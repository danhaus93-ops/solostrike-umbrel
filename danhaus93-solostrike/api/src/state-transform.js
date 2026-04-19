// Calculate block-finding probability based on pool HR vs network HR
function computeOdds(state) {
  const poolHR = state.hashrate?.current || 0;
  const netHR  = state.network?.hashrate || 0;
  if (!poolHR || !netHR) {
    return { perBlock: 0, expectedDays: null, perDay: 0 };
  }
  const perBlock       = poolHR / netHR;
  const blocksPerDay   = 144;
  const perDay         = 1 - Math.pow(1 - perBlock, blocksPerDay);
  const expectedBlocks = 1 / perBlock;
  const expectedDays   = expectedBlocks / blocksPerDay;
  return { perBlock, expectedDays, perDay };
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

// Aggregate the last N network blocks into top pool-finders leaderboard.
// Returns top 5 pools with block count in the sample window.
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
  return Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// Compute estimated next-block reward = subsidy + mempool fees total
function computeBlockReward(state) {
  const subsidyBtc = 3.125;
  const feesBtc    = state.mempool?.totalFeesBtc || 0;
  return {
    subsidyBtc,
    feesBtc,
    totalBtc: subsidyBtc + feesBtc,
    totalSats: Math.round((subsidyBtc + feesBtc) * 1e8),
  };
}

function transformState(state) {
  const { _avgState, workers, ...rest } = state;
  return {
    ...rest,
    workers:     Object.values(workers || {}),
    odds:        computeOdds(state),
    luck:        computeLuck(state),
    retarget:    state.retarget  || null,
    netBlocks:   state.netBlocks || [],
    topFinders:  computeTopFinders(state),
    blockReward: computeBlockReward(state),
  };
}

module.exports = { transformState };
