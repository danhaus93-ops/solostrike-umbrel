// ── Miner poller (v1.9.0) ───────────────────────────────────────────────────
//
// Polls each authorised miner over the local network to gather two kinds of
// data, both READ-ONLY:
//
//   1. Pool alignment — verifies the miner is actually pointed at SoloStrike
//      by checking its configured pool list and matching against the user's
//      payout address. Catches "your miner is silently mining for someone
//      else" — the on-brand killer feature.
//
//   2. Live telemetry — temperatures, fan speeds, miner-reported hashrate,
//      hardware errors, firmware version. Catches hot/dying miners before
//      they thermal out.
//
// Both work via two protocol adapters:
//
//   * cgminer-JSON (TCP 4028, the de facto standard since 2011)
//     Used by: LuxOS, BraiinsOS, Vnish, Whatsminer, Avalon, Innosilicon,
//     Goldshell, iPollo, Bitmain stock with API enabled.
//     We send `pools|summary|stats` (pipe-separated multi-command) in a
//     single TCP connection and parse the combined response.
//
//   * ESP-Miner (HTTP REST GET on port 80)
//     Used by: BitAxe, NerdQaxe, NerdQaxe++, NerdMiner, Lucky Miner, PiAxe,
//     and similar single-board hobby ASICs.
//     We GET /api/system/info which returns JSON with temp, fanrpm, hashRate,
//     etc. directly. No separate "pools" endpoint exists — these miners
//     don't expose their pool config via API, so alignment status for them
//     is necessarily reported as "esp-no-pools" (unknown but not an error).
//
// Adapter dispatch uses the existing minerVendor classification from
// miner-detect.js (Bitmain/MicroBT/Canaan → cgminer; OSS/Shufps with
// type matching BitAxe/NerdQaxe → esp-miner). Unknown vendors try
// cgminer-JSON first, then fall back to ESP-Miner.
//
// Polling cadence: every 60 seconds. Each miner runs in parallel, with a
// 5-second per-miner timeout. Last result is persisted to disk so the UI
// shows status immediately after restart.

const net  = require('net');
const http = require('http');
const fs   = require('fs-extra');
const path = require('path');

const POLL_INTERVAL_MS  = 60_000;
const POLL_TIMEOUT_MS   = 5_000;
const CGMINER_PORT      = 4028;
const HTTP_PORT         = 80;
const CACHE_FILE_NAME   = 'miner-records.json';
const SAVE_DEBOUNCE_MS  = 2_000;

// In-memory unified record per worker:
//   alignment:   { status, activePool, activePoolUser, configuredPools }
//   live:        { tempC, tempDetails, fanRpm, fanPct, hashrateReported,
//                  hwErrors, uptimeSec, firmwareVersion }
//   adapter:     'cgminer'|'esp-miner'|null  (cached after first success)
//   lastCheckedAt, error
const records = new Map();

let pollerInterval     = null;
let getMetaFn          = null;
let getPayoutAddressFn = null;
let getWorkerVendorFn  = null;  // (workerName) → 'Bitmain'|'OSS'|... | null
let configDir          = null;
let enabled            = true;  // default ON; only disabled by config.json escape hatch
let saveTimer          = null;

// ── Public API ───────────────────────────────────────────────────────────────

async function startMinerPoller(opts) {
  getMetaFn          = opts.getMeta;
  getPayoutAddressFn = opts.getPayoutAddress;
  getWorkerVendorFn  = opts.getWorkerVendor;
  configDir          = opts.configDir;
  enabled            = opts.enabled !== false; // default true unless explicitly false

  await loadCache();

  // First poll fires after 10s (let ua-tailer harvest IPs first)
  if (enabled) {
    setTimeout(() => { pollAll().catch(() => {}); }, 10_000);
  }
  pollerInterval = setInterval(() => {
    if (enabled) pollAll().catch(() => {});
  }, POLL_INTERVAL_MS);

  return { ok: true };
}

function setEnabled(v) {
  const wasEnabled = enabled;
  enabled = !!v;
  if (enabled && !wasEnabled) {
    setTimeout(() => { pollAll().catch(() => {}); }, 1_000);
  } else if (!enabled && wasEnabled) {
    records.clear();
    scheduleSave();
  }
}

