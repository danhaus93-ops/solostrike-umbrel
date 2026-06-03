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
//
// v1.9.4 change: previously sent `pools|summary|stats` as a single multi-
// command in one TCP connection. That works on LuxOS, BraiinsOS, Vnish, and
// stock Bitmain — but the Avalon Nano 3S (and likely some other minimalist
// firmwares) only honors the first command and drops the rest, so we got
// pool data but no temps/fans. Now we issue three independent commands in
// parallel TCP connections and merge the results. Slightly more network
// chatter, but trivial at fleet scale and dramatically more compatible.

function tryCgminer(ip) {
  return new Promise(async (resolve) => {
    const [poolsRes, summaryRes, statsRes] = await Promise.all([
      cgminerCommand(ip, 'pools'),
      cgminerCommand(ip, 'summary'),
      cgminerCommand(ip, 'stats'),
    ]);

    // If ALL three failed, treat as unreachable/disabled. We surface the
    // most informative error (prefer ECONNREFUSED → 'disabled', else
    // 'unreachable').
    if (!poolsRes.ok && !summaryRes.ok && !statsRes.ok) {
      const allRefused = [poolsRes, summaryRes, statsRes].every(r => r.error === 'ECONNREFUSED');
      const status = allRefused ? 'disabled' : 'unreachable';
      const err    = poolsRes.error || summaryRes.error || statsRes.error || 'unknown';
      resolve({ ok: false, alignmentStatus: status, error: err });
      return;
    }

    // At least one command succeeded. Treat the connection as live cgminer.
    // Merge whatever data we got — partial results are fine.
    const pools   = poolsRes.ok   ? (poolsRes.data.POOLS   || poolsRes.data.pools   || []) : [];
    const summary = summaryRes.ok ? (summaryRes.data.SUMMARY || summaryRes.data.summary || []) : [];
    const stats   = statsRes.ok   ? (statsRes.data.STATS   || statsRes.data.stats   || []) : [];
    const live    = extractCgminerLive(summary, stats);

    resolve({ ok: true, adapter: 'cgminer', pools, live });
  });
}

