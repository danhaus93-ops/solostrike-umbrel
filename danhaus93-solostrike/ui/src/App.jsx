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
  if (!closestCalls?.length) {
    return (
      <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
        <div style={{...cardTitle, color:'var(--amber)'}}>▸ Near Strikes</div>
        <div style={{textAlign:'center', padding:'1rem', color:'var(--text-3)', fontSize:'0.8rem', fontFamily:'var(--fd)', letterSpacing:'0.05em'}}>
          📊 Stats loading...
          <div style={{fontSize:'0.65rem', marginTop:6, color:'var(--text-3)', fontFamily:'var(--fm)'}}>
            High-diff shares appear here as your miners hash.
          </div>
        </div>
      </div>
    );
  }

  const top = closestCalls.slice(0, 10);
  const bestVal = top[0]?.diff || 1;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <span>▸ Near Strikes</span>
        <span title="All-time top high-diff shares your pool found. Each is a near miss." style={{
          fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--text-3)',
          background:'var(--bg-raised)', padding:'2px 6px', border:'1px solid var(--border)',
          marginRight:'14px',
        }}>ALL-TIME</span>
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:6}}>
        {top.map((cc, i) => {
          const pct = (cc.diff / bestVal) * 100;
          const dispName = displayName(cc.workerName, aliases);
          return (
            <div key={i} style={{
              padding:'0.55rem 0.75rem',
              background:'var(--bg-raised)', border:'1px solid var(--border)',
              borderLeft: i===0 ? '3px solid var(--amber)' : i===1 ? '3px solid var(--cyan)' : i===2 ? '3px solid #c9b27a' : '3px solid transparent',
            }}>
              <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:5}}>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',color: i===0?'var(--amber)':'var(--text-3)', minWidth:24, textAlign:'right', fontWeight:600}}>
                  {i===0?'★':`#${i+1}`}
                </span>
                <span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--amber)',fontWeight:700, textShadow:i===0?'0 0 8px rgba(245,166,35,0.4)':'none'}}>
                  {fmtDiff(cc.diff)}
                </span>
                <span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-2)',flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {dispName}
                </span>
                <span style={{fontFamily:'var(--fm)',fontSize:'0.55rem',color:'var(--text-3)', whiteSpace:'nowrap'}}>
                  {timeAgo(cc.foundAt)}
                </span>
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8}}>
                <div style={{flex:1, height:3, background:'var(--bg-deep)', borderRadius:1, overflow:'hidden'}}>
                  <div style={{
                    height:'100%', width:`${pct}%`,
                    background: i===0?'linear-gradient(90deg, var(--amber), #ff9d3a)':'linear-gradient(90deg, var(--cyan), var(--amber))',
                    boxShadow: i===0?'0 0 6px rgba(245,166,35,0.4)':'none',
                  }}/>
                </div>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--text-3)', minWidth:42, textAlign:'right'}}>
                  {pct.toFixed(1)}%
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{textAlign:'center',marginTop:10,fontSize:'0.6rem',color:'var(--text-3)',fontFamily:'var(--fd)',letterSpacing:'0.1em'}}>
        ⚡ Each spike is a near miss
      </div>
    </div>
  );
}

// ── Network stats ─────────────────────────────────────────────────────────────
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

// ── Bitcoin Node ──────────────────────────────────────────────────────────────
function BitcoinNodePanel({ nodeInfo }) {
  if (!nodeInfo) {
    return (
      <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
        <div style={cardTitle}>▸ Bitcoin Node</div>
        <div style={{padding:'0.5rem 0', color:'var(--text-3)', fontSize:'0.78rem', fontFamily:'var(--fm)', textAlign:'center'}}>Connecting...</div>
      </div>
    );
  }
  const { name, version } = parseClient(nodeInfo.subversion);
  const peers = nodeInfo.peers || 0;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Bitcoin Node</div>
      <div style={statRow}>
        <span style={label}>Node Status</span>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:'var(--green)',textShadow:'0 0 6px var(--green)',display:'flex',alignItems:'center',gap:6}}>
          <span style={{width:6,height:6,borderRadius:'50%',background:'var(--green)',boxShadow:'0 0 6px var(--green)',animation:'pulse 2s ease-in-out infinite'}}/>
          ONLINE
        </span>
      </div>
      <div style={statRow}>
        <span style={label}>Client</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{name} {version}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Block Height</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{fmtNum(nodeInfo.blocks)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Connected Peers</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color: peers>=8?'var(--green)':peers>=4?'var(--amber)':'var(--red)'}}>{peers}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Mempool</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{nodeInfo.mempoolTxs ? `${fmtNum(nodeInfo.mempoolTxs)} TXs · ${fmtBytes(nodeInfo.mempoolBytes)}` : '—'}</span>
      </div>
    </div>
  );
}

// ── Odds ──────────────────────────────────────────────────────────────────────
function OddsDisplay({ odds, hashrate, netHashrate }) {
  if (!odds || !hashrate) {
    return (
      <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
        <div style={cardTitle}>▸ Strike Odds</div>
        <div style={{padding:'0.5rem 0', color:'var(--text-3)', fontSize:'0.78rem', fontFamily:'var(--fm)', textAlign:'center'}}>Computing...</div>
      </div>
    );
  }
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Strike Odds</div>
      <div style={{textAlign:'center', marginBottom:14}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'1.6rem', fontWeight:700, color:'var(--amber)', textShadow:'0 0 18px rgba(245,166,35,0.4)', lineHeight:1}}>
          {fmtOdds(odds.perBlock)}
        </div>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.18em', color:'var(--text-3)', textTransform:'uppercase', marginTop:4}}>Per Block · 1-in-{Math.round(1/odds.perBlock).toLocaleString()}</div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6}}>
        {[['Day', odds.perDay], ['Week', odds.perWeek], ['Month', odds.perMonth]].map(([l, v]) => (
          <div key={l} style={{textAlign:'center', padding:'0.5rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', color:'var(--text-3)', textTransform:'uppercase'}}>{l}</div>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.95rem', color:'var(--cyan)', fontWeight:700, marginTop:2}}>{fmtPct(v)}</div>
          </div>
        ))}
      </div>
      {odds.expectedDays!=null && (
        <div style={{textAlign:'center', marginTop:12, fontFamily:'var(--fd)', fontSize:'0.6rem', color:'var(--text-2)', letterSpacing:'0.1em', textTransform:'uppercase'}}>
          ETA · ~{fmtNum(Math.round(odds.expectedDays))} days
        </div>
      )}
    </div>
  );
}

