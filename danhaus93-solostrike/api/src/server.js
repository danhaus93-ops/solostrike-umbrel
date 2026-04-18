const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const chokidar = require('chokidar');
const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ── Paths ─────────────────────────────────────────────────────────────────────
const CONFIG_DIR = process.env.CONFIG_DIR || '/app/config';
const CKPOOL_LOG_DIR = process.env.CKPOOL_LOG_DIR || '/var/log/ckpool';
const CKPOOL_CFG_DIR = process.env.CKPOOL_CONFIG_DIR || '/etc/ckpool';

const CONFIG_FILE = path.join(CONFIG_DIR, 'solostrike.json');
const CKPOOL_CONF = path.join(CKPOOL_CFG_DIR, 'ckpool.conf');

// ── Bitcoin RPC ──────────────────────────────────────────────────────────────
const RPC_HOST = process.env.BITCOIN_RPC_HOST || 'bitcoin_bitcoind_1';
const RPC_PORT = process.env.BITCOIN_RPC_PORT || '8332';
const RPC_USER = process.env.BITCOIN_RPC_USER || 'umbrel';
const RPC_PASS = process.env.BITCOIN_RPC_PASS || 'moneyprintergobrrr';

async function rpc(method, params = []) {
  const auth = Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64');

  try {
    const res = await fetch(`http://${RPC_HOST}:${RPC_PORT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        jsonrpc: '1.0',
        id: 'ss',
        method,
        params,
      }),
      timeout: 5000,
    });

    const j = await res.json();
    return j.result;
  } catch (e) {
    return null;
  }
}

// ── State ────────────────────────────────────────────────────────────────────
let cfg = {
  payoutAddress: null,
  poolName: 'SoloStrike',
};

let state = {
  workers: {},
  hashrate: { current: 0, history: [] },
  blocks: [],
  shares: { accepted: 0, rejected: 0, stale: 0 },
  network: { height: 0, difficulty: 0, hashrate: 0 },
  uptime: Date.now(),
  status: 'starting',
};

// ── Config I/O ───────────────────────────────────────────────────────────────
async function loadCfg() {
  try {
    await fs.ensureDir(CONFIG_DIR);
    if (await fs.pathExists(CONFIG_FILE)) {
      cfg = await fs.readJson(CONFIG_FILE);
    }
  } catch {}
}

async function saveCfg() {
  await fs.ensureDir(CONFIG_DIR);
  await fs.writeJson(CONFIG_FILE, cfg, { spaces: 2 });
}

async function writeCkpoolConf(address) {
  const conf = {
    btcd: [
      {
        url: `http://${RPC_HOST}:${RPC_PORT}`,
        user: RPC_USER,
        pass: RPC_PASS,
        notify: true,
      },
    ],
    btcaddress: address,
    btcsig: 'SoloStrike/',
    blockpoll: 100,
    nonce1length: 4,
    nonce2length: 8,
    update_interval: 30,
    version_mask: '1fffe000',
    logdir: '/var/log/ckpool',
    serverurl: ['0.0.0.0:3333'],
    mindiff: 512,
    startdiff: 512,
    maxdiff: 0,
    solo: true,
  };

  await fs.ensureDir(CKPOOL_CFG_DIR);
  await fs.writeJson(CKPOOL_CONF, conf, { spaces: 2 });
  console.log(`[API] ckpool config written with address ${address}`);
}

// ── Log parsing ──────────────────────────────────────────────────────────────
const RE_SHARE = /(\S+)\.(\S+)\s+diff\s+([\d.]+)\s+(\w+)\s+share/;
const RE_WORKER = /"workername":"([^"]+)".*?"hashrate5m":([\d.]+)/;
const RE_BLOCK = /BLOCK FOUND.*height[:\s]+(\d+).*hash[:\s]+([a-f0-9]+)/i;
const RE_POOLHR = /"pool_hashrate":([\d.]+)/;

