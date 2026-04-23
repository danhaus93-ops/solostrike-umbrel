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

const VERSION = '1.5.7';

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
const ZMQ_HASHBLOCK_URL = process.env.BITCOIN_ZMQ_HASHBLOCK || null;
const POOL_SIGNATURE = process.env.POOL_SIGNATURE || 'SoloStrike on Umbrel/';
const START_DIFFICULTY  = parseInt(process.env.START_DIFFICULTY || '10000', 10);
const MIN_DIFFICULTY    = parseInt(process.env.MIN_DIFFICULTY || '1', 10);
const MAX_DIFFICULTY    = parseInt(process.env.MAX_DIFFICULTY || '0', 10);
const BLOCKPOLL         = parseInt(process.env.BLOCKPOLL || '50', 10);
const UPDATE_INTERVAL   = parseInt(process.env.UPDATE_INTERVAL || '20', 10);
const STRATUM_PORT      = parseInt(process.env.STRATUM_PORT || '3333', 10);
const STRATUM_PORT_HOBBY= parseInt(process.env.STRATUM_PORT_HOBBY || '3334', 10);
const STRATUM_PORT_TLS  = parseInt(process.env.STRATUM_PORT_TLS || '4333', 10);

let bootTime = Date.now();

const state = {
  status: 'loading',
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

async function saveConfigDisk(cfg) {
  try { await fs.ensureDir(CONFIG_DIR); await fs.writeJson(CONFIG_FILE, cfg, { spaces: 2 }); }
  catch (e) { console.error('saveConfig failed:', e.message); }
}

async function loadPersist() {
  try {
    if (await fs.pathExists(PERSIST_FILE)) return await fs.readJson(PERSIST_FILE);
  } catch {}
  return {};
}
async function savePersist(obj) {
  try { await fs.ensureDir(CONFIG_DIR); await fs.writeJson(PERSIST_FILE, obj, { spaces: 2 }); }
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
});

function rateLimitFactory(maxPerMin = 60) {
  const buckets = new Map();
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || (now - b.t) > 60000) { b = { c:0, t:now }; buckets.set(ip, b); }
    b.c++;
    if (b.c > maxPerMin) return res.status(429).json({ error: 'rate_limit' });
    next();
  };
}
const rateLimit = rateLimitFactory(60);

