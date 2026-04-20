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

const VERSION = '1.3.3';

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

const RPC_HOST = process.env.BITCOIN_RPC_HOST || '10.21.21.8';
const RPC_PORT = process.env.BITCOIN_RPC_PORT || '8332';
const RPC_USER = process.env.BITCOIN_RPC_USER || 'umbrel';
const RPC_PASS = process.env.BITCOIN_RPC_PASS || null;

if (!RPC_PASS) {
  console.error('[SoloStrike API] FATAL: BITCOIN_RPC_PASS not set. Refusing to start.');
  process.exit(1);
}

const POOL_SIGNATURE      = process.env.POOL_SIGNATURE      || 'SoloStrike/';
const START_DIFFICULTY    = parseInt(process.env.START_DIFFICULTY    || '10000', 10);
const MIN_DIFFICULTY      = parseInt(process.env.MIN_DIFFICULTY      || '1',     10);
const MAX_DIFFICULTY      = parseInt(process.env.MAX_DIFFICULTY      || '0',     10);
const BLOCKPOLL           = parseInt(process.env.BLOCKPOLL           || '50',    10);
const UPDATE_INTERVAL     = parseInt(process.env.UPDATE_INTERVAL     || '20',    10);
const STRATUM_PORT        = parseInt(process.env.STRATUM_PORT        || '3333',  10);
const STRATUM_PORT_HOBBY  = parseInt(process.env.STRATUM_PORT_HOBBY  || '3334',  10);
const HOBBY_STARTDIFF     = parseInt(process.env.HOBBY_STARTDIFF     || '100',   10);
const ZMQ_HASHBLOCK       = process.env.BITCOIN_ZMQ_HASHBLOCK        || null;

const MEMPOOL_API_URL     = process.env.MEMPOOL_API_URL     || 'https://mempool.space/api';
const MEMPOOL_PUBLIC      = process.env.MEMPOOL_PUBLIC_URL  || 'https://mempool.space';
const LOCAL_MEMPOOL_URL   = process.env.LOCAL_MEMPOOL_API_URL || 'http://mempool_app_proxy_1:3006/api';

const SOLO_POOL_SLUGS = new Set([
  'unknown', 'solock', 'solo-ckpool', 'ckpool', 'public-pool',
  'solo', 'solopool', 'gobrrr', 'gobrrrpool', 'gobrrr-pool',
  'umbrel', 'umbrel-pool', 'solostrike', 'solo-bitcoin',
]);
function isSoloBlock(block) {
  if (!block?.extras?.pool) return false;
  const p = block.extras.pool;
  const slug = (p.slug || '').toLowerCase();
  const name = (p.name || '').toLowerCase();
  if (SOLO_POOL_SLUGS.has(slug)) return true;
  if (name.includes('solo') || name.includes('ckpool') || name.includes('unknown')) return true;
  return false;
}

