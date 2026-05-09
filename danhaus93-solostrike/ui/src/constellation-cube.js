// SoloStrike Block Constellation — 2D canvas renderer (v1.11.0).
//
// Same surface area as constellation-2d.js (createXxx returns
// { update, destroy, addRotation, multiplyZoom, resetView, isReady,
//   pingInteraction, focusPeer (new), getPoolScreenPositions }) so it can
// be used as a drop-in for the existing Striker Constellation. App.jsx
// chooses between the two based on pulseAnim setting:
//   pulseAnim === 'constellation' → existing flat 2D renderer (rev70y)
//   pulseAnim === 'block'         → THIS renderer (cubes forming a block)
//
// Visual concept: peers and workers render as small 3D cubes (isometric
// projection w/ rotating Y axis). As Pulse adoption grows, the peer
// positions form progressively larger structures matching a Bitcoin block:
//   1-2 peers   → bar (matches today's 2-pool reality)
//   3-8 peers   → cube corners (each peer is one corner)
//   9-20 peers  → corners + edge midpoints
//   21-56 peers → all 12 edges populated
//   57-200      → faces filling
//   201+        → volume densely packed (Borg-cube territory)
//
// User can pinch to zoom 0.5×–10× and tap any cube to smoothly fly the
// camera to it (800ms cubic ease). Bottom-right "◎ Find Me" overlay
// (handled by App.jsx) calls focusPeer(0) to snap to your gold cube.
//
// Color palette matched to icon.svg / splash block:
//   Gold (your fleet — pool 0):
//     #FFE07A top (sky-lit), #D4A437 left (primary), #9B6E19 right (shadow)
//   Bitcoin orange (peers):
//     #FFB350 top, #F7931A left, #B45F0F right (icon.svg primary)
//
// All effect timings match constellation-2d.js so visual rhythm is
// consistent: FLASH_DUR=1000, BOLT_DURATION=500, PACKET_DURATION=700,
// supernova pulse on 1500ms sine cycle.

