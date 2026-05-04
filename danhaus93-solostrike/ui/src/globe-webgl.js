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
attribute vec2 aLatLon;       // (lat, lon) in radians, for tex lookup

uniform float uRotY;          // current rotation around Y axis (radians)
uniform float uAspect;        // canvas aspect ratio (W/H)
uniform float uScale;         // disk scale factor (e.g. 0.84)

varying vec3 vNormal;         // world-space normal (= rotated position)
varying vec2 vTexCoord;       // 0..1 equirectangular tex coord

void main() {
  // Rotate the sphere around the Y axis
  float c = cos(uRotY);
  float s = sin(uRotY);
  vec3 rotated = vec3(
    aPosition.x * c + aPosition.z * s,
    aPosition.y,
    -aPosition.x * s + aPosition.z * c
  );
  vNormal = rotated;

  // Equirectangular tex coord: lon in [0,2pi] → u in [0,1], lat in [-pi/2,pi/2] → v in [0,1]
  vTexCoord = vec2(
    fract(aLatLon.y / 6.2831853 + 0.5),
    1.0 - (aLatLon.x / 3.1415927 + 0.5)
  );

  // Orthographic projection — disk fills uScale * canvas height
  vec2 screen = vec2(rotated.x * uScale / uAspect, rotated.y * uScale);
  // Z used only for depth ordering (visible hemisphere only).
  // Map z=[-1,1] -> depth=[1,-1] so front of sphere wins
  gl_Position = vec4(screen, -rotated.z, 1.0);
}
`;

const FRAG_SHADER = `
precision mediump float;

uniform sampler2D uMap;       // equirectangular world texture (1024x512)
uniform vec3 uOceanColor;     // dark amber-tinted near black
uniform vec3 uLandColor;      // amber wash
uniform vec3 uAtmColor;       // atmospheric glow color
uniform float uTime;          // for any subtle effects

varying vec3 vNormal;
varying vec2 vTexCoord;

void main() {
  // The texture is grayscale where land=bright, ocean=dark.
  // Blend ocean->land based on luminance.
  float landMask = texture2D(uMap, vTexCoord).r;

  // Sphere normal lighting — fake "noon" at upper-left
  vec3 light = normalize(vec3(-0.4, 0.3, 0.85));
  float NdotL = max(0.0, dot(vNormal, light));
  // Ambient + diffuse combo
  float lit = 0.35 + 0.65 * NdotL;

  // Ocean + land blend
  vec3 oceanLit = uOceanColor * lit;
  vec3 landLit = uLandColor * (0.45 + 0.65 * NdotL);
  vec3 baseColor = mix(oceanLit, landLit, landMask);

  // Limb darkening — pixels near the rim of the visible disk fade
  // slightly toward black. vNormal.z is camera-facing (1 at center, 0 at rim).
  float limb = clamp(vNormal.z * 1.3 + 0.05, 0.0, 1.0);
  baseColor *= mix(0.55, 1.0, limb);

  // Fresnel atmospheric glow — bright at silhouette where normal.z → 0
  float fresnel = pow(1.0 - max(0.0, vNormal.z), 3.5);
  baseColor += uAtmColor * fresnel * 0.55;

  gl_FragColor = vec4(baseColor, 1.0);
}
`;

// Build a sphere mesh as triangle strips. nLat × nLon vertices.
// Returns { positions, latLons, indices } as Float32Array / Uint16Array.
function buildSphereMesh(nLat = 48, nLon = 96) {
  const positions = new Float32Array(nLat * nLon * 3);
  const latLons = new Float32Array(nLat * nLon * 2);
  let p = 0, ll = 0;
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
      latLons[ll++] = lat;
      latLons[ll++] = lon;
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
  return { positions, latLons, indices: new Uint16Array(indices) };
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
    aLatLon: gl.getAttribLocation(program, 'aLatLon'),
    uRotY: gl.getUniformLocation(program, 'uRotY'),
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

  const llBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, llBuf);
  gl.bufferData(gl.ARRAY_BUFFER, mesh.latLons, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(locs.aLatLon);
  gl.vertexAttribPointer(locs.aLatLon, 2, gl.FLOAT, false, 0, 0);

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

  // Set the colors — match SoloStrike amber palette
  // Ocean: very dark warm (almost black, slight amber undertone)
  gl.uniform3f(locs.uOceanColor, 0.040, 0.034, 0.024);
  // Land: amber wash. #F5A623 = (0.961, 0.651, 0.137). Toned down so the
  // texture mask + lighting can modulate without clipping.
  gl.uniform3f(locs.uLandColor, 0.78, 0.50, 0.10);
  // Atmosphere: slightly warmer amber, used for the Fresnel rim glow
  gl.uniform3f(locs.uAtmColor, 0.96, 0.65, 0.14);

  // Disk scale — controls how much of the canvas the sphere takes up.
  // 0.84 leaves room around the edge for the atmospheric glow to spread
  gl.uniform1f(locs.uScale, 0.84);

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
        gl.deleteBuffer(llBuf);
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
