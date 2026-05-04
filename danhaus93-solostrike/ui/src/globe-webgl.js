// SoloStrike WebGL globe renderer.
//
// Renders a textured sphere with limb darkening + atmospheric Fresnel glow.
// Designed to run behind a transparent 2D canvas that handles markers,
// pin tap overlay, and pin-placement UI.
//
// Public API:
//   const globe = createGlobeWebGL(canvas, { texture: ImageBitmap | HTMLCanvasElement })
//   globe.update({ rotY, dpr, width, height })  // call every frame
//   globe.destroy()                              // tear down on unmount
//   globe.isReady() // bool: WebGL context + shader compiled OK
//
// All numbers in the shader are in the [-1, 1] range so a single
// orthographic frustum 1:1 with the canvas works without a projection
// matrix. Sphere is centered at origin, radius 1.
//
// If WebGL context creation OR shader compilation fails for ANY reason,
// the factory returns null. Callers MUST check that.

const VERT_SHADER = `
precision mediump float;

attribute vec3 aPosition;     // sphere vertex position (radius 1, untransformed)

uniform float uRotY;          // yaw — rotation around Y axis (horizontal drag)
uniform float uRotX;          // pitch — rotation around X axis (vertical drag)
uniform float uAspect;        // canvas aspect ratio (W/H)
uniform float uScale;         // disk scale factor

varying vec3 vNormal;         // world-space normal AFTER rotation (for lighting)
varying vec3 vSpun;           // post-rotation (kept for shader symmetry)
varying vec3 vObjectPos;      // ORIGINAL un-rotated position — used for texture UV
                              // lookup. Texture coords MUST come from object space
                              // so the rendered surface scrolls under the rotated
                              // mesh as the user spins it.

void main() {
  vObjectPos = aPosition;

  // v1.8.8-rev36: removed fixed 23.5° axial tilt; replaced with user-
  // controlled pitch (uRotX). Apply PITCH first (rotates around X axis,
  // tipping planet forward/back) then YAW (rotates around Y axis,
  // spinning around the now-vertical pole). With this order, vertical
  // drag tips the planet and horizontal drag spins it — the standard
  // "Earth viewer" feel.
  float cx = cos(uRotX);
  float sx = sin(uRotX);
  vec3 pitched = vec3(
    aPosition.x,
    aPosition.y * cx - aPosition.z * sx,
    aPosition.y * sx + aPosition.z * cx
  );

  float cy = cos(uRotY);
  float sy = sin(uRotY);
  vec3 spun = vec3(
    pitched.x * cy + pitched.z * sy,
    pitched.y,
    -pitched.x * sy + pitched.z * cy
  );
  vSpun = spun;
  vNormal = spun;

  // Orthographic projection — disk fills uScale * canvas height
  vec2 screen = vec2(spun.x * uScale / uAspect, spun.y * uScale);
  gl_Position = vec4(screen, -spun.z, 1.0);
}
`;