// ── RPC with circuit breaker ─────────────────────────────────────────────────
const rpcBreaker = {
  consecutiveFailures: 0,
  nextAllowed: 0,
  nextBackoffMs: 5000,
};
function rpcOk() {
  rpcBreaker.consecutiveFailures = 0;
  rpcBreaker.nextBackoffMs = 5000;
  rpcBreaker.nextAllowed = 0;
}
function rpcFail() {
  rpcBreaker.consecutiveFailures += 1;
  if (rpcBreaker.consecutiveFailures >= 3) {
    const backoff = Math.min(5 * 60 * 1000, rpcBreaker.nextBackoffMs);
    rpcBreaker.nextAllowed = Date.now() + backoff;
    rpcBreaker.nextBackoffMs = Math.min(5 * 60 * 1000, rpcBreaker.nextBackoffMs * 2);
  }
}
async function rpc(method, params = []) {
  if (Date.now() < rpcBreaker.nextAllowed) return null;
  const auth = Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64');
  try {
    const res = await fetchWithTimeout(`http://${RPC_HOST}:${RPC_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'ss', method, params }),
      timeout: 5000,
    });
    if (!res.ok) { rpcFail(); return null; }
    const j = await res.json();
    rpcOk();
    return j.result;
  } catch (e) {
    rpcFail();
    if (rpcBreaker.consecutiveFailures <= 3) console.error(`[RPC] ${method} failed: ${e.message}`);
    return null;
  }
}

// ── State ────────────────────────────────────────────────────────────────────
let cfg = {
  payoutAddress: null,
  poolName: 'SoloStrike',
  privateMode: false,
  webhooks: [],
};

let state = {
  workers: {},
  hashrate: { current: 0, history: [], week: [], averages: {} },
  blocks: [],
  shares: { accepted: 0, rejected: 0, stale: 0, acceptedCount: 0, rejectedCount: 0, sps1m: 0 },
  network: { height: 0, difficulty: 0, hashrate: 0 },
  mempool: { feeRate: null, size: null, unconfirmedCount: null, totalFeesBtc: 0 },
  nodeInfo: { subversion: null, connected: false, peers: 0, peersIn: 0, peersOut: 0, relayFee: null, mempoolBytes: 0, mempoolCount: 0 },
  sync: { ibd: false, progress: 1, warn: false, headers: 0, blocks: 0 },
  retarget: null,
  netBlocks: [],
  prices: {},
  privateMode: false,
  localMempoolReachable: false,
  uptime: Date.now(),
  status: 'starting',
  bestshare: 0,
  totalWorkers: 0,
  totalUsers: 0,
  zmq: { enabled: false, endpoint: null, lastBlockHeardAt: null },
  _avgState: null,
  _workerLastStatus: {},
};

const PRIVATE   = () => cfg.privateMode === true;
const MEMPOOL_BASE = () => PRIVATE() ? LOCAL_MEMPOOL_URL : MEMPOOL_API_URL;

state.zmq.enabled  = !!ZMQ_HASHBLOCK;
state.zmq.endpoint = ZMQ_HASHBLOCK;
console.log(`[SoloStrike API v${VERSION}] booting. privateMode default: ${cfg.privateMode}, zmq: ${state.zmq.enabled ? 'enabled' : 'disabled'}`);

async function loadCfg() {
  try {
    await fs.ensureDir(CONFIG_DIR);
    if (await fs.pathExists(CONFIG_FILE)) {
      const loaded = await fs.readJson(CONFIG_FILE);
      cfg = { ...cfg, ...loaded };
      if (!Array.isArray(cfg.webhooks)) cfg.webhooks = [];
      if (typeof cfg.privateMode !== 'boolean') cfg.privateMode = false;
    }
    state.privateMode = cfg.privateMode;
    console.log(`[SoloStrike API] cfg loaded: privateMode=${cfg.privateMode}, webhooks=${cfg.webhooks.length}`);
  } catch (e) {
    console.error('[Cfg] load failed:', e.message);
  }
}
async function saveCfg() {
  try {
    await fs.ensureDir(CONFIG_DIR);
    await fs.writeJson(CONFIG_FILE, cfg, { spaces: 2 });
    state.privateMode = cfg.privateMode;
  } catch (e) { console.error('[Cfg] save failed:', e.message); }
}

async function loadPersist() {
  try {
    if (await fs.pathExists(PERSIST_FILE)) {
      const p = await fs.readJson(PERSIST_FILE);
      if (Array.isArray(p.blocks))               state.blocks = p.blocks.slice(0, 50);
      if (p._avgState && typeof p._avgState === 'object') state._avgState = { ...p._avgState, lastTs: Date.now() };
      if (Array.isArray(p.history))              state.hashrate.history = p.history.slice(-1440);
      if (Array.isArray(p.week))                 state.hashrate.week    = p.week.slice(-10080);
      if (Number.isFinite(p.bestshareAll))       state.bestshare = Math.max(state.bestshare, p.bestshareAll);
      console.log(`[Persist] restored: ${state.blocks.length} blocks, ${state.hashrate.history.length} history points, ${state.hashrate.week.length} week points`);
    }
  } catch (e) { console.error('[Persist] load failed:', e.message); }
}
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    try {
      await fs.writeJson(PERSIST_FILE, {
        savedAt: Date.now(),
        version: VERSION,
        blocks: state.blocks,
        _avgState: state._avgState,
        history: state.hashrate.history,
        week: state.hashrate.week,
        bestshareAll: state.bestshare,
      });
    } catch (e) { console.error('[Persist] save failed:', e.message); }
  }, 5000);
}
setInterval(schedulePersist, 2 * 60 * 1000);

async function writeCkpoolConf(address) {
  const conf = {
    btcd: [{
      url: `http://${RPC_HOST}:${RPC_PORT}`,
      auth: RPC_USER, pass: RPC_PASS, notify: true,
    }],
    btcaddress: address, btcsig: POOL_SIGNATURE,
    blockpoll: BLOCKPOLL, nonce1length: 4, nonce2length: 8,
    update_interval: UPDATE_INTERVAL, version_mask: '1fffe000',
    logdir: '/var/log/ckpool',
    serverurl: [
      `0.0.0.0:${STRATUM_PORT}`,         // 3333 — ASIC port (S19/S21, Whatsminer)
      `0.0.0.0:${STRATUM_PORT_HOBBY}`,   // 3334 — Hobby port (BitAxe, NerdQaxe++)
    ],
    mindiff: MIN_DIFFICULTY,
    startdiff: START_DIFFICULTY,
    maxdiff: MAX_DIFFICULTY,
    solo: true,
  };
  if (ZMQ_HASHBLOCK) conf.zmqblock = ZMQ_HASHBLOCK;
  await fs.ensureDir(CKPOOL_CFG_DIR);
  await fs.writeJson(CKPOOL_CONF, conf, { spaces: 2 });
  console.log(`[API] ckpool config written (ports ${STRATUM_PORT}/${STRATUM_PORT_HOBBY}, startdiff=${START_DIFFICULTY}, mindiff=${MIN_DIFFICULTY}, zmq=${ZMQ_HASHBLOCK ? 'on' : 'off'}) address=${address}`);
}

