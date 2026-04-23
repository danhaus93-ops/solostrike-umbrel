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
  { id:'hashrate',      label:'Pool Hashrate' },
  { id:'workers',       label:'Connected Workers' },
  { id:'network',       label:'Bitcoin Network' },
  { id:'node',          label:'Bitcoin Node' },
  { id:'odds',          label:'Block Probability' },
  { id:'luck',          label:'Luck Gauge' },
  { id:'retarget',      label:'Difficulty Retarget' },
  { id:'shares',        label:'Share Stats' },
  { id:'best',          label:'Leaderboard' },
  { id:'closestcalls',  label:'Closest Calls — Top 10' },
  { id:'blocks',        label:'Blocks Found' },
  { id:'topfinders',    label:'Top Pool Finders' },
  { id:'recent',        label:'Recent Network Blocks' },
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
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>▸ Pool Hashrate — Live</span>
        {peak > 0 && <span style={{color:'var(--amber-dim, #b37a1a)', fontFamily:'var(--fm)', fontSize:'0.6rem', letterSpacing:'0.08em'}}>PEAK {fmtHr(peak)}</span>}
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
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>▸ Connected Workers</span>
        <span style={{color:'var(--amber)'}}>{online}/{sorted.length} online</span>
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
        <div style={cardTitle}>▸ Closest Calls — Top 10 Near-Misses</div>
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
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>▸ Closest Calls — All-Time Top {list.length}</span>
        <span style={{color:'var(--amber)', fontFamily:'var(--fm)', fontSize:'0.6rem', letterSpacing:'0.08em'}}>fleet-wide</span>
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

// ── Bitcoin Node ──────────────────────────────────────────────────────────────
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

