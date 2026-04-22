import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/* ===============================================================
   SoloStrike — Deep Mine shell + header + live state wiring
   =============================================================== */

const API_BASE = '';
const WS_URL   = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws';

// ── Strip styles (shared between ticker + header) ───────────────────────────
const STRIP_FULL_WIDTH = {
  width: '100vw',
  marginLeft: 'calc(-50vw + 50%)',
  marginRight: 'calc(-50vw + 50%)',
  boxSizing: 'border-box',
};

// ── localStorage helpers ─────────────────────────────────────────────────────
const LS_ORDER    = 'ss_card_order_v1';
const LS_CURRENCY = 'ss_currency_v1';
const LS_ALIASES  = 'ss_aliases_v1';
const LS_NOTES    = 'ss_notes_v1';
const LS_STRIP_ENABLED = 'ss_strip_enabled_v1';
const LS_STRIP_METRICS = 'ss_strip_metrics_v1';
const LS_STRIP_CHUNK   = 'ss_strip_chunk_v1';
const LS_STRIP_FADE    = 'ss_strip_fade_v1';
const LS_TICKER_ENABLED = 'ss_ticker_enabled_v1';
const LS_TICKER_SPEED   = 'ss_ticker_speed_v1';
const LS_TICKER_METRICS = 'ss_ticker_metrics_v1';
const LS_MINIMAL_MODE   = 'ss_minimal_mode_v1';
const LS_VISIBLE_CARDS  = 'ss_visible_cards_v1';

const DEFAULT_CARDS = ['hashrate','workers','blocks','finders','closest','network','snapshots','prices'];

const DEFAULT_TICKER_METRICS = ['hashrate','btcPrice','workersActive','closestCall','pendingBlock','lastBlockAgo','feeRate','mempool','uptime'];

function loadOrder() {
  try {
    const v = localStorage.getItem(LS_ORDER);
    if (!v) return DEFAULT_CARDS;
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return DEFAULT_CARDS;
    const filtered = parsed.filter(c => DEFAULT_CARDS.includes(c));
    const missing = DEFAULT_CARDS.filter(c => !filtered.includes(c));
    return [...filtered, ...missing];
  } catch { return DEFAULT_CARDS; }
}
function saveOrder(order) {
  try { localStorage.setItem(LS_ORDER, JSON.stringify(order)); } catch {}
}

function loadCurrency() {
  try { return localStorage.getItem(LS_CURRENCY) || 'USD'; } catch { return 'USD'; }
}
function saveCurrency(c) {
  try { localStorage.setItem(LS_CURRENCY, c); } catch {}
}

function loadAliases() {
  try {
    const v = localStorage.getItem(LS_ALIASES);
    if (!v) return {};
    const parsed = JSON.parse(v);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}
function saveAliases(aliases) {
  try { localStorage.setItem(LS_ALIASES, JSON.stringify(aliases || {})); } catch {}
}

function loadNotes() {
  try {
    const v = localStorage.getItem(LS_NOTES);
    if (!v) return {};
    const parsed = JSON.parse(v);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}
function saveNotes(notes) {
  try { localStorage.setItem(LS_NOTES, JSON.stringify(notes || {})); } catch {}
}

function loadStripEnabled()  { try { return localStorage.getItem(LS_STRIP_ENABLED) !== 'false'; } catch { return true; } }
function saveStripEnabled(v) { try { localStorage.setItem(LS_STRIP_ENABLED, v ? 'true' : 'false'); } catch {} }
function loadStripMetrics()  { try { const v = localStorage.getItem(LS_STRIP_METRICS); return v ? JSON.parse(v) : ['mempool','feeRate','halving','btcPrice']; } catch { return ['mempool','feeRate','halving','btcPrice']; } }
function saveStripMetrics(m) { try { localStorage.setItem(LS_STRIP_METRICS, JSON.stringify(m||[])); } catch {} }
function loadStripChunk()    { try { return parseInt(localStorage.getItem(LS_STRIP_CHUNK) || '4', 10); } catch { return 4; } }
function saveStripChunk(n)   { try { localStorage.setItem(LS_STRIP_CHUNK, String(n)); } catch {} }
function loadStripFade()     { try { return parseInt(localStorage.getItem(LS_STRIP_FADE) || '600', 10); } catch { return 600; } }
function saveStripFade(n)    { try { localStorage.setItem(LS_STRIP_FADE, String(n)); } catch {} }

function loadTickerEnabled() { try { return localStorage.getItem(LS_TICKER_ENABLED) !== 'false'; } catch { return true; } }
function saveTickerEnabled(v){ try { localStorage.setItem(LS_TICKER_ENABLED, v ? 'true' : 'false'); } catch {} }
function loadTickerSpeed()   { try { return parseInt(localStorage.getItem(LS_TICKER_SPEED) || '60', 10); } catch { return 60; } }
function saveTickerSpeed(n)  { try { localStorage.setItem(LS_TICKER_SPEED, String(n)); } catch {} }
function loadTickerMetrics() { try { const v = localStorage.getItem(LS_TICKER_METRICS); return v ? JSON.parse(v) : DEFAULT_TICKER_METRICS; } catch { return DEFAULT_TICKER_METRICS; } }
function saveTickerMetrics(m){ try { localStorage.setItem(LS_TICKER_METRICS, JSON.stringify(m||DEFAULT_TICKER_METRICS)); } catch {} }

function loadMinimalMode()   { try { return localStorage.getItem(LS_MINIMAL_MODE) === 'true'; } catch { return false; } }
function saveMinimalMode(v)  { try { localStorage.setItem(LS_MINIMAL_MODE, v ? 'true' : 'false'); } catch {} }

function loadVisibleCards()  { try { const v = localStorage.getItem(LS_VISIBLE_CARDS); return v ? JSON.parse(v) : DEFAULT_CARDS; } catch { return DEFAULT_CARDS; } }
function saveVisibleCards(c) { try { localStorage.setItem(LS_VISIBLE_CARDS, JSON.stringify(c||DEFAULT_CARDS)); } catch {} }

// ── Tiny hook: live clock that only re-renders at a cadence we choose ─────────
function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
function fmtClockTime(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const mm = m < 10 ? '0' + m : '' + m;
  return `${h}:${mm} ${ampm}`;
}
function fmtClockDate(d) {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const days   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
}

// ── ZMQ badge ─────────────────────────────────────────────────────────────────
function ZmqBadge({ zmq }) {
  if (!zmq) return null;
  const z = zmq;
  const now = Date.now();
  const idleMs = 30 * 60 * 1000;
  const recentlyHeard = z.lastBlockHeardAt && (now - z.lastBlockHeardAt < idleMs);

  let color, text, title;
  if (!z.enabled) {
    color = 'var(--text-3)'; text = 'ZMQ OFF';
    title = 'ZMQ not configured — pool relies on RPC polling (slightly slower block notifications)';
  } else if (recentlyHeard) {
    color = 'var(--green)'; text = 'ZMQ';
    title = `ZMQ active — last block heard ${Math.floor((now - z.lastBlockHeardAt)/60000)}m ago${z.endpoint ? '\n' + z.endpoint : ''}`;
  } else {
    color = 'var(--amber)'; text = 'ZMQ IDLE';
    title = `ZMQ configured but no recent block. Normal during quiet periods.${z.endpoint ? '\n' + z.endpoint : ''}`;
  }

  return (
    <span title={title} style={{ display:'inline-flex', alignItems:'center', fontFamily:'var(--fd)', fontSize:'0.52rem', letterSpacing:'0.12em', textTransform:'uppercase', color, flexShrink:0, marginLeft:4, textShadow: z.enabled ? `0 0 5px ${color}` : 'none' }}>
      {text}
    </span>
  );
}

// ── PortLight — color-coded port number based on live stratum health ──────────
// v1.5.4+ feature. Shows the port number colored:
//   🟢 green  = healthy (listening + stratum handshake OK)
//   🟡 amber  = degraded (listening but handshake failed)
//   🔴 red    = down (port not reachable)
//   ⚪ cyan   = unknown (health check hasn't run yet)
function PortLight({ health, port }) {
  const portData = health?.ports?.[port];
  const status   = portData?.status;

  let color, glow, title;
  if (status === 'healthy') {
    color = 'var(--green)';
    glow  = color;
    title = `Port ${port} — healthy${portData.latencyMs ? ` (${portData.latencyMs}ms)` : ''}`;
  } else if (status === 'degraded') {
    color = 'var(--amber)';
    glow  = color;
    title = `Port ${port} — degraded${portData.error ? ` (${portData.error})` : ''}`;
  } else if (status === 'down') {
    color = 'var(--red)';
    glow  = color;
    title = `Port ${port} — down${portData.error ? ` (${portData.error})` : ''}`;
  } else {
    color = 'var(--cyan)';
    glow  = null;
    title = `Port ${port} — checking...`;
  }

  return (
    <span title={title} style={{ color, textShadow: glow ? `0 0 6px ${glow}` : 'none', transition:'color 0.3s, text-shadow 0.3s' }}>
      {port}
    </span>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ connected, status, onSettings, privateMode, minimalMode, zmq }) {
  const now = useNow(30000);
  const statusMap = { running:{c:'var(--green)',t:'MINING'}, mining:{c:'var(--green)',t:'MINING'}, no_address:{c:'var(--amber)',t:'SETUP'}, setup:{c:'var(--amber)',t:'SETUP'}, starting:{c:'var(--amber)',t:'STARTING'}, error:{c:'var(--red)',t:'ERROR'}, loading:{c:'var(--text-2)',t:'...'} };
  const st = statusMap[status] || statusMap.loading;
  return (
    <header style={{ ...STRIP_FULL_WIDTH, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 0.5rem', minHeight:58, borderBottom:'1px solid var(--border)', gap:'0.4rem' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', minWidth:0, flex:1 }}>
        <span style={{ fontSize:16, color:'var(--amber)', filter: minimalMode?'none':'drop-shadow(0 0 8px rgba(245,166,35,0.7))', animation: minimalMode?'none':'pulse 3s ease-in-out infinite', flexShrink:0 }}>⛏</span>
        <span style={{ fontFamily:'var(--fd)', fontSize:'0.92rem', fontWeight:700, letterSpacing:'0.06em', color:'var(--amber)', textTransform:'uppercase', flexShrink:0 }}>SoloStrike</span>
        {!minimalMode && (
          <>
            <div style={{ width:1, height:16, background:'var(--border)', flexShrink:0 }}/>
            <span style={{ fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.12em', textTransform:'uppercase', color:st.c, textShadow:`0 0 6px ${st.c}`, animation:'pulse 2s ease-in-out infinite', flexShrink:0 }}>{st.t}</span>
            <ZmqBadge zmq={zmq}/>
            {privateMode && (
              <span title="Private Mode" style={{ display:'inline-flex', alignItems:'center', gap:3, color:'var(--cyan)', fontFamily:'var(--fd)', fontSize:'0.54rem', letterSpacing:'0.12em', textTransform:'uppercase', textShadow:'0 0 6px rgba(0,255,209,0.4)', animation:'pulse 3s ease-in-out infinite', flexShrink:0, marginLeft:4 }}>🔒</span>
            )}
          </>
        )}
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', flexShrink:0 }}>
        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2, fontFamily:'var(--fd)' }}>
          <span style={{ fontSize:'0.58rem', letterSpacing:'0.12em', color: connected?'var(--cyan)':'var(--text-2)', textShadow: connected?'0 0 6px var(--cyan)':'none', fontFamily:'var(--fd)', textTransform:'uppercase' }}>
            {connected?'LIVE':'RECONN'}
          </span>
          <span style={{ fontSize:'0.52rem', letterSpacing:'0.04em', color:'var(--amber)', fontFamily:'var(--fm)', whiteSpace:'nowrap' }}>
            {fmtClockTime(now)}
          </span>
          <span style={{ fontSize:'0.48rem', letterSpacing:'0.08em', color:'var(--amber)', fontFamily:'var(--fm)', whiteSpace:'nowrap' }}>
            {fmtClockDate(now)}
          </span>
        </div>
        <button onClick={onSettings} style={{ background:'none', border:'none', color:'var(--text-2)', cursor:'pointer', fontSize:18, padding:'4px 6px', flexShrink:0 }}>⚙</button>
      </div>
    </header>
  );
}

// ── Ticker ────────────────────────────────────────────────────────────────────
const Ticker = React.memo(function Ticker({ snapshotText, enabled, speedSec }) {
  if (!enabled || !snapshotText) return null;
  const pxPerSec = 60;
  const textLen = snapshotText.length * 7;
  const viewportEst = 700;
  const calcDur = Math.max(30, Math.round((textLen + viewportEst) / pxPerSec));
  return (
    <div style={{
      ...STRIP_FULL_WIDTH,
      overflow:'hidden',
      whiteSpace:'nowrap',
      fontFamily:'var(--fd)',
      fontSize:'0.62rem',
      letterSpacing:'0.1em',
      color:'var(--text-2)',
      background:'var(--bg-2)',
      borderBottom:'1px solid var(--border)',
      padding:'4px 0',
      position:'relative',
      textTransform:'uppercase',
    }}>
      <div style={{
        display:'inline-block',
        paddingLeft:'100%',
        animation:`ticker-scroll ${calcDur}s linear infinite`,
        willChange:'transform',
      }}>{snapshotText}</div>
    </div>
  );
});

// ── Hashrate strip ──────────────────────────────────────────────────────────
function StatStrip({ metrics, chunkSize, fadeMs, enabled, getValues }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const safeMetrics = Array.isArray(metrics) ? metrics : [];

  const chunks = useMemo(() => {
    if (!safeMetrics.length) return [];
    const result = [];
    for (let i = 0; i < safeMetrics.length; i += chunkSize) {
      result.push(safeMetrics.slice(i, i + chunkSize));
    }
    return result;
  }, [safeMetrics, chunkSize]);

  useEffect(() => {
    if (!enabled || chunks.length <= 1) return;
    const rotationMs = 5000;
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % chunks.length);
        setVisible(true);
      }, fadeMs / 2);
    }, rotationMs);
    return () => clearInterval(id);
  }, [chunks.length, enabled, fadeMs]);

  if (!enabled || !chunks.length) return null;

  const activeChunk = chunks[idx] || [];
  const values = getValues(activeChunk);

  return (
    <div style={{
      ...STRIP_FULL_WIDTH,
      display:'flex',
      alignItems:'center',
      justifyContent:'center',
      gap:'clamp(0.75rem, 3vw, 2rem)',
      flexWrap:'wrap',
      padding:'0.55rem 0.75rem',
      background:'var(--bg-2)',
      borderBottom:'1px solid var(--border)',
      fontFamily:'var(--fd)',
      fontSize:'0.62rem',
      letterSpacing:'0.1em',
      textTransform:'uppercase',
      color:'var(--text-2)',
      transition:`opacity ${fadeMs/2}ms`,
      opacity: visible?1:0.15,
    }}>
      {values.map((v, i) => (
        <span key={`${v.label}-${i}`} style={{display:'inline-flex', alignItems:'center', gap:'0.4rem'}}>
          <span>{v.label}</span>
          <span style={{color:v.color||'var(--amber)', fontWeight:700, fontFamily:'var(--fm)'}}>{v.value}</span>
        </span>
      ))}
    </div>
  );
}

