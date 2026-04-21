// metrics.js — Customizable Top Strip metric registry
// Each metric defines how to read it from state + how to render it
import {
fmtHr,
fmtDiff,
fmtNum,
fmtOdds,
fmtPct,
fmtBtc,
fmtFiat,
fmtUptime,
timeAgo,
fmtAgoShort,
fmtDurationMs
} from ‘./utils.js’;

// Helpers used by some metrics
function workerHealthBreakdown(workers) {
const w = workers || [];
let g = 0, a = 0, r = 0;
for (const x of w) {
if (x.status === ‘offline’) { r++; continue; }
if (x.health === ‘green’) g++;
else if (x.health === ‘amber’) a++;
else if (x.health === ‘red’) r++;
}
return { green: g, amber: a, red: r };
}

function hashrateTrend(history) {
const h = history || [];
if (h.length < 10) return { pct: 0, direction: ‘flat’ };
const recent = h.slice(-5).reduce((s, p) => s + (p.hr || 0), 0) / 5;
const older  = h.slice(-60, -10);
if (!older.length) return { pct: 0, direction: ‘flat’ };
const olderAvg = older.reduce((s, p) => s + (p.hr || 0), 0) / older.length;
if (!olderAvg) return { pct: 0, direction: ‘flat’ };
const pct = ((recent - olderAvg) / olderAvg) * 100;
return { pct, direction: Math.abs(pct) < 1 ? ‘flat’ : pct > 0 ? ‘up’ : ‘down’ };
}

function stabilityIndex(history) {
const h = (history || []).slice(-60);
if (h.length < 5) return null;
const vals = h.map(p => p.hr || 0);
const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
if (!mean) return null;
const variance = vals.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / vals.length;
const cv = Math.sqrt(variance) / mean; // coefficient of variation
return cv;
}

function mempoolCongestion(feeRate) {
if (feeRate == null) return null;
if (feeRate >= 100) return ‘HIGH’;
if (feeRate >= 30)  return ‘MEDIUM’;
return ‘LOW’;
}

function daysUntilHalving(currentHeight) {
if (!currentHeight) return null;
const nextHalvingHeight = Math.ceil(currentHeight / 210000) * 210000;
const blocksLeft = nextHalvingHeight - currentHeight;
const minutesLeft = blocksLeft * 10;
return Math.round(minutesLeft / 60 / 24);
}

function blocksUntilHalving(currentHeight) {
if (!currentHeight) return null;
const nextHalvingHeight = Math.ceil(currentHeight / 210000) * 210000;
return nextHalvingHeight - currentHeight;
}

function topWorker(workers) {
const w = (workers || []).filter(x => x.status !== ‘offline’);
if (!w.length) return null;
return w.reduce((best, x) => (x.hashrate || 0) > (best.hashrate || 0) ? x : best, w[0]);
}

function avgLastShareAge(workers) {
const w = (workers || []).filter(x => x.status !== ‘offline’ && x.lastSeen);
if (!w.length) return null;
const now = Date.now();
const sum = w.reduce((s, x) => s + (now - x.lastSeen), 0);
return sum / w.length;
}

