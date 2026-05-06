// SoloStrike WebGL constellation renderer — rev70i.
//
// "Striker Constellation" pulse animation. Visualizes the dual-tier census:
//   • Pools  = bright amber points (cluster centers)
//   • Strikers = blue-white points (orbit each pool's center)
// Plus dim amber lines from each striker to its pool center (intra-pool
// edges) and very sparse gray lines between nearby pool centers
// (inter-pool edges).
//
// Public API (matches globe-webgl pattern):
//   const c = createConstellationWebGL(canvas)
//   c.update({ dpr, width, height, pools, strikers, dt })   // each frame
//   c.destroy()
//   c.isReady()

const VERT_POINTS = `
precision mediump float;
attribute vec3 aPos;
attribute float aSize;
attribute vec3 aColor;
uniform mat4 uViewProj;
uniform float uPxScale;
varying vec3 vColor;
void main() {
  vec4 p = uViewProj * vec4(aPos, 1.0);
  gl_PointSize = aSize * uPxScale / max(0.1, -p.z);
  gl_Position = p;
  vColor = aColor;
}
`;

const FRAG_POINTS = `
precision mediump float;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  // Soft glow — exponential falloff from center
  float a = exp(-d * 7.0);
  gl_FragColor = vec4(vColor, a * 1.6);
}
`;

const VERT_LINES = `
precision mediump float;
attribute vec3 aPos;
attribute vec3 aColor;
uniform mat4 uViewProj;
varying vec3 vColor;
void main() {
  gl_Position = uViewProj * vec4(aPos, 1.0);
  vColor = aColor;
}
`;

const FRAG_LINES = `
precision mediump float;
varying vec3 vColor;
uniform float uOpacity;
void main() {
  gl_FragColor = vec4(vColor, uOpacity);
}
`;

