// sv2-telemetry.js - bridges the SRI translator's monitoring API (9092)
// into worker-meta so SV2 miners get their REAL device IP + identity,
// restoring the full Crew card the proxy would otherwise anonymize.
const http = require('http');

const TPROXY_HOST = process.env.TPROXY_MONITOR_HOST || 'tproxy';
const TPROXY_PORT = process.env.TPROXY_MONITOR_PORT || '9092';
const SV2_WORKER_PREFIX = process.env.SV2_WORKER_PREFIX || 'axeSV2';

function fetchJson(path) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: TPROXY_HOST, port: TPROXY_PORT, path, timeout: 4000 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch (_) { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// ckpoolWorkerName -> { ip, make, model, firmware, reportedHashrate,
// sv1WorkerName, viaProxy }. Empty map when proxy/endpoint absent.
async function pollSv2Telemetry(payoutAddress) {
  if (!payoutAddress) return {};
  const data = await fetchJson('/api/v1/sv1/clients');
  if (!data || !Array.isArray(data.items)) return {};
  const out = {};
  for (const c of data.items) {
    const ip = c.management_ip || c.connection_ip;
    if (!ip) continue;
    const worker = payoutAddress + '.' + SV2_WORKER_PREFIX +
      '.miner' + c.channel_id;
    const t = c.miner_telemetry || {};
    out[worker] = {
      ip,
      sv1WorkerName: c.sv1_worker_name || null,
      make: t.make || null,
      model: t.model || null,
      firmware: t.firmware_version || null,
      reportedHashrate: t.reported_hashrate_hs || null,
      viaProxy: true,
    };
  }
  return out;
}

module.exports = { pollSv2Telemetry };
