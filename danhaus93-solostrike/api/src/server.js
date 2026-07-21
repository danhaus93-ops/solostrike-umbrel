// SoloStrike API server (v1.11.59 — privacy-aware)
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const http = require('http');
const WebSocket = require('ws');

// v1.11.x SAFETY: top-level error handlers. Without these, a single
// unhandled async error or uncaught exception silently kills the API
// process (Node's default behavior is exit-on-uncaught). The container
// would restart via Docker's restart policy, but the UI would show a
// connection blip until then. Now we:
//   - Log unhandled promise rejections (don't exit — these are often
//     false positives from libs and the process is usually still healthy)
//   - Log uncaught exceptions and exit cleanly (process state may be
//     corrupted; let Docker restart us fresh)
process.on('unhandledRejection', (reason, promise) => {
  console.error('[unhandledRejection]', reason && (reason.stack || reason.message || reason));
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && (err.stack || err.message || err));
  // Give logs a moment to flush, then exit so Docker restarts us clean.
  setTimeout(() => process.exit(1), 100);
});

const { startStatusPoller }             = require('./status-poller');
const { startUaTailer, getAllMeta }     = require('./ua-tailer');
const { startMinerPoller, setEnabled: setMinerPollerEnabled,
        isEnabled: isMinerPollerEnabled, getAllAlignments, getAllLive,
        getAllRecords, pollOne: pollOneMiner } = require('./miner-poller');
const { transformState }                = require('./state-transform');
const { isValidBtcAddress }             = require('./validators');
const minerControl                      = require('./miner-control');
const {
  loadSnapshots,
  saveSnapshots,
  captureDailySnapshot,
  applyDailySnapshot,
  updateClosestCalls,
  syncBlockEffort,
  sampleBestTrend,
} = require('./snapshots');
const { startStratumHealthPoller, getStratumHealth } = require('./stratum-health');
const { startBlockWatcher } = require('./block-watcher');
const { startShareWatcher } = require('./share-watcher');
const { startNetworkStats } = require('./network-stats');

const PORT          = parseInt(process.env.PORT, 10) || 3001;
const CKPOOL_LOG_DIR = process.env.CKPOOL_LOG_DIR || '/var/log/ckpool';
const CKPOOL_CONFIG_DIR = process.env.CKPOOL_CONFIG_DIR || '/etc/ckpool';
const CKPOOL_CONFIG_FILE = path.join(CKPOOL_CONFIG_DIR, 'ckpool.conf');
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
const { createOracle } = require('./utxoracle'); // v3.1.0: UTXOracle v8 port (private-mode price)

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
  tempOverrides: {}, // v3.1.1: per-miner temp alert thresholds { name: { amber, red } }
  hashrate: { current: 0, history: [], week: [] },
  workers: {},
  network: { height: 0, difficulty: 0, hashrate: 0 },
  blockReward: { totalBtc: 0, base: 0, fees: 0, subsidyBtc: 0, feesBtc: 0, totalSats: 0 },
  mempool: { totalFeesBtc: 0, feeRate: null, feeFast: null, feeMid: null, feeLow: null },
  prices: {},
  blocks: [],
  netBlocks: [],
  topFinders: [],
  closestCalls: [],
  bestshare: 0,
  shares: { acceptedCount: 0, rejectedCount: 0, stale: 0, rejectReasons: {}, sps1m: 0, spsHistory: [], acceptedSdiffSum: 0, lastShareAt: null },
  uptime: 0,
  startedAt: Date.now(),
  // v1.8.4: rolling error counter for the System Health card. Incremented
  // by the error-handler middleware (registered after all other middleware).
  // `lastHour` resets every 60min. `recent` keeps the last 10 errors with
  // {ts, msg, path} for the detailed-diagnostic modal.
  errorCount: { lastHour: 0, recent: [] },
  odds: { perBlock: 0, expectedDays: null, perDay: 0, perWeek: 0, perMonth: 0 },
  luck: { progress: 0, blocksExpected: 0, blocksFound: 0, luck: null },
  retarget: null,
  nodeInfo: null,
  zmq: null,
  sync: null,
  snapshots: { daily: [], closestCalls: [], lastRollupDate: null, blockEffort: [], bestTrend: [] },
  // v1.12.0: live block-effort ring (newest-first); snapshots persists it
  blockEffortHistory: [],
  // v1.12.0: round-share baseline for effort calc (set on each block solve)
  _sharesAtLastBlock: 0,
  shareCounters: {},
  sharelogCursors: {},
  webhooks: [],
  shareStatsStartedAt: 0,
  version: '3.6.5',
  // Compose/manifest version — bump only when umbrel-app.yml or docker-compose.yml
  // change in ways that require Umbrel to re-read them. Soft updates leave this
  // untouched; hard updates bump this so the UI banner can prompt the user to
  // open Umbrel for the update.
  composeVersion: '1.8.5',
  // Update urgency — drives banner styling. 'normal' (amber), 'recommended' (cyan),
  // 'critical' (red). Set per release.
  urgency: 'normal',
  // Short release notes shown when user expands the update banner.
  // Keep concise — markdown-style bullets work fine, displayed as plain text.
  releaseNotes:
    "• Mobile carousel — swipe horizontally between cards, each fills the screen\n" +
    "• Tappable position dots at the bottom show which card you're on\n" +
    "• Stratum card auto-jumps to FIRST position for new users (until configured)\n" +
    "• Once Stratum is set up, it rotates to LAST and stays out of your daily view\n" +
    "• Desktop view unchanged — keeps the existing multi-column grid",
};

let cfg = {};
let wsClients = 0;

