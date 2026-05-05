// True WebGL BFM (Block Found Moment) Nonce celebration renderer.
//
// Convergence Storm: a 5-phase choreographed sequence triggered when the
// user actually finds a block while their Hunt animation is set to
// 'noncefield'. Replaces the flat 32×6 grid in the legacy drawBFMNonce()
// function. Designed to thematically pair with the new in-card Particle
// Stream — the in-card flow escalates into a screen-wide gravitational
// event that converges into the ₿ glyph, holds, then explodes outward.
//
// API matches lightning-webgl.js for consistency:
//
//   step(dt, t)           — render one frame at BFM-time t (seconds, 0..5.5)
//   resize()              — re-measure canvas
//   destroy()             — free GL resources
//   failed                — true if init failed (caller falls back to 2D)
//
// Caller pattern (mirrors lightning BFM in BlockFoundModal):
//
//   const r = createBFMNonceWebGL(canvas);
//   if (r.failed) { /* fall back to drawBFMNonce 2D path */ }
//   else { r.step(dt, t); /* then 2D overlay draws ₿ glyph + text */ }
//
// Phase structure (matches preview-bfm-nonce.html iteration 1):
//   0.0–0.5s : Particle storm (chaotic flying particles)
//   0.5–1.5s : Convergence (spiral inward with ease-out cubic)
//   1.5–2.5s : ₿ formation (gold ring + bloom rays)
//   2.5–4.0s : Hold (continuous pulse, particles settle near center)
//   4.0–5.5s : Outburst (radial shockwave + screen flash + fade)
//
// The 2D overlay canvas (rendered on top by the caller) is responsible for:
//   - ₿ glyph (drawBtcCelebrate, faded in 1.5–4.5s)
//   - "NONCE FOUND" text (drawBFMText, 3.0–5.5s)

