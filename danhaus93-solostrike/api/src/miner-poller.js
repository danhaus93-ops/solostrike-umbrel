// ── Miner poller (v1.9.0) ───────────────────────────────────────────────────
const _mvify = (n) => (typeof n==='number' && n>0 && n<100) ? Math.round(n*1000) : n;
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
const { boardModelString } = require('./miner-detect');

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
    if (r && r.live) {
      const live = { ...r.live, lastCheckedAt: r.lastCheckedAt };
      // v2.x: sustained hashrate for benchmarking (hashrate fluctuates, so a
      // single instant reading is noise). Priority: device-reported average
      // (Avalon GHSavg → hashrateAvg; NerdQAxe 24h → hr1d) → our own server-side
      // rolling average over recent polls → instantaneous (last resort).
      const roll = rollingAvgHr(r.hrSamples, 30 * 60 * 1000);
      live.hashrateSustained =
        (live.hashrateAvg != null ? live.hashrateAvg
         : live.hr1d != null ? live.hr1d
         : roll != null ? roll
         : live.hashrateReported);
      // v2.x: smoothed power (10-min window) so J/TH doesn't bounce with the
      // instantaneous power reading. Prefer a device-reported average if the
      // firmware exposes one (live.powerAvg); none currently do, so in practice
      // this uses our own rolling average, falling back to instant.
      const rollPw = rollingAvgPw(r.hrSamples, 10 * 60 * 1000);
      live.powerSustained =
        (live.powerAvg != null ? live.powerAvg
         : rollPw != null ? rollPw
         : live.powerW);
      out[name] = live;
    }
  }
  return out;
}

// v2.x: average of recent hashrateReported samples within a time window (H/s),
// or null if no samples. Used as the fallback sustained hashrate for devices
// that don't report their own average (e.g. BitAxe AxeOS has no rolling field).
function rollingAvgHr(samples, windowMs) {
  if (!Array.isArray(samples) || !samples.length) return null;
  const cutoff = Date.now() - windowMs;
  const recent = samples.filter(s => s && s.ts >= cutoff && Number.isFinite(s.hr) && s.hr > 0);
  if (!recent.length) return null;
  return recent.reduce((a, s) => a + s.hr, 0) / recent.length;
}

// v2.x: rolling average of recent power samples (W) within a window, or null.
function rollingAvgPw(samples, windowMs) {
  if (!Array.isArray(samples) || !samples.length) return null;
  const cutoff = Date.now() - windowMs;
  const recent = samples.filter(s => s && s.ts >= cutoff && Number.isFinite(s.pw) && s.pw > 0);
  if (!recent.length) return null;
  return recent.reduce((a, s) => a + s.pw, 0) / recent.length;
}

// v2.x: friendly model name for benchmark bucketing/labels. NerdQAxe reports
// deviceModel directly; BitAxe (AxeOS) doesn't, so derive its family from the
// ASIC chip. Falls back to the chip name, never blank.
function friendlyEspModel(d) {
  // GekkoScience GekkoAxe runs stock AxeOS on Bitmain chips (V2.0 GT = 2× BM1370),
  // so the only thing that distinguishes it from a Bitaxe/NerdQaxe is a "gekko"
  // token in deviceModel or hostname. Check that before anything else.
  const gekkoHint = [d && d.deviceModel, d && d.hostname].filter(Boolean).join(' ');
  if (/gekko/i.test(gekkoHint)) return 'GekkoAxe';
  // /api/system/asic gives a short deviceModel ("Gamma", "GT", "Hex"…). Normalize
  // the Bitaxe ones to the friendly family label; trust anything else (e.g.
  // "NerdQAxe++") verbatim.
  const dm = (d && typeof d.deviceModel === 'string') ? d.deviceModel.trim() : '';
  if (dm) {
    const DM = {
      'gamma': 'BitAxe Gamma', 'gammaduo': 'BitAxe Gamma Duo', 'gamma duo': 'BitAxe Gamma Duo',
      'gt': 'BitAxe GT', 'gammaturbo': 'BitAxe GT', 'gamma turbo': 'BitAxe GT',
      'hex': 'BitAxe Hex', 'supra': 'BitAxe Supra', 'ultra': 'BitAxe Ultra', 'max': 'BitAxe Max',
    };
    return DM[dm.toLowerCase()] || dm;
  }
  // No deviceModel (older stock AxeOS, /info only): boardVersion is authoritative.
  const bv = boardModelString(d && d.boardVersion);
  if (bv) return bv;
  // Last resort: chip + count.
  const asic = (d && typeof d.ASICModel === 'string') ? d.ASICModel.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  const n = (d && typeof d.asicCount === 'number') ? d.asicCount : 0;
  if (asic === 'BM1370') return n >= 4 ? 'NerdQAxe++' : (n === 2 ? 'BitAxe GT' : 'BitAxe Gamma');
  if (asic === 'BM1368') return n >= 4 ? 'NerdQAxe+'  : 'BitAxe Supra';
  if (asic === 'BM1366') return n >= 4 ? 'BitAxe Hex' : 'BitAxe Ultra';
  if (asic === 'BM1397') return 'BitAxe Max';
  return asic ? 'BitAxe (' + asic + ')' : 'BitAxe';
}

// v2.x: derive a friendly label for a GENERIC cgminer-family device from its
// firmware Description string (used only when we couldn't get a real model name
// from DEVS and it isn't an Avalon). These devices are for MONITORING; they
// usually don't expose core voltage, so they stay benchmark-ineligible.
function cgminerFamilyLabel(desc) {
  const s = (desc || '').toLowerCase();
  if (s.includes('luxminer') || s.includes('luxos'))                 return 'ASIC (LuxOS)';
  if (s.includes('boser') || s.includes('bosminer') || s.includes('braiins')) return 'ASIC (Braiins OS)';
  if (s.includes('btminer') || s.includes('whatsminer'))             return 'Whatsminer';
  if (s.includes('vnish'))                                           return 'ASIC (Vnish)';
  if (s.includes('tna-os') || s.includes('tnaos'))                   return 'ASIC (TNA-OS)';
  if (s.includes('bmminer'))                                         return 'Antminer';
  if (s.includes('cgminer'))                                         return 'ASIC (cgminer)';
  return 'ASIC';
}

