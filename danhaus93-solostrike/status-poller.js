const fs = require('fs-extra');
const path = require('path');
const { transformState } = require('./state-transform');
const { detectMinerBest, workerHealth } = require('./miner-detect');
const { getMetaForWorker } = require('./ua-tailer');

function parseHashrate(s) {
  if (!s) return 0;
  const str = String(s);
  const num = parseFloat(str);
  if (isNaN(num)) return 0;
  // iter27c bug 4: defensive case-insensitive suffix match. ckpool emits
  // uppercase in practice but a future format change would silently turn
  // "1.2t" into 1.2 (off by 1e12). Normalize before checking.
  const last = str.charAt(str.length - 1).toUpperCase();
  if (last === 'E') return num * 1e18;
  if (last === 'P') return num * 1e15;
  if (last === 'T') return num * 1e12;
  if (last === 'G') return num * 1e9;
  if (last === 'M') return num * 1e6;
  if (last === 'K') return num * 1e3;
  return num;
}

function applyMinerDetection(wk, workername) {
  const meta = getMetaForWorker(workername);
  const ua = meta?.userAgent || null;
  const result = detectMinerBest(workername, ua);
  wk.minerType   = result.type;
  wk.minerIcon   = result.icon || '▪';
  wk.minerVendor = result.vendor;
  wk.minerSource = result.source;
  wk.userAgent   = ua;
  wk.ip          = meta?.ip || null;
}

function computeAverage(history, windowMs) {
  if (!Array.isArray(history) || !history.length) return 0;
  const now = Date.now();
  const cutoff = now - windowMs;
  let sum = 0, count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i];
    if (!p || p.ts < cutoff) break;
    sum += (p.hr || 0);
    count++;
  }
  return count > 0 ? sum / count : 0;
}

