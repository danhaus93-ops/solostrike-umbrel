import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { usePool } from './hooks/usePool.js';
import { fmtHr, fmtDiff, fmtNum, fmtUptime, fmtOdds, timeAgo, fmtAgoShort, fmtPct, fmtDurationMs, fmtSats, fmtBtc, fmtFiat, CURRENCIES, blockTimeAgo } from './utils.js';
import { METRICS, METRIC_MAP, METRIC_CATEGORIES, DEFAULT_STRIP_METRICS, DEFAULT_CHUNK_SIZE, DEFAULT_FADE_MS } from './metrics.js';
import OnboardingWizard, { hasCompletedWizard } from './components/OnboardingWizard.jsx';

// ── Style tokens ──────────────────────────────────────────────────────────────
const card = { background:'var(--bg-surface)', border:'1px solid var(--border)', padding:'1.25rem' };
const cardTitle = { fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:'1rem' };
const statRow = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.5rem 0.75rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:'0.35rem' };
const label = { fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };
const HEALTH_COLOR = { green:'var(--green)', amber:'var(--amber)', red:'var(--red)' };

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_CARD_ORDER      = 'ss_card_order_v1';
const LS_CURRENCY        = 'ss_currency_v1';
const LS_ALIASES         = 'ss_worker_aliases_v1';
const LS_NOTES           = 'ss_worker_notes_v1';
const LS_OFFLINE_SEEN    = 'ss_offline_seen_v1';
const LS_STRIP_METRICS   = 'ss_strip_metrics_v1';
const LS_STRIP_CHUNK     = 'ss_strip_chunk_v1';
const LS_STRIP_FADE      = 'ss_strip_fade_v1';
const LS_STRIP_ENABLED   = 'ss_strip_enabled_v1';
const LS_TICKER_ENABLED  = 'ss_ticker_enabled_v1';
const LS_TICKER_SPEED    = 'ss_ticker_speed_v1';
const LS_TICKER_METRICS  = 'ss_ticker_metrics_v1';
const LS_MINIMAL_MODE    = 'ss_minimal_mode_v1';
const LS_VISIBLE_CARDS   = 'ss_visible_cards_v1';

const DEFAULT_TICKER_SPEED = 30;
const DEFAULT_TICKER_METRICS = ['pool_hashrate', 'worker_health', 'accept_rate', 'next_block_prize', 'btc_price', 'time_since_block', 'halving', 'blocks_found_total'];

const ALL_CARDS = [
  { id:'hashrate',      label:'Firepower' },
  { id:'workers',       label:'The Crew' },
  { id:'network',       label:'Bitcoin Network' },
  { id:'node',          label:'Bitcoin Node' },
  { id:'odds',          label:'Strike Odds' },
  { id:'luck',          label:'Hot Streak' },
  { id:'retarget',      label:'Difficulty Retarget' },
  { id:'shares',        label:'Share Stats' },
  { id:'best',          label:'Top Diggers' },
  { id:'closestcalls',  label:'Near Strikes' },
  { id:'blocks',        label:'Gold Strikes' },
  { id:'topfinders',    label:'Claim Jumpers' },
  { id:'recent',        label:'The Goldfields' },
  { id:'pulse',         label:'SoloStrike Pulse' },
];
const ALL_CARD_IDS    = ALL_CARDS.map(c => c.id);
const MINIMAL_PRESET  = ['hashrate', 'workers', 'blocks'];
const DEFAULT_PRESET  = ['hashrate', 'workers', 'network', 'shares', 'best', 'closestcalls', 'blocks'];
const EVERYTHING_PRESET = [...ALL_CARD_IDS];

function loadAliases() { try { const s = localStorage.getItem(LS_ALIASES); return s ? JSON.parse(s) : {}; } catch { return {}; } }
function saveAliases(a) { try { localStorage.setItem(LS_ALIASES, JSON.stringify(a)); } catch {} }
function loadNotes()   { try { const s = localStorage.getItem(LS_NOTES); return s ? JSON.parse(s) : {}; } catch { return {}; } }
function saveNotes(n)  { try { localStorage.setItem(LS_NOTES, JSON.stringify(n)); } catch {} }

function loadStripMetrics() { try { const s = localStorage.getItem(LS_STRIP_METRICS); if (!s) return DEFAULT_STRIP_METRICS; const p = JSON.parse(s); return Array.isArray(p) ? p.filter(id => METRIC_MAP[id]) : DEFAULT_STRIP_METRICS; } catch { return DEFAULT_STRIP_METRICS; } }
function saveStripMetrics(list) { try { localStorage.setItem(LS_STRIP_METRICS, JSON.stringify(list)); } catch {} }
function loadStripChunk()    { try { const n = parseInt(localStorage.getItem(LS_STRIP_CHUNK), 10); return Number.isFinite(n) && n>=1 && n<=8 ? n : DEFAULT_CHUNK_SIZE; } catch { return DEFAULT_CHUNK_SIZE; } }
function saveStripChunk(n)   { try { localStorage.setItem(LS_STRIP_CHUNK, String(n)); } catch {} }
function loadStripFade()     { try { const n = parseInt(localStorage.getItem(LS_STRIP_FADE), 10); return Number.isFinite(n) && n>=1000 && n<=20000 ? n : DEFAULT_FADE_MS; } catch { return DEFAULT_FADE_MS; } }
function saveStripFade(n)    { try { localStorage.setItem(LS_STRIP_FADE, String(n)); } catch {} }
function loadStripEnabled()  { try { const v = localStorage.getItem(LS_STRIP_ENABLED); return v === null ? true : v === 'true'; } catch { return true; } }
function saveStripEnabled(v) { try { localStorage.setItem(LS_STRIP_ENABLED, String(!!v)); } catch {} }
function loadTickerEnabled() { try { const v = localStorage.getItem(LS_TICKER_ENABLED); return v === null ? true : v === 'true'; } catch { return true; } }
function saveTickerEnabled(v){ try { localStorage.setItem(LS_TICKER_ENABLED, String(!!v)); } catch {} }
function loadTickerSpeed()   { try { const n = parseInt(localStorage.getItem(LS_TICKER_SPEED), 10); return Number.isFinite(n) && n>=3 && n<=120 ? n : DEFAULT_TICKER_SPEED; } catch { return DEFAULT_TICKER_SPEED; } }
function saveTickerSpeed(n)  { try { localStorage.setItem(LS_TICKER_SPEED, String(n)); } catch {} }
function loadTickerMetrics() { try { const s = localStorage.getItem(LS_TICKER_METRICS); if (!s) return DEFAULT_TICKER_METRICS; const p = JSON.parse(s); return Array.isArray(p) ? p.filter(id => METRIC_MAP[id]) : DEFAULT_TICKER_METRICS; } catch { return DEFAULT_TICKER_METRICS; } }
function saveTickerMetrics(list) { try { localStorage.setItem(LS_TICKER_METRICS, JSON.stringify(list)); } catch {} }
function loadMinimalMode()   { try { const v = localStorage.getItem(LS_MINIMAL_MODE); return v === 'true'; } catch { return false; } }
function saveMinimalMode(v)  { try { localStorage.setItem(LS_MINIMAL_MODE, String(!!v)); } catch {} }
function loadVisibleCards()  { try { const s = localStorage.getItem(LS_VISIBLE_CARDS); if (!s) return EVERYTHING_PRESET; const p = JSON.parse(s); return Array.isArray(p) ? p.filter(id => ALL_CARD_IDS.includes(id)) : EVERYTHING_PRESET; } catch { return EVERYTHING_PRESET; } }
function saveVisibleCards(list) { try { localStorage.setItem(LS_VISIBLE_CARDS, JSON.stringify(list)); } catch {} }

function stripAddr(fullName) {
  if (!fullName || typeof fullName !== 'string') return fullName || '';
  const dot = fullName.indexOf('.');
  if (dot === -1) return fullName;
  return fullName.slice(dot + 1);
}
function displayName(fullName, aliases) {
  if (!fullName) return '';
  if (aliases && aliases[fullName]) return aliases[fullName];
  return stripAddr(fullName);
}

function fmtBytes(bytes) {
  if (!bytes) return '—';
  const mb = bytes / 1_000_000;
  if (mb < 1) return `${(bytes/1000).toFixed(0)} KB`;
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb/1000).toFixed(2)} GB`;
}
function parseClient(subversion) {
  if (!subversion) return { name:'—', version:'' };
  const m = subversion.match(/\/([^:]+):([^/]+)\//);
  if (!m) return { name:subversion, version:'' };
  return { name: m[1] === 'Satoshi' ? 'Bitcoin Core' : m[1], version: m[2] };
}

const BTC_ADDR_RE = /^(bc1[a-z0-9]{6,87}|tb1[a-z0-9]{6,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
function isValidBtcAddress(a){ if(!a||typeof a!=='string')return false; const t=a.trim(); return t.length>=26&&t.length<=90&&BTC_ADDR_RE.test(t); }

const STRIP_FULL_WIDTH = { width:'100%', boxSizing:'border-box', maxWidth:'100%', minWidth:0 };

// ── DraggableCard ─────────────────────────────────────────────────────────────
function DraggableCard({ id, onDragStart, onDragOver, onDrop, draggedId, children, spanTwo }) {
  const classes = ['ss-card', spanTwo?'ss-span-2':'', draggedId===id?'ss-dragging':''].filter(Boolean).join(' ');
  return (
    <div className={classes}
      onDragOver={e=>{e.preventDefault(); onDragOver(id);}}
      onDrop={e=>{e.preventDefault(); onDrop(id);}}
    >
      <span className="ss-drag-handle" draggable
        style={{color:'var(--amber)'}}
        onDragStart={e=>{ e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain', id);}catch{} onDragStart(id); }}
        title="Drag to reorder">≡</span>
      {children}
    </div>
  );
}

// ── Live clock hook ───────────────────────────────────────────────────────────
function useNow(refreshMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);
  return now;
}
function fmtClockTime(d) {
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2,'0')} ${ampm}`;
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
  const trackRef = useRef(null);
  const stateRef = useRef({ x: 0, halfWidth: 0, lastT: null, rafId: null });
  const duration = speedSec || DEFAULT_TICKER_SPEED;

  useEffect(() => {
    if (!enabled || !snapshotText) return;
    const track = trackRef.current;
    if (!track) return;

    const measure = () => {
      stateRef.current.halfWidth = track.scrollWidth / 2;
    };
    measure();
    window.addEventListener('resize', measure);

    const step = (t) => {
      const s = stateRef.current;
      if (s.halfWidth <= 0) { s.rafId = requestAnimationFrame(step); return; }
      if (s.lastT == null) s.lastT = t;
      const dt = (t - s.lastT) / 1000;
      s.lastT = t;
      const pxPerSec = s.halfWidth / duration;
      s.x -= pxPerSec * dt;
      while (s.x <= -s.halfWidth) s.x += s.halfWidth;
      track.style.transform = `translate3d(${s.x.toFixed(2)}px, 0, 0)`;
      s.rafId = requestAnimationFrame(step);
    };
    stateRef.current.rafId = requestAnimationFrame(step);

    return () => {
      window.removeEventListener('resize', measure);
      if (stateRef.current.rafId) cancelAnimationFrame(stateRef.current.rafId);
      stateRef.current.lastT = null;
    };
  }, [enabled, snapshotText, duration]);

  if (!enabled || !snapshotText) return null;

  return (
    <div style={{
      width:'100%', boxSizing:'border-box', maxWidth:'100%', minWidth:0,
      background:'var(--bg-deep)',
      borderBottom:'1px solid var(--border)',
      overflow:'hidden',
      height:26,
      display:'flex',
      alignItems:'center',
    }}>
      <div ref={trackRef} style={{
        whiteSpace:'nowrap',
        fontFamily:'var(--fd)',
        fontSize:'0.55rem',
        letterSpacing:'0.15em',
        color:'var(--text-2)',
        textTransform:'uppercase',
        display:'inline-block',
        flexShrink:0,
        willChange:'transform',
        transform:'translate3d(0,0,0)',
      }}>
        {snapshotText}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{snapshotText}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      </div>
    </div>
  );
});

// ── Latest Block strip ────────────────────────────────────────────────────────
function LatestBlockStrip({ netBlocks, blockReward }) {
  const latest = netBlocks?.[0];
  if (!latest) return null;
  const rewardBtc = latest.reward != null ? (latest.reward / 1e8) : blockReward?.totalBtc;
  return (
    <div className="ss-hide-scrollbar" style={{
      ...STRIP_FULL_WIDTH,
      background:'linear-gradient(90deg, rgba(245,166,35,0.06) 0%, rgba(6,7,8,0.95) 60%)',
      borderBottom:'1px solid var(--border)',
      padding:'0.55rem 1rem',
      display:'flex', alignItems:'center', gap:'0.75rem',
      fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.08em',
      textTransform:'uppercase',
      overflowX:'auto', whiteSpace:'nowrap',
    }}>
      <span style={{display:'inline-flex', alignItems:'center', gap:6, flexShrink:0}}>
        <span style={{
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          width:20, height:20, borderRadius:'50%',
          background:'#000', color:'var(--btc-orange)',
          fontWeight:700, fontSize:'0.8rem', lineHeight:1,
          border:'1px solid var(--btc-orange)',
          boxShadow:'0 0 8px var(--btc-orange-glow)',
          flexShrink:0,
        }}>
          <span style={{transform:'translate(0.5px, 0.5px)', display:'inline-block'}}>₿</span>
        </span>
        <span style={{color:'var(--amber)', fontWeight:700}}>LATEST BLOCK</span>
      </span>
      <span style={{color:'var(--text-2)', flexShrink:0}}>·</span>
      <span style={{color:'var(--cyan)', fontFamily:'var(--fm)', fontWeight:700, flexShrink:0}}>#{fmtNum(latest.height)}</span>
      <span style={{color:'var(--text-2)', flexShrink:0}}>·</span>
      <span style={{color: latest.isSolo?'var(--amber)':'var(--text-1)', fontWeight:600, flexShrink:0}}>
        {latest.pool}{latest.isSolo && <span style={{marginLeft:6, fontSize:'0.52rem', border:'1px solid var(--amber)', padding:'1px 4px'}}>SOLO</span>}
      </span>
      <span style={{color:'var(--text-2)', flexShrink:0}}>·</span>
      <span style={{color:'var(--text-1)', fontFamily:'var(--fm)', flexShrink:0}}>{blockTimeAgo(latest.timestamp)}</span>
      {rewardBtc && (<>
        <span style={{color:'var(--text-2)', flexShrink:0}}>·</span>
        <span style={{color:'var(--green)', fontFamily:'var(--fm)', flexShrink:0}}>{rewardBtc.toFixed(3)} BTC</span>
      </>)}
      <a href={`https://mempool.space/block/${latest.id}`} target="_blank" rel="noopener noreferrer" style={{marginLeft:'auto', color:'var(--text-2)', fontSize:13, fontFamily:'var(--fm)', flexShrink:0}}>↗</a>
    </div>
  );
}

