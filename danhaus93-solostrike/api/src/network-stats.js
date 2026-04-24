// ── SoloStrike Network Stats (v1.6.0) ─────────────────────────────────────
//
// Publishes anonymous pool stats (hashrate, worker count, version,
// blocks found) to the SoloStrike Network over nostr every 5 minutes.
// Subscribes to everyone else's stats from the last 15 minutes and
// aggregates them into state.networkStats.
//
// Privacy model:
// • Random keypair generated once per install, stored in persist.json.
//   Not linked to the BTC payout address or anything else identifiable.
// • Payload contains only numeric stats and version string. No IP,
//   no BTC address, no hostname, no location.
// • Publishing is opt-in (cfg.networkStatsEnabled). Subscribing/
//   displaying network totals is always on — users can see the
//   network without contributing.
// • Users can regenerate the keypair anytime to start over with a
//   fresh identity.
//
// Protocol details:
// • nostr kind 30078 (parameterized replaceable — one event per install)
// • tag "t": "solostrike-stats" (discovery)
// • tag "d": install UUID (dedup key — same install only counts once
//   even if we see events from multiple relays)
// • content: JSON.stringify({ hashrate, workers, version, blocks })
//
// Spam defense:
// • Reject hashrate > 10 PH/s per install (home pool sanity limit)
// • Reject worker count > 1000 per install
// • Reject events older than 15 minutes (prevents replay)
// • Dedup by pubkey (one event per install per 15-min window)

const crypto = require('crypto');
const WebSocket = require('ws');
const {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} = require('nostr-tools/pure');

const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
];

const PUBLISH_INTERVAL_MS = 5 * 60 * 1000;   // 5 minutes
const SUBSCRIBE_WINDOW_MS = 15 * 60 * 1000;  // count events from last 15 min
const RECONNECT_DELAY_MS = 30 * 1000;        // 30s between reconnect attempts
const EVENT_KIND = 30078;                    // parameterized replaceable
const TAG_NAME = 'solostrike-stats';

// Sanity limits — reject obviously bogus events
const MAX_HASHRATE_HPS = 10 * 1e15;          // 10 PH/s
const MAX_WORKERS = 1000;
const MAX_BLOCKS = 1000;

