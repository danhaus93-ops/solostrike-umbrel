// ============================================================================
// SoloStrike Analytics Cards (v1.12.0)
// ============================================================================
// New panels for the Pool Internals + Luck & Analytics pages (desktop 3-page
// layout) and the corresponding mobile carousel cards. Every panel is a plain
// card component that reads from poolState slices the API now provides:
//   - state.pool.{hashrateWindows,hashrateWindowPct,spsWindows,idle,
//                 disconnected,users,workers,runtimeSec}
//   - state.shares.bestHistory  (+ bestHistoryTail merged client-side)
//   - state.snapshots.{blockEffort,bestTrend}
//   - per-worker live.{powerW,efficiencyJTH}
//
// Shared visual language matches App.jsx's cardTitle/statRow/label constants.
// Trend charts resolve per-theme --chart1/--chart2 to concrete colors (SVG
// stroke can't read CSS vars reliably) and render the lo/now/hi numbers in a
// caption row BELOW the chart so a trend line can never collide with them.
// ============================================================================

import React, { useRef, useEffect, useState, useMemo } from 'react';

// ── shared style tokens (mirror App.jsx) ───────────────────────────────────
const cardTitle = {
  fontFamily: 'var(--fd)',
  fontSize: '0.7rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: 'var(--amber)',
  marginBottom: '0.7rem',
  paddingBottom: '0.45rem',
  backgroundImage:
    'linear-gradient(90deg, rgba(var(--amber-rgb),0.55) 0%, rgba(var(--amber-rgb),0.45) 30%, rgba(var(--amber-rgb),0.12) 70%, rgba(var(--amber-rgb),0) 100%)',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 1px',
  backgroundPosition: 'bottom left',
};
const statRow = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.45rem 0.7rem', background:'transparent', border:'1px solid transparent', borderBottom:'1px solid rgba(var(--amber-rgb),0.07)', marginBottom:'0.3rem', borderRadius:'4px' };
const label = { fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };
const valMono = { fontFamily:'var(--fm)', fontSize:'0.8rem', color:'var(--text-1)', fontWeight:600 };
// v1.12.0-fix: card chrome matching App.jsx's `card` const. The analytics
// components previously returned bare <div>s with no panel background, so on
// the mobile carousel (where the .ss-card wrapper provides no fill) the
// dashboard background bled through. Wrapping each card's content in cardShell
// gives them the same amber-edged panel as every other card, on both mobile
// and desktop.
const cardShell = {
  background:
    'linear-gradient(90deg, transparent 10%, rgba(var(--amber-rgb),calc(0.45 * var(--card-chrome,1))) 50%, transparent 90%) top center / 100% 1.5px no-repeat, ' +
    'radial-gradient(ellipse 70% 90px at 50% 0%, rgba(var(--amber-rgb),calc(0.13 * var(--card-chrome,1))) 0%, transparent 70%), ' +
    // v2.0.x: frost-aware base fill — driven by the Display → Card Frost slider
    // (--card-fill) and Solid Cards toggle, exactly like the main mobile/desktop
    // card style. Was a hardcoded opaque gradient, which is why these analytics
    // cards stayed solid while every other card frosted. Falls back to 60%.
    'linear-gradient(180deg, color-mix(in srgb, var(--bg-raised) var(--card-fill, 60%), transparent) 0%, color-mix(in srgb, var(--bg-surface) var(--card-fill, 60%), transparent) 100%)',
  backdropFilter: 'blur(var(--card-blur, 7px))',
  WebkitBackdropFilter: 'blur(var(--card-blur, 7px))',
  border:'1px solid rgba(var(--amber-rgb),calc(0.22 * var(--card-chrome,1)))',
  borderRadius:'16px',
  padding:'1.3rem',
  boxShadow:
    'inset 0 1px 0 rgba(var(--amber-rgb),calc(0.18 * var(--card-chrome,1))), inset 0 0 0 1px rgba(0,0,0,calc(0.4 * var(--card-chrome,1))), ' +
    '0 8px 24px rgba(0,0,0,calc(0.6 * var(--card-chrome,1))), 0 0 32px rgba(var(--amber-rgb),calc(0.06 * var(--card-chrome,1)))',
  minWidth:0, maxWidth:'100%', overflow:'hidden',
  display:'flex', flexDirection:'column', height:'100%', boxSizing:'border-box',
};
// Wrap helper — applies the shell unless `bare` (used by DesktopPages which
// supplies its own wrapper).
function Shell({ children }) {
  return <div style={cardShell} className="fade-in ss-card-chrome">{children}</div>;
}