// pick first non-null value among candidate keys (firmwares vary on casing/naming)
function pickField(o, keys) {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) { if (o[k] != null) return o[k]; }
  return undefined;
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

// v2.x: tracks consecutive failed poll cycles per worker, for backoff.
const pollFailStreak = new Map();
let pollCycleCount = 0;

async function pollAll() {
  if (!getMetaFn) return;
  const allMeta = getMetaFn() || [];
  pollCycleCount++;
  // v2.x reliability fix: re-resolve each miner's IP from the LATEST ckpool
  // metadata every cycle (getMetaFn already returns fresh data), and no longer
  // permanently skip miners that previously failed or had no IP. Previously a
  // miner whose IP wasn't yet harvested — or that was briefly unreachable —
  // would stay blank until a manual reboot forced a fresh stratum reconnect.
  // Now telemetry self-heals as soon as the IP/endpoint becomes reachable.
  //
  // Gentle backoff: a miner that keeps failing is retried less often (every
  // 2^streak cycles, capped at every 10) so long-dead rigs don't generate a
  // timeout attempt every single 60s cycle — keeps CPU/sockets quiet.
  const targets = allMeta.filter(m => {
    if (!m || !m.name || !m.ip) return false;
    const streak = pollFailStreak.get(m.name) || 0;
    if (streak === 0) return true;                 // healthy → always poll
    const everyN = Math.min(10, Math.pow(2, Math.min(streak, 4))); // 2,4,8,10,10…
    return (pollCycleCount % everyN) === 0;        // backed-off retry
  });
  await Promise.allSettled(targets.map(m => pollMiner(m.name, m.ip)));
}

// v2.x: record poll outcome for backoff. ok=true resets the streak so a
// recovered miner immediately returns to every-cycle polling.
function notePollOutcome(workerName, ok) {
  if (ok) pollFailStreak.delete(workerName);
  else pollFailStreak.set(workerName, (pollFailStreak.get(workerName) || 0) + 1);
}

// Merge two `live` telemetry objects: start from the base (cgminer) and
// overlay any non-null field from the richer source (AxeOS HTTP). The HTTP
// payload wins where both have a value (higher-fidelity sensor read), while
// base-only fields are preserved.
function mergeLive(base, rich) {
  if (!rich) return base;
  if (!base) return rich;
  const out = Object.assign({}, base);
  for (const k of Object.keys(rich)) {
    const v = rich[k];
    if (v == null) continue;
    if (Array.isArray(v)) { if (v.length) out[k] = v; continue; }
    out[k] = v;
  }
  return out;
}

// True if the AxeOS/HTTP live payload carries materially richer telemetry than
// the cgminer one — i.e. it has fan/power/voltage/frequency that cgminer-thin
// firmwares (like TNA-OS over 4028) don't expose. Used to prefer the HTTP
// adapter for cgminer-classified devices that ALSO answer /api/system/info.
function espIsRicherThanCgminer(esp, cg) {
  if (!esp) return false;
  if (!cg) return true;
  // Count meaningful telemetry signals present on HTTP but absent on cgminer.
  const espHas = (
    (esp.fanRpm != null || esp.fanPct != null) ||
    (esp.powerW != null) ||
    (esp.coreVoltageMv != null) ||
    (esp.frequencyMhz != null) ||
    (esp.coreVoltageSetMv != null)
  );
  const cgLacks = (
    (cg.fanRpm == null && cg.fanPct == null) &&
    (cg.powerW == null) &&
    (cg.coreVoltageMv == null) &&
    (cg.frequencyMhz == null)
  );
  return espHas && cgLacks;
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
    // Vendor-classified cgminer device (e.g. Antminer). Stock Antminer firmware
    // only speaks cgminer TCP/4028 and refuses port 80. BUT custom firmwares on
    // the same hardware — notably TNA-OS — serve a rich AxeOS-style
    // /api/system/info over HTTP with fans, power, per-board temps, voltage and
    // frequency that the thin cgminer reply lacks. So we try cgminer first (fast,
    // expected to succeed), then ALSO probe HTTP; if HTTP returns a confirmed
    // AxeOS payload, we prefer it because it's strictly richer. Stock Antminers
    // simply 404/refuse port 80, so this is a no-op cost for them.
    result = await tryCgminer(ip);
    if (!result.ok) {
      const fallback = await tryEspMiner(ip);
      if (fallback.ok) result = fallback;
    } else {
      const httpRich = await tryEspMiner(ip);
      if (httpRich.ok && espIsRicherThanCgminer(httpRich.live, result.live)) {
        // Keep the cgminer adapter label + its pool/alignment data (the HTTP
        // endpoint has no pools), but merge in the richer AxeOS telemetry
        // (fans, power, voltage, frequency, per-board) over the thin cgminer
        // live object. Fields present on cgminer but missing on HTTP are kept.
        result = {
          ok: true,
          adapter: 'cgminer',
          pools: result.pools,
          live: mergeLive(result.live, httpRich.live),
        };
      }
    }
  } else {
    // v2.x: unknown vendor — probe the HTTP/AxeOS endpoint FIRST. AxeOS-style
    // firmwares that don't get a vendor classification (e.g. TNA-OS on big
    // Antminers) serve a rich /api/system/info with model/freq/coreVoltage;
    // their cgminer 4028 reply is a thin, sometimes non-standard envelope.
    // cgminer-only devices simply 404/refuse port 80, so we fall back cleanly.
    // HTTP is strictly richer for any device that answers both.
    result = await tryEspMiner(ip);
    if (!result.ok) {
      const fallback = await tryCgminer(ip);
      if (fallback.ok) result = fallback;
    }
  }

  if (!result.ok) {
    notePollOutcome(workerName, false);
    saveRecord(workerName, {
      alignment: { status: result.alignmentStatus || 'unreachable', error: result.error },
      live: null,
      adapter: prev ? prev.adapter : null,
      error: result.error,
    });
    return;
  }
  notePollOutcome(workerName, true);

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