// Single cgminer-JSON command in its own short-lived TCP connection.
// Returns { ok: true, data } on success or { ok: false, error } on failure.
function cgminerCommand(ip, command) {
  return new Promise((resolve) => {
    let resolved = false;
    let buf = '';
    const socket = new net.Socket();
    socket.setNoDelay(true);

    const finish = (out) => {
      if (resolved) return;
      resolved = true;
      try { socket.destroy(); } catch {}
      resolve(out);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: 'timeout' });
    }, POLL_TIMEOUT_MS);

    socket.on('connect', () => {
      try {
        socket.write(JSON.stringify({ command }) + '\n');
      } catch (e) {
        clearTimeout(timer);
        finish({ ok: false, error: 'write_failed' });
      }
    });
    socket.on('data', chunk => { buf += chunk.toString('utf8'); });
    socket.on('end', () => {
      clearTimeout(timer);
      const cleaned = buf.replace(/\x00/g, '').trim();
      if (!cleaned) { finish({ ok: false, error: 'empty_response' }); return; }
      try {
        const parsed = JSON.parse(cleaned);
        finish({ ok: true, data: parsed });
      } catch (e) {
        finish({ ok: false, error: 'invalid_json' });
      }
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, error: err.code || 'unknown' });
    });

    try { socket.connect({ host: ip, port: CGMINER_PORT }); }
    catch (e) {
      clearTimeout(timer);
      finish({ ok: false, error: 'connect_threw' });
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
    // v1.12.0: power draw (watts) + computed efficiency (J/TH) for Fleet
    // Efficiency. ckpool has no concept of power; this comes from the rig's
    // own API. Not all firmwares report it — null when unavailable.
    powerW: null,
    efficiencyJTH: null,
    frequencyMhz: null,
    coreVoltageMv: null,
    inputVoltageV: null,
    coreVoltageSetMv: null,
    sharesAccepted: null,
    sharesRejected: null,
    rejectPct: null,
    bestDiff: null,
    bestSessionDiff: null,
    expectedHashrate: null,
    defaultFrequencyMhz: null,
    defaultCoreVoltageMv: null,
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

    // v1.12.0: power from summary line (some firmwares put it here)
    const sumP = numOr(sm.Power ?? sm.power ?? sm['Power'] ?? sm['Power Consumption']);
    if (sumP !== null && sumP > 0 && sumP < 20000) live.powerW = sumP;
  }

  let maxTemp = null;
  let maxFanRpm = null;
  let maxFanPct = null;
  if (Array.isArray(stats)) {
    for (const s of stats) {
      if (!s || typeof s !== 'object') continue;

      // ── Direct numeric fields (most firmware) ──────────────────────────
      const tempCands = [
        s.Temp, s.Temperature, s.temp,
        s.temp1, s.temp2, s.temp3, s.temp4,
        s['Temp1'], s['Temp2'], s['Temp3'], s['Temp4'],
        s.chip_temp_max, s.chain_temp_max,
        s['Chip Temp Max'], s['Chain Temp Max'],
        // Avalon-style direct fields:
        s['Temp Max'], s['Temp Avg'], s['Temp Min'],
        s.MTmax, s.MTavg, s.MTmin,
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
                       'fanspeed_in','fanspeed_out','FanSpeedIn','FanSpeedOut',
                       'FanR1','FanR2','Fan Speed In','Fan Speed Out']) {
        const v = numOr(s[k]);
        if (v !== null && v > 0 && v < 20000) {
          if (maxFanRpm === null || v > maxFanRpm) maxFanRpm = v;
        }
      }
      const pctCands = [s['Fan%'], s.fan_pct, s['Fan Pct'], s.fanspeed_pct, s.FanPct];
      for (const c of pctCands) {
        const v = numOr(c);
        if (v !== null && v >= 0 && v <= 100) {
          if (maxFanPct === null || v > maxFanPct) maxFanPct = v;
        }
      }
      // v1.12.0: power draw (watts) from stats fields
      for (const k of ['Power','power','Power Consumption','wattage','Watts','PowerConsumption']) {
        const v = numOr(s[k]);
        if (v !== null && v > 0 && v < 20000) {
          if (live.powerW === null || v > live.powerW) live.powerW = v;
        }
      }

      if (!live.firmwareVersion) {
        live.firmwareVersion = s['Miner Version'] || s.MinerVersion
                            || s.Version || s.firmware_version || null;
      }

      // ── Avalon "MM ID" string parsing ──────────────────────────────────
      // Avalon firmware packs everything into one long string per module,
      // formatted like:
      //   "Ver[1.0.0] DNA[abc] ELAPSED[12345] MW[123 456] Temp[58]
      //    TMax[62] TAvg[55] Fan[3200] Fan1[3200] Fan2[3100] FanR[100]
      //    Vol[12500] GHSmm[6950.00] ..."
      // We extract Temp/TMax/Fan/etc. from the string and merge into the
      // unified live record. Without this, Avalons report ZERO useful
      // telemetry to our parser even though the data is right there.
      for (const key of Object.keys(s)) {
        if (!/^MM (ID)?\d+$/i.test(key) && key !== 'MM ID' && key !== 'MM') continue;
        const v = s[key];
        if (typeof v !== 'string') continue;
        const mmTemp = parseAvalonMmField(v, 'Temp', 'TMax', 'TAvg', 'Temperature');
        const mmFan  = parseAvalonMmField(v, 'Fan', 'Fan1', 'Fan2', 'FanRPM');
        const mmFanR = parseAvalonMmField(v, 'FanR');  // Avalon fan duty %
        const mmGhs  = parseAvalonMmField(v, 'GHSmm', 'GHSavg', 'GHSspd');
        const mmVer  = /Ver\[([^\]]+)\]/.exec(v);
        const mmElapsed = parseAvalonMmField(v, 'ELAPSED', 'Elapsed');
        const mmPower = parseAvalonMmField(v, 'MPO', 'Power', 'Pmax', 'PWR');
        // v2.x: tuning knobs from the MM blob — Avalon reports an average
        // frequency (Freq/Frequency/Fac) and core voltage (Vol/MV). Field names
        // vary by firmware, so try several. Used by the benchmark layer.
        // v2.x: Avalon reports average frequency as Freq[438.56] (MHz). It does
        // NOT expose a per-ASIC core voltage in mV like ESP-Miner — the closest
        // is the PS[] power-supply array, index 2 = INPUT voltage in centivolts
        // (27493 → 274.93 V). Different metric from BitAxe core mV, so stored
        // separately as inputVoltageV and labelled accordingly.
        const mmFreq = parseAvalonMmField(v, 'Freq', 'Frequency', 'Fac', 'FreqAvg');

        if (mmFreq !== null && mmFreq > 0 && mmFreq < 2000) {
          if (live.frequencyMhz == null || mmFreq > live.frequencyMhz) live.frequencyMhz = mmFreq;
        }
        const psMatch = /\bPS\[([0-9 .\-]+)\]/.exec(v);
        if (psMatch) {
          const ps = psMatch[1].trim().split(/\s+/).map(Number);
          if (ps.length > 2 && Number.isFinite(ps[2]) && ps[2] > 5000 && ps[2] < 30000) {
            if (live.inputVoltageV == null) live.inputVoltageV = ps[2] / 100;
          }
        }

        if (mmPower !== null && mmPower > 0 && mmPower < 20000) {
          if (live.powerW === null || mmPower > live.powerW) live.powerW = mmPower;
        }
        if (mmTemp !== null && mmTemp > 0 && mmTemp < 200) {
          if (maxTemp === null || mmTemp > maxTemp) maxTemp = mmTemp;
          live.tempDetails.push({ id: String(key), tempC: mmTemp });
        }
        if (mmFan !== null && mmFan > 0 && mmFan < 20000) {
          if (maxFanRpm === null || mmFan > maxFanRpm) maxFanRpm = mmFan;
        }
        if (mmFanR !== null && mmFanR >= 0 && mmFanR <= 100) {
          if (maxFanPct === null || mmFanR > maxFanPct) maxFanPct = mmFanR;
        }
        if (mmGhs !== null && mmGhs > 0 && live.hashrateReported == null) {
          live.hashrateReported = mmGhs * 1e9;  // GHS → H/s
        }
        if (mmVer && !live.firmwareVersion) {
          live.firmwareVersion = mmVer[1];
        }
        if (mmElapsed !== null && mmElapsed > 0 && live.uptimeSec == null) {
          live.uptimeSec = mmElapsed;
        }
      }
    }
  }

  if (maxTemp   !== null) live.tempC  = maxTemp;
  if (maxFanRpm !== null) live.fanRpm = maxFanRpm;
  if (maxFanPct !== null) live.fanPct = maxFanPct;

  // v1.12.0: efficiency = watts per terahash. Needs both a power reading and
  // a reported hashrate; null if either is missing.
  live.efficiencyJTH = computeEfficiency(live.powerW, live.hashrateReported);

  return live;
}