// ── THE REGISTRY ─────────────────────────────────────────────────────────────
// Each entry: { id, label, category, color, render(state, currency, uptime) }
// render() returns { value: string, prefix?: string }
export const METRICS = [
// ── PERFORMANCE ──
{ id: ‘pool_hashrate’, label: ‘Pool Hashrate’, category: ‘Performance’, color: ‘var(–amber)’,
render: (s) => ({ prefix: ‘POOL’, value: fmtHr(s.hashrate?.current) }) },
{ id: ‘hashrate_trend’, label: ‘Hashrate Trend’, category: ‘Performance’, color: ‘var(–cyan)’,
render: (s) => {
const t = hashrateTrend(s.hashrate?.history);
if (t.direction === ‘flat’) return { prefix: ‘TREND’, value: ‘—’ };
const arrow = t.direction === ‘up’ ? ‘📈’ : ‘📉’;
return { prefix: ‘TREND’, value: `${arrow} ${t.pct>=0?'+':''}${t.pct.toFixed(1)}%` };
} },
{ id: ‘stability’, label: ‘Stability’, category: ‘Performance’, color: ‘var(–cyan)’,
render: (s) => {
const cv = stabilityIndex(s.hashrate?.history);
if (cv == null) return { prefix: ‘STABILITY’, value: ‘—’ };
const label = cv < 0.1 ? ‘ROCK SOLID’ : cv < 0.25 ? ‘STEADY’ : cv < 0.5 ? ‘FLUX’ : ‘VOLATILE’;
return { prefix: ‘STABILITY’, value: label };
} },
{ id: ‘accept_rate’, label: ‘Accept Rate’, category: ‘Performance’, color: ‘var(–green)’,
render: (s) => {
const a = s.shares?.accepted || 0, r = s.shares?.rejected || 0;
const t = a + r || 1;
return { prefix: ‘ACCEPT’, value: `${((a/t)*100).toFixed(2)}%` };
} },
{ id: ‘shares_per_min’, label: ‘Shares/Min’, category: ‘Performance’, color: ‘var(–text-1)’,
render: (s) => {
const hr = s.hashrate?.current || 0;
return { prefix: ‘SHARES/M’, value: hr>0 ? (hr/4294967296*60).toFixed(1) : ‘0’ };
} },
{ id: ‘best_share_today’, label: ‘Best Today’, category: ‘Performance’, color: ‘var(–amber)’,
render: (s) => ({ prefix: ‘BEST (ALL)’, value: fmtDiff(s.bestshare || 0) }) },

// ── WORKERS ──
{ id: ‘worker_health’, label: ‘Worker Health’, category: ‘Workers’, color: ‘var(–text-1)’,
render: (s) => {
const h = workerHealthBreakdown(s.workers);
return { prefix: ‘WORKERS’, value: `🟢${h.green} 🟡${h.amber} 🔴${h.red}` };
} },
{ id: ‘workers_online’, label: ‘Workers Online’, category: ‘Workers’, color: ‘var(–green)’,
render: (s) => {
const total = (s.workers || []).length;
const online = (s.workers || []).filter(w => w.status !== ‘offline’).length;
return { prefix: ‘ONLINE’, value: `${online}/${total}` };
} },
{ id: ‘workers_offline’, label: ‘Workers Offline’, category: ‘Workers’, color: ‘var(–red)’,
render: (s) => {
const off = (s.workers || []).filter(w => w.status === ‘offline’).length;
return { prefix: ‘OFFLINE’, value: `${off}` };
} },
{ id: ‘avg_share_age’, label: ‘Avg Share Age’, category: ‘Workers’, color: ‘var(–cyan)’,
render: (s) => {
const avg = avgLastShareAge(s.workers);
if (avg == null) return { prefix: ‘AVG AGE’, value: ‘—’ };
return { prefix: ‘AVG AGE’, value: fmtAgoShort(Date.now() - avg) };
} },
{ id: ‘top_performer’, label: ‘Top Performer’, category: ‘Workers’, color: ‘var(–amber)’,
render: (s, aliases) => {
const w = topWorker(s.workers);
if (!w) return { prefix: ‘TOP’, value: ‘—’ };
const name = (aliases && aliases[w.name]) || (w.name || ‘’).split(’.’).pop();
return { prefix: ‘TOP’, value: `${name} ${fmtHr(w.hashrate)}` };
} },

// ── ODDS / LUCK ──
{ id: ‘per_day’, label: ‘Per Day Odds’, category: ‘Odds’, color: ‘var(–text-1)’,
render: (s) => {
const p = s.odds?.perDay;
return { prefix: ‘PER DAY’, value: p ? fmtPct(p*100, 4) : ‘—’ };
} },
{ id: ‘per_week’, label: ‘Per Week Odds’, category: ‘Odds’, color: ‘var(–text-1)’,
render: (s) => {
const p = s.odds?.perWeek;
return { prefix: ‘PER WEEK’, value: p ? fmtPct(p*100, 3) : ‘—’ };
} },
{ id: ‘per_month’, label: ‘Per Month Odds’, category: ‘Odds’, color: ‘var(–cyan)’,
render: (s) => {
const p = s.odds?.perMonth;
return { prefix: ‘PER MONTH’, value: p ? fmtPct(p*100, 2) : ‘—’ };
} },
{ id: ‘pool_share’, label: ‘Pool Share %’, category: ‘Odds’, color: ‘var(–cyan)’,
render: (s) => {
const pool = s.hashrate?.current || 0, net = s.network?.hashrate || 0;
if (!pool || !net) return { prefix: ‘POOL SHARE’, value: ‘—’ };
return { prefix: ‘POOL SHARE’, value: `${((pool/net)*100).toExponential(2)}%` };
} },
{ id: ‘expected_block’, label: ‘Expected Block’, category: ‘Odds’, color: ‘var(–amber)’,
render: (s) => {
const d = s.odds?.expectedDays;
return { prefix: ‘EXPECTED’, value: d != null ? fmtOdds(d) : ‘—’ };
} },
{ id: ‘luck_current’, label: ‘Luck’, category: ‘Odds’, color: ‘var(–amber)’,
render: (s) => {
const l = s.luck?.luck;
if (l == null) return { prefix: ‘LUCK’, value: ‘—’ };
return { prefix: ‘LUCK’, value: fmtPct(l, 1) };
} },

// ── NETWORK ──
{ id: ‘next_block_prize’, label: ‘Next Block Prize’, category: ‘Network’, color: ‘var(–amber)’,
render: (s, aliases, currency) => {
const br = s.blockReward;
const price = s.prices?.[currency || ‘USD’];
if (!br) return { prefix: ‘🏆 PRIZE’, value: ‘—’ };
const fiat = price ? ` · ${fmtFiat(br.totalBtc * price, currency || 'USD')}` : ‘’;
return { prefix: ‘🏆 PRIZE’, value: `${fmtBtc(br.totalBtc, 3)}${fiat}` };
} },
{ id: ‘block_reward_btc’, label: ‘Block Reward (BTC)’, category: ‘Network’, color: ‘var(–amber)’,
render: (s) => {
const br = s.blockReward;
if (!br) return { prefix: ‘🏆 REWARD’, value: ‘—’ };
return { prefix: ‘🏆 REWARD’, value: fmtBtc(br.totalBtc, 4) };
} },
{ id: ‘block_reward_fiat’, label: ‘Block Reward (Fiat)’, category: ‘Network’, color: ‘var(–amber)’,
render: (s, aliases, currency) => {
const br = s.blockReward;
const cur = currency || ‘USD’;
const price = s.prices?.[cur];
if (!br || !price) return { prefix: ‘🏆 REWARD’, value: ‘—’ };
return { prefix: ‘🏆 REWARD’, value: fmtFiat(br.totalBtc * price, cur) };
} },
{ id: ‘btc_price’, label: ‘BTC Price’, category: ‘Network’, color: ‘var(–cyan)’,
render: (s, aliases, currency) => {
const price = s.prices?.[currency || ‘USD’];
if (s.privateMode) return { prefix: ‘BTC’, value: ‘🔒 hidden’ };
return { prefix: ‘BTC’, value: price ? fmtFiat(price, currency || ‘USD’) : ‘—’ };
} },
{ id: ‘mempool_txs’, label: ‘Mempool TXs’, category: ‘Network’, color: ‘var(–text-1)’,
render: (s) => ({ prefix: ‘MEMPOOL’, value: `${fmtNum(s.nodeInfo?.mempoolCount || 0)} TX` }) },
{ id: ‘priority_fee’, label: ‘Priority Fee’, category: ‘Network’, color: ‘var(–amber)’,
render: (s) => {
const f = s.mempool?.feeRate;
return { prefix: ‘FEE’, value: f != null ? `${f} sat/vB` : ‘—’ };
} },
{ id: ‘mempool_fees_total’, label: ‘Mempool Fees Total’, category: ‘Network’, color: ‘var(–amber)’,
render: (s) => {
const btc = s.mempool?.totalFeesBtc;
if (btc == null) return { prefix: ‘MP FEES’, value: ‘—’ };
if (btc <= 0)    return { prefix: ‘MP FEES’, value: ‘0 BTC’ };
return { prefix: ‘MP FEES’, value: fmtBtc(btc, 3) };
} },
{ id: ‘time_since_block’, label: ‘Time Since Last Block’, category: ‘Network’, color: ‘var(–text-1)’,
render: (s) => {
const latest = s.netBlocks?.[0];
if (!latest?.timestamp) return { prefix: ‘LAST BLOCK’, value: ‘—’ };
return { prefix: ‘LAST BLOCK’, value: timeAgo(latest.timestamp * 1000) };
} },
{ id: ‘congestion’, label: ‘Mempool Congestion’, category: ‘Network’, color: ‘var(–amber)’,
render: (s) => {
const c = mempoolCongestion(s.mempool?.feeRate);
const color = c === ‘HIGH’ ? ‘🔴’ : c === ‘MEDIUM’ ? ‘🟡’ : c === ‘LOW’ ? ‘🟢’ : ‘—’;
return { prefix: ‘CONGESTION’, value: c ? `${color} ${c}` : ‘—’ };
} },
{ id: ‘halving’, label: ‘Days to Halving’, category: ‘Network’, color: ‘var(–amber)’,
render: (s) => {
const d = daysUntilHalving(s.network?.height);
return { prefix: ‘HALVING IN’, value: d ? `${fmtNum(d)}d` : ‘—’ };
} },
{ id: ‘halving_blocks’, label: ‘Halving Countdown (blocks)’, category: ‘Network’, color: ‘var(–amber)’,
render: (s) => {
const b = blocksUntilHalving(s.network?.height);
return { prefix: ‘HALVING IN’, value: b != null ? `${fmtNum(b)} blk` : ‘—’ };
} },
{ id: ‘retarget_eta’, label: ‘Retarget ETA’, category: ‘Network’, color: ‘var(–cyan)’,
render: (s) => {
const rt = s.retarget;
if (!rt || rt.remainingBlocks == null) return { prefix: ‘RETARGET’, value: ‘—’ };
const dChange = rt.difficultyChange;
const pct = dChange != null ? ` (${dChange>=0?'+':''}${dChange.toFixed(2)}%)` : ‘’;
return { prefix: ‘RETARGET’, value: `${fmtNum(rt.remainingBlocks)} blk${pct}` };
} },

// ── INFRASTRUCTURE ──
{ id: ‘node_sync’, label: ‘Node Sync %’, category: ‘Infrastructure’, color: ‘var(–green)’,
render: (s) => {
const p = s.sync?.progress;
if (p == null) return { prefix: ‘SYNC’, value: ‘—’ };
return { prefix: ‘SYNC’, value: p >= 0.9999 ? ‘✓ 100%’ : `${(p*100).toFixed(2)}%` };
} },
{ id: ‘node_peers’, label: ‘Node Peers’, category: ‘Infrastructure’, color: ‘var(–cyan)’,
render: (s) => {
const n = s.nodeInfo;
if (!n) return { prefix: ‘PEERS’, value: ‘—’ };
return { prefix: ‘PEERS’, value: `${n.peers||0} (${n.peersOut||0}↑ ${n.peersIn||0}↓)` };
} },
{ id: ‘node_connected’, label: ‘Node Status’, category: ‘Infrastructure’, color: ‘var(–green)’,
render: (s) => ({ prefix: ‘NODE’, value: s.nodeInfo?.connected ? ‘🟢 LIVE’ : ‘🔴 DOWN’ }) },
{ id: ‘private_mode’, label: ‘Private Mode’, category: ‘Infrastructure’, color: ‘var(–cyan)’,
render: (s) => ({ prefix: ‘PRIVATE’, value: s.privateMode ? ‘🔒 ON’ : ‘OFF’ }) },
{ id: ‘stratum_url’, label: ‘Stratum URL’, category: ‘Infrastructure’, color: ‘var(–cyan)’,
render: () => {
const host = typeof window !== ‘undefined’ ? window.location.hostname : ‘umbrel.local’;
return { prefix: ‘📡 STRATUM’, value: `stratum+tcp://${host}:3333` };
} },

// ── SESSION ──
{ id: ‘pool_uptime’, label: ‘Pool Uptime’, category: ‘Session’, color: ‘var(–text-1)’,
render: (s, aliases, currency, uptime) => ({
prefix: ‘UPTIME’, value: uptime ? fmtUptime(uptime) : ‘—’
}) },
{ id: ‘blocks_found_total’, label: ‘Blocks Found’, category: ‘Session’, color: ‘var(–green)’,
render: (s) => ({ prefix: ‘BLOCKS FOUND’, value: `${(s.blocks || []).length}` }) },
{ id: ‘sats_earned’, label: ‘Satoshis Earned’, category: ‘Session’, color: ‘var(–amber)’,
render: (s) => {
const total = (s.blocks || []).length * 3.125; // rough, each block = ~3.125 BTC subsidy
if (!total) return { prefix: ‘EARNED’, value: ‘0 sat’ };
return { prefix: ‘EARNED’, value: fmtBtc(total, 3) };
} },
];