function isEnabled() { return enabled; }

function getRecordForWorker(workerName) {
  return records.get(workerName) || null;
}

function getAllRecords() {
  return Object.fromEntries(records);
}

// Back-compat: expose just the alignment slice for /api/miners/alignments
function getAlignmentForWorker(workerName) {
  const r = records.get(workerName);
  return r ? r.alignment || null : null;
}

function getAllAlignments() {
  const out = {};
  for (const [name, r] of records) {
    if (r && r.alignment) out[name] = { ...r.alignment, lastCheckedAt: r.lastCheckedAt };
  }
  return out;
}

// Slice access for live telemetry
function getLiveForWorker(workerName) {
  const r = records.get(workerName);
  return r ? r.live || null : null;
}

function getAllLive() {
  const out = {};
  for (const [name, r] of records) {
    if (r && r.live) out[name] = { ...r.live, lastCheckedAt: r.lastCheckedAt };
  }
  return out;
}

async function pollOne(workerName) {
  if (!getMetaFn) return null;
  const all = getMetaFn();
  const m = all.find(x => x.name === workerName);
  if (!m || !m.ip) {
    saveRecord(workerName, {
      alignment: { status: 'unknown', error: 'no_ip' },
      live: null,
      adapter: null,
      error: 'no_ip',
    });
    return getRecordForWorker(workerName);
  }
  await pollMiner(m.name, m.ip);
  return getRecordForWorker(workerName);
}

// ── Adapter dispatch ─────────────────────────────────────────────────────────

function isEspMinerVendor(workerName, vendor) {
  if (!vendor) return null;  // null = unknown, try cgminer first
  if (vendor === 'OSS' || vendor === 'Shufps') return true;
  if (vendor === 'Bitmain' || vendor === 'MicroBT' || vendor === 'Canaan'
      || vendor === 'Innosilicon' || vendor === 'Rented') return false;
  return null;
}

async function pollAll() {
  if (!getMetaFn) return;
  const allMeta = getMetaFn() || [];
  await Promise.allSettled(
    allMeta
      .filter(m => m && m.name && m.ip)
      .map(m => pollMiner(m.name, m.ip))
  );
}

async function pollMiner(workerName, ip) {
  const prev = records.get(workerName);
  let preferEsp = null;
  if (prev && prev.adapter === 'cgminer')   preferEsp = false;
  if (prev && prev.adapter === 'esp-miner') preferEsp = true;

  if (preferEsp === null && getWorkerVendorFn) {
    const vendor = getWorkerVendorFn(workerName);
    preferEsp = isEspMinerVendor(workerName, vendor);
  }

  let result;
  if (preferEsp === true) {
    result = await tryEspMiner(ip);
    if (!result.ok) {
      const fallback = await tryCgminer(ip);
      if (fallback.ok) result = fallback;
    }
  } else if (preferEsp === false) {
    result = await tryCgminer(ip);
    if (!result.ok) {
      const fallback = await tryEspMiner(ip);
      if (fallback.ok) result = fallback;
    }
  } else {
    result = await tryCgminer(ip);
    if (!result.ok) {
      const fallback = await tryEspMiner(ip);
      if (fallback.ok) result = fallback;
    }
  }

  if (!result.ok) {
    saveRecord(workerName, {
      alignment: { status: result.alignmentStatus || 'unreachable', error: result.error },
      live: null,
      adapter: prev ? prev.adapter : null,
      error: result.error,
    });
    return;
  }

  const payoutAddress = (getPayoutAddressFn && getPayoutAddressFn()) || null;
  const alignment = result.adapter === 'cgminer'
    ? computeAlignment(result.pools, payoutAddress)
    : { status: 'esp-no-pools', error: null, configuredPools: [] };

  saveRecord(workerName, {
    alignment,
    live: result.live,
    adapter: result.adapter,
    error: null,
  });
}

// ── cgminer-JSON adapter ─────────────────────────────────────────────────────

