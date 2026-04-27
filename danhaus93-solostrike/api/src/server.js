// SoloStrike API server (v1.6.0 — privacy-aware)
const fs = require('fs-extra');
const path = require('path');
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const { startStatusPoller }             = require('./status-poller');
const { startUaTailer }                 = require('./ua-tailer');
const { transformState }                = require('./state-transform');
const { isValidBtcAddress }             = require('./validators');
const {
  loadSnapshots,
  saveSnapshots,
  captureDailySnapshot,
  applyDailySnapshot,
  updateClosestCalls,
} = require('./snapshots');
const { startStratumHealthPoller, getStratumHealth } = require('./stratum-health');
const { startBlockWatcher } = require('./block-watcher');
const { startShareWatcher } = require('./share-watcher');
const { startNetworkStats } = require('./network-stats');

const PORT          = parseInt(process.env.PORT, 10) || 3001;
const CKPOOL_LOG_DIR = process.env.CKPOOL_LOG_DIR || '/var/log/ckpool';
const CONFIG_DIR     = process.env.CONFIG_DIR || '/app/config';
const CONFIG_FILE    = path.join(CONFIG_DIR, 'config.json');
const PERSIST_FILE   = path.join(CONFIG_DIR, 'persist.json');
const HOOKS_FILE     = path.join(CONFIG_DIR, 'webhooks.json');
const MAX_HOOKS      = 16;
const MAX_WS_CLIENTS = 100;

// Bitcoin Core RPC (private mode uses ONLY this)
const RPC_HOST = process.env.BITCOIN_RPC_HOST || '10.21.21.8';
const RPC_PORT = parseInt(process.env.BITCOIN_RPC_PORT || '8332', 10);
const RPC_USER = process.env.BITCOIN_RPC_USER || 'umbrel';
const RPC_PASS = process.env.BITCOIN_RPC_PASS || '';

// Internal Mempool app (private mode allowed)
const INTERNAL_MEMPOOL = process.env.UMBREL_INTERNAL_MEMPOOL_URL || '';
const ZMQ_HASHBLOCK_URL = process.env.BITCOIN_ZMQ_HASHBLOCK || null;

// Status output URL (only used when private mode is OFF)
const PUBLIC_FEES_URL    = 'https://mempool.space/api/v1/fees/recommended';
const PUBLIC_BLOCKS_URL  = 'https://mempool.space/api/v1/blocks';
const PUBLIC_PRICE_URL   = 'https://mempool.space/api/v1/prices';

let networkStatsController = null;

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  status: 'starting',
  payoutAddress: null,
  poolName: 'SoloStrike',
  privateMode: false,
  hashrate: { current: 0, history: [], week: [] },
  workers: {},
  network: { height: 0, difficulty: 0, hashrate: 0 },
  blockReward: { totalBtc: 0, base: 0, fees: 0 },
  mempool: { totalFeesBtc: 0, feeRate: null, feeFast: null, feeMid: null, feeLow: null },
  prices: {},
  blocks: [],
  netBlocks: [],
  topFinders: [],
  closestCalls: [],
  bestshare: 0,
  shares: { acceptedCount: 0, rejectedCount: 0, stale: 0, rejectReasons: {} },
  uptime: 0,
  startedAt: Date.now(),
  odds: { perBlock: 0, expectedDays: null, perDay: 0, perWeek: 0, perMonth: 0 },
  luck: { progress: 0, blocksExpected: 0, blocksFound: 0, luck: null },
  retarget: null,
  nodeInfo: null,
  zmq: null,
  sync: null,
  snapshots: { daily: [] },
  shareCounters: {},
  sharelogCursors: {},
  webhooks: [],
  shareStatsStartedAt: 0,
  version: '1.7.22',
  // Compose/manifest version — bump only when umbrel-app.yml or docker-compose.yml
  // change in ways that require Umbrel to re-read them. Soft updates leave this
  // untouched; hard updates bump this so the UI banner can prompt the user to
  // open Umbrel for the update.
  composeVersion: '1.7.10',
  // Update urgency — drives banner styling. 'normal' (amber), 'recommended' (cyan),
  // 'critical' (red). Set per release.
  urgency: 'normal',
  // Short release notes shown when user expands the update banner.
  // Keep concise — markdown-style bullets work fine, displayed as plain text.
  releaseNotes:
    "• NEW: Claim Jumpers + Gold Strikes combined into one card\n" +
    "• FIXED: Color scheme restored — warm amber palette, BTC orange icon, Chakra Petch font\n" +
    "• FIXED: Header no longer scrolls away (replaced sticky with proper app shell)\n" +
    "• FIXED: The Vein no longer cut off at bottom\n" +
    "• FIXED: The Crew + Near Strikes scroll properly inside their slot\n" +
    "• Goldfields list expanded to show more recent network winners",
};

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

