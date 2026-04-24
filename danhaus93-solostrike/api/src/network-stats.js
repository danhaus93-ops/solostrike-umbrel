// ── SoloStrike Network Stats (v1.6.0) ─────────────────────────────────────
//
// Publishes anonymous pool stats to the SoloStrike Network over nostr
// every 5 minutes. Subscribes to everyone else's stats from the last
// 15 minutes and aggregates them into state.networkStats.
//
// Privacy: random keypair per install, no BTC address, no IP, no hostname.
// Opt-in publishing (cfg.networkStatsEnabled). Subscribing always on.
// Protocol: nostr kind 30078, tag "t":"solostrike-stats", tag "d":installId.

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

const PUBLISH_INTERVAL_MS = 5 * 60 * 1000;
const SUBSCRIBE_WINDOW_MS = 15 * 60 * 1000;
const RECONNECT_DELAY_MS = 30 * 1000;
const EVENT_KIND = 30078;
const TAG_NAME = 'solostrike-stats';

const MAX_HASHRATE_HPS = 10 * 1e15;
const MAX_WORKERS = 1000;
const MAX_BLOCKS = 1000;

function startNetworkStats({ state, cfg, savePersist }) {
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

  const seenEvents = new Map();

  state.networkStats = {
    enabled: !!cfg.networkStatsEnabled,
    pools: 0,
    hashrate: 0,
    workers: 0,
    blocks: 0,
    versions: {},
    lastUpdate: 0,
    relayStatus: {},
  };

  const sockets = new Map();
  const reconnectTimers = new Map();

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

  function handleIncomingEvent(ev) {
    if (!ev || typeof ev !== 'object') return;
    if (ev.kind !== EVENT_KIND) return;
    if (!Array.isArray(ev.tags)) return;

    const hasTag = ev.tags.some(t => Array.isArray(t) && t[0] === 't' && t[1] === TAG_NAME);
    if (!hasTag) return;

    const nowSec = Math.floor(Date.now() / 1000);
    if (ev.created_at < nowSec - (SUBSCRIBE_WINDOW_MS / 1000)) return;
    if (ev.created_at > nowSec + 60) return;

    let data;
    try { data = JSON.parse(ev.content); } catch { return; }
    if (!data || typeof data !== 'object') return;

    const hashrate = Number(data.hashrate) || 0;
    const workers = Number(data.workers) || 0;
    const blocks = Number(data.blocks) || 0;
    const version = typeof data.version === 'string' ? data.version.slice(0, 16) : 'unknown';

    if (hashrate < 0 || hashrate > MAX_HASHRATE_HPS) return;
    if (workers < 0 || workers > MAX_WORKERS) return;
    if (blocks < 0 || blocks > MAX_BLOCKS) return;

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
    if (!cfg.networkStatsEnabled) return;

    const ourHashrate = (state.hashrate && state.hashrate.current) || 0;
    const ourWorkers = Array.isArray(state.workers)
      ? state.workers.filter(w => w.status !== 'offline').length
      : 0;
    const ourBlocks = Array.isArray(state.blocks) ? state.blocks.length : 0;
    const ourVersion = state.version || 'unknown';

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
      tags: [['t', TAG_NAME], ['d', installId]],
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

    seenEvents.set(pubkey, {
      hashrate: Math.round(ourHashrate),
      workers: ourWorkers,
      blocks: ourBlocks,
      version: ourVersion,
      receivedAt: template.created_at,
    });
    recomputeAggregates();
  }

  const controller = {
    enable() {
      cfg.networkStatsEnabled = true;
      state.networkStats.enabled = true;
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
      cfg.nostrPrivkey = Buffer.from(sk).toString('hex');
      cfg.nostrInstallId = crypto.randomUUID();
      saveIdentity();
      console.log('[network-stats] Regenerated identity — restart API to apply');
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

  RELAYS.forEach(connectRelay);
  setInterval(publishOurStats, PUBLISH_INTERVAL_MS);
  setInterval(recomputeAggregates, 60 * 1000);
  setTimeout(publishOurStats, 15 * 1000);

  console.log(`[network-stats] Started (participating=${!!cfg.networkStatsEnabled})`);

  return controller;
}

module.exports = { startNetworkStats };
