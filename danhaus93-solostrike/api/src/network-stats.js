// network-stats.js — SoloStrike Pulse (v1.6.0+)
//
// Anonymous, opt-in census of solo mining pools running SoloStrike.
// Uses nostr (Notes and Other Stuff Transmitted by Relays) as the transport.
//
// HOW IT WORKS:
//   • Each pool generates a fresh keypair on first opt-in (nostrPrivkey in cfg)
//   • Every 5 min: signs an event with { hashrate, workers, version, blocks }
//     and publishes to 3 public relays (damus.io, nos.lol, primal.net)
//   • Subscribes to all SoloStrike events from the last 15 min
//   • Aggregates results into the network-stats response that the UI polls
//
// PRIVACY:
//   • Payload contains NO BTC address, NO IP, NO hostname, NO location
//   • Pool identity is a fresh keypair (not tied to BTC address)
//   • User can opt out anytime; user can regenerate identity anytime
//
// SPAM DEFENSE:
//   • MAX_HASHRATE_HPS = 10 PH/s per pool (10,000 TH/s — generous)
//   • MAX_WORKERS = 1000 per pool
//   • MAX_BLOCKS = 1000 per pool
//   • Replay protection: only the most recent event per pubkey within window
//
// EVENT FORMAT (kind 30078, parameterized replaceable per NIP-78):
//   • d-tag: "solostrike-pool-stats"
//   • content: JSON.stringify({ hashrate, workers, version, blocks })
//   • created_at: now
//   • signed with the pool's nostr privkey

const WebSocket = require('ws');
const { schnorr } = require('@noble/curves/secp256k1');
const { sha256 } = require('@noble/hashes/sha2');
const { bytesToHex, hexToBytes, randomBytes } = require('@noble/hashes/utils');

// Make WebSocket available to nostr-tools (needs global in Node)
global.WebSocket = WebSocket;

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const D_TAG = 'solostrike-pool-stats';
const EVENT_KIND = 30078;
const PUBLISH_INTERVAL_MS = 5 * 60 * 1000;       // every 5 min
const SUBSCRIBE_WINDOW_S = 15 * 60;              // last 15 min of events count
const MAX_HASHRATE_HPS = 10 * 1e15;              // 10 PH/s — fleet-level cap
const MAX_WORKERS = 1000;
const MAX_BLOCKS = 1000;

let publishTimer = null;
let aggregateTimer = null;
const relayConnections = new Map(); // url -> { ws, status, reconnectTimer }

// ─── KEY UTILS ──────────────────────────────────────────────────────────────

function generatePrivkey() {
  return bytesToHex(randomBytes(32));
}

function getPubkey(privkey) {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(privkey)));
}

function generateInstallId() {
  return bytesToHex(randomBytes(16));
}

// Compute event id (sha256 of canonical JSON serialization per NIP-01)
function getEventHash(event) {
  const serialized = JSON.stringify([
    0,
    event.pubkey,
    event.created_at,
    event.kind,
    event.tags,
    event.content,
  ]);
  return bytesToHex(sha256(new TextEncoder().encode(serialized)));
}

function signEvent(event, privkey) {
  const id = getEventHash(event);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(privkey)));
  return { ...event, id, sig };
}

function verifyEvent(event) {
  if (!event || !event.id || !event.sig || !event.pubkey) return false;
  try {
    const expectedId = getEventHash(event);
    if (expectedId !== event.id) return false;
    return schnorr.verify(hexToBytes(event.sig), hexToBytes(event.id), hexToBytes(event.pubkey));
  } catch {
    return false;
  }
}

// ─── PUBLIC API ─────────────────────────────────────────────────────────────

/**
 * Initialize state.networkStats and ensure cfg has a keypair if missing.
 * Returns { cfg, state } unchanged-but-augmented for the caller to merge.
 */
function ensureIdentity(cfg) {
  if (!cfg.nostrPrivkey) {
    cfg.nostrPrivkey = generatePrivkey();
  }
  if (!cfg.nostrInstallId) {
    cfg.nostrInstallId = generateInstallId();
  }
  return cfg;
}

function regenerateIdentity(cfg) {
  cfg.nostrPrivkey = generatePrivkey();
  cfg.nostrInstallId = generateInstallId();
  return cfg;
}

