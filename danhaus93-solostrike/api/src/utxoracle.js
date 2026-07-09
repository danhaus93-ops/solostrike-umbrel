// ── utxoracle.js ─────────────────────────────────────────────────────────────
// v3.1.0: Faithful Node.js port of UTXOracle.py Version 8 ("The Smooth
// Slider") by Steve Jeffress (@SteveSimple) — https://utxo.live/oracle/
//
// Estimates the previous UTC day's BTC/USD price using ONLY the local node:
// ~15% of on-chain outputs are round-*fiat* amounts (exchange withdrawals of
// $50/$100/$500...). Build a log histogram of a full day's output amounts,
// filter non-p2p-looking txs, smooth round-*BTC* bins, then slide Steve's
// calibrated smooth+spike stencils across the curve; the best-fit slide
// position IS the price.
//
// This port is BIT-FAITHFUL to v8: same bins (incl. bins[0]=0 and the
// linear bin-search), same seven tx filters, same round-BTC smoothing bins,
// same 0.008 clip, same stencil constants, same slide bounds and weighted-
// neighbor average, same int truncation. Anyone running UTXOracle.py v8 on
// the same day gets the same dollar figure — that's the point: a consensus
// price, independently reproducible from public block data.
//
// Runs only in PRIVATE MODE (public mode uses mempool.space spot). Note the
// result is a daily price for the *previous* UTC day, not a live tick; the
// UI surfaces it via state.prices with _oracle metadata.
//
// Upstream license (applies to the algorithm/constants herein):
//   "This software is free to use, modify and distribute for non-financial
//    gain purposes, so long as the full license is included with any use or
//    redistribution. Any use of this software for financial gain, including
//    but not limited to commercial applications, paid services, or monetized
//    redistribution, requires the expressed written consent of the author
//    (@SteveSimple on x.com)."
// LoneStrike is a free, non-commercial community app; this notice satisfies
// the redistribution term. Attribution retained with thanks.

'use strict';

const SECONDS_IN_A_DAY = 60 * 60 * 24;

// ── Part 5: output bell-curve bins (exact v8 construction) ──────────────────
// bins[0] = 0.0, then 200 log-spaced bins per 10x from 1e-6 to <1e6 BTC.
const output_bell_curve_bins = [0.0];
for (let exponent = -6; exponent < 6; exponent++) {
  for (let b = 0; b < 200; b++) {
    output_bell_curve_bins.push(Math.pow(10, exponent + b / 200));
  }
}
const number_of_bins = output_bell_curve_bins.length; // 2401
const first_bin_value = -6;
const range_bin_values = 12; // 6 - (-6)

// ── Part 8: stencils (exact v8 constants) ───────────────────────────────────
const NUM_ELEMENTS = 803;
const smooth_stencil = [];
{
  const mean = 411, std_dev = 201;
  for (let x = 0; x < NUM_ELEMENTS; x++) {
    const exp_part = -Math.pow(x - mean, 2) / (2 * Math.pow(std_dev, 2));
    smooth_stencil.push((0.00150 * Math.pow(2.718281828459045, exp_part)) + (0.0000005 * x));
  }
}
const spike_stencil = new Array(NUM_ELEMENTS).fill(0.0);
// round-usd bin location → popularity (usd amount noted)      // from v8
spike_stencil[40]  = 0.001300198324984352; // $1
spike_stencil[141] = 0.001676746949820743; // $5
spike_stencil[201] = 0.003468805546942046; // $10
spike_stencil[202] = 0.001991977522512513;
spike_stencil[236] = 0.001905066647961839; // $15
spike_stencil[261] = 0.003341772718156079; // $20
spike_stencil[262] = 0.002588902624584287;
spike_stencil[296] = 0.002577893841190244; // $30
spike_stencil[297] = 0.002733728814200412;
spike_stencil[340] = 0.003076117748975647; // $50
spike_stencil[341] = 0.005613067550103145;
spike_stencil[342] = 0.003088253178535568;
spike_stencil[400] = 0.002918457489366139; // $100
spike_stencil[401] = 0.006174500465286022;
spike_stencil[402] = 0.004417068070043504;
spike_stencil[403] = 0.002628663628020371;
spike_stencil[436] = 0.002858828161543839; // $150
spike_stencil[461] = 0.004097463611984264; // $200
spike_stencil[462] = 0.003345917406120509;
spike_stencil[496] = 0.002521467726855856; // $300
spike_stencil[497] = 0.002784125730361008;
spike_stencil[541] = 0.003792850444811335; // $500
spike_stencil[601] = 0.003688240815848247; // $1000
spike_stencil[602] = 0.002392400117402263;
spike_stencil[636] = 0.001280993059008106; // $1500
spike_stencil[661] = 0.001654665137536031; // $2000
spike_stencil[662] = 0.001395501347054946;
spike_stencil[741] = 0.001154279140906312; // $5000
spike_stencil[801] = 0.000832244504868709; // $10000

