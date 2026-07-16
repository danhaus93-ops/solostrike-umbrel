'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// alias-registry.js — API-side client for the SoloStrike alias registry.
//
//   • fetchRegistry()  GET <base>/registry.json → verify it's a genuine, signed
//     authority event (verifyEvent + pubkey === AUTHORITY_PUBKEY + right kind),
//     parse, and cache. Falls back to the last-known-good cache on any failure,
//     so resolution never breaks when the Worker/CDN is unreachable.
//   • resolve(name)    folded lookup → { pubkey, display } | null.
//   • postClaim(evt)   POST a signed claim event to <base>/claim.
//
// CONFIG (set via env or edit the two constants):
//   SS_REGISTRY_URL     base URL of the Worker, e.g. https://solostrike-alias-registry.<you>.workers.dev
//   SS_REGISTRY_PUBKEY  the authority PUBLIC key (64-hex) the Worker signs with.
// ─────────────────────────────────────────────────────────────────────────────

let verifyEvent;
try { ({ verifyEvent } = require('nostr-tools/pure')); }
catch { try { ({ verifyEvent } = require('nostr-tools')); } catch { verifyEvent = null; } }

const REGISTRY_KIND = 30079;

// ↓↓↓ FILL THESE IN after deploying the Worker (or set the env vars). ↓↓↓
const REGISTRY_BASE   = (process.env.SS_REGISTRY_URL    || 'https://solostrike-alias-registry.rwyft6g28c.workers.dev').replace(/\/+$/, '');
// v3.6.2: Worker signing key ROTATED (June: 3d7f7c02…, verified then; July:
// 5bf81c72…, verified via live /registry.json). Clients rejected the registry
// in between, so no alias resolved (names showed as striker-XXXX and the clean
// verified label never triggered). Overridable via SS_REGISTRY_PUBKEY so the
// next rotation is a compose edit, not a release.
const AUTHORITY_PUBKEY = (process.env.SS_REGISTRY_PUBKEY || '5bf81c72c7e55ccf53698185691e55a47159a5cce6343fa1f558405ea623a362').toLowerCase();

const FETCH_TIMEOUT_MS = 6000;

function fold(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// cache: { updated, byFolded: Map<folded,{pubkey,display}> }
let cache = null;

function isConfigured() {
  return /^https?:\/\//.test(REGISTRY_BASE) && !/CHANGE-ME/.test(REGISTRY_BASE) && /^[0-9a-f]{64}$/.test(AUTHORITY_PUBKEY);
}

// Verify + parse a registry event into a lookup. Returns null if untrusted.
function parseRegistryEvent(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (evt.kind !== REGISTRY_KIND) return null;
  if (String(evt.pubkey || '').toLowerCase() !== AUTHORITY_PUBKEY) return null;
  if (typeof verifyEvent === 'function') { try { if (!verifyEvent(evt)) return null; } catch { return null; } }
  let body;
  try { body = JSON.parse(evt.content); } catch { return null; }
  if (!body || !Array.isArray(body.entries)) return null;
  const byFolded = new Map();
  for (const e of body.entries) {
    if (!e || typeof e.name !== 'string' || !/^[0-9a-f]{64}$/.test(String(e.pubkey || ''))) continue;
    byFolded.set(fold(e.name), { pubkey: String(e.pubkey).toLowerCase(), display: e.name });
  }
  return { updated: body.updated || 0, byFolded };
}

// Seed the cache from a previously-persisted signed event (last-known-good).
function seedFromEvent(evt) {
  const parsed = parseRegistryEvent(evt);
  if (parsed) cache = parsed;
  return !!parsed;
}

async function fetchRegistry() {
  if (!isConfigured()) return null;
  let evt = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${REGISTRY_BASE}/registry.json`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.ok) evt = await res.json();
  } catch { /* network/timeout → keep last-known-good */ }
  if (!evt) return cache ? { ...cache, signedEvent: null } : null;
  const parsed = parseRegistryEvent(evt);
  if (!parsed) return cache ? { ...cache, signedEvent: null } : null; // reject untrusted, keep good copy
  cache = parsed;
  return { ...parsed, signedEvent: evt };
}

function resolve(name) {
  if (!cache || !name) return null;
  return cache.byFolded.get(fold(name)) || null;
}

function current() { return cache ? { updated: cache.updated, size: cache.byFolded.size } : null; }

async function postClaim(signedEvent) {
  if (!isConfigured()) return { ok: false, error: 'registry_not_configured', message: 'Set SS_REGISTRY_URL / SS_REGISTRY_PUBKEY first.' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${REGISTRY_BASE}/claim`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedEvent), signal: ctrl.signal,
    });
    clearTimeout(t);
    const j = await res.json().catch(() => ({}));
    return (j && typeof j === 'object') ? j : { ok: false, error: 'bad_response' };
  } catch (e) {
    return { ok: false, error: 'unreachable', message: 'could not reach the registry' };
  }
}

module.exports = { fold, isConfigured, seedFromEvent, fetchRegistry, resolve, current, postClaim, AUTHORITY_PUBKEY, REGISTRY_BASE };