// ── Block detection — multiple patterns for ckpool format tolerance ─────────
const BLOCK_PATTERNS = [
  /BLOCK FOUND.*height[:\s]+(\d+).*hash[:\s]+([a-f0-9]+)/i,
  /SOLVED.*height[:\s]+(\d+).*hash[:\s]+([a-f0-9]+)/i,
  /Block\s+(\d+)\s+.*found.*([a-f0-9]{64})/i,
  /block\s+(\d+)\s+confirmed.*([a-f0-9]{64})/i,
];
const seenBlocks = new Set();
function parseLine(line) {
  for (const pat of BLOCK_PATTERNS) {
    const m = line.match(pat);
    if (m) {
      const height = parseInt(m[1], 10);
      const hash = m[2].toLowerCase();
      const dedupeKey = `${height}:${hash}`;
      if (seenBlocks.has(dedupeKey)) return;
      seenBlocks.add(dedupeKey);
      if (seenBlocks.size > 500) {
        const arr = Array.from(seenBlocks).slice(-200);
        seenBlocks.clear();
        arr.forEach(k => seenBlocks.add(k));
      }
      const b = { height, hash, ts: Date.now() };
      state.blocks.unshift(b);
      if (state.blocks.length > 50) state.blocks.pop();
      state.zmq.lastBlockHeardAt = Date.now();
      broadcast({ type: 'BLOCK_FOUND', data: b });
      triggerWebhooks('block_found', b);
      schedulePersist();
      console.log(`[BLOCK] Found #${height} ${hash}`);
      return;
    }
  }
}