// v8 round-BTC bins smoothed (not zeroed) in Part 7
const round_btc_bins = [201, 401, 461, 496, 540, 601, 661, 696, 740, 801, 861, 896, 940, 1001, 1061, 1096, 1140, 1201];

// ── Parts 6–7: day accumulator (exact v8 filters + binning) ────────────────
function createDayAccumulator() {
  const counts = new Float64Array(number_of_bins);
  const todays_txids = new Set();

  function addBlock(block) {
    for (const tx of block.tx || []) {
      todays_txids.add(String(tx.txid).slice(-8));
      const inputs = tx.vin || [];
      const outputs = tx.vout || [];

      if (inputs[0] && 'coinbase' in inputs[0]) continue; // coinbase
      if (inputs.length > 5) continue;                    // many inputs
      if (outputs.length < 2) continue;                   // one output
      if (outputs.length > 2) continue;                   // many outputs

      let has_op_return = false;                          // opreturn
      for (const output of outputs) {
        const spk = output.scriptPubKey || {};
        if (spk.type === 'nulldata' || String(spk.asm || '').includes('OP_RETURN')) { has_op_return = true; break; }
      }
      if (has_op_return) continue;

      let has_sameday_input = false, has_big_witness = false;
      for (const inpt of inputs) {
        if ('txid' in inpt && todays_txids.has(String(inpt.txid).slice(-8))) { has_sameday_input = true; break; }
        if ('txinwitness' in inpt) {
          for (const witness of inpt.txinwitness) {
            if (String(witness).length > 500) { has_big_witness = true; break; }
          }
        }
        if (has_sameday_input || has_big_witness) break;
      }
      if (has_sameday_input || has_big_witness) continue;

      for (const output of outputs) {
        const amount = parseFloat(output.value);
        if (amount > 1e-5 && amount < 1e5) {
          const amount_log = Math.log10(amount);
          const percent_in_range = (amount_log - first_bin_value) / range_bin_values;
          let bin_number_est = Math.trunc(percent_in_range * number_of_bins);
          while (output_bell_curve_bins[bin_number_est] <= amount) bin_number_est += 1;
          counts[bin_number_est - 1] += 1.0;
        }
      }
    }
  }

  return { addBlock, counts };
}