// ── Toast system ─────────────────────────────────────────────────────────────
function ToastSystem({ blockAlert, workers }) {
  const [toasts, setToasts] = useState([]);
  const prevWorkersRef = useRef(null);
  useEffect(() => {
    if (!blockAlert || !blockAlert.timestamp) return;
    const id = `block-${blockAlert.timestamp}`;
    setToasts(t => {
      if (t.some(x => x.id === id)) return t;
      return [...t, { id, kind:'block', title:'🎉 BLOCK FOUND!', body:`Height #${blockAlert.height} · by ${blockAlert.minerAlias||blockAlert.miner||'unknown'}`, ttlMs:60000 }];
    });
    return () => {};
  }, [blockAlert && blockAlert.timestamp]);
  useEffect(() => {
    const prev = prevWorkersRef.current;
    const now = Array.isArray(workers) ? workers : [];
    if (prev && now.length) {
      const offline = now.filter(w => {
        const was = prev.find(p => p.name === w.name);
        if (!was) return false;
        return was.hashrate1m > 0 && w.hashrate1m === 0;
      });
      if (offline.length) {
        setToasts(t => {
          const next = [...t];
          offline.forEach(w => {
            const id = `offline-${w.name}-${Date.now()}`;
            if (!next.some(x => x.id === id)) {
              next.push({ id, kind:'worker', title:'⚠️ WORKER OFFLINE', body: w.alias || w.name, ttlMs:30000 });
            }
          });
          return next;
        });
      }
    }
    prevWorkersRef.current = now;
  }, [workers]);
  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map(t => setTimeout(() => {
      setToasts(curr => curr.filter(x => x.id !== t.id));
    }, t.ttlMs||20000));
    return () => timers.forEach(clearTimeout);
  }, [toasts]);
  const dismiss = (id) => setToasts(curr => curr.filter(t => t.id !== id));
  if (!toasts.length) return null;
  return (
    <div style={{position:'fixed',bottom:16,right:16,zIndex:2000,display:'flex',flexDirection:'column',gap:8,alignItems:'flex-end',maxWidth:360}}>
      {toasts.map(t=>(
        <div key={t.id} onClick={()=>dismiss(t.id)} style={{background:'var(--bg-2)',border:'1px solid '+(t.kind==='block'?'var(--amber)':'var(--red)'),borderRadius:6,padding:'0.7rem 0.9rem',fontFamily:'var(--fd)',fontSize:'0.75rem',color:'var(--text-1)',letterSpacing:'0.05em',cursor:'pointer',boxShadow:'0 6px 20px rgba(0,0,0,0.6)',minWidth:240,animation:'toast-in 0.4s ease-out'}}>
          <div style={{fontSize:'0.7rem',fontWeight:700,color:t.kind==='block'?'var(--amber)':'var(--red)',marginBottom:4,textTransform:'uppercase'}}>{t.title}</div>
          <div style={{color:'var(--text-2)',fontSize:'0.72rem'}}>{t.body}</div>
        </div>
      ))}
    </div>
  );
}

// ── Hashrate history chart ───────────────────────────────────────────────────
function HashrateChart({ history, state, fmtHashrate, range }) {
  if (!history || !history.length) {
    return <div style={{color:'var(--text-3)',padding:'2rem 0',textAlign:'center',fontSize:'0.8rem'}}>Collecting hashrate history…</div>;
  }
  const sorted = [...history].sort((a,b)=>a.t - b.t);
  const nowTs = Date.now();
  const rangeMs = range==='24h' ? 24*3600*1000 : range==='7d' ? 7*24*3600*1000 : 60*60*1000;
  const sinceTs = nowTs - rangeMs;
  const windowed = sorted.filter(p => p.t >= sinceTs);
  const data = windowed.length ? windowed : sorted;
  const maxY = Math.max(...data.map(p=>p.hps || 0), 1);
  const minY = 0;
  const axisTop = maxY * 1.12;
  const width = 800, height = 200;
  const padL = 48, padR = 10, padT = 16, padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const tMin = data[0].t, tMax = data[data.length-1].t || tMin + 1;
  const tSpan = Math.max(tMax - tMin, 1);
  const x = (t) => padL + ((t - tMin) / tSpan) * plotW;
  const y = (v) => padT + plotH - ((v - minY) / (axisTop - minY)) * plotH;
  const pts = data.map(p => `${x(p.t).toFixed(2)},${y(p.hps||0).toFixed(2)}`).join(' ');
  const areaPts = `${padL.toFixed(2)},${(padT+plotH).toFixed(2)} ${pts} ${(padL+plotW).toFixed(2)},${(padT+plotH).toFixed(2)}`;
  const peakPoint = data.reduce((best, p) => (p.hps||0) > (best.hps||0) ? p : best, data[0]);
  const currentVal = data[data.length-1]?.hps || 0;
  const avgVal = data.reduce((s,p) => s + (p.hps||0), 0) / data.length;
  const tickCount = 4;
  const yTicks = Array.from({length: tickCount+1}, (_,i) => (axisTop - minY) * (i/tickCount) + minY);
  const xTicks = [0, 0.33, 0.66, 1].map(f => tMin + tSpan*f);
  const fmtTick = (ts) => {
    const d = new Date(ts);
    if (range === '7d') {
      return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
    }
    return d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  };
  return (
    <div style={{width:'100%'}}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" style={{width:'100%',height:'auto'}}>
        <defs>
          <linearGradient id="hashArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.35"/>
            <stop offset="100%" stopColor="var(--amber)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {yTicks.map((tick,i)=>{
          const yp = y(tick);
          return <g key={`yt${i}`}>
            <line x1={padL} y1={yp} x2={padL+plotW} y2={yp} stroke="var(--border)" strokeDasharray="2 3"/>
            <text x={padL-6} y={yp+3} fontSize="10" fill="var(--text-3)" fontFamily="var(--fm)" textAnchor="end">{fmtHashrate(tick)}</text>
          </g>;
        })}
        {xTicks.map((tick,i)=>{
          const xp = x(tick);
          return <g key={`xt${i}`}>
            <line x1={xp} y1={padT+plotH} x2={xp} y2={padT+plotH+3} stroke="var(--border)"/>
            <text x={xp} y={padT+plotH+16} fontSize="10" fill="var(--text-3)" fontFamily="var(--fm)" textAnchor="middle">{fmtTick(tick)}</text>
          </g>;
        })}
        <polygon points={areaPts} fill="url(#hashArea)"/>
        <polyline points={pts} fill="none" stroke="var(--amber)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
        {peakPoint && (
          <g>
            <circle cx={x(peakPoint.t)} cy={y(peakPoint.hps||0)} r="4" fill="var(--cyan)" stroke="var(--bg-0)" strokeWidth="1.5"/>
            <text x={x(peakPoint.t)} y={y(peakPoint.hps||0) - 10} fontSize="10" fill="var(--cyan)" fontFamily="var(--fm)" textAnchor="middle" fontWeight="700">{fmtHashrate(peakPoint.hps||0)}</text>
          </g>
        )}
      </svg>
      <div style={{display:'flex',justifyContent:'space-around',fontSize:'0.6rem',color:'var(--text-3)',fontFamily:'var(--fm)',letterSpacing:'0.08em',marginTop:'0.3rem'}}>
        <span>CUR <span style={{color:'var(--amber)',fontWeight:700}}>{fmtHashrate(currentVal)}</span></span>
        <span>AVG <span style={{color:'var(--amber)',fontWeight:700}}>{fmtHashrate(avgVal)}</span></span>
        <span>PEAK <span style={{color:'var(--cyan)',fontWeight:700}}>{fmtHashrate(peakPoint?.hps||0)}</span></span>
      </div>
    </div>
  );
}

// ── Hashrate card ────────────────────────────────────────────────────────────
function HashrateCard({ state, fmtHashrate }) {
  const [range, setRange] = useState('1h');
  const btns = [['1h','1H'],['24h','24H'],['7d','7D']];
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem',flexWrap:'wrap',gap:'0.4rem'}}>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.1em',textTransform:'uppercase'}}>POOL HASHRATE</span>
        <div style={{display:'flex',gap:4}}>
          {btns.map(([k,l])=>(
            <button key={k} onClick={()=>setRange(k)} style={{background:range===k?'var(--amber)':'var(--bg-2)',color:range===k?'var(--bg-0)':'var(--text-2)',border:'1px solid var(--border)',padding:'3px 8px',fontSize:'0.6rem',fontFamily:'var(--fd)',letterSpacing:'0.1em',cursor:'pointer',borderRadius:3}}>{l}</button>
          ))}
        </div>
      </div>
      <HashrateChart history={state.hashrateHistory||[]} state={state} fmtHashrate={fmtHashrate} range={range}/>
    </div>
  );
}