// ── helpers ─────────────────────────────────────────────────────────────────
function resolveVar(varExpr) {
  // Resolve a CSS var() expression to a concrete color by reading computed
  // style off a throwaway element. SVG stroke/fill can't reliably read var().
  if (typeof document === 'undefined') return '#888';
  const probe = document.createElement('span');
  probe.style.color = varExpr;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const c = getComputedStyle(probe).color || '#888';
  probe.remove();
  return c;
}
function fmtHashrate(hs) {
  if (!hs || hs <= 0) return '0';
  const units = [['E',1e18],['P',1e15],['T',1e12],['G',1e9],['M',1e6],['K',1e3]];
  for (const [u, d] of units) { if (hs >= d) return (hs/d).toFixed(2) + ' ' + u + 'H/s'; }
  return hs.toFixed(0) + ' H/s';
}
function fmtDiff(d) {
  if (!d || d <= 0) return '0';
  const units = [['E',1e18],['P',1e15],['T',1e12],['G',1e9],['M',1e6],['K',1e3]];
  for (const [u, dv] of units) { if (d >= dv) return (d/dv).toFixed(2) + ' ' + u; }
  return d.toFixed(0);
}
function fmtDuration(sec) {
  if (!sec || sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// ── TrendChart — line in SVG, numbers in a caption row BELOW (no collision) ──
// themeKey is passed so the chart re-resolves colors when the theme changes.
export function TrendChart({ tt = (x) => x, points, colorVar = 'var(--chart1)', fill = true, fmt = (v)=>String(v), unit = '', height = 64, themeKey }) {
  const wrapRef = useRef(null);
  const [stroke, setStroke] = useState('#888');
  useEffect(() => { setStroke(resolveVar(colorVar)); }, [colorVar, themeKey]);

  const series = Array.isArray(points) ? points.filter(v => Number.isFinite(v)) : [];
  const W = 400, H = 80;
  let path = '', area = '', lo = 0, hi = 0, cur = 0, hasData = series.length >= 2;
  if (hasData) {
    lo = Math.min(...series); hi = Math.max(...series); cur = series[series.length-1];
    const rng = (hi - lo) || 1;
    const xy = series.map((v,i)=>[
      +(i*(W/(series.length-1))).toFixed(1),
      +(H-8-((v-lo)/rng)*(H-16)).toFixed(1),
    ]);
    path = 'M' + xy.map(p=>p.join(' ')).join(' L');
    area = path + ` L${W} ${H} L0 ${H} Z`;
  }

  const gid = useMemo(() => 'g_' + Math.random().toString(36).slice(2,8), []);

  return (
    <div ref={wrapRef} style={{ width:'100%' }}>
      <div style={{ width:'100%', height, position:'relative' }}>
        {hasData ? (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
               style={{ display:'block', width:'100%', height:'100%' }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={stroke} stopOpacity="0.35"/>
                <stop offset="100%" stopColor={stroke} stopOpacity="0"/>
              </linearGradient>
            </defs>
            {fill && <path d={area} fill={`url(#${gid})`} />}
            <path d={path} fill="none" stroke={stroke} strokeWidth="2"
                  strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        ) : (
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%',
                        fontFamily:'var(--fd)', fontSize:'0.6rem', color:'var(--text-3)',
                        letterSpacing:'0.1em', textTransform:'uppercase' }}>
            {tt('Collecting data…')}
          </div>
        )}
      </div>
      {hasData && (
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline',
                      fontFamily:'var(--fd)', fontSize:'0.55rem', padding:'3px 2px 0' }}>
          <span style={{ color:'var(--text-3)', opacity:0.8 }}>lo {fmt(lo)}</span>
          <span style={{ color:stroke, fontWeight:700, fontSize:'0.66rem' }}>now {fmt(cur)}{unit ? ' '+unit : ''}</span>
          <span style={{ color:'var(--text-3)', opacity:0.8 }}>hi {fmt(hi)}</span>
        </div>
      )}
    </div>
  );
}