function broadcast(msg) {
  const data = JSON.stringify(msg);
  // v1.11.x BACKPRESSURE: skip clients whose send buffer is over 1MB.
  // Without this, a slow mobile client (poor WiFi / backgrounded PWA) can
  // accumulate unsent frames in ws.bufferedAmount forever, growing the API
  // process's memory until the OS or Node OOMs. At ~5-50KB per state push
  // and 2-3 pushes/sec, 1MB is ~20-200 messages backlogged before we skip.
  // Normal clients sit at bufferedAmount = 0; this only kicks in when a
  // client is already in trouble. They'll catch up on the next broadcast
  // once their buffer drains, or get fresh state on reconnect.
  wss.clients.forEach(c => {
    if (c.readyState === WebSocket.OPEN && c.bufferedAmount < 1_000_000) {
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

// v1.11.56: write the user's payout address into ckpool.conf.
//
// Background: on a fresh install the init-permissions container generates
// ckpool.conf with a placeholder btcaddress (the user hasn't run the
// onboarding wizard yet when init runs). This function rewrites ckpool.conf
// with the real address once the user provides it, so the config's
// btcaddress matches reality.
//
// Note on payouts: ckpool runs in --btcsolo mode, where the payout address
// is taken from each miner's stratum USERNAME (e.g. "bc1q...workername"),
// NOT from this config field. So payouts already route correctly to the
// miner-supplied address regardless of what's here. The btcaddress field
// is the FALLBACK used only if a miner connects without a valid-address
// username — keeping it set to the user's real address means even that
// fallback pays the user, never the placeholder.
//
// Note on timing: ckpool reads its config only at process start, so a
// rewrite here takes effect on the next ckpool restart (app update/reboot).
// We intentionally do NOT try to restart ckpool from the api — that would
// require Docker socket access, which we avoid for security. The api has
// /etc/ckpool mounted read-write (see docker-compose) and runs as the same
// UID (1000) that owns the file, so the write itself always succeeds.
async function writeCkpoolConf() {
  try {
    if (!cfg.payoutAddress) return; // nothing to write yet
    const conf = {
      btcd: [{
        url:  `${RPC_HOST}:${RPC_PORT}`,
        auth: RPC_USER,
        pass: RPC_PASS,
      }],
      btcaddress:      cfg.payoutAddress,
      btcsig:          process.env.POOL_SIGNATURE || 'LoneStrike on Umbrel/',
      blockpoll:       parseInt(process.env.BLOCKPOLL || '50', 10),
      update_interval: parseInt(process.env.UPDATE_INTERVAL || '20', 10),
      serverurl:       ['0.0.0.0:3333', '0.0.0.0:3334', '0.0.0.0:4334'],
      mindiff:         parseInt(process.env.MIN_DIFFICULTY || '1', 10),
      startdiff:       parseInt(process.env.START_DIFFICULTY || '10000', 10),
      maxdiff:         parseInt(process.env.MAX_DIFFICULTY || '0', 10),
      highdiff:        parseInt(process.env.HIGH_DIFFICULTY || '500000', 10),
      logdir:          '/var/log/ckpool',
      zmqblock:        ZMQ_HASHBLOCK_URL || '',
    };
    await fs.ensureDir(CKPOOL_CONFIG_DIR);
    await fs.writeJson(CKPOOL_CONFIG_FILE, conf, { spaces: 2 });
    console.log(`[ckpool-conf] wrote ${CKPOOL_CONFIG_FILE} with btcaddress=${cfg.payoutAddress} (takes effect on next ckpool restart)`);
  } catch (e) {
    // Non-fatal: persist.json still has the address, payouts still work via
    // miner username. Log and continue so the wizard never errors out.
    console.error('[ckpool-conf] writeCkpoolConf failed:', e.message);
  }
}
async function loadPersist() {
  try {
    if (await fs.pathExists(PERSIST_FILE)) return await fs.readJson(PERSIST_FILE);
  } catch (e) { console.error('loadPersist failed:', e.message); }
  return {};
}
// v1.8.3-rev29: serialize savePersist calls. Multiple async sources
// (block-watcher, share-watcher, network-stats, daily snapshot rollup at UTC
// midnight, periodic history save every 60s, hooks) all write to persist.json.
// The read-modify-write pattern below has no atomicity guarantees — without
// serialization, concurrent calls can clobber each other's changes (last-
// writer-wins). The chain ensures one-at-a-time execution; queued callers
// await the previous write naturally via the chain head.
let _persistChain = Promise.resolve();
async function savePersist(obj) {
  _persistChain = _persistChain.then(async () => {
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
  });
  return _persistChain;
}

function cfgPublic() {
  return {
    poolName: cfg.poolName || 'SoloStrike',
    privateMode: !!cfg.privateMode,
    privacy: { ...(cfg.privacy || {}) },
    tempOverrides: cfg.tempOverrides || {},
    hasAddress: !!cfg.payoutAddress,
  };
}

// v1.10.1 SECURITY: cfgPrivate is the authenticated companion to cfgPublic.
// Returned ONLY by /api/config (which Umbrel's app_proxy gates behind a
// session token — see PROXY_AUTH_WHITELIST in docker-compose.yml: /api/config
// is NOT in that list, so it requires session). Includes the payout address
// so the StratumPanel can build the full stratum username for the user.
// Webhooks are returned via /api/webhooks (also session-gated).
function cfgPrivate() {
  return {
    ...cfgPublic(),
    payoutAddress: cfg.payoutAddress || null,
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

// v1.10.1 SECURITY: SSRF guard for webhook URLs.
// Returns true if the URL points at a private/loopback/link-local address
// or an unparseable host. Used to block default-deny webhooks aimed at
// internal services (Bitcoin RPC, Umbrel internal subnet 10.21.21.x,
// router admin pages, etc). Users can explicitly opt in per-webhook via
// the `allowInternal` flag if they're targeting their own self-hosted
// service like Home Assistant. Hostname literals (homeassistant.local,
// raspberrypi.local) are also treated as internal because mDNS resolves
// them only on the local network.
function isPrivateUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost') return true;
    if (host === 'metadata.google.internal') return true;
    if (host.endsWith('.local')) return true;     // mDNS / Bonjour
    if (host.endsWith('.internal')) return true;  // common AWS / GCP internal TLD
    // IPv4 literal
    const m4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m4) {
      const [, a, b] = m4.map(Number);
      if (a === 0)   return true;       // 0.0.0.0/8
      if (a === 10)  return true;       // 10.0.0.0/8
      if (a === 127) return true;       // loopback
      if (a === 169 && b === 254) return true;  // link-local
      if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
      if (a === 192 && b === 168) return true;  // 192.168.0.0/16
      if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT incl. Tailscale 100.64/10
      return false;
    }
    // IPv6 literal — block all loopback (::1) and ULA (fc00::/7) and link-local (fe80::/10)
    if (host.startsWith('[::1') || host === '::1') return true;
    if (host.startsWith('[fc') || host.startsWith('[fd')) return true;
    if (host.startsWith('[fe8') || host.startsWith('[fe9') || host.startsWith('[fea') || host.startsWith('[feb')) return true;
    return false;
  } catch {
    return true;  // unparseable → treat as private (default-deny)
  }
}
async function fireHooks(eventName, payload) {
  // v3.6.0: webhook deliveries are outbound — gated under lockdown (absolute,
  // LAN included: 'nothing escapes' stays literally true) and by their toggle.
  if (cfg.privateMode || (cfg.privacy && cfg.privacy.webhooks === false)) return;
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
async function rpc(method, params = [], ms = 8000) { // v3.1.1: per-call timeout (oracle needs >8s for verbosity-2 blocks)
  const url = `http://${RPC_HOST}:${RPC_PORT}/`;
  const body = JSON.stringify({ jsonrpc: '1.0', id: 'solostrike', method, params });
  const auth = 'Basic ' + Buffer.from(`${RPC_USER}:${RPC_PASS}`).toString('base64');
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
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
    } catch (e) {
      // v1.8.3-rev29: was silently swallowed. getblocktemplate fails during
      // IBD or right after BTC restart — without logging, state.blockReward
      // would silently stop updating with no indication. Now warns once per
      // failure so log searches surface the issue.
      console.warn('[poll] getblocktemplate failed:', e.message);
    }

    // v1.8.3-rev29: skip odds/luck computation if network hashrate hasn't
    // been populated yet. Previously fell back to `state.network.hashrate || 1`,
    // which during the ~15s startup window before pollBitcoind completes
    // produced odds = myHr/1 (e.g. 86 trillion), making the dashboard briefly
    // display "1 block every 0.0000…s days" before correcting.
    if (!state.network.hashrate || state.network.hashrate <= 0) {
      state.odds = null;
      state.luck = null;
      return;
    }
    const myHr = state.hashrate.current || 0;
    const netHr = state.network.hashrate;
    const blocksPerDay = 144;
    const odds = myHr / netHr;
    const expectedDaysPerBlock = odds > 0 ? (1 / odds) / blocksPerDay : null;
    const perBlockProbWithinDay = 1 - Math.exp(-odds * blocksPerDay);
    const perBlockProbWithinWeek = 1 - Math.exp(-odds * blocksPerDay * 7);
    const perBlockProbWithinMonth = 1 - Math.exp(-odds * blocksPerDay * 30);
    const perBlockProbWithinYear = 1 - Math.exp(-odds * blocksPerDay * 365);
    state.odds = {
      perBlock: odds,
      expectedDays: expectedDaysPerBlock,
      perDay: perBlockProbWithinDay,
      perWeek: perBlockProbWithinWeek,
      perMonth: perBlockProbWithinMonth,
      perYear: perBlockProbWithinYear,
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
      // v3.1.2: getblockheader instead of getblock -- headers are never
      // pruned, so Retarget keeps working on pruned nodes deep into an
      // epoch (getblock throws once the epoch-start block ages past the
      // prune window, which silently killed this card). Header has both
      // fields we read (.time, .difficulty).
      const startBlock = await rpc('getblockheader', [startBlockHash, true]);
      const elapsedSec = (Date.now() / 1000) - startBlock.time;
      const blocksDoneInEpoch = blocks - retargetEpochStart;
      const expectedSecPerBlock = 600;
      const actualSecPerBlock = blocksDoneInEpoch > 0 ? elapsedSec / blocksDoneInEpoch : expectedSecPerBlock;
      const change = ((expectedSecPerBlock / actualSecPerBlock) - 1) * 100;
      const remainingTime = remainingBlocks * actualSecPerBlock * 1000;

      // iter28-fix-C: cache previous epoch's actual difficulty change.
      // Compute from current epoch's difficulty vs previous epoch's
      // difficulty (block at retargetEpochStart - 2016). Cache by epoch
      // number so we only do the extra RPC once per epoch.
      let prevDifficultyChange = state._cachedPrevEpochDelta?.value ?? null;
      const epochNum = Math.floor(retargetEpochStart / 2016);
      if (state._cachedPrevEpochDelta?.epoch !== epochNum && retargetEpochStart >= 2016) {
        try {
          const prevEpochStartHeight = retargetEpochStart - 2016;
          const prevHash = await rpc('getblockhash', [prevEpochStartHeight]);
          const prevBlk  = await rpc('getblockheader', [prevHash, true]); // v3.1.2: prune-safe
          // Difficulty at epoch boundary applies to the next 2016 blocks.
          // Current epoch's difficulty is on startBlock; previous epoch's
          // difficulty is on prevBlk. Percent change between the two.
          if (prevBlk?.difficulty && startBlock?.difficulty) {
            const delta = ((startBlock.difficulty / prevBlk.difficulty) - 1) * 100;
            prevDifficultyChange = delta;
            state._cachedPrevEpochDelta = { epoch: epochNum, value: delta };
          }
        } catch (e) {
          // Older block prune may make prev epoch unreachable; leave prevDifficultyChange null.
        }
      }

      state.retarget = {
        progressPercent: (blocksDoneInEpoch / 2016) * 100,
        difficultyChange: change,
        remainingBlocks,
        remainingTime,
        prevDifficultyChange,
      };
    } catch (e) {}

  } catch (e) {
    console.warn('pollBitcoind failed:', e.message);
    if (state.nodeInfo) state.nodeInfo.connected = false;
  }
}

async function pollMempool() {
  // v3.6.0: fees toggle — same fallback path as lockdown (internal mempool or skip)
  if (cfg.privateMode || (cfg.privacy && cfg.privacy.fees === false)) {
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
  // v3.6.0: blocks toggle — The Ledger's feed
  if (cfg.privateMode || (cfg.privacy && cfg.privacy.blocks === false)) {
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

// v3.1.0: UTXOracle -- in private mode, estimate BTC/USD from the local
// node's own chain data (zero outbound calls). Faithful port of Steve
// Jeffress's UTXOracle.py v8; produces the previous UTC day's consensus
// price (same integer anyone running UTXOracle.py gets). run() early-exits
// with ~3 cheap header RPCs when the price day hasn't rolled over, so the
// 30-minute cadence below only pays the full ~144-block read once per day.
const utxOracle = createOracle({ rpc, log: console.log });

function maybeRunOracle() {
  // v3.6.0: oracle runs under lockdown OR when the external price is toggled off
  if (!cfg.privateMode && !(cfg.privacy && cfg.privacy.price === false)) return;
  if (!utxOracle.isRunning()) utxOracle.run().catch(() => {});
}

async function pollPrices() {
  // v3.6.0: price toggle — UTXOracle takes over, same as lockdown
  if (cfg.privateMode || (cfg.privacy && cfg.privacy.price === false)) {
    const est = utxOracle.last();
    if (est && (Date.now() - est.at) < 48 * 60 * 60 * 1000) {
      state.prices = { USD: est.price, _oracle: { source: 'utxoracle-v8', priceDate: est.priceDate, blocks: est.blocks, at: est.at } };
    } else {
      state.prices = {};
    }
    return;
  }
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

// ── v3.3.0: server-side API authentication (TOFU key) ────────────────────────
// Umbrel's app_proxy authenticates BROWSERS, but any container on the shared
// umbrel_main_network could previously reach this API directly and read or
// mutate config (payout address, miner voltage/frequency, webhooks). Every
// sensitive route now requires the key below. Trust-on-first-use: the key is
// generated at first boot and handed out exactly once via /api/auth/claim —
// the first browser session claims it silently (no login UX), and it persists
// in that browser's localStorage. Additional devices paste it once (revealed
// in Settings on a claimed device, or `cat data/config/api-key` over SSH).
const API_KEY_FILE = path.join(CONFIG_DIR, 'api-key');
const API_KEY_CLAIM_FILE = path.join(CONFIG_DIR, 'api-key.claimed');
let apiKey = null;
try {
  if (fs.existsSync(API_KEY_FILE)) {
    apiKey = fs.readFileSync(API_KEY_FILE, 'utf8').trim();
  }
  if (!apiKey) {
    apiKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(API_KEY_FILE, apiKey + '\n', { mode: 0o600 });
    console.log('[auth] generated new API key at', API_KEY_FILE);
  }
} catch (e) {
  console.error('[auth] FATAL: cannot create/read API key:', e.message);
  process.exit(1);
}
const keyClaimed = () => fs.existsSync(API_KEY_CLAIM_FILE);
const timingSafeEq = (a, b) => {
  const ba = Buffer.from(String(a || '')), bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};
const requestKey = (req) => req.get('x-api-key') || (req.query ? req.query.key : null);
// Keyless allowlist — every entry is public-stats or infrastructural:
//   /api/health            Docker healthcheck (wget from inside the container)
//   /api/widget/four-stats umbreld fetches it directly for the home-screen tile
//   /api/auth/claim        the one-time bootstrap itself
const AUTH_EXEMPT = new Set(['/api/health', '/api/widget/four-stats', '/api/auth/claim', '/api/ports']);
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();   // /metrics + static: not ours
  if (AUTH_EXEMPT.has(req.path)) return next();
  if (timingSafeEq(requestKey(req), apiKey)) return next();
  return res.status(401).json({ error: 'unauthorized', hint: 'X-Api-Key required' });
});


// v1.11.x SAFETY: Trust X-Forwarded-* headers only when the immediate
// proxy is on loopback. The Umbrel app_proxy connects to the API container
// on the internal docker network (loopback from the API's perspective),
// so this resolves req.ip to the real client IP for rate-limiting purposes.
// Crucially, NOT 'true' — that would trust X-Forwarded-* from any source,
// allowing a malicious authenticated user to spoof their IP. With
// 'loopback', only loopback-originated proxy headers are honored.
app.set('trust proxy', 'loopback');

// v1.10.1 SECURITY: helmet adds defense-in-depth response headers.
// Carefully configured to NOT break Umbrel's webview (which iframes the
// app) and NOT break the React UI's heavy use of inline styles.
//   - frameguard: DISABLED (Umbrel webview iframes us; SAMEORIGIN would break it)
//   - contentSecurityPolicy: DISABLED (inline styles everywhere; Umbrel
//     handles CSP at the proxy level if needed)
//   - crossOriginEmbedderPolicy: DISABLED (would break WebGL canvases that
//     load CDN textures)
//   - hsts: DISABLED (UI is served over HTTP via Umbrel app_proxy; HSTS
//     would be a no-op today but could lock browsers into HTTPS-only if
//     Umbrel's proxy ever gets HTTPS, breaking direct LAN access. Leaving
//     it off is the safest choice for self-hosted apps.)
//
// What helmet DOES enable here that we want:
//   X-Content-Type-Options: nosniff       (no MIME sniffing)
//   X-DNS-Prefetch-Control: off           (no preemptive DNS)
//   Referrer-Policy: no-referrer          (don't leak app paths to webhooks)
//   X-Download-Options: noopen            (IE legacy, harmless)
//   X-Permitted-Cross-Domain-Policies: none
//   Origin-Agent-Cluster: ?1
app.use(helmet({
  frameguard: false,
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: false,
}));

app.use(cors());
app.use(express.json({ limit: '64kb' }));

function rateLimitFactory(maxPerMin = 60) {
  const buckets = new Map();
  // v1.11.x SAFETY: periodic cleanup so the buckets Map doesn't grow
  // unbounded over long uptimes. Each entry's `t` is the start of the
  // current 60s window; anything older than 5 min is stale. Runs every
  // 5 min — cheap (linear scan of small map). unref() so this timer
  // doesn't keep the process alive on shutdown.
  setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [ip, b] of buckets) {
      if (b.t < cutoff) buckets.delete(ip);
    }
  }, 5 * 60 * 1000).unref();
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
  // v3.3.0: the WebSocket bypasses Express middleware, so gate it here.
  try {
    const u = new URL(req.url, 'http://x');
    if (!timingSafeEq(u.searchParams.get('key'), apiKey)) { ws.close(4401, 'unauthorized'); return; }
  } catch (e) { ws.close(4401, 'unauthorized'); return; }

  if (wsClients >= MAX_WS_CLIENTS) {
    try { ws.close(); } catch {}
    return;
  }
  wsClients++;
  // v1.11.46 FIX: on-connection welcome message ships FULL transformState
  // (not compact). Reason: iOS aggressively backgrounds web/PWA tabs,
  // closing the WS every 6-7 minutes. Each reconnect previously got a
  // compact welcome with only 2-entry tails for spsHistory/hashrate.history/
  // statusHistory. Entries written by the server during the disconnect
  // window were silently lost — Strike Velocity chart bled samples over
  // time (debug showed 18 samples at 73min uptime, [hashrate-merge] gap
  // warning fired with 1142s gap). Closing+reopening the app "fixed" it
  // only because that triggered a fresh /api/state HTTP fetch on remount.
  //
  // Now: WS welcome = full state (~120KB once per reconnect), subsequent
  // setInterval broadcasts (every 3s) stay compact (~24KB). Net cost on
  // iOS: ~10 extra welcomes/hour × 100KB = ~1MB/hour, fully acceptable.
  // The client's existing merge logic already handles full-state arrivals
  // correctly (the conditional tail-merges are no-ops when full arrays
  // are present, so the outer { ...newData } spread sets them cleanly).
  try { ws.send(JSON.stringify({ type:'STATE_UPDATE', data: transformState(state) })); } catch {}
  try { ws.send(JSON.stringify({ type:'CONFIG', data: cfgPrivate() })); } catch {}
  ws.on('close', () => { wsClients--; });
});