function tryCgminer(ip) {
  return new Promise((resolve) => {
    let resolved = false;
    let data = '';
    const socket = new net.Socket();
    socket.setNoDelay(true);

    const finish = (out) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch {}
      resolve(out);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, alignmentStatus: 'unreachable', error: 'timeout' });
    }, POLL_TIMEOUT_MS);

    socket.on('connect', () => {
      try {
        socket.write(JSON.stringify({ command: 'pools|summary|stats' }) + '\n');
      } catch (e) {
        clearTimeout(timer);
        finish({ ok: false, alignmentStatus: 'unreachable', error: 'write_failed' });
      }
    });

    socket.on('data', chunk => { data += chunk.toString('utf8'); });

    socket.on('end', () => {
      clearTimeout(timer);
      const cleaned = data.replace(/\x00/g, '').trim();
      if (!cleaned) {
        finish({ ok: false, alignmentStatus: 'disabled', error: 'empty_response' });
        return;
      }
      try {
        const parsed = JSON.parse(cleaned);
        const pools   = parsed.POOLS   || parsed.pools   || [];
        const summary = parsed.SUMMARY || parsed.summary || [];
        const stats   = parsed.STATS   || parsed.stats   || [];
        const live    = extractCgminerLive(summary, stats);
        finish({ ok: true, adapter: 'cgminer', pools, live });
      } catch (e) {
        finish({ ok: false, alignmentStatus: 'disabled', error: 'invalid_json' });
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      const code = err.code || '';
      const status = code === 'ECONNREFUSED' ? 'disabled' : 'unreachable';
      finish({ ok: false, alignmentStatus: status, error: code || 'unknown' });
    });

    try {
      socket.connect({ host: ip, port: CGMINER_PORT });
    } catch (e) {
      clearTimeout(timer);
      finish({ ok: false, alignmentStatus: 'unreachable', error: 'connect_threw' });
    }
  });
}

function extractCgminerLive(summary, stats) {
  const live = {
    tempC: null,
    tempDetails: [],
    fanRpm: null,
    fanPct: null,
    hashrateReported: null,
    hwErrors: null,
    uptimeSec: null,
    firmwareVersion: null,
  };

  const sm = Array.isArray(summary) ? summary[0] : summary;
  if (sm && typeof sm === 'object') {
    if (typeof sm.Elapsed === 'number')          live.uptimeSec = sm.Elapsed;
    if (typeof sm['Hardware Errors'] === 'number') live.hwErrors = sm['Hardware Errors'];
    if (typeof sm.HardwareErrors === 'number')   live.hwErrors = sm.HardwareErrors;

    const ghsAv = numOr(sm['GHS av']);
    const ghs5s = numOr(sm['GHS 5s']);
    const mhsAv = numOr(sm['MHS av']);
    const mhs5s = numOr(sm['MHS 5s']);
    const ths   = numOr(sm['THS av'] || sm['THS 5s']);
    if      (ths !== null)   live.hashrateReported = ths * 1e12;
    else if (ghs5s !== null) live.hashrateReported = ghs5s * 1e9;
    else if (ghsAv !== null) live.hashrateReported = ghsAv * 1e9;
    else if (mhs5s !== null) live.hashrateReported = mhs5s * 1e6;
    else if (mhsAv !== null) live.hashrateReported = mhsAv * 1e6;

    const sumT = numOr(sm.Temperature);
    if (sumT !== null && sumT > 0) live.tempC = sumT;
  }

  let maxTemp = null;
  let maxFanRpm = null;
  let maxFanPct = null;
  if (Array.isArray(stats)) {
    for (const s of stats) {
      if (!s || typeof s !== 'object') continue;
      const tempCands = [
        s.Temp, s.Temperature, s.temp,
        s.temp1, s.temp2, s.temp3, s.temp4,
        s['Temp1'], s['Temp2'], s['Temp3'], s['Temp4'],
        s.chip_temp_max, s.chain_temp_max,
        s['Chip Temp Max'], s['Chain Temp Max'],
      ];
      for (const c of tempCands) {
        const t = numOr(c);
        if (t !== null && t > 0 && t < 200) {
          if (maxTemp === null || t > maxTemp) maxTemp = t;
        }
      }

      const id = s.ID || s.id || s.Chain || (s.STATS != null ? `chain-${s.STATS}` : null);
      const boardTemps = tempCands.map(numOr).filter(t => t !== null && t > 0 && t < 200);
      if (boardTemps.length && id) {
        live.tempDetails.push({
          id: String(id),
          tempC: Math.max(...boardTemps),
        });
      }

      for (const k of ['Fan1','Fan2','Fan3','Fan4','fan1','fan2','fan3','fan4',
                       'fanspeed_in','fanspeed_out','FanSpeedIn','FanSpeedOut']) {
        const v = numOr(s[k]);
        if (v !== null && v > 0 && v < 20000) {
          if (maxFanRpm === null || v > maxFanRpm) maxFanRpm = v;
        }
      }
      const pctCands = [s['Fan%'], s.fan_pct, s['Fan Pct'], s.fanspeed_pct];
      for (const c of pctCands) {
        const v = numOr(c);
        if (v !== null && v >= 0 && v <= 100) {
          if (maxFanPct === null || v > maxFanPct) maxFanPct = v;
        }
      }

      if (!live.firmwareVersion) {
        live.firmwareVersion = s['Miner Version'] || s.MinerVersion
                            || s.Version || s.firmware_version || null;
      }
    }
  }

  if (maxTemp   !== null) live.tempC  = maxTemp;
  if (maxFanRpm !== null) live.fanRpm = maxFanRpm;
  if (maxFanPct !== null) live.fanPct = maxFanPct;

  return live;
}