// ── Parts 7–9: curve conditioning + stencil slide (exact v8) ────────────────
function estimateFromCounts(countsIn) {
  const c = Array.from(countsIn);

  for (let n = 0; n < 201; n++) c[n] = 0;                       // < ~10k sats
  for (let n = 1601; n < c.length; n++) c[n] = 0;               // large amounts
  for (const r of round_btc_bins) c[r] = 0.5 * (c[r + 1] + c[r - 1]); // smooth round btc

  let curve_sum = 0.0;
  for (let n = 201; n < 1601; n++) curve_sum += c[n];
  if (curve_sum <= 0) return null;
  for (let n = 201; n < 1601; n++) {
    c[n] /= curve_sum;
    if (c[n] > 0.008) c[n] = 0.008;                             // extreme clip
  }

  const center_p001 = 601;                                      // 0.001 btc bin
  const left_p001  = center_p001 - Math.trunc((NUM_ELEMENTS + 1) / 2);
  const right_p001 = center_p001 + Math.trunc((NUM_ELEMENTS + 1) / 2);
  const min_slide = -141;                                       // $500k
  const max_slide = 201;                                        // $5k

  let best_slide = 0, best_slide_score = 0, total_score = 0;
  for (let slide = min_slide; slide < max_slide; slide++) {
    const off = left_p001 + slide;
    let slide_score_smooth = 0.0, slide_score = 0.0;
    for (let n = 0; n < NUM_ELEMENTS; n++) {
      const v = c[off + n];
      slide_score_smooth += v * smooth_stencil[n];
      slide_score += v * spike_stencil[n];
    }
    if (slide < 150) slide_score = slide_score + slide_score_smooth * 0.65;
    if (slide_score > best_slide_score) { best_slide_score = slide_score; best_slide = slide; }
    total_score += slide_score;
  }
  if (best_slide_score <= 0) return null;

  const btc_in_usd_best = 100 / output_bell_curve_bins[center_p001 + best_slide];

  const scoreAt = (slide) => {
    const off = left_p001 + slide;
    let s = 0.0;
    for (let n = 0; n < NUM_ELEMENTS; n++) s += c[off + n] * spike_stencil[n];
    return s;
  };
  const neighbor_up_score = scoreAt(best_slide + 1);
  const neighbor_down_score = scoreAt(best_slide - 1);
  let best_neighbor = +1, neighbor_score = neighbor_up_score;
  if (neighbor_down_score > neighbor_up_score) { best_neighbor = -1; neighbor_score = neighbor_down_score; }
  const btc_in_usd_2nd = 100 / output_bell_curve_bins[center_p001 + best_slide + best_neighbor];

  const avg_score = total_score / (max_slide - min_slide);
  const a1 = best_slide_score - avg_score;
  const a2 = Math.abs(neighbor_score - avg_score);
  const w1 = a1 / (a1 + a2);
  const w2 = a2 / (a1 + a2);
  const price_estimate = Math.trunc(w1 * btc_in_usd_best + w2 * btc_in_usd_2nd);
  return { price: price_estimate, best_slide };
}

// ── Runner: v8 day selection + block walk over injected rpc ────────────────
// createOracle({ rpc, log }) → { run(), last(), isRunning() }
// run() estimates the price for the day before the node's latest block's UTC
// day (v8's "most recent price"), exactly like pressing ENTER in the script.
function createOracle({ rpc, log = () => {}, blockDelayMs = 150, retries = 3 }) {
  let lastResult = null; // { price, priceDate, blocks, at }
  let running = false;

  const utcDayStr = (d) => d.toISOString().slice(0, 10);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // v3.1.1: retrying rpc wrapper. getblock verbosity 2 is a multi-MB JSON
  // serialization on bitcoind's side and can exceed the API's default 8s
  // rpc timeout on modest hardware -- so oracle calls pass explicit long
  // timeouts (server.js rpc() gained an ms param in v3.1.1) and retry
  // transient failures with backoff instead of aborting the whole day-read.
  async function call(method, params, ms) {
    let lastErr;
    for (let a = 1; a <= retries; a++) {
      try { return await rpc(method, params, ms); }
      catch (e) {
        lastErr = e;
        log(`[utxoracle] rpc ${method} attempt ${a}/${retries} failed: ${e.message}`);
        await sleep(1500 * a);
      }
    }
    throw lastErr;
  }

  async function headerAt(height) {
    const hash = await call('getblockhash', [height], 30000);
    return call('getblockheader', [hash, true], 30000);
  }

  async function run() {
    if (running) return lastResult;
    running = true;
    try {
      // Part 2: latest block → latest UTC midnight → price day = day before
      const block_count = await call('getblockcount', [], 30000);
      const latestHeader = await headerAt(block_count);
      const latest = new Date(latestHeader.time * 1000);
      const latest_utc_midnight = Date.UTC(latest.getUTCFullYear(), latest.getUTCMonth(), latest.getUTCDate()) / 1000;
      const price_day_seconds = latest_utc_midnight - SECONDS_IN_A_DAY;
      const priceDate = utcDayStr(new Date(price_day_seconds * 1000));

      if (lastResult && lastResult.priceDate === priceDate) return lastResult; // already have today's answer
      log(`[utxoracle] starting: estimating ${priceDate} from ~144 blocks -- this takes several minutes, progress every 24 blocks...`);

      // Part 4: jump-search for the first block of the price day (v8 logic)
      let seconds_since = latestHeader.time - price_day_seconds;
      let est = block_count - Math.round(144 * seconds_since / SECONDS_IN_A_DAY);
      let hdr = await headerAt(est);
      let jump = Math.round(144 * (hdr.time - price_day_seconds) / SECONDS_IN_A_DAY);
      let last_est = 0, last_last_est = 0;
      while (Math.abs(jump) > 6 && jump !== last_last_est) {
        last_last_est = last_est; last_est = jump;
        est = est - jump;
        hdr = await headerAt(est);
        jump = Math.round(144 * (hdr.time - price_day_seconds) / SECONDS_IN_A_DAY);
      }
      if (hdr.time > price_day_seconds) {
        while (hdr.time > price_day_seconds) { est -= 1; hdr = await headerAt(est); }
        est += 1;
      } else if (hdr.time < price_day_seconds) {
        while (hdr.time < price_day_seconds) { est += 1; hdr = await headerAt(est); }
      }

      // Part 6: walk the day's blocks through the accumulator
      const acc = createDayAccumulator();
      let height = est;
      let hash = await call('getblockhash', [height], 30000);
      let block = await call('getblock', [hash, 2], 90000);
      const target_dom = new Date(block.time * 1000).getUTCDate();
      let blocksRead = 0;
      while (new Date(block.time * 1000).getUTCDate() === target_dom) {
        acc.addBlock(block);
        blocksRead += 1;
        if (blocksRead % 24 === 0) log(`[utxoracle] progress: ${blocksRead} blocks read (height ${height})...`);
        height += 1;
        await sleep(blockDelayMs); // pace RPC so pollBitcoind never starves
        hash = await call('getblockhash', [height], 30000);
        block = await call('getblock', [hash, 2], 90000);
      }

      const est9 = estimateFromCounts(acc.counts);
      if (est9) {
        lastResult = { price: est9.price, priceDate, blocks: blocksRead, at: Date.now() };
        log(`[utxoracle] ${priceDate} price estimate: $${est9.price.toLocaleString()} (${blocksRead} blocks, UTXOracle v8 method)`);
      } else {
        log(`[utxoracle] ${priceDate}: no estimate (empty/degenerate curve)`);
      }
      return lastResult;
    } catch (e) {
      log(`[utxoracle] run failed: ${e.message}`);
      return lastResult;
    } finally {
      running = false;
    }
  }

  return { run, last: () => lastResult, isRunning: () => running };
}