// ── RPC helpers ──────────────────────────────────────────────────────────────
async function btcRpc(method, params = []) {
  if (!RPC_USER || !RPC_PASS) return null;
  try {
    const r = await fetchWithTimeout(`http://${RPC_HOST}:${RPC_PORT}/`, {
      method: 'POST',
      headers: {
        'authorization': 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc:'1.0', id:'ss', method, params }),
      timeout: 8000,
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.result;
  } catch (e) { return null; }
}

async function pollBitcoind() {
  try {
    // Update API uptime (v1.5.5+) — bootTime is a timestamp; UI formats it.
    state.uptime = bootTime;

    const info = await btcRpc('getblockchaininfo');
    if (!info) {
      state.nodeInfo = { connected: false, subversion: '', peers: 0, peersIn: 0, peersOut: 0, relayFee: 0, mempoolCount: 0, mempoolBytes: 0 };
      state.sync = null;
      return;
    }
    state.bitcoind.synced = info.initialblockdownload === false;
    state.bitcoind.progress = info.verificationprogress || 0;
    state.network.height = info.blocks || 0;
    state.network.difficulty = info.difficulty || 0;

    // Difficulty retarget (v1.5.6+) — compute epoch progress + estimated change
    const epochProgress   = (info.blocks || 0) % 2016;
    const remainingBlocks = 2016 - epochProgress;
    let difficultyChange = 0;
    try {
      if (epochProgress > 0) {
        const epochStartHeight = (info.blocks || 0) - epochProgress;
        const startHash  = await btcRpc('getblockhash', [epochStartHeight]);
        const startBlock = startHash ? await btcRpc('getblockheader', [startHash]) : null;
        const currTime   = info.mediantime || Math.floor(Date.now()/1000);
        if (startBlock && startBlock.time) {
          const actualSec = currTime - startBlock.time;
          const idealSec  = epochProgress * 600;
          if (actualSec > 0) {
            difficultyChange = ((idealSec / actualSec) - 1) * 100;
            difficultyChange = Math.max(-75, Math.min(300, difficultyChange));
          }
        }
      }
    } catch (e) {}
    state.retarget = {
      progressPercent: (epochProgress / 2016) * 100,
      difficultyChange,
      remainingBlocks,
      remainingTime: remainingBlocks * 600 * 1000,
    };

    // Sync status for UPTIME/STABILITY banner (v1.5.5+)
    const headers   = info.headers || info.blocks || 0;
    const blocksN   = info.blocks || 0;
    const progress  = info.verificationprogress || 0;
    const behind    = Math.max(0, headers - blocksN);
    const warn      = !state.bitcoind.synced || behind > 0 || progress < 0.9999;
    state.sync = {
      synced: state.bitcoind.synced,
      progress,
      headers,
      blocks: blocksN,
      behind,
      warn,
    };

    const hashinfo = await btcRpc('getnetworkhashps', []);
    if (hashinfo) state.network.hashrate = hashinfo;

    // Node info for Bitcoin Node panel (v1.5.5+)
    const netinfo   = await btcRpc('getnetworkinfo') || {};
    const meminfo   = await btcRpc('getmempoolinfo') || {};
    const peerinfo  = await btcRpc('getpeerinfo')   || [];
    state.nodeInfo = {
      connected: true,
      subversion: netinfo.subversion || '',
      peers: Array.isArray(peerinfo) ? peerinfo.length : 0,
      peersIn:  Array.isArray(peerinfo) ? peerinfo.filter(p => p.inbound).length  : 0,
      peersOut: Array.isArray(peerinfo) ? peerinfo.filter(p => !p.inbound).length : 0,
      relayFee: netinfo.relayfee || 0,
      mempoolCount: meminfo.size || 0,
      mempoolBytes: meminfo.bytes || 0,
    };

    // Latest block
    const lbHash = info.bestblockhash;
    if (lbHash) {
      const b = await btcRpc('getblock', [lbHash, 1]);
      if (b) {
        const coinbaseHash = b.tx && b.tx[0];
        let miner = 'unknown', reward = 0;
        if (coinbaseHash) {
          const cb = await btcRpc('getrawtransaction', [coinbaseHash, true, lbHash]);
          if (cb) {
            reward = cb.vout?.reduce((s,v) => s + (v.value||0), 0) || 0;
            const coinbaseScript = cb.vin?.[0]?.coinbase || '';
            miner = identifyMiner(coinbaseScript);
          }
        }
        state.latestBlock = {
          height: b.height,
          hash: b.hash,
          timestamp: (b.time || 0) * 1000,
          miner,
          reward,
        };
      }
    }
  } catch (e) {
    state.nodeInfo = { connected: false, subversion: '', peers: 0, peersIn: 0, peersOut: 0, relayFee: 0, mempoolCount: 0, mempoolBytes: 0 };
  }
}

function identifyMiner(coinbaseHex) {
  if (!coinbaseHex) return 'unknown';
  try {
    const ascii = Buffer.from(coinbaseHex, 'hex').toString('ascii');
    const sigs = [
      [/Foundry USA/i, 'Foundry USA'],
      [/AntPool/i, 'AntPool'],
      [/F2Pool|f2pool/i, 'F2Pool'],
      [/ViaBTC/i, 'ViaBTC'],
      [/Binance/i, 'Binance Pool'],
      [/Luxor/i, 'Luxor'],
      [/SBICrypto/i, 'SBI Crypto'],
      [/SpiderPool/i, 'SpiderPool'],
      [/Braiins|SlushPool/i, 'Braiins'],
      [/MARA/i, 'MARA Pool'],
      [/OCEAN/i, 'OCEAN'],
      [/Public-Pool/i, 'Public Pool'],
      [/SoloStrike/i, 'SoloStrike'],
      [/Bassin/i, 'Bassin'],
      [/NiceHash/i, 'NiceHash'],
      [/secpool/i, 'SECPool'],
      [/WhitePool/i, 'WhitePool'],
      [/ULTIMUSPOOL/i, 'Ultimus'],
      [/CKPool|ckpool/i, 'CKPool'],
    ];
    for (const [re, name] of sigs) { if (re.test(ascii)) return name; }
    return 'unknown';
  } catch { return 'unknown'; }
}

async function pollMempool() {
  if (cfg.privateMode) return;
  try {
    const r = await fetchWithTimeout('https://mempool.space/api/mempool', { timeout: 6000 });
    if (!r.ok) return;
    const j = await r.json();
    state.mempool.count = j.count || 0;
    state.mempool.feeRate = j.total_fee && j.count ? (j.total_fee / j.count) : 0;

    const fr = await fetchWithTimeout('https://mempool.space/api/v1/fees/recommended', { timeout: 6000 });
    if (fr.ok) {
      const fj = await fr.json();
      if (fj.halfHourFee) state.mempool.feeRate = fj.halfHourFee;
    }

    // Total fees expected in next block (v1.5.7+) — for accurate block prize calc
    const mb = await fetchWithTimeout('https://mempool.space/api/v1/fees/mempool-blocks', { timeout: 6000 });
    if (mb.ok) {
      const arr = await mb.json();
      if (Array.isArray(arr) && arr[0]) {
        // totalFees is in sats, convert to BTC
        state.mempool.totalFeesBtc = (arr[0].totalFees || 0) / 1e8;
      }
    }
  } catch {}
}

async function pollBlocks() {
  if (cfg.privateMode) return;
  try {
    const r = await fetchWithTimeout('https://mempool.space/api/v1/blocks', { timeout: 6000 });
    if (!r.ok) return;
    const arr = await r.json();
    if (!Array.isArray(arr)) return;
    const SOLO_SIGNATURES = [
      /Solo/i, /^SoloStrike/i, /Mario Nano/i, /Ckpool/i, /ckpool-solo/i, /OrangeSurf/i,
    ];
    state.netBlocks = arr.slice(0, 30).map(b => {
      const pool = b.extras?.pool?.name || 'unknown';
      const isSolo = SOLO_SIGNATURES.some(re => re.test(pool));
      return {
        height: b.height,
        timestamp: (b.timestamp || 0),
        pool,
        id: b.id,
        tx_count: b.tx_count,
        reward: b.extras?.reward,
        isSolo,
      };
    });
    const counts = {};
    state.netBlocks.forEach(b => { counts[b.pool] = (counts[b.pool]||0)+1; });
    const total = state.netBlocks.length;
    state.topFinders = Object.entries(counts)
      .map(([pool,count]) => ({ pool, count, pct: total ? (count/total)*100 : 0 }))
      .sort((a,b) => b.count - a.count)
      .slice(0, 8);
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

// ── Log watcher ──────────────────────────────────────────────────────────────
function watchLogs() {
  if (!fs.existsSync(CKPOOL_LOG_DIR)) {
    console.warn('[logs] ckpool log dir does not exist:', CKPOOL_LOG_DIR);
    return;
  }
  const watcher = chokidar.watch(path.join(CKPOOL_LOG_DIR, '*.log'), {
    persistent: true, ignoreInitial: true, usePolling: false,
  });
  watcher.on('add', (p) => console.log('[logs] new file', p));
}

// ── Webhooks ─────────────────────────────────────────────────────────────────
async function fireWebhook(hook, event, payload) {
  try {
    await fetchWithTimeout(hook.url, {
      method: 'POST',
      headers: {'content-type':'application/json'},
      body: JSON.stringify({ event, pool: cfg.poolName||'SoloStrike', at: Date.now(), ...payload }),
      timeout: 5000,
    });
  } catch {}
}
function fireHooks(event, payload) {
  (state.webhooks||[]).forEach(h => {
    if (h.events && h.events.includes(event)) fireWebhook(h, event, payload);
  });
}

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
    hashrate: s.hashrate?.current || 0,
    workers: s.totalWorkers || 0,
    blocks: (s.blocks||[]).length,
    bestShare: s.bestshare || 0,
  });
});