// v3.3.0 TOFU bootstrap: hands the key out exactly once. After the first
// successful claim this endpoint returns 403 forever (until the key files are
// deleted over SSH, which regenerates+unclaims on restart). The race window is
// first-boot-to-first-browser-visit — same trust model as Bitcoin Core's
// .cookie file. Claimed devices can reveal the key via GET /api/auth/key.
// ── v3.5.0: Backup & Migrate ────────────────────────────────────────────────
// Moves an install's identity + settings + history to new hardware, or to the
// official app-store package (different app id => different data dir => Umbrel
// treats it as a fresh install). Covers the three JSON files under CONFIG_DIR.
//
// EXCLUDED ON PURPOSE: api-key / api-key.claimed. Each install mints its own —
// carrying one across would hand the destination's credential to whoever holds
// the backup file. They live in separate files, so they're excluded by
// construction rather than by filtering.
//
// SECURITY: the blob contains the Pulse private key. Both routes sit under
// /api/, so the v3.3.0 auth middleware already gates them.
const BACKUP_SCHEMA = 1;

app.get('/api/backup/export', async (req, res) => {
  try {
    const readOrNull = async (f) => {
      try { if (await fs.pathExists(f)) return await fs.readJson(f); } catch (e) {}
      return null;
    };
    const blob = {
      schema: BACKUP_SCHEMA,
      exportedAt: new Date().toISOString(),
      appVersion: state.version,
      files: {
        config:   await readOrNull(CONFIG_FILE),
        persist:  await readOrNull(PERSIST_FILE),
        webhooks: await readOrNull(HOOKS_FILE),
      },
      warning: 'Contains your Pulse private key. Anyone with this file can sign Pulse events as you. Store it offline.',
    };
    res.setHeader('Content-Disposition', 'attachment; filename="lonestrike-backup.json"');
    return res.json(blob);
  } catch (e) {
    console.error('[backup] export failed:', e.message);
    return res.status(500).json({ error: 'export-failed' });
  }
});

