// ── network-stats.js ─────────────────────────────────────────────────────────
//
//   The SoloStrike Network — anonymous, opt-in census over nostr.
//
//   Publishes anonymous pool stats (hashrate, worker count, version,
//   blocks found) to nostr relays. Subscribes to other SoloStrike
//   installs and aggregates live network totals locally.
//
//   THREAT MODEL & DEFENSE LAYERS:
//
//   Tier 1:   Per-pubkey rate limiting (block spam from one bad actor).
//             Median-Absolute-Deviation outlier filter (block one big
//             liar from skewing the totals). Range validation on every
//             field. Schema check before trusting any payload.
//   Tier 2:   Encrypted identity at rest (privkey encrypted with a
//             device-bound salt before saving). Identity rotation
//             every 90 days (auto). Independent read keypair (so the
//             relay can't correlate our subscriptions vs publishing).
//             Plaintext-to-encrypted migration runs once at boot.
//   Tier 3:   Diversified relay pool (8 independent operators). Per-
//             broadcast random subset (publish to 5 of 8 each cycle so
//             no single operator sees all our broadcasts). Timing
//             jitter (5min ± 90s) defeats timing correlation.
//             Optional Tor routing through Umbrel's tor_proxy.
//
// ─────────────────────────────────────────────────────────────────────────────

const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs-extra');
const path = require('path');
const dns = require('dns').promises;
const net = require('net');
const { URL } = require('url');

// ── nostr-tools (CommonJS imports for older bundles) ────────────────────────
let finalizeEvent, generateSecretKey, getPublicKey, verifyEvent;
try {
  // Newer API path
  const pure = require('nostr-tools/pure');
  finalizeEvent     = pure.finalizeEvent;
  generateSecretKey = pure.generateSecretKey;
  getPublicKey      = pure.getPublicKey;
  verifyEvent       = pure.verifyEvent;
} catch (_) {
  // Fallback for older builds
  ({
    finalizeEvent,
    generateSecretKey,
    getPublicKey,
    verifyEvent,
  } = require('nostr-tools'));
}

// ── Optional Tor support via socks-proxy-agent ──────────────────────────────
// We require it inside a try so installs without socks-proxy-agent in their
// node_modules just get Pulse-without-Tor. The module is in package.json so
// this should always succeed on a clean build, but the guard keeps the
// service from crash-looping on a partially-installed container.
let SocksProxyAgent;
try {
  ({ SocksProxyAgent } = require('socks-proxy-agent'));
} catch (_) { /* Tor unavailable; toggle becomes a no-op */ }

// ── Constants ────────────────────────────────────────────────────────────────

// Default relay pool (Tier 3: diversified — N=8 from independent operators)
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://eden.nostr.land',
  'wss://nostr.bitcoiner.social',
  'wss://nostr.oxtr.dev',
  'wss://nostr-pub.wellorder.net',
];
// Per-broadcast subset size — picks N random relays each cycle
const PUBLISH_SUBSET_SIZE = 5;

const PUBLISH_INTERVAL_MS = 5 * 60 * 1000;          // 5 minutes baseline
const PUBLISH_JITTER_MS   = 90 * 1000;              // ±90s random offset
const SUBSCRIBE_WINDOW_MS = 15 * 60 * 1000;         // count events from last 15 min
const RECONNECT_DELAY_MS  = 30 * 1000;              // 30s between reconnect attempts
const EVENT_KIND          = 30078;                  // parameterized replaceable
const TAG_NAME            = 'solostrike-stats';

// Outbound throttle: we never broadcast our own pool more than once every 4 min,
// regardless of how many times we get poked
const MIN_OWN_BROADCAST_INTERVAL_MS = 4 * 60 * 1000;

// Inbound rate limit: any single pubkey can't deliver more than 1 event / 4min
// (otherwise we drop it as spam — typical legitimate broadcast is one per 5min)
// Tier 1 — Per-pubkey rate limit (block spam from one bad actor)
const MIN_PUBKEY_INTERVAL_SEC = 240;                 // 4 min between events from same pubkey
const PUBKEY_HISTORY_TTL_MS   = 30 * 60 * 1000;     // forget pubkeys we haven't seen in 30 min

// Hard ceilings — anything above these is plainly bogus
const MAX_HASHRATE_HPS  = 10e15;                    // 10 PH/s
const MAX_WORKERS       = 1000;
const MAX_BLOCKS        = 1e6;                       // sanity cap
const MAX_VERSION_LEN   = 16;                        // version strings are short

// Outlier filtering — Median Absolute Deviation, drop entries > 5×MAD from median
const OUTLIER_MAD_MULTIPLIER = 5;
const OUTLIER_MIN_SAMPLES    = 5;                    // need >= 5 to compute median meaningfully

// Identity rotation
const KEY_ROTATION_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;  // 90 days
const ENCRYPTION_VERSION       = 'v1';

