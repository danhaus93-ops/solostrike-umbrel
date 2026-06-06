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
const LIMITS = {
  frequency:   { min: 100, max: 1200 },   // MHz
  coreVoltage: { min: 900, max: 1400 },   // mV (BM-series domain)
  fanspeed:    { min: 0,   max: 100 },     // %
  stratumPort: { min: 1,   max: 65535 },
};

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
async function dispatch(ip, adapter, action, body) {
  body = body || {};
  const isEsp = adapter === 'esp-miner';
  const isCg  = adapter === 'cgminer';

  if (action === 'tuning') {
    if (!isEsp) return { ok: false, error: 'unsupported', message: 'Frequency/voltage tuning is only available on AxeOS (Bitaxe/NerdQAxe) miners.' };
    const patch = {};
    if (body.frequency != null) {
      const f = clampInt(body.frequency, LIMITS.frequency);
      if (f == null) return { ok: false, error: 'out_of_range', message: `frequency must be ${LIMITS.frequency.min}–${LIMITS.frequency.max} MHz` };
      patch.frequency = f;
    }
    if (body.coreVoltage != null) {
      const v = clampInt(body.coreVoltage, LIMITS.coreVoltage);
      if (v == null) return { ok: false, error: 'out_of_range', message: `coreVoltage must be ${LIMITS.coreVoltage.min}–${LIMITS.coreVoltage.max} mV` };
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
      const add = await cgminerCmd(ip, { command: 'addpool', parameter: `${url}:${port},${user},${pass}` });
      const addS = cgStatusOk(add);
      if (!addS.ok) return { ok: false, error: 'cg_addpool_failed', message: addS.msg || 'addpool failed' };
      const pools = await cgminerCmd(ip, { command: 'pools' });
      let newId = null;
      try {
        const list = pools.data && pools.data.POOLS ? pools.data.POOLS : [];
        const match = list.filter(p => String(p.URL || '').includes(url));
        if (match.length) newId = match[match.length - 1].POOL;
      } catch {}
      if (newId != null) await cgminerCmd(ip, { command: 'switchpool', parameter: String(newId) });
      return { ok: true, applied: { url, port, user }, restart: false, note: 'pool added/switched on Avalon (verify on the miner)' };
    }
    return { ok: false, error: 'unsupported', message: 'unknown miner adapter for this worker' };
  }

  if (action === 'restart') {
    if (isEsp) { const r = await espRestart(ip); return r.ok ? { ok: true, restart: true } : { ok: false, error: r.error || ('http_' + r.status), message: 'restart failed or miner unreachable' }; }
    if (isCg)  { const r = await cgminerCmd(ip, { command: 'restart' }); const s = cgStatusOk(r); return s.ok ? { ok: true, restart: true } : { ok: false, error: 'cg_restart_failed', message: s.msg || 'restart failed' }; }
    return { ok: false, error: 'unsupported', message: 'restart not supported for this miner' };
  }

  if (action === 'avalon-level') {
    if (!isCg) return { ok: false, error: 'unsupported', message: 'power-mode is only available on Avalon miners' };
    const lvl = clampInt(body.level, { min: 0, max: 2 });
    if (lvl == null) return { ok: false, error: 'out_of_range', message: 'level must be 0, 1, or 2' };
    const r = await cgminerCmd(ip, { command: 'ascset', parameter: `0,worklevel,${lvl}` });
    const s = cgStatusOk(r);
    return s.ok ? { ok: true, applied: { level: lvl } } : { ok: false, error: 'cg_ascset_failed', message: s.msg || 'power-mode set failed' };
  }

  return { ok: false, error: 'bad_action', message: 'unknown action' };
}

module.exports = { dispatch, LIMITS };