// ── Odds ──────────────────────────────────────────────────────────────────────
function OddsDisplay({ odds, hashrate, netHashrate }) {
  const { perBlock=0, expectedDays=null, perDay=0, perWeek=0, perMonth=0 } = odds||{};
  const R=48, C=2*Math.PI*R;
  const scale=perBlock>0?Math.min(1,Math.log10(1+perBlock*1e9)/3):0;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Block Probability</div>
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

// ── Luck ──────────────────────────────────────────────────────────────────────
function LuckGauge({ luck }) {
  const { progress=0, blocksExpected=0, blocksFound=0, luck: luckVal=null } = luck||{};
  const visualPct = Math.min(300, progress);
  const w = Math.min(100, visualPct/3);
  const barColor = luckVal==null ? 'var(--amber)' : (luckVal>=100 ? 'var(--green)' : luckVal>=50 ? 'var(--amber)' : 'var(--red)');
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Luck — Since Pool Start</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.6rem'}}>
        <div style={{textAlign:'center',padding:'0.6rem 0'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'2rem',fontWeight:700,color:barColor,textShadow:`0 0 20px ${barColor}50`,lineHeight:1}}>
            {luckVal==null ? '—' : fmtPct(luckVal, 1)}
          </div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginTop:4}}>
            {luckVal==null ? 'warming up' : luckVal>=100 ? 'lucky' : 'unlucky so far'}
          </div>
        </div>
        <div>
          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:4}}>
            <span>Progress to next block</span>
            <span style={{color:'var(--amber)'}}>{fmtPct(progress,2)}</span>
          </div>
          <div style={{height:4,background:'var(--bg-deep)',borderRadius:2,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${w}%`,background:barColor,boxShadow:`0 0 8px ${barColor}80`,transition:'width 0.6s ease'}}/>
          </div>
        </div>
        <div style={{...statRow,marginBottom:0}}><span style={label}>Blocks Expected</span><span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{blocksExpected.toFixed(3)}</span></div>
        <div style={{...statRow,marginBottom:0}}><span style={label}>Blocks Found</span><span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:blocksFound>0?'var(--green)':'var(--text-1)'}}>{blocksFound}</span></div>
      </div>
    </div>
  );
}

// ── Retarget ──────────────────────────────────────────────────────────────────
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

// ── Share stats ───────────────────────────────────────────────────────────────
function ShareStats({ shares, hashrate, bestshare }) {
  const s = shares || {};
  const workAccepted = s.accepted || 0;
  const workRejected = s.rejected || 0;
  const stale = s.stale || 0;
  const total = workAccepted + workRejected || 1;
  const acceptRate = ((workAccepted / total) * 100).toFixed(2);
  const sharesPerMin = hashrate > 0 ? (hashrate / 4294967296 * 60).toFixed(1) : '0';
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>▸ Share Stats</span>
        <a href="/api/export/workers.csv" download style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',color:'var(--cyan)',textDecoration:'none',border:'1px solid var(--border)',padding:'2px 6px',background:'var(--bg-raised)'}}>⬇ CSV</a>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.6rem'}}>
        <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.875rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Work Accepted</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.8rem',fontWeight:700,color:'var(--green)',lineHeight:1}}>{fmtDiff(workAccepted)}</div>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-2)',marginTop:6}}>
            {workRejected>0 && <><span style={{color:'var(--red)'}}>{fmtDiff(workRejected)}</span> rejected</>}
            {stale>0 && <> · <span style={{color:'var(--amber)'}}>{fmtDiff(stale)}</span> stale</>}
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
      </div>
    </div>
  );
}

// ── Leaderboard ───────────────────────────────────────────────────────────────
function BestShareLeaderboard({ workers, poolBest, aliases }) {
  const sorted = [...(workers || [])].filter(w => (w.bestshare||0) > 0).sort((a, b) => (b.bestshare || 0) - (a.bestshare || 0)).slice(0, 5);
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Leaderboard — Best Difficulties</div>
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

// ── Top Pool Finders ──────────────────────────────────────────────────────────
function TopFindersPanel({ topFinders, netBlocks }) {
  const list = topFinders || [];
  const totalSample = (netBlocks||[]).length;
  if (!list.length) return null;
  const maxCount = list[0]?.count || 1;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Top Pool Finders — Last {totalSample} Blocks</div>
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


// ── Block feed ────────────────────────────────────────────────────────────────
function BlockFeed({ blocks, blockAlert }) {
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>▸ Blocks Found — {(blocks||[]).length} total</span>
        {(blocks||[]).length>0 && <a href="/api/export/blocks.csv" download style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',color:'var(--cyan)',textDecoration:'none',border:'1px solid var(--border)',padding:'2px 6px',background:'var(--bg-raised)'}}>⬇ CSV</a>}
      </div>
      {!(blocks||[]).length?(
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)'}}>No blocks found yet.<br/><span style={{color:'var(--amber)',fontSize:'0.68rem'}}>Keep mining ⛏</span></div>
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
      <div style={cardTitle}>▸ Recent Network Blocks — Solo Winners ⚡</div>
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

// ── Confetti + BlockAlert ─────────────────────────────────────────────────────
function Confetti() {
  const ref = useRef(null);
  useEffect(()=>{
    const canvas=ref.current; if(!canvas)return;
    const ctx=canvas.getContext('2d'); canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    const colors=['#F5A623','#00FFD1','#39FF6A','#FF7A00','#fff'];
    const pts=Array.from({length:150},()=>({x:Math.random()*canvas.width,y:-10,vy:3+Math.random()*5,vx:(Math.random()-.5)*4,s:3+Math.random()*6,c:colors[Math.floor(Math.random()*colors.length)],r:Math.random()*360,rv:(Math.random()-.5)*8,op:1}));
    let frame; const draw=()=>{ ctx.clearRect(0,0,canvas.width,canvas.height); let alive=false;
      pts.forEach(p=>{p.y+=p.vy;p.x+=p.vx;p.r+=p.rv;p.op-=0.007; if(p.y<canvas.height&&p.op>0)alive=true;
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r*Math.PI/180);ctx.globalAlpha=Math.max(0,p.op);ctx.fillStyle=p.c;ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s);ctx.restore();
      }); if(alive)frame=requestAnimationFrame(draw); };
    frame=requestAnimationFrame(draw); return ()=>cancelAnimationFrame(frame);
  },[]);
  return <canvas ref={ref} style={{position:'fixed',inset:0,pointerEvents:'none',zIndex:500}}/>;
}
function BlockAlert({ show, block, onDismiss }) {
  useEffect(()=>{ if(show){const t=setTimeout(onDismiss,8000); return()=>clearTimeout(t);} },[show,onDismiss]);
  if(!show||!block)return null;
  return(
    <div style={{position:'fixed',top:'8rem',left:'50%',transform:'translateX(-50%)',zIndex:300,background:'var(--bg-surface)',border:'2px solid var(--green)',padding:'1.5rem 2rem',boxShadow:'0 0 60px rgba(57,255,106,0.6)',animation:'fadeIn .5s ease',maxWidth:'90%'}}>
      <div style={{fontFamily:'var(--fd)',fontSize:'0.7rem',letterSpacing:'0.2em',color:'var(--green)',textTransform:'uppercase',marginBottom:'0.5rem',textAlign:'center'}}>✦ BLOCK FOUND ✦</div>
      <div style={{fontFamily:'var(--fd)',fontSize:'2.5rem',fontWeight:700,color:'var(--amber)',textAlign:'center',textShadow:'0 0 20px var(--amber)'}}>#{fmtNum(block.height)}</div>
      <button onClick={onDismiss} style={{width:'100%',marginTop:'1rem',padding:'0.5rem',background:'transparent',border:'1px solid var(--green)',color:'var(--green)',fontFamily:'var(--fd)',fontSize:'0.7rem',letterSpacing:'0.1em',cursor:'pointer'}}>DISMISS</button>
    </div>
  );
}

// ── Setup form ────────────────────────────────────────────────────────────────
function SetupForm({ saveConfig }) {
  const [addr,setAddr]=useState(''); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const submit=async()=>{
    setError('');const t=addr.trim();
    if(!t){setError('Address required');return;}
    if(!isValidBtcAddress(t)){setError("That doesn't look like a valid Bitcoin address.");return;}
    setLoading(true);
    try{await saveConfig({payoutAddress:t});}catch(e){setError(e.message);}finally{setLoading(false);}
  };
  return (
    <div style={{minHeight:'80vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'2rem 1rem'}}>
      <div style={{width:'100%',maxWidth:440,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',padding:'2rem'}}>
        <h2 style={{fontFamily:'var(--fd)',fontSize:'1.2rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.05em',marginBottom:'0.5rem',textShadow:'var(--glow-a)'}}>⛏ SoloStrike Setup</h2>
        <p style={{fontFamily:'var(--fd)',fontSize:'0.72rem',color:'var(--text-2)',marginBottom:'1.5rem',letterSpacing:'0.05em',lineHeight:1.6}}>Set your Bitcoin payout address to begin mining. You're 100% solo — if you find a block, you keep all of it.</p>
        <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.62rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem'}}>Bitcoin Payout Address</label>
        <input style={{width:'100%',background:'var(--bg-deep)',border:`1px solid ${error?'rgba(255,59,59,0.5)':addr?'var(--border-hot)':'var(--border)'}`,color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.82rem',padding:'0.75rem 1rem',outline:'none',boxSizing:'border-box'}}
          type="text" placeholder="bc1q… or 1… or 3…" value={addr} onChange={e=>{setAddr(e.target.value);setError('');}} onKeyDown={e=>e.key==='Enter'&&submit()} spellCheck={false} autoCorrect="off" autoCapitalize="off"/>
        {error&&<div style={{background:'rgba(255,59,59,0.08)',border:'1px solid rgba(255,59,59,0.3)',padding:'0.6rem 0.875rem',fontSize:'0.75rem',color:'var(--red)',marginTop:'0.75rem'}}>⚠ {error}</div>}
        <button onClick={submit} disabled={loading} style={{width:'100%',marginTop:'1.5rem',padding:'0.875rem',background:'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:700,letterSpacing:'0.15em',textTransform:'uppercase',cursor:'pointer',opacity:loading?0.6:1}}>
          {loading?'SAVING…':'START MINING →'}
        </button>
      </div>
    </div>
  );
}

// ── Settings modal ────────────────────────────────────────────────────────────
function SettingsModal({ onClose, saveConfig, currentConfig, currency, onCurrencyChange, onResetLayout, workers, aliases, onAliasesChange, stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange }) {
  const [tab, setTab] = useState('main');
  const [addr,setAddr]=useState('');
  const [poolName,setPoolName]=useState(currentConfig?.poolName||'SoloStrike');
  const [privateMode, setPrivateMode] = useState(!!currentConfig?.privateMode);
  const [loading,setLoading]=useState(false);
  const [saved,setSaved]=useState(false);
  const [error,setError]=useState('');

  useEffect(() => {
    setPrivateMode(!!currentConfig?.privateMode);
    setPoolName(currentConfig?.poolName || 'SoloStrike');
  }, [currentConfig]);

  const submit = async () => {
    setLoading(true);setError('');setSaved(false);
    try{
      const p = { poolName, privateMode };
      const trimmed=addr.trim();
      if(trimmed){ if(!isValidBtcAddress(trimmed)){setError("That doesn't look like a valid Bitcoin address.");setLoading(false);return;} p.payoutAddress=trimmed; }
      await saveConfig(p); setSaved(true); setAddr(''); setTimeout(()=>setSaved(false),3000);
    } catch(e){setError(e.message);} finally{setLoading(false);}
  };

  const tabStyle = (active) => ({
    padding:'0.5rem 0.55rem', background:active?'var(--bg-raised)':'transparent',
    border:'1px solid', borderColor:active?'var(--border-hot)':'var(--border)',
    color:active?'var(--amber)':'var(--text-2)',
    fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em',
    textTransform:'uppercase', cursor:'pointer', flex:1, textAlign:'center',
  });

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'1rem'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:500,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',padding:'1.5rem',boxShadow:'var(--glow-a)',maxHeight:'92vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1rem'}}>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--amber)'}}>⚙ Settings</span>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:18}}>✕</button>
        </div>
        <div style={{display:'flex',gap:3,marginBottom:'1rem',flexWrap:'wrap'}}>
          <button onClick={()=>setTab('main')}     style={tabStyle(tab==='main')}>Main</button>
          <button onClick={()=>setTab('display')}  style={tabStyle(tab==='display')}>Display</button>
          <button onClick={()=>setTab('privacy')}  style={tabStyle(tab==='privacy')}>Privacy</button>
          <button onClick={()=>setTab('aliases')}  style={tabStyle(tab==='aliases')}>Names</button>
          <button onClick={()=>setTab('hooks')}    style={tabStyle(tab==='hooks')}>Webhooks</button>
        </div>
        {saved&&<div style={{background:'rgba(57,255,106,0.06)',border:'1px solid rgba(57,255,106,0.2)',padding:'0.5rem 0.75rem',fontSize:'0.72rem',color:'var(--green)',marginBottom:'1rem'}}>✓ Saved</div>}
        {error&&<div style={{background:'rgba(255,59,59,0.06)',border:'1px solid rgba(255,59,59,0.2)',padding:'0.5rem 0.75rem',fontSize:'0.72rem',color:'var(--red)',marginBottom:'1rem'}}>⚠ {error}</div>}

        {tab==='main' && <MainTab addr={addr} setAddr={setAddr} poolName={poolName} setPoolName={setPoolName} currency={currency} onCurrencyChange={onCurrencyChange} onResetLayout={onResetLayout} submit={submit} saved={saved} loading={loading}/>}
        {tab==='display' && <DisplayTab stripSettings={stripSettings} onStripSettingsChange={onStripSettingsChange} tickerSettings={tickerSettings} onTickerSettingsChange={onTickerSettingsChange} minimalMode={minimalMode} onMinimalModeChange={onMinimalModeChange} visibleCards={visibleCards} onVisibleCardsChange={onVisibleCardsChange}/>}
        {tab==='privacy' && <PrivacyTab privateMode={privateMode} setPrivateMode={setPrivateMode} submit={submit} saved={saved} loading={loading}/>}
        {tab==='aliases' && <AliasesTab workers={workers} aliases={aliases} onAliasesChange={onAliasesChange}/>}
        {tab==='hooks' && <WebhooksTab />}
      </div>
    </div>
  );
}

function MainTab({addr,setAddr,poolName,setPoolName,currency,onCurrencyChange,onResetLayout,submit,saved,loading}) {
  const [show,setShow]=useState(false);
  return (
    <>
      <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem'}}>New Payout Address</label>
      <div style={{position:'relative'}}>
        <input style={{width:'100%',background:'var(--bg-deep)',border:`1px solid ${addr?'var(--border-hot)':'var(--border)'}`,color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.8rem',padding:'0.7rem 2.5rem 0.7rem 0.875rem',outline:'none',boxSizing:'border-box'}} type={show?'text':'password'} placeholder="Leave blank to keep current" value={addr} onChange={e=>setAddr(e.target.value)} spellCheck={false} autoCorrect="off" autoCapitalize="off"/>
        <button onClick={()=>setShow(v=>!v)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:12}}>{show?'🙈':'👁'}</button>
      </div>
      <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem',marginTop:'1rem'}}>Pool Name</label>
      <input style={{width:'100%',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.8rem',padding:'0.7rem 0.875rem',outline:'none',boxSizing:'border-box'}} maxLength={32} value={poolName} onChange={e=>setPoolName(e.target.value)}/>
      <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem',marginTop:'1rem'}}>BTC Price Currency</label>
      <select value={currency} onChange={e=>onCurrencyChange(e.target.value)} style={{width:'100%',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.8rem',padding:'0.7rem 0.875rem',outline:'none',boxSizing:'border-box'}}>
        {CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}
      </select>
      <div style={{height:1,background:'var(--border)',margin:'1.25rem 0'}}/>
      <button onClick={onResetLayout} style={{width:'100%',padding:'0.6rem',background:'var(--bg-raised)',color:'var(--text-2)',border:'1px solid var(--border)',fontFamily:'var(--fd)',fontSize:'0.7rem',fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',cursor:'pointer',marginBottom:'0.75rem'}}>↺ Reset Card Layout</button>
      <button onClick={submit} disabled={loading} style={{width:'100%',padding:'0.75rem',background:saved?'var(--green)':'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.8rem',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',cursor:'pointer',opacity:loading?0.6:1}}>
        {loading?'SAVING…':saved?'✓ SAVED':'SAVE SETTINGS'}
      </button>
    </>
  );
}

// ── DisplayTab ────────────────────────────────────────────────────────────────
function DisplayTab({ stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange }) {
  const toggleMetric = (id) => {
    const next = stripSettings.metrics.includes(id) ? stripSettings.metrics.filter(x => x !== id) : [...stripSettings.metrics, id];
    onStripSettingsChange({ ...stripSettings, metrics: next });
  };
  const moveMetric = (id, dir) => {
    const idx = stripSettings.metrics.indexOf(id);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= stripSettings.metrics.length) return;
    const next = [...stripSettings.metrics];
    const tmp = next[idx];
    next[idx] = next[swap];
    next[swap] = tmp;
    onStripSettingsChange({ ...stripSettings, metrics: next });
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
    const current = tickerSettings.metrics || [];
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    onTickerSettingsChange({ ...tickerSettings, metrics: next });
  };
  const moveTickerMetric = (id, dir) => {
    const current = tickerSettings.metrics || [];
    const idx = current.indexOf(id);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= current.length) return;
    const next = [...current];
    const tmp = next[idx]; next[idx] = next[swap]; next[swap] = tmp;
    onTickerSettingsChange({ ...tickerSettings, metrics: next });
  };
  const matchTickerToStrip = () => {
    onTickerSettingsChange({ ...tickerSettings, metrics: [...(stripSettings.metrics || [])] });
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
  );
}

function PrivacyTab({privateMode,setPrivateMode,submit,saved,loading}) {
  return (
    <>
      <div style={{background:'var(--bg-deep)',border:'1px solid var(--border)',padding:'1rem',marginBottom:'1rem'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'0.6rem'}}>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.8rem',fontWeight:700,color:privateMode?'var(--cyan)':'var(--text-1)',letterSpacing:'0.08em',textTransform:'uppercase'}}>🔒 Private Mode</span>
          <button onClick={()=>setPrivateMode(!privateMode)} style={{width:48,height:26,borderRadius:13,background:privateMode?'var(--cyan)':'var(--bg-raised)',border:'1px solid var(--border)',position:'relative',cursor:'pointer',transition:'background 0.2s'}}>
            <div style={{position:'absolute',top:2,left:privateMode?24:2,width:20,height:20,borderRadius:'50%',background:privateMode?'#000':'var(--text-2)',transition:'left 0.2s'}}/>
          </button>
        </div>
        <p style={{fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--text-2)',lineHeight:1.5,margin:0}}>
          When enabled, SoloStrike stops all external API calls. No mempool.space, no price feeds. All data comes from your own Bitcoin Core and (if installed) your Umbrel Mempool app.
        </p>
        <div style={{marginTop:'0.8rem',padding:'0.6rem',background:privateMode?'rgba(0,255,209,0.06)':'rgba(245,166,35,0.06)',border:`1px solid ${privateMode?'rgba(0,255,209,0.25)':'rgba(245,166,35,0.25)'}`}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.12em',textTransform:'uppercase',color:privateMode?'var(--cyan)':'var(--amber)',marginBottom:4}}>Current state</div>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-1)'}}>
            {privateMode ? 'Outbound calls: NONE. Your pool leaks zero metadata.' : 'Outbound calls: mempool.space (fees, blocks, prices).'}
          </div>
        </div>
      </div>
      <button onClick={submit} disabled={loading} style={{width:'100%',padding:'0.75rem',background:saved?'var(--green)':'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.8rem',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',cursor:'pointer',opacity:loading?0.6:1}}>
        {loading?'SAVING…':saved?'✓ SAVED':'APPLY PRIVATE MODE'}
      </button>
    </>
  );
}

function AliasesTab({workers, aliases, onAliasesChange}) {
  const [localAliases, setLocalAliases] = useState(aliases || {});
  useEffect(()=>setLocalAliases(aliases||{}), [aliases]);
  const updateAlias = (name, val) => {
    const next = { ...localAliases };
    if (!val.trim()) delete next[name]; else next[name] = val.trim().slice(0, 32);
    setLocalAliases(next);
  };
  const save = () => { onAliasesChange(localAliases); };
  return (
    <>
      <p style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-2)',lineHeight:1.5,marginBottom:'0.75rem'}}>
        Rename workers in the UI (saved on this device). Leave blank to use the default suffix name.
      </p>
      <div style={{display:'flex',flexDirection:'column',gap:'0.5rem',maxHeight:'50vh',overflowY:'auto'}}>
        {(workers||[]).map(w => (
          <div key={w.name} style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.6rem 0.75rem'}}>
            <div style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-3)',marginBottom:4,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{w.name}</div>
            <input type="text" value={localAliases[w.name] || ''} placeholder={stripAddr(w.name)} onChange={e=>updateAlias(w.name, e.target.value)} maxLength={32}
              style={{width:'100%',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.78rem',padding:'0.5rem 0.7rem',outline:'none',boxSizing:'border-box'}}/>
          </div>
        ))}
      </div>
      <button onClick={save} style={{width:'100%',marginTop:'1rem',padding:'0.7rem',background:'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',cursor:'pointer'}}>Save Aliases</button>
    </>
  );
}

function WebhooksTab() {
  const [hooks, setHooks] = useState([]);
  const [newUrl, setNewUrl] = useState('');
  const [newName, setNewName] = useState('');
  const [newEvents, setNewEvents] = useState(['block_found']);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { const r = await fetch('/api/webhooks'); const j = await r.json(); setHooks(j.hooks || []); } catch {}
  }, []);
  useEffect(()=>{ load(); }, [load]);
  const add = async () => {
    setErr('');
    if (!/^https?:\/\//i.test(newUrl.trim())) { setErr('URL must start with http:// or https://'); return; }
    setBusy(true);
    try {
    const r = await fetch('/api/webhooks', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ op:'add', name:newName || 'Webhook', url:newUrl.trim(), events:newEvents }) });
      if (!r.ok) { const e = await r.json().catch(()=>({})); throw new Error(e.error || 'Add failed'); }
      setNewUrl(''); setNewName(''); setNewEvents(['block_found']);
      await load();
    } catch(e){ setErr(e.message); } finally { setBusy(false); }
  };
  const del = async (id) => { await fetch('/api/webhooks', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ op:'remove', id }) }); await load(); };
  const EVENT_LABELS = { block_found:'Block Found', worker_offline:'Worker Offline', worker_online:'Worker Online' };
  const toggleEvent = (ev) => setNewEvents(list => list.includes(ev) ? list.filter(x=>x!==ev) : [...list, ev]);
  return (
    <>
      <p style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-2)',lineHeight:1.5,marginBottom:'0.75rem'}}>
        POST JSON events to any URL. Use with Discord webhooks, Telegram bots, ntfy.sh topics, Home Assistant, etc.
      </p>
      {hooks.length > 0 && (
        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem',marginBottom:'1rem'}}>
          {hooks.map(h => (
            <div key={h.id} style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.55rem 0.7rem',display:'flex',alignItems:'center',gap:8}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.72rem',color:'var(--text-1)',fontWeight:600}}>{h.name}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.url}</div>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--cyan)',letterSpacing:'0.08em',textTransform:'uppercase',marginTop:2}}>{(h.events||[]).map(e=>EVENT_LABELS[e]||e).join(' · ')}</div>
              </div>
              <button onClick={()=>del(h.id)} style={{background:'none',border:'1px solid rgba(255,59,59,0.4)',color:'var(--red)',padding:'4px 8px',cursor:'pointer',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em'}}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{background:'var(--bg-deep)',border:'1px solid var(--border)',padding:'0.8rem',display:'flex',flexDirection:'column',gap:'0.5rem'}}>
        <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--text-2)'}}>Add Webhook</div>
        <input type="text" value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Name (e.g. Discord)" maxLength={50}
          style={{background:'var(--bg-raised)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.75rem',padding:'0.5rem 0.7rem',outline:'none',boxSizing:'border-box'}}/>
        <input type="text" value={newUrl} onChange={e=>setNewUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/..." spellCheck={false} autoCorrect="off" autoCapitalize="off"
          style={{background:'var(--bg-raised)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.72rem',padding:'0.5rem 0.7rem',outline:'none',boxSizing:'border-box'}}/>
        <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
          {Object.keys(EVENT_LABELS).map(ev => (
            <button key={ev} onClick={()=>toggleEvent(ev)}
              style={{padding:'0.35rem 0.6rem',background:newEvents.includes(ev)?'var(--bg-raised)':'transparent',border:`1px solid ${newEvents.includes(ev)?'var(--cyan)':'var(--border)'}`,color:newEvents.includes(ev)?'var(--cyan)':'var(--text-2)',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.08em',textTransform:'uppercase',cursor:'pointer'}}>
              {EVENT_LABELS[ev]}
            </button>
          ))}
        </div>
        {err && <div style={{fontSize:'0.7rem',color:'var(--red)'}}>⚠ {err}</div>}
        <button onClick={add} disabled={busy || !newUrl.trim() || !newEvents.length}
          style={{padding:'0.55rem',background:'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.7rem',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',cursor:'pointer',opacity:(busy||!newUrl.trim()||!newEvents.length)?0.5:1}}>
          {busy?'ADDING…':'+ ADD WEBHOOK'}
        </button>
      </div>
    </>
  );
}

// ── Worker Detail Modal — NOW WITH CLICKABLE IP LINK ─────────────────────────
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
  );
}

// ── Card order + currency helpers ─────────────────────────────────────────────
const DEFAULT_ORDER = ['hashrate', 'workers', 'network', 'node', 'odds', 'luck', 'retarget', 'shares', 'best', 'closestcalls', 'blocks', 'topfinders', 'recent'];
function loadOrder() {
  try {
    const saved = localStorage.getItem(LS_CARD_ORDER);
    if (!saved) return DEFAULT_ORDER;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return DEFAULT_ORDER;
    const merged = [...parsed];
    DEFAULT_ORDER.forEach(k => { if (!merged.includes(k)) merged.push(k); });
    return merged.filter(k => DEFAULT_ORDER.includes(k));
  } catch { return DEFAULT_ORDER; }
}
function saveOrder(order) { try { localStorage.setItem(LS_CARD_ORDER, JSON.stringify(order)); } catch {} }
function loadCurrency() { try { return localStorage.getItem(LS_CURRENCY) || 'USD'; } catch { return 'USD'; } }
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
    const next = [...order];
    const from = next.indexOf(draggedId);
    const to   = next.indexOf(targetId);
    if (from < 0 || to < 0) { setDraggedId(null); setDragOverId(null); return; }
    next.splice(from, 1); next.splice(to, 0, draggedId);
    setOrder(next); saveOrder(next); setDraggedId(null); setDragOverId(null);
  };
  useEffect(() => {
    const endDrag = () => { setDraggedId(null); setDragOverId(null); };
    window.addEventListener('dragend', endDrag);
    return () => window.removeEventListener('dragend', endDrag);
  }, []);

  if (state.status==='loading') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--fd)',fontSize:'0.75rem',letterSpacing:'0.2em',color:'var(--text-2)',textTransform:'uppercase',animation:'pulse 1.5s ease-in-out infinite'}}>
      Connecting to pool…
    </div>
  );
  if (state.status==='no_address'||state.status==='setup') {
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
      <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',width:'100%',maxWidth:'100%',overflowX:'clip'}}>
        <div style={{ position:'sticky', top:0, zIndex:50, background:'rgba(6,7,8,0.92)', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', width:'100%', maxWidth:'100%', boxSizing:'border-box', overflow:'hidden' }}>
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
        <main style={{flex:1,padding:'1rem',width:'100%',maxWidth:'100%',boxSizing:'border-box',margin:0,overflowX:'clip'}}>
          <div className="ss-grid" style={{minWidth:0,maxWidth:'100%'}}>
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
        <footer style={{borderTop:'1px solid var(--border)',padding:'0.6rem 1rem',display:'flex',justifyContent:'space-between',alignItems:'center',fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--text-3)',letterSpacing:'0.08em',textTransform:'uppercase',gap:'0.5rem',flexWrap:'wrap',width:'100%',maxWidth:'100%',boxSizing:'border-box'}}>
          <span>SoloStrike v1.5.7 — ckpool-solo{state.privateMode && ' · 🔒 PRIVATE'}{minimalMode && ' · MIN'}</span>
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
