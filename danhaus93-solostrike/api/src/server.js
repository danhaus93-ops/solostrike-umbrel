const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const cors      = require('cors');
const chokidar  = require('chokidar');
const fs        = require('fs-extra');
const path      = require('path');
const { startStatusPoller }             = require('./status-poller');
const { startUaTailer }                 = require('./ua-tailer');
const { transformState }                = require('./state-transform');
const { isValidBtcAddress, rowsToCsv }  = require('./validators');
const {
  loadSnapshots,
  saveSnapshots,
  startSnapshotScheduler,
  MAX_DAILY_SNAPSHOTS,
  MAX_CLOSEST_CALLS,
} = require('./snapshots');
const { startStratumHealthPoller, getStratumHealth } = require('./stratum-health');
const { startBlockWatcher } = require('./block-watcher');
const { startShareWatcher } = require('./share-watcher');
const { startNetworkStats } = require('./network-stats');


const VERSION = '1.6.0';

async function fetchWithTimeout(url, opts = {}) {
  const { timeout = 8000, ...rest } = opts;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '32kb' }));
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, maxPayload: 64 * 1024 });
const MAX_WS_CLIENTS = 50;

const CONFIG_DIR     = process.env.CONFIG_DIR        || '/app/config';
const CKPOOL_LOG_DIR = process.env.CKPOOL_LOG_DIR    || '/var/log/ckpool';
const CKPOOL_CFG_DIR = process.env.CKPOOL_CONFIG_DIR || '/etc/ckpool';
const CONFIG_FILE    = path.join(CONFIG_DIR, 'solostrike.json');
const PERSIST_FILE   = path.join(CONFIG_DIR, 'persist.json');
const CKPOOL_CONF    = path.join(CKPOOL_CFG_DIR, 'ckpool.conf');

const BITCOIN_RPC_URL = process.env.BITCOIN_RPC_URL;
const BITCOIN_RPC_USER = process.env.BITCOIN_RPC_USER || '';
const BITCOIN_RPC_PASS = process.env.BITCOIN_RPC_PASS || '';
const ZMQ_HASHBLOCK_URL = process.env.ZMQ_HASHBLOCK_URL;

const STRATUM_PORT       = parseInt(process.env.STRATUM_PORT       || '3333', 10);
const STRATUM_PORT_HOBBY = parseInt(process.env.STRATUM_PORT_HOBBY || '3334', 10);
const STRATUM_PORT_TLS   = parseInt(process.env.STRATUM_PORT_TLS   || '4333', 10);

const MAX_HISTORY_POINTS = 1440;
const MAX_NET_BLOCKS     = 15;
const MAX_FOUND_BLOCKS   = 50;
const MAX_WEBHOOKS       = 10;

const bootTime = Date.now();

const state = {
  status: 'loading',
  version: '1.6.0',
  privateMode: false,
  minimalMode: false,
  workers: {},
  blocks: [],
  closestCalls: [],
  bestshare: 0,
  hashrate: { current:0, hour:0, day:0, history: [], week: [], averages: {} },
  hashrateHistory: [],
  network: { height:0, hashrate:0, difficulty:0 },
  latestBlock: null,
  mempool: { count:0, feeRate:0 },
  prices: {},
  netBlocks: [],
  topFinders: [],
  snapshots: { daily: [], closestCalls: [], lastRollupDate: null },
  bitcoind: { synced:false, progress:0 },
  shares: { accepted: 0, rejected: 0, acceptedCount: 0, rejectedCount: 0, stale: 0, sps1m: 0 },
  uptime: Date.now(),
  totalWorkers: 0,
  zmq: { enabled:false, lastBlockHeardAt:null, endpoint:null },
  webhooks: [],
  ports: { stratum:STRATUM_PORT, hobby:STRATUM_PORT_HOBBY, tls:STRATUM_PORT_TLS },
};

async function loadConfig() {
  try {
    if (await fs.pathExists(CONFIG_FILE)) {
      return await fs.readJson(CONFIG_FILE);
    }
  } catch {}
  return {};
}
async function saveConfig(obj) {
  try { await fs.ensureDir(CONFIG_DIR); await fs.writeJson(CONFIG_FILE, obj, { spaces: 2 }); }
  catch (e) { console.error('saveConfig failed:', e.message); }
}

