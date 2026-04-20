// User-agent pattern library for stratum mining.subscribe detection.
// Order matters: more specific patterns must come first.
// UA = whatever string the miner sent in mining.subscribe.

const UA_PATTERNS = [
  // ── OSS / Hobby (most distinctive UAs, put these first) ──────────────────
  { match: /bitaxe.*gamma/i,                      type: 'BitAxe Gamma',       icon: '◆', vendor: 'OSS' },
  { match: /bitaxe.*supra/i,                      type: 'BitAxe Supra',       icon: '◆', vendor: 'OSS' },
  { match: /bitaxe.*ultra/i,                      type: 'BitAxe Ultra',       icon: '◆', vendor: 'OSS' },
  { match: /bitaxe.*max/i,                        type: 'BitAxe Max',         icon: '◆', vendor: 'OSS' },
  { match: /bitaxe/i,                             type: 'BitAxe',             icon: '◆', vendor: 'OSS' },
  { match: /nerdqaxe\+\+|nerdqaxeplusplus/i,      type: 'NerdQaxe++',         icon: '◈', vendor: 'Shufps' },
  { match: /nerdqaxe/i,                           type: 'NerdQaxe',           icon: '◈', vendor: 'Shufps' },
  { match: /nerdaxe/i,                            type: 'NerdAxe',            icon: '◈', vendor: 'OSS' },
  { match: /nerdminer/i,                          type: 'NerdMiner',          icon: '◈', vendor: 'OSS' },
  { match: /esp32.*miner|cpuminer.*esp32/i,       type: 'ESP32 Miner',        icon: '◈', vendor: 'OSS' },

  // ── Firmware / OS (check before generic cgminer) ─────────────────────────
  { match: /braiins[- _]?os|\bbos[+]?\b/i,        type: 'Braiins OS',         icon: '⚡', vendor: 'Braiins' },
  { match: /vnish/i,                              type: 'Vnish Firmware',     icon: '⚡', vendor: 'Vnish' },
  { match: /luxos/i,                              type: 'LuxOS Firmware',     icon: '⚡', vendor: 'Luxor' },
  { match: /hiveos/i,                             type: 'HiveOS',             icon: '⚡', vendor: 'Hive' },

  // ── Bitmain Antminer ASICs ───────────────────────────────────────────────
  { match: /s21[\s_.-]*xp/i,                      type: 'Antminer S21 XP',    icon: '⛏', vendor: 'Bitmain' },
  { match: /s21[\s_.-]*pro/i,                     type: 'Antminer S21 Pro',   icon: '⛏', vendor: 'Bitmain' },
  { match: /\bs21\b/i,                            type: 'Antminer S21',       icon: '⛏', vendor: 'Bitmain' },
  { match: /s19[\s_.-]*xp|nakamoto/i,             type: 'Antminer S19 XP',    icon: '⛏', vendor: 'Bitmain' },
  { match: /s19[\s_.-]*k[\s_.-]*pro/i,            type: 'Antminer S19k Pro',  icon: '⛏', vendor: 'Bitmain' },
  { match: /s19[\s_.-]*j[\s_.-]*pro/i,            type: 'Antminer S19j Pro',  icon: '⛏', vendor: 'Bitmain' },
  { match: /s19[\s_.-]*pro/i,                     type: 'Antminer S19 Pro',   icon: '⛏', vendor: 'Bitmain' },
  { match: /\bs19\b/i,                            type: 'Antminer S19',       icon: '⛏', vendor: 'Bitmain' },
  { match: /\bs17|\bs15|\bs9\b/i,                 type: 'Antminer S-legacy',  icon: '⛏', vendor: 'Bitmain' },
  { match: /\bt21|\bt19|\bt17\b/i,                type: 'Antminer T-series',  icon: '⛏', vendor: 'Bitmain' },
  { match: /\bl9|\bl7\b/i,                        type: 'Antminer L-series',  icon: '⛏', vendor: 'Bitmain' },
  { match: /antminer/i,                           type: 'Antminer',           icon: '⛏', vendor: 'Bitmain' },

  // ── MicroBT Whatsminer ──────────────────────────────────────────────────
  { match: /whatsminer/i,                         type: 'Whatsminer',         icon: '⛏', vendor: 'MicroBT' },
  { match: /\bm6[0-9]\b|m60s|m63|m66/i,           type: 'Whatsminer M60+',    icon: '⛏', vendor: 'MicroBT' },
  { match: /\bm5[0-9]\b|m50s|m53|m56/i,           type: 'Whatsminer M50+',    icon: '⛏', vendor: 'MicroBT' },
  { match: /\bm3[0-9]\b|m30s|m31|m33/i,           type: 'Whatsminer M30+',    icon: '⛏', vendor: 'MicroBT' },
  { match: /btminer/i,                            type: 'Whatsminer (btminer)', icon: '⛏', vendor: 'MicroBT' },

  // ── Canaan Avalon ────────────────────────────────────────────────────────
  { match: /avalon[\s_.-]*nano[\s_.-]*3s/i,       type: 'Avalon Nano 3S',     icon: '▸', vendor: 'Canaan' },
  { match: /avalon[\s_.-]*nano/i,                 type: 'Avalon Nano',        icon: '▸', vendor: 'Canaan' },
  { match: /avalon[\s_.-]*q/i,                    type: 'Avalon Q',           icon: '▸', vendor: 'Canaan' },
  { match: /avalon[\s_.-]*1[0-9]+/i,              type: 'Avalon ASIC',        icon: '▸', vendor: 'Canaan' },
  { match: /avalon/i,                             type: 'Avalon',             icon: '▸', vendor: 'Canaan' },
  { match: /cgminer[- _]?avalon/i,                type: 'Avalon (cgminer)',   icon: '▸', vendor: 'Canaan' },

  // ── Innosilicon / Ebang / others ─────────────────────────────────────────
  { match: /innosilicon|\bt3\+?\b/i,              type: 'Innosilicon',        icon: '⛏', vendor: 'Innosilicon' },
  { match: /ebang|ebit/i,                         type: 'Ebang',              icon: '⛏', vendor: 'Ebang' },
  { match: /iceriver/i,                           type: 'IceRiver',           icon: '⛏', vendor: 'IceRiver' },
  { match: /goldshell/i,                          type: 'Goldshell',          icon: '⛏', vendor: 'Goldshell' },

  // ── Rentals / hashpower marketplaces ─────────────────────────────────────
  { match: /nicehash/i,                           type: 'NiceHash',           icon: '⚡', vendor: 'Rented' },
  { match: /miningrigrentals|mrr/i,               type: 'MiningRigRentals',   icon: '⚡', vendor: 'Rented' },
  { match: /hashpower|rental/i,                   type: 'Rental',             icon: '⚡', vendor: 'Rented' },

  // ── Generic miner software (lowest priority fallbacks) ──────────────────
  { match: /cgminer\/(\d+\.\d+\.\d+)/i,           type: 'cgminer',            icon: '▪', vendor: 'OSS' },
  { match: /cgminer/i,                            type: 'cgminer',            icon: '▪', vendor: 'OSS' },
  { match: /bfgminer/i,                           type: 'bfgminer',           icon: '▪', vendor: 'OSS' },
  { match: /cpuminer/i,                           type: 'cpuminer',           icon: '▪', vendor: 'OSS' },
  { match: /ccminer/i,                            type: 'ccminer',            icon: '▪', vendor: 'OSS' },
  { match: /lolminer/i,                           type: 'lolMiner',           icon: '▪', vendor: 'OSS' },
  { match: /minerstat/i,                          type: 'Minerstat',          icon: '▪', vendor: 'Minerstat' },
  { match: /awesome[- ]?miner/i,                  type: 'Awesome Miner',      icon: '▪', vendor: 'Awesome' },
];

function detectFromUserAgent(ua) {
  if (!ua || typeof ua !== 'string') {
    return { type: null, icon: null, vendor: null };
  }
  const clean = ua.trim();
  if (!clean) return { type: null, icon: null, vendor: null };
  for (const p of UA_PATTERNS) {
    if (p.match.test(clean)) {
      return { type: p.type, icon: p.icon, vendor: p.vendor };
    }
  }
  return { type: null, icon: null, vendor: null };
}

module.exports = { UA_PATTERNS, detectFromUserAgent };