app.get('/api/public/workers', rateLimit, (req, res) => {
  const s = transformState(state);
  res.json({ workers: (s.workers||[]).map(w => ({
    name: w.name,
    alias: w.alias,
    hashrate1m: w.hashrate1m,
    shares: w.shares,
    bestShare: w.bestShare,
  }))});
});

app.get('/api/widget/four-stats', (req, res) => {
  const formatHashrate = (hps) => {
    if (!hps || hps < 0 || !Number.isFinite(hps)) return { text: '0', subtext: 'H/s' };
    const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
    let rate = hps, i = 0;
    while (rate >= 1000 && i < units.length - 1) { rate /= 1000; i++; }
    return { text: rate.toFixed(2), subtext: units[i] };
  };
  const formatCompact = (n) => {
    if (!n || n < 0 || !Number.isFinite(n)) return '0';
    if (n < 1000) return Math.round(n).toString();
    if (n < 1e6) return (n / 1e3).toFixed(1) + 'K';
    if (n < 1e9) return (n / 1e6).toFixed(1) + 'M';
    if (n < 1e12) return (n / 1e9).toFixed(1) + 'B';
    return (n / 1e12).toFixed(1) + 'T';
  };
  try {
    const s = transformState(state);
    const hr = formatHashrate(s.hashrate?.current || 0);
    res.json({
      type: 'four-stats',
      refresh: '10s',
      items: [
        { title: 'Pool Hashrate', text: hr.text, subtext: hr.subtext },
        { title: 'Workers',       text: (s.totalWorkers || 0).toString() },
        { title: 'Blocks Found',  text: ((s.blocks || []).length).toString() },
        { title: 'Best Diff',     text: formatCompact(s.bestshare || 0) },
      ],
    });
  } catch (err) {
    res.json({
      type: 'four-stats',
      refresh: '10s',
      items: [
        { title: 'Pool Hashrate', text: '—', subtext: 'H/s' },
        { title: 'Workers',       text: '—' },
        { title: 'Blocks Found',  text: '—' },
        { title: 'Best Diff',     text: '—' },
      ],
    });
  }
});

