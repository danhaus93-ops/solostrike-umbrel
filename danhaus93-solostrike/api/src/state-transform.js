function computeOdds(state) {
  const poolHR = state.hashrate?.current || 0;
  const netHR  = state.network?.hashrate || 0;
  if (!poolHR || !netHR) {
    return { perBlock: 0, expectedDays: null, perDay: 0, perWeek: 0, perMonth: 0 };
  }
  const perBlock     = poolHR / netHR;
  const blocksPerDay = 144;
  const blocksPerWk  = 144 * 7;
  const blocksPerMo  = 144 * 30;
  const notFind = 1 - perBlock;
  const perDay   = 1 - Math.pow(notFind, blocksPerDay);
  const perWeek  = 1 - Math.pow(notFind, blocksPerWk);
  const perMonth = 1 - Math.pow(notFind, blocksPerMo);
  const expectedDays = (1 / perBlock) / blocksPerDay;
  return { perBlock, expectedDays, perDay, perWeek, perMonth };
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
  const subsidyBtc = 3.125;
  const feesBtc    = state.mempool?.totalFeesBtc || 0;
  return {
    subsidyBtc,
    feesBtc,
    totalBtc:  subsidyBtc + feesBtc,
    totalSats: Math.round((subsidyBtc + feesBtc) * 1e8),
  };
}

function transformState(state) {
  const { _avgState, _workerLastStatus, workers, ...rest } = state;
  return {
    ...rest,
    workers:              Object.values(workers || {}),
    odds:                 computeOdds(state),
    luck:                 computeLuck(state),
    retarget:             state.retarget  || null,
    netBlocks:            state.netBlocks || [],
    nodeInfo:             state.nodeInfo  || null,
    sync:                 state.sync      || null,
    privateMode:          state.privateMode || false,
    localMempoolReachable: state.localMempoolReachable || false,
    topFinders:           computeTopFinders(state),
    blockReward:          computeBlockReward(state),
  };
}

module.exports = { transformState };
