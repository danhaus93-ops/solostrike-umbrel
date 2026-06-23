'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// miner-control.js — WRITE settings to a miner's local API.
//
// SAFETY MODEL
//   • These actions are reached only through POST /api/miners/control/:worker,
//     which is NOT in PROXY_AUTH_WHITELIST → it requires the app session token.
//   • We only ever talk to a private LAN IP that ckpool already harvested for a
//     connected worker (server.js resolves state.workers[name].ip). We never
//     accept an arbitrary host from the client.
//   • SoloStrike relays the values the user typed. The UI gates them behind a
//     3× disclaimer + per-apply checkboxes; here we add a hard server-side clamp
//     as defense-in-depth so a malformed request can't push absurd values.
//
// ADAPTERS
//   esp-miner (Bitaxe / NerdQAxe / GekkoAxe — AxeOS):
//       PATCH /api/system   { frequency, coreVoltage, fanspeed, autofanspeed,
//                             stratumURL, stratumPort, stratumUser, stratumPassword }
//       POST  /api/system/restart
//   cgminer (Avalon Nano):
//       ascset worklevel  (power mode)   + addpool/switchpool (pool)
//       Best-effort: Avalon firmware is less uniform; failures return a clear msg.
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http');
const net  = require('net');

const HTTP_PORT       = 80;
const CGMINER_PORT    = 4028;
const WRITE_TIMEOUT_MS = 6000;

// Hard safety envelope — refuse anything outside this regardless of UI state.
// coreVoltage is NOT one-size-fits-all: the safe domain depends on the ASIC
// family. Bitaxe/NerdQAxe (single BM-series chip) run ~0.9–1.4 V; the Avalon
// Nano 3s runs ~3.1–3.9 V; big Antminers on TNA-OS run ~12–15 V. Sending a
// Bitaxe-domain value to a 13 V Antminer (or vice-versa) is meaningless at best
// and damaging at worst, so we select the domain per device and, when the miner
// reports its OWN minVoltage/maxVoltage over HTTP, prefer those exact bounds.
const LIMITS = {
  frequency:   { min: 100, max: 1200 },   // MHz (covers Bitaxe..Antminer targets)
  fanspeed:    { min: 0,   max: 100 },     // %
  stratumPort: { min: 1,   max: 65535 },
};

// Per-class fallback voltage envelopes (mV) — used only when the device does
// not report its own minVoltage/maxVoltage. Deliberately a bit tighter than the
// absolute chip max for safety margin.
const VOLTAGE_DOMAINS = {
  'bm-series': { min: 900,   max: 1400  },  // Bitaxe / NerdQAxe / GekkoAxe
  'avalon-nano': { min: 3100, max: 3900 },  // Avalon Nano 3s (TNA-OS Canaan)
  'antminer-big': { min: 11000, max: 15200 }, // S19/S21-class on TNA-OS
};

// Pick the safe coreVoltage envelope for THIS device. Precedence:
//   1. The miner's own reported minVoltage/maxVoltage (most authoritative).
//   2. Class inferred from model / current voltage magnitude.
//   3. Conservative BM-series default (smallest domain) so an unknown device
//      can never be sent a high-voltage value by mistake.
// `ctx` carries { model, asicModel, coreVoltageMv, minVoltageMv, maxVoltageMv }
// gathered from the latest poll record's `live`.
function voltageDomainFor(ctx) {
  ctx = ctx || {};
  // 1. device-reported bounds (sanity-checked)
  const rMin = Number(ctx.minVoltageMv), rMax = Number(ctx.maxVoltageMv);
  if (Number.isFinite(rMin) && Number.isFinite(rMax) && rMin > 0 && rMax > rMin && rMax < 20000) {
    return { min: Math.round(rMin), max: Math.round(rMax), source: 'device' };
  }
  // 2. infer from current live voltage magnitude (most reliable single signal)
  const v = Number(ctx.coreVoltageMv);
  if (Number.isFinite(v) && v > 0) {
    if (v >= 8000)  return { ...VOLTAGE_DOMAINS['antminer-big'], source: 'magnitude' };
    if (v >= 2500)  return { ...VOLTAGE_DOMAINS['avalon-nano'],  source: 'magnitude' };
    return { ...VOLTAGE_DOMAINS['bm-series'], source: 'magnitude' };
  }
  // 3. infer from model string
  const m = String(ctx.model || ctx.asicModel || '').toLowerCase();
  if (/s19|s21|antminer|t19|t21/.test(m)) return { ...VOLTAGE_DOMAINS['antminer-big'], source: 'model' };
  if (/avalon|nano|a3197/.test(m))        return { ...VOLTAGE_DOMAINS['avalon-nano'],  source: 'model' };
  // 4. safest default
  return { ...VOLTAGE_DOMAINS['bm-series'], source: 'default' };
}

function clampInt(v, lim) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  if (n < lim.min || n > lim.max) return null;
  return n;
}