export function createConstellationCube(canvas, opts = {}) {
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // ─── Effect constants — kept in sync with constellation-2d.js ────────
  const FLASH_DUR = 1000;
  const BOLT_DURATION = 500;
  const PACKET_DURATION = 700;

  // ─── Color palettes ──────────────────────────────────────────────────
  // Gold (your fleet — pool 0). Polished sun-lit gold, distinct from the
  // amber-orange peer palette so you can spot yourself instantly.
  const GOLD_TOP   = [255, 224, 122];
  const GOLD_LEFT  = [212, 164,  55];
  const GOLD_RIGHT = [155, 110,  25];
  const GOLD_DEEP  = [ 80,  55,  10];
  // Bitcoin orange (peers — matches icon.svg).
  const ORANGE_TOP   = [255, 184,  80];
  const ORANGE_LEFT  = [247, 147,  26];
  const ORANGE_RIGHT = [180,  95,  15];
  const ORANGE_DEEP  = [110,  55,   5];
  // Striker idle (blue).
  const STRIKER_TOP   = [120, 175, 255];
  const STRIKER_LEFT  = [ 76, 140, 255];
  const STRIKER_RIGHT = [ 40,  90, 200];
  const STRIKER_DEEP  = [ 20,  50, 130];
  // Striker hot (during share flash).
  const HOT_TOP   = [255, 255, 255];
  const HOT_LEFT  = [255, 245, 200];
  const HOT_RIGHT = [255, 200, 130];
  const HOT_DEEP  = [200, 120,  30];

  // ─── Render state ────────────────────────────────────────────────────
  let dpr = 1;
  let W = 0, H = 0;
  let peers = null;          // [{x, y, z, isOwn, workers, stage}]
  let workers = null;        // [{poolIdx, ax, ay, az, ...}]
  let plasmaBolts = [];
  let energyPackets = [];
  let strikerFlashUntil = null;
  let poolStrikerIndices = [];
  let lastSig = '';
  let lastPeerCount = -1;
  let destroyed = false;

  // ─── Camera ──────────────────────────────────────────────────────────
  // Continuous Y-axis auto-rotation (so user can read 3D structure).
  // User drag adds offset rotation. Zoom is uniform multiplier.
  // Pan offsets the screen origin (used when zoomed in for navigation).
  let autoRotY = 0;
  let userRotX = 0.30;       // initial pitch — looking slightly down
  let userRotY = 0;
  let zoom = 1.0;
  let panX = 0;
  let panY = 0;
  const MIN_ZOOM = 0.5;
  const MAX_ZOOM = 10.0;
  // Smooth-zoom-to-target system. Set by focusPeer(); cleared when complete.
  let cameraTarget = null;

  // ─── Pool screen positions (exposed for App.jsx plasma overlay) ──────
  // App.jsx calls getPoolScreenPositions(W, H) to draw plasma bolts on
  // an overlay canvas. We populate this on every frame after projection.
  let lastProjPeers = [];

  // ─── Cube structure references ───────────────────────────────────────
  const CUBE_CORNERS = [
    {x:-1,y:-1,z:-1}, {x: 1,y:-1,z:-1}, {x: 1,y: 1,z:-1}, {x:-1,y: 1,z:-1},
    {x:-1,y:-1,z: 1}, {x: 1,y:-1,z: 1}, {x: 1,y: 1,z: 1}, {x:-1,y: 1,z: 1},
  ];
  const CUBE_EDGES = [
    [0,1],[1,2],[2,3],[3,0],
    [4,5],[5,6],[6,7],[7,4],
    [0,4],[1,5],[2,6],[3,7],
  ];
  const CUBE_FACES = [
    [0,1,2,3], [4,5,6,7],
    [0,1,5,4], [2,3,7,6],
    [0,3,7,4], [1,2,6,5],
  ];

  // ─── Seeded RNG for deterministic peer placement ─────────────────────
  // Placement is keyed off peer count, so the same network size always
  // produces the same layout — important for stability when you tap on a
  // cube and expect it to stay there as the camera animates.
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

  // ─── Place peers on cube structure (progressive formation) ───────────
  // Pool 0 is always treated as "you" (isOwn=true). Other peers fill the
  // cube shape according to the current peer count's stage.
  function placePeers(n, ownWorkerCount) {
    const r = rng(n * 17);
    const out = [];
    if (n <= 0) return out;

    function rollWorkers() {
      const roll = r();
      return roll < 0.55 ? (1 + Math.floor(r() * 2))
           : roll < 0.85 ? (3 + Math.floor(r() * 3))
           : roll < 0.97 ? (6 + Math.floor(r() * 3))
                          : (9 + Math.floor(r() * 4));
    }

    // Stage 1 — 1-2 peers: bar layout (matches today's 2-pool reality)
    if (n <= 2) {
      out.push({ x: -0.4, y: 0, z: 0, isOwn: true,  workers: ownWorkerCount, stage: 'bar' });
      if (n === 2) {
        out.push({ x:  0.4, y: 0, z: 0, isOwn: false, workers: rollWorkers(),  stage: 'bar' });
      }
      return out;
    }

    // Stage 2 — 3-8 peers: cube corners (each peer is one corner)
    if (n <= 8) {
      out.push({ ...CUBE_CORNERS[0], isOwn: true, workers: ownWorkerCount, stage: 'corners' });
      for (let i = 1; i < n; i++) {
        out.push({ ...CUBE_CORNERS[i], isOwn: false, workers: rollWorkers(), stage: 'corners' });
      }
      return out;
    }

    // Stage 3 — 9-20 peers: corners + edge midpoints
    if (n <= 20) {
      out.push({ ...CUBE_CORNERS[0], isOwn: true, workers: ownWorkerCount, stage: 'edges-light' });
      for (let i = 1; i < 8 && out.length < n; i++) {
        out.push({ ...CUBE_CORNERS[i], isOwn: false, workers: rollWorkers(), stage: 'edges-light' });
      }
      let edgeIdx = 0;
      while (out.length < n && edgeIdx < CUBE_EDGES.length) {
        const [a, b] = CUBE_EDGES[edgeIdx];
        const ca = CUBE_CORNERS[a], cb = CUBE_CORNERS[b];
        out.push({
          x: (ca.x + cb.x) / 2,
          y: (ca.y + cb.y) / 2,
          z: (ca.z + cb.z) / 2,
          isOwn: false, workers: rollWorkers(), stage: 'edges-light',
        });
        edgeIdx++;
      }
      return out;
    }

    // Stage 4 — 21-56 peers: all 12 edges fully populated
    if (n <= 56) {
      out.push({ ...CUBE_CORNERS[0], isOwn: true, workers: ownWorkerCount, stage: 'edges-full' });
      for (let i = 1; i < 8 && out.length < n; i++) {
        out.push({ ...CUBE_CORNERS[i], isOwn: false, workers: rollWorkers(), stage: 'edges-full' });
      }
      const remaining = n - out.length;
      const pointsPerEdge = Math.ceil(remaining / 12);
      for (let e = 0; e < 12 && out.length < n; e++) {
        const [a, b] = CUBE_EDGES[e];
        const ca = CUBE_CORNERS[a], cb = CUBE_CORNERS[b];
        for (let p = 1; p <= pointsPerEdge && out.length < n; p++) {
          const t = p / (pointsPerEdge + 1);
          out.push({
            x: ca.x + (cb.x - ca.x) * t,
            y: ca.y + (cb.y - ca.y) * t,
            z: ca.z + (cb.z - ca.z) * t,
            isOwn: false, workers: rollWorkers(), stage: 'edges-full',
          });
        }
      }
      return out;
    }

    // Stage 5 — 57-200 peers: face panels filling
    if (n <= 200) {
      out.push({ ...CUBE_CORNERS[0], isOwn: true, workers: ownWorkerCount, stage: 'faces' });
      for (let i = 1; i < 8; i++) {
        out.push({ ...CUBE_CORNERS[i], isOwn: false, workers: rollWorkers(), stage: 'faces' });
      }
      // Dense edges (4 per edge)
      for (let e = 0; e < 12; e++) {
        const [a, b] = CUBE_EDGES[e];
        const ca = CUBE_CORNERS[a], cb = CUBE_CORNERS[b];
        for (let p = 1; p <= 4; p++) {
          const t = p / 5;
          out.push({
            x: ca.x + (cb.x - ca.x) * t,
            y: ca.y + (cb.y - ca.y) * t,
            z: ca.z + (cb.z - ca.z) * t,
            isOwn: false, workers: rollWorkers(), stage: 'faces',
          });
        }
      }
      const remaining = n - out.length;
      const perFace = Math.ceil(remaining / 6);
      const gridDim = Math.max(2, Math.ceil(Math.sqrt(perFace)));
      for (let fIdx = 0; fIdx < 6 && out.length < n; fIdx++) {
        const face = CUBE_FACES[fIdx];
        const c0 = CUBE_CORNERS[face[0]];
        const c1 = CUBE_CORNERS[face[1]];
        const c3 = CUBE_CORNERS[face[3]];
        for (let i = 1; i < gridDim; i++) {
          for (let j = 1; j < gridDim; j++) {
            if (out.length >= n) break;
            const ti = i / gridDim;
            const tj = j / gridDim;
            const ux = c1.x - c0.x, uy = c1.y - c0.y, uz = c1.z - c0.z;
            const vx = c3.x - c0.x, vy = c3.y - c0.y, vz = c3.z - c0.z;
            out.push({
              x: c0.x + ux * ti + vx * tj + (r() - 0.5) * 0.05,
              y: c0.y + uy * ti + vy * tj + (r() - 0.5) * 0.05,
              z: c0.z + uz * ti + vz * tj + (r() - 0.5) * 0.05,
              isOwn: false, workers: rollWorkers(), stage: 'faces',
            });
          }
        }
      }
      return out;
    }

    // Stage 6 — 200+ peers: full volume packing
    out.push({ ...CUBE_CORNERS[0], isOwn: true, workers: ownWorkerCount, stage: 'volume' });
    for (let i = 1; i < 8; i++) {
      out.push({ ...CUBE_CORNERS[i], isOwn: false, workers: rollWorkers(), stage: 'volume' });
    }
    const edgeBudget = Math.min(60, Math.floor(n * 0.05));
    const faceBudget = Math.min(360, Math.floor(n * 0.20));
    const volumeBudget = n - 8 - edgeBudget - faceBudget;

    const ePerEdge = Math.ceil(edgeBudget / 12);
    for (let e = 0; e < 12 && out.length < n; e++) {
      const [a, b] = CUBE_EDGES[e];
      const ca = CUBE_CORNERS[a], cb = CUBE_CORNERS[b];
      for (let p = 1; p <= ePerEdge && out.length < n; p++) {
        const t = p / (ePerEdge + 1);
        out.push({
          x: ca.x + (cb.x - ca.x) * t,
          y: ca.y + (cb.y - ca.y) * t,
          z: ca.z + (cb.z - ca.z) * t,
          isOwn: false, workers: rollWorkers(), stage: 'volume',
        });
      }
    }
    const perFace = Math.ceil(faceBudget / 6);
    const gridDim = Math.max(3, Math.ceil(Math.sqrt(perFace)));
    for (let fIdx = 0; fIdx < 6 && out.length < n; fIdx++) {
      const face = CUBE_FACES[fIdx];
      const c0 = CUBE_CORNERS[face[0]];
      const c1 = CUBE_CORNERS[face[1]];
      const c3 = CUBE_CORNERS[face[3]];
      for (let i = 1; i < gridDim; i++) {
        for (let j = 1; j < gridDim; j++) {
          if (out.length >= n) break;
          const ti = i / gridDim;
          const tj = j / gridDim;
          const ux = c1.x - c0.x, uy = c1.y - c0.y, uz = c1.z - c0.z;
          const vx = c3.x - c0.x, vy = c3.y - c0.y, vz = c3.z - c0.z;
          out.push({
            x: c0.x + ux * ti + vx * tj + (r() - 0.5) * 0.04,
            y: c0.y + uy * ti + vy * tj + (r() - 0.5) * 0.04,
            z: c0.z + uz * ti + vz * tj + (r() - 0.5) * 0.04,
            isOwn: false, workers: rollWorkers(), stage: 'volume',
          });
        }
      }
    }
    const volSide = Math.ceil(Math.cbrt(volumeBudget));
    let placed = 0;
    for (let i = 0; i < volSide && out.length < n; i++) {
      for (let j = 0; j < volSide && out.length < n; j++) {
        for (let k = 0; k < volSide && out.length < n; k++) {
          if (placed >= volumeBudget) break;
          const tx = (i + 0.5 + (r() - 0.5) * 0.4) / volSide;
          const ty = (j + 0.5 + (r() - 0.5) * 0.4) / volSide;
          const tz = (k + 0.5 + (r() - 0.5) * 0.4) / volSide;
          out.push({
            x: -0.85 + tx * 1.7,
            y: -0.85 + ty * 1.7,
            z: -0.85 + tz * 1.7,
            isOwn: false, workers: rollWorkers(), stage: 'volume',
          });
          placed++;
        }
      }
    }
    return out;
  }

  // ─── Build worker scatter around each peer ───────────────────────────
  function rebuildScene(poolWorkerCounts) {
    const n = poolWorkerCounts.length;
    const ownCount = poolWorkerCounts[0] | 0;
    peers = placePeers(n, ownCount);

    // Real worker counts override the synthetic ones for ALL pools we
    // received counts for. Pool 0 is always real; others are synthetic
    // unless App.jsx provides actual counts (which it does for both own
    // and peer pools when peer broadcasts include worker counts).
    for (let p = 0; p < peers.length && p < poolWorkerCounts.length; p++) {
      peers[p].workers = poolWorkerCounts[p] | 0;
    }

    workers = [];
    poolStrikerIndices = [];
    if (peers.length === 0) return;
    const r = rng(424242);
    let id = 0;

    // Worker fan-out scales down as peer count grows so they don't
    // overlap their neighbors. Capped at sensible counts past 50 peers.
    // v1.11.1: bumped low-peer-count radii (was 0.18 / 0.10 / 0.07) so
    // energy packets have a longer striker→peer travel arc and the
    // share-flash visuals are more readable. Keeps overlap-prevention
    // ratios intact at higher peer counts.
    // v1.11.2: re-tuned to match the old Striker Constellation (rev70y)
    // which used baseRadius=50 absolute at 2 pools, 42 at 3+. The cube
    // renderer uses normalized world coords scaled by `min(W,H) × 0.30 ×
    // perspective`, so to produce the same screen distance:
    //   2 peers: 50 / (min(W,H) × 0.30) ≈ 0.35 on a typical phone
    //   3-4:     42 / (min(W,H) × 0.30) ≈ 0.29
    //   5-10:    a hair tighter (~0.20) since cube depth foreshortens
    //   >50:     fall to 0.05 — overlap-avoidance dominates at scale
    const baseR = n > 1000 ? 0.020
                : n > 200  ? 0.030
                : n > 50   ? 0.050
                : n > 10   ? 0.20
                : n > 4    ? 0.29
                            : 0.35;
    const maxWorkersShown = n > 1000 ? 1
                          : n > 200  ? 2
                          : n > 50   ? 3
                                      : 14;

    for (let p = 0; p < peers.length; p++) {
      const peer = peers[p];
      poolStrikerIndices.push([]);
      const visibleN = Math.min(peer.workers, maxWorkersShown);
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < visibleN; i++) {
        const y = visibleN === 1 ? 0 : 1 - (i / (visibleN - 1)) * 2;
        const ringR = Math.sqrt(1 - y * y);
        const theta = golden * i;
        const ox = Math.cos(theta) * ringR * baseR;
        const oy = y * baseR;
        const oz = Math.sin(theta) * ringR * baseR;
        workers.push({
          id: id++, poolIdx: p,
          ax: peer.x + ox, ay: peer.y + oy, az: peer.z + oz,
          x: 0, y: 0, z: 0, scale: 1,
          speed: 0.4 + r() * 0.8,
          offset: r() * 1000,
          wobX: 0, wobY: 0, wobZ: 0,
        });
        poolStrikerIndices[p].push(workers.length - 1);
      }
    }
    if (!strikerFlashUntil || strikerFlashUntil.length < workers.length) {
      strikerFlashUntil = new Float32Array(Math.max(workers.length, 256));
    } else {
      for (let i = 0; i < strikerFlashUntil.length; i++) strikerFlashUntil[i] = 0;
    }
    lastPeerCount = n;
  }

  // ─── 3D projection ───────────────────────────────────────────────────
  // Rotates around Y axis (auto-spin + user offset), then around X
  // (user-controlled pitch). Standard perspective divide using camera
  // distance. Returns screen coords + depth + scale factor.
  function project(v) {
    const cosY = Math.cos(autoRotY + userRotY);
    const sinY = Math.sin(autoRotY + userRotY);
    const cosX = Math.cos(userRotX);
    const sinX = Math.sin(userRotX);
    const x1 = v.x * cosY - v.z * sinY;
    const z1 = v.x * sinY + v.z * cosY;
    const y1 = v.y * cosX - z1 * sinX;
    const z2 = v.y * sinX + z1 * cosX;
    const dist = 4.2;
    const persp = 1 / (1 - z2 / dist);
    const screenScale = Math.min(W, H) * 0.30 * zoom;
    return {
      x: W * 0.5 + panX + x1 * screenScale * persp,
      y: H * 0.5 + panY + y1 * screenScale * persp,
      z: z2,
      scale: persp * zoom,
    };
  }

  // ─── Cube primitive ──────────────────────────────────────────────────
  // Draws a small isometric 3D cube at (cx, cy) on screen, with world-
  // space size 'size'. The cube has 6 faces; we depth-sort and render
  // back-to-front. Three faces are visible at any time (top, front-left,
  // front-right) given the fixed tilt + Y rotation. Top face uses palette
  // 'top' (lit/sun side), front-right uses 'left' (primary), back/right
  // use 'right' (shadow). Outline drawn in 'deep' for face definition.
  function drawCube(cx, cy, size, rotY, palette) {
    const tiltX = 0.45;
    const cosT = Math.cos(tiltX), sinT = Math.sin(tiltX);
    const cosR = Math.cos(rotY), sinR = Math.sin(rotY);
    const s = size;
    const localVerts = [
      {x:-s, y:-s, z:-s}, {x: s, y:-s, z:-s},
      {x: s, y: s, z:-s}, {x:-s, y: s, z:-s},
      {x:-s, y:-s, z: s}, {x: s, y:-s, z: s},
      {x: s, y: s, z: s}, {x:-s, y: s, z: s},
    ];
    const proj = localVerts.map(v => {
      const x1 = v.x * cosR - v.z * sinR;
      const z1 = v.x * sinR + v.z * cosR;
      const y1 = v.y * cosT - z1 * sinT;
      const z2 = v.y * sinT + z1 * cosT;
      return { x: cx + x1, y: cy + y1, z: z2 };
    });
    const faces = [
      { vs: [4,5,6,7], pal: 'front' },
      { vs: [1,0,3,2], pal: 'back'  },
      { vs: [0,4,7,3], pal: 'left'  },
      { vs: [5,1,2,6], pal: 'right' },
      { vs: [3,7,6,2], pal: 'top'   },
      { vs: [0,1,5,4], pal: 'bottom'},
    ];
    const faceData = faces.map(f => ({
      f, avgZ: f.vs.reduce((s, vi) => s + proj[vi].z, 0) / 4,
    })).sort((a, b) => a.avgZ - b.avgZ);

    function colorFor(name) {
      if (name === 'top') return palette.top;
      if (name === 'bottom') return palette.deep;
      if (name === 'front' || name === 'right') return palette.left;
      if (name === 'left' || name === 'back') return palette.right;
      return palette.left;
    }

    for (const {f} of faceData) {
      const c = colorFor(f.pal);
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.beginPath();
      for (let i = 0; i < f.vs.length; i++) {
        const p = proj[f.vs[i]];
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(${palette.deep[0]},${palette.deep[1]},${palette.deep[2]},0.5)`;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }

  // ─── Jagged path (matches constellation-2d.js makeJaggedPath) ────────
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

  // ─── Pick a target peer for a plasma bolt ────────────────────────────
  function pickBoltTarget(fromIdx) {
    if (!peers || peers.length < 2) return -1;
    let t;
    let attempts = 0;
    do {
      t = Math.floor(Math.random() * peers.length);
      attempts++;
    } while (t === fromIdx && attempts < 8);
    return t === fromIdx ? -1 : t;
  }

  // ─── Camera animation (smooth zoom-to-target) ────────────────────────
  function updateCamera() {
    if (!cameraTarget) return;
    const now = performance.now();
    const t = Math.min(1, (now - cameraTarget.startTime) / cameraTarget.duration);
    // Cubic ease-in-out
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const peer = peers && peers[cameraTarget.focusPeer];
    if (!peer) { cameraTarget = null; return; }

    // Project the target peer at the current rotation but zoom=1, pan=0,
    // to find its base screen position. Then compute the pan needed so
    // that at the target zoom level, the peer ends up at canvas center.
    const savedZoom = zoom, savedPanX = panX, savedPanY = panY;
    zoom = 1; panX = 0; panY = 0;
    const screenP = project(peer);
    zoom = savedZoom; panX = savedPanX; panY = savedPanY;

    const targetZoom = cameraTarget.targetZoom || 4.0;
    const offsetX = screenP.x - W * 0.5;
    const offsetY = screenP.y - H * 0.5;
    const targetPanX = -offsetX * targetZoom;
    const targetPanY = -offsetY * targetZoom;

    zoom = cameraTarget.startZoom + (targetZoom - cameraTarget.startZoom) * ease;
    panX = cameraTarget.startPanX + (targetPanX - cameraTarget.startPanX) * ease;
    panY = cameraTarget.startPanY + (targetPanY - cameraTarget.startPanY) * ease;

    if (t >= 1) cameraTarget = null;
  }

  function startZoomTo(peerIdx, targetZoom = 4.0) {
    if (!peers || peerIdx < 0 || peerIdx >= peers.length) return;
    cameraTarget = {
      focusPeer: peerIdx,
      progress: 0,
      duration: 800,
      targetZoom,
      startZoom: zoom,
      startPanX: panX,
      startPanY: panY,
      startTime: performance.now(),
    };
  }

  // ─── Main update loop (called every frame from App.jsx) ──────────────
  function update({
    dpr: dprIn,
    width,
    height,
    poolWorkers,
    dt,
    flashPoolIndices,
    flashStrikerEvents,
    ownPoolIdx = 0,
  }) {
    if (destroyed) return;
    if (!poolWorkers || poolWorkers.length === 0) return;

    // Resize canvas backing store to match CSS pixel dimensions × dpr
    dpr = dprIn || 1;
    if (width !== W || height !== H) {
      W = width; H = height;
      lastSig = '';
    }
    const wantW = Math.floor(W * dpr);
    const wantH = Math.floor(H * dpr);
    if (canvas.width !== wantW) canvas.width = wantW;
    if (canvas.height !== wantH) canvas.height = wantH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Rebuild scene if peer count or dimensions changed
    const sig = poolWorkers.length + '|' + W + 'x' + H + '|' + (poolWorkers[0] || 0);
    if (sig !== lastSig) {
      lastSig = sig;
      rebuildScene(poolWorkers);
    }
    if (!peers || peers.length === 0) return;

    // v1.11.1: auto-rotation disabled by user request — block is stationary
    // and the user drags to rotate. Previous behavior spun on the Y axis at
    // 0.20 rad/s slowed by zoom. The auto-spin made it feel "alive" but
    // also made it harder to find/track a specific peer cube. With manual
    // drag the user can park the cube at any angle and it stays put.
    // autoRotY += dt * (0.20 / Math.max(1, zoom * 0.5));
    updateCamera();

    const t = performance.now();

    // ─── Process incoming events ───────────────────────────────────────
    if (Array.isArray(flashStrikerEvents)) {
      for (const evt of flashStrikerEvents) {
        if (!evt || typeof evt.poolIdx !== 'number') continue;
        const indices = poolStrikerIndices[evt.poolIdx];
        if (!indices || evt.strikerIdx >= indices.length) continue;
        const realIdx = indices[evt.strikerIdx | 0];
        if (realIdx == null || realIdx >= strikerFlashUntil.length) continue;
        strikerFlashUntil[realIdx] = t + FLASH_DUR;
        if (peers.length < 1000) {
          energyPackets.push({ strikerIdx: realIdx, poolIdx: evt.poolIdx, start: t });
        }
        if (peers.length < 500) {
          const toIdx = pickBoltTarget(evt.poolIdx);
          if (toIdx >= 0) plasmaBolts.push({ fromIdx: evt.poolIdx, toIdx, start: t, duration: BOLT_DURATION });
        }
      }
    }
    if (Array.isArray(flashPoolIndices)) {
      for (const poolIdx of flashPoolIndices) {
        if (typeof poolIdx !== 'number') continue;
        const indices = poolStrikerIndices[poolIdx];
        if (!indices || indices.length === 0) continue;
        const picked = indices[Math.floor(Math.random() * indices.length)];
        if (picked == null || picked >= strikerFlashUntil.length) continue;
        strikerFlashUntil[picked] = t + FLASH_DUR;
        if (peers.length < 500) {
          energyPackets.push({ strikerIdx: picked, poolIdx, start: t });
          const toIdx = pickBoltTarget(poolIdx);
          if (toIdx >= 0) plasmaBolts.push({ fromIdx: poolIdx, toIdx, start: t, duration: BOLT_DURATION });
        }
      }
    }

    // Animate worker wobble
    for (const wkr of workers) {
      const phase = (t / 1000) * wkr.speed + wkr.offset;
      wkr.wobX = Math.cos(phase) * 0.008;
      wkr.wobY = Math.sin(phase * 1.3) * 0.008;
      wkr.wobZ = Math.cos(phase * 0.7) * 0.008;
    }

    ctx.clearRect(0, 0, W, H);

    // ─── Project all entities ──────────────────────────────────────────
    const projPeers = peers.map((p, i) => ({...project(p), peer: p, idx: i}));
    lastProjPeers = projPeers;
    const projWorkers = workers.map((wkr, i) => {
      const p = project({
        x: wkr.ax + (wkr.wobX || 0),
        y: wkr.ay + (wkr.wobY || 0),
        z: wkr.az + (wkr.wobZ || 0),
      });
      wkr.x = p.x; wkr.y = p.y; wkr.z = p.z; wkr.scale = p.scale;
      return { ...p, wkr, idx: i };
    });

    // ─── Striker → peer amber lines ─────────────────────────────────────
    if (peers.length < 500) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(212,164,55,0.25)';
      ctx.lineWidth = 0.5;
      for (const wkr of workers) {
        const peerProj = projPeers[wkr.poolIdx];
        if (!peerProj) continue;
        ctx.beginPath();
        ctx.moveTo(peerProj.x, peerProj.y);
        ctx.lineTo(wkr.x, wkr.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ─── Inter-peer mesh lines (only at low peer counts) ───────────────
    if (peers.length <= 8) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(71,82,97,0.45)';
      ctx.lineWidth = 0.7;
      for (let i = 0; i < projPeers.length; i++) {
        for (let j = i + 1; j < projPeers.length; j++) {
          ctx.beginPath();
          ctx.moveTo(projPeers[i].x, projPeers[i].y);
          ctx.lineTo(projPeers[j].x, projPeers[j].y);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // ─── Combined depth-sorted render queue ────────────────────────────
    const renderQueue = [
      ...projPeers.map(p => ({type:'peer', z: p.z, ...p})),
      ...projWorkers.map(w => ({type:'worker', z: w.z, ...w})),
    ];
    renderQueue.sort((a, b) => a.z - b.z);

    // Supernova pulse (matches constellation-2d.js timing)
    const pulsePhase = (t / 1500) % 1;
    const pulseEase = 0.5 - 0.5 * Math.cos(pulsePhase * Math.PI * 2);
    const pulseSizeMult = 1 + pulseEase * 0.30;
    const pulseBrightMult = 1 + pulseEase * 0.50;

    // Cube sizes — smaller than v2 mockup, scale down past 50 peers
    const peerCubeBase = peers.length > 1000 ? 3.0
                      : peers.length > 200  ? 4.0
                      : peers.length > 50   ? 5.0
                      : peers.length > 10   ? 6.0
                                             : 7.0;
    const strikerCubeBase = peers.length > 1000 ? 1.0
                         : peers.length > 200  ? 1.4
                         : peers.length > 50   ? 1.8
                                                : 2.2;

    for (const item of renderQueue) {
      if (item.type === 'peer') {
        const peer = item.peer;
        const isOwn = peer.isOwn;

        const palette = isOwn
          ? { top: GOLD_TOP, left: GOLD_LEFT, right: GOLD_RIGHT, deep: GOLD_DEEP }
          : { top: ORANGE_TOP, left: ORANGE_LEFT, right: ORANGE_RIGHT, deep: ORANGE_DEEP };

        // Brighten faces during supernova pulse peak
        const bright = (c) => [
          Math.min(255, c[0] + pulseEase * 30),
          Math.min(255, c[1] + pulseEase * 25),
          Math.min(255, c[2] + pulseEase * 15),
        ];
        const pulsed = {
          top: bright(palette.top),
          left: bright(palette.left),
          right: bright(palette.right),
          deep: palette.deep,
        };

        const cubeSize = peerCubeBase * pulseSizeMult * Math.sqrt(item.scale);

        // Halo glow (matches constellation-2d.js: radius × 5, additive)
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const haloR = cubeSize * 5;
        const haloColor = isOwn ? [255, 220, 110] : [247, 147, 26];
        const g = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, haloR);
        g.addColorStop(0, `rgba(${haloColor[0]},${haloColor[1]},${haloColor[2]},${0.30 * pulseBrightMult})`);
        g.addColorStop(0.5, `rgba(${haloColor[0]},${haloColor[1]},${haloColor[2]},${0.12 * pulseBrightMult})`);
        g.addColorStop(1, `rgba(${haloColor[0]},${haloColor[1]},${haloColor[2]},0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(item.x, item.y, haloR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        drawCube(item.x, item.y, cubeSize, autoRotY + userRotY, pulsed);
      } else {
        const wkr = item.wkr;
        const flashing = item.idx < strikerFlashUntil.length && t < strikerFlashUntil[item.idx];
        // Workers render as lit spheres (style C) instead of cubes. Peer
        // cubes still render as cubes — only the workers changed. The
        // sphere is drawn with a radial gradient (highlight upper-left,
        // shadow lower-right) for a 3D pearl look without the visual
        // weight of a rotating cube primitive. Sphere radius matches the
        // old Striker Constellation dot (≈1.6px at base scale × 1.4 to
        // give it a touch more presence vs the flat dot).
        const dotSize = (strikerCubeBase * 1.4) * Math.sqrt(item.scale || 1);

        if (flashing) {
          const fade = (strikerFlashUntil[item.idx] - t) / FLASH_DUR;
          const ease = fade * fade * fade;
          // Hot halo (white-amber decay)
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          const haloR = 7 + ease * 9;
          const g = ctx.createRadialGradient(item.x, item.y, 0, item.x, item.y, haloR);
          g.addColorStop(0, `rgba(255,240,180,${ease * 0.5 + 0.2})`);
          g.addColorStop(1, 'rgba(255,240,180,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(item.x, item.y, haloR, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          // Hot lit-sphere body (white core → hot-amber → deep-amber edge)
          const r = dotSize * (1 + ease * 0.5);
          const sg = ctx.createRadialGradient(
            item.x - r * 0.4, item.y - r * 0.4, 0,
            item.x, item.y, r * 1.2
          );
          sg.addColorStop(0,   'rgba(255,255,255,1)');
          sg.addColorStop(0.4, 'rgba(255,235,170,1)');
          sg.addColorStop(1,   'rgba(200,120, 30,1)');
          ctx.fillStyle = sg;
          ctx.beginPath();
          ctx.arc(item.x, item.y, r, 0, Math.PI * 2);
          ctx.fill();
        } else {
          // Idle blue lit-sphere (highlight upper-left → striker-blue
          // mid → deep-navy edge). No rotation — light always falls from
          // upper-left so all sphere shading reads consistent regardless
          // of cube rotation.
          const r = dotSize;
          const sg = ctx.createRadialGradient(
            item.x - r * 0.4, item.y - r * 0.4, 0,
            item.x, item.y, r * 1.2
          );
          sg.addColorStop(0,   'rgba(180,210,255,1)');
          sg.addColorStop(0.4, 'rgba( 76,140,255,1)');
          sg.addColorStop(1,   'rgba( 20, 50,130,1)');
          ctx.fillStyle = sg;
          ctx.beginPath();
          ctx.arc(item.x, item.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // ─── Plasma bolts ──────────────────────────────────────────────────
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = plasmaBolts.length - 1; i >= 0; i--) {
      const b = plasmaBolts[i];
      const age = (t - b.start) / b.duration;
      if (age >= 1) { plasmaBolts.splice(i, 1); continue; }
      const alpha = Math.min(1, (1 - age) * 1.4);
      const fromV = projPeers[b.fromIdx];
      const toV = projPeers[b.toIdx];
      if (!fromV || !toV) { plasmaBolts.splice(i, 1); continue; }
      const segs = makeJaggedPath(fromV.x, fromV.y, toV.x, toV.y, 14, 4);
      // Warm-amber bolt to match BTC palette (vs constellation-2d.js's blue)
      ctx.strokeStyle = `rgba(255,200,130,${alpha * 0.85})`;
      ctx.lineWidth = 3.0;
      ctx.beginPath();
      for (let j = 0; j < segs.length; j += 2) {
        if (j === 0) ctx.moveTo(segs[j].x, segs[j].y);
        ctx.lineTo(segs[j + 1].x, segs[j + 1].y);
      }
      ctx.stroke();
      ctx.strokeStyle = `rgba(255,255,235,${alpha * 0.95})`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let j = 0; j < segs.length; j += 2) {
        if (j === 0) ctx.moveTo(segs[j].x, segs[j].y);
        ctx.lineTo(segs[j + 1].x, segs[j + 1].y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // ─── Energy packets (cyan striker → peer travelers) ────────────────
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = energyPackets.length - 1; i >= 0; i--) {
      const p = energyPackets[i];
      const age = (t - p.start) / PACKET_DURATION;
      if (age >= 1) { energyPackets.splice(i, 1); continue; }
      const wkr = workers[p.strikerIdx];
      const peerProj = projPeers[p.poolIdx];
      if (!wkr || !peerProj) { energyPackets.splice(i, 1); continue; }
      const x = wkr.x + (peerProj.x - wkr.x) * age;
      const y = wkr.y + (peerProj.y - wkr.y) * age;
      const haloR = 7;
      const g = ctx.createRadialGradient(x, y, 0, x, y, haloR);
      g.addColorStop(0, 'rgba(0,255,209,0.65)');
      g.addColorStop(1, 'rgba(0,255,209,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, haloR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(x, y, 2.0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function destroy() {
    destroyed = true;
    peers = null;
    workers = null;
    plasmaBolts = [];
    energyPackets = [];
    strikerFlashUntil = null;
    poolStrikerIndices = [];
    lastProjPeers = [];
  }

  // ─── Public API (matches constellation-2d.js shape) ──────────────────
  return {
    isReady() { return !destroyed; },
    update,
    destroy,

    // When zoomed out, drag rotates the cube; when zoomed in (>1.5×),
    // drag pans the camera so user can navigate the dense block.
    addRotation(dxPx, dyPx) {
      const dx = dxPx || 0;
      const dy = dyPx || 0;
      if (zoom > 1.5) {
        panX += dx;
        panY += dy;
      } else {
        userRotY += dx * 0.01;
        userRotX += dy * 0.01;
      }
    },
    multiplyZoom(factor) {
      const f = factor || 1;
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * f));
    },
    resetView() {
      panX = 0; panY = 0; zoom = 1.0;
      userRotX = 0.30; userRotY = 0;
      cameraTarget = null;
    },
    pingInteraction() {},

    // ─── New methods specific to this renderer ─────────────────────────
    // Smoothly fly the camera to a specific peer index (800ms cubic ease).
    // Used by the "◎ Find Me" overlay (focusPeer(0) = your gold cube)
    // and by tap-to-focus interaction.
    focusPeer(peerIdx, targetZoom) {
      startZoomTo(peerIdx | 0, targetZoom || 4.0);
    },

    // Hit-test a screen-space point against peer cubes. Returns the index
    // of the closest peer within `radiusPx` of the tap, or -1 if no hit.
    // Used by App.jsx tap handler to drive focus-on-tap.
    hitTestPeer(screenX, screenY, radiusPx = 30) {
      if (!lastProjPeers || lastProjPeers.length === 0) return -1;
      let best = -1;
      let bestDist = radiusPx * radiusPx;
      for (let i = 0; i < lastProjPeers.length; i++) {
        const p = lastProjPeers[i];
        const dx = p.x - screenX;
        const dy = p.y - screenY;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist) { best = i; bestDist = d2; }
      }
      return best;
    },

    // Provide pool screen positions (used by App.jsx plasma bolt overlay).
    getPoolScreenPositions(_W, _H) {
      // We already have projected positions from the last frame.
      return lastProjPeers.map(p => ({ x: p.x, y: p.y }));
    },

    // Read current zoom level (used by App.jsx for "Find Me" visibility logic).
    getZoom() { return zoom; },
  };
}