const FRAG_SHADER = `
precision mediump float;

uniform sampler2D uMap;       // equirectangular world texture
uniform vec3 uOceanColor;     // dark amber-tinted near black
uniform vec3 uLandColor;      // strong amber wash
uniform vec3 uAtmColor;       // atmospheric glow color (used at rim)
uniform float uTime;          // for any subtle effects
uniform float uRotY;          // yaw — needed to inverse-rotate the
                              // reconstructed sphere normal back to
                              // object space for texture lookup
uniform float uRotX;          // pitch — same purpose as uRotY (rev37)

varying vec3 vNormal;         // (legacy, kept for shader symmetry — the
                              // exact normal is now reconstructed below)
varying vec3 vSpun;           // post-rotation vertex position. Linearly
                              // interpolated x,y == fragment's actual
                              // screen-space position (orthographic).
varying vec3 vObjectPos;      // (legacy, kept for shader symmetry)

const float PI = 3.14159265359;

// Hash-based 3D noise — cheap and stable for procedural land relief
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

void main() {
  // ─── v1.8.8-rev37: EXACT sphere-position reconstruction ──────────────
  //
  // The rev30→rev36 path used the linearly-interpolated un-rotated vertex
  // position (vObjectPos) for the texture UV lookup. That works fine over
  // most of the sphere, but the UV-sphere mesh has DEGENERATE FAN
  // TRIANGLES at the poles (one vertex collapsed to y=±1). For fragments
  // inside those fan triangles, interpolated x and z are tiny noisy
  // values, so atan2(x, z) returns a basically-random longitude and the
  // texture sampling is wrong over a wide cap around each pole. The
  // polar-fade hack (smoothstep(65°, 89°)) hid this by erasing land in
  // that band — which only "worked" visually while the globe was locked
  // upright, because the band appeared as a thin sliver at the disk's
  // top/bottom edge. rev36 added user-driven pitch, so the fade band
  // can now be rotated into the middle of the visible disk, where it
  // shows up as a giant concentric ring with continents (Greenland,
  // Svalbard, Russian Arctic, Canadian Arctic) erased inside it. That
  // is the "land masses don't align at the top of the globe" report.
  //
  // The fix: stop trusting the vertex-interpolated position. Instead
  // reconstruct the rotated sphere normal EXACTLY per fragment, then
  // inverse-rotate it to get the object-space normal for the texture.
  //
  // Why this works: the vertex shader uses an ORTHOGRAPHIC projection
  //     screen.x = spun.x * uScale / uAspect
  //     screen.y = spun.y * uScale
  // which is linear in spun.x and spun.y. The rasterizer's linear
  // interpolation of vSpun.xy across the triangle therefore reproduces
  // the EXACT spun.x and spun.y at each fragment's screen position.
  // Only spun.z is wrong (linear interp doesn't preserve the unit-sphere
  // constraint), and we can recompute it directly: z = sqrt(1 - x² - y²)
  // for any point on the front hemisphere of the unit sphere.
  //
  // Once we have the exact rotated normal, the inverse rotation chain
  // (un-YAW then un-PITCH, the reverse of the vertex shader's chain)
  // gives the exact object-space normal. Texture UV computed from this
  // is geometrically exact at every latitude — no mesh artifacts, no
  // need for any polar fade.
  vec3 spun = vec3(
    vSpun.xy,
    sqrt(max(0.0, 1.0 - dot(vSpun.xy, vSpun.xy)))
  );

  // Inverse YAW (rotate by -uRotY around Y axis)
  float cy = cos(uRotY);
  float sy = sin(uRotY);
  vec3 unyawed = vec3(
    spun.x * cy - spun.z * sy,
    spun.y,
    spun.x * sy + spun.z * cy
  );
  // Inverse PITCH (rotate by -uRotX around X axis)
  float cx = cos(uRotX);
  float sx = sin(uRotX);
  vec3 obj = vec3(
    unyawed.x,
    unyawed.y * cx + unyawed.z * sx,
    -unyawed.y * sx + unyawed.z * cx
  );

  float lon = atan(obj.x, obj.z);
  float lat = asin(clamp(obj.y, -1.0, 1.0));
  vec2 uv = vec2(
    fract(lon / (2.0 * PI) + 0.5),
    1.0 - (lat / PI + 0.5)
  );

  // Sample land mask. No more polar fade — sampling is exact, and the
  // equirectangular texture's actual polar singularity (one row covers
  // all longitudes at lat=±90°) is sub-pixel at any sane resolution.
  float landMask = texture2D(uMap, uv).r;

  // Lighting uses the exact rotated normal (== spun, since it's a unit
  // vector by construction). Sun is "above-left" relative to camera.
  vec3 light = normalize(vec3(-0.4, 0.5, 0.85));
  float NdotL = max(0.0, dot(spun, light));
  float lit = 0.42 + 0.58 * NdotL;

  // Procedural noise — sampled in object space (rotates with planet).
  // Now safe to sample at the poles too because obj is exact.
  float noise = noise3(obj * 8.0) * 0.5
              + noise3(obj * 16.0) * 0.25
              + noise3(obj * 32.0) * 0.125;
  noise = (noise - 0.5) * 2.0;

  vec3 oceanLit = uOceanColor * lit;
  vec3 landBase = uLandColor * (0.40 + 0.85 * NdotL);
  landBase *= (1.0 + noise * 0.18);
  vec3 baseColor = mix(oceanLit, landBase, landMask);

  // Limb darkening — uses exact spun.z so the falloff is geometrically
  // correct, matching the visible silhouette exactly.
  float limb = clamp(spun.z * 1.3 + 0.10, 0.0, 1.0);
  baseColor *= mix(0.75, 1.0, limb);

  // Fresnel rim glow (rev35) — also uses exact spun.z.
  float fresnel = pow(1.0 - max(0.0, spun.z), 3.0);
  baseColor += uAtmColor * fresnel * 0.55;

  gl_FragColor = vec4(baseColor, 1.0);
}
`;

