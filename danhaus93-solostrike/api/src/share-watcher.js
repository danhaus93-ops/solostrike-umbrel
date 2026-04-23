// ── Share watcher (v1.5.12+) ────────────────────────────────────────────────
// Tails ckpool sharelog files (requires --log-shares flag in ckpool command).
// For every share submission, ckpool writes a JSON line with workername,
// result (accepted/rejected), reject-reason, sdiff, and more.
//
// We discover the pool-id subdirectory dynamically, watch all .sharelog files
// under it, parse each line as JSON, and aggregate counters per worker AND at
// the pool level.
//
// Classification:
//   result:true                                       → accepted
//   result:false + reason matches STALE_RE           → stale (network latency)
//   result:false + any other reason                  → rejected (hardware/config)
//
// Persistence (v1.5.11+):
//   Counters persist to persist.json as shareCounters so restarts don't zero.
//   Sharelog file read-offsets persist as sharelogCursors so we resume reading
//   from where we left off instead of skipping ahead to end-of-file on every
//   restart (which previously caused us to miss historical shares entirely).
//   Pool-level acceptedCount/rejectedCount/stale now populated in real time.
//
//   Shape:
//     shareCounters: { [workerName]: { accepted, rejected, stale, bestSdiff,
//                                       rejectReasons: { reason: count },
//                                       lastRejectReason, lastRejectAt, port,
//                                       firstSeen } }
//     sharelogCursors: { [absoluteFilePath]: bytesRead }
//     state.shares.acceptedCount / rejectedCount / stale   (pool-level rollup)

const fs = require('fs');
const path = require('path');

const STALE_RE = /stale|invalid.?jobid|old.?job|expired/i;
const POLL_MS = 2000;
const PERSIST_MS = 60000;
const MAX_FILES_TRACKED = 50;

