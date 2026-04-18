const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const chokidar = require('chokidar');
const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const { startStatusPoller } = require('./status-poller');
const { transformState } = require('./state-transform');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const CONFIG_DIR      = process.env.CONFIG_DIR       || '/app/config';
const CKPOOL_LOG_DIR  = process.env.CKPOOL_LOG_DIR   || '/var/log/ckpool';
const CKPOOL_CFG_DIR  = process.env.CKPOOL_CONFIG_DIR || '/etc/ckpool';
const CONFIG_FILE     = path.join(CONFIG_DIR, 'solostrike.json');
const CKPOOL_CONF     = path.join(CKPOOL_CFG_DIR, 'ckpool.conf');

const RPC_HOST = process.env.BITCOIN_RPC_HOST || '10.21.21.8';
const RPC_PORT = process.env.BITCOIN_RPC_PORT || '8332';
const RPC_USER = process.env.BITCOIN_RPC_USER || 'umbrel';
const RPC_PASS = process.env.BITCOIN_RPC_PASS || 'moneyprintergobrrr';

async function rpc(method, params = []) {
  const auth = Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64');
  try {
    const res = await fetch(`http://${RPC_HOST}:${RPC_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ jsonrpc: '1.0', id: 'ss', method, params }),
      timeout: 5000,
    });
    const j = await res.json();
    return j.result;
  } catch (e) { return null; }
}

let cfg = { payoutAddress: null, poolName: 'SoloStrike' };
let state = {
  workers: {},
  hashrate: { current: 0, history: [] },
  blocks: [],
  shares: { accepted: 0, rejected: 0, stale: 0 },
  network: { height: 0, difficulty: 0, hashrate: 0 },
  uptime: Date.now(),
  status: 'starting',
  bestshare: 0,
  totalWorkers: 0,
  totalUsers: 0,
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
      auth: RPC_USER,
      pass: RPC_PASS,
      notify: true,
    }],
    btcaddress: address,
    btcsig: 'SoloStrike/',
    blockpoll: 100,
    nonce1length: 4,
    nonce2length: 8,
    update_interval: 30,
    version_mask: '1fffe000',
    logdir: '/var/log/ckpool',
    serverurl: ['0.0.0.0:3333'],
    mindiff: 1,
    startdiff: 42,
    maxdiff: 0,
    solo: true,
  };
  await fs.ensureDir(CKPOOL_CFG_DIR);
  await fs.writeJson(CKPOOL_CONF, conf, { spaces: 2 });
  console.log(`[API] ckpool config written with address ${address}`);
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
      if (!stat || stat.size <= fileSize) return;
      const buf = Buffer.alloc(stat.size - fileSize);
      const fd = await fs.open(logFile, 'r');
      await fs.read(fd, buf, 0, buf.length, fileSize);
      await fs.close(fd);
      fileSize = stat.size;
      buf.toString('utf8').split('\n').forEach(l => l.trim() && parseLine(l));
    } catch {}
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
  if (chain) { state.network.height = chain.blocks; state.network.difficulty = chain.difficulty; }
  if (mining) state.network.hashrate = mining.networkhashps;
}
setInterval(pollNetwork, 15000);

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(data); });
}

setInterval(() => {
  broadcast({ type: 'STATE_UPDATE', data: transformState(state) });
}, 5000);

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'STATE_UPDATE', data: transformState(state) }));
  ws.send(JSON.stringify({ type: 'CONFIG', data: cfg }));
});

app.get('/api/state', (req, res) => res.json(transformState(state)));
app.get('/api/config', (req, res) => res.json(cfg));

app.post('/api/setup', async (req, res) => {
  const { payoutAddress, poolName } = req.body;
  if (!payoutAddress || typeof payoutAddress !== 'string') {
    return res.status(400).json({ error: 'payoutAddress required' });
  }
  cfg.payoutAddress = payoutAddress.trim();
  if (poolName) cfg.poolName = poolName;
  await saveCfg();
  await writeCkpoolConf(cfg.payoutAddress);
  state.status = 'mining';
  broadcast({ type: 'CONFIG', data: cfg });
  res.json({ ok: true, cfg });
});

app.post('/api/settings', async (req, res) => {
  const { payoutAddress, poolName } = req.body;
  if (payoutAddress) cfg.payoutAddress = payoutAddress.trim();
  if (poolName) cfg.poolName = poolName;
  await saveCfg();
  if (payoutAddress) await writeCkpoolConf(cfg.payoutAddress);
  broadcast({ type: 'CONFIG', data: cfg });
  res.json({ ok: true, cfg });
});

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: Date.now() - state.uptime }));

async function boot() {
  await loadCfg();
  if (cfg.payoutAddress) await writeCkpoolConf(cfg.payoutAddress);
  pollNetwork();
  watchLogs();
  startStatusPoller(state, broadcast, CKPOOL_LOG_DIR);
  state.status = cfg.payoutAddress ? 'mining' : 'setup';
  const PORT = 3001;
  server.listen(PORT, () => console.log(`[SoloStrike API] Listening on :${PORT}`));
}

boot();