async function loadPersist() {
  try {
    if (await fs.pathExists(PERSIST_FILE)) return await fs.readJson(PERSIST_FILE);
  } catch {}
  return {};
}
async function savePersist(obj) {
  try {
    await fs.ensureDir(CONFIG_DIR);
    // Merge with existing persist so callers only need to pass what they changed
    let existing = {};
    try {
      if (await fs.pathExists(PERSIST_FILE)) existing = await fs.readJson(PERSIST_FILE);
    } catch {}
    const merged = { ...existing, ...obj };
    await fs.writeJson(PERSIST_FILE, merged, { spaces: 2 });
  }
  catch (e) { console.error('savePersist failed:', e.message); }
}

function cfgPublic() {
  return {
    payoutAddress: cfg.payoutAddress || '',
    poolName: cfg.poolName || 'SoloStrike',
    privateMode: !!cfg.privateMode,
    stratumPort: STRATUM_PORT,
    stratumPortHobby: STRATUM_PORT_HOBBY,
    stratumPortTls: STRATUM_PORT_TLS,
  };
}

let cfg = {};
let wsClients = 0;

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN) {
      try { c.send(data); } catch {}
    }
  });
}

wss.on('connection', (ws, req) => {
  if (wsClients >= MAX_WS_CLIENTS) {
    try { ws.close(); } catch {}
    return;
  }
  wsClients++;
  try { ws.send(JSON.stringify({ type:'STATE_UPDATE', data: transformState(state) })); } catch {}
  try { ws.send(JSON.stringify({ type:'CONFIG', data: { poolName: cfg.poolName || 'SoloStrike', privateMode: !!cfg.privateMode, hasAddress: !!cfg.payoutAddress } })); } catch {}
  ws.on('close', () => { wsClients--; });
  ws.on('error', () => { wsClients--; });
});

setInterval(() => {
  try { broadcast({ type:'STATE_UPDATE', data: transformState(state) }); } catch {}
}, 3000);

// ── Rate limiter for public endpoints ────────────────────────────────────────
const rateCache = new Map();
function rateLimit(req, res, next) {
  const ip = (req.headers['x-forwarded-for'] || req.connection?.remoteAddress || '').toString();
  const now = Date.now();
  const entry = rateCache.get(ip) || { count: 0, resetAt: now + 60000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 60000; }
  entry.count++;
  rateCache.set(ip, entry);
  if (entry.count > 60) {
    return res.status(429).json({ error: 'Rate limit exceeded (60/min)' });
  }
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, e] of rateCache) if (now > e.resetAt + 60000) rateCache.delete(ip);
}, 120000);

// ── Webhooks ─────────────────────────────────────────────────────────────────
async function fireHooks(eventType, payload) {
  const hooks = (state.webhooks || []).filter(h => (h.events || []).includes(eventType));
  if (!hooks.length) return;
  const body = JSON.stringify({ event: eventType, timestamp: Date.now(), ...payload });
  await Promise.all(hooks.map(async h => {
    try {
      await fetchWithTimeout(h.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        timeout: 5000,
      });
    } catch (e) {
      console.log(`[webhook] ${h.name} failed: ${e.message}`);
    }
  }));
}

