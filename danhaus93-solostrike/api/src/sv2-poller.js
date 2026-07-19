// sv2-poller.js — Stage C3
// Polls the SRI SV2 pool's monitoring HTTP API and merges SV2 workers into
// state.workers alongside SV1 (ckpool) workers, so the dashboard shows one
// unified fleet. SV2 workers are tagged protocol:'sv2'.
//
// SRI monitoring API (two-call pattern, confirmed from source + live):
//   GET /api/v1/clients                  -> { items:[ {client_id, extended_channels_count, ...} ] }
//   GET /api/v1/clients/{id}/channels    -> { extended:[ ExtendedChannelInfo ], standard:[ StandardChannelInfo ] }
// ExtendedChannelInfo fields we use: user_identity, nominal_hashrate, stable_hashrate,
//   shares_accepted, shares_rejected, shares_rejected_by_reason, best_diff, blocks_found.
//
// COUNTER-RESET GUARD: SRI counters are in-memory and reset when the pool
// process restarts, whereas our worker shareCounters are cumulative-persisted.
// We keep per-channel high-water marks in persist.json (state.sv2Cursors) and
// add deltas, re-baselining when a counter drops below its high-water (= restart).

const http = require('http');

const POLL_INTERVAL_MS = 10000; // respect monitoring_cache_refresh_secs=10
const SV2_HOST = process.env.SV2POOL_HOST || null; // full container name per store
const SV2_MONITOR_PORT = parseInt(process.env.SV2_MONITOR_PORT || '9091', 10);
const STALE_MS = 5 * 60 * 1000;

function httpGetJson(path) {
  return new Promise((resolve, reject) => {
    if (!SV2_HOST) return reject(new Error('SV2POOL_HOST not set'));
    const req = http.get(
      { host: SV2_HOST, port: SV2_MONITOR_PORT, path, timeout: 4000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} ${path}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      }
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}

// user_identity is "bc1q...address.workername" (solo convention, same as ckpool).
function parseWorkerName(userIdentity) {
  if (!userIdentity) return 'sv2-unknown';
  const dot = userIdentity.indexOf('.');
  return dot >= 0 ? userIdentity.slice(dot + 1) : userIdentity;
}

// Merge one SV2 channel into state.workers with cumulative counters.
function mergeChannel(state, ch, nowTs) {
  if (!state.workers) state.workers = {};
  if (!state.sv2Cursors) state.sv2Cursors = {}; // persisted high-water marks

  const name = parseWorkerName(ch.user_identity);
  const key = `sv2:${ch.channel_id}`;
  const cur = state.sv2Cursors[key] || { accepted: 0, rejected: 0 };

  // reset detection: counter dropped below high-water => pool restarted, re-baseline
  const rawAcc = ch.shares_accepted || 0;
  const rawRej = ch.shares_rejected || 0;
  if (rawAcc < cur.accepted || rawRej < cur.rejected) {
    cur.accepted = 0; cur.rejected = 0; // re-baseline; deltas resume from here
  }
  const dAcc = Math.max(0, rawAcc - cur.accepted);
  const dRej = Math.max(0, rawRej - cur.rejected);
  cur.accepted = rawAcc; cur.rejected = rawRej;
  state.sv2Cursors[key] = cur;

  let w = state.workers[name];
  const existingSv1 = w && w.protocol && w.protocol !== 'sv2';
  if (!w) {
    w = state.workers[name] = {
      name,
      protocol: 'sv2',
      shareCounters: { accepted: 0, rejected: 0 },
      bestshare: 0,
      hashrate: 0,
      shares: 0,
      rejected: 0,
      diff: 0,
      status: 'online',
      lastSeen: nowTs,
    };
  }
  // dedup: same workername already present via SV1 -> tag combined, don't double-count hashrate
  if (existingSv1) w.protocol = 'sv1+sv2';
  else w.protocol = w.protocol === 'sv1+sv2' ? 'sv1+sv2' : 'sv2';

  w.shareCounters = w.shareCounters || { accepted: 0, rejected: 0 };
  w.shareCounters.accepted += dAcc;
  w.shareCounters.rejected += dRej;
  w.shares = w.shareCounters.accepted;
  w.rejected = w.shareCounters.rejected;
  if (ch.shares_rejected_by_reason && Object.keys(ch.shares_rejected_by_reason).length) {
    w.rejectReasons = ch.shares_rejected_by_reason; // pre-bucketed by SRI
  }
  // hashrate: SRI nominal_hashrate can read 0 before stable; keep last nonzero,
  // and mark online since shares are actively arriving.
  const sv2Hr = ch.nominal_hashrate || 0;
  if (existingSv1) w.hashrate = Math.max(w.hashrate || 0, sv2Hr);
  else if (sv2Hr > 0) w.hashrate = sv2Hr;
  w.stableHashrate = !!ch.stable_hashrate;
  w.status = 'online';
  w.lastSeen = nowTs;
  // best diff feeds Near Strikes; keep the max across protocols
  if ((ch.best_diff || 0) > (w.bestshare || 0)) w.bestshare = ch.best_diff;
  if (ch.blocks_found) w.sv2BlocksFound = ch.blocks_found;
  w.channelType = 'extended';
  w.lastUpdate = nowTs;
  return name;
}

async function pollOnce(state) {
  const nowTs = Date.now();
  const list = await httpGetJson('/api/v1/clients');
  const items = (list && list.items) || [];
  const seen = new Set();
  for (const client of items) {
    let chans;
    try { chans = await httpGetJson(`/api/v1/clients/${client.client_id}/channels`); }
    catch (e) { continue; }
    const extended = (chans && chans.extended_channels) || [];
    const standard = (chans && chans.standard_channels) || [];
    for (const ch of extended.concat(standard)) {
      seen.add(mergeChannel(state, ch, nowTs));
    }
  }
  // stale cleanup: SV2 workers not seen this cycle and gone > STALE_MS drop to offline
  for (const [name, w] of Object.entries(state.workers || {})) {
    if (w.protocol && w.protocol.includes('sv2') && !seen.has(name)) {
      if (nowTs - (w.lastUpdate || 0) > STALE_MS) w.hashrate = 0;
    }
  }
  return items.length;
}

function startSv2Poller(state) {
  if (!SV2_HOST) {
    console.log('[SV2Poller] disabled (SV2POOL_HOST not set)');
    return;
  }
  async function loop() {
    try {
      const n = await pollOnce(state);
      state.sv2PoolUp = true;
      state.sv2LastPoll = Date.now();
      if (n > 0) state.sv2ClientCount = n;
    } catch (e) {
      state.sv2PoolUp = false;
      // quiet: pool may be down/starting; don't spam
    }
  }
  setInterval(loop, POLL_INTERVAL_MS);
  loop();
  console.log(`[SV2Poller] Started (poll ${POLL_INTERVAL_MS}ms, host ${SV2_HOST}:${SV2_MONITOR_PORT})`);
}

module.exports = { startSv2Poller, parseWorkerName };