// v1.12.0: J/TH = watts / (hashrate in TH/s). hashrate is stored in H/s.
// v2.x: best-share difficulty arrives in two firmware formats — a raw number
// (NerdQAxe/TNA, e.g. 23715853416) or a pre-formatted string with a unit
// suffix (BitAxe AxeOS, e.g. "86.75 G"). Normalize both to a plain number of
// difficulty units so the UI formats them consistently.
function normalizeDiff(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === 'string') {
    const m = /^\s*([0-9]*\.?[0-9]+)\s*([kKmMgGtTpPeE]?)/.exec(v);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return null;
    const mult = { '': 1, k: 1e3, m: 1e6, g: 1e9, t: 1e12, p: 1e15, e: 1e18 };
    return n * (mult[m[2].toLowerCase()] || 1);
  }
  return null;
}

function computeEfficiency(powerW, hashrateHs) {
  if (!powerW || powerW <= 0) return null;
  if (!hashrateHs || hashrateHs <= 0) return null;
  const ths = hashrateHs / 1e12;
  if (ths <= 0) return null;
  return +(powerW / ths).toFixed(2);
}

// Avalon "MM ID" string sub-field extractor. Tries multiple key candidates
// and returns the first valid numeric value, e.g.:
//   parseAvalonMmField("... Temp[58] TMax[62] ...", 'Temp', 'TMax')  → 58
function parseAvalonMmField(str, ...keys) {
  for (const k of keys) {
    const re = new RegExp(`\\b${k}\\[([0-9.\\-]+)`, 'i');
    const m = re.exec(str);
    if (m) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
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
    asicModel: null,
    frequencyMhz: null,
    coreVoltageMv: null,
    coreVoltageSetMv: null,
    sharesAccepted: null,
    sharesRejected: null,
    rejectPct: null,
    bestDiff: null,
    bestSessionDiff: null,
    expectedHashrate: null,
    defaultFrequencyMhz: null,
    defaultCoreVoltageMv: null,
  };
  if (typeof d.temp === 'number' && d.temp > 0)       live.tempC = d.temp;
  if (typeof d.fanrpm === 'number' && d.fanrpm >= 0)  live.fanRpm = d.fanrpm;
  if (typeof d.fanspeed === 'number' && d.fanspeed >= 0 && d.fanspeed <= 100)
    live.fanPct = d.fanspeed;
  if (typeof d.hashRate === 'number' && d.hashRate >= 0)
    live.hashrateReported = d.hashRate * 1e9;
  if (typeof d.uptimeSeconds === 'number')            live.uptimeSec = d.uptimeSeconds;
  if (typeof d.version === 'string')                  live.firmwareVersion = d.version;
  // v1.12.x: ESP-Miner reports the actual mining chip in ASICModel
  // (e.g. "BM1370", "BM1366"). This is the authoritative model signal —
  // far more reliable than guessing from the worker name. Captured here
  // and consumed by miner-detect's detectFromAsicModel().
  if (typeof d.ASICModel === 'string' && d.ASICModel.trim()) live.asicModel = d.ASICModel.trim();
  else if (typeof d.asicModel === 'string' && d.asicModel.trim()) live.asicModel = d.asicModel.trim();
  if (typeof d.asicCount === 'number' && d.asicCount > 0) live.asicCount = d.asicCount;
  if (typeof d.boardVersion === 'string' && d.boardVersion.trim()) live.boardVersion = d.boardVersion.trim();
  // v1.12.0: ESP-Miner reports instantaneous power draw in watts.
  if (typeof d.power === 'number' && d.power > 0 && d.power < 20000) live.powerW = d.power;
  // v2.x: tuning knobs from the SAME /api/system/info payload — frequency (MHz)
  // and core voltage (mV). coreVoltageActual is the measured value (preferred);
  // coreVoltage is the configured target. These feed the crowdsourced benchmark
  // layer and the per-worker tuning detail. Bounds guard against bad firmware.
  if (typeof d.frequency === 'number' && d.frequency > 0 && d.frequency < 2000) live.frequencyMhz = d.frequency;
  if (typeof d.coreVoltageActual === 'number' && d.coreVoltageActual > 0 && d.coreVoltageActual < 3000) live.coreVoltageMv = d.coreVoltageActual;
  else if (typeof d.coreVoltage === 'number' && d.coreVoltage > 0 && d.coreVoltage < 3000) live.coreVoltageMv = d.coreVoltage;
  // v2.x Tier-1: the CONFIGURED core voltage (target). Shown alongside the
  // measured value as "set → actual" so VR sag is visible at a glance.
  if (typeof d.coreVoltage === 'number' && d.coreVoltage > 0 && d.coreVoltage < 3000) live.coreVoltageSetMv = d.coreVoltage;
  // v2.x Tier-1: share counters → reject %. Present on both BitAxe & NerdQAxe.
  if (typeof d.sharesAccepted === 'number' && d.sharesAccepted >= 0) live.sharesAccepted = d.sharesAccepted;
  if (typeof d.sharesRejected === 'number' && d.sharesRejected >= 0) live.sharesRejected = d.sharesRejected;
  if (live.sharesAccepted != null && live.sharesRejected != null) {
    const tot = live.sharesAccepted + live.sharesRejected;
    live.rejectPct = tot > 0 ? (live.sharesRejected / tot) * 100 : 0;
  }
  // v2.x Tier-1: best share. BitAxe sends a pre-formatted STRING ("86.75 G");
  // NerdQAxe/TNA sends a raw integer (23715853416). Normalize both to a number
  // of difficulty units so the UI can format consistently.
  live.bestDiff = normalizeDiff(d.bestDiff);
  live.bestSessionDiff = normalizeDiff(d.bestSessionDiff);
  // v2.x Tier-1: expected hashrate (BitAxe) — actual-vs-expected health signal.
  if (typeof d.expectedHashrate === 'number' && d.expectedHashrate > 0) live.expectedHashrate = d.expectedHashrate * 1e9;
  // v2.x Tier-1: stock baselines — the OC reference point for the benchmark layer.
  if (typeof d.defaultFrequency === 'number' && d.defaultFrequency > 0 && d.defaultFrequency < 2000) live.defaultFrequencyMhz = d.defaultFrequency;
  if (typeof d.defaultCoreVoltage === 'number' && d.defaultCoreVoltage > 0 && d.defaultCoreVoltage < 3000) live.defaultCoreVoltageMv = d.defaultCoreVoltage;
  live.efficiencyJTH = computeEfficiency(live.powerW, live.hashrateReported);

  if (live.tempC !== null) {
    live.tempDetails.push({ id: 'asic', tempC: live.tempC });
  }
  if (typeof d.vrTemp === 'number' && d.vrTemp > 0) {
    live.tempDetails.push({ id: 'vr', tempC: d.vrTemp });
  }
  return live;
}

