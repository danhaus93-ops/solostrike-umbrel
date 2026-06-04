#!/usr/bin/env node
// gekko-test.js — hardware-free verification of GekkoAxe family recognition.
//
// Runs the REAL detection + extraction code (miner-detect.js, miner-poller.js)
// against synthetic GekkoAxe /api/system/info payloads. Proves the LOGIC without
// a physical board. What it CANNOT prove: which identity token your actual unit
// emits — only a real `curl http://<gekko-ip>/api/system/info` settles that.
//
//   Run on the Umbrel (or anywhere with node):  node gekko-test.js
//
// Exit code 0 = all assertions passed, 1 = a failure (so it's CI-friendly).

const { detectMinerBest, detectFromAsicModel, detectFromUserAgent,
        detectFromWorkername } = require('./miner-detect');
const { extractEspMinerLive } = require('./miner-poller');

let pass = 0, fail = 0;
const ok  = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}${extra ? '  ' + extra : ''}`);
  cond ? pass++ : fail++;
};
const hr = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 60 - t.length)));

// ─────────────────────────────────────────────────────────────────────────────
// 1. DETECTION LOGIC (the actual decision code, exported & pure)
// ─────────────────────────────────────────────────────────────────────────────
hr('1. Detection logic — GekkoAxe is recognized on every signal');
ok(detectFromUserAgent('GekkoAxe/2.1').type === 'GekkoAxe',            'stratum UA "GekkoAxe/2.1"');
ok(detectFromUserAgent('cgminer GekkoScience').type === 'GekkoAxe',    'stratum UA "...GekkoScience"');
ok(detectFromWorkername('bc1qxxxx.gekko').type === 'GekkoAxe',         'worker suffix ".gekko"');
ok(detectFromWorkername('bc1qxxxx.gekkoaxe').type === 'GekkoAxe',      'worker suffix ".gekkoaxe"');
ok(detectFromAsicModel('BM1370', 2, 'GekkoAxe').type === 'GekkoAxe',   'asic BM1370×2 + deviceModel hint');
ok(detectFromAsicModel('BM1370', 1, 'gekko-rig').type === 'GekkoAxe',  'asic BM1370×1 + hostname hint');
ok(detectFromAsicModel('BM1370', 2, 'gekko').vendor === 'GekkoScience','vendor = GekkoScience');
ok(detectFromAsicModel('BM1370', 2, 'gekko').icon === '\u2756',        'icon = \u2756');
ok(detectMinerBest('w', '', 'BM1370', 2, 'GekkoAxe').type === 'GekkoAxe', 'detectMinerBest: hint beats NerdQaxe fallback');

hr('1b. NO REGRESSION — NerdQaxe/BitAxe unchanged when no gekko token');
ok(detectFromAsicModel('BM1370', 2).type === 'NerdQaxe++',            'BM1370×2, no hint → NerdQaxe++');
ok(detectFromAsicModel('BM1370', 2, 'NerdQAxe++').type === 'NerdQaxe++','BM1370×2, plain hint → NerdQaxe++');
ok(detectFromAsicModel('BM1370', 1).type === 'BitAxe Gamma',         'BM1370×1 → BitAxe Gamma');
ok(detectFromUserAgent('bitaxe/2.0').type === 'BitAxe',              'UA "bitaxe/2.0" → BitAxe');
ok(detectMinerBest('w', '', 'BM1370', 2).type === 'NerdQaxe++',       'detectMinerBest: no token → NerdQaxe++');

// ─────────────────────────────────────────────────────────────────────────────
// 2. END-TO-END EXTRACTION (real extractEspMinerLive → friendly model → label)
//    Mirrors exactly what state-transform.js does:
//      bucket label  = live.model           (Top Strikers bucket key)
//      card label    = detectFromAsicModel(live.asicModel, live.asicCount, live.model)
// ─────────────────────────────────────────────────────────────────────────────
// Realistic AxeOS /api/system/info shapes for a GekkoAxe V2.0 GT (2× BM1370).
// hashRate is GH/s in AxeOS; uptimeSeconds ≥ 180 so it isn't treated as warmup.
const base = {
  ASICModel: 'BM1370', asicCount: 2, boardVersion: '2.0',
  hashRate: 2400, power: 35, temp: 62, frequency: 600, coreVoltage: 1150,
  uptimeSeconds: 7200, version: 'AxeOS/v2.9.0', hostname: 'bitaxe',
};
const scenarios = [
  { name: 'A · firmware sets deviceModel="GekkoAxe"', payload: { ...base, deviceModel: 'GekkoAxe' },               expectModel: 'GekkoAxe',     expectCard: 'GekkoAxe'   },
  { name: 'B · hostname carries "gekko" (no deviceModel)', payload: { ...base, hostname: 'gekkoaxe-shop1' },       expectModel: 'GekkoAxe',     expectCard: 'GekkoAxe'   },
  { name: 'C · pure stock AxeOS, NO gekko token anywhere', payload: { ...base },                                  expectModel: 'BitAxe Gamma', expectCard: 'NerdQaxe++' },
];

hr('2. End-to-end extraction (real extractEspMinerLive)');
for (const s of scenarios) {
  const live = extractEspMinerLive(s.payload);
  const card = detectFromAsicModel(live.asicModel, live.asicCount, live.model);
  ok(live.model === s.expectModel, s.name + '  → bucket "' + live.model + '"');
  ok((card.type || '(none)') === s.expectCard, '   ↳ card label = "' + (card.type || '(none)') + '"');
  // sanity: telemetry still flows for bucketing
  ok(live.hashrateReported === 2400e9 && live.asicCount === 2,
     '   ↳ telemetry intact (hr=' + (live.hashrateReported/1e9) + ' GH/s, asicCount=' + live.asicCount + ')');
}

hr('2b. The manual-suffix path for the indistinguishable case (C)');
// Scenario C is electrically identical to a NerdQaxe++. The reliable fix is the
// operator naming the worker "<addr>.gekko" — which the live-status path honors:
const cWorker = detectMinerBest('bc1qxxxx.gekko', '', 'BM1370', 2, extractEspMinerLive(base).model);
ok(cWorker.type === 'GekkoAxe', 'worker ".gekko" suffix forces GekkoAxe even on stock AxeOS',
   '(source=' + cWorker.source + ')');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(64));
console.log(`RESULT: ${pass} passed, ${fail} failed`);
console.log('='.repeat(64));
if (fail === 0) {
  console.log('\nLogic verified. Remaining real-world unknown: which token your');
  console.log('actual GekkoAxe emits. Run on the unit:');
  console.log('  curl -s http://<gekko-ip>/api/system/info | python3 -m json.tool');
  console.log('and check deviceModel / hostname / boardVersion / ASICModel / asicCount.');
}
process.exit(fail === 0 ? 0 : 1);
