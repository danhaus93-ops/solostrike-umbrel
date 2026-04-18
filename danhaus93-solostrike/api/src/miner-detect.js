// Detect miner type from workername suffix patterns.
// Gavin's convention: worker = bc1q...address.suffix
// We sniff the suffix against known miner fingerprints.

const PATTERNS = [
  { match: /\.s19[\s_.-]*xp|\.s19xp|\.nakamoto/i,       type: 'Antminer S19 XP', icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.s21/i,                                     type: 'Antminer S21',    icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.s19|\.antminer/i,                          type: 'Antminer S19',    icon: '⛏',  vendor: 'Bitmain' },
  { match: /\.nano[\s_.-]*3s|\.avalon[\s_.-]*nano/i,     type: 'Avalon Nano 3S',  icon: '▸',  vendor: 'Canaan' },
  { match: /\.avalon/i,                                  type: 'Avalon',          icon: '▸',  vendor: 'Canaan' },
  { match: /\.nerdqaxe/i,                                type: 'NerdQaxe++',      icon: '◈',  vendor: 'Shufps' },
  { match: /\.nerdminer|\.nerd/i,                        type: 'NerdMiner',       icon: '◈',  vendor: 'OSS' },
  { match: /\.bitaxe/i,                                  type: 'BitAxe',          icon: '◆',  vendor: 'OSS' },
  { match: /\.braiins|\.hashpower|\.rental/i,            type: 'Braiins Rental',  icon: '⚡', vendor: 'Rented' },
  { match: /\.whatsminer|\.m3[0-9]|\.m5[0-9]|\.m6[0-9]/i, type: 'Whatsminer',     icon: '⛏',  vendor: 'MicroBT' },
  { match: /\.t3|\.innosilicon/i,                        type: 'Innosilicon',     icon: '⛏',  vendor: 'Innosilicon' },
];

function detectMiner(workername) {
  if (!workername || typeof workername !== 'string') {
    return { type: null, icon: '▪', vendor: null };
  }
  for (const p of PATTERNS) {
    if (p.match.test(workername)) {
      return { type: p.type, icon: p.icon, vendor: p.vendor };
    }
  }
  return { type: null, icon: '▪', vendor: null };
}

// Traffic-light worker health
// green  = fresh shares (< 2min) and reject rate < 1%
// amber  = stale-ish (2-10min) OR reject rate 1-5%
// red    = offline (> 10min) OR reject rate > 5%
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

module.exports = { detectMiner, workerHealth };
