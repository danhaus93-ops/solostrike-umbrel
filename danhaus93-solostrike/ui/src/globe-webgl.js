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

varying vec3 vNormal;
varying vec3 vObjectPos;

const float PI = 3.14159265359;

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

  // rev52 combo: texture is full color (amber land with biome shading,
  // coastline ink, polar ice, city lights). Sample directly.
  vec3 texColor = texture2D(uMap, uv).rgb;

  // Lighting — sun upper-left
  vec3 light = normalize(vec3(-0.4, 0.5, 0.85));
  float NdotL = max(0.0, dot(vNormal, light));
  float lit = 0.30 + 0.70 * NdotL;

  // Detect bright spots (city lights) — they should glow even on the
  // night side. r > 0.85 AND g > 0.85 means bright pinpoint pixel.
  float cityLight = step(0.85, texColor.r) * step(0.85, texColor.g);

  // Day-side: full lit color. Night-side: dark, but city lights glow.
  vec3 baseColor = texColor * lit;
  // Add city light glow (amber-ish) on the dark side
  baseColor += texColor * cityLight * (1.0 - NdotL) * 0.6;

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

  gl.uniform1f(locs.uScale, 0.72);
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

      // rev52: dynamic uScale so disk size = min(W,H) * 0.46 in pixels.
      // Pixel disk radius = uScale * H / 2, so uScale = 0.92 * min(W,H)/H.
      const dynScale = 0.92 * Math.min(W, H) / H;

      // Main pass — solid sphere
      gl.useProgram(program);
      gl.uniform1f(locs.uRotY, rotY);
      gl.uniform1f(locs.uRotX, rotX);
      gl.uniform1f(locs.uAspect, W / H);
      gl.uniform1f(locs.uScale, dynScale);
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
        gl.uniform1f(debugLocs.uScale, dynScale);
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

