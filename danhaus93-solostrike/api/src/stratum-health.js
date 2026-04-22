// Stratum health poller — checks listening state + basic stratum handshake
// on all configured stratum ports every 30 seconds.
//
// Each port can be in one of three states:
//   - ‘healthy’  : TCP connect succeeds + server accepts mining.subscribe
//   - ‘degraded’ : TCP connect succeeds but handshake times out or fails
//   - ‘down’     : TCP connect fails entirely (port closed / container crashed)
//
// For port 4333 (TLS), we do a TLS handshake instead of plain TCP.
//
// Results are cached in-memory and served via GET /api/stratum-health.

const net = require(‘net’);
const tls = require(‘tls’);

const CHECK_INTERVAL_MS = 30000; // 30 seconds
const CONNECT_TIMEOUT_MS = 4000; // 4 seconds per port

// In-memory cache, updated by the background poller.
let cache = {
lastCheckAt: null,
ports: {},  // { ‘3333’: { status, latencyMs, error }, … }
};

function now() { return Date.now(); }

// Check a plain TCP stratum port. Connects, sends mining.subscribe, waits for response.
function checkPlainPort(port, host = ‘127.0.0.1’) {
return new Promise((resolve) => {
const started = now();
const socket = new net.Socket();
let settled = false;
const finish = (status, error = null) => {
if (settled) return;
settled = true;
try { socket.destroy(); } catch (_) {}
resolve({ status, latencyMs: now() - started, error });
};
socket.setTimeout(CONNECT_TIMEOUT_MS);
socket.once(‘error’, (err) => finish(‘down’, err.code || err.message));
socket.once(‘timeout’, () => finish(‘down’, ‘timeout’));
socket.connect(port, host, () => {
// Send a basic stratum subscribe — should get JSON-RPC response
const msg = JSON.stringify({ id: 1, method: ‘mining.subscribe’, params: [‘SoloStrikeHealthCheck/1.0’] }) + ‘\n’;
socket.write(msg);
let buf = ‘’;
socket.on(‘data’, (chunk) => {
buf += chunk.toString();
if (buf.includes(’\n’)) {
// Got at least one line back — check if it looks like JSON-RPC
if (buf.includes(’“result”’) || buf.includes(’“error”’) || buf.includes(’“id”’)) {
finish(‘healthy’);
} else {
finish(‘degraded’, ‘unexpected_response’);
}
}
});
});
});
}

// Check a TLS stratum port. Performs TLS handshake, then stratum subscribe.
function checkTlsPort(port, host = ‘127.0.0.1’) {
return new Promise((resolve) => {
const started = now();
let settled = false;
const finish = (status, error = null) => {
if (settled) return;
settled = true;
try { socket.destroy(); } catch (_) {}
resolve({ status, latencyMs: now() - started, error });
};
const socket = tls.connect({
port,
host,
rejectUnauthorized: false, // self-signed cert is expected
timeout: CONNECT_TIMEOUT_MS,
}, () => {
// TLS handshake succeeded — now try stratum
const msg = JSON.stringify({ id: 1, method: ‘mining.subscribe’, params: [‘SoloStrikeHealthCheck/1.0’] }) + ‘\n’;
socket.write(msg);
let buf = ‘’;
socket.on(‘data’, (chunk) => {
buf += chunk.toString();
if (buf.includes(’\n’)) {
if (buf.includes(’“result”’) || buf.includes(’“error”’) || buf.includes(’“id”’)) {
finish(‘healthy’);
} else {
finish(‘degraded’, ‘unexpected_response’);
}
}
});
});
socket.once(‘error’, (err) => finish(‘down’, err.code || err.message));
socket.once(‘timeout’, () => finish(‘down’, ‘tls_timeout’));
});
}

async function runHealthCheck() {
// ckpool listens on ckpool:3333 and ckpool:3334
// stunnel listens on stunnel:4333
const checks = [
{ port: ‘3333’, host: ‘ckpool’,  tls: false },
{ port: ‘3334’, host: ‘ckpool’,  tls: false },
{ port: ‘4333’, host: ‘stunnel’, tls: true  },
];
const results = await Promise.all(
checks.map(async (c) => {
const result = c.tls
? await checkTlsPort(Number(c.port), c.host)
: await checkPlainPort(Number(c.port), c.host);
return [c.port, result];
})
);
const ports = {};
for (const [port, result] of results) ports[port] = result;
cache = { lastCheckAt: now(), ports };
}

function startStratumHealthPoller() {
// Run immediately, then every CHECK_INTERVAL_MS
runHealthCheck().catch((err) => console.error(’[stratum-health] initial check failed:’, err));
setInterval(() => {
runHealthCheck().catch((err) => console.error(’[stratum-health] check failed:’, err));
}, CHECK_INTERVAL_MS);
}

function getStratumHealth() {
return {
lastCheckAt: cache.lastCheckAt,
ports: cache.ports,
};
}

module.exports = { startStratumHealthPoller, getStratumHealth };