// ── ESP-Miner adapter ────────────────────────────────────────────────────────

function tryEspMiner(ip) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (out) => {
      if (resolved) return;
      resolved = true;
      resolve(out);
    };

    const req = http.get({
      host: ip,
      port: HTTP_PORT,
      path: '/api/system/info',
      timeout: POLL_TIMEOUT_MS,
      headers: { 'Accept': 'application/json' },
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        finish({ ok: false, alignmentStatus: 'disabled', error: `http_${res.statusCode}` });
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const live = extractEspMinerLive(parsed);
          finish({ ok: true, adapter: 'esp-miner', pools: [], live });
        } catch (e) {
          finish({ ok: false, alignmentStatus: 'disabled', error: 'invalid_json' });
        }
      });
    });

    req.on('error', (err) => {
      const code = err.code || '';
      const status = code === 'ECONNREFUSED' ? 'disabled' : 'unreachable';
      finish({ ok: false, alignmentStatus: status, error: code || 'unknown' });
    });
    req.on('timeout', () => {
      try { req.destroy(); } catch {}
      finish({ ok: false, alignmentStatus: 'unreachable', error: 'timeout' });
    });
  });
}

function extractEspMinerLive(d) {
  if (!d || typeof d !== 'object') return null;
  const live = {
    tempC: null,
    tempDetails: [],
    fanRpm: null,
    fanPct: null,
    hashrateReported: null,
    hwErrors: null,
    uptimeSec: null,
    firmwareVersion: null,
  };
  if (typeof d.temp === 'number' && d.temp > 0)       live.tempC = d.temp;
  if (typeof d.fanrpm === 'number' && d.fanrpm >= 0)  live.fanRpm = d.fanrpm;
  if (typeof d.fanspeed === 'number' && d.fanspeed >= 0 && d.fanspeed <= 100)
    live.fanPct = d.fanspeed;
  if (typeof d.hashRate === 'number' && d.hashRate >= 0)
    live.hashrateReported = d.hashRate * 1e9;
  if (typeof d.uptimeSeconds === 'number')            live.uptimeSec = d.uptimeSeconds;
  if (typeof d.version === 'string')                  live.firmwareVersion = d.version;

  if (live.tempC !== null) {
    live.tempDetails.push({ id: 'asic', tempC: live.tempC });
  }
  if (typeof d.vrTemp === 'number' && d.vrTemp > 0) {
    live.tempDetails.push({ id: 'vr', tempC: d.vrTemp });
  }
  return live;
}

// ── Pool alignment computation ───────────────────────────────────────────────