// Build a sphere mesh as triangle strips. nLat × nLon vertices.
// Returns { positions, indices } as Float32Array / Uint16Array.
// (UVs are computed per-pixel in the fragment shader from the rotated
// normal — fixes the seam-line bug.)
function buildSphereMesh(nLat = 48, nLon = 96) {
  const positions = new Float32Array(nLat * nLon * 3);
  let p = 0;
  for (let i = 0; i < nLat; i++) {
    const lat = -Math.PI / 2 + (i / (nLat - 1)) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let j = 0; j < nLon; j++) {
      const lon = (j / nLon) * Math.PI * 2;
      const x = cosLat * Math.sin(lon);
      const y = sinLat;
      const z = cosLat * Math.cos(lon);
      positions[p++] = x;
      positions[p++] = y;
      positions[p++] = z;
    }
  }

  // Index buffer — quads as two triangles
  const indices = [];
  for (let i = 0; i < nLat - 1; i++) {
    for (let j = 0; j < nLon; j++) {
      const a = i * nLon + j;
      const b = i * nLon + ((j + 1) % nLon);
      const c = (i + 1) * nLon + j;
      const d = (i + 1) * nLon + ((j + 1) % nLon);
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }
  return { positions, indices: new Uint16Array(indices) };
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    console.error('Shader compile error:', log, '\n', src);
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function createGlobeWebGL(canvas, opts = {}) {
  // Try to get a WebGL context. Bail early on any failure.
  let gl = null;
  try {
    gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false })
       || canvas.getContext('experimental-webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
  } catch (e) {
    console.warn('WebGL ctx creation threw:', e);
    return null;
  }
  if (!gl) {
    console.warn('WebGL not supported on this device');
    return null;
  }

  // Compile shaders
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(program));
    return null;
  }
  gl.useProgram(program);

  // Cache uniform/attribute locations.
  // v1.8.8-rev37: uRotX and uRotY are now used in the FRAGMENT shader
  // too (for the per-fragment inverse-rotation that powers the exact
  // sphere reconstruction). The uniform location lookup automatically
  // picks up the merged usage — same name, same uniform, just visible
  // to both stages.
  const locs = {
    aPosition: gl.getAttribLocation(program, 'aPosition'),
    uRotY: gl.getUniformLocation(program, 'uRotY'),
    uRotX: gl.getUniformLocation(program, 'uRotX'),
    uAspect: gl.getUniformLocation(program, 'uAspect'),
    uScale: gl.getUniformLocation(program, 'uScale'),
    uMap: gl.getUniformLocation(program, 'uMap'),
    uOceanColor: gl.getUniformLocation(program, 'uOceanColor'),
    uLandColor: gl.getUniformLocation(program, 'uLandColor'),
    uAtmColor: gl.getUniformLocation(program, 'uAtmColor'),
    uTime: gl.getUniformLocation(program, 'uTime'),
  };

  // Build sphere mesh
  const mesh = buildSphereMesh(48, 96);
  const posBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(locs.aPosition);
  gl.vertexAttribPointer(locs.aPosition, 3, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
  const indexCount = mesh.indices.length;

  // Texture — placeholder until baked
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // 1x1 black placeholder so we can render before real texture arrives
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // v1.8.8-rev38: trilinear with auto-generated mipmaps. With bilinear-
  // only filtering, the polar region aliased badly: at the pole, atan2()
  // is geometrically ill-conditioned (lon = atan2(~0, ~0)), so adjacent
  // screen pixels in the polar cap sample wildly different longitudes.
  // A 2x2 LINEAR window can't average out 1024-wide land/ocean stripes,
  // so it shows up as concentric high-frequency rings centered on the
  // visible pole. With mipmapping, the GPU's per-fragment dFdx/dFdy of
  // UV picks a coarser mip when UV is jumping fast — at the pole, that
  // collapses the polar cap to the averaged equirectangular row, which
  // reads as a soft fade rather than ringing.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(locs.uMap, 0);

  // Set the colors — strong SoloStrike amber palette
  // Ocean: dark warm with amber undertone. v1.8.8-rev32: bumped from
  // (0.060, 0.050, 0.034) so night-side ocean stays visible against
  // the dark page background (~rgb(4,5,10)/256 = ~0.018).
  gl.uniform3f(locs.uOceanColor, 0.090, 0.075, 0.050);
  // Land: STRONG amber. Pure #F5A623 = (0.961, 0.651, 0.137).
  // Pushed up vs prior (0.78, 0.50, 0.10) so continents read warmly even
  // in shadow. Lighting modulation in fragment shader brings down the
  // shadow side appropriately.
  gl.uniform3f(locs.uLandColor, 0.96, 0.65, 0.14);
  // Atmosphere: warm amber for the Fresnel rim glow
  gl.uniform3f(locs.uAtmColor, 0.96, 0.65, 0.14);

  // Disk scale — controls how much of the canvas the sphere takes up.
  // v1.8.8-rev31: dropped 0.78 → 0.72. The 2D atmospheric halo has an
  // outer radius of atmRadius * 1.34, and atmRadius = uScale/2 * H. With
  // uScale 0.78 that put the halo's outer edge at 0.5226 * H from
  // center, ~9px past the canvas top/bottom on a 380px-tall container —
  // the halo got clipped at the top edge and the residual polar pinch
  // ended up right at the visible silhouette. 0.72 puts the halo outer
  // at 0.482 * H, leaving ~7px breathing room. Marker render radius
  // (atmRadius in App.jsx) and tap inverse-projection radius MUST track
  // this number — they're tied to uScale/2.
  gl.uniform1f(locs.uScale, 0.72);

  // v1.8.8-rev36: axial tilt removed. Replaced with user-controlled
  // pitch (uRotX) so the user can drag the planet to any orientation.
  // Initial value 0 = upright. App.jsx drives uRotX from drag state.

  // GL state
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0, 0, 0, 0); // transparent — page bg now solid #000 (rev36)

  let _ready = true;
  let _destroyed = false;

  return {
    isReady() { return _ready && !_destroyed; },

    // Upload a new equirectangular texture (HTMLCanvasElement, ImageBitmap, or HTMLImageElement)
    setTexture(source) {
      if (_destroyed) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      // v1.8.8-rev38: regenerate mipmap chain after every upload. Texture
      // dims (1024x512) are power-of-two so this is well-defined in WebGL1.
      gl.generateMipmap(gl.TEXTURE_2D);
    },

    // Draw a frame.
    // v1.8.8-rev36: now accepts both rotY (yaw) and rotX (pitch) so the
    // caller can drive full 2-axis rotation from drag state.
    update({ rotY = 0, rotX = 0, dpr = 1, width = 100, height = 100 }) {
      if (_destroyed || !_ready) return;
      const W = Math.round(width * dpr);
      const H = Math.round(height * dpr);
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      gl.viewport(0, 0, W, H);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform1f(locs.uRotY, rotY);
      gl.uniform1f(locs.uRotX, rotX);
      gl.uniform1f(locs.uAspect, W / H);
      gl.uniform1f(locs.uTime, performance.now() / 1000);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
    },

    destroy() {
      if (_destroyed) return;
      _destroyed = true;
      try {
        gl.deleteBuffer(posBuf);
        gl.deleteBuffer(idxBuf);
        gl.deleteTexture(tex);
        gl.deleteProgram(program);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      } catch {}
    },
  };
}

