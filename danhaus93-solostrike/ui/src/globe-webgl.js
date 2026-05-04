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
uniform float uRotY;          // current rotation — used to advance the texture lookup

varying vec3 vNormal;         // tilted, rotated sphere normal (for lighting)
varying vec3 vSpun;           // post-Y-rotation pre-tilt (for ground-fixed effects)
varying vec3 vObjectPos;      // original un-rotated position (for texture UV)

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
  // CRITICAL: compute UV from the ORIGINAL un-rotated position (vObjectPos).
  // The geometry rotates so the mesh spins, BUT vObjectPos interpolates
  // across each rotated triangle in screen space — so each screen pixel
  // ends up looking up the texture using the original (un-rotated) sphere
  // coordinates of whatever triangle currently covers it. As triangles
  // rotate into view, different parts of the texture come into view.
  float lon = atan(vObjectPos.x, vObjectPos.z);
  float lat = asin(clamp(vObjectPos.y, -1.0, 1.0));
  vec2 uv = vec2(
    fract(lon / (2.0 * PI) + 0.5),
    1.0 - (lat / PI + 0.5)
  );

  // Sample land mask from texture
  float landMask = texture2D(uMap, uv).r;

  // v1.8.8-rev32: hide equirectangular polar pinch.
  // At |lat| → 90° the texture's top/bottom row smears 360° around the
  // rotation axis (every longitude samples the same texel column), which
  // looks like a flat "cap" or jagged plateau at the top of the visible
  // globe. Fade the land mask to ocean over the last ~25° toward each
  // pole so the polar singularity dissolves into water — visually it
  // reads as the Arctic / Antarctic seas, which are mostly empty anyway.
  // rev32 widened the fade zone from (75, 89) → (65, 89) because the
  // user reports continued visible artifacts at the top of the globe.
  float absLatDeg = abs(lat) * 180.0 / PI;
  float polarFade = 1.0 - smoothstep(65.0, 89.0, absLatDeg);
  landMask *= polarFade;

  // Lighting — sun "above-left" relative to the camera frame.
  // Use vNormal (the rotated + tilted normal) so the lit hemisphere
  // stays anchored to the sun direction in screen space.
  vec3 light = normalize(vec3(-0.4, 0.5, 0.85));
  float NdotL = max(0.0, dot(vNormal, light));
  // v1.8.8-rev32: bump night-side floor 0.30 → 0.42 so the night-side
  // silhouette is visible against the dark page background. Without this
  // the night-side ocean rendered at ~RGB(0.01, 0.01, 0.01), identical
  // to the canvas backdrop, making the top/bottom of the globe look
  // "clipped" where the night-side rim met the background.
  float lit = 0.42 + 0.58 * NdotL;

  // Procedural noise for land texture. Sample in OBJECT space so the
  // noise pattern is stuck to the planet surface — rotates with the
  // continents instead of swimming over them.
  // v1.8.8-rev32: scale noise by polarFade too. At the poles, adjacent
  // mesh triangles have wildly different interpolated vObjectPos.x/z
  // values (because they meet at the same y=±1 point but come from
  // different longitudes), causing noise() to read jaggedly across the
  // pole. Fading noise to 0 there kills the visible striping.
  float noise = noise3(vObjectPos * 8.0) * 0.5
              + noise3(vObjectPos * 16.0) * 0.25
              + noise3(vObjectPos * 32.0) * 0.125;
  noise = (noise - 0.5) * 2.0 * polarFade;

  // Blend land + ocean
  vec3 oceanLit = uOceanColor * lit;
  vec3 landBase = uLandColor * (0.40 + 0.85 * NdotL);
  landBase *= (1.0 + noise * 0.18);
  vec3 baseColor = mix(oceanLit, landBase, landMask);

  // Limb darkening — pixels at the rim fade slightly. v1.8.8-rev32:
  // raised the floor 0.62 → 0.75 so the night-side silhouette remains
  // visible against the dark page background.
  float limb = clamp(vNormal.z * 1.3 + 0.10, 0.0, 1.0);
  baseColor *= mix(0.75, 1.0, limb);

  // v1.8.8-rev35: Fresnel rim glow RESTORED. This is the actual fix for
  // the persistent "top is clipped" reports across rev30→rev34. The
  // night-side hemisphere of the sphere paints at uOceanColor * ambient
  // ≈ RGB(0.018, 0.015, 0.010) — visually identical to the dark card
  // background. The unlit rim therefore disappears entirely, making
  // the globe look like a half-disc with a flat edge wherever lit meets
  // unlit. The 2D halo helps OUTSIDE the disk but doesn't put any light
  // ON the disk's silhouette — that has to come from the shader.
  //
  // pow(...,3.0) makes the falloff sharp so only the very rim glows;
  // the rest of the sphere is unaffected. Multiplier 0.55 is strong
  // enough to be visible against the dark background but doesn't blow
  // out the lit-side rim. uAtmColor is the existing warm amber.
  float fresnel = pow(1.0 - max(0.0, vNormal.z), 3.0);
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

  // Cache uniform/attribute locations
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
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