// LuxOS board voltage WITHOUT the unsafe `voltageget` hardware read (that live
// bus poll crashes/restarts the miner). Instead read the CONFIGURED voltage from
// the active tuning profile: `config` names the active profile, `profiles` lists
// each profile's Voltage. Both are config-FILE reads over HTTP :8080 — verified
// safe to poll. Returns mV or null.
function luxosHttp(ip, command) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const body = JSON.stringify({ command });
      const req = http.request({
        host: ip, port: 8080, path: '/api', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 3000,
      }, (res) => {
        let d = '';
        res.on('data', (c) => { d += c; if (d.length > 65536) req.destroy(); });
        res.on('end', () => { try { fin(JSON.parse(d)); } catch (e) { fin(null); } });
      });
      req.on('error', () => fin(null));
      req.on('timeout', () => { req.destroy(); fin(null); });
      req.write(body); req.end();
    } catch (e) { fin(null); }
  });
}
async function luxosProfileVoltageMv(ip, freqHint) {
  const [cfg, profs] = await Promise.all([luxosHttp(ip, 'config'), luxosHttp(ip, 'profiles')]);
  const list = profs && Array.isArray(profs.PROFILES) ? profs.PROFILES : null;
  if (!list || !list.length) return null;
  const c = cfg && Array.isArray(cfg.CONFIG) ? cfg.CONFIG[0] : null;
  const name = c && c.Profile != null ? String(c.Profile) : null;
  const step = c && c.ProfileStep != null ? String(c.ProfileStep) : null;
  let p = null;
  if (name) p = list.find(x => String(x['Profile Name']) === name);
  if (!p && step != null) p = list.find(x => String(x.Step) === step);
  if (!p && freqHint != null) {
    let best = null, bd = Infinity;
    for (const x of list) { const d = Math.abs(Number(x.Frequency) - Number(freqHint)); if (Number.isFinite(d) && d < bd) { bd = d; best = x; } }
    if (bd <= 13) p = best; // within half a 25 MHz step
  }
  if (!p) return null;
  const v = Number(p.Voltage);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v < 100 ? Math.round(v * 1000) : Math.round(v); // volts -> mV
}

function tryCgminer(ip) {
  return new Promise(async (resolve) => {
    const [poolsRes, summaryRes, statsRes, devsRes, powerRes, versionRes] = await Promise.all([
      cgminerCommand(ip, 'pools'),
      cgminerCommand(ip, 'summary'),
      cgminerCommand(ip, 'stats'),
      cgminerCommand(ip, 'devs'),
      cgminerCommand(ip, 'power'),
      cgminerCommand(ip, 'version'),
    ]);

    // If ALL failed, treat as unreachable/disabled. We surface the
    // most informative error (prefer ECONNREFUSED → 'disabled', else
    // 'unreachable').
    if (!poolsRes.ok && !summaryRes.ok && !statsRes.ok && !devsRes.ok) {
      const allRefused = [poolsRes, summaryRes, statsRes, devsRes].every(r => r.error === 'ECONNREFUSED');
      const status = allRefused ? 'disabled' : 'unreachable';
      const err    = poolsRes.error || summaryRes.error || statsRes.error || devsRes.error || 'unknown';
      resolve({ ok: false, alignmentStatus: status, error: err });
      return;
    }

    // At least one command succeeded. Treat the connection as live cgminer.
    // Merge whatever data we got — partial results are fine.
    const pools   = poolsRes.ok   ? (poolsRes.data.POOLS   || poolsRes.data.pools   || []) : [];
    const summary = summaryRes.ok ? (summaryRes.data.SUMMARY || summaryRes.data.summary || []) : [];
    const stats   = statsRes.ok   ? (statsRes.data.STATS   || statsRes.data.stats   || []) : [];
    // v2.x: devs carries per-board Temperature/Frequency/Fan on GENERIC cgminer
    // firmwares (Antminer/LuxOS/Braiins/Whatsminer/Vnish); Avalon doesn't need it.
    const devs    = devsRes.ok    ? (devsRes.data.DEVS     || devsRes.data.devs     || []) : [];
    // firmware id from any STATUS block → labels generic devices. Standard
    // cgminer puts it in STATUS[0].Description; TNA-OS puts the firmware name in
    // STATUS[0].Msg (e.g. "TNA-OS") — but other commands put generic Msgs there
    // too ("Summary", "stats"), so we must not let those win. Collect all
    // candidates, then prefer a real firmware identifier over generic command
    // names.
    const GENERIC_MSG = /^(summary|stats|pools|devs|version|config|power|ok)$/i;
    const fwCandidates = [versionRes, summaryRes, statsRes, devsRes, poolsRes]
      .map(r => r && r.ok && r.data && Array.isArray(r.data.STATUS) && r.data.STATUS[0]
                && (r.data.STATUS[0].Description || r.data.STATUS[0].Msg))
      .filter(d => typeof d === 'string' && d.trim());
    const fwDesc =
      fwCandidates.find(d => !GENERIC_MSG.test(d.trim())) ||  // prefer a real fw name
      fwCandidates[0] || '';
    const power   = powerRes.ok ? (powerRes.data.POWER || powerRes.data.power || []) : [];
    const version = versionRes && versionRes.ok ? (versionRes.data.VERSION || versionRes.data.version || []) : [];
    const live    = extractCgminerLive(summary, stats, devs, fwDesc, power, version);

    // LuxOS: take board voltage from the active tuning profile (config + profiles,
    // safe file reads). NEVER `voltageget` — its live hardware read crashes the
    // miner. Silent on failure; voltage just stays null (gate is voltage-optional).
    if (live.coreVoltageMv == null && /lux(miner|os)/i.test(fwDesc || '')) {
      const vmv = await luxosProfileVoltageMv(ip, live.frequencyMhz);
      if (vmv != null && vmv > 0 && vmv < 20000) {
        live.coreVoltageMv = vmv;
        if (live.coreVoltageSetMv == null) live.coreVoltageSetMv = vmv;
      }
    }

    resolve({ ok: true, adapter: 'cgminer', pools, live });
  });
}