// ── AxeOS / ESP-Miner ────────────────────────────────────────────────────────
function espPatch(ip, body) {
  return new Promise((resolve) => {
    const payload = JSON.stringify(body);
    let done = false; const finish = (o) => { if (!done) { done = true; resolve(o); } };
    const req = http.request({
      host: ip, port: HTTP_PORT, path: '/api/system', method: 'PATCH',
      timeout: WRITE_TIMEOUT_MS,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = ''; res.setEncoding('utf8');
      res.on('data', c => { data += c; });
      res.on('end', () => finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data }));
    });
    req.on('error', e => finish({ ok: false, error: e.code || 'unknown' }));
    req.on('timeout', () => { try { req.destroy(); } catch {} finish({ ok: false, error: 'timeout' }); });
    req.write(payload); req.end();
  });
}

function espRestart(ip) {
  return new Promise((resolve) => {
    let done = false; const finish = (o) => { if (!done) { done = true; resolve(o); } };
    const req = http.request({
      host: ip, port: HTTP_PORT, path: '/api/system/restart', method: 'POST', timeout: WRITE_TIMEOUT_MS,
    }, (res) => { res.resume(); res.on('end', () => finish({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode })); });
    req.on('error', e => finish({ ok: false, error: e.code || 'unknown' }));
    req.on('timeout', () => { try { req.destroy(); } catch {} finish({ ok: false, error: 'timeout' }); });
    req.end();
  });
}

// ── cgminer (Avalon) ─────────────────────────────────────────────────────────
function cgminerCmd(ip, command) {
  return new Promise((resolve) => {
    let data = ''; let done = false; const finish = (o) => { if (!done) { done = true; resolve(o); } };
    const s = net.connect({ host: ip, port: CGMINER_PORT });
    s.setTimeout(WRITE_TIMEOUT_MS);
    s.on('connect', () => s.write(JSON.stringify(command)));
    s.on('data', c => { data += c; });
    s.on('end', () => {
      const clean = data.replace(/\0+$/, '').trim();
      try { finish({ ok: true, data: JSON.parse(clean) }); }
      catch { finish({ ok: true, raw: clean }); }
    });
    s.on('error', e => finish({ ok: false, error: e.code || 'unknown' }));
    s.on('timeout', () => { try { s.destroy(); } catch {} finish({ ok: false, error: 'timeout' }); });
  });
}

function cgStatusOk(resp) {
  // cgminer replies { STATUS:[{ STATUS:'S'|'E'|'W'|'I', Msg:'...' }], ... }
  try {
    const st = resp && resp.data && Array.isArray(resp.data.STATUS) ? resp.data.STATUS[0] : null;
    if (!st) return { ok: !!(resp && resp.ok), msg: resp && resp.raw };
    return { ok: st.STATUS === 'S' || st.STATUS === 'I', msg: st.Msg };
  } catch { return { ok: false, msg: 'parse_error' }; }
}