const VS_QUAD = `
attribute vec2 a;
varying vec2 uv;
void main() {
  uv = a * 0.5 + 0.5;
  gl_Position = vec4(a, 0.0, 1.0);
}
`;

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
  // Aspect-corrected position around center (square-ish on iPhone portrait)
  vec2 ap = (p - c) * vec2(uRes.x / uRes.y, 1.0);

  vec3 col = vec3(0.005, 0.008, 0.014);

  // Phase weights (cross-faded so transitions are smooth)
  float pStorm    = smoothstep(0.0, 0.5, uT) * (1.0 - smoothstep(0.5, 1.5, uT));
  float pHold     = smoothstep(1.5, 2.5, uT) * (1.0 - smoothstep(4.0, 5.0, uT));
  float pBurst    = smoothstep(4.0, 4.3, uT) * (1.0 - smoothstep(4.5, 5.5, uT));
  float pFade     = 1.0 - smoothstep(5.0, 5.5, uT);

  // ── 120 particles, all simulated in the shader ────────────────────────
  // Each has a stable random origin + spirals in to center over 0.5–2.5s
  // Then settles, then bursts outward 4.0–5.5s.
  const int N = 120;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    vec2 rnd = hash22(vec2(fi, 1.7));
    vec2 origin = (rnd - 0.5) * 2.0;
    // Storm phase: chaotic radial drift
    float stormR = mix(0.5, 1.0, hash(vec2(fi, 3.0)));
    float stormA = uT * (2.0 + rnd.x * 4.0) + fi * 0.7;
    vec2 stormPos = origin + vec2(cos(stormA), sin(stormA)) * stormR * pStorm * 0.4;
    // Convergence: ease-out cubic spiral toward center
    float convT = clamp((uT - 0.5) / 1.5, 0.0, 1.0);
    convT = 1.0 - pow(1.0 - convT, 3.0);
    float spiralA = stormA + convT * 6.0;
    float spiralR = mix(stormR, 0.05, convT);
    vec2 convPos = c + vec2(cos(spiralA), sin(spiralA)) * spiralR * (1.0 - convT * 0.95);
    // Phase-specific position
    vec2 pos;
    if (uT < 0.5) {
      pos = c + stormPos;
    } else if (uT < 2.5) {
      pos = mix(c + stormPos, c, convT);
    } else if (uT < 4.0) {
      // Settle: gently jitter near center
      pos = c + (rnd - 0.5) * 0.04;
    } else {
      // Outburst: explode along origin direction
      float bT = clamp((uT - 4.0) / 1.5, 0.0, 1.0);
      bT = 1.0 - pow(1.0 - bT, 2.0);   // ease-out quadratic
      vec2 dir = normalize(rnd - 0.5 + vec2(0.0001));
      pos = c + dir * bT * 1.4;
    }
    float dist = length(p - pos);
    float intensity = exp(-dist * dist * 1500.0);
    // Color: amber default, gold-shifted during hold + burst
    vec3 hue = mix(vec3(0.96, 0.65, 0.18), vec3(1.0, 0.90, 0.55), pHold + pBurst);
    col += hue * intensity * 1.3;
  }

  // ── Gold ring + bloom rays during hold (1.5–4.0s) ─────────────────────
  if (pHold > 0.01) {
    float ringD = length(ap);
    // Outer glow ring
    float ring = smoothstep(0.18, 0.13, ringD) * (1.0 - smoothstep(0.10, 0.08, ringD));
    col += vec3(1.0, 0.85, 0.45) * ring * pHold * 1.5;
    // Bloom rays (8 spokes)
    float ang = atan(ap.y, ap.x);
    float rays = pow(0.5 + 0.5 * cos(ang * 8.0), 12.0) * smoothstep(0.4, 0.0, ringD);
    col += vec3(1.0, 0.80, 0.30) * rays * pHold * 0.5;
    // Subtle pulse — breathing bloom around glyph position
    float breathe = 0.85 + 0.15 * sin(uT * 4.0);
    float bloom = exp(-ringD * ringD * 8.0) * pHold * breathe * 0.35;
    col += vec3(1.0, 0.85, 0.45) * bloom;
  }

  // ── Outburst (4.0–5.5s) ────────────────────────────────────────────────
  // Screen-wide gold flash
  col += vec3(1.0, 0.85, 0.50) * pBurst * 0.4;
  // Expanding shockwave ring
  if (pBurst > 0.01) {
    float bR = pBurst * 0.8;
    float ringD = length(ap);
    col += vec3(1.0, 0.95, 0.7) * smoothstep(0.04, 0.0, abs(ringD - bR)) * 1.8;
  }

  // ── Final fade-out (5.0–5.5s) ─────────────────────────────────────────
  col *= pFade;

  // ── Vignette (constant, frames the action) ────────────────────────────
  float vig = 1.0 - smoothstep(0.6, 1.0, length(p - 0.5) * 1.4) * 0.5;
  col *= vig;

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createBFMNonceWebGL(canvas) {
  const gl = canvas.getContext('webgl', {
    antialias: false,
    alpha: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',  // BFM is short, prefer quality
  });
  if (!gl) return { failed: true };

  // ── Compile shaders ─────────────────────────────────────────────────────
  function compile(src, type) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      // eslint-disable-next-line no-console
      console.warn('[bfm-nonce-webgl] shader compile failed:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  const vs = compile(VS_QUAD, gl.VERTEX_SHADER);
  const fs = compile(FS_CONVERGENCE, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return { failed: true };

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    // eslint-disable-next-line no-console
    console.warn('[bfm-nonce-webgl] program link failed:', gl.getProgramInfoLog(prog));
    return { failed: true };
  }

  // Full-screen quad
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW
  );

  // Cache uniform locations
  const uT = gl.getUniformLocation(prog, 'uT');
  const uRes = gl.getUniformLocation(prog, 'uRes');
  const aLoc = gl.getAttribLocation(prog, 'a');

  // ── Resize handling ─────────────────────────────────────────────────────
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

  // ── Per-frame step ──────────────────────────────────────────────────────
  function step(dt, t) {
    // dt is unused (time is fully driven by t — caller knows BFM start time)
    // but kept for API parity with lightning-webgl.js step(dt, ...)
    void dt;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(uT, Math.max(0, t || 0));
    gl.uniform2f(uRes, canvas.width, canvas.height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────
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

  return { failed: false, step, resize, destroy };
}
