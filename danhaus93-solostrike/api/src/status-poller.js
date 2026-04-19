const fs = require('fs-extra');
const path = require('path');
const { transformState } = require('./state-transform');
const { detectMiner, workerHealth } = require('./miner-detect');

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

function startStatusPoller(state, broadcast, logDir) {
  const poolStatus = path.join(logDir, 'pool/pool.status');
  const usersDir   = path.join(logDir, 'users');

  const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

  function cleanupStaleWorkers() {
    const now = Date.now();
    for (const key of Object.keys(state.workers)) {
      const w = state.workers[key];
      if (w.lastSeen && (now - w.lastSeen) > STALE_THRESHOLD_MS) {
        delete state.workers[key];
      }
    }
  }

  // Rolling hashrate*time integral for Luck calculation.
  // Stored at state._avgState (top level) — NOT inside state.hashrate — so it
  // never leaks into any serialization that skips transformState().
  function updateAvgHashrate(current) {
    const now = Date.now();
    if (!state._avgState) state._avgState = { lastTs: now, totalHashTime: 0 };
    const a = state._avgState;
    const dt = (now - a.lastTs) / 1000;
    if (dt > 0 && dt < 3600) a.totalHashTime += current * dt;
    a.lastTs = now;
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
            state.hashrate.history.push({ ts: Date.now(), hr });
            if (state.hashrate.history.length > 360) state.hashrate.history.shift();
            updateAvgHashrate(hr);
            state.shares.accepted  = shares.accepted  || 0;
            state.shares.rejected  = shares.rejected  || 0;
            state.shares.stale     = shares.stale || shares.sps || 0;
            state.bestshare        = shares.bestshare || 0;
            state.totalWorkers     = summary.Workers  || 0;
            state.totalUsers       = summary.Users    || 0;
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
                const meta = detectMiner(key);
                state.workers[key] = {
                  name: key,
                  hashrate: 0, shares: 0, rejected: 0,
                  lastSeen: Date.now(), diff: 0, status: 'online',
                  bestshare: 0,
                  minerType: meta.type, minerIcon: meta.icon, minerVendor: meta.vendor,
                  health: 'green',
                };
              }
              const wk = state.workers[key];
              wk.hashrate  = parseHashrate(w.hashrate1m);
              wk.shares    = w.shares    || 0;
              wk.rejected  = w.rejected  || wk.rejected || 0;
              wk.bestshare = w.bestshare || 0;
              wk.diff      = w.lastdiff || w.diff || wk.diff || 0;
              wk.lastSeen  = (w.lastshare || Math.floor(Date.now()/1000)) * 1000;
              const age = Date.now() - wk.lastSeen;
              wk.status = age < 10 * 60 * 1000 ? 'online' : 'offline';
              wk.health = workerHealth(wk);
              if (!wk.minerType) {
                const meta = detectMiner(key);
                wk.minerType = meta.type; wk.minerIcon = meta.icon; wk.minerVendor = meta.vendor;
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
  console.log('[StatusPoller] Started, polling every 5s (cleanup > 24h stale)');
}

module.exports = { startStatusPoller };