// Live stratum port health (v1.5.4+)
app.get('/api/stratum-health', (req, res) => {
  res.json(getStratumHealth());
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
  if (op === 'add') {
    if (!url) return res.status(400).json({ error: 'url required' });
    const hook = { id: 'h_' + Date.now().toString(36), name: name || 'webhook', url, events: events || ['block_found'] };
    state.webhooks = [...(state.webhooks||[]), hook];
    await savePersist({ closestCalls: state.closestCalls, blocks: state.blocks, snapshots: state.snapshots, webhooks: state.webhooks });
  } else if (op === 'remove') {
    if (!id) return res.status(400).json({ error: 'id required' });
    state.webhooks = (state.webhooks||[]).filter(h => h.id !== id);
    await savePersist({ closestCalls: state.closestCalls, blocks: state.blocks, snapshots: state.snapshots, webhooks: state.webhooks });
  } else if (op === 'test') {
    const hook = (state.webhooks||[]).find(h => h.id === id);
    if (!hook) return res.status(404).json({ error: 'not_found' });
    fireWebhook(hook, 'test', { sample: true });
  } else {
    return res.status(400).json({ error: 'unknown_op' });
  }
  res.json({ hooks: (state.webhooks || []).map(h => ({ id:h.id, name:h.name, url:h.url, events:h.events })) });
});

