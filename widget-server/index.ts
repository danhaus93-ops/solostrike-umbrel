// SoloStrike widget server for umbrelOS
// Serves /widgets/pool in the four-stats format expected by umbrelOS 1.0+
// Calls SoloStrike's existing /api/public/summary endpoint internally.

const PORT = 3000;
const API_URL = process.env.SOLOSTRIKE_API_URL || 'http://api:3001';

// Placeholder response used when the upstream API is unreachable.
// umbrelOS still renders the widget with these values so the user sees
// the tile titles instead of a blank card.
const placeholderResponse = {
  type: 'four-stats',
  refresh: '10s',
  items: [
    { title: 'Pool Hashrate', text: '—', subtext: 'H/s' },
    { title: 'Workers',       text: '—' },
    { title: 'Blocks Found',  text: '—' },
    { title: 'Best Diff',     text: '—' },
  ],
};

// Format hashrate H/s -> KH/s -> MH/s -> ... -> EH/s
function formatHashrate(hps: number): { text: string; subtext: string } {
  if (!hps || hps < 0 || !Number.isFinite(hps)) return { text: '0', subtext: 'H/s' };
  const units = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
  let rate = hps;
  let i = 0;
  while (rate >= 1000 && i < units.length - 1) {
    rate /= 1000;
    i++;
  }
  return { text: rate.toFixed(2), subtext: units[i] };
}

// Format a big difficulty number compactly: 1_234_567 -> 1.2M, 1_234_567_890 -> 1.2B
function formatCompact(n: number): string {
  if (!n || n < 0 || !Number.isFinite(n)) return '0';
  if (n < 1000) return Math.round(n).toString();
  if (n < 1_000_000) return (n / 1000).toFixed(1) + 'K';
  if (n < 1_000_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n < 1_000_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  return (n / 1_000_000_000_000).toFixed(1) + 'T';
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== '/widgets/pool') {
      return new Response('Not Found', { status: 404 });
    }

    try {
      const resp = await fetch(`${API_URL}/api/public/summary`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!resp.ok) throw new Error(`Upstream status ${resp.status}`);
      const s: any = await resp.json();

      const hr = formatHashrate(s.poolHashrate || 0);

      return Response.json({
        type: 'four-stats',
        refresh: '10s',
        items: [
          { title: 'Pool Hashrate', text: hr.text,                           subtext: hr.subtext },
          { title: 'Workers',       text: (s.workers || 0).toString() },
          { title: 'Blocks Found',  text: (s.blocksFound || 0).toString() },
          { title: 'Best Diff',     text: formatCompact(s.bestshare || 0) },
        ],
      });
    } catch (err) {
      console.error('[widget] upstream fetch failed:', err);
      return Response.json(placeholderResponse);
    }
  },
});

console.log(`SoloStrike widget server listening on :${PORT}, upstream: ${API_URL}`);
