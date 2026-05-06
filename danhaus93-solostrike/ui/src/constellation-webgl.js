// ============================================================================
// constellation-webgl.js — Lightning Cascade renderer (rev70r)
//
// Despite the historical "webgl" filename, this is now a 2D canvas renderer
// implementing the Lightning Cascade visualization. The exported API surface
// matches the previous WebGL renderer so App.jsx wiring stays identical.
//
// What changed from rev70q:
//   - 3D WebGL point sprites + Fibonacci sphere → 2D canvas with random scatter
//   - Drag-rotate / pinch-zoom / ambient rotation → REMOVED (no-op stubs kept)
//   - Two-zone star shader → 2D drawing primitives (gradients, paths)
//   - Decorative striker pulses → driven by flashPoolIndices from real share data
//
// What stays the same:
//   - Public function name `createConstellationWebGL`
//   - update({ dpr, width, height, poolWorkers, dt, flashPoolIndices }) signature
//   - Method names addRotation / multiplyZoom / setZoom / resetView /
//     pingInteraction / destroy / isReady (all become no-ops if not relevant)
//   - Per-pool striker counts pulled from poolWorkers array (1:1 with peer.workers)
//   - flashPoolIndices array — when a pool's index appears, fire a cascade
//     originating from a random striker in that pool, chaining 3 levels deep
//     to 2-nearest-neighbor strikers
// ============================================================================

const POOLS_MAX = 64;
const STRIKERS_MAX = 800;
const K_NEIGHBORS = 2;       // each striker → 2 nearest neighbors for cascade
const FLASH_DUR = 1000;      // ms — striker white-flash duration (cubic ease)
const CHAIN_DELAY = 120;     // ms between chain hops
const CHAIN_DEPTH = 3;       // max recursion depth per cascade
const BOLT_DURATION = 300;   // ms — single lightning bolt fade
const RNG_SEED = 424242;

