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
  color: 'var(--text-2)',
  marginBottom: '0.7rem',
  paddingBottom: '0.45rem',
  backgroundImage:
    'linear-gradient(90deg, rgba(var(--amber-rgb),0.55) 0%, rgba(var(--amber-rgb),0.45) 30%, rgba(var(--amber-rgb),0.12) 70%, rgba(var(--amber-rgb),0) 100%)',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 1px',
  backgroundPosition: 'bottom left',
};
const statRow = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.45rem 0.7rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:'0.3rem', borderRadius:'4px' };
const label = { fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };
const valMono = { fontFamily:'var(--fm)', fontSize:'0.8rem', color:'var(--text-1)', fontWeight:600 };

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
export function TrendChart({ points, colorVar = 'var(--chart1)', fill = true, fmt = (v)=>String(v), unit = '', height = 64, themeKey }) {
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
            Collecting data…
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
export function PoolHashrateWindows({ pool, themeKey }) {
  const w = pool?.hashrateWindows || {};
  const pct = pool?.hashrateWindowPct || {};
  const rows = [
    ['1M', w.hr1m, pct.hr1m], ['5M', w.hr5m, pct.hr5m], ['15M', w.hr15m, pct.hr15m],
    ['1H', w.hr1h, pct.hr1h], ['6H', w.hr6h, pct.hr6h], ['1D', w.hr1d, pct.hr1d],
    ['7D', w.hr7d, pct.hr7d],
  ];
  return (
    <div>
      <div style={cardTitle}>▸ Hashrate Windows — % of Pool Peak</div>
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
  );
}

// ── SPS Windows (Page 2) ────────────────────────────────────────────────────
export function SpsWindows({ pool }) {
  const s = pool?.spsWindows || {};
  const rows = [['1M', s.sps1m], ['5M', s.sps5m], ['15M', s.sps15m], ['1H', s.sps1h]];
  const max = Math.max(...rows.map(r => r[1]||0), 1);
  const fmtK = (v)=> v >= 1000 ? (v/1000).toFixed(2)+'k sh/s' : (v||0).toFixed(1)+' sh/s';
  return (
    <div>
      <div style={cardTitle}>▸ Shares / Second — Windows</div>
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
  );
}

// ── Connection States donut (Page 2) ────────────────────────────────────────
export function ConnectionStates({ pool }) {
  const active = Math.max(0, (pool?.workers || 0) - (pool?.idle || 0) - (pool?.disconnected || 0));
  const idle = pool?.idle || 0;
  const disc = pool?.disconnected || 0;
  const total = active + idle + disc || 1;
  const segs = [
    ['Active', active, 'var(--green)'],
    ['Idle', idle, 'var(--amber)'],
    ['Disconnected', disc, 'var(--red)'],
  ];
  // build conic-gradient stops
  let acc = 0;
  const stops = segs.map(([,n,c]) => {
    const start = (acc/total)*100; acc += n; const end = (acc/total)*100;
    return `${c} ${start}% ${end}%`;
  }).join(', ');
  return (
    <div>
      <div style={cardTitle}>▸ Connection States</div>
      <div style={{ display:'flex', alignItems:'center', gap:'1.2rem' }}>
        <div style={{ position:'relative', width:96, height:96, flexShrink:0 }}>
          <div style={{ width:'100%', height:'100%', borderRadius:'50%',
                        background:`conic-gradient(${stops})` }}/>
          <div style={{ position:'absolute', inset:'22%', borderRadius:'50%', background:'var(--bg-surface)',
                        display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
            <span style={{ fontFamily:'var(--fd)', fontSize:'1.3rem', fontWeight:700, color:'var(--text-1)', lineHeight:1 }}>{total}</span>
            <span style={{ fontFamily:'var(--fd)', fontSize:'0.45rem', letterSpacing:'0.1em', color:'var(--text-3)', textTransform:'uppercase' }}>workers</span>
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
  );
}

// ── Block Effort / Luck (Page 3) ────────────────────────────────────────────
export function BlockEffortPanel({ snapshots, sharesThisRound, networkDifficulty }) {
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
  bars.push({ lab: 'NOW', pct: openPct });

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={cardTitle}>▸ Block Effort / Luck <span style={{ color:'var(--text-3)', fontSize:'0.85em', letterSpacing:0, textTransform:'none' }}>(shares-to-find vs expected · &lt;100% = lucky)</span></div>
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
          No blocks found yet — history fills in as you strike. The NOW bar shows the current open round's effort.
        </div>
      )}
    </div>
  );
}

