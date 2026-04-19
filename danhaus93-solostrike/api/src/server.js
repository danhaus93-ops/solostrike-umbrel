const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const cors      = require('cors');
const chokidar  = require('chokidar');
const fs        = require('fs-extra');
const path      = require('path');
const { startStatusPoller }             = require('./status-poller');
const { transformState }                = require('./state-transform');
const { isValidBtcAddress, rowsToCsv }  = require('./validators');

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
app.use(express.json({ limit: '16kb' }));
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

const CONFIG_DIR     = process.env.CONFIG_DIR        || '/app/config';
const CKPOOL_LOG_DIR = process.env.CKPOOL_LOG_DIR    || '/var/log/ckpool';
const CKPOOL_CFG_DIR = process.env.CKPOOL_CONFIG_DIR || '/etc/ckpool';
const CONFIG_FILE    = path.join(CONFIG_DIR, 'solostrike.json');
const CKPOOL_CONF    = path.join(CKPOOL_CFG_DIR, 'ckpool.conf');

const RPC_HOST = process.env.BITCOIN_RPC_HOST || '10.21.21.8';
const RPC_PORT = process.env.BITCOIN_RPC_PORT || '8332';
const RPC_USER = process.env.BITCOIN_RPC_USER || 'umbrel';
const RPC_PASS = process.env.BITCOIN_RPC_PASS || null;

if (!RPC_PASS) {
  console.error('[SoloStrike API] FATAL: BITCOIN_RPC_PASS not set. Refusing to start.');
  process.exit(1);
}

const POOL_SIGNATURE   = process.env.POOL_SIGNATURE   || 'SoloStrike/';
const START_DIFFICULTY = parseInt(process.env.START_DIFFICULTY || '10000', 10);
const MIN_DIFFICULTY   = parseInt(process.env.MIN_DIFFICULTY   || '1',     10);
const MAX_DIFFICULTY   = parseInt(process.env.MAX_DIFFICULTY   || '0',     10);
const BLOCKPOLL        = parseInt(process.env.BLOCKPOLL        || '50',    10);
const UPDATE_INTERVAL  = parseInt(process.env.UPDATE_INTERVAL  || '20',    10);
const STRATUM_PORT     = parseInt(process.env.STRATUM_PORT     || '3333',  10);
const ZMQ_HASHBLOCK    = process.env.BITCOIN_ZMQ_HASHBLOCK     || null;
const MEMPOOL_API_URL  = process.env.MEMPOOL_API_URL           || null;
const MEMPOOL_PUBLIC   = process.env.MEMPOOL_PUBLIC_URL        || 'https://mempool.space';

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

async function rpc(method, params = []) {
  const auth = Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64');
  try {
    const res = await fetchWithTimeout(`http://${RPC_HOST}:${RPC_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'ss', method, params }),
      timeout: 5000,
    });
    const j = await res.json();
    return j.result;
  } catch (e) {
    console.error(`[RPC] ${method} failed`);
    return null;
  }
}

let cfg = { payoutAddress: null, poolName: 'SoloStrike' };
let state = {
  workers: {},
  hashrate: { current: 0, history: [] },
  blocks: [],
  shares: { accepted: 0, rejected: 0, stale: 0, acceptedCount: 0, rejectedCount: 0 },
  network: { height: 0, difficulty: 0, hashrate: 0 },
  mempool: { feeRate: null, size: null, unconfirmedCount: null, totalFeesBtc: 0 },
  retarget: null,
  netBlocks: [],
  prices: {},
  uptime: Date.now(),
  status: 'starting',
  bestshare: 0,
  totalWorkers: 0,
  totalUsers: 0,
  _avgState: null,
};

async function loadCfg() {
  try {
    await fs.ensureDir(CONFIG_DIR);
    if (await fs.pathExists(CONFIG_FILE)) cfg = await fs.readJson(CONFIG_FILE);
  } catch {}
}
async function saveCfg() {
  await fs.ensureDir(CONFIG_DIR);
  await fs.writeJson(CONFIG_FILE, cfg, { spaces: 2 });
}

async function writeCkpoolConf(address) {
  const conf = {
    btcd: [{
      url: `http://${RPC_HOST}:${RPC_PORT}`,
      auth: RPC_USER, pass: RPC_PASS, notify: true,
    }],
    btcaddress: address, btcsig: POOL_SIGNATURE,
    blockpoll: BLOCKPOLL, nonce1length: 4, nonce2length: 8,
    update_interval: UPDATE_INTERVAL, version_mask: '1fffe000',
    logdir: '/var/log/ckpool', serverurl: [`0.0.0.0:${STRATUM_PORT}`],
    mindiff: MIN_DIFFICULTY, startdiff: START_DIFFICULTY, maxdiff: MAX_DIFFICULTY,
    solo: true,
  };
  if (ZMQ_HASHBLOCK) conf.zmqblock = ZMQ_HASHBLOCK;
  await fs.ensureDir(CKPOOL_CFG_DIR);
  await fs.writeJson(CKPOOL_CONF, conf, { spaces: 2 });
  console.log(`[API] ckpool config written (startdiff=${START_DIFFICULTY}, mindiff=${MIN_DIFFICULTY}, zmq=${ZMQ_HASHBLOCK ? 'on' : 'off'}) address=${address}`);
}

