// Tails ckpool's pool.log, extracts mining.subscribe user-agents per
// workername, and maintains a persistent cache at CONFIG_DIR/worker-meta.json.
//
// ckpool log format varies by version. We match multiple patterns:
//   - "Authorised client ...user=bc1q...addr.worker useragent=cgminer/4.12"
//   - "Added client .../bc1q...addr.worker using user agent 'cgminer/4.12'"
//   - "Subscribed: bc1q...addr.worker (cgminer/4.12)"
// Also captures client_id -> workername mapping so we can correlate
// subscribe events (which come before authorise) with the workername.

const fs = require('fs-extra');
const path = require('path');
const { detectFromUserAgent } = require('./ua-patterns');

// Map of client_id -> userAgent seen in mining.subscribe (before authorise).
const pendingByClientId = new Map();
const PENDING_MAX = 500;

// In-memory cache: workername -> { userAgent, minerType, minerIcon, minerVendor, firstSeen, lastSeen }
let metaCache = {};
let cachePath = null;
let saveTimer = null;
let SAVE_DEBOUNCE_MS = 2000;

function loadMeta(configDir) {
  cachePath = path.join(configDir, 'worker-meta.json');
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf8');
      metaCache = JSON.parse(raw) || {};
      console.log(`[UaTailer] Loaded ${Object.keys(metaCache).length} cached worker metas from ${cachePath}`);
    }
  } catch (e) {
    console.error('[UaTailer] Failed to load worker-meta.json:', e.message);
    metaCache = {};
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await fs.ensureDir(path.dirname(cachePath));
      await fs.writeFile(cachePath, JSON.stringify(metaCache, null, 2));
    } catch (e) {
      console.error('[UaTailer] Save failed:', e.message);
    }
  }, SAVE_DEBOUNCE_MS);
}

// Cap map size to avoid unbounded growth on long-lived pools with churn.
function trimPending() {
  if (pendingByClientId.size <= PENDING_MAX) return;
  const toDelete = pendingByClientId.size - PENDING_MAX;
  let i = 0;
  for (const key of pendingByClientId.keys()) {
    if (i++ >= toDelete) break;
    pendingByClientId.delete(key);
  }
}

function recordMeta(workername, userAgent) {
  if (!workername || !userAgent) return false;
  const det = detectFromUserAgent(userAgent);
  const now = Date.now();
  const existing = metaCache[workername];
  const changed = !existing || existing.userAgent !== userAgent || existing.minerType !== det.type;
  metaCache[workername] = {
    userAgent,
    minerType: det.type,
    minerIcon: det.icon,
    minerVendor: det.vendor,
    firstSeen: existing?.firstSeen || now,
    lastSeen: now,
  };
  if (changed) {
    scheduleSave();
    console.log(`[UaTailer] ${workername} -> ${det.type || 'Unknown'} (ua="${userAgent.slice(0, 60)}")`);
  }
  return true;
}

// Parsers for different ckpool log line formats.
// Return { workername, userAgent } or null.
function parseLine(line) {
  if (!line || typeof line !== 'string') return null;

  // Pattern A: authorise line with explicit useragent kv
  //   "... Authorised client ... user=<workername> ... useragent=<ua>"
  let m = line.match(/user=([^\s,]+).*?useragent=([^,\n\r]+?)(?=[,\s]*(?:$|[A-Za-z_]+=))/i);
  if (m) return { workername: m[1], userAgent: m[2].trim().replace(/^["']|["']$/g, '') };

  // Pattern B: "Added client <ip> using user agent '<ua>' as <workername>"
  m = line.match(/using user agent ['"]([^'"]+)['"].*?as\s+([^\s,]+)/i);
  if (m) return { workername: m[2], userAgent: m[1] };

  // Pattern C: "Subscribed: <workername> (<ua>)"
  m = line.match(/subscribed:?\s+([^\s(]+)\s*\(([^)]+)\)/i);
  if (m) return { workername: m[1], userAgent: m[2] };

  // Pattern D: two-line correlation via client_id — subscribe sets pending.
  //   "... Client <id> ... subscribed ... useragent <ua>"
  //   "... Client <id> ... authorised ... workername <name>"
  m = line.match(/client\s+(\d+).*?subscrib(?:ed|e).*?(?:useragent|user agent|ua)\s*[:= ]\s*['"]?([^'"\n,]+)/i);
  if (m) {
    pendingByClientId.set(m[1], m[2].trim());
    trimPending();
    return null;
  }

  // Pattern E: authorise that references a client_id whose subscribe we saw.
  //   "... Client <id> ... authoris(ed|e) ... (?:worker|user)=<workername>"
  m = line.match(/client\s+(\d+).*?authoris.*?(?:worker|user)\s*[:= ]\s*([^\s,]+)/i);
  if (m) {
    const ua = pendingByClientId.get(m[1]);
    if (ua) {
      pendingByClientId.delete(m[1]);
      return { workername: m[2], userAgent: ua };
    }
  }

  return null;
}

// Tails a file from its current end. Rotates handle on truncate / unlink.
function tailFile(filepath, onLine) {
  let position = 0;
  let opened = false;
  let buffer = '';
  let watcher = null;

  const reopen = async () => {
    try {
      const stat = await fs.stat(filepath);
      position = stat.size;
      opened = true;
    } catch { opened = false; }
  };

  const readAppend = async () => {
    if (!opened) { await reopen(); return; }
    try {
      const stat = await fs.stat(filepath);
      if (stat.size < position) {
        // file rotated / truncated
        position = 0;
      }
      if (stat.size === position) return;
      const stream = fs.createReadStream(filepath, { start: position, end: stat.size - 1, encoding: 'utf8' });
      let chunk = '';
      stream.on('data', d => { chunk += d; });
      stream.on('end', () => {
        position = stat.size;
        buffer += chunk;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop(); // keep partial last line
        for (const ln of lines) {
          try { onLine(ln); } catch (e) { console.error('[UaTailer] line handler:', e.message); }
        }
      });
      stream.on('error', () => {});
    } catch {
      opened = false;
    }
  };

  reopen().then(() => {
    // Poll-based tail: simpler and more reliable than fs.watch across
    // bind mounts and log rotation. 1-second interval is fine here.
    const id = setInterval(readAppend, 1000);
    watcher = { stop: () => clearInterval(id) };
  });

  return { stop: () => watcher && watcher.stop() };
}

function startUaTailer({ configDir, logDir }) {
  loadMeta(configDir);
  const poolLog = path.join(logDir, 'ckpool.log');
  const tailer = tailFile(poolLog, (line) => {
    const parsed = parseLine(line);
    if (parsed) recordMeta(parsed.workername, parsed.userAgent);
  });
  console.log(`[UaTailer] Started, tailing ${poolLog}`);
  return tailer;
}

function getMetaForWorker(workername) {
  return metaCache[workername] || null;
}

function getAllMeta() {
  return { ...metaCache };
}

module.exports = { startUaTailer, getMetaForWorker, getAllMeta, loadMeta, parseLine };
