// rev63 premium pass — animated WebGL background.
//
// "Drift Blocks" — faint pulsing beveled blocks slowly scrolling, hints
// at "calculation happening underneath" without competing with foreground
// cards. Theme-coherent with the existing nonce-field aesthetic but at
// very low opacity (~30% effective brightness vs the actual nonce field).
//
// Lifecycle: a single instance is mounted once at App startup as a fixed
// full-viewport canvas at z-index:-1 (behind every UI element). It runs
// continuously via requestAnimationFrame at native refresh; cost is
// negligible (one full-screen quad per frame, simple fragment shader).
// Pauses automatically when the document is hidden via Page Visibility.

export function createAnimatedBackground(canvas) {
  if (!canvas) return null;
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });

  // v1.11.31: surface WebGL context loss. iOS Safari (and some Android
  // Chrome) reclaim GPU resources under memory pressure or after
  // backgrounding. Without a listener, the canvas silently goes black
  // forever. We can't reliably re-init from inside this module without
  // significant refactoring — for now we warn so users can manually
  // reload to recover. Future work: full restore handler.
  try {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('[WebGL] context lost — reload page to recover');
    }, false);
    canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[WebGL] context restored — reload recommended');
    }, false);
  } catch (_) { /* listener support absent */ }
  if (!gl) {
    console.warn('Animated bg: WebGL unavailable, fallback to static body bg');
    return null;
  }

  const VS = `attribute vec2 a; varying vec2 uv;
    void main() { uv = a*0.5+0.5; gl_Position = vec4(a, 0., 1.); }`;

  const FS = `precision highp float;
    varying vec2 uv;
    uniform float uT;
    uniform vec2 uRes;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      // Base near-black canvas (matches --bg-void at 0.024,0.027,0.031)
      vec3 col = vec3(0.024, 0.027, 0.031);

      // Slowly scrolling beveled-block grid. 20×12 cells, scrolling rightward
      // at 0.012 units/sec — one full traverse takes ~83 seconds. Very slow.
      vec2 grid = vec2(20.0, 12.0);
      vec2 cuv = vec2(uv.x + uT * 0.012, uv.y);
      vec2 cId = floor(cuv * grid);
      vec2 fr  = fract(cuv * grid);

      // Block fill region (with gap between blocks)
      vec2 d = abs(fr - 0.5);
      float dInside = max(d.x, d.y);
      float inBlock = smoothstep(0.5, 0.45, dInside);

      // Per-cell gentle pulse (independent phases via cell hash)
      float seed = hash(cId);
      float pulse = sin(uT * 0.4 + seed * 6.28) * 0.5 + 0.5;
      pulse = smoothstep(0.6, 0.95, pulse);

      // Beveled lighting (top-left lighter, bottom-right darker)
      vec2 bevD = (fr - 0.5);
      float bevel = (bevD.x + bevD.y) * 4.0;

      vec3 blockBase = vec3(0.06, 0.04, 0.02);                 // dark amber base
      blockBase += vec3(0.30, 0.18, 0.04) * pulse;              // pulse adds amber heat
      blockBase += vec3(0.08, 0.05, 0.02) * (1.0 - smoothstep(-1.0, 0.5, bevel)) * pulse;

      // Render block at low opacity — never compete with foreground content
      col += blockBase * inBlock * 0.35;

      // Vignette — fade towards edges so cards near edges aren't competing
      // with bright blocks
      vec2 vp = uv - 0.5;
      vp.x *= uRes.x / uRes.y;
      col *= 1.0 - smoothstep(0.3, 0.85, length(vp)) * 0.5;

      // Top-edge amber radial (reinforces existing static gradient)
      col += vec3(0.05, 0.03, 0.01) * exp(-pow((1.0 - uv.y) * 1.5, 2.0));

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
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    rafId = requestAnimationFrame(draw);
  }

  function start() { if (!paused && rafId == null) rafId = requestAnimationFrame(draw); }
  function pause() { paused = true; if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; } }
  function resume() { paused = false; start(); }

  // Auto-pause when tab is hidden — saves battery on iPhone
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
  };
}