function watchLogs() {
  const logFile = path.join(CKPOOL_LOG_DIR, 'ckpool.log');
  let fileSize = 0;
  const read = async () => {
    try {
      const stat = await fs.stat(logFile).catch(() => null);
      if (!stat) return;
      if (stat.size < fileSize) fileSize = 0;
      if (stat.size <= fileSize) return;
      const buf = Buffer.alloc(stat.size - fileSize);
      const fd  = await fs.open(logFile, 'r');
      try { await fs.read(fd, buf, 0, buf.length, fileSize); }
      finally { await fs.close(fd); }
      fileSize = stat.size;
      buf.toString('utf8').split('\n').forEach(l => l.trim() && parseLine(l));
    } catch (e) { console.error('[LogWatch]', e.message); }
  };
  chokidar.watch(logFile, { usePolling: true, interval: 1000 }).on('change', read).on('add', read);
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  Object.values(state.workers).forEach(w => {
    const prev = state._workerLastStatus[w.name];
    const nowStatus = w.lastSeen < cutoff ? 'offline' : 'online';
    w.status = nowStatus;
    if (prev && prev !== nowStatus) {
      if (nowStatus === 'offline') {
        broadcast({ type: 'WORKER_OFFLINE', data: { name: w.name, lastSeen: w.lastSeen } });
        triggerWebhooks('worker_offline', { name: w.name, lastSeen: w.lastSeen });
      } else {
        broadcast({ type: 'WORKER_ONLINE', data: { name: w.name, hashrate: w.hashrate } });
        triggerWebhooks('worker_online', { name: w.name, hashrate: w.hashrate });
      }
    }
    state._workerLastStatus[w.name] = nowStatus;
  });
}, 30000);

async function pollNetwork() {
  const [chain, mining, netinfo, mempoolinfo] = await Promise.all([
    rpc('getblockchaininfo'),
    rpc('getmininginfo'),
    rpc('getnetworkinfo'),
    rpc('getmempoolinfo'),
  ]);
  if (chain)  {
    state.network.height = chain.blocks;
    state.network.difficulty = chain.difficulty;
    state.sync.ibd      = !!chain.initialblockdownload;
    state.sync.progress = chain.verificationprogress != null ? chain.verificationprogress : 1;
    state.sync.headers  = chain.headers || 0;
    state.sync.blocks   = chain.blocks  || 0;
    state.sync.warn = state.sync.ibd
      || (state.sync.headers - state.sync.blocks > 200)
      || (state.sync.progress < 0.9999);
  }
  if (mining) { state.network.hashrate = mining.networkhashps; }
  if (netinfo) {
    state.nodeInfo.subversion  = netinfo.subversion || null;
    state.nodeInfo.connected   = true;
    state.nodeInfo.peers       = netinfo.connections || 0;
    state.nodeInfo.peersIn     = netinfo.connections_in || 0;
    state.nodeInfo.peersOut    = netinfo.connections_out || 0;
    state.nodeInfo.relayFee    = netinfo.relayfee || null;
  } else {
    state.nodeInfo.connected = false;
  }
  if (mempoolinfo) {
    state.nodeInfo.mempoolBytes = mempoolinfo.bytes || 0;
    state.nodeInfo.mempoolCount = mempoolinfo.size || 0;
  }
}
setInterval(pollNetwork, 15000);

