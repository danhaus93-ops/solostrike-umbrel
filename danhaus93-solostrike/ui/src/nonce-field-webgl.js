// True WebGL nonce field renderer.
//
// Used by both Hunt mode (NonceField in-card) and BFM celebration. The
// renderer owns a WebGL canvas and draws everything via shaders. Mode is
// set at construction:
//
//   createNonceFieldWebGL(canvas, { mode: 'hunt' })  ← in-card Particle Stream
//   createNonceFieldWebGL(canvas, { mode: 'bfm' })   ← full-screen Convergence Storm
//
// API (matches lightning-webgl.js for consistency):
//
//   step(dt, hashTHS, opts)          — render one frame
//     - hunt: hashTHS = current hashrate in TH/s
//             opts = { enabled }
//     - bfm:  hashTHS ignored
//             opts = { bfmTime: 0..5.5 } seconds since BFM started
//   triggerStrike(opts)              — block-found event (hunt mode only)
//   resize()                         — re-measure canvas
//   destroy()                        — free GL resources
//   failed                           — true if init failed (caller falls back)
//
// ─── Hunt mode: PARTICLE STREAM ──────────────────────────────────────────
// 12 horizontal lanes of analytic point particles flowing L→R. Density
// scales with hashrate. Block-found triggers an 8-direction golden burst.
//
// ─── BFM mode: CONVERGENCE STORM ─────────────────────────────────────────
// 5-phase choreographed sequence (5.5s total):
//   0.0–0.5s : Storm — chaotic flying particles
//   0.5–1.5s : Convergence — spiral inward with ease-out cubic
//   1.5–2.5s : Formation — gold ring + bloom rays appear
//   2.5–4.0s : Hold — pulsing glow (₿ glyph drawn by 2D overlay)
//   4.0–5.5s : Outburst — radial shockwave + screen flash + fade
//
// Both modes share a single full-screen quad and identical resize logic.

const VS_QUAD = `
attribute vec2 a;
varying vec2 uv;
void main() {
  uv = a * 0.5 + 0.5;
  gl_Position = vec4(a, 0.0, 1.0);
}
`;

// ─── Hunt mode: Beveled Blocks (rev61) ───────────────────────────────────
//
// 2D grid of beveled rounded blocks in Bitcoin orange. Active cells pulse
// at frequencies seeded by their grid ID; pulse threshold scales with hash-
// rate so higher hashrate = more cells lit at once. Block-found events
// show as a radial wave that lights the whole grid briefly.
//
// Replaced the rev55-rev60 Particle Stream shader (the "tron-grid" lanes
// look) per user pick after evaluating 4 block-style variants. Beveled is
// the most tactile / "this is mining" reading.
const FS_STREAM = `
precision highp float;
varying vec2 uv;
uniform float uT;
uniform float uHashTHS;
uniform vec3 uBtcBg;
uniform vec3 uBtcDim;
uniform vec3 uBtcMid;
uniform vec3 uBtcDark;
uniform vec3 uBtcLight;
uniform float uStrike;
uniform float uStrikeGold;
uniform float uEnabled;
uniform vec2  uRes;
uniform vec2  uGrid;        // (cols, rows)
uniform float uBright;      // 0..1
uniform float uShowScan;    // 0 or 1
uniform float uShowVig;     // 0 or 1

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float cellAct(vec2 cId, float t, float hr) {
  float seed = hash(cId);
  float freq = 0.4 + hr * 0.03 + seed * 1.5;
  float pulse = sin(t * freq + seed * 6.28) * 0.5 + 0.5;
  float thresh = clamp(0.55 - hr * 0.004, 0.15, 0.75);
  return smoothstep(thresh, thresh + 0.08, pulse);
}

void main() {
  // v1.11.47: theme-driven palette (was hardcoded Bitcoin #FB940D).
  vec3 BTC_BG    = uBtcBg;
  vec3 BTC_DIM   = uBtcDim;
  vec3 BTC_MID   = uBtcMid;
  vec3 BTC_DARK  = uBtcDark;
  vec3 BTC_LIGHT = uBtcLight;

  vec2 p = uv;
  vec2 cId = floor(p * uGrid);
  vec2 cuv = fract(p * uGrid);
  float a = cellAct(cId, uT, uHashTHS) * uEnabled;

  // Block-found wave: forward strike pulses the whole grid radially
  if (uStrike > 0.01) {
    float sR = (1.0 - uStrike) * 1.4;
    float sD = distance(p, vec2(0.5));
    float wave = exp(-pow((sD - sR) * 8.0, 2.0));
    a = max(a, wave * uStrike * mix(1.0, 1.4, uStrikeGold));
  }

  // Scan sweep highlight
  if (uShowScan > 0.5) {
    float sx = mod(uT * 0.3, 1.0);
    a = max(a, exp(-pow((p.x - sx) * 15.0, 2.0)) * 0.3 * uEnabled);
  }

  // Block bounds with gap
  vec2 d = abs(cuv - 0.5);
  float gap = 0.08;
  float dInside = max(d.x, d.y);
  float inBlock = step(dInside, 0.5 - gap);

  // Bevel: top-left bright, bottom-right dark
  vec2 bevD = (cuv - 0.5);
  float bevel = (bevD.x + bevD.y) * 4.0;

  // Base fill: dim block + active mix
  vec3 col = BTC_BG;
  vec3 fillBase = mix(BTC_DIM * 0.4, BTC_MID * uBright, a);
  vec3 fillBeveled = fillBase;
  fillBeveled += BTC_LIGHT * (1.0 - smoothstep(-1.0, 0.5, bevel)) * 0.18 * (a * 0.6 + 0.4);
  fillBeveled -= BTC_DARK  * smoothstep(0.5, 1.0, bevel) * 0.4 * (a * 0.6 + 0.4);
  col = mix(col, fillBeveled, inBlock);

  // Inner edge highlight on top + left
  if (cuv.x < 0.06 + gap || cuv.y < 0.06 + gap) {
    col += BTC_LIGHT * inBlock * (a * 0.6 + 0.3) * 0.25;
  }

  // Gold strike overlay (extra warmth on block-found events)
  if (uStrike > 0.01 && uStrikeGold > 0.5) {
    col += vec3(0.5, 0.40, 0.15) * uStrike * uStrike * 0.20;
  }

  if (uShowVig > 0.5) col *= 1.0 - smoothstep(0.6, 1.05, length(p - 0.5) * 1.4) * 0.7;

  // v1.8.5-rev70e: alpha=inBlock so block pixels are opaque and gap pixels
  // are transparent (card shows through gaps in the nonce field).
  gl_FragColor = vec4(col, inBlock);
}
`;

