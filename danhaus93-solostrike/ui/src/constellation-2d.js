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
  // rev71L: energy packets — small glowing dots that travel from striker
  // to pool when that striker submits a share. Each entry:
  //   { strikerIdx, poolIdx, start } — endpoint positions resolved per
  //   frame from current striker/pool positions (so packets follow
  //   striker drift over their travel time). Duration: 700ms.
  let energyPackets = [];
  const PACKET_DURATION = 700;
  let lastSig = '';
  let tAccum = 0;
  let strikerFlashUntil = null; // Float32Array per striker
  // rev71h: per-pool striker-index buckets. Built in rebuildScene; used to
  // pick a random striker on each flash event.
  let poolStrikerIndices = [];

  // rev71c: pan + zoom state for drag/pinch interaction. Rotation isn't
  // meaningful for a 2D layout, so `addRotation` is reinterpreted as pan.
  let panX = 0, panY = 0;
  let zoom = 1.0;
  const MIN_ZOOM = 0.5, MAX_ZOOM = 4.0;

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
      // rev71c: tighter pool→striker radius (was 70/60 → 50/42).
      const baseRadius = totalPools === 2 ? 50 : 42;
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
    // rev71h: index of striker indices per pool. Used to pick ONE random
    // striker per share-flash event so individual miners light up
    // sequentially rather than the whole pool at once.
    poolStrikerIndices = [];
    for (let p = 0; p < pools.length; p++) poolStrikerIndices.push([]);
    for (let i = 0; i < strikers.length; i++) {
      poolStrikerIndices[strikers[i].poolIdx].push(i);
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

  function update({ dpr: dprIn, width, height, poolWorkers, dt, flashPoolIndices, flashStrikerEvents, ownPoolIdx = -1 }) {
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
    // rev71h: each share submission flashes ONE random striker (a single
    // miner), not the whole pool. With multiple flashes queued per second
    // (own pool burst, peer Poisson synthesis), strikers light up in a
    // staggered swarm — much more "alive" than a unified pool blink.
    // rev71i: flashStrikerEvents path is the 1:1 per-worker mapping for
    // our own pool. flashPoolIndices stays for peer synthesis (which has
    // no worker IDs in the broadcast, so random pick is the best we have).
    if (Array.isArray(flashStrikerEvents) && flashStrikerEvents.length > 0) {
      for (const evt of flashStrikerEvents) {
        if (!evt) continue;
        const poolIdx = evt.poolIdx | 0;
        const strikerIdx = evt.strikerIdx | 0;
        if (poolIdx < 0 || poolIdx >= totalPools) continue;
        const indices = poolStrikerIndices[poolIdx];
        if (!indices || strikerIdx < 0 || strikerIdx >= indices.length) continue;
        const realIdx = indices[strikerIdx];
        strikerFlashUntil[realIdx] = t + FLASH_DUR;
        // rev71L: spawn an energy packet from this striker to its pool
        energyPackets.push({ strikerIdx: realIdx, poolIdx, start: t });
        // Plasma bolt on each event (real network share)
        if (totalPools >= 2) {
          const toIdx = (poolIdx + 1) % totalPools;
          plasmaBolts.push({
            fromIdx: poolIdx,
            toIdx,
            start: t,
            duration: BOLT_DURATION,
          });
        }
      }
    }
    if (Array.isArray(flashPoolIndices) && flashPoolIndices.length > 0) {
      for (const poolIdx of flashPoolIndices) {
        if (poolIdx < 0 || poolIdx >= totalPools) continue;
        // Pick one random striker in this pool (peer synthesis path)
        const indices = poolStrikerIndices[poolIdx];
        if (indices && indices.length > 0) {
          const picked = indices[Math.floor(Math.random() * indices.length)];
          strikerFlashUntil[picked] = t + FLASH_DUR;
          // rev71L: energy packet from this random striker to its pool
          energyPackets.push({ strikerIdx: picked, poolIdx, start: t });
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

    // rev71c: apply pan/zoom for the SCENE only. Clear stays in CSS pixel
    // space so it always covers the full canvas. Zoom centers on canvas
    // center; pan is in CSS pixels.
    if (zoom !== 1.0 || panX !== 0 || panY !== 0) {
      const cx = W / 2, cy = H / 2;
      ctx.translate(cx + panX, cy + panY);
      ctx.scale(zoom, zoom);
      ctx.translate(-cx, -cy);
    }

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

    // ── Energy packets (rev71L) ────────────────────────────────────────
    // Glowing white-core dot with cyan halo travels striker → pool over
    // 700ms. Endpoints resolve per-frame from current striker/pool
    // positions so the packet tracks subtle striker wobble.
    // Drawn AFTER plasma bolts and BEFORE strikers so the striker's
    // arrival flash visually overlaps the packet hitting the pool.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = energyPackets.length - 1; i >= 0; i--) {
      const p = energyPackets[i];
      const age = (t - p.start) / PACKET_DURATION;
      if (age >= 1) { energyPackets.splice(i, 1); continue; }
      const s = strikers[p.strikerIdx];
      const pool = pools[p.poolIdx];
      if (!s || !pool) { energyPackets.splice(i, 1); continue; }
      const fromX = s.x, fromY = s.y;
      const toX = pool.x, toY = pool.y;
      const x = fromX + (toX - fromX) * age;
      const y = fromY + (toY - fromY) * age;
      // Cyan halo (matches preview variant 6 exactly)
      const haloR = 8;
      const g = ctx.createRadialGradient(x, y, 0, x, y, haloR);
      g.addColorStop(0, 'rgba(0,255,209,0.55)');
      g.addColorStop(1, 'rgba(0,255,209,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, haloR, 0, Math.PI * 2);
      ctx.fill();
      // White core
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
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
        // rev71f: halo toned down from earlier rev (radius 12+14 → 7+9,
        // peak alpha 1.0 → 0.55) so flashing strikers don't dominate the
        // panel. White core kept at full intensity — that's the focal hit.
        const haloR = 7 + ease * 9;
        ctx.beginPath();
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
        g.addColorStop(0, `rgba(170,220,255,${ease * 0.4 + 0.15})`);
        g.addColorStop(1, 'rgba(170,220,255,0)');
        ctx.fillStyle = g;
        ctx.arc(s.x, s.y, haloR, 0, Math.PI * 2);
        ctx.fill();
        // White core (unchanged — this is the actual visible "hit")
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
    // rev71j: own pool gets a cyan accent ring at the outer halo edge.
    // Cyan already lives in this palette (striker flash core), so it
    // stays in-family without clashing.
    for (let pi = 0; pi < pools.length; pi++) {
      const pool = pools[pi];
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
      // rev71j: cyan accent ring marking the own pool
      if (pi === ownPoolIdx) {
        const ringR = size * 2.4;
        const ringPulse = 0.8 + 0.2 * Math.sin(t / 600);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = `rgba(0,255,209,${0.55 * ringPulse})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(pool.x, pool.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
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
    // rev71c: real interaction handlers. App.jsx routes pointer/wheel
    // events to these names (same names as the WebGL constellation API).
    // For 2D, rotation is meaningless, so `addRotation(dx, dy)` is
    // reinterpreted as pan in CSS pixels.
    // rev71g: camera-style pan. Drag right → camera looks right → scene
    // appears to move LEFT (opposite of finger). Was grab-style (panX += dx)
    // in rev71f which felt inverted. Sign flipped to subtract.
    addRotation(dxPx, dyPx) {
      panX -= (dxPx || 0);
      panY -= (dyPx || 0);
    },
    multiplyZoom(factor) {
      const f = factor || 1;
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * f));
    },
    resetView() {
      panX = 0; panY = 0; zoom = 1.0;
    },
    // rev71e: no-op stub. The WebGL constellation used pingInteraction to
    // pause auto-rotation on user input. The 2D renderer has no auto-rotate,
    // so this just exists to satisfy callers that expect the method.
    pingInteraction() {},
  };
}
