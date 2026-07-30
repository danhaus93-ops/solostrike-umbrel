// ── BestDiffTab.jsx (v3.7.0) ────────────────────────────────────────────────
//
//   Pulse modal · BEST DIFF tab — ranks the highest-difficulty share every
//   Pulse pool has ever submitted. Sits between Strikers and Top Strikers.
//
//   Data: networkStats.entries — each entry may carry bd: { d, ts } (validated
//   and monotonically merged API-side in best-diff.js / network-stats.js).
//   Windows filter by WHEN the record was struck: ALL-TIME shows every record,
//   7D / 24H show records struck inside the window. No extra wire fields.
//
//   Same visual anatomy as the Top Strikers board: champion hero banner,
//   runner-up rows, pinned "your rank" strip, collapsible ⓘ. Amber headline
//   (a luck stat, matching the Best Difficulty card) — green stays reserved
//   for the efficiency champion.
//
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';

// K/M/G/T/P suffix formatting — matches the Best Difficulty card's display.
function fmtDiff(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  const units = [[1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'K']];
  for (const [v, s] of units) {
    if (n >= v) return (n / v >= 100 ? Math.round(n / v) : +(n / v).toFixed(2)) + ' ' + s;
  }
  return String(Math.round(n));
}

function fmtAgo(tsSec, tt) {
  if (!Number.isFinite(tsSec) || tsSec <= 0) return '—';
  const s = Math.max(0, Math.floor(Date.now() / 1000) - tsSec);
  if (s < 3600) return Math.max(1, Math.floor(s / 60)) + 'm ' + tt('ago');
  if (s < 86400) return Math.floor(s / 3600) + 'h ' + tt('ago');
  if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ' + tt('ago');
  const d = new Date(tsSec * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtThs(hps) {
  const n = Number(hps);
  if (!Number.isFinite(n) || n <= 0) return null;
  return +(n / 1e12).toFixed(1);
}

const WINDOWS = [
  { id: 'all', label: 'ALL-TIME', secs: Infinity },
  { id: 'd7',  label: '7 DAYS',   secs: 7 * 86400 },
  { id: 'd24', label: '24 HOURS', secs: 86400 },
];

export default function BestDiffTab({ tt, networkStats, netDifficulty = null }) {
  const [win, setWin] = useState('all');
  const [showInfo, setShowInfo] = useState(false);

  const entries = Array.isArray(networkStats?.entries) ? networkStats.entries : [];

  // Every peer with a valid record, newest-strike info attached.
  const ranked = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const w = WINDOWS.find(x => x.id === win) || WINDOWS[0];
    return entries
      .filter(e => e && e.bd && Number.isFinite(e.bd.d) && e.bd.d > 0)
      .filter(e => w.secs === Infinity || (Number.isFinite(e.bd.ts) && now - e.bd.ts <= w.secs))
      .map(e => ({
        d: e.bd.d,
        ts: e.bd.ts,
        alias: (typeof e.alias === 'string' && e.alias) ? e.alias : null,
        pub: typeof e.pubkey === 'string' ? e.pubkey : '',
        ths: fmtThs(e.hashrate),
        workers: Number.isFinite(e.workers) ? e.workers : null,
        own: e.own === true || e.isOwn === true || e.self === true,
      }))
      .sort((a, b) => b.d - a.d);
  }, [entries, win]);

  const counts = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const withBd = entries.filter(e => e && e.bd && Number.isFinite(e.bd.d) && e.bd.d > 0);
    return {
      all: withBd.length,
      d7:  withBd.filter(e => now - e.bd.ts <= 7 * 86400).length,
      d24: withBd.filter(e => now - e.bd.ts <= 86400).length,
    };
  }, [entries]);

  const champ = ranked[0] || null;
  const ownIdx = ranked.findIndex(r => r.own);
  const own = ownIdx >= 0 ? ranked[ownIdx] : null;
  const nextAbove = ownIdx > 0 ? ranked[ownIdx - 1] : null;

  const label = (r, i) =>
    (r.alias || (r.pub ? 'striker-' + r.pub.slice(0, 4) : tt('striker') + '-????')) +
    (r.own ? ' (' + tt('you') + ')' : '');

  const pctOfNet = (d) => {
    const nd = Number(netDifficulty);
    if (!Number.isFinite(nd) || nd <= 0) return null;
    return +((d / nd) * 100).toFixed(2);
  };

  const lbl = { fontFamily: 'var(--fd)', fontSize: '0.4rem', letterSpacing: '0.12em', color: 'var(--text-3)', textTransform: 'uppercase', marginBottom: 2 };
  const val = { fontFamily: 'var(--fd)', fontWeight: 700 };
  const rankColor = (i) => i === 0 ? '#FFD700' : i === 1 ? '#C9CDD3' : i === 2 ? '#CD7F32' : 'var(--text-3)';

  return (
    <div>
      {/* window chips — same pattern as the benchmark bucket picker */}
      <div style={{ display: 'flex', gap: 5, marginBottom: 12, flexWrap: 'wrap' }}>
        {WINDOWS.map(w => (
          <button key={w.id} onClick={() => setWin(w.id)} style={{
            fontFamily: 'var(--fd)', fontSize: '0.52rem', padding: '5px 11px', borderRadius: 18,
            border: '1px solid ' + (win === w.id ? 'var(--amber)' : 'var(--border)'),
            background: win === w.id ? 'rgba(var(--amber-rgb),0.08)' : 'var(--bg-deep)',
            color: win === w.id ? 'var(--amber)' : 'var(--text-3)', cursor: 'pointer',
          }}>
            {tt(w.label)} <span style={{ opacity: 0.7 }}>· {counts[w.id]}</span>
          </button>
        ))}
      </div>

      {!champ && (
        <div style={{ fontFamily: 'var(--fm)', fontSize: '0.58rem', color: 'var(--text-2)', padding: '18px 4px', lineHeight: 1.6 }}>
          {tt('No best-diff records in this window yet. Records appear as Pulse pools broadcast their highest-difficulty accepted share.')}
        </div>
      )}

      {champ && (
        <div style={{ background: 'linear-gradient(135deg,rgba(var(--amber-rgb),0.12),rgba(255,122,0,0.03))', border: '1px solid rgba(var(--amber-rgb),0.38)', borderRadius: 11, padding: '12px 13px', marginBottom: 12 }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '0.46rem', letterSpacing: '0.15em', color: 'var(--amber)', textTransform: 'uppercase', marginBottom: 6 }}>
            {'⚡ ' + tt('Best diff') + ' · ' + tt((WINDOWS.find(w => w.id === win) || WINDOWS[0]).label.toLowerCase())}
          </div>
          <div style={{ fontFamily: 'var(--fd)', fontWeight: 700, fontSize: '0.92rem', color: champ.own ? 'var(--cyan)' : 'var(--text-1)', marginBottom: 2 }}>
            {label(champ, 0)}
          </div>
          <div style={{ fontFamily: 'var(--fm)', fontSize: '0.5rem', color: 'var(--text-2)', marginBottom: 8 }}>
            {(champ.ths != null ? champ.ths + ' TH/s ' + tt('pool') : tt('pool'))}
            {champ.workers != null ? ' · ' + champ.workers + ' ' + tt('workers') : ''}
            {' · ' + tt('struck') + ' ' + fmtAgo(champ.ts, tt)}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
            <span style={{ fontFamily: 'var(--fd)', fontWeight: 700, fontSize: '1.7rem', color: 'var(--amber)', lineHeight: 1, textShadow: '0 0 14px rgba(var(--amber-rgb),0.45)' }}>{fmtDiff(champ.d)}</span>
            <span style={{ fontFamily: 'var(--fd)', fontSize: '0.58rem', color: 'var(--text-3)' }}>{tt('DIFF')}</span>
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--fm)', fontSize: '0.5rem', color: 'var(--text-3)' }}>{ranked.length + ' ' + tt('pools ranked')}</span>
          </div>
          {pctOfNet(champ.d) != null && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginTop: 8 }}>
              <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '5px 4px', textAlign: 'center' }}>
                <div style={lbl}>{tt('% of network diff')}</div>
                <div style={{ ...val, color: 'var(--cyan)', fontSize: '0.7rem' }}>{pctOfNet(champ.d)}%</div>
              </div>
              <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '5px 4px', textAlign: 'center' }}>
                <div style={lbl}>{tt('Struck')}</div>
                <div style={{ ...val, color: 'var(--cyan)', fontSize: '0.7rem' }}>{fmtAgo(champ.ts, tt)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {ranked.length > 1 && (
        <>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.14em', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6 }}>{tt('Best diff leaderboard')}</div>
          {ranked.slice(1).map((r, i) => (
            <div key={r.pub || i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontFamily: 'var(--fd)', fontWeight: 700, fontSize: '0.64rem', color: r.own ? 'var(--cyan)' : rankColor(i + 1), width: 24, textAlign: 'center' }}>{i + 2}</span>
              <span style={{ flex: 1, fontFamily: 'var(--fm)', fontSize: '0.56rem', color: r.own ? 'var(--cyan)' : 'var(--text-2)', minWidth: 0 }}>
                {label(r, i + 1)}
                <span style={{ display: 'block', fontSize: '0.44rem', color: r.own ? 'rgba(0,255,209,0.55)' : 'var(--text-3)', marginTop: 1 }}>
                  {r.ths != null ? r.ths + ' TH/s' : '—'}
                  {r.workers != null ? ' · ' + r.workers + ' ' + tt('workers') : ''}
                  {pctOfNet(r.d) != null ? ' · ' + pctOfNet(r.d) + '% ' + tt('of net') : ''}
                </span>
              </span>
              <span style={{ fontFamily: 'var(--fm)', fontSize: '0.48rem', color: 'var(--text-3)', minWidth: 42, textAlign: 'right' }}>{fmtAgo(r.ts, tt)}</span>
              <span style={{ fontFamily: 'var(--fd)', fontWeight: 700, fontSize: '0.68rem', color: r.own ? 'var(--cyan)' : 'var(--amber)', minWidth: 64, textAlign: 'right' }}>{fmtDiff(r.d)}</span>
            </div>
          ))}
        </>
      )}

      {own && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'rgba(0,255,209,0.05)', border: '1px solid rgba(0,255,209,0.25)' }}>
          <span style={{ fontFamily: 'var(--fd)', fontSize: '0.46rem', letterSpacing: '0.14em', color: 'var(--cyan)', textTransform: 'uppercase' }}>
            {tt('Your best')} · {tt('rank')} {ownIdx + 1} / {ranked.length}
          </span>
          {nextAbove && <span style={{ fontFamily: 'var(--fm)', fontSize: '0.46rem', color: 'var(--text-3)' }}>{tt('next')}: {fmtDiff(nextAbove.d)}</span>}
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--fd)', fontWeight: 700, fontSize: '0.72rem', color: 'var(--cyan)' }}>{fmtDiff(own.d)}</span>
        </div>
      )}

      {/* collapsible: what counts + what gets shared — same pattern as benchmarks ⓘ */}
      <div style={{ marginTop: 12, background: 'rgba(var(--amber-rgb),0.05)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div onClick={() => setShowInfo(v => !v)} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', fontFamily: 'var(--fm)', fontSize: '0.55rem', color: 'var(--text-2)' }}>
          <span style={{ color: 'var(--amber)' }}>ⓘ</span>{tt('What counts and what gets shared')}
          <span style={{ marginLeft: 'auto', color: 'var(--text-3)', transform: showInfo ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}>›</span>
        </div>
        {showInfo && (
          <div style={{ padding: '0 11px 10px', fontFamily: 'var(--fm)', fontSize: '0.55rem', lineHeight: 1.6, color: 'var(--text-2)' }}>
            <p style={{ marginBottom: 8 }}>{tt('Ranks the highest-difficulty accepted share each Pulse pool reports — the same number as your Best Difficulty card, read from the pool\u2019s own sharelog before broadcast. Values are self-reported by each pool and sanity-checked, not independently verified. Equal the network difficulty and it isn\u2019t a leaderboard entry — it\u2019s a block.')}</p>
            <p style={{ color: 'var(--text-1)' }}>{tt('Shares only the best diff value, when it was struck, and your pool\u2019s already-broadcast Pulse stats. Never your wallet address, IP, hostname, or worker names. Rides the existing Pulse broadcast — off with Pulse, gone with Private Mode.')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