function parseLine(line) {
  if (RE_BLOCK.test(line)) {
    const m = line.match(RE_BLOCK);
    const b = { height: parseInt(m[1], 10), hash: m[2], ts: Date.now() };
    state.blocks.unshift(b);
    if (state.blocks.length > 50) state.blocks.pop();
    broadcast({ type: 'BLOCK_FOUND', data: b });
    return;
  }

  if (RE_SHARE.test(line)) {
    const m = line.match(RE_SHARE);
    const [, user, worker, diff, status] = m;
    const key = `${user}.${worker}`;

    if (!state.workers[key]) {
      state.workers[key] = {
        name: key,
        hashrate: 0,
        shares: 0,
        rejected: 0,
        lastSeen: Date.now(),
        diff: 0,
        status: 'online',
      };
    }

    state.workers[key].lastSeen = Date.now();
    state.workers[key].diff = parseFloat(diff);
    state.workers[key].status = 'online';

    if (status === 'accepted') {
      state.shares.accepted++;
      state.workers[key].shares++;
    } else if (status === 'rejected') {
      state.shares.rejected++;
      state.workers[key].rejected++;
    } else if (status === 'stale') {
      state.shares.stale++;
    }

    return;
  }

  if (RE_WORKER.test(line)) {
    const m = line.match(RE_WORKER);
    const name = m[1];

    if (!state.workers[name]) {
      state.workers[name] = {
        name,
        hashrate: 0,
        shares: 0,
        rejected: 0,
        lastSeen: Date.now(),
        diff: 0,
        status: 'online',
      };
    }

    state.workers[name].hashrate = parseFloat(m[2]);
    return;
  }

  if (RE_POOLHR.test(line)) {
    const m = line.match(RE_POOLHR);
    const hr = parseFloat(m[1]);
    state.hashrate.current = hr;
    state.hashrate.history.push({ ts: Date.now(), hr });
    if (state.hashrate.history.length > 360) state.hashrate.history.shift();
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
      buf
        .toString('utf8')
        .split('\n')
        .forEach((l) => l.trim() && parseLine(l));
    } catch {}
  };

  chokidar
    .watch(logFile, { usePolling: true, interval: 1000 })
    .on('change', read)
    .on('add', read);
}

// ── Worker heartbeat ─────────────────────────────────────────────────────────
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  Object.values(state.workers).forEach((w) => {
    w.status = w.lastSeen < cutoff ? 'offline' : 'online';
  });
}, 30000);

// ── Network polling ──────────────────────────────────────────────────────────
async function pollNetwork() {
  const [chain, mining] = await Promise.all([
    rpc('getblockchaininfo'),
    rpc('getmininginfo'),
  ]);

  if (chain) {
    state.network.height = chain.blocks;
    state.network.difficulty = chain.difficulty;
  }

  if (mining) {
    state.network.hashrate = mining.networkhashps;
  }

  state.status = cfg.payoutAddress ? 'running' : 'no_address';
}

setInterval(pollNetwork, 15000);

// ── WebSocket ────────────────────────────────────────────────────────────────
function broadcast(msg) {
  const s = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(s);
  });
}

setInterval(() => broadcast({ type: 'STATE', data: publicState() }), 5000);

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'STATE', data: publicState() }));
});

function publicState() {
  const workers = Object.values(state.workers);
  const totalHr = workers
    .filter((w) => w.status !== 'offline')
    .reduce((s, w) => s + (w.hashrate || 0), 0);

  const netHr = state.network.hashrate || 1;
  const perBlock = totalHr > 0 ? totalHr / netHr : 0;

  return {
    config: {
      poolName: cfg.poolName,
      hasAddress: !!cfg.payoutAddress,
    },
    status: state.status,
    hashrate: {
      current: totalHr,
      history: state.hashrate.history,
    },
    workers,
    shares: state.shares,
    blocks: state.blocks,
    network: state.network,
    odds: {
      perBlock,
      expectedDays: perBlock > 0 ? 1 / (perBlock * 144) : null,
    },
    uptime: state.uptime,
  };
}

// ── REST ─────────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.get('/api/state', (_, res) => res.json(publicState()));

app.get('/api/config', (_, res) =>
  res.json({
    hasAddress: !!cfg.payoutAddress,
    addressMasked: cfg.payoutAddress
      ? `${cfg.payoutAddress.slice(0, 8)}...${cfg.payoutAddress.slice(-6)}`
      : null,
    poolName: cfg.poolName,
  })
);

app.post('/api/config', async (req, res) => {
  const { payoutAddress, poolName } = req.body;

  if (payoutAddress) {
    if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(payoutAddress)) {
      return res.status(400).json({ error: 'Invalid Bitcoin address' });
    }

    cfg.payoutAddress = payoutAddress;
    await writeCkpoolConf(payoutAddress);
  }

  if (poolName) {
    cfg.poolName = poolName.slice(0, 32);
  }

  await saveCfg();
  state.status = cfg.payoutAddress ? 'running' : 'no_address';

  broadcast({
    type: 'CONFIG_UPDATED',
    data: {
      hasAddress: !!cfg.payoutAddress,
      poolName: cfg.poolName,
    },
  });

  res.json({ ok: true });
});

// ── Boot ─────────────────────────────────────────────────────────────────────
async function boot() {
  await loadCfg();

  if (cfg.payoutAddress) {
    await writeCkpoolConf(cfg.payoutAddress);
    state.status = 'running';
  } else {
    state.status = 'no_address';
  }

  watchLogs();
  await pollNetwork();

  server.listen(3001, () => {
    console.log('[SoloStrike API] Listening on :3001');
  });
}

boot();
