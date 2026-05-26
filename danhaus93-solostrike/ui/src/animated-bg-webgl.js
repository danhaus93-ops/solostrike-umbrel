// rev63 premium pass — animated WebGL background.
// v1.11.47: theme support added — shader color triplets become uniforms.
// Structure (grid scan, pulse, bevel, vignette, top radial) unchanged.
// Paper Light: special-cased — uses 2D canvas blueprint renderer instead.
//
// "Drift Blocks" — faint pulsing beveled blocks slowly scrolling, hints
// at "calculation happening underneath" without competing with foreground
// cards.

export function createAnimatedBackground(canvas, options = {}) {
  if (!canvas) return null;
  const theme = options.theme || null;

  // ── Paper Light branch: 2D blueprint renderer ─────────────────────────────
  // Light mode requires a fundamentally different background structure —
  // the dark-mode additive grid doesn't translate. We render a static
  // blueprint grid (minor + major lines) with a very slow horizontal drift
  // matching the deployed shader's 0.012 units/sec scroll.
  if (theme && theme.special === 'lightMode') {
    return createBlueprintBackground(canvas, theme);
  }

  // ── Default WebGL path (themed via uniforms) ──────────────────────────────
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });

  try {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[WebGL] context lost — reload page to recover');
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[WebGL] context restored — reload recommended');
    }, false);
  } catch (_) {}
  if (!gl) {
    console.warn('Animated bg: WebGL unavailable, fallback to static body bg');
    return null;
  }

  const VS = `attribute vec2 a; varying vec2 uv;
    void main() { uv = a*0.5+0.5; gl_Position = vec4(a, 0., 1.); }`;

  // v1.11.47: color triplets are now uniforms. Default values match the
  // deployed Classic theme exactly so behavior is preserved when no
  // theme is set.
  const FS = `precision highp float;
    varying vec2 uv;
    uniform float uT;
    uniform vec2 uRes;
    uniform vec3 uBgBase;       // base canvas color
    uniform vec3 uBlockBase;    // dark amber base (was vec3(0.06,0.04,0.02))
    uniform vec3 uBlockPulse;   // pulse heat add (was vec3(0.30,0.18,0.04))
    uniform vec3 uBlockBevel;   // bevel highlight (was vec3(0.08,0.05,0.02))
    uniform vec3 uTopRadial;    // top-edge radial (was vec3(0.05,0.03,0.01))
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec3 col = uBgBase;

      vec2 grid = vec2(20.0, 12.0);
      vec2 cuv = vec2(uv.x + uT * 0.012, uv.y);
      vec2 cId = floor(cuv * grid);
      vec2 fr  = fract(cuv * grid);

      vec2 d = abs(fr - 0.5);
      float dInside = max(d.x, d.y);
      float inBlock = smoothstep(0.5, 0.45, dInside);

      float seed = hash(cId);
      float pulse = sin(uT * 0.4 + seed * 6.28) * 0.5 + 0.5;
      pulse = smoothstep(0.6, 0.95, pulse);

      vec2 bevD = (fr - 0.5);
      float bevel = (bevD.x + bevD.y) * 4.0;

      vec3 blockBase = uBlockBase;
      blockBase += uBlockPulse * pulse;
      blockBase += uBlockBevel * (1.0 - smoothstep(-1.0, 0.5, bevel)) * pulse;

      col += blockBase * inBlock * 0.35;

      vec2 vp = uv - 0.5;
      vp.x *= uRes.x / uRes.y;
      col *= 1.0 - smoothstep(0.3, 0.85, length(vp)) * 0.5;

      col += uTopRadial * exp(-pow((1.0 - uv.y) * 1.5, 2.0));

      gl_FragColor = vec4(col, 1.0);
    }`;

  function compile(src, type) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('Animated bg shader compile error:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  const vs = compile(VS, gl.VERTEX_SHADER);
  const fs = compile(FS, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Animated bg program link error:', gl.getProgramInfoLog(prog));
    return null;
  }

  const aLoc = gl.getAttribLocation(prog, 'a');
  const uT = gl.getUniformLocation(prog, 'uT');
  const uRes = gl.getUniformLocation(prog, 'uRes');
  const uBgBase     = gl.getUniformLocation(prog, 'uBgBase');
  const uBlockBase  = gl.getUniformLocation(prog, 'uBlockBase');
  const uBlockPulse = gl.getUniformLocation(prog, 'uBlockPulse');
  const uBlockBevel = gl.getUniformLocation(prog, 'uBlockBevel');
  const uTopRadial  = gl.getUniformLocation(prog, 'uTopRadial');

  // Default to Classic theme (deployed hardcoded values)
  let currentColors = {
    bgBase:     [0.024, 0.027, 0.031],
    blockBase:  [0.06, 0.04, 0.02],
    blockPulse: [0.30, 0.18, 0.04],
    blockBevel: [0.08, 0.05, 0.02],
    topRadial:  [0.05, 0.03, 0.01],
  };
  if (theme && theme.bg) {
    currentColors = { ...currentColors, ...theme.bg };
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER,
    new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]),
    gl.STATIC_DRAW);

  const startT = performance.now();
  let rafId = null;
  let lastWidth = 0, lastHeight = 0;
  let paused = false;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (w !== lastWidth || h !== lastHeight) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
      lastWidth = w;
      lastHeight = h;
    }
  }
  resize();

  function draw() {
    if (paused) return;
    resize();
    const t = (performance.now() - startT) / 1000;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(uT, t);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform3fv(uBgBase,     currentColors.bgBase);
    gl.uniform3fv(uBlockBase,  currentColors.blockBase);
    gl.uniform3fv(uBlockPulse, currentColors.blockPulse);
    gl.uniform3fv(uBlockBevel, currentColors.blockBevel);
    gl.uniform3fv(uTopRadial,  currentColors.topRadial);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    rafId = requestAnimationFrame(draw);
  }

  function start() { if (!paused && rafId == null) rafId = requestAnimationFrame(draw); }
  function pause() { paused = true; if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }
  function resume() { paused = false; start(); }

  function visHandler() { if (document.hidden) pause(); else resume(); }
  document.addEventListener('visibilitychange', visHandler);
  window.addEventListener('resize', resize);

  start();

  return {
    destroy() {
      pause();
      document.removeEventListener('visibilitychange', visHandler);
      window.removeEventListener('resize', resize);
      gl.deleteProgram(prog);
      gl.deleteBuffer(quad);
    },
    pause, resume,
    // v1.11.47: live theme update without rebuilding the WebGL context
    setTheme(newTheme) {
      if (newTheme && newTheme.bg) {
        currentColors = {
          bgBase:     [0.024, 0.027, 0.031],
          blockBase:  [0.06, 0.04, 0.02],
          blockPulse: [0.30, 0.18, 0.04],
          blockBevel: [0.08, 0.05, 0.02],
          topRadial:  [0.05, 0.03, 0.01],
          ...newTheme.bg,
        };
      }
    },
  };
}