// ─── BFM mode: Convergence Storm ──────────────────────────────────────────
const FS_CONVERGENCE = `
precision highp float;
varying vec2 uv;
uniform float uT;
uniform vec2 uRes;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
vec2 hash22(vec2 p) {
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)),
                         dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

void main() {
  vec2 p = uv;
  vec2 c = vec2(0.5, 0.5);
  vec2 ap = (p - c) * vec2(uRes.x / uRes.y, 1.0);
  vec3 col = vec3(0.005, 0.008, 0.014);

  float pStorm = smoothstep(0.0, 0.5, uT) * (1.0 - smoothstep(0.5, 1.5, uT));
  float pHold  = smoothstep(1.5, 2.5, uT) * (1.0 - smoothstep(4.0, 5.0, uT));
  float pBurst = smoothstep(4.0, 4.3, uT) * (1.0 - smoothstep(4.5, 5.5, uT));
  float pFade  = 1.0 - smoothstep(5.0, 5.5, uT);

  const int N = 120;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    vec2 rnd = hash22(vec2(fi, 1.7));
    vec2 origin = (rnd - 0.5) * 2.0;
    float stormR = mix(0.5, 1.0, hash(vec2(fi, 3.0)));
    float stormA = uT * (2.0 + rnd.x * 4.0) + fi * 0.7;
    vec2 stormPos = origin + vec2(cos(stormA), sin(stormA)) * stormR * pStorm * 0.4;
    float convT = clamp((uT - 0.5) / 1.5, 0.0, 1.0);
    convT = 1.0 - pow(1.0 - convT, 3.0);
    vec2 pos;
    if (uT < 0.5) {
      pos = c + stormPos;
    } else if (uT < 2.5) {
      pos = mix(c + stormPos, c, convT);
    } else if (uT < 4.0) {
      pos = c + (rnd - 0.5) * 0.04;
    } else {
      float bT = clamp((uT - 4.0) / 1.5, 0.0, 1.0);
      bT = 1.0 - pow(1.0 - bT, 2.0);
      vec2 dir = normalize(rnd - 0.5 + vec2(0.0001));
      pos = c + dir * bT * 1.4;
    }
    float dist = length(p - pos);
    float intensity = exp(-dist * dist * 1500.0);
    vec3 hue = mix(vec3(0.96, 0.65, 0.18), vec3(1.0, 0.90, 0.55), pHold + pBurst);
    col += hue * intensity * 1.3;
  }

  if (pHold > 0.01) {
    float ringD = length(ap);
    float ring = smoothstep(0.18, 0.13, ringD) * (1.0 - smoothstep(0.10, 0.08, ringD));
    col += vec3(1.0, 0.85, 0.45) * ring * pHold * 1.5;
    float ang = atan(ap.y, ap.x);
    float rays = pow(0.5 + 0.5 * cos(ang * 8.0), 12.0) * smoothstep(0.4, 0.0, ringD);
    col += vec3(1.0, 0.80, 0.30) * rays * pHold * 0.5;
    float breathe = 0.85 + 0.15 * sin(uT * 4.0);
    float bloom = exp(-ringD * ringD * 8.0) * pHold * breathe * 0.35;
    col += vec3(1.0, 0.85, 0.45) * bloom;
  }

  col += vec3(1.0, 0.85, 0.50) * pBurst * 0.4;
  if (pBurst > 0.01) {
    float bR = pBurst * 0.8;
    float ringD = length(ap);
    col += vec3(1.0, 0.95, 0.7) * smoothstep(0.04, 0.0, abs(ringD - bR)) * 1.8;
  }

  col *= pFade;
  float vig = 1.0 - smoothstep(0.6, 1.0, length(p - 0.5) * 1.4) * 0.5;
  col *= vig;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createNonceFieldWebGL(canvas, options) {
  // v1.11.47: theme palette state. Defaults reproduce deployed Classic.
  let currentNonce = (options && options.theme && options.theme.nonce) || {
    bg:    [0.022, 0.018, 0.012],
    dim:   [0.140, 0.085, 0.022],
    mid:   [0.984, 0.580, 0.051],
    dark:  [0.480, 0.260, 0.030],
    light: [1.000, 0.820, 0.420],
  };

  const opts = options || {};
  const mode = opts.mode === 'bfm' ? 'bfm' : 'hunt';

  const gl = canvas.getContext('webgl', {
    antialias: false,
    // v1.8.5-rev70e: alpha:true so card shows through gap pixels in
    // hunt mode (fragment shader outputs alpha=inBlock; gaps = 0).
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    // BFM is short and visual-quality matters; hunt runs continuously so
    // power efficiency wins.
    powerPreference: mode === 'bfm' ? 'high-performance' : 'low-power',
  });

  // v1.11.31: surface WebGL context loss. iOS Safari (and some Android
  // Chrome) reclaim GPU memory under pressure — without listeners the
  // canvas silently goes black. For now we warn so users can reload.
  // Full re-init handler is future work.
  try {
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      console.warn("[WebGL] context lost — reload page to recover");
    }, false);
    canvas.addEventListener("webglcontextrestored", () => {
      console.warn("[WebGL] context restored — reload recommended");
    }, false);
  } catch (_) { /* listener support absent */ }

  if (!gl) return { failed: true };

  function compile(src, type) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      // eslint-disable-next-line no-console
      console.warn('[nonce-field-webgl] shader compile failed:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  const vs = compile(VS_QUAD, gl.VERTEX_SHADER);
  const fsSrc = mode === 'bfm' ? FS_CONVERGENCE : FS_STREAM;
  const fs = compile(fsSrc, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return { failed: true };

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    // eslint-disable-next-line no-console
    console.warn('[nonce-field-webgl] program link failed:', gl.getProgramInfoLog(prog));
    return { failed: true };
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  // Cache uniform locations (hunt has more uniforms than bfm)
  const uT = gl.getUniformLocation(prog, 'uT');
  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uHashTHS = mode === 'hunt' ? gl.getUniformLocation(prog, 'uHashTHS') : null;
  const uStrike = mode === 'hunt' ? gl.getUniformLocation(prog, 'uStrike') : null;
  const uStrikeGold = mode === 'hunt' ? gl.getUniformLocation(prog, 'uStrikeGold') : null;
  const uEnabled = mode === 'hunt' ? gl.getUniformLocation(prog, 'uEnabled') : null;
  // rev61: Beveled Blocks shader uniforms
  const uGrid = mode === 'hunt' ? gl.getUniformLocation(prog, 'uGrid') : null;
  const uBright = mode === 'hunt' ? gl.getUniformLocation(prog, 'uBright') : null;
  const uShowScan = mode === 'hunt' ? gl.getUniformLocation(prog, 'uShowScan') : null;
  const uShowVig = mode === 'hunt' ? gl.getUniformLocation(prog, 'uShowVig') : null;
  // v1.11.47: theme palette uniform locations
  const uBtcBg    = mode === 'hunt' ? gl.getUniformLocation(prog, 'uBtcBg')    : null;
  const uBtcDim   = mode === 'hunt' ? gl.getUniformLocation(prog, 'uBtcDim')   : null;
  const uBtcMid   = mode === 'hunt' ? gl.getUniformLocation(prog, 'uBtcMid')   : null;
  const uBtcDark  = mode === 'hunt' ? gl.getUniformLocation(prog, 'uBtcDark')  : null;
  const uBtcLight = mode === 'hunt' ? gl.getUniformLocation(prog, 'uBtcLight') : null;
  const aLoc = gl.getAttribLocation(prog, 'a');

  // Internal state (hunt mode)
  let timeAccum = 0;
  let strike = 0;
  let strikeGold = 0;
  let enabled = 1;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.floor(r.width * dpr));
    const H = Math.max(1, Math.floor(r.height * dpr));
    if (canvas.width !== W) canvas.width = W;
    if (canvas.height !== H) canvas.height = H;
  }
  resize();

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(resize);
    ro.observe(canvas);
  }

  function step(dt, hashTHS, stepOpts) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

    if (mode === 'bfm') {
      // Caller passes wall-clock t directly via opts.bfmTime.
      // Phase boundaries must be precise so we don't accumulate dt internally.
      const t = (stepOpts && typeof stepOpts.bfmTime === 'number')
        ? stepOpts.bfmTime
        : (timeAccum += dt, timeAccum);
      gl.uniform1f(uT, Math.max(0, t));
      gl.uniform2f(uRes, canvas.width, canvas.height);
    } else {
      timeAccum += dt;
      const targetEnabled = (stepOpts && stepOpts.enabled === false) ? 0 : 1;
      const lerpRate = Math.min(1, dt * 4);
      enabled += (targetEnabled - enabled) * lerpRate;
      const decayRate = strikeGold > 0.5 ? (1 / 1.5) : (1 / 0.7);
      strike = Math.max(0, strike - dt * decayRate);
      if (strike <= 0) strikeGold = 0;

      gl.uniform1f(uT, timeAccum);
      gl.uniform1f(uHashTHS, Math.max(0, hashTHS || 0));
      gl.uniform1f(uStrike, strike);
      gl.uniform1f(uStrikeGold, strikeGold);
      gl.uniform1f(uEnabled, enabled);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      // rev61: Beveled Blocks grid + post-processing uniforms.
      // Block size 72 → 72 cols. Rows derived from aspect so cells stay
      // roughly square-ish (the user picked 72/100%/scan+vig in preview).
      const aspect = canvas.width / Math.max(1, canvas.height);
      const cols = 72;
      const rows = Math.max(3, Math.round(cols / aspect / 2.5));
      gl.uniform2f(uGrid, cols, rows);
      gl.uniform1f(uBright, 1.0);
      gl.uniform1f(uShowScan, 1.0);
      gl.uniform1f(uShowVig, 1.0);
      // v1.11.47: theme palette per-frame
      gl.uniform3fv(uBtcBg,    currentNonce.bg);
      gl.uniform3fv(uBtcDim,   currentNonce.dim);
      gl.uniform3fv(uBtcMid,   currentNonce.mid);
      gl.uniform3fv(uBtcDark,  currentNonce.dark);
      gl.uniform3fv(uBtcLight, currentNonce.light);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function triggerStrike(strikeOpts) {
    if (mode !== 'hunt') return;
    strike = 1;
    strikeGold = (strikeOpts && (strikeOpts.gold || strikeOpts.isBlock)) ? 1 : 0;
  }

  function destroy() {
    if (ro) { try { ro.disconnect(); } catch (_) {} ro = null; }
    try {
      gl.deleteBuffer(quad);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    } catch (_) {}
    const lc = gl.getExtension('WEBGL_lose_context');
    if (lc) { try { lc.loseContext(); } catch (_) {} }
  }

  // v1.11.47: live theme palette update
  function setTheme(newTheme) {
    if (newTheme && newTheme.nonce) {
      currentNonce = { ...currentNonce, ...newTheme.nonce };
    }
  }

  return { failed: false, step, triggerStrike, resize, destroy, setTheme };
}