// ── Config loaders ────────────────────────────────────────────────────────
async function loadConfig() {
  try {
    if (await fs.pathExists(CONFIG_FILE)) return await fs.readJson(CONFIG_FILE);
  } catch (e) { console.error('loadConfig failed:', e.message); }
  return {};
}
async function saveConfig() {
  try {
    await fs.ensureDir(CONFIG_DIR);
    await fs.writeJson(CONFIG_FILE, cfg, { spaces: 2 });
  } catch (e) { console.error('saveConfig failed:', e.message); }
}
async function loadPersist() {
  try {
    if (await fs.pathExists(PERSIST_FILE)) return await fs.readJson(PERSIST_FILE);
  } catch (e) { console.error('loadPersist failed:', e.message); }
  return {};
}
async function savePersist(obj) {
  try {
    await fs.ensureDir(CONFIG_DIR);
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
    poolName: cfg.poolName || 'SoloStrike',
    privateMode: !!cfg.privateMode,
    hasAddress: !!cfg.payoutAddress,
  };
}

// ── Webhooks ──────────────────────────────────────────────────────────────
async function loadHooks() {
  try {
    if (await fs.pathExists(HOOKS_FILE)) {
      const arr = await fs.readJson(HOOKS_FILE);
      if (Array.isArray(arr)) state.webhooks = arr.slice(0, MAX_HOOKS);
    }
  } catch (e) { console.error('loadHooks failed:', e.message); }
}
async function saveHooks() {
  try {
    await fs.ensureDir(CONFIG_DIR);
    await fs.writeJson(HOOKS_FILE, state.webhooks || [], { spaces: 2 });
  } catch (e) { console.error('saveHooks failed:', e.message); }
}
async function fireHooks(eventName, payload) {
  const hooks = (state.webhooks || []).filter(h => Array.isArray(h.events) && h.events.includes(eventName));
  for (const h of hooks) {
    try {
      const body = JSON.stringify({ event: eventName, ts: Date.now(), pool: cfg.poolName || 'SoloStrike', ...payload });
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 6000);
      const r = await fetch(h.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: c.signal,
      });
      clearTimeout(t);
      if (!r.ok) console.warn(`[webhook ${h.name}] ${eventName} -> ${r.status}`);
    } catch (e) { console.warn(`[webhook ${h.name}] ${eventName} failed: ${e.message}`); }
  }
}

// ── RPC + fetch helpers ───────────────────────────────────────────────────
async function rpc(method, params = []) {
  const url = `http://${RPC_HOST}:${RPC_PORT}/`;
  const body = JSON.stringify({ jsonrpc: '1.0', id: 'solostrike', method, params });
  const auth = 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64');
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 8000);
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body,
      signal: c.signal,
    });
  } finally { clearTimeout(t); }
  if (!r.ok) throw new Error(`RPC ${method} ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method} ${j.error.message}`);
  return j.result;
}

