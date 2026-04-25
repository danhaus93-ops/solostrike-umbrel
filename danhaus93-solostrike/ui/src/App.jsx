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
  if (!closestCalls || closestCalls.length === 0) {
    return (
      <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
        <div style={{...cardTitle, color:'var(--amber)'}}>▸ Near Strikes</div>
        <div style={{textAlign:'center',padding:'1rem',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)',letterSpacing:'0.05em'}}>
          No high-diff shares yet. Keep grinding…
        </div>
      </div>
    );
  }
  const top10 = closestCalls.slice(0, 10);
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Near Strikes</div>
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {top10.map((c,i)=>{
          const disp = displayName(c.workerName, aliases);
          const pct = Math.min(100, ((c.diff || 0) / (top10[0].diff || 1)) * 100);
          return (
            <div key={`${c.workerName}-${i}`} style={{
              display:'flex',alignItems:'center',gap:8,
              padding:'0.45rem 0.6rem',
              background:'var(--bg-raised)',
              border: i===0 ? '1px solid var(--border-hot, rgba(245,166,35,0.4))' : '1px solid var(--border)',
              position:'relative',
              overflow:'hidden',
            }}>
              <div style={{position:'absolute', inset:0, width:`${pct}%`, background:'linear-gradient(90deg, rgba(245,166,35,0.05), rgba(245,166,35,0.01))', pointerEvents:'none'}}/>
              <div style={{position:'relative',zIndex:1,display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0,overflow:'hidden'}}>
                <span style={{
                  fontFamily:'var(--fd)',fontSize:'0.65rem',fontWeight:700,color:i===0?'var(--amber)':'var(--text-3)',
                  width:24,textAlign:'right',
                  textShadow: i===0 ? '0 0 8px rgba(245,166,35,0.5)' : 'none',
                }}>{i===0?'⚡':`#${i+1}`}</span>
                <div style={{flex:1,minWidth:0,overflow:'hidden'}}>
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.75rem',color:'var(--text-1)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={c.workerName}>
                    {disp}
                    {c.minerType && <span style={{fontFamily:'var(--fd)', fontSize:'0.5rem', color:'var(--text-3)', marginLeft:6, letterSpacing:'0.1em', textTransform:'uppercase'}}>{c.minerType}</span>}
                  </div>
                  <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',color:'var(--text-3)',letterSpacing:'0.05em',marginTop:2}}>{timeAgo(c.ts)}</div>
                </div>
              </div>
              <span style={{position:'relative',zIndex:1,fontFamily:'var(--fd)',fontSize:'0.95rem',fontWeight:700,color:i===0?'var(--amber)':'var(--text-1)',whiteSpace:'nowrap'}}>
                {fmtDiff(c.diff)}
              </span>
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
  const reward = blockReward?.totalBtc || 0;
  const fiatPrize = price ? reward * price : null;
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Bitcoin Network</div>
      <div style={statRow}>
        <span style={label}>Block Height</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{fmtNum(network?.height||0)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Net Hashrate</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{fmtHr(network?.hashrate||0)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Difficulty</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{fmtDiff(network?.difficulty||0)}</span>
      </div>
      {!privateMode && mempool?.feeRate!=null && (
        <div style={statRow}>
          <span style={label}>Fee Rate</span>
          <span style={{fontFamily:'var(--fm)',color:'var(--cyan)'}}>{mempool.feeRate} sat/vB</span>
        </div>
      )}
      <div style={{...statRow, borderColor:'var(--border-hot, rgba(245,166,35,0.3))'}}>
        <span style={label}>Block Prize</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--amber)',fontWeight:600}}>{reward.toFixed(3)} BTC{fiatPrize && <span style={{color:'var(--text-2)',fontSize:'0.75em',marginLeft:6}}>({fmtFiat(fiatPrize, currency)})</span>}</span>
      </div>
    </div>
  );
}

// ── Bitcoin Node panel ────────────────────────────────────────────────────────
function BitcoinNodePanel({ nodeInfo }) {
  if (!nodeInfo) return null;
  const c = parseClient(nodeInfo.subversion);
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Bitcoin Node</div>
      <div style={statRow}>
        <span style={label}>Node Status</span>
        <span style={{fontFamily:'var(--fm)',color: nodeInfo.connected?'var(--green)':'var(--red)',fontWeight:600,textShadow:nodeInfo.connected?'0 0 6px var(--green)':'none'}}>
          {nodeInfo.connected?'● ONLINE':'○ OFFLINE'}
        </span>
      </div>
      <div style={statRow}>
        <span style={label}>Client</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{c.name}{c.version&&<span style={{color:'var(--text-2)',marginLeft:6}}>{c.version}</span>}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Peers</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{nodeInfo.peers||0}{(nodeInfo.peersIn>0||nodeInfo.peersOut>0)&&<span style={{color:'var(--text-2)',marginLeft:6,fontSize:'0.9em'}}>({nodeInfo.peersIn||0}↑ {nodeInfo.peersOut||0}↓)</span>}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Mempool</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{fmtNum(nodeInfo.mempoolCount||0)} <span style={{color:'var(--text-2)',marginLeft:4}}>{fmtBytes(nodeInfo.mempoolBytes||0)}</span></span>
      </div>
    </div>
  );
}

// ── Strike Odds ───────────────────────────────────────────────────────────────
function OddsDisplay({ odds, hashrate, netHashrate }) {
  if (!odds || !hashrate || !netHashrate) return null;
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Strike Odds</div>
      <div style={statRow}>
        <span style={label}>Per Block</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{fmtOdds(odds.perBlock)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Avg. Time</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--cyan)'}}>{odds.expectedDays==null?'—':odds.expectedDays<1?`${(odds.expectedDays*24).toFixed(1)} h`:`${odds.expectedDays.toFixed(1)} d`}</span>
      </div>
      <div style={statRow}>
        <span style={label}>In 24h</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{fmtPct(odds.perDay||0)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>In 1 Week</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{fmtPct(odds.perWeek||0)}</span>
      </div>
      <div style={{...statRow, borderColor:'var(--border-hot, rgba(245,166,35,0.3))'}}>
        <span style={label}>In 1 Month</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--amber)',fontWeight:600}}>{fmtPct(odds.perMonth||0)}</span>
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
  const remainingDays = retarget.remainingTime ? retarget.remainingTime / (1000 * 60 * 60 * 24) : null;
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Difficulty Retarget</div>
      <div style={{position:'relative', height:20, background:'var(--bg-deep)', border:'1px solid var(--border)', overflow:'hidden', marginBottom:8}}>
        <div style={{ height:'100%', width:`${retarget.progressPercent||0}%`, background:'linear-gradient(90deg, var(--cyan-glow, rgba(0,255,209,0.4)) 0%, var(--cyan) 100%)', boxShadow:'0 0 8px rgba(0,255,209,0.4)', transition:'width 0.4s ease' }}/>
      </div>
      <div style={statRow}>
        <span style={label}>Progress</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{(retarget.progressPercent||0).toFixed(2)}%</span>
      </div>
      <div style={statRow}>
        <span style={label}>Blocks Left</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--cyan)'}}>{fmtNum(retarget.remainingBlocks||0)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>ETA</span>
        <span style={{fontFamily:'var(--fm)',color:'var(--text-1)'}}>{remainingDays==null?'—':remainingDays<1?`${(remainingDays*24).toFixed(1)} h`:`${remainingDays.toFixed(1)} d`}</span>
      </div>
      <div style={{...statRow, borderColor: retarget.difficultyChange>=0 ? 'var(--border-hot, rgba(245,166,35,0.3))' : 'rgba(57,255,106,0.3)'}}>
        <span style={label}>Δ Difficulty</span>
        <span style={{fontFamily:'var(--fm)',color: retarget.difficultyChange>=0?'var(--amber)':'var(--green)',fontWeight:600}}>{retarget.difficultyChange>=0?'+':''}{(retarget.difficultyChange||0).toFixed(2)}%</span>
      </div>
    </div>
  );
}

// ── Share stats modal ─────────────────────────────────────────────────────────
function ShareStatsModal({ shares, workers, aliases, onClose, onWorkerSelect, trackingSince }) {
  const [copied, setCopied] = useState('');
  if (!shares) return null;
  const total = (shares.acceptedCount || 0) + (shares.rejectedCount || 0);
  const acceptPct = total > 0 ? ((shares.acceptedCount || 0) / total) * 100 : 100;
  const rejectPct = total > 0 ? ((shares.rejectedCount || 0) / total) * 100 : 0;
  const stalePct  = total > 0 ? ((shares.stale || 0) / total) * 100 : 0;
  const reasons = Object.entries(shares.rejectReasons || {}).sort((a,b)=>b[1]-a[1]);
  const totalReject = (shares.rejectedCount || 0) + (shares.stale || 0);
  const trackedDur = trackingSince ? fmtDurationMs(Date.now() - trackingSince) : null;

  const workersWithRejects = (workers || [])
    .filter(w => (w.rejected || 0) > 0 || (w.stale || 0) > 0 || w.lastRejectReason)
    .sort((a,b) => ((b.rejected||0) + (b.stale||0)) - ((a.rejected||0) + (a.stale||0)));

  const copyAll = () => {
    if (!reasons.length && !workersWithRejects.length) return;
    const lines = [];
    lines.push(`SoloStrike Share Diagnostics (${new Date().toLocaleString()})`);
    if (trackedDur) lines.push(`Tracking: last ${trackedDur}`);
    lines.push(`Total shares: ${fmtNum(total)} | Accepted: ${fmtNum(shares.acceptedCount||0)} (${acceptPct.toFixed(2)}%) | Rejected: ${fmtNum(shares.rejectedCount||0)} | Stale: ${fmtNum(shares.stale||0)}`);
    lines.push('');
    if (reasons.length) {
      lines.push('Reject reasons:');
      reasons.forEach(([r,c]) => {
        const pct = totalReject > 0 ? ((c/totalReject)*100).toFixed(1) : '100.0';
        lines.push(`  ${r}: ${fmtNum(c)} (${pct}%)`);
      });
      lines.push('');
    }
    if (workersWithRejects.length) {
      lines.push('Per-worker:');
      workersWithRejects.forEach(w => {
        const disp = displayName(w.name, aliases);
        const reasonNote = w.lastRejectReason ? ` last reason: ${w.lastRejectReason}` : '';
        lines.push(`  ${disp}: ${fmtNum(w.rejected||0)} rejected, ${fmtNum(w.stale||0)} stale${reasonNote}`);
      });
    }
    const text = lines.join('\n');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(()=>{ setCopied('all'); setTimeout(()=>setCopied(''), 1500); });
    }
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:300,display:'flex',alignItems:'center',justifyContent:'center',padding:'1rem'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-elevated, #15161a)',border:'1px solid var(--border)',maxWidth:560,width:'100%',maxHeight:'90vh',overflowY:'auto',padding:'1.25rem'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
          <h3 style={{margin:0,fontFamily:'var(--fd)',fontSize:'0.75rem',letterSpacing:'0.18em',color:'var(--amber)'}}>▸ Share Diagnostics</h3>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            <button onClick={copyAll} disabled={!reasons.length && !workersWithRejects.length} style={{background:'transparent',border:'1px solid var(--border)',color:copied==='all'?'var(--green)':'var(--text-2)',cursor:reasons.length||workersWithRejects.length?'pointer':'default',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',padding:'4px 8px',textTransform:'uppercase',opacity:reasons.length||workersWithRejects.length?1:0.3}}>
              {copied==='all'?'COPIED':'COPY'}
            </button>
            <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:'1.1rem',padding:0,lineHeight:1}}>✕</button>
          </div>
        </div>

        {trackedDur && (
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--text-3)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>
            Last {trackedDur} · {fmtNum(total)} total
          </div>
        )}

        {total > 0 ? (
          <>
            <div style={{height:14,display:'flex',background:'var(--bg-deep)',border:'1px solid var(--border)',marginBottom:6,overflow:'hidden'}}>
              <div style={{width:`${acceptPct}%`,background:'var(--green)',transition:'width 0.4s'}}/>
              <div style={{width:`${stalePct}%`,background:'var(--amber)',transition:'width 0.4s'}}/>
              <div style={{width:`${rejectPct}%`,background:'var(--red)',transition:'width 0.4s'}}/>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.08em',color:'var(--text-3)',marginBottom:14,textTransform:'uppercase'}}>
              <span>Accepted {acceptPct.toFixed(2)}%</span>
              {(shares.stale||0)>0 && <span>Stale {stalePct.toFixed(2)}%</span>}
              <span>Rejected {rejectPct.toFixed(2)}%</span>
            </div>
          </>
        ) : (
          <div style={{textAlign:'center',padding:'1rem',color:'var(--text-2)',fontSize:'0.7rem'}}>No share activity yet</div>
        )}

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8,marginBottom:14}}>
          <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.5rem',textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Accepted</div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.95rem',color:'var(--green)',fontWeight:700,marginTop:4}}>{fmtNum(shares.acceptedCount||0)}</div>
          </div>
          <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.5rem',textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Rejected</div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.95rem',color:(shares.rejectedCount||0)>0?'var(--red)':'var(--text-2)',fontWeight:700,marginTop:4}}>{fmtNum(shares.rejectedCount||0)}</div>
          </div>
          <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.5rem',textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Stale</div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.95rem',color:(shares.stale||0)>0?'var(--amber)':'var(--text-2)',fontWeight:700,marginTop:4}}>{fmtNum(shares.stale||0)}</div>
          </div>
        </div>

        {reasons.length > 0 && (
          <div style={{marginBottom:14}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Why rejects happened</div>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {reasons.map(([r,c])=>{
                const pct = totalReject > 0 ? ((c/totalReject)*100) : 100;
                return (
                  <div key={r} style={{display:'flex',justifyContent:'space-between',padding:'0.45rem 0.6rem',background:'var(--bg-raised)',border:'1px solid var(--border)',fontFamily:'var(--fm)',fontSize:'0.7rem'}}>
                    <span style={{color:'var(--text-1)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r}</span>
                    <span style={{color:'var(--red)',marginLeft:8,whiteSpace:'nowrap'}}>{fmtNum(c)} <span style={{color:'var(--text-3)'}}>({pct.toFixed(1)}%)</span></span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {workersWithRejects.length > 0 && (
          <div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Per-worker</div>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              {workersWithRejects.map(w => {
                const disp = displayName(w.name, aliases);
                const total = (w.rejected||0) + (w.stale||0);
                return (
                  <div key={w.name} onClick={()=>{onWorkerSelect&&onWorkerSelect(w); onClose();}} style={{display:'flex',justifyContent:'space-between',padding:'0.5rem 0.6rem',background:'var(--bg-raised)',border:'1px solid var(--border)',cursor:'pointer'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontFamily:'var(--fm)',fontSize:'0.75rem',color:'var(--text-1)',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{disp}</div>
                      {w.lastRejectReason && <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-3)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{w.lastRejectReason}</div>}
                    </div>
                    <span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--red)',whiteSpace:'nowrap',marginLeft:8}}>{fmtNum(total)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Share Stats card ──────────────────────────────────────────────────────────
function ShareStats({ shares, hashrate, bestshare, onOpen }) {
  if (!shares) return null;
  const total = (shares.acceptedCount || 0) + (shares.rejectedCount || 0);
  const acceptPct = total > 0 ? ((shares.acceptedCount || 0) / total) * 100 : 100;
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)'}}>
        <span>▸ Share Stats</span>
        {(shares.rejectedCount > 0 || shares.stale > 0 || (Object.keys(shares.rejectReasons||{}).length>0)) && (
          <button onClick={onOpen} style={{background:'transparent', border:'1px solid var(--border)', color:'var(--text-2)', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', padding:'2px 8px', cursor:'pointer', marginRight:'14px'}}>DIAGNOSE</button>
        )}
      </div>
      <div style={{textAlign:'center', marginBottom:8}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'2.4rem', fontWeight:700, color:'var(--green)', textShadow:'0 0 18px rgba(57,255,106,0.4)'}}>{acceptPct.toFixed(2)}%</div>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.18em', color:'var(--text-3)', textTransform:'uppercase', marginTop:2}}>Accept Rate</div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, marginBottom:6}}>
        <div style={{textAlign:'center', padding:'0.4rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', color:'var(--green)', fontWeight:700}}>{fmtNum(shares.acceptedCount||0)}</div>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', color:'var(--text-3)', textTransform:'uppercase'}}>Accepted</div>
        </div>
        <div style={{textAlign:'center', padding:'0.4rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', color: (shares.rejectedCount||0)>0?'var(--red)':'var(--text-2)', fontWeight:700}}>{fmtNum(shares.rejectedCount||0)}</div>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', color:'var(--text-3)', textTransform:'uppercase'}}>Rejected</div>
        </div>
        <div style={{textAlign:'center', padding:'0.4rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', color: (shares.stale||0)>0?'var(--amber)':'var(--text-2)', fontWeight:700}}>{fmtNum(shares.stale||0)}</div>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', color:'var(--text-3)', textTransform:'uppercase'}}>Stale</div>
        </div>
      </div>
      {bestshare > 0 && (
        <div style={{...statRow, marginTop:8, borderColor:'var(--border-hot, rgba(245,166,35,0.3))'}}>
          <span style={label}>Best Share</span>
          <span style={{fontFamily:'var(--fm)',color:'var(--amber)',fontWeight:600}}>{fmtDiff(bestshare)}</span>
        </div>
      )}
    </div>
  );
}

// ── Top Diggers (best share leaderboard) ──────────────────────────────────────
function BestShareLeaderboard({ workers, poolBest, aliases }) {
  const sorted = [...(workers||[])].filter(w=>w.bestshare>0).sort((a,b)=>b.bestshare-a.bestshare);
  const top5 = sorted.slice(0,5);
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Top Diggers</div>
      {top5.length === 0 ? (
        <div style={{textAlign:'center',padding:'1.5rem',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)',letterSpacing:'0.05em'}}>
          No high-diff shares yet. Keep grinding…
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {top5.map((w,i)=>{
            const disp = displayName(w.name, aliases);
            return (
              <div key={w.name} style={{display:'flex',alignItems:'center',gap:8,padding:'0.45rem 0.6rem',background:'var(--bg-raised)',border:i===0?'1px solid var(--border-hot, rgba(245,166,35,0.4))':'1px solid var(--border)'}}>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.65rem',fontWeight:700,color:i===0?'var(--amber)':'var(--text-3)',width:20,textAlign:'right'}}>{i===0?'👑':`#${i+1}`}</span>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.75rem',color:'var(--text-1)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={w.name}>
                    {disp}
                    {w.minerType && <span style={{fontFamily:'var(--fd)', fontSize:'0.5rem', color:'var(--text-3)', marginLeft:6, letterSpacing:'0.1em', textTransform:'uppercase'}}>{w.minerType}</span>}
                  </div>
                </div>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:600,color:i===0?'var(--amber)':'var(--text-1)'}}>{fmtDiff(w.bestshare)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Top Finders ────────────────────────────────────────────────────────────────
function TopFindersPanel({ topFinders, netBlocks }) {
  if (!topFinders?.length) return null;
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Claim Jumpers</div>
      <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--text-3)', textTransform:'uppercase', marginBottom:6}}>Last {netBlocks?.length||30} blocks</div>
      <div style={{display:'flex',flexDirection:'column',gap:5}}>
        {topFinders.slice(0,5).map((f,i)=>{
          const max = topFinders[0].count || 1;
          const pct = (f.count/max)*100;
          return (
            <div key={f.name} style={{position:'relative',display:'flex',alignItems:'center',padding:'0.45rem 0.6rem',background:'var(--bg-raised)',border:'1px solid var(--border)',gap:8,overflow:'hidden'}}>
              <div style={{position:'absolute',inset:0,width:`${pct}%`,background:f.isSolo?'rgba(245,166,35,0.06)':'rgba(0,255,209,0.04)'}}/>
              <span style={{position:'relative',fontFamily:'var(--fd)',fontSize:'0.65rem',fontWeight:700,color:'var(--text-3)',width:18,textAlign:'right'}}>#{i+1}</span>
              <span style={{position:'relative',flex:1,fontFamily:'var(--fm)',fontSize:'0.72rem',color:f.isSolo?'var(--amber)':'var(--text-1)',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {f.name}
                {f.isSolo && <span style={{marginLeft:6,fontFamily:'var(--fd)',fontSize:'0.48rem',letterSpacing:'0.1em',color:'var(--amber)',border:'1px solid var(--amber)',padding:'1px 4px'}}>SOLO</span>}
              </span>
              <span style={{position:'relative',fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:700,color:'var(--amber)'}}>{f.count}</span>
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
    <div style={card} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ Gold Strikes</div>
      {blocks?.length>0 ? (
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {blocks.slice(0,5).map(b=>(
            <div key={b.hash} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.5rem 0.7rem',background:'var(--bg-raised)',border:'1px solid var(--amber)'}}>
              <div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--cyan)',fontWeight:600}}>#{fmtNum(b.height)}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)'}}>{timeAgo(b.ts)}</div>
              </div>
              <div style={{fontFamily:'var(--fd)',fontSize:'0.85rem',color:'var(--amber)',fontWeight:600}}>{(b.reward||0).toFixed(3)} BTC</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{textAlign:'center',padding:'1.5rem',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)',letterSpacing:'0.05em'}}>
          No strikes yet. Keep digging…
        </div>
      )}
    </div>
  );
}

// ── Recent network blocks ─────────────────────────────────────────────────────
function RecentBlocksPanel({ netBlocks }) {
  if (!netBlocks?.length) return null;
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ The Goldfields</div>
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        {netBlocks.slice(0,8).map(b=>(
          <div key={b.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'0.4rem 0.6rem',background:'var(--bg-raised)',border:'1px solid var(--border)',gap:8}}>
            <div style={{flex:1, minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <span style={{fontFamily:'var(--fm)',fontSize:'0.75rem',color:'var(--cyan)',fontWeight:600}}>#{fmtNum(b.height)}</span>
                {b.isSolo && <span style={{fontFamily:'var(--fd)',fontSize:'0.45rem',letterSpacing:'0.1em',color:'var(--amber)',border:'1px solid var(--amber)',padding:'1px 3px'}}>SOLO</span>}
              </div>
              <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:b.isSolo?'var(--amber)':'var(--text-2)',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.pool}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',fontSize:'0.6rem',fontFamily:'var(--fm)'}}>
              <span style={{color:'var(--text-2)'}}>{blockTimeAgo(b.timestamp)}</span>
              {b.reward && <span style={{color:'var(--green)',marginTop:1}}>{(b.reward/1e8).toFixed(3)}</span>}
            </div>
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
  const stripIds = stripSettings.metricIds;
  const tickerIds = tickerSettings.metricIds;
  const stripSet = new Set(stripIds);
  const tickerSet = new Set(tickerIds);
  const fadeSec = (stripSettings.fadeMs || DEFAULT_FADE_MS) / 1000;
  const [draggedStrip, setDraggedStrip] = useState(null);
  const [draggedTicker, setDraggedTicker] = useState(null);

  const moveStrip = (idx, dir) => {
    const next = [...stripIds];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    const tmp = next[idx]; next[idx] = next[swap]; next[swap] = tmp;
    onStripSettingsChange({ ...stripSettings, metricIds: next });
  };

  const moveTicker = (idx, dir) => {
    const next = [...tickerIds];
    const swap = idx + dir;
    if (swap < 0 || swap >= next.length) return;
    const tmp = next[idx]; next[idx] = next[swap]; next[swap] = tmp;
    onTickerSettingsChange({ ...tickerSettings, metricIds: next });
  };

  const reorderStrip = (fromId, toId) => {
    if (fromId === toId) return;
    const fromIdx = stripIds.indexOf(fromId);
    const toIdx = stripIds.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...stripIds];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onStripSettingsChange({ ...stripSettings, metricIds: next });
  };

  const reorderTicker = (fromId, toId) => {
    if (fromId === toId) return;
    const fromIdx = tickerIds.indexOf(fromId);
    const toIdx = tickerIds.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    const next = [...tickerIds];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    onTickerSettingsChange({ ...tickerSettings, metricIds: next });
  };

  const toggleStripMetric = (id) => {
    if (stripSet.has(id)) {
      const next = stripIds.filter(x=>x!==id);
      onStripSettingsChange({ ...stripSettings, metricIds: next });
    } else {
      onStripSettingsChange({ ...stripSettings, metricIds: [...stripIds, id] });
    }
  };

  const toggleTickerMetric = (id) => {
    if (tickerSet.has(id)) {
      const next = tickerIds.filter(x=>x!==id);
      onTickerSettingsChange({ ...tickerSettings, metricIds: next });
    } else {
      onTickerSettingsChange({ ...tickerSettings, metricIds: [...tickerIds, id] });
    }
  };

  const sectionStyle = { marginBottom: 18, paddingBottom: 14, borderBottom:'1px dashed var(--border)' };
  const rowLabel = { fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:6, textTransform:'uppercase' };
  const inputStyle = { width:'100%', padding:'0.5rem', background:'var(--bg-deep)', border:'1px solid var(--border)', color:'var(--text-1)', fontFamily:'var(--fm)', fontSize:'0.75rem', outline:'none', boxSizing:'border-box' };

  // Card preset helpers
  const applyPreset = (preset) => onVisibleCardsChange(preset);
  const matchesPreset = (preset) => {
    if (visibleCards.length !== preset.length) return false;
    return preset.every(id => visibleCards.includes(id));
  };
  const toggleCard = (id) => {
    if (visibleCards.includes(id)) {
      onVisibleCardsChange(visibleCards.filter(x => x !== id));
    } else {
      onVisibleCardsChange([...visibleCards, id]);
    }
  };
  const presetBtnStyle = (active) => ({
    padding:'6px 12px', background:active?'var(--bg-raised)':'transparent',
    border: active?'1px solid var(--amber)':'1px solid var(--border)',
    color: active?'var(--amber)':'var(--text-2)',
    fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em',
    cursor:'pointer', textTransform:'uppercase'
  });

  return (
    <>
      <div style={sectionStyle}>
        <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:6}}>
          <input type="checkbox" id="minimal-mode" checked={minimalMode} onChange={e=>onMinimalModeChange(e.target.checked)} style={{accentColor:'var(--amber)'}}/>
          <label htmlFor="minimal-mode" style={{fontFamily:'var(--fd)', fontSize:'0.7rem', color:'var(--text-1)', cursor:'pointer', letterSpacing:'0.05em'}}>Minimal mode</label>
        </div>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-3)', marginLeft:24}}>Hides strips, ticker, and most cards. Just the essentials.</div>
      </div>

      <div style={sectionStyle}>
        <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:8}}>
          <input type="checkbox" id="strip-enabled" checked={stripSettings.enabled} onChange={e=>onStripSettingsChange({...stripSettings, enabled:e.target.checked})} style={{accentColor:'var(--amber)'}}/>
          <label htmlFor="strip-enabled" style={{fontFamily:'var(--fd)', fontSize:'0.7rem', color:'var(--text-1)', cursor:'pointer', letterSpacing:'0.05em'}}>Show top strip</label>
        </div>
        {stripSettings.enabled && (
          <>
            <div style={{display:'flex', gap:'0.6rem', marginBottom:10}}>
              <div style={{flex:1}}>
                <div style={rowLabel}>Per slide</div>
                <input type="number" min="1" max="8" value={stripSettings.chunkSize} onChange={e=>onStripSettingsChange({...stripSettings, chunkSize:Math.max(1, Math.min(8, parseInt(e.target.value)||1))})} style={inputStyle}/>
              </div>
              <div style={{flex:1}}>
                <div style={rowLabel}>Speed (sec)</div>
                <input type="number" min="1" max="20" step="0.5" value={fadeSec} onChange={e=>onStripSettingsChange({...stripSettings, fadeMs:Math.round((parseFloat(e.target.value)||4)*1000)})} style={inputStyle}/>
              </div>
            </div>
            <div style={rowLabel}>Selected ({stripIds.length}) — drag to reorder</div>
            <div style={{display:'flex', flexDirection:'column', gap:3, padding:4, background:'var(--bg-deep)', border:'1px solid var(--border)', marginBottom:8}}>
              {stripIds.length === 0 && <div style={{fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-3)', padding:'0.4rem'}}>No metrics selected</div>}
              {stripIds.map((id, idx) => {
                const m = METRIC_MAP[id];
                if (!m) return null;
                return (
                  <div key={id} draggable
                    onDragStart={()=>setDraggedStrip(id)}
                    onDragOver={e=>{e.preventDefault();}}
                    onDrop={()=>{ reorderStrip(draggedStrip, id); setDraggedStrip(null); }}
                    onDragEnd={()=>setDraggedStrip(null)}
                    style={{display:'flex', alignItems:'center', gap:8, padding:'5px 8px', background: draggedStrip===id ? 'var(--bg-raised)' : 'transparent', borderBottom:'1px solid rgba(255,255,255,0.03)', cursor:'grab'}}>
                    <span style={{color:'var(--text-3)', fontSize:14}}>≡</span>
                    <span style={{flex:1, fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-1)'}}>{m.icon||''} {m.label}</span>
                    <button onClick={()=>moveStrip(idx, -1)} disabled={idx===0} style={{background:'transparent', border:'1px solid var(--border)', color:idx===0?'var(--text-3)':'var(--text-2)', fontFamily:'var(--fd)', fontSize:'0.55rem', padding:'2px 5px', cursor:idx===0?'default':'pointer'}}>↑</button>
                    <button onClick={()=>moveStrip(idx, 1)} disabled={idx===stripIds.length-1} style={{background:'transparent', border:'1px solid var(--border)', color:idx===stripIds.length-1?'var(--text-3)':'var(--text-2)', fontFamily:'var(--fd)', fontSize:'0.55rem', padding:'2px 5px', cursor:idx===stripIds.length-1?'default':'pointer'}}>↓</button>
                    <button onClick={()=>toggleStripMetric(id)} style={{background:'transparent', border:'1px solid var(--red)', color:'var(--red)', fontFamily:'var(--fd)', fontSize:'0.55rem', padding:'2px 5px', cursor:'pointer'}}>✕</button>
                  </div>
                );
              })}
            </div>
            <div style={rowLabel}>Available — tap to add</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:5}}>
              {Object.entries(METRIC_CATEGORIES).map(([cat, ids]) => {
                const available = ids.filter(id => !stripSet.has(id));
                if (!available.length) return null;
                return (
                  <React.Fragment key={cat}>
                    <div style={{width:'100%', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--text-3)', marginTop:6, marginBottom:2, textTransform:'uppercase'}}>{cat}</div>
                    {available.map(id => {
                      const m = METRIC_MAP[id];
                      return (
                        <button key={id} onClick={()=>toggleStripMetric(id)} style={{padding:'5px 8px', background:'var(--bg-raised)', border:'1px solid var(--border)', color:'var(--text-2)', fontFamily:'var(--fm)', fontSize:'0.65rem', cursor:'pointer'}}>+ {m.icon||''} {m.label}</button>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div style={sectionStyle}>
        <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:8}}>
          <input type="checkbox" id="ticker-enabled" checked={tickerSettings.enabled} onChange={e=>onTickerSettingsChange({...tickerSettings, enabled:e.target.checked})} style={{accentColor:'var(--amber)'}}/>
          <label htmlFor="ticker-enabled" style={{fontFamily:'var(--fd)', fontSize:'0.7rem', color:'var(--text-1)', cursor:'pointer', letterSpacing:'0.05em'}}>Show scrolling ticker</label>
        </div>
        {tickerSettings.enabled && (
          <>
            <div style={{display:'flex', gap:'0.6rem', marginBottom:10}}>
              <div style={{flex:1}}>
                <div style={rowLabel}>Speed (seconds for one cycle)</div>
                <input type="number" min="3" max="120" step="1" value={tickerSettings.speedSec} onChange={e=>onTickerSettingsChange({...tickerSettings, speedSec:Math.max(3, Math.min(120, parseInt(e.target.value)||30))})} style={inputStyle}/>
              </div>
            </div>
            <div style={rowLabel}>Selected ({tickerIds.length}) — drag to reorder</div>
            <div style={{display:'flex', flexDirection:'column', gap:3, padding:4, background:'var(--bg-deep)', border:'1px solid var(--border)', marginBottom:8}}>
              {tickerIds.length === 0 && <div style={{fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-3)', padding:'0.4rem'}}>No metrics selected</div>}
              {tickerIds.map((id, idx) => {
                const m = METRIC_MAP[id];
                if (!m) return null;
                return (
                  <div key={id} draggable
                    onDragStart={()=>setDraggedTicker(id)}
                    onDragOver={e=>{e.preventDefault();}}
                    onDrop={()=>{ reorderTicker(draggedTicker, id); setDraggedTicker(null); }}
                    onDragEnd={()=>setDraggedTicker(null)}
                    style={{display:'flex', alignItems:'center', gap:8, padding:'5px 8px', background: draggedTicker===id ? 'var(--bg-raised)' : 'transparent', borderBottom:'1px solid rgba(255,255,255,0.03)', cursor:'grab'}}>
                    <span style={{color:'var(--text-3)', fontSize:14}}>≡</span>
                    <span style={{flex:1, fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-1)'}}>{m.icon||''} {m.label}</span>
                    <button onClick={()=>moveTicker(idx, -1)} disabled={idx===0} style={{background:'transparent', border:'1px solid var(--border)', color:idx===0?'var(--text-3)':'var(--text-2)', fontFamily:'var(--fd)', fontSize:'0.55rem', padding:'2px 5px', cursor:idx===0?'default':'pointer'}}>↑</button>
                    <button onClick={()=>moveTicker(idx, 1)} disabled={idx===tickerIds.length-1} style={{background:'transparent', border:'1px solid var(--border)', color:idx===tickerIds.length-1?'var(--text-3)':'var(--text-2)', fontFamily:'var(--fd)', fontSize:'0.55rem', padding:'2px 5px', cursor:idx===tickerIds.length-1?'default':'pointer'}}>↓</button>
                    <button onClick={()=>toggleTickerMetric(id)} style={{background:'transparent', border:'1px solid var(--red)', color:'var(--red)', fontFamily:'var(--fd)', fontSize:'0.55rem', padding:'2px 5px', cursor:'pointer'}}>✕</button>
                  </div>
                );
              })}
            </div>
            <div style={rowLabel}>Available — tap to add</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:5}}>
              {Object.entries(METRIC_CATEGORIES).map(([cat, ids]) => {
                const available = ids.filter(id => !tickerSet.has(id));
                if (!available.length) return null;
                return (
                  <React.Fragment key={cat}>
                    <div style={{width:'100%', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--text-3)', marginTop:6, marginBottom:2, textTransform:'uppercase'}}>{cat}</div>
                    {available.map(id => {
                      const m = METRIC_MAP[id];
                      return (
                        <button key={id} onClick={()=>toggleTickerMetric(id)} style={{padding:'5px 8px', background:'var(--bg-raised)', border:'1px solid var(--border)', color:'var(--text-2)', fontFamily:'var(--fm)', fontSize:'0.65rem', cursor:'pointer'}}>+ {m.icon||''} {m.label}</button>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div style={sectionStyle}>
        <div style={rowLabel}>Visible cards ({visibleCards.length}/{ALL_CARDS.length})</div>
        <div style={{display:'flex', gap:5, marginBottom:8, flexWrap:'wrap'}}>
          <button onClick={()=>applyPreset(MINIMAL_PRESET)} style={presetBtnStyle(matchesPreset(MINIMAL_PRESET))}>
            Minimal ({MINIMAL_PRESET.length})
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
                  style={{width:18, height:18, padding:0, background:on?'var(--amber)':'transparent', border:'1px solid '+(on?'var(--amber)':'var(--border)'), color:'#000', fontFamily:'var(--fd)', fontSize:'0.65rem', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center'}}>
                  {on ? '✓' : ''}
                </button>
                <span style={{flex:1, fontFamily:'var(--fm)', fontSize:'0.72rem', color:on?'var(--text-1)':'var(--text-3)'}}>{c.label}</span>
              </div>
            );
          })}
        </div>
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
  const [aliasEdit, setAliasEdit] = useState(aliases?.[worker?.name] || '');
  const [noteEdit, setNoteEdit] = useState(notes?.[worker?.name] || '');
  const [savedFlash, setSavedFlash] = useState(false);

  if (!worker) return null;

  const save = () => {
    const newAliases = { ...aliases };
    if (aliasEdit.trim()) newAliases[worker.name] = aliasEdit.trim();
    else delete newAliases[worker.name];
    onAliasesChange(newAliases);

    const newNotes = { ...notes };
    if (noteEdit.trim()) newNotes[worker.name] = noteEdit.trim();
    else delete newNotes[worker.name];
    onNotesChange(newNotes);

    setSavedFlash(true);
    setTimeout(()=>setSavedFlash(false), 1500);
  };

  const stripped = stripAddr(worker.name);
  const total = (worker.shares||0) + (worker.rejected||0);
  const acceptPct = total > 0 ? ((worker.shares||0)/total*100) : 100;

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'1rem',overflowY:'auto'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-elevated, #15161a)',border:'1px solid var(--border)',maxWidth:520,width:'100%',padding:'1.4rem',marginTop:'2rem'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <h3 style={{margin:0,fontFamily:'var(--fd)',fontSize:'0.85rem',letterSpacing:'0.18em',color:'var(--amber)'}}>▸ Worker Details</h3>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:'1.2rem'}}>✕</button>
        </div>

        <div style={{padding:'0.75rem',background:'var(--bg-raised)',border:'1px solid var(--border)',marginBottom:14}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase',marginBottom:3}}>Worker Name</div>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.8rem',color:'var(--text-1)',fontWeight:600,wordBreak:'break-all'}}>{stripped}</div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
          <div style={{padding:'0.55rem',background:'var(--bg-raised)',border:'1px solid var(--border)',textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Status</div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.85rem',color:worker.status==='offline'?'var(--text-2)':'var(--green)',fontWeight:700,marginTop:4}}>{worker.status==='offline'?'OFFLINE':'ONLINE'}</div>
          </div>
          <div style={{padding:'0.55rem',background:'var(--bg-raised)',border:'1px solid var(--border)',textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Hashrate</div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.85rem',color:'var(--amber)',fontWeight:700,marginTop:4}}>{worker.status==='offline'?'—':fmtHr(worker.hashrate)}</div>
          </div>
          <div style={{padding:'0.55rem',background:'var(--bg-raised)',border:'1px solid var(--border)',textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Best Share</div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.85rem',color:'var(--amber)',fontWeight:700,marginTop:4}}>{worker.bestshare?fmtDiff(worker.bestshare):'—'}</div>
          </div>
          <div style={{padding:'0.55rem',background:'var(--bg-raised)',border:'1px solid var(--border)',textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.12em',color:'var(--text-3)',textTransform:'uppercase'}}>Accept</div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.85rem',color:acceptPct>99?'var(--green)':acceptPct>95?'var(--amber)':'var(--red)',fontWeight:700,marginTop:4}}>{acceptPct.toFixed(2)}%</div>
          </div>
        </div>

        {worker.lastRejectReason && (
          <div style={{padding:'0.55rem',background:'rgba(255,59,59,0.05)',border:'1px solid rgba(255,59,59,0.3)',marginBottom:14}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',color:'var(--red)',textTransform:'uppercase',marginBottom:3}}>Last Reject Reason</div>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-1)'}}>{worker.lastRejectReason}</div>
          </div>
        )}

        <div style={{marginBottom:12}}>
          <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em', color:'var(--text-2)', marginBottom:5, textTransform:'uppercase'}}>Alias (private to you)</label>
          <input type="text" value={aliasEdit} onChange={e=>setAliasEdit(e.target.value)} placeholder="e.g. Garage S19"
            style={{width:'100%',padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.75rem',outline:'none',boxSizing:'border-box'}}/>
        </div>

        <div style={{marginBottom:14}}>
          <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em', color:'var(--text-2)', marginBottom:5, textTransform:'uppercase'}}>Notes</label>
          <textarea value={noteEdit} onChange={e=>setNoteEdit(e.target.value)} rows={3} placeholder="Maintenance notes, location, model details…"
            style={{width:'100%',padding:'0.5rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.75rem',outline:'none',boxSizing:'border-box',resize:'vertical'}}/>
        </div>

        <button onClick={save} style={{width:'100%',padding:'0.6rem',background:savedFlash?'var(--green)':'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontWeight:700,letterSpacing:'0.1em',fontSize:'0.7rem',cursor:'pointer',textTransform:'uppercase'}}>
          {savedFlash ? '✓ SAVED' : 'SAVE'}
        </button>
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
  const { connected, state: poolState, lastBlock, blockAlert, setBlockAlert, saveConfig, refreshConfig } = usePool();
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
    closestcalls: <ClosestCallsPanel closestCalls={poolState?.closestCalls} aliases={aliases}/>,
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
