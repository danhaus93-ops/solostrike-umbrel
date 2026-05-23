// state-transform.js — formats internal state for the public API surface.
// v1.9.0: enriches each worker with `poolAlignment` AND `live` from the
// miner-poller cache. Both are null when polling is disabled or no result
// yet exists.

const { getAlignmentForWorker, getLiveForWorker } = require('./miner-poller');

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

// v1.11.31: transformState accepts options. opts.compact=true strips
// the 90-day snapshots blob to keep WS broadcast payloads small (was
// ~134KB → now ~5-10KB). The HTTP /api/state endpoint always returns
// the full payload including snapshots, so the client gets them once
// on initial load and preserves them via merge logic in usePool.js
// across subsequent WS updates.
function transformState(state, opts) {
  const compact = opts && opts.compact === true;
  // v1.10.1 SECURITY: explicitly strip sensitive fields before returning. The
  // /api/state endpoint is on Umbrel's app_proxy auth whitelist (no session
  // required), so anything we return here is reachable by anyone who can
  // reach the Umbrel host (LAN, Tailscale, exposed reverse proxy). The
  // payout address is PII and the webhooks list contains URLs that may
  // include bearer tokens. Both belong on the authenticated /api/config
  // endpoint instead.
  const {
    _avgState, _workerLastStatus, workers, shareCounters,
    payoutAddress,    // PII — exposed via /api/config (auth required) instead
    webhooks,         // URLs may contain Discord/Slack/ntfy webhook tokens
    // v1.11.32 FIX: snapshots was previously NOT destructured, so the
    // earlier ...(compact ? {} : { snapshots }) conditional was a no-op
    // (snapshots was still in ...rest). Now properly extracted so we can
    // omit it from compact broadcasts.
    snapshots: stateSnapshots,
    // v1.11.32: networkStats.peers can be 100-500 entries worldwide,
    // ~150 bytes each. Extract networkStats so we can rebuild it in
    // compact mode with peers omitted.
    networkStats: stateNetworkStats,
    // v1.11.32: state.blocks can hold up to 1000 mined blocks. Compact
    // broadcasts ship only the latest 20; full history available on
    // /api/state initial load. Client merge preserves the rest.
    blocks: stateBlocks,
    // v1.11.33 FIX: state.hashrate.history holds 1440 entries (24h @ 1min)
    // and state.hashrate.week holds up to 10080 entries (7d @ 1min).
    hashrate: stateHashrate,
    // v1.11.34 FIX (RUNTIME-VERIFIED): production /api/state diagnostic
    // showed actual bloat was elsewhere than I'd been targeting:
    //   shares          = 46KB (rejectReasons dict grows unbounded)
    //   sharelogCursors = 21KB (server-only bookkeeping, UI never reads)
    //   workers         = 57KB (statusHistory at 3.7KB × N workers)
    shares: stateShares,
    sharelogCursors: _stateSharelogCursors,  // dropped entirely from output
    ...rest
  } = state;
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
    // v1.10.1 SECURITY: expose only `hasAddress: boolean` (not the address
    // itself). UI's onboarding-detection check (`if (!poolState.payoutAddress)`)
    // is updated to use this boolean. Components needing the actual address
    // (StratumPanel for the copy-username feature) read it from /api/config
    // instead.
    hasAddress: !!payoutAddress,
    // v1.11.34: in compact mode strip per-worker statusHistory (3.7KB
    // each × 13 workers = 48KB!) and ship just the last 2 entries as
    // statusHistoryTail. Client appends them to its existing array
    // (deduped by ts). UptimeSparkline stays live, payload tiny.
    // shareEvents stays in compact (small, 267 bytes, drives striker
    // animations).
    workers: Object.values(workers || {}).map(w => {
      if (compact) {
        const { statusHistory, ...wRest } = w;
        return {
          ...wRest,
          shareEvents:   (shareCounters || {})[w.name] || null,
          poolAlignment: getAlignmentForWorker(w.name),
          live:          getLiveForWorker(w.name),
          statusHistoryTail: Array.isArray(statusHistory) ? statusHistory.slice(-2) : [],
        };
      }
      return {
        ...w,
        shareEvents:   (shareCounters || {})[w.name] || null,
        poolAlignment: getAlignmentForWorker(w.name),
        live:          getLiveForWorker(w.name),
      };
    }),
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
    // v1.11.32: heavy fields ride only on /api/state (full), not WS broadcasts.
    // Client merge logic in usePool.js preserves last-known values.
    ...(compact ? {
      // Compact broadcast: ship only the latest 20 blocks (UI shows ~5 max
      // in the "latest blocks" strip; full history loads via /api/state).
      blocks: Array.isArray(stateBlocks) ? stateBlocks.slice(0, 20) : [],
      // Compact broadcast: networkStats WITHOUT peers (peers array can be
      // 100-500 entries × ~150 bytes = up to 75KB).
      networkStats: stateNetworkStats
        ? (({ peers, ...rest_ns }) => rest_ns)(stateNetworkStats)
        : undefined,
      // v1.11.33: hashrate without full history/week arrays. Charts need
      // those arrays to render, so we ship just the LAST 2 entries from
      // each as historyTail/weekTail. Client appends new points to its
      // existing arrays (deduped by ts). Chart stays live, payload tiny
      // (~70 bytes vs 300KB+ for the full arrays).
      hashrate: stateHashrate ? {
        current:     stateHashrate.current     || 0,
        averages:    stateHashrate.averages    || {},
        historyTail: Array.isArray(stateHashrate.history) ? stateHashrate.history.slice(-2) : [],
        weekTail:    Array.isArray(stateHashrate.week)    ? stateHashrate.week.slice(-2)    : [],
      } : undefined,
      // v1.11.34: shares.rejectReasons grows unbounded — accumulates every
      // unique rejection string ckpool ever emits. Production showed 46KB.
      // Cap to TOP 20 most-frequent reasons (covers >99% of rejects). Full
      // dictionary available via /api/state.
      //
      // v1.11.36: shares.spsHistory holds 1440 entries (24h @ 1min sampling)
      // at ~32 bytes each = ~46KB. This was the REAL culprit hiding in
      // state.shares all along — v1.11.34's rejectReasons cap was correct
      // but targeted the wrong field. Same fix as hashrate: ship last 2
      // entries as spsHistoryTail, client appends to its existing array.
      // StrikeVelocityChart consumes shares.spsHistory.
      shares: stateShares ? (() => {
        const { rejectReasons, spsHistory, ...rest_s } = stateShares;
        const top = rejectReasons
          ? Object.entries(rejectReasons).sort((a,b)=>b[1]-a[1]).slice(0,20)
          : [];
        return {
          ...rest_s,
          rejectReasons: Object.fromEntries(top),
          spsHistoryTail: Array.isArray(spsHistory) ? spsHistory.slice(-2) : [],
        };
      })() : undefined,
      // snapshots omitted entirely in compact mode
      // sharelogCursors omitted entirely (server-only bookkeeping)
    } : {
      blocks: stateBlocks || [],
      networkStats: stateNetworkStats || undefined,
      hashrate: stateHashrate || undefined,
      shares: stateShares || undefined,
      snapshots: stateSnapshots || { daily: [], closestCalls: [], lastRollupDate: null },
      // sharelogCursors still omitted from /api/state — UI never reads it
    }),
  };
}

module.exports = { transformState };
