// ── best-diff.js (v3.7.0) ───────────────────────────────────────────────────
//
//   Pulse "Best Diff" leaderboard — local tracking + network hygiene.
//
//   Ranks the highest-difficulty ACCEPTED share each Pulse pool has ever
//   submitted. Three responsibilities, all small:
//
//   1. record(sdiff)     — called by share-watcher on every accepted share.
//                          Keeps the pool-wide all-time best WITH a timestamp
//                          (shareCounters.bestSinceReset has the value but not
//                          when it was struck). Persists via state so restarts
//                          don't zero it.
//   2. forBroadcast()    — the { d, ts } object network-stats spreads into the
//                          Pulse census event. Values come straight from the
//                          sharelog-fed tracker — never from client input — so
//                          our own broadcast is honest by construction. Bounds
//                          are re-clamped here as belt-and-suspenders.
//   3. sanitizeInbound() — validation for a peer's claimed bd. Same defensive
//                          posture as the benchmark validator: shape-check,
//                          range-clamp, timestamp sanity. mergePeer() keeps
//                          the max ever seen per peer (monotonic), so a replay
//                          of an old lower value can never regress a record.
//
//   Windows (24H / 7D / ALL-TIME) need no extra fields: peers broadcast the
//   all-time best plus WHEN it was struck, and the UI filters by ts. "Best
//   diff struck in the last 24h" is exactly the right semantics.
//
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Hard ceiling for a plausible share diff. Network difficulty is ~1.2e14 in
// mid-2026; 1e16 leaves two orders of headroom for years of growth while
// still rejecting absurd forged values (1e300 etc). A share at network diff
// is a BLOCK and shows up in lastStrike anyway.
const MAX_PLAUSIBLE_DIFF = 1e16;

// Nothing before SoloStrike existed can be a legitimate strike timestamp.
const MIN_TS = 1704067200; // 2024-01-01T00:00:00Z (epoch seconds)

// Allow modest clock skew between a peer's share clock and the nostr
// event's created_at when validating "struck before broadcast".
const TS_SKEW_S = 300;

let _singleton = null;

function createBestDiffTracker({ state, savePersist }) {
  // Persisted shape: state.bestDiffPulse = { d: <number>, ts: <epoch s> }
  if (!state.bestDiffPulse || typeof state.bestDiffPulse !== 'object') {
    state.bestDiffPulse = { d: 0, ts: 0 };
  }
  // Heal a partially-corrupt persist without nuking a valid record.
  if (!Number.isFinite(state.bestDiffPulse.d) || state.bestDiffPulse.d < 0) {
    state.bestDiffPulse.d = 0;
  }
  if (!Number.isFinite(state.bestDiffPulse.ts) || state.bestDiffPulse.ts < 0) {
    state.bestDiffPulse.ts = 0;
  }

  // Bootstrap from shareCounters on first run after upgrade, so pools with an
  // existing Best Difficulty card value start ranked instead of at zero.
  // Timestamp is unknown for the historical value — use firstSeen of the
  // worker that holds it (closest honest lower bound we have).
  try {
    let seedD = 0, seedTs = 0;
    for (const c of Object.values(state.shareCounters || {})) {
      const v = Number(c && c.bestSinceReset);
      if (Number.isFinite(v) && v > seedD) {
        seedD = v;
        const fs = Number(c.firstSeen);
        seedTs = Number.isFinite(fs) && fs > 0 ? Math.floor(fs / 1000) : 0;
      }
    }
    if (seedD > state.bestDiffPulse.d) {
      state.bestDiffPulse = { d: seedD, ts: seedTs || Math.floor(Date.now() / 1000) };
    }
  } catch (_) { /* seed is best-effort; never block boot */ }

  let dirty = false;
  // Coalesce persist writes: a hot pool sees thousands of shares/min and
  // savePersist() must not run per-share. New records are rare after warmup.
  const flush = () => {
    if (!dirty) return;
    dirty = false;
    try { if (typeof savePersist === 'function') savePersist(); } catch (_) {}
  };
  const flushTimer = setInterval(flush, 30000);
  if (flushTimer.unref) flushTimer.unref();

  return {
    // Called from share-watcher.processShare on ACCEPTED shares only.
    record(sdiff) {
      const d = Number(sdiff);
      if (!Number.isFinite(d) || d <= 0 || d > MAX_PLAUSIBLE_DIFF) return;
      if (d > state.bestDiffPulse.d) {
        state.bestDiffPulse = { d, ts: Math.floor(Date.now() / 1000) };
        dirty = true;
      }
    },

    // The object spread into the Pulse census broadcast, or null to omit.
    forBroadcast() {
      const { d, ts } = state.bestDiffPulse;
      if (!Number.isFinite(d) || d <= 0) return null;
      return {
        d: Math.min(Math.round(d * 100) / 100, MAX_PLAUSIBLE_DIFF),
        ts: (Number.isFinite(ts) && ts >= MIN_TS) ? Math.floor(ts) : Math.floor(Date.now() / 1000),
      };
    },

    getBest() { return { ...state.bestDiffPulse }; },
  };
}

// share-watcher and network-stats both need the tracker without threading a
// new param through their factory signatures — module-level singleton, set
// once at boot by server.js.
function initBestDiffTracker(opts) {
  _singleton = createBestDiffTracker(opts);
  return _singleton;
}
// Lazy: first caller with opts (share-watcher, which has `state` in scope)
// creates the tracker; later callers (network-stats broadcast) just read it.
// If persistence of state.bestDiffPulse is unavailable, the counter-seed in
// createBestDiffTracker re-derives the record from shareCounters on boot.
function getBestDiffTracker(opts) {
  if (!_singleton && opts) _singleton = createBestDiffTracker(opts);
  return _singleton;
}

// ── Inbound (peer) hygiene ──────────────────────────────────────────────────

// Validate a peer's claimed bd from a parsed census payload. Returns a clean
// { d, ts } or null. `createdAt` is the nostr event's created_at (seconds).
function sanitizeInboundBd(raw, createdAt) {
  if (!raw || typeof raw !== 'object') return null;
  const d = Number(raw.d);
  const ts = Number(raw.ts);
  if (!Number.isFinite(d) || d <= 0 || d > MAX_PLAUSIBLE_DIFF) return null;
  if (!Number.isFinite(ts) || ts < MIN_TS) return null;
  if (Number.isFinite(createdAt) && ts > createdAt + TS_SKEW_S) return null; // struck "in the future"
  return { d: Math.round(d * 100) / 100, ts: Math.floor(ts) };
}

// Monotonic merge: a peer's record can only ever rise. Defends against
// replayed older events and against a peer re-broadcasting a lower value
// after a local reset (their reset shouldn't erase what the network saw).
function mergePeerBd(prev, next) {
  if (!next) return prev || null;
  if (!prev || !Number.isFinite(prev.d) || next.d > prev.d) return next;
  return prev;
}

module.exports = {
  initBestDiffTracker,
  getBestDiffTracker,
  sanitizeInboundBd,
  mergePeerBd,
  MAX_PLAUSIBLE_DIFF,
};