async function pollMempool() {
  const url = MEMPOOL_BASE();
  if (!url) return;
  try {
    const [feesRes, mempoolRes, diffRes, blocksRes] = await Promise.all([
      fetchWithTimeout(`${url}/v1/fees/recommended`,     { timeout: 6000 }).catch(() => null),
      fetchWithTimeout(`${url}/mempool`,                  { timeout: 6000 }).catch(() => null),
      fetchWithTimeout(`${url}/v1/difficulty-adjustment`, { timeout: 6000 }).catch(() => null),
      fetchWithTimeout(`${url}/v1/blocks`,                { timeout: 8000 }).catch(() => null),
    ]);

    const anyOk = [feesRes, mempoolRes, diffRes, blocksRes].some(r => r && r.ok);
    if (PRIVATE()) state.localMempoolReachable = anyOk;

    if (feesRes && feesRes.ok) {
      const fees = await feesRes.json();
      state.mempool.feeRate = fees.fastestFee || null;
    }
    if (mempoolRes && mempoolRes.ok) {
      const mp = await mempoolRes.json();
      state.mempool.size             = mp.vsize || null;
      state.mempool.unconfirmedCount = mp.count || null;
      if (mp.total_fee != null) state.mempool.totalFeesBtc = mp.total_fee / 1e8;
    }
    if (diffRes && diffRes.ok) {
      const d = await diffRes.json();
      state.retarget = {
        progressPercent:       d.progressPercent,
        difficultyChange:      d.difficultyChange,
        remainingBlocks:       d.remainingBlocks,
        remainingTime:         d.remainingTime,
        estimatedRetargetDate: d.estimatedRetargetDate,
        nextRetargetHeight:    d.nextRetargetHeight,
      };
    }
    if (blocksRes && blocksRes.ok) {
      const blocks = await blocksRes.json();
      const prevTopHeight = state.netBlocks?.[0]?.height || 0;
      state.netBlocks = (blocks || []).slice(0, 20).map(b => ({
        height:    b.height,  id: b.id, timestamp: b.timestamp,
        tx_count:  b.tx_count, size: b.size,
        pool:      b?.extras?.pool?.name || 'Unknown',
        poolSlug:  b?.extras?.pool?.slug || 'unknown',
        reward:    b?.extras?.reward,
        fees:      b?.extras?.totalFees,
        isSolo:    isSoloBlock(b),
      }));
      const newTopHeight = state.netBlocks?.[0]?.height || 0;
      if (newTopHeight > prevTopHeight && prevTopHeight > 0) {
        state.zmq.lastBlockHeardAt = Date.now();
      }
    }
  } catch (e) {
    console.error('[Mempool]', e.message);
    if (PRIVATE()) state.localMempoolReachable = false;
  }
}
setInterval(pollMempool, 30000);

async function pollPrices() {
  if (PRIVATE()) { state.prices = {}; return; }
  try {
    const res = await fetchWithTimeout(`${MEMPOOL_PUBLIC}/api/v1/prices`, { timeout: 6000 });
    if (!res.ok) return;
    const p = await res.json();
    state.prices = p || {};
  } catch {}
}
setInterval(pollPrices, 60000);

// ── Webhooks — parallel dispatch with 3-attempt retry ────────────────────────
async function deliverOne(h, body, event, attempt = 1) {
  try {
    const r = await fetchWithTimeout(h.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': `SoloStrike/${VERSION}` },
      body,
      timeout: 5000,
    });
    if (!r.ok && r.status >= 500 && attempt < 3) {
      const delay = 2000 * attempt;
      setTimeout(() => deliverOne(h, body, event, attempt + 1), delay);
    }
  } catch (e) {
    if (attempt < 3) {
      const delay = 2000 * attempt;
      setTimeout(() => deliverOne(h, body, event, attempt + 1), delay);
    } else {
      console.error(`[Webhook] ${h.name || h.url} (${event}) failed after 3 attempts: ${e.message}`);
    }
  }
}
function triggerWebhooks(event, payload) {
  const hooks = (cfg.webhooks || []).filter(h => h.enabled !== false && Array.isArray(h.events) && h.events.includes(event));
  if (!hooks.length) return;
  const body = JSON.stringify({ event, at: new Date().toISOString(), source: 'solostrike', payload });
  hooks.forEach(h => {
    if (typeof h.url !== 'string' || !/^https?:\/\//i.test(h.url)) return;
    deliverOne(h, body, event);
  });
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) { try { c.send(data); } catch {} } });
}
setInterval(() => {
  broadcast({ type: 'STATE_UPDATE', data: transformState(state) });
}, 5000);

function heartbeat() { this.isAlive = true; }
wss.on('connection', (ws, req) => {
  if (wss.clients.size > MAX_WS_CLIENTS) {
    ws.close(1008, 'too many connections');
    return;
  }
  ws.isAlive = true;
  ws.on('pong', heartbeat);
  try {
    ws.send(JSON.stringify({ type: 'STATE_UPDATE', data: transformState(state) }));
    ws.send(JSON.stringify({ type: 'CONFIG',       data: cfgPublic() }));
  } catch {}
});
setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  });
}, 30000);