// ── TNA-OS envelope normalizer ───────────────────────────────────────────────
// Standard cgminer-JSON replies put the payload at the TOP level, e.g.
//   { "STATUS":[...], "SUMMARY":[{...}], "id":1 }
// TNA-OS (custom Antminer firmware seen on S19 XP, v0.8.1) wraps that whole
// object inside an extra single-element array keyed by the LOWERCASE command
// name, e.g.
//   { "id":1, "summary":[ { "STATUS":[...], "SUMMARY":[{...}], "id":1 } ] }
// Without unwrapping, every downstream read of data.SUMMARY / data.STATS /
// data.VERSION is undefined, so hashrate/temp/etc. all come back null even
// though the miner is reporting them. This detects that extra wrapper and lifts
// the inner object back to the top level. It is a no-op for standard firmwares
// (LuxOS, Braiins, Vnish, stock Bitmain, Avalon, ESP-Miner), so it is safe to
// run on every cgminer response.
function normalizeCgminerEnvelope(data, command) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const cmd = String(command || '').toLowerCase();
  const wrapper = data[cmd];
  if (Array.isArray(wrapper) && wrapper.length && wrapper[0] && typeof wrapper[0] === 'object') {
    const inner = wrapper[0];
    const looksLikeCgminerObj =
      Array.isArray(inner.STATUS) ||
      inner.SUMMARY || inner.STATS || inner.VERSION || inner.POOLS || inner.DEVS;
    if (looksLikeCgminerObj) return inner;
  }
  return data;
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
        const parsed = normalizeCgminerEnvelope(JSON.parse(cleaned), command);
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