// CSV exports
app.get('/api/export/workers.csv', rateLimit, (req, res) => {
  const s = transformState(state);
  const rows = (s.workers||[]).map(w => ({
    name: w.name,
    alias: w.alias || '',
    hashrate_1m: w.hashrate1m,
    hashrate_5m: w.hashrate5m,
    hashrate_1h: w.hashrate1h,
    hashrate_1d: w.hashrate1d,
    shares: w.shares,
    best_share: w.bestShare,
  }));
  res.set('content-type', 'text/csv').send(rowsToCsv(rows));
});
app.get('/api/export/blocks.csv', rateLimit, (req, res) => {
  const rows = (state.blocks||[]).map(b => ({
    height: b.height,
    miner: b.miner,
    miner_alias: b.minerAlias || '',
    timestamp: new Date(b.timestamp).toISOString(),
    hash: b.hash || '',
  }));
  res.set('content-type', 'text/csv').send(rowsToCsv(rows));
});
app.get('/api/export/snapshots.csv', rateLimit, (req, res) => {
  const rows = (state.snapshots?.daily || []).map(s => ({
    date: s.date,
    avg_hps: s.avg,
    peak_hps: s.peak,
    blocks: s.blocks || 0,
  }));
  res.set('content-type', 'text/csv').send(rowsToCsv(rows));
});

// Setup endpoint
app.post('/api/setup', async (req, res) => {
  const { payoutAddress, poolName, privateMode } = req.body || {};
  const addr = (payoutAddress || '').trim();
  if (!addr) return res.status(400).json({ error: 'address required' });
  if (!isValidBtcAddress(addr)) return res.status(400).json({ error: 'invalid btc address' });

  cfg.payoutAddress = addr;
  cfg.poolName = (poolName || 'SoloStrike').trim() || 'SoloStrike';
  if (privateMode !== undefined) cfg.privateMode = !!privateMode;
  state.privateMode = cfg.privateMode;

  await saveConfigDisk(cfg);

  try {
    await fs.ensureDir(CKPOOL_CFG_DIR);
    const ckConf = {
      btcsolo: true,
      donation: 'solo',
      btcaddress: cfg.payoutAddress,
      btcsig: POOL_SIGNATURE,
      serverurl: [`0.0.0.0:${STRATUM_PORT}`, `0.0.0.0:${STRATUM_PORT_HOBBY}`],
      mindiff: MIN_DIFFICULTY,
      startdiff: START_DIFFICULTY,
      maxdiff: MAX_DIFFICULTY,
      blockpoll: BLOCKPOLL,
      update_interval: UPDATE_INTERVAL,
      logdir: CKPOOL_LOG_DIR,
      proxy: false,
      loglevel: 5,
    };
    await fs.writeJson(CKPOOL_CONF, ckConf, { spaces: 2 });
  } catch (e) {
    console.error('failed to write ckpool.conf:', e.message);
  }

  state.status = 'mining';
  res.json({ ok: true });
});

const handleSettings = async (req, res) => {
  const b = req.body || {};
  if (b.payoutAddress) {
    const addr = (b.payoutAddress || '').trim();
    if (!isValidBtcAddress(addr)) return res.status(400).json({ error: 'invalid address' });
    cfg.payoutAddress = addr;
  }
  if (b.poolName !== undefined) cfg.poolName = (b.poolName || 'SoloStrike').trim() || 'SoloStrike';
  if (b.privateMode !== undefined) { cfg.privateMode = !!b.privateMode; state.privateMode = cfg.privateMode; }
  await saveConfigDisk(cfg);
  // Broadcast config change to all connected clients (v1.5.5+)
  broadcast({ type: 'CONFIG', data: { poolName: cfg.poolName || 'SoloStrike', privateMode: !!cfg.privateMode, hasAddress: !!cfg.payoutAddress } });
  res.json({ ok: true });
};
app.post('/api/settings', handleSettings);
app.post('/api/config',   handleSettings);

// ── Boot sequence ────────────────────────────────────────────────────────────
async function boot() {
  cfg = await loadConfig();
  const persist = await loadPersist();
  if (persist.closestCalls) state.closestCalls = persist.closestCalls;
  if (persist.blocks) state.blocks = persist.blocks;
  if (persist.snapshots) state.snapshots = persist.snapshots;
  if (persist.webhooks) state.webhooks = persist.webhooks;
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
  state.status = cfg.payoutAddress ? 'mining' : 'setup';
  const PORT = 3001;
  server.listen(PORT, () => console.log(`[SoloStrike API v${VERSION}] Listening on :${PORT} (privateMode=${cfg.privateMode})`));
}

boot();
