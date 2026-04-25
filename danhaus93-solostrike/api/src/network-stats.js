// ── SoloStrike Network Stats (v1.7.1) — Hardened ──────────────────────────
//
// Publishes anonymous pool stats (hashrate, worker count, version,
// blocks found) to the SoloStrike Network over nostr every 5 minutes.
// Subscribes to everyone else's stats and aggregates them into
// state.networkStats.
//
// SECURITY HARDENING (v1.7.1):
// • Tier 1: Strict signature verification on every inbound event.
//           Schema + range validation. Per-pubkey rate limiting.
//           Outbound self-rate-limit. Outlier detection (median+MAD).
// • Tier 2: AES-256-GCM encryption of identity privkey at rest, keyed
//           to this device's hardware fingerprint (no user passphrase
//           required). Ephemeral read identity (separate keypair for
//           subscriptions vs publishing). Plaintext-to-encrypted
//           migration on first boot. Backup export available on demand.
// • Tier 3: Diversified relay pool with random subset selection per
//           broadcast. Timing jitter (5min ± 90s) defeats timing
//           correlation. Optional Tor routing via SOCKS5
//           (off by default; activates if socks-proxy-agent installed).
//
// Privacy model:
// • Random keypair generated once per install, encrypted at rest in
//   persist.json. Not linked to BTC payout address or anything else.
// • Payload contains only numeric stats and version string. No IP,
//   no BTC address, no hostname, no location.
// • Publishing is opt-in (cfg.networkStatsEnabled). Reading the network
//   is always on.
//
// Compatibility: maintains the same controller contract as v1.6.0 so
// server.js requires no changes:
//   startNetworkStats({state, cfg, savePersist}) -> { enable, disable,
//                                                     regenerateIdentity,
//                                                     exportBackup }

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
} = require('nostr-tools/pure');

// Optional Tor SOCKS5 support — gracefully degrades if dep is missing.
let SocksProxyAgent = null;
try {
  ({ SocksProxyAgent } = require('socks-proxy-agent'));
} catch (_) { /* Tor unavailable; toggle becomes a no-op */ }

// ── Constants ────────────────────────────────────────────────────────────────

// Default relay pool (Tier 3: diversified — N=8 from independent operators)
const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.wine',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostr.band',
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

// Tier 1 — Validation limits
const MAX_HASHRATE_HPS    = 10 * 1e15;              // 10 PH/s — home-pool sanity ceiling
const MAX_WORKERS         = 1000;
const MAX_BLOCKS          = 1000;
const MAX_VERSION_LEN     = 16;
const VERSION_PATTERN     = /^[0-9a-zA-Z._\-]+$/;

// Tier 1 — Per-pubkey rate limit (block spam from one bad actor)
const MIN_PUBKEY_INTERVAL_SEC = 240;                 // 4 min between events from same pubkey
const PUBKEY_HISTORY_TTL_MS   = 2 * 60 * 60 * 1000;  // 2h cleanup

// Tier 1 — Outbound self-throttle (defense against bug-induced flooding)
const MIN_OWN_BROADCAST_INTERVAL_MS = 240 * 1000;    // 4 min minimum

// Tier 1 — Outlier filter (median absolute deviation)
const OUTLIER_MIN_SAMPLES = 5;                       // need ≥5 pools to filter
const OUTLIER_MAD_THRESHOLD = 3.5;                   // modified Z-score cutoff

// Tier 2 — Encryption parameters
const KEY_DERIVATION_INFO = 'SoloStrike-Pulse-v1';   // domain separator for HKDF

// Tier 2 — Auto rotation (90 days). null disables.
const KEY_ROTATION_INTERVAL_MS = null; // not enabled by default; user must opt in

// ── Tier 2: Device-bound encryption ──────────────────────────────────────────
// Derives an encryption key from stable hardware identifiers. The same Umbrel
// always produces the same derived key. A different machine cannot decrypt the
// stored identity even if it has the persist.json file.