// ── Workers card ─────────────────────────────────────────────────────────────
function WorkersCard({ state, aliases, setAliases, onSelect, selectedWorker, onClearSelection, fmtHashrate }) {
  const [query, setQuery] = useState('');
  const workers = Array.isArray(state.workers) ? state.workers : [];
  const q = query.trim().toLowerCase();
  const filtered = q ? workers.filter(w => {
    const disp = (aliases[w.name] || w.name).toLowerCase();
    return disp.includes(q) || w.name.toLowerCase().includes(q);
  }) : workers;
  const sorted = [...filtered].sort((a,b)=>(b.hashrate1m||0)-(a.hashrate1m||0));

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem',flexWrap:'wrap',gap:'0.4rem'}}>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.1em',textTransform:'uppercase'}}>WORKERS ({sorted.length})</span>
        <input type="text" placeholder="Search…" value={query} onChange={e=>setQuery(e.target.value)} style={{background:'var(--bg-2)',color:'var(--text-1)',border:'1px solid var(--border)',padding:'3px 8px',fontSize:'0.65rem',fontFamily:'var(--fd)',borderRadius:3,width:120}}/>
      </div>
      {sorted.length === 0
        ? (q ? <div style={{color:'var(--text-3)',fontSize:'0.72rem',textAlign:'center',padding:'1rem'}}>No workers match "{query}"</div>
             : <>No miners connected yet.<br/><span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--cyan)'}}>stratum+tcp://umbrel.local:3333</span><br/><span style={{color:'var(--text-3)',fontSize:'0.65rem'}}>user: worker_name · pass: x</span></>)
        : (
          <div style={{display:'flex',flexDirection:'column',gap:3}}>
            {sorted.map(w => {
              const disp = aliases[w.name] || w.name;
              const isSelected = selectedWorker === w.name;
              const on = w.hashrate1m > 0;
              return (
                <div
                  key={w.name}
                  onClick={()=>isSelected?onClearSelection():onSelect(w.name)}
                  style={{
                    display:'flex',justifyContent:'space-between',alignItems:'center',
                    padding:'5px 8px',
                    background:isSelected?'var(--bg-2)':'transparent',
                    border:isSelected?'1px solid var(--amber)':'1px solid transparent',
                    borderRadius:3,cursor:'pointer',
                    transition:'background 0.15s',
                  }}
                  onMouseEnter={e=>{ if (!isSelected) e.currentTarget.style.background = 'var(--bg-2)'; }}
                  onMouseLeave={e=>{ if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1}}>
                    <span style={{width:6,height:6,borderRadius:'50%',background:on?'var(--green)':'var(--text-3)',flexShrink:0,boxShadow:on?'0 0 6px var(--green)':'none'}}/>
                    <span style={{fontFamily:'var(--fd)',fontSize:'0.75rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{disp}</span>
                    {w.minerType && <span style={{color:'var(--text-3)',fontSize:'0.6rem',fontFamily:'var(--fd)',letterSpacing:'0.08em',textTransform:'uppercase'}}>{w.minerType}</span>}
                  </div>
                  <span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:on?'var(--amber)':'var(--text-3)',fontWeight:700}}>{fmtHashrate(w.hashrate1m||0)}</span>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}

// ── Worker detail modal ──────────────────────────────────────────────────────
function WorkerDetailModal({ workerName, onClose, state, aliases, setAliases, notes, setNotes, fmtHashrate }) {
  const w = (state.workers||[]).find(x => x.name === workerName);
  if (!w) return null;
  const disp = aliases[w.name] || w.name;
  const note = notes[w.name] || '';
  const [localAlias, setLocalAlias] = useState(disp);
  const [localNote, setLocalNote] = useState(note);
  useEffect(()=>{ setLocalAlias(aliases[w.name]||w.name); }, [w.name, aliases]);
  useEffect(()=>{ setLocalNote(notes[w.name]||''); }, [w.name, notes]);
  const saveAlias = (value) => {
    const next = { ...aliases };
    if (value && value !== w.name) next[w.name] = value; else delete next[w.name];
    setAliases(next);
  };
  const saveNote = (value) => {
    const next = { ...notes };
    if (value) next[w.name] = value; else delete next[w.name];
    setNotes(next);
  };
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-1)',border:'1px solid var(--border)',borderRadius:6,padding:20,maxWidth:420,width:'100%',boxShadow:'0 16px 60px rgba(0,0,0,0.8)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,marginBottom:16}}>
          <div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.65rem',color:'var(--text-3)',letterSpacing:'0.1em',textTransform:'uppercase'}}>{w.name}</div>
            <div style={{fontFamily:'var(--fd)',fontSize:'1rem',fontWeight:700,color:'var(--amber)'}}>{disp}</div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'1px solid var(--border)',color:'var(--text-2)',padding:'3px 9px',cursor:'pointer',borderRadius:3,fontSize:16,lineHeight:1}}>×</button>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12,fontFamily:'var(--fm)',fontSize:'0.8rem'}}>
          <div>
            <div style={{color:'var(--text-3)',fontSize:'0.6rem',letterSpacing:'0.1em',marginBottom:2}}>1M HR</div>
            <div style={{color:'var(--amber)',fontWeight:700}}>{fmtHashrate(w.hashrate1m||0)}</div>
          </div>
          <div>
            <div style={{color:'var(--text-3)',fontSize:'0.6rem',letterSpacing:'0.1em',marginBottom:2}}>5M HR</div>
            <div style={{color:'var(--amber)',fontWeight:700}}>{fmtHashrate(w.hashrate5m||0)}</div>
          </div>
          <div>
            <div style={{color:'var(--text-3)',fontSize:'0.6rem',letterSpacing:'0.1em',marginBottom:2}}>1HR HR</div>
            <div style={{color:'var(--amber)',fontWeight:700}}>{fmtHashrate(w.hashrate1h||0)}</div>
          </div>
          <div>
            <div style={{color:'var(--text-3)',fontSize:'0.6rem',letterSpacing:'0.1em',marginBottom:2}}>24H HR</div>
            <div style={{color:'var(--amber)',fontWeight:700}}>{fmtHashrate(w.hashrate1d||0)}</div>
          </div>
          <div>
            <div style={{color:'var(--text-3)',fontSize:'0.6rem',letterSpacing:'0.1em',marginBottom:2}}>SHARES</div>
            <div style={{color:'var(--text-1)'}}>{(w.shares||0).toLocaleString()}</div>
          </div>
          <div>
            <div style={{color:'var(--text-3)',fontSize:'0.6rem',letterSpacing:'0.1em',marginBottom:2}}>BEST SHARE</div>
            <div style={{color:'var(--text-1)'}}>{w.bestShareFmt || '—'}</div>
          </div>
          {w.ip && (
            <div style={{gridColumn:'1 / -1'}}>
              <div style={{color:'var(--text-3)',fontSize:'0.6rem',letterSpacing:'0.1em',marginBottom:2}}>IP</div>
              <a href={`http://${w.ip}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--cyan)',textDecoration:'none'}}>{w.ip}</a>
            </div>
          )}
        </div>
        <div style={{marginBottom:10}}>
          <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.65rem',color:'var(--text-3)',letterSpacing:'0.1em',marginBottom:4,textTransform:'uppercase'}}>ALIAS</label>
          <input
            type="text"
            value={localAlias}
            onChange={e=>setLocalAlias(e.target.value)}
            onBlur={e=>saveAlias(e.target.value.trim())}
            onKeyDown={e=>{ if (e.key==='Enter') { saveAlias(e.target.value.trim()); e.target.blur(); }}}
            style={{width:'100%',background:'var(--bg-2)',color:'var(--text-1)',border:'1px solid var(--border)',padding:'5px 9px',fontFamily:'var(--fd)',fontSize:'0.8rem',borderRadius:3,boxSizing:'border-box'}}
          />
        </div>
        <div>
          <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.65rem',color:'var(--text-3)',letterSpacing:'0.1em',marginBottom:4,textTransform:'uppercase'}}>NOTE</label>
          <textarea
            value={localNote}
            onChange={e=>setLocalNote(e.target.value)}
            onBlur={e=>saveNote(e.target.value.trim())}
            rows={3}
            style={{width:'100%',background:'var(--bg-2)',color:'var(--text-1)',border:'1px solid var(--border)',padding:'5px 9px',fontFamily:'var(--fd)',fontSize:'0.8rem',borderRadius:3,boxSizing:'border-box',resize:'vertical'}}
          />
        </div>
      </div>
    </div>
  );
}

// ── Closest Calls panel ──────────────────────────────────────────────────────
function ClosestCallsPanel({ closestCalls, aliases, fmtBestShareCompact }) {
  const list = closestCalls || [];
  if (!list.length) {
    return <div style={{color:'var(--text-3)',padding:'1rem',textAlign:'center',fontSize:'0.72rem',letterSpacing:'0.08em'}}>Waiting for your first high-difficulty share...</div>;
  }
  return (
    <div style={{display:'flex',flexDirection:'column',gap:3}}>
      {list.map((c,i)=>{
        const disp = aliases[c.worker] || c.worker;
        const ts = new Date(c.timestamp);
        const ago = (() => {
          const now = Date.now();
          const diff = now - c.timestamp;
          const days = Math.floor(diff / 86400000);
          const hrs = Math.floor((diff % 86400000) / 3600000);
          if (days > 0) return `${days}d ago`;
          if (hrs > 0) return `${hrs}h ago`;
          const mins = Math.floor(diff / 60000);
          return `${mins}m ago`;
        })();
        return (
          <div key={`${c.worker}-${c.timestamp}-${i}`} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 7px',border:'1px solid var(--border)',borderRadius:3,background:i===0?'rgba(245,166,35,0.06)':'transparent'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1}}>
              <span style={{fontFamily:'var(--fd)',fontSize:'0.65rem',color:'var(--text-3)',letterSpacing:'0.08em',width:24,flexShrink:0}}>#{i+1}</span>
              <span style={{fontFamily:'var(--fd)',fontSize:'0.75rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{disp}</span>
              <span style={{color:'var(--text-3)',fontSize:'0.62rem',fontFamily:'var(--fm)'}}>{ago}</span>
            </div>
            <span style={{fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--amber)',fontWeight:700}}>{fmtBestShareCompact(c.bestShare)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Blocks card ──────────────────────────────────────────────────────────────
function BlocksCard({ state, fmtBestShareCompact }) {
  const blocks = Array.isArray(state.blocks) ? state.blocks : [];
  const sorted = [...blocks].sort((a,b)=>b.height - a.height);
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem'}}>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.1em',textTransform:'uppercase'}}>BLOCKS FOUND ({sorted.length})</span>
      </div>
      {sorted.length === 0 ? (
        <div style={{color:'var(--text-3)',padding:'1rem 0',textAlign:'center',fontSize:'0.72rem'}}>No solo blocks yet. Best of luck, miner.</div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:3}}>
          {sorted.map(b=>{
            const ts = new Date(b.timestamp);
            const dateStr = ts.toLocaleDateString(undefined,{ month:'short', day:'numeric', year:'numeric'});
            return (
              <div key={b.height} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 7px',border:'1px solid var(--border)',borderRadius:3,background:'rgba(245,166,35,0.06)'}}>
                <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1}}>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.72rem',color:'var(--amber)',fontWeight:700}}>#{b.height}</span>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.75rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.minerAlias || b.miner || 'unknown'}</span>
                </div>
                <span style={{color:'var(--text-3)',fontSize:'0.65rem',fontFamily:'var(--fm)'}}>{dateStr}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Top Pool Finders ──────────────────────────────────────────────────────────
function TopFindersPanel({ topFinders, netBlocks }) {
const list = topFinders || [];
const totalSample = (netBlocks||[]).length;
if (!list.length) return null;
const maxCount = list[0]?.count || 1;
return (
<div style={{…card, minWidth:0, maxWidth:‘100%’, overflow:‘hidden’}} className=“fade-in”>
<div style={cardTitle}>▸ Top Pool Finders — Last {totalSample} Blocks</div>
<div style={{display:‘flex’,flexDirection:‘column’,gap:‘0.35rem’}}>
{list.map((p,i)=>{
const pct = (p.count/maxCount)*100;
const color = p.isSolo ? ‘var(–amber)’ : (i===0 ? ‘var(–cyan)’ : ‘var(–text-1)’);
return (
<div key={p.name} style={{padding:‘0.5rem 0.8rem’,background:‘var(–bg-raised)’,border:`1px solid ${i===0?'rgba(0,255,209,0.2)':'var(--border)'}`,position:‘relative’,overflow:‘hidden’, minWidth:0}}>
<div style={{position:‘absolute’,inset:0,width:`${pct}%`,background:p.isSolo?‘rgba(245,166,35,0.06)’:‘rgba(0,255,209,0.04)’,transition:‘width 0.6s ease’}}/>
<div style={{position:‘relative’,display:‘flex’,alignItems:‘center’,gap:‘0.6rem’}}>
<span style={{fontFamily:‘var(–fd)’,fontSize:‘0.65rem’,fontWeight:700,color:i===0?‘var(–cyan)’:‘var(–text-2)’,width:18, flexShrink:0}}>#{i+1}</span>
<div style={{flex:1,minWidth:0,fontFamily:‘var(–fd)’,fontSize:‘0.72rem’,color,letterSpacing:‘0.05em’,overflow:‘hidden’,textOverflow:‘ellipsis’,whiteSpace:‘nowrap’,textTransform:‘uppercase’}}>
{p.name}{p.isSolo && <span style={{fontSize:‘0.5rem’,color:‘var(–amber)’,marginLeft:6,border:‘1px solid var(–amber)’,padding:‘0 4px’}}>SOLO</span>}
</div>
<span style={{fontFamily:‘var(–fd)’,fontSize:‘0.85rem’,fontWeight:700,color, flexShrink:0}}>{p.count}</span>
</div>
</div>
);
})}
</div>
</div>
);
}

// ── Block feed ────────────────────────────────────────────────────────────────
function BlockFeed({ blocks, blockAlert }) {
return (
<div style={{…card, minWidth:0, maxWidth:‘100%’, overflow:‘hidden’}} className=“fade-in”>
<div style={{…cardTitle,display:‘flex’,justifyContent:‘space-between’,alignItems:‘center’}}>
<span>▸ Blocks Found — {(blocks||[]).length} total</span>
{(blocks||[]).length>0 && <a href=”/api/export/blocks.csv” download style={{fontFamily:‘var(–fd)’,fontSize:‘0.55rem’,letterSpacing:‘0.1em’,color:‘var(–cyan)’,textDecoration:‘none’,border:‘1px solid var(–border)’,padding:‘2px 6px’,background:‘var(–bg-raised)’}}>⬇ CSV</a>}
</div>
{!(blocks||[]).length?(
<div style={{textAlign:‘center’,padding:‘1.5rem’,border:‘1px dashed var(–border)’,color:‘var(–text-2)’,fontSize:‘0.75rem’,fontFamily:‘var(–fd)’}}>No blocks found yet.<br/><span style={{color:‘var(–amber)’,fontSize:‘0.68rem’}}>Keep mining ⛏</span></div>
):(
<div style={{display:‘flex’,flexDirection:‘column’,gap:‘0.4rem’,maxHeight:240,overflowY:‘auto’}}>
{blocks.map((b,i)=>(
<div key={b.hash} style={{display:‘flex’,alignItems:‘center’,gap:‘0.75rem’,padding:‘0.7rem 1rem’,background:‘var(–bg-raised)’,border:`1px solid ${blockAlert&&i===0?'var(--green)':'rgba(57,255,106,0.15)'}`,animation:blockAlert&&i===0?‘blockBoom 0.6s ease’:‘none’, minWidth:0}}>
<span style={{fontSize:16, flexShrink:0}}>💎</span>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:‘var(–fd)’,fontSize:‘0.88rem’,fontWeight:600,color:‘var(–green)’}}>#{fmtNum(b.height)}</div>
<div style={{fontFamily:‘var(–fm)’,fontSize:‘0.6rem’,color:‘var(–text-2)’,overflow:‘hidden’,textOverflow:‘ellipsis’,whiteSpace:‘nowrap’}}>{b.hash?.slice(0,24)}…</div>
</div>
<span style={{fontFamily:‘var(–fm)’,fontSize:‘0.62rem’,color:‘var(–text-2)’,flexShrink:0}}>{timeAgo(b.ts)}</span>
<a href={`https://mempool.space/block/${b.hash}`} target=”_blank” rel=“noopener noreferrer” style={{color:‘var(–text-2)’,fontSize:12, flexShrink:0}}>↗</a>
</div>
))}
</div>
)}
</div>
);
}

// ── Recent network blocks ─────────────────────────────────────────────────────
function RecentBlocksPanel({ netBlocks }) {
const list = netBlocks || [];
if (!list.length) return null;
return (
<div style={{…card, minWidth:0, maxWidth:‘100%’, overflow:‘hidden’}} className=“fade-in”>
<div style={cardTitle}>▸ Recent Network Blocks — Solo Winners ⚡</div>
<div style={{display:‘flex’,flexDirection:‘column’,gap:‘0.35rem’,maxHeight:300,overflowY:‘auto’}}>
{list.slice(0,15).map(b=>(
<div key={b.id} style={{display:‘flex’,alignItems:‘center’,gap:‘0.6rem’,padding:‘0.55rem 0.8rem’,background:‘var(–bg-raised)’,border:`1px solid ${b.isSolo?'rgba(245,166,35,0.35)':'var(--border)'}`,boxShadow:b.isSolo?‘0 0 10px rgba(245,166,35,0.12)’:‘none’, minWidth:0}}>
<span style={{fontSize:13,color:b.isSolo?‘var(–amber)’:‘var(–text-3)’,flexShrink:0}}>{b.isSolo?‘⚡’:‘▪’}</span>
<div style={{flex:1,minWidth:0}}>
<div style={{display:‘flex’,alignItems:‘center’,gap:8}}>
<span style={{fontFamily:‘var(–fd)’,fontSize:‘0.78rem’,fontWeight:600,color:b.isSolo?‘var(–amber)’:‘var(–text-1)’}}>#{fmtNum(b.height)}</span>
<span style={{fontFamily:‘var(–fd)’,fontSize:‘0.58rem’,letterSpacing:‘0.1em’,color:b.isSolo?‘var(–amber)’:‘var(–text-2)’,textTransform:‘uppercase’}}>{b.pool}</span>
{b.isSolo && <span style={{fontFamily:‘var(–fd)’,fontSize:‘0.52rem’,color:‘var(–amber)’,border:‘1px solid var(–amber)’,padding:‘1px 5px’,letterSpacing:‘0.12em’}}>SOLO</span>}
</div>
<div style={{fontFamily:‘var(–fm)’,fontSize:‘0.58rem’,color:‘var(–text-3)’,marginTop:2}}>
{fmtNum(b.tx_count||0)} tx · {blockTimeAgo(b.timestamp)}
{b.reward!=null && <> · <span style={{color:‘var(–cyan)’}}>{fmtSats(b.reward)}</span></>}
</div>
</div>
<a href={`https://mempool.space/block/${b.id}`} target=”_blank” rel=“noopener noreferrer” style={{color:‘var(–text-2)’,fontSize:12,flexShrink:0}}>↗</a>
</div>
))}
</div>
</div>
);
}