// ── ckpool log tailers ───────────────────────────────────────────────────────
async function rpcBitcoind(method, params = []) {
  if (!BITCOIN_RPC_URL) throw new Error('BITCOIN_RPC_URL not set');
  const auth = Buffer.from(`${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASS}`).toString('base64');
  const r = await fetchWithTimeout(BITCOIN_RPC_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Basic ${auth}` },
    body: JSON.stringify({ jsonrpc: '1.0', method, params }),
    timeout: 8000,
  });
  if (!r.ok) throw new Error(`rpc ${method} HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}

async function pollBitcoind() {
  try {
    const info = await rpcBitcoind('getblockchaininfo');
    const peerInfo = await rpcBitcoind('getpeerinfo').catch(() => []);
    const mempool = await rpcBitcoind('getmempoolinfo').catch(() => ({}));
    const netInfo = await rpcBitcoind('getnetworkinfo').catch(() => ({}));

    state.bitcoind = {
      synced: !info.initialblockdownload && info.verificationprogress > 0.9999,
      progress: info.verificationprogress,
      height: info.blocks,
      headers: info.headers,
    };
    state.network.height = info.blocks;
    state.network.difficulty = info.difficulty;

    // hashrate from network info (1008 blocks ≈ 1 week)
    try {
      const nh = await rpcBitcoind('getnetworkhashps', [1008]);
      state.network.hashrate = nh;
    } catch {}

    state.nodeInfo = {
      version: netInfo.subversion || 'unknown',
      peersIn: peerInfo.filter(p => p.inbound).length,
      peersOut: peerInfo.filter(p => !p.inbound).length,
      peersTotal: peerInfo.length,
      relayFeeBtc: netInfo.relayfee || 0,
      mempoolSize: mempool.size || 0,
      mempoolBytes: mempool.bytes || 0,
    };

    // sync state
    const behind = Math.max(0, info.headers - info.blocks);
    state.sync = { synced: behind < 3, behindBy: behind };

    // retarget countdown
    const blocksToRetarget = 2016 - (info.blocks % 2016);
    state.retarget = {
      blocksLeft: blocksToRetarget,
      nextHeight: info.blocks + blocksToRetarget,
      estimatedSeconds: blocksToRetarget * 600,
    };

    // block reward for this epoch
    state.blockReward = Math.floor(info.blocks / 210000) < 33
      ? 50 / Math.pow(2, Math.floor(info.blocks / 210000))
      : 0;

  } catch (e) {
    state.bitcoind = { synced: false, progress: 0, error: e.message };
  }
}

async function pollBlocks() {
  try {
    const height = state.network.height;
    if (!height) return;

    const recent = [];
    for (let h = height; h > height - 15 && h >= 0; h--) {
      try {
        const hash = await rpcBitcoind('getblockhash', [h]);
        const blk = await rpcBitcoind('getblock', [hash, 1]);
        const coinbaseTxid = blk.tx[0];
        const coinbaseTx = await rpcBitcoind('getrawtransaction', [coinbaseTxid, true, hash]).catch(() => null);
        const coinbaseScript = coinbaseTx?.vin?.[0]?.coinbase || '';
        let pool = detectPool(coinbaseScript, coinbaseTx);
        const isSolo = /solo|ckpool|solostrike/i.test(pool);
        const reward = coinbaseTx?.vout?.[0]?.value || 0;
        recent.push({
          id: hash,
          height: h,
          timestamp: blk.time,
          tx_count: blk.nTx,
          size: blk.size,
          pool,
          isSolo,
          reward: Math.round(reward * 1e8),
        });
      } catch {}
    }
    state.netBlocks = recent;

    // latest block summary
    if (recent[0]) {
      state.latestBlock = {
        height: recent[0].height,
        pool: recent[0].pool,
        isSolo: recent[0].isSolo,
        reward: recent[0].reward,
        timestamp: recent[0].timestamp,
      };
    }

    // top finders aggregation across the window
    const finderMap = {};
    recent.forEach(b => {
      if (!finderMap[b.pool]) finderMap[b.pool] = { name: b.pool, count: 0, isSolo: b.isSolo };
      finderMap[b.pool].count++;
    });
    state.topFinders = Object.values(finderMap).sort((a,b) => b.count - a.count).slice(0, 5);

  } catch (e) { /* keep last known */ }
}

function detectPool(coinbaseHex, tx) {
  if (!coinbaseHex) return 'Unknown';
  try {
    const buf = Buffer.from(coinbaseHex, 'hex');
    const ascii = buf.toString('ascii');
    if (/foundryusa|foundry/i.test(ascii)) return 'Foundry USA';
    if (/antpool/i.test(ascii)) return 'AntPool';
    if (/f2pool/i.test(ascii)) return 'F2Pool';
    if (/viabtc/i.test(ascii)) return 'ViaBTC';
    if (/binance/i.test(ascii)) return 'Binance Pool';
    if (/luxor/i.test(ascii)) return 'Luxor';
    if (/mara/i.test(ascii)) return 'MARA Pool';
    if (/mining\.?squared|1THash|ocean|ckpool|solo\.?ckpool/i.test(ascii)) {
      if (/ckpool|solo/i.test(ascii)) return 'Solo CKpool';
      if (/ocean/i.test(ascii)) return 'Ocean';
      if (/1thash/i.test(ascii)) return '1THash';
    }
    if (/spiderpool/i.test(ascii)) return 'SpiderPool';
    if (/sbi|poolin/i.test(ascii)) return 'Poolin';
    if (/secpool|sec.?pool/i.test(ascii)) return 'SECPool';
    return 'Unknown';
  } catch { return 'Unknown'; }
}

async function pollMempool() {
  if (cfg.privateMode) return;
  try {
    const r = await fetchWithTimeout('https://mempool.space/api/v1/fees/recommended', { timeout: 6000 });
    if (!r.ok) return;
    const j = await r.json();
    state.mempool.feeRate = j.fastestFee || 0;
    state.mempool.halfHour = j.halfHourFee || 0;
    state.mempool.hour = j.hourFee || 0;
    state.mempool.economy = j.economyFee || 0;
    state.mempool.minimum = j.minimumFee || 0;
  } catch {}
  try {
    const r2 = await fetchWithTimeout('https://mempool.space/api/mempool', { timeout: 6000 });
    if (!r2.ok) return;
    const j2 = await r2.json();
    state.mempool.count = j2.count || 0;
    state.mempool.vsize = j2.vsize || 0;
    state.mempool.total_fee = j2.total_fee || 0;
  } catch {}
}

async function pollPrices() {
  if (cfg.privateMode) return;
  try {
    const r = await fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,eur,gbp,jpy,cad,aud', { timeout: 6000 });
    if (!r.ok) return;
    const j = await r.json();
    if (j.bitcoin) state.prices = j.bitcoin;
  } catch {}
}

// ── ZMQ client for instant block notifications ──────────────────────────────
function startZmq() {
  if (!ZMQ_HASHBLOCK_URL) {
    state.zmq = { enabled:false, lastBlockHeardAt:null, endpoint:null };
    return;
  }
  try {
    const zmq = require('zeromq');
    const sock = zmq.socket('sub');
    sock.connect(ZMQ_HASHBLOCK_URL);
    sock.subscribe('hashblock');
    sock.on('message', () => {
      state.zmq.lastBlockHeardAt = Date.now();
      pollBitcoind();
      pollBlocks();
    });
    sock.on('error', (e) => {
      console.log('[ZMQ] socket error:', e.message);
      try { sock.close(); } catch {}
      state.zmq = { enabled:false, lastBlockHeardAt:null, endpoint:null };
      setTimeout(startZmq, 10000);
    });
    state.zmq = { enabled:true, lastBlockHeardAt:null, endpoint: ZMQ_HASHBLOCK_URL };

    console.log(`[ZMQ] connected to ${ZMQ_HASHBLOCK_URL}`);
  } catch (e) {
    state.zmq = { enabled:false, lastBlockHeardAt:null, endpoint:null };
    console.log('[zmq] unavailable:', e.message);
  }
}

function watchLogs() {
  // ckpool's pool.status is watched by startStatusPoller — don't double-up.
  // block-watcher and share-watcher handle their own directories too.
  // This function remains for any future file-watching needs.
}

// ── Luck & odds computations ─────────────────────────────────────────────────
function computeLuck() {
  const blocks = state.blocks || [];
  if (!blocks.length) {
    state.luck = { value: 0, label: 'no blocks yet', color: 'var(--text-2)' };
    return;
  }
  // Trailing-30-day luck: expected vs actual
  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const recent = blocks.filter(b => b.ts >= cutoff);
  const hashrate = state.hashrate?.averages?.day || state.hashrate?.current || 0;
  const netHashrate = state.network?.hashrate || 0;
  if (!hashrate || !netHashrate) {
    state.luck = { value: 0, label: 'warming up', color: 'var(--text-2)' };
    return;
  }
  const expectedBlocksPerDay = (hashrate / netHashrate) * 144;
  const expectedBlocks30d = expectedBlocksPerDay * 30;
  const actualBlocks30d = recent.length;
  const luck = expectedBlocks30d > 0 ? (actualBlocks30d / expectedBlocks30d) : 0;
  let label = 'cold';
  let color = 'var(--text-2)';
  if (luck > 1.5) { label = 'scorching'; color = 'var(--amber)'; }
  else if (luck > 1) { label = 'hot'; color = 'var(--amber)'; }
  else if (luck > 0.5) { label = 'warm'; color = 'var(--text-1)'; }
  else if (luck > 0) { label = 'cool'; color = 'var(--text-2)'; }
  state.luck = { value: luck, label, color, expected: expectedBlocks30d, actual: actualBlocks30d };
}

function computeOdds() {
  const hashrate = state.hashrate?.current || 0;
  const netHashrate = state.network?.hashrate || 0;
  if (!hashrate || !netHashrate) {
    state.odds = { daily: 0, weekly: 0, monthly: 0, expectedSeconds: Infinity };
    return;
  }
  const share = hashrate / netHashrate;
  const expectedSeconds = share > 0 ? 600 / share : Infinity;
  state.odds = {
    daily:   1 - Math.pow(1 - share, 144),
    weekly:  1 - Math.pow(1 - share, 144 * 7),
    monthly: 1 - Math.pow(1 - share, 144 * 30),
    expectedSeconds,
  };
}

setInterval(() => { computeLuck(); computeOdds(); }, 30000);

// ── API routes ───────────────────────────────────────────────────────────────
app.get('/api/state',  (req, res) => res.json(transformState(state)));
app.get('/api/config', (req, res) => res.json(cfgPublic()));
app.get('/api/health', (req, res) => res.json({
  ok: true,
  version: VERSION,
  uptime: Math.floor((Date.now() - bootTime)/1000),
  status: state.status,
  bitcoind: state.bitcoind,
  workers: Object.values(state.workers || {}).length || 0,
  privateMode: !!cfg.privateMode,
  zmq: state.zmq,
}));

app.get('/api/prices', (req, res) => res.json(state.prices || {}));

app.get('/api/snapshots', rateLimit, (req, res) => {
  res.json(state.snapshots || { daily: [] });
});

app.get('/api/public/summary', rateLimit, (req, res) => {
  const s = transformState(state);
  res.json({
    pool: cfg.poolName || 'SoloStrike',
    hashrate: s.hashrate?.current || 0,
    workers: s.totalWorkers || 0,
    blocks: (s.blocks || []).length,
    bestshare: s.bestshare || 0,
    uptime: Math.floor((Date.now() - bootTime) / 1000),
  });
});

app.get('/api/public/workers', rateLimit, (req, res) => {
  const workers = (transformState(state).workers || []).map(w => ({
    name: w.name?.split('.').pop() || 'unknown',
    hashrate: w.hashrate1m || 0,
    status: w.status,
    minerType: w.minerType,
  }));
  res.json({ workers });
});

app.get('/api/widget/four-stats', (req, res) => {
  const s = transformState(state);
  const hr = s.hashrate?.current || 0;
  let hrText, hrSub;
  if (hr >= 1e15) { hrText = (hr / 1e15).toFixed(2); hrSub = 'PH/s'; }
  else if (hr >= 1e12) { hrText = (hr / 1e12).toFixed(1); hrSub = 'TH/s'; }
  else if (hr >= 1e9)  { hrText = (hr / 1e9).toFixed(1);  hrSub = 'GH/s'; }
  else if (hr >= 1e6)  { hrText = (hr / 1e6).toFixed(1);  hrSub = 'MH/s'; }
  else                 { hrText = hr.toFixed(0);          hrSub = 'H/s';  }
  const best = s.bestshare || 0;
  let bestText;
  if (best >= 1e9) bestText = (best / 1e9).toFixed(2) + 'B';
  else if (best >= 1e6) bestText = (best / 1e6).toFixed(2) + 'M';
  else if (best >= 1e3) bestText = (best / 1e3).toFixed(2) + 'K';
  else bestText = String(Math.round(best));
  res.json({
    type: 'four-stats',
    link: '',
    items: [
      { title: 'Pool Hashrate', text: hrText, subtext: hrSub },
      { title: 'Workers',       text: String(s.totalWorkers || 0) },
      { title: 'Blocks Found',  text: String((s.blocks || []).length) },
      { title: 'Best Diff',     text: bestText },
    ],
  });
});

app.get('/api/stratum-health', (req, res) => {
  res.json(getStratumHealth());
});

// ── SoloStrike Network (v1.6.0) ──────────────────────────────────────────────
app.get('/api/network-stats', (req, res) => {
  res.json(state.networkStats || { enabled: false, pools: 0, hashrate: 0, workers: 0, blocks: 0, versions: {} });
});

app.post('/api/network-stats/enable', (req, res) => {
  if (!networkStatsController) return res.status(503).json({ error: 'network-stats not initialized yet' });
  networkStatsController.enable();
  res.json({ ok: true, enabled: true });
});

app.post('/api/network-stats/disable', (req, res) => {
  if (!networkStatsController) return res.status(503).json({ error: 'network-stats not initialized yet' });
  networkStatsController.disable();
  res.json({ ok: true, enabled: false });
});

app.post('/api/network-stats/regenerate', (req, res) => {
  if (!networkStatsController) return res.status(503).json({ error: 'network-stats not initialized yet' });
  networkStatsController.regenerateIdentity();
  res.json({ ok: true, message: 'Identity regenerated. Restart the API container to apply.' });
});

app.get('/metrics', (req, res) => {
  const s = transformState(state);
  const lines = [];
  const add = (name, help, type, value) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name} ${value}`);
  };
  add('solostrike_hashrate_hps', 'Current pool hashrate in H/s', 'gauge', s.hashrate?.current || 0);
  add('solostrike_workers_total', 'Total workers', 'gauge', s.totalWorkers || 0);
  add('solostrike_workers_active', 'Workers with hashrate > 0', 'gauge',
      (s.workers||[]).filter(w => w.hashrate1m > 0).length);
  add('solostrike_blocks_found_total', 'Total blocks found by pool', 'counter', (s.blocks||[]).length);
  add('solostrike_best_share', 'Best share difficulty on record', 'gauge', s.bestshare || 0);
  add('solostrike_network_height', 'Bitcoin chain height', 'gauge', s.network?.height || 0);
  add('solostrike_network_hashrate_hps', 'Bitcoin network hashrate', 'gauge', s.network?.hashrate || 0);
  add('solostrike_bitcoind_synced', '1 if bitcoind is synced', 'gauge', s.bitcoind?.synced ? 1 : 0);
  add('solostrike_api_uptime_seconds', 'API uptime in seconds', 'counter',
      Math.floor((Date.now() - bootTime)/1000));
  res.set('content-type', 'text/plain; version=0.0.4').send(lines.join('\n') + '\n');
});

// Webhooks
app.get('/api/webhooks', (req, res) => {
  res.json({ hooks: (state.webhooks || []).map(h => ({ id:h.id, name:h.name, url:h.url, events:h.events })) });
});

app.post('/api/webhooks', async (req, res) => {
  const { op, id, name, url, events } = req.body || {};
  state.webhooks = state.webhooks || [];
  try {
    if (op === 'add') {
      if (state.webhooks.length >= MAX_WEBHOOKS) return res.status(400).json({ error: `max ${MAX_WEBHOOKS} webhooks` });
      if (!/^https?:\/\//i.test((url || '').trim())) return res.status(400).json({ error: 'url must be http(s)' });
      const allowed = ['block_found','worker_offline','worker_online'];
      const ev = Array.isArray(events) ? events.filter(x => allowed.includes(x)) : [];
      if (!ev.length) return res.status(400).json({ error: 'no valid events' });
      const h = { id: 'wh-' + Date.now().toString(36), name: String(name || 'Webhook').slice(0,50), url: url.trim(), events: ev };
      state.webhooks.push(h);
    } else if (op === 'remove') {
      state.webhooks = state.webhooks.filter(h => h.id !== id);
    } else {
      return res.status(400).json({ error: 'unknown op' });
    }
    await savePersist({
      closestCalls: state.closestCalls,
      blocks: state.blocks,
      snapshots: state.snapshots,
      webhooks: state.webhooks,
    });
    res.json({ ok: true, hooks: state.webhooks.map(h => ({ id:h.id, name:h.name, url:h.url, events:h.events })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/export/workers.csv', rateLimit, (req, res) => {
  const s = transformState(state);
  const header = [
    'name','display_name','miner_type','miner_vendor','status','ip',
    'hashrate_1m_hps','hashrate_5m_hps','hashrate_1h_hps','hashrate_24h_hps','hashrate_7d_hps',
    'shares_accepted','shares_rejected','shares_stale','accept_rate_pct','best_share',
    'session_accepted','session_rejected','session_stale','session_accept_rate_pct',
    'last_reject_reason','last_reject_at','port','last_seen',
  ];
  const rows = [header];
  (s.workers || []).forEach(w => {
    const se = w.shareEvents || {};
    const tot = (se.accepted || 0) + (se.rejected || 0) + (se.stale || 0);
    const ar = tot > 0 ? (((se.accepted || 0) / tot) * 100).toFixed(3) : '';
    const work = w.shares || 0;
    const workRej = w.rejected || 0;
    const workAr = (work + workRej) > 0 ? ((work / (work + workRej)) * 100).toFixed(3) : '';
    rows.push([
      w.name || '',
      (w.name || '').split('.').pop(),
      w.minerType || '',
      w.minerVendor || '',
      w.status || '',
      w.ip || '',
      w.hashrate1m || 0,
      w.hashrate5m || 0,
      w.hashrate1h || 0,
      w.hashrate24h || 0,
      w.hashrate7d || 0,
      work,
      workRej,
      se.stale || 0,
      workAr,
      Math.round(w.bestshare || 0),
      se.accepted || 0,
      se.rejected || 0,
      se.stale || 0,
      ar,
      se.lastRejectReason || '',
      se.lastRejectAt ? new Date(se.lastRejectAt).toISOString() : '',
      se.port || '',
      w.lastSeen ? new Date(w.lastSeen).toISOString() : '',
    ]);
  });
  const csv = rowsToCsv(rows);
  res.set('content-type', 'text/csv');
  res.set('content-disposition', `attachment; filename="solostrike-workers-${Date.now()}.csv"`);
  res.send(csv);
});

app.get('/api/export/blocks.csv', rateLimit, (req, res) => {
  const header = ['height','hash','timestamp','iso_time','worker','bestshare'];
  const rows = [header];
  (state.blocks || []).forEach(b => {
    rows.push([
      b.height || 0,
      b.hash || '',
      b.ts || 0,
      b.ts ? new Date(b.ts).toISOString() : '',
      b.worker || '',
      Math.round(b.bestshare || 0),
    ]);
  });
  const csv = rowsToCsv(rows);
  res.set('content-type', 'text/csv');
  res.set('content-disposition', `attachment; filename="solostrike-blocks-${Date.now()}.csv"`);
  res.send(csv);
});

app.get('/api/export/snapshots.csv', rateLimit, (req, res) => {
  const header = ['date','avg_hashrate_hps','peak_hashrate_hps','workers_peak','blocks_in_day'];
  const rows = [header];
  ((state.snapshots?.daily) || []).forEach(d => {
    rows.push([
      d.date || '',
      d.avg || 0,
      d.peak || 0,
      d.workersPeak || 0,
      d.blocks || 0,
    ]);
  });
  const csv = rowsToCsv(rows);
  res.set('content-type', 'text/csv');
  res.set('content-disposition', `attachment; filename="solostrike-snapshots-${Date.now()}.csv"`);
  res.send(csv);
});

app.post('/api/reset-share-stats', (req, res) => {
  try {
    // Zero per-worker counters
    state.shareCounters = {};
    // Zero pool-level
    if (state.shares) {
      state.shares.acceptedCount = 0;
      state.shares.rejectedCount = 0;
      state.shares.stale = 0;
      state.shares.rejectReasons = {};
    }
    // Capture current byte-offsets of every existing sharelog so the watcher
    // skips over everything on disk and starts fresh from "now"
    const cursors = {};
    try {
      const walk = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            if (e.name === 'pool' || e.name === 'users') continue;
            walk(full);
          } else if (e.isFile() && e.name.endsWith('.sharelog')) {
            try {
              const st = fs.statSync(full);
              cursors[full] = st.size;
            } catch {}
          }
        }
      };
      if (fs.existsSync(CKPOOL_LOG_DIR)) walk(CKPOOL_LOG_DIR);
    } catch (e) { /* logDir may not exist yet */ }
    state.sharelogCursors = cursors;
    state.shareStatsStartedAt = Date.now();

    // Snapshot to disk so reset survives API restart
    savePersist({
      closestCalls: state.closestCalls,
      blocks: state.blocks,
      snapshots: state.snapshots,
      webhooks: state.webhooks,
      shareCounters: state.shareCounters,
      sharelogCursors: state.sharelogCursors,
      shareStatsStartedAt: state.shareStatsStartedAt,
    });

    console.log('[api] /api/reset-share-stats OK — cursors=' + Object.keys(cursors).length + ' resetAt=' + state.shareStatsStartedAt);
    res.json({
      ok: true,
      resetAt: state.shareStatsStartedAt,
      cursorsSkipped: Object.keys(cursors).length,
    });
  } catch (e) {
    console.log('[api] /api/reset-share-stats FAILED:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/setup', async (req, res) => {
  const { payoutAddress, poolName, privateMode } = req.body || {};
  const addr = (payoutAddress || '').trim();
  if (!addr) return res.status(400).json({ error: 'payoutAddress required' });
  if (!isValidBtcAddress(addr)) return res.status(400).json({ error: 'invalid BTC address' });
  try {
    cfg.payoutAddress = addr;
    if (poolName) cfg.poolName = String(poolName).slice(0, 32);
    if (typeof privateMode === 'boolean') cfg.privateMode = privateMode;
    await saveConfig(cfg);

    // write ckpool.conf so next ckpool restart uses the new address
    try {
      await fs.ensureDir(CKPOOL_CFG_DIR);
      const conf = {
        btcd: [{ url: BITCOIN_RPC_URL, auth: `${BITCOIN_RPC_USER}:${BITCOIN_RPC_PASS}`, notify: true }],
        btcaddress: cfg.payoutAddress,
        btcsig: cfg.poolName || 'SoloStrike',
        serverurl: [`0.0.0.0:${STRATUM_PORT}`, `0.0.0.0:${STRATUM_PORT_HOBBY}`],
        mindiff: 1,
        startdiff: 10000,
        maxdiff: 0,
        logdir: CKPOOL_LOG_DIR,
      };
      await fs.writeJson(CKPOOL_CONF, conf, { spaces: 2 });
    } catch (e) { console.log('ckpool.conf write failed (non-fatal):', e.message); }

    state.status = 'mining';
    broadcast({ type: 'CONFIG', data: { poolName: cfg.poolName || 'SoloStrike', privateMode: !!cfg.privateMode, hasAddress: !!cfg.payoutAddress } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function handleSettings(req, res) {
  const b = req.body || {};
  try {
    if (b.payoutAddress) {
      const addr = (b.payoutAddress || '').trim();
      if (!isValidBtcAddress(addr)) return res.status(400).json({ error: 'invalid BTC address' });
      cfg.payoutAddress = addr;
    }
    if (b.poolName) cfg.poolName = String(b.poolName).slice(0, 32);
    if (typeof b.privateMode === 'boolean') cfg.privateMode = b.privateMode;
    state.privateMode = !!cfg.privateMode;
    await saveConfig(cfg);
    broadcast({ type: 'CONFIG', data: { poolName: cfg.poolName || 'SoloStrike', privateMode: !!cfg.privateMode, hasAddress: !!cfg.payoutAddress } });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

app.post('/api/settings', handleSettings);
app.post('/api/config',   handleSettings);

// ── Boot sequence ────────────────────────────────────────────────────────────
let networkStatsController = null;

async function boot() {
  cfg = await loadConfig();
  const persist = await loadPersist();
  if (persist.closestCalls) state.closestCalls = persist.closestCalls;
  if (persist.blocks) state.blocks = persist.blocks;
  if (persist.snapshots) state.snapshots = persist.snapshots;
  if (persist.webhooks) state.webhooks = persist.webhooks;
  // v1.6.0: nostr identity + network-stats opt-in flag persist across restarts
  if (persist.nostrPrivkey) cfg.nostrPrivkey = persist.nostrPrivkey;
  if (persist.nostrInstallId) cfg.nostrInstallId = persist.nostrInstallId;
  if (typeof persist.networkStatsEnabled === 'boolean') cfg.networkStatsEnabled = persist.networkStatsEnabled;
  state.privateMode = !!cfg.privateMode;

  // Main polls
  setInterval(pollBitcoind, 15000);
  setInterval(pollMempool,  60000);
  setInterval(pollBlocks,   120000);
  setInterval(pollPrices,   300000);

  startZmq();
  pollBitcoind();
  pollBlocks();
  pollMempool();
  pollPrices();
  watchLogs();
  startUaTailer({ configDir: CONFIG_DIR, logDir: CKPOOL_LOG_DIR });
  startStatusPoller(state, broadcast, CKPOOL_LOG_DIR);
  startSnapshotScheduler({ state, snapshots: state.snapshots, configDir: CONFIG_DIR });
  startStratumHealthPoller();
  startBlockWatcher({ state, broadcast, fireHooks, savePersist, logDir: CKPOOL_LOG_DIR });
  startShareWatcher({ state, logDir: CKPOOL_LOG_DIR, savePersist, broadcast });
  networkStatsController = startNetworkStats({ state, cfg, savePersist });

  state.status = cfg.payoutAddress ? 'mining' : 'setup';
  const PORT = 3001;
  server.listen(PORT, () => console.log(`[SoloStrike API v${VERSION}] Listening on :${PORT} (privateMode=${cfg.privateMode})`));
}

boot();