function startShareWatcher({ state, logDir, savePersist, broadcast }) {
  if (!fs.existsSync(logDir)) {
    console.warn('[share-watcher] logDir not found:', logDir);
    return;
  }

  const tracked = new Map(); // filepath -> lastSize (mirrors state.sharelogCursors)
  let poolDir = null;
  let lastPersistAt = Date.now();

  if (!state.shareCounters) state.shareCounters = {};
  if (!state.sharelogCursors) state.sharelogCursors = {};
  if (!state.shares) state.shares = {};
  if (typeof state.shares.acceptedCount !== 'number') state.shares.acceptedCount = 0;
  if (typeof state.shares.rejectedCount !== 'number') state.shares.rejectedCount = 0;
  if (typeof state.shares.stale !== 'number') state.shares.stale = 0;
  if (!state.shares.rejectReasons) state.shares.rejectReasons = {};
  // v1.5.12: Track when counters started accumulating (for "Tracking since"
  // timestamp in the UI and for the reset-stats endpoint).
  if (typeof state.shareStatsStartedAt !== 'number') state.shareStatsStartedAt = Date.now();

  // Restore counters + cursors from persist.json if present
  try {
    const persistPath = path.join(process.env.CONFIG_DIR || '/app/config', 'persist.json');
    if (fs.existsSync(persistPath)) {
      const p = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
      if (p.shareCounters && typeof p.shareCounters === 'object') {
        state.shareCounters = p.shareCounters;
        let poolAccepted = 0;
        let poolRejected = 0;
        let poolStale = 0;
        const poolReasons = {};
        for (const name of Object.keys(state.shareCounters)) {
          const c = state.shareCounters[name];
          poolAccepted += (c.accepted || 0);
          poolRejected += (c.rejected || 0);
          poolStale += (c.stale || 0);
          for (const [r, n] of Object.entries(c.rejectReasons || {})) {
            poolReasons[r] = (poolReasons[r] || 0) + n;
          }
        }
        state.shares.acceptedCount = poolAccepted;
        state.shares.rejectedCount = poolRejected;
        state.shares.stale = poolStale;
        state.shares.rejectReasons = poolReasons;
        console.log('[share-watcher] Restored counters for', Object.keys(state.shareCounters).length, 'workers (accepted=' + poolAccepted + ' rejected=' + poolRejected + ' stale=' + poolStale + ')');
      }
      if (p.sharelogCursors && typeof p.sharelogCursors === 'object') {
        state.sharelogCursors = p.sharelogCursors;
        console.log('[share-watcher] Restored sharelog cursors for', Object.keys(state.sharelogCursors).length, 'files');
      }
      if (typeof p.shareStatsStartedAt === 'number') {
        state.shareStatsStartedAt = p.shareStatsStartedAt;
      }
    }
  } catch (e) { console.log('[share-watcher] persist restore failed:', e.message); }

  function findPoolDir() {
    try {
      const entries = fs.readdirSync(logDir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (e.name === 'pool' || e.name === 'users') continue;
        if (/^[0-9a-f]+$/i.test(e.name)) return path.join(logDir, e.name);
      }
    } catch {}
    return null;
  }

  function ensureCounter(name) {
    if (!state.shareCounters[name]) {
      state.shareCounters[name] = {
        accepted: 0, rejected: 0, stale: 0, bestSdiff: 0,
        rejectReasons: {}, lastRejectReason: null, lastRejectAt: null,
        port: null, firstSeen: Date.now(),
      };
    }
    return state.shareCounters[name];
  }

  function processShare(obj) {
    if (!obj || !obj.workername) return;
    const name = obj.workername;
    const c = ensureCounter(name);
    const reason = obj['reject-reason'] || null;
    const port = (obj.createinet || '').match(/:(\d+)$/);
    if (port) c.port = parseInt(port[1], 10);

    if (obj.result === true) {
      c.accepted++;
      state.shares.acceptedCount = (state.shares.acceptedCount || 0) + 1;
      const sd = typeof obj.sdiff === 'number' ? obj.sdiff : 0;
      if (sd > c.bestSdiff) c.bestSdiff = sd;
    } else {
      const isStale = reason && STALE_RE.test(reason);
      if (isStale) {
        c.stale++;
        state.shares.stale = (state.shares.stale || 0) + 1;
      } else {
        c.rejected++;
        state.shares.rejectedCount = (state.shares.rejectedCount || 0) + 1;
      }
      if (reason) {
        c.rejectReasons[reason] = (c.rejectReasons[reason] || 0) + 1;
        state.shares.rejectReasons[reason] = (state.shares.rejectReasons[reason] || 0) + 1;
        c.lastRejectReason = reason;
        c.lastRejectAt = Date.now();
      }
    }
  }

  function processChunk(chunk) {
    const lines = chunk.split(/\r?\n/);
    for (const raw of lines) {
      if (!raw) continue;
      const trimmed = raw.trim();
      if (!trimmed.startsWith('{')) continue;
      try {
        const obj = JSON.parse(trimmed);
        processShare(obj);
      } catch {}
    }
  }

  function scanFiles() {
    if (!poolDir) poolDir = findPoolDir();
    if (!poolDir) return;

    let files;
    try {
      files = fs.readdirSync(poolDir)
        .filter(f => f.endsWith('.sharelog'))
        .map(f => path.join(poolDir, f));
    } catch { return; }

    // Purge tracked files that no longer exist on disk (ckpool log rotation)
    for (const p of Array.from(tracked.keys())) {
      if (!files.includes(p)) {
        tracked.delete(p);
        delete state.sharelogCursors[p];
      }
    }

    if (files.length > MAX_FILES_TRACKED) {
      files.sort();
      files = files.slice(-MAX_FILES_TRACKED);
    }

    for (const filepath of files) {
      if (!tracked.has(filepath)) {
        // Resume from last persisted cursor, or start from byte 0 for new files.
        // v1.5.11 fix: previously we set cursor to current file size on first
        // discovery, silently skipping all existing shares on every API restart.
        // Now we read from byte 0 so historical shares get counted exactly once
        // (persistence prevents double-count across restarts).
        const savedCursor = state.sharelogCursors[filepath];
        tracked.set(filepath, typeof savedCursor === 'number' ? savedCursor : 0);
      }
      tickFile(filepath);
    }
  }

  function tickFile(filepath) {
    fs.stat(filepath, (err, stats) => {
      if (err) { tracked.delete(filepath); delete state.sharelogCursors[filepath]; return; }
      const lastSize = tracked.get(filepath) || 0;
      if (stats.size < lastSize) {
        // File was truncated/rotated in place — reset cursor
        tracked.set(filepath, 0);
        state.sharelogCursors[filepath] = 0;
        return;
      }
      if (stats.size <= lastSize) return;
      const stream = fs.createReadStream(filepath, {
        start: lastSize, end: stats.size, encoding: 'utf8',
      });
      let buf = '';
      stream.on('data', (d) => { buf += d; });
      stream.on('end', () => {
        processChunk(buf);
        tracked.set(filepath, stats.size);
        state.sharelogCursors[filepath] = stats.size;
      });
      stream.on('error', () => {});
    });
  }

  function maybePersist() {
    const now = Date.now();
    if (now - lastPersistAt < PERSIST_MS) return;
    lastPersistAt = now;
    try {
      savePersist({
        closestCalls: state.closestCalls,
        blocks: state.blocks,
        snapshots: state.snapshots,
        webhooks: state.webhooks,
        shareCounters: state.shareCounters,
        sharelogCursors: state.sharelogCursors,
        shareStatsStartedAt: state.shareStatsStartedAt,
      });
    } catch (e) { console.log('[share-watcher] persist failed:', e.message); }
  }

  function tick() {
    scanFiles();
    maybePersist();
  }

  setInterval(tick, POLL_MS);
  console.log('[share-watcher] Watching', logDir, 'for .sharelog files');
}

module.exports = { startShareWatcher };