// Bake an equirectangular world map texture from already-decoded TopoJSON
// rings. Returns a 1024x512 OffscreenCanvas (or HTMLCanvasElement) ready
// to upload as a WebGL texture.
//
// Land = white-ish (R=240). Ocean = black (R=15). The shader blends
// uOceanColor → uLandColor based on the red channel.
//
// NOTE: rings come in as arrays of [lon, lat] in degrees (TopoJSON-style).
export function bakeWorldMapTexture(rings, opts = {}) {
  const W = opts.width || 1024;
  const H = opts.height || 512;

  // Use a regular HTMLCanvasElement — works everywhere
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // Ocean
  ctx.fillStyle = 'rgb(15,15,15)';
  ctx.fillRect(0, 0, W, H);

  // Land — fill each ring as a polygon. Equirectangular projection:
  //   x = (lon + 180) / 360 * W
  //   y = (90 - lat) / 180 * H
  ctx.fillStyle = 'rgb(240,240,240)';
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let started = false;
    for (let i = 0; i < ring.length; i++) {
      const lon = ring[i][0];
      const lat = ring[i][1];
      const x = (lon + 180) / 360 * W;
      const y = (90 - lat) / 180 * H;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else { ctx.lineTo(x, y); }
    }
    ctx.closePath();
  }
  // Even-odd rule handles holes/overlap consistently
  ctx.fill('evenodd');

  // Subtle blur to soften coastline pixelation when sampled
  // (optional — skip if performance becomes an issue)
  return c;
}