const rateBuckets = new Map();
function rateLimit(req, res, next) {
  const key = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const bucket = rateBuckets.get(key) || { tokens: 60, last: now };
  const refill = ((now - bucket.last) / 60000) * 60;
  bucket.tokens = Math.min(60, bucket.tokens + refill);
  bucket.last = now;
  if (bucket.tokens < 1) {
    res.setHeader('Retry-After', '30');
    return res.status(429).json({ error: 'rate limited' });
  }
  bucket.tokens -= 1;
  rateBuckets.set(key, bucket);
  next();
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of rateBuckets) if (v.last < cutoff) rateBuckets.delete(k);
}, 5 * 60 * 1000);

function cfgPublic() {
  return {
    payoutAddress: cfg.payoutAddress,
    poolName:      cfg.poolName,
    privateMode:   cfg.privateMode,
    webhooks:      (cfg.webhooks || []).map(h => ({ id: h.id, name: h.name, url: h.url, events: h.events, enabled: h.enabled !== false })),
  };
}

// ==============================================================================
// REST
// ==============================================================================
app.get('/api/state',  (req, res) => res.json(transformState(state)));
app.get('/api/config', (req, res) => res.json(cfgPublic()));
app.get('/api/health', (req, res) => res.json({
  ok: true,
  uptime: Date.now() - state.uptime,
  version: VERSION,
  privateMode: cfg.privateMode,
  nodeConnected: state.nodeInfo.connected,
  workersOnline: Object.values(state.workers).filter(w => w.status !== 'offline').length,
  blocksFound: state.blocks.length,
  zmq: state.zmq,
}));
app.get('/api/prices', (req, res) => res.json(state.prices || {}));

app.get('/api/public/summary', rateLimit, (req, res) => {
  const s = transformState(state);
  res.json({
    poolHashrate:    s.hashrate?.current || 0,
    networkHashrate: s.network?.hashrate || 0,
    workers:         s.totalWorkers,
    accepted:        s.shares?.accepted || 0,
    rejected:        s.shares?.rejected || 0,
    bestshare:       s.bestshare,
    blocksFound:     (s.blocks || []).length,
    odds:            s.odds,
    luck:            s.luck,
  });
});
app.get('/api/public/workers', rateLimit, (req, res) => {
  const s = transformState(state);
  res.json((s.workers || []).map(w => ({
    name: w.name, hashrate: w.hashrate, status: w.status, bestshare: w.bestshare,
    minerType: w.minerType, diff: w.diff, health: w.health, lastShare: w.lastSeen,
  })));
});

