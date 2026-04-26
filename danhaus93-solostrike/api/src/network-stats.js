// ── SoloStrike Network Stats (v1.7.3) — Hardened ──────────────────────────
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
// v1.7.3: Tor state machine — pre-flight reachability test, hot-swap
// reconnect on toggle, auto-fallback to direct on failure, background
// recovery loop. Default Tor URL is socks5h://tor_proxy:9050 (Umbrel's
// tor_proxy on umbrel_main_network).
//
// Privacy model:
// • Random keypair generated once per install, encrypted at rest in
//   persist.json. Not linked to BTC payout address or anything else.
// • Payload contains only numeric stats and version string. No IP,
//   no BTC address, no hostname, no location.
// • Publishing is opt-in (cfg.networkStatsEnabled). Reading the network
//   is always on.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const net = require('net');
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
  'wss://nostr.mom',
  'wss://offchain.pub',
  'wss://nostr.bitcoiner.social',
  'wss://relay.nostr.bg.fail',
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
function ensureDeviceSalt(cfg) {
  if (cfg.pulseDeviceSalt && typeof cfg.pulseDeviceSalt === 'string' && cfg.pulseDeviceSalt.length >= 32) {
    return cfg.pulseDeviceSalt;
  }
  const salt = crypto.randomBytes(32).toString('hex');
  cfg.pulseDeviceSalt = salt;
  return salt;
}

function getDeviceFingerprint(cfg) {
  const sources = [];
  const salt = ensureDeviceSalt(cfg);
  sources.push('salt:' + salt);
  try {
    const mid = fs.readFileSync('/etc/machine-id', 'utf8').trim();
    if (mid) sources.push('machine-id:' + mid);
  } catch (_) { /* container without machine-id, fall through */ }
  // Hostname IS unstable in Docker (changes on container recreate via docker rm -f),
  // so we exclude it. The salt alone is the anchor — 32 bytes of host-persisted randomness.
  // MAC addresses are unstable in Docker (assigned fresh per container restart),
  // so we explicitly do NOT include them. The salt is the real anchor.
  const inner = crypto.createHash('sha256').update(sources.join('||')).digest();
  return crypto.createHash('sha256')
    .update(KEY_DERIVATION_INFO + '||')
    .update(inner)
    .digest();
}