// The global body limit is 64kb — deliberately tight, since every other route
// takes small payloads and a low ceiling is free DoS protection. A real backup
// blows past it (worker status history alone runs ~48kb, before spsHistory and
// snapshots), so this ONE route gets its own larger parser. Without it the
// feature would work on empty test installs and 413 for exactly the users with
// history worth migrating.
app.post('/api/backup/import', express.json({ limit: '8mb' }), async (req, res) => {
  try {
    const blob = req.body;
    if (!blob || typeof blob !== 'object') return res.status(400).json({ error: 'bad-blob' });
    if (blob.schema !== BACKUP_SCHEMA) return res.status(400).json({ error: 'schema-mismatch', expected: BACKUP_SCHEMA, got: blob.schema });
    const f = blob.files;
    if (!f || typeof f !== 'object') return res.status(400).json({ error: 'no-files' });
    if (!f.config && !f.persist) return res.status(400).json({ error: 'empty-backup' });
    // Sanity-check the identity if one is present: a malformed key would leave
    // Pulse unable to sign, and the failure would surface far from here.
    const pk = f.persist && f.persist.nostrPrivkey;
    if (pk != null && typeof pk !== 'string') return res.status(400).json({ error: 'bad-identity' });

    await fs.ensureDir(CONFIG_DIR);
    if (f.config)   await fs.writeJson(CONFIG_FILE,  f.config,   { spaces: 2 });
    if (f.persist)  await fs.writeJson(PERSIST_FILE, f.persist,  { spaces: 2 });
    if (f.webhooks) await fs.writeJson(HOOKS_FILE,   f.webhooks, { spaces: 2 });
    console.log('[backup] imported (schema', blob.schema + ', from', (blob.appVersion || 'unknown') + ') — restart required');
    return res.json({ ok: true, restartRequired: true });
  } catch (e) {
    console.error('[backup] import failed:', e.message);
    return res.status(500).json({ error: 'import-failed' });
  }
});

app.get('/api/auth/claim', (req, res) => {
  if (keyClaimed()) return res.status(403).json({ error: 'already-claimed' });
  try { fs.writeFileSync(API_KEY_CLAIM_FILE, String(Date.now()), { mode: 0o600 }); }
  catch (e) { return res.status(500).json({ error: 'claim-persist-failed' }); }
  console.log('[auth] API key claimed by', req.ip);
  return res.json({ key: apiKey });
});
// Authenticated reveal — lets a claimed device show the key for pairing others.
app.get('/api/auth/key', (req, res) => res.json({ key: apiKey }));