app.get('/metrics', (req, res) => {
  const s = transformState(state);
  const lines = [];
  const add = (name, help, type, value) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name} ${Number.isFinite(value) ? value : 0}`);
  };
  add('solostrike_pool_hashrate_hps',        'Current pool hashrate in H/s',                   'gauge',   s.hashrate?.current || 0);
  add('solostrike_network_hashrate_hps',     'Current Bitcoin network hashrate in H/s',        'gauge',   s.network?.hashrate || 0);
  add('solostrike_network_difficulty',       'Current network difficulty',                      'gauge',   s.network?.difficulty || 0);
  add('solostrike_network_height',           'Current network block height',                    'gauge',   s.network?.height || 0);
  add('solostrike_workers_total',            'Total configured workers',                        'gauge',   (s.workers || []).length);
  add('solostrike_workers_online',           'Workers with status online',                      'gauge',   (s.workers || []).filter(w => w.status !== 'offline').length);
  add('solostrike_shares_accepted_total',    'Cumulative diff-weighted work accepted',          'counter', s.shares?.accepted || 0);
  add('solostrike_shares_rejected_total',    'Cumulative diff-weighted work rejected',          'counter', s.shares?.rejected || 0);
  add('solostrike_blocks_found_total',       'Number of blocks found by this pool',             'counter', (s.blocks || []).length);
  add('solostrike_bestshare',                'Highest diff-weighted share ever submitted',      'gauge',   s.bestshare || 0);
  add('solostrike_odds_per_block',           'Probability this pool finds the next block',     'gauge',   s.odds?.perBlock || 0);
  add('solostrike_odds_per_day',             'Probability this pool finds a block in 24h',     'gauge',   s.odds?.perDay || 0);
  add('solostrike_luck_percent',             'Luck ratio vs expected (100 = on par)',          'gauge',   s.luck?.luck || 0);
  add('solostrike_node_peers',               'Bitcoin Core peer count',                         'gauge',   s.nodeInfo?.peers || 0);
  add('solostrike_node_connected',           '1 if Bitcoin Core RPC reachable',                 'gauge',   s.nodeInfo?.connected ? 1 : 0);
  add('solostrike_node_sync_progress',       'Bitcoin Core verificationprogress 0-1',           'gauge',   s.sync?.progress || 0);
  add('solostrike_node_sync_warn',           '1 if Bitcoin Core not fully synced',              'gauge',   s.sync?.warn ? 1 : 0);
  add('solostrike_mempool_txs',              'Mempool transaction count',                       'gauge',   s.nodeInfo?.mempoolCount || 0);
  add('solostrike_mempool_bytes',            'Mempool size in bytes',                           'gauge',   s.nodeInfo?.mempoolBytes || 0);
  add('solostrike_zmq_enabled',              '1 if ZMQ hashblock notifications configured',     'gauge',   s.zmq?.enabled ? 1 : 0);
  (s.workers || []).forEach(w => {
    const safe = (w.name || '').replace(/[^a-zA-Z0-9_.]/g, '_');
    lines.push(`solostrike_worker_hashrate_hps{worker="${safe}",miner="${w.minerType || 'Unknown'}"} ${w.hashrate || 0}`);
    lines.push(`solostrike_worker_online{worker="${safe}"} ${w.status === 'offline' ? 0 : 1}`);
    lines.push(`solostrike_worker_bestshare{worker="${safe}"} ${w.bestshare || 0}`);
  });
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});

app.get('/api/webhooks', (req, res) => {
  res.json((cfg.webhooks || []).map(h => ({ id: h.id, name: h.name, url: h.url, events: h.events, enabled: h.enabled !== false })));
});
app.post('/api/webhooks', async (req, res) => {
  const { name, url, events } = req.body || {};
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'URL must start with http:// or https://' });
  }
  const allowed = ['block_found', 'worker_offline', 'worker_online'];
  const evs = Array.isArray(events) ? events.filter(e => allowed.includes(e)) : ['block_found'];
  const hook = {
    id: 'wh_' + Math.random().toString(36).slice(2, 10),
    name: (name || 'Webhook').toString().slice(0, 50),
    url: url.slice(0, 500),
    events: evs,
    enabled: true,
  };
  cfg.webhooks = [...(cfg.webhooks || []), hook];
  await saveCfg();
  broadcast({ type: 'CONFIG', data: cfgPublic() });
  res.json(hook);
});
app.delete('/api/webhooks/:id', async (req, res) => {
  cfg.webhooks = (cfg.webhooks || []).filter(h => h.id !== req.params.id);
  await saveCfg();
  broadcast({ type: 'CONFIG', data: cfgPublic() });
  res.json({ ok: true });
});

function sendCsv(res, filename, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(rowsToCsv(rows));
}

app.get('/api/export/workers.csv', rateLimit, (req, res) => {
  const s = transformState(state);
  const rows = [
    ['# generated_at_utc', new Date().toISOString()],
    ['# solostrike_version', VERSION],
    ['workername','miner_type','hashrate_hps','work_accepted','rejected','bestshare','difficulty','status','health','last_seen_iso'],
  ];
  (s.workers || []).forEach(w => {
    rows.push([
      w.name, w.minerType || '', w.hashrate || 0,
      Math.round(w.shares || 0), Math.round(w.rejected || 0),
      Math.round(w.bestshare || 0), w.diff || 0, w.status || '', w.health || '',
      new Date(w.lastSeen || 0).toISOString(),
    ]);
  });
  sendCsv(res, `solostrike-workers-${Date.now()}.csv`, rows);
});

app.get('/api/export/blocks.csv', rateLimit, (req, res) => {
  const rows = [
    ['# generated_at_utc', new Date().toISOString()],
    ['# solostrike_version', VERSION],
    ['height','hash','found_at_iso'],
  ];
  (state.blocks || []).forEach(b => {
    rows.push([b.height, b.hash, new Date(b.ts).toISOString()]);
  });
  sendCsv(res, `solostrike-blocks-${Date.now()}.csv`, rows);
});

app.post('/api/setup', async (req, res) => {
  const { payoutAddress, poolName } = req.body || {};
  if (!isValidBtcAddress(payoutAddress)) {
    return res.status(400).json({ error: 'Invalid Bitcoin address format. Expected bc1..., 1..., or 3...' });
  }
  cfg.payoutAddress = payoutAddress.trim();
  if (poolName && typeof poolName === 'string') cfg.poolName = poolName.trim().slice(0, 32);
  await saveCfg();
  await writeCkpoolConf(cfg.payoutAddress);
  state.status = 'starting';
  broadcast({ type: 'CONFIG', data: cfgPublic() });
  setTimeout(() => {
    state.status = 'mining';
    broadcast({ type: 'STATE_UPDATE', data: transformState(state) });
  }, 4000);
  res.json({ ok: true, cfg: cfgPublic() });
});

async function handleSettings(req, res) {
  try {
    const { payoutAddress, poolName, privateMode } = req.body || {};
    if (payoutAddress !== undefined && !isValidBtcAddress(payoutAddress)) {
      return res.status(400).json({ error: 'Invalid Bitcoin address format.' });
    }
    if (payoutAddress) cfg.payoutAddress = String(payoutAddress).trim();
    if (poolName && typeof poolName === 'string') cfg.poolName = poolName.trim().slice(0, 32);
    if (typeof privateMode === 'boolean') {
      cfg.privateMode = privateMode;
      if (privateMode) {
        state.prices = {};
        state.localMempoolReachable = false;
      }
      console.log(`[SoloStrike API] privateMode changed to ${privateMode}`);
    }
    await saveCfg();
    if (payoutAddress) await writeCkpoolConf(cfg.payoutAddress);
    broadcast({ type: 'CONFIG', data: cfgPublic() });
    pollMempool();
    pollPrices();
    res.json({ ok: true, cfg: cfgPublic() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
app.post('/api/settings', handleSettings);
app.post('/api/config',   handleSettings);

// ── Graceful shutdown ────────────────────────────────────────────────────────
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Shutdown] received ${signal}, flushing state…`);
  try {
    if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
    await fs.writeJson(PERSIST_FILE, {
      savedAt: Date.now(),
      version: VERSION,
      blocks: state.blocks,
      _avgState: state._avgState,
      history: state.hashrate.history,
      week: state.hashrate.week,
      bestshareAll: state.bestshare,
    });
    console.log('[Shutdown] state flushed to disk');
  } catch (e) {
    console.error('[Shutdown] flush failed:', e.message);
  }
  try {
    wss.clients.forEach(ws => { try { ws.close(1001, 'server shutting down'); } catch {} });
    server.close();
  } catch {}
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

async function boot() {
  await loadCfg();
  await loadPersist();
  if (cfg.payoutAddress) await writeCkpoolConf(cfg.payoutAddress);
  pollNetwork();
  pollMempool();
  pollPrices();
  watchLogs();
  startUaTailer({ configDir: CONFIG_DIR, logDir: CKPOOL_LOG_DIR });
  startStatusPoller(state, broadcast, CKPOOL_LOG_DIR);
  state.status = cfg.payoutAddress ? 'mining' : 'setup';
  const PORT = 3001;
  server.listen(PORT, () => console.log(`[SoloStrike API v${VERSION}] Listening on :${PORT} (privateMode=${cfg.privateMode})`));
}

boot();
