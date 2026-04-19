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

// Luck / lottery progress.
// Hash-seconds integral (state._avgState.totalHashTime) vs expected hashes-per-block.
// Expected hashes to find one block at current difficulty = netDiff * 2^32.
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

// Transform state into a public payload safe to broadcast.
// Strips internal-only fields (_avgState) before emission.
function transformState(state) {
  const { _avgState, workers, ...rest } = state;
  return {
    ...rest,
    workers:   Object.values(workers || {}),
    odds:      computeOdds(state),
    luck:      computeLuck(state),
    retarget:  state.retarget  || null,
    netBlocks: state.netBlocks || [],
  };
}

module.exports = { transformState };