const RE_BLOCK = /BLOCK FOUND.*height[:\s]+(\d+).*hash[:\s]+([a-f0-9]+)/i;
function parseLine(line) {
  if (RE_BLOCK.test(line)) {
    const m = line.match(RE_BLOCK);
    const b = { height: parseInt(m[1]), hash: m[2], ts: Date.now() };
    state.blocks.unshift(b);
    if (state.blocks.length > 50) state.blocks.pop();
    broadcast({ type: 'BLOCK_FOUND', data: b });
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
    w.status = w.lastSeen < cutoff ? 'offline' : 'online';
  });
}, 30000);

async function pollNetwork() {
  const [chain, mining] = await Promise.all([rpc('getblockchaininfo'), rpc('getmininginfo')]);
  if (chain)  { state.network.height = chain.blocks; state.network.difficulty = chain.difficulty; }
  if (mining)   state.network.hashrate = mining.networkhashps;
}
setInterval(pollNetwork, 15000);

async function pollMempool() {
  if (!MEMPOOL_API_URL) return;
  try {
    const [feesRes, mempoolRes, diffRes, blocksRes] = await Promise.all([
      fetchWithTimeout(`${MEMPOOL_API_URL}/v1/fees/recommended`,      { timeout: 4000 }).catch(() => null),
      fetchWithTimeout(`${MEMPOOL_API_URL}/mempool`,                   { timeout: 4000 }).catch(() => null),
      fetchWithTimeout(`${MEMPOOL_API_URL}/v1/difficulty-adjustment`,  { timeout: 4000 }).catch(() => null),
      fetchWithTimeout(`${MEMPOOL_API_URL}/v1/blocks`,                 { timeout: 5000 }).catch(() => null),
    ]);

    if (feesRes && feesRes.ok) {
      const fees = await feesRes.json();
      state.mempool.feeRate = fees.fastestFee || null;
    }
    if (mempoolRes && mempoolRes.ok) {
      const mp = await mempoolRes.json();
      state.mempool.size             = mp.vsize || null;
      state.mempool.unconfirmedCount = mp.count || null;
      // total_fee is in sats when present; convert to BTC for convenience
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
      state.netBlocks = (blocks || []).slice(0, 20).map(b => ({
        height:    b.height,  id: b.id, timestamp: b.timestamp,
        tx_count:  b.tx_count, size: b.size,
        pool:      b?.extras?.pool?.name || 'Unknown',
        poolSlug:  b?.extras?.pool?.slug || 'unknown',
        reward:    b?.extras?.reward,
        fees:      b?.extras?.totalFees,
        isSolo:    isSoloBlock(b),
      }));
    }
  } catch {}
}
setInterval(pollMempool, 30000);