// ── Customizable Top Strip ────────────────────────────────────────────────────
function CustomizableTopStrip({ state, aliases, currency, uptime, enabled, metricIds, chunkSize, fadeMs }) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  const validMetrics = useMemo(
    () => (metricIds || []).map(id => METRIC_MAP[id]).filter(Boolean),
    [metricIds]
  );

  const groups = useMemo(() => {
    if (!validMetrics.length) return [];
    const cs = Math.max(1, Math.min(chunkSize || 1, validMetrics.length));
    if (cs >= validMetrics.length) return [validMetrics];
    const out = [];
    for (let i = 0; i < validMetrics.length; i += cs) out.push(validMetrics.slice(i, i + cs));
    return out;
  }, [validMetrics, chunkSize]);

  useEffect(() => {
    if (groups.length <= 1) return;
    const fadeDuration = 400;
    const holdDuration = Math.max(1000, (fadeMs || DEFAULT_FADE_MS) - fadeDuration * 2);
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % groups.length);
        setVisible(true);
      }, fadeDuration);
    }, holdDuration + fadeDuration);
    return () => clearInterval(id);
  }, [groups.length, fadeMs]);

  if (!enabled || !groups.length) return null;
  const currentGroup = groups[Math.min(idx, groups.length - 1)] || groups[0];

  return (
    <div className="ss-hide-scrollbar" style={{
      ...STRIP_FULL_WIDTH,
      background:'linear-gradient(90deg, rgba(0,255,209,0.04) 0%, rgba(6,7,8,0.95) 60%)',
      borderBottom:'1px solid var(--border)',
      padding:'0.5rem 1rem',
      display:'flex', alignItems:'center', gap:'0.75rem',
      fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.08em',
      textTransform:'uppercase',
      minHeight:32,
      overflow:'hidden', whiteSpace:'nowrap',
    }}>
      <div style={{
        display:'flex', alignItems:'center', gap:'0.9rem',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-3px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
        minWidth:0,
        flex:1,
        overflowX:'auto',
      }} className="ss-hide-scrollbar">
        {currentGroup.map((m, i) => {
          const out = m.render(state, aliases, currency, uptime) || {};
          const value = out.value != null ? out.value : '—';
          const prefix = out.prefix != null ? out.prefix : m.label.toUpperCase();
          return (
            <React.Fragment key={m.id}>
              {i > 0 && <span style={{color:'var(--text-3)'}}>·</span>}
              <span style={{display:'inline-flex', gap:6, alignItems:'baseline', flexShrink:0}}>
                <span style={{color:'var(--text-2)'}}>{prefix}</span>
                <span style={{color:m.color || 'var(--text-1)', fontFamily:'var(--fm)', textTransform:'none', letterSpacing:0, fontWeight:600}}>
                  {value}
                </span>
              </span>
            </React.Fragment>
          );
        })}
      </div>
      {groups.length > 1 && (
        <div style={{display:'flex', gap:3, flexShrink:0}}>
          {groups.map((_, i) => (
            <span key={i} style={{
              width:4, height:4, borderRadius:'50%',
              background: i === idx ? 'var(--amber)' : 'var(--text-3)',
              transition:'background 0.3s',
            }}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Sync warning banner ───────────────────────────────────────────────────────
function SyncWarningBanner({ sync }) {
  if (!sync?.warn) return null;
  const pct = (sync.progress || 0) * 100;
  const behind = Math.max(0, (sync.headers || 0) - (sync.blocks || 0));
  return (
    <div className="ss-hide-scrollbar" style={{
      ...STRIP_FULL_WIDTH,
      background:'linear-gradient(90deg, rgba(255,59,59,0.14) 0%, rgba(6,7,8,0.95) 70%)',
      borderBottom:'1px solid rgba(255,59,59,0.35)',
      padding:'0.55rem 1rem',
      display:'flex', alignItems:'center', gap:'0.75rem',
      fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.1em',
      textTransform:'uppercase', color:'var(--red)',
      boxShadow:'inset 0 -1px 0 rgba(255,59,59,0.2)',
      overflowX:'auto', whiteSpace:'nowrap',
    }}>
      <span style={{fontWeight:700, animation:'pulse 2s ease-in-out infinite', flexShrink:0}}>⚠ BITCOIN CORE SYNCING</span>
      <span style={{color:'var(--text-2)', flexShrink:0}}>·</span>
      <span style={{color:'var(--text-1)', fontFamily:'var(--fm)', flexShrink:0}}>{pct.toFixed(2)}% verified</span>
      {behind > 0 && <>
        <span style={{color:'var(--text-2)', flexShrink:0}}>·</span>
        <span style={{color:'var(--text-1)', fontFamily:'var(--fm)', flexShrink:0}}>{fmtNum(behind)} blocks behind</span>
      </>}
      <span style={{color:'var(--text-3)', marginLeft:'auto', fontSize:'0.55rem', flexShrink:0}}>Mined blocks may be stale</span>
    </div>
  );
}

// ── Offline toast ─────────────────────────────────────────────────────────────
function OfflineToasts({ workers, aliases }) {
  const [toasts, setToasts] = useState([]);
  const prevRef = useRef({});
  useEffect(() => {
    let seen = {};
    try { seen = JSON.parse(sessionStorage.getItem(LS_OFFLINE_SEEN) || '{}'); } catch {}
    const newToasts = [];
    (workers || []).forEach(w => {
      const prevStatus = prevRef.current[w.name];
      if (prevStatus && prevStatus !== 'offline' && w.status === 'offline' && !seen[w.name + ':' + w.lastSeen]) {
        newToasts.push({ id:`${w.name}-${w.lastSeen}`, name:w.name, displayName:displayName(w.name, aliases), lastSeen:w.lastSeen, minerType:w.minerType });
        seen[w.name + ':' + w.lastSeen] = Date.now();
      }
      prevRef.current[w.name] = w.status;
    });
    try { sessionStorage.setItem(LS_OFFLINE_SEEN, JSON.stringify(seen)); } catch {}
    if (newToasts.length) setToasts(t => [...t, ...newToasts]);
  }, [workers, aliases]);
  const dismiss = (id) => setToasts(t => t.filter(x => x.id !== id));
  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map(t => setTimeout(() => dismiss(t.id), 12000));
    return () => timers.forEach(clearTimeout);
  }, [toasts]);
  if (!toasts.length) return null;
  return (
    <div style={{position:'fixed', right:12, bottom:12, display:'flex', flexDirection:'column', gap:8, zIndex:400, maxWidth:340, pointerEvents:'none'}}>
      {toasts.map(t => (
        <div key={t.id} onClick={()=>dismiss(t.id)} style={{
          pointerEvents:'auto', cursor:'pointer',
          background:'var(--bg-elevated, #1a1b1e)', border:'1px solid var(--amber)',
          padding:'0.7rem 0.9rem', boxShadow:'0 6px 24px rgba(245,166,35,0.15), 0 0 18px rgba(245,166,35,0.2)',
          animation:'fadeIn 0.3s ease',
        }}>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.15em', color:'var(--amber)', textTransform:'uppercase', marginBottom:4}}>⚠ WORKER OFFLINE</div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.82rem', color:'var(--text-1)', fontWeight:600}}>
            {t.displayName}
            {t.minerType && <span style={{fontFamily:'var(--fd)',fontSize:'0.54rem',color:'var(--text-3)',marginLeft:8,letterSpacing:'0.1em',textTransform:'uppercase'}}>{t.minerType}</span>}
          </div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-2)', marginTop:2}}>Last share {timeAgo(t.lastSeen)} · tap to dismiss</div>
        </div>
      ))}
    </div>
  );
}

// ── Hashrate chart ────────────────────────────────────────────────────────────
function HashrateChart({ history, week, current }) {
  const [range, setRange] = useState('1h');

  const windowMs = { '1h': 60*60*1000, '6h': 6*60*60*1000, '24h': 24*60*60*1000, '7d': 7*24*60*60*1000 }[range];
  const source = range === '7d' ? (week || []) : (history || []);
  const cutoff = Date.now() - windowMs;
  const filtered = source.filter(p => p && p.ts >= cutoff);

  const smoothWindow = { '1h': 3, '6h': 5, '24h': 10, '7d': 30 }[range];
  const smoothed = filtered.map((p, i) => {
    const start = Math.max(0, i - smoothWindow + 1);
    const slice = filtered.slice(start, i + 1);
    const avg = slice.reduce((s, x) => s + (x.hr || 0), 0) / slice.length;
    return { ts: p.ts, hr: avg };
  });

  const data = smoothed;
  const peak = useMemo(() => Math.max(current || 0, ...data.map(p => p.hr || 0)), [data, current]);
  const [p0, p1] = fmtHr(current).split(' ');

  const rangeBtn = (key, label) => (
    <button key={key} onClick={() => setRange(key)}
      style={{
        padding:'4px 10px', minWidth:38,
        background: range === key ? 'var(--bg-raised)' : 'transparent',
        border: `1px solid ${range === key ? 'var(--border-hot)' : 'var(--border)'}`,
        color: range === key ? 'var(--amber)' : 'var(--text-2)',
        fontFamily:'var(--fd)', fontSize:'0.58rem', fontWeight:600,
        letterSpacing:'0.08em', textTransform:'uppercase', cursor:'pointer',
      }}>
      {label}
    </button>
  );

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)'}}>
        <span>▸ Firepower — Live</span>
        {peak > 0 && <span style={{color:'var(--amber-dim, #b37a1a)', fontFamily:'var(--fm)', fontSize:'0.6rem', letterSpacing:'0.08em', marginRight:'14px', whiteSpace:'nowrap'}}>PEAK {fmtHr(peak)}</span>}
      </div>
      <div style={{ fontFamily:'var(--fd)', fontSize:'2.6rem', fontWeight:700, color:'var(--amber)', letterSpacing:'0.01em', lineHeight:1, textShadow:'0 0 30px rgba(245,166,35,0.35)', marginBottom:'0.8rem' }}>
        {p0}<span style={{ fontSize:'1rem', color:'var(--amber-dim)', marginLeft:4 }}>{p1}</span>
      </div>
      <div style={{display:'flex', gap:4, marginBottom:'0.6rem', justifyContent:'flex-end'}}>
        {rangeBtn('1h', '1H')}
        {rangeBtn('6h', '6H')}
        {rangeBtn('24h', '24H')}
        {rangeBtn('7d', '7D')}
      </div>
      <div style={{width:'100%', maxWidth:'100%', overflow:'hidden', minWidth:0}}>
        <ResponsiveContainer width="100%" height={140}>
          <AreaChart data={data} margin={{top:18, right:22, left:8, bottom:4}}>
            <defs>
              <linearGradient id="hrG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#F5A623" stopOpacity={0.28}/>
                <stop offset="95%" stopColor="#F5A623" stopOpacity={0.02}/>
              </linearGradient>
            </defs>
            <XAxis hide dataKey="ts"/>
            <YAxis hide domain={[0, (dataMax)=>Math.max(dataMax, peak)*1.15]}/>
            <Tooltip content={({active,payload})=>{
              if(!active||!payload?.length) return null;
              const p = payload[0].payload;
              return (
                <div style={{background:'var(--bg-elevated, #1a1b1e)',border:'1px solid var(--border-hot, rgba(245,166,35,0.4))',padding:'5px 10px',fontSize:'0.7rem',fontFamily:'var(--fm)'}}>
                  <div style={{color:'var(--amber)',fontWeight:600}}>{fmtHr(p.hr)}</div>
                  <div style={{color:'var(--text-2)',fontSize:'0.6rem',marginTop:2}}>{timeAgo(p.ts)}</div>
                </div>
              );
            }}/>
            <Area type="monotone" dataKey="hr" stroke="#F5A623" strokeWidth={2} fill="url(#hrG)" dot={false} isAnimationActive={false}/>
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ── Worker grid ───────────────────────────────────────────────────────────────
function WorkerGrid({ workers, aliases, onWorkerClick }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const sorted = [...(workers||[])].sort(
    (a,b)=>(a.status==='offline'?1:-1)-(b.status==='offline'?1:-1)||(b.hashrate||0)-(a.hashrate||0)
  );
  const filtered = q
    ? sorted.filter(w =>
        (w.name||'').toLowerCase().includes(q) ||
        (stripAddr(w.name)||'').toLowerCase().includes(q) ||
        (displayName(w.name, aliases)||'').toLowerCase().includes(q) ||
        (w.minerType||'').toLowerCase().includes(q)
      )
    : sorted;
  const online = sorted.filter(w=>w.status!=='offline').length;

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)'}}>
        <span>▸ The Crew</span>
        <span style={{color:'var(--amber)', marginRight:'14px', whiteSpace:'nowrap'}}>{online}/{sorted.length} online</span>
      </div>
      {sorted.length > 3 && (
        <div style={{position:'relative', marginBottom:'0.5rem'}}>
          <span style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', fontSize:12, color:'var(--text-2)', pointerEvents:'none'}}>🔍</span>
          <input type="text" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Filter workers by name or miner type…"
            spellCheck={false} autoCorrect="off" autoCapitalize="off"
            style={{width:'100%',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.75rem',padding:'0.5rem 0.6rem 0.5rem 2rem',outline:'none',boxSizing:'border-box'}}/>
          {query && <button onClick={()=>setQuery('')} style={{position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'var(--text-2)', cursor:'pointer', fontSize:14, padding:'4px 6px'}}>✕</button>}
        </div>
      )}
      {filtered.length === 0 ? (
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)',lineHeight:2}}>
          {q ? <>No workers match "<span style={{color:'var(--amber)'}}>{query}</span>"</>
             : <>No miners connected yet.<br/><span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--cyan)'}}>stratum+tcp://umbrel.local:3333</span><br/><span style={{color:'var(--text-3)',fontSize:'0.65rem'}}>user: worker_name · pass: x</span></>}
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem'}}>
          {filtered.map(w=>{
            const on=w.status!=='offline';
            const workAccepted = w.shares || 0;
            const workRejected = w.rejected || 0;
            const totalWork = workAccepted + workRejected || 1;
            const healthC = HEALTH_COLOR[w.health] || 'var(--text-3)';
            const icon = w.minerIcon || '▪';
            const disp = displayName(w.name, aliases);
            const lastShareAgo = w.lastSeen ? fmtAgoShort(w.lastSeen) : '—';
            return(
              <div key={w.name} onClick={()=>onWorkerClick&&onWorkerClick(w)} style={{display:'flex',alignItems:'center',gap:'0.6rem',padding:'0.6rem 0.875rem',background:'var(--bg-raised)',border:`1px solid ${on?'rgba(57,255,106,0.12)':'transparent'}`,opacity:on?1:0.45,cursor:'pointer',transition:'background 0.15s', minWidth:0, overflow:'hidden'}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--bg-elevated, #1a1b1e)'} onMouseLeave={e=>e.currentTarget.style.background='var(--bg-raised)'}>
                <div title={w.health||'unknown'} style={{width:8,height:8,borderRadius:'50%',flexShrink:0,background:on?healthC:'var(--text-3)',boxShadow:on?`0 0 6px ${healthC}`:'none',animation:on?'pulse 2s ease-in-out infinite':'none'}}/>
                <span title={w.minerType||'Unknown'} style={{fontSize:13,color:on?'var(--cyan)':'var(--text-3)',width:16,textAlign:'center',flexShrink:0}}>{icon}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.82rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500}} title={w.name}>
                    {disp}
                    {w.minerType && <span style={{fontFamily:'var(--fd)',fontSize:'0.54rem',letterSpacing:'0.1em',color:'var(--text-3)',marginLeft:8,textTransform:'uppercase'}}>{w.minerType}</span>}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center',marginTop:3}}>
                    <div style={{flex:1,height:2,background:'var(--bg-deep)',borderRadius:1,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${(workAccepted/totalWork)*100}%`,background:'var(--green)',borderRadius:1}}/>
                    </div>
                    <span style={{fontFamily:'var(--fm)',fontSize:'0.55rem',color:'var(--text-3)',whiteSpace:'nowrap'}}>last {lastShareAgo}</span>
                    {w.diff>0 && <span style={{fontFamily:'var(--fm)',fontSize:'0.55rem',color:'var(--text-3)',whiteSpace:'nowrap'}}>diff {fmtDiff(w.diff)}</span>}
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1, flexShrink:0}}>
                  <span style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-2)'}}>
                    <span style={{color:'var(--green)'}}>{fmtDiff(workAccepted)}</span>{workRejected>0 && <>/<span style={{color:'var(--red)'}}>{fmtDiff(workRejected)}</span></>}
                  </span>
                  {w.bestshare>0 && <span style={{fontFamily:'var(--fm)',fontSize:'0.55rem',color:'var(--amber)'}}>best {fmtDiff(w.bestshare)}</span>}
                </div>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.78rem',fontWeight:600,color:on?'var(--amber)':'var(--text-2)',minWidth:64,textAlign:'right', flexShrink:0}}>
                  {on?fmtHr(w.hashrate):'offline'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Closest Calls — pool-wide top 10 best-diff shares ever ──────────────────
function ClosestCallsPanel({ closestCalls, aliases }) {
  const list = closestCalls || [];
  if (!list.length) {
    return (
      <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
        <div style={{...cardTitle, color:'var(--amber)'}}>▸ Near Strikes</div>
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.72rem',fontFamily:'var(--fd)'}}>
          Building leaderboard…<br/>
          <span style={{color:'var(--amber)',fontSize:'0.65rem'}}>Shares tracked as they come in</span>
        </div>
      </div>
    );
  }

  const maxDiff = list[0]?.diff || 1;

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)'}}>
        <span>▸ Near Strikes</span>
        <span style={{color:'var(--amber)', fontFamily:'var(--fm)', fontSize:'0.6rem', letterSpacing:'0.08em', marginRight:'14px', whiteSpace:'nowrap'}}>fleet-wide</span>
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:'0.35rem'}}>
        {list.map((c, i) => {
          const pct = (c.diff / maxDiff) * 100;
          const disp = displayName(c.workerName, aliases);
          const color = i === 0 ? 'var(--amber)' : i < 3 ? 'var(--cyan)' : 'var(--text-1)';
          return (
            <div key={`${c.workerName}-${c.ts}`} style={{
              padding:'0.55rem 0.7rem',
              background:'var(--bg-raised)',
              border:`1px solid ${i===0?'rgba(245,166,35,0.35)':i<3?'rgba(0,255,209,0.15)':'var(--border)'}`,
              position:'relative',
              overflow:'hidden',
              minWidth:0,
              boxShadow: i===0 ? '0 0 10px rgba(245,166,35,0.12)' : 'none',
            }}>
              <div style={{position:'absolute', inset:0, width:`${pct}%`, background: i===0?'rgba(245,166,35,0.06)':'rgba(0,255,209,0.04)', transition:'width 0.6s ease'}}/>
              <div style={{position:'relative', display:'flex', alignItems:'center', gap:'0.6rem'}}>
                <span style={{
                  fontFamily:'var(--fd)', fontSize:'0.72rem', fontWeight:700,
                  color, minWidth:22, flexShrink:0,
                  textShadow: i===0 ? '0 0 8px rgba(245,166,35,0.5)' : 'none',
                }}>#{i+1}</span>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontFamily:'var(--fm)', fontSize:'0.78rem', color:'var(--text-1)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}} title={c.workerName}>
                    {disp}
                    {c.minerType && <span style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.1em', color:'var(--text-3)', marginLeft:6, textTransform:'uppercase'}}>{c.minerType}</span>}
                  </div>
                  <div style={{fontFamily:'var(--fm)', fontSize:'0.55rem', color:'var(--text-3)', marginTop:2}}>
                    {c.ts ? timeAgo(c.ts) : '—'}
                  </div>
                </div>
                <span style={{fontFamily:'var(--fd)', fontSize:'0.9rem', fontWeight:700, color, flexShrink:0, textShadow: i===0 ? '0 0 10px rgba(245,166,35,0.4)' : 'none'}}>
                  {fmtDiff(c.diff)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Bitcoin Network ───────────────────────────────────────────────────────────
function NetworkStats({ network, blockReward, mempool, prices, currency, privateMode }) {
  const price = prices?.[currency];
  const rewardUsd = price && blockReward ? blockReward.totalBtc * price : null;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Bitcoin Network</div>
      {[['Block Height', fmtNum(network?.height), 'var(--text-1)'],
        ['Difficulty', fmtDiff(network?.difficulty), 'var(--text-1)'],
        ['Net Hashrate', fmtHr(network?.hashrate), 'var(--cyan)']].map(([l,v,c])=>(
        <div key={l} style={statRow}>
          <span style={label}>{l}</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:c,textShadow:c==='var(--cyan)'?'0 0 10px rgba(0,255,209,0.3)':'none'}}>{v}</span>
        </div>
      ))}
      <div style={{height:1,background:'var(--border)',margin:'0.7rem 0'}}/>
      {blockReward && (
        <div style={{...statRow, background:'var(--bg-deep)', borderColor:'rgba(245,166,35,0.25)'}}>
          <span style={{...label, color:'var(--amber)'}}>🏆 Next Block Prize</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'1rem',fontWeight:700,color:'var(--amber)',textShadow:'0 0 12px rgba(245,166,35,0.4)',textAlign:'right'}}>
            {fmtBtc(blockReward.totalBtc, 3)}
            {rewardUsd!=null && <div style={{fontFamily:'var(--fm)',fontSize:'0.68rem',color:'var(--green)',fontWeight:600,marginTop:2,textShadow:'0 0 8px rgba(57,255,106,0.2)'}}>{fmtFiat(rewardUsd, currency)}</div>}
          </span>
        </div>
      )}
      {!privateMode && price!=null && (
        <div style={statRow}>
          <span style={label}>BTC Price</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:'var(--cyan)'}}>{fmtFiat(price, currency)}</span>
        </div>
      )}
      {mempool?.totalFeesBtc>0 && (
        <div style={statRow}>
          <span style={label}>Mempool Fees</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--amber)'}}>{fmtBtc(mempool.totalFeesBtc, 2)}</span>
        </div>
      )}
      {mempool?.feeRate!=null && (
        <div style={statRow}>
          <span style={label}>Priority Fee</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--amber)'}}>{mempool.feeRate} sat/vB</span>
        </div>
      )}
      {privateMode && (
        <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--cyan)',marginTop:'0.5rem',textAlign:'center',letterSpacing:'0.1em'}}>
          🔒 PRICE HIDDEN — PRIVATE MODE
        </div>
      )}
    </div>
  );
}

// ── Bitcoin Node panel ────────────────────────────────────────────────────────
function BitcoinNodePanel({ nodeInfo }) {
  const ni = nodeInfo || {};
  const client = parseClient(ni.subversion);
  const connected = ni.connected;
  const relayStr = ni.relayFee != null ? `${(ni.relayFee * 1e5).toFixed(2)} sat/vB` : '—';
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>▸ Bitcoin Node</span>
        <span style={{display:'inline-flex', alignItems:'center', gap:5, color: connected?'var(--green)':'var(--red)', fontSize:'0.55rem', letterSpacing:'0.12em'}}>
          <span style={{width:6, height:6, borderRadius:'50%', background: connected?'var(--green)':'var(--red)', boxShadow: `0 0 6px ${connected?'var(--green)':'var(--red)'}`, animation: connected?'pulse 2s ease-in-out infinite':'none'}}/>
          {connected ? 'CONNECTED' : 'OFFLINE'}
        </span>
      </div>
      <div style={statRow}>
        <span style={label}>Client</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)',textAlign:'right'}}>
          {client.name}
          {client.version && <div style={{fontSize:'0.6rem',color:'var(--text-2)',marginTop:2}}>v{client.version}</div>}
        </span>
      </div>
      <div style={statRow}>
        <span style={label}>Peers</span>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:'var(--cyan)'}}>
          {fmtNum(ni.peers || 0)}
          {(ni.peersIn > 0 || ni.peersOut > 0) && <span style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',fontWeight:400,marginLeft:6}}>{ni.peersOut}↑ · {ni.peersIn}↓</span>}
        </span>
      </div>
      <div style={statRow}><span style={label}>Relay Fee</span><span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--amber)'}}>{relayStr}</span></div>
      <div style={statRow}><span style={label}>Mempool TXs</span><span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{fmtNum(ni.mempoolCount || 0)}</span></div>
      <div style={statRow}><span style={label}>Mempool Size</span><span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--cyan)'}}>{fmtBytes(ni.mempoolBytes || 0)}</span></div>
    </div>
  );
}

// ── Strike Odds ───────────────────────────────────────────────────────────────
function OddsDisplay({ odds, hashrate, netHashrate }) {
  const { perBlock=0, expectedDays=null, perDay=0, perWeek=0, perMonth=0 } = odds||{};
  const R=48, C=2*Math.PI*R;
  const scale=perBlock>0?Math.min(1,Math.log10(1+perBlock*1e9)/3):0;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Strike Odds</div>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'0.875rem'}}>
        <div style={{position:'relative',width:110,height:110,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <svg width="110" height="110" viewBox="0 0 110 110" style={{position:'absolute'}}>
            <circle cx="55" cy="55" r={R} fill="none" stroke="var(--bg-raised)" strokeWidth="7"/>
            {[0,90,180,270].map(d=><line key={d} x1="55" y1="4" x2="55" y2="12" stroke="var(--border)" strokeWidth="1" transform={`rotate(${d} 55 55)`}/>)}
            <circle cx="55" cy="55" r={R} fill="none" stroke="var(--amber)" strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${C*scale} ${C}`} style={{filter:'drop-shadow(0 0 5px rgba(245,166,35,0.6))',transition:'stroke-dasharray 1.2s ease'}} transform="rotate(-90 55 55)"/>
          </svg>
          <div style={{textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.65rem',fontWeight:700,color:'var(--amber)',lineHeight:1.2}}>
              {perBlock>0?`${(perBlock*100).toExponential(1)}%`:'—'}
            </div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',color:'var(--text-2)',letterSpacing:'0.08em',textTransform:'uppercase',marginTop:2}}>per block</div>
          </div>
        </div>
        {[['Expected', fmtOdds(expectedDays), 'var(--amber)'],
          ['Per Day',   perDay>0?fmtPct(perDay*100,4):'—', 'var(--text-1)'],
          ['Per Week',  perWeek>0?fmtPct(perWeek*100,3):'—', 'var(--text-1)'],
          ['Per Month', perMonth>0?fmtPct(perMonth*100,2):'—','var(--cyan)'],
          ['Pool Share', netHashrate>0&&hashrate>0?`${((hashrate/netHashrate)*100).toExponential(2)}%`:'—','var(--text-1)']
        ].map(([l,v,c])=>(
          <div key={l} style={{...statRow,width:'100%',marginBottom:0}}>
            <span style={label}>{l}</span>
            <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:c}}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Hot Streak (luck) ─────────────────────────────────────────────────────────
function LuckGauge({ luck }) {
  if (!luck) return null;
  const pct = Math.max(0, Math.min(100, luck.progress||0));
  const luckPct = luck.luck;
  let luckColor = 'var(--text-2)';
  let luckLabel = '—';
  if (luckPct != null) {
    if (luckPct >= 100) { luckColor = 'var(--green)'; luckLabel = `${luckPct.toFixed(0)}% lucky`; }
    else if (luckPct >= 50) { luckColor = 'var(--amber)'; luckLabel = `${luckPct.toFixed(0)}% lucky`; }
    else { luckColor = 'var(--red)'; luckLabel = `${luckPct.toFixed(0)}% lucky`; }
  }
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Hot Streak</div>
      <div style={{position:'relative', height:20, background:'var(--bg-deep)', border:'1px solid var(--border)', overflow:'hidden', marginBottom:8}}>
        <div style={{ height:'100%', width:`${pct}%`, background:'linear-gradient(90deg, var(--amber-glow, rgba(245,166,35,0.4)) 0%, var(--amber) 100%)', boxShadow:'0 0 8px rgba(245,166,35,0.4)', transition:'width 0.4s ease' }}/>
        <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.1em', color:'#000', fontWeight:700, mixBlendMode:'screen'}}>
          {pct.toFixed(1)}% to next
        </div>
      </div>
      <div style={statRow}>
        <span style={label}>Expected</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{(luck.blocksExpected||0).toFixed(2)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Found</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--cyan)'}}>{luck.blocksFound||0}</span>
      </div>
      <div style={{...statRow, borderColor:'var(--border-hot, rgba(245,166,35,0.3))'}}>
        <span style={label}>Streak</span>
        <span style={{fontFamily:'var(--fm)',color:luckColor,fontWeight:600}}>{luckLabel}</span>
      </div>
    </div>
  );
}

// ── Difficulty Retarget ───────────────────────────────────────────────────────
function RetargetPanel({ retarget }) {
  if (!retarget) return null;
  const { progressPercent=0, difficultyChange=0, remainingBlocks=0, remainingTime=0 } = retarget;
  const changeColor = difficultyChange>=0 ? 'var(--red)' : 'var(--green)';
  const pct = Math.max(0, Math.min(100, progressPercent));
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Difficulty Retarget</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
        <div style={{textAlign:'center',padding:'0.25rem 0'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.6rem',fontWeight:700,color:changeColor,textShadow:`0 0 14px ${changeColor}50`,lineHeight:1}}>
            {difficultyChange>=0?'+':''}{difficultyChange.toFixed(2)}%
          </div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginTop:4}}>estimated change</div>
        </div>
        <div>
          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:4}}>
            <span>Epoch progress</span><span style={{color:'var(--cyan)'}}>{pct.toFixed(1)}%</span>
          </div>
          <div style={{height:3,background:'var(--bg-deep)',borderRadius:2,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${pct}%`,background:'var(--cyan)',boxShadow:'0 0 8px rgba(0,255,209,0.5)',transition:'width 0.6s ease'}}/>
          </div>
        </div>
        <div style={{...statRow,marginBottom:0}}><span style={label}>Remaining Blocks</span><span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{fmtNum(remainingBlocks)}</span></div>
        <div style={{...statRow,marginBottom:0}}><span style={label}>ETA</span><span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--amber)'}}>{fmtDurationMs(remainingTime)}</span></div>
      </div>
    </div>
  );
}

// ── Share stats modal ─────────────────────────────────────────────────────────
function ShareStatsModal({ shares, workers, aliases, onClose, onWorkerSelect, trackingSince }) {
  const s = shares || {};
  const reasons = s.rejectReasons || {};

  const wl = Array.isArray(workers) ? workers : [];
  const sh = shares || {};
  const totalAccepted = sh.acceptedCount || 0;
  const totalRejected = sh.rejectedCount || 0;
  const totalStale    = sh.stale || 0;
  let bestSdiff = 0;
  for (const w of wl) {
    const se = w.shareEvents;
    if (!se) continue;
    if ((se.bestSdiff || 0) > bestSdiff) bestSdiff = se.bestSdiff;
  }

  const grandTotal = totalAccepted + totalRejected + totalStale || 1;
  const acceptPct = ((totalAccepted / grandTotal) * 100);
  const rejectPct = ((totalRejected / grandTotal) * 100);
  const stalePct  = ((totalStale    / grandTotal) * 100);

  const reasonRows = Object.entries(reasons).sort((a,b) => b[1] - a[1]);

  const classifyReason = (reason) => {
    if (/stale|invalid.?jobid|old.?job|expired/i.test(reason)) return 'var(--amber)';
    if (/duplicate|bad.?nonce|coinbase/i.test(reason)) return 'var(--text-2)';
    return 'var(--red)';
  };

  const workerRows = wl
    .filter(w => w.shareEvents)
    .map(w => {
      const se = w.shareEvents;
      const tot = (se.accepted || 0) + (se.rejected || 0) + (se.stale || 0);
      const ar = tot > 0 ? ((se.accepted || 0) / tot) * 100 : 100;
      return { worker: w, se, tot, ar };
    })
    .filter(r => r.tot > 0)
    .sort((a, b) => a.ar - b.ar);

  const health = (ar) => ar >= 99.9 ? 'var(--green)' : ar >= 99 ? 'var(--amber)' : 'var(--red)';

  const section = { marginBottom:'1rem' };
  const secTitle = { fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--amber)', marginBottom:'0.5rem' };
  const kvRow = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.4rem 0.6rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:3 };
  const kvLabel = { fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };
  const kvVal = { fontFamily:'var(--fm)', fontSize:'0.75rem', color:'var(--text-1)', textAlign:'right' };
  const heroBox = { background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.7rem', textAlign:'center' };
  const heroLbl = { fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:4 };
  const heroVal = { fontFamily:'var(--fd)', fontSize:'1.1rem', fontWeight:700, lineHeight:1 };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:250,padding:'0.75rem'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:560,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',boxShadow:'var(--glow-a)',maxHeight:'95vh',overflowY:'auto'}}>
        <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
            <span style={{fontSize:16,color:'var(--amber)'}}>📊</span>
            <span style={{fontFamily:'var(--fd)',fontSize:'1rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.05em'}}>Share Diagnostics</span>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:22,padding:'0 4px'}}>✕</button>
        </div>

        <div style={{padding:'1rem 1.25rem'}}>

          <div style={section}>
            <div style={secTitle}>▸ Pool Share Health</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'0.5rem',marginBottom:'0.5rem'}}>
              <div style={heroBox}><div style={heroLbl}>Accepted</div><div style={{...heroVal,color:'var(--green)'}}>{fmtNum(totalAccepted)}</div></div>
              <div style={heroBox}><div style={heroLbl}>Rejected</div><div style={{...heroVal,color:totalRejected>0?'var(--red)':'var(--text-2)'}}>{fmtNum(totalRejected)}</div></div>
              <div style={heroBox}><div style={heroLbl}>Stale</div><div style={{...heroVal,color:totalStale>0?'var(--amber)':'var(--text-2)'}}>{fmtNum(totalStale)}</div></div>
            </div>
            <div style={kvRow}><span style={kvLabel}>Accept Rate</span><span style={{...kvVal,color:health(acceptPct)}}>{acceptPct.toFixed(3)}%</span></div>
            <div style={kvRow}><span style={kvLabel}>Reject Rate</span><span style={{...kvVal,color:rejectPct<0.5?'var(--text-2)':'var(--red)'}}>{rejectPct.toFixed(3)}%</span></div>
            <div style={kvRow}><span style={kvLabel}>Stale Rate</span><span style={{...kvVal,color:stalePct<0.5?'var(--text-2)':'var(--amber)'}}>{stalePct.toFixed(3)}%</span></div>
            <div style={kvRow}><span style={kvLabel}>Best Share (session)</span><span style={{...kvVal,color:'var(--amber)'}}>{fmtDiff(bestSdiff)}</span></div>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-3)',marginTop:'0.4rem',lineHeight:1.4}}>
              {trackingSince ? <>Tracking since <span style={{color:'var(--amber)'}}>{new Date(trackingSince).toLocaleDateString(undefined,{month:'short',day:'numeric'})} {new Date(trackingSince).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</span>. Persists across restarts.</> : <>Session totals since share-watcher started. Persists across restarts.</>}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',marginTop:'0.6rem'}}>
              <button onClick={()=>{
                if(!window.confirm('Reset all share statistics?\n\nThis zeros accepted/rejected/stale counts for every worker.\nHistorical sharelogs on disk are unaffected.\n\nAfter reset, only new shares from this moment forward are tracked.')) return;
                fetch('/api/reset-share-stats',{method:'POST'})
                  .then(r=>r.json())
                  .then(d=>{ if(d.error) throw new Error(d.error); onClose && onClose(); })
                  .catch(e=>window.alert('Reset failed: '+e.message));
              }} style={{background:'none',border:'1px solid var(--red)',color:'var(--red)',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.1em',padding:'6px 12px',cursor:'pointer',textTransform:'uppercase'}}>⟲ Reset Session Stats</button>
            </div>
          </div>

          <div style={section}>
            <div style={secTitle}>▸ Reject Reasons</div>
            {reasonRows.length === 0 ? (
              <div style={{textAlign:'center',padding:'1rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontFamily:'var(--fd)',fontSize:'0.65rem',letterSpacing:'0.1em',textTransform:'uppercase'}}>
                No rejects yet ✓
              </div>
            ) : (
              reasonRows.map(([reason, count]) => (
                <div key={reason} style={kvRow}>
                  <span style={{...kvLabel,textTransform:'none',letterSpacing:'0.02em',color:classifyReason(reason)}}>{reason}</span>
                  <span style={{...kvVal,color:'var(--text-1)',fontWeight:600}}>{fmtNum(count)}</span>
                </div>
              ))
            )}
            <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-3)',marginTop:'0.4rem',lineHeight:1.4}}>
              <span style={{color:'var(--amber)'}}>amber</span> = stale/latency · <span style={{color:'var(--red)'}}>red</span> = hardware/config · <span style={{color:'var(--text-2)'}}>grey</span> = rare
            </div>
          </div>

          <div style={section}>
            <div style={secTitle}>▸ Per-Worker Health ({workerRows.length})</div>
            {workerRows.length === 0 ? (
              <div style={{textAlign:'center',padding:'1rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontFamily:'var(--fd)',fontSize:'0.65rem',letterSpacing:'0.1em',textTransform:'uppercase'}}>
                Gathering data…
              </div>
            ) : (
              workerRows.map(({worker, se, tot, ar}) => (
                <div key={worker.name}
                     onClick={() => { onClose(); onWorkerSelect && onWorkerSelect(worker); }}
                     style={{...kvRow,cursor:'pointer',flexDirection:'column',alignItems:'stretch',gap:4}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <span style={{fontFamily:'var(--fd)',fontSize:'0.68rem',fontWeight:600,color:'var(--text-1)'}}>
                      {worker.minerIcon || '▪'} {displayName(worker.name, aliases)}
                    </span>
                    <span style={{fontFamily:'var(--fm)',fontSize:'0.75rem',fontWeight:700,color:health(ar)}}>{ar.toFixed(2)}%</span>
                  </div>
                  <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-2)'}}>
                    <span>
                      <span style={{color:'var(--green)'}}>{fmtNum(se.accepted||0)}</span>
                      {' · '}<span style={{color:(se.rejected||0) > 0 ? 'var(--red)' : 'var(--text-3)'}}>{fmtNum(se.rejected||0)} rej</span>
                      {' · '}<span style={{color:(se.stale||0) > 0 ? 'var(--amber)' : 'var(--text-3)'}}>{fmtNum(se.stale||0)} stale</span>
                    </span>
                    <span>
                      {se.port && <>:{se.port}</>}
                      {se.lastRejectReason && <> · {se.lastRejectReason}</>}
                    </span>
                  </div>
                </div>
              ))
            )}
            <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-3)',marginTop:'0.4rem',lineHeight:1.4}}>
              Sorted by accept rate (worst first). Tap a worker for full details.
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Share Stats card ──────────────────────────────────────────────────────────
function ShareStats({ shares, hashrate, bestshare, onOpen }) {
  const s = shares || {};
  const workAccepted = s.accepted || 0;
  const workRejected = s.rejected || 0;
  const stale = s.stale || 0;
  const total = workAccepted + workRejected || 1;
  const acceptRate = ((workAccepted / total) * 100).toFixed(2);
  const sharesPerMin = hashrate > 0 ? (hashrate / 4294967296 * 60).toFixed(1) : '0';
  return (
    <div onClick={onOpen} style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', cursor: onOpen ? 'pointer' : 'default'}} className="fade-in">
      <div style={{...cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>▸ Share Stats</span>
        <a href="/api/export/workers.csv" download onClick={e=>e.stopPropagation()} style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.1em',color:'var(--cyan)',textDecoration:'none',padding:'4px 8px',marginRight:'14px',whiteSpace:'nowrap'}}>⬇ CSV</a>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.6rem'}}>
        <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.875rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Work Accepted</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.8rem',fontWeight:700,color:'var(--green)',lineHeight:1}}>{fmtDiff(workAccepted)}</div>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-2)',marginTop:6}}>
            {workRejected>0 && <><span style={{color:'var(--red)'}}>{fmtDiff(workRejected)}</span> rejected</>}
       <> · <span style={{color:stale>0?'var(--amber)':'var(--text-2)'}}>{fmtDiff(stale)}</span> stale</>
            {workAccepted>0 && workRejected>0 && <> · <span style={{color:parseFloat(acceptRate)>99.9?'var(--green)':'var(--amber)'}}>{acceptRate}%</span> accept</>}
          </div>
        </div>
        <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.875rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Best Difficulty</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.8rem',fontWeight:700,color:'var(--amber)',lineHeight:1,textShadow:'0 0 14px rgba(245,166,35,0.3)'}}>{fmtDiff(bestshare||0)}<span style={{fontSize:'0.6rem',color:'var(--text-2)',marginLeft:6,fontWeight:400}}>all-time</span></div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',marginTop:'0.2rem'}}>
          <span>Shares / min (est.)</span><span style={{color:'var(--cyan)'}}>{sharesPerMin}</span>
        </div>
        {onOpen && (
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',color:'var(--cyan)',textTransform:'uppercase',textAlign:'center',paddingTop:4,borderTop:'1px dashed var(--border)',marginTop:2}}>
            Tap for diagnostics ↗
          </div>
        )}
      </div>
    </div>
  );
}

// ── Top Diggers (best share leaderboard) ──────────────────────────────────────
function BestShareLeaderboard({ workers, poolBest, aliases }) {
  const sorted = [...(workers || [])].filter(w => (w.bestshare||0) > 0).sort((a, b) => (b.bestshare || 0) - (a.bestshare || 0)).slice(0, 5);
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Top Diggers — Best Difficulties</div>
      {sorted.length === 0 ? (
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.72rem',fontFamily:'var(--fd)'}}>No shares submitted yet<br/><span style={{color:'var(--amber)',fontSize:'0.65rem'}}>Keep mining ⛏</span></div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'0.35rem'}}>
          {sorted.map((w, i) => {
            const on = w.status !== 'offline';
            const healthC = HEALTH_COLOR[w.health] || 'var(--text-3)';
            return (
              <div key={w.name} style={{padding:'0.55rem 0.7rem',background:'var(--bg-raised)',border:`1px solid ${i===0?'rgba(245,166,35,0.3)':'var(--border)'}`,opacity:on?1:0.55, minWidth:0, overflow:'hidden'}}>
                <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:3}}>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.7rem',fontWeight:700,color:i===0?'var(--amber)':'var(--text-2)',minWidth:20, flexShrink:0}}>#{i+1}</span>
                  <div style={{flex:1,minWidth:0,fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={w.name}>{displayName(w.name, aliases)}</div>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.82rem',fontWeight:700,color:i===0?'var(--amber)':'var(--cyan)', flexShrink:0}}>{fmtDiff(w.bestshare || 0)}</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'0.5rem',paddingLeft:25,fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-2)'}}>
                  <div title={w.health||'unknown'} style={{width:6,height:6,borderRadius:'50%',background:on?healthC:'var(--text-3)',boxShadow:on?`0 0 4px ${healthC}`:'none',flexShrink:0}}/>
                  {w.minerType && <><span style={{color:'var(--text-3)',letterSpacing:'0.05em',textTransform:'uppercase',fontSize:'0.55rem'}}>{w.minerType}</span><span style={{color:'var(--text-3)'}}>·</span></>}
                  <span style={{color: on?'var(--amber)':'var(--text-3)'}}>{on ? fmtHr(w.hashrate) : 'offline'}</span>
                </div>
              </div>
            );
          })}
          <div style={{...statRow,marginTop:'0.4rem',borderColor:'var(--border-hot)'}}>
            <span style={label}>Pool Best</span>
            <span style={{fontFamily:'var(--fd)',fontSize:'0.9rem',fontWeight:700,color:'var(--amber)',textShadow:'0 0 8px rgba(245,166,35,0.4)'}}>{fmtDiff(poolBest || 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Top Finders ────────────────────────────────────────────────────────────────
function TopFindersPanel({ topFinders, netBlocks }) {
  const list = topFinders || [];
  const totalSample = (netBlocks||[]).length;
  if (!list.length) return null;
  const maxCount = list[0]?.count || 1;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Claim Jumpers — Latest Strikes</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.35rem'}}>
        {list.map((p,i)=>{
          const pct = (p.count/maxCount)*100;
          const color = p.isSolo ? 'var(--amber)' : (i===0 ? 'var(--cyan)' : 'var(--text-1)');
          return (
            <div key={p.name} style={{padding:'0.5rem 0.8rem',background:'var(--bg-raised)',border:`1px solid ${i===0?'rgba(0,255,209,0.2)':'var(--border)'}`,position:'relative',overflow:'hidden', minWidth:0}}>
              <div style={{position:'absolute',inset:0,width:`${pct}%`,background:p.isSolo?'rgba(245,166,35,0.06)':'rgba(0,255,209,0.04)',transition:'width 0.6s ease'}}/>
              <div style={{position:'relative',display:'flex',alignItems:'center',gap:'0.6rem'}}>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.65rem',fontWeight:700,color:i===0?'var(--cyan)':'var(--text-2)',width:18, flexShrink:0}}>#{i+1}</span>
                <div style={{flex:1,minWidth:0,fontFamily:'var(--fd)',fontSize:'0.72rem',color,letterSpacing:'0.05em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textTransform:'uppercase'}}>
                  {p.name}{p.isSolo && <span style={{fontSize:'0.5rem',color:'var(--amber)',marginLeft:6,border:'1px solid var(--amber)',padding:'0 4px'}}>SOLO</span>}
                </div>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:700,color, flexShrink:0}}>{p.count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Block feed (our strikes) ──────────────────────────────────────────────────
function BlockFeed({ blocks, blockAlert }) {
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center', color:'var(--amber)'}}>
        <span>▸ Gold Strikes — {(blocks||[]).length} total</span>
        {(blocks||[]).length>0 && <a href="/api/export/blocks.csv" download style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.1em',color:'var(--cyan)',textDecoration:'none',padding:'4px 8px',marginRight:'14px',whiteSpace:'nowrap'}}>⬇ CSV</a>}
      </div>
      {!(blocks||[]).length?(
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)'}}>No gold struck yet.<br/><span style={{color:'var(--amber)',fontSize:'0.68rem'}}>Keep digging ⛏</span></div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem',maxHeight:240,overflowY:'auto'}}>
          {blocks.map((b,i)=>(
            <div key={b.hash} style={{display:'flex',alignItems:'center',gap:'0.75rem',padding:'0.7rem 1rem',background:'var(--bg-raised)',border:`1px solid ${blockAlert&&i===0?'var(--green)':'rgba(57,255,106,0.15)'}`,animation:blockAlert&&i===0?'blockBoom 0.6s ease':'none', minWidth:0}}>
              <span style={{fontSize:16, flexShrink:0}}>💎</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:'var(--green)'}}>#{fmtNum(b.height)}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.hash?.slice(0,24)}…</div>
              </div>
              <span style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-2)',flexShrink:0}}>{timeAgo(b.ts)}</span>
              <a href={`https://mempool.space/block/${b.hash}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--text-2)',fontSize:12, flexShrink:0}}>↗</a>
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
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ The Goldfields — Solo Winners ⚡</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.35rem',maxHeight:300,overflowY:'auto'}}>
        {list.slice(0,15).map(b=>(
          <div key={b.id} style={{display:'flex',alignItems:'center',gap:'0.6rem',padding:'0.55rem 0.8rem',background:'var(--bg-raised)',border:`1px solid ${b.isSolo?'rgba(245,166,35,0.35)':'var(--border)'}`,boxShadow:b.isSolo?'0 0 10px rgba(245,166,35,0.12)':'none', minWidth:0}}>
            <span style={{fontSize:13,color:b.isSolo?'var(--amber)':'var(--text-3)',flexShrink:0}}>{b.isSolo?'⚡':'▪'}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.78rem',fontWeight:600,color:b.isSolo?'var(--amber)':'var(--text-1)'}}>#{fmtNum(b.height)}</span>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.58rem',letterSpacing:'0.1em',color:b.isSolo?'var(--amber)':'var(--text-2)',textTransform:'uppercase'}}>{b.pool}</span>
                {b.isSolo && <span style={{fontFamily:'var(--fd)',fontSize:'0.52rem',color:'var(--amber)',border:'1px solid var(--amber)',padding:'1px 5px',letterSpacing:'0.12em'}}>SOLO</span>}
              </div>
              <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-3)',marginTop:2}}>
                {fmtNum(b.tx_count||0)} tx · {blockTimeAgo(b.timestamp)}
                {b.reward!=null && <> · <span style={{color:'var(--cyan)'}}>{fmtSats(b.reward)}</span></>}
              </div>
            </div>
            <a href={`https://mempool.space/block/${b.id}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--text-2)',fontSize:12,flexShrink:0}}>↗</a>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Confetti / block alert ────────────────────────────────────────────────────
function Confetti() {
  const pieces = useMemo(() => Array.from({length: 60}).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 2 + Math.random() * 1.5,
    color: ['#F5A623', '#39FF6A', '#00FFD1', '#fff'][i % 4],
  })), []);
  return <div style={{position:'fixed', inset:0, pointerEvents:'none', zIndex:1000, overflow:'hidden'}}>{pieces.map(p=>(
    <div key={p.id} style={{position:'absolute', top:'-20px', left:`${p.left}%`, width:6, height:14, background:p.color, animation:`confettiFall ${p.duration}s ${p.delay}s linear forwards`, transform:'rotate(0deg)'}}/>
  ))}</div>;
}
function BlockAlert({ show, block, onDismiss }) {
  if (!show||!block) return null;
  return (
    <>
      <Confetti/>
      <div onClick={onDismiss} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:999,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem',cursor:'pointer'}}>
        <div style={{textAlign:'center',background:'var(--bg-elevated, #15161a)',border:'1px solid var(--amber)',padding:'2.4rem 2rem',maxWidth:420,boxShadow:'0 0 50px rgba(245,166,35,0.5)'}}>
          <div style={{fontSize:60,animation:'pulse 1.2s infinite'}}>⚡</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'2.4rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.05em',marginTop:14,textShadow:'0 0 25px var(--amber)'}}>STRIKE!</div>
          <div style={{fontFamily:'var(--fm)',fontSize:'1.05rem',color:'var(--text-1)',marginTop:8}}>Block #{fmtNum(block.height||0)}</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.4rem',color:'var(--green)',fontWeight:700,marginTop:14,textShadow:'0 0 14px rgba(57,255,106,0.45)'}}>+{(block.reward||0).toFixed(3)} BTC</div>
          <div style={{fontSize:'0.7rem',color:'var(--text-2)',marginTop:14,fontFamily:'var(--fd)',letterSpacing:'0.1em'}}>tap to dismiss</div>
        </div>
      </div>
    </>
  );
}

// ── Setup Form ────────────────────────────────────────────────────────────────
function SetupForm({ saveConfig }) {
  const [a, setA] = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setErr('');
    if (!isValidBtcAddress(a)) { setErr('Invalid BTC address'); return; }
    setLoading(true);
    try { await saveConfig({ payoutAddress: a.trim() }); } catch (e) { setErr(e.message || 'Failed'); }
    finally { setLoading(false); }
  };
  return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',padding:'1.5rem'}}>
      <div style={{maxWidth:500, width:'100%', background:'var(--bg-surface)', border:'1px solid var(--amber)', padding:'1.8rem'}}>
        <h2 style={{fontFamily:'var(--fd)', color:'var(--amber)', letterSpacing:'0.1em', fontSize:'1.1rem'}}>⛏ SoloStrike Setup</h2>
        <p style={{color:'var(--text-2)', fontSize:'0.78rem', marginTop:8, lineHeight:1.5}}>Set your Bitcoin payout address to begin mining. You're 100% solo — if you find a block, you keep all of it.</p>
        <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginTop:18, marginBottom:6}}>Bitcoin Payout Address</label>
        <input type="text" value={a} onChange={e=>setA(e.target.value)} placeholder="bc1q..."
          style={{width:'100%',padding:'0.7rem',background:'var(--bg-deep)',border:`1px solid ${err?'var(--red)':'var(--border)'}`,color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.85rem',outline:'none',boxSizing:'border-box'}}/>
        {err && <div style={{color:'var(--red)', fontSize:'0.7rem', marginTop:6, fontFamily:'var(--fm)'}}>⚠ {err}</div>}
        <button onClick={submit} disabled={loading} style={{width:'100%',padding:'0.85rem',marginTop:18,background:'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,letterSpacing:'0.1em',fontSize:'0.85rem',cursor:loading?'wait':'pointer',textTransform:'uppercase',opacity:loading?0.6:1}}>
          {loading ? 'Saving…' : 'START MINING →'}
        </button>
      </div>
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────
function SettingsModal({ onClose, saveConfig, currentConfig, currency, onCurrencyChange, onResetLayout, workers, aliases, onAliasesChange, stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange, networkStats, onNetworkStatsRefresh }) {
  const [tab, setTab] = useState('main');
  const [addr, setAddr] = useState(currentConfig?.payoutAddress || '');
  const [poolName, setPoolName] = useState(currentConfig?.poolName || 'SoloStrike');
  const [privateMode, setPrivateMode] = useState(!!currentConfig?.privateMode);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await saveConfig({ payoutAddress: addr || undefined, poolName, privateMode });
      setSaved(true); setTimeout(()=>setSaved(false), 2000);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'1rem',overflowY:'auto'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-elevated, #15161a)',border:'1px solid var(--border)',maxWidth:680,width:'100%',padding:'1.4rem',marginTop:'2rem',marginBottom:'2rem'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <h3 style={{margin:0,fontFamily:'var(--fd)',fontSize:'0.85rem',letterSpacing:'0.18em',color:'var(--amber)'}}>⛏ Settings</h3>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:'1.2rem',lineHeight:1,padding:0}}>✕</button>
        </div>

        <div style={{display:'flex',gap:0,borderBottom:'1px solid var(--border)',marginBottom:14, flexWrap:'wrap'}}>
          {[
            ['main','Main'],
            ['display','Display'],
            ['privacy','Privacy'],
            ['pulse','Pulse'],
            ['aliases','Aliases'],
            ['webhooks','Webhooks'],
          ].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id)} style={{
              padding:'8px 14px', background:tab===id?'var(--bg-raised)':'transparent',
              border:'none', borderBottom: tab===id?'2px solid var(--amber)':'2px solid transparent',
              color:tab===id?'var(--amber)':'var(--text-2)',
              fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.12em',
              cursor:'pointer', textTransform:'uppercase'
            }}>{label}</button>
          ))}
        </div>

        {tab==='main' && (
          <MainTab addr={addr} setAddr={setAddr} poolName={poolName} setPoolName={setPoolName}
            currency={currency} onCurrencyChange={onCurrencyChange} onResetLayout={onResetLayout}
            submit={submit} saved={saved} loading={loading}/>
        )}
        {tab==='display' && (
          <DisplayTab stripSettings={stripSettings} onStripSettingsChange={onStripSettingsChange}
            tickerSettings={tickerSettings} onTickerSettingsChange={onTickerSettingsChange}
            minimalMode={minimalMode} onMinimalModeChange={onMinimalModeChange}
            visibleCards={visibleCards} onVisibleCardsChange={onVisibleCardsChange}/>
        )}
        {tab==='privacy' && (
          <PrivacyTab privateMode={privateMode} setPrivateMode={setPrivateMode}
            submit={submit} saved={saved} loading={loading}/>
        )}
        {tab==='pulse' && (
          <PulseTab networkStats={networkStats} onRefresh={onNetworkStatsRefresh}/>
        )}
        {tab==='aliases' && (
          <AliasesTab workers={workers} aliases={aliases} onAliasesChange={onAliasesChange}/>
        )}
        {tab==='webhooks' && (
          <WebhooksTab/>
        )}
      </div>
    </div>
  );
}

// ── Main settings tab ─────────────────────────────────────────────────────────
function MainTab({addr,setAddr,poolName,setPoolName,currency,onCurrencyChange,onResetLayout,submit,saved,loading}) {
  return (
    <>
      <div style={{marginBottom:14}}>
        <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:4, textTransform:'uppercase'}}>Bitcoin Payout Address</label>
        <input type="text" value={addr} onChange={e=>setAddr(e.target.value)} placeholder="bc1q..."
          style={{width:'100%',padding:'0.55rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.78rem',outline:'none',boxSizing:'border-box'}}/>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-3)', marginTop:5}}>Where block rewards go. Use a fresh, dedicated address from your own wallet.</div>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:4, textTransform:'uppercase'}}>Pool Name</label>
        <input type="text" value={poolName} onChange={e=>setPoolName(e.target.value)} maxLength={32}
          style={{width:'100%',padding:'0.55rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.78rem',outline:'none',boxSizing:'border-box'}}/>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:4, textTransform:'uppercase'}}>Currency</label>
        <select value={currency} onChange={e=>onCurrencyChange(e.target.value)}
          style={{width:'100%',padding:'0.55rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.78rem',outline:'none',boxSizing:'border-box'}}>
          {CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={{display:'flex',gap:8, marginTop:18}}>
        <button onClick={submit} disabled={loading}
          style={{flex:1, padding:'0.7rem', background:saved?'var(--green)':'var(--amber)', color:'#000', border:'none', fontFamily:'var(--fd)', fontWeight:700, letterSpacing:'0.1em', fontSize:'0.7rem', cursor:loading?'wait':'pointer', textTransform:'uppercase', opacity:loading?0.6:1}}>
          {loading?'SAVING…':saved?'✓ SAVED':'SAVE'}
        </button>
        <button onClick={onResetLayout}
          style={{padding:'0.7rem 1rem', background:'transparent', color:'var(--text-2)', border:'1px solid var(--border)', fontFamily:'var(--fd)', fontWeight:600, letterSpacing:'0.1em', fontSize:'0.65rem', cursor:'pointer', textTransform:'uppercase'}}>
          Reset Layout
        </button>
      </div>
    </>
  );
}

// ── Display tab ───────────────────────────────────────────────────────────────
function DisplayTab({ stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange }) {
  const toggleMetric = (id) => {
    const next = stripSettings.metricIds.includes(id) ? stripSettings.metricIds.filter(x => x !== id) : [...stripSettings.metricIds, id];
    onStripSettingsChange({ ...stripSettings, metricIds: next });
  };
  const moveMetric = (id, dir) => {
    const idx = stripSettings.metricIds.indexOf(id);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= stripSettings.metricIds.length) return;
    const next = [...stripSettings.metricIds];
    const tmp = next[idx];
    next[idx] = next[swap];
    next[swap] = tmp;
    onStripSettingsChange({ ...stripSettings, metricIds: next });
  };
  const toggleCard = (id) => {
    const next = visibleCards.includes(id) ? visibleCards.filter(x => x !== id) : [...visibleCards, id];
    onVisibleCardsChange(next);
  };
  const applyPreset = (preset) => onVisibleCardsChange([...preset]);
  const matchesPreset = (preset) => {
    if (!Array.isArray(visibleCards) || visibleCards.length !== preset.length) return false;
    const a = [...visibleCards].sort();
    const b = [...preset].sort();
    return a.every((id, i) => id === b[i]);
  };
  const presetBtnStyle = (active) => ({
    flex:1, padding:'0.55rem',
    background:'var(--bg-raised)',
    border:`1px solid ${active?'var(--border-hot)':'var(--border)'}`,
    color: active?'var(--amber)':'var(--text-1)',
    fontFamily:'var(--fd)', fontSize:'0.62rem', fontWeight:700,
    letterSpacing:'0.1em', textTransform:'uppercase', cursor:'pointer',
  });

  const toggleTickerMetric = (id) => {
    const current = tickerSettings.metricIds || [];
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    onTickerSettingsChange({ ...tickerSettings, metricIds: next });
  };
  const moveTickerMetric = (id, dir) => {
    const current = tickerSettings.metricIds || [];
    const idx = current.indexOf(id);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= current.length) return;
    const next = [...current];
    const tmp = next[idx]; next[idx] = next[swap]; next[swap] = tmp;
    onTickerSettingsChange({ ...tickerSettings, metricIds: next });
  };
  const matchTickerToStrip = () => {
    onTickerSettingsChange({ ...tickerSettings, metricIds: [...(stripSettings.metricIds || [])] });
  };

  const sectionTitle = { fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--amber)', marginBottom:'0.5rem', marginTop:'1rem' };
  const firstSectionTitle = { ...sectionTitle, marginTop:0 };
  const rowLabel = { fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:6 };
  const btnBase = { padding:'4px 8px', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.08em', textTransform:'uppercase', cursor:'pointer', border:'1px solid var(--border)', background:'var(--bg-raised)', color:'var(--text-2)' };

  return (
    <>
      <div style={firstSectionTitle}>▸ Minimal Mode</div>
      <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.5rem', padding:'0.75rem 0.8rem', background: minimalMode?'rgba(0,255,209,0.06)':'var(--bg-raised)', border:`1px solid ${minimalMode?'rgba(0,255,209,0.35)':'var(--border)'}`}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.78rem', color: minimalMode?'var(--cyan)':'var(--text-1)', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase'}}>Bare Bones UI</div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)', marginTop:3, lineHeight:1.4}}>
            Hides ticker, block strips, status dot, and shows only Hashrate + Workers + Blocks cards.
          </div>
        </div>
        <button onClick={()=>onMinimalModeChange(!minimalMode)}
          style={{width:46, height:26, borderRadius:13, background: minimalMode?'var(--cyan)':'var(--bg-deep)', border:'1px solid var(--border)', position:'relative', cursor:'pointer', flexShrink:0}}>
          <div style={{position:'absolute', top:2, left: minimalMode?22:2, width:20, height:20, borderRadius:'50%', background: minimalMode?'#000':'var(--text-2)', transition:'left 0.2s'}}/>
        </button>
      </div>
      {minimalMode && (
        <div style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--cyan)', marginBottom:'0.5rem', padding:'0.4rem 0.6rem', background:'rgba(0,255,209,0.04)', border:'1px dashed rgba(0,255,209,0.2)'}}>
          🔇 Minimal Mode is on — settings below are overridden until you turn it off.
        </div>
      )}

      <div style={sectionTitle}>▸ Dashboard Cards</div>

      <div style={rowLabel}>Quick presets</div>
      <div style={{display:'flex', gap:6, marginBottom:'0.75rem'}}>
        <button onClick={()=>applyPreset(MINIMAL_PRESET)} style={presetBtnStyle(matchesPreset(MINIMAL_PRESET))}>
          Minimal (3)
        </button>
        <button onClick={()=>applyPreset(DEFAULT_PRESET)} style={presetBtnStyle(matchesPreset(DEFAULT_PRESET))}>
          Default ({DEFAULT_PRESET.length})
        </button>
        <button onClick={()=>applyPreset(EVERYTHING_PRESET)} style={presetBtnStyle(matchesPreset(EVERYTHING_PRESET))}>
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
              const on = stripSettings.metricIds.includes(metric.id);
              const order = on ? stripSettings.metricIds.indexOf(metric.id) : -1;
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
        Selected: <span style={{color:'var(--amber)'}}>{stripSettings.metricIds.length}</span> metric{stripSettings.metricIds.length===1?'':'s'}
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
                  const on = (tickerSettings.metricIds || []).includes(metric.id);
                  const order = on ? tickerSettings.metricIds.indexOf(metric.id) : -1;
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
            Selected: <span style={{color:'var(--amber)'}}>{(tickerSettings.metricIds || []).length}</span> metric{(tickerSettings.metricIds || []).length===1?'':'s'}
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
  );
}

// ── Privacy tab ───────────────────────────────────────────────────────────────
function PrivacyTab({privateMode,setPrivateMode,submit,saved,loading}) {
  return (
    <>
      <div style={{padding:'0.85rem 1rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:14,display:'flex',alignItems:'center',gap:'0.75rem'}}>
        <input type="checkbox" id="priv-mode" checked={privateMode} onChange={e=>setPrivateMode(e.target.checked)} style={{accentColor:'var(--cyan)'}}/>
        <div style={{flex:1}}>
          <label htmlFor="priv-mode" style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.74rem',fontWeight:700,color:'var(--cyan)',cursor:'pointer',letterSpacing:'0.05em'}}>🔒 Private Mode</label>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.66rem',color:'var(--text-2)',marginTop:3,lineHeight:1.5}}>
            Disables external API calls (mempool.space, prices). Pool gets its data exclusively from your local Bitcoin Core node. Some features (fee rates, top finders, fiat prices) become unavailable.
          </div>
        </div>
      </div>
      <div style={{display:'flex',gap:8,marginTop:14}}>
        <button onClick={submit} disabled={loading} style={{flex:1,padding:'0.7rem',background:saved?'var(--green)':'var(--cyan)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,letterSpacing:'0.1em',fontSize:'0.7rem',cursor:loading?'wait':'pointer',textTransform:'uppercase',opacity:loading?0.6:1}}>
          {loading?'SAVING…':saved?'✓ SAVED':'SAVE'}
        </button>
      </div>
    </>
  );
}

// ── Pulse tab ─────────────────────────────────────────────────────────────────
function PulseTab({ networkStats, onRefresh }) {
  const [err, setErr] = useState('');
  const [optimistic, setOptimistic] = useState(null); // null = use server, bool = override
  const ns = networkStats || { enabled: false, pools: 0, hashrate: 0, workers: 0, blocks: 0, versions: {}, relayStatus: {} };
  const enabled = optimistic !== null ? optimistic : !!ns.enabled;
  const [torOn, setTorOn] = useState(false);
  // v1.7.3 — track actual Tor routing state for UI banner
  // null = no info yet, "tor" = routing through Tor, "direct" = fallback or off,
  // "unreachable" = toggle on but Tor SOCKS unreachable, "checking" = probing
  const [torMode, setTorMode] = useState(null);
  const [torError, setTorError] = useState('');
  const [backup, setBackup] = useState(null);
  const [backupCopied, setBackupCopied] = useState(false);

  // Clear the optimistic override once the server has caught up
  useEffect(() => {
    if (optimistic !== null && !!ns.enabled === optimistic) setOptimistic(null);
  }, [ns.enabled, optimistic]);

  // v1.7.3 — load actual Tor state from server on mount + poll every 30s
  // so the banner reflects reality (e.g., if Tor goes into fallback mode
  // mid-session, UI updates without user interaction).
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const r = await fetch('/api/network-stats/security');
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const torConfigured = !!j.torEnabled || (j.torHealth && j.torHealth.state !== 'off');
        setTorOn(torConfigured);
        if (j.torHealth) {
          if (j.torHealth.state === 'ready') setTorMode('tor');
          else if (j.torHealth.state === 'fallback') setTorMode('direct');
          else if (j.torHealth.state === 'checking') setTorMode('checking');
          else setTorMode(null);
          if (j.torHealth.lastError) setTorError(j.torHealth.lastError);
        }
      } catch (_) { /* network glitch — ignore */ }
    };
    refresh();
    const id = setInterval(refresh, 30 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const toggle = async () => {
    const next = !enabled;
    setOptimistic(next);
    setErr('');
    try {
      const r = await fetch('/api/network-stats/' + (next ? 'enable' : 'disable'), { method: 'POST' });
      if (!r.ok) throw new Error('Failed to ' + (next ? 'enable' : 'disable'));
      onRefresh && onRefresh();
    } catch (e) {
      setErr(e.message);
      setOptimistic(!next);
    }
  };

  const regenerate = async () => {
    if (!window.confirm('Generate a new identity?\n\nYour Pulse identity is anonymous and persistent. Regenerating only useful if you want to reset history. Requires API restart.')) return;
    setErr('');
    try {
      const r = await fetch('/api/network-stats/regenerate', { method: 'POST' });
      if (!r.ok) throw new Error('Failed');
      alert('Identity regenerated. Restart the API container (Umbrel app menu → restart) to apply.');
    } catch (e) { setErr(e.message); }
  };

  return (
    <>
      <div style={{padding:'0.85rem 1rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:'0.6rem',display:'flex',alignItems:'center',gap:'0.75rem'}}>
        <input type="checkbox" id="pulse-on" checked={enabled} onChange={toggle} style={{accentColor:'var(--amber)'}}/>
        <div style={{flex:1}}>
          <label htmlFor="pulse-on" style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.74rem',fontWeight:700,color:'var(--amber)',cursor:'pointer',letterSpacing:'0.05em'}}>📡 Join Pulse</label>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.66rem',color:'var(--text-2)',marginTop:3,lineHeight:1.5}}>
            Broadcast your pool's anonymous stats to the SoloStrike Pulse network. See how many other solo pools exist. Opt-in, can be turned off any time.
          </div>
        </div>
      </div>

     {enabled && (
        <>
          {/* Tor routing toggle */}
          <div style={{padding:'0.7rem 0.8rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:'0.5rem'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.58rem',letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:8}}>Privacy</div>
            <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:6}}>
              <div style={{flex:1}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.72rem',fontWeight:700,color:'var(--text-1)',letterSpacing:'0.05em',marginBottom:3}}>🧅 Route via Tor</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',lineHeight:1.45}}>
                  Send broadcasts through Tor so no relay learns your IP address. Adds latency. Requires Umbrel Tor service running.
                </div>
              </div>
              <button
                onClick={async()=>{
                  const next = !torOn;
                  setTorOn(next); setErr(''); setTorError('');
                  setTorMode(next ? 'checking' : 'direct');
                  try {
                    const r = await fetch('/api/network-stats/tor', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ enabled: next }) });
                    const j = await r.json().catch(()=>({}));
                    if (!r.ok && r.status >= 500) throw new Error(j.error || ('server returned ' + r.status));
                    // Backend returns ok=false WITH the reason if Tor unreachable.
                    // Revert optimistic toggle and surface the error.
                    if (next && j.ok === false) {
                      setTorOn(false);
                      setTorMode('unreachable');
                      setTorError(j.error || 'Tor unreachable');
                    } else if (next && j.ok) {
                      setTorMode(j.mode || 'tor');
                    } else if (!next && j.ok) {
                      setTorMode('direct');
                    }
                  } catch(e) {
                    setTorError(e.message); setTorOn(!next); setTorMode(null);
                  }
                }}
                style={{flexShrink:0,width:46,height:24,borderRadius:12,background:torOn?'var(--cyan)':'var(--bg-deep)',border:'1px solid var(--border)',position:'relative',cursor:'pointer',transition:'background 0.2s'}}>
                <div style={{position:'absolute',top:2,left:torOn?24:2,width:18,height:18,borderRadius:'50%',background:torOn?'#000':'var(--text-2)',transition:'left 0.2s'}}/>
              </button>
            </div>
            {torMode === 'checking' && (
              <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-2)',padding:'0.4rem 0.55rem',background:'rgba(255,255,255,0.03)',border:'1px dashed var(--border)',marginTop:6}}>
                ⏳ Testing Tor reachability…
              </div>
            )}
            {torMode === 'tor' && (
              <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--green)',padding:'0.4rem 0.55rem',background:'rgba(0,255,128,0.05)',border:'1px dashed rgba(0,255,128,0.3)',marginTop:6}}>
                🟢 Routing all relays through Tor. Privacy active.
              </div>
            )}
            {torMode === 'unreachable' && (
              <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--amber)',padding:'0.4rem 0.55rem',background:'rgba(245,166,35,0.06)',border:'1px dashed rgba(245,166,35,0.4)',marginTop:6,lineHeight:1.5}}>
                ⚠ Tor unreachable: <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{torError || 'check Umbrel Tor service'}</span>. Pulse continues broadcasting direct.
              </div>
            )}
            {torOn && torMode === 'direct' && (
              <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--amber)',padding:'0.4rem 0.55rem',background:'rgba(245,166,35,0.06)',border:'1px dashed rgba(245,166,35,0.4)',marginTop:6}}>
                🟡 Tor degraded — broadcasts using direct routing. Auto-recovery every 5 min.
              </div>
            )}
          </div>

          {/* Advanced actions */}
          <div style={{padding:'0.7rem 0.8rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:'0.5rem'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.58rem',letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:8}}>Advanced</div>
            <button onClick={async()=>{
              if (!window.confirm('Show your Pulse identity backup?\n\nThis reveals your private signing key. Anyone with this key can sign Pulse events as you.\n\nUse only if you intend to back it up offline (paper, encrypted vault).')) return;
              setErr('');
              try {
                const r = await fetch('/api/network-stats/export-backup', { method:'POST' });
                if (!r.ok) {
                  const j = await r.json().catch(()=>({}));
                  throw new Error(j.error || ('server returned ' + r.status));
                }
                const j = await r.json();
                setBackup(j);
                setBackupCopied(false);
              } catch(e) { setErr(e.message); }
            }}
            style={{display:'block',width:'100%',padding:'0.5rem 0.7rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fd)',fontSize:'0.65rem',letterSpacing:'0.1em',cursor:'pointer',textTransform:'uppercase',marginBottom:6}}>
              🔑 Backup Pulse Identity
            </button>
            <button onClick={regenerate} style={{display:'block',width:'100%',padding:'0.5rem 0.7rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-2)',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.1em',cursor:'pointer',textTransform:'uppercase'}}>
              🔄 Regenerate Identity
            </button>
          </div>

          {/* Backup display modal-style overlay */}
          {backup && (
            <div onClick={()=>setBackup(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',zIndex:400,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'}}>
              <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-elevated, #15161a)',border:'1px solid var(--amber)',maxWidth:560,width:'100%',padding:'1.25rem',boxShadow:'0 0 30px rgba(245,166,35,0.3)'}}>
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
                  <h3 style={{margin:0,fontFamily:'var(--fd)',fontSize:'0.75rem',letterSpacing:'0.18em',color:'var(--amber)'}}>🔑 Identity Backup</h3>
                  <button onClick={()=>setBackup(null)} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:'1.2rem'}}>✕</button>
                </div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.66rem',color:'var(--amber)',padding:'0.55rem',background:'rgba(245,166,35,0.06)',border:'1px solid rgba(245,166,35,0.3)',marginBottom:12,lineHeight:1.5}}>
                  ⚠ {backup.warning}
                </div>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:5}}>Public Key</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-1)',padding:'0.45rem',background:'var(--bg-deep)',border:'1px solid var(--border)',marginBottom:10,wordBreak:'break-all'}}>{backup.pubkey}</div>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:5}}>Private Key (hex)</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--amber)',padding:'0.45rem',background:'var(--bg-deep)',border:'1px solid var(--amber)',marginBottom:10,wordBreak:'break-all'}}>{backup.privkeyHex}</div>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:5}}>Install ID</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-1)',padding:'0.45rem',background:'var(--bg-deep)',border:'1px solid var(--border)',marginBottom:14,wordBreak:'break-all'}}>{backup.installId}</div>
                <div style={{display:'flex',gap:6}}>
                  <button onClick={()=>{ if(navigator.clipboard?.writeText){ navigator.clipboard.writeText(`pubkey: ${backup.pubkey}\nprivkey: ${backup.privkeyHex}\ninstallId: ${backup.installId}`).then(()=>{ setBackupCopied(true); setTimeout(()=>setBackupCopied(false), 2000); }); } }} style={{flex:1,padding:'0.55rem',background:backupCopied?'var(--green)':'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,fontSize:'0.65rem',letterSpacing:'0.1em',cursor:'pointer',textTransform:'uppercase'}}>{backupCopied?'✓ COPIED':'COPY ALL'}</button>
                  <button onClick={()=>setBackup(null)} style={{padding:'0.55rem 0.9rem',background:'transparent',color:'var(--text-2)',border:'1px solid var(--border)',fontFamily:'var(--fd)',fontWeight:600,fontSize:'0.62rem',letterSpacing:'0.1em',cursor:'pointer',textTransform:'uppercase'}}>CLOSE</button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {enabled && (
        <div style={{ marginTop: '0.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
            <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.7rem 0.4rem', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Pools</div>
              <div style={{ fontFamily: 'var(--fd)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1, textShadow: '0 0 14px rgba(245,166,35,0.35)' }}>{ns.pools || 0}</div>
            </div>
            <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.7rem 0.4rem', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Hashrate</div>
              <div style={{ fontFamily: 'var(--fd)', fontSize: '1rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1 }}>{fmtPulseHr(ns.hashrate)}</div>
            </div>
            <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.7rem 0.4rem', textAlign: 'center' }}>
              <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Miners</div>
              <div style={{ fontFamily: 'var(--fd)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1, textShadow: '0 0 14px rgba(245,166,35,0.35)' }}>{ns.workers || 0}</div>
            </div>
          </div>

          <div style={{ padding: '0.65rem', background: 'var(--bg-deep)', border: '1px solid var(--border)', marginBottom: '0.6rem' }}>
            <div style={{ fontFamily: 'var(--fd)', fontSize: '0.55rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 6 }}>Relay status (8 relays)</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
              {Object.entries(ns.relayStatus || {}).map(([url, status]) => (
                <div key={url} style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'var(--fm)', fontSize: '0.6rem' }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: (status==='connected'||status==='connected-tor'||status==='connected-direct') ? 'var(--green)' : status === 'connecting' ? 'var(--amber)' : 'var(--red)' }} />
                  <span style={{ color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {url.replace('wss://', '').replace('relay.', '')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {Object.keys(ns.versions || {}).length > 0 && (
            <div style={{ padding: '0.55rem', background: 'var(--bg-deep)', border: '1px solid var(--border)' }}>
              <div style={{ fontFamily: 'var(--fd)', fontSize: '0.55rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 5 }}>Versions in network</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(ns.versions).map(([v, count]) => (
                  <div key={v} style={{ fontFamily: 'var(--fm)', fontSize: '0.62rem', padding: '2px 6px', background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-2)' }}>v{v}</span>
                    <span style={{ color: 'var(--amber)', marginLeft: 4 }}>×{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {err && (
        <div style={{ marginTop: 10, padding: '0.5rem', background: 'rgba(255,59,59,0.1)', border: '1px solid var(--red)', fontFamily: 'var(--fm)', fontSize: '0.65rem', color: 'var(--red)' }}>
          ⚠ {err}
        </div>
      )}
    </>
  );
}
function fmtPulseHr(h) {
  if (!h) return '0 H/s';
  if (h >= 1e15) return (h / 1e15).toFixed(1) + ' PH/s';
  if (h >= 1e12) return (h / 1e12).toFixed(1) + ' TH/s';
  if (h >= 1e9) return (h / 1e9).toFixed(1) + ' GH/s';
  if (h >= 1e6) return (h / 1e6).toFixed(1) + ' MH/s';
  if (h >= 1e3) return (h / 1e3).toFixed(1) + ' KH/s';
  return Math.round(h) + ' H/s';
}

// ── PulsePanel — Heartbeat dashboard card (v1.7.0) ────────────────────────
function PulsePanel({ networkStats, onOpenSettings }) {
  const ns = networkStats || { enabled: false, pools: 0, hashrate: 0, workers: 0, blocks: 0, versions: {}, relayStatus: {} };
  const enabled = !!ns.enabled;

  // Canvas refs for the EKG-style waveform
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const phaseRef = useRef(0);
  const spikesRef = useRef([]);
  const lastTickRef = useRef(performance.now());
  const lastBroadcastRef = useRef({ hashrate: 0, pools: 0, workers: 0 });
  const canvasWidthRef = useRef(0);
  const canvasHeightRef = useRef(0);
  const dprRef = useRef(window.devicePixelRatio || 1);

  // Set up the canvas — handles HiDPI properly so the waveform stays crisp on retina screens
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      dprRef.current = dpr;
      const cssWidth = Math.max(120, rect.width);
      const cssHeight = 96;
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = cssHeight + 'px';
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      canvasWidthRef.current = cssWidth;
      canvasHeightRef.current = cssHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(resize);
      ro.observe(container);
    } else {
      window.addEventListener('resize', resize);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', resize);
    };
  }, []);

  // The waveform draw loop — runs at 60fps when card is visible.
  // - Idle state: gentle sine undulation (alive but quiet)
  // - Spike state: superimposed peaks travelling left when broadcasts happen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = (now) => {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000); // cap dt to avoid jumps
      lastTickRef.current = now;
      phaseRef.current += dt * (enabled ? 0.7 : 0.25); // slower phase if Pulse is off

      const W = canvasWidthRef.current;
      const H = canvasHeightRef.current;
      if (!W || !H) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // Background grid — very subtle
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(245,166,35,0.06)';
      ctx.lineWidth = 1;
      const gridStep = 16;
      ctx.beginPath();
      for (let x = 0; x < W; x += gridStep) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
      }
      for (let y = 0; y < H; y += gridStep) {
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
      }
      ctx.stroke();

      // Build the waveform
      const midY = H / 2;
      const baseAmp = enabled ? 6 : 2;

      // Move spikes leftward and age them out
      spikesRef.current = spikesRef.current
        .map(s => ({ ...s, x: s.x - dt * 60, age: s.age + dt }))
        .filter(s => s.x > -50 && s.age < 4);

      ctx.lineWidth = 2.2;
      ctx.strokeStyle = enabled ? '#F5A623' : 'rgba(245,166,35,0.4)';
      ctx.shadowColor = enabled ? 'rgba(245,166,35,0.6)' : 'transparent';
      ctx.shadowBlur = enabled ? 8 : 0;

      ctx.beginPath();
      const samples = Math.max(W, 200);
      for (let i = 0; i <= samples; i++) {
        const x = (i / samples) * W;
        const t = phaseRef.current;
        const idle = Math.sin((x / W) * Math.PI * 2 + t) * baseAmp;
        // Layer in spike contributions — Gaussian peak around each spike's x
        let spikeY = 0;
        for (const s of spikesRef.current) {
          const dx = x - s.x;
          const sigma = 18;
          const peak = Math.exp(-(dx * dx) / (2 * sigma * sigma));
          spikeY -= peak * s.intensity * 18 * Math.max(0, 1 - s.age / 4);
        }
        const y = midY + idle + spikeY;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      animationFrameRef.current = requestAnimationFrame(draw);
    };

    animationFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [enabled]);

  // Trigger a spike whenever broadcast values change (i.e. a real heartbeat happened)
  useEffect(() => {
    const last = lastBroadcastRef.current;
    const isFirstRun = last.pools === undefined && last.hashrate === undefined && last.workers === undefined;
    if (!isFirstRun && enabled) {
      const hashrateChanged = last.hashrate !== ns.hashrate;
      const poolsChanged   = last.pools !== ns.pools;
      const workersChanged  = last.workers !== ns.workers;
      if (hashrateChanged || poolsChanged || workersChanged) {
        spikesRef.current.push({ x: canvasWidthRef.current, intensity: 1.3, age: 0 });
      }
    }
    lastBroadcastRef.current = { hashrate: ns.hashrate, pools: ns.pools, workers: ns.workers };
  }, [ns.hashrate, ns.pools, ns.workers, enabled]);

  // Bottom-right "100% SOLO" stamp — rotated, amber, glowing
  const StampSolo = () => (
    <div style={{
      position:'absolute', right:'1rem', bottom:'1rem',
      transform:'rotate(-12deg)',
      fontFamily:'var(--fd)', fontSize:'0.62rem', fontWeight:800,
      letterSpacing:'0.18em', textTransform:'uppercase',
      color:'rgba(245,166,35,0.65)',
      border:'2px solid rgba(245,166,35,0.5)',
      padding:'4px 10px',
      pointerEvents:'none',
      textShadow:'0 0 8px rgba(245,166,35,0.6)',
      boxShadow:'0 0 12px rgba(245,166,35,0.25), inset 0 0 8px rgba(245,166,35,0.15)',
      background:'rgba(245,166,35,0.03)',
      lineHeight:1.2,
      textAlign:'center',
      animation:'pulse 4s ease-in-out infinite',
    }}>
      <div>100%</div>
      <div>SOLO</div>
    </div>
  );

  if (!enabled) {
    return (
      <div style={{...card, position:'relative', minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
        <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)'}}>
          <span>▸ SoloStrike Pulse</span>
          <span style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em', color:'var(--text-3)', marginRight:14}}>OFF</span>
        </div>
        <div style={{textAlign:'center', padding:'1.5rem 0.75rem', color:'var(--text-2)'}}>
          <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>📡</div>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.78rem', color:'var(--text-1)', marginBottom: 6, fontWeight:600}}>Pulse is offline</div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.68rem', color:'var(--text-2)', lineHeight:1.5, maxWidth:300, margin:'0 auto'}}>
            See how many other solo pools are running, combined hashrate, and miner count across the network.
          </div>
          <button
            onClick={onOpenSettings}
            style={{
              marginTop:'0.9rem',
              padding:'0.55rem 1rem',
              background:'var(--amber)', color:'#000',
              border:'none', cursor:'pointer',
              fontFamily:'var(--fd)', fontSize:'0.65rem', fontWeight:700,
              letterSpacing:'0.12em', textTransform:'uppercase',
              boxShadow:'0 0 14px rgba(245,166,35,0.35)',
            }}>
            JOIN PULSE
          </button>
        </div>
        <StampSolo/>
      </div>
    );
  }

  return (
    <div style={{...card, position:'relative', minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)'}}>
        <span>▸ SoloStrike Pulse</span>
        <span style={{display:'inline-flex', alignItems:'center', gap:5, fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.15em', color:'var(--green)', textShadow:'0 0 6px var(--green)', marginRight:14}}>
          <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 6px var(--green)', animation:'pulse 2s ease-in-out infinite'}}/>
          LIVE
        </span>
      </div>

      {/* The heartbeat waveform itself */}
      <div ref={containerRef} style={{
        width:'100%', height:96,
        background:'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(245,166,35,0.02) 100%)',
        border:'1px solid var(--border)',
        marginBottom:'0.7rem',
        position:'relative', overflow:'hidden',
      }}>
        <canvas ref={canvasRef} style={{display:'block', width:'100%', height:'100%'}}/>
      </div>

      {/* The 3 stat tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.7rem' }}>
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.65rem 0.4rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Pools</div>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1, textShadow: '0 0 14px rgba(245,166,35,0.4)' }}>{ns.pools || 0}</div>
        </div>
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.65rem 0.4rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Hashrate</div>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1 }}>{fmtPulseHr(ns.hashrate)}</div>
        </div>
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.65rem 0.4rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Miners</div>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1, textShadow: '0 0 14px rgba(245,166,35,0.4)' }}>{ns.workers || 0}</div>
        </div>
      </div>

      {/* Footer tagline */}
      <div style={{
        borderTop:'1px dashed rgba(245,166,35,0.18)',
        paddingTop:'0.5rem',
        fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)',
        lineHeight:1.5, paddingRight:'4rem' /* leave room for the rotated stamp */,
      }}>
        Pulse is a census, not a pool. <span style={{color:'var(--amber)', fontWeight:600}}>Your blocks stay 100% yours.</span>
      </div>
      <StampSolo/>
    </div>
  );
}

// ── Aliases tab ───────────────────────────────────────────────────────────────
function AliasesTab({workers, aliases, onAliasesChange}) {
  const updateAlias = (workerName, alias) => {
    const next = { ...aliases };
    if (alias && alias.trim()) next[workerName] = alias.trim();
    else delete next[workerName];
    onAliasesChange(next);
  };
  const sorted = [...(workers||[])].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  return (
    <>
      <div style={{padding:'0.65rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:14,fontFamily:'var(--fm)',fontSize:'0.66rem',color:'var(--text-2)',lineHeight:1.5}}>
        Give your workers friendly names. Aliases are stored locally in your browser and only visible to you.
      </div>
      {sorted.length === 0 ? (
        <div style={{textAlign:'center',padding:'2rem',color:'var(--text-2)',fontSize:'0.75rem'}}>No workers yet.</div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {sorted.map(w=>{
            const stripped = stripAddr(w.name);
            return (
              <div key={w.name} style={{display:'flex',alignItems:'center',gap:8,padding:'0.55rem 0.7rem',background:'var(--bg-raised)',border:'1px solid var(--border)'}}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{stripped}</div>
                </div>
                <input type="text" value={aliases[w.name]||''} onChange={e=>updateAlias(w.name, e.target.value)} placeholder="alias…"
                  style={{width:140,padding:'0.4rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.7rem',outline:'none'}}/>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Webhooks tab ──────────────────────────────────────────────────────────────
function WebhooksTab() {
  const [hooks, setHooks] = useState([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState({block_found:true, worker_offline:true, worker_online:false});
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      const r = await fetch('/api/webhooks');
      const j = await r.json();
      setHooks(j.hooks || []);
    } catch (e) { /* swallow */ }
  };
  useEffect(()=>{ load(); }, []);

  const add = async () => {
    setErr('');
    if (!url.trim()) { setErr('URL required'); return; }
    const evList = Object.entries(events).filter(([,v])=>v).map(([k])=>k);
    if (!evList.length) { setErr('Select at least one event'); return; }
    setLoading(true);
    try {
      const r = await fetch('/api/webhooks', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({op:'add', name: name||'Webhook', url, events: evList}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      setName(''); setUrl(''); load();
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  };
  const remove = async (id) => {
    if (!window.confirm('Remove this webhook?')) return;
    try {
      const r = await fetch('/api/webhooks', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({op:'remove', id}),
      });
      if (!r.ok) throw new Error('Failed');
      load();
    } catch (e) { alert(e.message); }
  };

  return (
    <>
      <div style={{padding:'0.65rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:14,fontFamily:'var(--fm)',fontSize:'0.66rem',color:'var(--text-2)',lineHeight:1.5}}>
        Get a HTTP POST when blocks are found or workers go offline. Use Discord, Slack, custom endpoint, etc.
      </div>
      <div style={{marginBottom:14}}>
        <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:4, textTransform:'uppercase'}}>Name</label>
        <input type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="My Discord"
          style={{width:'100%',padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.75rem',outline:'none',boxSizing:'border-box'}}/>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:4, textTransform:'uppercase'}}>URL</label>
        <input type="text" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://..."
          style={{width:'100%',padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.75rem',outline:'none',boxSizing:'border-box'}}/>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:4, textTransform:'uppercase'}}>Events</label>
        {[
          ['block_found','Block found (strike)'],
          ['worker_offline','Worker offline'],
          ['worker_online','Worker online'],
        ].map(([k,v])=>(
          <label key={k} style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',cursor:'pointer'}}>
            <input type="checkbox" checked={!!events[k]} onChange={e=>setEvents({...events, [k]:e.target.checked})} style={{accentColor:'var(--amber)'}}/>
            <span style={{fontFamily:'var(--fm)',fontSize:'0.75rem',color:'var(--text-1)'}}>{v}</span>
          </label>
        ))}
      </div>
      {err && <div style={{padding:'0.5rem', background:'rgba(255,59,59,0.1)', border:'1px solid var(--red)', fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--red)', marginBottom:10}}>⚠ {err}</div>}
      <button onClick={add} disabled={loading} style={{width:'100%',padding:'0.6rem',background:'var(--cyan)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,letterSpacing:'0.1em',fontSize:'0.7rem',cursor:loading?'wait':'pointer',textTransform:'uppercase',marginBottom:14}}>
        {loading ? 'Adding…' : '+ Add Webhook'}
      </button>
      {hooks.length > 0 && (
        <div>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:6, textTransform:'uppercase'}}>Configured ({hooks.length})</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {hooks.map(h=>(
              <div key={h.id} style={{padding:'0.55rem',background:'var(--bg-raised)',border:'1px solid var(--border)',display:'flex',gap:8}}>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)',fontWeight:600}}>{h.name}</div>
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-2)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.url}</div>
                  <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--text-3)',marginTop:3,letterSpacing:'0.05em',textTransform:'uppercase'}}>{(h.events||[]).join(' · ')}</div>
                </div>
                <button onClick={()=>remove(h.id)} style={{background:'transparent',border:'1px solid var(--red)',color:'var(--red)',fontFamily:'var(--fd)',fontSize:'0.55rem',padding:'4px 8px',cursor:'pointer',letterSpacing:'0.1em'}}>REMOVE</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// ── Worker detail modal ───────────────────────────────────────────────────────
function WorkerDetailModal({ worker, onClose, aliases, onAliasesChange, notes, onNotesChange }) {
  const [copied, setCopied] = useState('');
  const [aliasVal, setAliasVal] = useState(aliases[worker.name] || '');
  const [noteVal, setNoteVal] = useState(notes[worker.name] || '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setAliasVal(aliases[worker.name] || '');
    setNoteVal(notes[worker.name] || '');
    setDirty(false);
  }, [worker.name, aliases, notes]);

  const w = worker;
  const on = w.status !== 'offline';
  const raw = w.sharesCount || 0;
  const rawRej = w.rejectedCount || 0;
  const work = w.shares || 0;
  const workRej = w.rejected || 0;
  const totalWork = work + workRej || 1;
  const acceptRate = ((work / totalWork) * 100).toFixed(2);
  const rejectRatio = ((workRej / totalWork) * 100).toFixed(3);
  const se = w.shareEvents || null;
  const seAcc = se?.accepted || 0;
  const seRej = se?.rejected || 0;
  const seStale = se?.stale || 0;
  const seTot = seAcc + seRej + seStale;
  const seAcceptRate = seTot > 0 ? ((seAcc / seTot) * 100).toFixed(3) : null;
  const seReasons = se?.rejectReasons || {};
  const seReasonRows = Object.entries(seReasons).sort((a,b) => b[1] - a[1]);
  const classifySeReason = (reason) => {
    if (/stale|invalid.?jobid|old.?job|expired/i.test(reason)) return 'var(--amber)';
    if (/duplicate|bad.?nonce|coinbase/i.test(reason)) return 'var(--text-2)';
    return 'var(--red)';
  };
  const sharesPerMin = w.hashrate > 0 ? (w.hashrate / 4294967296 * 60).toFixed(1) : '0';
  const healthMap = { green:'🟢 GREEN · fresh shares', amber:'🟡 AMBER · stale or rejects', red:'🔴 RED · offline or failing' };
  const freshness = (() => {
    const age = Date.now() - (w.lastSeen || 0);
    if (age < 2*60*1000) return 'fresh (<2m)';
    if (age < 10*60*1000) return `stale (${Math.floor(age/60000)}m)`;
    return `offline (${Math.floor(age/60000)}m)`;
  })();

  const host = typeof window !== 'undefined' ? window.location.hostname : 'umbrel.local';
  const stratumUrl      = `stratum+tcp://${host}:3333`;
  const stratumUrlHobby = `stratum+tcp://${host}:3334`;
  const minerUrl        = w.ip ? `http://${w.ip}` : null;

  const copy = async (val, lbl) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopied(lbl); setTimeout(() => setCopied(''), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = val; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopied(lbl); setTimeout(()=>setCopied(''),2000); } catch {}
      document.body.removeChild(ta);
    }
  };

  const save = () => {
    const nextA = { ...aliases };
    if (!aliasVal.trim()) delete nextA[w.name]; else nextA[w.name] = aliasVal.trim().slice(0, 32);
    onAliasesChange(nextA);
    const nextN = { ...notes };
    if (!noteVal.trim()) delete nextN[w.name]; else nextN[w.name] = noteVal.trim().slice(0, 200);
    onNotesChange(nextN);
    setDirty(false);
  };

  const exportCsv = () => {
    const rows = [
      ['# generated_at_utc', new Date().toISOString()],
      ['# worker', w.name],
      ['field','value'],
      ['hashrate_hps', w.hashrate || 0],
      ['current_difficulty', w.diff || 0],
      ['best_share', Math.round(w.bestshare || 0)],
      ['work_accepted', work],
      ['work_rejected', workRej],
      ['ip', w.ip || ''],
    ];
    const csv = rows.map(r => r.map(v => {
      const s = String(v == null ? '' : v);
      if (/[,"\n\r]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
      return s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `solostrike-worker-${stripAddr(w.name).replace(/[^A-Za-z0-9]/g,'_')}-${Date.now()}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  };

  const section = { marginBottom:'1rem' };
  const secTitle = { fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--amber)', marginBottom:'0.5rem' };
  const kvRow = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.4rem 0.6rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:3 };
  const kvLabel = { fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };
  const kvVal = { fontFamily:'var(--fm)', fontSize:'0.75rem', color:'var(--text-1)', textAlign:'right', overflow:'hidden', textOverflow:'ellipsis', maxWidth:'65%' };
  const heroBox = { background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.7rem', textAlign:'center' };
  const heroLbl = { fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:4 };
  const heroVal = { fontFamily:'var(--fd)', fontSize:'1.1rem', fontWeight:700, color:'var(--amber)', lineHeight:1 };
  const btn = { padding:'0.55rem 0.7rem', background:'var(--bg-raised)', border:'1px solid var(--border)', color:'var(--text-1)', fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', textTransform:'uppercase', cursor:'pointer', flex:1, minWidth:'48%' };
  const inputStyle = { width:'100%', background:'var(--bg-deep)', border:'1px solid var(--border)', color:'var(--text-1)', fontFamily:'var(--fm)', fontSize:'0.78rem', padding:'0.55rem 0.7rem', outline:'none', boxSizing:'border-box' };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:250,padding:'0.75rem'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:560,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',boxShadow:'var(--glow-a)',maxHeight:'95vh',overflowY:'auto'}}>
        <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'0.75rem'}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:4}}>
              <span style={{fontSize:16,color:'var(--cyan)'}}>{w.minerIcon || '▪'}</span>
              <span style={{fontFamily:'var(--fd)',fontSize:'1.1rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.05em'}}>{displayName(w.name, aliases)}</span>
            </div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.58rem',letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:6}}>
              {w.minerType || 'Unknown miner'}{w.minerVendor && ` · ${w.minerVendor}`}
            </div>
            <div style={{display:'inline-flex',alignItems:'center',gap:5,fontFamily:'var(--fd)',fontSize:'0.58rem',letterSpacing:'0.12em',textTransform:'uppercase'}}>
              <span style={{width:6,height:6,borderRadius:'50%',background:on?'var(--green)':'var(--red)',boxShadow:`0 0 6px ${on?'var(--green)':'var(--red)'}`,animation:on?'pulse 2s ease-in-out infinite':'none'}}/>
              <span style={{color:on?'var(--green)':'var(--red)'}}>{on?'ONLINE':'OFFLINE'}</span>
              <span style={{color:'var(--text-3)',marginLeft:8}}>last share {w.lastSeen?timeAgo(w.lastSeen):'—'}</span>
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:22,padding:'0 4px',flexShrink:0}}>✕</button>
        </div>

        <div style={{padding:'1rem 1.25rem'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'0.5rem',marginBottom:'1rem'}}>
            <div style={heroBox}><div style={heroLbl}>Hashrate</div><div style={heroVal}>{on?fmtHr(w.hashrate):'offline'}</div></div>
            <div style={heroBox}><div style={heroLbl}>Best Diff</div><div style={heroVal}>{fmtDiff(w.bestshare||0)}</div></div>
            <div style={heroBox}><div style={heroLbl}>Work Done</div><div style={{...heroVal,color:'var(--green)'}}>{fmtDiff(work)}</div></div>
            <div style={heroBox}><div style={heroLbl}>Last Share</div><div style={{...heroVal,color:on?'var(--green)':'var(--text-2)'}}>{w.lastSeen?fmtAgoShort(w.lastSeen):'—'}</div></div>
          </div>

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
            {se && seTot > 0 && (
              <>
                <div style={kvRow}><span style={kvLabel}>Accepted (session)</span><span style={{...kvVal,color:'var(--green)'}}>{fmtNum(seAcc)}</span></div>
                <div style={kvRow}><span style={kvLabel}>Rejected (session)</span><span style={{...kvVal,color:seRej > 0 ? 'var(--red)' : 'var(--text-2)'}}>{fmtNum(seRej)}</span></div>
                <div style={kvRow}><span style={kvLabel}>Stale (session)</span><span style={{...kvVal,color:seStale > 0 ? 'var(--amber)' : 'var(--text-2)'}}>{fmtNum(seStale)}</span></div>
                {seAcceptRate != null && <div style={kvRow}><span style={kvLabel}>Accept Rate (session)</span><span style={{...kvVal,color:parseFloat(seAcceptRate)>=99.9?'var(--green)':parseFloat(seAcceptRate)>=99?'var(--amber)':'var(--red)'}}>{seAcceptRate}%</span></div>}
                {se.bestSdiff > 0 && <div style={kvRow}><span style={kvLabel}>Best Share (session)</span><span style={{...kvVal,color:'var(--amber)'}}>{fmtDiff(se.bestSdiff)}</span></div>}
              </>
            )}
            {raw > 0 && <div style={kvRow}><span style={kvLabel}>Raw Shares</span><span style={kvVal}>{fmtNum(raw)}</span></div>}
            {rawRej > 0 && <div style={kvRow}><span style={kvLabel}>Raw Rejected</span><span style={kvVal}>{fmtNum(rawRej)}</span></div>}
            <div style={kvRow}><span style={kvLabel}>Shares/min (est)</span><span style={{...kvVal,color:'var(--cyan)'}}>{sharesPerMin}</span></div>
          </div>

          {seReasonRows.length > 0 && (
            <div style={section}>
              <div style={secTitle}>▸ Reject Reasons</div>
              {seReasonRows.map(([reason, count]) => (
                <div key={reason} style={kvRow}>
                  <span style={{...kvLabel,textTransform:'none',letterSpacing:'0.02em',color:classifySeReason(reason)}}>{reason}</span>
                  <span style={{...kvVal,color:'var(--text-1)',fontWeight:600}}>{fmtNum(count)}</span>
                </div>
              ))}
              {se && se.lastRejectAt && (
                <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-3)',marginTop:'0.4rem'}}>
                  Last reject: {fmtAgoShort(se.lastRejectAt)}
                </div>
              )}
            </div>
          )}

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
  );
}

// ── Layout helpers ────────────────────────────────────────────────────────────
const DEFAULT_ORDER = ['hashrate','workers','network','node','odds','luck','retarget','shares','best','closestcalls','blocks','topfinders','recent','pulse'];
function loadOrder() {
  try {
    const s = localStorage.getItem(LS_CARD_ORDER);
    if (!s) return DEFAULT_ORDER;
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return DEFAULT_ORDER;
    const known = parsed.filter(id => DEFAULT_ORDER.includes(id));
    DEFAULT_ORDER.forEach(id => { if (!known.includes(id)) known.push(id); });
    return known;
  } catch { return DEFAULT_ORDER; }
}
function saveOrder(order) { try { localStorage.setItem(LS_CARD_ORDER, JSON.stringify(order)); } catch {} }
function loadCurrency() { try { return localStorage.getItem(LS_CURRENCY) || 'USD'; } catch { return 'USD'; } }
function saveCurrency(c) { try { localStorage.setItem(LS_CURRENCY, c); } catch {} }

// ── App root ──────────────────────────────────────────────────────────────────
export default function App() {
  const { connected, state: poolState, blockAlert, saveConfig, getConfig } = usePool();
  const lastBlock = blockAlert; // alias — block alert IS the last block info
  const setBlockAlert = () => {}; // no-op since usePool auto-clears
  const refreshConfig = () => { fetch('/api/state').then(r=>r.json()).catch(()=>{}); };
  const [showSettings, setShowSettings] = useState(false);
  const [showShareStats, setShowShareStats] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [order, setOrder] = useState(loadOrder());
  const [draggedId, setDraggedId] = useState(null);
  const [overId, setOverId] = useState(null);
  const [currency, setCurrencyState] = useState(loadCurrency());
  const [aliases, setAliases] = useState(loadAliases());
  const [notes, setNotes] = useState(loadNotes());
  const [selectedWorker, setSelectedWorker] = useState(null);
  const [stripSettings, setStripSettings] = useState({
    enabled: loadStripEnabled(), metricIds: loadStripMetrics(),
    chunkSize: loadStripChunk(), fadeMs: loadStripFade(),
  });
  const [tickerSettings, setTickerSettings] = useState({
    enabled: loadTickerEnabled(), speedSec: loadTickerSpeed(), metricIds: loadTickerMetrics(),
  });
  const [minimalMode, setMinimalMode] = useState(loadMinimalMode());
  const [visibleCards, setVisibleCards] = useState(loadVisibleCards());
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

  const onCurrencyChange = (c) => { setCurrencyState(c); saveCurrency(c); };
  const onResetLayout = () => { setOrder(DEFAULT_ORDER); saveOrder(DEFAULT_ORDER); };
  const onAliasesChange = (a) => { setAliases(a); saveAliases(a); };
  const onNotesChange = (n) => { setNotes(n); saveNotes(n); };
  const onMinimalModeChange = (v) => { setMinimalMode(v); saveMinimalMode(v); };
  const onVisibleCardsChange = (list) => { setVisibleCards(list); saveVisibleCards(list); };

  const onStripSettingsChange = useCallback((next) => {
    setStripSettings(next);
    saveStripEnabled(next.enabled);
    saveStripMetrics(next.metricIds);
    saveStripChunk(next.chunkSize);
    saveStripFade(next.fadeMs);
  }, []);
  const onTickerSettingsChange = useCallback((next) => {
    setTickerSettings(next);
    saveTickerEnabled(next.enabled);
    saveTickerSpeed(next.speedSec);
    saveTickerMetrics(next.metricIds);
  }, []);

  // First-time onboarding
  useEffect(() => {
    if (poolState && !poolState.payoutAddress && !hasCompletedWizard()) {
      setShowOnboarding(true);
    }
  }, [poolState?.payoutAddress]);

  // Drag handlers
  const onDragStart = (id) => setDraggedId(id);
  const onDragOver = (id) => setOverId(id);
  const onDrop = (id) => {
    if (!draggedId || draggedId === id) { setDraggedId(null); setOverId(null); return; }
    const next = [...order];
    const fromIdx = next.indexOf(draggedId);
    const toIdx = next.indexOf(id);
    if (fromIdx >= 0 && toIdx >= 0) {
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, draggedId);
      setOrder(next);
      saveOrder(next);
    }
    setDraggedId(null); setOverId(null);
  };

  // Filter workers: build sorted live array
  const workers = useMemo(() => Object.values(poolState?.workers || {}), [poolState?.workers]);

  // Build ticker text
  const tickerText = useMemo(() => {
    if (!tickerSettings.enabled || !tickerSettings.metricIds?.length) return '';
    return tickerSettings.metricIds.map(id => {
      const m = METRIC_MAP[id];
      if (!m) return null;
      const out = m.render(poolState||{}, aliases, currency, poolState?.uptime) || {};
      const v = out.value != null ? out.value : '—';
      const p = out.prefix != null ? out.prefix : m.label.toUpperCase();
      return `${p} ${v}`;
    }).filter(Boolean).join('   ·   ');
  }, [tickerSettings, poolState, aliases, currency]);

  if (!connected && !poolState) {
    return (
      <div style={{height:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-2)',fontFamily:'var(--fd)',letterSpacing:'0.15em',fontSize:'0.85rem'}}>
        ⛏ Connecting to pool…
      </div>
    );
  }

  if (showOnboarding) {
    return (
      <OnboardingWizard
        onComplete={async (data) => {
          await saveConfig(data);
          setShowOnboarding(false);
        }}
        onSkip={() => setShowOnboarding(false)}
      />
    );
  }

  if (poolState && !poolState.payoutAddress) {
    return (
      <>
        <Header connected={connected} status="setup" onSettings={()=>setShowSettings(true)} privateMode={!!poolState.privateMode} minimalMode={minimalMode} zmq={poolState?.zmq}/>
        <SetupForm saveConfig={saveConfig}/>
        {showSettings && (
          <SettingsModal
            onClose={()=>setShowSettings(false)}
            saveConfig={saveConfig}
            currentConfig={poolState}
            currency={currency} onCurrencyChange={onCurrencyChange}
            onResetLayout={onResetLayout}
            workers={workers} aliases={aliases} onAliasesChange={onAliasesChange}
            stripSettings={stripSettings} onStripSettingsChange={onStripSettingsChange}
            tickerSettings={tickerSettings} onTickerSettingsChange={onTickerSettingsChange}
            minimalMode={minimalMode} onMinimalModeChange={onMinimalModeChange}
            visibleCards={visibleCards} onVisibleCardsChange={onVisibleCardsChange}
            networkStats={poolState?.networkStats}
            onNetworkStatsRefresh={refreshConfig}
          />
        )}
      </>
    );
  }

  const status = poolState?.status || 'loading';
  const ns = poolState?.networkStats || {};

  const cardComponents = {
    hashrate: <HashrateChart history={poolState?.hashrate?.history} week={poolState?.hashrate?.week} current={poolState?.hashrate?.current||0}/>,
    workers: <WorkerGrid workers={workers} aliases={aliases} onWorkerClick={setSelectedWorker}/>,
    network: <NetworkStats network={poolState?.network} blockReward={poolState?.blockReward} mempool={poolState?.mempool} prices={poolState?.prices} currency={currency} privateMode={!!poolState?.privateMode}/>,
    node: <BitcoinNodePanel nodeInfo={poolState?.nodeInfo}/>,
    odds: <OddsDisplay odds={poolState?.odds} hashrate={poolState?.hashrate?.current} netHashrate={poolState?.network?.hashrate}/>,
    luck: <LuckGauge luck={poolState?.luck}/>,
    retarget: <RetargetPanel retarget={poolState?.retarget}/>,
    shares: <ShareStats shares={poolState?.shares} hashrate={poolState?.hashrate?.current} bestshare={poolState?.bestshare} onOpen={()=>setShowShareStats(true)}/>,
    best: <BestShareLeaderboard workers={workers} poolBest={poolState?.bestshare} aliases={aliases}/>,
    closestcalls: <ClosestCallsPanel closestCalls={poolState?.snapshots?.closestCalls} aliases={aliases}/>,
    blocks: <BlockFeed blocks={poolState?.blocks} blockAlert={blockAlert}/>,
    topfinders: <TopFindersPanel topFinders={poolState?.topFinders} netBlocks={poolState?.netBlocks}/>,
    recent: <RecentBlocksPanel netBlocks={poolState?.netBlocks}/>,
    pulse: <PulsePanel networkStats={poolState?.networkStats} onOpenSettings={()=>setShowSettings(true)}/>,
  };

  const visibleSet = new Set(minimalMode ? MINIMAL_PRESET : visibleCards);
  const renderableOrder = order.filter(id => visibleSet.has(id) && cardComponents[id]);

  return (
    <>
      <Header connected={connected} status={status} onSettings={()=>setShowSettings(true)} privateMode={!!poolState?.privateMode} minimalMode={minimalMode} zmq={poolState?.zmq}/>
      {!minimalMode && (
        <>
          <CustomizableTopStrip
            state={poolState}
            aliases={aliases}
            currency={currency}
            uptime={poolState?.uptime}
            enabled={stripSettings.enabled}
            metricIds={stripSettings.metricIds}
            chunkSize={stripSettings.chunkSize}
            fadeMs={stripSettings.fadeMs}
          />
          <LatestBlockStrip netBlocks={poolState?.netBlocks} blockReward={poolState?.blockReward}/>
          <SyncWarningBanner sync={poolState?.sync}/>
          <Ticker snapshotText={tickerText} enabled={tickerSettings.enabled} speedSec={tickerSettings.speedSec}/>
        </>
      )}
      <main style={{padding:'0.65rem'}}>
        <div className="ss-grid">
          {renderableOrder.map(id => (
            <DraggableCard key={id} id={id} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} draggedId={draggedId}>
              {cardComponents[id]}
            </DraggableCard>
          ))}
        </div>
      </main>
      <footer style={{borderTop:'1px solid var(--border)',padding:'0.6rem 1rem',display:'flex',justifyContent:'space-between',alignItems:'center',fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--text-3)',letterSpacing:'0.08em',textTransform:'uppercase',gap:'0.5rem',flexWrap:'wrap',width:'100%',maxWidth:'100%',boxSizing:'border-box'}}>
        <span>SoloStrike v1.7.4 — ckpool-solo{poolState?.privateMode && ' · 🔒 PRIVATE'}{minimalMode && ' · MIN'}</span>
        <a href="https://github.com/danhaus93-ops/solostrike-umbrel" target="_blank" rel="noopener noreferrer" title="View source on GitHub" style={{display:'inline-flex', alignItems:'center', justifyContent:'center', color:'var(--text-2)', textDecoration:'none', padding:'2px 6px', lineHeight:1, flexShrink:0}}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
        <span>Ports <PortLight health={stratumHealth} port="3333"/> · <PortLight health={stratumHealth} port="3334"/> · 🔒 <PortLight health={stratumHealth} port="4333"/></span>
      </footer>

      <BlockAlert show={!!blockAlert} block={lastBlock} onDismiss={()=>setBlockAlert(false)}/>
      <OfflineToasts workers={workers} aliases={aliases}/>
      {selectedWorker && (
        <WorkerDetailModal worker={selectedWorker} onClose={()=>setSelectedWorker(null)}
          aliases={aliases} onAliasesChange={onAliasesChange}
          notes={notes} onNotesChange={onNotesChange}/>
      )}
      {showShareStats && (
        <ShareStatsModal shares={poolState?.shares} workers={workers} aliases={aliases}
          onClose={()=>setShowShareStats(false)} onWorkerSelect={setSelectedWorker}
          trackingSince={poolState?.shareStatsStartedAt}/>
      )}
      {showSettings && (
        <SettingsModal
          onClose={()=>setShowSettings(false)}
          saveConfig={saveConfig}
          currentConfig={poolState}
          currency={currency} onCurrencyChange={onCurrencyChange}
          onResetLayout={onResetLayout}
          workers={workers} aliases={aliases} onAliasesChange={onAliasesChange}
          stripSettings={stripSettings} onStripSettingsChange={onStripSettingsChange}
          tickerSettings={tickerSettings} onTickerSettingsChange={onTickerSettingsChange}
          minimalMode={minimalMode} onMinimalModeChange={onMinimalModeChange}
          visibleCards={visibleCards} onVisibleCardsChange={onVisibleCardsChange}
          networkStats={poolState?.networkStats}
          onNetworkStatsRefresh={refreshConfig}
        />
      )}
    </>
  );
}