// ── public dispatch ──────────────────────────────────────────────────────────
//
// action:
//   'tuning'  { frequency?, coreVoltage?, fanspeed?, autofanspeed? }   (esp only)
//   'pool'    { url, port, user, password, restart? }                  (esp + avalon)
//   'restart' {}                                                       (esp + avalon)
//   'avalon-level' { level: 0|1|2 }                                    (avalon only)
//
async function dispatch(ip, adapter, action, body, ctx) {
  body = body || {};
  ctx = ctx || {};
  const isEsp = adapter === 'esp-miner';
  const isCg  = adapter === 'cgminer';
  // TNA-OS runs on Antminer/Avalon hardware so it's classified as the cgminer
  // adapter, but it ALSO serves the AxeOS HTTP API (PATCH /api/system) — so it
  // IS tuning-capable. We treat a device as HTTP-tunable when the poll record
  // shows it exposed AxeOS-style telemetry over HTTP (surfaced as ctx.httpTunable).
  const httpTunable = isEsp || !!ctx.httpTunable;

  if (action === 'tuning') {
    if (!httpTunable) return { ok: false, error: 'unsupported', message: 'Frequency/voltage tuning is only available on miners that expose the AxeOS HTTP API (Bitaxe/NerdQAxe, or Antminer/Avalon running TNA-OS).' };
    // Select the per-device coreVoltage envelope. A wrong-domain value (e.g. a
    // 1200 mV Bitaxe setting sent to a 13 V Antminer) is refused here.
    const vDomain = voltageDomainFor(ctx);
    const patch = {};
    if (body.frequency != null) {
      const f = clampInt(body.frequency, LIMITS.frequency);
      if (f == null) return { ok: false, error: 'out_of_range', message: `frequency must be ${LIMITS.frequency.min}–${LIMITS.frequency.max} MHz` };
      patch.frequency = f;
    }
    if (body.coreVoltage != null) {
      const v = clampInt(body.coreVoltage, vDomain);
      if (v == null) return { ok: false, error: 'out_of_range', message: `coreVoltage must be ${vDomain.min}–${vDomain.max} mV for this device` };
      patch.coreVoltage = v;
    }
    if (body.autofanspeed != null) patch.autofanspeed = !!body.autofanspeed;
    if (!patch.autofanspeed && body.fanspeed != null) {
      const fan = clampInt(body.fanspeed, LIMITS.fanspeed);
      if (fan == null) return { ok: false, error: 'out_of_range', message: 'fanspeed must be 0–100 %' };
      patch.fanspeed = fan;
    }
    if (Object.keys(patch).length === 0) return { ok: false, error: 'empty', message: 'no settings to apply' };
    const r = await espPatch(ip, patch);
    return r.ok ? { ok: true, applied: patch, restart: false } : { ok: false, error: r.error || ('http_' + r.status), message: 'miner rejected the write or was unreachable' };
  }

  if (action === 'pool') {
    const url  = String(body.url || '').trim().replace(/^stratum\+tcp:\/\//i, '').replace(/^stratum\+ssl:\/\//i, '');
    const port = clampInt(body.port, LIMITS.stratumPort);
    const user = String(body.user || '').trim();
    const pass = body.password != null ? String(body.password) : 'x';
    if (!url || port == null || !user) return { ok: false, error: 'invalid_pool', message: 'pool needs a URL, port (1–65535), and worker/user' };

    if (isEsp) {
      const r = await espPatch(ip, { stratumURL: url, stratumPort: port, stratumUser: user, stratumPassword: pass });
      if (!r.ok) return { ok: false, error: r.error || ('http_' + r.status), message: 'miner rejected the pool write or was unreachable' };
      if (body.restart) { const rr = await espRestart(ip); return { ok: rr.ok, applied: { url, port, user }, restart: true, restartOk: rr.ok }; }
      return { ok: true, applied: { url, port, user }, restart: false, note: 'pool written — restart the miner for it to take effect' };
    }
    if (isCg) {
      // Avalon: ascset setpool <login_user>,<login_pass>,<pooladdr>,<worker>,<workerpass>.
      // Login creds default to root/root (standard Avalon). Takes effect on reboot.
      const scheme = body.tls ? 'stratum+ssl' : 'stratum+tcp';
      const r = await cgminerCmd(ip, { command: 'ascset', parameter: `0,setpool,root,root,${scheme}://${url}:${port},${user},${pass}` });
      const s = cgStatusOk(r);
      if (!s.ok) return { ok: false, error: 'cg_setpool_failed', message: s.msg || 'setpool failed (is the Avalon login root/root?)' };
      if (body.restart) { const rr = await cgminerCmd(ip, { command: 'ascset', parameter: '0,reboot,0' }); return { ok: true, applied: { url, port, user }, restart: true, restartOk: cgStatusOk(rr).ok }; }
      return { ok: true, applied: { url, port, user }, restart: false, note: 'pool written — reboot the Avalon for it to take effect' };
    }
    return { ok: false, error: 'unsupported', message: 'unknown miner adapter for this worker' };
  }

  if (action === 'restart') {
    if (isEsp) { const r = await espRestart(ip); return r.ok ? { ok: true, restart: true } : { ok: false, error: r.error || ('http_' + r.status), message: 'restart failed or miner unreachable' }; }
    if (isCg)  { const r = await cgminerCmd(ip, { command: 'ascset', parameter: '0,reboot,0' }); const s = cgStatusOk(r); return s.ok ? { ok: true, restart: true } : { ok: false, error: 'cg_reboot_failed', message: s.msg || 'reboot failed' }; }
    return { ok: false, error: 'unsupported', message: 'restart not supported for this miner' };
  }

  if (action === 'avalon') {
    if (!isCg) return { ok: false, error: 'unsupported', message: 'power-mode/fan is only available on Avalon miners' };
    const applied = {}; const fails = [];
    if (body.level != null) {
      const lvl = clampInt(body.level, { min: 0, max: 2 });
      if (lvl == null) return { ok: false, error: 'out_of_range', message: 'level must be 0, 1, or 2' };
      const r = await cgminerCmd(ip, { command: 'ascset', parameter: `0,workmode,set,${lvl}` });
      const s = cgStatusOk(r);
      if (s.ok) applied.level = lvl; else fails.push('workmode: ' + (s.msg || 'failed'));
    }
    if (body.fanAuto) {
      const r = await cgminerCmd(ip, { command: 'ascset', parameter: '0,fan-spd,-1' });
      const s = cgStatusOk(r);
      if (s.ok) applied.fan = 'auto'; else fails.push('fan: ' + (s.msg || 'failed'));
    } else if (body.fanspeed != null) {
      const fan = clampInt(body.fanspeed, { min: 15, max: 100 });
      if (fan == null) return { ok: false, error: 'out_of_range', message: 'Avalon fan must be 15–100 % (or AUTO)' };
      const r = await cgminerCmd(ip, { command: 'ascset', parameter: `0,fan-spd,${fan}` });
      const s = cgStatusOk(r);
      if (s.ok) applied.fan = fan; else fails.push('fan: ' + (s.msg || 'failed'));
    }
    if (fails.length) return { ok: false, error: 'cg_ascset_failed', message: fails.join('; '), applied };
    if (Object.keys(applied).length === 0) return { ok: false, error: 'empty', message: 'nothing to apply' };
    return { ok: true, applied };
  }

  return { ok: false, error: 'bad_action', message: 'unknown action' };
}

module.exports = { dispatch, LIMITS };
