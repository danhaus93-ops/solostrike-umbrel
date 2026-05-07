// SoloStrike Constellation — 2D canvas renderer (rev70y).
//
// Drop-in replacement for constellation-webgl.js with the same factory API:
//   createConstellation2D(canvas) → { isReady, update, destroy, addRotation, multiplyZoom, resetView }
//
// Why 2D instead of WebGL:
//   - Browsers cap WebGL gl.lineWidth at 1px (spec-permitted), so thick
//     plasma-bolt strokes (3px outer glow + 1.2px core) don't render. Our
//     v1.8.5-rev70x bolt looked like a hairline as a result.
//   - gl_POINTS can render colored dots but can't paint a radial-gradient
//     halo around them. Pool glow halos require Canvas2D radial gradients.
//
// All visuals here are ported from solostrike-rev70x-preview.html which the
// user signed off on. Preserve those exact constants when iterating —
// changing pool size, striker brightness, or bolt geometry will diverge
// from the approved look.

export function createConstellation2D(canvas, opts = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { failed: true };

  const FLASH_DUR = 1000;
  const BOLT_DURATION = 500;

  let dpr = 1;
  let W = 0, H = 0;
  let pools = null;
  let strikers = null;
  let plasmaBolts = [];
  let lastSig = '';
  let tAccum = 0;
  let strikerFlashUntil = null; // Float32Array per striker

  // Seeded RNG so striker layouts are stable across re-builds
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

  function poolPositions(count, w, h) {
    const out = [];
    if (count === 1) {
      out.push({ x: w * 0.5, y: h * 0.5, breathPhase: 0 });
    } else if (count === 2) {
      // Match preview: pool α at (0.32, 0.50), pool β at (0.70, 0.40)
      out.push({ x: w * 0.32, y: h * 0.50, breathPhase: 0 });
      out.push({ x: w * 0.70, y: h * 0.40, breathPhase: 1.5 });
    } else {
      // Arrange in a circle around center
      const cx = w * 0.5, cy = h * 0.5;
      const radius = Math.min(w, h) * 0.32;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2 - Math.PI / 2;
        out.push({
          x: cx + Math.cos(ang) * radius,
          y: cy + Math.sin(ang) * radius,
          breathPhase: (i * 1.7) % (Math.PI * 2),
        });
      }
    }
    return out;
  }

  function rebuildScene(counts) {
    const totalPools = counts.length;
    pools = poolPositions(totalPools, W, H);
    strikers = [];
    if (totalPools === 0) return;
    const rand = rng(424242);
    let id = 0;
    for (let p = 0; p < totalPools; p++) {
      const pool = pools[p];
      const cnt = counts[p] | 0;
      // Fibonacci-sphere distribution per pool
      const golden = Math.PI * (3 - Math.sqrt(5));
      const baseRadius = totalPools === 2 ? 70 : 60;
      for (let i = 0; i < cnt; i++) {
        const y = 1 - (i / Math.max(1, cnt - 1)) * 2;
        const ringR = Math.sqrt(1 - y * y);
        const theta = golden * i;
        const jx = (rand() - 0.5) * 0.12;
        const jy = (rand() - 0.5) * 0.12;
        const jz = (rand() - 0.5) * 0.12;
        const ox = (Math.cos(theta) * ringR + jx) * baseRadius;
        const oy = (y + jy) * baseRadius;
        const oz = (Math.sin(theta) * ringR + jz) * baseRadius;
        strikers.push({
          id: id++,
          poolIdx: p,
          ax: pool.x + ox,
          ay: pool.y + oy,
          baseZ: oz,
          x: 0, y: 0, z: 0,
          speed: 0.4 + rand() * 0.8,
          offset: rand() * 1000,
        });
      }
    }
    if (!strikerFlashUntil || strikerFlashUntil.length < strikers.length) {
      strikerFlashUntil = new Float32Array(strikers.length);
    }
  }

  // Mid-point displacement jagged path (matches preview)
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

  function update({ dpr: dprIn, width, height, poolWorkers, dt, flashPoolIndices }) {
    dpr = dprIn || 1;
    const targetW = width || canvas.clientWidth;
    const targetH = height || canvas.clientHeight;

    // Resize backing store if needed
    const want_w = Math.floor(targetW * dpr);
    const want_h = Math.floor(targetH * dpr);
    if (canvas.width !== want_w) canvas.width = want_w;
    if (canvas.height !== want_h) canvas.height = want_h;

    if (W !== targetW || H !== targetH) {
      W = targetW; H = targetH;
      lastSig = ''; // trigger rebuild on resize
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const counts = Array.isArray(poolWorkers) ? poolWorkers : [];
    const totalPools = counts.length;
    const sig = counts.length + '|' + counts.join(',') + '|' + W + 'x' + H;
    if (sig !== lastSig) {
      lastSig = sig;
      rebuildScene(counts);
    }

    // Empty state — clear and bail
    if (totalPools === 0 || !pools || !strikers) {
      ctx.clearRect(0, 0, W, H);
      return;
    }

    const stepDt = Math.min(0.05, Math.max(0, dt || 0.016));
    tAccum += stepDt;
    const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());

    // ── Process flashPoolIndices (real share-flash) ─────────────────────
    if (Array.isArray(flashPoolIndices) && flashPoolIndices.length > 0) {
      for (const poolIdx of flashPoolIndices) {
        if (poolIdx < 0 || poolIdx >= totalPools) continue;
        // Flash all strikers in this pool
        for (let i = 0; i < strikers.length; i++) {
          if (strikers[i].poolIdx === poolIdx) {
            strikerFlashUntil[i] = t + FLASH_DUR;
          }
        }
        // Auto-fire plasma bolt: from this pool to another (round-robin)
        if (totalPools >= 2) {
          let toIdx = (poolIdx + 1) % totalPools;
          // If multiple pools flashed, prefer the OTHER flashed one
          for (const other of flashPoolIndices) {
            if (other !== poolIdx && other >= 0 && other < totalPools) {
              toIdx = other;
              break;
            }
          }
          plasmaBolts.push({
            fromIdx: poolIdx,
            toIdx,
            start: t,
            duration: BOLT_DURATION,
          });
        }
      }
    }

    // ── Animate striker positions (subtle wobble) ───────────────────────
    for (const s of strikers) {
      const phase = (t / 1000) * s.speed + s.offset;
      s.x = s.ax + Math.cos(phase) * 2;
      s.y = s.ay + Math.sin(phase * 1.3) * 2;
      s.z = s.baseZ + Math.cos(phase * 0.7) * 2;
    }

    // ── Background clear ────────────────────────────────────────────────
    ctx.clearRect(0, 0, W, H);

    // ── Inter-pool dim lines (always visible, gray-blue, low alpha) ─────
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(71,82,97,0.55)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i < totalPools; i++) {
      for (let j = i + 1; j < totalPools; j++) {
        ctx.beginPath();
        ctx.moveTo(pools[i].x, pools[i].y);
        ctx.lineTo(pools[j].x, pools[j].y);
        ctx.stroke();
      }
    }

    // ── Intra-pool lines (striker → pool, amber-dim) ────────────────────
    ctx.strokeStyle = 'rgba(245,166,36,0.32)';
    ctx.lineWidth = 0.6;
    for (const s of strikers) {
      const pool = pools[s.poolIdx];
      ctx.beginPath();
      ctx.moveTo(pool.x, pool.y);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    ctx.restore();

    // ── Plasma bolts (jagged) ──────────────────────────────────────────
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = plasmaBolts.length - 1; i >= 0; i--) {
      const b = plasmaBolts[i];
      const age = (t - b.start) / b.duration;
      if (age >= 1) { plasmaBolts.splice(i, 1); continue; }
      const alpha = Math.min(1, (1 - age) * 1.4);
      const fromPool = pools[b.fromIdx];
      const toPool = pools[b.toIdx];
      if (!fromPool || !toPool) { plasmaBolts.splice(i, 1); continue; }
      // Regenerate jagged path each frame for liveness
      const segs = makeJaggedPath(fromPool.x, fromPool.y, toPool.x, toPool.y, 18, 4);
      // Outer blue glow
      ctx.strokeStyle = `rgba(170,200,255,${alpha * 0.85})`;
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      for (let j = 0; j < segs.length; j += 2) {
        if (j === 0) ctx.moveTo(segs[j].x, segs[j].y);
        ctx.lineTo(segs[j + 1].x, segs[j + 1].y);
      }
      ctx.stroke();
      // Inner white core
      ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.95})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let j = 0; j < segs.length; j += 2) {
        if (j === 0) ctx.moveTo(segs[j].x, segs[j].y);
        ctx.lineTo(segs[j + 1].x, segs[j + 1].y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // ── Strikers (saturated blue, flash white on share) ────────────────
    for (let i = 0; i < strikers.length; i++) {
      const s = strikers[i];
      const depth = 1 + s.z / 200; // 0.65 to 1.35
      const baseSize = 1.6 * depth;
      const flashing = t < strikerFlashUntil[i];
      if (flashing) {
        const fade = (strikerFlashUntil[i] - t) / FLASH_DUR;
        const ease = fade * fade * fade;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 12 + ease * 14);
        g.addColorStop(0, `rgba(170,220,255,${ease * 0.7 + 0.3})`);
        g.addColorStop(1, 'rgba(170,220,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 12 + ease * 14, 0, Math.PI * 2);
        ctx.fill();
        // White core
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, baseSize + ease * 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = 'rgba(76,140,255,0.95)';
        ctx.beginPath();
        ctx.arc(s.x, s.y, baseSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── Pools (deep amber-orange, BIG with radial glow halo) ───────────
    for (const pool of pools) {
      const breath = 0.92 + 0.10 * Math.sin(t / 1200 + pool.breathPhase);
      const size = 6.5 * breath;
      // Outer glow halo
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(pool.x, pool.y, 0, pool.x, pool.y, size * 4);
      g.addColorStop(0, 'rgba(255,166,51,0.30)');
      g.addColorStop(1, 'rgba(255,166,51,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, size * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Solid amber body
      ctx.fillStyle = 'rgba(255,166,51,1)';
      ctx.beginPath();
      ctx.arc(pool.x, pool.y, size, 0, Math.PI * 2);
      ctx.fill();
      // Highlight
      ctx.fillStyle = 'rgba(255,220,150,0.7)';
      ctx.beginPath();
      ctx.arc(pool.x - 1.5, pool.y - 1.5, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function destroy() {
    pools = null;
    strikers = null;
    plasmaBolts = [];
    strikerFlashUntil = null;
  }

  return {
    isReady() { return true; },
    update,
    destroy,
    // Interaction stubs — 2D constellation is non-interactive. Drag-rotate
    // and pinch-zoom would not change anything visible since this is a flat
    // 2D layout, so the methods just no-op rather than throw.
    addRotation() {},
    multiplyZoom() {},
    resetView() {},
  };
}