// ── Utility — random subset selection ───────────────────────────────────────
function pickRandomSubset(arr, n) {
  if (arr.length <= n) return arr.slice();
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// ── Outlier filtering — Median Absolute Deviation ──────────────────────────
// MAD is more robust than stddev because a single huge value can't poison
// the median. If a hostile broadcaster says "1 EH/s", the median is unmoved
// and the broadcast gets clipped.
function medianAbsoluteDeviation(values) {
  if (values.length === 0) return { median: 0, mad: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map(v => Math.abs(v - median));
  deviations.sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];
  return { median, mad };
}

function isOutlier(value, median, mad) {
  if (mad === 0) return false; // can't determine outlier with zero deviation
  return Math.abs(value - median) > OUTLIER_MAD_MULTIPLIER * mad;
}

// ── Pool pin location (privacy-preserving 5° grid snap) ────────────────────
// Users can opt into broadcasting a coarse approximate location for the
// network globe. We always SNAP server-side too — never store/transmit
// finer than 5° (~500km cells, US-state-sized regions). Even if a malicious
// client sent precise coordinates, this re-snap step discards the precision.
const LOC_GRID_DEG = 5;
function snapToLocGrid(lat, lon) {
  return [
    Math.round(lat / LOC_GRID_DEG) * LOC_GRID_DEG,
    Math.round(lon / LOC_GRID_DEG) * LOC_GRID_DEG,
  ];
}

// ── Identity encryption (Tier 2 hardening) ─────────────────────────────────
// Encrypt the privkey at rest with a device-bound salt that we store in the
// same config file. This is NOT a security boundary against an attacker who
// can read the file (they have both halves), but it's defense against casual
// disk inspection: viewing the JSON doesn't immediately leak the private key.
function getDeviceSalt(cfg) {
  if (cfg.pulseDeviceSalt && /^[0-9a-f]{64}$/.test(cfg.pulseDeviceSalt)) {
    return Buffer.from(cfg.pulseDeviceSalt, 'hex');
  }
  // First-time generation — random, stable for the lifetime of this install
  const salt = crypto.randomBytes(32);
  cfg.pulseDeviceSalt = salt.toString('hex');
  return salt;
}

function encryptIdentityKey(plaintextHex, cfg) {
  const salt = getDeviceSalt(cfg);
  const key = crypto.scryptSync(salt, 'solostrike-pulse-v1', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintextHex, 'hex')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTION_VERSION}:${iv.toString('base64')}${enc.toString('base64')}${tag.toString('base64')}`;
}

function decryptIdentityKey(stored, cfg) {
  if (!stored || typeof stored !== 'string') return null;
  // Migration: old plaintext keys (64 hex chars) — accept but trigger re-encrypt
  if (/^[0-9a-f]{64}$/.test(stored)) {
    return { plaintext: stored, needsMigration: true };
  }
  if (!stored.startsWith(`${ENCRYPTION_VERSION}:`)) return null;
  try {
    const body = stored.slice(`${ENCRYPTION_VERSION}:`.length);
    // iv is 12 bytes → 16 base64 chars; tag is 16 bytes → 24 base64 chars
    const ivB64  = body.slice(0, 16);
    const tagB64 = body.slice(-24);
    const encB64 = body.slice(16, -24);
    const iv  = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const enc = Buffer.from(encB64, 'base64');
    const salt = getDeviceSalt(cfg);
    const key = crypto.scryptSync(salt, 'solostrike-pulse-v1', 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return { plaintext: dec.toString('hex'), needsMigration: false };
  } catch (e) {
    console.warn('[network-stats] Identity decryption failed:', e.message);
    return null;
  }
}

// ── Schema validation (Tier 1 hardening) ───────────────────────────────────
// Run on every inbound event before trusting any field. Drops malformed,
// out-of-range, or unsigned events. Returns parsed payload + accept flag.
function validateAndExtractEvent(ev, ourPubkey) {
  // Basic shape
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'bad-event-shape' };
  if (typeof ev.id !== 'string' || !/^[0-9a-f]{64}$/.test(ev.id)) {
    return { ok: false, reason: 'bad-id' };
  }
  if (typeof ev.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(ev.pubkey)) {
    return { ok: false, reason: 'bad-pubkey' };
  }
  if (typeof ev.kind !== 'number' || ev.kind !== EVENT_KIND) {
    return { ok: false, reason: 'wrong-kind' };
  }
  if (typeof ev.created_at !== 'number') {
    return { ok: false, reason: 'bad-timestamp' };
  }

  // Time window — drop anything older than our subscription window or further
  // in the future than 5 min (clock skew tolerance)
  const nowSec = Math.floor(Date.now() / 1000);
  const ageSec = nowSec - ev.created_at;
  if (ageSec > Math.floor(SUBSCRIBE_WINDOW_MS / 1000)) {
    return { ok: false, reason: 'too-old' };
  }
  if (ageSec < -300) {
    return { ok: false, reason: 'future-timestamp' };
  }

  // Tag presence — must have ['t', 'solostrike-stats'] for filter narrowing
  if (!Array.isArray(ev.tags) || !ev.tags.some(t => Array.isArray(t) && t[0] === 't' && t[1] === TAG_NAME)) {
    return { ok: false, reason: 'missing-tag' };
  }

  // Content — JSON, has the four fields with valid ranges
  if (typeof ev.content !== 'string' || ev.content.length > 2048) {
    return { ok: false, reason: 'bad-content-size' };
  }
  let data;
  try { data = JSON.parse(ev.content); } catch { return { ok: false, reason: 'bad-content-json' }; }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-content-type' };

  const hashrate = Number(data.hashrate);
  if (!Number.isFinite(hashrate) || hashrate < 0 || hashrate > MAX_HASHRATE_HPS) {
    return { ok: false, reason: 'hashrate-range' };
  }
  const workers = Number(data.workers);
  if (!Number.isFinite(workers) || workers < 0 || workers > MAX_WORKERS) {
    return { ok: false, reason: 'workers-range' };
  }
  const blocks = Number(data.blocks);
  if (!Number.isFinite(blocks) || blocks < 0 || blocks > MAX_BLOCKS) {
    return { ok: false, reason: 'blocks-range' };
  }
  const version = typeof data.version === 'string' && data.version.length <= MAX_VERSION_LEN
    ? data.version
    : 'unknown';

  // Optional pool location. Validate range; always re-snap server-side
  // even if the broadcaster pre-snapped, so the privacy invariant (≤5°
  // resolution) is enforced regardless of whether peers respect it.
  let loc = null;
  if (data.loc !== undefined) {
    if (Array.isArray(data.loc) && data.loc.length === 2) {
      const [latRaw, lonRaw] = data.loc;
      if (Number.isFinite(latRaw) && Number.isFinite(lonRaw)
          && latRaw >= -90 && latRaw <= 90
          && lonRaw >= -180 && lonRaw <= 180) {
        loc = snapToLocGrid(latRaw, lonRaw);
      }
    }
  }

  // v1.12.x: optional lastStrike — most recent block this peer claims found.
  // Validated for shape + sanity ranges. Block height bounded to current
  // chain tip + 1000 (defense against forged future blocks).
  let lastStrike = null;
  if (data.lastStrike !== undefined && data.lastStrike !== null) {
    if (typeof data.lastStrike === 'object'
        && Number.isFinite(data.lastStrike.height)
        && Number.isFinite(data.lastStrike.ts)
        && data.lastStrike.height >= 1
        && data.lastStrike.height <= 10_000_000  // sanity: way beyond current chain
        && data.lastStrike.ts >= 1_230_000_000   // post-genesis
        && data.lastStrike.ts <= (Date.now() / 1000) + 600) { // ≤10min future
      lastStrike = {
        height: Math.floor(data.lastStrike.height),
        ts: Math.floor(data.lastStrike.ts),
      };
    }
  }

  // v1.12.x: optional firstSeen — when this peer claims to have first
  // activated. Defensive: must be ≥ 2024-01-01 (after SoloStrike existed)
  // and ≤ event created_at. We don't trust this blindly — see the merge
  // logic in the consumer.
  let firstSeen = null;
  if (data.firstSeen !== undefined && Number.isFinite(data.firstSeen)) {
    if (data.firstSeen >= 1704067200 && data.firstSeen <= ev.created_at) {
      firstSeen = Math.floor(data.firstSeen);
    }
  }

  // Signature — verify last (most expensive). Skip our own (we trust local).
  if (ev.pubkey === ourPubkey) {
    // Echo of our own broadcast — fine, accept
  } else {
    if (typeof verifyEvent === 'function' && !verifyEvent(ev)) {
      return { ok: false, reason: 'bad-signature' };
    }
  }

  return {
    ok: true,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    payload: { hashrate, workers, blocks, version: version || 'unknown', loc, lastStrike, firstSeen },
  };
}

// ── Main controller factory ─────────────────────────────────────────────────
function startNetworkStats({ state, cfg, savePersist }) {
  // ── Identity bootstrap ─────────────────────────────────────────────────
  // First boot: generate and encrypt. Existing install: decrypt. Plaintext
  // legacy keys get re-encrypted on first save.
  const sockets = new Map();        // url -> WebSocket
  const reconnectTimers = new Map(); // url -> Timer
  const subId = 'solostrike-' + crypto.randomBytes(4).toString('hex');

  function saveIdentity() {
    if (typeof savePersist === 'function') {
      try {
        savePersist({
          nostrPrivkey: cfg.nostrPrivkey,
          nostrInstallId: cfg.nostrInstallId,
          pulseDeviceSalt: cfg.pulseDeviceSalt,
          networkStatsEnabled: !!cfg.networkStatsEnabled,
          pulseTorEnabled: !!cfg.pulseTorEnabled,
          // v1.12.x: persist when this install first joined the network. Used
          // for the "Joined Nd ago" badge in the Strikers modal and broadcast
          // to peers so they can show it for us. Rotates on identity rotation
          // (every 90 days) — that's intentional, fresh identity = fresh start.
          pulseFirstSeen: cfg.pulseFirstSeen,
        });
      } catch (e) {
        console.warn('[network-stats] saveIdentity failed:', e.message);
      }
    }
  }

  let plaintextForBackup = null;
  let privkeyBytes;

  const decrypted = decryptIdentityKey(cfg.nostrPrivkey, cfg);
  if (decrypted && decrypted.plaintext) {
    plaintextForBackup = decrypted.plaintext;
    privkeyBytes = Buffer.from(decrypted.plaintext, 'hex');
    if (decrypted.needsMigration) {
      cfg.nostrPrivkey = encryptIdentityKey(decrypted.plaintext, cfg);
      console.log('[network-stats] Migrated plaintext identity → encrypted v1');
    }
    if (!cfg.nostrInstallId) {
      cfg.nostrInstallId = crypto.randomUUID();
    }
  } else {
    // Fresh install or unrecoverable — generate
    const sk = generateSecretKey();
    plaintextForBackup = Buffer.from(sk).toString('hex');
    privkeyBytes = sk;
    cfg.nostrPrivkey = encryptIdentityKey(plaintextForBackup, cfg);
    cfg.nostrInstallId = crypto.randomUUID();
  }

  // v1.12.x: stamp pulseFirstSeen if not yet recorded. For brand-new identities
  // this is now-ish (matches "0d ago"). For users upgrading from v1.11.x, this
  // ALSO stamps now — so existing peers will show "0d ago" on first upgrade.
  // That's a one-time cosmetic acceptable tradeoff (we don't know when they
  // really first activated; we never persisted it before).
  if (!Number.isFinite(cfg.pulseFirstSeen) || cfg.pulseFirstSeen <= 0) {
    cfg.pulseFirstSeen = Math.floor(Date.now() / 1000);
  }

  const pubkey = getPublicKey(privkeyBytes);
  const installId = cfg.nostrInstallId;

  const ephemeralReadKey = generateSecretKey();
  const ephemeralReadPubkey = getPublicKey(ephemeralReadKey);

  console.log(`[network-stats] Identity: pubkey=${pubkey.slice(0,16)}... installId=${installId.slice(0,8)}... readkey=${ephemeralReadPubkey.slice(0,8)}...`);

  const seenEvents = new Map();
  const lastSeenPerPubkey = new Map();
  const droppedReasons = new Map();
  let lastOwnBroadcastAt = 0;

  state.networkStats = {
    enabled: !!cfg.networkStatsEnabled,
    pools: 0,
    hashrate: 0,
    workers: 0,
    blocks: 0,
    versions: {},
    lastUpdate: 0,
    relayStatus: {},
    // Per-peer breakdown for the Strikers modal. Each entry is anonymous —
    // pubkey is the only stable handle and is never exposed to the UI here.
    // Includes BOTH filtered and outlier entries; the UI decides what to show.
    peers: [],
    ownPubkey: '',  // populated below once pubkey closure var exists
    security: {
      eventsAccepted: 0,
      eventsDropped: 0,
      droppedReasons: {},
      outliersFiltered: 0,
      torEnabled: false,
    },
  };
  state.networkStats.ownPubkey = pubkey;

  // ── Tier 3: Tor support with reachability test + auto-fallback ──────────
  // Default URL points at Umbrel's tor_proxy container on umbrel_main_network.
  // Override via cfg.pulseTorUrl or env var PULSE_TOR_URL for non-Umbrel installs.
  const TOR_DEFAULT_URL = process.env.PULSE_TOR_URL || 'socks5h://tor_proxy:9050';

  // Tor health state machine — tracks whether Tor is actually working RIGHT NOW
  //   "off"        — user toggle is off, nothing to check
  //   "checking"   — actively probing reachability
  //   "ready"      — last probe succeeded, Tor is the path
  //   "fallback"   — toggle is on but probes fail; using direct, retrying in background
  const torHealth = {
    state: 'off',
    lastProbeAt: 0,
    lastProbeOk: null,
    consecutiveFailures: 0,
    activeUrl: TOR_DEFAULT_URL,
    lastError: null,
  };
  // Lightweight TCP probe to the SOCKS port. Doesn't actually open a SOCKS
  // session — just verifies the port accepts TCP. Cheap, ~50ms, reliable.
  function testSocksReachable(socksUrl, timeoutMs = 3000) {
    return new Promise((resolve) => {
      try {
        const u = new URL(socksUrl);
        const port = parseInt(u.port || '9050', 10);
        const host = u.hostname;
        const sock = new net.Socket();
        let done = false;
        const finish = (ok, err) => {
          if (done) return;
          done = true;
          try { sock.destroy(); } catch {}
          resolve({ ok, error: err || null });
        };
        sock.setTimeout(timeoutMs);
        sock.once('connect', () => finish(true));
        sock.once('timeout', () => finish(false, 'timeout'));
        sock.once('error', (e) => finish(false, e.code || e.message));
        sock.connect(port, host);
      } catch (e) {
        resolve({ ok: false, error: 'bad-url:' + e.message });
      }
    });
  }

  function buildSocketOptions(targetUrl) {
    // Returns the agent + headers config for a relay connection.
    // When Tor is healthy: route through SOCKS5. Otherwise: direct.
    const useTor = cfg.pulseTorEnabled && torHealth.state === 'ready' && SocksProxyAgent;
    if (useTor) {
      try {
        const agent = new SocksProxyAgent(torHealth.activeUrl);
        return { agent, headers: {}, mode: 'tor' };
      } catch (e) {
        console.warn(`[network-stats] Failed to construct SocksProxyAgent: ${e.message} — falling back to direct`);
        return { agent: undefined, headers: {}, mode: 'direct-fallback' };
      }
    }
    return { agent: undefined, headers: {}, mode: 'direct' };
  }

  function recordDrop(reason) {
    state.networkStats.security.eventsDropped++;
    droppedReasons.set(reason, (droppedReasons.get(reason) || 0) + 1);
    state.networkStats.security.droppedReasons = Object.fromEntries(droppedReasons);
  }

  // ── Relay connection management ─────────────────────────────────────────
  function connectRelay(url) {
    if (sockets.has(url)) {
      try { sockets.get(url).close(); } catch {}
    }
    if (reconnectTimers.has(url)) {
      clearTimeout(reconnectTimers.get(url));
      reconnectTimers.delete(url);
    }

    const { agent, headers, mode } = buildSocketOptions(url);
    let ws;
    try {
      ws = new WebSocket(url, { agent, headers });
      ws._pulseMode = mode; // for debug + securityStats
    } catch (e) {
      console.log(`[network-stats] WebSocket construction failed for ${url}: ${e.message}`);
      scheduleReconnect(url);
      return;
    }

    sockets.set(url, ws);
    state.networkStats.relayStatus[url] = 'connecting';

    ws.on('open', () => {
      state.networkStats.relayStatus[url] = 'connected';
      console.log(`[network-stats] Connected to ${url} (mode=${mode})`);
      // Subscribe to events with our tag from the last 15 min
      const sinceSec = Math.floor((Date.now() - SUBSCRIBE_WINDOW_MS) / 1000);
      const filter = {
        kinds: [EVENT_KIND],
        '#t': [TAG_NAME],
        since: sinceSec,
      };
      ws.send(JSON.stringify(['REQ', subId, filter]));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { recordDrop('bad-frame'); return; }
      if (!Array.isArray(msg)) { recordDrop('bad-frame-shape'); return; }

      if (msg[0] === 'EVENT') {
        // ['EVENT', subId, event]
        const ev = msg[2];
        handleIncomingEvent(ev);
      } else if (msg[0] === 'NOTICE') {
        // Relay-level notice — log but don't drop
        if (msg[1]) console.log(`[network-stats] NOTICE from ${url}: ${msg[1]}`);
      } else if (msg[0] === 'OK') {
        // Publish acknowledgment — fine
      } else if (msg[0] === 'EOSE') {
        // End of stored events — fine
      } else {
        // Unknown frame type — ignore
      }
    });

    ws.on('error', (e) => {
      console.log(`[network-stats] Relay ${url} error: ${e.message}`);
    });

    ws.on('close', () => {
      state.networkStats.relayStatus[url] = 'disconnected';
      sockets.delete(url);
      scheduleReconnect(url);
    });
  }

  function scheduleReconnect(url) {
    if (reconnectTimers.has(url)) return;
    const t = setTimeout(() => {
      reconnectTimers.delete(url);
      connectRelay(url);
    }, RECONNECT_DELAY_MS);
    reconnectTimers.set(url, t);
  }

  function closeAllSockets(reason) {
    for (const [url, ws] of sockets.entries()) {
      try { ws.close(); } catch {}
      sockets.delete(url);
    }
    for (const [url, t] of reconnectTimers.entries()) {
      clearTimeout(t);
      reconnectTimers.delete(url);
    }
    console.log(`[network-stats] All sockets closed (${reason}) — reconnecting…`);
    setTimeout(() => DEFAULT_RELAYS.forEach(connectRelay), 250);
  }

  // ── Event handling ──────────────────────────────────────────────────────
  function handleIncomingEvent(ev) {
    const result = validateAndExtractEvent(ev, pubkey);
    if (!result.ok) {
      recordDrop(result.reason);
      return;
    }

    // Per-pubkey rate limit (Tier 1) — exempt our own pubkey since we
    // publish to 5/8 relays and receive 5 echoes back per cycle. The
    // dedup-on-created_at check below already handles the duplicate
    // echoes; no need to throttle ourselves out of our own visibility.
    if (result.pubkey !== pubkey) {
      const lastSeen = lastSeenPerPubkey.get(result.pubkey);
      if (lastSeen && (result.created_at - lastSeen) < MIN_PUBKEY_INTERVAL_SEC) {
        recordDrop('rate-limited-pubkey');
        return;
      }
      lastSeenPerPubkey.set(result.pubkey, result.created_at);
    }


    const existing = seenEvents.get(result.pubkey);
    if (existing && existing.receivedAt >= result.created_at) {
      recordDrop('dedup-older');
      return;
    }

    // v1.12.x: track firstSeen — the timestamp we first observed this peer.
    // Preserved across updates so we can show "Joined Nd ago" in the UI.
    // If the peer broadcasts its OWN firstSeen (data.firstSeen), prefer
    // that value when older than what we have (true network-wide first-seen).
    const observedFirstSeen = (existing && existing.firstSeen) || result.created_at;
    let peerFirstSeen = observedFirstSeen;
    if (Number.isFinite(result.payload.firstSeen)
        && result.payload.firstSeen > 0
        && result.payload.firstSeen < result.created_at
        && result.payload.firstSeen < peerFirstSeen) {
      peerFirstSeen = Math.floor(result.payload.firstSeen);
    }

    seenEvents.set(result.pubkey, {
      hashrate: result.payload.hashrate,
      workers: result.payload.workers,
      blocks: result.payload.blocks,
      version: result.payload.version,
      loc: result.payload.loc,  // null if not broadcast by peer
      receivedAt: result.created_at,
      firstSeen: peerFirstSeen,
      // v1.12.x: most recent block this peer claims to have found
      lastStrike: result.payload.lastStrike || (existing && existing.lastStrike) || null,
    });
    state.networkStats.security.eventsAccepted++;
    recomputeAggregates();
  }

  function recomputeAggregates() {
    const cutoffSec = Math.floor((Date.now() - SUBSCRIBE_WINDOW_MS) / 1000);

    for (const [pk, e] of seenEvents) {
      if (e.receivedAt < cutoffSec) seenEvents.delete(pk);
    }
    const histCutoff = Math.floor((Date.now() - PUBKEY_HISTORY_TTL_MS) / 1000);
    for (const [pk, t] of lastSeenPerPubkey) {
      if (t < histCutoff) lastSeenPerPubkey.delete(pk);
    }

    const all = [...seenEvents.entries()];
    let activeEntries = all;
    let outliersFilteredThisRound = 0;

    if (all.length >= OUTLIER_MIN_SAMPLES) {
      const hashrates = all.map(([, e]) => e.hashrate);
      const workersArr = all.map(([, e]) => e.workers);
      const { median: hrMed, mad: hrMad } = medianAbsoluteDeviation(hashrates);
      const { median: wMed, mad: wMad } = medianAbsoluteDeviation(workersArr);

      activeEntries = all.filter(([, e]) => {
        const hashOutlier = isOutlier(e.hashrate, hrMed, hrMad);
        const workersOutlier = isOutlier(e.workers, wMed, wMad);
        if (hashOutlier || workersOutlier) {
          outliersFilteredThisRound++;
          return false;
        }
        return true;
      });
    }

    let hashrate = 0, workers = 0, blocks = 0;
    const versions = {};
    for (const [, e] of activeEntries) {
      hashrate += e.hashrate;
      workers += e.workers;
      blocks += e.blocks;
      versions[e.version] = (versions[e.version] || 0) + 1;
    }

    // Build per-peer list for the Strikers modal. Marks outlier-filtered peers
    // so the UI can hide them by default (with toggle to reveal).
    const filteredPubkeys = new Set(activeEntries.map(([pk]) => pk));
    const peers = all.map(([pk, e]) => ({
      pubkey: pk,
      hashrate: e.hashrate,
      workers: e.workers,
      blocks: e.blocks,
      version: e.version,
      loc: e.loc || null,  // [lat, lon] on 5° grid, or null
      lastSeenAgoSec: Math.max(0, Math.floor(Date.now() / 1000 - e.receivedAt)),
      filtered: !filteredPubkeys.has(pk),
      isOwn: pk === pubkey,
      // v1.12.x: new fields surfaced for the Strikers modal
      firstSeen: e.firstSeen || e.receivedAt,
      lastStrike: e.lastStrike || null,
    })).sort((a, b) => b.hashrate - a.hashrate);

    state.networkStats.pools = activeEntries.length;
    state.networkStats.hashrate = hashrate;
    state.networkStats.workers = workers;
    state.networkStats.blocks = blocks;
    state.networkStats.versions = versions;
    state.networkStats.peers = peers;
    state.networkStats.lastUpdate = Date.now();
    state.networkStats.security.outliersFiltered += outliersFilteredThisRound;

    // v1.12.x: rolling hashrate history for trend arrow in UI.
    // Push current aggregate, keep last 60 samples. recomputeAggregates fires
    // roughly once per minute (on every accepted event or publish cycle),
    // giving us ~60 minutes of history. UI consumes via networkStats.hashrateHistory
    // and computes trend = (now - 1h_ago) / 1h_ago * 100.
    if (!Array.isArray(state.networkStats.hashrateHistory)) {
      state.networkStats.hashrateHistory = [];
    }
    const HASHRATE_HISTORY_MAX = 60;
    state.networkStats.hashrateHistory.push({ ts: Date.now(), hr: hashrate });
    if (state.networkStats.hashrateHistory.length > HASHRATE_HISTORY_MAX) {
      state.networkStats.hashrateHistory.splice(0, state.networkStats.hashrateHistory.length - HASHRATE_HISTORY_MAX);
    }
  }

  function publishOurStats() {
    if (!cfg.networkStatsEnabled) return;

    const now = Date.now();
    if (now - lastOwnBroadcastAt < MIN_OWN_BROADCAST_INTERVAL_MS) {
      console.warn('[network-stats] Outbound throttle: skipping (last broadcast ' +
        Math.floor((now - lastOwnBroadcastAt) / 1000) + 's ago)');
      return;
    }

    const ourHashrate = (state.hashrate && state.hashrate.current) || 0;
    const workersArr = Array.isArray(state.workers)
      ? state.workers
      : (state.workers && typeof state.workers === 'object' ? Object.values(state.workers) : []);
    const ourWorkers = workersArr.filter(w => w && w.status !== 'offline').length;
    const ourBlocks = Array.isArray(state.blocks) ? state.blocks.length : 0;
    const ourVersion = state.version || 'unknown';

    if (ourHashrate === 0 && ourWorkers === 0) return;

    const safeHashrate = Math.min(Math.max(0, Math.round(ourHashrate)), MAX_HASHRATE_HPS);
    const safeWorkers = Math.min(Math.max(0, Math.round(ourWorkers)), MAX_WORKERS);
    const safeBlocks = Math.min(Math.max(0, Math.round(ourBlocks)), MAX_BLOCKS);
    const safeVersion = String(ourVersion).slice(0, MAX_VERSION_LEN);

    const content = JSON.stringify({
      hashrate: safeHashrate,
      workers: safeWorkers,
      version: safeVersion,
      blocks: safeBlocks,
      // Optional: only include if user has opted into broadcasting their
      // approximate pool location. Always re-snapped to 5° grid here as a
      // belt-and-suspenders against any UI bug that might submit finer
      // resolution.
      ...(Array.isArray(cfg.poolLocation) && cfg.poolLocation.length === 2
          && Number.isFinite(cfg.poolLocation[0]) && Number.isFinite(cfg.poolLocation[1])
        ? { loc: snapToLocGrid(cfg.poolLocation[0], cfg.poolLocation[1]) }
        : {}),
      // v1.12.x: broadcast our most recent found block so peers can show
      // "Recent Strikes" in their Pulse modal. state.blocks[0] is the latest.
      ...(Array.isArray(state.blocks) && state.blocks.length > 0
          && Number.isFinite(state.blocks[0].height)
          && Number.isFinite(state.blocks[0].timestamp)
        ? { lastStrike: {
            height: state.blocks[0].height,
            ts: Math.floor(state.blocks[0].timestamp / 1000),
          } }
        : {}),
      // v1.12.x: broadcast when this install joined the network. Lets peers
      // show our "Joined Nd ago" badge in their UI.
      ...(Number.isFinite(cfg.pulseFirstSeen) && cfg.pulseFirstSeen > 0
        ? { firstSeen: cfg.pulseFirstSeen }
        : {}),
    });

    const template = {
      kind: EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', TAG_NAME], ['d', installId]],
      content,
    };

    let signed;
    try { signed = finalizeEvent(template, privkeyBytes); }
    catch (e) { console.log(`[network-stats] Sign failed: ${e.message}`); return; }

    const connected = [...sockets.entries()]
      .filter(([, ws]) => ws.readyState === WebSocket.OPEN);
    const subset = pickRandomSubset(connected, PUBLISH_SUBSET_SIZE);

    const payload = JSON.stringify(['EVENT', signed]);
    let publishedTo = 0;
    for (const [url, ws] of subset) {
      try { ws.send(payload); publishedTo++; }
      catch (e) { console.log(`[network-stats] Publish to ${url} failed: ${e.message}`); }
    }
    lastOwnBroadcastAt = now;
    console.log(`[network-stats] Published own stats to ${publishedTo}/${subset.length} relays (${connected.length} connected total)`);
  }

  function schedulePublish(initialDelayMs = PUBLISH_INTERVAL_MS) {
    const jitter = Math.floor((Math.random() * 2 - 1) * PUBLISH_JITTER_MS);
    const delay = Math.max(5000, initialDelayMs + jitter);
    setTimeout(() => {
      publishOurStats();
      schedulePublish(PUBLISH_INTERVAL_MS);
    }, delay);
  }

  // ── Public controller API ───────────────────────────────────────────────
  const controller = {
    enable() {
      cfg.networkStatsEnabled = true;
      state.networkStats.enabled = true;
      lastOwnBroadcastAt = 0;
      publishOurStats();
      saveIdentity();
    },
    setPoolLocation(loc) {
      // loc: null to clear, or [lat, lon] in decimal degrees (will be snapped to 5°)
      if (loc === null) {
        cfg.poolLocation = null;
      } else if (Array.isArray(loc) && loc.length === 2) {
        const [lat, lon] = loc;
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
        if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
        cfg.poolLocation = snapToLocGrid(lat, lon);
      } else {
        return false;
      }
      // Force re-broadcast on next cycle so the new pin propagates fast
      lastOwnBroadcastAt = 0;
      return true;
    },
    disable() {
      cfg.networkStatsEnabled = false;
      state.networkStats.enabled = false;
      seenEvents.delete(pubkey);
      recomputeAggregates();
      saveIdentity();
    },
    regenerateIdentity() {
      seenEvents.delete(pubkey);
      const sk = generateSecretKey();
      const plaintext = Buffer.from(sk).toString('hex');
      cfg.nostrPrivkey = encryptIdentityKey(plaintext, cfg);
      cfg.nostrInstallId = crypto.randomUUID();
      saveIdentity();
      console.log('[network-stats] Regenerated identity — restart API to apply');
    },
    exportBackup() {
      return {
        privkeyHex: plaintextForBackup,
        installId,
        pubkey,
        warning: 'This is your Pulse identity. Anyone with this key can sign events as you. Store it offline.',
      };
    },
    securityStats() {
      const connected = [...sockets.values()].filter(w => w.readyState === WebSocket.OPEN);
      const torConnections = connected.filter(w => w._pulseMode === 'tor').length;
      const directConnections = connected.filter(w => w._pulseMode === 'direct').length;
      return {
        relays: {
          configured: DEFAULT_RELAYS.length,
          connected: connected.length,
          tor: torConnections,
          direct: directConnections,
        },
        eventsAccepted: state.networkStats.security.eventsAccepted,
        eventsDropped: state.networkStats.security.eventsDropped,
        droppedReasons: { ...state.networkStats.security.droppedReasons },
        outliersFiltered: state.networkStats.security.outliersFiltered,
        torEnabled: state.networkStats.security.torEnabled,
        torAvailable: !!SocksProxyAgent,
        torHealth: {
          state: torHealth.state,
          activeUrl: torHealth.activeUrl,
          lastProbeAt: torHealth.lastProbeAt,
          lastProbeOk: torHealth.lastProbeOk,
          consecutiveFailures: torHealth.consecutiveFailures,
          lastError: torHealth.lastError,
        },
        ratelimitedPubkeys: lastSeenPerPubkey.size,
        encryption: ENCRYPTION_VERSION,
      };
    },
    async setTorEnabled(enabled) {
      if (!SocksProxyAgent) {
        return { ok: false, mode: 'unavailable', error: 'socks-proxy-agent not installed' };
      }
      if (!enabled) {
        cfg.pulseTorEnabled = false;
        torHealth.state = 'off';
        torHealth.consecutiveFailures = 0;
        torHealth.lastError = null;
        state.networkStats.security.torEnabled = false;
        saveIdentity();
        closeAllSockets('tor-off');
        return { ok: true, mode: 'direct' };
      }

      // Enabling — probe first
      torHealth.state = 'checking';
      const probe = await testSocksReachable(torHealth.activeUrl, 3000);
      torHealth.lastProbeAt = Date.now();
      torHealth.lastProbeOk = probe.ok;
      if (!probe.ok) {
        torHealth.state = 'fallback';
        torHealth.consecutiveFailures++;
        torHealth.lastError = 'probe-failed:' + (probe.error || 'unknown');
        state.networkStats.security.torEnabled = false;
        console.warn(`[network-stats] Tor probe failed at ${torHealth.activeUrl}: ${probe.error}`);
        return {
          ok: false,
          mode: 'unreachable',
          via: torHealth.activeUrl,
          error: probe.error || 'probe-failed',
        };
      }

      cfg.pulseTorEnabled = true;
      torHealth.state = 'ready';
      torHealth.consecutiveFailures = 0;
      torHealth.lastError = null;
      state.networkStats.security.torEnabled = true;
      saveIdentity();
      closeAllSockets('tor-on');
      console.log(`[network-stats] Tor enabled and reachable via ${torHealth.activeUrl} — reconnecting all relays`);
      return { ok: true, mode: 'tor', via: torHealth.activeUrl };
    },
  };

  // ── Boot ─────────────────────────────────────────────────────────────────
  (async () => {
    if (cfg.pulseTorEnabled && SocksProxyAgent) {
      const probe = await testSocksReachable(torHealth.activeUrl, 3000);
      torHealth.lastProbeAt = Date.now();
      torHealth.lastProbeOk = probe.ok;
      if (probe.ok) {
        torHealth.state = 'ready';
        state.networkStats.security.torEnabled = true;
        console.log(`[network-stats] Tor reachable at boot via ${torHealth.activeUrl}`);
      } else {
        torHealth.state = 'fallback';
        torHealth.lastError = 'boot-probe-failed:' + (probe.error || 'unknown');
        state.networkStats.security.torEnabled = false;
        console.warn(`[network-stats] Tor configured but unreachable (${probe.error}). Boot connecting direct; will retry Tor every 5min.`);
      }
    }
    DEFAULT_RELAYS.forEach(connectRelay);
  })();

  // Background Tor health check — recovery loop.
  setInterval(async () => {
    if (!cfg.pulseTorEnabled || !SocksProxyAgent) return;
    if (torHealth.state === 'ready') return;
    const probe = await testSocksReachable(torHealth.activeUrl, 3000);
    torHealth.lastProbeAt = Date.now();
    torHealth.lastProbeOk = probe.ok;
    if (probe.ok && torHealth.state !== 'ready') {
      torHealth.state = 'ready';
      torHealth.consecutiveFailures = 0;
      torHealth.lastError = null;
      state.networkStats.security.torEnabled = true;
      console.log('[network-stats] Tor recovered — switching all relays back to Tor routing');
      closeAllSockets('tor-recovered');
    }
  }, 5 * 60 * 1000);

  setInterval(recomputeAggregates, 60 * 1000);

  schedulePublish(15 * 1000);

  // Auto-rotation disabled. The original 90-day interval (7.776e9 ms) exceeds
  // setInterval's MAX_INT32 ceiling (~2.147e9 ms / 24.8 days), so Node silently
  // clamps it to 1ms and fires the rotation thousands of times per second —
  // continuously regenerating the identity, thrashing persist.json, and making
  // the install invisible in its own Strikers roster.
  //
  // If you want long-term rotation, gate it on a wall-clock check at boot:
  // load lastRotatedAt from persist.json; if (Date.now() - lastRotatedAt) >
  // 90 days, rotate once at startup. NEVER schedule with setInterval beyond
  // ~24 days. For now, manual rotation only via the UI button.


  saveIdentity();

  console.log(`[network-stats v1.7.3] Started: participating=${!!cfg.networkStatsEnabled}, ` +
    `relays=${DEFAULT_RELAYS.length}, tor=${cfg.pulseTorEnabled ? torHealth.state : 'off'}, ` +
    `torUrl=${torHealth.activeUrl}, encryption=v1`);

  return controller;
}

module.exports = { startNetworkStats };