// v3.6.5: host-side stratum ports, resolved from compose env. The official
// app-store package maps different host ports (32222-32225) than the community
// package (3333/3334/4333/4334); the UI displays whatever the env says so
// in-app connection instructions are always correct for the install. Keyless:
// these are connection instructions, not secrets.
const STRATUM_PORTS = {
  main:     process.env.STRATUM_PORT          || '3333',
  hobby:    process.env.STRATUM_PORT_HOBBY    || '3334',
  tls:      process.env.STRATUM_PORT_TLS      || '4333',
  nicehash: process.env.STRATUM_PORT_NICEHASH || '4334',
};
app.get('/api/ports', (req, res) => res.json(STRATUM_PORTS));
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// v1.8.4: detailed system health endpoint for the System Health card.
// The existing /api/health (above) is a tiny ping kept for back-compat with
// any external monitoring. This endpoint aggregates 6 health signals:
//   containers, api, persistence, ckpool, zmq, disk
// Each returns { status: 'green'|'amber'|'red', value: '<display string>' }.
// Polled by the UI every 5s. Cheap to compute (one statSync, one execFileSync).
app.get('/api/health/detailed', (req, res) => {
  try {
    const now = Date.now();
    const { execFileSync } = require('child_process');

    // ── containers ─────────────────────────────────────────────────────
    // From inside the API container we cannot enumerate sibling containers
    // without docker socket access (handoff Option B, deferred to v1.9).
    // For v1 we use signals we DO have:
    //   - api: alive (we're answering)
    //   - ckpool: alive if state.status === 'running' AND we've seen shares recently
    // The other 3 (ui, stunnel, app_proxy) we can't probe — show "verified" for
    // the 2 we can confirm, surface that limitation honestly in the value.
    const ckpoolHealthy = (state.status === 'running')
      && state.shares?.lastShareAt
      && (now - state.shares.lastShareAt) < 600000; // 10min

    const containers = ckpoolHealthy
      ? { status: 'green', value: 'API + ckpool OK' }
      : (state.status === 'running'
          ? { status: 'amber', value: 'API OK · ckpool quiet' }
          : { status: 'red',   value: `API up · status: ${state.status}` });

    // ── api ────────────────────────────────────────────────────────────
    const apiErrors = state.errorCount?.lastHour || 0;
    const api = {
      status: apiErrors === 0 ? 'green' : (apiErrors < 6 ? 'amber' : 'red'),
      value:  `Healthy · ${apiErrors} error${apiErrors === 1 ? '' : 's'}`,
    };

    // ── persistence ────────────────────────────────────────────────────
    const spsCount = (state.shares?.spsHistory || []).length;
    let persistMtimeAge = null;
    try {
      const stat = fs.statSync(PERSIST_FILE);
      persistMtimeAge = now - stat.mtimeMs;
    } catch {}
    const persistence = {
      status: spsCount === 0 ? 'red'
            : spsCount < 60   ? 'amber'
            : 'green',
      value:  spsCount === 0
            ? 'No samples'
            : `${spsCount} samples · ${(spsCount / 60).toFixed(1)}h`,
    };

    // ── ckpool ─────────────────────────────────────────────────────────
    const lastShareAge = state.shares?.lastShareAt
      ? (now - state.shares.lastShareAt)
      : Infinity;
    const fmtAge = (ms) => {
      if (ms < 60000)        return `${Math.floor(ms / 1000)}s ago`;
      if (ms < 3600000)      return `${Math.floor(ms / 60000)}m ago`;
      return `${Math.floor(ms / 3600000)}h ago`;
    };
    const ckpool = {
      status: lastShareAge < 120000  ? 'green'
            : lastShareAge < 600000  ? 'amber'
            : 'red',
      value:  lastShareAge === Infinity
            ? 'No shares yet'
            : `Share ${fmtAge(lastShareAge)}`,
    };

    // ── zmq ────────────────────────────────────────────────────────────
    const zmqEnabled    = state.zmq?.enabled === true;
    const zmqLastBlock  = state.zmq?.lastBlockHeardAt || null;
    const zmqAge        = zmqLastBlock ? (now - zmqLastBlock) : Infinity;
    let zmq;
    if (!zmqEnabled) {
      zmq = { status: 'amber', value: 'Disabled' };
    } else if (zmqAge === Infinity) {
      zmq = { status: 'amber', value: 'Active · no blocks heard yet' };
    } else if (zmqAge < 1800000) {
      zmq = { status: 'green', value: `Active · ${fmtAge(zmqAge)}` };
    } else if (zmqAge < 3600000) {
      zmq = { status: 'amber', value: `Stale · ${fmtAge(zmqAge)}` };
    } else {
      zmq = { status: 'red',   value: `Stale · ${fmtAge(zmqAge)}` };
    }

    // ── disk ───────────────────────────────────────────────────────────
    let diskFreePct = null;
    try {
      // v1.11.x SECURITY: use execFileSync (no shell) instead of execSync.
      // The previous shell-interpolated `df ${CONFIG_DIR}` was vulnerable
      // to injection if CONFIG_DIR ever contained shell metacharacters
      // (Docker compose sets it to /app/config, but defense-in-depth).
      // We also lose shell pipes/redirects, so parse df output in JS:
      // typical output is two lines, last line is the data row, 5th column
      // (index 4) is the "Use%" percentage.
      const raw = execFileSync('df', [CONFIG_DIR], {
        timeout: 1000,
        stdio: ['ignore', 'pipe', 'ignore'], // suppress stderr (replaces 2>/dev/null)
      }).toString();
      const lines = raw.trim().split('\n');
      if (lines.length >= 2) {
        const cols = lines[lines.length - 1].split(/\s+/);
        const usedPct = parseInt(cols[4], 10);
        if (Number.isFinite(usedPct)) diskFreePct = 100 - usedPct;
      }
    } catch {}
    const disk = diskFreePct === null
      ? { status: 'amber', value: 'Unknown' }
      : diskFreePct > 20
        ? { status: 'green', value: `${diskFreePct}% free` }
        : diskFreePct > 10
          ? { status: 'amber', value: `${diskFreePct}% free` }
          : { status: 'red',   value: `${diskFreePct}% free` };

    const checks = { containers, api, persistence, ckpool, zmq, disk };
    const reds   = Object.values(checks).filter(c => c.status === 'red').length;
    const ambers = Object.values(checks).filter(c => c.status === 'amber').length;
    const overall = reds > 0 ? 'red' : (ambers > 0 ? 'amber' : 'green');

    const mem = process.memoryUsage();
    res.json({
      overall,
      checks,
      details: {
        version: state.version,
        uptime: now - state.startedAt,
        persistMtimeAge,
        memoryUsage: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
        },
        recentErrors: (state.errorCount?.recent || []).slice(0, 10),
        wsClients,
        privateMode: !!state.privateMode,
        zmqEndpoint: state.zmq?.endpoint || null,
      },
    });
  } catch (e) {
    // Don't throw — the health endpoint must never fail loudly. UI shows
    // a degraded card if the structure is malformed.
    console.error('[health/detailed]', e && (e.stack || e.message));
    res.status(500).json({
      overall: 'red',
      checks: {},
      error: 'Internal server error',
    });
  }
});
app.get('/api/state',  (req, res) => res.json(transformState(state)));
app.get('/api/config', (req, res) => res.json(cfgPrivate()));
// Wizard alias for /api/config — accepts {payoutAddress} only
app.post('/api/setup', async (req, res) => {
  try {
    const { payoutAddress } = req.body || {};
    if (!payoutAddress) return res.status(400).json({ error: 'payoutAddress required' });
    const t = String(payoutAddress).trim();
    if (!isValidBtcAddress(t)) return res.status(400).json({ error: 'Invalid BTC address' });
    cfg.payoutAddress = t;
    await saveConfig();
    await writeCkpoolConf();
    if (cfg.payoutAddress && (state.status === 'no_address' || state.status === 'starting')) state.status = 'running';
    res.json({ ok: true });
    broadcast({ type: 'CONFIG', data: cfgPrivate() });
  } catch (e) {
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post('/api/config', async (req, res) => {
  try {
    // v1.11.4: poolName removed from accepted fields — UI no longer exposes it.
    // Webhook payloads now hardcode 'SoloStrike' as the pool value (see line ~271).
    const { payoutAddress, privateMode, privacy } = req.body || {};
    let addressChanged = false;
    if (payoutAddress != null) {
      const t = String(payoutAddress).trim();
      if (!isValidBtcAddress(t)) return res.status(400).json({ error: 'Invalid BTC address' });
      if (t !== cfg.payoutAddress) addressChanged = true;
      cfg.payoutAddress = t;
      state.payoutAddress = t;
    }
    if (typeof privateMode === 'boolean') {
      const changed = !!cfg.privateMode !== privateMode;
      cfg.privateMode = privateMode;
      state.privateMode = privateMode;
      // v3.4.0: apply immediately — tear down (or resume) Pulse relay
      // connections without waiting for an API restart.
      if (changed) {
        try { if (networkStatsController && networkStatsController.applyPrivacy) networkStatsController.applyPrivacy(); }
        catch (e) { console.warn('[config] applyPrivacy failed:', e.message); }
      }
    }
    // v3.6.0: per-service privacy toggles. Master privateMode always wins; these
    // only matter with the lockdown off. Unknown keys dropped, values coerced to
    // boolean, absent = enabled. Pulse flips also tear down / resume live relay
    // sockets via the same applyPrivacy path as the master toggle.
    if (privacy && typeof privacy === 'object') {
      const PRIVACY_KEYS = ['pulse', 'registry', 'fees', 'blocks', 'price', 'webhooks', 'mapData'];
      const prevPulseOn = !(cfg.privacy && cfg.privacy.pulse === false);
      cfg.privacy = cfg.privacy || {};
      for (const k of PRIVACY_KEYS) if (k in privacy) cfg.privacy[k] = !!privacy[k];
      state.privacy = { ...cfg.privacy };
      const nowPulseOn = !(cfg.privacy.pulse === false);
      if (prevPulseOn !== nowPulseOn) {
        try { if (networkStatsController && networkStatsController.applyPrivacy) networkStatsController.applyPrivacy(); }
        catch (e) { console.warn('[config] applyPrivacy (pulse toggle) failed:', e.message); }
      }
    }
    // v3.1.1: per-miner temp alert overrides. Merge semantics: { name: {amber,
    // red} } upserts, { name: null } clears. Values sanitized server-side so
    // every client agrees; capped to keep cfg bounded.
    const { tempOverrides } = req.body || {};
    if (tempOverrides && typeof tempOverrides === 'object' && !Array.isArray(tempOverrides)) {
      cfg.tempOverrides = cfg.tempOverrides || {};
      for (const [name, v] of Object.entries(tempOverrides)) {
        const key = String(name).slice(0, 64);
        if (v == null) { delete cfg.tempOverrides[key]; continue; }
        let amber = Math.round(Number(v.amber)), red = Math.round(Number(v.red));
        if (!Number.isFinite(amber) || !Number.isFinite(red)) continue;
        amber = Math.min(115, Math.max(40, amber));
        red   = Math.min(120, Math.max(amber + 1, red));
        if (Object.keys(cfg.tempOverrides).length >= 128 && !(key in cfg.tempOverrides)) continue;
        cfg.tempOverrides[key] = { amber, red };
      }
      state.tempOverrides = cfg.tempOverrides;
    }
    await saveConfig();
    if (addressChanged) await writeCkpoolConf();
    if (cfg.payoutAddress && (state.status === 'no_address' || state.status === 'starting')) state.status = 'running';
    res.json({ ok: true, ...cfgPublic() });
    broadcast({ type: 'CONFIG', data: cfgPrivate() });
  } catch (e) {
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ error: "Internal server error" });
  }
});

// CSV exports
// iter27c bug 5: proper RFC-4180 quoting. Worker names, miner subversion
// strings, and pool names can contain commas, quotes, or newlines. Wrap
// each field in "..." and double any embedded quotes.
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  // Always quote — keeps output uniform and safe against future special chars.
  return '"' + s.replace(/"/g, '""') + '"';
}
function rowsToCsv(rows) {
  return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

app.get('/api/export/blocks.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="solostrike-blocks.csv"');
  const rows = [['height','hash','timestamp','reward_btc']];
  (state.blocks || []).forEach(b => rows.push([b.height, b.hash, b.ts, b.reward || '']));
  res.send(rowsToCsv(rows));
});

