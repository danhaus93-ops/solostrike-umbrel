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
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem'}}>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.1em',textTransform:'uppercase'}}>TOP POOLS</span>
        <span style={{color:'var(--text-3)',fontSize:'0.6rem',fontFamily:'var(--fd)',letterSpacing:'0.08em'}}>LAST {totalSample} BLOCKS</span>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:3}}>
        {list.map((f,i)=>(
          <div key={f.pool} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 7px',border:'1px solid var(--border)',borderRadius:3}}>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontFamily:'var(--fd)',fontSize:'0.65rem',color:'var(--text-3)',letterSpacing:'0.08em',width:24}}>#{i+1}</span>
              <span style={{fontFamily:'var(--fd)',fontSize:'0.75rem',color:'var(--text-1)'}}>{f.pool}</span>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <span style={{color:'var(--text-3)',fontSize:'0.62rem',fontFamily:'var(--fm)'}}>{f.count}</span>
              <span style={{fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--amber)',fontWeight:700,minWidth:42,textAlign:'right'}}>{(f.pct||0).toFixed(1)}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Network card ─────────────────────────────────────────────────────────────
function NetworkCard({ state, fmtHashrate, fmtBestShareCompact }) {
  const n = state.network || {};
  const b = state.bitcoind || {};
  const blockAgo = state.latestBlock?.timestamp ? Math.floor((Date.now() - state.latestBlock.timestamp)/1000) : 0;
  const fmtAgo = (s) => {
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ${s%60}s ago`;
    return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ago`;
  };
  return (
    <div>
      <div style={{fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:'0.5rem'}}>NETWORK</div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem 0.7rem',fontFamily:'var(--fm)',fontSize:'0.72rem'}}>
        <div>
          <div style={{color:'var(--text-3)',fontSize:'0.58rem',letterSpacing:'0.1em',marginBottom:2}}>HASHRATE</div>
          <div style={{color:'var(--amber)',fontWeight:700}}>{fmtHashrate(n.hashrate||0)}</div>
        </div>
        <div>
          <div style={{color:'var(--text-3)',fontSize:'0.58rem',letterSpacing:'0.1em',marginBottom:2}}>DIFFICULTY</div>
          <div style={{color:'var(--text-1)'}}>{fmtBestShareCompact(n.difficulty||0)}</div>
        </div>
        <div>
          <div style={{color:'var(--text-3)',fontSize:'0.58rem',letterSpacing:'0.1em',marginBottom:2}}>HEIGHT</div>
          <div style={{color:'var(--text-1)'}}>{(n.height||0).toLocaleString()}</div>
        </div>
        <div>
          <div style={{color:'var(--text-3)',fontSize:'0.58rem',letterSpacing:'0.1em',marginBottom:2}}>BLOCK AGE</div>
          <div style={{color:'var(--text-1)'}}>{blockAgo > 0 ? fmtAgo(blockAgo) : '—'}</div>
        </div>
        <div style={{gridColumn:'1 / -1',marginTop:4,paddingTop:6,borderTop:'1px solid var(--border)'}}>
          <div style={{color:'var(--text-3)',fontSize:'0.58rem',letterSpacing:'0.1em',marginBottom:2}}>NODE</div>
          <div style={{color:b.synced?'var(--green)':'var(--amber)',fontSize:'0.68rem'}}>{b.synced ? 'SYNCED' : `SYNCING (${((b.progress||0)*100).toFixed(2)}%)`}</div>
        </div>
      </div>
    </div>
  );
}

// ── Snapshots card ───────────────────────────────────────────────────────────
function SnapshotsCard({ state, fmtHashrate }) {
  const snaps = state.snapshots?.daily || [];
  if (!snaps.length) {
    return <div style={{color:'var(--text-3)',padding:'1rem 0',textAlign:'center',fontSize:'0.72rem'}}>No daily snapshots yet. First one rolls at midnight UTC.</div>;
  }
  const maxAvg = Math.max(...snaps.map(s=>s.avg||0), 1);
  return (
    <div>
      <div style={{fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:'0.5rem'}}>DAILY SNAPSHOTS</div>
      <div style={{display:'flex',flexDirection:'column',gap:2}}>
        {snaps.slice(-14).reverse().map(s=>{
          const d = new Date(s.date);
          const label = `${d.getMonth()+1}/${d.getDate()}`;
          const pct = maxAvg > 0 ? (s.avg / maxAvg) * 100 : 0;
          return (
            <div key={s.date} style={{display:'flex',alignItems:'center',gap:6,fontFamily:'var(--fm)',fontSize:'0.65rem'}}>
              <span style={{color:'var(--text-3)',width:36,flexShrink:0}}>{label}</span>
              <div style={{flex:1,height:12,background:'var(--bg-2)',borderRadius:2,overflow:'hidden'}}>
                <div style={{width:`${pct}%`,height:'100%',background:'var(--amber)',opacity:0.7}}/>
              </div>
              <span style={{color:'var(--amber)',fontWeight:700,minWidth:56,textAlign:'right',fontSize:'0.62rem'}}>{fmtHashrate(s.avg||0)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Prices card ──────────────────────────────────────────────────────────────
function PricesCard({ state, currency }) {
  const p = state.prices || {};
  const price = p[currency.toLowerCase()] || 0;
  const symbols = { USD:'$', EUR:'€', GBP:'£', JPY:'¥', CAD:'C$', AUD:'A$' };
  const sym = symbols[currency] || '$';
  if (!price) {
    return <div style={{color:'var(--text-3)',padding:'1rem 0',textAlign:'center',fontSize:'0.72rem'}}>Price feed unavailable.</div>;
  }
  return (
    <div>
      <div style={{fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:'0.5rem'}}>BTC PRICE</div>
      <div style={{fontFamily:'var(--fm)',fontSize:'1.3rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.03em'}}>{sym}{price.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
      <div style={{fontFamily:'var(--fd)',fontSize:'0.62rem',color:'var(--text-3)',letterSpacing:'0.1em',marginTop:2,textTransform:'uppercase'}}>{currency}</div>
    </div>
  );
}

// ── Latest Block strip (full-width) ──────────────────────────────────────────
function LatestBlockStrip({ state }) {
  const lb = state.latestBlock;
  if (!lb) return null;
  const ts = lb.timestamp;
  const ago = (() => {
    const s = Math.floor((Date.now() - ts)/1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    return `${Math.floor(s/3600)}h ago`;
  })();
  const reward = lb.reward != null ? `${lb.reward.toFixed(3)} BTC` : '';
  return (
    <div style={{
      ...STRIP_FULL_WIDTH,
      display:'flex',
      alignItems:'center',
      gap:'clamp(0.6rem, 2.5vw, 1.5rem)',
      padding:'0.45rem 0.9rem',
      background:'linear-gradient(180deg, rgba(245,166,35,0.06) 0%, transparent 100%)',
      borderBottom:'1px solid var(--border)',
      fontFamily:'var(--fd)',
      fontSize:'0.66rem',
      letterSpacing:'0.1em',
      textTransform:'uppercase',
      color:'var(--text-2)',
      flexWrap:'wrap',
    }}>
      <span style={{display:'inline-flex', alignItems:'center', gap:6}}>
        <span style={{display:'inline-block', fontSize:18, color:'#F7931A', filter:'drop-shadow(0 0 6px rgba(247,147,26,0.5))', lineHeight:1}}>
          <span style={{display:'inline-block', transform:'translate(1px, 1px)'}}>₿</span>
        </span>
        <span style={{color:'var(--amber)',fontWeight:700}}>LATEST BLOCK</span>
      </span>
      <span style={{color:'var(--text-3)'}}>·</span>
      <span style={{fontFamily:'var(--fm)',color:'var(--cyan)',fontWeight:700}}>#{(lb.height||0).toLocaleString()}</span>
      <span style={{color:'var(--text-3)'}}>·</span>
      <span>{lb.miner || 'unknown'}</span>
      <span style={{color:'var(--text-3)'}}>·</span>
      <span>{ago}</span>
      {reward && <>
        <span style={{color:'var(--text-3)'}}>·</span>
        <span style={{color:'var(--green)',fontFamily:'var(--fm)',fontWeight:700}}>{reward}</span>
      </>}
    </div>
  );
}

// ── Draggable card wrapper ───────────────────────────────────────────────────
function DraggableCard({ id, spanTwo, onDragStart, onDragOver, onDrop, draggedId, children }) {
  const isDragging = draggedId === id;
  return (
    <div
      draggable
      onDragStart={(e)=>onDragStart(e, id)}
      onDragOver={(e)=>onDragOver(e, id)}
      onDrop={(e)=>onDrop(e, id)}
      style={{
        gridColumn: spanTwo ? 'span 2' : 'auto',
        background:'var(--bg-1)',
        border:'1px solid var(--border)',
        borderRadius:6,
        padding:'0.85rem 1rem',
        opacity:isDragging?0.35:1,
        cursor:'grab',
        transition:'opacity 0.15s, transform 0.15s',
      }}
    >{children}</div>
  );
}

// ── Setup wizard ─────────────────────────────────────────────────────────────
function SetupWizard({ onSubmit }) {
  const [addr,setAddr]=useState(''); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const submit = async () => {
    setError(''); setLoading(true);
    try { await onSubmit(addr.trim()); }
    catch(e){ setError(e.message || String(e)); setLoading(false); }
  };
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'calc(100vh - 120px)',padding:'1rem'}}>
      <div style={{maxWidth:520,width:'100%',background:'var(--bg-1)',border:'1px solid var(--border)',borderRadius:8,padding:'2rem 1.5rem',textAlign:'center'}}>
        <div style={{fontSize:36,color:'var(--amber)',filter:'drop-shadow(0 0 12px rgba(245,166,35,0.6))',marginBottom:8}}>⛏</div>
        <div style={{fontFamily:'var(--fd)',fontSize:'1.2rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:16}}>SOLOSTRIKE</div>
        <p style={{color:'var(--text-2)',fontSize:'0.85rem',marginBottom:14,lineHeight:1.5}}>
          Enter your Bitcoin payout address to begin.
          Every block your fleet finds is sent here — 100% of the reward, no middleman.
        </p>
        <input
          type="text"
          value={addr}
          onChange={e=>setAddr(e.target.value)}
          placeholder="bc1q..."
          style={{width:'100%',background:'var(--bg-2)',color:'var(--text-1)',border:'1px solid var(--border)',padding:'9px 11px',fontFamily:'var(--fm)',fontSize:'0.8rem',borderRadius:4,boxSizing:'border-box',marginBottom:14}}
        />
        {error && <div style={{color:'var(--red)',fontSize:'0.75rem',marginBottom:12}}>{error}</div>}
        <button onClick={submit} disabled={loading||!addr.trim()} style={{background:loading||!addr.trim()?'var(--bg-2)':'var(--amber)',color:loading||!addr.trim()?'var(--text-3)':'var(--bg-0)',border:'none',padding:'10px 22px',fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:700,letterSpacing:'0.1em',cursor:loading||!addr.trim()?'not-allowed':'pointer',borderRadius:4,textTransform:'uppercase',width:'100%'}}>
          {loading ? 'STARTING…' : 'START MINING'}
        </button>
      </div>
    </div>
  );
}

// ── Settings modal ───────────────────────────────────────────────────────────
function SettingsModal({ onClose, saveConfig, currentConfig, currency, onCurrencyChange, onResetLayout, workers, aliases, onAliasesChange, stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange }) {
  const [tab, setTab] = useState('main');
  const [addr,setAddr]=useState('');
  const [poolName,setPoolName]=useState(currentConfig?.poolName||'SoloStrike');
  const [privateMode, setPrivateMode] = useState(!!currentConfig?.privateMode);
  const [loading,setLoading]=useState(false);
  const [saved,setSaved]=useState(false);
  const [error,setError]=useState('');

  useEffect(() => {
    setAddr(currentConfig?.payoutAddress || '');
    setPoolName(currentConfig?.poolName || 'SoloStrike');
    setPrivateMode(!!currentConfig?.privateMode);
  }, [currentConfig]);

  const submit = async () => {
    setError(''); setLoading(true); setSaved(false);
    try {
      await saveConfig({ payoutAddress: addr.trim(), poolName: poolName.trim() || 'SoloStrike', privateMode });
      setSaved(true);
      setTimeout(()=>setSaved(false), 2500);
    } catch(e){ setError(e.message || String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:800,display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-1)',border:'1px solid var(--border)',borderRadius:6,maxWidth:520,width:'100%',maxHeight:'calc(100vh - 40px)',overflowY:'auto',boxShadow:'0 16px 60px rgba(0,0,0,0.8)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'14px 18px',borderBottom:'1px solid var(--border)',position:'sticky',top:0,background:'var(--bg-1)',zIndex:1}}>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.9rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.1em',textTransform:'uppercase'}}>SETTINGS</span>
          <button onClick={onClose} style={{background:'none',border:'1px solid var(--border)',color:'var(--text-2)',padding:'3px 9px',cursor:'pointer',borderRadius:3,fontSize:16,lineHeight:1}}>×</button>
        </div>
        <div style={{display:'flex',gap:1,borderBottom:'1px solid var(--border)',background:'var(--bg-2)'}}>
          {[['main','MAIN'],['display','DISPLAY'],['aliases','ALIASES'],['advanced','ADVANCED']].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{flex:1,background:tab===k?'var(--bg-1)':'transparent',color:tab===k?'var(--amber)':'var(--text-3)',border:'none',borderBottom:tab===k?'2px solid var(--amber)':'2px solid transparent',padding:'8px 6px',fontFamily:'var(--fd)',fontSize:'0.65rem',fontWeight:700,letterSpacing:'0.1em',cursor:'pointer'}}>{l}</button>
          ))}
        </div>
        <div style={{padding:'16px 18px'}}>
          {tab==='main' && <MainTab addr={addr} setAddr={setAddr} poolName={poolName} setPoolName={setPoolName} currency={currency} onCurrencyChange={onCurrencyChange} onResetLayout={onResetLayout} submit={submit} saved={saved} loading={loading}/>}
          {tab==='display' && <DisplayTab stripSettings={stripSettings} onStripSettingsChange={onStripSettingsChange} tickerSettings={tickerSettings} onTickerSettingsChange={onTickerSettingsChange} minimalMode={minimalMode} onMinimalModeChange={onMinimalModeChange} visibleCards={visibleCards} onVisibleCardsChange={onVisibleCardsChange}/>}
          {tab==='aliases' && <AliasesTab workers={workers} aliases={aliases} onAliasesChange={onAliasesChange}/>}
          {tab==='advanced' && <AdvancedTab privateMode={privateMode} setPrivateMode={setPrivateMode} saveConfig={saveConfig} currentConfig={currentConfig}/>}
          {error && <div style={{color:'var(--red)',fontSize:'0.75rem',marginTop:10}}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

function MainTab({addr,setAddr,poolName,setPoolName,currency,onCurrencyChange,onResetLayout,submit,saved,loading}) {
  const [show,setShow]=useState(false);
  return (
    <>
      <Field label="PAYOUT ADDRESS">
        <input type="text" value={addr} onChange={e=>setAddr(e.target.value)} placeholder="bc1q..." style={F.inp}/>
      </Field>
      <Field label="POOL NAME">
        <input type="text" value={poolName} onChange={e=>setPoolName(e.target.value)} style={F.inp}/>
      </Field>
      <Field label="CURRENCY">
        <select value={currency} onChange={e=>onCurrencyChange(e.target.value)} style={F.inp}>
          {['USD','EUR','GBP','JPY','CAD','AUD'].map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <div style={{display:'flex',gap:8,marginTop:12}}>
        <button onClick={submit} disabled={loading} style={{...F.btn, flex:1, background:saved?'var(--green)':'var(--amber)',color:'var(--bg-0)'}}>{loading?'SAVING…':(saved?'SAVED':'SAVE')}</button>
        <button onClick={()=>{if(confirm('Reset card layout to default?'))onResetLayout();}} style={{...F.btn, background:'var(--bg-2)',color:'var(--text-2)',border:'1px solid var(--border)'}}>RESET LAYOUT</button>
      </div>
      {!show && <button onClick={()=>setShow(true)} style={{marginTop:14,background:'none',border:'none',color:'var(--text-3)',fontSize:'0.7rem',cursor:'pointer',fontFamily:'var(--fd)',letterSpacing:'0.08em'}}>SHOW STRATUM URL →</button>}
      {show && <div style={{marginTop:12,padding:10,background:'var(--bg-2)',borderRadius:4,border:'1px solid var(--border)'}}>
        <div style={{color:'var(--text-3)',fontSize:'0.62rem',letterSpacing:'0.1em',marginBottom:4,fontFamily:'var(--fd)'}}>STRATUM URL</div>
        <div style={{color:'var(--cyan)',fontSize:'0.75rem',fontFamily:'var(--fm)',wordBreak:'break-all'}}>stratum+tcp://umbrel.local:3333</div>
        <div style={{color:'var(--text-3)',fontSize:'0.68rem',marginTop:4,fontFamily:'var(--fm)'}}>user: worker_name · pass: x</div>
      </div>}
    </>
  );
}

function DisplayTab({stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange}) {
  return (
    <>
      <Field label="MINIMAL MODE">
        <label style={{display:'flex',alignItems:'center',gap:8,fontSize:'0.75rem',color:'var(--text-2)',cursor:'pointer'}}>
          <input type="checkbox" checked={minimalMode} onChange={e=>onMinimalModeChange(e.target.checked)}/>
          Hide header decorations
        </label>
      </Field>
      <Field label="STAT STRIP">
        <label style={{display:'flex',alignItems:'center',gap:8,fontSize:'0.75rem',color:'var(--text-2)',cursor:'pointer',marginBottom:6}}>
          <input type="checkbox" checked={stripSettings.enabled} onChange={e=>onStripSettingsChange({...stripSettings,enabled:e.target.checked})}/>
          Show metrics rotation
        </label>
      </Field>
      <Field label="TICKER">
        <label style={{display:'flex',alignItems:'center',gap:8,fontSize:'0.75rem',color:'var(--text-2)',cursor:'pointer'}}>
          <input type="checkbox" checked={tickerSettings.enabled} onChange={e=>onTickerSettingsChange({...tickerSettings,enabled:e.target.checked})}/>
          Show scrolling ticker
        </label>
      </Field>
      <Field label="VISIBLE CARDS">
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          {DEFAULT_CARDS.map(c=>(
            <label key={c} style={{display:'flex',alignItems:'center',gap:8,fontSize:'0.72rem',color:'var(--text-2)',cursor:'pointer',textTransform:'uppercase',letterSpacing:'0.08em'}}>
              <input type="checkbox" checked={visibleCards.includes(c)} onChange={e=>{
                if (e.target.checked) onVisibleCardsChange([...visibleCards,c]);
                else onVisibleCardsChange(visibleCards.filter(x=>x!==c));
              }}/>
              {c}
            </label>
          ))}
        </div>
      </Field>
    </>
  );
}

function AliasesTab({workers, aliases, onAliasesChange}) {
  const [localAliases, setLocalAliases] = useState(aliases || {});
  useEffect(()=>setLocalAliases(aliases||{}), [aliases]);
  const setAlias = (name, value) => {
    const next = { ...localAliases };
    if (value && value !== name) next[name] = value;
    else delete next[name];
    setLocalAliases(next);
    onAliasesChange(next);
  };
  const wlist = Array.isArray(workers) ? workers : [];
  if (!wlist.length) return <div style={{color:'var(--text-3)',fontSize:'0.75rem',textAlign:'center',padding:'1rem'}}>No workers connected yet.</div>;
  return (
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {wlist.map(w=>(
        <div key={w.name} style={{display:'flex',gap:8,alignItems:'center'}}>
          <div style={{flex:1,minWidth:0,fontSize:'0.7rem',color:'var(--text-3)',fontFamily:'var(--fm)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{w.name}</div>
          <input type="text" defaultValue={localAliases[w.name]||''} onBlur={e=>setAlias(w.name, e.target.value.trim())} placeholder="(alias)" style={{...F.inp, flex:1}}/>
        </div>
      ))}
    </div>
  );
}

function AdvancedTab({privateMode, setPrivateMode, saveConfig, currentConfig}) {
  const [hooks, setHooks] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newEvents, setNewEvents] = useState(['block_found']);
  const [busy, setBusy] = useState(false);

  useEffect(()=>{
    fetch('/api/webhooks').then(r=>r.json()).then(d=>setHooks(d.hooks||[])).catch(()=>{});
  },[]);

  const savePrivate = async (v) => {
    setPrivateMode(v);
    try { await saveConfig({ ...currentConfig, privateMode: v }); } catch {}
  };

  const addHook = async () => {
    if (!newUrl.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/webhooks', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'add',name:newName.trim()||'webhook',url:newUrl.trim(),events:newEvents})});
      const d = await r.json();
      if (d.hooks) setHooks(d.hooks);
      setNewUrl(''); setNewName('');
    } catch(e){}
    setBusy(false);
  };

  const removeHook = async (id) => {
    try {
      const r = await fetch('/api/webhooks', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'remove',id})});
      const d = await r.json();
      if (d.hooks) setHooks(d.hooks);
    } catch(e){}
  };

  return (
    <>
      <Field label="PRIVATE MODE">
        <label style={{display:'flex',alignItems:'center',gap:8,fontSize:'0.75rem',color:'var(--text-2)',cursor:'pointer'}}>
          <input type="checkbox" checked={privateMode} onChange={e=>savePrivate(e.target.checked)}/>
          Disable all external API calls (airgapped)
        </label>
      </Field>
      <Field label="WEBHOOKS">
        {hooks.length === 0 && <div style={{color:'var(--text-3)',fontSize:'0.72rem',fontStyle:'italic'}}>No webhooks configured.</div>}
        {hooks.map(h=>(
          <div key={h.id} style={{display:'flex',gap:6,alignItems:'center',marginBottom:4,padding:6,background:'var(--bg-2)',borderRadius:3}}>
            <div style={{flex:1,minWidth:0,fontSize:'0.68rem',color:'var(--text-2)',fontFamily:'var(--fm)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.name}: {h.url}</div>
            <button onClick={()=>removeHook(h.id)} style={{...F.btn, padding:'3px 7px', background:'var(--bg-1)',color:'var(--red)',border:'1px solid var(--border)',fontSize:'0.6rem'}}>X</button>
          </div>
        ))}
        <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:6}}>
          <input type="text" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="name" style={F.inp}/>
          <input type="text" value={newUrl} onChange={e=>setNewUrl(e.target.value)} placeholder="https://..." style={F.inp}/>
          <button onClick={addHook} disabled={busy||!newUrl.trim()} style={{...F.btn, background:'var(--amber)',color:'var(--bg-0)'}}>ADD WEBHOOK</button>
        </div>
      </Field>
    </>
  );
}

function Field({label, children}) {
  return <div style={{marginBottom:12}}>
    <div style={{fontFamily:'var(--fd)',fontSize:'0.62rem',color:'var(--text-3)',letterSpacing:'0.1em',marginBottom:5,textTransform:'uppercase'}}>{label}</div>
    {children}
  </div>;
}

const F = {
  inp: {width:'100%',background:'var(--bg-2)',color:'var(--text-1)',border:'1px solid var(--border)',padding:'6px 10px',fontFamily:'var(--fd)',fontSize:'0.75rem',borderRadius:3,boxSizing:'border-box'},
  btn: {padding:'7px 12px',fontFamily:'var(--fd)',fontSize:'0.72rem',fontWeight:700,letterSpacing:'0.08em',cursor:'pointer',borderRadius:3,border:'none',textTransform:'uppercase'}
};

// ── Metric definitions for ticker + strip ────────────────────────────────────
function fmtHashrateG(hps) {
  if (!hps || hps < 0) return '0';
  const units = ['H/s','KH/s','MH/s','GH/s','TH/s','PH/s','EH/s'];
  let r = hps, i = 0;
  while (r >= 1000 && i < units.length - 1) { r /= 1000; i++; }
  return `${r.toFixed(2)} ${units[i]}`;
}
function fmtBestShareCompactG(n) {
  if (!n || n < 0) return '0';
  if (n < 1000) return Math.round(n).toString();
  if (n < 1e6) return (n / 1e3).toFixed(1) + 'K';
  if (n < 1e9) return (n / 1e6).toFixed(1) + 'M';
  if (n < 1e12) return (n / 1e9).toFixed(1) + 'B';
  return (n / 1e12).toFixed(1) + 'T';
}
const METRIC_MAP = {
  hashrate:     { label: 'HR',       render: (s) => ({ value: fmtHashrateG(s.hashrate?.current || 0) }) },
  btcPrice:     { label: 'BTC',      render: (s, _, currency) => {
    const p = s.prices?.[currency.toLowerCase()] || 0;
    const syms = { USD:'$', EUR:'€', GBP:'£', JPY:'¥', CAD:'C$', AUD:'A$' };
    return { value: p ? `${syms[currency]||'$'}${Math.round(p).toLocaleString()}` : '—' };
  }},
  workersActive:{ label: 'ACTIVE',   render: (s) => {
    const active = (s.workers||[]).filter(w => w.hashrate1m > 0).length;
    const total = (s.workers||[]).length;
    return { value: `${active}/${total}` };
  }},
  closestCall:  { label: 'BEST',     render: (s) => ({ value: fmtBestShareCompactG((s.closestCalls||[])[0]?.bestShare || 0) }) },
  pendingBlock: { label: 'SHARES',   render: (s) => {
    const totalShares = (s.workers||[]).reduce((acc, w) => acc + (w.shares||0), 0);
    return { value: totalShares.toLocaleString() };
  }},
  lastBlockAgo: { label: 'BLOCK',    render: (s) => {
    const ts = s.latestBlock?.timestamp;
    if (!ts) return { value: '—' };
    const sec = Math.floor((Date.now() - ts) / 1000);
    if (sec < 60) return { value: `${sec}s` };
    if (sec < 3600) return { value: `${Math.floor(sec/60)}m` };
    return { value: `${Math.floor(sec/3600)}h` };
  }},
  feeRate:      { label: 'FEE',      render: (s) => ({ value: `${(s.mempool?.feeRate||0).toFixed(0)} sat/vB` }) },
  mempool:      { label: 'MEMPOOL',  render: (s) => ({ value: `${((s.mempool?.count||0)/1000).toFixed(1)}K TX` }) },
  uptime:       { label: 'UPTIME',   render: (s, _, __, uptimeSec) => {
    if (!uptimeSec) return { value: '—' };
    const d = Math.floor(uptimeSec/86400);
    const h = Math.floor((uptimeSec%86400)/3600);
    const m = Math.floor((uptimeSec%3600)/60);
    if (d > 0) return { value: `${d}d ${h}h` };
    if (h > 0) return { value: `${h}h ${m}m` };
    return { value: `${m}m` };
  }},
  halving:      { label: 'HALVING',  render: (s) => {
    const height = s.network?.height || 0;
    const next = Math.ceil(height / 210000) * 210000;
    const days = Math.floor((next - height) * 10 / 1440);
    return { value: `${days}D` };
  }},
};

// ── Pool socket hook ─────────────────────────────────────────────────────────
function usePool() {
  const [state, setState]         = useState({});
  const [connected, setConnected] = useState(false);
  const [blockAlert, setBlockAlert] = useState(null);
  const wsRef = useRef(null);
  const reconRef = useRef(0);

  const loadState = useCallback(async () => {
    try {
      const r = await fetch(API_BASE + '/api/state');
      if (r.ok) setState(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    loadState();
    const id = setInterval(loadState, 15000);
    return () => clearInterval(id);
  }, [loadState]);

  useEffect(() => {
    let alive = true;
    const connect = () => {
      if (!alive) return;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        ws.onopen = () => { setConnected(true); reconRef.current = 0; };
        ws.onclose = () => {
          setConnected(false);
          if (!alive) return;
          reconRef.current = Math.min(reconRef.current + 1, 10);
          const delay = Math.min(1000 * Math.pow(1.5, reconRef.current), 30000);
          setTimeout(connect, delay);
        };
        ws.onerror = () => { try { ws.close(); } catch {} };
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'state') setState(msg.data);
            else if (msg.type === 'block_found') setBlockAlert(msg.data);
          } catch {}
        };
      } catch {
        setTimeout(connect, 3000);
      }
    };
    connect();
    return () => { alive = false; try { wsRef.current?.close(); } catch {} };
  }, []);

  const saveConfig = async (cfg) => {
    const r = await fetch(API_BASE + '/api/setup', {
      method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(cfg)
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'save failed');
    await loadState();
  };

  const getConfig = async () => {
    const r = await fetch(API_BASE + '/api/config');
    return await r.json();
  };

  return { state, connected, blockAlert, saveConfig, getConfig };
}

// ── Main App ─────────────────────────────────────────────────────────────────
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

  const [tickerSnapshot, setTickerSnapshot] = useState('');
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
        const r = await fetch('/api/stratum-health', { cache: 'no-store' });
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
    if (!selected.length) { setTickerSnapshot(''); return; }
    const items = selected.map(m => {
      const out = m.render(state, aliases, currency, state.uptime) || {};
      const value = out.value != null ? out.value : '—';
      const prefix = out.prefix != null ? out.prefix : m.label.toUpperCase();
      return `${prefix} ${value}`;
    });
    setTickerSnapshot(items.join('   ·   '));
  }, [state, tickerSettings.metrics, aliases, currency, tickerTick]);

  useEffect(() => { saveOrder(order); }, [order]);
  useEffect(() => { saveCurrency(currency); }, [currency]);
  useEffect(() => { saveAliases(aliases); }, [aliases]);
  useEffect(() => { saveNotes(notes); }, [notes]);
  useEffect(() => { saveStripEnabled(stripSettings.enabled); saveStripMetrics(stripSettings.metrics); saveStripChunk(stripSettings.chunkSize); saveStripFade(stripSettings.fadeMs); }, [stripSettings]);
  useEffect(() => { saveTickerEnabled(tickerSettings.enabled); saveTickerSpeed(tickerSettings.speedSec); saveTickerMetrics(tickerSettings.metrics); }, [tickerSettings]);
  useEffect(() => { saveMinimalMode(minimalMode); }, [minimalMode]);
  useEffect(() => { saveVisibleCards(visibleCards); }, [visibleCards]);

  useEffect(() => {
    if (showSettings) {
      getConfig().then(setSettingsCfg);
    }
  }, [showSettings, getConfig]);

  const effectiveVisibleCards = useMemo(() => {
    const filtered = order.filter(id => visibleCards.includes(id));
    const missing = visibleCards.filter(id => !filtered.includes(id));
    return [...filtered, ...missing];
  }, [order, visibleCards]);

  const onDragStart = (e, id) => { setDraggedId(id); e.dataTransfer.effectAllowed = 'move'; };
  const onDragOver = (e, id) => { e.preventDefault(); setDragOverId(id); };
  const onDrop = (e, targetId) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return; }
    const next = [...order];
    const from = next.indexOf(draggedId);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) { setDraggedId(null); return; }
    next.splice(from, 1);
    next.splice(to, 0, draggedId);
    setOrder(next);
    setDraggedId(null);
  };

  const handleCurrencyChange = (c) => setCurrency(c);
  const handleResetLayout = () => setOrder(DEFAULT_CARDS);
  const handleAliasesChange = (a) => setAliases(a);
  const handleStripSettingsChange = (s) => setStripSettings(s);
  const handleTickerSettingsChange = (s) => setTickerSettings(s);

  const fmtHashrate = useCallback((hps) => {
    if (!hps || hps < 0) return '0 H/s';
    const units = ['H/s','KH/s','MH/s','GH/s','TH/s','PH/s','EH/s'];
    let r = hps, i = 0;
    while (r >= 1000 && i < units.length - 1) { r /= 1000; i++; }
    return `${r.toFixed(2)} ${units[i]}`;
  }, []);

  const fmtBestShareCompact = useCallback((n) => {
    if (!n || n < 0) return '0';
    if (n < 1000) return Math.round(n).toString();
    if (n < 1e6) return (n / 1e3).toFixed(1) + 'K';
    if (n < 1e9) return (n / 1e6).toFixed(1) + 'M';
    if (n < 1e12) return (n / 1e9).toFixed(1) + 'B';
    return (n / 1e12).toFixed(1) + 'T';
  }, []);

  const getStripValues = useCallback((chunk) => {
    return chunk.map(id => {
      const m = METRIC_MAP[id];
      if (!m) return null;
      const out = m.render(state, aliases, currency, state.uptime) || {};
      return { label: m.label, value: out.value != null ? out.value : '—' };
    }).filter(Boolean);
  }, [state, aliases, currency]);

  const needsSetup = state.status === 'no_address' || state.status === 'setup';

  if (needsSetup) {
    return (
      <div className="app">
        <Header connected={connected} status={state.status} onSettings={()=>setShowSettings(true)} privateMode={state.privateMode} minimalMode={minimalMode} zmq={state.zmq}/>
        <SetupWizard onSubmit={async (addr)=>{ await saveConfig({ payoutAddress: addr, poolName: 'SoloStrike' }); }}/>
        {showSettings && <SettingsModal
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
          onMinimalModeChange={setMinimalMode}
          visibleCards={visibleCards}
          onVisibleCardsChange={setVisibleCards}
        />}
      </div>
    );
  }

  const cards = {
    hashrate:  { el: <HashrateCard state={state} fmtHashrate={fmtHashrate}/>, spanTwo: true },
    workers:   { el: <WorkersCard state={state} aliases={aliases} setAliases={setAliases} onSelect={setSelectedWorker} selectedWorker={selectedWorker} onClearSelection={()=>setSelectedWorker(null)} fmtHashrate={fmtHashrate}/>, spanTwo: false },
    blocks:    { el: <BlocksCard state={state} fmtBestShareCompact={fmtBestShareCompact}/>, spanTwo: false },
    finders:   { el: <TopFindersPanel topFinders={state.topFinders} netBlocks={state.netBlocks}/>, spanTwo: false },
    closest:   { el: <ClosestCallsPanel closestCalls={state.closestCalls} aliases={aliases} fmtBestShareCompact={fmtBestShareCompact}/>, spanTwo: false },
    network:   { el: <NetworkCard state={state} fmtHashrate={fmtHashrate} fmtBestShareCompact={fmtBestShareCompact}/>, spanTwo: false },
    snapshots: { el: <SnapshotsCard state={state} fmtHashrate={fmtHashrate}/>, spanTwo: false },
    prices:    { el: <PricesCard state={state} currency={currency}/>, spanTwo: false },
  };

  return (
    <div className="app">
      <ToastSystem blockAlert={blockAlert} workers={state.workers}/>
      {selectedWorker && <WorkerDetailModal workerName={selectedWorker} onClose={()=>setSelectedWorker(null)} state={state} aliases={aliases} setAliases={setAliases} notes={notes} setNotes={setNotes} fmtHashrate={fmtHashrate}/>}
      <Header connected={connected} status={state.status} onSettings={()=>setShowSettings(true)} privateMode={state.privateMode} minimalMode={minimalMode} zmq={state.zmq}/>
      {!minimalMode && <Ticker snapshotText={tickerSnapshot} enabled={tickerSettings.enabled} speedSec={tickerSettings.speedSec}/>}
      {!minimalMode && <StatStrip metrics={stripSettings.metrics} chunkSize={stripSettings.chunkSize} fadeMs={stripSettings.fadeMs} enabled={stripSettings.enabled} getValues={getStripValues}/>}
      {!minimalMode && <LatestBlockStrip state={state}/>}
      <div style={{width:'100%',maxWidth:'100%',overflow:'hidden',display:'flex',flexDirection:'column',minHeight:'calc(100vh - 120px)'}}>
        <main style={{flex:1, padding:'1rem', width:'100%', boxSizing:'border-box'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(2, 1fr)',gap:'0.85rem',alignItems:'start',maxWidth:'100%'}}>
            {effectiveVisibleCards.map(id => {
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
        <footer style={{borderTop:'1px solid var(--border)',padding:'0.6rem 1rem',display:'flex',justifyContent:'space-between',alignItems:'center',fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--text-3)',letterSpacing:'0.08em',textTransform:'uppercase',gap:'0.5rem',flexWrap:'wrap',width:'100%',maxWidth:'100%',boxSizing:'border-box'}}>
          <span>SoloStrike v1.5.4 — ckpool-solo{state.privateMode && ' · 🔒 PRIVATE'}{minimalMode && ' · MIN'}</span>
          <a href="https://github.com/danhaus93-ops/solostrike-umbrel" target="_blank" rel="noopener noreferrer" title="View source on GitHub" style={{display:'inline-flex', alignItems:'center', justifyContent:'center', color:'var(--text-2)', textDecoration:'none', padding:'2px 6px', lineHeight:1, flexShrink:0}}>
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
        onMinimalModeChange={setMinimalMode}
        visibleCards={visibleCards}
        onVisibleCardsChange={setVisibleCards}
      />}
    </div>
  );
}
