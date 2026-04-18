// Calculate block-finding probability based on pool HR vs network HR
function computeOdds(state) {
  const poolHR = state.hashrate?.current || 0;
  const netHR = state.network?.hashrate || 0;
  if (!poolHR || !netHR) {
    return { perBlock: 0, expectedDays: null, perDay: 0 };
  }
  const perBlock = poolHR / netHR;
  const blocksPerDay = 144; // Bitcoin average
  const perDay = 1 - Math.pow(1 - perBlock, blocksPerDay);
  const expectedBlocks = 1 / perBlock;
  const expectedDays = expectedBlocks / blocksPerDay;
  return { perBlock, expectedDays, perDay };
}

// Transform state so workers is an array, matching what the UI expects,
// and add computed odds
function transformState(state) {
  return {
    ...state,
    workers: Object.values(state.workers || {}),
    odds: computeOdds(state),
  };
}

module.exports = { transformState };
