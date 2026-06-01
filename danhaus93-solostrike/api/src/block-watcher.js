// ── Block watcher (v1.5.7+) ─────────────────────────────────────────────────
// Tails ckpool.log for block-solve events. When your pool finds a block, ckpool
// writes a distinctive log line. We parse it, append to state.blocks, broadcast
// a BLOCK_FOUND websocket event, and fire 'block_found' webhooks.
//
// ckpool-solo writes these patterns (observed from source + community logs):
//   * "BLOCK ACCEPTED!"       — block accepted by network
//   * "Block hash: <hex>"     — follows above
//   * "Block solved"          — variant
//   * "SOLVED"                — short variant
//   * "block .*? solved"      — yet another variant
//
// We match any of the above, then capture the hash from the nearest
// "Block hash:" line. Height is fetched from state.network.height at the
// moment of the event.

const fs = require('fs');
const path = require('path');

function startBlockWatcher({ state, broadcast, fireHooks, savePersist, logDir }) {
  const logPath = path.join(logDir, 'ckpool.log');
  if (!fs.existsSync(logPath)) {
    console.warn('[block-watcher] ckpool.log not found at', logPath);
    return;
  }

  let lastSize = 0;
  let pendingHash = null;
  let pendingHeight = null;

  try {
    lastSize = fs.statSync(logPath).size;
  } catch {}

  function handleBlockFound({ hash, height }) {
    // v1.12.0: block effort / luck. ckpool tells us a block was solved but not
    // how hard it was to find. Effort% = (shares submitted this round) /
    // (shares expected for the network difficulty). <100% = lucky, >100% =
    // unlucky. We approximate round shares from the accepted-share counter's
    // delta since the previous block, and expected shares ≈ network difficulty
    // (the average number of diff-1 shares to find a block at that difficulty).
    const netDiff = state.network?.difficulty || 0;
    const acceptedNow = state.shares?.accepted || 0;
    const sharesThisRound = Math.max(0, acceptedNow - (state._sharesAtLastBlock || 0));
    let effortPct = null;
    if (netDiff > 0 && sharesThisRound > 0) {
      effortPct = +((sharesThisRound / netDiff) * 100).toFixed(1);
    }
    const block = {
      hash: hash || null,
      height: height || state.network?.height || 0,
      timestamp: Date.now(),
      miner: 'SoloStrike',
      minerAlias: null,
      difficulty: netDiff,
      reward: (3.125 + (state.mempool?.totalFeesBtc || 0)),
      // v1.12.0 effort/luck fields
      sharesThisRound,
      effortPct,
          };
          // Dedup: skip if this block hash is already recorded (handles multi-pattern log matches)
          if (block.hash && (state.blocks || []).some(b => b.hash === block.hash)) return;
          console.log('[block-watcher] 🎉 BLOCK FOUND:', block.height, block.hash || '(hash pending)');

    state.blocks = [block, ...(state.blocks || [])].slice(0, 1000);
    // v1.12.0: reset the round baseline so the NEXT block's effort measures
    // only shares since this solve.
    state._sharesAtLastBlock = acceptedNow;
    // Append to the block-effort history ring (persisted by snapshots.js).
    if (!Array.isArray(state.blockEffortHistory)) state.blockEffortHistory = [];
    state.blockEffortHistory.unshift({
      height: block.height,
      ts: block.timestamp,
      effortPct,
      sharesThisRound,
      difficulty: netDiff,
    });
    state.blockEffortHistory = state.blockEffortHistory.slice(0, 200);
    try { broadcast({ type: 'BLOCK_FOUND', data: block }); } catch {}
    try { fireHooks('block_found', { block }); } catch {}
    try {
      savePersist({
        closestCalls: state.closestCalls,
        blocks: state.blocks,
        snapshots: state.snapshots,
        webhooks: state.webhooks,
      });
    } catch {}
  }

  function processChunk(chunk) {
    const lines = chunk.split(/\r?\n/);
    for (const raw of lines) {
      if (!raw) continue;
      const line = raw.trim();

      // Capture hash/height proactively from context
      const hashMatch = line.match(/Block hash[:\s]+([0-9a-fA-F]{64})/i);
      if (hashMatch) {
        pendingHash = hashMatch[1].toLowerCase();
        continue;
      }
      const heightMatch = line.match(/height[:\s]+(\d+)/i);
      if (heightMatch) {
        pendingHeight = parseInt(heightMatch[1], 10);
      }

      // Trigger on any of these event patterns
      const solved =
        /BLOCK ACCEPTED!/i.test(line) ||
        /Block solved/i.test(line) ||
        /\bSOLVED\b/.test(line) ||
        /block .*? solved/i.test(line);

      if (solved) {
        const capturedHash = pendingHash;
        const capturedHeight = pendingHeight;
        // 500ms debounce to capture any follow-up "Block hash:" line
        setTimeout(() => {
          handleBlockFound({
            hash: capturedHash || pendingHash,
            height: capturedHeight || pendingHeight,
          });
          pendingHash = null;
          pendingHeight = null;
        }, 500);
      }
    }
  }

  function tick() {
    fs.stat(logPath, (err, stats) => {
      if (err) return;
      if (stats.size < lastSize) {
        // log rotated
        lastSize = 0;
      }
      if (stats.size <= lastSize) return;
      const stream = fs.createReadStream(logPath, {
        start: lastSize,
        end: stats.size,
        encoding: 'utf8',
      });
      let buf = '';
      stream.on('data', (d) => { buf += d; });
      stream.on('end', () => {
        processChunk(buf);
        lastSize = stats.size;
      });
      stream.on('error', () => {});
    });
  }

  setInterval(tick, 2000);
  console.log('[block-watcher] Watching', logPath, 'for block-solve events');
}

module.exports = { startBlockWatcher };
