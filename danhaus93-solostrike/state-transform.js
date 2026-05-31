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
// v1.11.37: shares-flowing alignment proof. The URL-based fallback added in
// v1.11.31 doesn't work for Docker installs because os.networkInterfaces()
// inside the API container returns container bridge IPs (172.x.x.x), not
// the Umbrel host's LAN IP. When a miner reports redacted User credentials,
// the only way to "verify" alignment from inside the container is via the
// strongest possible signal: the miner is actively submitting shares that
// ckpool is accepting. If we see the worker name in shareCounters with a
// recent lastShareAt, the miner IS pointed at our pool — no IP match
// needed. Self-evident proof: they couldn't be in our share log if they
// weren't sending shares to us.
function enhanceAlignmentWithShares(alignment, shareCounters, workerName) {
  if (!alignment) return alignment;
  if (alignment.status !== 'unverifiable' || alignment.error !== 'no_user_data') {
    return alignment;
  }
  const counter = shareCounters && shareCounters[workerName];
  if (!counter || !counter.lastShareAt) return alignment;
  const ageMs = Date.now() - counter.lastShareAt;
  // 5-minute freshness window. Shares older than this aren't strong
  // enough proof — the miner may have moved to a different pool.
  if (ageMs > 5 * 60 * 1000) return alignment;
  return {
    ...alignment,
    status: 'aligned',
    matchedBy: 'shares-flowing',
    lastShareAgo: Math.round(ageMs / 1000),
  };
}

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
    pool: statePool,
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
    pool: statePool ? (compact ? (() => {
      const { workersHistory, ...rest_p } = statePool;
      return { ...rest_p, workersHistoryTail: Array.isArray(workersHistory) ? workersHistory.slice(-10) : [] };
    })() : statePool) : undefined,
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
      // v1.11.37: shares-flowing alignment fallback applied to both paths
      const rawAlignment = getAlignmentForWorker(w.name);
      const alignment = enhanceAlignmentWithShares(rawAlignment, shareCounters, w.name);
      if (compact) {
        const { statusHistory, ...wRest } = w;
        return {
          ...wRest,
          shareEvents:   (shareCounters || {})[w.name] || null,
          poolAlignment: alignment,
          live:          getLiveForWorker(w.name),
          statusHistoryTail: Array.isArray(statusHistory) ? statusHistory.slice(-10) : [],
        };
      }
      return {
        ...w,
        shareEvents:   (shareCounters || {})[w.name] || null,
        poolAlignment: alignment,
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
      // Compact broadcast: networkStats WITHOUT full peers array but WITH
      // peerHeartbeats (pubkey → lastSeenAgoSec). Full peers (loc, hashrate,
      // etc) are preserved client-side from initial /api/state. The
      // heartbeat update is essential for the peer share-synthesis effect
      // in App.jsx — it triggers a new Poisson schedule whenever a peer's
      // lastSeenAgoSec resets to a smaller value (= they just rebroadcast).
      // Without this, peer firing animations stop after 4 minutes.
      // Cost: ~10 bytes × 20 active peers = 200 bytes vs 75KB for full peers.
      networkStats: stateNetworkStats
        ? (() => {
            const { peers, ...rest_ns } = stateNetworkStats;
            const peerHeartbeats = Array.isArray(peers)
              ? peers
                  .filter(p => p && p.pubkey && Number.isFinite(p.lastSeenAgoSec))
                  .map(p => [p.pubkey, p.lastSeenAgoSec | 0])
              : [];
            return { ...rest_ns, peerHeartbeats };
          })()
        : undefined,
      // v1.11.33: hashrate without full history/week arrays. Charts need
      // those arrays to render, so we ship just the LAST N entries from
      // each as historyTail/weekTail. Client appends new points to its
      // existing arrays (deduped by ts). Chart stays live, payload tiny.
      // v1.11.38: tail size is now 10 (was 2). Reason: WS broadcasts every
      // 3s, samples written every 60s. A 5-minute disconnect window misses
      // 5 samples — a tail of 2 only catches 2, losing 3. Tail of 10
      // covers ≥10 minutes of disconnect transparently. Cost: ~150 bytes
      // extra per broadcast (10 entries × ~15 bytes vs 2 × 15). Trivial.
      // The new "full state on connect" welcome message (above) is the
      // primary defense; this is the secondary safety net.
      hashrate: stateHashrate ? {
        current:     stateHashrate.current     || 0,
        averages:    stateHashrate.averages    || {},
        historyTail: Array.isArray(stateHashrate.history) ? stateHashrate.history.slice(-10) : [],
        weekTail:    Array.isArray(stateHashrate.week)    ? stateHashrate.week.slice(-10)    : [],
      } : undefined,
      // v1.11.34: shares.rejectReasons grows unbounded — accumulates every
      // unique rejection string ckpool ever emits. Production showed 46KB.
      // Cap to TOP 20 most-frequent reasons (covers >99% of rejects). Full
      // dictionary available via /api/state.
      //
      // v1.11.36: shares.spsHistory holds 1440 entries (24h @ 1min sampling)
      // at ~32 bytes each = ~46KB. This was the REAL culprit hiding in
      // state.shares all along — v1.11.34's rejectReasons cap was correct
      // but targeted the wrong field. Same fix as hashrate: ship last N
      // entries as spsHistoryTail, client appends to its existing array.
      // StrikeVelocityChart consumes shares.spsHistory.
      // v1.11.38: tail size is 10 (was 2), matching hashrate tails — covers
      // ≥10 minute disconnects without dropping samples.
      shares: stateShares ? (() => {
        // v1.12.0: bestHistory (Best Share Trend) gets the same tail treatment
        // as spsHistory — 1440 entries @ 1min would bloat every broadcast.
        const { rejectReasons, spsHistory, bestHistory, ...rest_s } = stateShares;
        const top = rejectReasons
          ? Object.entries(rejectReasons).sort((a,b)=>b[1]-a[1]).slice(0,20)
          : [];
        return {
          ...rest_s,
          rejectReasons: Object.fromEntries(top),
          spsHistoryTail: Array.isArray(spsHistory) ? spsHistory.slice(-10) : [],
          bestHistoryTail: Array.isArray(bestHistory) ? bestHistory.slice(-10) : [],
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