function extractCgminerLive(summary, stats, devs, fwDesc, power = [], version = []) {
  // Firmware version from the VERSION block. Different firmwares key this
  // differently: TNA-OS uses {"TNA-OS":"0.8.1"}, LuxOS {"LUXminer":...},
  // Braiins {"BOSminer+":...}, stock Bitmain {"BMMiner":...}. Capture the first
  // version-like value and a human label.
  let fwFromVersion = null, fwLabelHint = null;
  const v0 = Array.isArray(version) && version[0] && typeof version[0] === 'object' ? version[0] : null;
  if (v0) {
    for (const key of ['TNA-OS','LUXminer','BOSminer+','BOSminer','VNish','Vnish','BMMiner','CGMiner','Miner']) {
      if (v0[key] != null && String(v0[key]).trim()) {
        fwFromVersion = `${key} ${v0[key]}`.trim();
        fwLabelHint = key;
        break;
      }
    }
  }
  const live = {
    tempC: null,
    tempDetails: [],
    fanRpm: null,
    fanPct: null,
    hashrateReported: null,
    hwErrors: null,
    uptimeSec: null,
    firmwareVersion: null,
    model: null,
    hashrateAvg: null,
    hashrateSustained: null,
    powerAvg: null,
    powerSustained: null,
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
    inputVoltageV: null,
    inputCurrentA: null,
    tempTargetC: null,
    overclockEnabled: null,
    overheatMode: null,
    boardVersion: null,
    hr1m: null, hr10m: null, hr1h: null, hr1d: null,
    vrTempC: null,
    stratumConnected: null,
    pingRttMs: null,
    pingLossPct: null,
    advanced: {},
    chipTemps: null,
    chipVolts: null,
    chipTempAvg: null,
    chipTempMax: null,
    chipVoltAvg: null,
    outletTempC: null,
  };

  const sm = Array.isArray(summary) ? summary[0] : summary;
  if (sm && typeof sm === 'object') {
    if (typeof sm.Elapsed === 'number')          live.uptimeSec = sm.Elapsed;
    if (typeof sm['Hardware Errors'] === 'number') live.hwErrors = sm['Hardware Errors'];
    if (typeof sm.HardwareErrors === 'number')   live.hwErrors = sm.HardwareErrors;
    // v2.x: Avalon/cgminer reject rate. Prefer cgminer's own computed
    // "Device Rejected%" (e.g. 0.2099); else derive from Accepted/Rejected
    // counts. Previously unparsed → benchmark showed a fabricated 0%.
    {
      const devRej = numOr(sm['Device Rejected%']);
      const acc = numOr(sm.Accepted), rej = numOr(sm.Rejected);
      if (acc !== null) live.sharesAccepted = acc;
      if (rej !== null) live.sharesRejected = rej;
      if (devRej !== null && devRej >= 0) live.rejectPct = devRej;
      else if (acc !== null && rej !== null && (acc + rej) > 0) live.rejectPct = (rej / (acc + rej)) * 100;
    }

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

        // v2.x: Avalon per-chip telemetry, confirmed real via HashWatcher. The
        // MM blob carries per-chip temps (PVT_T0[...]), per-chip core voltages
        // (PVT_V0[...], mV — a REAL tunable signal, just per-chip scale ~306mV
        // vs BitAxe's single ~1170mV domain), outlet/exhaust temp (OTemp), and
        // per-chain frequency (SF0). parseAvalonMmArray pulls a bracketed,
        // space-separated numeric array (handles leading/irregular spaces).
        // v2.x: device-reported AVERAGE hashrate (GHSavg, GH/s → H/s) — a smoothed
        // sustained figure, far better for benchmarking than the bouncing instant
        // reading. The Avalon has no hr1d field, so this is its sustained source.
        const ghsAvg = parseAvalonMmField(v, 'GHSavg');
        if (ghsAvg != null && ghsAvg > 0) live.hashrateAvg = ghsAvg * 1e9;
        // v2.x: friendly model name. The Ver[...] string carries the model
        // (e.g. "Nano3s-25061101_..."). Without this the bucket reads "unknown".
        const verStr = (mmVer && mmVer[1]) || live.firmwareVersion || '';
        if (/nano\s*3s/i.test(verStr)) live.model = 'Avalon Nano 3S';
        else if (/nano/i.test(verStr)) live.model = 'Avalon Nano';
        else if (!live.model) live.model = 'Avalon';
        const chipTemps = parseAvalonMmArray(v, 'PVT_T0');
        const chipVolts = parseAvalonMmArray(v, 'PVT_V0');
        if (chipTemps && chipTemps.length) {
          live.chipTemps = chipTemps;
          live.chipTempAvg = +(chipTemps.reduce((a, b) => a + b, 0) / chipTemps.length).toFixed(1);
          live.chipTempMax = Math.max(...chipTemps);
        }
        if (chipVolts && chipVolts.length) {
          live.chipVolts = chipVolts;
          const avgMv = chipVolts.reduce((a, b) => a + b, 0) / chipVolts.length;
          live.chipVoltAvg = Math.round(avgMv);
          // Surface as core voltage so it shows in the standard row AND feeds the
          // benchmark (model-bucketed, so it only ever compares Nano-to-Nano).
          if (live.coreVoltageMv == null && avgMv > 0 && avgMv < 3000) live.coreVoltageMv = Math.round(avgMv);
        }
        const otemp = parseAvalonMmField(v, 'OTemp');
        if (otemp !== null && otemp > 0 && otemp < 200) live.outletTempC = otemp;
        const sf0 = parseAvalonMmArray(v, 'SF0');
        if (sf0 && sf0.length) live.advanced.perChainFreq = sf0.join(' / ') + ' MHz';
        const bin = parseAvalonMmField(v, 'BIN');
        if (bin !== null) live.advanced.siliconBin = String(bin);
        const wm = parseAvalonMmField(v, 'WORKMODE');
        const wl = parseAvalonMmField(v, 'WORKLEVEL');
        if (wm !== null) live.advanced.workMode = wl !== null ? `mode ${wm} · level ${wl}` : `mode ${wm}`;

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
  // v2.x: right after a reboot Avalon reports a depressed hashrate (averaging
  // window not yet filled) while power is already at full draw — that yields an
  // absurd J/TH spike (e.g. 507 instead of 34). Suppress efficiency during the
  // warm-up window so the artifact doesn't show or feed the benchmark layer.
  // v2.x: LuxOS / generic cgminer expose total power via the `power` command
  // (POWER[].Watts — absent from summary/stats) and aggregate frequency in
  // `stats` (frequency / total_freqavg). Fill BOTH before efficiency so J/TH
  // computes and the rig clears the Top Strikers gate.
  if (live.powerW == null && Array.isArray(power)) {
    for (const p of power) {
      if (!p || typeof p !== 'object') continue;
      const w = numOr(pickField(p, ['Watts', 'watts', 'Power', 'power', 'Watt']));
      if (w != null && w > 0 && w < 20000) { live.powerW = w; break; }
    }
  }
  if (live.frequencyMhz == null && Array.isArray(stats)) {
    for (const st of stats) {
      if (!st || typeof st !== 'object') continue;
      const f = numOr(pickField(st, ['frequency', 'total_freqavg', 'freqavg', 'FreqAvg', 'freq_avg', 'Frequency']));
      if (f != null && f > 0 && f < 5000) { live.frequencyMhz = f; break; }
    }
  }
  const cgWarmup = live.uptimeSec != null && live.uptimeSec < 180;
  live.efficiencyJTH = cgWarmup ? null : computeEfficiency(live.powerW, live.hashrateReported);

  // ── v2.x: GENERIC cgminer-family fallbacks ────────────────────────────────
  // Everything above is tuned for Avalon (MM-string). Stock Antminer, LuxOS,
  // Braiins OS+ (socket), Whatsminer and Vnish instead expose per-board values
  // in DEVS and a firmware id in STATUS.Description. We fill ONLY fields still
  // null, so Avalon's richer parse is never overridden. Result: universal
  // monitoring (hashrate/temp/reject/uptime/fan) for any cgminer device. Core
  // voltage stays null on firmwares that don't expose it, which correctly keeps
  // those devices benchmark-ineligible (the gate requires freq + coreVoltage).
  const devList = Array.isArray(devs) ? devs.filter(x => x && typeof x === 'object') : [];
  if (devList.length) {
    if (live.tempC == null) {
      let t = null;
      for (const d of devList) {
        const v = numOr(pickField(d, ['Temperature', 'Temp', 'temp']));
        if (v != null && v > 0 && v < 200 && (t == null || v > t)) t = v;
      }
      if (t != null) { live.tempC = t; live.tempDetails.push({ id: 'devs', tempC: t }); }
    }
    if (live.frequencyMhz == null) {
      let f = null;
      for (const d of devList) {
        const v = numOr(pickField(d, ['Frequency', 'frequency', 'Freq']));
        if (v != null && v > 0 && v < 5000 && (f == null || v > f)) f = v;
      }
      if (f != null) live.frequencyMhz = f;
    }
    if (live.fanRpm == null) {
      let fr = null;
      for (const d of devList) {
        const v = numOr(pickField(d, ['Fan Speed', 'FanSpeed', 'Fan Speed In', 'fan']));
        if (v != null && v > 0 && (fr == null || v > fr)) fr = v;
      }
      if (fr != null) live.fanRpm = fr;
    }
    // per-device share totals if summary didn't carry them
    if (live.sharesAccepted == null || live.sharesRejected == null) {
      let acc = 0, rej = 0, seen = false;
      for (const d of devList) {
        const a = numOr(d.Accepted), r = numOr(d.Rejected);
        if (a != null || r != null) { seen = true; acc += (a || 0); rej += (r || 0); }
      }
      if (seen) {
        if (live.sharesAccepted == null) live.sharesAccepted = acc;
        if (live.sharesRejected == null) live.sharesRejected = rej;
        if (live.rejectPct == null && (acc + rej) > 0) live.rejectPct = (rej / (acc + rej)) * 100;
      }
    }
  }
  // model label only if the Avalon parse didn't already set one
  if (!live.model) {
    const d0 = devList[0] || {};
    const fromDev = pickField(d0, ['Model', 'Name', 'Board', 'Type']);
    let devName = (typeof fromDev === 'string' && fromDev.trim()) ? fromDev.trim() : '';
    // LuxOS/cgminer often leave DEVS.Name blank but carry the real model in
    // STATS[0].Type (e.g. "Antminer S21 XP"); prefer that over the family label.
    if (!devName && Array.isArray(stats)) {
      for (const st of stats) {
        const t = st && (st.Type || st.type);
        if (typeof t === 'string' && t.trim()) { devName = t.trim(); break; }
      }
    }
    live.model = devName || cgminerFamilyLabel(fwDesc);
  }
  // Firmware version precedence: explicit VERSION-block value (e.g. TNA-OS
  // 0.8.1) wins, then any value already discovered from stats, then fwDesc.
  if (!live.firmwareVersion && fwFromVersion) live.firmwareVersion = fwFromVersion.slice(0, 60);
  if (!live.firmwareVersion && fwDesc) live.firmwareVersion = String(fwDesc).slice(0, 60);
  // If model is still unknown, the VERSION block's Type is reliable on TNA-OS.
  if (!live.model && v0 && v0.Type) live.model = String(v0.Type).slice(0, 60);

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

// v2.x: parse a bracketed, space-separated numeric array from an MM string,
// e.g. PVT_T0[ 54  62  65 ...] or SF0[396 414 435 456]. Handles leading and
// irregular internal spaces. Returns an array of finite numbers, or null.
function parseAvalonMmArray(str, key) {
  const re = new RegExp(`\\b${key}\\[([0-9.\\-\\s]+)\\]`, 'i');
  const m = re.exec(str);
  if (!m) return null;
  const arr = m[1].trim().split(/\s+/).map(Number).filter(Number.isFinite);
  return arr.length ? arr : null;
}

// ── ESP-Miner adapter ────────────────────────────────────────────────────────

// Single AxeOS HTTP GET → JSON. Resolves { ok:true, data } | { ok:false, status|error }.
// Pure read; harmless against any device (a non-AxeOS box just 404s or times out).
function fetchEspJson(ip, reqPath) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (out) => { if (!done) { done = true; resolve(out); } };
    const req = http.get({
      host: ip,
      port: HTTP_PORT,
      path: reqPath,
      timeout: POLL_TIMEOUT_MS,
      headers: { 'Accept': 'application/json' },
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); finish({ ok: false, status: res.statusCode }); return; }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { finish({ ok: true, data: JSON.parse(data) }); }
        catch { finish({ ok: false, error: 'invalid_json' }); }
      });
    });
    req.on('error', (err) => finish({ ok: false, error: err.code || 'unknown' }));
    req.on('timeout', () => { try { req.destroy(); } catch {} finish({ ok: false, error: 'timeout' }); });
  });
}