async function tryFetchJson(url, ms = 6000) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    const r = await fetch(url, { signal: c.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Pollers ───────────────────────────────────────────────────────────────
async function pollBitcoind() {
  try {
    const [info, mining, mempool, blockchain, networkInfo] = await Promise.all([
      rpc('getblockchaininfo'),
      rpc('getmininginfo'),
      rpc('getmempoolinfo'),
      rpc('getblockchaininfo'),
      rpc('getnetworkinfo').catch(()=>null),
    ]);
    state.network.height = info.blocks;
    state.network.difficulty = info.difficulty;
    state.network.hashrate = mining.networkhashps;

    state.nodeInfo = {
      connected: true,
      subversion: networkInfo?.subversion || '',
      peers: networkInfo?.connections || 0,
      peersIn: networkInfo?.connections_in || 0,
      peersOut: networkInfo?.connections_out || 0,
      relayFee: networkInfo?.relayfee || 0,
      mempoolCount: mempool.size || 0,
      mempoolBytes: mempool.bytes || 0,
    };

    const headers = blockchain.headers || 0;
    const blocks = blockchain.blocks || 0;
    const progress = blockchain.verificationprogress || 0;
    const behind = headers - blocks;
    state.sync = {
      blocks,
      headers,
      progress,
      warn: progress < 0.999 || behind > 5,
    };

    try {
      const tmpl = await rpc('getblocktemplate', [{ rules: ['segwit'] }]);
      const totalFees = (tmpl.transactions || []).reduce((s, t) => s + (t.fee || 0), 0);
      const blockSubsidy = tmpl.coinbasevalue - totalFees;
      state.blockReward = {
        totalBtc: tmpl.coinbasevalue / 1e8,
        base: blockSubsidy / 1e8,
        fees: totalFees / 1e8,
      };
    } catch (e) {}

    const myHr = state.hashrate.current || 0;
    const netHr = state.network.hashrate || 1;
    const blocksPerDay = 144;
    const odds = myHr / netHr;
    const expectedDaysPerBlock = odds > 0 ? (1 / odds) / blocksPerDay : null;
    const perBlockProbWithinDay = 1 - Math.exp(-odds * blocksPerDay);
    const perBlockProbWithinWeek = 1 - Math.exp(-odds * blocksPerDay * 7);
    const perBlockProbWithinMonth = 1 - Math.exp(-odds * blocksPerDay * 30);
    state.odds = {
      perBlock: odds,
      expectedDays: expectedDaysPerBlock,
      perDay: perBlockProbWithinDay,
      perWeek: perBlockProbWithinWeek,
      perMonth: perBlockProbWithinMonth,
    };

    if (state.startedAt) {
      const elapsedMs = Date.now() - state.startedAt;
      const blocksExpected = (myHr / netHr) * (elapsedMs / 600000);
      const blocksFound = (state.blocks || []).length;
      const luckPct = blocksExpected > 0 ? (blocksFound / blocksExpected) * 100 : null;
      const progress = (blocksExpected % 1) * 100;
      state.luck = {
        progress: blocksExpected < 1 ? blocksExpected * 100 : progress,
        blocksExpected,
        blocksFound,
        luck: luckPct,
      };
    }

    const retargetBlock = Math.floor(blocks / 2016) * 2016 + 2016;
    const remainingBlocks = retargetBlock - blocks;
    const retargetEpochStart = retargetBlock - 2016;
    try {
      const startBlockHash = await rpc('getblockhash', [retargetEpochStart]);
      const startBlock = await rpc('getblock', [startBlockHash]);
      const elapsedSec = (Date.now() / 1000) - startBlock.time;
      const blocksDoneInEpoch = blocks - retargetEpochStart;
      const expectedSecPerBlock = 600;
      const actualSecPerBlock = blocksDoneInEpoch > 0 ? elapsedSec / blocksDoneInEpoch : expectedSecPerBlock;
      const change = ((expectedSecPerBlock / actualSecPerBlock) - 1) * 100;
      const remainingTime = remainingBlocks * actualSecPerBlock * 1000;
      state.retarget = {
        progressPercent: (blocksDoneInEpoch / 2016) * 100,
        difficultyChange: -change,
        remainingBlocks,
        remainingTime,
      };
    } catch (e) {}

  } catch (e) {
    console.warn('pollBitcoind failed:', e.message);
    if (state.nodeInfo) state.nodeInfo.connected = false;
  }
}

async function pollMempool() {
  if (cfg.privateMode) {
    if (INTERNAL_MEMPOOL) {
      const fees = await tryFetchJson(`${INTERNAL_MEMPOOL}/api/v1/fees/recommended`);
      if (fees) {
        state.mempool.feeRate = fees.fastestFee || fees.halfHourFee || null;
        state.mempool.feeFast = fees.fastestFee || null;
        state.mempool.feeMid  = fees.halfHourFee || null;
        state.mempool.feeLow  = fees.hourFee || fees.economyFee || null;
        return;
      }
    }
    state.mempool.feeRate = null;
    state.mempool.feeFast = null;
    state.mempool.feeMid = null;
    state.mempool.feeLow = null;
    return;
  }
  const fees = await tryFetchJson(PUBLIC_FEES_URL);
  if (fees) {
    state.mempool.feeRate = fees.fastestFee || fees.halfHourFee || null;
    state.mempool.feeFast = fees.fastestFee || null;
    state.mempool.feeMid  = fees.halfHourFee || null;
    state.mempool.feeLow  = fees.hourFee || fees.economyFee || null;
  }
}

async function pollBlocks() {
  if (cfg.privateMode) {
    if (INTERNAL_MEMPOOL) {
      const blocks = await tryFetchJson(`${INTERNAL_MEMPOOL}/api/v1/blocks`);
      if (Array.isArray(blocks)) state.netBlocks = blocks.slice(0, 30).map(formatNetBlock);
    }
    return;
  }
  const blocks = await tryFetchJson(PUBLIC_BLOCKS_URL);
  if (!Array.isArray(blocks)) return;
  state.netBlocks = blocks.slice(0, 30).map(formatNetBlock);

  const counts = new Map();
  for (const b of blocks) {
    const key = b.extras?.pool?.name || 'unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  state.topFinders = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count, isSolo: /solo/i.test(name) }));
}
function formatNetBlock(b) {
  return {
    id:        b.id,
    height:    b.height,
    timestamp: b.timestamp,
    pool:      b.extras?.pool?.name || 'unknown',
    isSolo:    /solo/i.test(b.extras?.pool?.name || ''),
    tx_count:  b.tx_count,
    reward:    b.extras?.reward || 0,
  };
}

async function pollPrices() {
  if (cfg.privateMode) { state.prices = {}; return; }
  const prices = await tryFetchJson(PUBLIC_PRICE_URL);
  if (prices && typeof prices === 'object') state.prices = prices;
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

// ── HTTP/WS server ────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: '64kb' }));

function rateLimitFactory(maxPerMin = 60) {
  const buckets = new Map();
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || (now - b.t) > 60000) { b = { c:0, t:now }; buckets.set(ip, b); }
    b.c++;
    if (b.c > maxPerMin) return res.status(429).json({ error: 'rate limited' });
    next();
  };
}
app.use(rateLimitFactory(120));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/api/ws' });

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

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));
app.get('/api/state',  (req, res) => res.json(transformState(state)));
app.get('/api/config', (req, res) => res.json(cfgPublic()));
// Wizard alias for /api/config — accepts {payoutAddress} only
app.post('/api/setup', async (req, res) => {
  try {
    const { payoutAddress } = req.body || {};
    if (!payoutAddress) return res.status(400).json({ error: 'payoutAddress required' });
    const t = String(payoutAddress).trim();
    if (!isValidBtcAddress(t)) return res.status(400).json({ error: 'Invalid BTC address' });
    cfg.payoutAddress = t;
    await saveConfig();
    if (state.status === 'no_address' && cfg.payoutAddress) state.status = 'starting';
    res.json({ ok: true });
    broadcast({ type: 'CONFIG', data: cfgPublic() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const { payoutAddress, poolName, privateMode } = req.body || {};
    if (payoutAddress != null) {
      const t = String(payoutAddress).trim();
      if (!isValidBtcAddress(t)) return res.status(400).json({ error: 'Invalid BTC address' });
      cfg.payoutAddress = t;
      state.payoutAddress = t;
    }
    if (poolName != null) cfg.poolName = String(poolName).slice(0, 32);
    if (typeof privateMode === 'boolean') {
      cfg.privateMode = privateMode;
      state.privateMode = privateMode;
    }
    await saveConfig();
    if (state.status === 'no_address' && cfg.payoutAddress) state.status = 'starting';
    res.json({ ok: true, ...cfgPublic() });
    broadcast({ type: 'CONFIG', data: cfgPublic() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CSV exports
app.get('/api/export/blocks.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="solostrike-blocks.csv"');
  const rows = [['height','hash','timestamp','reward_btc']];
  (state.blocks || []).forEach(b => rows.push([b.height, b.hash, b.ts, b.reward || '']));
  res.send(rows.map(r => r.join(',')).join('\n'));
});

app.get('/api/export/workers.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="solostrike-workers.csv"');
  const wl = Object.values(state.workers || {});
  const rows = [['name','status','hashrate','accepted','rejected','best','last_seen','miner_type']];
  wl.forEach(w => rows.push([w.name, w.status, w.hashrate || 0, w.shares || 0, w.rejected || 0, w.bestshare || 0, w.lastSeen || 0, w.minerType || '']));
  res.send(rows.map(r => r.join(',')).join('\n'));
});

app.post('/api/reset-share-stats', (req, res) => {
  try {
    if (state.shareCounters) {
      for (const name of Object.keys(state.shareCounters)) {
        const c = state.shareCounters[name];
        c.accepted = 0; c.rejected = 0; c.stale = 0; c.bestSdiff = 0;
        c.rejectReasons = {}; c.lastRejectReason = null; c.lastRejectAt = null;
      }
    }
    state.shares.acceptedCount = 0;
    state.shares.rejectedCount = 0;
    state.shares.stale = 0;
    state.shares.rejectReasons = {};
    state.shareStatsStartedAt = Date.now();
    savePersist({
      shareCounters: state.shareCounters,
      shareStatsStartedAt: state.shareStatsStartedAt,
    });
    res.json({ ok: true, resetAt: state.shareStatsStartedAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stratum-health', (req, res) => {
  res.json(getStratumHealth());
});

// Umbrel home-screen widget endpoint — returns the four-stats JSON shape
// Umbrel expects. Mounted on /api/widget/four-stats; declared in umbrel-app.yml.
// v1.7.9 — restored to the v1.5.3 reference shape (uses transformState,
// includes 'refresh' field, omits 'link' at top level).
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

app.get('/api/webhooks', (req, res) => {
  res.json({ hooks: state.webhooks || [] });
});
app.post('/api/webhooks', async (req, res) => {
  try {
    const body = req.body || {};
    const op = body.op;
    if (op === 'add') {
      const { name, url, events } = body;
      if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Invalid URL' });
      if (!Array.isArray(events) || !events.length) return res.status(400).json({ error: 'No events selected' });
      if ((state.webhooks || []).length >= MAX_HOOKS) return res.status(400).json({ error: `Max ${MAX_HOOKS} webhooks` });
      const id = 'wh_' + Math.random().toString(36).slice(2, 10);
      state.webhooks = [...(state.webhooks || []), {
        id,
        name: String(name || 'Webhook').slice(0, 50),
        url: String(url).slice(0, 500),
        events: events.filter(e => ['block_found','worker_offline','worker_online'].includes(e)),
      }];
      await saveHooks();
      return res.json({ ok: true, id });
    }
    if (op === 'remove') {
      const { id } = body;
      state.webhooks = (state.webhooks || []).filter(h => h.id !== id);
      await saveHooks();
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'Unknown op' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SoloStrike Network ──────────────────────────────────────────────────────
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

// v1.7.1 — Backup the encrypted identity to plaintext on user demand (localhost-only).
app.post('/api/network-stats/export-backup', (req, res) => {
  if (!networkStatsController) return res.status(503).json({ error: 'network-stats not initialized yet' });
  if (typeof networkStatsController.exportBackup !== 'function') {
    return res.status(501).json({ error: 'exportBackup not supported in this API version' });
  }
  const ip = req.ip || req.connection?.remoteAddress || '';
  const isLocal = ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.') || ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('172.');
  if (!isLocal) return res.status(403).json({ error: 'export-backup requires local access' });
  try {
    const backup = networkStatsController.exportBackup();
    res.json({ ok: true, ...backup });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// v1.7.3 — Async toggle Tor routing with reachability pre-flight + hot-swap.
// Returns { ok, mode, via, error } so UI can show specific feedback.
app.post('/api/network-stats/tor', async (req, res) => {
  if (!networkStatsController) return res.status(503).json({ error: 'network-stats not initialized yet' });
  if (typeof networkStatsController.setTorEnabled !== 'function') {
    return res.status(501).json({ error: 'tor toggle not supported in this API version' });
  }
  const enabled = !!(req.body && req.body.enabled);
  try {
    const result = await networkStatsController.setTorEnabled(enabled);
    if (!result.ok) {
      return res.json({
        ok: false,
        enabled: false,
        mode: result.mode,
        via: result.via,
        error: result.error,
      });
    }
    res.json({
      ok: true,
      enabled: result.mode === 'tor',
      mode: result.mode,
      via: result.via,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// v1.7.1 — Security telemetry endpoint for diagnostics
app.get('/api/network-stats/security', (req, res) => {
  if (!networkStatsController) return res.status(503).json({ error: 'network-stats not initialized yet' });
  if (typeof networkStatsController.securityStats !== 'function') {
    return res.status(501).json({ error: 'security stats not supported in this API version' });
  }
  res.json(networkStatsController.securityStats());
});

app.get('/metrics', (req, res) => {
  const s = transformState(state);
  const lines = [];
  const add = (name, help, type, value) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name} ${value}`);
  };
  add('solostrike_hashrate_hps', 'Pool hashrate in H/s', 'gauge', s.hashrate?.current || 0);
  add('solostrike_workers_total', 'Total registered workers', 'gauge', (s.workers || []).length);
  add('solostrike_workers_online', 'Currently mining workers', 'gauge', (s.workers || []).filter(w => w.status !== 'offline').length);
  add('solostrike_blocks_found', 'Total blocks found', 'counter', (s.blocks || []).length);
  add('solostrike_shares_accepted', 'Accepted shares (count)', 'counter', s.shares?.acceptedCount || 0);
  add('solostrike_shares_rejected', 'Rejected shares (count)', 'counter', s.shares?.rejectedCount || 0);
  add('solostrike_shares_stale',    'Stale shares (count)',    'counter', s.shares?.stale || 0);
  add('solostrike_best_share', 'Best share difficulty (all-time)', 'gauge', s.bestshare || 0);
  add('solostrike_network_hashrate', 'Bitcoin network hashrate (H/s)', 'gauge', s.network?.hashrate || 0);
  add('solostrike_network_difficulty', 'Bitcoin network difficulty', 'gauge', s.network?.difficulty || 0);
  add('solostrike_block_height', 'Latest block height', 'gauge', s.network?.height || 0);
  add('solostrike_node_connected', 'Bitcoin Core RPC reachable (1/0)', 'gauge', s.nodeInfo?.connected ? 1 : 0);
  add('solostrike_node_peers', 'Bitcoin Core peer count', 'gauge', s.nodeInfo?.peers || 0);
  add('solostrike_uptime_seconds', 'API uptime (seconds)', 'counter', Math.floor((Date.now() - state.startedAt) / 1000));
  res.setHeader('Content-Type', 'text/plain');
  res.send(lines.join('\n') + '\n');
});

setInterval(() => {
  if (wss.clients.size === 0) return;
  broadcast({ type: 'STATE_UPDATE', data: transformState(state) });
}, 5000);

// ── Snapshots scheduler ────────────────────────────────────────────────────
function startSnapshotScheduler() {
  const ROLLUP_INTERVAL_MS = 60 * 1000;

  const scheduleNextRollup = () => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 0, 0);
    const ms = tomorrow.getTime() - now.getTime();
    setTimeout(async () => {
      try {
        const snap = captureDailySnapshot(state);
        await applyDailySnapshot(state, snap);
        await savePersist({ snapshots: state.snapshots, closestCalls: state.closestCalls });
      } catch (e) { console.error('[snapshots] daily failed:', e.message); }
      scheduleNextRollup();
    }, ms);
  };
  scheduleNextRollup();

  setInterval(() => {
    try {
      updateClosestCalls(state.snapshots, state);
    } catch (e) { console.error('[snapshots] interval failed:', e.message); }
  }, ROLLUP_INTERVAL_MS);

  console.log(`[Snapshots] Scheduler started (interval ${ROLLUP_INTERVAL_MS/1000}s, daily rollup at UTC midnight)`);
}

// ── Boot sequence ─────────────────────────────────────────────────────────
async function main() {
  await fs.ensureDir(CONFIG_DIR);
  cfg = await loadConfig();
  const persist = await loadPersist();
  if (persist.closestCalls) state.closestCalls = persist.closestCalls;
  if (persist.blocks) state.blocks = persist.blocks;
  if (persist.snapshots) state.snapshots = persist.snapshots;
  if (persist.webhooks) state.webhooks = persist.webhooks;
  if (persist.nostrPrivkey) cfg.nostrPrivkey = persist.nostrPrivkey;
  if (persist.nostrInstallId) cfg.nostrInstallId = persist.nostrInstallId;
  if (typeof persist.networkStatsEnabled === 'boolean') cfg.networkStatsEnabled = persist.networkStatsEnabled;
  if (persist.pulseDeviceSalt) cfg.pulseDeviceSalt = persist.pulseDeviceSalt;
  if (typeof persist.pulseTorEnabled === 'boolean') cfg.pulseTorEnabled = persist.pulseTorEnabled;
  state.privateMode = !!cfg.privateMode;
  state.payoutAddress = cfg.payoutAddress || null;

  try {
    const loaded = await loadSnapshots(CONFIG_DIR);
    if (loaded) state.snapshots = loaded;
  } catch (e) { console.error('snapshot load failed:', e.message); }

  setInterval(pollBitcoind, 15000);
  setInterval(pollMempool,  60000);
  setInterval(pollBlocks,   120000);
  setInterval(pollPrices,   300000);

  await pollBitcoind();
  await pollMempool();
  await pollBlocks();
  await pollPrices();

  if (!cfg.payoutAddress) {
    state.status = 'no_address';
  } else {
    state.status = 'starting';
  }

  await loadHooks();

  // Subsystems
  startZmq();
  startUaTailer({ configDir: CONFIG_DIR, logDir: CKPOOL_LOG_DIR });
  startStatusPoller(state, broadcast, CKPOOL_LOG_DIR);
  startSnapshotScheduler();
  startStratumHealthPoller();
  startBlockWatcher({ state, broadcast, fireHooks, savePersist, logDir: CKPOOL_LOG_DIR });
  startShareWatcher({ state, logDir: CKPOOL_LOG_DIR, savePersist, broadcast });
  networkStatsController = startNetworkStats({ state, cfg, savePersist });

  setTimeout(() => {
    if (state.status === 'starting' && cfg.payoutAddress) state.status = 'running';
  }, 5000);
  // UI expects uptime as a Unix millisecond timestamp of boot time.
  // It computes (Date.now() - state.uptime) to get elapsed time client-side.
  state.uptime = state.startedAt;

  server.listen(PORT, () => {
    console.log(`[SoloStrike API v${state.version}] Listening on :${PORT} (privateMode=${state.privateMode})`);
  });
}

main().catch(e => {
  console.error('Boot failed:', e);
  process.exit(1);
});