function rng(seed) {
  let s = seed | 0;
  return function() {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createConstellationWebGL(canvas) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { failed: true };

  // ── State ────────────────────────────────────────────────────────────────
  let W = 0, H = 0, dprCached = 1;
  let pools = [];
  let strikers = [];
  let adj = new Map();
  let bolts = [];
  let lastSig = '';
  let destroyed = false;

  // ── Scene rebuild ────────────────────────────────────────────────────────
  function rebuildScene(poolCounts) {
    pools = [];
    strikers = [];
    adj = new Map();
    bolts = [];

    const numPools = Math.min(POOLS_MAX, poolCounts.length);
    if (numPools === 0 || W === 0 || H === 0) return;

    const rand = rng(RNG_SEED);

    // ── Place pool centers ────────────────────────────────────────────────
    // Layout depends on count. 1 = center. 2 = left/right. 3+ = ring.
    if (numPools === 1) {
      pools.push({ x: W / 2, y: H / 2, idx: 0 });
    } else if (numPools === 2) {
      pools.push({ x: W * 0.30, y: H * 0.45, idx: 0 });
      pools.push({ x: W * 0.70, y: H * 0.55, idx: 1 });
    } else {
      const cx = W / 2, cy = H / 2;
      const r = Math.min(W, H) * 0.32;
      for (let i = 0; i < numPools; i++) {
        const ang = (i / numPools) * Math.PI * 2 + 0.4;
        pools.push({ x: cx + Math.cos(ang) * r, y: cy + Math.sin(ang) * r * 0.8, idx: i });
      }
    }

    // ── Place strikers per pool — RANDOM SCATTER, count matches poolCounts ─
    let id = 0;
    let strikersUsed = 0;
    // Adjust scatter radius based on density
    const minR = numPools <= 2 ? 22 : 18;
    const maxR = numPools <= 2 ? 78 : 55;

    for (let p = 0; p < numPools; p++) {
      const pool = pools[p];
      const cnt = Math.min(poolCounts[p] | 0, STRIKERS_MAX - strikersUsed);
      strikersUsed += cnt;
      for (let i = 0; i < cnt; i++) {
        // RANDOM angle + distance — organic scatter, NOT evenly spaced
        const ang = rand() * Math.PI * 2;
        const dist = minR + rand() * (maxR - minR);
        strikers.push({
          id: id++,
          poolIdx: p,
          ax: pool.x + Math.cos(ang) * dist,
          ay: pool.y + Math.sin(ang) * dist,
          x: 0, y: 0,
          speed: 0.2 + rand() * 0.3,
          offset: rand() * 1000,
          flashUntil: 0,
        });
      }
    }

    // ── K-nearest adjacency (for cascade chain) ──────────────────────────
    for (let i = 0; i < strikers.length; i++) adj.set(i, []);
    for (let i = 0; i < strikers.length; i++) {
      const dists = strikers.map((s, j) => ({
        j,
        d: i === j ? Infinity : Math.hypot(s.ax - strikers[i].ax, s.ay - strikers[i].ay),
      }));
      dists.sort((a, b) => a.d - b.d);
      for (let k = 0; k < K_NEIGHBORS && k < dists.length; k++) {
        const j = dists[k].j;
        if (j < 0 || !isFinite(dists[k].d)) continue;
        if (!adj.get(i).includes(j)) adj.get(i).push(j);
        if (!adj.get(j).includes(i)) adj.get(j).push(i);
      }
    }
  }

  // ── Lightning path generator (mid-point displacement) ──────────────────
  function makeJaggedPath(x1, y1, x2, y2, disp, depth) {
    const segs = [];
    function recurse(p1, p2, d, depthLeft) {
      if (depthLeft === 0) { segs.push(p1, p2); return; }
      const mx = (p1.x + p2.x) / 2 + (Math.random() - 0.5) * d;
      const my = (p1.y + p2.y) / 2 + (Math.random() - 0.5) * d;
      const m = { x: mx, y: my };
      recurse(p1, m, d * 0.5, depthLeft - 1);
      recurse(m, p2, d * 0.5, depthLeft - 1);
    }
    recurse({ x: x1, y: y1 }, { x: x2, y: y2 }, disp, depth);
    return segs;
  }

  // ── Cascade triggers ───────────────────────────────────────────────────
  function fireFromPool(poolIdx, t) {
    if (poolIdx < 0 || poolIdx >= pools.length) return;
    const candidates = [];
    for (let i = 0; i < strikers.length; i++) {
      if (strikers[i].poolIdx === poolIdx) candidates.push(i);
    }
    if (candidates.length === 0) return;
    const targetIdx = candidates[Math.floor(Math.random() * candidates.length)];
    strikers[targetIdx].flashUntil = t + FLASH_DUR;
    bolts.push({
      type: 'pool',
      fromX: pools[poolIdx].x,
      fromY: pools[poolIdx].y,
      toIdx: targetIdx,
      start: t,
      duration: BOLT_DURATION,
      nextIdx: targetIdx,
      nextDepth: 1,
      triggered: false,
    });
  }

  function chain(idx, t, depth) {
    if (idx < 0 || idx >= strikers.length) return;
    strikers[idx].flashUntil = t + FLASH_DUR * 0.6;
    if (depth >= CHAIN_DEPTH) return;
    const neighbors = adj.get(idx) || [];
    for (const n of neighbors) {
      bolts.push({
        type: 'striker',
        fromIdx: idx,
        toIdx: n,
        start: t + depth * CHAIN_DELAY,
        duration: BOLT_DURATION,
        nextIdx: n,
        nextDepth: depth + 1,
        triggered: false,
      });
    }
  }

  // ── Update + render ────────────────────────────────────────────────────
  function update(opts) {
    if (destroyed || !opts) return;
    const { dpr, width, height, poolWorkers, flashPoolIndices } = opts;
    if (!width || !height) return;

    const dprNew = dpr || 1;
    if (W !== width || H !== height || dprCached !== dprNew) {
      W = width; H = height; dprCached = dprNew;
      canvas.width = Math.floor(W * dprNew);
      canvas.height = Math.floor(H * dprNew);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      ctx.setTransform(dprNew, 0, 0, dprNew, 0, 0);
      lastSig = ''; // force scene rebuild for new dimensions
    }

    const counts = Array.isArray(poolWorkers) ? poolWorkers : [];
    const sig = counts.length + '|' + counts.join(',');
    if (sig !== lastSig) {
      lastSig = sig;
      rebuildScene(counts);
    }

    if (pools.length === 0) {
      ctx.clearRect(0, 0, W, H);
      return;
    }

    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // Trigger cascades for each pool with detected activity
    if (Array.isArray(flashPoolIndices) && flashPoolIndices.length > 0) {
      for (const poolIdx of flashPoolIndices) {
        fireFromPool(poolIdx, t);
      }
    }

    // Striker subtle position wobble
    for (const s of strikers) {
      const phase = (t / 1000) * s.speed + s.offset;
      s.x = s.ax + Math.cos(phase) * 2;
      s.y = s.ay + Math.sin(phase * 1.3) * 2;
    }

    // Process bolt queue: trigger next chain when bolt reaches halfway
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      if (t < b.start) continue;
      const age = (t - b.start) / b.duration;
      if (age >= 0.5 && !b.triggered) {
        b.triggered = true;
        if (b.nextDepth !== undefined && b.nextDepth < CHAIN_DEPTH) {
          chain(b.nextIdx, t, b.nextDepth);
        }
      }
      if (age >= 1) bolts.splice(i, 1);
    }

    // ── Draw frame ────────────────────────────────────────────────────────
    // Background fade — semi-transparent fill creates subtle motion-blur trails
    ctx.fillStyle = 'rgba(8,7,5,0.85)';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Persistent dim mesh edges (shows striker connectivity)
    const drawn = new Set();
    for (let i = 0; i < strikers.length; i++) {
      const list = adj.get(i) || [];
      for (const j of list) {
        const a = Math.min(i, j), b = Math.max(i, j);
        const key = a + '_' + b;
        if (drawn.has(key)) continue;
        drawn.add(key);
        ctx.strokeStyle = 'rgba(89,153,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(strikers[i].x, strikers[i].y);
        ctx.lineTo(strikers[j].x, strikers[j].y);
        ctx.stroke();
      }
    }

    // Active lightning bolts
    for (const bolt of bolts) {
      if (t < bolt.start) continue;
      const age = (t - bolt.start) / bolt.duration;
      if (age >= 1) continue;
      const alpha = Math.min(1, (1 - age) * 1.4);
      let fx, fy, tx, ty;
      if (bolt.type === 'pool') {
        fx = bolt.fromX; fy = bolt.fromY;
        if (bolt.toIdx < 0 || bolt.toIdx >= strikers.length) continue;
        tx = strikers[bolt.toIdx].x; ty = strikers[bolt.toIdx].y;
      } else {
        if (bolt.fromIdx < 0 || bolt.fromIdx >= strikers.length) continue;
        if (bolt.toIdx < 0 || bolt.toIdx >= strikers.length) continue;
        fx = strikers[bolt.fromIdx].x; fy = strikers[bolt.fromIdx].y;
        tx = strikers[bolt.toIdx].x; ty = strikers[bolt.toIdx].y;
      }
      const segs = makeJaggedPath(fx, fy, tx, ty, 12, 3);
      const thickness = bolt.type === 'pool' ? 2.2 : 1.6;

      // Outer blue glow
      ctx.strokeStyle = `rgba(170,200,255,${alpha * 0.85})`;
      ctx.lineWidth = thickness;
      ctx.beginPath();
      for (let j = 0; j < segs.length; j += 2) {
        if (j === 0) ctx.moveTo(segs[j].x, segs[j].y);
        ctx.lineTo(segs[j + 1].x, segs[j + 1].y);
      }
      ctx.stroke();
      // Inner white core
      ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.95})`;
      ctx.lineWidth = thickness * 0.4;
      ctx.beginPath();
      for (let j = 0; j < segs.length; j += 2) {
        if (j === 0) ctx.moveTo(segs[j].x, segs[j].y);
        ctx.lineTo(segs[j + 1].x, segs[j + 1].y);
      }
      ctx.stroke();
    }

    // Strikers (with cubic ease-out white flash on chain hits)
    for (const s of strikers) {
      const flashing = t < s.flashUntil;
      if (flashing) {
        const fade = (s.flashUntil - t) / FLASH_DUR;
        const ease = fade * fade * fade;
        // Outer blue glow
        const g1 = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 14 + ease * 16);
        g1.addColorStop(0, `rgba(170,220,255,${ease * 0.6 + 0.2})`);
        g1.addColorStop(1, 'rgba(170,220,255,0)');
        ctx.fillStyle = g1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 14 + ease * 16, 0, Math.PI * 2);
        ctx.fill();
        // White core
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2 + ease * 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Normal blue dot with subtle halo
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 4);
        g.addColorStop(0, 'rgba(89,153,255,0.5)');
        g.addColorStop(1, 'rgba(89,153,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(89,153,255,0.85)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Pool electrodes (amber + blue electric halo)
    for (const p of pools) {
      // Outer amber halo
      const g1 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 28);
      g1.addColorStop(0, 'rgba(255,166,51,0.18)');
      g1.addColorStop(1, 'rgba(255,166,51,0)');
      ctx.fillStyle = g1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, Math.PI * 2); ctx.fill();
      // Inner blue electric halo
      const g2 = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
      g2.addColorStop(0, 'rgba(200,220,255,0.25)');
      g2.addColorStop(1, 'rgba(200,220,255,0)');
      ctx.fillStyle = g2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill();
      // Solid amber core
      ctx.fillStyle = 'rgba(255,166,51,0.95)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
      // Highlight
      ctx.fillStyle = 'rgba(255,220,180,0.7)';
      ctx.beginPath(); ctx.arc(p.x - 1.4, p.y - 1.4, 2.8, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore();
  }

  function destroy() {
    destroyed = true;
    pools = [];
    strikers = [];
    bolts = [];
    adj = new Map();
  }

  // ── Public API ────────────────────────────────────────────────────────────
  // The rotation/zoom/interaction methods are kept as no-ops so App.jsx's
  // pointer handlers (which call into them when pulseAnim === 'constellation')
  // continue to work harmlessly without crashing.
  return {
    update,
    addRotation: () => {},
    multiplyZoom: () => {},
    setZoom: () => {},
    resetView: () => {},
    pingInteraction: () => {},
    destroy,
    isReady: () => !destroyed,
  };
}
