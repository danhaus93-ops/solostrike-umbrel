// SoloStrike WebGL globe renderer — rev42 (rev27 restoration + debug).
//
// This is a restoration of the rev27 build (the "Globes looking awesome!"
// version) with a debug overlay added. Lighting/colors/shader logic
// matches rev27. Pitch is back to a fixed 23.5° axial tilt — no user-
// controlled pitch.
//
// DEBUG MODE: pass { debug: true } to enable a wireframe overlay that
// makes the mesh topology visible. This is how we'll see what's actually
// happening at the poles.
//
// Public API:
//   const globe = createGlobeWebGL(canvas, { debug?: bool })
//   globe.setTexture(canvasOrImage)
//   globe.update({ rotY, dpr, width, height })
//   globe.destroy()
//   globe.isReady()

const VERT_SHADER = `
precision mediump float;

attribute vec3 aPosition;

uniform float uRotY;
uniform float uRotX;
uniform float uTilt;
uniform float uAspect;
uniform float uScale;

varying vec3 vNormal;
varying vec3 vSpun;
varying vec3 vObjectPos;

void main() {
  vObjectPos = aPosition;

  // 1) Rotate around Y (planetary spin / yaw)
  float cy = cos(uRotY);
  float sy = sin(uRotY);
  vec3 spun = vec3(
    aPosition.x * cy + aPosition.z * sy,
    aPosition.y,
    -aPosition.x * sy + aPosition.z * cy
  );
  vSpun = spun;

  // 2) Axial tilt around Z (fixed 23.5°)
  float ct = cos(uTilt);
  float st = sin(uTilt);
  vec3 tilted = vec3(
    spun.x * ct - spun.y * st,
    spun.x * st + spun.y * ct,
    spun.z
  );

  // 3) User-controlled pitch around X (look up/down at poles)
  float cp = cos(uRotX);
  float sp = sin(uRotX);
  vec3 pitched = vec3(
    tilted.x,
    tilted.y * cp - tilted.z * sp,
    tilted.y * sp + tilted.z * cp
  );
  vNormal = pitched;

  // Orthographic projection
  vec2 screen = vec2(pitched.x * uScale / uAspect, pitched.y * uScale);
  gl_Position = vec4(screen, -pitched.z, 1.0);
}
`;

const FRAG_SHADER = `
precision mediump float;

uniform sampler2D uMap;
uniform vec3 uOceanColor;
uniform vec3 uLandColor;
uniform vec3 uAtmColor;
uniform float uTime;
uniform float uRotY;

varying vec3 vNormal;
varying vec3 vSpun;
varying vec3 vObjectPos;

const float PI = 3.14159265359;

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
  // UV from object position (rev27 critical fix — texture stays anchored
  // to mesh in object space, so as the mesh rotates different parts of
  // the texture come into screen view).
  float lon = atan(vObjectPos.x, vObjectPos.z);
  float lat = asin(clamp(vObjectPos.y, -1.0, 1.0));
  vec2 uv = vec2(
    fract(lon / (2.0 * PI) + 0.5),
    1.0 - (lat / PI + 0.5)
  );

  // Sample land mask
  float landMask = texture2D(uMap, uv).r;

  // Lighting — sun upper-left
  vec3 light = normalize(vec3(-0.4, 0.5, 0.85));
  float NdotL = max(0.0, dot(vNormal, light));
  // rev27 values
  float lit = 0.30 + 0.70 * NdotL;

  // Procedural noise on land
  float noise = noise3(vObjectPos * 8.0) * 0.5
              + noise3(vObjectPos * 16.0) * 0.25
              + noise3(vObjectPos * 32.0) * 0.125;
  noise = (noise - 0.5) * 2.0;

  // Blend land + ocean
  vec3 oceanLit = uOceanColor * lit;
  vec3 landBase = uLandColor * (0.40 + 0.85 * NdotL);
  landBase *= (1.0 + noise * 0.18);
  vec3 baseColor = mix(oceanLit, landBase, landMask);

  // Limb darkening — rev27 values
  float limb = clamp(vNormal.z * 1.3 + 0.10, 0.0, 1.0);
  baseColor *= mix(0.62, 1.0, limb);

  gl_FragColor = vec4(baseColor, 1.0);
}
`;

