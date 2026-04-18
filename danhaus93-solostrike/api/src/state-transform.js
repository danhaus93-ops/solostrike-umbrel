// Transform state so workers is an array, matching what the UI expects
function transformState(state) {
  return {
    ...state,
    workers: Object.values(state.workers || {}),
  };
}

module.exports = { transformState };