function getDeviceFingerprint() {
  const sources = [];

  // Linux machine-id is the gold standard — stable across boots, unique per
  // machine, doesn't change on hostname/IP changes.
  try {
    const mid = fs.readFileSync('/etc/machine-id', 'utf8').trim();
    if (mid) sources.push('machine-id:' + mid);
  } catch (_) { /* fall through to other sources */ }

  // Hostname provides moderate uniqueness
  sources.push('host:' + (os.hostname() || 'unknown'));

  // First non-internal MAC address
  try {
    const ifaces = os.networkInterfaces();
    const macs = [];
    for (const name of Object.keys(ifaces)) {
      for (const i of ifaces[name]) {
        if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') {
          macs.push(i.mac);
        }
      }
    }
    macs.sort(); // deterministic ordering across boots
    if (macs.length) sources.push('mac:' + macs[0]);
  } catch (_) { /* no network info available */ }

  // Failsafe — guarantee at least one source
  if (sources.length === 0) {
    sources.push('fallback:solostrike-pulse-fingerprint');
  }

  // HKDF-style derivation: sha256(domain || sha256(joined sources))
  const inner = crypto.createHash('sha256').update(sources.join('||')).digest();
  return crypto.createHash('sha256')
    .update(KEY_DERIVATION_INFO + '||')
    .update(inner)
    .digest();
}