async function tryEspMiner(ip) {
  // Tier 1: /api/system/info. If this isn't a clean 200 + JSON, the device is NOT
  // AxeOS (e.g. a LuxOS S21 XP, which 404s / returns HTML here) — bail out now.
  // This is the gate that guarantees the /api/system/asic call below can only ever
  // reach a confirmed AxeOS device.
  const info = await fetchEspJson(ip, '/api/system/info');
  if (!info.ok) {
    let alignmentStatus = 'unreachable', error = info.error || 'unknown';
    if (info.status)                        { alignmentStatus = 'disabled'; error = `http_${info.status}`; }
    else if (info.error === 'invalid_json') { alignmentStatus = 'disabled'; error = 'invalid_json'; }
    else if (info.error === 'ECONNREFUSED') { alignmentStatus = 'disabled'; }
    return { ok: false, alignmentStatus, error };
  }
  // Tier 2: confirmed AxeOS — enrich with /api/system/asic (deviceModel, asicCount,
  // swarmColor). Failure-tolerant: forks / older firmware may lack the endpoint, and
  // a missing or bad /asic must never sink the /info result.
  let merged = info.data;
  const asic = await fetchEspJson(ip, '/api/system/asic');
  if (asic.ok && asic.data && typeof asic.data === 'object') {
    merged = Object.assign({}, info.data, asic.data);
  }
  const live = extractEspMinerLive(merged);
  return { ok: true, adapter: 'esp-miner', pools: [], live };
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
    model: null,
    hashrateAvg: null,
    hashrateSustained: null,
    powerAvg: null,
    powerSustained: null,
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
    minVoltageMv: null,
    maxVoltageMv: null,
    httpTunable: null,
    inputVoltageV: null,
    inputCurrentA: null,
    tempTargetC: null,
    overclockEnabled: null,
    overheatMode: null,
    boardVersion: null,
    hr1m: null, hr10m: null, hr1h: null, hr1d: null,
    vrTempC: null,
    stratumConnected: null,
    pingRttMs: null,
    pingLossPct: null,
    advanced: {},
  };
  if (typeof d.temp === 'number' && d.temp > 0)       live.tempC = d.temp;
  // fan rpm: AxeOS sends fanrpm (number); TNA-OS sends fanRpm (per-fan array)
  {
    let fr = (typeof d.fanrpm === 'number') ? d.fanrpm : null;
    if (fr == null && d.fanRpm != null) {
      if (Array.isArray(d.fanRpm)) {
        const nums = d.fanRpm.filter(x => typeof x === 'number' && x >= 0);
        if (nums.length) fr = Math.max(...nums);
      } else if (typeof d.fanRpm === 'number') {
        fr = d.fanRpm;
      }
    }
    if (typeof fr === 'number' && fr >= 0) live.fanRpm = fr;
  }
  {
    const fp = (typeof d.fanspeed === 'number') ? d.fanspeed
             : (typeof d.fanSpeed === 'number') ? d.fanSpeed : null;
    if (fp != null && fp >= 0 && fp <= 100) live.fanPct = fp;
  }
  if (typeof d.uptimeSeconds === 'number')            live.uptimeSec = d.uptimeSeconds;
  // v2.x: ESP/TNA firmware reports hashRate:0 for the first ~minutes after boot
  // while its averaging window fills. Showing a stark "0 H/s" next to a healthy
  // pool-side hashrate is misleading, and it also poisons the efficiency calc
  // (power ÷ ~0 = absurd J/TH). Treat 0 during the warm-up window as "not yet
  // reported" (null → UI hides the row) rather than a real zero. A genuine 0 on
  // an established miner (uptime past the window) is a real fault, so keep it.
  const WARMUP_SEC = 180;
  if (typeof d.hashRate === 'number' && d.hashRate >= 0) {
    const warmingUp = d.hashRate === 0 && live.uptimeSec != null && live.uptimeSec < WARMUP_SEC;
    live.hashrateReported = warmingUp ? null : d.hashRate * 1e9;
  }
  if (typeof d.version === 'string')                  live.firmwareVersion = d.version;
  // v1.12.x: ESP-Miner reports the actual mining chip in ASICModel
  // (e.g. "BM1370", "BM1366"). This is the authoritative model signal —
  // far more reliable than guessing from the worker name. Captured here
  // and consumed by miner-detect's detectFromAsicModel().
  if (typeof d.ASICModel === 'string' && d.ASICModel.trim()) live.asicModel = d.ASICModel.trim();
  else if (typeof d.asicModel === 'string' && d.asicModel.trim()) live.asicModel = d.asicModel.trim();
  // v2.x: friendly model name (NerdQAxe++ / BitAxe Gamma / …) for benchmark
  // bucketing & labels — without this, buckets read the raw chip ("BM1370").
  live.model = friendlyEspModel(d);
  if (typeof d.asicCount === 'number' && d.asicCount > 0) live.asicCount = d.asicCount;
  if (typeof d.boardVersion === 'string' && d.boardVersion.trim()) live.boardVersion = d.boardVersion.trim();
  // v1.12.0: ESP-Miner reports instantaneous power draw in watts.
  if (typeof d.power === 'number' && d.power > 0 && d.power < 20000) live.powerW = d.power;
  // v2.x: tuning knobs from the SAME /api/system/info payload — frequency (MHz)
  // and core voltage (mV). coreVoltageActual is the measured value (preferred);
  // coreVoltage is the configured target. These feed the crowdsourced benchmark
  // layer and the per-worker tuning detail. Bounds guard against bad firmware.
  if (typeof d.frequency === 'number' && d.frequency > 0 && d.frequency < 2000) live.frequencyMhz = d.frequency;
  if (typeof d.coreVoltageActual === 'number' && d.coreVoltageActual > 0 && d.coreVoltageActual < 20000) live.coreVoltageMv = _mvify(d.coreVoltageActual);
  else if (typeof d.coreVoltage === 'number' && d.coreVoltage > 0 && d.coreVoltage < 20000) live.coreVoltageMv = _mvify(d.coreVoltage);
  // v2.x: device-reported safe voltage bounds (TNA-OS / AxeOS expose these in
  // /api/system/info as minVoltage/maxVoltage, mV). These are the AUTHORITATIVE
  // tuning envelope for this exact hardware — the control layer prefers them
  // over any hardcoded per-class range, so an S19XP's ~12–15 V domain and a
  // Bitaxe's ~0.9–1.4 V domain are each respected without guessing.
  if (typeof d.minVoltage === 'number' && d.minVoltage > 0 && d.minVoltage < 20000) live.minVoltageMv = _mvify(d.minVoltage);
  if (typeof d.maxVoltage === 'number' && d.maxVoltage > 0 && d.maxVoltage < 20000) live.maxVoltageMv = _mvify(d.maxVoltage);
  // v2.x: this device answered the AxeOS HTTP API, so frequency/voltage tuning
  // via PATCH /api/system is available — even when the adapter label is
  // 'cgminer' (TNA-OS on Antminer/Avalon). The control layer reads this to
  // decide whether to show + accept tuning writes.
  live.httpTunable = true;
  // v2.x Tier-1: the CONFIGURED core voltage (target). Shown alongside the
  // measured value as "set → actual" so VR sag is visible at a glance.
  if (typeof d.coreVoltage === 'number' && d.coreVoltage > 0 && d.coreVoltage < 20000) live.coreVoltageSetMv = d.coreVoltage;
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
  if (typeof d.defaultCoreVoltage === 'number' && d.defaultCoreVoltage > 0 && d.defaultCoreVoltage < 20000) live.defaultCoreVoltageMv = d.defaultCoreVoltage;
  live.efficiencyJTH = computeEfficiency(live.powerW, live.hashrateReported);

  // ── Tier 2: operator telemetry (some benchmark-eligible) ──────────────────
  // Input rail (BitAxe `voltage` mV → V, `current` mA → A; NerdQAxe similar).
  if (typeof d.voltage === 'number' && d.voltage > 0) live.inputVoltageV = d.voltage / 1000;
  if (typeof d.current === 'number' && d.current > 0) live.inputCurrentA = d.current / 1000;
  // Fan PID setpoint (BitAxe `temptarget`, NerdQAxe `pidTargetTemp`).
  if (typeof d.temptarget === 'number' && d.temptarget > 0) live.tempTargetC = d.temptarget;
  else if (typeof d.pidTargetTemp === 'number' && d.pidTargetTemp > 0) live.tempTargetC = d.pidTargetTemp;
  if (typeof d.overclockEnabled !== 'undefined') live.overclockEnabled = !!d.overclockEnabled;
  if (typeof d.overheat_mode !== 'undefined') live.overheatMode = !!d.overheat_mode;
  if (typeof d.boardVersion === 'string' && d.boardVersion.trim()) live.boardVersion = d.boardVersion.trim();
  else if (typeof d.boardVersion === 'number') live.boardVersion = String(d.boardVersion);
  // Rolling hashrate windows (NerdQAxe exposes these directly; H/s).
  if (typeof d.hashRate_1m === 'number')  live.hr1m  = d.hashRate_1m  * 1e9;
  if (typeof d.hashRate_10m === 'number') live.hr10m = d.hashRate_10m * 1e9;
  if (typeof d.hashRate_1h === 'number')  live.hr1h  = d.hashRate_1h  * 1e9;
  if (typeof d.hashRate_1d === 'number')  live.hr1d  = d.hashRate_1d  * 1e9;
  if (typeof d.vrTemp === 'number' && d.vrTemp > 0) live.vrTempC = d.vrTemp;
  // Connection health.
  if (typeof d.isStratumConnected !== 'undefined') live.stratumConnected = !!d.isStratumConnected;
  if (typeof d.lastpingrtt === 'number' && d.lastpingrtt >= 0) live.pingRttMs = d.lastpingrtt;
  if (typeof d.recentpingloss === 'number' && d.recentpingloss >= 0) live.pingLossPct = d.recentpingloss;

  // ── Tier 3: OPERATOR-ONLY system/identity/noise → live.advanced ───────────
  // Captured for the operator's Advanced panel. NEVER broadcast — the benchmark
  // whitelist only reads a fixed top-level field set and cannot reach in here.
  const adv = live.advanced;
  const setAdv = (k, v) => { if (v !== undefined && v !== null && v !== '') adv[k] = v; };
  setAdv('hostname', d.hostname);
  setAdv('ssid', d.ssid);
  setAdv('wifiRSSI', (typeof d.wifiRSSI === 'number' && d.wifiRSSI !== 0 && d.wifiRSSI !== -128) ? d.wifiRSSI : null);
  setAdv('networkMode', d.networkMode);
  setAdv('macAddr', (d.macAddr && d.macAddr.trim()) ? d.macAddr.trim() : (d.ethMac || null));
  setAdv('ethIPv4', d.ethIPv4 || d.ipv4 || d.hostip);
  setAdv('freeHeap', d.freeHeap);
  setAdv('lastResetReason', d.lastResetReason);
  setAdv('runningPartition', d.runningPartition);
  setAdv('idfVersion', d.idfVersion);
  setAdv('axeOSVersion', d.axeOSVersion);
  setAdv('stratumUser', d.stratumUser);            // contains payout address — operator-only
  setAdv('stratumURL', (d.stratumURL != null && d.stratumPort != null) ? `${d.stratumURL}:${d.stratumPort}` : null);
  if (typeof d.pidP === 'number' || typeof d.pidI === 'number' || typeof d.pidD === 'number') {
    setAdv('pid', `P${d.pidP ?? '–'} I${d.pidI ?? '–'} D${d.pidD ?? '–'}`);
  }
  setAdv('jobInterval', d.jobInterval);
  setAdv('smallCoreCount', d.smallCoreCount);
  setAdv('asicCount', d.asicCount);
  setAdv('deviceModel', d.deviceModel);   // from /api/system/asic — "Gamma"/"GT"/"Hex"/…
  setAdv('swarmColor', d.swarmColor);     // from /api/system/asic — per-board accent
  setAdv('defaultTheme', d.defaultTheme);
  setAdv('display', d.display);
  setAdv('freeHeapInt', d.freeHeapInt);
  setAdv('proxyDifficulty', d.proxyDifficulty);
  setAdv('jobInterval', d.jobInterval);
  if (typeof d.armyEnabled !== 'undefined') {
    setAdv('army', d.armyEnabled ? `enabled (${d.armyConnected ? 'connected' : 'disconnected'})` : 'disabled');
  }

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

  // v3.0.3: TNA-OS (and some cgminer builds) don't emit a "Stratum Active"
  // flag — they signal the in-use pool via Status:"Alive" + the POOL index.
  // If nothing set an explicit active flag above, fall back to cgminer's rule:
  // the active pool is the lowest-priority (lowest POOL#) pool that is Alive.
  if (!configuredPools.some(p => p.active)) {
    const aliveRanked = configuredPools
      .map((p, i) => ({ p, i, prio: (typeof p.priority === 'number' ? p.priority : i) }))
      .filter(x => typeof x.p.status === 'string' && x.p.status.toLowerCase() === 'alive')
      .sort((a, b) => a.prio - b.prio);
    if (aliveRanked.length) aliveRanked[0].p.active = true;
  }

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
  // v2.x: maintain a small ring buffer of recent hashrate samples per worker so
  // we can compute a server-side rolling average for the benchmark (fallback for
  // devices that don't report their own average). Carries across poll cycles
  // (saveRecord replaces the record, so we must preserve it explicitly).
  const prev = records.get(workerName);
  let hrSamples = (prev && Array.isArray(prev.hrSamples)) ? prev.hrSamples : [];
  const hr = partial && partial.live && partial.live.hashrateReported;
  const pw = partial && partial.live && partial.live.powerW;
  if (Number.isFinite(hr) && hr > 0) {
    hrSamples = hrSamples.concat([{ ts: Date.now(), hr, pw: (Number.isFinite(pw) && pw > 0 ? pw : null) }]);
    const cutoff = Date.now() - 60 * 60 * 1000; // keep ~1h
    hrSamples = hrSamples.filter(s => s.ts >= cutoff).slice(-120); // cap 120 samples
  }
  records.set(workerName, { ...partial, hrSamples, lastCheckedAt: Date.now() });
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

// ── test-only exports ───────────────────────────────────────────────────────
// Exposed for gekko-test.js / fixture harnesses. Harmless in production: these
// are pure functions with no side effects and the running server never calls them.
module.exports.extractEspMinerLive = extractEspMinerLive;
module.exports.friendlyEspModel = friendlyEspModel;
