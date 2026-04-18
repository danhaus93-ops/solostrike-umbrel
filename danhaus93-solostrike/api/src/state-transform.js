// Calculate block-finding probability based on pool HR vs network HR
function computeOdds(state) {
  const poolHR = state.hashrate?.current || 0;
  const netHR  = state.network?.hashrate || 0;
  if (!poolHR || !netHR) {
    return { perBlock: 0, expectedDays: null, perDay: 0 };
  }
  const perBlock       = poolHR / netHR;
  const blocksPerDay   = 144; // Bitcoin average
  const perDay         = 1 - Math.pow(1 - perBlock, blocksPerDay);
  const expectedBlocks = 1 / perBlock;
  const expectedDays   = expectedBlocks / blocksPerDay;
  return { perBlock, expectedDays, perDay };
}

// Luck / lottery progress.
// We maintain a running integral of hashrate*time ("hash-seconds") since pool start.
// Expected hashes to find one block at current difficulty = netDiff * 2^32.
// Progress = cumulative hash-seconds / hashes-per-block  (as percent toward 1 block).
// Luck    = blocks-found / blocks-expected * 100 (only meaningful after >= 1 block or when expected >= 0.5).
function computeLuck(state) {
  const netDiff = state.network?.difficulty || 0;
  const avg     = state.hashrate?._avgState;
  const found   = (state.blocks || []).length;
  if (!netDiff || !avg || !avg.totalHashTime) {
    return { progress: 0, blocksExpected: 0, blocksFound: found, luck: null };
  }
  const hashesPerBlock = netDiff * Math.pow(2, 32);
  const blocksExpected = avg.totalHashTime / hashesPerBlock;
  const progress       = blocksExpected * 100;                        // % toward next expected
  const luck           = blocksExpected >= 0.01 ? (found / blocksExpected) * 100 : null;
  return { progress, blocksExpected, blocksFound: found, luck };
}

// Transform state so workers is an array, matching what the UI expects,
// and add computed odds + luck + difficulty retarget + recent network blocks.
function transformState(state) {
  // Strip the internal _avgState blob from public output
  const { _avgState, ...hashrateOut } = state.hashrate || {};
  return {
    ...state,
    hashrate:  hashrateOut,
    workers:   Object.values(state.workers || {}),
    odds:      computeOdds(state),
    luck:      computeLuck(state),
    retarget:  state.retarget  || null,
    netBlocks: state.netBlocks || [],
  };
}

module.exports = { transformState };