// Map for quick lookup by id
export const METRIC_MAP = Object.fromEntries(METRICS.map(m => [m.id, m]));

// Category order for the settings UI
export const METRIC_CATEGORIES = [‘Performance’, ‘Workers’, ‘Odds’, ‘Network’, ‘Infrastructure’, ‘Session’];

// Available chart marker symbols
export const MARKER_SYMBOLS = [‘₿’, ‘⛏’, ‘💎’, ‘⚡’, ‘🎯’, ‘🔥’, ‘🚀’, ‘🎰’, ‘☠️’, ‘🟠’];

// Defaults
export const DEFAULT_STRIP_METRICS = [‘pool_hashrate’, ‘next_block_prize’, ‘accept_rate’, ‘worker_health’, ‘node_sync’, ‘hashrate_trend’];
export const DEFAULT_CHUNK_SIZE   = 2;
export const DEFAULT_FADE_MS      = 5000;
export const DEFAULT_MARKER_SYMS  = [‘₿’, ‘⛏’, ‘💎’];
export const DEFAULT_MARKER_MS    = 4000;

// Ticker defaults — live metric-driven scrolling ticker shares the METRICS registry.
export const DEFAULT_TICKER_METRICS = [
‘btc_price’,
‘block_reward_btc’,
‘block_reward_fiat’,
‘priority_fee’,
‘pool_hashrate’,
‘workers_online’,
‘blocks_found_total’,
‘expected_block’,
‘luck_current’,
‘retarget_eta’,
‘halving’,
];
export const TICKER_SEPARATORS = [’·’, ‘—’, ‘|’];
export const DEFAULT_TICKER_SEPARATOR = ‘·’;