// ── Pool Hashrate Windows — % of pool peak (Page 2) ─────────────────────────
export function PoolHashrateWindows({ tt = (x) => x, pool, themeKey }) {
  const w = pool?.hashrateWindows || {};
  const pct = pool?.hashrateWindowPct || {};
  const rows = [
    ['1M', w.hr1m, pct.hr1m], ['5M', w.hr5m, pct.hr5m], ['15M', w.hr15m, pct.hr15m],
    ['1H', w.hr1h, pct.hr1h], ['6H', w.hr6h, pct.hr6h], ['1D', w.hr1d, pct.hr1d],
    ['7D', w.hr7d, pct.hr7d],
  ];
  return (
      <Shell>
    <div>
      <div style={cardTitle}>{tt('▸ Hashrate Windows — % of Pool Peak')}</div>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.3rem' }}>
        {rows.map(([lab, hr, p]) => (
          <div key={lab} style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
            <span style={{ ...label, width:34 }}>{lab}</span>
            <div style={{ flex:1, height:8, background:'var(--bg-deep)', borderRadius:4, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${Math.max(0, Math.min(100, p||0))}%`,
                            background:'var(--chart1)', borderRadius:4, transition:'width 0.5s ease' }}/>
            </div>
            <span style={{ ...valMono, width:96, textAlign:'right', fontSize:'0.66rem' }}>{fmtHashrate(hr)}</span>
            <span style={{ fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-2)', width:38, textAlign:'right' }}>{(p||0).toFixed(0)}%</span>
          </div>
        ))}
      </div>
    </div>
      </Shell>
    );
}

// ── SPS Windows (Page 2) ────────────────────────────────────────────────────
export function SpsWindows({ tt = (x) => x, pool }) {
  const s = pool?.spsWindows || {};
  const rows = [['1M', s.sps1m], ['5M', s.sps5m], ['15M', s.sps15m], ['1H', s.sps1h]];
  const max = Math.max(...rows.map(r => r[1]||0), 1);
  const fmtK = (v)=> v >= 1000 ? (v/1000).toFixed(2)+'k sh/s' : (v||0).toFixed(1)+' sh/s';
  return (
      <Shell>
    <div>
      <div style={cardTitle}>{tt('▸ Shares / Second — Windows')}</div>
      <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem' }}>
        {rows.map(([lab, v]) => (
          <div key={lab} style={{ display:'flex', alignItems:'center', gap:'0.6rem' }}>
            <span style={{ ...label, width:34 }}>{lab}</span>
            <div style={{ flex:1, height:9, background:'var(--bg-deep)', borderRadius:4, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${((v||0)/max)*100}%`, background:'var(--chart1)', borderRadius:4 }}/>
            </div>
            <span style={{ ...valMono, width:104, textAlign:'right', fontSize:'0.7rem' }}>{fmtK(v)}</span>
          </div>
        ))}
      </div>
    </div>
      </Shell>
    );
}