app.get('/api/export/workers.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="solostrike-workers.csv"');
  const wl = Object.values(state.workers || {});
  const rows = [['name','status','hashrate','accepted','rejected','best','last_seen','miner_type']];
  wl.forEach(w => rows.push([w.name, w.status, w.hashrate || 0, w.shares || 0, w.rejected || 0, ((state.shareCounters && state.shareCounters[w.name] && state.shareCounters[w.name].bestSinceReset) || 0), w.lastSeen || 0, w.minerType || '']));
  res.send(rowsToCsv(rows));
});

// Reset best difficulty. Body: { worker } resets one miner; omit/null resets
// all. Zeros SoloStrike's best-since-reset (which every best-diff display reads)
// and clears the derived stores (Near Strikes, Best Share Trend) so nothing
// refills from ckpool. ckpool's cumulative lifetime best is left untouched and
// stays available as the per-worker/pool lifetime readout.
app.post('/api/reset-best-diff', (req, res) => {
  try {
    const worker = (req.body && typeof req.body.worker === 'string' && req.body.worker.trim())
      ? req.body.worker.trim() : null;
    if (worker) {
      if (state.shareCounters && state.shareCounters[worker]) {
        state.shareCounters[worker].bestSinceReset = 0;
        // v2.1.0 Strike Force: clear the share-diff ring so the histogram's
        // best bar can't disagree with the zeroed best-since-reset.
        state.shareCounters[worker].recentSdiffs = [];
      }
      // drop this worker from the Near Strikes leaderboard
      if (state.snapshots && Array.isArray(state.snapshots.closestCalls)) {
        state.snapshots.closestCalls = state.snapshots.closestCalls.filter(c => c.workerName !== worker);
      }
    } else {
      if (state.shareCounters) {
        for (const n of Object.keys(state.shareCounters)) {
          state.shareCounters[n].bestSinceReset = 0;
          state.shareCounters[n].recentSdiffs = [];
        }
      }
      // clear pool-wide derived stores so the trend + Near Strikes restart clean
      if (state.snapshots) { state.snapshots.closestCalls = []; state.snapshots.bestTrend = []; }
      if (state.shares && Array.isArray(state.shares.bestHistory)) state.shares.bestHistory = [];
      if (Array.isArray(state.closestCalls)) state.closestCalls = [];
    }
    savePersist({
      shareCounters: state.shareCounters,
      snapshots: state.snapshots,
      closestCalls: state.closestCalls,
    });
    res.json({ ok: true, scope: worker || 'all' });
  } catch (e) {
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post('/api/reset-share-stats', (req, res) => {
  try {
    if (state.shareCounters) {
      for (const name of Object.keys(state.shareCounters)) {
        const c = state.shareCounters[name];
        c.accepted = 0; c.rejected = 0; c.stale = 0; c.bestSdiff = 0;
        c.sdiffSum = 0;
        c.recentSdiffs = [];
        c.rejectReasons = {}; c.lastRejectReason = null; c.lastRejectAt = null;
      }
    }
    state.shares.acceptedCount = 0;
    state.shares.rejectedCount = 0;
    state.shares.stale = 0;
    state.shares.rejectReasons = {};
    state.shares.acceptedSdiffSum = 0;
    state.shareStatsStartedAt = Date.now();
    savePersist({
      shareCounters: state.shareCounters,
      shareStatsStartedAt: state.shareStatsStartedAt,
    });
    res.json({ ok: true, resetAt: state.shareStatsStartedAt });
  } catch (e) {
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ error: "Internal server error" });
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
  // v1.11.53: align with UI's fmtDiff() in utils.js — use SI prefixes (K/M/G/T/P),
  // 2 decimals, space before unit. Previous version used K/M/B/T with 1 decimal
  // and no space, which differed from the main dashboard ('5.22 G' vs '5.2B').
  // A tester flagged the inconsistency; matching the UI formatter for consistency.
  const formatCompact = (n) => {
    if (!n || n < 0 || !Number.isFinite(n)) return '0';
    if (n < 1000) return Math.round(n).toString();
    if (n < 1e6)  return (n / 1e3).toFixed(2) + ' K';
    if (n < 1e9)  return (n / 1e6).toFixed(2) + ' M';
    if (n < 1e12) return (n / 1e9).toFixed(2) + ' G';
    if (n < 1e15) return (n / 1e12).toFixed(2) + ' T';
    return (n / 1e15).toFixed(2) + ' P';
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
      const { name, url, events, allowInternal } = body;
      if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Invalid URL' });
      if (!Array.isArray(events) || !events.length) return res.status(400).json({ error: 'No events selected' });
      if ((state.webhooks || []).length >= MAX_HOOKS) return res.status(400).json({ error: `Max ${MAX_HOOKS} webhooks` });
      // v1.10.1 SECURITY: default-deny webhooks targeting private/loopback IPs.
      // Users with legitimate self-hosted services (Home Assistant on LAN, etc)
      // can opt in by checking the "Allow internal/LAN URL" toggle in the UI,
      // which sets allowInternal:true. The opt-in is per-webhook, not global.
      if (isPrivateUrl(url) && !allowInternal) {
        return res.status(400).json({
          error: 'This URL points to a private/local address (LAN, loopback, or .local hostname). If you are intentionally targeting a self-hosted service like Home Assistant, enable the "Allow internal/LAN URL" toggle in the form.'
        });
      }
      const id = 'wh_' + Math.random().toString(36).slice(2, 10);
      state.webhooks = [...(state.webhooks || []), {
        id,
        name: String(name || 'Webhook').slice(0, 50),
        url: String(url).slice(0, 500),
        events: events.filter(e => ['block_found','worker_offline','worker_online'].includes(e)),
        allowInternal: !!allowInternal,
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
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Miner pool-alignment polling (v1.9.0) ───────────────────────────────────
// Reads each authorised miner's local API to verify pool alignment + pull
// live telemetry (temps, fans, hardware errors). Read-only — no write
// commands ever sent. Default-on; disable with `"minerPolling": false` in
// config.json. All endpoints require Umbrel session.
app.get('/api/miners/alignments', (req, res) => {
  res.json({
    enabled:    isMinerPollerEnabled(),
    alignments: getAllAlignments(),
  });
});

app.get('/api/miners/live', (req, res) => {
  res.json({
    enabled: isMinerPollerEnabled(),
    live:    getAllLive(),
  });
});

// Combined endpoint — returns full per-worker records (alignment + live)
app.get('/api/miners/records', (req, res) => {
  res.json({
    enabled: isMinerPollerEnabled(),
    records: getAllRecords(),
  });
});

app.post('/api/miners/poll/:workerName', async (req, res) => {
  try {
    const result = await pollOneMiner(req.params.workerName);
    if (!result) return res.status(404).json({ error: 'worker not found or no IP' });
    res.json({ ok: true, record: result });
  } catch (e) {
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ error: "Internal server error" });
  }
});

// v2.x: WRITE settings to a miner. Session-gated (NOT in PROXY_AUTH_WHITELIST).
// Resolves the LAN IP from ckpool-harvested worker metadata — never from the
// client — and the adapter (esp-miner | cgminer) from the latest poll record.
// All values are clamped server-side in miner-control.dispatch().
app.post('/api/miners/control/:workerName', async (req, res) => {
  try {
    const name = req.params.workerName;
    const w = state.workers && state.workers[name];
    const ip = w && w.ip;
    if (!ip) return res.status(404).json({ ok: false, error: 'no_ip', message: 'No LAN IP harvested for this worker yet — reconnect it on a plain (3333) port so ckpool logs its address.' });
    const recs = (typeof getAllRecords === 'function') ? getAllRecords() : {};
    const rec = recs[name] || null;
    const adapter = rec && rec.adapter ? rec.adapter : null; // 'esp-miner' | 'cgminer' | null
    // Device context for safe tuning: the per-device voltage envelope + whether
    // the miner exposed the AxeOS HTTP API (TNA-OS on Antminer/Avalon reports as
    // cgminer but IS HTTP-tunable). All sourced from the latest poll record.
    const live = (rec && rec.live) || {};
    const ctx = {
      model:        live.model || null,
      asicModel:    live.asicModel || null,
      coreVoltageMv: live.coreVoltageMv != null ? live.coreVoltageMv : null,
      minVoltageMv: live.minVoltageMv != null ? live.minVoltageMv : null,
      maxVoltageMv: live.maxVoltageMv != null ? live.maxVoltageMv : null,
      httpTunable:  !!live.httpTunable,
    };
    const body = req.body || {};
    const action = String(body.action || '');
    if (!['tuning', 'pool', 'restart', 'avalon'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'bad_action' });
    }
    const result = await minerControl.dispatch(ip, adapter, action, body, ctx);
    if (!result.ok) return res.status(502).json(result);
    res.json(result);
  } catch (e) {
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ ok: false, error: 'Internal server error' });
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

// v2.x: alias registry. Session-gated (NOT in PROXY_AUTH_WHITELIST). The claim is
// signed server-side with the node's Nostr key, where the key already lives.
app.get('/api/alias/status', (req, res) => {
  if (!networkStatsController || typeof networkStatsController.getAliasStatus !== 'function') {
    return res.status(503).json({ error: 'network-stats not initialized yet' });
  }
  res.json(networkStatsController.getAliasStatus());
});

app.post('/api/alias/claim', async (req, res) => {
  try {
    if (!networkStatsController || typeof networkStatsController.submitAliasClaim !== 'function') {
      return res.status(503).json({ ok: false, error: 'network-stats not initialized yet' });
    }
    const name = req.body && req.body.name;
    if (!name || typeof name !== 'string') return res.status(400).json({ ok: false, error: 'missing_name' });
    const result = await networkStatsController.submitAliasClaim(name);
    res.status(result && result.ok ? 200 : 409).json(result);
  } catch (e) {
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
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

// User pool location pin. Body: { lat, lon } — both numbers — or
// { lat: null, lon: null } to clear. Server always snaps to 5° grid before
// storing or broadcasting (privacy invariant: never finer than ~500km).
app.post('/api/network-stats/location', async (req, res) => {
  if (!networkStatsController) return res.status(503).json({ error: 'network-stats not initialized yet' });
  if (typeof networkStatsController.setPoolLocation !== 'function') {
    return res.status(501).json({ error: 'setPoolLocation not supported in this API version' });
  }
  const { lat, lon } = req.body || {};
  if (lat === null && lon === null) {
    networkStatsController.setPoolLocation(null);
    await saveConfig();
    return res.json({ ok: true, location: null });
  }
  const latNum = Number(lat), lonNum = Number(lon);
  if (!Number.isFinite(latNum) || !Number.isFinite(lonNum)) {
    return res.status(400).json({ error: 'lat and lon must be numbers' });
  }
  const ok = networkStatsController.setPoolLocation([latNum, lonNum]);
  if (!ok) return res.status(400).json({ error: 'Coordinates out of range (lat: -90..90, lon: -180..180)' });
  await saveConfig();
  res.json({ ok: true, location: cfg.poolLocation });
});

// Self-declared roster flag. Body: { code } — a region code ("US" / "US-TX")
// or null/'' to clear (fall back to the geo-guess from the pin). No
// coordinates involved; just the region code the user chose to display.
app.post('/api/network-stats/roster-flag', async (req, res) => {
  if (!networkStatsController) return res.status(503).json({ error: 'network-stats not initialized yet' });
  if (typeof networkStatsController.setRosterFlag !== 'function') {
    return res.status(501).json({ error: 'setRosterFlag not supported in this API version' });
  }
  const { code } = req.body || {};
  const ok = networkStatsController.setRosterFlag(code == null ? null : code);
  if (!ok) return res.status(400).json({ error: 'Invalid region code (expected "US" or "US-TX" form, or null to clear)' });
  await saveConfig();
  res.json({ ok: true, rosterFlag: cfg.rosterFlag });
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
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ error: "Internal server error" });
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
    console.error("[api error]", req.method, req.path, e && (e.stack || e.message));
    res.status(500).json({ error: "Internal server error" });
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
    // v1.11.46: diagnostic — log broadcast size every 60 seconds so we can
  // verify the compact mode actually reduces payload. Remove after confirming.
  const _payload = JSON.stringify({ type: 'STATE_UPDATE', data: transformState(state, { compact: true }) });
  if (!global.__ssLastSizeLog || Date.now() - global.__ssLastSizeLog > 60000) {
    console.log('[broadcast] STATE_UPDATE size:', _payload.length, 'bytes');
    global.__ssLastSizeLog = Date.now();
  }
  broadcast({ type: 'STATE_UPDATE', data: transformState(state, { compact: true }) });
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
        await applyDailySnapshot(state.snapshots, snap);
        await savePersist({ snapshots: state.snapshots, closestCalls: state.closestCalls });
      } catch (e) { console.error('[snapshots] daily failed:', e.message); }
      scheduleNextRollup();
    }, ms);
  };
  scheduleNextRollup();

  setInterval(() => {
    try {
      updateClosestCalls(state.snapshots, state);
      // v1.12.0: persist block-effort history + best-share trend samples.
      const effChanged  = syncBlockEffort(state.snapshots, state);
      const bestChanged = sampleBestTrend(state.snapshots, state);
      if (effChanged || bestChanged) {
        savePersist({ snapshots: state.snapshots, closestCalls: state.closestCalls })
          .catch(e => console.error('[snapshots] persist failed:', e.message));
      }
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
  if (persist.snapshots) {
    state.snapshots = persist.snapshots;
    // v1.12.0 upgrade-safe backfill: older persist files lack these arrays.
    if (!Array.isArray(state.snapshots.blockEffort)) state.snapshots.blockEffort = [];
    if (!Array.isArray(state.snapshots.bestTrend))   state.snapshots.bestTrend = [];
  }
  if (persist.webhooks) state.webhooks = persist.webhooks;
  if (persist.nostrPrivkey) cfg.nostrPrivkey = persist.nostrPrivkey;
  // v3.6.3: restore the claimed alias (see saveIdentity for why it was lost)
  if (typeof persist.pulseAlias === 'string' && persist.pulseAlias) cfg.pulseAlias = persist.pulseAlias;
  if (persist.nostrInstallId) cfg.nostrInstallId = persist.nostrInstallId;
  if (typeof persist.networkStatsEnabled === 'boolean') cfg.networkStatsEnabled = persist.networkStatsEnabled;
  if (persist.pulseDeviceSalt) cfg.pulseDeviceSalt = persist.pulseDeviceSalt;
  if (typeof persist.pulseTorEnabled === 'boolean') cfg.pulseTorEnabled = persist.pulseTorEnabled;
  // v1.12.x: restore pulseFirstSeen so "Joined Nd ago" survives restarts
  if (Number.isFinite(persist.pulseFirstSeen) && persist.pulseFirstSeen > 0) {
    cfg.pulseFirstSeen = persist.pulseFirstSeen;
  }
  // iter28-fix: restore Strike Velocity ring buffer + per-worker uptime sparklines
  // from disk so 24h history survives restarts. Drop samples older than 24h on load.
  if (Array.isArray(persist.spsHistory)) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    state.shares.spsHistory = persist.spsHistory.filter(p => p && p.ts > cutoff);
  }
  if (persist.workersStatusHistory && typeof persist.workersStatusHistory === 'object') {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [name, hist] of Object.entries(persist.workersStatusHistory)) {
      if (!Array.isArray(hist)) continue;
      const filtered = hist.filter(p => p && p.ts > cutoff);
      if (!state.workers[name]) {
        // Worker not yet rediscovered from ckpool; create a minimal stub so
        // the history isn't lost. Will be filled in on next status poll.
        state.workers[name] = {
          name, hashrate: 0, shares: 0, rejected: 0,
          sharesCount: 0, rejectedCount: 0,
          lastSeen: 0, diff: 0, status: 'offline',
          bestshare: 0,
          minerType: null, minerIcon: '▪', minerVendor: null,
          minerSource: 'unknown', userAgent: null,
          ip: null, health: 'green',
          statusHistory: filtered,
        };
      } else {
        state.workers[name].statusHistory = filtered;
      }
    }
  }
  state.privateMode = !!cfg.privateMode;
  state.privacy = { ...(cfg.privacy || {}) };
  state.tempOverrides = cfg.tempOverrides || {};
  state.payoutAddress = cfg.payoutAddress || null;

  // v1.11.58: sync ckpool.conf to the saved payout address on every boot.
  // Fixes the case where the address was saved (config.json) but ckpool.conf
  // still held the init placeholder — e.g. the address was set before a
  // restart, or re-submitted unchanged (which skipped the per-request write).
  // Idempotent and safe; takes effect in ckpool on its next restart. Payouts
  // already route via miner username regardless (--btcsolo).
  await writeCkpoolConf();

  try {
    const loaded = await loadSnapshots(CONFIG_DIR);
    if (loaded) state.snapshots = loaded;
  } catch (e) { console.error('snapshot load failed:', e.message); }

  setInterval(pollBitcoind, 15000);
  setInterval(pollMempool,  60000);
  setInterval(pollBlocks,   120000);
  setInterval(pollPrices,   300000);
  // v3.1.0: oracle cadence -- first attempt 3min after boot (node RPC warm),
  // then every 30min (cheap no-op via header check until the UTC day rolls).
  setTimeout(maybeRunOracle, 3 * 60 * 1000);
  setInterval(maybeRunOracle, 30 * 60 * 1000);

  // v1.11.58: fire-and-forget the initial polls instead of awaiting them.
  // These were previously awaited before server.listen(), so a slow or
  // not-yet-ready bitcoind RPC at cold boot stalled the api from binding
  // its port — the app looked dead until a manual restart. The setInterval
  // above already schedules recurring polls; these immediate calls just
  // populate state ASAP in the background, and the UI renders each value
  // as it resolves. .catch guards prevent unhandled rejections.
  pollBitcoind().catch(() => {});
  pollMempool().catch(() => {});
  pollBlocks().catch(() => {});
  pollPrices().catch(() => {});

  if (!cfg.payoutAddress) {
    state.status = 'no_address';
  } else {
    state.status = 'starting';
  }

  await loadHooks();

  // Subsystems
  startZmq();
  startUaTailer({ configDir: CONFIG_DIR, logDir: CKPOOL_LOG_DIR });
  // v1.9.0: Miner polling is default-on. Power-user escape hatch: set
  // `"minerPolling": false` in config.json. The poller is fully read-only
  // (only sends `pools|summary|stats` over local LAN) so default-on is
  // safe — and most users would never find a Settings toggle anyway.
  startMinerPoller({
    configDir: CONFIG_DIR,
    getMeta: getAllMeta,
    getPayoutAddress: () => cfg.payoutAddress,
    getWorkerVendor: (workerName) => {
      const w = state.workers && state.workers[workerName];
      return w ? (w.minerVendor || null) : null;
    },
    enabled: cfg.minerPolling !== false,
  });
  startStatusPoller(state, broadcast, CKPOOL_LOG_DIR);
  startSnapshotScheduler();
  startStratumHealthPoller();
  startBlockWatcher({ state, broadcast, fireHooks, savePersist, logDir: CKPOOL_LOG_DIR });
  startShareWatcher({ state, logDir: CKPOOL_LOG_DIR, savePersist, broadcast });
  networkStatsController = startNetworkStats({ state, cfg, savePersist, getLive: getAllLive });

  // iter28-fix: persist Strike Velocity ring buffer + per-worker uptime
  // sparklines to disk every 60 seconds so they survive restarts.
  // 24h coverage means losing up to 60s of latest data on hard crash —
  // acceptable trade vs the alternative (full data loss).
  async function saveHistoryBuffers() {
    try {
      const workersStatusHistory = {};
      for (const [name, w] of Object.entries(state.workers || {})) {
        if (Array.isArray(w.statusHistory) && w.statusHistory.length > 0) {
          workersStatusHistory[name] = w.statusHistory;
        }
      }
      await savePersist({
        spsHistory: Array.isArray(state.shares?.spsHistory) ? state.shares.spsHistory : [],
        workersStatusHistory,
      });
    } catch (e) {
      console.error('[persist] saveHistoryBuffers failed:', e.message);
    }
  }
  setInterval(saveHistoryBuffers, 60 * 1000);

  // Save once on graceful shutdown so the most recent samples don't get lost
  // on a clean container restart (Umbrel app updates, etc.)
  const onShutdown = async (sig) => {
    console.log(`[shutdown] ${sig} received, flushing history buffers…`);
    try { await saveHistoryBuffers(); } catch {}
    process.exit(0);
  };
  process.once('SIGTERM', () => onShutdown('SIGTERM'));
  process.once('SIGINT',  () => onShutdown('SIGINT'));

  setTimeout(() => {
    if (state.status === 'starting' && cfg.payoutAddress) state.status = 'running';
  }, 5000);
  // UI expects uptime as a Unix millisecond timestamp of boot time.
  // It computes (Date.now() - state.uptime) to get elapsed time client-side.
  state.uptime = state.startedAt;

  // v1.8.4: error-tracking middleware for the System Health card.
  // Registered LAST so it sees errors from all earlier middleware/routes.
  // Increments state.errorCount.lastHour and pushes onto recent[].
  // Does not change response shape — still returns 500 with {error: msg}.
  app.use((err, req, res, next) => {
    try {
      state.errorCount.lastHour = (state.errorCount.lastHour || 0) + 1;
      state.errorCount.recent.unshift({
        ts: Date.now(),
        msg: err?.message || String(err),
        path: req?.path || '',
      });
      if (state.errorCount.recent.length > 10) state.errorCount.recent.length = 10;
    } catch {}
    console.error('[api error]', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err?.message || 'Internal error' });
  });

  // v1.8.4: reset rolling error counter every 60min. The recent[] log is
  // kept (last 10 errors regardless of age) for diagnostic context.
  setInterval(() => {
    state.errorCount.lastHour = 0;
  }, 3600000);

  server.listen(PORT, () => {
    console.log(`[SoloStrike API v${state.version}] Listening on :${PORT} (privateMode=${state.privateMode})`);
  });
}

main().catch(e => {
  console.error('Boot failed:', e);
  process.exit(1);
});