// v1.12.0: parse a ckpool runtime/uptime field. ckpool's pool.status summary
// line carries "runtime" as integer seconds since the pool process started.
function parseRuntimeSeconds(summary) {
  const r = summary && (summary.runtime ?? summary.Runtime ?? summary.uptime);
  const n = Number(r);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function startStatusPoller(state, broadcast, logDir) {
  const poolStatus = path.join(logDir, 'pool/pool.status');
  const usersDir   = path.join(logDir, 'users');
  const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

  const HISTORY_INTERVAL_MS = 60 * 1000;
  const HISTORY_MAX_POINTS  = 1440;       // 24h at 1min
  const WEEK_MAX_POINTS     = 10080;      // 7d at 1min
  const WEEK_INTERVAL_MS    = 60 * 1000;
  let lastHistoryPush = 0;
  let lastWeekPush = 0;

  // v1.12.0: best-share-over-time ring buffer. ckpool only ever exposes the
  // CURRENT pool bestshare; to chart "are we getting closer to a block over
  // time" we sample it ourselves. Same 60s throttle + 1440-point (24h) cap
  // as spsHistory. Persistence across restarts is layered on by snapshots.js;
  // this in-memory buffer feeds the live Best Share — Trend chart.
  const BEST_INTERVAL_MS = 60 * 1000;
  let lastBestPush = 0;
  const WORKERS_INTERVAL_MS = 60 * 1000;
  let lastWorkersPush = 0;

  // v1.11.8: decouple poll cadence from broadcast cadence.
  // Poll ckpool's status files every 2s for fresh internal state, but
  // throttle WebSocket broadcasts to a minimum 3s interval so we don't
  // hammer connected clients. Net effect: dashboard updates ~1.7× faster
  // than the previous 5s cadence with only 1.7× the prior WS bandwidth
  // (vs 2.5× if we broadcast on every poll). ckpool itself only refreshes
  // pool.status every UPDATE_INTERVAL (=20s in our docker-compose), so
  // polling faster than ckpool refreshes is cheap — file-cache reads only.
  const POLL_INTERVAL_MS          = 2000;
  const BROADCAST_MIN_INTERVAL_MS = 3000;
  let lastBroadcastAt = 0;

  if (!Array.isArray(state.hashrate.week)) state.hashrate.week = [];
  if (!state.hashrate.averages) state.hashrate.averages = {};
  // v1.12.0: ensure the new pool-internals containers exist so transformState
  // and the UI never read undefined.
  if (!state.pool) state.pool = {};
  if (!Array.isArray(state.shares.bestHistory)) state.shares.bestHistory = [];
  if (!Array.isArray(state.pool.workersHistory)) state.pool.workersHistory = [];

  function cleanupStaleWorkers() {
    const now = Date.now();
    // v1.11.1 BUG FIX: workers dropped by ckpool (socket disconnect, miner
    // powered off, network drop) disappear from the user files entirely, so
    // the file-scan loop above never touches them again. Previously this meant
    // they kept whatever status they had last — typically 'online' — until
    // the 24h delete threshold hit. The offline-warning banner relies on
    // status transitioning online → offline, so the banner never fired for
    // these workers. Fix: age any worker offline whose lastSeen is older
    // than the same 120s threshold used for live workers above (line 215).
    const OFFLINE_THRESHOLD_MS = 120 * 1000;
    for (const key of Object.keys(state.workers)) {
      const w = state.workers[key];
      if (!w) continue;
      // Age-out: mark offline if we haven't seen a share in >120s
      if (w.lastSeen && (now - w.lastSeen) > OFFLINE_THRESHOLD_MS && w.status !== 'offline') {
        w.status = 'offline';
        w.health = workerHealth(w);
      }
      // Original cleanup: delete after 24h
      if (w.lastSeen && (now - w.lastSeen) > STALE_THRESHOLD_MS) {
        delete state.workers[key];
      }
    }
  }

  function updateAvgHashrate(current) {
    const now = Date.now();
    if (!state._avgState) state._avgState = { lastTs: now, totalHashTime: 0 };
    const a = state._avgState;
    const dt = (now - a.lastTs) / 1000;
    if (dt > 0 && dt < 3600) a.totalHashTime += current * dt;
    a.lastTs = now;
  }

  function refreshAverages() {
    const shortHist = state.hashrate.history || [];
    const longHist  = state.hashrate.week    || [];
    state.hashrate.averages = {
      hr1m:  computeAverage(shortHist,      60 * 1000),
      hr5m:  computeAverage(shortHist,  5 * 60 * 1000),
      hr15m: computeAverage(shortHist, 15 * 60 * 1000),
      hr1h:  computeAverage(shortHist, 60 * 60 * 1000),
      hr6h:  computeAverage(shortHist,  6 * 60 * 60 * 1000),
      hr24h: computeAverage(shortHist, 24 * 60 * 60 * 1000),
      hr7d:  computeAverage(longHist,   7 * 24 * 60 * 60 * 1000),
    };
  }

  async function poll() {
    try {
      if (await fs.pathExists(poolStatus)) {
        const content = await fs.readFile(poolStatus, 'utf8');
        const lines = content.trim().split('\n').filter(Boolean);
        if (lines.length >= 3) {
          try {
            const summary = JSON.parse(lines[0]);
            const rates   = JSON.parse(lines[1]);
            const shares  = JSON.parse(lines[2]);
            const hr      = parseHashrate(rates.hashrate1m);
            state.hashrate.current = hr;
            updateAvgHashrate(hr);

            const now = Date.now();

            if (now - lastHistoryPush >= HISTORY_INTERVAL_MS) {
              state.hashrate.history.push({ ts: now, hr });
              if (state.hashrate.history.length > HISTORY_MAX_POINTS) {
                state.hashrate.history.shift();
              }
              lastHistoryPush = now;
            }

            if (now - lastWeekPush >= WEEK_INTERVAL_MS) {
              state.hashrate.week.push({ ts: now, hr });
              if (state.hashrate.week.length > WEEK_MAX_POINTS) {
                state.hashrate.week.shift();
              }
              lastWeekPush = now;
            }

            refreshAverages();

            // ── v1.12.0: ckpool NATIVE pool-level windows ──────────────────
            // Previously we computed our own averages from history and ignored
            // ckpool's own windowed rates. ckpool's "rates" line carries
            // authoritative hashrate1m/5m/15m/1hr/6hr/1d/7d; the "summary"
            // line carries Idle/Disconnected and runtime; the "shares" line
            // carries SPS1m/5m/15m/1h. Surface all of them under state.pool
            // for the Pool Internals page (Page 2). These are the pool's OWN
            // numbers, distinct from the history-derived averages above.
            state.pool.hashrateWindows = {
              hr1m:  parseHashrate(rates.hashrate1m),
              hr5m:  parseHashrate(rates.hashrate5m),
              hr15m: parseHashrate(rates.hashrate15m),
              hr1h:  parseHashrate(rates.hashrate1hr),
              hr6h:  parseHashrate(rates.hashrate6hr),
              hr1d:  parseHashrate(rates.hashrate1d),
              hr7d:  parseHashrate(rates.hashrate7d),
            };
            // % of pool peak — the highest of the windows is the reference.
            {
              const w = state.pool.hashrateWindows;
              const peak = Math.max(w.hr1m, w.hr5m, w.hr15m, w.hr1h, w.hr6h, w.hr1d, w.hr7d, 1);
              state.pool.hashrateWindowPct = {
                hr1m:  +(w.hr1m  / peak * 100).toFixed(1),
                hr5m:  +(w.hr5m  / peak * 100).toFixed(1),
                hr15m: +(w.hr15m / peak * 100).toFixed(1),
                hr1h:  +(w.hr1h  / peak * 100).toFixed(1),
                hr6h:  +(w.hr6h  / peak * 100).toFixed(1),
                hr1d:  +(w.hr1d  / peak * 100).toFixed(1),
                hr7d:  +(w.hr7d  / peak * 100).toFixed(1),
              };
              state.pool.hashratePeak = peak;
            }
            // SPS windows — ckpool exposes all four; we previously kept only 1m.
            state.pool.spsWindows = {
              sps1m:  shares.SPS1m  || 0,
              sps5m:  shares.SPS5m  || 0,
              sps15m: shares.SPS15m || 0,
              sps1h:  shares.SPS1h  || shares.SPS1hr || 0,
            };
            // Connection states + runtime from the summary line.
            state.pool.users        = summary.Users        || 0;
            state.pool.workers      = summary.Workers       || 0;
            state.pool.idle         = summary.Idle          || 0;
            state.pool.disconnected = summary.Disconnected  || 0;
            state.pool.runtimeSec   = parseRuntimeSeconds(summary);
            state.pool.lastUpdate   = summary.lastupdate || summary.lastUpdate || Math.floor(now / 1000);
            state.pool.lastPolledAt = now;
            // v1.12.x: rolling workers+users history for the Page-2 trend.
            // {ts, workers, users}. One sample/min, 24h cap — mirrors bestHistory.
            (() => {
              if (!Array.isArray(state.pool.workersHistory)) state.pool.workersHistory = [];
              if (now - lastWorkersPush < WORKERS_INTERVAL_MS) return;
              state.pool.workersHistory.push({ ts: now, workers: state.pool.workers || 0, users: state.pool.users || 0 });
              if (state.pool.workersHistory.length > HISTORY_MAX_POINTS) {
                state.pool.workersHistory.splice(0, state.pool.workersHistory.length - HISTORY_MAX_POINTS);
              }
              lastWorkersPush = now;
            })();
            // ───────────────────────────────────────────────────────────────

// v1.5.11: share-watcher owns acceptedCount/rejectedCount/stale fields
            // (real share counts from sharelogs). Status-poller only sets the
            // work-weighted accepted/rejected from ckpool's pool.status.
            state.shares.accepted = shares.accepted || 0;
            state.shares.rejected = shares.rejected || 0;
            state.shares.sps1m    = shares.SPS1m    || 0;
            // iter28-fix-F: spsHistory ring buffer for Strike Velocity card.
            // Sample once per ~60s (poller fires every 5s, so we throttle).
            // Cap at 1440 points = 24h.
            (() => {
              if (!Array.isArray(state.shares.spsHistory)) state.shares.spsHistory = [];
              const sps = shares.SPS1m || 0;
              const last = state.shares.spsHistory[state.shares.spsHistory.length - 1];
              if (last && (now - last.ts) < 50000) return;
              state.shares.spsHistory.push({ ts: now, sps });
              if (state.shares.spsHistory.length > 1440) {
                state.shares.spsHistory.splice(0, state.shares.spsHistory.length - 1440);
              }
            })();
            state.bestshare            = shares.bestshare     || 0;
            state.totalWorkers         = summary.Workers      || 0;
            state.totalUsers           = summary.Users        || 0;

            // ── v1.12.0: best-share-over-time ring buffer (Best Share Trend) ─
            // ckpool only ever gives the CURRENT bestshare; to chart it over
            // time we sample on the same 60s cadence. The value is a running
            // session maximum, so the series is monotonic non-decreasing —
            // that's intentional: the chart shows "closest we've ever come,
            // climbing over the round."
            (() => {
              if (!Array.isArray(state.shares.bestHistory)) state.shares.bestHistory = [];
              if (now - lastBestPush < BEST_INTERVAL_MS) return;
              const best = shares.bestshare || 0;
              state.shares.bestHistory.push({ ts: now, best });
              if (state.shares.bestHistory.length > 1440) {
                state.shares.bestHistory.splice(0, state.shares.bestHistory.length - 1440);
              }
              lastBestPush = now;
            })();
          } catch (e) {
            // v1.8.3-rev29: was silently swallowed. If ckpool's pool.status
            // becomes malformed (disk full mid-write, partial flush, etc.),
            // dashboard would keep showing stale stats with no warning.
            console.warn('[StatusPoller] pool.status parse failed:', e.message);
          }
        }
      }

      if (await fs.pathExists(usersDir)) {
        const userFiles = await fs.readdir(usersDir);
        for (const userFile of userFiles) {
          const fullPath = path.join(usersDir, userFile);
          try {
            const stat = await fs.stat(fullPath);
            if (!stat.isFile()) continue;
            const data = await fs.readFile(fullPath, 'utf8');
            const userData = JSON.parse(data);
            if (!Array.isArray(userData.worker)) continue;
            for (const w of userData.worker) {
              const key = w.workername;
              if (!key) continue;
              if (!state.workers[key]) {
                state.workers[key] = {
                  name: key,
                  hashrate: 0, shares: 0, rejected: 0,
                  sharesCount: 0, rejectedCount: 0,
                  lastSeen: Date.now(), diff: 0, status: 'online',
                  bestshare: 0,
                  // v1.12.0: lifetime best (bestever) tracked separately from
                  // session bestshare for the Fleet Comparison "Best Ever" col.
                  bestever: 0,
                  minerType: null, minerIcon: '▪', minerVendor: null,
                  minerSource: 'unknown', userAgent: null,
                  ip: null,
                  health: 'green',
                  // iter28-fix-B: 24h online/offline history for uptime sparkline.
                  // 96 samples × 15min cadence = 24h coverage.
                  statusHistory: [],
                };
                applyMinerDetection(state.workers[key], key);
              }
              const wk = state.workers[key];
              wk.hashrate       = parseHashrate(w.hashrate1m);
              wk.hashrate5m     = parseHashrate(w.hashrate5m);
              wk.hashrate1h     = parseHashrate(w.hashrate1hr);
              wk.hashrate24h    = parseHashrate(w.hashrate1d);
              wk.hashrate7d     = parseHashrate(w.hashrate7d);
              wk.shares         = w.shares         ?? wk.shares ?? 0;
              wk.rejected       = w.rejected       ?? wk.rejected ?? 0;
              wk.sharesCount    = w.sharesCount    || w.shares_count   || 0;
              wk.rejectedCount  = w.rejectedCount  || w.rejected_count || 0;
              wk.bestshare      = w.bestshare      || 0;
              // v1.12.0: bestever — ckpool's per-worker lifetime best diff.
              // Fall back to tracking the running max of bestshare if ckpool
              // doesn't emit a separate bestever field on this build.
              wk.bestever       = Math.max(wk.bestever || 0, w.bestever || 0, wk.bestshare || 0);
              wk.diff           = w.lastdiff       || w.diff || wk.diff || 0;
              wk.lastSeen       = (w.lastshare || Math.floor(Date.now()/1000)) * 1000;
              const age = Date.now() - wk.lastSeen;
              // v1.8.3-rev27: bumped from 60s (rev26) to 120s. 60s caused
              // mass false-flag flapping when 7+ workers had natural share
              // intervals creeping near the threshold (e.g. during quiet
              // luck stretches or right after a block change resets work).
              // 120s gives ~4-7x margin over typical 17-32s share intervals
              // while still catching real outages within 2 minutes. To test
              // detection, power off a miner for >2 minutes.
              wk.status = age < 120 * 1000 ? 'online' : 'offline';
              wk.health = workerHealth(wk);

              // iter28-fix-B: push to statusHistory ring buffer once per ~15 min.
              // Throttle so duplicate pushes within 14m are skipped (poller fires
              // every 5s so without throttle we'd get 180 samples per 15min slot).
              if (!Array.isArray(wk.statusHistory)) wk.statusHistory = [];
              const lastSample = wk.statusHistory[wk.statusHistory.length - 1];
              const FIFTEEN_MIN_MS = 15 * 60 * 1000;
              if (!lastSample || (Date.now() - lastSample.ts) >= (FIFTEEN_MIN_MS - 60000)) {
                wk.statusHistory.push({ ts: Date.now(), status: wk.status });
                if (wk.statusHistory.length > 96) {
                  wk.statusHistory.splice(0, wk.statusHistory.length - 96);
                }
              }

              // refresh miner detection + IP on every poll — cheap and keeps IP fresh
              const prevSource = wk.minerSource;
              applyMinerDetection(wk, key);
              if (wk.minerSource === 'user-agent' && prevSource !== 'user-agent') {
                console.log(`[StatusPoller] Upgraded ${key} to UA-based detection: ${wk.minerType}`);
              }
            }
          } catch (e) {}
        }
      }

      cleanupStaleWorkers();
      // v1.11.8: throttle WS broadcasts to 3s minimum even though we poll
      // every 2s. Internal state stays fresh for HTTP /api/state callers
      // and for the next eligible broadcast cycle; this keeps perceived
      // dashboard latency low while only modestly increasing WS bandwidth
      // (~1.7× the prior 5s cadence vs the 2.5× full-rate would cost).
      const now = Date.now();
      if (now - lastBroadcastAt >= BROADCAST_MIN_INTERVAL_MS) {
        lastBroadcastAt = now;
        broadcast({ type: 'STATE_UPDATE', data: transformState(state, { compact: true }) });
      }
    } catch (e) {
      console.error('[StatusPoller]', e.message);
    }
  }

  // v1.11.8: poll every 2s (was 5s) so internal state stays fresh for the
  // HTTP API and so the next eligible broadcast tick has up-to-date data.
  // Broadcasts are throttled to ≥3s intervals inside poll() — see above.
  setInterval(poll, POLL_INTERVAL_MS);
  poll();
  console.log(`[StatusPoller] Started (poll ${POLL_INTERVAL_MS}ms, broadcast ≥${BROADCAST_MIN_INTERVAL_MS}ms, keep ${HISTORY_MAX_POINTS}pts/24h + ${WEEK_MAX_POINTS}pts/7d)`);
}

module.exports = { startStatusPoller };
