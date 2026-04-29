function computeOdds(state) {
  const poolHR = state.hashrate?.current || 0;
  const netHR  = state.network?.hashrate || 0;
  if (!poolHR || !netHR) {
    return { perBlock: 0, expectedDays: null, perDay: 0, perWeek: 0, perMonth: 0, perYear: 0 };
  }
  const perBlock     = poolHR / netHR;
  const blocksPerDay = 144;
  const blocksPerWk  = 144 * 7;
  const blocksPerMo  = 144 * 30;
  const blocksPerYr  = 144 * 365;
  const notFind = 1 - perBlock;
  const perDay   = 1 - Math.pow(notFind, blocksPerDay);
  const perWeek  = 1 - Math.pow(notFind, blocksPerWk);
  const perMonth = 1 - Math.pow(notFind, blocksPerMo);
  const perYear  = 1 - Math.pow(notFind, blocksPerYr);
  const expectedDays = (1 / perBlock) / blocksPerDay;
  return { perBlock, expectedDays, perDay, perWeek, perMonth, perYear };
}

function computeLuck(state) {
  const netDiff = state.network?.difficulty || 0;
  const avg     = state._avgState;
  const found   = (state.blocks || []).length;
  if (!netDiff || !avg || !avg.totalHashTime) {
    return { progress: 0, blocksExpected: 0, blocksFound: found, luck: null };
  }
  const hashesPerBlock = netDiff * Math.pow(2, 32);
  const blocksExpected = avg.totalHashTime / hashesPerBlock;
  const progress       = blocksExpected * 100;
  const luck           = blocksExpected >= 0.01 ? (found / blocksExpected) * 100 : null;
  return { progress, blocksExpected, blocksFound: found, luck };
}

function computeTopFinders(state) {
  const blocks = state.netBlocks || [];
  if (!blocks.length) return [];
  const counts = new Map();
  for (const b of blocks) {
    const name = b.pool || 'Unknown';
    const prev = counts.get(name) || { name, count: 0, isSolo: b.isSolo };
    prev.count += 1;
    counts.set(name, prev);
  }
  return Array.from(counts.values()).sort((a, b) => b.count - a.count).slice(0, 5);
}

function computeBlockReward(state) {
  // iter27c bug 1+3: pollBitcoind() in server.js already writes the correct
  // reward to state.blockReward using getblocktemplate's coinbasevalue. We
  // were previously *overwriting* that with state.mempool.totalFeesBtc, which
  // is never populated → fees always rendered as 0.0000.
  //
  // Fix: prefer the values already on state.blockReward (whichever key shape
  // they came in as), fall back to state.mempool.totalFeesBtc if those are
  // missing, fall back to 0 last. Output both `base/fees` and
  // `subsidyBtc/feesBtc` keys so existing UI consumers (which destructure
  // both shapes defensively) keep working.
  const br = state.blockReward || {};
  const subsidyBtc = br.base ?? br.subsidyBtc ?? 3.125;
  const feesBtc    = br.fees ?? br.feesBtc ?? state.mempool?.totalFeesBtc ?? 0;
  const totalBtc   = br.totalBtc ?? (subsidyBtc + feesBtc);
  return {
    base: subsidyBtc,
    subsidyBtc,
    fees: feesBtc,
    feesBtc,
    totalBtc,
    totalSats: Math.round(totalBtc * 1e8),
  };
}

function transformState(state) {
  const { _avgState, _workerLastStatus, workers, shareCounters, ...rest } = state;
  // netBlocks fallback (v1.5.7+) — when mempool.space is unreachable or privateMode,
  // synthesize netBlocks[0] from the locally-fetched latestBlock (from Bitcoin Core RPC)
  let netBlocks = Array.isArray(state.netBlocks) ? state.netBlocks : [];
  if (!netBlocks.length && state.latestBlock) {
    const lb = state.latestBlock;
    netBlocks = [{
      height: lb.height,
      timestamp: Math.floor((lb.timestamp || Date.now()) / 1000),
      pool: lb.miner || 'unknown',
      id: lb.hash,
      tx_count: null,
      reward: lb.reward != null ? Math.round(lb.reward * 1e8) : undefined,
      isSolo: /solostrike/i.test(lb.miner || ''),
    }];
  }
  return {
    ...rest,
    workers:              Object.values(workers || {}).map(w => ({ ...w, shareEvents: (shareCounters || {})[w.name] || null })),
    odds:                 computeOdds(state),
    luck:                 computeLuck(state),
    retarget:             state.retarget  || null,
    netBlocks,
    latestBlock:          state.latestBlock || null,
    nodeInfo:             state.nodeInfo  || null,
    sync:                 state.sync      || null,
    privateMode:          state.privateMode || false,
    localMempoolReachable: state.localMempoolReachable || false,
    topFinders:           computeTopFinders(state),
    blockReward:          computeBlockReward(state),
    snapshots:            state.snapshots || { daily: [], closestCalls: [], lastRollupDate: null },
  };
}

module.exports = { transformState };
