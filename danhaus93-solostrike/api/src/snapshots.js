const fs = require('fs-extra');
const path = require('path');

const MAX_DAILY_SNAPSHOTS = 90;
const MAX_CLOSEST_CALLS   = 10;

function todayUtcKey(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function loadSnapshots(configDir) {
  const file = path.join(configDir, 'snapshots.json');
  try {
    if (await fs.pathExists(file)) {
      const data = await fs.readJson(file);
      return {
        daily:           Array.isArray(data.daily)        ? data.daily.slice(-MAX_DAILY_SNAPSHOTS) : [],
        closestCalls:    Array.isArray(data.closestCalls) ? data.closestCalls.slice(0, MAX_CLOSEST_CALLS) : [],
        lastRollupDate:  data.lastRollupDate || null,
      };
    }
  } catch (e) {
    console.error('[Snapshots] load failed:', e.message);
  }
  return { daily: [], closestCalls: [], lastRollupDate: null };
}

async function saveSnapshots(configDir, snapshots) {
  const file = path.join(configDir, 'snapshots.json');
  try {
    await fs.ensureDir(configDir);
    await fs.writeJson(file, {
      savedAt:        Date.now(),
      daily:          (snapshots.daily || []).slice(-MAX_DAILY_SNAPSHOTS),
      closestCalls:   (snapshots.closestCalls || []).slice(0, MAX_CLOSEST_CALLS),
      lastRollupDate: snapshots.lastRollupDate || null,
    }, { spaces: 2 });
  } catch (e) {
    console.error('[Snapshots] save failed:', e.message);
  }
}

// Capture a daily snapshot from current state
function captureDailySnapshot(state) {
  const hist = state.hashrate?.history || [];
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const recentPoints = hist.filter(p => p && p.ts >= dayAgo);

  let avgHr = 0, peakHr = 0;
  if (recentPoints.length > 0) {
    const sum = recentPoints.reduce((s, p) => s + (p.hr || 0), 0);
    avgHr  = sum / recentPoints.length;
    peakHr = Math.max(...recentPoints.map(p => p.hr || 0));
  }

  const workers = Object.values(state.workers || {});
  const workersOnline = workers.filter(w => w.status !== 'offline').length;

  return {
    date:          todayUtcKey(),
    capturedAt:    now,
    avgHashrate:   avgHr,
    peakHashrate:  peakHr,
    currentHashrate: state.hashrate?.current || 0,
    workAccepted:  state.shares?.accepted || 0,
    workRejected:  state.shares?.rejected || 0,
    bestShare:     state.bestshare || 0,
    blocksFound:   (state.blocks || []).length,
    workersTotal:  workers.length,
    workersOnline,
  };
}

// Insert a new daily snapshot (replaces existing entry for the same date)
function applyDailySnapshot(snapshots, snap) {
  const existingIdx = snapshots.daily.findIndex(s => s.date === snap.date);
  if (existingIdx >= 0) {
    snapshots.daily[existingIdx] = snap;
  } else {
    snapshots.daily.push(snap);
  }
  // keep sorted by date ascending
  snapshots.daily.sort((a, b) => a.date.localeCompare(b.date));
  // trim
  if (snapshots.daily.length > MAX_DAILY_SNAPSHOTS) {
    snapshots.daily = snapshots.daily.slice(-MAX_DAILY_SNAPSHOTS);
  }
}

// Update closest-calls leaderboard based on current worker bestshares
// Returns true if the leaderboard changed (caller should persist)
function updateClosestCalls(snapshots, state) {
  if (!Array.isArray(snapshots.closestCalls)) snapshots.closestCalls = [];
  const workers = Object.values(state.workers || {});

  let changed = false;

  for (const w of workers) {
    const diff = w.bestshare || 0;
    if (diff <= 0) continue;

    // find if this worker already has an entry with equal or higher diff
    const existing = snapshots.closestCalls.find(c => c.workerName === w.name);
    if (existing && existing.diff >= diff) continue;

    // remove any old entry for this worker
    snapshots.closestCalls = snapshots.closestCalls.filter(c => c.workerName !== w.name);

    // insert new entry
    snapshots.closestCalls.push({
      workerName: w.name,
      minerType:  w.minerType || null,
      diff,
      ts:         Date.now(),
    });
    changed = true;
  }

  if (changed) {
    snapshots.closestCalls.sort((a, b) => b.diff - a.diff);
    if (snapshots.closestCalls.length > MAX_CLOSEST_CALLS) {
      snapshots.closestCalls = snapshots.closestCalls.slice(0, MAX_CLOSEST_CALLS);
    }
  }
  return changed;
}

// Schedule UTC-midnight rollups. Also immediately runs a rollup if we've passed
// midnight since last rollup (catches restarts).
function startSnapshotScheduler({ state, snapshots, configDir, intervalMs = 60 * 1000 }) {
  const tick = async () => {
    try {
      const todayKey = todayUtcKey();

      // Capture-if-needed logic:
      // - If lastRollupDate is not today, roll up yesterday's final snapshot and save
      // - Also keep updating today's snapshot so we always have a fresh view
      const snap = captureDailySnapshot(state);
      applyDailySnapshot(snapshots, snap);

      if (snapshots.lastRollupDate !== todayKey) {
        snapshots.lastRollupDate = todayKey;
        await saveSnapshots(configDir, snapshots);
        console.log(`[Snapshots] Daily rollup completed for ${todayKey} (avg: ${(snap.avgHashrate/1e12).toFixed(2)} TH/s)`);
      }

      // Closest calls can change at any time as bestshares grow
      const ccChanged = updateClosestCalls(snapshots, state);
      if (ccChanged) {
        await saveSnapshots(configDir, snapshots);
      }
    } catch (e) {
      console.error('[Snapshots] tick error:', e.message);
    }
  };

  // First tick soon after boot (5s delay to let state settle)
  setTimeout(tick, 5000);
  // Then every minute
  setInterval(tick, intervalMs);

  console.log(`[Snapshots] Scheduler started (interval ${intervalMs/1000}s, daily rollup at UTC midnight)`);
}

module.exports = {
  loadSnapshots,
  saveSnapshots,
  captureDailySnapshot,
  applyDailySnapshot,
  updateClosestCalls,
  startSnapshotScheduler,
  MAX_DAILY_SNAPSHOTS,
  MAX_CLOSEST_CALLS,
};