function compileShader(gl, src, type) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('constellation shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function linkProgram(gl, vs, fs) {
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('constellation program link failed:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

// Build a perspective * view matrix for our orbital camera.
// fovYRad = field of view, aspect = w/h, near/far clipping planes.
function buildViewProj(out, fovYRad, aspect, near, far, rotY, rotX, distance) {
  // Perspective projection
  const f = 1.0 / Math.tan(fovYRad / 2);
  const nf = 1.0 / (near - far);
  const persp = [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ];
  // View: rotate scene by -rotY around Y, -rotX around X, then translate -distance on Z.
  const cy = Math.cos(rotY), sy = Math.sin(rotY);
  const cx = Math.cos(rotX), sx = Math.sin(rotX);
  // Combined rotation Y then X (column-major)
  const view = [
    cy,        sy * sx,  -sy * cx, 0,
    0,         cx,        sx,      0,
    sy,       -cy * sx,   cy * cx, 0,
    0,         0,        -distance,1,
  ];
  // out = persp * view (column-major matrix multiply)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += persp[k * 4 + r] * view[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
}

export function createConstellationWebGL(canvas, opts = {}) {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
    antialias: true,
    preserveDrawingBuffer: false,
    powerPreference: 'low-power',
  });
  if (!gl) {
    console.warn('constellation: WebGL not available');
    return { failed: true };
  }

  // ─── Compile shaders ───
  const vsP = compileShader(gl, VERT_POINTS, gl.VERTEX_SHADER);
  const fsP = compileShader(gl, FRAG_POINTS, gl.FRAGMENT_SHADER);
  const vsL = compileShader(gl, VERT_LINES, gl.VERTEX_SHADER);
  const fsL = compileShader(gl, FRAG_LINES, gl.FRAGMENT_SHADER);
  if (!vsP || !fsP || !vsL || !fsL) return { failed: true };

  const progPoints = linkProgram(gl, vsP, fsP);
  const progLines = linkProgram(gl, vsL, fsL);
  if (!progPoints || !progLines) return { failed: true };

  // Uniform / attribute locations
  const aPosP = gl.getAttribLocation(progPoints, 'aPos');
  const aSizeP = gl.getAttribLocation(progPoints, 'aSize');
  const aColorP = gl.getAttribLocation(progPoints, 'aColor');
  const uViewProjP = gl.getUniformLocation(progPoints, 'uViewProj');
  const uPxScale = gl.getUniformLocation(progPoints, 'uPxScale');

  const aPosL = gl.getAttribLocation(progLines, 'aPos');
  const aColorL = gl.getAttribLocation(progLines, 'aColor');
  const uViewProjL = gl.getUniformLocation(progLines, 'uViewProj');
  const uLineOpacity = gl.getUniformLocation(progLines, 'uOpacity');

  // ─── Buffers ───
  const pointsPosBuf = gl.createBuffer();
  const pointsSizeBuf = gl.createBuffer();
  const pointsColorBuf = gl.createBuffer();

  const intraLinesPosBuf = gl.createBuffer();
  const intraLinesColorBuf = gl.createBuffer();

  const interLinesPosBuf = gl.createBuffer();
  const interLinesColorBuf = gl.createBuffer();

  // ─── Scene state ───
  let pools = []; // [{ cx, cy, cz }]
  let strikers = []; // [{ poolIdx, ox, oy, oz, speed, offset, flashUntil }]
  let interLineCount = 0;

  // Persistent typed arrays — sized for max scene.
  // rev70j: bumped from 16/192 to support strict 1:1 mapping with real
  // pool/worker counts. Buffers are static-sized; counts above these
  // caps are still drawn but scene rebuild caps at MAX_POOLS / MAX_STRIKERS
  // and excess is silently dropped. Real SoloStrike network is unlikely
  // to exceed these in the medium term.
  const MAX_POOLS = 64;
  const MAX_STRIKERS = 800;
  const MAX_TOTAL_POINTS = MAX_POOLS + MAX_STRIKERS;

  const pointPositions = new Float32Array(MAX_TOTAL_POINTS * 3);
  const pointSizes = new Float32Array(MAX_TOTAL_POINTS);
  const pointColors = new Float32Array(MAX_TOTAL_POINTS * 3);

  const intraLinePositions = new Float32Array(MAX_STRIKERS * 6); // 2 verts/line × 3 floats
  const intraLineColors = new Float32Array(MAX_STRIKERS * 6);

  // Inter-pool lines: all pairs of pool centers within range. Cap total
  // line count to keep render cost predictable at high pool counts.
  const MAX_INTER_LINES = 400;
  const interLinePositions = new Float32Array(MAX_INTER_LINES * 6);
  const interLineColors = new Float32Array(MAX_INTER_LINES * 6);

  let totalPoints = 0;
  let totalStrikers = 0;
  let totalPools = 0;

  // RNG (deterministic so layout is stable across rebuilds with same seed)
  let rngSeed = 12345;
  function rand() {
    rngSeed = (rngSeed * 1664525 + 1013904223) | 0;
    return ((rngSeed >>> 0) / 4294967296);
  }
  function resetRng(seed) { rngSeed = (seed | 0) || 12345; }

  function rebuildScene(poolWorkerCounts) {
    resetRng(424242); // deterministic for stable rebuild

    // rev70k: STRICT per-pool counts. Caller passes an array where each
    // entry is the worker count of one specific pool. Pools[i] gets
    // poolWorkerCounts[i] strikers. This matches the API model where
    // each peer == one pool, and peer.workers is that pool's striker count.
    const counts = Array.isArray(poolWorkerCounts) ? poolWorkerCounts : [];
    const RAW_POOLS = counts.length;
    const POOLS = Math.min(MAX_POOLS, RAW_POOLS);
    const RAW_STRIKERS = counts.reduce((a, b) => a + (b | 0), 0);
    if (RAW_POOLS > MAX_POOLS) {
      console.warn(`constellation: ${RAW_POOLS} pools exceeds buffer cap ${MAX_POOLS}; capping.`);
    }
    if (RAW_STRIKERS > MAX_STRIKERS) {
      console.warn(`constellation: ${RAW_STRIKERS} strikers exceeds buffer cap ${MAX_STRIKERS}; some pools will lose strikers.`);
    }

    pools = [];
    strikers = [];

    // Empty network — just clear scene state and bail. Nothing to draw.
    if (POOLS === 0) {
      totalPools = 0;
      totalStrikers = 0;
      totalPoints = 0;
      interLineCount = 0;
      return;
    }

    // Build pool cluster centers — distributed on a flattened spherical
    // shell. With many pools they pack densely; that's accurate not a bug.
    for (let p = 0; p < POOLS; p++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const r = 1.4 + rand() * 1.6;
      const cx = r * Math.sin(phi) * Math.cos(theta);
      const cy = r * Math.sin(phi) * Math.sin(theta) * 0.6;
      const cz = r * Math.cos(phi);
      pools.push({ cx, cy, cz, flashUntil: 0, workers: counts[p] | 0 });
    }

    // Build strikers: pool i gets exactly counts[i] dots.
    let strikersBudget = MAX_STRIKERS;
    for (let p = 0; p < POOLS && strikersBudget > 0; p++) {
      const w = Math.min(counts[p] | 0, strikersBudget);
      strikersBudget -= w;
      for (let s = 0; s < w; s++) {
        const sa = rand() * Math.PI * 2;
        const sb = (rand() - 0.5) * Math.PI;
        const sr = 0.18 + rand() * 0.22;
        strikers.push({
          poolIdx: p,
          baseOx: Math.cos(sa) * Math.cos(sb) * sr,
          baseOy: Math.sin(sb) * sr,
          baseOz: Math.sin(sa) * Math.cos(sb) * sr,
          ox: 0, oy: 0, oz: 0,
          speed: 0.4 + rand() * 0.8,
          offset: rand() * 1000,
        });
      }
    }

    totalPools = POOLS;
    totalStrikers = strikers.length;
    totalPoints = totalPools + totalStrikers;

    // Pre-fill colors and base sizes
    // Pools: amber-bright #FFD68A (1.0, 0.84, 0.42)
    // Strikers: blue-tint #88AACC (0.55, 0.72, 0.95)
    // rev70j: when very few pools, scale up the pool size slightly so they
    // don't look lonely. When many pools, scale down so they don't crowd.
    const poolSizeBase = totalPools <= 3 ? 0.30
                       : totalPools <= 8 ? 0.22
                       : totalPools <= 20 ? 0.18
                       : 0.14;
    const strikerSizeBase = totalStrikers <= 20 ? 0.08
                          : totalStrikers <= 80 ? 0.06
                          : totalStrikers <= 200 ? 0.05
                          : 0.04;

    for (let i = 0; i < totalPools; i++) {
      pointColors[i * 3 + 0] = 1.0;
      pointColors[i * 3 + 1] = 0.84;
      pointColors[i * 3 + 2] = 0.42;
      pointSizes[i] = poolSizeBase;
    }
    for (let i = 0; i < totalStrikers; i++) {
      const k = totalPools + i;
      pointColors[k * 3 + 0] = 0.55;
      pointColors[k * 3 + 1] = 0.72;
      pointColors[k * 3 + 2] = 0.95;
      pointSizes[k] = strikerSizeBase;
    }
    // Stash for animation loop reference
    pools.poolSizeBase = poolSizeBase;
    strikers.strikerSizeBase = strikerSizeBase;

    gl.bindBuffer(gl.ARRAY_BUFFER, pointsColorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pointColors, gl.DYNAMIC_DRAW);

    // Build inter-pool lines — pool centers within range. Capped to
    // MAX_INTER_LINES total. Range tightened slightly when there are many
    // pools so the network doesn't degenerate to a fully-connected mess.
    const range = totalPools <= 8 ? 2.6
                : totalPools <= 20 ? 2.0
                : 1.4;
    let liIdx = 0;
    interLineCount = 0;
    for (let i = 0; i < totalPools && interLineCount < MAX_INTER_LINES; i++) {
      for (let j = i + 1; j < totalPools && interLineCount < MAX_INTER_LINES; j++) {
        const dx = pools[i].cx - pools[j].cx;
        const dy = pools[i].cy - pools[j].cy;
        const dz = pools[i].cz - pools[j].cz;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < range) {
          interLinePositions[liIdx * 6 + 0] = pools[i].cx;
          interLinePositions[liIdx * 6 + 1] = pools[i].cy;
          interLinePositions[liIdx * 6 + 2] = pools[i].cz;
          interLinePositions[liIdx * 6 + 3] = pools[j].cx;
          interLinePositions[liIdx * 6 + 4] = pools[j].cy;
          interLinePositions[liIdx * 6 + 5] = pools[j].cz;
          for (let v = 0; v < 2; v++) {
            interLineColors[liIdx * 6 + v * 3 + 0] = 0.28;
            interLineColors[liIdx * 6 + v * 3 + 1] = 0.32;
            interLineColors[liIdx * 6 + v * 3 + 2] = 0.38;
          }
          liIdx++;
          interLineCount++;
        }
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, interLinesPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, interLinePositions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, interLinesColorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, interLineColors, gl.STATIC_DRAW);

    // Pre-color intra-pool lines (amber-dim)
    for (let i = 0; i < MAX_STRIKERS * 6; i += 3) {
      intraLineColors[i + 0] = 0.96;
      intraLineColors[i + 1] = 0.65;
      intraLineColors[i + 2] = 0.14;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, intraLinesColorBuf);
    gl.bufferData(gl.ARRAY_BUFFER, intraLineColors, gl.STATIC_DRAW);
  }

  // Build initial empty scene. update() rebuilds on first real data.
  rebuildScene([]);

  // Time accumulator
  let tAccum = 0;

  // Scene rotation. rev70k: split into two:
  //   • idleRotY/X — automatic gentle drift when user is not interacting
  //   • userRotY/X — user-controlled rotation from drag input
  // Final rotation = idle + user. When user interacts, idle pauses for
  // a few seconds before resuming.
  let userRotY = 0;
  let userRotX = 0;
  let userZoom = 1.0; // multiplicative on base distance
  let lastInteractionMs = 0;
  const IDLE_RESUME_MS = 3500; // auto-rotate resumes this many ms after last input
  const BASE_DISTANCE = 6.5;
  const MIN_ZOOM = 0.45;
  const MAX_ZOOM = 4.0;

  // Cached signature of the last poolWorkers array. Used to detect changes
  // cheaply without deep-comparing every frame. Format: "n|w0,w1,w2,..."
  let lastSig = '';

  let lastWidth = 0, lastHeight = 0, lastDpr = 0;

  function resize(width, height, dpr) {
    if (width === lastWidth && height === lastHeight && dpr === lastDpr) return;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    lastWidth = width; lastHeight = height; lastDpr = dpr;
  }

  const viewProj = new Float32Array(16);

  function update({ dpr, width, height, poolWorkers, dt }) {
    if (!width || !height) return;
    resize(width, height, dpr || 1);

    // rev70k: per-pool worker counts. Caller passes poolWorkers (array).
    const counts = Array.isArray(poolWorkers) ? poolWorkers : [];
    // Cheap change detection
    const sig = counts.length + '|' + counts.join(',');
    if (sig !== lastSig) {
      lastSig = sig;
      rebuildScene(counts);
    }

    // No data → just clear (canvas stays transparent, card surface shows)
    if (totalPools === 0) {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    // Advance time
    const stepDt = Math.min(0.05, Math.max(0, dt || 0.016));
    tAccum += stepDt;

    // Idle auto-rotation resumes after IDLE_RESUME_MS of no interaction.
    // While user is interacting, rotation is purely user-controlled.
    const nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const idleRatio = Math.min(1, Math.max(0, (nowMs - lastInteractionMs - IDLE_RESUME_MS) / 1500));
    const idleRotY = tAccum * 0.07 * idleRatio;
    const idleRotX = Math.sin(tAccum * 0.1) * 0.15 * idleRatio;
    rotY = userRotY + idleRotY;
    rotX = userRotX + idleRotX;

    // Animate striker positions (orbit around their pool center).
    // Update vertex positions for points buffer.
    // Pool centers are stable.
    for (let i = 0; i < totalPools; i++) {
      pointPositions[i * 3 + 0] = pools[i].cx;
      pointPositions[i * 3 + 1] = pools[i].cy;
      pointPositions[i * 3 + 2] = pools[i].cz;
    }
    // Strikers — base offset + small phase wobble
    const strikerBase = strikers.strikerSizeBase || 0.06;
    const flashSize = Math.max(0.18, strikerBase * 3.5);
    for (let i = 0; i < totalStrikers; i++) {
      const s = strikers[i];
      const p = pools[s.poolIdx];
      const phase = tAccum * s.speed + s.offset;
      // Small jitter around base position so they look alive
      s.ox = s.baseOx + Math.cos(phase) * 0.025;
      s.oy = s.baseOy + Math.sin(phase * 1.3) * 0.025;
      s.oz = s.baseOz + Math.cos(phase * 0.7) * 0.025;
      const k = totalPools + i;
      pointPositions[k * 3 + 0] = p.cx + s.ox;
      pointPositions[k * 3 + 1] = p.cy + s.oy;
      pointPositions[k * 3 + 2] = p.cz + s.oz;

      // Sizes: pulse + occasional bright flash (random "share submitted")
      const baseSize = strikerBase * (0.8 + 0.5 * Math.abs(Math.sin(phase)));
      pointSizes[k] = (Math.random() < 0.0006) ? flashSize : baseSize;
    }
    // Pool sizes: gentle breathing, scaled to current poolSizeBase
    const poolBase = pools.poolSizeBase || 0.20;
    for (let i = 0; i < totalPools; i++) {
      pointSizes[i] = poolBase * (0.92 + 0.10 * Math.sin(tAccum * 0.8 + i));
    }

    // Build intra-pool line positions (each striker → its pool)
    for (let i = 0; i < totalStrikers; i++) {
      const s = strikers[i];
      const p = pools[s.poolIdx];
      intraLinePositions[i * 6 + 0] = p.cx;
      intraLinePositions[i * 6 + 1] = p.cy;
      intraLinePositions[i * 6 + 2] = p.cz;
      intraLinePositions[i * 6 + 3] = p.cx + s.ox;
      intraLinePositions[i * 6 + 4] = p.cy + s.oy;
      intraLinePositions[i * 6 + 5] = p.cz + s.oz;
    }

    // Upload buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, pointsPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pointPositions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointsSizeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pointSizes, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, intraLinesPosBuf);
    gl.bufferData(gl.ARRAY_BUFFER, intraLinePositions, gl.DYNAMIC_DRAW);

    // ─── Render ───
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE); // additive
    gl.disable(gl.DEPTH_TEST);

    const aspect = width / height;
    const distance = BASE_DISTANCE / userZoom;
    buildViewProj(viewProj, Math.PI * 0.25, aspect, 0.1, 100, rotY, rotX, distance);

    // Px scale: for gl_PointSize we need a scale that converts world-space
    // to pixel-space. 380 is a tuned value from the preview.
    const pxScale = 380 * (dpr || 1) * (height / 300); // matches preview when 300px tall

    // Lines first (so they appear behind glowing points)
    gl.useProgram(progLines);
    gl.uniformMatrix4fv(uViewProjL, false, viewProj);

    // Inter-pool lines (dim gray)
    if (interLineCount > 0) {
      gl.uniform1f(uLineOpacity, 0.22);
      gl.bindBuffer(gl.ARRAY_BUFFER, interLinesPosBuf);
      gl.enableVertexAttribArray(aPosL);
      gl.vertexAttribPointer(aPosL, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, interLinesColorBuf);
      gl.enableVertexAttribArray(aColorL);
      gl.vertexAttribPointer(aColorL, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, interLineCount * 2);
    }

    // Intra-pool lines (amber-dim)
    if (totalStrikers > 0) {
      gl.uniform1f(uLineOpacity, 0.18);
      gl.bindBuffer(gl.ARRAY_BUFFER, intraLinesPosBuf);
      gl.enableVertexAttribArray(aPosL);
      gl.vertexAttribPointer(aPosL, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, intraLinesColorBuf);
      gl.enableVertexAttribArray(aColorL);
      gl.vertexAttribPointer(aColorL, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.LINES, 0, totalStrikers * 2);
    }

    // Points on top
    gl.useProgram(progPoints);
    gl.uniformMatrix4fv(uViewProjP, false, viewProj);
    gl.uniform1f(uPxScale, pxScale);

    gl.bindBuffer(gl.ARRAY_BUFFER, pointsPosBuf);
    gl.enableVertexAttribArray(aPosP);
    gl.vertexAttribPointer(aPosP, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointsSizeBuf);
    gl.enableVertexAttribArray(aSizeP);
    gl.vertexAttribPointer(aSizeP, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, pointsColorBuf);
    gl.enableVertexAttribArray(aColorP);
    gl.vertexAttribPointer(aColorP, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, totalPoints);
  }

  function destroy() {
    try {
      gl.deleteBuffer(pointsPosBuf);
      gl.deleteBuffer(pointsSizeBuf);
      gl.deleteBuffer(pointsColorBuf);
      gl.deleteBuffer(intraLinesPosBuf);
      gl.deleteBuffer(intraLinesColorBuf);
      gl.deleteBuffer(interLinesPosBuf);
      gl.deleteBuffer(interLinesColorBuf);
      gl.deleteProgram(progPoints);
      gl.deleteProgram(progLines);
      gl.deleteShader(vsP);
      gl.deleteShader(fsP);
      gl.deleteShader(vsL);
      gl.deleteShader(fsL);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    } catch (e) {}
  }

  return {
    isReady() { return true; },
    update,
    destroy,
    // ── rev70k interaction API ──────────────────────────────────────────
    // All three methods bump lastInteractionMs so idle auto-rotate pauses.
    /** Drag input. dx/dy are CSS pixels of pointer movement. */
    addRotation(dxPx, dyPx) {
      // Convert pixel deltas to radians. ~600px = π rotation.
      userRotY += (dxPx || 0) * (Math.PI / 600);
      const newRotX = userRotX + (dyPx || 0) * (Math.PI / 600);
      // Clamp pitch so view doesn't flip upside-down
      userRotX = Math.max(-1.2, Math.min(1.2, newRotX));
      lastInteractionMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    },
    /** Pinch / wheel zoom. factor > 1 zooms in, < 1 zooms out. */
    multiplyZoom(factor) {
      userZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, userZoom * (factor || 1)));
      lastInteractionMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    },
    /** Set zoom directly. */
    setZoom(z) {
      userZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z || 1));
      lastInteractionMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    },
    /** Reset to default view + clear interaction so auto-rotate resumes. */
    resetView() {
      userRotY = 0;
      userRotX = 0;
      userZoom = 1.0;
      lastInteractionMs = 0;
    },
    /** Bump interaction timestamp without changing view (e.g. on pointer-down). */
    pingInteraction() {
      lastInteractionMs = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    },
  };
}