/**
 * Connect to all relays. Reconnects automatically.
 * Stores subscriptions to receive other pools' events.
 */
function startNetworkStats({ cfg, state, savePersist, log }) {
  if (!state.networkStats) {
    state.networkStats = {
      enabled: !!cfg.networkStatsEnabled,
      pools: 0,
      hashrate: 0,
      workers: 0,
      blocks: 0,
      versions: {},
      relayStatus: {},
      lastUpdate: 0,
    };
  } else {
    state.networkStats.enabled = !!cfg.networkStatsEnabled;
  }

  // Always populate pubkey for UI, even if not enabled
  if (cfg.nostrPrivkey) {
    try { state.networkStats.pubkey = getPubkey(cfg.nostrPrivkey); } catch {}
  }

  // Always observe the network even when not publishing —
  // gives the user a glimpse of the count before they opt in.
  ensureIdentity(cfg);
  // Persist any keypair we just generated
  if (typeof savePersist === 'function') {
    try { savePersist({ nostrPrivkey: cfg.nostrPrivkey, nostrInstallId: cfg.nostrInstallId }); } catch {}
  }

  // seenEvents: stores latest event per pubkey within the rolling window
  const seenEvents = new Map(); // pubkey -> { hashrate, workers, version, blocks, receivedAt }

  function aggregate() {
    const now = Date.now();
    const cutoff = now - SUBSCRIBE_WINDOW_S * 1000;
    let totalHashrate = 0;
    let totalWorkers = 0;
    let totalBlocks = 0;
    const versions = {};
    let pools = 0;

    for (const [pubkey, ev] of seenEvents.entries()) {
      if (ev.receivedAt < cutoff) {
        seenEvents.delete(pubkey);
        continue;
      }
      pools++;
      totalHashrate += ev.hashrate;
      totalWorkers += ev.workers;
      totalBlocks += ev.blocks;
      versions[ev.version] = (versions[ev.version] || 0) + 1;
    }

    state.networkStats.pools = pools;
    state.networkStats.hashrate = totalHashrate;
    state.networkStats.workers = totalWorkers;
    state.networkStats.blocks = totalBlocks;
    state.networkStats.versions = versions;
    state.networkStats.lastUpdate = now;
  }

  function ingestEvent(event) {
    if (event.kind !== EVENT_KIND) return;
    const dTag = (event.tags || []).find(t => t[0] === 'd');
    if (!dTag || dTag[1] !== D_TAG) return;
    if (!verifyEvent(event)) {
      if (log) log(`[network-stats] Rejected event with bad signature from ${event.pubkey?.slice(0,8)}…`);
      return;
    }

    let data;
    try { data = JSON.parse(event.content); }
    catch { return; }

    const hashrate = Number(data.hashrate) || 0;
    const workers = Number(data.workers) || 0;
    const blocks = Number(data.blocks) || 0;
    const version = String(data.version || 'unknown').slice(0, 16);

    // Spam defense — clamp values
    if (hashrate < 0 || hashrate > MAX_HASHRATE_HPS) return;
    if (workers < 0 || workers > MAX_WORKERS) return;
    if (blocks < 0 || blocks > MAX_BLOCKS) return;

    // Keep most recent event per pubkey
    const existing = seenEvents.get(event.pubkey);
    if (existing && existing.receivedAt > (event.created_at * 1000)) return;

    seenEvents.set(event.pubkey, {
      hashrate, workers, blocks, version,
      receivedAt: event.created_at * 1000,
    });

    aggregate();
  }

  function connectRelay(url) {
    const existing = relayConnections.get(url);
    if (existing && existing.ws && existing.ws.readyState === WebSocket.OPEN) return;

    if (existing && existing.reconnectTimer) {
      clearTimeout(existing.reconnectTimer);
    }

    const ws = new WebSocket(url);
    const conn = { ws, status: 'connecting', reconnectTimer: null };
    relayConnections.set(url, conn);
    state.networkStats.relayStatus[url] = 'connecting';

    ws.on('open', () => {
      conn.status = 'connected';
      state.networkStats.relayStatus[url] = 'connected';
      if (log) log(`[network-stats] Connected to ${url}`);

      // Subscribe to all SoloStrike events from the last window
      const since = Math.floor(Date.now() / 1000) - SUBSCRIBE_WINDOW_S;
      const subId = 'solostrike-pulse';
      const sub = ['REQ', subId, {
        kinds: [EVENT_KIND],
        '#d': [D_TAG],
        since,
      }];
      try { ws.send(JSON.stringify(sub)); } catch {}
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (Array.isArray(msg) && msg[0] === 'EVENT' && msg[2]) {
          ingestEvent(msg[2]);
        }
        // ignore EOSE, NOTICE, OK, etc.
      } catch { /* malformed message — ignore */ }
    });

    ws.on('close', () => {
      conn.status = 'disconnected';
      state.networkStats.relayStatus[url] = 'disconnected';
      if (log) log(`[network-stats] Disconnected from ${url} — reconnecting in 30s`);
      conn.reconnectTimer = setTimeout(() => connectRelay(url), 30000);
    });

    ws.on('error', (err) => {
      conn.status = 'error';
      state.networkStats.relayStatus[url] = 'error';
      if (log) log(`[network-stats] Error on ${url}: ${err.message}`);
      // close handler will trigger reconnect
    });
  }

  // Periodically publish our own stats
  function publish() {
    // Only publish if opted in
    if (!cfg.networkStatsEnabled) return;

    const ourHashrate = (state.hashrate && state.hashrate.current) || 0;
    // v1.6.1: state.workers is an object keyed by worker name, not an array.
    // Use Object.values fallback so we count active miners correctly.
    const workersArr = Array.isArray(state.workers)
      ? state.workers
      : (state.workers && typeof state.workers === 'object' ? Object.values(state.workers) : []);
    const ourWorkers = workersArr.filter(w => w && w.status !== 'offline').length;
    const ourBlocks = Array.isArray(state.blocks) ? state.blocks.length : 0;
    const ourVersion = state.version || 'unknown';

    // Don't publish garbage — if we have no hashrate and no workers,
    // there's nothing meaningful to broadcast yet
    if (ourHashrate === 0 && ourWorkers === 0) return;

    const content = JSON.stringify({
      hashrate: Math.round(ourHashrate),
      workers: ourWorkers,
      version: ourVersion,
      blocks: ourBlocks,
    });

    const template = {
      kind: EVENT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', D_TAG]],
      content,
      pubkey: getPubkey(cfg.nostrPrivkey),
    };

    const signed = signEvent(template, cfg.nostrPrivkey);

    let publishedTo = 0;
    for (const [url, conn] of relayConnections.entries()) {
      if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
        try {
          conn.ws.send(JSON.stringify(['EVENT', signed]));
          publishedTo++;
        } catch (e) {
          if (log) log(`[network-stats] Failed to publish to ${url}: ${e.message}`);
        }
      }
    }
    if (log) log(`[network-stats] Published stats to ${publishedTo}/${relayConnections.size} relays`);

    // Also self-ingest so our own pool is counted in the aggregate
    seenEvents.set(signed.pubkey, {
      hashrate: ourHashrate,
      workers: ourWorkers,
      blocks: ourBlocks,
      version: ourVersion,
      receivedAt: Date.now(),
    });
    aggregate();
  }

  // Connect to all relays
  for (const url of RELAYS) {
    connectRelay(url);
  }

  // Schedule publishing — every 5 min, with a small initial delay so we
  // get a chance to see our own first event come back through the relays
  if (publishTimer) clearInterval(publishTimer);
  publishTimer = setInterval(publish, PUBLISH_INTERVAL_MS);
  setTimeout(publish, 30 * 1000); // first publish after 30s

  // Periodically re-aggregate (in case events expire from window)
  if (aggregateTimer) clearInterval(aggregateTimer);
  aggregateTimer = setInterval(aggregate, 60 * 1000);

  return {
    publishNow: publish,
    aggregateNow: aggregate,
    stop: () => {
      if (publishTimer) clearInterval(publishTimer);
      if (aggregateTimer) clearInterval(aggregateTimer);
      for (const [, conn] of relayConnections.entries()) {
        if (conn.reconnectTimer) clearTimeout(conn.reconnectTimer);
        if (conn.ws) {
          try { conn.ws.close(); } catch {}
        }
      }
      relayConnections.clear();
    },
  };
}

module.exports = {
  startNetworkStats,
  ensureIdentity,
  regenerateIdentity,
  generatePrivkey,
  getPubkey,
};