// Hash-based deterministic noise. Reproducible across reloads.
function _hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}
function _valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = _hash2(ix, iy);
  const b = _hash2(ix + 1, iy);
  const c = _hash2(ix, iy + 1);
  const d = _hash2(ix + 1, iy + 1);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  return a*(1-sx)*(1-sy) + b*sx*(1-sy) + c*(1-sx)*sy + d*sx*sy;
}
function _fbm(x, y) {
  let v = 0, amp = 1, freq = 1, total = 0;
  for (let i = 0; i < 4; i++) {
    v += _valueNoise(x * freq, y * freq) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return v / total;
}

// Bake equirectangular world map texture from TopoJSON-style rings.
// rings: arrays of [lon, lat] in degrees.
//
// rev52 COMBO bake — outputs full-color RGB texture (not grayscale mask):
//   - Amber land base with FBM biome variation
//   - Coastline ink (dark amber stroke on every land edge)
//   - Polar ice caps for Antarctica + Arctic
//   - City lights (bright pinpoints scattered on land)
//   - Antimeridian split (so polygons don't draw stripes across map)
//   - Polar fill (so Antarctica doesn't render as a fan)
//
// The shader was updated to use texture color directly. Don't use this
// with the legacy grayscale-mask shader path.
export function bakeWorldMapTexture(rings, opts = {}) {
  const W = opts.width || 2048;
  const H = opts.height || 1024;

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // OCEAN — solid dark base. Shader will tint based on lighting.
  ctx.fillStyle = 'rgb(15, 13, 9)';
  ctx.fillRect(0, 0, W, H);

  // Track polar touches
  let touchesSouthPole = false;
  let touchesNorthPole = false;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    for (const pt of ring) {
      if (pt[1] <= -85) touchesSouthPole = true;
      if (pt[1] >= 85) touchesNorthPole = true;
    }
  }

  // Helper: split ring at antimeridian and draw each sub-path
  const drawRingSplit = (ring, fillStyle, strokeStyle, lineWidth) => {
    const subPaths = [];
    let current = [];
    let prevLon = null;
    for (let i = 0; i < ring.length; i++) {
      const lon = ring[i][0];
      const lat = ring[i][1];
      if (prevLon !== null && Math.abs(lon - prevLon) > 180) {
        if (current.length > 1) subPaths.push(current);
        current = [];
      }
      current.push([lon, lat]);
      prevLon = lon;
    }
    if (current.length > 1) subPaths.push(current);
    for (const sub of subPaths) {
      ctx.beginPath();
      for (let i = 0; i < sub.length; i++) {
        const x = (sub[i][0] + 180) / 360 * W;
        const y = (90 - sub[i][1]) / 180 * H;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      if (fillStyle) { ctx.fillStyle = fillStyle; ctx.fill(); }
      if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth || 1;
        ctx.stroke();
      }
    }
  };

  // 1) Fill all land with amber base
  const LAND_BASE = 'rgb(245, 168, 50)';
  for (const ring of rings) {
    if (ring.length < 3) continue;
    drawRingSplit(ring, LAND_BASE, null, 0);
  }

  // 2) Polar caps as solid amber first (covers Antarctica fan)
  const polarCapPx = Math.floor(H * 0.05);
  if (touchesSouthPole) {
    ctx.fillStyle = LAND_BASE;
    ctx.fillRect(0, H - polarCapPx, W, polarCapPx);
  }
  if (touchesNorthPole) {
    ctx.fillStyle = LAND_BASE;
    ctx.fillRect(0, 0, W, polarCapPx);
  }

  // 3) Biome shading — FBM noise modulates land brightness ±25
  // Then polar ice tint over high latitudes. Done in one pixel pass.
  const img = ctx.getImageData(0, 0, W, H);
  const data = img.data;
  const STEP = 1;
  for (let y = 0; y < H; y += STEP) {
    for (let x = 0; x < W; x += STEP) {
      const i = (y * W + x) * 4;
      const r = data[i];

      // Skip ocean
      if (r < 100) continue;

      // Biome noise on land
      const n = _fbm(x / 60, y / 60);  // FBM 0..1
      const tint = (n - 0.5) * 50;     // -25..+25
      let nr = data[i]   + tint;
      let ng = data[i+1] + tint * 0.7;
      let nb = data[i+2] + tint * 0.4;

      // Polar ice tint — cooler/paler color near poles. Smooth blend
      // from lat ±60° to ±85° (then solid ice in the polar cap rect).
      const lat = 90 - (y / H) * 180;
      const absLat = Math.abs(lat);
      if (absLat > 60) {
        const t = Math.min(1, (absLat - 60) / 25);  // 0 at 60°, 1 at 85°
        // Pale frost color: rgb(220, 200, 170)
        nr = nr * (1 - t) + 220 * t;
        ng = ng * (1 - t) + 200 * t;
        nb = nb * (1 - t) + 170 * t;
      }

      data[i]   = Math.max(0, Math.min(255, nr));
      data[i+1] = Math.max(0, Math.min(255, ng));
      data[i+2] = Math.max(0, Math.min(255, nb));
    }
  }
  ctx.putImageData(img, 0, 0);

  // 4) Coastline ink — dark amber stroke along every coast.
  for (const ring of rings) {
    if (ring.length < 3) continue;
    drawRingSplit(ring, null, 'rgb(80, 40, 8)', 1.5);
  }

  // 5) City lights — bright amber pinpoints scattered on land.
  // Sample by reading land pixels and dropping points.
  const cityImg = ctx.getImageData(0, 0, W, H);
  const cityData = cityImg.data;
  ctx.fillStyle = 'rgb(255, 240, 180)';
  // Use seeded PRNG for stable lights across reloads
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const NUM_LIGHTS = 1500;
  for (let i = 0; i < NUM_LIGHTS; i++) {
    const x = Math.floor(rand() * W);
    const y = Math.floor(rand() * H);
    const idx = (y * W + x) * 4;
    const r = cityData[idx];
    const g = cityData[idx + 1];
    // Skip ocean (dark r) AND polar ice (high r AND high b — frost is bluish-pale)
    if (r > 130 && g > 80 && cityData[idx + 2] < 130) {
      const size = rand() < 0.85 ? 1 : 2;
      ctx.fillRect(x, y, size, size);
    }
  }

  return c;
}