module.exports = { createOracle, createDayAccumulator, estimateFromCounts, _bins: output_bell_curve_bins };

// ── selftest ─────────────────────────────────────────────────────────────────
// `node utxoracle.js` — deterministic (seeded LCG) synthetic day pushed
// through the accumulator + estimator; asserts the EXACT integer computed by
// the validated build (equivalence-proven against UTXOracle.py v8 upstream).
// Purpose: catches any transcription damage during deploy embedding.
if (require.main === module) {
  let seed = 0xC0FFEE;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const P = 91000;
  const acc = createDayAccumulator();
  const mkOut = (v) => ({ value: v, scriptPubKey: { type: 'witness_v0_keyhash', asm: '0 ab' } });
  const usdSpots = [[10, 16], [20, 15], [50, 26], [100, 28], [200, 18], [500, 17], [1000, 16]];
  const txs = [];
  let id = 0;
  for (const [usd, cnt] of usdSpots) {
    for (let i = 0; i < cnt * 4; i++) {
      txs.push({ txid: 't' + (id++), vin: [{ txid: 'p' + id, vout: 0 }], vout: [mkOut(usd / P * (1 + (rnd() - 0.5) * 0.004)), mkOut(Math.pow(10, -4 + rnd() * 4))] });
    }
  }
  for (let i = 0; i < 400; i++) {
    txs.push({ txid: 'n' + (id++), vin: [{ txid: 'q' + id, vout: 0 }], vout: [mkOut(Math.pow(10, -4.5 + rnd() * 5)), mkOut(Math.pow(10, -4.5 + rnd() * 5))] });
  }
  acc.addBlock({ time: 0, tx: txs });
  const r = estimateFromCounts(acc.counts);
  const EXPECTED = 90603; // pinned from the equivalence-validated build
  console.log('selftest price:', r && r.price);
  if (EXPECTED !== null) {
    if (!r || r.price !== EXPECTED) { console.error(`SELFTEST FAIL: got ${r && r.price}, expected ${EXPECTED}`); process.exit(1); }
    console.log('SELFTEST PASS (exact match with validated build)');
  }
}