// ── Hashrate Stability (Page 3) ─────────────────────────────────────────────
export function HashrateStability({ hashrate, themeKey }) {
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
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={cardTitle}>▸ Hashrate Stability</div>
      <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:8 }}>
        <span style={{ fontFamily:'var(--fd)', fontSize:'1.8rem', fontWeight:700, color:'var(--amber)' }}>
          {stats ? stats.consistency.toFixed(1) : '—'}<span style={{ fontSize:'0.4em', color:'var(--text-3)' }}> %</span>
        </span>
        <span style={{ fontSize:'0.62rem', color:'var(--text-2)' }}>consistency (24h)</span>
      </div>
      <TrendChart points={pts.map(v=>v/1e12)} colorVar="var(--chart1)" fmt={(v)=>v.toFixed(1)} unit="T" height={54} themeKey={themeKey} />
      {stats && (
        <div style={{ display:'flex', marginTop:10 }}>
          <Stat k="Std Dev" v={`±${(stats.std/1e12).toFixed(1)} T`} color="var(--amber)" border />
          <Stat k="Min / Max" v={`${(stats.min/1e12).toFixed(0)} / ${(stats.max/1e12).toFixed(0)} T`} color="var(--text-1)" border />
          <Stat k="Dips 24h" v={String(stats.dips)} color="var(--red)" />
        </div>
      )}
    </div>
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
export function RejectTrend({ shares }) {
  const reasons = shares?.rejectReasons || {};
  const entries = Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,4);
  const total = entries.reduce((a,[,n])=>a+n,0) || 1;
  const colors = ['var(--amber)','var(--cyan)','var(--text-2)','var(--red)'];
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      <div style={cardTitle}>▸ Reject Reasons</div>
      {entries.length === 0 ? (
        <div style={{ fontSize:'0.6rem', color:'var(--text-3)', marginTop:8 }}>No rejected shares recorded.</div>
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
  );
}

// ── Best Share Trend (Page 2) ───────────────────────────────────────────────
export function BestShareTrend({ snapshots, bestHistory, themeKey }) {
  // prefer persisted bestTrend, fall back to live in-memory bestHistory
  const series = Array.isArray(snapshots?.bestTrend) && snapshots.bestTrend.length >= 2
    ? snapshots.bestTrend
    : (Array.isArray(bestHistory) ? bestHistory : []);
  const pts = series.map(p => (p.best || 0) / 1e15); // → P (peta) units
  return (
    <div>
      <div style={cardTitle}>▸ Best Share — Trend</div>
      <TrendChart points={pts} colorVar="var(--chart1)" fmt={(v)=>v.toFixed(2)} unit="P" height={62} themeKey={themeKey} />
    </div>
  );
}

// ── Fleet Efficiency (Page 3) ───────────────────────────────────────────────
export function FleetEfficiency({ workers }) {
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
    <div>
      <div style={cardTitle}>▸ Fleet Efficiency</div>
      {rigs.length === 0 ? (
        <div style={{ fontSize:'0.6rem', color:'var(--text-3)', marginTop:8, lineHeight:1.5 }}>
          No power data yet. Efficiency (J/TH) needs each rig's local API to report watts (ESP-Miner, LuxOS, Avalon, etc.).
        </div>
      ) : (
        <>
          <div style={statRow}><span style={label}>Total power</span><span style={valMono}>{totalPower.toFixed(0)} W</span></div>
          <div style={statRow}><span style={label}>Avg J/TH</span><span style={{...valMono, color:'var(--amber)'}}>{avgJth.toFixed(1)}</span></div>
          <div style={statRow}><span style={label}>Most efficient</span><span style={{...valMono, color:'var(--green)'}}>{best.toFixed(2)}</span></div>
          <div style={statRow}><span style={label}>Least efficient</span><span style={{...valMono, color:'var(--red)'}}>{worst.toFixed(2)}</span></div>
        </>
      )}
    </div>
  );
}

// ── Pool Uptime / Reliability (Page 3) ──────────────────────────────────────
export function PoolReliability({ pool, workers }) {
  const online = (Array.isArray(workers) ? workers : []).filter(w => w.status !== 'offline').length;
  const total = (Array.isArray(workers) ? workers : []).length || 1;
  const pct = ((online/total)*100).toFixed(1);
  return (
    <div>
      <div style={cardTitle}>▸ Reliability</div>
      <div style={statRow}><span style={label}>Pool uptime</span><span style={valMono}>{fmtDuration(pool?.runtimeSec)}</span></div>
      <div style={statRow}><span style={label}>Workers online</span><span style={{...valMono, color:'var(--green)'}}>{online} / {total}</span></div>
      <div style={statRow}><span style={label}>Online %</span><span style={valMono}>{pct}%</span></div>
      <div style={statRow}><span style={label}>Idle / Disc.</span><span style={valMono}>{pool?.idle||0} / {pool?.disconnected||0}</span></div>
    </div>
  );
}
