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

// v1.11.x MEMORY LEAK FIX:
// ckpool creates a new directory for each block height under /var/log/ckpool
// (e.g. 000e708f/, 000e7090/, ...). Once the chain moves on, ckpool stops
// appending to old block-height dirs — they become frozen historical record.
// Previously we tracked ALL .sharelog files forever, which accumulated to
// 75,000+ files after a few weeks of mining. Each one held an entry in the
// `tracked` Map AND `state.sharelogCursors` AND ran fs.stat() every poll
// tick. Result: Node heap exhausted after ~34 hours of uptime, container
// OOM-crash + restart.
//
// Fix: only track sharelog files modified within MAX_FILE_AGE_MS. Files
// older than that are stale block-height dirs ckpool doesn't write to.
// We skip them in walkSharelogFiles() and purge their cursors on startup
// in restorePersistedState().
const MAX_FILE_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// v1.11.x MEMORY LEAK FIX (companion to the file-age fix above):
// state.shareCounters is keyed by workerName and was never pruned. With a
// stable fleet (current state: 14 workers) this is fine. But every unique
// workerName ever seen accumulated forever, persisting to persist.json across
// restarts. For long-running pools or pools open to testers, this grows.
// Fix: prune counters for workers without a share submission in 30 days.
const MAX_COUNTER_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COUNTER_PRUNE_INTERVAL_MS = 60 * 60 * 1000;    // hourly

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
  // v1.8.3-rev22: session-scoped sum of accepted share difficulties.
  // Used by UI for implied-hashrate calculation. Resets with session.
  // (state.shares.accepted is the LIFETIME work-weighted sum from ckpool's
  // pool.status — that one never resets and would inflate session math.)
  if (typeof state.shares.acceptedSdiffSum !== 'number') state.shares.acceptedSdiffSum = 0;
  if (typeof state.shareStatsStartedAt !== 'number' || !state.shareStatsStartedAt) state.shareStatsStartedAt = Date.now();

  // Restore counters + cursors from persist.json if present.
  // v1.8.3-rev21: Track whether the persisted shareStatsStartedAt was
  // valid. If we restore non-zero shareCounters but the timestamp was
  // missing/zero (forcing line 60 default to Date.now()), we have a
  // sync drift — implied-hashrate math would be wildly wrong because
  // it'd divide lifetime shares by a fresh session window. The guard
  // below detects this and resets counters to bring back into sync.
  let persistedTimestampValid = false;
  try {
    const persistPath = path.join(process.env.CONFIG_DIR || '/app/config', 'persist.json');
    if (fs.existsSync(persistPath)) {
      const p = JSON.parse(fs.readFileSync(persistPath, 'utf8'));
      if (p.shareCounters && typeof p.shareCounters === 'object') {
        state.shareCounters = p.shareCounters;
        // v1.11.x MEMORY LEAK FIX: prune counters for workers not seen in
        // MAX_COUNTER_AGE_MS. Previously this Object grew unboundedly across
        // restarts as every unique workerName ever observed accumulated.
        //
        // UPGRADE-SAFE BACKFILL: counters created before this fix lack
        // lastShareAt. We backfill them with Date.now() (NOT firstSeen) on
        // first load, which gives every existing worker a 30-day grace
        // period from this deploy. This prevents accidentally wiping the
        // user's entire lifetime stat history on upgrade. From this deploy
        // forward, every share submission updates lastShareAt, so genuinely
        // inactive workers will be pruned ~30 days later.
        const ageCutoff = Date.now() - MAX_COUNTER_AGE_MS;
        let pruned = 0;
        for (const name of Object.keys(state.shareCounters)) {
          const c = state.shareCounters[name];
          if (typeof c.lastShareAt !== 'number') {
            // Upgrade backfill: give grace period from now, not from firstSeen
            c.lastShareAt = Date.now();
          }
          if (c.lastShareAt < ageCutoff) {
            delete state.shareCounters[name];
            pruned++;
          }
        }
        let poolAccepted = 0;
        let poolRejected = 0;
        let poolStale = 0;
        let poolSdiffSum = 0;
        const poolReasons = {};
        for (const name of Object.keys(state.shareCounters)) {
          const c = state.shareCounters[name];
          poolAccepted += (c.accepted || 0);
          poolRejected += (c.rejected || 0);
          poolStale += (c.stale || 0);
          poolSdiffSum += (c.sdiffSum || 0);
          for (const [r, n] of Object.entries(c.rejectReasons || {})) {
            poolReasons[r] = (poolReasons[r] || 0) + n;
          }
        }
        state.shares.acceptedCount = poolAccepted;
        state.shares.rejectedCount = poolRejected;
        state.shares.stale = poolStale;
        state.shares.rejectReasons = poolReasons;
        state.shares.acceptedSdiffSum = poolSdiffSum;
        const remaining = Object.keys(state.shareCounters).length;
        console.log(`[share-watcher] Restored counters for ${remaining} workers (pruned ${pruned} stale) (accepted=${poolAccepted} rejected=${poolRejected} stale=${poolStale} sdiffSum=${poolSdiffSum})`);
      }
      if (p.sharelogCursors && typeof p.sharelogCursors === 'object') {
        state.sharelogCursors = p.sharelogCursors;
        // v1.11.x MEMORY LEAK FIX: purge cursors for files that no longer
        // exist or are older than MAX_FILE_AGE_MS. Previously this Object
        // grew unboundedly (75,000+ entries observed in production after a
        // few weeks of mining), causing eventual heap exhaustion. Pruning
        // on startup ensures we don't drag old cursors forward.
        const before = Object.keys(state.sharelogCursors).length;
        const ageCutoff = Date.now() - MAX_FILE_AGE_MS;
        let purged = 0;
        for (const fp of Object.keys(state.sharelogCursors)) {
          try {
            const st = fs.statSync(fp);
            if (st.mtimeMs < ageCutoff) {
              delete state.sharelogCursors[fp];
              purged++;
            }
          } catch {
            // File no longer exists
            delete state.sharelogCursors[fp];
            purged++;
          }
        }
        const after = Object.keys(state.sharelogCursors).length;
        console.log(`[share-watcher] Restored sharelog cursors for ${after} files (purged ${purged} stale of ${before} total)`);
      }
      if (typeof p.shareStatsStartedAt === 'number' && p.shareStatsStartedAt > 0) {
        state.shareStatsStartedAt = p.shareStatsStartedAt;
        persistedTimestampValid = true;
      }
    }
  } catch (e) { console.log('[share-watcher] persist restore failed:', e.message); }

  // v1.8.3-rev21: Sync drift guard. If shareCounters were restored with
  // non-zero data but shareStatsStartedAt was NOT a valid persisted
  // value (so line 60 had to default it to Date.now()), the two are
  // out of sync — implied hashrate would compute lifetime-shares /
  // recent-session-window and produce a value that is orders of
  // magnitude too high. Reset counters to bring back into sync. The
  // freshly-defaulted shareStatsStartedAt at line 60 stays as-is so
  // tracking begins now. Lifetime data is intentionally sacrificed to
  // keep the implied hashrate display honest.
  // v1.8.3-rev22: Sync drift guard, expanded. Triggers if EITHER:
  //   (a) shareStatsStartedAt was missing/invalid (rev21 case — counts
  //       restored but session timestamp defaulted to now), OR
  //   (b) acceptedCount > 0 but acceptedSdiffSum is 0 (rev22 upgrade
  //       case — old persist file lacks per-worker sdiffSum field, so
  //       new sum starts at 0 while count is restored from history).
  // In either case the implied-hashrate math would be off. Reset
  // session counters to bring everything back into sync. The
  // freshly-defaulted shareStatsStartedAt at line 60 stays as-is so
  // tracking begins now. Lifetime data is intentionally sacrificed.
  const driftA = !persistedTimestampValid && state.shares.acceptedCount > 0;
  const driftB = state.shares.acceptedCount > 0 && state.shares.acceptedSdiffSum === 0;
  if (driftA || driftB) {
    const reason = driftA ? 'shareStatsStartedAt missing/invalid'
                          : 'acceptedSdiffSum is 0 but acceptedCount > 0 (likely rev22 upgrade)';
    console.log('[share-watcher] DRIFT GUARD: ' + reason + '. Resetting counters (' + state.shares.acceptedCount + ' accepted) to sync with fresh session.');
    if (state.shareCounters) {
      for (const name of Object.keys(state.shareCounters)) {
        const c = state.shareCounters[name];
        c.accepted = 0; c.rejected = 0; c.stale = 0; c.bestSdiff = 0; c.sdiffSum = 0;
        c.recentSdiffs = [];
        c.rejectReasons = {}; c.lastRejectReason = null; c.lastRejectAt = null;
      }
    }
    state.shares.acceptedCount = 0;
    state.shares.rejectedCount = 0;
    state.shares.stale = 0;
    state.shares.rejectReasons = {};
    state.shares.acceptedSdiffSum = 0;
    state.shareStatsStartedAt = Date.now();
  }

  // Recursively walk logDir for all .sharelog files. ckpool creates one
  // subdirectory per block height (e.g. 000e708f, 000e7090, ...), so we
  // must re-walk every RESCAN_DIRS_EVERY_MS to catch new directories.
  // We skip 'pool' and 'users' subdirs (those are ckpool's own bookkeeping).
  function walkSharelogFiles(root) {
    const out = [];
    const stack = [root];
    const ageCutoff = Date.now() - MAX_FILE_AGE_MS;
    let skippedStale = 0;
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
          const filepath = path.join(dir, e.name);
          // v1.11.x MEMORY LEAK FIX: skip stale block-height files. Once
          // ckpool moves to a new block, old .sharelog files never get
          // appended to again — only the current block's sharelogs are live.
          // statSync is cheap; we do it here once per scan (every 15s).
          try {
            const stat = fs.statSync(filepath);
            if (stat.mtimeMs < ageCutoff) { skippedStale++; continue; }
            out.push(filepath);
          } catch { /* file vanished mid-scan; ignore */ }
        }
      }
    }
    if (skippedStale > 0 && Math.random() < 0.05) {
      // Log occasionally so users can see the leak fix at work without spamming
      console.log(`[share-watcher] Skipped ${skippedStale} stale sharelog files (older than ${MAX_FILE_AGE_MS / 1000 / 60}min)`);
    }
    return out;
  }

  function ensureCounter(name) {
    if (!state.shareCounters[name]) {
      state.shareCounters[name] = {
        accepted: 0, rejected: 0, stale: 0, bestSdiff: 0,
        // best share diff since the last *best-diff* reset (independent of the
        // session-stats reset that zeros bestSdiff). Drives all best-diff
        // displays so a reset clears them consistently. ckpool's cumulative
        // best stays available separately as the worker's lifetime value.
        bestSinceReset: 0,
        // v1.12.x Strike Force: bounded ring of recent ACCEPTED share diffs
        // (achieved sdiff), retained only for rental high-diff ports (>4000)
        // so the Strike Force card can render a real per-share histogram.
        // Capped at 512 — owned miners on 3333/3334 never populate this, so
        // the compact shareEvents payload stays tiny for the whole fleet.
        recentSdiffs: [],
        rejectReasons: {}, lastRejectReason: null, lastRejectAt: null,
        port: null, firstSeen: Date.now(),
        // v1.11.x MEMORY LEAK FIX: track lastShareAt so we can prune counters
        // for workers that haven't submitted shares in a long time. Without
        // this, every unique workerName ever seen accumulates forever.
        lastShareAt: Date.now(),
      };
    } else {
      // Touch lastShareAt so existing counters get bumped on activity
      state.shareCounters[name].lastShareAt = Date.now();
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
      // v1.8.4: timestamp the most recent accepted share so the System Health
      // card can answer "when did ckpool last process a share?". This is the
      // single most useful liveness signal — if it's been more than ~2min
      // since the last share, something is wrong (every miner offline,
      // ckpool stuck, sharelog rotation broken, etc.).
      state.shares.lastShareAt = Date.now();
      const sd = typeof obj.sdiff === 'number' ? obj.sdiff : 0;
      const td = typeof obj.diff  === 'number' ? obj.diff  : 0;
      if (sd > c.bestSdiff) c.bestSdiff = sd;
      if (sd > (c.bestSinceReset || 0)) c.bestSinceReset = sd;
      // v1.12.x Strike Force: retain per-share achieved diff for the histogram,
      // but ONLY for rental high-diff ports (NiceHash/MRR connect on >4000,
      // e.g. 4334). Owned miners on 3333/3334 skip this so payload stays small.
      if (c.port && c.port > 4000) {
        if (!Array.isArray(c.recentSdiffs)) c.recentSdiffs = [];
        c.recentSdiffs.push(sd);
        if (c.recentSdiffs.length > 512) c.recentSdiffs.shift();
      }
      // v1.8.3-rev24: sum TARGET difficulties (obj.diff), not achieved sdiff.
      // sdiff includes a luck factor (sdiff >= diff for accepted shares;
      // lucky shares can have sdiff orders of magnitude higher than diff).
      // For implied-hashrate calc we want the unbiased estimator, which is
      // sum(target_diff) × 2^32 / time. Using sdiff lets a single lucky
      // share inflate the implied HR by entire PH/s (rev22 bug). The field
      // names retain "Sdiff" for backwards compat with persist files but
      // now sum target diffs. bestSdiff (the display metric) still uses
      // sdiff — that one really is "best lucky share".
      c.sdiffSum = (c.sdiffSum || 0) + td;
      state.shares.acceptedSdiffSum = (state.shares.acceptedSdiffSum || 0) + td;
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

  // v1.11.x MEMORY LEAK FIX: hourly prune of stale shareCounters.
  // Companion to the on-load prune in restorePersistedState — handles long-
  // running containers where workers eventually go silent for >30d.
  setInterval(() => {
    const ageCutoff = Date.now() - MAX_COUNTER_AGE_MS;
    let pruned = 0;
    for (const name of Object.keys(state.shareCounters)) {
      const c = state.shareCounters[name];
      const lastShareAt = (typeof c.lastShareAt === 'number') ? c.lastShareAt : 0;
      if (lastShareAt < ageCutoff) {
        delete state.shareCounters[name];
        pruned++;
      }
    }
    if (pruned > 0) {
      const remaining = Object.keys(state.shareCounters).length;
      console.log(`[share-watcher] Pruned ${pruned} stale share counters (now tracking ${remaining} workers)`);
    }
  }, COUNTER_PRUNE_INTERVAL_MS).unref();

  console.log('[share-watcher] Watching', logDir, 'recursively for .sharelog files (v1.5.13)');
}

module.exports = { startShareWatcher };
