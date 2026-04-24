// ── Share watcher (v1.5.13) ─────────────────────────────────────────────────
// Tails ckpool sharelog files (requires --log-shares flag in ckpool command).
// For every share submission, ckpool writes a JSON line with workername,
// result (accepted/rejected), reject-reason, sdiff, and more.
//
// ckpool's log directory layout is:
//   <logDir>/<block-height-hex>/<jobid-hex>.sharelog
// A NEW subdirectory is created for every block height, so the watcher must
// recursively scan and re-discover new directories continuously — not cache a
// single poolDir from first boot (v1.5.12 bug that missed 97% of shares).
//
// Classification:
//   result:true                                       → accepted
//   result:false + reason matches STALE_RE           → stale (latency-adjacent,
//                                                        includes "Invalid JobID")
//   result:false + any other reason                  → rejected (hardware/config)
//
// Persistence (v1.5.11+):
//   Counters persist to persist.json as shareCounters so restarts don't zero.
//   Sharelog file read-offsets persist as sharelogCursors so we resume reading
//   from where we left off instead of skipping ahead to end-of-file on every
//   restart (which previously caused us to miss historical shares entirely).
//   Pool-level acceptedCount/rejectedCount/stale populated in real time.
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
const RESCAN_DIRS_EVERY_MS = 15000;   // re-walk tree every 15s for new block-height dirs
const SKIP_DIRS = new Set(['pool', 'users']);

function startShareWatcher({ state, logDir, savePersist, broadcast }) {
  if (!fs.existsSync(logDir)) {
    console.warn('[share-watcher] logDir not found:', logDir);
    return;
  }

  const tracked = new Map(); // filepath -> lastSize (mirrors state.sharelogCursors)
  let lastPersistAt = Date.now();
  let lastDirScanAt = 0;
  let cachedFileList = [];

  if (!state.shareCounters) state.shareCounters = {};
  if (!state.sharelogCursors) state.sharelogCursors = {};
  if (!state.shares) state.shares = {};
  if (typeof state.shares.acceptedCount !== 'number') state.shares.acceptedCount = 0;
  if (typeof state.shares.rejectedCount !== 'number') state.shares.rejectedCount = 0;
  if (typeof state.shares.stale !== 'number') state.shares.stale = 0;
  if (!state.shares.rejectReasons) state.shares.rejectReasons = {};
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

  // Recursively walk logDir for all .sharelog files. ckpool creates one
  // subdirectory per block height (e.g. 000e708f, 000e7090, ...), so we
  // must re-walk every RESCAN_DIRS_EVERY_MS to catch new directories.
  // We skip 'pool' and 'users' subdirs (those are ckpool's own bookkeeping).
  function walkSharelogFiles(root) {
    const out = [];
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch { continue; }
      for (const e of entries) {
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          stack.push(path.join(dir, e.name));
        } else if (e.isFile() && e.name.endsWith('.sharelog')) {
          out.push(path.join(dir, e.name));
        }
      }
    }
    return out;
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
    const now = Date.now();

    // Re-walk the directory tree periodically (every 15s) to pick up new
    // block-height subdirectories created by ckpool. Between walks we reuse
    // the cached list — cheap, avoids thrashing the filesystem.
    if (now - lastDirScanAt >= RESCAN_DIRS_EVERY_MS || cachedFileList.length === 0) {
      cachedFileList = walkSharelogFiles(logDir);
      lastDirScanAt = now;
    }
    const files = cachedFileList;
    if (!files.length) return;

    const fileSet = new Set(files);

    // Purge tracked files that no longer exist on disk (deleted/rotated away).
    // Keep cursors for files that still exist — we want to resume them.
    for (const p of Array.from(tracked.keys())) {
      if (!fileSet.has(p)) {
        tracked.delete(p);
        delete state.sharelogCursors[p];
      }
    }

    // Track and tick every sharelog file — no cap. At ~300 files across 60
    // block-height dirs this is fine; fs.stat is cheap and streams only read
    // new bytes beyond the cursor.
    for (const filepath of files) {
      if (!tracked.has(filepath)) {
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
  console.log('[share-watcher] Watching', logDir, 'recursively for .sharelog files (v1.5.13)');
}

module.exports = { startShareWatcher };