// ── Connection States donut (Page 2) ────────────────────────────────────────
export function ConnectionStates({ tt = (x) => x, pool, workers = [] }) {
  // v2.0.x: "Active" is now the TRUE count of currently-mining rigs, taken from
  // the per-worker list (same source the Crew card trusts: live unless status
  // is 'offline'). The old value subtracted ckpool's Idle+Disconnected from its
  // Workers total, which rental connection churn inflated until the result
  // floored to 0 — falsely showing no live rigs while mining. Idle and
  // Disconnected remain ckpool's real summary counters (connection churn).
  const wl = Array.isArray(workers) ? workers : Object.values(workers || {});
  const active = wl.filter(w => w && w.status !== 'offline').length;
  const idle = pool?.idle || 0;
  const disc = pool?.disconnected || 0;
  const total = active + idle + disc || 1;
  const segs = [
    [tt('Active'), active, 'var(--green)'],
    [tt('Idle'), idle, 'var(--amber)'],
    [tt('Disconnected'), disc, 'var(--red)'],
  ];
  // build conic-gradient stops
  let acc = 0;
  const stops = segs.map(([,n,c]) => {
    const start = (acc/total)*100; acc += n; const end = (acc/total)*100;
    return `${c} ${start}% ${end}%`;
  }).join(', ');
  return (
      <Shell>
    <div>
      <div style={cardTitle}>{tt('▸ Connection States')}</div>
      <div style={{ display:'flex', alignItems:'center', gap:'1.2rem' }}>
        <div style={{ position:'relative', width:96, height:96, flexShrink:0 }}>
          <div style={{ width:'100%', height:'100%', borderRadius:'50%',
                        background:`conic-gradient(${stops})` }}/>
          <div style={{ position:'absolute', inset:'22%', borderRadius:'50%', background:'var(--bg-surface)',
                        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
            <span style={{ fontFamily:'var(--fd)', fontSize:'1.3rem', fontWeight:700, color:'var(--text-1)', lineHeight:1 }}>{total}</span>
            <span style={{ fontFamily:'var(--fd)', fontSize:'0.45rem', letterSpacing:'0.1em', color:'var(--text-3)', textTransform:'uppercase' }}>{tt('workers')}</span>
          </div>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:'0.4rem', flex:1 }}>
          {segs.map(([name, n, c]) => (
            <div key={name} style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
              <span style={{ width:10, height:10, borderRadius:2, background:c, flexShrink:0 }}/>
              <span style={{ ...label, flex:1 }}>{name}</span>
              <span style={valMono}>{n}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
      </Shell>
    );
}

// ── Block Effort / Luck (Page 3) ────────────────────────────────────────────
export function BlockEffortPanel({ tt = (x) => x, snapshots, sharesThisRound, networkDifficulty }) {
  const effort = Array.isArray(snapshots?.blockEffort) ? snapshots.blockEffort.slice(0, 8) : [];
  // current open round (no block yet) effort estimate
  let openPct = null;
  if (networkDifficulty > 0 && sharesThisRound > 0) {
    openPct = +((sharesThisRound / networkDifficulty) * 100).toFixed(0);
  }
  const colorFor = (p) => p == null ? 'var(--bg-raised)' : p < 100 ? 'var(--green)' : p <= 200 ? 'var(--amber)' : 'var(--red)';
  // bars: historical (reverse so newest right) + current open round
  const bars = [];
  for (let i = Math.min(7, effort.length) - 1; i >= 0; i--) {
    const e = effort[i];
    bars.push({ lab: `#${String(e.height||'').slice(-4)}`, pct: e.effortPct });
  }
  while (bars.length < 7) bars.unshift({ lab: '—', pct: null });
  bars.push({ lab: tt('NOW'), pct: openPct });

  return (
      <Shell>
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={cardTitle}>{tt('▸ Block Effort / Luck')} <span style={{ color:'var(--text-3)', fontSize:'0.85em', letterSpacing:0, textTransform:'none' }}>{tt('(shares-to-find vs expected · <100% = lucky)')}</span></div>
      <div style={{ flex:1, display:'flex', alignItems:'flex-end', gap:6, minHeight:90, paddingTop:8 }}>
        {bars.map((b, i) => {
          const h = b.pct == null ? 14 : Math.min(100, (b.pct/250)*100);
          const c = colorFor(b.pct);
          return (
            <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4, justifyContent:'flex-end', height:'100%' }}>
              <div style={{ fontFamily:'var(--fd)', fontSize:'0.52rem', fontWeight:700, color:c }}>{b.pct == null ? '' : b.pct+'%'}</div>
              <div style={{ width:'100%', height:`${h}%`, minHeight:4, background:c, borderRadius:'2px 2px 0 0' }}/>
              <div style={{ fontFamily:'var(--fd)', fontSize:'0.46rem', color:'var(--text-3)' }}>{b.lab}</div>
            </div>
          );
        })}
      </div>
      {effort.length === 0 && (
        <div style={{ fontSize:'0.56rem', color:'var(--text-3)', lineHeight:1.5, marginTop:6 }}>
          {tt("No blocks found yet — history fills in as you strike. The NOW bar shows the current open round's effort.")}
        </div>
      )}
    </div>
      </Shell>
    );
}

// ── Hashrate Stability (Page 3) ─────────────────────────────────────────────
export function HashrateStability({ tt = (x) => x, hashrate, themeKey }) {
  const hist = Array.isArray(hashrate?.history) ? hashrate.history : [];
  const pts = hist.map(p => p.hr).filter(Number.isFinite);
  const stats = useMemo(() => {
    if (pts.length < 2) return null;
    const mean = pts.reduce((a,b)=>a+b,0)/pts.length;
    const variance = pts.reduce((a,b)=>a+(b-mean)**2,0)/pts.length;
    const std = Math.sqrt(variance);
    const consistency = mean > 0 ? Math.max(0, Math.min(100, (1 - std/mean) * 100)) : 0;
    const min = Math.min(...pts), max = Math.max(...pts);
    const dips = pts.filter(v => v < mean * 0.5).length;
    return { mean, std, consistency, min, max, dips };
  }, [pts]);
  return (
      <Shell>
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={cardTitle}>{tt('▸ Hashrate Stability')}</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:8 }}>
        <span style={{ fontFamily:'var(--fd)', fontSize:'1.8rem', fontWeight:700, color:'var(--amber)' }}>
          {stats ? stats.consistency.toFixed(1) : '—'}<span style={{ fontSize:'0.4em', color:'var(--text-3)' }}> %</span>
        </span>
        <span style={{ fontSize:'0.62rem', color:'var(--text-2)' }}>{tt('consistency (24h)')}</span>
      </div>
      <TrendChart tt={tt} points={pts.map(v=>v/1e12)} colorVar="var(--chart1)" fmt={(v)=>v.toFixed(1)} unit="T" height={54} themeKey={themeKey} />
      {stats && (
        <div style={{ display:'flex', marginTop:10 }}>
          <Stat k={tt("Std Dev")} v={`±${(stats.std/1e12).toFixed(1)} T`} color="var(--amber)" border />
          <Stat k={tt("Min / Max")} v={`${(stats.min/1e12).toFixed(0)} / ${(stats.max/1e12).toFixed(0)} T`} color="var(--text-1)" border />
          <Stat k={tt("Dips 24h")} v={String(stats.dips)} color="var(--red)" />
        </div>
      )}
    </div>
      </Shell>
    );
}
function Stat({ k, v, color, border }) {
  return (
    <div style={{ flex:1, textAlign:'center', borderRight: border ? '1px solid var(--border)' : 'none' }}>
      <div style={{ fontFamily:'var(--fd)', fontSize:'0.5rem', color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'0.1em' }}>{k}</div>
      <div style={{ fontFamily:'var(--fd)', fontSize:'0.8rem', fontWeight:700, color }}>{v}</div>
    </div>
  );
}