function startNetworkStats({ state, cfg, savePersist }) {
  // Ensure identity keypair exists. Stored in persist.json so it survives
  // restarts — otherwise we'd create a new "install" every boot and
  // pollute everyone's counter.
  if (!cfg.nostrPrivkey) {
    const sk = generateSecretKey();
    cfg.nostrPrivkey = Buffer.from(sk).toString('hex');
    cfg.nostrInstallId = crypto.randomUUID();
    console.log('[network-stats] Generated new nostr identity');
  }
  if (!cfg.nostrInstallId) {
    cfg.nostrInstallId = crypto.randomUUID();
  }

  const privkeyBytes = Buffer.from(cfg.nostrPrivkey, 'hex');
  const pubkey = getPublicKey(privkeyBytes);
  const installId = cfg.nostrInstallId;

  console.log(`[network-stats] Identity: pubkey=${pubkey.slice(0,16)}… installId=${installId.slice(0,8)}…`);

  // Aggregated view of the network — refreshed continuously as we
  // receive events. Gets pruned every minute to drop stale entries.
  // Keyed by pubkey so the same install reporting to multiple relays
  // only counts once.
  const seenEvents = new Map(); // pubkey -> { hashrate, workers, version, blocks, receivedAt }

  state.networkStats = {
    enabled: !!cfg.networkStatsEnabled,
    pools: 0,
    hashrate: 0,
    workers: 0,
    blocks: 0,
    versions: {},
    lastUpdate: 0,
    relayStatus: {}, // url -> 'connected' | 'connecting' | 'error'
  };

  // Relay connection pool. One WebSocket per relay, reconnects on drop.
  const sockets = new Map(); // url -> WebSocket

  function connectRelay(url) {
    state.networkStats.relayStatus[url] = 'connecting';

    let ws;
    try {
      ws = new WebSocket(url, { handshakeTimeout: 10000 });
    } catch (e) {
      console.log(`[network-stats] Relay ${url} connect threw: ${e.message}`);
      scheduleReconnect(url);
      return;
    }

    sockets.set(url, ws);

    ws.on('open', () => {
      state.networkStats.relayStatus[url] = 'connected';
      console.log(`[network-stats] Connected to ${url}`);
      // Subscribe immediately on connect
      const subId = 'ss-sub-' + crypto.randomBytes(4).toString('hex');
      const since = Math.floor((Date.now() - SUBSCRIBE_WINDOW_MS) / 1000);
      const req = JSON.stringify([
        'REQ', subId,
        { kinds: [EVENT_KIND], '#t': [TAG_NAME], since },
      ]);
      try { ws.send(req); } catch {}
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (!Array.isArray(msg)) return;

      const type = msg[0];
      if (type === 'EVENT') {
        handleIncomingEvent(msg[2]);
      } else if (type === 'NOTICE') {
        // Relay advisory, log but don't panic
        console.log(`[network-stats] ${url} notice: ${msg[1]}`);
      }
      // EOSE and OK messages — no action needed
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

  const reconnectTimers = new Map();
  function scheduleReconnect(url) {
    if (reconnectTimers.has(url)) return;
    const timer = setTimeout(() => {
      reconnectTimers.delete(url);
      connectRelay(url);
    }, RECONNECT_DELAY_MS);
    reconnectTimers.set(url, timer);
  }

  function handleIncomingEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.kind !== EVENT_KIND) return;
    if (!Array.isArray(ev.tags)) return;

    // Must have the solostrike-stats tag
    const hasTag = ev.tags.some(t => Array.isArray(t) && t[0] === 't' && t[1] === TAG_NAME);
    if (!hasTag) return;

    // Reject events older than our subscribe window (replay protection)
    const nowSec = Math.floor(Date.now() / 1000);
    if (ev.created_at < nowSec - (SUBSCRIBE_WINDOW_MS / 1000)) return;
    if (ev.created_at > nowSec + 60) return; // clock-skew tolerance

    // Parse content
    let data;
    try { data = JSON.parse(ev.content); } catch { return; }
    if (!data || typeof data !== 'object') return;

    const hashrate = Number(data.hashrate) || 0;
    const workers = Number(data.workers) || 0;
    const blocks = Number(data.blocks) || 0;
    const version = typeof data.version === 'string' ? data.version.slice(0, 16) : 'unknown';

    // Sanity limits
    if (hashrate < 0 || hashrate > MAX_HASHRATE_HPS) return;
    if (workers < 0 || workers > MAX_WORKERS) return;
    if (blocks < 0 || blocks > MAX_BLOCKS) return;

    // Dedup by pubkey — keep newest event only
    const existing = seenEvents.get(ev.pubkey);
    if (existing && existing.receivedAt > ev.created_at) return;

    seenEvents.set(ev.pubkey, {
      hashrate, workers, blocks, version,
      receivedAt: ev.created_at,
    });

    recomputeAggregates();
  }

  function recomputeAggregates() {
    const cutoffSec = Math.floor((Date.now() - SUBSCRIBE_WINDOW_MS) / 1000);

    // Prune stale entries
    for (const [pk, e] of seenEvents) {
      if (e.receivedAt < cutoffSec) seenEvents.delete(pk);
    }

    let hashrate = 0, workers = 0, blocks = 0;
    const versions = {};
    for (const e of seenEvents.values()) {
      hashrate += e.hashrate;
      workers += e.workers;
      blocks += e.blocks;
      versions[e.version] = (versions[e.version] || 0) + 1;
    }

    state.networkStats.pools = seenEvents.size;
    state.networkStats.hashrate = hashrate;
    state.networkStats.workers = workers;
    state.networkStats.blocks = blocks;
    state.networkStats.versions = versions;
    state.networkStats.lastUpdate = Date.now();
  }

  function publishOurStats() {
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
      tags: [
        ['t', TAG_NAME],
        ['d', installId],
      ],
      content,
    };

    let signed;
    try {
      signed = finalizeEvent(template, privkeyBytes);
    } catch (e) {
      console.log(`[network-stats] Sign failed: ${e.message}`);
      return;
    }

    const payload = JSON.stringify(['EVENT', signed]);

    let publishedTo = 0;
    for (const [url, ws] of sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(payload);
        publishedTo++;
      } catch (e) {
        console.log(`[network-stats] Publish to ${url} failed: ${e.message}`);
      }
    }
    console.log(`[network-stats] Published stats to ${publishedTo}/${RELAYS.length} relays`);

    // Also count ourselves in the aggregate immediately (don't wait to
    // hear our own event echoed back)
    seenEvents.set(pubkey, {
      hashrate: Math.round(ourHashrate),
      workers: ourWorkers,
      blocks: ourBlocks,
      version: ourVersion,
      receivedAt: template.created_at,
    });
    recomputeAggregates();
  }

  // API exposed to the rest of the app for runtime control
  const controller = {
    enable() {
      cfg.networkStatsEnabled = true;
      state.networkStats.enabled = true;
      // Publish immediately so the user sees themselves in the counter
      publishOurStats();
      saveIdentity();
    },
    disable() {
      cfg.networkStatsEnabled = false;
      state.networkStats.enabled = false;
      // Remove our own event from the local aggregate so counter updates
      seenEvents.delete(pubkey);
      recomputeAggregates();
      saveIdentity();
    },
    regenerateIdentity() {
      // Clear our old pubkey from the aggregate first
      seenEvents.delete(pubkey);
      const sk = generateSecretKey();
      cfg.nostrPrivkey = Buffer.from(sk).toString('hex');
      cfg.nostrInstallId = crypto.randomUUID();
      saveIdentity();
      console.log('[network-stats] Regenerated identity — restart API to apply');
      // Note: we don't rebuild the signer in-place because the closure
      // captures privkeyBytes and pubkey. A restart is required for the
      // new identity to actually publish.
    },
  };

  function saveIdentity() {
    try {
      savePersist({
        nostrPrivkey: cfg.nostrPrivkey,
        nostrInstallId: cfg.nostrInstallId,
        networkStatsEnabled: !!cfg.networkStatsEnabled,
      });
    } catch (e) {
      console.log(`[network-stats] saveIdentity failed: ${e.message}`);
    }
  }

  // Kick everything off
  RELAYS.forEach(connectRelay);
  setInterval(publishOurStats, PUBLISH_INTERVAL_MS);
  setInterval(recomputeAggregates, 60 * 1000); // prune every minute

  // First publish happens after 15s delay so hashrate has time to warm up
  setTimeout(publishOurStats, 15 * 1000);

  console.log(`[network-stats] Started (participating=${!!cfg.networkStatsEnabled})`);

  return controller;
}

module.exports = { startNetworkStats };
