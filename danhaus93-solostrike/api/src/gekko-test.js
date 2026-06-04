#!/usr/bin/env node
// gekko-test.js — hardware-free verification of the FULL Bitaxe/NerdQAxe/Gekko
// family detection, the boardVersion map, the /info+/asic merge, AND an explicit
// proof that a cgminer/LuxOS device (the S21 XP) is never touched.
//
//   Run on the Umbrel:  sudo docker exec danhaus93dev-solostrike_api_1 node src/gekko-test.js
//
// Exit 0 = all pass, 1 = a failure (CI-friendly). Pure logic; no hardware, no
// network — it calls the REAL detection + extraction code with synthetic payloads.

const { detectMinerBest, detectFromAsicModel, detectFromUserAgent,
        detectFromWorkername, boardModelString } = require('./miner-detect');
const { extractEspMinerLive } = require('./miner-poller');

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}${extra ? '  ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const hr = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 58 - t.length)));
const T = (am, n, hint, bv) => (detectFromAsicModel(am, n, hint, bv).type || '(none)');

// ── 1. Family resolution by chip + count ─────────────────────────────────────
hr('1. Chip + count → model');
ok(T('BM1397', 1) === 'BitAxe Max',     'BM1397      → BitAxe Max');
ok(T('BM1366', 1) === 'BitAxe Ultra',   'BM1366 ×1   → BitAxe Ultra');
ok(T('BM1366', 4) === 'BitAxe Hex',     'BM1366 ×4   → BitAxe Hex');
ok(T('BM1368', 1) === 'BitAxe Supra',   'BM1368 ×1   → BitAxe Supra');
ok(T('BM1368', 4) === 'NerdQaxe+',      'BM1368 ×4   → NerdQaxe+');
ok(T('BM1370', 1) === 'BitAxe Gamma',   'BM1370 ×1   → BitAxe Gamma');
ok(T('BM1370', 2) === 'BitAxe GT',      'BM1370 ×2   → BitAxe GT');
ok(T('BM1370', 4) === 'NerdQaxe++',     'BM1370 ×4   → NerdQaxe++');

// ── 2. boardVersion as authoritative tiebreaker ──────────────────────────────
hr('2. boardVersion map + tiebreaker');
ok(boardModelString('100') === 'BitAxe Max',       'bv 100 → Max');
ok(boardModelString('300') === 'BitAxe Hex',       'bv 300 → Hex');
ok(boardModelString('601') === 'BitAxe Gamma',     'bv 601 → Gamma');
ok(boardModelString('650') === 'BitAxe Gamma Duo', 'bv 650 → Gamma Duo');
ok(boardModelString('801') === 'BitAxe GT',        'bv 801 → GT');
ok(T('BM1370', 2, '', '650') === 'BitAxe Gamma Duo', 'BM1370 ×2 + bv650 → Gamma Duo (not GT)');
ok(T('BM1370', 2, '', '801') === 'BitAxe GT',        'BM1370 ×2 + bv801 → GT');
ok(T('BM1370', 0, '', '601') === 'BitAxe Gamma',     'BM1370 + bv601, count missing → Gamma');
ok(T('BM1370', 0, '', '801') === 'BitAxe GT',        'BM1370 + bv801, count missing → GT');

// ── 3. GekkoAxe still recognized on every signal ─────────────────────────────
hr('3. GekkoAxe');
ok(detectFromUserAgent('GekkoAxe/2.1').type === 'GekkoAxe', 'UA gekko');
ok(detectFromWorkername('bc1qx.gekko').type === 'GekkoAxe', 'worker .gekko');
ok(T('BM1370', 2, 'GekkoAxe', '801') === 'GekkoAxe',        'gekko token beats GT/bv801');
ok(detectMinerBest('bc1qx.gekko', '', 'BM1370', 2, '', '801').type === 'GekkoAxe', 'detectMinerBest: .gekko beats bv801');

// ── 4. NO REGRESSION for existing real devices ───────────────────────────────
hr('4. No regression (NerdQAxe++ / Gamma / BitAxe)');
ok(T('BM1370', 4, 'NerdQAxe++') === 'NerdQaxe++', 'NerdQAxe++ (BM1370 ×4) stays NerdQaxe++');
ok(T('BM1370', 1) === 'BitAxe Gamma',             'Gamma (BM1370 ×1) stays Gamma');
ok(detectFromUserAgent('bitaxe/2.0').type === 'BitAxe', 'UA bitaxe → BitAxe');

// ── 5. S21 XP / cgminer NO-TOUCH (the safety proof) ──────────────────────────
hr('5. S21 XP / cgminer is never reclassified');
// A LuxOS/cgminer device has NO BM ASICModel and NO boardVersion → the chip tier
// returns null, so applyAsicModelUpgrade's `if (!live.asicModel) return w` guard
// leaves its UA/workername label fully intact.
ok(T(null, null) === '(none)',                 'no chip, no bv            → (none)');
ok(T(null, 4, 's21 xp luxos', null) === '(none)', 'no chip + cgminer hint    → (none)');
ok(T(undefined, 2, '', '') === '(none)',       'undefined chip, empty bv  → (none)');
ok(detectMinerBest('bc1qaddr.s21xp', '', null, null).type === 'Antminer S21 XP',
   'S21 XP keeps its workername label (asic tier inert)');

// ── 6. End-to-end: real extractEspMinerLive on merged /info + /asic ───────────
hr('6. End-to-end (real extract: /info + /asic merged)');
const info = { ASICModel: 'BM1370', hashRate: 1200, uptimeSeconds: 7200, version: 'AxeOS/v2.12.2', hostname: 'bitaxe' };
const cases = [
  { name: 'Gamma',        d: { ...info, boardVersion: '601', deviceModel: 'Gamma', asicCount: 1 },                 model: 'BitAxe Gamma', card: 'BitAxe Gamma' },
  { name: 'GT',           d: { ...info, boardVersion: '801', deviceModel: 'GT',    asicCount: 2 },                 model: 'BitAxe GT',    card: 'BitAxe GT' },
  { name: 'Gamma Duo',    d: { ...info, boardVersion: '650', deviceModel: 'GammaDuo', asicCount: 2 },              model: 'BitAxe Gamma Duo', card: 'BitAxe Gamma Duo' },
  { name: 'Hex',          d: { ...info, ASICModel: 'BM1366', boardVersion: '300', deviceModel: 'Hex', asicCount: 4 }, model: 'BitAxe Hex', card: 'BitAxe Hex' },
  { name: 'NerdQAxe++',   d: { ...info, boardVersion: '', deviceModel: 'NerdQAxe++', asicCount: 4 },               model: 'NerdQAxe++',   card: 'NerdQaxe++' },
  { name: 'GekkoAxe(Hex OS)', d: { ...info, boardVersion: '801', deviceModel: 'GekkoAxe', asicCount: 2 },          model: 'GekkoAxe',     card: 'GekkoAxe' },
  { name: 'GekkoAxe(stock→GT)', d: { ...info, boardVersion: '801', deviceModel: 'GT', asicCount: 2 },              model: 'BitAxe GT',    card: 'BitAxe GT' },
];
for (const c of cases) {
  const live = extractEspMinerLive(c.d);
  const card = detectFromAsicModel(live.asicModel, live.asicCount, [live.model].join(' '), live.boardVersion).type || '(none)';
  ok(live.model === c.model, `${c.name}: bucket "${live.model}"`);
  ok(card === c.card,        `   ↳ card "${card}"`);
}

console.log('\n' + '='.repeat(60));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(60));
if (fail === 0) {
  console.log('\nFull family verified. The S21 XP (no BM chip / no boardVersion) is');
  console.log('provably untouched by the chip tier. Remaining real-world unknown:');
  console.log('the exact deviceModel/boardVersion strings each board emits —');
  console.log('  curl -s http://<ip>/api/system/info ; curl -s http://<ip>/api/system/asic');
}
process.exit(fail === 0 ? 0 : 1);
