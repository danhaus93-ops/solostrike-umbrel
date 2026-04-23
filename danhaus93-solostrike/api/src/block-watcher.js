// Miner-type detection: two-tier (user-agent preferred, workername suffix fallback).
// User-agent comes from stratum mining.subscribe via ua-tailer.
// Workername suffix is the historical fallback for users who name their
// workers like "bc1q...address.s19jpro".

const { detectFromUserAgent } = require('./ua-patterns');

// Legacy workername-suffix patterns (kept as fallback).
const WORKERNAME_PATTERNS = [
  { match: /\.s19[\s_.-]*xp|\.s19xp|\.nakamoto/i,              type: 'Antminer S19 XP',      icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.s19[\s_.-]*k[\s_.-]*pro|\.s19kpro/i,             type: 'Antminer S19k Pro',    icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.s19[\s_.-]*j[\s_.-]*pro|\.s19jpro/i,             type: 'Antminer S19j Pro',    icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.s19[\s_.-]*pro|\.s19pro/i,                       type: 'Antminer S19 Pro',     icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.s21[\s_.-]*xp|\.s21xp/i,                         type: 'Antminer S21 XP',      icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.s21/i,                                           type: 'Antminer S21',         icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.s19|\.antminer/i,                                type: 'Antminer S19',         icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.l9|\.l7/i,                                       type: 'Antminer L-series',    icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.nano[\s_.-]*3s|\.avalon[\s_.-]*nano/i,           type: 'Avalon Nano 3S',       icon: '▸',  vendor: 'Canaan' },
  { match: /\.avalon[\s_.-]*q/i,                               type: 'Avalon Q',             icon: '▸',  vendor: 'Canaan' },
  { match: /\.avalon/i,                                        type: 'Avalon',               icon: '▸',  vendor: 'Canaan' },
  { match: /\.nerdqaxe/i,                                      type: 'NerdQaxe++',           icon: '◈',  vendor: 'Shufps' },
  { match: /\.nerdminer|\.nerd/i,                              type: 'NerdMiner',            icon: '◈',  vendor: 'OSS' },
  { match: /\.bitaxe[\s_.-]*gamma/i,                           type: 'BitAxe Gamma',         icon: '◆',  vendor: 'OSS' },
  { match: /\.bitaxe[\s_.-]*supra/i,                           type: 'BitAxe Supra',         icon: '◆',  vendor: 'OSS' },
  { match: /\.bitaxe[\s_.-]*ultra/i,                           type: 'BitAxe Ultra',         icon: '◆',  vendor: 'OSS' },
  { match: /\.bitaxe/i,                                        type: 'BitAxe',               icon: '◆',  vendor: 'OSS' },
  { match: /\.braiins|\.hashpower|\.rental/i,                  type: 'Braiins Rental',       icon: '⚡', vendor: 'Rented' },
  { match: /\.whatsminer|\.m3[0-9]|\.m5[0-9]|\.m6[0-9]/i,      type: 'Whatsminer',           icon: '⛏',  vendor: 'MicroBT' },
  { match: /\.t3|\.innosilicon/i,                              type: 'Innosilicon',          icon: '⛏',  vendor: 'Innosilicon' },
  { match: /\.cgminer|\.bfgminer/i,                            type: 'cgminer/bfgminer',     icon: '▪',  vendor: 'OSS' },
];

function detectFromWorkername(workername) {
  if (!workername || typeof workername !== 'string') {
    return { type: null, icon: null, vendor: null };
  }
  for (const p of WORKERNAME_PATTERNS) {
    if (p.match.test(workername)) {
      return { type: p.type, icon: p.icon, vendor: p.vendor };
    }
  }
  return { type: null, icon: null, vendor: null };
}

// Best-effort detection combining user-agent (preferred) and workername fallback.
// Returns { type, icon, vendor, source } — `source` tells you which method won.
function detectMinerBest(workername, userAgent) {
  const ua = detectFromUserAgent(userAgent);
  if (ua.type) return { ...ua, source: 'user-agent' };

  const wn = detectFromWorkername(workername);
  if (wn.type) return { ...wn, source: 'workername' };

  return { type: null, icon: '▪', vendor: null, source: 'unknown' };
}

// Back-compat: the old `detectMiner(workername)` used elsewhere.
function detectMiner(workername) {
  const result = detectFromWorkername(workername);
  return {
    type: result.type,
    icon: result.icon || '▪',
    vendor: result.vendor,
  };
}

// Traffic-light worker health
function workerHealth(w) {
  if (!w) return 'red';
  const now = Date.now();
  const age = now - (w.lastSeen || 0);
  const total = (w.shares || 0) + (w.rejected || 0);
  const rejectRate = total > 0 ? (w.rejected || 0) / total : 0;
  if (age > 10 * 60 * 1000 || rejectRate > 0.05) return 'red';
  if (age > 2  * 60 * 1000 || rejectRate > 0.01) return 'amber';
  return 'green';
}

module.exports = {
  detectMiner,            // back-compat
  detectMinerBest,        // new two-tier detection
  detectFromWorkername,
  detectFromUserAgent,
  workerHealth,
};
