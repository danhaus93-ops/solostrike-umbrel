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

attribute vec3 aPosition;     // sphere vertex position (radius 1)

uniform float uRotY;          // current rotation around Y axis (radians)
uniform float uTilt;          // axial tilt angle (radians, ~0.41 = 23.5°)
uniform float uAspect;        // canvas aspect ratio (W/H)
uniform float uScale;         // disk scale factor

varying vec3 vNormal;         // world-space normal AFTER rotation (for tex lookup + lighting)
varying vec3 vUntilted;       // normal in axial frame — used for terminator calc

void main() {
  // First: rotate around Y (planet's spin)
  float cy = cos(uRotY);
  float sy = sin(uRotY);
  vec3 spun = vec3(
    aPosition.x * cy + aPosition.z * sy,
    aPosition.y,
    -aPosition.x * sy + aPosition.z * cy
  );
  vUntilted = spun;

  // Then: tilt around Z (axial tilt — leans the spin axis)
  float ct = cos(uTilt);
  float st = sin(uTilt);
  vec3 tilted = vec3(
    spun.x * ct - spun.y * st,
    spun.x * st + spun.y * ct,
    spun.z
  );
  vNormal = tilted;

  // Orthographic projection
  vec2 screen = vec2(tilted.x * uScale / uAspect, tilted.y * uScale);
  gl_Position = vec4(screen, -tilted.z, 1.0);
}
`;

const FRAG_SHADER = `
precision mediump float;

uniform sampler2D uMap;       // equirectangular world texture
uniform vec3 uOceanColor;     // dark amber-tinted near black
uniform vec3 uLandColor;      // strong amber wash
uniform vec3 uAtmColor;       // atmospheric glow color (used at rim)
uniform float uTime;          // for any subtle effects

varying vec3 vNormal;         // tilted, rotated sphere normal
varying vec3 vUntilted;       // pre-tilt rotated normal (for tex lookup)

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
  f = f * f * (3.0 - 2.0 * f);  // smoothstep
  return mix(
    mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

void main() {
  // Compute equirectangular UV from the UN-tilted rotated normal, in
  // fragment shader. atan2 is continuous so no seam issue. This is the
  // key fix for the vertical line bug.
  float lon = atan(vUntilted.x, vUntilted.z);  // -PI..PI
  float lat = asin(clamp(vUntilted.y, -1.0, 1.0));  // -PI/2..PI/2
  vec2 uv = vec2(
    lon / (2.0 * PI) + 0.5,
    1.0 - (lat / PI + 0.5)
  );

  // Sample land mask from texture
  float landMask = texture2D(uMap, uv).r;

  // Lighting — sun "above-left" relative to the tilted globe.
  // Use vNormal (the tilted normal) so the lit hemisphere stays steady
  // as the planet spins.
  vec3 light = normalize(vec3(-0.4, 0.5, 0.85));
  float NdotL = max(0.0, dot(vNormal, light));
  float lit = 0.30 + 0.70 * NdotL;

  // Land color — strong amber, modulated by lighting + procedural noise.
  // Noise sampled from world-space (un-tilted) so it stays "fixed to the
  // ground" as the planet rotates instead of swimming.
  float noise = noise3(vUntilted * 8.0) * 0.5
              + noise3(vUntilted * 16.0) * 0.25
              + noise3(vUntilted * 32.0) * 0.125;
  // Bring noise from [0,1] to [-1,1], then scale to subtle relief
  noise = (noise - 0.5) * 2.0;

  // Blend land + ocean by mask
  vec3 oceanLit = uOceanColor * lit;
  // Land base: full amber where lit, dim brown where shadow
  vec3 landBase = uLandColor * (0.40 + 0.85 * NdotL);
  // Apply noise as a brightness modulation (±18%)
  landBase *= (1.0 + noise * 0.18);
  vec3 baseColor = mix(oceanLit, landBase, landMask);

  // Limb darkening — pixels at the rim fade slightly
  float limb = clamp(vNormal.z * 1.3 + 0.10, 0.0, 1.0);
  baseColor *= mix(0.62, 1.0, limb);

  // v1.8.8-rev27: Fresnel rim glow REMOVED. It was painting amber INSIDE
  // the silhouette which made the "atmospheric glow" look like it was
  // inside the globe. Atmosphere is now exclusively the 2D radial halo
  // drawn OUTSIDE the disk on the 2D canvas.

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
    uTilt: gl.getUniformLocation(program, 'uTilt'),
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
  // Ocean: very dark warm (almost black with slight amber undertone)
  gl.uniform3f(locs.uOceanColor, 0.060, 0.050, 0.034);
  // Land: STRONG amber. Pure #F5A623 = (0.961, 0.651, 0.137).
  // Pushed up vs prior (0.78, 0.50, 0.10) so continents read warmly even
  // in shadow. Lighting modulation in fragment shader brings down the
  // shadow side appropriately.
  gl.uniform3f(locs.uLandColor, 0.96, 0.65, 0.14);
  // Atmosphere: warm amber for the Fresnel rim glow
  gl.uniform3f(locs.uAtmColor, 0.96, 0.65, 0.14);

  // Disk scale — controls how much of the canvas the sphere takes up.
  // 0.78 leaves room around the edge for the atmospheric glow halo
  // (drawn on the 2D canvas) to fully spread without clipping.
  gl.uniform1f(locs.uScale, 0.78);

  // Axial tilt — Earth's actual tilt is 23.5°. Adds visual interest
  // and makes it feel like a "real planet" rather than a perfect upright sphere.
  gl.uniform1f(locs.uTilt, 23.5 * Math.PI / 180);

  // GL state
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0.016, 0.020, 0.039, 0); // matches SoloStrike --bg-0 with alpha 0

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
    update({ rotY = 0, dpr = 1, width = 100, height = 100 }) {
      if (_destroyed || !_ready) return;
      const W = Math.round(width * dpr);
      const H = Math.round(height * dpr);
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      gl.viewport(0, 0, W, H);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform1f(locs.uRotY, rotY);
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