// ── v1.11.31: self-host detection for URL-based pool alignment fallback ────
// When a miner firmware redacts User credentials in its cgminer-JSON pools
// response (e.g. Avalon Nano 3S, custom TNA-branded S19j Pro firmware,
// other privacy-conscious variants), we can't compare pool.user vs the
// configured payout address. As a fallback, we try to match the active
// pool's URL host against the Umbrel host's own LAN IP(s). If the miner
// is pointed at this Umbrel box's stratum, the URL host matches and we
// can confidently mark the alignment as ALIGNED-BY-URL (still green, with
// a slightly different label to indicate how we matched).

let _selfHostsCache = null;
let _selfHostsCacheTs = 0;
const SELF_HOSTS_CACHE_MS = 60 * 1000; // refresh every minute

function getSelfHosts() {
  const now = Date.now();
  if (_selfHostsCache && (now - _selfHostsCacheTs) < SELF_HOSTS_CACHE_MS) {
    return _selfHostsCache;
  }
  const hosts = new Set([
    'localhost',
    '127.0.0.1',
    'umbrel.local',
    'umbrel.localdomain',
    'umbrel',
  ]);
  try {
    const os = require('os');
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const addr of ifaces[name] || []) {
        // IPv4 only, skip internal/loopback (we already added 127.0.0.1)
        if (addr.family === 'IPv4' && !addr.internal && addr.address) {
          hosts.add(addr.address);
        }
      }
    }
  } catch (e) {
    // os module unavailable or permission error — fallback list still works
  }
  _selfHostsCache = hosts;
  _selfHostsCacheTs = now;
  return hosts;
}