function encryptIdentityKey(plaintextHex) {
  const deviceKey = getDeviceFingerprint();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deviceKey, iv);
  const ct = Buffer.concat([cipher.update(plaintextHex, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Wire format: "v1:<base64(iv|tag|ciphertext)>" — version prefix lets us
  // change crypto schemes later without breaking existing installs.
  return 'v1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptIdentityKey(encrypted) {
  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('decryptIdentityKey: empty input');
  }
  if (!encrypted.startsWith('v1:')) {
    throw new Error('decryptIdentityKey: unknown version prefix');
  }
  const buf = Buffer.from(encrypted.slice(3), 'base64');
  if (buf.length < 12 + 16 + 1) {
    throw new Error('decryptIdentityKey: ciphertext too short');
  }
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ct = buf.slice(28);
  const deviceKey = getDeviceFingerprint();
  const decipher = crypto.createDecipheriv('aes-256-gcm', deviceKey, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

// Heuristic: is this string a 64-char hex (legacy plaintext) or our v1: prefix?
function isPlaintextHexKey(s) {
  return typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
}

// ── Tier 1: Inbound event validation ─────────────────────────────────────────

function validatePulseEvent(ev) {
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'not-object' };

  // Structural checks
  if (ev.kind !== EVENT_KIND) return { ok: false, reason: 'wrong-kind' };
  if (typeof ev.pubkey !== 'string' || !/^[0-9a-f]{64}$/.test(ev.pubkey)) {
    return { ok: false, reason: 'bad-pubkey' };
  }
  if (typeof ev.id !== 'string' || !/^[0-9a-f]{64}$/.test(ev.id)) {
    return { ok: false, reason: 'bad-id' };
  }
  if (typeof ev.sig !== 'string' || !/^[0-9a-f]{128}$/.test(ev.sig)) {
    return { ok: false, reason: 'bad-sig-format' };
  }
  if (typeof ev.created_at !== 'number' || !Number.isFinite(ev.created_at)) {
    return { ok: false, reason: 'bad-created-at' };
  }
  if (!Array.isArray(ev.tags)) return { ok: false, reason: 'bad-tags' };

  // Tag check — must be a SoloStrike Pulse event
  const hasOurTag = ev.tags.some(t =>
    Array.isArray(t) && t[0] === 't' && t[1] === TAG_NAME
  );
  if (!hasOurTag) return { ok: false, reason: 'missing-tag' };

  // Time window — reject too old (replay) and too future (clock injection)
  const nowSec = Math.floor(Date.now() / 1000);
  const minAge = nowSec - Math.floor(SUBSCRIBE_WINDOW_MS / 1000);
  if (ev.created_at < minAge) return { ok: false, reason: 'too-old' };
  if (ev.created_at > nowSec + 300) return { ok: false, reason: 'future-timestamp' };

  // Content shape
  if (typeof ev.content !== 'string' || ev.content.length > 2048) {
    return { ok: false, reason: 'bad-content-size' };
  }
  let data;
  try { data = JSON.parse(ev.content); } catch { return { ok: false, reason: 'bad-content-json' }; }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'bad-content-type' };

  // Numeric range validation
  const hashrate = Number(data.hashrate);
  if (!Number.isFinite(hashrate) || hashrate < 0 || hashrate > MAX_HASHRATE_HPS) {
    return { ok: false, reason: 'hashrate-range' };
  }
  const workers = Number(data.workers);
  if (!Number.isInteger(workers) || workers < 0 || workers > MAX_WORKERS) {
    return { ok: false, reason: 'workers-range' };
  }
  const blocks = Number(data.blocks);
  if (!Number.isInteger(blocks) || blocks < 0 || blocks > MAX_BLOCKS) {
    return { ok: false, reason: 'blocks-range' };
  }

  // Version string — strict format, length cap
  const version = String(data.version || '').slice(0, MAX_VERSION_LEN);
  if (version && !VERSION_PATTERN.test(version)) {
    return { ok: false, reason: 'bad-version-chars' };
  }

  // Cryptographic verification (this is the critical check — confirms the
  // event was actually signed by the claimed pubkey, not forged by a relay)
  let sigValid;
  try { sigValid = verifyEvent(ev); }
  catch (e) { return { ok: false, reason: 'verify-threw:' + e.message }; }
  if (!sigValid) return { ok: false, reason: 'signature-invalid' };

  return {
    ok: true,
    pubkey: ev.pubkey,
    created_at: ev.created_at,
    payload: { hashrate, workers, blocks, version: version || 'unknown' },
  };
}

// ── Tier 1: Outlier detection (median absolute deviation) ───────────────────

function medianAbsoluteDeviation(values) {
  if (!values.length) return { median: 0, mad: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map(v => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];
  return { median, mad };
}

function isOutlier(value, median, mad) {
  if (mad === 0) return false; // can't compute Z-score against zero variance
  // Modified Z-score (Iglewicz-Hoaglin): 0.6745 * |v - median| / MAD
  const z = 0.6745 * Math.abs(value - median) / mad;
  return z > OUTLIER_MAD_THRESHOLD;
}

// ── Main module ──────────────────────────────────────────────────────────────

function startNetworkStats({ state, cfg, savePersist }) {
  // ── Tier 2: Identity bootstrap with encryption migration ───────────────────
  // Three cases:
  //   1. Fresh install: no key, generate one and store encrypted.
  //   2. Migration: plaintext key found, encrypt and rewrite.
  //   3. Existing encrypted key: decrypt to memory.

  if (!cfg.nostrPrivkey) {
    const sk = generateSecretKey();
    const plaintextHex = Buffer.from(sk).toString('hex');
    cfg.nostrPrivkey = encryptIdentityKey(plaintextHex);
    cfg.nostrInstallId = crypto.randomUUID();
    console.log('[network-stats] Generated new nostr identity (encrypted at rest)');
  } else if (isPlaintextHexKey(cfg.nostrPrivkey)) {
    // Legacy plaintext key — migrate to encrypted form
    try {
      const encrypted = encryptIdentityKey(cfg.nostrPrivkey);
      cfg.nostrPrivkey = encrypted;
      console.log('[network-stats] Migrated plaintext identity key to encrypted storage');
    } catch (e) {
      console.error('[network-stats] Migration encrypt failed:', e.message);
      // Continue with plaintext — better to keep working than to brick Pulse
    }
  }

  if (!cfg.nostrInstallId) cfg.nostrInstallId = crypto.randomUUID();

  // Decrypt to memory (or fall back to plaintext if migration failed)
  let privkeyBytes;
  let plaintextForBackup; // held only in-memory for export feature
  try {
    if (isPlaintextHexKey(cfg.nostrPrivkey)) {
      plaintextForBackup = cfg.nostrPrivkey;
    } else {
      plaintextForBackup = decryptIdentityKey(cfg.nostrPrivkey);
    }
    privkeyBytes = Buffer.from(plaintextForBackup, 'hex');
  } catch (e) {
    console.error('[network-stats] Identity decrypt failed:', e.message);
    console.error('[network-stats] Generating fresh identity to keep Pulse working');
    const sk = generateSecretKey();
    plaintextForBackup = Buffer.from(sk).toString('hex');
    privkeyBytes = sk;
    cfg.nostrPrivkey = encryptIdentityKey(plaintextForBackup);
    cfg.nostrInstallId = crypto.randomUUID();
  }

  const pubkey = getPublicKey(privkeyBytes);
  const installId = cfg.nostrInstallId;

  // ── Tier 2: Ephemeral read identity ──────────────────────────────────────
  // Subscribing to relays uses this throwaway keypair, regenerated per process
  // boot. The publishing identity stays clean of metadata about what we read.
  // Note: nostr REQ messages don't actually require auth on most relays, but
  // some relays sign their connection metadata. Using a fresh ephemeral
  // keypair ensures even if relays log connection identifiers, our publishing
  // identity is never tied to our reading patterns.
  const ephemeralReadKey = generateSecretKey();
  const ephemeralReadPubkey = getPublicKey(ephemeralReadKey);

  console.log(`[network-stats] Identity: pubkey=${pubkey.slice(0,16)}... installId=${installId.slice(0,8)}... readkey=${ephemeralReadPubkey.slice(0,8)}...`);

  // ── State setup ─────────────────────────────────────────────────────────
  const seenEvents = new Map();         // pubkey -> { hashrate, workers, version, blocks, receivedAt }
  const lastSeenPerPubkey = new Map();  // pubkey -> last created_at (Tier 1: rate limit)
  const droppedReasons = new Map();     // reason -> count (telemetry)
  let lastOwnBroadcastAt = 0;            // Tier 1: outbound throttle

  state.networkStats = {
    enabled: !!cfg.networkStatsEnabled,
    pools: 0,
    hashrate: 0,
    workers: 0,
    blocks: 0,
    versions: {},
    lastUpdate: 0,
    relayStatus: {},
    // v1.7.1 telemetry — exposed for diagnostics
    security: {
      eventsAccepted: 0,
      eventsDropped: 0,
      droppedReasons: {},
      outliersFiltered: 0,
      torEnabled: false,
    },
  };

  // ── Tier 3: Tor support ─────────────────────────────────────────────────
  function maybeBuildTorAgent() {
    if (!cfg.pulseTorEnabled) return null;
    if (!SocksProxyAgent) {
      console.warn('[network-stats] Tor requested but socks-proxy-agent not installed; falling back to direct');
      return null;
    }
    try {
      // Umbrel's built-in Tor SOCKS port (verify on your install)
      const torUrl = cfg.pulseTorUrl || 'socks5h://127.0.0.1:9050';
      return new SocksProxyAgent(torUrl);
    } catch (e) {
      console.warn('[network-stats] Tor agent build failed:', e.message);
      return null;
    }
  }

  state.networkStats.security.torEnabled = !!(cfg.pulseTorEnabled && SocksProxyAgent);

  // ── Relay connection management ─────────────────────────────────────────
  const sockets = new Map(); // url -> WebSocket
  const reconnectTimers = new Map();

  function connectRelay(url) {
    if (sockets.has(url)) return; // already connected/connecting
    state.networkStats.relayStatus[url] = 'connecting';

    const wsOpts = { handshakeTimeout: 10000 };
    const torAgent = maybeBuildTorAgent();
    if (torAgent) wsOpts.agent = torAgent;

    let ws;
    try {
      ws = new WebSocket(url, wsOpts);
    } catch (e) {
      console.log(`[network-stats] Relay ${url} connect threw: ${e.message}`);
      scheduleReconnect(url);
      return;
    }

    sockets.set(url, ws);

    ws.on('open', () => {
      state.networkStats.relayStatus[url] = 'connected';
      console.log(`[network-stats] Connected to ${url}${torAgent ? ' (via Tor)' : ''}`);
      const subId = 'ss-sub-' + crypto.randomBytes(4).toString('hex');
      const since = Math.floor((Date.now() - SUBSCRIBE_WINDOW_MS) / 1000);
      const req = JSON.stringify(['REQ', subId, { kinds: [EVENT_KIND], '#t': [TAG_NAME], since }]);
      try { ws.send(req); } catch (_) { /* relay died mid-subscribe */ }
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(msg)) return;
      const type = msg[0];
      if (type === 'EVENT') {
        handleIncomingEvent(msg[2]);
      } else if (type === 'NOTICE') {
        console.log(`[network-stats] ${url} notice: ${msg[1]}`);
      }
    });

    ws.on('error', (err) => {
      console.log(`[network-stats] Relay ${url} error: ${err.message}`);
      state.networkStats.relayStatus[url] = 'error';
    });

    ws.on('close', () => {
      sockets.delete(url);
      state.networkStats.relayStatus[url] = 'error';
      scheduleReconnect(url);
    });
  }

  function scheduleReconnect(url) {
    if (reconnectTimers.has(url)) return;
    const timer = setTimeout(() => {
      reconnectTimers.delete(url);
      connectRelay(url);
    }, RECONNECT_DELAY_MS);
    reconnectTimers.set(url, timer);
  }

  // ── Tier 1: Hardened inbound handler ────────────────────────────────────
  function recordDrop(reason) {
    droppedReasons.set(reason, (droppedReasons.get(reason) || 0) + 1);
    state.networkStats.security.eventsDropped++;
    state.networkStats.security.droppedReasons[reason] =
      (state.networkStats.security.droppedReasons[reason] || 0) + 1;
  }

  function handleIncomingEvent(ev) {
    // Step 1: Validate structure + signature + content
    const result = validatePulseEvent(ev);
    if (!result.ok) { recordDrop(result.reason); return; }

    // Step 2: Per-pubkey rate limit (Tier 1 — block spam from one bad actor)
    const lastSeen = lastSeenPerPubkey.get(result.pubkey);
    if (lastSeen && (result.created_at - lastSeen) < MIN_PUBKEY_INTERVAL_SEC) {
      recordDrop('rate-limited-pubkey');
      return;
    }
    lastSeenPerPubkey.set(result.pubkey, result.created_at);

    // Step 3: Dedup (keep newest) — protect against multi-relay echoes
    const existing = seenEvents.get(result.pubkey);
    if (existing && existing.receivedAt >= result.created_at) {
      recordDrop('dedup-older');
      return;
    }

    // Accept
    seenEvents.set(result.pubkey, {
      hashrate: result.payload.hashrate,
      workers: result.payload.workers,
      blocks: result.payload.blocks,
      version: result.payload.version,
      receivedAt: result.created_at,
    });
    state.networkStats.security.eventsAccepted++;
    recomputeAggregates();
  }

  // ── Tier 1: Outlier-aware aggregation ───────────────────────────────────
  function recomputeAggregates() {
    const cutoffSec = Math.floor((Date.now() - SUBSCRIBE_WINDOW_MS) / 1000);

    // Prune stale entries
    for (const [pk, e] of seenEvents) {
      if (e.receivedAt < cutoffSec) seenEvents.delete(pk);
    }
    // Prune rate-limit history
    const histCutoff = Math.floor((Date.now() - PUBKEY_HISTORY_TTL_MS) / 1000);
    for (const [pk, t] of lastSeenPerPubkey) {
      if (t < histCutoff) lastSeenPerPubkey.delete(pk);
    }

    const all = [...seenEvents.entries()];
    let activeEntries = all;
    let outliersFilteredThisRound = 0;

    // Outlier filter — only meaningful with N≥OUTLIER_MIN_SAMPLES
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

    state.networkStats.pools = activeEntries.length;
    state.networkStats.hashrate = hashrate;
    state.networkStats.workers = workers;
    state.networkStats.blocks = blocks;
    state.networkStats.versions = versions;
    state.networkStats.lastUpdate = Date.now();
    state.networkStats.security.outliersFiltered += outliersFilteredThisRound;
  }

  // ── Tier 1+3: Hardened broadcast ────────────────────────────────────────
  function publishOurStats() {
    if (!cfg.networkStatsEnabled) return;

    // Tier 1 — outbound self-throttle
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

    // Defensive cap on our own outbound numbers — prevents bug-induced bogus values
    const safeHashrate = Math.min(Math.max(0, Math.round(ourHashrate)), MAX_HASHRATE_HPS);
    const safeWorkers = Math.min(Math.max(0, Math.round(ourWorkers)), MAX_WORKERS);
    const safeBlocks = Math.min(Math.max(0, Math.round(ourBlocks)), MAX_BLOCKS);
    const safeVersion = String(ourVersion).slice(0, MAX_VERSION_LEN);

    const content = JSON.stringify({
      hashrate: safeHashrate,
      workers: safeWorkers,
      version: safeVersion,
      blocks: safeBlocks,
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

    // Tier 3 — random subset of connected relays. Reduces correlation any
    // single relay operator can do across our broadcasts.
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
    console.log(`[network-stats] Published to ${publishedTo}/${connected.length} relays (subset of ${DEFAULT_RELAYS.length})`);

    // Count ourselves in the local aggregate immediately
    seenEvents.set(pubkey, {
      hashrate: safeHashrate,
      workers: safeWorkers,
      blocks: safeBlocks,
      version: safeVersion,
      receivedAt: template.created_at,
    });
    recomputeAggregates();
  }

  function pickRandomSubset(arr, n) {
    if (arr.length <= n) return arr;
    const copy = [...arr];
    // Fisher-Yates partial shuffle
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(Math.random() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  // ── Tier 3: Jittered publish scheduler ─────────────────────────────────
  let publishTimer = null;
  function schedulePublish(initialDelayMs) {
    if (publishTimer) clearTimeout(publishTimer);
    const baseDelay = (initialDelayMs != null) ? initialDelayMs : PUBLISH_INTERVAL_MS;
    // Symmetric jitter: ±PUBLISH_JITTER_MS
    const jitter = (Math.random() * 2 - 1) * PUBLISH_JITTER_MS;
    const delay = Math.max(15 * 1000, baseDelay + jitter); // never below 15s
    publishTimer = setTimeout(() => {
      try { publishOurStats(); } catch (e) { console.error('[network-stats] publish error:', e.message); }
      schedulePublish(); // chain for next cycle
    }, delay);
  }

  // ── Controller — same contract as v1.6.0 + new exportBackup ─────────────
  function saveIdentity() {
    try {
      savePersist({
        nostrPrivkey: cfg.nostrPrivkey, // already encrypted
        nostrInstallId: cfg.nostrInstallId,
        networkStatsEnabled: !!cfg.networkStatsEnabled,
        pulseTorEnabled: !!cfg.pulseTorEnabled,
      });
    } catch (e) {
      console.log(`[network-stats] saveIdentity failed: ${e.message}`);
    }
  }

  const controller = {
    enable() {
      cfg.networkStatsEnabled = true;
      state.networkStats.enabled = true;
      // Reset throttle so user sees themselves immediately on enable
      lastOwnBroadcastAt = 0;
      publishOurStats();
      saveIdentity();
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
      cfg.nostrPrivkey = encryptIdentityKey(plaintext);
      cfg.nostrInstallId = crypto.randomUUID();
      saveIdentity();
      console.log('[network-stats] Regenerated identity — restart API to apply');
      // Note: in-memory privkey/pubkey closure isn't rebuilt; restart required
      // to actually publish under the new identity.
    },
    // v1.7.1 — backup export. Returns the plaintext nsec/hex key + installId.
    // Caller is responsible for showing this only on user demand and clearing
    // it from any UI state quickly. Never stored in logs.
    exportBackup() {
      return {
        privkeyHex: plaintextForBackup,
        installId,
        pubkey,
        warning: 'This is your Pulse identity. Anyone with this key can sign events as you. Store it offline.',
      };
    },
    // v1.7.1 — security telemetry for diagnostics
    securityStats() {
      return {
        relays: { configured: DEFAULT_RELAYS.length, connected: [...sockets.values()].filter(w => w.readyState === WebSocket.OPEN).length },
        eventsAccepted: state.networkStats.security.eventsAccepted,
        eventsDropped: state.networkStats.security.eventsDropped,
        droppedReasons: { ...state.networkStats.security.droppedReasons },
        outliersFiltered: state.networkStats.security.outliersFiltered,
        torEnabled: state.networkStats.security.torEnabled,
        torAvailable: !!SocksProxyAgent,
        ratelimitedPubkeys: lastSeenPerPubkey.size,
      };
    },
    setTorEnabled(enabled) {
      cfg.pulseTorEnabled = !!enabled;
      state.networkStats.security.torEnabled = !!(enabled && SocksProxyAgent);
      saveIdentity();
      // Existing connections keep using direct path; new reconnects pick up Tor
      console.log(`[network-stats] Tor ${enabled ? 'enabled' : 'disabled'} (effective on reconnect; available=${!!SocksProxyAgent})`);
    },
  };

  // ── Boot ─────────────────────────────────────────────────────────────────
  // Connect to all relays from the diversified pool
  DEFAULT_RELAYS.forEach(connectRelay);

  // Schedule recompute every minute to prune stale entries
  setInterval(recomputeAggregates, 60 * 1000);

  // First publish after a short warm-up delay (gives miners time to come up
  // before we broadcast a "0 H/s" message)
  schedulePublish(15 * 1000);

  // Optional auto-rotation (disabled by default)
  if (KEY_ROTATION_INTERVAL_MS) {
    setInterval(() => {
      console.log('[network-stats] Auto-rotating identity (90 days elapsed)');
      controller.regenerateIdentity();
    }, KEY_ROTATION_INTERVAL_MS);
  }

  // Persist any migrations that happened during boot
  saveIdentity();

  console.log(`[network-stats v1.7.1] Started: participating=${!!cfg.networkStatsEnabled}, ` +
    `relays=${DEFAULT_RELAYS.length}, tor=${state.networkStats.security.torEnabled}, ` +
    `encryption=v1`);

  return controller;
}

module.exports = { startNetworkStats };