// ── Confetti + BlockAlert ─────────────────────────────────────────────────────
function Confetti() {
const ref = useRef(null);
useEffect(()=>{
const canvas=ref.current; if(!canvas)return;
const ctx=canvas.getContext(‘2d’); canvas.width=window.innerWidth; canvas.height=window.innerHeight;
const colors=[’#F5A623’,’#00FFD1’,’#39FF6A’,’#FF7A00’,’#fff’];
const pts=Array.from({length:150},()=>({x:Math.random()*canvas.width,y:-10,vy:3+Math.random()*5,vx:(Math.random()-.5)*4,s:3+Math.random()*6,c:colors[Math.floor(Math.random()*colors.length)],r:Math.random()*360,rv:(Math.random()-.5)*8,op:1}));
let frame; const draw=()=>{ ctx.clearRect(0,0,canvas.width,canvas.height); let alive=false;
pts.forEach(p=>{p.y+=p.vy;p.x+=p.vx;p.r+=p.rv;p.op-=0.007; if(p.y<canvas.height&&p.op>0)alive=true;
ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r*Math.PI/180);ctx.globalAlpha=Math.max(0,p.op);ctx.fillStyle=p.c;ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s*.5);ctx.restore();});
if(alive)frame=requestAnimationFrame(draw);};
frame=requestAnimationFrame(draw); return()=>cancelAnimationFrame(frame);
},[]);
return <canvas ref={ref} style={{position:‘fixed’,inset:0,width:‘100%’,height:‘100%’,pointerEvents:‘none’,zIndex:299}}/>;
}
function BlockAlert({ block, onDismiss }) {
if(!block) return null;
return(<>
<Confetti/>
<div style={{position:‘fixed’,inset:0,display:‘flex’,alignItems:‘center’,justifyContent:‘center’,zIndex:300,pointerEvents:‘none’}}>
<div onClick={onDismiss} style={{background:‘var(–bg-surface)’,border:‘2px solid var(–green)’,padding:‘2.5rem 4rem’,textAlign:‘center’,boxShadow:‘0 0 60px rgba(57,255,106,0.4)’,animation:‘blockBoom 0.5s ease’,pointerEvents:‘auto’,cursor:‘pointer’}}>
<div style={{fontSize:‘3.5rem’,marginBottom:‘0.5rem’}}>💎</div>
<div style={{fontFamily:‘var(–fd)’,fontSize:‘0.7rem’,letterSpacing:‘0.3em’,textTransform:‘uppercase’,color:‘var(–green)’,marginBottom:‘0.25rem’}}>⚡ BLOCK FOUND ⚡</div>
<div style={{fontFamily:‘var(–fd)’,fontSize:‘2.8rem’,fontWeight:700,color:’#fff’,textShadow:‘0 0 24px rgba(57,255,106,0.6)’}}>#{fmtNum(block.height)}</div>
<div style={{fontFamily:‘var(–fm)’,fontSize:‘0.65rem’,color:‘var(–text-2)’,marginTop:‘0.4rem’}}>{block.hash?.slice(0,20)}…</div>
<div style={{fontFamily:‘var(–fd)’,fontSize:‘0.55rem’,color:‘var(–text-3)’,marginTop:‘1rem’,letterSpacing:‘0.1em’}}>TAP TO DISMISS</div>
</div>
</div>
</>);
}

// ── Setup screen ──────────────────────────────────────────────────────────────
function SetupScreen({ onComplete }) {
const [addr,setAddr]=useState(’’); const [loading,setLoading]=useState(false); const [error,setError]=useState(’’);
const submit = async () => {
if(!addr.trim()){setError(‘Please enter a Bitcoin address.’);return;}
if(!isValidBtcAddress(addr)){setError(“That doesn’t look like a valid Bitcoin address.”);return;}
setLoading(true);setError(’’);
try{ const r=await fetch(’/api/setup’,{method:‘POST’,headers:{‘Content-Type’:‘application/json’},body:JSON.stringify({payoutAddress:addr.trim()})}); const d=await r.json(); if(!r.ok){setError(d.error||‘Invalid address.’);return;} onComplete(); }
catch{setError(‘Cannot reach pool API.’);} finally{setLoading(false);}
};
return (
<div style={{position:‘fixed’,inset:0,background:‘var(–bg-void)’,display:‘flex’,alignItems:‘center’,justifyContent:‘center’,zIndex:100,padding:‘1rem’}}>
<div style={{width:‘100%’,maxWidth:500,background:‘var(–bg-surface)’,border:‘1px solid var(–border-hot)’,padding:‘2rem’,boxShadow:‘var(–glow-a)’}}>
<div style={{display:‘flex’,alignItems:‘center’,gap:‘0.75rem’,marginBottom:‘0.5rem’}}>
<span style={{fontSize:22,color:‘var(–amber)’}}>⛏</span>
<span style={{fontFamily:‘var(–fd)’,fontSize:‘1.6rem’,fontWeight:700,color:‘var(–amber)’,letterSpacing:‘0.08em’}}>SOLOSTRIKE</span>
</div>
<p style={{fontFamily:‘var(–fd)’,fontSize:‘0.65rem’,letterSpacing:‘0.15em’,textTransform:‘uppercase’,color:‘var(–text-2)’,marginBottom:‘2rem’}}>Initial Setup — Enter Payout Address</p>
<label style={{display:‘block’,fontFamily:‘var(–fd)’,fontSize:‘0.62rem’,letterSpacing:‘0.15em’,textTransform:‘uppercase’,color:‘var(–text-2)’,marginBottom:‘0.4rem’}}>Bitcoin Payout Address</label>
<input style={{width:‘100%’,background:‘var(–bg-deep)’,border:`1px solid ${error?'rgba(255,59,59,0.5)':addr?'var(--border-hot)':'var(--border)'}`,color:‘var(–text-1)’,fontFamily:‘var(–fm)’,fontSize:‘0.82rem’,padding:‘0.75rem 1rem’,outline:‘none’,boxSizing:‘border-box’}}
type=“text” placeholder=“bc1q… or 1… or 3…” value={addr} onChange={e=>{setAddr(e.target.value);setError(’’);}} onKeyDown={e=>e.key===‘Enter’&&submit()} spellCheck={false} autoCorrect=“off” autoCapitalize=“off”/>
{error&&<div style={{background:‘rgba(255,59,59,0.08)’,border:‘1px solid rgba(255,59,59,0.3)’,padding:‘0.6rem 0.875rem’,fontSize:‘0.75rem’,color:‘var(–red)’,marginTop:‘0.75rem’}}>⚠ {error}</div>}
<button onClick={submit} disabled={loading} style={{width:‘100%’,marginTop:‘1.5rem’,padding:‘0.875rem’,background:‘var(–amber)’,color:’#000’,border:‘none’,fontFamily:‘var(–fd)’,fontSize:‘0.85rem’,fontWeight:700,letterSpacing:‘0.15em’,textTransform:‘uppercase’,cursor:‘pointer’,opacity:loading?0.6:1}}>
{loading?‘SAVING…’:‘START MINING →’}
</button>
</div>
</div>
);
}

// ── Settings modal ────────────────────────────────────────────────────────────
function SettingsModal({ onClose, saveConfig, currentConfig, currency, onCurrencyChange, onResetLayout, workers, aliases, onAliasesChange, stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange }) {
const [tab, setTab] = useState(‘main’);
const [addr,setAddr]=useState(’’);
const [poolName,setPoolName]=useState(currentConfig?.poolName||‘SoloStrike’);
const [privateMode, setPrivateMode] = useState(!!currentConfig?.privateMode);
const [loading,setLoading]=useState(false);
const [saved,setSaved]=useState(false);
const [error,setError]=useState(’’);

useEffect(() => {
setPrivateMode(!!currentConfig?.privateMode);
setPoolName(currentConfig?.poolName || ‘SoloStrike’);
}, [currentConfig]);

const submit = async () => {
setLoading(true);setError(’’);setSaved(false);
try{
const p = { poolName, privateMode };
const trimmed=addr.trim();
if(trimmed){ if(!isValidBtcAddress(trimmed)){setError(“That doesn’t look like a valid Bitcoin address.”);setLoading(false);return;} p.payoutAddress=trimmed; }
await saveConfig(p); setSaved(true); setAddr(’’); setTimeout(()=>setSaved(false),3000);
} catch(e){setError(e.message);} finally{setLoading(false);}
};

const tabStyle = (active) => ({
padding:‘0.5rem 0.55rem’, background:active?‘var(–bg-raised)’:‘transparent’,
border:‘1px solid’, borderColor:active?‘var(–border-hot)’:‘var(–border)’,
color:active?‘var(–amber)’:‘var(–text-2)’,
fontFamily:‘var(–fd)’, fontSize:‘0.55rem’, letterSpacing:‘0.1em’,
textTransform:‘uppercase’, cursor:‘pointer’, flex:1, textAlign:‘center’,
});

return (
<div style={{position:‘fixed’,inset:0,background:‘rgba(6,7,8,0.88)’,backdropFilter:‘blur(4px)’,display:‘flex’,alignItems:‘center’,justifyContent:‘center’,zIndex:200,padding:‘1rem’}} onClick={e=>e.target===e.currentTarget&&onClose()}>
<div style={{width:‘100%’,maxWidth:500,background:‘var(–bg-surface)’,border:‘1px solid var(–border-hot)’,padding:‘1.5rem’,boxShadow:‘var(–glow-a)’,maxHeight:‘92vh’,overflowY:‘auto’}}>
<div style={{display:‘flex’,justifyContent:‘space-between’,alignItems:‘center’,marginBottom:‘1rem’}}>
<span style={{fontFamily:‘var(–fd)’,fontSize:‘0.85rem’,fontWeight:600,letterSpacing:‘0.1em’,textTransform:‘uppercase’,color:‘var(–amber)’}}>⚙ Settings</span>
<button onClick={onClose} style={{background:‘none’,border:‘none’,color:‘var(–text-2)’,cursor:‘pointer’,fontSize:18}}>✕</button>
</div>
<div style={{display:‘flex’,gap:3,marginBottom:‘1rem’,flexWrap:‘wrap’}}>
<button onClick={()=>setTab(‘main’)}     style={tabStyle(tab===‘main’)}>Main</button>
<button onClick={()=>setTab(‘display’)}  style={tabStyle(tab===‘display’)}>Display</button>
<button onClick={()=>setTab(‘privacy’)}  style={tabStyle(tab===‘privacy’)}>Privacy</button>
<button onClick={()=>setTab(‘aliases’)}  style={tabStyle(tab===‘aliases’)}>Names</button>
<button onClick={()=>setTab(‘hooks’)}    style={tabStyle(tab===‘hooks’)}>Webhooks</button>
</div>
{saved&&<div style={{background:‘rgba(57,255,106,0.06)’,border:‘1px solid rgba(57,255,106,0.2)’,padding:‘0.5rem 0.75rem’,fontSize:‘0.72rem’,color:‘var(–green)’,marginBottom:‘1rem’}}>✓ Saved</div>}
{error&&<div style={{background:‘rgba(255,59,59,0.06)’,border:‘1px solid rgba(255,59,59,0.2)’,padding:‘0.5rem 0.75rem’,fontSize:‘0.72rem’,color:‘var(–red)’,marginBottom:‘1rem’}}>⚠ {error}</div>}

```
    {tab==='main' && <MainTab addr={addr} setAddr={setAddr} poolName={poolName} setPoolName={setPoolName} currency={currency} onCurrencyChange={onCurrencyChange} onResetLayout={onResetLayout} submit={submit} saved={saved} loading={loading}/>}
    {tab==='display' && <DisplayTab stripSettings={stripSettings} onStripSettingsChange={onStripSettingsChange} tickerSettings={tickerSettings} onTickerSettingsChange={onTickerSettingsChange} minimalMode={minimalMode} onMinimalModeChange={onMinimalModeChange} visibleCards={visibleCards} onVisibleCardsChange={onVisibleCardsChange}/>}
    {tab==='privacy' && <PrivacyTab privateMode={privateMode} setPrivateMode={setPrivateMode} submit={submit} saved={saved} loading={loading}/>}
    {tab==='aliases' && <AliasesTab workers={workers} aliases={aliases} onAliasesChange={onAliasesChange}/>}
    {tab==='hooks' && <WebhooksTab />}
  </div>
</div>
```

);
}

function MainTab({addr,setAddr,poolName,setPoolName,currency,onCurrencyChange,onResetLayout,submit,saved,loading}) {
const [show,setShow]=useState(false);
return (
<>
<label style={{display:‘block’,fontFamily:‘var(–fd)’,fontSize:‘0.6rem’,letterSpacing:‘0.15em’,textTransform:‘uppercase’,color:‘var(–text-2)’,marginBottom:‘0.4rem’}}>New Payout Address</label>
<div style={{position:‘relative’}}>
<input style={{width:‘100%’,background:‘var(–bg-deep)’,border:`1px solid ${addr?'var(--border-hot)':'var(--border)'}`,color:‘var(–text-1)’,fontFamily:‘var(–fm)’,fontSize:‘0.8rem’,padding:‘0.7rem 2.5rem 0.7rem 0.875rem’,outline:‘none’,boxSizing:‘border-box’}} type={show?‘text’:‘password’} placeholder=“Leave blank to keep current” value={addr} onChange={e=>setAddr(e.target.value)} spellCheck={false} autoCorrect=“off” autoCapitalize=“off”/>
<button onClick={()=>setShow(v=>!v)} style={{position:‘absolute’,right:8,top:‘50%’,transform:‘translateY(-50%)’,background:‘none’,border:‘none’,color:‘var(–text-2)’,cursor:‘pointer’,fontSize:12}}>{show?‘🙈’:‘👁’}</button>
</div>
<label style={{display:‘block’,fontFamily:‘var(–fd)’,fontSize:‘0.6rem’,letterSpacing:‘0.15em’,textTransform:‘uppercase’,color:‘var(–text-2)’,marginBottom:‘0.4rem’,marginTop:‘1rem’}}>Pool Name</label>
<input style={{width:‘100%’,background:‘var(–bg-deep)’,border:‘1px solid var(–border)’,color:‘var(–text-1)’,fontFamily:‘var(–fm)’,fontSize:‘0.8rem’,padding:‘0.7rem 0.875rem’,outline:‘none’,boxSizing:‘border-box’}} maxLength={32} value={poolName} onChange={e=>setPoolName(e.target.value)}/>
<label style={{display:‘block’,fontFamily:‘var(–fd)’,fontSize:‘0.6rem’,letterSpacing:‘0.15em’,textTransform:‘uppercase’,color:‘var(–text-2)’,marginBottom:‘0.4rem’,marginTop:‘1rem’}}>BTC Price Currency</label>
<select value={currency} onChange={e=>onCurrencyChange(e.target.value)} style={{width:‘100%’,background:‘var(–bg-deep)’,border:‘1px solid var(–border)’,color:‘var(–text-1)’,fontFamily:‘var(–fm)’,fontSize:‘0.8rem’,padding:‘0.7rem 0.875rem’,outline:‘none’,boxSizing:‘border-box’}}>
{CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}
</select>
<div style={{height:1,background:‘var(–border)’,margin:‘1.25rem 0’}}/>
<button onClick={onResetLayout} style={{width:‘100%’,padding:‘0.6rem’,background:‘var(–bg-raised)’,color:‘var(–text-2)’,border:‘1px solid var(–border)’,fontFamily:‘var(–fd)’,fontSize:‘0.7rem’,fontWeight:600,letterSpacing:‘0.1em’,textTransform:‘uppercase’,cursor:‘pointer’,marginBottom:‘0.75rem’}}>↺ Reset Card Layout</button>
<button onClick={submit} disabled={loading} style={{width:‘100%’,padding:‘0.75rem’,background:saved?‘var(–green)’:‘var(–amber)’,color:’#000’,border:‘none’,fontFamily:‘var(–fd)’,fontSize:‘0.8rem’,fontWeight:700,letterSpacing:‘0.12em’,textTransform:‘uppercase’,cursor:‘pointer’,opacity:loading?0.6:1}}>
{loading?‘SAVING…’:saved?‘✓ SAVED’:‘SAVE SETTINGS’}
</button>
</>
);
}

// ── DisplayTab ────────────────────────────────────────────────────────────────
function DisplayTab({ stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange }) {
const toggleMetric = (id) => {
const next = stripSettings.metrics.includes(id) ? stripSettings.metrics.filter(x => x !== id) : […stripSettings.metrics, id];
onStripSettingsChange({ …stripSettings, metrics: next });
};
const moveMetric = (id, dir) => {
const idx = stripSettings.metrics.indexOf(id);
if (idx < 0) return;
const swap = idx + dir;
if (swap < 0 || swap >= stripSettings.metrics.length) return;
const next = […stripSettings.metrics];
const tmp = next[idx];
next[idx] = next[swap];
next[swap] = tmp;
onStripSettingsChange({ …stripSettings, metrics: next });
};
const toggleCard = (id) => {
const next = visibleCards.includes(id) ? visibleCards.filter(x => x !== id) : […visibleCards, id];
onVisibleCardsChange(next);
};
const applyPreset = (preset) => onVisibleCardsChange([…preset]);

const toggleTickerMetric = (id) => {
const current = tickerSettings.metrics || [];
const next = current.includes(id) ? current.filter(x => x !== id) : […current, id];
onTickerSettingsChange({ …tickerSettings, metrics: next });
};
const moveTickerMetric = (id, dir) => {
const current = tickerSettings.metrics || [];
const idx = current.indexOf(id);
if (idx < 0) return;
const swap = idx + dir;
if (swap < 0 || swap >= current.length) return;
const next = […current];
const tmp = next[idx]; next[idx] = next[swap]; next[swap] = tmp;
onTickerSettingsChange({ …tickerSettings, metrics: next });
};
const matchTickerToStrip = () => {
onTickerSettingsChange({ …tickerSettings, metrics: […(stripSettings.metrics || [])] });
};

const sectionTitle = { fontFamily:‘var(–fd)’, fontSize:‘0.62rem’, letterSpacing:‘0.15em’, textTransform:‘uppercase’, color:‘var(–amber)’, marginBottom:‘0.5rem’, marginTop:‘1rem’ };
const firstSectionTitle = { …sectionTitle, marginTop:0 };
const rowLabel = { fontFamily:‘var(–fd)’, fontSize:‘0.58rem’, letterSpacing:‘0.1em’, textTransform:‘uppercase’, color:‘var(–text-2)’, marginBottom:6 };
const btnBase = { padding:‘4px 8px’, fontFamily:‘var(–fd)’, fontSize:‘0.55rem’, letterSpacing:‘0.08em’, textTransform:‘uppercase’, cursor:‘pointer’, border:‘1px solid var(–border)’, background:‘var(–bg-raised)’, color:‘var(–text-2)’ };

return (
<>
<div style={firstSectionTitle}>▸ Minimal Mode</div>
<div style={{display:‘flex’, alignItems:‘center’, gap:‘0.75rem’, marginBottom:‘0.5rem’, padding:‘0.75rem 0.8rem’, background: minimalMode?‘rgba(0,255,209,0.06)’:‘var(–bg-raised)’, border:`1px solid ${minimalMode?'rgba(0,255,209,0.35)':'var(--border)'}`}}>
<div style={{flex:1}}>
<div style={{fontFamily:‘var(–fd)’, fontSize:‘0.78rem’, color: minimalMode?‘var(–cyan)’:‘var(–text-1)’, fontWeight:700, letterSpacing:‘0.08em’, textTransform:‘uppercase’}}>Bare Bones UI</div>
<div style={{fontFamily:‘var(–fm)’, fontSize:‘0.62rem’, color:‘var(–text-2)’, marginTop:3, lineHeight:1.4}}>
Hides ticker, block strips, status dot, and shows only Hashrate + Workers + Blocks cards.
</div>
</div>
<button onClick={()=>onMinimalModeChange(!minimalMode)}
style={{width:46, height:26, borderRadius:13, background: minimalMode?‘var(–cyan)’:‘var(–bg-deep)’, border:‘1px solid var(–border)’, position:‘relative’, cursor:‘pointer’, flexShrink:0}}>
<div style={{position:‘absolute’, top:2, left: minimalMode?22:2, width:20, height:20, borderRadius:‘50%’, background: minimalMode?’#000’:‘var(–text-2)’, transition:‘left 0.2s’}}/>
</button>
</div>
{minimalMode && (
<div style={{fontFamily:‘var(–fm)’, fontSize:‘0.6rem’, color:‘var(–cyan)’, marginBottom:‘0.5rem’, padding:‘0.4rem 0.6rem’, background:‘rgba(0,255,209,0.04)’, border:‘1px dashed rgba(0,255,209,0.2)’}}>
🔇 Minimal Mode is on — settings below are overridden until you turn it off.
</div>
)}

```
  <div style={sectionTitle}>▸ Dashboard Cards</div>

  <div style={rowLabel}>Quick presets</div>
  <div style={{display:'flex', gap:6, marginBottom:'0.75rem'}}>
    <button onClick={()=>applyPreset(MINIMAL_PRESET)}
      style={{flex:1, padding:'0.55rem', background:'var(--bg-raised)', border:'1px solid var(--border)', color:'var(--text-1)', fontFamily:'var(--fd)', fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', cursor:'pointer'}}>
      Minimal (3)
    </button>
    <button onClick={()=>applyPreset(DEFAULT_PRESET)}
      style={{flex:1, padding:'0.55rem', background:'var(--bg-raised)', border:'1px solid var(--border-hot)', color:'var(--amber)', fontFamily:'var(--fd)', fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', cursor:'pointer'}}>
      Default ({DEFAULT_PRESET.length})
    </button>
    <button onClick={()=>applyPreset(EVERYTHING_PRESET)}
      style={{flex:1, padding:'0.55rem', background:'var(--bg-raised)', border:'1px solid var(--border)', color:'var(--text-1)', fontFamily:'var(--fd)', fontSize:'0.62rem', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase', cursor:'pointer'}}>
      Everything ({EVERYTHING_PRESET.length})
    </button>
  </div>

  <div style={rowLabel}>Individual cards (tap to toggle)</div>
  <div style={{display:'flex', flexDirection:'column', gap:3, padding:4, background:'var(--bg-deep)', border:'1px solid var(--border)'}}>
    {ALL_CARDS.map(c => {
      const on = visibleCards.includes(c.id);
      return (
        <div key={c.id} style={{display:'flex', alignItems:'center', gap:8, padding:'6px 8px', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
          <button onClick={()=>toggleCard(c.id)}
            style={{width:20, height:20, borderRadius:3, border:`1px solid ${on?'var(--cyan)':'var(--border)'}`, background:on?'var(--cyan)':'transparent', color:'#000', cursor:'pointer', fontSize:13, lineHeight:1, padding:0, flexShrink:0}}>
            {on?'✓':''}
          </button>
          <span style={{flex:1, fontFamily:'var(--fm)', fontSize:'0.78rem', color: on?'var(--text-1)':'var(--text-2)'}}>{c.label}</span>
        </div>
      );
    })}
  </div>
  <div style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)', marginTop:4}}>
    Showing: <span style={{color:'var(--amber)'}}>{visibleCards.length}</span> of {ALL_CARDS.length} cards
  </div>

  <div style={sectionTitle}>▸ Top Strip</div>

  <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.75rem', padding:'0.5rem 0.6rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
    <span style={{fontFamily:'var(--fd)', fontSize:'0.68rem', color:'var(--text-1)', fontWeight:600, flex:1}}>Enable top strip</span>
    <button onClick={()=>onStripSettingsChange({ ...stripSettings, enabled: !stripSettings.enabled })}
      style={{width:40, height:22, borderRadius:11, background: stripSettings.enabled?'var(--cyan)':'var(--bg-deep)', border:'1px solid var(--border)', position:'relative', cursor:'pointer'}}>
      <div style={{position:'absolute', top:1, left: stripSettings.enabled?20:2, width:18, height:18, borderRadius:'50%', background: stripSettings.enabled?'#000':'var(--text-2)', transition:'left 0.2s'}}/>
    </button>
  </div>

  <div style={rowLabel}>Metrics (tap to toggle, ↑↓ to reorder)</div>
  <div style={{display:'flex', flexDirection:'column', gap:4, maxHeight:220, overflowY:'auto', padding:4, background:'var(--bg-deep)', border:'1px solid var(--border)'}}>
    {METRIC_CATEGORIES.map(cat => (
      <div key={cat}>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.52rem', letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--text-3)', padding:'4px 6px', borderBottom:'1px dashed var(--border)', marginTop:4}}>{cat}</div>
        {METRICS.filter(metric => metric.category === cat).map(metric => {
          const on = stripSettings.metrics.includes(metric.id);
          const order = on ? stripSettings.metrics.indexOf(metric.id) : -1;
          return (
            <div key={metric.id} style={{display:'flex', alignItems:'center', gap:6, padding:'5px 6px', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
              <button onClick={()=>toggleMetric(metric.id)}
                style={{width:18, height:18, borderRadius:3, border:`1px solid ${on?'var(--cyan)':'var(--border)'}`, background:on?'var(--cyan)':'transparent', color:'#000', cursor:'pointer', fontSize:12, lineHeight:1, padding:0, flexShrink:0}}>
                {on?'✓':''}
              </button>
              <span style={{flex:1, fontFamily:'var(--fm)', fontSize:'0.72rem', color: on?'var(--text-1)':'var(--text-2)'}}>{metric.label}</span>
              {on && (
                <>
                  <span style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-3)', minWidth:18, textAlign:'right'}}>#{order+1}</span>
                  <button onClick={()=>moveMetric(metric.id, -1)} style={{...btnBase, padding:'2px 6px'}}>↑</button>
                  <button onClick={()=>moveMetric(metric.id, 1)} style={{...btnBase, padding:'2px 6px'}}>↓</button>
                </>
              )}
            </div>
          );
        })}
      </div>
    ))}
  </div>
  <div style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)', marginTop:4}}>
    Selected: <span style={{color:'var(--amber)'}}>{stripSettings.metrics.length}</span> metric{stripSettings.metrics.length===1?'':'s'}
  </div>

  <div style={{...rowLabel, marginTop:'0.9rem'}}>Show how many at a time (fade between groups)</div>
  <div style={{display:'flex', gap:6}}>
    {[1,2,3,4].map(n => (
      <button key={n} onClick={()=>onStripSettingsChange({ ...stripSettings, chunkSize: n })}
        style={{flex:1, padding:'0.55rem', background: stripSettings.chunkSize===n?'var(--bg-raised)':'transparent', border:`1px solid ${stripSettings.chunkSize===n?'var(--border-hot)':'var(--border)'}`, color: stripSettings.chunkSize===n?'var(--amber)':'var(--text-2)', fontFamily:'var(--fd)', fontSize:'0.7rem', fontWeight:700, cursor:'pointer'}}>
        {n}
      </button>
    ))}
  </div>

  <div style={{...rowLabel, marginTop:'0.9rem'}}>Fade interval: <span style={{color:'var(--amber)'}}>{(stripSettings.fadeMs/1000).toFixed(1)}s</span></div>
  <input type="range" min="2000" max="15000" step="500" value={stripSettings.fadeMs} onChange={e=>onStripSettingsChange({ ...stripSettings, fadeMs: parseInt(e.target.value,10) })}
    style={{width:'100%', accentColor:'var(--amber)'}}/>

  <div style={sectionTitle}>▸ Scrolling Ticker</div>

  <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.75rem', padding:'0.5rem 0.6rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
    <span style={{fontFamily:'var(--fd)', fontSize:'0.68rem', color:'var(--text-1)', fontWeight:600, flex:1}}>Show scrolling ticker</span>
    <button onClick={()=>onTickerSettingsChange({ ...tickerSettings, enabled: !tickerSettings.enabled })}
      style={{width:40, height:22, borderRadius:11, background: tickerSettings.enabled?'var(--cyan)':'var(--bg-deep)', border:'1px solid var(--border)', position:'relative', cursor:'pointer'}}>
      <div style={{position:'absolute', top:1, left: tickerSettings.enabled?20:2, width:18, height:18, borderRadius:'50%', background: tickerSettings.enabled?'#000':'var(--text-2)', transition:'left 0.2s'}}/>
    </button>
  </div>

  {tickerSettings.enabled && (
    <>
      <div style={{...rowLabel, marginTop:'0.5rem', display:'flex', alignItems:'center', justifyContent:'space-between', gap:6}}>
        <span>Ticker metrics (tap to toggle, ↑↓ to reorder)</span>
        <button onClick={matchTickerToStrip}
          title="Copy top strip selection into ticker"
          style={{padding:'3px 7px', background:'var(--bg-raised)', border:'1px solid var(--border)', color:'var(--cyan)', fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.08em', textTransform:'uppercase', cursor:'pointer'}}>
          ⤴ Match Top Strip
        </button>
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:4, maxHeight:220, overflowY:'auto', padding:4, background:'var(--bg-deep)', border:'1px solid var(--border)'}}>
        {METRIC_CATEGORIES.map(cat => (
          <div key={cat}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.52rem', letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--text-3)', padding:'4px 6px', borderBottom:'1px dashed var(--border)', marginTop:4}}>{cat}</div>
            {METRICS.filter(metric => metric.category === cat).map(metric => {
              const on = (tickerSettings.metrics || []).includes(metric.id);
              const order = on ? tickerSettings.metrics.indexOf(metric.id) : -1;
              return (
                <div key={metric.id} style={{display:'flex', alignItems:'center', gap:6, padding:'5px 6px', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                  <button onClick={()=>toggleTickerMetric(metric.id)}
                    style={{width:18, height:18, borderRadius:3, border:`1px solid ${on?'var(--cyan)':'var(--border)'}`, background:on?'var(--cyan)':'transparent', color:'#000', cursor:'pointer', fontSize:12, lineHeight:1, padding:0, flexShrink:0}}>
                    {on?'✓':''}
                  </button>
                  <span style={{flex:1, fontFamily:'var(--fm)', fontSize:'0.72rem', color: on?'var(--text-1)':'var(--text-2)'}}>{metric.label}</span>
                  {on && (
                    <>
                      <span style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-3)', minWidth:18, textAlign:'right'}}>#{order+1}</span>
                      <button onClick={()=>moveTickerMetric(metric.id, -1)} style={{...btnBase, padding:'2px 6px'}}>↑</button>
                      <button onClick={()=>moveTickerMetric(metric.id, 1)} style={{...btnBase, padding:'2px 6px'}}>↓</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)', marginTop:4}}>
        Selected: <span style={{color:'var(--amber)'}}>{(tickerSettings.metrics || []).length}</span> metric{(tickerSettings.metrics || []).length===1?'':'s'}
      </div>

      <div style={{...rowLabel, marginTop:'0.9rem'}}>
        Scroll speed: <span style={{color:'var(--amber)'}}>{tickerSettings.speedSec}s per loop</span>
        <span style={{color:'var(--text-3)', marginLeft:6, fontSize:'0.52rem'}}>
          ({tickerSettings.speedSec <= 6 ? 'very fast' : tickerSettings.speedSec <= 15 ? 'fast' : tickerSettings.speedSec <= 35 ? 'medium' : 'slow'})
        </span>
      </div>
      <input type="range" min="3" max="90" step="1" value={tickerSettings.speedSec} onChange={e=>onTickerSettingsChange({ ...tickerSettings, speedSec: parseInt(e.target.value,10) })}
        style={{width:'100%', accentColor:'var(--amber)'}}/>
      <div style={{display:'flex', justifyContent:'space-between', fontFamily:'var(--fm)', fontSize:'0.52rem', color:'var(--text-3)', marginTop:2}}>
        <span>very fast</span><span>slow</span>
      </div>
      <div style={{fontFamily:'var(--fm)', fontSize:'0.58rem', color:'var(--text-3)', marginTop:6, lineHeight:1.4}}>
        Ticker values refresh every 30 seconds. Animation briefly resets on each refresh to sync cleanly with the new data.
      </div>
    </>
  )}

  <div style={{fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-3)', marginTop:'1rem', textAlign:'center', lineHeight:1.4}}>
    Changes save automatically and persist on this device
  </div>
</>
```

);
}

function PrivacyTab({privateMode,setPrivateMode,submit,saved,loading}) {
return (
<>
<div style={{background:‘var(–bg-deep)’,border:‘1px solid var(–border)’,padding:‘1rem’,marginBottom:‘1rem’}}>
<div style={{display:‘flex’,alignItems:‘center’,justifyContent:‘space-between’,marginBottom:‘0.6rem’}}>
<span style={{fontFamily:‘var(–fd)’,fontSize:‘0.8rem’,fontWeight:700,color:privateMode?‘var(–cyan)’:‘var(–text-1)’,letterSpacing:‘0.08em’,textTransform:‘uppercase’}}>🔒 Private Mode</span>
<button onClick={()=>setPrivateMode(!privateMode)} style={{width:48,height:26,borderRadius:13,background:privateMode?‘var(–cyan)’:‘var(–bg-raised)’,border:‘1px solid var(–border)’,position:‘relative’,cursor:‘pointer’,transition:‘background 0.2s’}}>
<div style={{position:‘absolute’,top:2,left:privateMode?24:2,width:20,height:20,borderRadius:‘50%’,background:privateMode?’#000’:‘var(–text-2)’,transition:‘left 0.2s’}}/>
</button>
</div>
<p style={{fontFamily:‘var(–fm)’,fontSize:‘0.72rem’,color:‘var(–text-2)’,lineHeight:1.5,margin:0}}>
When enabled, SoloStrike stops all external API calls. No mempool.space, no price feeds. All data comes from your own Bitcoin Core and (if installed) your Umbrel Mempool app.
</p>
<div style={{marginTop:‘0.8rem’,padding:‘0.6rem’,background:privateMode?‘rgba(0,255,209,0.06)’:‘rgba(245,166,35,0.06)’,border:`1px solid ${privateMode?'rgba(0,255,209,0.25)':'rgba(245,166,35,0.25)'}`}}>
<div style={{fontFamily:‘var(–fd)’,fontSize:‘0.55rem’,letterSpacing:‘0.12em’,textTransform:‘uppercase’,color:privateMode?‘var(–cyan)’:‘var(–amber)’,marginBottom:4}}>Current state</div>
<div style={{fontFamily:‘var(–fm)’,fontSize:‘0.7rem’,color:‘var(–text-1)’}}>
{privateMode ? ‘Outbound calls: NONE. Your pool leaks zero metadata.’ : ‘Outbound calls: mempool.space (fees, blocks, prices).’}
</div>
</div>
</div>
<button onClick={submit} disabled={loading} style={{width:‘100%’,padding:‘0.75rem’,background:saved?‘var(–green)’:‘var(–amber)’,color:’#000’,border:‘none’,fontFamily:‘var(–fd)’,fontSize:‘0.8rem’,fontWeight:700,letterSpacing:‘0.12em’,textTransform:‘uppercase’,cursor:‘pointer’,opacity:loading?0.6:1}}>
{loading?‘SAVING…’:saved?‘✓ SAVED’:‘APPLY PRIVATE MODE’}
</button>
</>
);
}

function AliasesTab({workers, aliases, onAliasesChange}) {
const [localAliases, setLocalAliases] = useState(aliases || {});
useEffect(()=>setLocalAliases(aliases||{}), [aliases]);
const updateAlias = (name, val) => {
const next = { …localAliases };
if (!val.trim()) delete next[name]; else next[name] = val.trim().slice(0, 32);
setLocalAliases(next);
};
const save = () => { onAliasesChange(localAliases); };
return (
<>
<p style={{fontFamily:‘var(–fm)’,fontSize:‘0.7rem’,color:‘var(–text-2)’,lineHeight:1.5,marginBottom:‘0.75rem’}}>
Rename workers in the UI (saved on this device). Leave blank to use the default suffix name.
</p>
<div style={{display:‘flex’,flexDirection:‘column’,gap:‘0.5rem’,maxHeight:‘50vh’,overflowY:‘auto’}}>
{(workers||[]).map(w => (
<div key={w.name} style={{background:‘var(–bg-raised)’,border:‘1px solid var(–border)’,padding:‘0.6rem 0.75rem’}}>
<div style={{fontFamily:‘var(–fm)’,fontSize:‘0.65rem’,color:‘var(–text-3)’,marginBottom:4,overflow:‘hidden’,textOverflow:‘ellipsis’,whiteSpace:‘nowrap’}}>{w.name}</div>
<input type=“text” value={localAliases[w.name] || ‘’} placeholder={stripAddr(w.name)} onChange={e=>updateAlias(w.name, e.target.value)} maxLength={32}
style={{width:‘100%’,background:‘var(–bg-deep)’,border:‘1px solid var(–border)’,color:‘var(–text-1)’,fontFamily:‘var(–fm)’,fontSize:‘0.78rem’,padding:‘0.5rem 0.7rem’,outline:‘none’,boxSizing:‘border-box’}}/>
</div>
))}
</div>
<button onClick={save} style={{width:‘100%’,marginTop:‘1rem’,padding:‘0.7rem’,background:‘var(–amber)’,color:’#000’,border:‘none’,fontFamily:‘var(–fd)’,fontSize:‘0.75rem’,fontWeight:700,letterSpacing:‘0.12em’,textTransform:‘uppercase’,cursor:‘pointer’}}>Save Aliases</button>
</>
);
}

function WebhooksTab() {
const [hooks, setHooks] = useState([]);
const [newUrl, setNewUrl] = useState(’’);
const [newName, setNewName] = useState(’’);
const [newEvents, setNewEvents] = useState([‘block_found’]);
const [busy, setBusy] = useState(false);
const [err, setErr] = useState(’’);
const load = useCallback(async () => {
try { const r = await fetch(’/api/webhooks’); setHooks(await r.json()); } catch {}
}, []);
useEffect(()=>{ load(); }, [load]);
const add = async () => {
setErr(’’);
if (!/^https?:///i.test(newUrl.trim())) { setErr(‘URL must start with http:// or https://’); return; }
setBusy(true);
try {
const r = await fetch(’/api/webhooks’, { method:‘POST’, headers:{‘Content-Type’:‘application/json’}, body:JSON.stringify({ name:newName || ‘Webhook’, url:newUrl.trim(), events:newEvents }) });
if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || ‘Add failed’); }
setNewUrl(’’); setNewName(’’); setNewEvents([‘block_found’]);
await load();
} catch(e){ setErr(e.message); } finally { setBusy(false); }
};
const del = async (id) => { await fetch(`/api/webhooks/${id}`, { method:‘DELETE’ }); await load(); };
const EVENT_LABELS = { block_found:‘Block Found’, worker_offline:‘Worker Offline’, worker_online:‘Worker Online’ };
const toggleEvent = (ev) => setNewEvents(list => list.includes(ev) ? list.filter(x=>x!==ev) : […list, ev]);
return (
<>
<p style={{fontFamily:‘var(–fm)’,fontSize:‘0.7rem’,color:‘var(–text-2)’,lineHeight:1.5,marginBottom:‘0.75rem’}}>
POST JSON events to any URL. Use with Discord webhooks, Telegram bots, ntfy.sh topics, Home Assistant, etc.
</p>
{hooks.length > 0 && (
<div style={{display:‘flex’,flexDirection:‘column’,gap:‘0.4rem’,marginBottom:‘1rem’}}>
{hooks.map(h => (
<div key={h.id} style={{background:‘var(–bg-raised)’,border:‘1px solid var(–border)’,padding:‘0.55rem 0.7rem’,display:‘flex’,alignItems:‘center’,gap:8}}>
<div style={{flex:1,minWidth:0}}>
<div style={{fontFamily:‘var(–fd)’,fontSize:‘0.72rem’,color:‘var(–text-1)’,fontWeight:600}}>{h.name}</div>
<div style={{fontFamily:‘var(–fm)’,fontSize:‘0.58rem’,color:‘var(–text-2)’,overflow:‘hidden’,textOverflow:‘ellipsis’,whiteSpace:‘nowrap’}}>{h.url}</div>
<div style={{fontFamily:‘var(–fd)’,fontSize:‘0.55rem’,color:‘var(–cyan)’,letterSpacing:‘0.08em’,textTransform:‘uppercase’,marginTop:2}}>{(h.events||[]).map(e=>EVENT_LABELS[e]||e).join(’ · ‘)}</div>
</div>
<button onClick={()=>del(h.id)} style={{background:‘none’,border:‘1px solid rgba(255,59,59,0.4)’,color:‘var(–red)’,padding:‘4px 8px’,cursor:‘pointer’,fontFamily:‘var(–fd)’,fontSize:‘0.55rem’,letterSpacing:‘0.1em’}}>✕</button>
</div>
))}
</div>
)}
<div style={{background:‘var(–bg-deep)’,border:‘1px solid var(–border)’,padding:‘0.8rem’,display:‘flex’,flexDirection:‘column’,gap:‘0.5rem’}}>
<div style={{fontFamily:‘var(–fd)’,fontSize:‘0.6rem’,letterSpacing:‘0.12em’,textTransform:‘uppercase’,color:‘var(–text-2)’}}>Add Webhook</div>
<input type=“text” value={newName} onChange={e=>setNewName(e.target.value)} placeholder=“Name (e.g. Discord)” maxLength={50}
style={{background:‘var(–bg-raised)’,border:‘1px solid var(–border)’,color:‘var(–text-1)’,fontFamily:‘var(–fm)’,fontSize:‘0.75rem’,padding:‘0.5rem 0.7rem’,outline:‘none’,boxSizing:‘border-box’}}/>
<input type=“text” value={newUrl} onChange={e=>setNewUrl(e.target.value)} placeholder=“https://discord.com/api/webhooks/…” spellCheck={false} autoCorrect=“off” autoCapitalize=“off”
style={{background:‘var(–bg-raised)’,border:‘1px solid var(–border)’,color:‘var(–text-1)’,fontFamily:‘var(–fm)’,fontSize:‘0.72rem’,padding:‘0.5rem 0.7rem’,outline:‘none’,boxSizing:‘border-box’}}/>
<div style={{display:‘flex’,gap:4,flexWrap:‘wrap’}}>
{Object.keys(EVENT_LABELS).map(ev => (
<button key={ev} onClick={()=>toggleEvent(ev)}
style={{padding:‘0.35rem 0.6rem’,background:newEvents.includes(ev)?‘var(–bg-raised)’:‘transparent’,border:`1px solid ${newEvents.includes(ev)?'var(--cyan)':'var(--border)'}`,color:newEvents.includes(ev)?‘var(–cyan)’:‘var(–text-2)’,fontFamily:‘var(–fd)’,fontSize:‘0.55rem’,letterSpacing:‘0.08em’,textTransform:‘uppercase’,cursor:‘pointer’}}>
{EVENT_LABELS[ev]}
</button>
))}
</div>
{err && <div style={{fontSize:‘0.7rem’,color:‘var(–red)’}}>⚠ {err}</div>}
<button onClick={add} disabled={busy || !newUrl.trim() || !newEvents.length}
style={{padding:‘0.55rem’,background:‘var(–amber)’,color:’#000’,border:‘none’,fontFamily:‘var(–fd)’,fontSize:‘0.7rem’,fontWeight:700,letterSpacing:‘0.12em’,textTransform:‘uppercase’,cursor:‘pointer’,opacity:(busy||!newUrl.trim()||!newEvents.length)?0.5:1}}>
{busy?‘ADDING…’:’+ ADD WEBHOOK’}
</button>
</div>
</>
);
}

// ── Worker Detail Modal — NOW WITH CLICKABLE IP LINK ─────────────────────────
function WorkerDetailModal({ worker, onClose, aliases, onAliasesChange, notes, onNotesChange }) {
const [copied, setCopied] = useState(’’);
const [aliasVal, setAliasVal] = useState(aliases[worker.name] || ‘’);
const [noteVal, setNoteVal] = useState(notes[worker.name] || ‘’);
const [dirty, setDirty] = useState(false);

useEffect(() => {
setAliasVal(aliases[worker.name] || ‘’);
setNoteVal(notes[worker.name] || ‘’);
setDirty(false);
}, [worker.name, aliases, notes]);

const w = worker;
const on = w.status !== ‘offline’;
const raw = w.sharesCount || 0;
const rawRej = w.rejectedCount || 0;
const work = w.shares || 0;
const workRej = w.rejected || 0;
const totalWork = work + workRej || 1;
const acceptRate = ((work / totalWork) * 100).toFixed(2);
const rejectRatio = ((workRej / totalWork) * 100).toFixed(3);
const sharesPerMin = w.hashrate > 0 ? (w.hashrate / 4294967296 * 60).toFixed(1) : ‘0’;
const healthMap = { green:‘🟢 GREEN · fresh shares’, amber:‘🟡 AMBER · stale or rejects’, red:‘🔴 RED · offline or failing’ };
const freshness = (() => {
const age = Date.now() - (w.lastSeen || 0);
if (age < 2*60*1000) return ‘fresh (<2m)’;
if (age < 10*60*1000) return `stale (${Math.floor(age/60000)}m)`;
return `offline (${Math.floor(age/60000)}m)`;
})();

const host = typeof window !== ‘undefined’ ? window.location.hostname : ‘umbrel.local’;
const stratumUrl      = `stratum+tcp://${host}:3333`;
const stratumUrlHobby = `stratum+tcp://${host}:3334`;
const minerUrl        = w.ip ? `http://${w.ip}` : null;

const copy = async (val, lbl) => {
try {
await navigator.clipboard.writeText(val);
setCopied(lbl); setTimeout(() => setCopied(’’), 2000);
} catch {
const ta = document.createElement(‘textarea’);
ta.value = val; document.body.appendChild(ta); ta.select();
try { document.execCommand(‘copy’); setCopied(lbl); setTimeout(()=>setCopied(’’),2000); } catch {}
document.body.removeChild(ta);
}
};

const save = () => {
const nextA = { …aliases };
if (!aliasVal.trim()) delete nextA[w.name]; else nextA[w.name] = aliasVal.trim().slice(0, 32);
onAliasesChange(nextA);
const nextN = { …notes };
if (!noteVal.trim()) delete nextN[w.name]; else nextN[w.name] = noteVal.trim().slice(0, 200);
onNotesChange(nextN);
setDirty(false);
};

const exportCsv = () => {
const rows = [
[’# generated_at_utc’, new Date().toISOString()],
[’# worker’, w.name],
[‘field’,‘value’],
[‘hashrate_hps’, w.hashrate || 0],
[‘current_difficulty’, w.diff || 0],
[‘best_share’, Math.round(w.bestshare || 0)],
[‘work_accepted’, work],
[‘work_rejected’, workRej],
[‘ip’, w.ip || ‘’],
];
const csv = rows.map(r => r.map(v => {
const s = String(v == null ? ‘’ : v);
if (/[,”\n\r]/.test(s)) return ‘”’ + s.replace(/”/g,’””’) + ‘”’;
return s;
}).join(’,’)).join(’\n’);
const blob = new Blob([csv], { type: ‘text/csv’ });
const url = URL.createObjectURL(blob);
const a = document.createElement(‘a’);
a.href = url; a.download = `solostrike-worker-${stripAddr(w.name).replace(/[^A-Za-z0-9]/g,'_')}-${Date.now()}.csv`;
document.body.appendChild(a); a.click();
setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
};

const section = { marginBottom:‘1rem’ };
const secTitle = { fontFamily:‘var(–fd)’, fontSize:‘0.55rem’, letterSpacing:‘0.2em’, textTransform:‘uppercase’, color:‘var(–amber)’, marginBottom:‘0.5rem’ };
const kvRow = { display:‘flex’, justifyContent:‘space-between’, alignItems:‘center’, padding:‘0.4rem 0.6rem’, background:‘var(–bg-raised)’, border:‘1px solid var(–border)’, marginBottom:3 };
const kvLabel = { fontFamily:‘var(–fd)’, fontSize:‘0.58rem’, letterSpacing:‘0.1em’, textTransform:‘uppercase’, color:‘var(–text-2)’ };
const kvVal = { fontFamily:‘var(–fm)’, fontSize:‘0.75rem’, color:‘var(–text-1)’, textAlign:‘right’, overflow:‘hidden’, textOverflow:‘ellipsis’, maxWidth:‘65%’ };
const heroBox = { background:‘var(–bg-raised)’, border:‘1px solid var(–border)’, padding:‘0.7rem’, textAlign:‘center’ };
const heroLbl = { fontFamily:‘var(–fd)’, fontSize:‘0.5rem’, letterSpacing:‘0.12em’, textTransform:‘uppercase’, color:‘var(–text-2)’, marginBottom:4 };
const heroVal = { fontFamily:‘var(–fd)’, fontSize:‘1.1rem’, fontWeight:700, color:‘var(–amber)’, lineHeight:1 };
const btn = { padding:‘0.55rem 0.7rem’, background:‘var(–bg-raised)’, border:‘1px solid var(–border)’, color:‘var(–text-1)’, fontFamily:‘var(–fd)’, fontSize:‘0.6rem’, letterSpacing:‘0.1em’, textTransform:‘uppercase’, cursor:‘pointer’, flex:1, minWidth:‘48%’ };
const inputStyle = { width:‘100%’, background:‘var(–bg-deep)’, border:‘1px solid var(–border)’, color:‘var(–text-1)’, fontFamily:‘var(–fm)’, fontSize:‘0.78rem’, padding:‘0.55rem 0.7rem’, outline:‘none’, boxSizing:‘border-box’ };

return (
<div style={{position:‘fixed’,inset:0,background:‘rgba(6,7,8,0.88)’,backdropFilter:‘blur(4px)’,WebkitBackdropFilter:‘blur(4px)’,display:‘flex’,alignItems:‘center’,justifyContent:‘center’,zIndex:250,padding:‘0.75rem’}} onClick={e=>e.target===e.currentTarget&&onClose()}>
<div style={{width:‘100%’,maxWidth:560,background:‘var(–bg-surface)’,border:‘1px solid var(–border-hot)’,boxShadow:‘var(–glow-a)’,maxHeight:‘95vh’,overflowY:‘auto’}}>
<div style={{padding:‘1rem 1.25rem’,borderBottom:‘1px solid var(–border)’,display:‘flex’,alignItems:‘flex-start’,justifyContent:‘space-between’,gap:‘0.75rem’}}>
<div style={{flex:1,minWidth:0}}>
<div style={{display:‘flex’,alignItems:‘center’,gap:‘0.5rem’,marginBottom:4}}>
<span style={{fontSize:16,color:‘var(–cyan)’}}>{w.minerIcon || ‘▪’}</span>
<span style={{fontFamily:‘var(–fd)’,fontSize:‘1.1rem’,fontWeight:700,color:‘var(–amber)’,letterSpacing:‘0.05em’}}>{displayName(w.name, aliases)}</span>
</div>
<div style={{fontFamily:‘var(–fd)’,fontSize:‘0.58rem’,letterSpacing:‘0.12em’,textTransform:‘uppercase’,color:‘var(–text-2)’,marginBottom:6}}>
{w.minerType || ‘Unknown miner’}{w.minerVendor && ` · ${w.minerVendor}`}
</div>
<div style={{display:‘inline-flex’,alignItems:‘center’,gap:5,fontFamily:‘var(–fd)’,fontSize:‘0.58rem’,letterSpacing:‘0.12em’,textTransform:‘uppercase’}}>
<span style={{width:6,height:6,borderRadius:‘50%’,background:on?‘var(–green)’:‘var(–red)’,boxShadow:`0 0 6px ${on?'var(--green)':'var(--red)'}`,animation:on?‘pulse 2s ease-in-out infinite’:‘none’}}/>
<span style={{color:on?‘var(–green)’:‘var(–red)’}}>{on?‘ONLINE’:‘OFFLINE’}</span>
<span style={{color:‘var(–text-3)’,marginLeft:8}}>last share {w.lastSeen?timeAgo(w.lastSeen):’—’}</span>
</div>
</div>
<button onClick={onClose} style={{background:‘none’,border:‘none’,color:‘var(–text-2)’,cursor:‘pointer’,fontSize:22,padding:‘0 4px’,flexShrink:0}}>✕</button>
</div>

```
    <div style={{padding:'1rem 1.25rem'}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem',marginBottom:'1rem'}}>
        <div style={heroBox}><div style={heroLbl}>Hashrate</div><div style={heroVal}>{on?fmtHr(w.hashrate):'offline'}</div></div>
        <div style={heroBox}><div style={heroLbl}>Best Diff</div><div style={heroVal}>{fmtDiff(w.bestshare||0)}</div></div>
        <div style={heroBox}><div style={heroLbl}>Work Done</div><div style={{...heroVal,color:'var(--green)'}}>{fmtDiff(work)}</div></div>
        <div style={heroBox}><div style={heroLbl}>Last Share</div><div style={{...heroVal,color:on?'var(--green)':'var(--text-2)'}}>{w.lastSeen?fmtAgoShort(w.lastSeen):'—'}</div></div>
      </div>

      {/* NEW: Prominent Miner Web UI link if we have an IP */}
      {minerUrl && (
        <div style={{...section, marginBottom:'1.25rem'}}>
          <a href={minerUrl} target="_blank" rel="noopener noreferrer" style={{
            display:'flex', alignItems:'center', gap:'0.7rem',
            padding:'0.8rem 1rem',
            background:'linear-gradient(90deg, rgba(0,255,209,0.1) 0%, rgba(0,255,209,0.02) 100%)',
            border:'1px solid rgba(0,255,209,0.35)',
            textDecoration:'none', cursor:'pointer',
            boxShadow:'0 0 12px rgba(0,255,209,0.08)',
          }}>
            <span style={{fontSize:22, flexShrink:0}}>🌐</span>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--cyan)', marginBottom:2}}>OPEN MINER WEB UI</div>
              <div style={{fontFamily:'var(--fm)', fontSize:'0.82rem', color:'var(--text-1)', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{minerUrl}</div>
            </div>
            <span style={{color:'var(--cyan)', fontSize:16, fontFamily:'var(--fm)', flexShrink:0}}>↗</span>
          </a>
        </div>
      )}

      <div style={section}>
        <div style={secTitle}>▸ Shares</div>
        <div style={kvRow}><span style={kvLabel}>Work Accepted</span><span style={{...kvVal,color:'var(--green)'}}>{fmtDiff(work)}</span></div>
        {workRej > 0 && (
          <>
            <div style={kvRow}><span style={kvLabel}>Work Rejected</span><span style={{...kvVal,color:'var(--red)'}}>{fmtDiff(workRej)}</span></div>
            <div style={kvRow}><span style={kvLabel}>Accept Rate</span><span style={{...kvVal,color:parseFloat(acceptRate)>99.9?'var(--green)':'var(--amber)'}}>{acceptRate}%</span></div>
          </>
        )}
        {raw > 0 && <div style={kvRow}><span style={kvLabel}>Raw Shares</span><span style={kvVal}>{fmtNum(raw)}</span></div>}
        {rawRej > 0 && <div style={kvRow}><span style={kvLabel}>Raw Rejected</span><span style={kvVal}>{fmtNum(rawRej)}</span></div>}
        <div style={kvRow}><span style={kvLabel}>Shares/min (est)</span><span style={{...kvVal,color:'var(--cyan)'}}>{sharesPerMin}</span></div>
      </div>

      <div style={section}>
        <div style={secTitle}>▸ Connection</div>
        <div style={kvRow}><span style={kvLabel}>ASIC Port</span><span style={{...kvVal,fontSize:'0.66rem',color:'var(--cyan)'}}>{stratumUrl}</span></div>
        <div style={kvRow}><span style={kvLabel}>Hobby Port</span><span style={{...kvVal,fontSize:'0.66rem',color:'var(--cyan)'}}>{stratumUrlHobby}</span></div>
        <div style={kvRow}>
          <span style={kvLabel}>Miner IP</span>
          {w.ip ? (
            <a href={`http://${w.ip}`} target="_blank" rel="noopener noreferrer" style={{...kvVal, color:'var(--cyan)', textDecoration:'underline', cursor:'pointer', fontWeight:600}}>
              {w.ip} ↗
            </a>
          ) : (
            <span style={{...kvVal, color:'var(--text-3)'}}>— <span style={{fontSize:'0.6rem'}}>(waiting for auth)</span></span>
          )}
        </div>
        <div style={kvRow}><span style={kvLabel}>Worker User</span><span style={{...kvVal,fontSize:'0.62rem'}} title={w.name}>{w.name.length>32?w.name.slice(0,12)+'…'+w.name.slice(-16):w.name}</span></div>
      </div>

      <div style={section}>
        <div style={secTitle}>▸ Health</div>
        <div style={kvRow}><span style={kvLabel}>Status</span><span style={kvVal}>{healthMap[w.health] || '—'}</span></div>
        {workRej > 0 && <div style={kvRow}><span style={kvLabel}>Reject Ratio</span><span style={{...kvVal,color:parseFloat(rejectRatio)<1?'var(--green)':'var(--amber)'}}>{rejectRatio}%</span></div>}
        <div style={kvRow}><span style={kvLabel}>Share Freshness</span><span style={kvVal}>{freshness}</span></div>
      </div>

      <div style={section}>
        <div style={secTitle}>▸ Options</div>
        <div style={{marginBottom:'0.6rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.58rem',letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:4}}>Display Name</div>
          <input type="text" value={aliasVal} placeholder={stripAddr(w.name)} maxLength={32} onChange={e=>{setAliasVal(e.target.value);setDirty(true);}} style={inputStyle}/>
        </div>
        <div style={{marginBottom:'0.6rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.58rem',letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:4}}>Notes (private)</div>
          <textarea rows={2} value={noteVal} placeholder="e.g. living room, next to router" maxLength={200} onChange={e=>{setNoteVal(e.target.value);setDirty(true);}} style={{...inputStyle,resize:'vertical',minHeight:50}}/>
        </div>
        {dirty && (
          <button onClick={save} style={{width:'100%',padding:'0.6rem',background:'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.7rem',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',cursor:'pointer'}}>Save Changes</button>
        )}
      </div>

      <div style={section}>
        <div style={secTitle}>▸ Actions</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          <button onClick={()=>copy(stratumUrl,'asic')}       style={btn}>{copied==='asic' ?'✓ Copied':'Copy ASIC URL'}</button>
          <button onClick={()=>copy(stratumUrlHobby,'hobby')}  style={btn}>{copied==='hobby'?'✓ Copied':'Copy Hobby URL'}</button>
          {w.ip && <button onClick={()=>copy(w.ip,'ip')}       style={btn}>{copied==='ip'   ?'✓ Copied':'Copy Miner IP'}</button>}
          <button onClick={()=>copy(w.name,'name')}            style={btn}>{copied==='name' ?'✓ Copied':'Copy Workername'}</button>
          <button onClick={exportCsv} style={btn}>⬇ Export CSV</button>
        </div>
      </div>
    </div>
  </div>
</div>
```

);
}

// ── Card order + currency helpers ─────────────────────────────────────────────
const DEFAULT_ORDER = [‘hashrate’, ‘workers’, ‘network’, ‘node’, ‘odds’, ‘luck’, ‘retarget’, ‘shares’, ‘best’, ‘closestcalls’, ‘blocks’, ‘topfinders’, ‘recent’];
function loadOrder() {
try {
const saved = localStorage.getItem(LS_CARD_ORDER);
if (!saved) return DEFAULT_ORDER;
const parsed = JSON.parse(saved);
if (!Array.isArray(parsed)) return DEFAULT_ORDER;
const merged = […parsed];
DEFAULT_ORDER.forEach(k => { if (!merged.includes(k)) merged.push(k); });
return merged.filter(k => DEFAULT_ORDER.includes(k));
} catch { return DEFAULT_ORDER; }
}
function saveOrder(order) { try { localStorage.setItem(LS_CARD_ORDER, JSON.stringify(order)); } catch {} }
function loadCurrency() { try { return localStorage.getItem(LS_CURRENCY) || ‘USD’; } catch { return ‘USD’; } }
function saveCurrency(c) { try { localStorage.setItem(LS_CURRENCY, c); } catch {} }

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
const { state, connected, blockAlert, saveConfig, getConfig } = usePool();
const [showSettings, setShowSettings] = useState(false);
const [settingsCfg, setSettingsCfg] = useState(null);
const [dismissedAlert, setDismissedAlert] = useState(false);
const [order, setOrder] = useState(loadOrder);
const [currency, setCurrency] = useState(loadCurrency);
const [draggedId, setDraggedId] = useState(null);
const [, setDragOverId] = useState(null);
const [aliases, setAliases] = useState(loadAliases);
const [notes, setNotes] = useState(loadNotes);
const [selectedWorker, setSelectedWorker] = useState(null);

const [stripSettings, setStripSettings] = useState(() => ({
enabled: loadStripEnabled(),
metrics: loadStripMetrics(),
chunkSize: loadStripChunk(),
fadeMs: loadStripFade(),
}));
const [tickerSettings, setTickerSettings] = useState(() => ({
enabled: loadTickerEnabled(),
speedSec: loadTickerSpeed(),
metrics: loadTickerMetrics(),
}));
const [minimalMode, setMinimalMode]     = useState(loadMinimalMode);
const [visibleCards, setVisibleCards]   = useState(loadVisibleCards);

const [tickerSnapshot, setTickerSnapshot] = useState(’’);
const [tickerTick, setTickerTick] = useState(0);
useEffect(() => {
const id = setInterval(() => setTickerTick(t => t + 1), 30000);
return () => clearInterval(id);
}, []);

// Stratum port health — polls /api/stratum-health every 30s (v1.5.4+)
const [stratumHealth, setStratumHealth] = useState({ ports: {} });
useEffect(() => {
let cancelled = false;
async function fetchHealth() {
try {
const r = await fetch(’/api/stratum-health’, { cache: ‘no-store’ });
if (!r.ok) return;
const j = await r.json();
if (!cancelled) setStratumHealth(j || { ports: {} });
} catch (_) { /* network blip — keep last known state */ }
}
fetchHealth();
const id = setInterval(fetchHealth, 30000);
return () => { cancelled = true; clearInterval(id); };
}, []);
useEffect(() => {
const hasData = (state.workers || []).length > 0 || (state.network?.height || 0) > 0;
if (!hasData) return;
const selected = (tickerSettings.metrics || []).map(id => METRIC_MAP[id]).filter(Boolean);
if (!selected.length) { setTickerSnapshot(’’); return; }
const items = selected.map(m => {
const out = m.render(state, aliases, currency, state.uptime) || {};
const value = out.value != null ? out.value : ‘—’;
const prefix = out.prefix != null ? out.prefix : m.label.toUpperCase();
return `${prefix} ${value}`;
});
setTickerSnapshot(items.join(’   ·   ’));
}, [state, aliases, currency, tickerSettings.metrics, tickerTick]);

const handleStripSettingsChange = (next) => {
setStripSettings(next);
saveStripEnabled(next.enabled);
saveStripMetrics(next.metrics);
saveStripChunk(next.chunkSize);
saveStripFade(next.fadeMs);
};
const handleTickerSettingsChange = (next) => {
setTickerSettings(next);
saveTickerEnabled(next.enabled);
saveTickerSpeed(next.speedSec);
saveTickerMetrics(next.metrics);
};
const handleMinimalModeChange = (v) => { setMinimalMode(v); saveMinimalMode(v); };
const handleVisibleCardsChange = (list) => { setVisibleCards(list); saveVisibleCards(list); };

useEffect(()=>{ if(blockAlert) setDismissedAlert(false); }, [blockAlert]);

const openSettings = async () => {
try { const c=await getConfig(); setSettingsCfg(c); } catch {}
setShowSettings(true);
};
const handleCurrencyChange = (c) => { setCurrency(c); saveCurrency(c); };
const handleResetLayout = () => { setOrder(DEFAULT_ORDER); saveOrder(DEFAULT_ORDER); };
const handleAliasesChange = (a) => { setAliases(a); saveAliases(a); };
const handleNotesChange = (n) => { setNotes(n); saveNotes(n); };

const onDragStart = (id) => setDraggedId(id);
const onDragOver  = (id) => setDragOverId(id);
const onDrop      = (targetId) => {
if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return; }
const next = […order];
const from = next.indexOf(draggedId);
const to   = next.indexOf(targetId);
if (from < 0 || to < 0) { setDraggedId(null); setDragOverId(null); return; }
next.splice(from, 1); next.splice(to, 0, draggedId);
setOrder(next); saveOrder(next); setDraggedId(null); setDragOverId(null);
};
useEffect(() => {
const endDrag = () => { setDraggedId(null); setDragOverId(null); };
window.addEventListener(‘dragend’, endDrag);
return () => window.removeEventListener(‘dragend’, endDrag);
}, []);

if (state.status===‘loading’) return (
<div style={{minHeight:‘100vh’,display:‘flex’,alignItems:‘center’,justifyContent:‘center’,fontFamily:‘var(–fd)’,fontSize:‘0.75rem’,letterSpacing:‘0.2em’,color:‘var(–text-2)’,textTransform:‘uppercase’,animation:‘pulse 1.5s ease-in-out infinite’}}>
Connecting to pool…
</div>
);
if (state.status===‘no_address’||state.status===‘setup’) {
if (!hasCompletedWizard()) return <OnboardingWizard onComplete={()=>window.location.reload()}/>;
return <SetupScreen onComplete={()=>window.location.reload()}/>;
}

const cards = {
hashrate:     { spanTwo:true,  el:<HashrateChart history={state.hashrate?.history} week={state.hashrate?.week} current={state.hashrate?.current}/> },
workers:      { spanTwo:true,  el:<WorkerGrid workers={state.workers} aliases={aliases} onWorkerClick={setSelectedWorker}/> },
network:      { spanTwo:false, el:<NetworkStats network={state.network} blockReward={state.blockReward} mempool={state.mempool} prices={state.prices} currency={currency} privateMode={state.privateMode}/> },
node:         { spanTwo:false, el:<BitcoinNodePanel nodeInfo={state.nodeInfo}/> },
odds:         { spanTwo:false, el:<OddsDisplay odds={state.odds} hashrate={state.hashrate?.current} netHashrate={state.network?.hashrate}/> },
luck:         { spanTwo:false, el:<LuckGauge luck={state.luck}/> },
retarget:     { spanTwo:false, el:<RetargetPanel retarget={state.retarget}/> },
shares:       { spanTwo:false, el:<ShareStats shares={state.shares} hashrate={state.hashrate?.current} bestshare={state.bestshare}/> },
best:         { spanTwo:false, el:<BestShareLeaderboard workers={state.workers} poolBest={state.bestshare} aliases={aliases}/> },
closestcalls: { spanTwo:false, el:<ClosestCallsPanel closestCalls={state.snapshots?.closestCalls} aliases={aliases}/> },
blocks:       { spanTwo:false, el:<BlockFeed blocks={state.blocks} blockAlert={blockAlert&&!dismissedAlert?blockAlert:null}/> },
topfinders:   { spanTwo:false, el:<TopFindersPanel topFinders={state.topFinders} netBlocks={state.netBlocks}/> },
recent:       { spanTwo:true,  el:<RecentBlocksPanel netBlocks={state.netBlocks}/> },
};

const effectiveVisibleCards = minimalMode ? MINIMAL_PRESET : visibleCards;
const tickerVisible        = !minimalMode && tickerSettings.enabled;
const latestBlockVisible   = !minimalMode;
const customStripVisible   = !minimalMode && stripSettings.enabled;

return (
<>
<div style={{minHeight:‘100vh’,display:‘flex’,flexDirection:‘column’,width:‘100%’,maxWidth:‘100%’,overflowX:‘clip’}}>
<div style={{ position:‘sticky’, top:0, zIndex:50, background:‘rgba(6,7,8,0.92)’, backdropFilter:‘blur(10px)’, WebkitBackdropFilter:‘blur(10px)’, width:‘100%’, maxWidth:‘100%’, boxSizing:‘border-box’, overflow:‘hidden’ }}>
<Header connected={connected} status={state.status} onSettings={openSettings} privateMode={state.privateMode} minimalMode={minimalMode} zmq={state.zmq}/>
<Ticker snapshotText={tickerSnapshot} enabled={tickerVisible} speedSec={tickerSettings.speedSec}/>
{latestBlockVisible && <LatestBlockStrip netBlocks={state.netBlocks} blockReward={state.blockReward}/>}
<CustomizableTopStrip
state={state}
aliases={aliases}
currency={currency}
uptime={state.uptime}
enabled={customStripVisible}
metricIds={stripSettings.metrics}
chunkSize={stripSettings.chunkSize}
fadeMs={stripSettings.fadeMs}
/>
<SyncWarningBanner sync={state.sync}/>
</div>
<main style={{flex:1,padding:‘1rem’,width:‘100%’,maxWidth:‘100%’,boxSizing:‘border-box’,margin:0,overflowX:‘clip’}}>
<div className=“ss-grid” style={{minWidth:0,maxWidth:‘100%’}}>
{order.map(id=>{
if (!effectiveVisibleCards.includes(id)) return null;
const c = cards[id];
if (!c || !c.el) return null;
return (
<DraggableCard key={id} id={id} spanTwo={c.spanTwo} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} draggedId={draggedId}>
{c.el}
</DraggableCard>
);
})}
</div>
</main>
<footer style={{borderTop:‘1px solid var(–border)’,padding:‘0.6rem 1rem’,display:‘flex’,justifyContent:‘space-between’,alignItems:‘center’,fontFamily:‘var(–fd)’,fontSize:‘0.55rem’,color:‘var(–text-3)’,letterSpacing:‘0.08em’,textTransform:‘uppercase’,gap:‘0.5rem’,flexWrap:‘wrap’,width:‘100%’,maxWidth:‘100%’,boxSizing:‘border-box’}}>
<span>SoloStrike v1.5.4 — ckpool-solo{state.privateMode && ’ · 🔒 PRIVATE’}{minimalMode && ’ · MIN’}</span>
<a href=“https://github.com/danhaus93-ops/solostrike-umbrel” target=”_blank” rel=“noopener noreferrer” title=“View source on GitHub” style={{display:‘inline-flex’, alignItems:‘center’, justifyContent:‘center’, color:‘var(–text-2)’, textDecoration:‘none’, padding:‘2px 6px’, lineHeight:1, flexShrink:0}}>
<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
</svg>
</a>
<span>Ports <PortLight health={stratumHealth} port="3333"/> · <PortLight health={stratumHealth} port="3334"/> · 🔒 <PortLight health={stratumHealth} port="4333"/></span>
</footer>
</div>
{showSettings&&<SettingsModal
onClose={()=>setShowSettings(false)}
saveConfig={saveConfig}
currentConfig={settingsCfg}
currency={currency}
onCurrencyChange={handleCurrencyChange}
onResetLayout={handleResetLayout}
workers={state.workers}
aliases={aliases}
onAliasesChange={handleAliasesChange}
stripSettings={stripSettings}
onStripSettingsChange={handleStripSettingsChange}
tickerSettings={tickerSettings}
onTickerSettingsChange={handleTickerSettingsChange}
minimalMode={minimalMode}
onMinimalModeChange={handleMinimalModeChange}
visibleCards={visibleCards}
onVisibleCardsChange={handleVisibleCardsChange}
/>}
{blockAlert&&!dismissedAlert&&<BlockAlert block={blockAlert} onDismiss={()=>setDismissedAlert(true)}/>}
<OfflineToasts workers={state.workers} aliases={aliases}/>
{selectedWorker && (() => {
const live = (state.workers || []).find(w => w.name === selectedWorker.name) || selectedWorker;
return <WorkerDetailModal worker={live} onClose={()=>setSelectedWorker(null)} aliases={aliases} onAliasesChange={handleAliasesChange} notes={notes} onNotesChange={handleNotesChange}/>;
})()}
</>
);
}