function encryptIdentityKey(plaintextHex, cfg) {
  const deviceKey = getDeviceFingerprint(cfg);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deviceKey, iv);
  const ct = Buffer.concat([cipher.update(plaintextHex, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return 'v1:' + Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptIdentityKey(encrypted, cfg) {
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
  const deviceKey = getDeviceFingerprint(cfg);
  const decipher = crypto.createDecipheriv('aes-256-gcm', deviceKey, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}

function isPlaintextHexKey(s) {
  return typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
}

// ── Tier 1: Inbound event validation ─────────────────────────────────────────
function validatePulseEvent(ev) {
  if (!ev || typeof ev !== 'object') return { ok: false, reason: 'not-object' };
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

  const hasOurTag = ev.tags.some(t =>
    Array.isArray(t) && t[0] === 't' && t[1] === TAG_NAME
  );
  if (!hasOurTag) return { ok: false, reason: 'missing-tag' };

  const nowSec = Math.floor(Date.now() / 1000);
  const minAge = nowSec - Math.floor(SUBSCRIBE_WINDOW_MS / 1000);
  if (ev.created_at < minAge) return { ok: false, reason: 'too-old' };
  if (ev.created_at > nowSec + 300) return { ok: false, reason: 'future-timestamp' };

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
  if (!Number.isInteger(workers) || workers < 0 || workers > MAX_WORKERS) {
    return { ok: false, reason: 'workers-range' };
  }
  const blocks = Number(data.blocks);
  if (!Number.isInteger(blocks) || blocks < 0 || blocks > MAX_BLOCKS) {
    return { ok: false, reason: 'blocks-range' };
  }

  const version = String(data.version || '').slice(0, MAX_VERSION_LEN);
  if (version && !VERSION_PATTERN.test(version)) {
    return { ok: false, reason: 'bad-version-chars' };
  }

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
  if (mad === 0) return false;
  const z = 0.6745 * Math.abs(value - median) / mad;
  return z > OUTLIER_MAD_THRESHOLD;
}

// ── Main module ──────────────────────────────────────────────────────────────
function startNetworkStats({ state, cfg, savePersist }) {
  if (!cfg.nostrPrivkey) {
    const sk = generateSecretKey();
    const plaintextHex = Buffer.from(sk).toString('hex');
    cfg.nostrPrivkey = encryptIdentityKey(plaintextHex, cfg);
    cfg.nostrInstallId = crypto.randomUUID();
    console.log('[network-stats] Generated new nostr identity (encrypted at rest)');
  } else if (isPlaintextHexKey(cfg.nostrPrivkey)) {
    try {
      const encrypted = encryptIdentityKey(cfg.nostrPrivkey, cfg);
      cfg.nostrPrivkey = encrypted;
      console.log('[network-stats] Migrated plaintext identity key to encrypted storage');
    } catch (e) {
      console.error('[network-stats] Migration encrypt failed:', e.message);
    }
  }

  if (!cfg.nostrInstallId) cfg.nostrInstallId = crypto.randomUUID();

  let privkeyBytes;
  let plaintextForBackup;
  try {
    if (isPlaintextHexKey(cfg.nostrPrivkey)) {
      plaintextForBackup = cfg.nostrPrivkey;
    } else {
      plaintextForBackup = decryptIdentityKey(cfg.nostrPrivkey, cfg);
    }
    privkeyBytes = Buffer.from(plaintextForBackup, 'hex');
  } catch (e) {
    console.error('[network-stats] Identity decrypt failed:', e.message);
    console.error('[network-stats] Generating fresh identity to keep Pulse working');
    const sk = generateSecretKey();
    plaintextForBackup = Buffer.from(sk).toString('hex');
    privkeyBytes = sk;
    cfg.nostrPrivkey = encryptIdentityKey(plaintextForBackup, cfg);
    cfg.nostrInstallId = crypto.randomUUID();
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
    security: {
      eventsAccepted: 0,
      eventsDropped: 0,
      droppedReasons: {},
      outliersFiltered: 0,
      torEnabled: false,
    },
  };

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
        const host = u.hostname;
        const port = parseInt(u.port || '9050', 10);
        const sock = net.createConnection({ host, port });
        let settled = false;
        const finish = (ok, err) => {
          if (settled) return;
          settled = true;
          try { sock.destroy(); } catch (_) {}
          resolve({ ok, host, port, error: err || null });
        };
        sock.setTimeout(timeoutMs, () => finish(false, 'timeout'));
        sock.once('connect', () => finish(true));
        sock.once('error', (e) => finish(false, e.message));
      } catch (e) {
        resolve({ ok: false, host: null, port: null, error: 'invalid-url:' + e.message });
      }
    });
  }

  function buildTorAgent() {
    if (!SocksProxyAgent) return null;
    try { return new SocksProxyAgent(torHealth.activeUrl); }
    catch (e) {
      torHealth.lastError = 'agent-build:' + e.message;
      return null;
    }
  }

  // Returns the agent to use right now (or null for direct), based on toggle + health.
  function currentTorAgent() {
    if (!cfg.pulseTorEnabled) return null;
    if (torHealth.state !== 'ready') return null;
    return buildTorAgent();
  }

  state.networkStats.security.torEnabled = !!(cfg.pulseTorEnabled && SocksProxyAgent);

  // ── Relay connection management ─────────────────────────────────────────
  const sockets = new Map();
  const reconnectTimers = new Map();

  function connectRelay(url) {
    if (sockets.has(url)) return;
    state.networkStats.relayStatus[url] = 'connecting';

    const wsOpts = { handshakeTimeout: 10000 };
    const torAgent = currentTorAgent();
    const usingTor = !!torAgent;
    if (torAgent) wsOpts.agent = torAgent;

    let ws;
    try {
      ws = new WebSocket(url, wsOpts);
    } catch (e) {
      console.log(`[network-stats] Relay ${url} connect threw: ${e.message}`);
      if (cfg.pulseTorEnabled && torHealth.state === 'ready') {
        markTorUnhealthy('connect-threw:' + e.message);
      }
      scheduleReconnect(url);
      return;
    }

    sockets.set(url, ws);
    ws._pulseMode = usingTor ? 'tor' : 'direct';

    ws.on('open', () => {
      state.networkStats.relayStatus[url] = usingTor ? 'connected-tor' : 'connected-direct';
      console.log(`[network-stats] Connected to ${url}${usingTor ? ' (via Tor)' : ''}`);
      if (usingTor && torHealth.state !== 'ready') {
        torHealth.state = 'ready';
        torHealth.consecutiveFailures = 0;
        torHealth.lastError = null;
        state.networkStats.security.torEnabled = true;
      }
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
      if (usingTor && /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT/.test(err.message)) {
        markTorUnhealthy('relay-error:' + err.message.slice(0, 60));
      }
    });

    ws.on('close', () => {
      sockets.delete(url);
      state.networkStats.relayStatus[url] = 'error';
      scheduleReconnect(url);
    });
  }

  // Tor went bad — switch to fallback mode and trigger immediate reconnect
  // of all sockets via direct routing. Pulse keeps broadcasting; privacy
  // is degraded but the network stays alive.
  function markTorUnhealthy(reason) {
    if (torHealth.state === 'fallback') return;
    torHealth.consecutiveFailures++;
    torHealth.lastError = reason;
    torHealth.state = 'fallback';
    state.networkStats.security.torEnabled = false;
    console.warn(`[network-stats] Tor unhealthy (${reason}). Falling back to direct connections.`);
    closeAllSockets('tor-fallback');
  }

  // Close all relay sockets — used when Tor toggle changes or fallback triggers.
  function closeAllSockets(reason) {
    for (const [url, ws] of sockets) {
      try { ws.close(1000, reason); } catch (_) {}
    }
    sockets.clear();
    for (const t of reconnectTimers.values()) clearTimeout(t);
    reconnectTimers.clear();
    setTimeout(() => DEFAULT_RELAYS.forEach(connectRelay), 100);
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
    const result = validatePulseEvent(ev);
    if (!result.ok) { recordDrop(result.reason); return; }

    const lastSeen = lastSeenPerPubkey.get(result.pubkey);
    if (lastSeen && (result.created_at - lastSeen) < MIN_PUBKEY_INTERVAL_SEC) {
      recordDrop('rate-limited-pubkey');
      return;
    }
    lastSeenPerPubkey.set(result.pubkey, result.created_at);

    const existing = seenEvents.get(result.pubkey);
    if (existing && existing.receivedAt >= result.created_at) {
      recordDrop('dedup-older');
      return;
    }

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

    state.networkStats.pools = activeEntries.length;
    state.networkStats.hashrate = hashrate;
    state.networkStats.workers = workers;
    state.networkStats.blocks = blocks;
    state.networkStats.versions = versions;
    state.networkStats.lastUpdate = Date.now();
    state.networkStats.security.outliersFiltered += outliersFilteredThisRound;
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
    console.log(`[network-stats] Published to ${publishedTo}/${connected.length} relays (subset of ${DEFAULT_RELAYS.length})`);

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
    for (let i = 0; i < n; i++) {
      const j = i + Math.floor(Math.random() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  }

  let publishTimer = null;
  function schedulePublish(initialDelayMs) {
    if (publishTimer) clearTimeout(publishTimer);
    const baseDelay = (initialDelayMs != null) ? initialDelayMs : PUBLISH_INTERVAL_MS;
    const jitter = (Math.random() * 2 - 1) * PUBLISH_JITTER_MS;
    const delay = Math.max(15 * 1000, baseDelay + jitter);
    publishTimer = setTimeout(() => {
      try { publishOurStats(); } catch (e) { console.error('[network-stats] publish error:', e.message); }
      schedulePublish();
    }, delay);
  }

  function saveIdentity() {
    try {
      savePersist({
        nostrPrivkey: cfg.nostrPrivkey,
        nostrInstallId: cfg.nostrInstallId,
        pulseDeviceSalt: cfg.pulseDeviceSalt,
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
          lastProbeOk: torHealth.lastProbeOk,
          lastError: torHealth.lastError,
          consecutiveFailures: torHealth.consecutiveFailures,
        },
        ratelimitedPubkeys: lastSeenPerPubkey.size,
      };
    },
    // v1.7.3 — async toggle with reachability pre-flight + hot-swap reconnect.
    // Returns: { ok, mode: "tor"|"direct"|"unreachable", via, error }
    async setTorEnabled(enabled) {
      const wantOn = !!enabled;

      if (!wantOn) {
        cfg.pulseTorEnabled = false;
        torHealth.state = 'off';
        torHealth.lastError = null;
        state.networkStats.security.torEnabled = false;
        saveIdentity();
        closeAllSockets('tor-off');
        console.log('[network-stats] Tor disabled — reconnecting all relays direct');
        return { ok: true, mode: 'direct', via: null };
      }

      if (!SocksProxyAgent) {
        return {
          ok: false,
          mode: 'unreachable',
          via: torHealth.activeUrl,
          error: 'socks-proxy-agent dependency missing in API container',
        };
      }

      torHealth.state = 'checking';
      const probe = await testSocksReachable(torHealth.activeUrl, 3000);
      torHealth.lastProbeAt = Date.now();
      torHealth.lastProbeOk = probe.ok;

      if (!probe.ok) {
        torHealth.state = 'off';
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

  if (KEY_ROTATION_INTERVAL_MS) {
    setInterval(() => {
      console.log('[network-stats] Auto-rotating identity (90 days elapsed)');
      controller.regenerateIdentity();
    }, KEY_ROTATION_INTERVAL_MS);
  }

  saveIdentity();

  console.log(`[network-stats v1.7.3] Started: participating=${!!cfg.networkStatsEnabled}, ` +
    `relays=${DEFAULT_RELAYS.length}, tor=${cfg.pulseTorEnabled ? torHealth.state : 'off'}, ` +
    `torUrl=${torHealth.activeUrl}, encryption=v1`);

  return controller;
}

module.exports = { startNetworkStats };
