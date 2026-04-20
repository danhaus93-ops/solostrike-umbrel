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
  if (str.endsWith('E')) return num * 1e18;
  if (str.endsWith('P')) return num * 1e15;
  if (str.endsWith('T')) return num * 1e12;
  if (str.endsWith('G')) return num * 1e9;
  if (str.endsWith('M')) return num * 1e6;
  if (str.endsWith('K')) return num * 1e3;
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
}

// ── Rolling averages over history ring buffer ────────────────────────────────
// history is an array of { ts, hr } points. Already capped at 1440 (24h).
// For 7d we also need longer retention, so we maintain a secondary sparse buffer.
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

function startStatusPoller(state, broadcast, logDir) {
  const poolStatus = path.join(logDir, 'pool/pool.status');
  const usersDir   = path.join(logDir, 'users');
  const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

  const HISTORY_INTERVAL_MS = 60 * 1000;
  const HISTORY_MAX_POINTS  = 1440;       // 24h at 1min resolution
  const WEEK_MAX_POINTS     = 10080;      // 7d at 1min resolution (same cadence)
  const WEEK_INTERVAL_MS    = 60 * 1000;  // 1-min sample kept separately for 7d span
  let lastHistoryPush = 0;
  let lastWeekPush = 0;

  // Ensure the week ring exists on state for persistence
  if (!Array.isArray(state.hashrate.week)) state.hashrate.week = [];
  if (!state.hashrate.averages) state.hashrate.averages = {};

  function cleanupStaleWorkers() {
    const now = Date.now();
    for (const key of Object.keys(state.workers)) {
      const w = state.workers[key];
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
      hr1h:  computeAverage(shortHist, 60 * 60 * 1000),
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

            // 24h ring buffer (1-min cadence)
            if (now - lastHistoryPush >= HISTORY_INTERVAL_MS) {
              state.hashrate.history.push({ ts: now, hr });
              if (state.hashrate.history.length > HISTORY_MAX_POINTS) {
                state.hashrate.history.shift();
              }
              lastHistoryPush = now;
            }

            // 7d ring buffer (1-min cadence, 10080 points)
            if (now - lastWeekPush >= WEEK_INTERVAL_MS) {
              state.hashrate.week.push({ ts: now, hr });
              if (state.hashrate.week.length > WEEK_MAX_POINTS) {
                state.hashrate.week.shift();
              }
              lastWeekPush = now;
            }

            // Recompute averages every poll
            refreshAverages();

            state.shares.accepted      = shares.accepted      || 0;
            state.shares.rejected      = shares.rejected      || 0;
            state.shares.acceptedCount = shares.acceptedCount || 0;
            state.shares.rejectedCount = shares.rejectedCount || 0;
            state.shares.stale         = shares.stale         || 0;
            state.shares.sps1m         = shares.SPS1m         || 0;
            state.bestshare            = shares.bestshare     || 0;
            state.totalWorkers         = summary.Workers      || 0;
            state.totalUsers           = summary.Users        || 0;
          } catch (e) {}
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
                  minerType: null, minerIcon: '▪', minerVendor: null,
                  minerSource: 'unknown', userAgent: null,
                  health: 'green',
                };
                applyMinerDetection(state.workers[key], key);
              }
              const wk = state.workers[key];
              wk.hashrate       = parseHashrate(w.hashrate1m);
              wk.hashrate5m     = parseHashrate(w.hashrate5m);
              wk.hashrate1h     = parseHashrate(w.hashrate1hr);
              wk.hashrate24h    = parseHashrate(w.hashrate1d);
              wk.hashrate7d    = parseHashrate(w.hashrate7d);
              wk.shares         = w.shares         || 0;
              wk.rejected       = w.rejected       || wk.rejected || 0;
              wk.sharesCount    = w.sharesCount    || w.shares_count   || 0;
              wk.rejectedCount  = w.rejectedCount  || w.rejected_count || 0;
              wk.bestshare      = w.bestshare      || 0;
              wk.diff           = w.lastdiff       || w.diff || wk.diff || 0;
              wk.lastSeen       = (w.lastshare || Math.floor(Date.now()/1000)) * 1000;
              const age = Date.now() - wk.lastSeen;
              wk.status = age < 10 * 60 * 1000 ? 'online' : 'offline';
              wk.health = workerHealth(wk);

              if (!wk.minerType || wk.minerSource !== 'user-agent') {
                const prevSource = wk.minerSource;
                applyMinerDetection(wk, key);
                if (wk.minerSource === 'user-agent' && prevSource !== 'user-agent') {
                  console.log(`[StatusPoller] Upgraded ${key} to UA-based detection: ${wk.minerType}`);
                }
              }
            }
          } catch (e) {}
        }
      }

      cleanupStaleWorkers();
      broadcast({ type: 'STATE_UPDATE', data: transformState(state) });
    } catch (e) {
      console.error('[StatusPoller]', e.message);
    }
  }

  setInterval(poll, 5000);
  poll();
  console.log(`[StatusPoller] Started (poll 5s, keep ${HISTORY_MAX_POINTS}pts/24h + ${WEEK_MAX_POINTS}pts/7d, averages computed live)`);
}

module.exports = { startStatusPoller };