// ── Luck gauge ────────────────────────────────────────────────────────────────
function LuckGauge({ luck }) {
  if (!luck) return null;
  const pct = Math.max(0, Math.min(200, luck.luck != null ? luck.luck : (luck.progress * 100)));
  let color = 'var(--cyan)';
  let status = 'GRINDING';
  if (luck.luck != null) {
    if (luck.luck > 150)      { color = 'var(--green)'; status = '🔥 BLAZING'; }
    else if (luck.luck > 100) { color = 'var(--amber)'; status = '⚡ HOT'; }
    else if (luck.luck > 50)  { color = 'var(--cyan)';  status = '○ STEADY'; }
    else                       { color = 'var(--text-2)'; status = '◌ COLD'; }
  }
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Hot Streak</div>
      <div style={{textAlign:'center', marginBottom:'0.6rem'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'2rem', fontWeight:700, color, textShadow:`0 0 14px ${color}`, lineHeight:1}}>
          {luck.luck!=null ? `${pct.toFixed(0)}%` : `${(luck.progress*100).toFixed(1)}%`}
        </div>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.18em', color:'var(--text-3)', textTransform:'uppercase', marginTop:4}}>{status}</div>
      </div>
      <div style={{height:6, background:'var(--bg-deep)', overflow:'hidden', marginBottom:'0.5rem'}}>
        <div style={{height:'100%', width:`${Math.min(100, pct/2)}%`, background:`linear-gradient(90deg, var(--cyan), ${color})`, boxShadow:`0 0 8px ${color}`}}/>
      </div>
      <div style={{display:'flex', justifyContent:'space-between', fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-3)', letterSpacing:'0.1em'}}>
        <span>0%</span><span>100%</span><span>200%</span>
      </div>
      <div style={{display:'flex', justifyContent:'space-between', marginTop:8, padding:'0.5rem 0.75rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
        <span style={label}>Found / Expected</span>
        <span style={{fontFamily:'var(--fm)', color:'var(--text-1)'}}>{luck.blocksFound} / {luck.blocksExpected.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ── Retarget panel ────────────────────────────────────────────────────────────
function RetargetPanel({ retarget }) {
  if (!retarget) return null;
  const pct = retarget.changePct;
  const color = pct > 0 ? 'var(--red)' : 'var(--green)';
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Difficulty Retarget</div>
      <div style={statRow}>
        <span style={label}>Blocks Left</span>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:'var(--cyan)',textShadow:'0 0 6px var(--cyan)'}}>{fmtNum(retarget.blocksLeft)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>ETA</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{retarget.etaDays.toFixed(1)} d</span>
      </div>
      <div style={{...statRow, borderColor: pct === 0 ? 'var(--border)' : color, marginTop:10}}>
        <span style={{...label, color: pct === 0 ? 'var(--text-2)' : color}}>Δ Difficulty</span>
        <span style={{fontFamily:'var(--fd)',fontSize:'1rem',fontWeight:700,color, textShadow:`0 0 8px ${color}`}}>
          {pct > 0 ? '+' : ''}{pct.toFixed(2)}%
        </span>
      </div>
    </div>
  );
}

// ── Share Stats Modal ─────────────────────────────────────────────────────────
function ShareStatsModal({ shares, workers, aliases, onClose, onWorkerSelect, trackingSince }) {
  if (!shares) return null;

  const accepted    = shares.acceptedCount || 0;
  const rejected    = shares.rejectedCount || 0;
  const stale       = shares.stale || 0;
  const total       = accepted + rejected;
  const acceptPct   = total > 0 ? (accepted / total) * 100 : 100;
  const rejectPct   = total > 0 ? (rejected / total) * 100 : 0;
  const stalePct    = total > 0 ? (stale / total) * 100 : 0;
  const reasons     = shares.rejectReasons || {};
  const reasonRows  = Object.entries(reasons).sort((a,b) => b[1] - a[1]);

  // Fairness analysis on workers (compare accept rate vs pool average)
  const workerStats = (workers || []).map(w => {
    const wAcc = w.shareEvents?.accepted || 0;
    const wRej = w.shareEvents?.rejected || 0;
    const wStale = w.shareEvents?.stale || 0;
    const wTotal = wAcc + wRej + wStale;
    const wAcceptPct = wTotal > 0 ? (wAcc / wTotal) * 100 : null;
    const wRejPct = wTotal > 0 ? (wRej / wTotal) * 100 : 0;
    const wStalePct = wTotal > 0 ? (wStale / wTotal) * 100 : 0;
    return {
      name: w.name,
      displayName: displayName(w.name, aliases),
      total: wTotal,
      accepted: wAcc,
      rejected: wRej,
      stale: wStale,
      acceptPct: wAcceptPct,
      rejPct: wRejPct,
      stalePct: wStalePct,
      reasons: w.shareEvents?.rejectReasons || {},
    };
  }).filter(w => w.total > 0).sort((a,b) => (a.acceptPct || 100) - (b.acceptPct || 100));

  // Reason classification
  const classifyReason = (reason) => {
    if (/stale|invalid.?jobid|old.?job|expired/i.test(reason)) return { color:'var(--amber)', cause:'NETWORK' };
    if (/duplicate/i.test(reason)) return { color:'var(--amber)', cause:'DUPLICATE' };
    if (/bad.?nonce|coinbase|coinbase2/i.test(reason)) return { color:'var(--text-2)', cause:'PROTOCOL' };
    return { color:'var(--red)', cause:'MINER' };
  };

  const trackedSince = trackingSince ? new Date(trackingSince) : null;
  const trackedSinceText = trackedSince ? trackedSince.toLocaleDateString() : 'unknown';

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:250,padding:'0.75rem'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:600,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',boxShadow:'var(--glow-a)',maxHeight:'95vh',overflowY:'auto'}}>
        <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <div style={{fontFamily:'var(--fd)',fontSize:'1rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.06em',marginBottom:2}}>
              Share Stats Diagnostic
            </div>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-3)'}}>
              Tracking since {trackedSinceText}
            </div>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:22,padding:'0 4px'}}>✕</button>
        </div>

        <div style={{padding:'1rem 1.25rem'}}>
          {/* Hero stats */}
          <div style={{textAlign:'center', marginBottom:'1rem'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'2.6rem',fontWeight:700,color:'var(--green)',textShadow:'0 0 18px rgba(57,255,106,0.4)',lineHeight:1}}>
              {acceptPct.toFixed(2)}%
            </div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.18em',color:'var(--text-3)',textTransform:'uppercase',marginTop:4}}>
              Accept Rate
            </div>
          </div>

          {/* Stacked bar */}
          <div style={{display:'flex', height:16, marginBottom:14, borderRadius:2, overflow:'hidden', boxShadow:'0 0 8px rgba(0,0,0,0.4)'}}>
            <div title={`${accepted} accepted (${acceptPct.toFixed(2)}%)`} style={{flex:acceptPct, background:'linear-gradient(90deg, var(--green) 0%, #2ed158 100%)', minWidth: acceptPct > 0 ? 4 : 0}}/>
            {rejPct > 0 && <div title={`${rejected} rejected (${rejPct.toFixed(2)}%)`} style={{flex:rejPct, background:'linear-gradient(90deg, var(--red) 0%, #d12e2e 100%)', minWidth:4}}/>}
            {stalePct > 0 && <div title={`${stale} stale (${stalePct.toFixed(2)}%)`} style={{flex:stalePct, background:'linear-gradient(90deg, var(--amber) 0%, #d18b1f 100%)', minWidth:4}}/>}
          </div>

          {/* Counts */}
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:14}}>
            <div style={{textAlign:'center', padding:'0.6rem', background:'var(--bg-raised)', border:'1px solid rgba(57,255,106,0.2)'}}>
              <div style={{fontFamily:'var(--fd)',fontSize:'1.1rem',color:'var(--green)',fontWeight:700}}>{fmtNum(accepted)}</div>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase',marginTop:2}}>Accepted</div>
            </div>
            <div style={{textAlign:'center', padding:'0.6rem', background:'var(--bg-raised)', border: rejected > 0 ? '1px solid rgba(255,59,59,0.3)' : '1px solid var(--border)'}}>
              <div style={{fontFamily:'var(--fd)',fontSize:'1.1rem',color:rejected>0?'var(--red)':'var(--text-2)',fontWeight:700}}>{fmtNum(rejected)}</div>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase',marginTop:2}}>Rejected</div>
            </div>
            <div style={{textAlign:'center', padding:'0.6rem', background:'var(--bg-raised)', border: stale > 0 ? '1px solid rgba(245,166,35,0.3)' : '1px solid var(--border)'}}>
              <div style={{fontFamily:'var(--fd)',fontSize:'1.1rem',color:stale>0?'var(--amber)':'var(--text-2)',fontWeight:700}}>{fmtNum(stale)}</div>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase',marginTop:2}}>Stale</div>
            </div>
          </div>

          {/* Reject reasons */}
          {reasonRows.length > 0 && (
            <>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.18em',color:'var(--amber)',textTransform:'uppercase',marginBottom:8,marginTop:14}}>
                Rejection Reasons
              </div>
              <div style={{display:'flex', flexDirection:'column', gap:5, marginBottom:14}}>
                {reasonRows.map(([reason, count]) => {
                  const meta = classifyReason(reason);
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={reason} style={{padding:'0.5rem 0.7rem', background:'var(--bg-raised)', border:'1px solid var(--border)', display:'flex', alignItems:'center', gap:8}}>
                      <span style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.1em',color:meta.color,padding:'2px 5px',border:`1px solid ${meta.color}`,textTransform:'uppercase',flexShrink:0}}>{meta.cause}</span>
                      <span style={{flex:1,fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={reason}>{reason}</span>
                      <span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:meta.color,fontWeight:700,whiteSpace:'nowrap'}}>{fmtNum(count)}</span>
                      <span style={{fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--text-3)',minWidth:36,textAlign:'right'}}>{pct.toFixed(2)}%</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Per-worker (only show those with rejects/stales OR those clearly worse than pool) */}
          {workerStats.length > 0 && (
            <>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.18em',color:'var(--amber)',textTransform:'uppercase',marginBottom:8,marginTop:14}}>
                Per-worker Health <span style={{color:'var(--text-3)',fontSize:'0.55rem',marginLeft:6,fontWeight:400}}>({workerStats.length})</span>
              </div>
              <div style={{display:'flex', flexDirection:'column', gap:5}}>
                {workerStats.map(w => {
                  const isHealthy = (w.acceptPct || 100) >= 99 && w.rejected === 0 && w.stale === 0;
                  const isProblematic = (w.acceptPct != null && w.acceptPct < 95) || w.rejected > 50;
                  const acceptColor = isHealthy ? 'var(--green)' : isProblematic ? 'var(--red)' : 'var(--amber)';
                  const topReason = Object.entries(w.reasons).sort((a,b)=>b[1]-a[1])[0];
                  return (
                    <div key={w.name}
                      onClick={() => onWorkerSelect && onWorkerSelect({ name: w.name })}
                      style={{padding:'0.55rem 0.7rem', background:'var(--bg-raised)', border:`1px solid ${isProblematic ? 'rgba(255,59,59,0.3)' : 'var(--border)'}`, cursor:'pointer'}}>
                      <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:3}}>
                        <span style={{flex:1,fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500}}>{w.displayName}</span>
                        <span style={{fontFamily:'var(--fd)',fontSize:'0.85rem',color:acceptColor,fontWeight:700}}>{w.acceptPct != null ? `${w.acceptPct.toFixed(2)}%` : '—'}</span>
                      </div>
                      <div style={{display:'flex', gap:8, fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)'}}>
                        <span>{fmtNum(w.accepted)}<span style={{color:'var(--text-3)',marginLeft:2}}>acc</span></span>
                        {w.rejected > 0 && <span style={{color:'var(--red)'}}>{fmtNum(w.rejected)}<span style={{color:'var(--text-3)',marginLeft:2}}>rej</span></span>}
                        {w.stale > 0 && <span style={{color:'var(--amber)'}}>{fmtNum(w.stale)}<span style={{color:'var(--text-3)',marginLeft:2}}>stale</span></span>}
                        {topReason && <span style={{marginLeft:'auto',color:'var(--text-2)'}}>{topReason[0]}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Footer hint */}
          <div style={{marginTop:'1rem',padding:'0.6rem',background:'var(--bg-deep)',border:'1px dashed var(--border)',fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-2)',lineHeight:1.5}}>
            <strong style={{color:'var(--cyan)'}}>How to read this:</strong> Healthy pools sit at <span style={{color:'var(--green)'}}>99-100%</span> accept. Anything below 95% needs attention. <strong style={{color:'var(--amber)'}}>Stale</strong> shares = your miner submitted on an old job (network or clock drift). <strong style={{color:'var(--red)'}}>Rejected</strong> = miner-side problem (firmware, freq too high, bad nonce).
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Share Stats card (with optional Diagnose CTA) ─────────────────────────────
function ShareStats({ shares, hashrate, bestshare, onOpen }) {
  if (!shares) return null;
  const accepted = shares.acceptedCount || 0;
  const rejected = shares.rejectedCount || 0;
  const stale    = shares.stale || 0;
  const total    = accepted + rejected;
  const acceptPct = total > 0 ? (accepted / total) * 100 : 100;
  const hasIssues = rejected > 0 || stale > 0 || Object.keys(shares.rejectReasons || {}).length > 0;

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <span>▸ Share Stats</span>
        {hasIssues && (
          <button onClick={onOpen} style={{
            fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',color:'var(--cyan)',
            background:'transparent',border:'1px solid rgba(0,255,209,0.3)',padding:'3px 8px',
            cursor:'pointer',textTransform:'uppercase', marginRight:'14px'
          }}>Diagnose</button>
        )}
      </div>
      <div style={{textAlign:'center', marginBottom:'0.75rem'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'2.4rem', fontWeight:700, color:'var(--green)', textShadow:'0 0 18px rgba(57,255,106,0.4)', lineHeight:1}}>
          {acceptPct.toFixed(2)}%
        </div>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.18em', color:'var(--text-3)', textTransform:'uppercase', marginTop:4}}>Accept Rate</div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, marginBottom:8}}>
        <div style={{textAlign:'center', padding:'0.5rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.95rem',color:'var(--green)',fontWeight:700}}>{fmtNum(accepted)}</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Accepted</div>
        </div>
        <div style={{textAlign:'center', padding:'0.5rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.95rem',color: rejected>0?'var(--red)':'var(--text-2)',fontWeight:700}}>{fmtNum(rejected)}</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Rejected</div>
        </div>
        <div style={{textAlign:'center', padding:'0.5rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.95rem',color:stale>0?'var(--amber)':'var(--text-2)',fontWeight:700}}>{fmtNum(stale)}</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Stale</div>
        </div>
      </div>
      {bestshare>0 && (
        <div style={{...statRow, marginTop:8}}>
          <span style={label}>Best Share</span>
          <span style={{fontFamily:'var(--fm)',color:'var(--amber)',fontWeight:600}}>{fmtDiff(bestshare)}</span>
        </div>
      )}
    </div>
  );
}

// ── Best share leaderboard ────────────────────────────────────────────────────
function BestShareLeaderboard({ workers, poolBest, aliases }) {
  const sorted = [...(workers||[])].filter(w=>(w.bestshare||0)>0).sort((a,b)=>(b.bestshare||0)-(a.bestshare||0)).slice(0,5);
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <span>▸ Top Diggers</span>
        {poolBest>0 && <span style={{color:'var(--amber)', marginRight:'14px', whiteSpace:'nowrap'}}>POOL BEST {fmtDiff(poolBest)}</span>}
      </div>
      {sorted.length===0 ? (
        <div style={{textAlign:'center', padding:'1rem', color:'var(--text-3)', fontSize:'0.78rem', fontFamily:'var(--fd)'}}>
          ⛏ No high-diff shares yet
        </div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:4}}>
          {sorted.map((w,i)=>{
            const disp = displayName(w.name, aliases);
            return (
              <div key={w.name} style={{display:'flex', alignItems:'center', gap:8, padding:'0.5rem 0.75rem', background:'var(--bg-raised)', border:'1px solid var(--border)', borderLeft: i===0?'3px solid var(--amber)':'3px solid transparent'}}>
                <span style={{fontFamily:'var(--fd)', fontSize:'0.7rem', fontWeight:600, color:i===0?'var(--amber)':'var(--text-3)', minWidth:28, textAlign:'right'}}>
                  {i===0 ? '👑' : `#${i+1}`}
                </span>
                <span style={{flex:1, fontFamily:'var(--fm)', fontSize:'0.78rem', color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
                  {disp}
                  {w.minerType && <span style={{fontFamily:'var(--fd)', fontSize:'0.5rem', color:'var(--text-3)', marginLeft:8, letterSpacing:'0.1em', textTransform:'uppercase'}}>{w.minerType}</span>}
                </span>
                <span style={{fontFamily:'var(--fd)', fontSize:'0.85rem', fontWeight:700, color:'var(--amber)', minWidth:60, textAlign:'right'}}>
                  {fmtDiff(w.bestshare)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Top finders panel ─────────────────────────────────────────────────────────
function TopFindersPanel({ topFinders, netBlocks }) {
  if (!topFinders?.length) return null;
  const max = topFinders[0]?.count || 1;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <span>▸ Claim Jumpers</span>
        <span style={{color:'var(--text-3)', marginRight:'14px', fontSize:'0.55rem', whiteSpace:'nowrap'}}>last {netBlocks?.length || 0} blocks</span>
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:5}}>
        {topFinders.map((p,i)=>(
          <div key={p.name} style={{display:'flex',alignItems:'center',gap:8,padding:'0.5rem 0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)'}}>
            <span style={{fontFamily:'var(--fd)',fontSize:'0.55rem',color: i===0?'var(--amber)':'var(--text-3)', minWidth:24, textAlign:'right', fontWeight:600}}>
              {i===0?'★':`#${i+1}`}
            </span>
            <span style={{flex:1,fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
              {p.name}
              {p.isSolo && <span style={{marginLeft:6,fontFamily:'var(--fd)',fontSize:'0.5rem',color:'var(--amber)',border:'1px solid var(--amber)',padding:'1px 4px',letterSpacing:'0.1em'}}>SOLO</span>}
            </span>
            <div style={{flex:1,height:4,background:'var(--bg-deep)',borderRadius:1,overflow:'hidden',maxWidth:80}}>
              <div style={{height:'100%',width:`${(p.count/max)*100}%`,background:'linear-gradient(90deg, var(--cyan), var(--amber))'}}/>
            </div>
            <span style={{fontFamily:'var(--fd)',fontSize:'0.78rem',color:'var(--cyan)',fontWeight:600,minWidth:28,textAlign:'right'}}>
              {p.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Block feed (your blocks) ──────────────────────────────────────────────────
function BlockFeed({ blocks, blockAlert }) {
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
        <span>▸ Gold Strikes</span>
        {blockAlert && <span style={{color:'var(--green)', animation:'pulse 1s infinite', marginRight:'14px', whiteSpace:'nowrap'}}>★ NEW</span>}
      </div>
      {(!blocks?.length) ? (
        <div style={{textAlign:'center', padding:'1.2rem', color:'var(--text-3)', fontSize:'0.8rem', fontFamily:'var(--fd)', letterSpacing:'0.05em'}}>No strikes yet. Keep digging…</div>
      ) : (
        <div style={{display:'flex', flexDirection:'column', gap:6}}>
          {blocks.map((b,i)=>(
            <div key={b.height||i} style={{padding:'0.6rem 0.75rem', background:'var(--bg-raised)', border:'1px solid var(--border)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <div>
                <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', color:'var(--amber)', fontWeight:700}}>#{fmtNum(b.height)}</div>
                <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-3)', marginTop:2}}>{b.foundAt ? timeAgo(b.foundAt) : ''}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', color:'var(--green)', fontWeight:700}}>+{(b.reward || 3.125).toFixed(3)} BTC</div>
                <div style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)', marginTop:2}}>{b.workerName || '—'}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Recent network blocks (mempool feed) ─────────────────────────────────────
function RecentBlocksPanel({ netBlocks }) {
  if (!netBlocks?.length) return null;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ The Goldfields</div>
      <div style={{display:'flex', flexDirection:'column', gap:5}}>
        {netBlocks.slice(0, 7).map(b => (
          <div key={b.id || b.height} style={{display:'flex',alignItems:'center',gap:8,padding:'0.5rem 0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)'}}>
            <span style={{fontFamily:'var(--fm)', fontSize:'0.78rem', color:'var(--cyan)', fontWeight:700, minWidth:80}}>#{fmtNum(b.height)}</span>
            <span style={{flex:1,fontFamily:'var(--fm)',fontSize:'0.72rem',color: b.isSolo?'var(--amber)':'var(--text-1)', fontWeight: b.isSolo?600:400, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>
              {b.pool || 'unknown'}
              {b.isSolo && <span style={{marginLeft:6,fontFamily:'var(--fd)',fontSize:'0.5rem',color:'var(--amber)',border:'1px solid var(--amber)',padding:'1px 4px',letterSpacing:'0.1em'}}>SOLO</span>}
            </span>
            <span style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)', whiteSpace:'nowrap'}}>{blockTimeAgo(b.timestamp)}</span>
            <a href={`https://mempool.space/block/${b.id}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--text-2)', fontSize:13}}>↗</a>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function Confetti() {
  const pieces = useMemo(() => Array.from({length:60}, (_,i)=>({
    left: Math.random()*100,
    delay: Math.random()*0.5,
    color: ['#F5A623','#FFCD55','#FFE066','#39FF6A'][Math.floor(Math.random()*4)],
  })), []);
  return (
    <div style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:1000,overflow:'hidden'}}>
      {pieces.map((p,i)=>(
        <div key={i} style={{
          position:'absolute', top:'-20px', left:`${p.left}%`,
          width:8, height:14, background:p.color,
          animation:`confetti 3.2s ${p.delay}s ease-out forwards`,
          borderRadius:1,
        }}/>
      ))}
    </div>
  );
}

// ── Block alert overlay ───────────────────────────────────────────────────────
function BlockAlert({ show, block, onDismiss }) {
  if (!show) return null;
  return (
    <div onClick={onDismiss} style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.9)',backdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,cursor:'pointer'}}>
      <Confetti/>
      <div style={{textAlign:'center', maxWidth:500, padding:'2rem'}}>
        <div style={{fontSize:'5rem', animation:'pulse 0.8s ease-in-out infinite'}}>🏆</div>
        <div style={{fontFamily:'var(--fd)', fontSize:'2.2rem', fontWeight:700, color:'var(--amber)', textShadow:'0 0 30px var(--amber)', letterSpacing:'0.05em', margin:'0.6rem 0'}}>BLOCK FOUND!</div>
        <div style={{fontFamily:'var(--fd)', fontSize:'1rem', color:'var(--text-1)', letterSpacing:'0.1em', textTransform:'uppercase', marginBottom:'0.4rem'}}>#{fmtNum(block?.height || 0)}</div>
        <div style={{fontFamily:'var(--fd)', fontSize:'1.4rem', color:'var(--green)', textShadow:'0 0 14px var(--green)', fontWeight:700}}>+{(block?.reward || 3.125).toFixed(3)} BTC</div>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-3)', marginTop:'1.4rem'}}>tap anywhere to dismiss</div>
      </div>
    </div>
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
          {loading?'STARTING…':'⛏ Start Mining'}
        </button>
      </div>
    </div>
  );
}

// ── Settings modal ────────────────────────────────────────────────────────────
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

  const sectionTitle = { fontFamily:'var(--fd)', fontSize:'0.7rem', letterSpacing:'0.15em', color:'var(--amber)', textTransform:'uppercase', marginTop:'1.25rem', marginBottom:'0.5rem' };
  const rowLabel = { fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:5, textTransform:'uppercase' };

  return (
    <>
      <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1rem', padding:'0.6rem 0.75rem', background:'var(--bg-raised)', border:`1px solid ${minimalMode?'var(--cyan)':'var(--border)'}`}}>
        <span style={{fontSize:'1.1rem'}}>{minimalMode?'🔇':'🔊'}</span>
        <div style={{flex:1}}>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.72rem', color:'var(--text-1)', fontWeight:600, letterSpacing:'0.05em'}}>Minimal Mode</div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)', marginTop:2}}>Cleaner dashboard for shared screens. Hides nav, clock, ZMQ badge, fee rate.</div>
        </div>
        <button onClick={()=>onMinimalModeChange(!minimalMode)}
          style={{width:40, height:22, borderRadius:11, background: minimalMode?'var(--cyan)':'var(--bg-deep)', border:'1px solid var(--border)', position:'relative', cursor:'pointer', flexShrink:0}}>
          <div style={{position:'absolute', top:1, left: minimalMode?20:2, width:18, height:18, borderRadius:'50%', background: minimalMode?'#000':'var(--text-2)', transition:'left 0.2s'}}/>
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

      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:'0.75rem'}}>
        <div>
          <div style={rowLabel}>Items per slide</div>
          <input type="number" min="1" max="6" value={stripSettings.chunkSize}
            onChange={e=>onStripSettingsChange({...stripSettings, chunkSize: Math.max(1, Math.min(6, parseInt(e.target.value)||1))})}
            style={{width:'100%',padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.78rem',outline:'none',boxSizing:'border-box'}}/>
        </div>
        <div>
          <div style={rowLabel}>Slide duration (ms)</div>
          <input type="number" min="1000" max="20000" step="500" value={stripSettings.fadeMs}
            onChange={e=>onStripSettingsChange({...stripSettings, fadeMs: Math.max(1000, Math.min(20000, parseInt(e.target.value)||5000))})}
            style={{width:'100%',padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.78rem',outline:'none',boxSizing:'border-box'}}/>
        </div>
      </div>

      <div style={rowLabel}>Strip metrics (tap to toggle, ↑↓ to reorder)</div>
      <div style={{display:'flex', flexDirection:'column', gap:3, padding:4, background:'var(--bg-deep)', border:'1px solid var(--border)', maxHeight:280, overflowY:'auto'}}>
        {METRIC_CATEGORIES.map(cat => (
          <div key={cat}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.15em', color:'var(--amber)', textTransform:'uppercase', padding:'8px 6px 4px', borderBottom:'1px solid rgba(245,166,35,0.15)'}}>{cat}</div>
            {METRICS.filter(m => m.category === cat).map(metric => {
              const on = stripSettings.metricIds.includes(metric.id);
              const order = on ? stripSettings.metricIds.indexOf(metric.id) : -1;
              return (
                <div key={metric.id} style={{display:'flex', alignItems:'center', gap:6, padding:'5px 6px', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                  <button onClick={()=>toggleMetric(metric.id)}
                    style={{width:20, height:20, borderRadius:3, border:`1px solid ${on?'var(--amber)':'var(--border)'}`, background:on?'var(--amber)':'transparent', color:'#000', cursor:'pointer', fontSize:13, lineHeight:1, padding:0, flexShrink:0}}>
                    {on?'✓':''}
                  </button>
                  <span style={{flex:1, fontFamily:'var(--fm)', fontSize:'0.74rem', color: on?'var(--text-1)':'var(--text-2)', display:'flex', gap:6, alignItems:'center'}}>
                    {metric.icon && <span style={{fontSize:'0.85rem'}}>{metric.icon}</span>}
                    <span>{metric.label}</span>
                  </span>
                  {on && (
                    <>
                      <span style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)', minWidth:20, textAlign:'right'}}>#{order+1}</span>
                      <button onClick={()=>moveMetric(metric.id, -1)} disabled={order===0}
                        style={{width:22, height:22, padding:0, background:'transparent', border:'1px solid var(--border)', color: order===0?'var(--text-3)':'var(--cyan)', fontSize:11, cursor: order===0?'default':'pointer'}}>↑</button>
                      <button onClick={()=>moveMetric(metric.id, +1)} disabled={order===stripSettings.metricIds.length-1}
                        style={{width:22, height:22, padding:0, background:'transparent', border:'1px solid var(--border)', color: order===stripSettings.metricIds.length-1?'var(--text-3)':'var(--cyan)', fontSize:11, cursor: order===stripSettings.metricIds.length-1?'default':'pointer'}}>↓</button>
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

      <div style={sectionTitle}>▸ Scrolling Ticker</div>

      <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.75rem', padding:'0.5rem 0.6rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
        <span style={{fontFamily:'var(--fd)', fontSize:'0.68rem', color:'var(--text-1)', fontWeight:600, flex:1}}>Enable scrolling ticker</span>
        <button onClick={()=>onTickerSettingsChange({ ...tickerSettings, enabled: !tickerSettings.enabled })}
          style={{width:40, height:22, borderRadius:11, background: tickerSettings.enabled?'var(--cyan)':'var(--bg-deep)', border:'1px solid var(--border)', position:'relative', cursor:'pointer'}}>
          <div style={{position:'absolute', top:1, left: tickerSettings.enabled?20:2, width:18, height:18, borderRadius:'50%', background: tickerSettings.enabled?'#000':'var(--text-2)', transition:'left 0.2s'}}/>
        </button>
      </div>

      {tickerSettings.enabled && (
        <>
          <div style={{display:'grid', gridTemplateColumns:'1fr', gap:8, marginBottom:'0.75rem'}}>
            <div>
              <div style={rowLabel}>Scroll speed (sec for one full pass)</div>
              <input type="number" min="3" max="120" step="1" value={tickerSettings.speedSec}
                onChange={e=>onTickerSettingsChange({...tickerSettings, speedSec: Math.max(3, Math.min(120, parseInt(e.target.value)||30))})}
                style={{width:'100%',padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.78rem',outline:'none',boxSizing:'border-box'}}/>
              <div style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)', marginTop:3}}>Lower = faster scroll. 30s is a comfortable default.</div>
            </div>
          </div>

          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:6, marginBottom:6}}>
            <span>Ticker metrics (tap to toggle, ↑↓ to reorder)</span>
            <button onClick={matchTickerToStrip}
              style={{padding:'4px 8px', background:'transparent', border:'1px solid var(--border)', color:'var(--cyan)', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', cursor:'pointer', textTransform:'uppercase'}}>
              Match strip
            </button>
          </div>

          <div style={{display:'flex', flexDirection:'column', gap:3, padding:4, background:'var(--bg-deep)', border:'1px solid var(--border)', maxHeight:280, overflowY:'auto'}}>
            {METRIC_CATEGORIES.map(cat => (
              <div key={cat}>
                <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.15em', color:'var(--cyan)', textTransform:'uppercase', padding:'8px 6px 4px', borderBottom:'1px solid rgba(0,255,209,0.15)'}}>{cat}</div>
                {METRICS.filter(m => m.category === cat).map(metric => {
                  const on = (tickerSettings.metricIds || []).includes(metric.id);
                  const order = on ? tickerSettings.metricIds.indexOf(metric.id) : -1;
                  return (
                    <div key={metric.id} style={{display:'flex', alignItems:'center', gap:6, padding:'5px 6px', borderBottom:'1px solid rgba(255,255,255,0.03)'}}>
                      <button onClick={()=>toggleTickerMetric(metric.id)}
                        style={{width:20, height:20, borderRadius:3, border:`1px solid ${on?'var(--cyan)':'var(--border)'}`, background:on?'var(--cyan)':'transparent', color:'#000', cursor:'pointer', fontSize:13, lineHeight:1, padding:0, flexShrink:0}}>
                        {on?'✓':''}
                      </button>
                      <span style={{flex:1, fontFamily:'var(--fm)', fontSize:'0.74rem', color: on?'var(--text-1)':'var(--text-2)', display:'flex', gap:6, alignItems:'center'}}>
                        {metric.icon && <span style={{fontSize:'0.85rem'}}>{metric.icon}</span>}
                        <span>{metric.label}</span>
                      </span>
                      {on && (
                        <>
                          <span style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)', minWidth:20, textAlign:'right'}}>#{order+1}</span>
                          <button onClick={()=>moveTickerMetric(metric.id, -1)} disabled={order===0}
                            style={{width:22, height:22, padding:0, background:'transparent', border:'1px solid var(--border)', color: order===0?'var(--text-3)':'var(--cyan)', fontSize:11, cursor: order===0?'default':'pointer'}}>↑</button>
                          <button onClick={()=>moveTickerMetric(metric.id, +1)} disabled={order===(tickerSettings.metricIds||[]).length-1}
                            style={{width:22, height:22, padding:0, background:'transparent', border:'1px solid var(--border)', color: order===(tickerSettings.metricIds||[]).length-1?'var(--text-3)':'var(--cyan)', fontSize:11, cursor: order===(tickerSettings.metricIds||[]).length-1?'default':'pointer'}}>↓</button>
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
        </>
      )}
    </>
  );
}

// ── Privacy tab ───────────────────────────────────────────────────────────────
function PrivacyTab({privateMode,setPrivateMode,submit,saved,loading}) {
  return (
    <>
      <div style={{padding:'1rem',background:'var(--bg-raised)',border:'1px solid var(--border)', marginBottom:'0.75rem'}}>
        <label style={{display:'flex',alignItems:'center',gap:'0.75rem',cursor:'pointer'}}>
          <input type="checkbox" checked={privateMode} onChange={e=>setPrivateMode(e.target.checked)}
            style={{width:18,height:18,accentColor:'var(--cyan)',cursor:'pointer'}}/>
          <div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.75rem',color:'var(--text-1)',fontWeight:600,letterSpacing:'0.05em'}}>🔒 Private Mode</div>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.68rem',color:'var(--text-2)',marginTop:4,lineHeight:1.5}}>
              Keep your operation off the radar. Hides BTC price, all USD values, mempool data, and any external network calls. Locks the dashboard down for screenshots, demos, or simply staying invisible.
            </div>
          </div>
        </label>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end', marginTop:14}}>
        <button onClick={submit} disabled={loading}
          style={{padding:'0.7rem 1.4rem',background:saved?'var(--green)':'var(--cyan)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,letterSpacing:'0.1em',fontSize:'0.7rem',cursor:loading?'wait':'pointer',textTransform:'uppercase',opacity:loading?0.6:1}}>
          {loading?'SAVING…':saved?'✓ SAVED':'SAVE'}
        </button>
      </div>
    </>
  );
}

// ── Pulse tab ─────────────────────────────────────────────────────────────────
function PulseTab({ networkStats, onRefresh }) {
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);
  const [torBusy, setTorBusy] = useState(false);
  const [torError, setTorError] = useState('');
  const [showRevealKey, setShowRevealKey] = useState(false);

  const apiCall = useCallback(async (path, method = 'POST', body = null) => {
    setBusy(true);
    try {
      const opts = { method, headers: { 'Content-Type':'application/json' } };
      if (body) opts.body = JSON.stringify(body);
      const r = await fetch(path, opts);
      if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || `HTTP ${r.status}`); }
      const data = await r.json();
      onRefresh();
      return data;
    } catch (e) {
      console.error('Pulse action failed:', e);
      alert(`Action failed: ${e.message}`);
      throw e;
    } finally {
      setBusy(false);
    }
  }, [onRefresh]);

  const enable = () => apiCall('/api/network-stats/enable');
  const disable = () => {
    if (!confirm('Stop participating? Your stats will no longer contribute to the network and you will lose your read/write keys unless you back them up.')) return;
    apiCall('/api/network-stats/disable');
  };
  const regenerate = () => {
    if (!confirm('Generate fresh anonymous identity? Your old keys will be permanently deleted. This is irreversible.')) return;
    apiCall('/api/network-stats/regenerate');
  };
  const exportBackup = async () => {
    try {
      const data = await apiCall('/api/network-stats/export-backup');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type:'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `solostrike-pulse-keys-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    } catch {}
  };

  const setTorEnabled = async (enabled) => {
    setTorError('');
    setTorBusy(true);
    try {
      const r = await fetch('/api/network-stats/tor', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ enabled })
      });
      const data = await r.json().catch(()=>({}));
      if (!r.ok || data.ok === false) {
        setTorError(data.error || `HTTP ${r.status}`);
      }
      onRefresh();
    } catch (e) {
      setTorError(e.message || 'Network error');
    } finally {
      setTorBusy(false);
    }
  };

  const enabled = !!networkStats?.enabled;
  const conn = networkStats?.connections;
  const sec  = networkStats?.security;

  // Tor state for banner display
  const torEnabled = !!sec?.torEnabled;
  const torHealth = sec?.torHealth?.state;
  const torRelays = networkStats?.connections?.relayDetails || [];
  const torRelayCount = torRelays.filter(r => r.via === 'tor').length;
  const directRelayCount = torRelays.filter(r => r.via !== 'tor').length;

  const tabBtn = (id, label) => (
    <button onClick={()=>setTab(id)} style={{
      flex:1, padding:'0.55rem',
      background:tab===id?'var(--bg-raised)':'transparent',
      border:'none', borderBottom: tab===id?'2px solid var(--amber)':'2px solid transparent',
      color:tab===id?'var(--amber)':'var(--text-2)',
      fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em',
      cursor:'pointer', textTransform:'uppercase'
    }}>{label}</button>
  );

  if (!enabled) {
    return (
      <div>
        <div style={{padding:'1.2rem',background:'linear-gradient(135deg, rgba(0,255,209,0.04) 0%, rgba(245,166,35,0.04) 100%)',border:'1px solid var(--border)', marginBottom:'1rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'1rem',color:'var(--cyan)',fontWeight:700,letterSpacing:'0.05em',marginBottom:6,display:'flex',alignItems:'center',gap:8}}>
            <span style={{filter:'drop-shadow(0 0 6px var(--cyan))'}}>📡</span>
            <span>Join the Pulse</span>
          </div>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--text-1)',lineHeight:1.6,marginBottom:'0.75rem'}}>
            See <strong>which solo miners are out there</strong>, where blocks are being struck, and how your firepower compares to the global solo network — all <strong>fully anonymous</strong>.
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6,fontFamily:'var(--fm)',fontSize:'0.68rem',color:'var(--text-2)',marginBottom:'1rem'}}>
            <div>🔐 <strong style={{color:'var(--text-1)'}}>Anonymous by default.</strong> No address. No name. Just an unlinkable key per device.</div>
            <div>🌐 <strong style={{color:'var(--text-1)'}}>Decentralized.</strong> Broadcasts via 5+ Nostr relays. No central server.</div>
            <div>📊 <strong style={{color:'var(--text-1)'}}>Optional.</strong> One-click pause/leave. Full control of your data.</div>
            <div>🔥 <strong style={{color:'var(--text-1)'}}>Worth it.</strong> See what the solo movement looks like in real time.</div>
          </div>
          <button onClick={enable} disabled={busy}
            style={{width:'100%',padding:'0.85rem',background:'var(--cyan)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,letterSpacing:'0.1em',fontSize:'0.8rem',cursor:busy?'wait':'pointer',textTransform:'uppercase',opacity:busy?0.6:1, boxShadow:'0 0 16px rgba(0,255,209,0.2)'}}>
            {busy?'JOINING…':'⚡ Join the Pulse'}
          </button>
        </div>
        <details style={{padding:'0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)',fontFamily:'var(--fm)',fontSize:'0.68rem',color:'var(--text-2)',lineHeight:1.6}}>
          <summary style={{fontFamily:'var(--fd)',fontSize:'0.65rem',color:'var(--cyan)',letterSpacing:'0.1em',textTransform:'uppercase',cursor:'pointer'}}>🔒 What gets shared?</summary>
          <div style={{marginTop:8,paddingLeft:6}}>
            <div style={{marginBottom:4}}>• Your hashrate (rounded), worker count, accept rate</div>
            <div style={{marginBottom:4}}>• Your blocks found (height, height delta, block time) — never your address</div>
            <div style={{marginBottom:4}}>• An anonymous identity hash (random per device, never tied to wallet)</div>
            <div style={{color:'var(--green)',marginTop:8}}>✓ Never shared: payout address, IP, worker names, or anything that identifies you.</div>
          </div>
        </details>
      </div>
    );
  }

  return (
    <>
      {/* Tor status banner — shows current state of routing */}
      {torEnabled && torHealth === 'checking' && (
        <div style={{padding:'0.6rem 0.8rem',background:'var(--bg-raised)',border:'1px solid var(--cyan)',marginBottom:'0.75rem',fontFamily:'var(--fm)',fontSize:'0.68rem',color:'var(--cyan)',display:'flex',alignItems:'center',gap:8}}>
          <span>⏳</span>
          <span>Testing Tor reachability…</span>
        </div>
      )}
      {torEnabled && torHealth === 'ready' && torRelayCount > 0 && (
        <div style={{padding:'0.6rem 0.8rem',background:'rgba(57,255,106,0.05)',border:'1px solid rgba(57,255,106,0.3)',marginBottom:'0.75rem',fontFamily:'var(--fm)',fontSize:'0.68rem',color:'var(--green)',display:'flex',alignItems:'center',gap:8}}>
          <span>🟢</span>
          <span>Routing all relays through Tor. Privacy active.</span>
        </div>
      )}
      {torEnabled && torHealth === 'fallback' && (
        <div style={{padding:'0.6rem 0.8rem',background:'rgba(245,166,35,0.05)',border:'1px solid rgba(245,166,35,0.3)',marginBottom:'0.75rem',fontFamily:'var(--fm)',fontSize:'0.68rem',color:'var(--amber)',display:'flex',alignItems:'center',gap:8}}>
          <span>🟡</span>
          <span>Tor unhealthy — temporarily routing direct. Will retry automatically.</span>
        </div>
      )}
      {torError && (
        <div style={{padding:'0.6rem 0.8rem',background:'rgba(255,59,59,0.05)',border:'1px solid rgba(255,59,59,0.3)',marginBottom:'0.75rem',fontFamily:'var(--fm)',fontSize:'0.68rem',color:'var(--red)',display:'flex',alignItems:'center',gap:8}}>
          <span>⚠</span>
          <span>Tor unreachable: {torError}</span>
        </div>
      )}

      <div style={{display:'flex',gap:0,borderBottom:'1px solid var(--border)',marginBottom:14}}>
        {tabBtn('overview','Overview')}
        {tabBtn('identity','Identity')}
        {tabBtn('keys','Keys & Backup')}
      </div>

      {tab==='overview' && (
        <>
          <div style={{padding:'0.75rem',background:'rgba(57,255,106,0.05)',border:'1px solid rgba(57,255,106,0.3)', marginBottom:'1rem',display:'flex',alignItems:'center',gap:'0.6rem'}}>
            <span style={{fontSize:'1.2rem'}}>📡</span>
            <div style={{flex:1}}>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.7rem',color:'var(--green)',fontWeight:700,letterSpacing:'0.05em'}}>Pulse Active</div>
              <div style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-2)',marginTop:2}}>Broadcasting to {conn?.connected || 0} of {conn?.total || 0} relays</div>
            </div>
          </div>

          {/* Tor toggle */}
          <div style={{padding:'0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:'1rem'}}>
            <div style={{display:'flex',alignItems:'center',gap:'0.75rem'}}>
              <span style={{fontSize:'1.3rem'}}>🧅</span>
              <div style={{flex:1}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.72rem',color:'var(--text-1)',fontWeight:600,letterSpacing:'0.05em'}}>Route via Tor</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-2)',marginTop:3,lineHeight:1.5}}>
                  Hide your IP from Nostr relays. Requires Tor app installed on your Umbrel.
                </div>
              </div>
              <button onClick={()=>setTorEnabled(!torEnabled)} disabled={torBusy}
                style={{width:40, height:22, borderRadius:11, background: torEnabled?'var(--cyan)':'var(--bg-deep)', border:'1px solid var(--border)', position:'relative', cursor: torBusy?'wait':'pointer', flexShrink:0, opacity: torBusy?0.5:1}}>
                <div style={{position:'absolute', top:1, left: torEnabled?20:2, width:18, height:18, borderRadius:'50%', background: torEnabled?'#000':'var(--text-2)', transition:'left 0.2s'}}/>
              </button>
            </div>
          </div>

          {conn?.relayDetails && conn.relayDetails.length > 0 && (
            <div style={{marginBottom:'1rem'}}>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Relays</div>
              <div style={{display:'flex',flexDirection:'column',gap:4,padding:6,background:'var(--bg-deep)',border:'1px solid var(--border)'}}>
                {conn.relayDetails.map((r,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:8,fontFamily:'var(--fm)',fontSize:'0.68rem',padding:'4px 6px'}}>
                    <span style={{
                      width:7,height:7,borderRadius:'50%',
                      background: r.connected ? 'var(--green)' : 'var(--red)',
                      boxShadow: r.connected ? '0 0 4px var(--green)' : 'none',
                      flexShrink:0,
                    }}/>
                    <span style={{flex:1,color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.url.replace('wss://','')}</span>
                    {r.via === 'tor' && <span style={{fontFamily:'var(--fd)',fontSize:'0.5rem',color:'var(--cyan)',letterSpacing:'0.1em',padding:'1px 4px',border:'1px solid rgba(0,255,209,0.4)'}}>TOR</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {networkStats?.broadcastStats && (
            <div style={{marginBottom:'1rem'}}>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Broadcast Stats</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                <div style={{padding:'0.55rem',background:'var(--bg-raised)',border:'1px solid var(--border)',textAlign:'center'}}>
                  <div style={{fontFamily:'var(--fd)',fontSize:'0.85rem',color:'var(--green)',fontWeight:700}}>{networkStats.broadcastStats.success || 0}</div>
                  <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase',marginTop:2}}>Success</div>
                </div>
                <div style={{padding:'0.55rem',background:'var(--bg-raised)',border:'1px solid var(--border)',textAlign:'center'}}>
                  <div style={{fontFamily:'var(--fd)',fontSize:'0.85rem',color:(networkStats.broadcastStats.failed||0)>0?'var(--amber)':'var(--text-2)',fontWeight:700}}>{networkStats.broadcastStats.failed || 0}</div>
                  <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase',marginTop:2}}>Failed</div>
                </div>
              </div>
            </div>
          )}

          <button onClick={disable} disabled={busy}
            style={{width:'100%',padding:'0.65rem',background:'transparent',color:'var(--text-2)',border:'1px solid var(--border)',fontFamily:'var(--fd)',fontWeight:600,letterSpacing:'0.1em',fontSize:'0.62rem',cursor:busy?'wait':'pointer',textTransform:'uppercase',opacity:busy?0.6:1}}>
            {busy ? 'STOPPING…' : 'Pause / Leave Pulse'}
          </button>
        </>
      )}

      {tab==='identity' && sec && (
        <>
          <div style={{padding:'0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:'0.75rem'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:4}}>Pubkey (anonymous identity)</div>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--text-1)',wordBreak:'break-all'}}>{sec.pubkey || '—'}</div>
          </div>

          <div style={{padding:'0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:'0.75rem'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:4}}>Encryption</div>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--green)'}}>
              {sec.encryption === 'v1' ? '✓ Encrypted at rest (AES-256-GCM)' : 'Plaintext (legacy)'}
            </div>
          </div>

          <div style={{padding:'0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:'0.75rem'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:4}}>Created</div>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--text-1)'}}>
              {sec.createdAt ? new Date(sec.createdAt).toLocaleString() : '—'}
            </div>
          </div>

          <button onClick={regenerate} disabled={busy}
            style={{width:'100%',padding:'0.65rem',background:'transparent',color:'var(--red)',border:'1px solid var(--red)',fontFamily:'var(--fd)',fontWeight:600,letterSpacing:'0.1em',fontSize:'0.62rem',cursor:busy?'wait':'pointer',textTransform:'uppercase',opacity:busy?0.6:1, marginTop:8}}>
            ⚠ Regenerate Identity
          </button>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-3)',marginTop:6,lineHeight:1.5}}>
            This deletes your old keys forever and creates a fresh anonymous identity. Useful if you suspect compromise.
          </div>
        </>
      )}

      {tab==='keys' && sec && (
        <>
          <div style={{padding:'0.75rem',background:'rgba(245,166,35,0.04)',border:'1px solid rgba(245,166,35,0.3)',marginBottom:'1rem'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.65rem',color:'var(--amber)',letterSpacing:'0.1em',marginBottom:6,fontWeight:700}}>🔑 Backup Your Keys</div>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-1)',lineHeight:1.5,marginBottom:8}}>
              Your private signing key lives only in this Umbrel. If your hardware fails or you reinstall SoloStrike, exporting now keeps your reputation and history intact.
            </div>
            <button onClick={exportBackup} disabled={busy}
              style={{width:'100%',padding:'0.7rem',background:'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,letterSpacing:'0.1em',fontSize:'0.7rem',cursor:busy?'wait':'pointer',textTransform:'uppercase',opacity:busy?0.6:1}}>
              {busy?'EXPORTING…':'⬇ Export Backup (.json)'}
            </button>
          </div>

          <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.12em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:8}}>Read Key (sharable)</div>
          <div style={{padding:'0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:'0.75rem'}}>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-1)',wordBreak:'break-all',marginBottom:6}}>{sec.readKey || '—'}</div>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',lineHeight:1.5}}>
              Share this with friends so they can verify your stats. Read-only — they can never sign as you.
            </div>
          </div>

          {sec.privkeyEncrypted && (
            <>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.12em',color:'var(--red)',textTransform:'uppercase',marginBottom:8,marginTop:'1rem'}}>⚠ Encrypted Private Key</div>
              <div style={{padding:'0.75rem',background:'var(--bg-raised)',border:'1px solid var(--red)',marginBottom:'0.75rem'}}>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-2)',marginBottom:8,lineHeight:1.5}}>
                  Encrypted ciphertext only. Never share. Use export backup instead.
                </div>
                <button onClick={()=>setShowRevealKey(!showRevealKey)}
                  style={{padding:'0.4rem 0.75rem',background:'transparent',color:'var(--red)',border:'1px solid var(--red)',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',cursor:'pointer',textTransform:'uppercase'}}>
                  {showRevealKey ? 'Hide' : 'Reveal Ciphertext'}
                </button>
                {showRevealKey && (
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-1)',wordBreak:'break-all',marginTop:8,padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)'}}>
                    {sec.privkeyEncrypted}
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

// ── Pulse Panel — heartbeat card ──────────────────────────────────────────────
function PulsePanel({ networkStats, onOpenSettings }) {
  const ns = networkStats || { enabled: false, pools: 0, hashrate: 0, workers: 0, blocks: 0 };
  const enabled = !!ns.enabled;

  if (!enabled) {
    return (
      <div style={{...card, position:'relative', minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
        <div style={{...cardTitle, color:'var(--amber)'}}>▸ SoloStrike Pulse</div>
        <div style={{textAlign:'center', padding:'1.5rem 0.75rem', color:'var(--text-2)'}}>
          <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>📡</div>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.78rem', color:'var(--text-1)', marginBottom: 6, fontWeight:600}}>Pulse is offline</div>
          <button onClick={onOpenSettings}
            style={{marginTop:'0.9rem', padding:'0.55rem 1rem', background:'var(--amber)', color:'#000', border:'none', cursor:'pointer', fontFamily:'var(--fd)', fontSize:'0.65rem', fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase'}}>
            JOIN PULSE
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{...card, position:'relative', minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ SoloStrike Pulse</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.7rem' }}>
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.65rem 0.4rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Pools</div>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1 }}>{ns.pools || 0}</div>
        </div>
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.65rem 0.4rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Hashrate</div>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '1.05rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1 }}>{fmtHr(ns.hashrate || 0)}</div>
        </div>
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.65rem 0.4rem', textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Miners</div>
          <div style={{ fontFamily: 'var(--fd)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1 }}>{ns.workers || 0}</div>
        </div>
      </div>
    </div>
  );
}

// ── Aliases tab ───────────────────────────────────────────────────────────────
function AliasesTab({workers, aliases, onAliasesChange}) {
  const [pending, setPending] = useState(aliases || {});
  const sorted = [...(workers||[])].sort((a,b)=>a.name.localeCompare(b.name));
  const setOne = (name, val) => setPending(p => ({...p, [name]: val}));
  const apply = () => {
    const cleaned = {};
    Object.entries(pending).forEach(([k,v]) => { if (v && v.trim()) cleaned[k] = v.trim().slice(0,32); });
    onAliasesChange(cleaned);
  };
  return (
    <>
      <div style={{padding:'0.75rem',background:'rgba(0,255,209,0.04)',border:'1px solid rgba(0,255,209,0.2)', marginBottom:'0.75rem',fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-1)',lineHeight:1.5}}>
        Aliases are <strong style={{color:'var(--cyan)'}}>private to this browser</strong>. They never leave your device.
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:'1rem'}}>
        {sorted.length === 0 ? (
          <div style={{textAlign:'center',padding:'1.5rem',color:'var(--text-3)',fontSize:'0.78rem',fontFamily:'var(--fd)'}}>No workers yet</div>
        ) : sorted.map(w => (
          <div key={w.name} style={{padding:'0.5rem 0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)'}}>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-3)',marginBottom:3,wordBreak:'break-all'}}>{w.name}</div>
            <input type="text" value={pending[w.name] || ''} onChange={e=>setOne(w.name, e.target.value)} placeholder={stripAddr(w.name) + ' (default)'}
              maxLength={32}
              style={{width:'100%',padding:'0.45rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.78rem',outline:'none',boxSizing:'border-box'}}/>
          </div>
        ))}
      </div>
      <div style={{display:'flex',justifyContent:'flex-end'}}>
        <button onClick={apply}
          style={{padding:'0.6rem 1.2rem',background:'var(--cyan)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,letterSpacing:'0.1em',fontSize:'0.7rem',cursor:'pointer',textTransform:'uppercase'}}>
          Save Aliases
        </button>
      </div>
    </>
  );
}

// ── Webhooks tab ──────────────────────────────────────────────────────────────
function WebhooksTab() {
  const [hooks, setHooks] = useState([]);
  const [url, setUrl] = useState('');
  const [type, setType] = useState('discord');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/webhooks');
      if (r.ok) setHooks(await r.json());
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!url.trim()) return;
    setLoading(true);
    try {
      const r = await fetch('/api/webhooks', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ url:url.trim(), type })});
      if (r.ok) { setUrl(''); await load(); }
    } finally { setLoading(false); }
  };

  const remove = async (id) => {
    if (!confirm('Remove this webhook?')) return;
    try { await fetch(`/api/webhooks?id=${id}`, { method:'DELETE' }); await load(); } catch {}
  };

  const test = async (id) => {
    try {
      const r = await fetch(`/api/webhooks/test?id=${id}`, { method:'POST' });
      const data = await r.json();
      alert(data.ok ? '✓ Test webhook sent' : `Failed: ${data.error || 'unknown error'}`);
    } catch (e) {
      alert(`Failed: ${e.message}`);
    }
  };

  return (
    <>
      <div style={{padding:'0.75rem',background:'rgba(245,166,35,0.04)',border:'1px solid rgba(245,166,35,0.2)', marginBottom:'1rem',fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-1)',lineHeight:1.5}}>
        Get notified on Discord / Slack / Telegram / Custom when blocks are found or workers go offline.
      </div>

      <div style={{padding:'0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)', marginBottom:'1rem'}}>
        <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.1em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Add Webhook</div>
        <div style={{display:'flex',gap:6,marginBottom:6}}>
          <select value={type} onChange={e=>setType(e.target.value)}
            style={{padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.75rem',outline:'none'}}>
            <option value="discord">Discord</option>
            <option value="slack">Slack</option>
            <option value="telegram">Telegram</option>
            <option value="generic">Generic JSON</option>
          </select>
          <input type="text" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/..."
            style={{flex:1,padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.75rem',outline:'none',boxSizing:'border-box'}}/>
        </div>
        <button onClick={add} disabled={loading || !url.trim()}
          style={{width:'100%',padding:'0.55rem',background:'var(--cyan)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,letterSpacing:'0.1em',fontSize:'0.65rem',cursor:loading?'wait':'pointer',textTransform:'uppercase',opacity:loading?0.6:1}}>
          {loading ? 'ADDING…' : '+ Add Webhook'}
        </button>
      </div>

      <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.12em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Active Webhooks</div>
      {hooks.length === 0 ? (
        <div style={{textAlign:'center',padding:'1.5rem',color:'var(--text-3)',fontSize:'0.78rem',fontFamily:'var(--fd)',border:'1px dashed var(--border)'}}>None configured</div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {hooks.map(h => (
            <div key={h.id} style={{padding:'0.55rem 0.7rem',background:'var(--bg-raised)',border:'1px solid var(--border)'}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',color:'var(--cyan)',padding:'2px 6px',border:'1px solid var(--cyan)',textTransform:'uppercase'}}>{h.type}</span>
                <span style={{flex:1,fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.url}</span>
              </div>
              <div style={{display:'flex',gap:6}}>
                <button onClick={()=>test(h.id)}
                  style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--border)',color:'var(--cyan)',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',cursor:'pointer',textTransform:'uppercase'}}>Test</button>
                <button onClick={()=>remove(h.id)}
                  style={{padding:'4px 10px',background:'transparent',border:'1px solid var(--red)',color:'var(--red)',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',cursor:'pointer',textTransform:'uppercase'}}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Worker Detail Modal ───────────────────────────────────────────────────────
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
                <span style={{fontSize:18, color:'var(--cyan)', flexShrink:0}}>↗</span>
              </a>
            </div>
          )}

          <div style={section}>
            <div style={secTitle}>▸ Connection</div>
            <div style={kvRow}>
              <span style={kvLabel}>IP Address</span>
              <span style={kvVal}>{w.ip || '—'}</span>
            </div>
            <div style={kvRow}>
              <span style={kvLabel}>Stratum URL</span>
              <span style={kvVal}>{stratumUrl}</span>
            </div>
            {w.diff > 0 && (
              <div style={kvRow}>
                <span style={kvLabel}>Current Diff</span>
                <span style={kvVal}>{fmtDiff(w.diff)}</span>
              </div>
            )}
            <div style={kvRow}>
              <span style={kvLabel}>Shares/Min (target)</span>
              <span style={kvVal}>~{sharesPerMin}</span>
            </div>
            <div style={kvRow}>
              <span style={kvLabel}>Health</span>
              <span style={{...kvVal, color:HEALTH_COLOR[w.health] || 'var(--text-2)'}}>{healthMap[w.health] || '—'}</span>
            </div>
          </div>

          <div style={section}>
            <div style={secTitle}>▸ Share Stats</div>
            <div style={kvRow}>
              <span style={kvLabel}>Accepted Work</span>
              <span style={{...kvVal, color:'var(--green)'}}>{fmtDiff(work)}</span>
            </div>
            <div style={kvRow}>
              <span style={kvLabel}>Rejected Work</span>
              <span style={{...kvVal, color:workRej>0?'var(--red)':'var(--text-2)'}}>{fmtDiff(workRej)} ({rejectRatio}%)</span>
            </div>
            <div style={kvRow}>
              <span style={kvLabel}>Accept Rate</span>
              <span style={{...kvVal, color:'var(--green)', fontWeight:700}}>{acceptRate}%</span>
            </div>
            {seTot > 0 && (
              <>
                <div style={{...kvRow, marginTop:8, borderColor:'rgba(0,255,209,0.25)'}}>
                  <span style={{...kvLabel, color:'var(--cyan)'}}>Counted Shares (total)</span>
                  <span style={{...kvVal, color:'var(--cyan)'}}>{fmtNum(seTot)}</span>
                </div>
                <div style={kvRow}>
                  <span style={kvLabel}>Counted · Accepted</span>
                  <span style={{...kvVal, color:'var(--green)'}}>{fmtNum(seAcc)}</span>
                </div>
                {seRej > 0 && (
                  <div style={kvRow}>
                    <span style={kvLabel}>Counted · Rejected</span>
                    <span style={{...kvVal, color:'var(--red)'}}>{fmtNum(seRej)}</span>
                  </div>
                )}
                {seStale > 0 && (
                  <div style={kvRow}>
                    <span style={kvLabel}>Counted · Stale</span>
                    <span style={{...kvVal, color:'var(--amber)'}}>{fmtNum(seStale)}</span>
                  </div>
                )}
                {seAcceptRate && (
                  <div style={kvRow}>
                    <span style={kvLabel}>Counted Accept Rate</span>
                    <span style={{...kvVal, color:'var(--green)', fontWeight:700}}>{seAcceptRate}%</span>
                  </div>
                )}
                {seReasonRows.length > 0 && (
                  <div style={{padding:'0.5rem 0.6rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginTop:6}}>
                    <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em', color:'var(--text-2)', textTransform:'uppercase', marginBottom:5}}>Reject Reasons</div>
                    {seReasonRows.map(([reason, count]) => (
                      <div key={reason} style={{display:'flex', justifyContent:'space-between', fontFamily:'var(--fm)', fontSize:'0.7rem', padding:'2px 0'}}>
                        <span style={{color:classifySeReason(reason), overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', flex:1, marginRight:8}}>{reason}</span>
                        <span style={{color:'var(--text-1)', fontWeight:600}}>{fmtNum(count)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div style={section}>
            <div style={secTitle}>▸ Notes & Alias</div>
            <div style={{marginBottom:6}}>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em', color:'var(--text-2)', textTransform:'uppercase', marginBottom:4}}>Alias (private to you)</div>
              <input type="text" value={aliasVal} onChange={e=>{setAliasVal(e.target.value); setDirty(true);}} placeholder="e.g. Garage S19" maxLength={32} style={inputStyle}/>
            </div>
            <div>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em', color:'var(--text-2)', textTransform:'uppercase', marginBottom:4}}>Notes</div>
              <textarea value={noteVal} onChange={e=>{setNoteVal(e.target.value); setDirty(true);}} placeholder="Maintenance notes, location, model details…" maxLength={200} rows={3}
                style={{...inputStyle, resize:'vertical', minHeight:60, fontFamily:'var(--fm)'}}/>
            </div>
            {dirty && (
              <button onClick={save}
                style={{width:'100%', marginTop:8, padding:'0.6rem', background:'var(--amber)', color:'#000', border:'none', fontFamily:'var(--fd)', fontWeight:700, letterSpacing:'0.1em', fontSize:'0.7rem', cursor:'pointer', textTransform:'uppercase'}}>
                Save
              </button>
            )}
          </div>

          <div style={section}>
            <div style={secTitle}>▸ Quick Actions</div>
            <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
              <button onClick={()=>copy(stratumUrl, 'stratum')} style={btn}>{copied==='stratum'?'✓ Copied':'⎘ Copy Stratum'}</button>
              {w.ip && <button onClick={()=>copy(w.ip, 'ip')} style={btn}>{copied==='ip'?'✓ Copied':'⎘ Copy IP'}</button>}
              <button onClick={exportCsv} style={btn}>⬇ Export CSV</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Card order + currency helpers ─────────────────────────────────────────────
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
  const { connected, state: poolState, lastBlock, blockAlert, setBlockAlert, saveConfig, refreshConfig } = usePool();
  const [showSettings, setShowSettings] = useState(false);
  const [showShareStats, setShowShareStats] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [order, setOrder] = useState(loadOrder());
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

  const onCurrencyChange = (c) => { setCurrencyState(c); saveCurrency(c); };
  const onResetLayout = () => { setOrder(DEFAULT_ORDER); saveOrder(DEFAULT_ORDER); };
  const onAliasesChange = (a) => { setAliases(a); saveAliases(a); };
  const onNotesChange = (n) => { setNotes(n); saveNotes(n); };
  const onMinimalModeChange = (v) => { setMinimalMode(v); saveMinimalMode(v); };
  const onVisibleCardsChange = (list) => { setVisibleCards(list); saveVisibleCards(list); };

  const onStripSettingsChange = (s) => {
    setStripSettings(s);
    saveStripEnabled(s.enabled);
    saveStripMetrics(s.metricIds);
    saveStripChunk(s.chunkSize);
    saveStripFade(s.fadeMs);
  };
  const onTickerSettingsChange = (s) => {
    setTickerSettings(s);
    saveTickerEnabled(s.enabled);
    saveTickerSpeed(s.speedSec);
    saveTickerMetrics(s.metricIds);
  };

  const status = poolState?.status || 'loading';
  const workers = poolState?.workers || [];
  const uptime = poolState?.uptime || 0;
  const networkStats = poolState?.networkStats;

  // Ticker snapshot — shared metric formatter
  const [tickerSnapshot, setTickerSnapshot] = useState('');
  useEffect(() => {
    if (!tickerSettings.enabled || !poolState) { setTickerSnapshot(''); return; }
    const ids = tickerSettings.metricIds || [];
    const parts = [];
    for (const id of ids) {
      const m = METRIC_MAP[id];
      if (!m) continue;
      try {
        const out = m.render(poolState, aliases, currency, uptime) || {};
        const value = out.value != null ? String(out.value) : '—';
        const prefix = out.prefix != null ? out.prefix : m.label.toUpperCase();
        parts.push(`${prefix} ${value}`);
      } catch {}
    }
    setTickerSnapshot(parts.join('  ·  '));
  }, [poolState, tickerSettings.enabled, tickerSettings.metricIds, aliases, currency, uptime]);

  const onDragStart = (id) => setDraggedId(id);
  const onDragOver  = () => {};
  const onDrop = (targetId) => {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return; }
    const fromIdx = order.indexOf(draggedId);
    const toIdx   = order.indexOf(targetId);
    if (fromIdx === -1 || toIdx === -1) { setDraggedId(null); return; }
    const next = [...order];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    setOrder(next);
    saveOrder(next);
    setDraggedId(null);
  };

  // Wizard logic — show only on fresh setup
  const [showWizard, setShowWizard] = useState(false);
  useEffect(() => {
    if (poolState && !poolState.payoutAddress && !hasCompletedWizard()) {
      setShowWizard(true);
    }
  }, [poolState?.payoutAddress]);

  if (showWizard) {
    return <OnboardingWizard onComplete={()=>{ setShowWizard(false); refreshConfig(); }} saveConfig={saveConfig}/>;
  }

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
    closestcalls: <ClosestCallsPanel closestCalls={poolState?.closestCalls} aliases={aliases}/>,
    blocks: <BlockFeed blocks={poolState?.blocks} blockAlert={blockAlert}/>,
    topfinders: <TopFindersPanel topFinders={poolState?.topFinders} netBlocks={poolState?.netBlocks}/>,
    recent: <RecentBlocksPanel netBlocks={poolState?.netBlocks}/>,
    pulse: <PulsePanel networkStats={poolState?.networkStats} onOpenSettings={()=>setShowSettings(true)}/>,
  };

  const visibleSet = new Set(minimalMode ? MINIMAL_PRESET : visibleCards);
  const visibleOrdered = order.filter(id => visibleSet.has(id) && cardComponents[id]);

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
            networkStats={networkStats}
            onNetworkStatsRefresh={refreshConfig}
          />
        )}
      </>
    );
  }

  return (
    <>
      <Header connected={connected} status={status} onSettings={()=>setShowSettings(true)} privateMode={!!poolState?.privateMode} minimalMode={minimalMode} zmq={poolState?.zmq}/>
      {!minimalMode && <SyncWarningBanner sync={poolState?.sync}/>}
      {!minimalMode && <LatestBlockStrip netBlocks={poolState?.netBlocks} blockReward={poolState?.blockReward}/>}
      {!minimalMode && (
        <CustomizableTopStrip
          state={poolState} aliases={aliases} currency={currency} uptime={uptime}
          enabled={stripSettings.enabled} metricIds={stripSettings.metricIds}
          chunkSize={stripSettings.chunkSize} fadeMs={stripSettings.fadeMs}
        />
      )}
      {!minimalMode && <Ticker snapshotText={tickerSnapshot} enabled={tickerSettings.enabled} speedSec={tickerSettings.speedSec}/>}

      <main className="ss-grid" style={{padding:'0.75rem', display:'grid', gap:'0.75rem', gridTemplateColumns:'repeat(auto-fit, minmax(280px, 1fr))', maxWidth:'100%', boxSizing:'border-box'}}>
        {visibleOrdered.map(id => (
          <DraggableCard key={id} id={id} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} draggedId={draggedId}>
            {cardComponents[id]}
          </DraggableCard>
        ))}
      </main>

      <OfflineToasts workers={workers} aliases={aliases}/>

      {selectedWorker && (
        <WorkerDetailModal worker={selectedWorker} onClose={()=>setSelectedWorker(null)}
          aliases={aliases} onAliasesChange={onAliasesChange}
          notes={notes} onNotesChange={onNotesChange}/>
      )}

      {showShareStats && (
        <ShareStatsModal shares={poolState?.shares} workers={workers} aliases={aliases}
          onClose={()=>setShowShareStats(false)} onWorkerSelect={setSelectedWorker}
          trackingSince={poolState?.shareTrackingSince}/>
      )}

      <BlockAlert show={!!blockAlert} block={lastBlock} onDismiss={()=>setBlockAlert(false)}/>

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
          networkStats={networkStats}
          onNetworkStatsRefresh={refreshConfig}
        />
      )}
    </>
  );
}