// Debug fragment shader for wireframe overlay — solid amber lines.
const DEBUG_FRAG = `
precision mediump float;
void main() {
  gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
}
`;

function buildSphereMesh(nLat = 48, nLon = 96) {
  const positions = new Float32Array(nLat * nLon * 3);
  let p = 0;
  for (let i = 0; i < nLat; i++) {
    const lat = -Math.PI / 2 + (i / (nLat - 1)) * Math.PI;
    const cosLat = Math.cos(lat);
    const sinLat = Math.sin(lat);
    for (let j = 0; j < nLon; j++) {
      const lon = (j / nLon) * Math.PI * 2;
      positions[p++] = cosLat * Math.sin(lon);
      positions[p++] = sinLat;
      positions[p++] = cosLat * Math.cos(lon);
    }
  }
  const indices = [];
  for (let i = 0; i < nLat - 1; i++) {
    for (let j = 0; j < nLon; j++) {
      const a = i * nLon + j;
      const b = i * nLon + ((j + 1) % nLon);
      const c = (i + 1) * nLon + j;
      const d = (i + 1) * nLon + ((j + 1) % nLon);
      indices.push(a, b, c, b, d, c);
    }
  }

  // Build wireframe edge index buffer (lines only, no triangles)
  const edges = [];
  for (let i = 0; i < nLat - 1; i++) {
    for (let j = 0; j < nLon; j++) {
      const a = i * nLon + j;
      const b = i * nLon + ((j + 1) % nLon);
      const c = (i + 1) * nLon + j;
      edges.push(a, b);   // horizontal edge
      edges.push(a, c);   // vertical edge
    }
  }
  // Final row's horizontal edges
  for (let j = 0; j < nLon; j++) {
    const a = (nLat - 1) * nLon + j;
    const b = (nLat - 1) * nLon + ((j + 1) % nLon);
    edges.push(a, b);
  }

  return {
    positions,
    indices: new Uint16Array(indices),
    edges: new Uint16Array(edges),
  };
}

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(sh), '\n', src);
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export function createGlobeWebGL(canvas, opts = {}) {
  const debugMode = !!opts.debug;
  let gl;
  try {
    gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      depth: true,
    });
  } catch {}
  if (!gl) return null;

  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER);
  if (!vs || !fs) return null;

  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  // Optional debug program for wireframe overlay
  let debugProgram = null;
  let debugVs = null, debugFs = null;
  if (debugMode) {
    debugVs = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER);
    debugFs = compileShader(gl, gl.FRAGMENT_SHADER, DEBUG_FRAG);
    if (debugVs && debugFs) {
      debugProgram = gl.createProgram();
      gl.attachShader(debugProgram, debugVs);
      gl.attachShader(debugProgram, debugFs);
      gl.linkProgram(debugProgram);
    }
  }

  gl.useProgram(program);

  const locs = {
    aPosition:   gl.getAttribLocation(program, 'aPosition'),
    uRotY:       gl.getUniformLocation(program, 'uRotY'),
    uRotX:       gl.getUniformLocation(program, 'uRotX'),
    uTilt:       gl.getUniformLocation(program, 'uTilt'),
    uAspect:     gl.getUniformLocation(program, 'uAspect'),
    uScale:      gl.getUniformLocation(program, 'uScale'),
    uMap:        gl.getUniformLocation(program, 'uMap'),
    uOceanColor: gl.getUniformLocation(program, 'uOceanColor'),
    uLandColor:  gl.getUniformLocation(program, 'uLandColor'),
    uAtmColor:   gl.getUniformLocation(program, 'uAtmColor'),
    uTime:       gl.getUniformLocation(program, 'uTime'),
  };

  const debugLocs = debugProgram ? {
    aPosition: gl.getAttribLocation(debugProgram, 'aPosition'),
    uRotY:     gl.getUniformLocation(debugProgram, 'uRotY'),
    uRotX:     gl.getUniformLocation(debugProgram, 'uRotX'),
    uTilt:     gl.getUniformLocation(debugProgram, 'uTilt'),
    uAspect:   gl.getUniformLocation(debugProgram, 'uAspect'),
    uScale:    gl.getUniformLocation(debugProgram, 'uScale'),
  } : null;

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

  // Wireframe edge buffer (only used in debug mode)
  let edgeBuf = null;
  let edgeCount = 0;
  if (debugMode) {
    edgeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.edges, gl.STATIC_DRAW);
    edgeCount = mesh.edges.length;
  }

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(locs.uMap, 0);

  // rev27 colors
  gl.uniform3f(locs.uOceanColor, 0.060, 0.050, 0.034);
  gl.uniform3f(locs.uLandColor,  0.96, 0.65, 0.14);
  gl.uniform3f(locs.uAtmColor,   0.96, 0.65, 0.14);
  gl.uniform1f(locs.uScale, 0.78);
  // rev44+: in debug mode, zero out the axial tilt so the user can
  // pitch straight down to look directly at either pole. The 23.5° tilt
  // is the cosmetic axial tilt of Earth — useful for the live globe but
  // gets in the way when inspecting pole topology.
  const initialTilt = debugMode ? 0 : (23.5 * Math.PI / 180);
  gl.uniform1f(locs.uTilt, initialTilt);

  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LESS);
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
  gl.clearColor(0, 0, 0, 0);

  let _ready = true;
  let _destroyed = false;

  return {
    isReady() { return _ready && !_destroyed; },

    setTexture(source) {
      if (_destroyed) return;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },

    update({ rotY = 0, rotX = 0, dpr = 1, width = 100, height = 100 }) {
      if (_destroyed || !_ready) return;
      const W = Math.round(width * dpr);
      const H = Math.round(height * dpr);
      if (canvas.width !== W) canvas.width = W;
      if (canvas.height !== H) canvas.height = H;
      gl.viewport(0, 0, W, H);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // Main pass — solid sphere
      gl.useProgram(program);
      gl.uniform1f(locs.uRotY, rotY);
      gl.uniform1f(locs.uRotX, rotX);
      gl.uniform1f(locs.uAspect, W / H);
      gl.uniform1f(locs.uTime, performance.now() / 1000);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.enableVertexAttribArray(locs.aPosition);
      gl.vertexAttribPointer(locs.aPosition, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);

      // Debug wireframe pass — overlay red lines on every triangle edge.
      // Disable depth test so wireframe always appears on top.
      if (debugMode && debugProgram) {
        gl.useProgram(debugProgram);
        gl.uniform1f(debugLocs.uRotY, rotY);
        gl.uniform1f(debugLocs.uRotX, rotX);
        gl.uniform1f(debugLocs.uTilt, initialTilt);
        gl.uniform1f(debugLocs.uAspect, W / H);
        gl.uniform1f(debugLocs.uScale, 0.78);
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.enableVertexAttribArray(debugLocs.aPosition);
        gl.vertexAttribPointer(debugLocs.aPosition, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, edgeBuf);
        gl.disable(gl.DEPTH_TEST);
        gl.drawElements(gl.LINES, edgeCount, gl.UNSIGNED_SHORT, 0);
        gl.enable(gl.DEPTH_TEST);
      }
    },

    destroy() {
      if (_destroyed) return;
      _destroyed = true;
      try {
        gl.deleteBuffer(posBuf);
        gl.deleteBuffer(idxBuf);
        if (edgeBuf) gl.deleteBuffer(edgeBuf);
        gl.deleteTexture(tex);
        gl.deleteProgram(program);
        if (debugProgram) gl.deleteProgram(debugProgram);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        if (debugVs) gl.deleteShader(debugVs);
        if (debugFs) gl.deleteShader(debugFs);
      } catch {}
    },
  };
}

// Bake equirectangular world map texture from TopoJSON-style rings.
// rings: arrays of [lon, lat] in degrees.
export function bakeWorldMapTexture(rings, opts = {}) {
  const W = opts.width || 1024;
  const H = opts.height || 512;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  ctx.fillStyle = 'rgb(15,15,15)';
  ctx.fillRect(0, 0, W, H);

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
  ctx.fill('evenodd');

  return c;
}