function computeAlignment(pools, payoutAddress) {
  if (!payoutAddress) {
    return { status: 'unknown', error: 'no_payout_address', configuredPools: [] };
  }
  if (!Array.isArray(pools)) {
    return { status: 'disabled', error: 'pools_not_array', configuredPools: [] };
  }

  const configuredPools = pools.map(p => {
    const url      = p.URL ?? p.url ?? null;
    const user     = p.User ?? p.user ?? null;
    const priority = p.Priority ?? p.priority ?? null;
    const status   = p.Status ?? p.status ?? null;
    const active   = (p['Stratum Active'] === true)
                  || (p['Stratum_Active'] === true)
                  || (p.stratumActive === true)
                  || (p.is_active === true)
                  || false;
    return { url, user, priority, status, active };
  });

  // v1.9.2: empty pools array — firmware responded but didn't list any
  // pools. Could mean the miner truly has none, or the firmware doesn't
  // expose pool config via this command. Don't accuse it of being misaligned.
  if (configuredPools.length === 0) {
    return { status: 'unknown', error: 'no_pools_data', configuredPools: [] };
  }

  // v1.9.2: some firmware (Avalon Nano 3S notably) returns pool entries
  // without User credentials — they redact the username for security. We
  // can't determine alignment from URL alone (URLs can be umbrel.local /
  // LAN IP / DDNS, no canonical form). Mark as unknown rather than
  // misaligned to avoid scaring the user about a working miner.
  const activePool = configuredPools.find(p => p.active) || null;
  const anyUserData = configuredPools.some(p =>
    typeof p.user === 'string' && p.user.trim().length > 0);
  if (!anyUserData) {
    return {
      status: 'unverifiable',
      error: 'no_user_data',
      activePool: activePool ? activePool.url : null,
      configuredPools,
    };
  }

  // v1.9.2: case-insensitive match + trim whitespace. Bech32 addresses are
  // canonically lowercase but some firmware uppercases them. Also handles
  // any leading/trailing whitespace the firmware might add.
  const lcAddr = String(payoutAddress).trim().toLowerCase();
  const ssPools = configuredPools.filter(p =>
    typeof p.user === 'string' && p.user.trim().toLowerCase().startsWith(lcAddr)
  );

  if (!ssPools.length) {
    return {
      status: 'misaligned',
      activePool: activePool ? activePool.url : null,
      activePoolUser: activePool ? activePool.user : null,
      configuredPools,
    };
  }
  const ssIsActive = ssPools.some(p => p.active);
  if (ssIsActive) {
    return {
      status: 'aligned',
      activePool: activePool.url,
      activePoolUser: activePool.user,
      configuredPools,
    };
  }
  return {
    status: 'backup',
    activePool: activePool ? activePool.url : null,
    activePoolUser: activePool ? activePool.user : null,
    configuredPools,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function numOr(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function saveRecord(workerName, partial) {
  records.set(workerName, { ...partial, lastCheckedAt: Date.now() });
  scheduleSave();
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await saveCache();
  }, SAVE_DEBOUNCE_MS);
}

async function saveCache() {
  if (!configDir) return;
  try {
    const file = path.join(configDir, CACHE_FILE_NAME);
    await fs.ensureDir(configDir);
    await fs.writeJson(file, {
      savedAt: Date.now(),
      records: Object.fromEntries(records),
    }, { spaces: 2 });
  } catch (e) {
    console.error('[miner-poller] save failed:', e.message);
  }
}

async function loadCache() {
  if (!configDir) return;
  const file = path.join(configDir, CACHE_FILE_NAME);
  try {
    if (!(await fs.pathExists(file))) return;
    const data = await fs.readJson(file);
    if (data && typeof data.records === 'object') {
      for (const [name, val] of Object.entries(data.records)) {
        records.set(name, val);
      }
      console.log(`[miner-poller] loaded ${records.size} cached records`);
    }
  } catch (e) {
    console.error('[miner-poller] load failed:', e.message);
  }
}

module.exports = {
  startMinerPoller,
  setEnabled,
  isEnabled,
  getRecordForWorker,
  getAllRecords,
  getAlignmentForWorker,
  getAllAlignments,
  getLiveForWorker,
  getAllLive,
  pollOne,
};
