const fs = require('fs-extra');
const path = require('path');
const chokidar = require('chokidar');

// Regex patterns for ckpool log lines we care about.
// ckpool-solo logs don't include user-agent strings, but they DO include IPs
// on "Authorised client" lines, which is exactly what we need for the
// "click IP to open miner web UI" feature.
const AUTH_PATTERN = /Authorised\s+client\s+(\d+)\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+worker\s+(\S+)\s+as\s+user/i;
const DROP_PATTERN = /Dropped\s+client\s+(\d+)\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s+user\s+\S+\s+worker\s+(\S+)/i;
// Some ckpool builds emit useragent strings on subscribe lines — capture if present
const UA_PATTERN   = /client\s+(\d+)\s+.*useragent[=:\s]+"?([^"\n\r]+)"?/i;

// v1.11.x MEMORY LEAK FIX:
// metaByWorker entries persist indefinitely — they only ever get .set(), never
// .delete(). With a stable fleet this is fine (one entry per known worker),
// but if random testers point miners at your pool with ever-changing worker
// names, or if a single miner cycles labels across firmware reboots, this
// Map grows unboundedly and bloats worker-meta.json on disk.
//
// Fix: prune entries with lastSeen older than MAX_META_AGE_MS. Sweep runs
// hourly. Old entries are also purged on startup load.
const MAX_META_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PRUNE_INTERVAL_MS = 60 * 60 * 1000;          // hourly

// In-memory cache of per-worker metadata
// { workerName -> { ip, clientId, userAgent, authorisedAt, lastSeen } }
const metaByWorker = new Map();
// client_id -> workerName for correlation when only client_id is in a log line
const clientIdToWorker = new Map();

function getMetaForWorker(workerName) {
  if (!workerName) return null;
  return metaByWorker.get(workerName) || null;
}

function getIpForWorker(workerName) {
  const m = metaByWorker.get(workerName);
  return m?.ip || null;
}

function getAllMeta() {
  return Array.from(metaByWorker.entries()).map(([name, meta]) => ({ name, ...meta }));
}

async function loadMetaCache(configDir) {
  const file = path.join(configDir, 'worker-meta.json');
  try {
    if (await fs.pathExists(file)) {
      const data = await fs.readJson(file);
      if (data && typeof data === 'object' && data.byWorker) {
        // v1.11.x MEMORY LEAK FIX: prune entries with lastSeen older than
        // MAX_META_AGE_MS. Previously this Map grew unboundedly across restarts.
        const ageCutoff = Date.now() - MAX_META_AGE_MS;
        let loaded = 0, pruned = 0;
        for (const [name, meta] of Object.entries(data.byWorker)) {
          if (!meta || typeof meta !== 'object') continue;
          // UPGRADE-SAFE BACKFILL: any entry missing lastSeen (shouldn't
          // happen since every set() includes it, but defensive) gets a
          // grace period from this deploy rather than being pruned.
          if (typeof meta.lastSeen !== 'number') {
            meta.lastSeen = Date.now();
          }
          if (meta.lastSeen >= ageCutoff) {
            metaByWorker.set(name, meta);
            loaded++;
          } else {
            pruned++;
          }
        }
        console.log(`[UA-Tailer] Loaded ${loaded} cached worker metadata entries (pruned ${pruned} stale)`);
      }
    }
  } catch (e) {
    console.error('[UA-Tailer] load cache failed:', e.message);
  }
}

let saveTimer = null;
function scheduleMetaSave(configDir) {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    const file = path.join(configDir, 'worker-meta.json');
    try {
      const byWorker = {};
      for (const [name, meta] of metaByWorker.entries()) {
        byWorker[name] = meta;
      }
      await fs.ensureDir(configDir);
      await fs.writeJson(file, { savedAt: Date.now(), byWorker }, { spaces: 2 });
    } catch (e) {
      console.error('[UA-Tailer] save cache failed:', e.message);
    }
  }, 3000);
}

function parseLine(line, configDir) {
  // Authorised line — IP + workername + client_id in one shot
  const authMatch = line.match(AUTH_PATTERN);
  if (authMatch) {
    const [, clientId, ip, workerName] = authMatch;
    const prev = metaByWorker.get(workerName) || {};
    const meta = {
      ...prev,
      ip,
      clientId,
      authorisedAt: Date.now(),
      lastSeen: Date.now(),
    };
    metaByWorker.set(workerName, meta);
    clientIdToWorker.set(clientId, workerName);
    scheduleMetaSave(configDir);
    return;
  }

  // Dropped line — just update lastSeen
  const dropMatch = line.match(DROP_PATTERN);
  if (dropMatch) {
    const [, clientId, , workerName] = dropMatch;
    const prev = metaByWorker.get(workerName);
    if (prev) {
      prev.lastSeen = Date.now();
      metaByWorker.set(workerName, prev);
      scheduleMetaSave(configDir);
    }
    clientIdToWorker.delete(clientId);
    return;
  }

  // User-agent line (rare on ckpool-solo but handle just in case)
  const uaMatch = line.match(UA_PATTERN);
  if (uaMatch) {
    const [, clientId, userAgent] = uaMatch;
    const workerName = clientIdToWorker.get(clientId);
    if (workerName) {
      const prev = metaByWorker.get(workerName) || {};
      metaByWorker.set(workerName, { ...prev, userAgent, lastSeen: Date.now() });
      scheduleMetaSave(configDir);
    }
  }
}

async function startUaTailer({ configDir, logDir }) {
  await loadMetaCache(configDir);

  // v1.11.x MEMORY LEAK FIX: hourly prune of stale metaByWorker entries.
  // Without this, every unique worker name ever seen accumulates forever.
  setInterval(() => {
    const ageCutoff = Date.now() - MAX_META_AGE_MS;
    let pruned = 0;
    for (const [name, meta] of metaByWorker.entries()) {
      const lastSeen = (meta && typeof meta.lastSeen === 'number') ? meta.lastSeen : 0;
      if (lastSeen < ageCutoff) {
        metaByWorker.delete(name);
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`[UA-Tailer] Pruned ${pruned} stale worker metadata entries (now tracking ${metaByWorker.size})`);
      scheduleMetaSave(configDir);
    }
  }, PRUNE_INTERVAL_MS).unref();

  const logFile = path.join(logDir, 'ckpool.log');
  let fileSize = 0;

  // On boot, seek to end of current log so we don't re-parse history
  try {
    const stat = await fs.stat(logFile);
    fileSize = stat.size;
  } catch {}

  const read = async () => {
    try {
      const stat = await fs.stat(logFile).catch(() => null);
      if (!stat) return;
      if (stat.size < fileSize) fileSize = 0; // rotation
      if (stat.size <= fileSize) return;
      const buf = Buffer.alloc(stat.size - fileSize);
      const fd = await fs.open(logFile, 'r');
      try { await fs.read(fd, buf, 0, buf.length, fileSize); }
      finally { await fs.close(fd); }
      fileSize = stat.size;
      buf.toString('utf8').split('\n').forEach(l => l.trim() && parseLine(l, configDir));
    } catch (e) { console.error('[UA-Tailer]', e.message); }
  };

  chokidar.watch(logFile, { usePolling: true, interval: 1000 }).on('change', read).on('add', read);
  console.log(`[UA-Tailer] Watching ${logFile} for auth/drop/ua events`);
}

module.exports = {
  startUaTailer,
  getMetaForWorker,
  getIpForWorker,
  getAllMeta,
};