// Parse a cgminer pool URL like "stratum+tcp://192.168.1.239:3333" and
// return just the host. Tolerates missing schemes, IPv4, hostnames.
function extractPoolHost(url) {
  if (typeof url !== 'string' || !url) return null;
  let s = url.trim();
  // Strip scheme: stratum+tcp://, stratum+ssl://, stratum://, ssl://, tcp://
  s = s.replace(/^[a-z+]+:\/\//i, '');
  // Strip path/query (rare for stratum but defensive)
  s = s.split('/')[0];
  // Strip port
  const portIdx = s.lastIndexOf(':');
  if (portIdx >= 0) s = s.substring(0, portIdx);
  return s.toLowerCase() || null;
}

function activePoolPointsAtSelf(configuredPools) {
  if (!Array.isArray(configuredPools) || !configuredPools.length) return false;
  const selfHosts = getSelfHosts();
  // Prefer the active pool, but also check non-active ones — a miner with
  // SoloStrike as backup is still "pointed at SoloStrike", just on standby.
  for (const p of configuredPools) {
    if (!p || !p.url) continue;
    const host = extractPoolHost(p.url);
    if (host && selfHosts.has(host)) return { matched: true, active: !!p.active, host };
  }
  return false;
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
    // v1.11.31: URL-based fallback. Some firmwares (Avalon Nano 3S, certain
    // TNA-branded S19j Pro builds, etc) redact the User field for security
    // but keep URL. If the active pool's URL host matches this Umbrel host's
    // own IP(s), we can confidently report ALIGNED-BY-URL.
    const urlMatch = activePoolPointsAtSelf(configuredPools);
    if (urlMatch && urlMatch.matched) {
      return {
        status: urlMatch.active ? 'aligned' : 'backup',
        matchedBy: 'url',
        matchedHost: urlMatch.host,
        activePool: activePool ? activePool.url : null,
        activePoolUser: null,
        configuredPools,
      };
    }
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