// ── 2D blueprint renderer for Paper Light theme ─────────────────────────────
// V3 Blueprint pattern: pale blue-grey base + minor 15px grid + major 60px
// grid + slow horizontal drift matching the deployed shader's 0.012 units/sec.
// Returns the same interface as the WebGL path (destroy/pause/resume/setTheme).
function createBlueprintBackground(canvas, theme) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let rafId = null;
  let paused = false;
  let lastWidth = 0, lastHeight = 0;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.floor(window.innerWidth * dpr);
    const h = Math.floor(window.innerHeight * dpr);
    if (w !== lastWidth || h !== lastHeight) {
      canvas.width = w;
      canvas.height = h;
      lastWidth = w;
      lastHeight = h;
    }
  }
  resize();

  const startT = performance.now();
  function draw() {
    if (paused) return;
    resize();
    const W = canvas.width, H = canvas.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const t = (performance.now() - startT) / 1000;

    // Drift: 0.012 units/sec × viewport-scaled
    const offsetX = (t * 0.012 * W * 4) % (60 * dpr);

    // Base blueprint pale blue
    ctx.fillStyle = '#E8EFF5';
    ctx.fillRect(0, 0, W, H);

    // Minor grid (every 15px)
    ctx.strokeStyle = 'rgba(50,100,160,0.10)';
    ctx.lineWidth = 0.5 * dpr;
    ctx.beginPath();
    const minorStep = 15 * dpr;
    for (let x = -offsetX; x < W; x += minorStep) {
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    for (let y = 0; y < H; y += minorStep) {
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();

    // Major grid (every 60px)
    ctx.strokeStyle = 'rgba(50,100,160,0.22)';
    ctx.lineWidth = 0.8 * dpr;
    ctx.beginPath();
    const majorStep = 60 * dpr;
    for (let x = -offsetX; x < W; x += majorStep) {
      ctx.moveTo(x, 0); ctx.lineTo(x, H);
    }
    for (let y = 0; y < H; y += majorStep) {
      ctx.moveTo(0, y); ctx.lineTo(W, y);
    }
    ctx.stroke();

    // Vignette
    const vg = ctx.createRadialGradient(W/2, H/2, W*0.3, W/2, H/2, W*0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(30,80,140,0.15)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    rafId = requestAnimationFrame(draw);
  }

  function start() { if (!paused && rafId == null) rafId = requestAnimationFrame(draw); }
  function pause() { paused = true; if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }
  function resume() { paused = false; start(); }

  function visHandler() { if (document.hidden) pause(); else resume(); }
  document.addEventListener('visibilitychange', visHandler);
  window.addEventListener('resize', resize);

  start();

  return {
    destroy() {
      pause();
      document.removeEventListener('visibilitychange', visHandler);
      window.removeEventListener('resize', resize);
    },
    pause, resume,
    setTheme(newTheme) { /* blueprint colors are fixed for paper light */ },
  };
}