// ── Reject Reasons trend (Page 3) ───────────────────────────────────────────
export function RejectTrend({ tt = (x) => x, shares }) {
  const reasons = shares?.rejectReasons || {};
  const entries = Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const total = entries.reduce((a,[,n])=>a+n,0) || 1;
  const colors = ['var(--amber)','var(--cyan)','var(--text-2)','var(--red)'];
  return (
      <Shell>
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={cardTitle}>{tt('▸ Reject Reasons')}</div>
      {entries.length === 0 ? (
        <div style={{ fontSize:'0.6rem', color:'var(--text-3)', marginTop:8 }}>{tt('No rejected shares recorded.')}</div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:9, justifyContent:'center', flex:1 }}>
          {entries.map(([name, n], i) => {
            const p = Math.round((n/total)*100);
            return (
              <div key={name} style={{ display:'flex', alignItems:'center', gap:8, fontSize:'0.6rem' }}>
                <span style={{ fontFamily:'var(--fd)', width:84, color:'var(--text-2)', textTransform:'uppercase', letterSpacing:'0.06em', fontSize:'0.52rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{name}</span>
                <span style={{ flex:1, height:7, background:'var(--bg-deep)', borderRadius:4, overflow:'hidden' }}>
                  <i style={{ display:'block', height:'100%', width:`${p}%`, background:colors[i%colors.length], borderRadius:4 }}/>
                </span>
                <span style={{ fontFamily:'var(--fm)', width:36, textAlign:'right', color:'var(--text-1)', fontWeight:700 }}>{p}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
      </Shell>
    );
}

// ── Best Share Trend (Page 2) ───────────────────────────────────────────────
export function BestShareTrend({ tt = (x) => x, snapshots, bestHistory, themeKey }) {
  // prefer persisted bestTrend, fall back to live in-memory bestHistory
  const series = Array.isArray(snapshots?.bestTrend) && snapshots.bestTrend.length >= 2
    ? snapshots.bestTrend
    : (Array.isArray(bestHistory) ? bestHistory : []);
  const pts = series.map(p => (p.best || 0) / 1e15); // → P (peta) units
  return (
      <Shell>
    <div>
      <div style={cardTitle}>{tt('▸ Best Share — Trend')}</div>
      <TrendChart tt={tt} points={pts} colorVar="var(--chart1)" fmt={(v)=>v.toFixed(2)} unit="P" height={62} themeKey={themeKey} />
    </div>
      </Shell>
    );
}

// ── Fleet Efficiency (Page 3) ───────────────────────────────────────────────
export function FleetEfficiency({ tt = (x) => x, workers }) {
  const rigs = (Array.isArray(workers) ? workers : [])
    .map(w => ({
      name: w.name,
      powerW: w.live?.powerW || null,
      jth: w.live?.efficiencyJTH || null,
      hr: w.hashrate || 0,
    }))
    .filter(r => r.jth != null);
  const totalPower = rigs.reduce((a,r)=>a+(r.powerW||0),0);
  const avgJth = rigs.length ? (rigs.reduce((a,r)=>a+r.jth,0)/rigs.length) : null;
  const best = rigs.length ? Math.min(...rigs.map(r=>r.jth)) : null;
  const worst = rigs.length ? Math.max(...rigs.map(r=>r.jth)) : null;
  return (
      <Shell>
    <div>
      <div style={cardTitle}>{tt('▸ Fleet Efficiency')}</div>
      {rigs.length === 0 ? (
        <div style={{ fontSize:'0.6rem', color:'var(--text-3)', marginTop:8, lineHeight:1.5 }}>
          {tt("No power data yet. Efficiency (J/TH) needs each rig's local API to report watts (ESP-Miner, LuxOS, Avalon, etc.).")}
        </div>
      ) : (
        <>
          <div style={statRow}><span style={label}>{tt('Total power')}</span><span style={valMono}>{totalPower.toFixed(0)} W</span></div>
          <div style={statRow}><span style={label}>{tt('Avg J/TH')}</span><span style={{...valMono, color:'var(--amber)'}}>{avgJth.toFixed(1)}</span></div>
          <div style={statRow}><span style={label}>{tt('Most efficient')}</span><span style={{...valMono, color:'var(--green)'}}>{best.toFixed(2)}</span></div>
          <div style={statRow}><span style={label}>{tt('Least efficient')}</span><span style={{...valMono, color:'var(--red)'}}>{worst.toFixed(2)}</span></div>
        </>
      )}
    </div>
      </Shell>
    );
}

// ── Pool Uptime / Reliability (Page 3) ──────────────────────────────────────
export function PoolReliability({ tt = (x) => x, pool, workers }) {
  const online = (Array.isArray(workers) ? workers : []).filter(w => w.status !== 'offline').length;
  const total = (Array.isArray(workers) ? workers : []).length || 1;
  const pct = ((online/total)*100).toFixed(1);
  return (
      <Shell>
    <div>
      <div style={cardTitle}>{tt('▸ Reliability')}</div>
      <div style={statRow}><span style={label}>{tt('Pool uptime')}</span><span style={valMono}>{fmtDuration(pool?.runtimeSec)}</span></div>
      <div style={statRow}><span style={label}>{tt('Workers online')}</span><span style={{...valMono, color:'var(--green)'}}>{online} / {total}</span></div>
      <div style={statRow}><span style={label}>{tt('Online %')}</span><span style={valMono}>{pct}%</span></div>
      <div style={statRow}><span style={label}>{tt('Idle / Disc.')}</span><span style={valMono}>{pool?.idle||0} / {pool?.disconnected||0}</span></div>
    </div>
      </Shell>
    );
}