// BTC prices — fetched from mempool.space public endpoint, cached 60s
async function pollPrices() {
  try {
    const res = await fetchWithTimeout(`${MEMPOOL_PUBLIC}/api/v1/prices`, { timeout: 5000 });
    if (!res.ok) return;
    const p = await res.json();
    // Shape: { time: ..., USD: 61234, EUR: 56789, GBP: ..., CAD: ..., CHF: ..., AUD: ..., JPY: ... }
    state.prices = p || {};
  } catch {}
}
setInterval(pollPrices, 60000);

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}
setInterval(() => {
  broadcast({ type: 'STATE_UPDATE', data: transformState(state) });
}, 5000);

function heartbeat() { this.isAlive = true; }
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', heartbeat);
  ws.send(JSON.stringify({ type: 'STATE_UPDATE', data: transformState(state) }));
  ws.send(JSON.stringify({ type: 'CONFIG',       data: cfg }));
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

// ==============================================================================
// REST
// ==============================================================================
app.get('/api/state',  (req, res) => res.json(transformState(state)));
app.get('/api/config', (req, res) => res.json(cfg));
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: Date.now() - state.uptime, version: '1.2.2' }));
app.get('/api/prices', (req, res) => res.json(state.prices || {}));

app.get('/api/public/summary', rateLimit, (req, res) => {
  const s = transformState(state);
  res.json({
    poolHashrate:    s.hashrate?.current || 0,
    networkHashrate: s.network?.hashrate || 0,
    workers:         s.totalWorkers,
    accepted:        s.shares?.accepted || 0,
    acceptedCount:   s.shares?.acceptedCount || 0,
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
    minerType: w.minerType, diff: w.diff, health: w.health,
    sharesCount: w.sharesCount, rejectedCount: w.rejectedCount,
  })));
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
    ['# solostrike_version', '1.2.2'],
    ['workername','miner_type','hashrate_hps','shares_count','rejected_count','bestshare','difficulty','status','health','last_seen_iso'],
  ];
  (s.workers || []).forEach(w => {
    rows.push([
      w.name, w.minerType || '', w.hashrate || 0,
      w.sharesCount || 0, w.rejectedCount || 0,
      Math.round(w.bestshare || 0), w.diff || 0, w.status || '', w.health || '',
      new Date(w.lastSeen || 0).toISOString(),
    ]);
  });
  sendCsv(res, `solostrike-workers-${Date.now()}.csv`, rows);
});

app.get('/api/export/blocks.csv', rateLimit, (req, res) => {
  const rows = [
    ['# generated_at_utc', new Date().toISOString()],
    ['# solostrike_version', '1.2.2'],
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
  broadcast({ type: 'CONFIG', data: cfg });
  setTimeout(() => {
    state.status = 'mining';
    broadcast({ type: 'STATE_UPDATE', data: transformState(state) });
  }, 4000);
  res.json({ ok: true, cfg });
});

async function handleSettings(req, res) {
  try {
    const { payoutAddress, poolName } = req.body || {};
    if (payoutAddress !== undefined && !isValidBtcAddress(payoutAddress)) {
      return res.status(400).json({ error: 'Invalid Bitcoin address format.' });
    }
    if (payoutAddress) cfg.payoutAddress = String(payoutAddress).trim();
    if (poolName && typeof poolName === 'string') cfg.poolName = poolName.trim().slice(0, 32);
    await saveCfg();
    if (payoutAddress) await writeCkpoolConf(cfg.payoutAddress);
    broadcast({ type: 'CONFIG', data: cfg });
    res.json({ ok: true, cfg });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
app.post('/api/settings', handleSettings);
app.post('/api/config',   handleSettings);

async function boot() {
  await loadCfg();
  if (cfg.payoutAddress) await writeCkpoolConf(cfg.payoutAddress);
  pollNetwork();
  pollMempool();
  pollPrices();
  watchLogs();
  startStatusPoller(state, broadcast, CKPOOL_LOG_DIR);
  state.status = cfg.payoutAddress ? 'mining' : 'setup';
  const PORT = 3001;
  server.listen(PORT, () => console.log(`[SoloStrike API v1.2.2] Listening on :${PORT}`));
}

boot();
