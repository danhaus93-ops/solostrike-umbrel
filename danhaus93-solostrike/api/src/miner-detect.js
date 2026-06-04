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
  { match: /\.bitaxe[\s_.-]*gamma|\.gamma[\s_.-]*60[12]|\.bitaxe[\s_.-]*60[12]|\.60[12](?:$|[\s_.-])/i,                           type: 'BitAxe Gamma',         icon: '◆',  vendor: 'OSS' },
  { match: /\.bitaxe[\s_.-]*supra/i,                           type: 'BitAxe Supra',         icon: '◆',  vendor: 'OSS' },
  { match: /\.bitaxe[\s_.-]*ultra/i,                           type: 'BitAxe Ultra',         icon: '◆',  vendor: 'OSS' },
  { match: /\.gekko[\s_.-]*axe|\.gekko/i,                       type: 'GekkoAxe',             icon: '❖',  vendor: 'GekkoScience' },
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

// v1.12.x: authoritative model detection from the ESP-Miner ASICModel field.
// ESP-Miner (Bitaxe family + NerdQaxe) reports the literal Bitmain chip ID
// in /api/system/info → ASICModel. The chip uniquely identifies the board:
//   BM1370 → Gamma (single) / NerdQaxe Gamma (multi)
//   BM1368 → Supra
//   BM1366 → Ultra
//   BM1397 → original Bitaxe Max / early single-chip boards
// asicCount disambiguates single-chip Bitaxe from multi-chip NerdQaxe.
// ── Bitaxe / NerdQAxe / Gekko family resolution ──────────────────────────────
// AxeOS reports the raw Bitmain chip in ASICModel; chip-count (asicCount) and the
// short deviceModel come from /api/system/asic, and boardVersion from
// /api/system/info. The chip alone is ambiguous for multi-chip boards, so resolve
// by chip + count, with boardVersion as the authoritative tiebreaker:
//   BM1370  ×1 → Gamma (bv 601) · ×2 → GT/Gamma Turbo (801) or Gamma Duo (650) · ×4 → NerdQAxe++
//   BM1368  ×1 → Supra           · ×4 → NerdQAxe+
//   BM1366  ×1 → Ultra           · ×4 → Hex
//   BM1397     → Max
// (Verified against osmu.wiki Bitaxe model + API pages and the ESP-Miner schema.)
const BITAXE = (type) => ({ type, icon: '◆', vendor: 'OSS' });
const NERD   = (type) => ({ type, icon: '◈', vendor: 'Shufps' });
const GEKKO  = { type: 'GekkoAxe', icon: '❖', vendor: 'GekkoScience' };
const GEKKO_RE = /gekko/i;

// boardVersion → friendly model string. On stock AxeOS, boardVersion is the only
// model signal present in /api/system/info, so it's the reliable discriminator.
function boardModelString(bv) {
  if (bv == null) return null;
  const s = String(bv).trim();
  if (!s) return null;
  const exact = {
    '100': 'BitAxe Max',  '200': 'BitAxe Ultra', '300': 'BitAxe Hex', '400': 'BitAxe Supra',
    '600': 'BitAxe Gamma', '601': 'BitAxe Gamma', '602': 'BitAxe Gamma', '604': 'BitAxe Gamma',
    '650': 'BitAxe Gamma Duo', '651': 'BitAxe Gamma Duo',
    '800': 'BitAxe GT', '801': 'BitAxe GT',
  };
  if (exact[s]) return exact[s];
  const n = parseInt(s, 10);
  if (!Number.isFinite(n)) return null;
  if (n >= 650 && n < 700) return 'BitAxe Gamma Duo';
  if (n >= 800 && n < 900) return 'BitAxe GT';
  if (n >= 600 && n < 650) return 'BitAxe Gamma';
  if (n >= 400 && n < 500) return 'BitAxe Supra';
  if (n >= 300 && n < 400) return 'BitAxe Hex';
  if (n >= 200 && n < 300) return 'BitAxe Ultra';
  if (n >= 100 && n < 200) return 'BitAxe Max';
  return null;
}

function labelToDet(label) {
  if (!label) return { type: null, icon: null, vendor: null };
  if (/^Nerd/i.test(label))  return NERD(label);
  if (/^Gekko/i.test(label)) return GEKKO;
  return BITAXE(label);
}

function detectFromAsicModel(asicModel, asicCount, deviceHint, boardVersion) {
  const key = (asicModel && typeof asicModel === 'string')
    ? asicModel.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
  // A "gekko" token (deviceModel/hostname/workername/UA) on a real AxeOS chip wins
  // over the chip guess — otherwise a 2× BM1370 GekkoAxe reads as a GT/NerdQaxe.
  if (key && deviceHint && GEKKO_RE.test(deviceHint)) return GEKKO;
  const n = Number(asicCount) || 0;
  if (key === 'BM1370') {
    if (n >= 4) return NERD('NerdQaxe++');
    if (n === 2) { const bv = boardModelString(boardVersion); return labelToDet(bv && /Duo/.test(bv) ? bv : 'BitAxe GT'); }
    const bv = boardModelString(boardVersion); if (bv) return labelToDet(bv);
    return BITAXE('BitAxe Gamma');
  }
  if (key === 'BM1368') return n >= 4 ? NERD('NerdQaxe+')    : BITAXE('BitAxe Supra');
  if (key === 'BM1366') return n >= 4 ? BITAXE('BitAxe Hex') : BITAXE('BitAxe Ultra');
  if (key === 'BM1397') return BITAXE('BitAxe Max');
  // Unrecognized/empty chip → boardVersion alone (defensive). A cgminer/LuxOS
  // device (e.g. the S21 XP) has NEITHER a BM ASICModel NOR a boardVersion, so it
  // returns null here and keeps its UA/workername label untouched.
  const bv = boardModelString(boardVersion);
  if (bv) return labelToDet(bv);
  return { type: null, icon: null, vendor: null };
}

// Best-effort detection combining user-agent (preferred) and workername fallback.
// Returns { type, icon, vendor, source } — `source` tells you which method won.
function detectMinerBest(workername, userAgent, asicModel, asicCount, deviceHint, boardVersion) {
  // v1.12.x: the physical chip ID is the most authoritative signal — use it first.
  // But a "gekko" token can ride in on the workername/UA/deviceModel; fold them all
  // into the hint so a GekkoAxe (2× BM1370) isn't mislabeled NerdQaxe++ before the
  // workername/UA tiers are ever consulted.
  const asicHint = [deviceHint, workername, userAgent].filter(Boolean).join(' ');
  const asic = detectFromAsicModel(asicModel, asicCount, asicHint, boardVersion);
  if (asic.type) return { ...asic, source: 'asic-model' };

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
  detectMinerBest,        // new three-tier detection (asic-model → UA → workername)
  detectFromWorkername,
  detectFromUserAgent,
  detectFromAsicModel,
  boardModelString,       // boardVersion → friendly model (shared with miner-poller)
  workerHealth,
};
