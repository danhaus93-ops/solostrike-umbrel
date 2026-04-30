import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { usePool } from './hooks/usePool.js';
import { fmtHr, fmtDiff, fmtNum, fmtUptime, fmtOdds, fmtOddsInverse, timeAgo, fmtAgoShort, fmtPct, fmtDurationMs, fmtSats, fmtBtc, fmtFiat, CURRENCIES, blockTimeAgo } from './utils.js';
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
  { id:'strikevel',     label:'Strike Velocity' },
  { id:'pulse',         label:'Solostrike Pulse' },
  { id:'workers',       label:'The Crew' },
  { id:'stratum',       label:'Stratum Connection' },
  { id:'vein',          label:'The Hunt' },
  { id:'network',       label:'Bitcoin Network' },
  { id:'node',          label:'Bitcoin Node' },
  { id:'luck',          label:'Hot Streak' },
  { id:'retarget',      label:'Difficulty Retarget' },
  { id:'shares',        label:'Share Stats' },
  { id:'best',          label:'Top Diggers' },
  { id:'closestcalls',  label:'Near Strikes' },
  { id:'jumpers',       label:'Claim Jumpers + Solo Strikes' },
  { id:'recent',        label:'The Ledger' },
];
const ALL_CARD_IDS    = ALL_CARDS.map(c => c.id);
const MINIMAL_PRESET  = ['hashrate', 'pulse', 'workers', 'jumpers'];
const DEFAULT_PRESET  = ['hashrate', 'strikevel', 'pulse', 'workers', 'stratum', 'vein', 'network', 'shares', 'best', 'closestcalls', 'jumpers'];
const EVERYTHING_PRESET = [...ALL_CARD_IDS];

// v1.7.6 migration — rename "odds" card id to "vein" in any persisted layouts.
// Idempotent and safe even if user hasn't seen the old id.
function migrateCardIds(arr) {
  if (!Array.isArray(arr)) return arr;
  const seen = new Set();
  const out = [];
  for (const id of arr) {
    // v1.7.x migrations:
    //   'odds'       -> 'vein'        (older rename)
    //   'hashpulse'  -> 'hashrate' + 'pulse' (v1.7.22-iter23: split back into two cards)
    //   'topfinders' -> 'jumpers'     (v1.7.22: merged Claim Jumpers + Gold Strikes)
    //   'blocks'     -> 'jumpers'     (v1.7.22: merged Claim Jumpers + Gold Strikes)
    //   'netstrikes' -> 'network'     (v1.7.22: split unwound; the strikes
    //                                  half goes into 'jumpers', so we add
    //                                  jumpers separately below)
    if (id === 'odds') {
      if (!seen.has('vein')) { seen.add('vein'); out.push('vein'); }
      continue;
    }
    if (id === 'hashpulse') {
      // Split the merged card back into its two original parts, in order
      if (!seen.has('hashrate')) { seen.add('hashrate'); out.push('hashrate'); }
      if (!seen.has('pulse'))    { seen.add('pulse');    out.push('pulse');    }
      continue;
    }
    let next = id;
    if (id === 'topfinders' || id === 'blocks') next = 'jumpers';
    else if (id === 'netstrikes') next = 'network';
    if (!seen.has(next)) { seen.add(next); out.push(next); }
    // If we mapped netstrikes -> network, also add jumpers (the strikes half)
    if (id === 'netstrikes' && !seen.has('jumpers')) {
      seen.add('jumpers'); out.push('jumpers');
    }
  }
  return out;
}

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
function loadVisibleCards()  { try { const s = localStorage.getItem(LS_VISIBLE_CARDS); if (!s) return EVERYTHING_PRESET; const p = JSON.parse(s); const migrated = migrateCardIds(Array.isArray(p) ? p : []); return migrated.length ? migrated.filter(id => ALL_CARD_IDS.includes(id)) : EVERYTHING_PRESET; } catch { return EVERYTHING_PRESET; } }
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
function DraggableCard({ id, onDragStart, onDragOver, onDrop, onDragEnd, draggedId, children, spanTwo }) {
  const classes = ['ss-card', spanTwo?'ss-span-2':'', draggedId===id?'ss-dragging':''].filter(Boolean).join(' ');
  return (
    <div className={classes}
      onDragOver={e=>{e.preventDefault(); onDragOver(id);}}
      onDrop={e=>{e.preventDefault(); onDrop(id);}}
    >
      <span className="ss-drag-handle" draggable
        style={{color:'var(--amber)'}}
        onDragStart={e=>{ e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain', id);}catch{} onDragStart(id); }}
        onDragEnd={()=>{ onDragEnd && onDragEnd(); }}
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

// ── CopyablePort (v1.7.12) ────────────────────────────────────────────────────
// Wraps PortLight in a tappable container that copies the full stratum URL
// to clipboard. Shows a brief floating "✓ COPIED" toast above the port number.
function CopyablePort({ health, port, ssl }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Read configured stratum host from localStorage (set in Stratum card),
    // fall back to umbrel.local if not configured. Was previously
    // window.location.hostname, which leaked Tailscale IPs to other users.
    const host = loadStratumHost() || 'umbrel.local';
    const proto = ssl ? 'stratum+ssl' : 'stratum+tcp';
    const url = `${proto}://${host}:${port}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <span
      onClick={onCopy}
      role="button"
      tabIndex={0}
      title={`Tap to copy ${ssl?'stratum+ssl':'stratum+tcp'}://...:${port}`}
      style={{
        position:'relative', cursor:'pointer', padding:'0 2px',
        WebkitTapHighlightColor:'transparent',
        transition:'transform 0.12s ease',
        transform: copied ? 'scale(1.08)' : 'scale(1)',
        display:'inline-block',
      }}
    >
      <PortLight health={health} port={port}/>
      {copied && (
        <span style={{
          position:'absolute', bottom:'calc(100% + 4px)', left:'50%',
          transform:'translateX(-50%)',
          background:'var(--amber)', color:'var(--bg-void, #060708)',
          padding:'2px 6px', borderRadius:3,
          fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.1em',
          fontWeight:800, whiteSpace:'nowrap',
          boxShadow:'0 2px 8px rgba(245,166,35,0.5)',
          animation:'fadeIn 0.18s ease both',
          pointerEvents:'none', zIndex:10,
        }}>✓ COPIED</span>
      )}
    </span>
  );
}

// ── UpdateBanner ──────────────────────────────────────────────────────────────
// Shown inside the sticky header zone whenever a new SoloStrike version is
// available. Three tiers based on what the update requires:
//
//   • soft     — just a code change, the service worker has the new bundle
//                ready. Tap to reload, ~2 seconds. (lightning-bolt icon, amber)
//   • hard     — manifest/compose change, requires Umbrel to re-read config.
//                Tap for instructions to update via the Umbrel app store.
//                (wrench icon, cyan)
//   • critical — security or mining-impacting fix. Same flow as soft, but
//                with red gradient and pulse, can't be dismissed.
//                (🚨 emoji)
//
// Urgency is set by the API in state.urgency ('normal' | 'recommended' | 'critical').
// 'critical' overrides everything else for styling.
function UpdateBanner({ tier, urgency, version, notes, expanded, onToggleExpanded, onApply, onDismiss }) {
  const isCritical = urgency === 'critical';
  const isHard = tier === 'hard';

  // Color & glyph depend on tier × urgency.
  let bg, border, fg, label, glyph;
  if (isCritical) {
    bg     = 'linear-gradient(90deg, rgba(255,59,59,0.25), rgba(255,122,0,0.18))';
    border = 'rgba(255,59,59,0.55)';
    fg     = '#FFE6E1';
    label  = `CRITICAL UPDATE V${version}`;
    glyph  = (
      <span style={{ fontSize:'1.1rem', filter:'drop-shadow(0 0 4px rgba(255,59,59,0.8))', animation:'pulse 1.4s ease-in-out infinite' }}>🚨</span>
    );
  } else if (isHard) {
    bg     = 'linear-gradient(90deg, rgba(0,255,209,0.14), rgba(0,255,209,0.04))';
    border = 'rgba(0,255,209,0.45)';
    fg     = 'var(--cyan)';
    label  = `V${version} — INFRASTRUCTURE UPDATE`;
    glyph  = (
      // Custom wrench SVG in cyan
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0, color:'var(--cyan)', filter:'drop-shadow(0 0 4px rgba(0,255,209,0.4))' }}>
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a1.4 1.4 0 1 0 2 2l6-6a4 4 0 0 0 5.4-5.4l-2.4 2.4-2-2 2.4-2.4z"/>
      </svg>
    );
  } else {
    bg     = 'linear-gradient(90deg, rgba(245,166,35,0.18), rgba(245,166,35,0.05))';
    border = 'rgba(245,166,35,0.55)';
    fg     = 'var(--amber)';
    label  = `V${version} — TAP TO UPDATE`;
    glyph  = (
      // Custom lightning-bolt SVG in amber
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0, color:'var(--amber)', filter:'drop-shadow(0 0 6px rgba(245,166,35,0.55))', animation:'pulse 2.2s ease-in-out infinite' }}>
        <path d="M13 2 L4 14 L11 14 L10 22 L20 9 L13 9 L13 2 Z"/>
      </svg>
    );
  }

  const handleClick = () => {
    if (isHard) {
      // For hard updates, expand to show instructions instead of triggering reload
      onToggleExpanded();
    } else {
      onApply();
    }
  };

  return (
    <div style={{
      borderBottom: `1px solid ${border}`,
      background: bg,
      fontFamily: 'var(--fd)',
      animation: isCritical ? 'pulse 1.4s ease-in-out infinite' : 'slideUp 0.3s ease both',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.55rem',
        padding: '0.55rem 0.75rem',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
      }} onClick={handleClick}>
        {glyph}
        <span style={{
          flex: 1,
          minWidth: 0,
          color: fg,
          fontSize: '0.62rem',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>{label}</span>
        {/* Expand chevron — only if there are notes to show */}
        {notes && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleExpanded(); }}
            style={{
              background: 'transparent',
              border: 'none',
              color: fg,
              padding: '0.15rem 0.35rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
              lineHeight: 1,
              transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
              flexShrink: 0,
              opacity: 0.85,
            }}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >▾</button>
        )}
        {/* Dismiss button — hidden for critical */}
        {!isCritical && (
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            style={{
              background: 'transparent',
              border: 'none',
              color: fg,
              padding: '0.15rem 0.35rem',
              cursor: 'pointer',
              fontSize: '0.85rem',
              lineHeight: 1,
              flexShrink: 0,
              opacity: 0.6,
            }}
            aria-label="Dismiss"
            title="Dismiss until next version"
          >×</button>
        )}
      </div>

      {/* Expanded panel — release notes + action button */}
      {expanded && (
        <div style={{
          padding: '0 0.75rem 0.7rem 0.75rem',
          borderTop: `1px solid ${border}`,
          background: 'rgba(0,0,0,0.25)',
          animation: 'slideUp 0.25s ease both',
        }}>
          {isHard && (
            <div style={{
              fontSize: '0.6rem',
              color: 'var(--text-1)',
              lineHeight: 1.5,
              padding: '0.55rem 0',
              fontFamily: 'var(--fm)',
            }}>
              <div style={{ color: fg, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                Update via Umbrel app store:
              </div>
              <div style={{ marginBottom: '0.2rem' }}>1. Open Umbrel on any device</div>
              <div style={{ marginBottom: '0.2rem' }}>2. Go to App Store → Community Store</div>
              <div style={{ marginBottom: '0.2rem' }}>3. Find SoloStrike → tap <span style={{ color:'var(--amber)' }}>Update</span></div>
              <div>4. Mining keeps hashing through the update</div>
            </div>
          )}
          {notes && (
            <div style={{
              fontSize: '0.6rem',
              color: 'var(--text-1)',
              lineHeight: 1.5,
              padding: '0.55rem 0',
              fontFamily: 'var(--fm)',
              whiteSpace: 'pre-wrap',
              maxHeight: '40vh',
              overflowY: 'auto',
              borderTop: isHard ? `1px dashed ${border}` : 'none',
              marginTop: isHard ? '0.4rem' : 0,
              paddingTop: isHard ? '0.55rem' : '0.55rem',
            }}>
              <div style={{ color: fg, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>
                What's new in v{version}:
              </div>
              {notes.length > 800 ? notes.slice(0, 800).trim() + '…' : notes}
            </div>
          )}
          {!isHard && (
            <button
              onClick={onApply}
              style={{
                display: 'block',
                width: '100%',
                padding: '0.5rem',
                marginTop: '0.4rem',
                background: 'var(--amber)',
                color: 'var(--bg-void)',
                border: 'none',
                borderRadius: '4px',
                fontFamily: 'var(--fd)',
                fontSize: '0.65rem',
                fontWeight: 800,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                boxShadow: '0 0 12px rgba(245,166,35,0.35)',
              }}
            >Update Now & Reload</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ connected, status, onSettings, privateMode, minimalMode, zmq, blocksFound, retargetPct, retargetBlocks }) {
  const now = useNow(30000);
  const statusMap = { running:{c:'var(--green)',t:'MINING'}, mining:{c:'var(--green)',t:'MINING'}, no_address:{c:'var(--amber)',t:'SETUP'}, setup:{c:'var(--amber)',t:'SETUP'}, starting:{c:'var(--amber)',t:'STARTING'}, error:{c:'var(--red)',t:'ERROR'}, loading:{c:'var(--text-2)',t:'...'} };
  const st = statusMap[status] || statusMap.loading;
  // Retarget direction colors
  const retargetColor = (retargetPct == null) ? 'var(--text-2)' : (retargetPct > 0 ? 'var(--green)' : retargetPct < 0 ? 'var(--red)' : 'var(--text-2)');
  const retargetSign = (retargetPct != null && retargetPct > 0) ? '+' : '';
  return (
    <header style={{ ...STRIP_FULL_WIDTH, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 0.5rem', minHeight:58, borderBottom:'1px solid var(--border)', gap:'0.4rem' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', minWidth:0, flex:1, flexWrap:'wrap' }}>
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
            {/* Strikes counter — total blocks found by this install */}
            {blocksFound != null && (
              <span title="Total blocks struck" style={{ display:'inline-flex', alignItems:'center', gap:3, fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color: blocksFound > 0 ? 'var(--amber)' : 'var(--text-2)', textShadow: blocksFound > 0 ? '0 0 6px rgba(245,166,35,0.5)' : 'none', flexShrink:0, marginLeft:4 }}>
                STRIKES <span style={{fontWeight:700}}>{blocksFound}</span>{blocksFound > 0 && <span>⚡</span>}
              </span>
            )}
            {/* Difficulty retarget */}
            {retargetPct != null && (
              <span title={retargetBlocks != null ? `${retargetBlocks} blocks until retarget` : 'Difficulty retarget'} style={{ display:'inline-flex', alignItems:'center', gap:3, fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.08em', color:retargetColor, flexShrink:0, marginLeft:4 }}>
                RETARGET <span style={{fontWeight:700}}>{retargetSign}{retargetPct.toFixed(2)}%</span>
              </span>
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
  // ── Persistent worker-offline banners (v1.7.12) ────────────────────────
  // Replaced auto-dismissing toasts with banners that stay visible until either
  // (a) the user taps × to dismiss, or (b) the worker comes back online — at
  // which point we flash a green "✓ BACK ONLINE" confirmation that auto-fades
  // after 5 seconds. Multiple offline workers collapse into one banner with
  // a count + expandable list.
  const [banners, setBanners] = useState([]);
  const [collapsed, setCollapsed] = useState(true);
  const prevRef = useRef({});

  useEffect(() => {
    const list = workers || [];
    setBanners(prev => {
      let next = prev.slice();
      list.forEach(w => {
        const prevStatus = prevRef.current[w.name];
        const isOffline  = w.status === 'offline';
        const idx = next.findIndex(b => b.name === w.name);
        if (prevStatus && prevStatus !== 'offline' && isOffline && idx === -1) {
          next.push({ name:w.name, displayName:displayName(w.name, aliases), lastSeen:w.lastSeen, minerType:w.minerType, recovered:false });
        } else if (idx !== -1 && !isOffline && !next[idx].recovered) {
          next = next.slice();
          next[idx] = { ...next[idx], recovered:true };
        }
        prevRef.current[w.name] = w.status;
      });
      return next;
    });
  }, [workers, aliases]);

  // Auto-dismiss recovered banners after 5 seconds
  useEffect(() => {
    const recovered = banners.filter(b => b.recovered);
    if (!recovered.length) return;
    const timers = recovered.map(b => setTimeout(() => {
      setBanners(curr => curr.filter(x => x.name !== b.name));
    }, 5000));
    return () => timers.forEach(clearTimeout);
  }, [banners]);

  const dismiss = (name) => setBanners(b => b.filter(x => x.name !== name));
  const dismissAll = () => setBanners([]);

  if (!banners.length) return null;

  const offlineBanners   = banners.filter(b => !b.recovered);
  const recoveredBanners = banners.filter(b => b.recovered);
  const offlineCount     = offlineBanners.length;

  return (
    <div style={{
      position:'fixed', top:'calc(env(safe-area-inset-top) + 4px)', left:'50%',
      transform:'translateX(-50%)', zIndex:300, maxWidth:'min(96vw, 480px)',
      width:'calc(100% - 16px)', display:'flex', flexDirection:'column', gap:6,
      pointerEvents:'none',
    }}>
      {recoveredBanners.map(b => (
        <div key={b.name+':rec'} style={{
          pointerEvents:'auto',
          background:'linear-gradient(90deg, rgba(57,255,106,0.18), rgba(57,255,106,0.05))',
          border:'1px solid rgba(57,255,106,0.5)',
          padding:'0.5rem 0.75rem', display:'flex', alignItems:'center', gap:'0.5rem',
          animation:'slideUp 0.3s ease both',
          boxShadow:'0 4px 18px rgba(0,0,0,0.4)',
          borderRadius:6,
        }}>
          <span style={{color:'var(--green, #39ff6a)', fontFamily:'var(--fd)', fontWeight:800, fontSize:'0.85rem'}}>✓</span>
          <span style={{flex:1, fontFamily:'var(--fd)', fontSize:'0.62rem', color:'var(--green, #39ff6a)', letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
            {b.displayName} BACK ONLINE
          </span>
        </div>
      ))}
      {offlineCount > 0 && (
        <div style={{
          pointerEvents:'auto',
          background:'linear-gradient(90deg, rgba(245,166,35,0.18), rgba(245,166,35,0.05))',
          border:'1px solid rgba(245,166,35,0.55)',
          boxShadow:'0 4px 18px rgba(0,0,0,0.4), 0 0 14px rgba(245,166,35,0.15)',
          borderRadius:6,
          animation:'slideUp 0.3s ease both',
        }}>
          <div onClick={() => setCollapsed(c => !c)} style={{
            display:'flex', alignItems:'center', gap:'0.5rem',
            padding:'0.5rem 0.75rem', cursor: offlineCount > 1 ? 'pointer' : 'default',
            WebkitTapHighlightColor:'transparent',
          }}>
            <span style={{color:'var(--amber)', fontFamily:'var(--fd)', fontSize:'1rem', filter:'drop-shadow(0 0 4px rgba(245,166,35,0.5))'}}>⚠</span>
            <span style={{flex:1, minWidth:0, fontFamily:'var(--fd)', fontSize:'0.62rem', color:'var(--amber)', letterSpacing:'0.1em', textTransform:'uppercase', fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
              {offlineCount === 1
                ? `${offlineBanners[0].displayName} OFFLINE`
                : `${offlineCount} WORKERS OFFLINE`}
            </span>
            {offlineCount > 1 && (
              <span style={{color:'var(--amber)', fontSize:'0.85rem', lineHeight:1, transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition:'transform 0.2s ease', flexShrink:0, opacity:0.85}}>▾</span>
            )}
            <button onClick={(e)=>{e.stopPropagation(); dismissAll();}} style={{
              background:'transparent', border:'none', color:'var(--amber)',
              padding:'0.15rem 0.35rem', cursor:'pointer', fontSize:'0.85rem',
              lineHeight:1, flexShrink:0, opacity:0.6,
            }} aria-label="Dismiss all" title="Dismiss all">×</button>
          </div>
          {offlineCount > 1 && !collapsed && (
            <div style={{
              borderTop:'1px solid rgba(245,166,35,0.3)', background:'rgba(0,0,0,0.25)',
              maxHeight:'40vh', overflowY:'auto',
            }}>
              {offlineBanners.map(b => (
                <div key={b.name} style={{
                  display:'flex', alignItems:'center', gap:'0.5rem',
                  padding:'0.4rem 0.75rem', borderBottom:'1px dashed rgba(245,166,35,0.15)',
                  fontFamily:'var(--fm)', fontSize:'0.62rem',
                }}>
                  <span style={{flex:1, color:'var(--text-1)', fontWeight:600}}>
                    {b.displayName}
                    {b.minerType && <span style={{fontFamily:'var(--fd)', fontSize:'0.5rem', color:'var(--text-3)', marginLeft:6, letterSpacing:'0.1em', textTransform:'uppercase'}}>{b.minerType}</span>}
                  </span>
                  <span style={{color:'var(--text-2)', fontSize:'0.55rem'}}>{timeAgo(b.lastSeen)}</span>
                  <button onClick={()=>dismiss(b.name)} style={{
                    background:'transparent', border:'none', color:'var(--text-2)',
                    padding:'0.1rem 0.3rem', cursor:'pointer', fontSize:'0.75rem',
                    lineHeight:1, opacity:0.6,
                  }} aria-label="Dismiss this">×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Hashrate trend indicator (v1.7.12) ────────────────────────────────────────
// Compares current hashrate against the avg from ~5 minutes ago to produce a
// small ▲/▼ percentage indicator. Hidden when change is <1% to avoid flicker.
function HashrateTrend({ history, current }) {
  const trend = useMemo(() => {
    if (!Array.isArray(history) || history.length < 4 || !current || current <= 0) return null;
    const now = Date.now();
    const baselineWindow = history.filter(p => p && p.ts && p.ts >= now - 6*60*1000 && p.ts <= now - 4*60*1000);
    if (baselineWindow.length < 2) return null;
    const baseline = baselineWindow.reduce((s, p) => s + (p.hr || 0), 0) / baselineWindow.length;
    if (!baseline || baseline <= 0) return null;
    const pct = ((current - baseline) / baseline) * 100;
    if (Math.abs(pct) < 1) return null;
    return { pct, dir: pct > 0 ? 'up' : 'down' };
  }, [history, current]);

  if (!trend) return null;

  const isUp = trend.dir === 'up';
  const color = isUp ? 'var(--green, #39ff6a)' : 'var(--red, #ff4757)';
  const glow  = isUp ? 'rgba(57,255,106,0.4)' : 'rgba(255,71,87,0.4)';

  return (
    <span style={{
      fontFamily:'var(--fd)', fontSize:'0.65rem', fontWeight:700,
      color, letterSpacing:'0.04em',
      filter:`drop-shadow(0 0 4px ${glow})`,
      whiteSpace:'nowrap', flexShrink:0, opacity:0.95,
    }}>
      {isUp ? '▲' : '▼'} {Math.abs(trend.pct).toFixed(1)}%
    </span>
  );
}

// ── Hashrate chart ────────────────────────────────────────────────────────────
// ── HashrateAverages — rolling hashrate averages bar list (iter26) ───────
// Renders a "Pool Stats" averages strip: one row per window
// (1m, 5m, 15m, 1h, 6h, 24h, 7d) with a horizontal bar showing relative
// magnitude and the formatted hashrate value on the right. All seven values
// come pre-computed from the API in `state.hashrate.averages`.
//
// iter27b: when `onRangeChange` is provided, the leftmost label in each row
// becomes a clickable button that switches the parent chart's time window.
// The currently-active range gets highlighted (amber border + amber text).
// ── HashrateAverages — rolling hashrate averages bar list (iter26) ───────
// Renders a "Pool Stats" averages strip: one row per window
// (1m, 5m, 15m, 1h, 6h, 24h, 7d) with a horizontal bar showing relative
// magnitude and the formatted hashrate value on the right. All seven values
// come pre-computed from the API in `state.hashrate.averages`.
//
// iter27b: when `onRangeChange` is provided, the leftmost label in each row
// becomes a clickable button that switches the parent chart's time window.
// The currently-active range gets highlighted (amber border + amber text).
function HashrateAverages({ averages, current, peak, range, onRangeChange }) {
  if (!averages) return null;
  const rows = [
    { key: 'hr1m',  label: '1M',  rangeKey: '1m'  },
    { key: 'hr5m',  label: '5M',  rangeKey: '5m'  },
    { key: 'hr15m', label: '15M', rangeKey: '15m' },
    { key: 'hr1h',  label: '1H',  rangeKey: '1h'  },
    { key: 'hr6h',  label: '6H',  rangeKey: '6h'  },
    { key: 'hr24h', label: '24H', rangeKey: '24h' },
    { key: 'hr7d',  label: '7D',  rangeKey: '7d'  },
  ];
  // Normalize bars against the largest of: peak, current, and any avg —
  // keeps every bar < 100% width so values never get clipped on the right.
  const vals = rows.map(r => averages[r.key] || 0);
  const maxAvg = Math.max(0, ...vals);
  const denom  = Math.max(maxAvg, peak || 0, current || 0) || 1;
  const anyData = vals.some(v => v > 0);
  if (!anyData) return null;
  const interactive = typeof onRangeChange === 'function';
  return (
    <div style={{
      marginTop: '0.85rem',
      paddingTop: '0.7rem',
      borderTop: '1px dashed rgba(245,166,35,0.18)',
    }}>
      <div style={{
        display:'flex', justifyContent:'space-between', alignItems:'baseline',
        marginBottom: '0.5rem',
      }}>
        <div style={{
          fontFamily: 'var(--fd)', fontSize: '0.55rem', letterSpacing: '0.18em',
          textTransform: 'uppercase', color: 'var(--text-2)',
        }}>
          ▸ Hashrate Averages
        </div>
        {interactive && (
          <div style={{
            fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.1em',
            color:'var(--text-3)', textTransform:'uppercase',
          }}>
            Tap label → chart
          </div>
        )}
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:'0.32rem'}}>
        {rows.map(r => {
          const v = averages[r.key] || 0;
          const pct = denom > 0 ? Math.min(100, (v / denom) * 100) : 0;
          const formatted = fmtHr(v);
          const isActive = interactive && range === r.rangeKey;
          // Label cell — button when interactive, span otherwise. Box size
          // stays identical between active/inactive so rows don't reflow.
          const labelCell = interactive ? (
            <button
              onClick={() => onRangeChange(r.rangeKey)}
              aria-pressed={isActive}
              style={{
                background: isActive ? 'var(--bg-raised)' : 'transparent',
                border: `1px solid ${isActive ? 'var(--border-hot, rgba(245,166,35,0.45))' : 'transparent'}`,
                color: isActive ? 'var(--amber)' : 'var(--text-2)',
                fontFamily: 'var(--fd)', fontSize: '0.6rem', fontWeight: 700,
                letterSpacing: '0.08em',
                padding: '2px 0',
                cursor: 'pointer',
                textAlign: 'center',
                lineHeight: 1.1,
                width: '100%',
                boxSizing: 'border-box',
                textShadow: isActive ? '0 0 6px rgba(245,166,35,0.4)' : 'none',
              }}>
              {r.label}
            </button>
          ) : (
            <span style={{
              fontFamily:'var(--fd)', fontSize:'0.6rem', fontWeight:700,
              letterSpacing:'0.08em', color:'var(--text-2)', textAlign:'center',
            }}>{r.label}</span>
          );
          return (
            <div key={r.key} style={{
              display:'grid',
              gridTemplateColumns:'2.7rem 1fr auto',
              alignItems:'center',
              gap:'0.55rem',
              minWidth:0,
            }}>
              {labelCell}
              <div style={{
                position:'relative',
                height:6,
                background:'var(--bg-deep)',
                border:'1px solid var(--border)',
                overflow:'hidden',
                minWidth:0,
              }}>
                <div style={{
                  width:`${pct}%`,
                  height:'100%',
                  background: isActive
                    ? 'linear-gradient(90deg, rgba(245,166,35,0.55), #FFD27A)'
                    : 'linear-gradient(90deg, rgba(245,166,35,0.35), var(--amber))',
                  transition:'width 0.5s ease, background 0.3s ease',
                }}/>
              </div>
              <span style={{
                fontFamily:'var(--fd)', fontSize:'0.7rem', fontWeight:700,
                color: v > 0 ? 'var(--amber)' : 'var(--text-3)',
                whiteSpace:'nowrap',
                textAlign:'right',
                minWidth:'4.6rem',
              }}>
                {v > 0 ? formatted : '—'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── StrikeVelocityChart — share submission histogram (iter27d) ────────────
// Sibling to Firepower but visualizes shares-per-second over time as a bar
// histogram instead of a smoothed line. Each bar = 1 minute of share
// submissions, sampled by the API every 60s into state.shares.spsHistory.
//
// Why a histogram (not another line chart): visually distinct from
// Firepower at a glance, and bar-shape semantics map cleanly to "tall =
// active minute, short = quiet minute, missing = downtime."
//
// Color coding:
//   green = within 30% of rolling median (normal)
//   amber = above 1.5× or below 0.5× median (anomaly — vardiff bump,
//           network hiccup, or partial outage)
//   red   = 0 shares for that minute (full downtime)
function StrikeVelocityChart({ spsHistory, currentSps, hashrate, compact = false }) {
  const [range, setRange] = useState('1h');
  const RANGES = {
    '1h':  60 * 60 * 1000,
    '6h':  6 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
  };
  const windowMs = RANGES[range] || RANGES['1h'];
  const cutoff = Date.now() - windowMs;
  const all = Array.isArray(spsHistory) ? spsHistory : [];
  const filtered = all.filter(p => p && p.ts >= cutoff);

  // Live sps — prefer the API's sps1m field, fall back to estimate from
  // hashrate (hashrate / 2^32 = shares/sec at diff 1).
  const liveSps = currentSps > 0
    ? currentSps
    : (hashrate > 0 ? hashrate / 4294967296 : 0);

  // Median of the visible window for color thresholding
  const sortedVals = filtered.map(p => p.sps || 0).filter(v => v > 0).sort((a, b) => a - b);
  const median = sortedVals.length > 0
    ? sortedVals[Math.floor(sortedVals.length / 2)]
    : liveSps;

  // For bar widths/spacing — chart targets ~140 visible bars max.
  // 1h × 1min sample = 60 bars (gentle), 24h would be 1440 (way too dense),
  // so for 24h we downsample by averaging consecutive samples into buckets.
  const maxBars = compact ? 60 : 140;
  let bars = filtered;
  if (filtered.length > maxBars) {
    const bucketSize = Math.ceil(filtered.length / maxBars);
    const bucketed = [];
    for (let i = 0; i < filtered.length; i += bucketSize) {
      const slice = filtered.slice(i, i + bucketSize);
      const avgSps = slice.reduce((s, p) => s + (p.sps || 0), 0) / slice.length;
      bucketed.push({ ts: slice[Math.floor(slice.length / 2)].ts, sps: avgSps });
    }
    bars = bucketed;
  }

  // Y-axis max for normalizing bar heights
  const maxVal = bars.reduce((m, b) => Math.max(m, b.sps || 0), liveSps || 1);
  const yMax = maxVal > 0 ? maxVal * 1.1 : 1;

  // Color classifier for each bar
  const classify = (v) => {
    if (v <= 0)                       return 'var(--red)';
    if (median <= 0)                  return 'var(--amber)';
    if (v > median * 1.5)             return 'var(--amber)';
    if (v < median * 0.5)             return 'var(--amber)';
    return 'var(--green)';
  };

  // iter27d: chart is 200px tall by default (was 140) so when bars appear
  // they fill more vertical space. Empty-state placeholder matches chart
  // height so the card doesn't jump in size when data arrives.
  const chartHeight = compact ? 130 : 200;
  const emptyHeight = chartHeight;
  const numberSize = compact ? '2.3rem' : '2.6rem';

  // Headline number formatting — shares/sec or shares/min for readability
  const headlineVal = liveSps;
  const headlineUnit = headlineVal >= 1 ? 's' : 'm';
  const headlineNumber = headlineVal >= 1
    ? headlineVal.toFixed(1)
    : (headlineVal * 60).toFixed(1);

  const rangeBtn = (key, label) => {
    const isActive = range === key;
    return (
      <button
        key={key}
        onClick={() => setRange(key)}
        style={{
          background: isActive ? 'var(--bg-raised)' : 'transparent',
          border: `1px solid ${isActive ? 'var(--border-hot, rgba(245,166,35,0.45))' : 'var(--border)'}`,
          color: isActive ? 'var(--amber)' : 'var(--text-2)',
          fontFamily:'var(--fd)', fontSize:'0.55rem', fontWeight:700,
          letterSpacing:'0.08em', padding:'3px 9px', cursor:'pointer',
          textTransform:'uppercase',
          textShadow: isActive ? '0 0 6px rgba(245,166,35,0.4)' : 'none',
        }}
      >{label}</button>
    );
  };

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)', marginBottom: '0.35rem'}}>
        <span>▸ Strike Velocity</span>
        {bars.length > 0 && (
          <span style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-2)', letterSpacing:'0.08em', marginRight:14, whiteSpace:'nowrap'}}>
            {bars.length} samples
          </span>
        )}
      </div>

      {/* Headline + range buttons in same row to save vertical space */}
      <div style={{
        display:'flex', alignItems:'flex-end', justifyContent:'space-between',
        gap:'0.6rem', marginBottom: '0.5rem',
      }}>
        <div style={{
          fontFamily:'var(--fd)', fontSize:numberSize, fontWeight:700,
          color:'var(--green)', letterSpacing:'0.01em', lineHeight:1,
          textShadow:'0 0 22px rgba(57,255,106,0.32)',
          display:'flex', alignItems:'baseline', flexWrap:'wrap', gap:'0.35rem',
          minWidth:0,
        }}>
          <span>
            {headlineNumber}
            <span style={{fontSize:'0.8rem', color:'var(--text-2)', marginLeft:5, fontWeight:600}}>
              shares/{headlineUnit}
            </span>
          </span>
        </div>
        <div style={{display:'flex', gap:4, flexShrink:0}}>
          {rangeBtn('1h', '1H')}
          {rangeBtn('6h', '6H')}
          {rangeBtn('24h', '24H')}
        </div>
      </div>

      {bars.length === 0 ? (
        <div style={{
          flex:'1 1 auto', minHeight: emptyHeight,
          display:'flex', alignItems:'center', justifyContent:'center',
          border:'1px dashed var(--border)',
          color:'var(--text-3)', fontFamily:'var(--fd)', fontSize:'0.65rem',
          letterSpacing:'0.12em', textTransform:'uppercase',
        }}>
          {hashrate > 0 ? 'Collecting samples…' : 'No miners connected'}
        </div>
      ) : (
        <div style={{
          flex:'1 1 0', height: chartHeight, minHeight: chartHeight,
          display:'flex', alignItems:'flex-end', justifyContent:'flex-start', gap:1,
          padding:'4px 2px',
          background:'var(--bg-deep)',
          border:'1px solid var(--border)',
          minWidth:0, overflow:'hidden',
          position:'relative',
        }}>
          {bars.map((b, i) => {
            const v = b.sps || 0;
            const pct = yMax > 0 ? (v / yMax) * 100 : 0;
            // Minimum 2px height for any bar with v > 0 so it's visible
            const minH = v > 0 ? 2 : 0;
            const barH = Math.max(minH, pct);
            return (
              <div
                key={i}
                title={`${new Date(b.ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} · ${v >= 1 ? v.toFixed(2) + '/s' : (v * 60).toFixed(1) + '/m'}`}
                style={{
                  flex:'1 1 0', minWidth:0, maxWidth:10,
                  height: `${barH}%`,
                  alignSelf:'flex-end',
                  background: classify(v),
                  opacity: v > 0 ? 0.85 : 0.35,
                  transition:'height 0.4s ease',
                }}
              />
            );
          })}
        </div>
      )}

      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontFamily:'var(--fd)', fontSize:'0.46rem', letterSpacing:'0.13em', textTransform:'uppercase', color:'var(--text-3)', marginTop:5}}>
        <span>Each bar = {bars.length > 0 && all.length > maxBars ? Math.ceil(filtered.length / maxBars) : 1} min</span>
        <span style={{color:'var(--text-2)'}}>median ≈ {median > 0 ? (median >= 1 ? median.toFixed(1) + '/s' : (median * 60).toFixed(1) + '/m') : '—'}</span>
      </div>
    </div>
  );
}

function HashrateChart({ history, week, current, averages, compact = false }) {
  // iter27b: range now controlled by clicking labels inside the
  // HashrateAverages strip below the chart. Default = 1h.
  const [range, setRange] = useState('1h');

  // Window-size, source-array, and smoothing-window dispatch tables for
  // each of the 7 rows in HashrateAverages. Short windows (1m/5m/15m)
  // pull from `history` and use minimal smoothing since there are few
  // points to begin with.
  const WINDOW_MS = {
    '1m':   60 * 1000,
    '5m':   5 * 60 * 1000,
    '15m':  15 * 60 * 1000,
    '1h':   60 * 60 * 1000,
    '6h':   6 * 60 * 60 * 1000,
    '24h':  24 * 60 * 60 * 1000,
    '7d':   7 * 24 * 60 * 60 * 1000,
  };
  const SMOOTH_WINDOW = {
    '1m': 1, '5m': 1, '15m': 2, '1h': 3, '6h': 5, '24h': 10, '7d': 30,
  };

  const windowMs = WINDOW_MS[range] || WINDOW_MS['1h'];
  const source = range === '7d' ? (week || []) : (history || []);
  const cutoff = Date.now() - windowMs;
  const filtered = source.filter(p => p && p.ts >= cutoff);

  const smoothWindow = SMOOTH_WINDOW[range] || 3;
  const smoothed = filtered.map((p, i) => {
    const start = Math.max(0, i - smoothWindow + 1);
    const slice = filtered.slice(start, i + 1);
    const avg = slice.reduce((s, x) => s + (x.hr || 0), 0) / slice.length;
    return { ts: p.ts, hr: avg };
  });

  const data = smoothed;
  const peak = useMemo(() => Math.max(current || 0, ...data.map(p => p.hr || 0)), [data, current]);
  const [p0, p1] = fmtHr(current).split(' ');

  const chartHeight = compact ? 105 : 140;
  const numberSize = compact ? '2.3rem' : '2.6rem';
  const numberMarginBottom = compact ? '0.7rem' : '0.8rem';

  // The actual chart content — used both in standalone card and embedded HashPulse
  const inner = (
    <>
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)', marginBottom: compact ? '0.4rem' : undefined}}>
        <span>▸ Firepower — Live</span>
        {peak > 0 && <span style={{color:'var(--amber-dim, #b37a1a)', fontFamily:'var(--fm)', fontSize: compact ? '0.55rem' : '0.6rem', letterSpacing:'0.08em', marginRight:'14px', whiteSpace:'nowrap'}}>PEAK {fmtHr(peak)}</span>}
      </div>
      <div style={{ fontFamily:'var(--fd)', fontSize:numberSize, fontWeight:700, color:'var(--amber)', letterSpacing:'0.01em', lineHeight:1, textShadow:'0 0 30px rgba(245,166,35,0.35)', marginBottom:numberMarginBottom, display:'flex', alignItems:'baseline', flexWrap:'wrap', gap:'0.4rem' }}>
        <span>{p0}<span style={{ fontSize: compact ? '0.85rem' : '1rem', color:'var(--amber-dim)', marginLeft:4 }}>{p1}</span></span>
        <HashrateTrend history={history} current={current}/>
      </div>
      {/* iter27a: range buttons (1H/6H/24H/7D) removed — the Hashrate
          Averages strip below the chart now covers all those windows
          numerically, making the toggle redundant. Chart now stays locked
          to 1H view by default. */}
      <div style={{width:'100%', maxWidth:'100%', overflow:'hidden', minWidth:0}}>
        <ResponsiveContainer width="100%" height={chartHeight}>
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
      {!compact && averages && (
        <HashrateAverages averages={averages} current={current} peak={peak} range={range} onRangeChange={setRange}/>
      )}
    </>
  );

  // Compact = inline render, no outer card wrapper (for HashPulse embed)
  if (compact) return inner;

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      {inner}
    </div>
  );
}

// ── UptimeSparkline ──────────────────────────────────────────────────────────
// 24h online/offline strip — renders 96 segments (one per 15min slot).
// Green = online, red = offline, dim = no data yet (<24h history).
// Source: API writes worker.statusHistory in status-poller.js (iter28-fix-B).
function UptimeSparkline({ history }) {
  const samples = Array.isArray(history) ? history : [];
  const SLOTS = 96;
  const recent = samples.slice(-SLOTS);
  const placeholders = SLOTS - recent.length;
  return (
    <div title={`Uptime over last 24h · ${recent.length}/${SLOTS} samples`} style={{
      display:'flex', height:5, gap:1, flexShrink:0,
      width:'100%', minWidth:0,
    }}>
      {Array.from({ length: SLOTS }).map((_, i) => {
        const isPlaceholder = i < placeholders;
        const sample = isPlaceholder ? null : recent[i - placeholders];
        let bg;
        if (isPlaceholder) bg = 'var(--bg-deep)';
        else if (sample.status === 'online') bg = 'rgba(57,255,106,0.65)';
        else bg = 'rgba(232,67,67,0.7)';
        return <div key={i} style={{ flex:'1 1 0', minWidth:0, background: bg, borderRadius:0.5 }}/>;
      })}
    </div>
  );
}

// ── Worker grid ───────────────────────────────────────────────────────────────
function WorkerGrid({ workers, aliases, onWorkerClick }) {
  // iter27c: removed worker filter search bar — for solo mining (~12-15
  // workers) the filter was visual noise. Workers are still sorted: online
  // first, then by descending hashrate.
  const sorted = [...(workers||[])].sort(
    (a,b)=>(a.status==='offline'?1:-1)-(b.status==='offline'?1:-1)||(b.hashrate||0)-(a.hashrate||0)
  );
  const online = sorted.filter(w=>w.status!=='offline').length;

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)', flexShrink:0}}>
        <span>▸ The Crew</span>
        <span style={{color:'var(--amber)', marginRight:'14px', whiteSpace:'nowrap'}}>{online}/{sorted.length} online</span>
      </div>
      {sorted.length === 0 ? (
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)',lineHeight:2}}>
          No miners connected yet.<br/><span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--cyan)'}}>stratum+tcp://umbrel.local:3333</span><br/><span style={{color:'var(--text-3)',fontSize:'0.65rem'}}>user: worker_name · pass: x</span>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem',flex:1,minHeight:0,overflowY:'auto'}}>
          {sorted.map(w=>{
            const on=w.status!=='offline';
            const workAccepted = w.shares || 0;
            const workRejected = w.rejected || 0;
            const totalWork = workAccepted + workRejected || 1;
            const healthC = HEALTH_COLOR[w.health] || 'var(--text-3)';
            const icon = w.minerIcon || '▪';
            const disp = displayName(w.name, aliases);
            const lastShareAgo = w.lastSeen ? fmtAgoShort(w.lastSeen) : '—';
            return(
              <div key={w.name} onClick={()=>onWorkerClick&&onWorkerClick(w)} style={{display:'flex',alignItems:'center',gap:'0.45rem',padding:'0.4rem 0.6rem',background:'var(--bg-raised)',border:`1px solid ${on?'rgba(57,255,106,0.12)':'transparent'}`,opacity:on?1:0.45,cursor:'pointer',transition:'background 0.15s', minWidth:0}}
                onMouseEnter={e=>e.currentTarget.style.background='var(--bg-elevated, #1a1b1e)'} onMouseLeave={e=>e.currentTarget.style.background='var(--bg-raised)'}>
                <div title={w.health||'unknown'} style={{width:7,height:7,borderRadius:'50%',flexShrink:0,background:on?healthC:'var(--text-3)',boxShadow:on?`0 0 5px ${healthC}`:'none',animation:on?'pulse 2s ease-in-out infinite':'none'}}/>
                <span title={w.minerType||'Unknown'} style={{fontSize:11,color:on?'var(--cyan)':'var(--text-3)',width:12,textAlign:'center',flexShrink:0}}>{icon}</span>
                {/* Middle: name + miner type stacked, with thin progress bar below */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:6,minWidth:0}}>
                    <span style={{fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500,minWidth:0}} title={w.name}>{disp}</span>
                    {w.minerType && <span style={{fontFamily:'var(--fd)',fontSize:'0.46rem',letterSpacing:'0.08em',color:'var(--text-3)',textTransform:'uppercase',whiteSpace:'nowrap',flexShrink:0}}>{w.minerType}</span>}
                  </div>
                  <div style={{display:'flex',gap:5,alignItems:'center',marginTop:2,minWidth:0}}>
                    <div style={{flex:1,height:1.5,background:'var(--bg-deep)',borderRadius:1,overflow:'hidden',minWidth:0}}>
                      <div style={{height:'100%',width:`${(workAccepted/totalWork)*100}%`,background:'var(--green)',borderRadius:1}}/>
                    </div>
                    <span style={{fontFamily:'var(--fm)',fontSize:'0.48rem',color:'var(--text-3)',whiteSpace:'nowrap',flexShrink:0}}>{lastShareAgo}</span>
                  </div>
                  {/* iter28-fix-B: 24h uptime sparkline */}
                  <div style={{marginTop:3, minWidth:0}}>
                    <UptimeSparkline history={w.statusHistory}/>
                  </div>
                </div>
                {/* Right: hashrate (big amber) + best-share underneath */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:0,flexShrink:0,minWidth:48}}>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.72rem',fontWeight:700,color:on?'var(--amber)':'var(--text-2)',whiteSpace:'nowrap',lineHeight:1.1}}>
                    {on?fmtHr(w.hashrate):'offline'}
                  </span>
                  {w.bestshare>0 && <span style={{fontFamily:'var(--fm)',fontSize:'0.46rem',color:'var(--amber)',whiteSpace:'nowrap',opacity:0.75}}>★ {fmtDiff(w.bestshare)}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Closest Calls — pool-wide top 10 best-diff shares ever ──────────────────
// iter28: rarity-tier system. Each share is rated by its % of network difficulty
// (i.e., how close it came to actually being a block). Tier label + color reflect
// rarity: NORMAL (background noise) → GOOD → RARE → EPIC → LEGENDARY.
function classifyShareTier(pctOfBlock) {
  if (pctOfBlock >= 10)   return { label:'LEGENDARY', color:'#ff5252', glow:true,  bgTint:'rgba(255,82,82,0.06)',  borderTint:'rgba(255,82,82,0.40)' };
  if (pctOfBlock >= 1)    return { label:'EPIC',      color:'#ff8a3d', glow:true,  bgTint:'rgba(255,138,61,0.06)', borderTint:'rgba(255,138,61,0.35)' };
  if (pctOfBlock >= 0.1)  return { label:'RARE',      color:'var(--amber)', glow:false, bgTint:'rgba(245,166,35,0.05)', borderTint:'rgba(245,166,35,0.25)' };
  if (pctOfBlock >= 0.01) return { label:'GOOD',      color:'var(--cyan)',  glow:false, bgTint:'rgba(0,255,209,0.04)',  borderTint:'rgba(0,255,209,0.18)' };
  return                       { label:'NORMAL',    color:'var(--text-2)', glow:false, bgTint:'transparent',         borderTint:'var(--border)' };
}

function fmtPctToBlock(pct) {
  if (!isFinite(pct) || pct <= 0) return '—';
  if (pct >= 1)     return pct.toFixed(2) + '%';
  if (pct >= 0.01)  return pct.toFixed(3) + '%';
  if (pct >= 0.0001) return pct.toFixed(4) + '%';
  return pct.toExponential(2) + '%';
}

function ClosestCallsPanel({ closestCalls, aliases, networkDifficulty }) {
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

  const netDiff = networkDifficulty && networkDifficulty > 0 ? networkDifficulty : null;

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)'}}>
        <span>▸ Near Strikes</span>
        <span style={{color:'var(--amber)', fontFamily:'var(--fm)', fontSize:'0.6rem', letterSpacing:'0.08em', marginRight:'14px', whiteSpace:'nowrap'}}>fleet-wide</span>
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:'0.35rem'}}>
        {list.map((c, i) => {
          const disp = displayName(c.workerName, aliases);
          const pctOfBlock = netDiff ? (c.diff / netDiff) * 100 : 0;
          const tier = netDiff ? classifyShareTier(pctOfBlock) : { label:'—', color:'var(--text-2)', glow:false, bgTint:'transparent', borderTint:'var(--border)' };
          return (
            <div key={`${c.workerName}-${c.ts}`} style={{
              padding:'0.45rem 0.6rem',
              background: tier.bgTint === 'transparent' ? 'var(--bg-raised)' : tier.bgTint,
              border: `1px solid ${tier.borderTint}`,
              minWidth:0,
              boxShadow: tier.glow ? `0 0 12px ${tier.color}55` : 'none',
            }}>
              <div style={{display:'flex', alignItems:'center', gap:'0.5rem', minWidth:0}}>
                <span style={{
                  fontFamily:'var(--fd)', fontSize:'0.62rem', fontWeight:700,
                  color: tier.color, minWidth:22, flexShrink:0,
                  textShadow: tier.glow ? `0 0 6px ${tier.color}` : 'none',
                }}>#{i+1}</span>
                <div style={{flex:1, minWidth:0, display:'flex', alignItems:'baseline', gap:5, flexWrap:'wrap'}}>
                  <span style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-1)', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0}} title={c.workerName}>
                    {disp}
                  </span>
                  {c.minerType && (
                    <span style={{fontFamily:'var(--fd)', fontSize:'0.45rem', letterSpacing:'0.08em', color:'var(--text-3)', textTransform:'uppercase', whiteSpace:'nowrap', flexShrink:0}}>
                      {c.minerType}
                    </span>
                  )}
                  <span style={{fontFamily:'var(--fd)', fontSize:'0.45rem', letterSpacing:'0.10em', color:tier.color, textTransform:'uppercase', whiteSpace:'nowrap', flexShrink:0, fontWeight:700, textShadow: tier.glow ? `0 0 4px ${tier.color}` : 'none'}}>
                    · {tier.label}
                  </span>
                </div>
                <span style={{fontFamily:'var(--fd)', fontSize:'0.78rem', fontWeight:700, color: tier.color, flexShrink:0, textShadow: tier.glow ? `0 0 8px ${tier.color}` : 'none'}}>
                  {fmtDiff(c.diff)}
                </span>
              </div>
              <div style={{display:'flex', justifyContent:'flex-end', marginTop:2}}>
                <span style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.06em', color:'var(--text-3)', whiteSpace:'nowrap'}}>
                  {netDiff ? fmtPctToBlock(pctOfBlock) + ' to block' : 'awaiting net diff…'}
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
function NetworkStats({ network, blockReward, mempool, prices, currency, privateMode, latestBlock }) {
  const price = prices?.[currency];
  const rewardUsd = price && blockReward ? blockReward.totalBtc * price : null;
  // iter26: latest block weight + tx count (data from mempool.space netBlocks).
  // Subsidy/fees breakdown and fee tiers live in the Vein card — not duplicated here.
  const lb = latestBlock || {};
  const blkWeight = lb.weight || lb.blockWeight || null;
  const blkTxs    = lb.txCount || lb.txs || lb.tx_count || null;
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
      {/* iter26: latest block weight + tx count */}
      {(blkWeight || blkTxs) && (
        <>
          {blkWeight && (
            <div style={statRow}>
              <span style={label}>Block Weight</span>
              <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{fmtNum(blkWeight)} WU</span>
            </div>
          )}
          {blkTxs != null && (
            <div style={statRow}>
              <span style={label}>Block Txs</span>
              <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{fmtNum(blkTxs)}</span>
            </div>
          )}
        </>
      )}
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
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)',textAlign:'right', minWidth:0, overflow:'hidden'}}>
          {client.name}
          {client.version && <div style={{fontSize:'0.6rem',color:'var(--text-2)',marginTop:2}}>v{client.version}</div>}
          {/* iter26: full subversion string (typically /Satoshi:29.2.0/) when present */}
          {ni.subversion && <div style={{fontSize:'0.55rem',color:'var(--text-3)',marginTop:1, fontFamily:'var(--fm)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'14rem'}}>{ni.subversion.replace(/^\/|\/$/g,'')}</div>}
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
// ── The Vein — Block Potential card (v1.7.6) ─────────────────────────────
// Replaces the old "Strike Odds" card. Fuses Strike Odds' orbital gauge with
// reward breakdown (subsidy + fees), expected daily sats, and live fee tier
// strip. Tap to open The Reckoning. Same readability standard as Strikers/
// Reckoning modals (no var(--text-3) ghost gray, body text >= 0.7rem).
// ── NonceField — Bitcoin-native visualization for The Vein (iter27c) ─────
// Each Bitcoin block requires finding a 32-bit nonce that, combined with
// the block header, produces a hash below the network difficulty target.
// The full nonce space is 2^32 ≈ 4.29 billion possibilities per header.
// Miners iterate through the space looking for one that satisfies the
// target — solo mining is essentially "I'm checking my pile of nonces,
// hoping mine contains the magic one."
//
// This component renders that nonce space as a sparse grid of dim points.
// Cells flicker amber as we hash through them. A subtle scan line sweeps
// L→R representing nonce iteration order. The density of activity scales
// with hashrate. It's not a literal 1:1 cell-per-hash mapping (we'd need
// 4 billion cells, not 120) — it's a representative visualization where
// brightness ∝ work being done.
function NonceField({ hashrate, netHashrate }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animRef = useRef(0);
  const dimsRef = useRef({ w: 600, h: 80, dpr: 1 });
  // Cell brightness map — index → intensity [0..1]. Decays over time.
  const cellsRef = useRef(null);
  // Strike flash — bright burst when a "winner" is found (rare, on a
  // probabilistic schedule based on hashrate vs network).
  const strikeRef = useRef({ active: false, t: 0, x: 0, y: 0 });
  const scanXRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const hrRef = useRef(hashrate || 0);
  const netHrRef = useRef(netHashrate || 1);

  // Keep latest hashrate accessible inside the animation loop
  useEffect(() => {
    hrRef.current = hashrate || 0;
    netHrRef.current = netHashrate || 1;
  }, [hashrate, netHashrate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Grid dimensions — these stay constant; only canvas pixel size changes.
    const COLS = 32;   // 32 columns ↔ 32 bits in nonce, conceptually
    const ROWS = 6;
    const TOTAL_CELLS = COLS * ROWS;
    if (!cellsRef.current || cellsRef.current.length !== TOTAL_CELLS) {
      cellsRef.current = new Float32Array(TOTAL_CELLS);
    }

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = Math.max(120, rect.width);
      const cssHeight = 80;
      canvas.style.width = cssWidth + 'px';
      canvas.style.height = cssHeight + 'px';
      canvas.width  = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dimsRef.current = { w: cssWidth, h: cssHeight, dpr };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const draw = (now) => {
      const dt = Math.min(0.1, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      const { w: W, h: H } = dimsRef.current;
      const cells = cellsRef.current;

      // Dark background
      ctx.fillStyle = 'rgba(8, 8, 10, 1)';
      ctx.fillRect(0, 0, W, H);

      // Decay all cells slowly
      const decay = Math.min(1, dt * 1.4);
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] > 0) cells[i] = Math.max(0, cells[i] - decay * cells[i]);
      }

      // Spawn rate scales with hashrate. At 0 TH/s → very few; at 100+ TH/s → many.
      // We don't model 4 billion checks/sec literally; it's a visual proxy.
      const ths = (hrRef.current || 0) / 1e12;
      const cellsPerSec = ths > 0
        ? Math.min(160, 18 + ths * 1.2)
        : 4;
      const expectedSpawns = cellsPerSec * dt;
      // Use Poisson-ish randomness: average expectedSpawns per frame.
      let spawns = Math.floor(expectedSpawns);
      if (Math.random() < (expectedSpawns - spawns)) spawns += 1;
      for (let i = 0; i < spawns; i++) {
        const idx = Math.floor(Math.random() * TOTAL_CELLS);
        cells[idx] = Math.min(1, cells[idx] + 0.6 + Math.random() * 0.4);
      }

      // Scan line — sweeps L→R representing nonce iteration order.
      // ~6s for full traversal regardless of hashrate (it's symbolic).
      scanXRef.current = (scanXRef.current + dt / 6) % 1;
      const scanX = scanXRef.current * W;

      // Render cells
      const cellW = W / COLS;
      const cellH = H / ROWS;
      const dotMaxR = Math.min(cellW, cellH) * 0.32;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c;
          const x = c * cellW + cellW / 2;
          const y = r * cellH + cellH / 2;
          const v = cells[idx];
          // Distance to scan line — cells near the line get a brightness boost
          const distToScan = Math.abs(x - scanX);
          const scanBoost = distToScan < cellW * 1.5
            ? (1 - distToScan / (cellW * 1.5)) * 0.25
            : 0;
          const lit = Math.min(1, v + scanBoost);
          if (lit < 0.05) {
            // Idle cell — very dim
            ctx.fillStyle = 'rgba(120, 90, 30, 0.18)';
            ctx.beginPath();
            ctx.arc(x, y, dotMaxR * 0.35, 0, Math.PI * 2);
            ctx.fill();
          } else {
            // Active cell — amber, brighter with intensity
            const alpha = 0.25 + lit * 0.75;
            ctx.fillStyle = `rgba(245, 166, 35, ${alpha})`;
            ctx.shadowColor = 'rgba(245, 166, 35, 0.6)';
            ctx.shadowBlur = lit > 0.7 ? 8 : 4;
            ctx.beginPath();
            ctx.arc(x, y, dotMaxR * (0.45 + lit * 0.55), 0, Math.PI * 2);
            ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      }

      // Probabilistic "share found" strike. Real shares-per-second is
      // hashrate / 2^32 at diff 1, much rarer at higher diffs. We fire a
      // visual strike at a rate proportional to ths but capped so it stays
      // dramatic — about once every 5-15 seconds at typical solo rates.
      if (!strikeRef.current.active && ths > 0) {
        const strikeRate = Math.min(0.25, 0.04 + ths * 0.0015); // per second
        if (Math.random() < strikeRate * dt) {
          const idx = Math.floor(Math.random() * TOTAL_CELLS);
          const r = Math.floor(idx / COLS);
          const c = idx % COLS;
          strikeRef.current = {
            active: true,
            t: 0,
            x: c * cellW + cellW / 2,
            y: r * cellH + cellH / 2,
          };
          // Flood the cell to max
          cells[idx] = 1;
        }
      }
      if (strikeRef.current.active) {
        const s = strikeRef.current;
        s.t += dt;
        const life = 0.55;
        if (s.t > life) {
          s.active = false;
        } else {
          const p = s.t / life;
          // Expanding ring + bright glow at center
          const ringR = 3 + p * 30;
          const ringAlpha = (1 - p) * 0.85;
          ctx.strokeStyle = `rgba(255, 220, 140, ${ringAlpha})`;
          ctx.lineWidth = 1.4;
          ctx.shadowColor = 'rgba(255, 210, 122, 0.75)';
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
          // Center burst
          const burstAlpha = (1 - p) * 0.95;
          ctx.fillStyle = `rgba(255, 240, 200, ${burstAlpha})`;
          ctx.shadowColor = 'rgba(255, 240, 200, 0.9)';
          ctx.shadowBlur = 16;
          ctx.beginPath();
          ctx.arc(s.x, s.y, 2.5 + (1 - p) * 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
      }

      // Subtle scan line itself — vertical bar
      const scanGrad = ctx.createLinearGradient(scanX - 4, 0, scanX + 4, 0);
      scanGrad.addColorStop(0, 'rgba(245, 166, 35, 0)');
      scanGrad.addColorStop(0.5, 'rgba(245, 166, 35, 0.18)');
      scanGrad.addColorStop(1, 'rgba(245, 166, 35, 0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(scanX - 4, 0, 8, H);

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, []); // mount-once; hashrate read via ref

  return (
    <div ref={containerRef} style={{
      width: '100%',
      height: 80,
      position: 'relative',
      overflow: 'hidden',
      background: 'rgba(8, 8, 10, 1)',
      border: '1px solid var(--border)',
    }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }}/>
    </div>
  );
}

function VeinPanel({ odds, hashrate, netHashrate, blockReward, mempool, prices, currency, onOpen }) {
  const { perBlock=0, expectedDays=null, perDay=0, perWeek=0, perMonth=0, perYear=0 } = odds||{};
  // iter27c: `scale` (logarithmic mapping for the gold-vein SVG fill width)
  // is no longer needed — replaced by the NonceField canvas component.

  // Reward breakdown — handle both shape variants for safety
  const reward = blockReward || {};
  const subsidyBtc = reward.base ?? reward.subsidyBtc ?? 0;
  const feesBtc    = reward.fees ?? reward.feesBtc ?? 0;
  const totalBtc   = reward.totalBtc ?? (subsidyBtc + feesBtc);
  const fiatPrice  = (prices && prices[currency]) || (prices && prices.USD) || 0;
  const totalFiat  = totalBtc * fiatPrice;

  // Fee tier strip
  const feeFast = mempool?.feeFast ?? mempool?.feeRate ?? null;
  const feeMid  = mempool?.feeMid ?? null;
  const feeLow  = mempool?.feeLow ?? null;

  // Expected sats per day at current odds (statistical avg, not promised)
  const expectedDailySats = (perDay > 0 && totalBtc > 0)
    ? Math.round(perDay * totalBtc * 1e8)
    : 0;

  return (
    <div
      style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', cursor: onOpen ? 'pointer' : 'default'}}
      className="fade-in"
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}
      title={onOpen ? 'Tap to open The Reckoning' : undefined}
    >
      <div style={{...cardTitle, color:'var(--amber)', display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>▸ The Hunt</span>
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:'0.55rem'}}>

        {/* iter27c: PER-BLOCK ODDS / NONCE FIELD
            Visualizes the nonce space (2^32 possibilities per block header).
            Each cell in the grid represents ~33M nonces. Cells flicker as
            we hash, brighter cells are "recently checked." A subtle scan
            line sweeps L→R representing nonce iteration order. The density
            of activity scales with your live hashrate. */}
        <div>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6}}>
            <span style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--text-2)'}}>
              Per-Block Odds
            </span>
            <span style={{fontFamily:'var(--fd)', fontSize:'0.78rem', fontWeight:700, color:'var(--amber)', textShadow:'0 0 8px rgba(245,166,35,0.4)'}}>
              {perBlock>0 ? fmtOddsInverse(perBlock) : '—'}
            </span>
          </div>
          <NonceField hashrate={hashrate} netHashrate={netHashrate}/>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', fontFamily:'var(--fd)', fontSize:'0.46rem', letterSpacing:'0.13em', textTransform:'uppercase', color:'var(--text-3)', marginTop:4}}>
            <span>Nonce Field · 2³² space</span>
            <span style={{color:'var(--text-2)'}}>{hashrate>0 ? `${(hashrate/1e12).toFixed(1)} TH/s scanning` : 'idle'}</span>
          </div>
        </div>

        {/* Block reward hero — subsidy + fees breakdown */}
        <div style={{
          background:'linear-gradient(135deg, rgba(245,166,35,0.08) 0%, rgba(245,166,35,0.02) 100%)',
          border:'1px solid var(--amber)',
          padding:'0.55rem 0.75rem',
        }}>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:5, textAlign:'center'}}>
            BLOCK REWARD
          </div>
          <div style={{textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'1.4rem', fontWeight:800, color:'var(--amber)', lineHeight:1.1, textShadow:'0 0 10px rgba(245,166,35,0.4)'}}>
              {totalBtc > 0 ? totalBtc.toFixed(4) : '—'} <span style={{fontSize:'0.85rem'}}>BTC</span>
            </div>
            {fiatPrice > 0 && totalBtc > 0 && (
              <div style={{fontFamily:'var(--fd)', fontSize:'0.78rem', color:'var(--text-1)', marginTop:3, fontWeight:600}}>
                {fmtFiat(totalFiat, currency)}
              </div>
            )}
          </div>
          {(subsidyBtc > 0 || feesBtc > 0) && (
            <div style={{display:'flex', justifyContent:'space-between', gap:6, marginTop:7, paddingTop:7, borderTop:'1px dashed rgba(245,166,35,0.18)'}}>
              <div style={{flex:1, textAlign:'center'}}>
                <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-2)', letterSpacing:'0.1em', textTransform:'uppercase'}}>SUBSIDY</div>
                <div style={{fontFamily:'var(--fm)', fontSize:'0.78rem', color:'var(--text-1)', fontWeight:600, marginTop:2}}>
                  {subsidyBtc.toFixed(3)}
                </div>
              </div>
              <div style={{flex:1, textAlign:'center'}}>
                <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-2)', letterSpacing:'0.1em', textTransform:'uppercase'}}>FEES</div>
                <div style={{fontFamily:'var(--fm)', fontSize:'0.78rem', color:'var(--cyan)', fontWeight:600, marginTop:2}}>
                  +{feesBtc.toFixed(4)}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Fee tier strip — Fast / Mid / Low (sat/vB) (UNCHANGED) */}
        {(feeFast || feeMid || feeLow) && (
          <div style={{display:'flex', gap:6}}>
            <div style={{flex:1, background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.4rem 0.35rem', textAlign:'center'}}>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--green)', textTransform:'uppercase'}}>⚡ FAST</div>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', color:'var(--text-1)', fontWeight:700, marginTop:3}}>
                {feeFast != null ? feeFast : '—'}
              </div>
              <div style={{fontFamily:'var(--fm)', fontSize:'0.55rem', color:'var(--text-2)', marginTop:1}}>sat/vB</div>
            </div>
            <div style={{flex:1, background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.4rem 0.35rem', textAlign:'center'}}>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--amber)', textTransform:'uppercase'}}>◐ MID</div>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', color:'var(--text-1)', fontWeight:700, marginTop:3}}>
                {feeMid != null ? feeMid : '—'}
              </div>
              <div style={{fontFamily:'var(--fm)', fontSize:'0.55rem', color:'var(--text-2)', marginTop:1}}>sat/vB</div>
            </div>
            <div style={{flex:1, background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.4rem 0.35rem', textAlign:'center'}}>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--text-2)', textTransform:'uppercase'}}>◯ LOW</div>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', color:'var(--text-1)', fontWeight:700, marginTop:3}}>
                {feeLow != null ? feeLow : '—'}
              </div>
              <div style={{fontFamily:'var(--fm)', fontSize:'0.55rem', color:'var(--text-2)', marginTop:1}}>sat/vB</div>
            </div>
          </div>
        )}

        {/* Stats — single row of 4 (was 2x2 grid, saves vertical space in carousel mode) */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:4}}>
          <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.35rem 0.3rem', textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.46rem', letterSpacing:'0.08em', color:'var(--text-2)', textTransform:'uppercase'}}>Expected</div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--amber)', fontWeight:700, marginTop:2}}>
              {fmtOdds(expectedDays)}
            </div>
          </div>
          <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.35rem 0.3rem', textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.46rem', letterSpacing:'0.08em', color:'var(--text-2)', textTransform:'uppercase'}}>Yearly</div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-1)', fontWeight:700, marginTop:2}}>
              {perYear>0 ? (perYear < 0.0001 ? perYear.toExponential(1)+'%' : fmtPct(perYear*100, perYear < 0.01 ? 3 : 2)) : '—'}
            </div>
          </div>
          <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.35rem 0.3rem', textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.46rem', letterSpacing:'0.08em', color:'var(--text-2)', textTransform:'uppercase'}}>Daily</div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-1)', fontWeight:700, marginTop:2}}>
              {perDay>0 ? fmtPct(perDay*100, 3) : '—'}
            </div>
          </div>
          <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.35rem 0.3rem', textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.46rem', letterSpacing:'0.08em', color:'var(--text-2)', textTransform:'uppercase'}}>Sats/d</div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--cyan)', fontWeight:700, marginTop:2}}>
              {expectedDailySats > 0 ? expectedDailySats.toLocaleString() : '—'}
            </div>
          </div>
        </div>

        {onOpen && (
          <div style={{
            borderTop:'1px dashed rgba(245,166,35,0.18)',
            paddingTop:'0.55rem',
            fontFamily:'var(--fd)', fontSize:'0.6rem', color:'var(--amber)',
            letterSpacing:'0.12em', textAlign:'center',
          }}>
            ▸ TAP FOR THE RECKONING
          </div>
        )}
      </div>
    </div>
  );
}

// ── Stratum localStorage helpers (v1.7.16) ──────────────────────────────────
const LS_STRATUM_HOST       = 'ss_stratum_host_v1';
const LS_STRATUM_WORKERNAME = 'ss_stratum_workername_v1';
const LS_STRATUM_PASS       = 'ss_stratum_pass_v1';
function loadStratumHost()       { try { return localStorage.getItem(LS_STRATUM_HOST) || ''; } catch { return ''; } }
function saveStratumHost(v)      { try { localStorage.setItem(LS_STRATUM_HOST, v || ''); } catch {} }
function loadStratumWorkername() { try { return localStorage.getItem(LS_STRATUM_WORKERNAME) || ''; } catch { return ''; } }
function saveStratumWorkername(v){ try { localStorage.setItem(LS_STRATUM_WORKERNAME, v || ''); } catch {} }
function loadStratumPass()       { try { return localStorage.getItem(LS_STRATUM_PASS) || ''; } catch { return ''; } }
function saveStratumPass(v)      { try { localStorage.setItem(LS_STRATUM_PASS, v || ''); } catch {} }

// ── Carousel + Stratum rotation helpers (v1.7.17) ───────────────────────────
const LS_CAROUSEL_ENABLED        = 'ss_carousel_enabled_v1';
const LS_STRATUM_ROTATED         = 'ss_stratum_rotated_v1';   // '1' once we've moved Stratum to last
const LS_PULSE_ANIM              = 'ss_pulse_anim_v1';         // 'sluice' | 'glimmers' | 'ticker' | 'conveyor' | 'embers'
function loadCarouselEnabled() { try { const v = localStorage.getItem(LS_CAROUSEL_ENABLED); return v === null ? true : v === 'true'; } catch { return true; } }
function saveCarouselEnabled(v){ try { localStorage.setItem(LS_CAROUSEL_ENABLED, String(!!v)); } catch {} }
function loadStratumRotated()  { try { return localStorage.getItem(LS_STRATUM_ROTATED) === '1'; } catch { return false; } }
function saveStratumRotated()  { try { localStorage.setItem(LS_STRATUM_ROTATED, '1'); } catch {} }
const PULSE_ANIM_OPTIONS = [
  { id: 'sluice',   label: 'Sluice Box' },
  { id: 'glimmers', label: 'Cave Glimmers' },
  { id: 'ticker',   label: 'Hash Ticker' },
  { id: 'conveyor', label: 'Conveyor of Ore' },
  { id: 'embers',   label: 'Forge Embers' },
];
const PULSE_ANIM_DEFAULT = 'ticker';
function loadPulseAnim() {
  try {
    const v = localStorage.getItem(LS_PULSE_ANIM);
    return PULSE_ANIM_OPTIONS.some(o => o.id === v) ? v : PULSE_ANIM_DEFAULT;
  } catch { return PULSE_ANIM_DEFAULT; }
}
function savePulseAnim(v) { try { localStorage.setItem(LS_PULSE_ANIM, String(v)); } catch {} }
const LS_PULSE_BITCOIN_SYMBOLS = 'ss_pulse_btc_v1';
function loadPulseBitcoinSymbols() {
  try { return localStorage.getItem(LS_PULSE_BITCOIN_SYMBOLS) === 'true'; } catch { return false; }
}
function savePulseBitcoinSymbols(v) {
  try { localStorage.setItem(LS_PULSE_BITCOIN_SYMBOLS, String(!!v)); } catch {}
}

// Detects whether the user is on a "mobile" viewport. Returns true for
// any width below the 768px breakpoint. Hook re-runs on resize/orientation.
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobile(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  return isMobile;
}

// ── Carousel position dots (v1.7.17) ────────────────────────────────────────
// Floating indicator showing which card is centered. Tap a dot to jump.
function CarouselDots({ count, activeIndex, onJump }) {
  // Dots fade out after a few seconds of inactivity, reappear on swipe/touch.
  // - Show on initial mount briefly (so user discovers the dots exist)
  // - Show on activeIndex change (user swiped to a different card)
  // - Show on touchstart/scroll on the carousel (partial swipes too)
  // - After 2.5s of no activity, fade out
  const [visible, setVisible] = useState(true);
  const timerRef = useRef(null);

  const ping = useCallback(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2500);
  }, []);

  // Trigger on activeIndex change (covers complete swipes and dot taps)
  useEffect(() => {
    if (count <= 1) return;
    ping();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeIndex, count, ping]);

  // Also listen to touch/scroll on the carousel directly so partial swipes
  // (that don't change the active card) still wake the dots
  useEffect(() => {
    if (count <= 1) return;
    const carousel = document.querySelector('.ss-carousel');
    if (!carousel) return;
    carousel.addEventListener('scroll', ping, { passive: true });
    carousel.addEventListener('touchstart', ping, { passive: true });
    return () => {
      carousel.removeEventListener('scroll', ping);
      carousel.removeEventListener('touchstart', ping);
    };
  }, [count, ping]);

  if (count <= 1) return null;
  return (
    <div className={'ss-dots' + (visible ? '' : ' ss-dots-hidden')} role="tablist" aria-label="Cards">
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          className={'ss-dot' + (i === activeIndex ? ' active' : '')}
          onClick={() => { onJump(i); ping(); }}
          role="tab"
          aria-selected={i === activeIndex}
          aria-label={`Card ${i + 1} of ${count}`}
        />
      ))}
    </div>
  );
}

// ── Stratum Connection card (v1.7.16) ────────────────────────────────────────
// Configurable connection details for any Stratum V1 miner. Three editable
// fields with placeholder examples (tap any field to type, blur to save):
//
//   • HOST       — what the miner connects to (default: umbrel.local)
//   • WORKERNAME — suffix appended after the BTC address; shows in The Crew
//   • PASS       — usually 'x'; or 'd=12345' to lock difficulty
//
// All three persist to localStorage. The HOST value is also exported via
// useStratumHost() so the footer ports and any other stratum URL builder
// uses the same configured value.
function StratumPanel({ payoutAddress, stratumHealth, startedAt }) {
  const [copied, setCopied] = useState('');

  // Persistent fields — load from localStorage, save on blur.
  const [hostInput, setHostInput]             = useState(() => loadStratumHost());
  const [workernameInput, setWorkernameInput] = useState(() => loadStratumWorkername());
  const [passInput, setPassInput]             = useState(() => loadStratumPass());

  // Effective values used to build URLs/strings. Empty user input = use defaults.
  const host       = (hostInput.trim() || 'umbrel.local');
  const workername = (workernameInput.trim() || 'workername');
  const pass       = (passInput.trim() || 'x');

  const addrShort = payoutAddress
    ? (payoutAddress.length > 16 ? `${payoutAddress.slice(0,8)}…${payoutAddress.slice(-6)}` : payoutAddress)
    : 'YOUR_BTC_ADDRESS';
  const fullUser  = payoutAddress
    ? `${payoutAddress}.${workername}`
    : `bc1q...your_address.${workername}`;

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

  const portStatus = (p) => {
    const s = stratumHealth?.ports?.[p];
    if (!s) return { color:'var(--text-2)', dot:'◯' };
    if (s.status === 'open' || s.ok === true) return { color:'var(--green)', dot:'●' };
    if (s.status === 'degraded') return { color:'var(--amber)', dot:'◐' };
    return { color:'var(--red)', dot:'✕' };
  };

  // ── Shared styles for the editable fields ─────────────────────────────────
  // iter27c: tightened padding/margins to fit the whole card on one screen.
  const fieldRowStyle = {
    background:'var(--bg-raised)', border:'1px solid var(--border)',
    padding:'0.5rem 0.65rem', marginBottom:'0.4rem',
  };
  const labelStyle = {
    fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em',
    color:'var(--text-2)', textTransform:'uppercase', marginBottom:4,
    display:'flex', alignItems:'center', justifyContent:'space-between',
  };
  const inputStyle = {
    width:'100%', boxSizing:'border-box',
    fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-1)',
    background:'var(--bg-deep)', border:'1px solid var(--border)',
    padding:'5px 7px', outline:'none',
    borderRadius:0,
    WebkitAppearance:'none', appearance:'none',
  };
  const inputFocusStyle = { borderColor:'var(--amber)' };
  const helperStyle = {
    fontFamily:'var(--fm)', fontSize:'0.55rem', color:'var(--text-3)',
    marginTop:4, fontStyle:'italic',
  };

  const copyBtnStyle = (lbl, disabled = false) => ({
    background: copied === lbl ? 'rgba(57,255,106,0.1)' : 'none',
    border: `1px solid ${copied === lbl ? 'var(--green)' : 'var(--border)'}`,
    color: copied === lbl ? 'var(--green)' : (disabled ? 'var(--text-2)' : 'var(--amber)'),
    fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em',
    padding:'3px 8px', cursor: disabled ? 'not-allowed' : 'pointer',
    textTransform:'uppercase',
    opacity: disabled ? 0.5 : 1,
    transition:'background 0.15s',
  });

  // ── Port chip — tappable, copies stratum+tcp://host:port ─────────────────
  const PortChip = ({ port, accent, ssl }) => {
    const ps = portStatus(port);
    const url = `${ssl ? 'stratum+ssl' : 'stratum+tcp'}://${host}:${port}`;
    const lbl = `port${port}`;
    const isCopied = copied === lbl;
    return (
      <button
        onClick={() => copy(url, lbl)}
        style={{
          flex:1, minWidth:0,
          background: isCopied ? 'rgba(57,255,106,0.1)' : 'var(--bg-deep)',
          border:`1px solid ${isCopied ? 'var(--green)' : (accent || 'var(--border)')}`,
          padding:'6px 4px', cursor:'pointer',
          display:'flex', flexDirection:'column', alignItems:'center', gap:2,
          fontFamily:'var(--fd)', textAlign:'center',
          transition:'background 0.15s, border-color 0.15s',
        }}
      >
        <span style={{fontSize:'0.6rem', letterSpacing:'0.05em', color:isCopied ? 'var(--green)' : (accent || 'var(--text-1)'), fontWeight:700}}>
          {ssl && '🔒 '}{port}
        </span>
        <span style={{fontSize:'0.5rem', letterSpacing:'0.08em', color: ps.color}}>
          {isCopied ? '✓ COPIED' : `${ps.dot} ${ps.status || 'tap to copy'}`}
        </span>
      </button>
    );
  };

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)', marginBottom:'0.5rem'}}>▸ Stratum Connection</div>

      {/* HOST — editable */}
      <div style={fieldRowStyle}>
        <div style={labelStyle}>
          <span>Host</span>
        </div>
        <input
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={hostInput}
          placeholder="umbrel.local · 192.168.1.42 · my-rig.local"
          onChange={(e) => setHostInput(e.target.value)}
          onBlur={() => saveStratumHost(hostInput.trim())}
          onFocus={(e) => { e.target.style.borderColor = 'var(--amber)'; }}
          onBlurCapture={(e) => { e.target.style.borderColor = 'var(--border)'; }}
          style={inputStyle}
        />

        {/* Three port chips — tap to copy stratum URL */}
        <div style={{display:'flex', gap:6, marginTop:8}}>
          <PortChip port="3333" accent="var(--amber)" />
          <PortChip port="3334" accent="var(--text-1)" />
          <PortChip port="4333" accent="var(--cyan)" ssl />
        </div>
        <div style={{...helperStyle, marginTop:5, fontSize:'0.5rem'}}>
          3333 ASIC · 3334 Hobby · 🔒 4333 SSL
        </div>
      </div>

      {/* WORKERNAME — editable */}
      <div style={fieldRowStyle}>
        <div style={labelStyle}>
          <span>Workername</span>
        </div>
        <input
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={workernameInput}
          placeholder="bitaxe-01 · s19xp · nano3s_1 ..."
          onChange={(e) => setWorkernameInput(e.target.value)}
          onBlur={() => saveStratumWorkername(workernameInput.trim())}
          onFocus={(e) => { e.target.style.borderColor = 'var(--amber)'; }}
          onBlurCapture={(e) => { e.target.style.borderColor = 'var(--border)'; }}
          style={inputStyle}
        />

        {/* Full USER preview */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:8, marginBottom:4}}>
          <span style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', color:'var(--text-2)', textTransform:'uppercase'}}>
            Full USER string
          </span>
          <button
            onClick={() => payoutAddress && copy(fullUser, 'user')}
            disabled={!payoutAddress}
            style={copyBtnStyle('user', !payoutAddress)}
          >
            {copied === 'user' ? '✓ COPIED' : 'COPY'}
          </button>
        </div>
        <div style={{
          fontFamily:'var(--fm)', fontSize:'0.68rem', color:'var(--text-1)',
          background:'var(--bg-deep)', border:'1px solid var(--border)',
          padding:'4px 7px', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
        }}>
          {addrShort}<span style={{color:'var(--text-2)'}}>.{workername}</span>
        </div>
        {!payoutAddress && (
          <div style={{...helperStyle, color:'var(--amber)', marginTop:4}}>
            ⚠ Set payout address in Settings
          </div>
        )}
      </div>

      {/* PASS — editable */}
      <div style={fieldRowStyle}>
        <div style={labelStyle}>
          <span>Pass / Difficulty</span>
        </div>
        <input
          type="text"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={passInput}
          placeholder="x   (or  d=10000  for fixed difficulty)"
          onChange={(e) => setPassInput(e.target.value)}
          onBlur={() => saveStratumPass(passInput.trim())}
          onFocus={(e) => { e.target.style.borderColor = 'var(--amber)'; }}
          onBlurCapture={(e) => { e.target.style.borderColor = 'var(--border)'; }}
          style={inputStyle}
        />
        <div style={{...helperStyle, fontSize:'0.5rem'}}>
          <span style={{color:'var(--amber)'}}>x</span>=vardiff · <span style={{color:'var(--cyan)'}}>d=10000</span>=lock 10K · <span style={{color:'var(--cyan)'}}>d=1M</span>=lock 1M
        </div>

        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:8, marginBottom:4}}>
          <span style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', color:'var(--text-2)', textTransform:'uppercase'}}>
            Effective PASS
          </span>
          <button
            onClick={() => copy(pass, 'pass')}
            style={copyBtnStyle('pass')}
          >
            {copied === 'pass' ? '✓ COPIED' : 'COPY'}
          </button>
        </div>
        <div style={{
          fontFamily:'var(--fm)', fontSize:'0.68rem', color:'var(--text-1)',
          background:'var(--bg-deep)', border:'1px solid var(--border)',
          padding:'4px 7px',
        }}>
          {pass}
        </div>
      </div>

      {/* iter26: Pool uptime + started date strip */}
      <PoolUptimeStrip startedAt={startedAt}/>
    </div>
  );
}

// iter26: Renders pool uptime + started timestamp at the bottom of the
// Stratum card. Pulls from the global `state.shareStatsStartedAt` timestamp
// which is the closest thing we have to "when did this pool start tracking."
function PoolUptimeStrip({ startedAt }) {
  // Read shareStatsStartedAt from window state if available — pulled in by
  // a parent prop in main render. Falls back to startedAt prop or null.
  const ts = startedAt || (typeof window !== 'undefined' && window.__solostrikeStartedAt) || null;
  if (!ts) return null;
  const sinceMs = Date.now() - ts;
  const days = Math.floor(sinceMs / 86400000);
  const hrs  = Math.floor((sinceMs % 86400000) / 3600000);
  const uptimeStr = days > 0 ? `${days}d ${hrs}h` : `${hrs}h`;
  const startedStr = new Date(ts).toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' });
  return (
    <div style={{
      marginTop:'0.7rem',
      paddingTop:'0.55rem',
      borderTop:'1px dashed rgba(245,166,35,0.18)',
      display:'grid',
      gridTemplateColumns:'1fr 1fr',
      gap:'0.5rem',
    }}>
      <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.5rem 0.4rem', textAlign:'center', minWidth:0, overflow:'hidden'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.13em', color:'var(--text-2)', textTransform:'uppercase', marginBottom:3}}>Uptime</div>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.95rem', fontWeight:700, color:'var(--green)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{uptimeStr}</div>
      </div>
      <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.5rem 0.4rem', textAlign:'center', minWidth:0, overflow:'hidden'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.13em', color:'var(--text-2)', textTransform:'uppercase', marginBottom:3}}>Started</div>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', fontWeight:700, color:'var(--cyan)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{startedStr}</div>
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
  const { progressPercent=0, difficultyChange=0, remainingBlocks=0, remainingTime=0, prevDifficultyChange=null } = retarget;
  const changeColor = difficultyChange>=0 ? 'var(--red)' : 'var(--green)';
  const pct = Math.max(0, Math.min(100, progressPercent));
  // iter26: previous epoch's adjustment color uses inverse semantics (last
  // change is historic, doesn't affect "do I want easy diff?" framing)
  const prevColor = prevDifficultyChange == null
    ? 'var(--text-2)'
    : prevDifficultyChange >= 0 ? 'var(--red)' : 'var(--green)';
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={cardTitle}>▸ Difficulty Retarget</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
        <div style={{textAlign:'center',padding:'0.25rem 0'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.6rem',fontWeight:700,color:changeColor,textShadow:`0 0 14px ${changeColor}50`,lineHeight:1}}>
            {difficultyChange>=0?'+':''}{difficultyChange.toFixed(2)}%
          </div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginTop:4}}>estimated change</div>
          {/* iter26: previous epoch comparison */}
          {prevDifficultyChange != null && (
            <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)', marginTop:6}}>
              Last epoch: <span style={{color:prevColor, fontWeight:600}}>{prevDifficultyChange>=0?'+':''}{prevDifficultyChange.toFixed(2)}%</span>
            </div>
          )}
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
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:250,padding:'calc(env(safe-area-inset-top) + 1rem) 0.75rem 0.75rem',overflowY:'auto'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:560,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',boxShadow:'var(--glow-a)',maxHeight:'calc(100dvh - 4rem)',overflowY:'auto'}}>
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
            {/* iter27d: extended diagnostics — session start, avg diff, last share, implied HR */}
            {(() => {
              // Session started — same trackingSince used in the footer text below
              const sessStart = trackingSince || null;
              const sessMs = sessStart ? Date.now() - sessStart : 0;
              const sessHrs = sessMs / 3600000;
              const sessLabel = sessStart
                ? `${new Date(sessStart).toLocaleDateString(undefined,{month:'short',day:'numeric'})} ${new Date(sessStart).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · ${fmtDurationMs(sessMs)} ago`
                : '—';

              // Average accepted-share difficulty
              const acceptedDiff = sh.accepted || 0;
              const avgDiff = totalAccepted > 0 ? (acceptedDiff / totalAccepted) : 0;
              const avgDiffLabel = avgDiff > 0 ? fmtDiff(avgDiff) : '—';

              // Last share submission across all workers (pool-level)
              let lastShareTs = 0;
              for (const w of wl) {
                if (w.lastSeen && w.lastSeen > lastShareTs) lastShareTs = w.lastSeen;
              }
              const lastShareLabel = lastShareTs > 0 ? fmtAgoShort(lastShareTs) : '—';
              const lastShareColor = lastShareTs > 0 && (Date.now() - lastShareTs) < 60000
                ? 'var(--green)'
                : lastShareTs > 0 && (Date.now() - lastShareTs) < 300000
                ? 'var(--amber)'
                : lastShareTs > 0 ? 'var(--red)' : 'var(--text-2)';

              // Implied hashrate from accepted-diff over time. Diff×2^32 = hashes.
              // Compare to live hashrate (reads off the live workers list).
              let liveHr = 0;
              for (const w of wl) liveHr += (w.hashrate || 0);
              const impliedHr = sessHrs > 0 && acceptedDiff > 0
                ? (acceptedDiff * 4294967296) / (sessHrs * 3600)
                : 0;
              const matchOk = liveHr > 0 && impliedHr > 0
                ? Math.abs(impliedHr - liveHr) / Math.max(impliedHr, liveHr) < 0.25
                : false;
              const matchLabel = impliedHr > 0
                ? `${fmtHr(impliedHr)}${liveHr > 0 ? (matchOk ? ' ✓' : ' ⚠') : ''}`
                : '—';
              const matchColor = impliedHr > 0
                ? (liveHr === 0 ? 'var(--text-1)' : matchOk ? 'var(--green)' : 'var(--amber)')
                : 'var(--text-2)';

              return (
                <>
                  <div style={kvRow}>
                    <span style={kvLabel}>Avg Share Difficulty</span>
                    <span style={{...kvVal,color:'var(--cyan)'}}>{avgDiffLabel}</span>
                  </div>
                  <div style={kvRow}>
                    <span style={kvLabel}>Last Share (pool)</span>
                    <span style={{...kvVal,color:lastShareColor}}>{lastShareLabel}</span>
                  </div>
                  <div style={kvRow}>
                    <span style={kvLabel}>Implied Hashrate</span>
                    <span style={{...kvVal,color:matchColor}}>{matchLabel}</span>
                  </div>
                  <div style={kvRow}>
                    <span style={kvLabel}>Session Started</span>
                    <span style={{...kvVal,color:'var(--text-2)',fontSize:'0.62rem'}}>{sessLabel}</span>
                  </div>
                </>
              );
            })()}
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
  // iter26: prefer real SPS from ckpool's pool.status (sps1m); fall back to
  // hashrate-derived estimate if the API field isn't yet populated.
  const realSps = s.sps1m || 0;
  const estSps  = hashrate > 0 ? (hashrate / 4294967296) : 0;
  const useSps  = realSps > 0 ? realSps : estSps;
  const sharesPerMin = (useSps * 60).toFixed(1);
  const spsLabel = realSps > 0 ? 'Shares / min' : 'Shares / min (est.)';
  // iter26: top-line reject rate %. Counts include stale shares as rejected
  // for the headline accuracy figure (standard share-quality methodology).
  const lifeAccepted = s.acceptedCount || 0;
  const lifeRejected = s.rejectedCount || 0;
  const lifeStale    = s.stale || 0;
  const lifeTotal = lifeAccepted + lifeRejected + lifeStale;
  const rejectPct = lifeTotal > 0 ? (((lifeRejected + lifeStale) / lifeTotal) * 100) : null;
  return (
    <div onClick={onOpen} style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', cursor: onOpen ? 'pointer' : 'default'}} className="fade-in">
      <div style={{...cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>▸ Share Stats</span>
        <a href="/api/export/workers.csv" download onClick={e=>e.stopPropagation()} style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.1em',color:'var(--cyan)',textDecoration:'none',padding:'4px 8px',marginRight:'14px',whiteSpace:'nowrap'}}>⬇ CSV</a>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.6rem'}}>
        <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.875rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Accepted Work</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.8rem',fontWeight:700,color:'var(--green)',lineHeight:1}}>{fmtDiff(workAccepted)}</div>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-2)',marginTop:6}}>
            {workRejected>0 && <><span style={{color:'var(--red)'}}>{fmtDiff(workRejected)}</span> rejected</>}
       <> · <span style={{color:stale>0?'var(--amber)':'var(--text-2)'}}>{fmtDiff(stale)}</span> stale</>
          </div>
        </div>
        {/* iter26: Reject Rate top-line + lifetime share counter */}
        {(rejectPct !== null || lifeAccepted > 0) && (
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem'}}>
            {rejectPct !== null && (
              <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.65rem 0.5rem', minWidth:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.13em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:4}}>Reject Rate</div>
                <div style={{fontFamily:'var(--fd)',fontSize:'1.15rem',fontWeight:700,lineHeight:1,color: rejectPct < 0.5 ? 'var(--green)' : rejectPct < 2 ? 'var(--amber)' : 'var(--red)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {rejectPct < 0.001 ? rejectPct.toExponential(1) : rejectPct.toFixed(rejectPct < 0.1 ? 3 : 2)}%
                </div>
              </div>
            )}
            {lifeAccepted > 0 && (
              <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.65rem 0.5rem', minWidth:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',letterSpacing:'0.13em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:4}}>Lifetime Shares</div>
                <div style={{fontFamily:'var(--fd)',fontSize:'1.15rem',fontWeight:700,lineHeight:1,color:'var(--cyan)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {fmtNum(lifeAccepted)}
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.875rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Best Difficulty</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.8rem',fontWeight:700,color:'var(--amber)',lineHeight:1,textShadow:'0 0 14px rgba(245,166,35,0.3)'}}>{fmtDiff(bestshare||0)}<span style={{fontSize:'0.6rem',color:'var(--text-2)',marginLeft:6,fontWeight:400}}>all-time</span></div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',marginTop:'0.2rem'}}>
          <span>{spsLabel}</span><span style={{color:'var(--cyan)'}}>{sharesPerMin}</span>
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
function TopFindersPanel({ topFinders, netBlocks, compact = false }) {
  const list = topFinders || [];
  const totalSample = (netBlocks||[]).length;
  if (!list.length) return null;
  const maxCount = list[0]?.count || 1;
  const inner = (
    <>
      <div style={{...cardTitle, color:'var(--amber)', marginBottom: compact ? '0.4rem' : undefined}}>▸ Claim Jumpers — Latest Strikes</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.35rem', maxHeight: compact ? 180 : undefined, overflowY: compact ? 'auto' : undefined}}>
        {list.map((p,i)=>{
          const pct = (p.count/maxCount)*100;
          const color = p.isSolo ? 'var(--amber)' : (i===0 ? 'var(--cyan)' : 'var(--text-1)');
          return (
            <div key={p.name} style={{padding: compact ? '0.4rem 0.7rem' : '0.5rem 0.8rem',background:'var(--bg-raised)',border:`1px solid ${i===0?'rgba(0,255,209,0.2)':'var(--border)'}`,position:'relative',overflow:'hidden', minWidth:0}}>
              <div style={{position:'absolute',inset:0,width:`${pct}%`,background:p.isSolo?'rgba(245,166,35,0.06)':'rgba(0,255,209,0.04)',transition:'width 0.6s ease'}}/>
              <div style={{position:'relative',display:'flex',alignItems:'center',gap:'0.6rem'}}>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.65rem',fontWeight:700,color:i===0?'var(--cyan)':'var(--text-2)',width:18, flexShrink:0}}>#{i+1}</span>
                <div style={{flex:1,minWidth:0,fontFamily:'var(--fd)',fontSize: compact ? '0.66rem' : '0.72rem',color,letterSpacing:'0.05em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textTransform:'uppercase'}}>
                  {p.name}{p.isSolo && <span style={{fontSize:'0.5rem',color:'var(--amber)',marginLeft:6,border:'1px solid var(--amber)',padding:'0 4px'}}>SOLO</span>}
                </div>
                <span style={{fontFamily:'var(--fd)',fontSize: compact ? '0.78rem' : '0.85rem',fontWeight:700,color, flexShrink:0}}>{p.count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
  if (compact) return inner;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      {inner}
    </div>
  );
}

// ── Block feed (our strikes) ──────────────────────────────────────────────────
function BlockFeed({ blocks, blockAlert, compact = false }) {
  const inner = (
    <>
      <div style={{...cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center', color:'var(--amber)', marginBottom: compact ? '0.4rem' : undefined}}>
        <span>▸ Solo Strikes — {(blocks||[]).length} total</span>
        {(blocks||[]).length>0 && <a href="/api/export/blocks.csv" download style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.1em',color:'var(--cyan)',textDecoration:'none',padding:'4px 8px',marginRight:'14px',whiteSpace:'nowrap'}}>⬇ CSV</a>}
      </div>
      {!(blocks||[]).length?(
        <div style={{textAlign:'center',padding: compact ? '0.9rem' : '1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)'}}>No block hit yet.<br/><span style={{color:'var(--amber)',fontSize:'0.68rem'}}>Keep mining ⛏</span></div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem',maxHeight: compact ? 140 : 240,overflowY:'auto'}}>
          {blocks.map((b,i)=>(
            <div key={b.hash} style={{display:'flex',alignItems:'center',gap:'0.75rem',padding: compact ? '0.5rem 0.75rem' : '0.7rem 1rem',background:'var(--bg-raised)',border:`1px solid ${blockAlert&&i===0?'var(--green)':'rgba(57,255,106,0.15)'}`,animation:blockAlert&&i===0?'blockBoom 0.6s ease':'none', minWidth:0}}>
              <span style={{fontSize:16, flexShrink:0}}>💎</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize: compact ? '0.78rem' : '0.88rem',fontWeight:600,color:'var(--green)'}}>#{fmtNum(b.height)}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.hash?.slice(0,24)}…</div>
              </div>
              <span style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-2)',flexShrink:0}}>{timeAgo(b.ts)}</span>
              <a href={`https://mempool.space/block/${b.hash}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--text-2)',fontSize:12, flexShrink:0}}>↗</a>
            </div>
          ))}
        </div>
      )}
    </>
  );
  if (compact) return inner;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      {inner}
    </div>
  );
}

// ── Recent network blocks ─────────────────────────────────────────────────────
function RecentBlocksPanel({ netBlocks }) {
  const list = netBlocks || [];
  if (!list.length) return null;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, color:'var(--amber)'}}>▸ The Ledger — Solo Winners ⚡</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.35rem',maxHeight:500,overflowY:'auto'}}>
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
          <div style={{fontFamily:'var(--fd)',fontSize:'2rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.05em',marginTop:14,textShadow:'0 0 25px var(--amber)'}}>BLOCK STRUCK!</div>
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
function SettingsModal({ onClose, saveConfig, currentConfig, currency, onCurrencyChange, onResetLayout, workers, aliases, onAliasesChange, stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange, networkStats, onNetworkStatsRefresh, carouselEnabled, onCarouselChange, pulseAnim, onPulseAnimChange, useBitcoinSymbols, onBitcoinSymbolsChange }) {
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
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'calc(env(safe-area-inset-top) + 1rem) 1rem 1rem',overflowY:'auto'}} onClick={onClose}>
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
            visibleCards={visibleCards} onVisibleCardsChange={onVisibleCardsChange}
            carouselEnabled={carouselEnabled} onCarouselChange={onCarouselChange}/>
        )}
        {tab==='privacy' && (
          <PrivacyTab privateMode={privateMode} setPrivateMode={setPrivateMode}
            submit={submit} saved={saved} loading={loading}/>
        )}
        {tab==='pulse' && (
          <PulseTab networkStats={networkStats} onRefresh={onNetworkStatsRefresh}
            pulseAnim={pulseAnim} onPulseAnimChange={onPulseAnimChange}
            useBitcoinSymbols={useBitcoinSymbols} onBitcoinSymbolsChange={onBitcoinSymbolsChange}/>
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
function DisplayTab({ stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, visibleCards, onVisibleCardsChange, carouselEnabled, onCarouselChange }) {
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

      <div style={sectionTitle}>▸ Card Layout (Mobile)</div>
      <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.5rem', padding:'0.75rem 0.8rem', background: carouselEnabled?'rgba(245,166,35,0.06)':'var(--bg-raised)', border:`1px solid ${carouselEnabled?'rgba(245,166,35,0.35)':'var(--border)'}`}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.78rem', color: carouselEnabled?'var(--amber)':'var(--text-1)', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase'}}>
            {carouselEnabled ? 'Carousel · Swipe' : 'Vertical · Scroll'}
          </div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)', marginTop:3, lineHeight:1.4}}>
            {carouselEnabled
              ? 'One card per screen — swipe left/right between them. Position dots at the bottom show where you are. Mobile only — desktop always uses the grid.'
              : 'Classic vertical stack — scroll up/down through all cards on one page. Same as it was before v1.7.17.'}
          </div>
        </div>
        <button onClick={()=>onCarouselChange(!carouselEnabled)}
          style={{width:46, height:26, borderRadius:13, background: carouselEnabled?'var(--amber)':'var(--bg-deep)', border:'1px solid var(--border)', position:'relative', cursor:'pointer', flexShrink:0}}>
          <div style={{position:'absolute', top:2, left: carouselEnabled?22:2, width:20, height:20, borderRadius:'50%', background: carouselEnabled?'#000':'var(--text-2)', transition:'left 0.2s'}}/>
        </button>
      </div>

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
function PulseTab({ networkStats, onRefresh, pulseAnim, onPulseAnimChange, useBitcoinSymbols, onBitcoinSymbolsChange }) {
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

      {/* ─── Pulse animation picker (v1.7.22-iter23) ────────────────────── */}
      {onPulseAnimChange && (
        <div style={{
          marginTop: 18, paddingTop: 14,
          borderTop: '1px solid var(--border)',
        }}>
          <div style={{
            fontFamily: 'var(--fd)', fontSize: '0.6rem', letterSpacing: '0.12em',
            color: 'var(--text-2)', marginBottom: 8, textTransform: 'uppercase',
          }}>
            Pulse Animation Style
          </div>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: '0.4rem',
          }}>
            {PULSE_ANIM_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => onPulseAnimChange(opt.id)}
                style={{
                  background: pulseAnim === opt.id ? 'rgba(245,166,35,0.18)' : 'transparent',
                  border: `1px solid ${pulseAnim === opt.id ? 'var(--amber)' : 'var(--border)'}`,
                  color: pulseAnim === opt.id ? 'var(--amber)' : 'var(--text-2)',
                  fontFamily: 'var(--fd)', fontSize: '0.62rem', letterSpacing: '0.08em',
                  textTransform: 'uppercase', padding: '0.45rem 0.7rem',
                  cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 2,
                  transition: 'all 0.15s ease',
                }}
              >{opt.label}</button>
            ))}
          </div>
          <div style={{
            fontFamily: 'var(--fm)', fontSize: '0.62rem', color: 'var(--text-3)',
            marginTop: 6,
          }}>
            Choose how the SoloStrike Pulse network is visualized.
          </div>
        </div>
      )}

      {/* ─── Bitcoin Symbols toggle (v1.7.22-iter23) ───────────────────── */}
      {onBitcoinSymbolsChange && (
        <div style={{ marginTop: 14 }}>
          <label style={{
            display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={!!useBitcoinSymbols}
              onChange={e => onBitcoinSymbolsChange(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: 'var(--amber)' }}
            />
            <span style={{
              fontFamily: 'var(--fd)', fontSize: '0.7rem', letterSpacing: '0.08em',
              color: 'var(--text-1)', textTransform: 'uppercase',
            }}>
              Bitcoin Symbols (₿)
            </span>
          </label>
          <div style={{
            fontFamily: 'var(--fm)', fontSize: '0.62rem', color: 'var(--text-3)',
            marginTop: 4, marginLeft: 24,
          }}>
            Replace gold flakes / embers / glints with Bitcoin (₿) symbols.
          </div>
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
function PulsePanel({ networkStats, onOpenSettings, onOpenStrikers, pulseAnim = 'ticker', useBitcoinSymbols = false, compact = false }) {
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
      // iter25: read actual container height instead of hardcoded 96.
      // Container is 88px in compact (carousel) and 160px standalone.
      // Hardcoding 96 left the bottom of the standalone container empty
      // because the canvas backing store was smaller than the visible area.
      const cssHeight = Math.max(40, rect.height);
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
  // ────────────────────────────────────────────────────────────────────
  //  Pulse animation dispatcher
  //  ‒ One useEffect, switches based on `pulseAnim` prop
  //  ‒ All draw functions share: enabled, ns.hashrate, lastTickRef,
  //    canvasWidthRef, canvasHeightRef, animationFrameRef, spikesRef,
  //    canvas (persisted state stored on canvas._foo)
  //  ‒ Common pattern: a draw(now) function called via requestAnimationFrame
  //  ‒ Stat-change broadcasts trigger an "event burst" pertinent to each animation
  // ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Reset persistent state when switching animations so the new one starts clean
    canvas._flakes = undefined;
    canvas._flakeAccum = undefined;
    canvas._timeAccum = undefined;
    canvas._columns = undefined;
    canvas._winnerAccum = undefined;
    canvas._embers = undefined;
    canvas._emberAccum = undefined;
    canvas._chunks = undefined;
    canvas._chunkAccum = undefined;
    canvas._glints = undefined;
    canvas._glintAccum = undefined;

    // ─── Sluice Box Stream ────────────────────────────────────
    const drawSluice = (dt, W, H) => {
      if (!canvas._flakes) canvas._flakes = [];
      if (canvas._flakeAccum === undefined) canvas._flakeAccum = 0;
      if (canvas._timeAccum === undefined) canvas._timeAccum = 0;
      canvas._timeAccum += dt;

      const ths = enabled ? (ns.hashrate || 0) / 1e12 : 0;
      const speed = enabled ? 60 + Math.min(180, ths * 1.5) : 25;
      const flakeRate = enabled ? 0.5 + Math.min(15, ths * 0.15) : 0.15;

      canvas._flakeAccum += dt * flakeRate;
      while (canvas._flakeAccum >= 1) {
        canvas._flakeAccum -= 1;
        canvas._flakes.push({
          x: -3, y: Math.random() * (H - 8) + 4,
          vx: speed * (1.1 + Math.random() * 0.4),
          vy: (Math.random() - 0.5) * 8,
          size: 0.8 + Math.random() * 1.6,
          shade: Math.random(), life: 0,
        });
      }

      spikesRef.current = spikesRef.current
        .map(s => ({ ...s, age: s.age + dt }))
        .filter(s => s.age < 0.3);
      for (const s of spikesRef.current) {
        if (s.age < dt * 1.5) {
          for (let i = 0; i < 12; i++) {
            canvas._flakes.push({
              x: -3 - Math.random() * 20,
              y: Math.random() * (H - 8) + 4,
              vx: speed * (1.2 + Math.random() * 0.6),
              vy: (Math.random() - 0.5) * 16,
              size: 1.2 + Math.random() * 2.0,
              shade: 0.7 + Math.random() * 0.3,
              life: 0, burst: true,
            });
          }
        }
      }

      const flakes = canvas._flakes;
      for (let i = flakes.length - 1; i >= 0; i--) {
        const f = flakes[i];
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        f.life += dt;
        if (f.x > W + 5) flakes.splice(i, 1);
      }

      ctx.fillStyle = 'rgba(20, 22, 26, 0.85)';
      ctx.fillRect(0, 0, W, H);

      const layers = [
        { y: H * 0.35, amp: 4,  freq: 0.018, color: 'rgba(60,80,100,0.20)', speedMul: 0.7 },
        { y: H * 0.55, amp: 6,  freq: 0.022, color: 'rgba(80,100,120,0.18)', speedMul: 0.85 },
        { y: H * 0.75, amp: 5,  freq: 0.026, color: 'rgba(100,120,140,0.14)', speedMul: 1.0 },
      ];
      for (const layer of layers) {
        const phaseShift = canvas._timeAccum * speed * layer.speedMul * 0.05;
        ctx.strokeStyle = layer.color;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        for (let x = 0; x <= W; x += 4) {
          const y = layer.y + Math.sin(x * layer.freq + phaseShift) * layer.amp +
                              Math.sin(x * layer.freq * 1.7 + phaseShift * 0.6) * (layer.amp * 0.4);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      ctx.strokeStyle = 'rgba(100,80,50,0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = 0; x < W; x += 14) { ctx.moveTo(x, H); ctx.lineTo(x, H - 6); }
      ctx.moveTo(0, H - 0.5); ctx.lineTo(W, H - 0.5);
      ctx.stroke();

      ctx.shadowBlur = enabled ? 6 : 0;
      for (const f of flakes) {
        const alpha = enabled ? Math.min(1, f.life * 8) : 0.4;
        const r = Math.round(245 + f.shade * 10);
        const g = Math.round(166 + f.shade * 45);
        const b = Math.round(35 + f.shade * 80);
        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
        if (useBitcoinSymbols) {
          // Render as ₿ — use size to drive font size (1.6-3.2 range → 8-14px)
          const fontPx = Math.max(8, Math.round(5 + f.size * 2.4));
          ctx.font = `${fontPx}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('₿', f.x, f.y);
        } else {
          ctx.beginPath();
          ctx.ellipse(f.x, f.y, f.size * 1.4, f.size * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
    };

    // ─── Cave Glimmers ────────────────────────────────────────
    const drawGlimmers = (dt, W, H) => {
      if (!canvas._glints) canvas._glints = [];
      if (canvas._glintAccum === undefined) canvas._glintAccum = 0;
      if (canvas._timeAccum === undefined) canvas._timeAccum = 0;
      canvas._timeAccum += dt;

      const ths = enabled ? (ns.hashrate || 0) / 1e12 : 0;
      // Glints per second: 0.8 base + 0.2 per TH/s
      const rate = enabled ? 0.8 + Math.min(20, ths * 0.2) : 0.3;

      canvas._glintAccum += dt * rate;
      while (canvas._glintAccum >= 1) {
        canvas._glintAccum -= 1;
        canvas._glints.push({
          x: 4 + Math.random() * (W - 8),
          y: 4 + Math.random() * (H - 8),
          age: 0,
          life: 0.6 + Math.random() * 1.2,
          maxR: 1.6 + Math.random() * 2.4,
          shade: Math.random(),
          gold: false,
        });
      }

      spikesRef.current = spikesRef.current
        .map(s => ({ ...s, age: s.age + dt }))
        .filter(s => s.age < 0.3);
      for (const s of spikesRef.current) {
        if (s.age < dt * 1.5) {
          // Big glint cluster — like a big find
          for (let i = 0; i < 6; i++) {
            canvas._glints.push({
              x: 4 + Math.random() * (W - 8),
              y: 4 + Math.random() * (H - 8),
              age: 0, life: 1.4 + Math.random() * 0.8,
              maxR: 3 + Math.random() * 2,
              shade: 0.8, gold: true,
            });
          }
        }
      }

      const glints = canvas._glints;
      for (let i = glints.length - 1; i >= 0; i--) {
        glints[i].age += dt;
        if (glints[i].age > glints[i].life) glints.splice(i, 1);
      }

      // Dark cave-rock background with subtle vignette
      ctx.fillStyle = 'rgba(14, 16, 20, 0.95)';
      ctx.fillRect(0, 0, W, H);

      // Faint cave-wall texture (deterministic pseudo-noise lines)
      ctx.strokeStyle = 'rgba(60, 50, 40, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < W; x += 12) {
        const y1 = (Math.sin(x * 0.13) + Math.sin(x * 0.07)) * 4 + H * 0.3;
        const y2 = (Math.cos(x * 0.11) + Math.sin(x * 0.05)) * 5 + H * 0.7;
        ctx.moveTo(x, y1); ctx.lineTo(x + 8, y1 + 1);
        ctx.moveTo(x + 4, y2); ctx.lineTo(x + 12, y2 + 1.5);
      }
      ctx.stroke();

      // Render glints
      for (const g of glints) {
        const t = g.age / g.life;
        // 3-stage envelope: fade in (0-0.2) → peak (0.2-0.6) → fade out (0.6-1.0)
        let alpha;
        if (t < 0.2) alpha = t / 0.2;
        else if (t < 0.6) alpha = 1;
        else alpha = (1 - t) / 0.4;
        if (!enabled) alpha *= 0.45;

        const r = g.gold ? 255 : Math.round(245 + g.shade * 10);
        const gC = g.gold ? 230 : Math.round(166 + g.shade * 50);
        const b = g.gold ? 130 : Math.round(35 + g.shade * 90);

        // Star-burst rays + center dot
        ctx.shadowColor = `rgba(${r},${gC},${b},0.9)`;
        ctx.shadowBlur = g.gold ? 14 : 8;

        if (useBitcoinSymbols) {
          // Render center as ₿ symbol
          const fontPx = Math.max(8, Math.round(g.maxR * 3.2));
          ctx.font = `${fontPx}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = `rgba(${r},${gC},${b},${alpha})`;
          ctx.fillText('₿', g.x, g.y);
        } else {
          // Center bright dot
          ctx.fillStyle = `rgba(${r},${gC},${b},${alpha})`;
          ctx.beginPath();
          ctx.arc(g.x, g.y, g.maxR * (alpha * 0.6 + 0.4), 0, Math.PI * 2);
          ctx.fill();
        }

        // 4-point star rays at peak (still drawn in both modes for emphasis)
        if (alpha > 0.3 && !useBitcoinSymbols) {
          ctx.strokeStyle = `rgba(${r},${gC},${b},${alpha * 0.7})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          const rayLen = g.maxR * 2.5;
          ctx.moveTo(g.x - rayLen, g.y); ctx.lineTo(g.x + rayLen, g.y);
          ctx.moveTo(g.x, g.y - rayLen); ctx.lineTo(g.x, g.y + rayLen);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
    };

    // ─── Hash Ticker (Matrix Rain) ────────────────────────────
    const HEX_CHARS = '0123456789abcdef';
    const drawTicker = (dt, W, H) => {
      if (!canvas._columns) canvas._columns = [];
      if (canvas._winnerAccum === undefined) canvas._winnerAccum = 0;
      const CHAR_W = 9;
      const CHAR_H = 11;

      const ths = enabled ? (ns.hashrate || 0) / 1e12 : 0;
      const maxColumns = Math.floor(W / CHAR_W);
      const columnCount = Math.min(maxColumns, 10 + Math.floor(ths * 0.4));
      const fallSpeed = enabled ? 35 + Math.min(120, ths * 0.8) : 12;
      const winnerRate = enabled ? 0.3 + Math.min(8, ths * 0.04) : 0.1;

      while (canvas._columns.length < columnCount) {
        canvas._columns.push({ drops: [], spawnAccum: Math.random() });
      }
      while (canvas._columns.length > columnCount) canvas._columns.pop();
      const spacing = columnCount > 0 ? W / columnCount : W;
      for (let i = 0; i < canvas._columns.length; i++) {
        canvas._columns[i].x = spacing * i + spacing / 2;
      }

      canvas._winnerAccum += dt * winnerRate;
      while (canvas._winnerAccum >= 1) {
        canvas._winnerAccum -= 1;
        if (canvas._columns.length > 0) {
          const col = canvas._columns[Math.floor(Math.random() * canvas._columns.length)];
          if (col.drops.length > 0) {
            col.drops[0].isWinner = true;
            col.drops[0].winnerLife = 0;
          }
        }
      }

      spikesRef.current = spikesRef.current
        .map(s => ({ ...s, age: s.age + dt }))
        .filter(s => s.age < 0.3);
      for (const s of spikesRef.current) {
        if (s.age < dt * 1.5) {
          const numFlash = Math.min(4, canvas._columns.length);
          const indices = new Set();
          while (indices.size < numFlash && indices.size < canvas._columns.length) {
            indices.add(Math.floor(Math.random() * canvas._columns.length));
          }
          for (const idx of indices) {
            const col = canvas._columns[idx];
            if (col.drops.length > 0) {
              col.drops[0].isWinner = true;
              col.drops[0].isBroadcast = true;
              col.drops[0].winnerLife = 0;
            }
          }
        }
      }

      // Scale drop density to canvas height — tall canvases need more drops
      // per column to stay visually full. ~14 rows fits at 160px → up to 6 drops.
      const rowsOnScreen = Math.max(8, Math.floor(H / CHAR_H));
      const maxDropsPerCol = Math.max(3, Math.ceil(rowsOnScreen / 2.5));
      // Faster cadence on taller canvases so drops don't drain out before refilling
      const spawnGap = Math.max(0.25, 1.6 / (rowsOnScreen / 8));

      for (const col of canvas._columns) {
        col.spawnAccum -= dt * (fallSpeed / 60);
        if (col.spawnAccum <= 0 && col.drops.length < maxDropsPerCol) {
          const len = 6 + Math.floor(Math.random() * 14);
          const chars = [];
          for (let i = 0; i < len; i++) chars.push(HEX_CHARS[Math.floor(Math.random() * 16)]);
          col.drops.push({
            y: -CHAR_H * len, chars,
            speedMul: 0.85 + Math.random() * 0.4,
            nextChange: 0.05 + Math.random() * 0.15,
            sinceChange: 0,
            goldIdx: Math.random() < 0.25 ? Math.floor(Math.random() * len) : -1,
          });
          col.spawnAccum = (spawnGap * 0.4) + Math.random() * spawnGap;
        }
        for (let i = col.drops.length - 1; i >= 0; i--) {
          const d = col.drops[i];
          d.y += fallSpeed * d.speedMul * dt;
          d.sinceChange += dt;
          if (d.sinceChange >= d.nextChange) {
            d.chars[Math.floor(Math.random() * d.chars.length)] = HEX_CHARS[Math.floor(Math.random() * 16)];
            d.sinceChange = 0;
            d.nextChange = 0.05 + Math.random() * 0.15;
          }
          if (d.isWinner !== undefined) d.winnerLife += dt;
          if (d.y > H + CHAR_H * d.chars.length) col.drops.splice(i, 1);
        }
      }

      ctx.fillStyle = 'rgba(20, 22, 26, 0.85)';
      ctx.fillRect(0, 0, W, H);
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';

      for (const col of canvas._columns) {
        for (const d of col.drops) {
          const len = d.chars.length;
          for (let i = 0; i < len; i++) {
            const charY = d.y + i * CHAR_H;
            if (charY < -CHAR_H || charY > H + CHAR_H) continue;
            const fromHead = (len - 1 - i) / len;
            let r, g, b, a;
            const isGold = d.isWinner || (d.goldIdx === i && d.y > 0);
            if (isGold) {
              const winnerFade = d.isWinner ? Math.max(0.6, 1 - d.winnerLife / 1.2) : 1;
              if (d.isBroadcast) { r = 255; g = 240; b = 180; }
              else { r = 255; g = 215; b = 90; }
              a = (i === len - 1 ? 1 : 0.7 - fromHead * 0.6) * winnerFade;
              if (!enabled) a *= 0.4;
              ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
              ctx.shadowBlur = 6;
            } else {
              const dim = enabled ? 1 : 0.5;
              if (i === len - 1) { r = 200; g = 215; b = 230; a = 0.85 * dim; }
              else { r = 110; g = 125; b = 145; a = (1 - fromHead * 0.85) * 0.55 * dim; }
              ctx.shadowBlur = 0;
            }
            ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
            // In Bitcoin mode, replace gold winner chars with ₿; non-winners stay hex
            const renderChar = (useBitcoinSymbols && isGold) ? '₿' : d.chars[i];
            ctx.fillText(renderChar, col.x, charY);
          }
        }
      }
      ctx.shadowBlur = 0;
    };

    // ─── Conveyor of Ore ──────────────────────────────────────
    const drawConveyor = (dt, W, H) => {
      if (!canvas._chunks) canvas._chunks = [];
      if (canvas._chunkAccum === undefined) canvas._chunkAccum = 0;
      if (canvas._timeAccum === undefined) canvas._timeAccum = 0;
      canvas._timeAccum += dt;

      const ths = enabled ? (ns.hashrate || 0) / 1e12 : 0;
      // Conveyor speed: 30 + 0.6 per TH/s
      const speed = enabled ? 30 + Math.min(150, ths * 0.6) : 12;
      // Chunks per sec: 0.6 + 0.08 per TH/s
      const chunkRate = enabled ? 0.6 + Math.min(8, ths * 0.08) : 0.2;

      canvas._chunkAccum += dt * chunkRate;
      while (canvas._chunkAccum >= 1) {
        canvas._chunkAccum -= 1;
        // Chunk size + how much gold it has (random)
        const isGoldRich = Math.random() < 0.35;
        canvas._chunks.push({
          x: -16,
          y: H * 0.55, // resting on the conveyor belt
          w: 12 + Math.random() * 10,
          h: 8 + Math.random() * 5,
          tilt: (Math.random() - 0.5) * 0.3,
          // Gold spots embedded in this chunk
          spots: Array.from({ length: isGoldRich ? 3 + Math.floor(Math.random() * 3) : Math.floor(Math.random() * 2) }, () => ({
            dx: (Math.random() - 0.5),
            dy: (Math.random() - 0.5),
            r: 0.6 + Math.random() * 1.2,
          })),
          rich: isGoldRich,
          big: false,
        });
      }

      spikesRef.current = spikesRef.current
        .map(s => ({ ...s, age: s.age + dt }))
        .filter(s => s.age < 0.3);
      for (const s of spikesRef.current) {
        if (s.age < dt * 1.5) {
          // Big nugget chunk — extra-rich gold
          canvas._chunks.push({
            x: -22, y: H * 0.55,
            w: 22, h: 14, tilt: (Math.random() - 0.5) * 0.2,
            spots: Array.from({ length: 6 }, () => ({
              dx: (Math.random() - 0.5), dy: (Math.random() - 0.5),
              r: 1 + Math.random() * 1.5,
            })),
            rich: true, big: true,
          });
        }
      }

      const chunks = canvas._chunks;
      for (let i = chunks.length - 1; i >= 0; i--) {
        chunks[i].x += speed * dt;
        if (chunks[i].x > W + 25) chunks.splice(i, 1);
      }

      ctx.fillStyle = 'rgba(20, 22, 26, 0.85)';
      ctx.fillRect(0, 0, W, H);

      // Conveyor belt — two horizontal rails with cross-segments scrolling
      const beltY = H * 0.7;
      ctx.strokeStyle = 'rgba(120, 90, 60, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, beltY); ctx.lineTo(W, beltY);
      ctx.moveTo(0, beltY + 6); ctx.lineTo(W, beltY + 6);
      ctx.stroke();

      // Belt segments scrolling at conveyor speed
      ctx.strokeStyle = 'rgba(160, 130, 90, 0.4)';
      const segSpacing = 10;
      const offset = (canvas._timeAccum * speed) % segSpacing;
      ctx.beginPath();
      for (let x = -segSpacing + offset; x < W; x += segSpacing) {
        ctx.moveTo(x, beltY); ctx.lineTo(x, beltY + 6);
      }
      ctx.stroke();

      // Render chunks
      for (const c of chunks) {
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(c.tilt);
        // Rock body
        const rockColor = c.rich ? 'rgba(95, 75, 50, 0.95)' : 'rgba(70, 65, 60, 0.95)';
        ctx.fillStyle = rockColor;
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        // Highlight edge
        ctx.strokeStyle = c.rich ? 'rgba(140, 110, 70, 0.9)' : 'rgba(100, 95, 90, 0.7)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-c.w / 2, -c.h / 2, c.w, c.h);
        // Gold spots
        const goldDim = enabled ? 1 : 0.5;
        for (const spot of c.spots) {
          ctx.fillStyle = c.big ? `rgba(255, 230, 130, ${0.95 * goldDim})` : `rgba(245, 180, 60, ${0.85 * goldDim})`;
          ctx.shadowColor = c.big ? 'rgba(255,230,130,0.9)' : 'rgba(245,180,60,0.6)';
          ctx.shadowBlur = c.big ? 6 : 3;
          if (useBitcoinSymbols) {
            // Render gold spots as tiny ₿ glyphs
            const fontPx = Math.max(7, Math.round(4 + spot.r * 3));
            ctx.font = `${fontPx}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('₿', spot.dx * c.w * 0.4, spot.dy * c.h * 0.4);
          } else {
            ctx.beginPath();
            ctx.arc(spot.dx * c.w * 0.4, spot.dy * c.h * 0.4, spot.r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.shadowBlur = 0;
        ctx.restore();
      }
    };

    // ─── Forge Embers ─────────────────────────────────────────
    const drawEmbers = (dt, W, H) => {
      if (!canvas._embers) canvas._embers = [];
      if (canvas._emberAccum === undefined) canvas._emberAccum = 0;
      if (canvas._timeAccum === undefined) canvas._timeAccum = 0;
      canvas._timeAccum += dt;

      const ths = enabled ? (ns.hashrate || 0) / 1e12 : 0;
      // Embers per sec: 1 + 0.18 per TH/s
      const rate = enabled ? 1 + Math.min(18, ths * 0.18) : 0.4;

      canvas._emberAccum += dt * rate;
      while (canvas._emberAccum >= 1) {
        canvas._emberAccum -= 1;
        canvas._embers.push({
          x: 4 + Math.random() * (W - 8),
          y: H + 2,
          // Upward velocity with subtle drift
          vy: -(20 + Math.random() * 25),
          vx: (Math.random() - 0.5) * 14,
          size: 0.6 + Math.random() * 1.4,
          shade: Math.random(),
          life: 0,
          maxLife: 1.2 + Math.random() * 1.0,
          big: false,
        });
      }

      spikesRef.current = spikesRef.current
        .map(s => ({ ...s, age: s.age + dt }))
        .filter(s => s.age < 0.3);
      for (const s of spikesRef.current) {
        if (s.age < dt * 1.5) {
          // Big ember burst — like dropping fresh coal on the forge
          for (let i = 0; i < 14; i++) {
            canvas._embers.push({
              x: 4 + Math.random() * (W - 8),
              y: H - Math.random() * 6,
              vy: -(35 + Math.random() * 30),
              vx: (Math.random() - 0.5) * 30,
              size: 1.2 + Math.random() * 1.5,
              shade: 0.7 + Math.random() * 0.3,
              life: 0,
              maxLife: 1.5 + Math.random() * 0.8,
              big: true,
            });
          }
        }
      }

      const embers = canvas._embers;
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.life += dt;
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        // Slight upward acceleration (heat rises)
        e.vy -= 6 * dt;
        // Horizontal drift settles
        e.vx *= 0.985;
        if (e.life > e.maxLife || e.y < -5) embers.splice(i, 1);
      }

      // Dark forge background with subtle warm gradient at bottom
      ctx.fillStyle = 'rgba(16, 14, 12, 0.9)';
      ctx.fillRect(0, 0, W, H);
      // Glowing forge floor at bottom edge
      const grad = ctx.createLinearGradient(0, H - 12, 0, H);
      grad.addColorStop(0, 'rgba(60, 30, 10, 0)');
      grad.addColorStop(1, enabled ? 'rgba(150, 70, 20, 0.4)' : 'rgba(80, 40, 15, 0.2)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, H - 12, W, 12);

      // Render embers
      for (const e of embers) {
        const t = e.life / e.maxLife;
        // Brightness fades over lifetime
        let alpha;
        if (t < 0.1) alpha = t / 0.1;
        else alpha = (1 - t);
        if (!enabled) alpha *= 0.5;

        // Color shift: hot orange → cooler red-amber as it ages
        const hot = 1 - t;
        const r = e.big ? 255 : Math.round(245 + e.shade * 10);
        const g = Math.round((e.big ? 170 : 120) * hot + (e.big ? 80 : 50) * t);
        const b = Math.round(20 + e.shade * 30 * hot);

        ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.shadowColor = `rgba(${r},${g + 40},${b + 30},${alpha * 0.9})`;
        ctx.shadowBlur = e.big ? 8 : 5;
        if (useBitcoinSymbols) {
          const fontPx = Math.max(8, Math.round(5 + e.size * 2.5));
          ctx.font = `${fontPx}px "JetBrains Mono", monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('₿', e.x, e.y);
        } else {
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.shadowBlur = 0;
    };

    // ─── Master draw — picks the right one ────────────────────
    const draw = (now) => {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;
      const W = canvasWidthRef.current;
      const H = canvasHeightRef.current;
      if (!W || !H) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }
      ctx.clearRect(0, 0, W, H);
      if (pulseAnim === 'sluice') drawSluice(dt, W, H);
      else if (pulseAnim === 'glimmers') drawGlimmers(dt, W, H);
      else if (pulseAnim === 'conveyor') drawConveyor(dt, W, H);
      else if (pulseAnim === 'embers') drawEmbers(dt, W, H);
      else drawTicker(dt, W, H); // default 'ticker'
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    animationFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [enabled, ns.hashrate, pulseAnim, useBitcoinSymbols]);







  // Trigger an emphasis bump when broadcast values change (i.e. a real event)
  useEffect(() => {
    const last = lastBroadcastRef.current;
    const isFirstRun = last.pools === undefined && last.hashrate === undefined && last.workers === undefined;
    if (!isFirstRun && enabled) {
      const hashrateChanged = last.hashrate !== ns.hashrate;
      const poolsChanged   = last.pools !== ns.pools;
      const workersChanged  = last.workers !== ns.workers;
      if (hashrateChanged || poolsChanged || workersChanged) {
        spikesRef.current.push({ intensity: 1.0, age: 0 });
      }
    }
    lastBroadcastRef.current = { hashrate: ns.hashrate, pools: ns.pools, workers: ns.workers };
  }, [ns.hashrate, ns.pools, ns.workers, enabled]);

  // Bottom-right "100% SOLO" stamp — rotated, amber, glowing
  // iter27c: bumped up from 0.2rem to 0.6rem so it's no longer clipped
  // at the card's bottom edge on mobile.
  const StampSolo = () => (
    <div style={{
      position:'absolute', right:'0.5rem', bottom:'0.6rem',
      transform:'rotate(-12deg)',
      fontFamily:'var(--fd)', fontSize:'0.55rem', fontWeight:800,
      letterSpacing:'0.18em', textTransform:'uppercase',
      color:'rgba(245,166,35,0.65)',
      border:'2px solid rgba(245,166,35,0.5)',
      padding:'3px 8px',
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
    compact ? (
      <div style={{position:'relative'}}>
        <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)', marginBottom:'0.4rem'}}>
          <span>▸ SoloStrike Pulse</span>
          <span style={{display:'inline-flex', alignItems:'center', gap:5, fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.15em', color:'var(--green)', textShadow:'0 0 6px var(--green)', marginRight:14}}>
            <span style={{width:5, height:5, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 6px var(--green)', animation:'pulse 2s ease-in-out infinite'}}/>
            LIVE
          </span>
        </div>
        <div
          onClick={onOpenStrikers}
          role={onOpenStrikers ? 'button' : undefined}
          tabIndex={onOpenStrikers ? 0 : undefined}
          onKeyDown={onOpenStrikers ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStrikers(); } } : undefined}
          style={{ cursor: onOpenStrikers ? 'pointer' : 'default' }}
          title={onOpenStrikers ? 'Tap to view all Strikers' : undefined}
        >
        {/* Smaller waveform for embedded mode */}
        <div ref={containerRef} style={{
          width:'100%', height:88,
          background:'linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(245,166,35,0.02) 100%)',
          border:'1px solid var(--border)',
          marginBottom:'0.6rem',
          position:'relative', overflow:'hidden',
        }}>

          <canvas ref={canvasRef} style={{display:'block', width:'100%', height:'100%'}}/>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '0.6rem' }}>
          <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.6rem 0.35rem', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Pools</div>
            <div style={{ fontFamily: 'var(--fd)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1, textShadow: '0 0 14px rgba(245,166,35,0.4)' }}>{ns.pools || 0}</div>
          </div>
          <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.6rem 0.35rem', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Hashrate</div>
            <div style={{ fontFamily: 'var(--fd)', fontSize: '1rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1 }}>{fmtPulseHr(ns.hashrate)}</div>
          </div>
          <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.6rem 0.35rem', textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--fd)', fontSize: '0.5rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 }}>Miners</div>
            <div style={{ fontFamily: 'var(--fd)', fontSize: '1.5rem', fontWeight: 700, color: 'var(--amber)', lineHeight: 1, textShadow: '0 0 14px rgba(245,166,35,0.4)' }}>{ns.workers || 0}</div>
          </div>
        </div>

        {/* Footer tagline — single line in compact, leave room for stamp on right */}
        <div style={{
          borderTop:'1px dashed rgba(245,166,35,0.18)',
          paddingTop:'0.4rem',
          fontFamily:'var(--fm)', fontSize:'0.55rem', color:'var(--text-2)',
          lineHeight:1.4, paddingRight:'4rem',
        }}>
          <span style={{color:'var(--amber)', fontWeight:600}}>100% SOLO ·</span> Your blocks stay yours.
          {onOpenStrikers && (ns.peers && ns.peers.length > 0) && (
            <span style={{marginLeft:6, color:'var(--amber)', fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em'}}>▸ TAP STRIKERS</span>
          )}
        </div>
        </div>
        <StampSolo/>
      </div>
    ) : (
    <div style={{...card, position:'relative', minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)'}}>
        <span>▸ SoloStrike Pulse</span>
        <span style={{display:'inline-flex', alignItems:'center', gap:5, fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.15em', color:'var(--green)', textShadow:'0 0 6px var(--green)', marginRight:14}}>
          <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 6px var(--green)', animation:'pulse 2s ease-in-out infinite'}}/>
          LIVE
        </span>
      </div>

      {/* Clickable region — whole body opens Strikers modal */}
      <div
        onClick={onOpenStrikers}
        role={onOpenStrikers ? 'button' : undefined}
        tabIndex={onOpenStrikers ? 0 : undefined}
        onKeyDown={onOpenStrikers ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStrikers(); } } : undefined}
        style={{ cursor: onOpenStrikers ? 'pointer' : 'default' }}
        title={onOpenStrikers ? 'Tap to view all Strikers' : undefined}
      >
      {/* The heartbeat waveform itself */}
      <div ref={containerRef} style={{
        width:'100%', height:160,
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
        {onOpenStrikers && (ns.peers && ns.peers.length > 0) && (
          <span style={{display:'block', marginTop:4, color:'var(--amber)', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em'}}>▸ TAP TO SEE STRIKERS</span>
        )}
      </div>
      </div>
      <StampSolo/>
    </div>
    )
  );
}

// ── HashPulse — Combined Firepower + Pulse card (v1.7.20) ───────────────────
// One card that stacks the Firepower (live hashrate) section on top and the
// SoloStrike Pulse (network census) section beneath it. Both sections use
// their existing components in `compact` mode — they skip their outer card
// wrapper and shrink chart heights / font sizes so they fit together in one
// carousel slot without scrolling.
//
// Section names ("FIREPOWER — LIVE" and "SOLOSTRIKE PULSE") are preserved
// from the standalone cards so users still recognize what they're looking at.
// PulsePanel in compact mode renders its own 100% SOLO stamp internally.
function HashPulsePanel({ history, week, current, networkStats, onOpenSettings, onOpenStrikers, pulseAnim, onPulseAnimChange }) {
  return (
    <div style={{...card, position:'relative', minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      {/* Firepower section */}
      <HashrateChart history={history} week={week} current={current} compact />

      {/* Divider between sections */}
      <div style={{
        height:1, background:'linear-gradient(90deg, transparent, rgba(245,166,35,0.25), transparent)',
        margin:'0.7rem 0',
      }}/>

      {/* Pulse section — renders its own StampSolo internally in compact mode */}
      <PulsePanel networkStats={networkStats} onOpenSettings={onOpenSettings} onOpenStrikers={onOpenStrikers} pulseAnim={pulseAnim} onPulseAnimChange={onPulseAnimChange} compact />
    </div>
  );
}

// ── Jumpers — Combined Claim Jumpers + Gold Strikes card (v1.7.22) ──────────
// Stacks Claim Jumpers (top — pool find counts) with Gold Strikes (bottom —
// our own found blocks). Both sections render compact (no outer card wrapper,
// smaller padding/font, internal scroll caps). Section names preserved.
function JumpersPanel({ topFinders, netBlocks, blocks, blockAlert }) {
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden'}} className="fade-in">
      {/* Claim Jumpers section (top) */}
      <TopFindersPanel topFinders={topFinders} netBlocks={netBlocks} compact />

      {/* Divider */}
      <div style={{
        height:1, background:'linear-gradient(90deg, transparent, rgba(245,166,35,0.25), transparent)',
        margin:'0.7rem 0',
      }}/>

      {/* Gold Strikes section (bottom) */}
      <BlockFeed blocks={blocks} blockAlert={blockAlert} compact />
    </div>
  );
}


// Shows every Striker (anonymous SoloStrike operator) currently on the network.
// You're pinned at the top, then everyone else by hashrate descending.
// Outlier-filtered peers hidden by default; toggle reveals them.
function StrikersModal({ networkStats, onClose }) {
  const [showFiltered, setShowFiltered] = useState(false);

  const ns = networkStats || {};
  const allPeers = Array.isArray(ns.peers) ? ns.peers : [];
  const ownPubkey = ns.ownPubkey || '';

  const ownPeer = allPeers.find(p => p.isOwn || p.pubkey === ownPubkey) || null;
  const others = allPeers.filter(p => p !== ownPeer);
  const visibleOthers = showFiltered ? others : others.filter(p => !p.filtered);
  const filteredCount = others.filter(p => p.filtered).length;

  const shownPeers = ownPeer ? [ownPeer, ...visibleOthers] : visibleOthers;
  const dispHash = shownPeers.reduce((s, p) => s + p.hashrate, 0);
  const dispWorkers = shownPeers.reduce((s, p) => s + p.workers, 0);
  const dispCount = shownPeers.length;

  const fmtAgo = (sec) => {
    if (!sec || sec < 60) return 'now';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    return Math.floor(sec / 3600) + 'h ago';
  };

  const section = { marginBottom:'1rem' };
  const secTitle = { fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--amber)', marginBottom:'0.5rem' };
  const heroBox = { background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.7rem', textAlign:'center' };
  const heroLbl = { fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:4 };
  const heroVal = { fontFamily:'var(--fd)', fontSize:'1.1rem', fontWeight:700, lineHeight:1, color:'var(--amber)' };

  // Single row component — handles both "you" (highlighted gold treatment)
  // and other Strikers (standard treatment) via the p.isOwn flag.
  const Row = ({ p, idx }) => {
  const isOwn = !!p.isOwn;
    return (
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding: isOwn ? '0.7rem 0.8rem' : '0.6rem 0.8rem',
        background: isOwn ? 'rgba(245,166,35,0.08)' : 'var(--bg-raised)',
        border: isOwn ? '1px solid var(--amber)' : '1px solid var(--border)',
        boxShadow: isOwn ? '0 0 12px rgba(245,166,35,0.2)' : 'none',
        marginBottom: isOwn ? '0.5rem' : '0.35rem',
        opacity: p.filtered && !isOwn ? 0.55 : 1,
      }}>
        <div style={{display:'flex', flexDirection:'column', gap:3, minWidth:0, flex:'1 1 auto'}}>
          <div style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
            <span style={{
              fontFamily:'var(--fd)',
              fontSize:'0.78rem',
              fontWeight:700,
              color: isOwn ? 'var(--amber)' : 'var(--text-1)',
              letterSpacing:'0.08em',
            }}>
              {isOwn ? 'YOU' : `STRIKER ${String(idx + 1).padStart(2, '0')}`}
            </span>
            {p.filtered && !isOwn && (
              <span style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-2)', letterSpacing:'0.12em', background:'rgba(255,255,255,0.05)', border:'1px solid var(--border)', padding:'1px 6px'}}>FILTERED</span>
            )}
          </div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-2)'}}>
            {p.workers} worker{p.workers===1?'':'s'} · v{p.version || '?'}
          </div>
        </div>
        <div style={{textAlign:'right', flexShrink:0}}>
          <div style={{
            fontFamily:'var(--fd)',
            fontSize: isOwn ? '1.05rem' : '1rem',
            fontWeight:700,
            color: (p.filtered && !isOwn) ? 'var(--text-2)' : 'var(--amber)',
            lineHeight:1,
          }}>
            {fmtPulseHr(p.hashrate)}
          </div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-2)', marginTop:3}}>
            {fmtAgo(p.lastSeenAgoSec)}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:250,padding:'calc(env(safe-area-inset-top) + 1rem) 0.75rem 0.75rem',overflowY:'auto'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:560,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',boxShadow:'var(--glow-a)',maxHeight:'calc(100dvh - 4rem)',overflowY:'auto',position:'relative'}}>
        <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
            <span style={{fontSize:16,color:'var(--amber)'}}>📡</span>
            <span style={{fontFamily:'var(--fd)',fontSize:'1rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.05em'}}>Pulse Strikers</span>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:22,padding:'0 4px'}}>✕</button>
        </div>

        <div style={{padding:'1rem 1.25rem 4.5rem 1.25rem'}}>

          <div style={section}>
            <div style={secTitle}>▸ Network Snapshot</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'0.5rem'}}>
              <div style={heroBox}><div style={heroLbl}>Strikers</div><div style={heroVal}>{dispCount}</div></div>
              <div style={heroBox}><div style={heroLbl}>Hashrate</div><div style={{...heroVal, fontSize:'0.95rem'}}>{fmtPulseHr(dispHash)}</div></div>
              <div style={heroBox}><div style={heroLbl}>Miners</div><div style={heroVal}>{dispWorkers}</div></div>
            </div>
          </div>

          <div style={section}>
            <div style={{...secTitle, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
              <span>▸ Roster</span>
              {filteredCount > 0 && (
                <button
                  onClick={() => setShowFiltered(v => !v)}
                  style={{
                    background:'none',
                    border:'1px solid var(--border)',
                    color:showFiltered ? 'var(--amber)' : 'var(--text-2)',
                    fontFamily:'var(--fd)',
                    fontSize:'0.55rem',
                    letterSpacing:'0.12em',
                    padding:'4px 10px',
                    cursor:'pointer',
                    textTransform:'uppercase',
                    transition:'color 0.1s, border-color 0.1s',
                    borderColor: showFiltered ? 'var(--amber)' : 'var(--border)',
                  }}
                >
                  {showFiltered ? '◉ HIDE FILTERED' : `◯ SHOW ${filteredCount} FILTERED`}
                </button>
              )}
            </div>

            {shownPeers.length === 0 && (
              <div style={{textAlign:'center', padding:'1.25rem 0.5rem', color:'var(--text-2)', fontFamily:'var(--fm)', fontSize:'0.75rem'}}>
                No Strikers visible yet. The first broadcast cycle takes a few minutes after Pulse goes live.
              </div>
            )}

            {shownPeers.map((p, i) => (
              <Row key={p.pubkey} p={p} idx={i}/>
            ))}

          </div>

          <div style={{
            borderTop:'1px dashed rgba(245,166,35,0.18)',
            paddingTop:'0.7rem',
            fontFamily:'var(--fm)', fontSize:'0.75rem', color:'var(--text-1)',
            lineHeight:1.5,
            paddingRight:'5rem',
          }}>
            Pulse is a census, not a pool. <span style={{color:'var(--amber)', fontWeight:600}}>Your blocks stay 100% yours.</span>
            <div style={{marginTop:8, fontSize:'0.68rem', color:'var(--text-2)', lineHeight:1.5}}>
              Strikers are anonymous SoloStrike operators broadcasting hashrate via nostr. No names, no IPs, no pool — just a heartbeat. Identities rotate every 90 days.
            </div>
          </div>


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

        </div>
      </div>
    </div>
  );
}

// ── ReckoningModal — Strike Forecast simulator (v1.7.6) ───────────────────
// "The Reckoning" — drill-down from the Strike Odds card. Lets the user
// see when their next strike is statistically likely, slide their hashrate
// to simulate hardware additions, and visualize the probability curve.
//
// Math primer: solo block-finding is a Bernoulli trial with per-block
// probability p = yourHash / netHash. Probability of >=1 strike over N
// blocks is 1 - (1-p)^N. Inverting:
//   blocks-to-X-percent = log(1-X) / log(1-p)
// Bitcoin produces 1 block per 10 minutes on average, so:
//   days-to-X-percent = (blocks * 10) / (60 * 24)
function ReckoningModal({ poolState, currency, onClose }) {
  const baseHash = poolState?.hashrate?.current || 0;
  const netHash = poolState?.network?.hashrate || 0;
// blockReward is an object { subsidyBtc, feesBtc, totalBtc, totalSats } — use totalBtc
  const blockReward = poolState?.blockReward?.totalBtc || 3.125; // BTC
  const prices = poolState?.prices || {};
  const fiatPrice = prices[currency] || prices.USD || 0;

  // Slider state — multiplier on baseHash. 1.0 = current. Range 0.1x to 10x.
  // Default to current (1.0).
  const [hashMult, setHashMult] = useState(1.0);

  // The Burn — power cost inputs (v1.7.7). Persist across modal reopens via
  // localStorage so testers don't re-enter their kWh rate every session.
  const [burnWatts, setBurnWatts] = useState(() => {
    try { const s = localStorage.getItem('ss_burn_watts_v1'); return s ? parseFloat(s) : 0; } catch { return 0; }
  });
  const [burnRate, setBurnRate] = useState(() => {
    try { const s = localStorage.getItem('ss_burn_kwh_v1'); return s ? parseFloat(s) : 0.12; } catch { return 0.12; }
  });
  useEffect(() => {
    try { localStorage.setItem('ss_burn_watts_v1', String(burnWatts || 0)); } catch {}
  }, [burnWatts]);
  useEffect(() => {
    try { localStorage.setItem('ss_burn_kwh_v1', String(burnRate || 0)); } catch {}
  }, [burnRate]);

  // Reset slider whenever the modal reopens or baseHash changes meaningfully
  useEffect(() => { setHashMult(1.0); }, [baseHash]);

  const simHash = baseHash * hashMult;
  const haveData = baseHash > 0 && netHash > 0;

  // ── Probability core ──
  // p = per-block strike probability at simulated hashrate
  const p = haveData ? Math.min(1, simHash / netHash) : 0;
  // Days until cumulative probability of strike reaches X
  const daysToX = (x) => {
    if (!haveData || p <= 0) return null;
    if (x >= 1) return null;
    // log(1-x) / log(1-p) = blocks. * 10 min / (60*24) = days
    const blocks = Math.log(1 - x) / Math.log(1 - p);
    return blocks * 10 / (60 * 24);
  };

  const horizon = {
    p25: daysToX(0.25),
    p50: daysToX(0.50),
    p75: daysToX(0.75),
    p90: daysToX(0.90),
  };

  // Daily / weekly / monthly strike chance at simulated hashrate
  const blocksPerDay = 144;
  const blocksPerWeek = 144 * 7;
  const blocksPerMonth = 144 * 30;
  const probDay = haveData ? 1 - Math.pow(1 - p, blocksPerDay) : 0;
  const probWeek = haveData ? 1 - Math.pow(1 - p, blocksPerWeek) : 0;
  const probMonth = haveData ? 1 - Math.pow(1 - p, blocksPerMonth) : 0;

  // Baseline (current hashrate) 50% horizon — for the "moves from X → Y" hint
  const baseP = haveData ? Math.min(1, baseHash / netHash) : 0;
  const baselineP50 = (haveData && baseP > 0 && baseP < 1)
    ? (Math.log(0.5) / Math.log(1 - baseP)) * 10 / (60 * 24)
    : null;

  // Reward calc — block subsidy + ~0.1 BTC fees average
  const rewardBtc = blockReward;
  const rewardFiat = rewardBtc * fiatPrice;

  // Pool share (your slice of total network)
  const poolSharePct = haveData ? (simHash / netHash) * 100 : 0;
  const basePoolSharePct = haveData ? (baseHash / netHash) * 100 : 0;

  // ── Network rank from Pulse data ──
  const peers = poolState?.networkStats?.peers || [];
  const ownPubkey = poolState?.networkStats?.ownPubkey || '';
  const peersSorted = [...peers].filter(p => !p.filtered).sort((a, b) => b.hashrate - a.hashrate);
  const myRank = peersSorted.findIndex(p => p.isOwn || p.pubkey === ownPubkey);
  const totalPeers = peersSorted.length;

  // ── Helpers ──
  const fmtDays = (d) => {
    if (d == null || !isFinite(d)) return '—';
    if (d < 1) return Math.round(d * 24) + 'h';
    if (d < 365) return Math.round(d) + 'd';
    if (d < 365 * 10) return (d / 365).toFixed(1) + 'y';
    return Math.round(d / 365) + 'y';
  };
  const fmtDate = (d) => {
    if (d == null || !isFinite(d)) return '—';
    const ms = Date.now() + d * 86400 * 1000;
    const dt = new Date(ms);
    return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  };
  const fmtPctSafe = (v, digits = 2) => {
    if (!isFinite(v) || v <= 0) return '—';
    if (v < 0.01) return v.toExponential(2) + '%';
    return v.toFixed(digits) + '%';
  };

  // ── The Burn — power cost computations (v1.7.7) ──
  // Required: simHash > 0, baseP > 0 (have data), burnWatts > 0, burnRate > 0
  // Otherwise we hide the Burn section entirely (no point showing zeros).
  const wattsNum = parseFloat(burnWatts) || 0;
  const rateNum  = parseFloat(burnRate)  || 0;
  const haveBurn = haveData && wattsNum > 0 && rateNum > 0 && fiatPrice > 0;

  // Daily/monthly cost regardless of strikes — pure electricity bill
  const kwhPerDay     = (wattsNum * 24) / 1000;
  const costPerDay    = kwhPerDay * rateNum;
  const costPerMonth  = costPerDay * 30;
  const costPerYear   = costPerDay * 365;

  // Cost over the 50% horizon (median time-to-strike)
  const costToP50  = horizon.p50 != null ? costPerDay * horizon.p50 : null;
  const netP50     = (costToP50 != null) ? rewardFiat - costToP50 : null;

  // Break-even electricity rate — at what $/kWh does a single strike just
  // pay for the electricity used on the way to it (50% horizon)?
  const kwhTotalP50  = horizon.p50 != null ? kwhPerDay * horizon.p50 : null;
  const breakEvenRate = (kwhTotalP50 != null && kwhTotalP50 > 0) ? rewardFiat / kwhTotalP50 : null;

  // Slider math — log scale from 0.1x to 10x, mapped to 0–100 control range
  const sliderMin = 0.1, sliderMax = 10;
  const logMin = Math.log(sliderMin), logMax = Math.log(sliderMax);
  const sliderToMult = (s) => Math.exp(logMin + (s / 100) * (logMax - logMin));
  const multToSlider = (m) => ((Math.log(m) - logMin) / (logMax - logMin)) * 100;

  // Style tokens — match Strikers modal readability standards
  const section = { marginBottom: '1rem' };
  const secTitle = { fontFamily: 'var(--fd)', fontSize: '0.6rem', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--amber)', marginBottom: '0.55rem' };
  const heroBox = { background: 'var(--bg-raised)', border: '1px solid var(--border)', padding: '0.7rem', textAlign: 'center' };
  const heroLbl = { fontFamily: 'var(--fd)', fontSize: '0.55rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-2)', marginBottom: 4 };
  const heroVal = { fontFamily: 'var(--fd)', fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.1, color: 'var(--amber)' };

  // Horizon row component — one milestone in the timeline
  const HorizonRow = ({ pct, days, label, accent }) => {
    const visualBar = days != null && isFinite(days) && horizon.p90 ? Math.min(100, (days / horizon.p90) * 100) : 0;
    return (
      <div style={{ marginBottom: '0.65rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <span style={{ fontFamily: 'var(--fd)', fontSize: '0.78rem', fontWeight: 700, color: accent || 'var(--text-1)', letterSpacing: '0.05em' }}>
            {label} <span style={{ fontFamily: 'var(--fm)', fontSize: '0.65rem', color: 'var(--text-2)', fontWeight: 400, letterSpacing: 0 }}>({pct}% chance)</span>
          </span>
          <span style={{ fontFamily: 'var(--fd)', fontSize: '0.85rem', fontWeight: 700, color: accent || 'var(--text-1)' }}>
            {fmtDays(days)}
          </span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-deep)', border: '1px solid var(--border)', overflow: 'hidden', position: 'relative' }}>
          <div style={{
            width: `${visualBar}%`,
            height: '100%',
            background: accent === 'var(--amber)'
              ? 'linear-gradient(90deg, rgba(245,166,35,0.4), var(--amber))'
              : 'linear-gradient(90deg, rgba(245,166,35,0.2), rgba(245,166,35,0.6))',
            transition: 'width 0.4s ease',
          }} />
        </div>
        <div style={{ fontFamily: 'var(--fm)', fontSize: '0.65rem', color: 'var(--text-2)', marginTop: 3 }}>
          by {fmtDate(days)}
        </div>
      </div>
    );
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:250,padding:'calc(env(safe-area-inset-top) + 1rem) 0.75rem 0.75rem',overflowY:'auto'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:600,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',boxShadow:'var(--glow-a)',maxHeight:'calc(100dvh - 4rem)',overflowY:'auto',position:'relative'}}>
        <div style={{padding:'1rem 1.25rem',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
            <span style={{fontSize:18,color:'var(--amber)'}}>⚡</span>
            <span style={{fontFamily:'var(--fd)',fontSize:'1.05rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.05em'}}>The Reckoning</span>
          </div>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:22,padding:'0 4px'}}>✕</button>
        </div>

        <div style={{padding:'1rem 1.25rem 4.5rem 1.25rem'}}>

          {!haveData && (
            <div style={{textAlign:'center', padding:'2rem 1rem', color:'var(--text-2)', fontFamily:'var(--fm)', fontSize:'0.85rem'}}>
              The Reckoning needs your hashrate and the current network hashrate to forecast your strike. Waiting for first data…
            </div>
          )}

          {haveData && (
            <>
              {/* The "if you struck right now" hero */}
              <div style={section}>
                <div style={secTitle}>▸ If You Struck Right Now</div>
                <div style={{
                  background:'linear-gradient(135deg, rgba(245,166,35,0.08) 0%, rgba(245,166,35,0.02) 100%)',
                  border:'1px solid var(--amber)',
                  boxShadow:'0 0 14px rgba(245,166,35,0.18)',
                  padding:'1rem',
                  textAlign:'center',
                }}>
                  <div style={{ fontFamily:'var(--fd)', fontSize:'2rem', fontWeight:800, color:'var(--amber)', lineHeight:1.1, textShadow:'0 0 12px rgba(245,166,35,0.5)' }}>
                    {rewardBtc.toFixed(3)} <span style={{fontSize:'1rem'}}>BTC</span>
                  </div>
                  {fiatPrice > 0 && (
                    <div style={{ fontFamily:'var(--fd)', fontSize:'1.15rem', fontWeight:700, color:'var(--text-1)', marginTop:5 }}>
                      ≈ {fmtFiat(rewardFiat, currency)}
                    </div>
                  )}
                  <div style={{ fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-2)', marginTop:6, lineHeight:1.5 }}>
                    Block subsidy at current height. <span style={{color:'var(--amber)'}}>100% yours.</span>
                  </div>
                </div>
              </div>

              {/* Hashrate slider — the simulator */}
              <div style={section}>
                <div style={{...secTitle, display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                  <span>▸ Firepower Simulator</span>
                  <span style={{fontFamily:'var(--fd)', fontSize:'0.65rem', color: hashMult === 1 ? 'var(--text-2)' : 'var(--amber)', fontWeight:700, letterSpacing:'0.05em'}}>
                    {hashMult.toFixed(2)}× current
                  </span>
                </div>
                <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.85rem 1rem'}}>
                  <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8}}>
                    <span style={{fontFamily:'var(--fd)', fontSize:'0.7rem', color:'var(--text-2)', letterSpacing:'0.08em'}}>SIMULATED HASHRATE</span>
                    <span style={{fontFamily:'var(--fd)', fontSize:'1.1rem', fontWeight:700, color:'var(--amber)'}}>{fmtHr(simHash)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="0.5"
                    value={multToSlider(hashMult)}
                    onChange={(e) => setHashMult(sliderToMult(parseFloat(e.target.value)))}
                    style={{
                      width:'100%',
                      accentColor:'var(--amber)',
                      cursor:'pointer',
                      height: 6,
                    }}
                  />
                  <div style={{display:'flex', justifyContent:'space-between', fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-2)', marginTop:4}}>
                    <span>0.1× ({fmtHr(baseHash * 0.1)})</span>
                    <button
                      onClick={() => setHashMult(1.0)}
                      style={{
                        background:'none',
                        border:'1px solid var(--border)',
                        color: hashMult === 1 ? 'var(--amber)' : 'var(--text-2)',
                        fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em',
                        padding:'2px 8px', cursor:'pointer', textTransform:'uppercase',
                        borderColor: hashMult === 1 ? 'var(--amber)' : 'var(--border)',
                      }}>
                      RESET
                    </button>
                    <span>10× ({fmtHr(baseHash * 10)})</span>
                  </div>
                  {hashMult !== 1.0 && (
                    <div style={{
                      marginTop:'0.55rem',
                      paddingTop:'0.55rem',
                      borderTop:'1px dashed rgba(245,166,35,0.18)',
                      fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-1)',
                      textAlign:'center', lineHeight:1.5,
                    }}>
                      {simHash > baseHash ? 'Adding ' : 'Removing '}
                      <span style={{color:'var(--amber)', fontWeight:600}}>{fmtHr(Math.abs(simHash - baseHash))}</span> moves your strike horizon from
                      <span style={{color:'var(--text-2)'}}> {fmtDays(baselineP50)}</span>
                      <span style={{color:'var(--text-2)'}}> → </span>
                      <span style={{color: simHash > baseHash ? 'var(--amber)' : 'var(--text-1)', fontWeight:700}}>{fmtDays(horizon.p50)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* The horizon — probability waterfall */}
              <div style={section}>
                <div style={secTitle}>▸ Strike Horizon</div>
                <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.9rem 1rem' }}>
                  <HorizonRow pct={25} days={horizon.p25} label="First strike likely" accent="var(--text-1)"/>
                  <HorizonRow pct={50} days={horizon.p50} label="Coin flip" accent="var(--amber)"/>
                  <HorizonRow pct={75} days={horizon.p75} label="Probably struck" accent="var(--text-1)"/>
                  <HorizonRow pct={90} days={horizon.p90} label="Almost certain" accent="var(--text-1)"/>
                </div>
                <div style={{ marginTop:'0.55rem', fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-2)', lineHeight:1.5 }}>
                  Each bar shows how long until your cumulative strike probability reaches that mark, at the simulated hashrate. The 50% line is your "expected" strike — half of all installs at this hashrate would have struck by then.
                </div>
              </div>

              {/* Short-term probabilities */}
              <div style={section}>
                <div style={secTitle}>▸ Short-Term Strike Chance</div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.55rem'}}>
                  <div style={heroBox}>
                    <div style={heroLbl}>This Day</div>
                    <div style={{...heroVal, fontSize: probDay >= 0.01 ? '1.05rem' : '0.85rem'}}>{fmtPctSafe(probDay * 100, 4)}</div>
                  </div>
                  <div style={heroBox}>
                    <div style={heroLbl}>This Week</div>
                    <div style={{...heroVal, fontSize: probWeek >= 0.01 ? '1.05rem' : '0.85rem'}}>{fmtPctSafe(probWeek * 100, 3)}</div>
                  </div>
                  <div style={heroBox}>
                    <div style={heroLbl}>This Month</div>
                    <div style={{...heroVal, fontSize: probMonth >= 0.01 ? '1.05rem' : '0.85rem'}}>{fmtPctSafe(probMonth * 100, 2)}</div>
                  </div>
                </div>
              </div>

             {/* Your slice of the entire Bitcoin network */}
              {haveData && (
                <div style={section}>
                  <div style={secTitle}>▸ Your Slice</div>
                  <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.85rem 1rem' }}>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8}}>
                      <span style={{fontFamily:'var(--fd)', fontSize:'0.78rem', fontWeight:700, color:'var(--text-1)', letterSpacing:'0.05em'}}>
                        Of the global Bitcoin network
                      </span>
                      <span style={{fontFamily:'var(--fd)', fontSize:'1rem', fontWeight:700, color:'var(--amber)'}}>
                        1 in {(netHash / baseHash).toLocaleString(undefined, {maximumFractionDigits:0})}
                      </span>
                    </div>
                    <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-1)', lineHeight:1.5}}>
                      Your <span style={{color:'var(--amber)', fontWeight:600}}>{fmtHr(baseHash)}</span> is{' '}
                      <span style={{color:'var(--amber)', fontWeight:600}}>
                        {basePoolSharePct >= 0.0001 ? basePoolSharePct.toFixed(6) + '%' : basePoolSharePct.toExponential(2) + '%'}
                      </span>{' '}
                      of all Bitcoin hashrate worldwide ({fmtHr(netHash)}). Every block, you're one of <span style={{color:'var(--amber)', fontWeight:600}}>{(netHash / baseHash).toLocaleString(undefined, {maximumFractionDigits:0})}</span> tickets in the lottery — and yours pays the full <span style={{color:'var(--amber)', fontWeight:600}}>{rewardBtc.toFixed(3)} BTC</span> if it wins.
                    </div>
                  </div>
                </div>
              )}


              {/* ── The Burn — power cost integration (v1.7.7) ── */}
              <div style={section}>
                <div style={{...secTitle, display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                  <span>▸ The Burn</span>
                  {haveBurn && netP50 != null && (
                    <span style={{
                      fontFamily:'var(--fd)', fontSize:'0.65rem', fontWeight:700,
                      color: netP50 >= 0 ? 'var(--green)' : 'var(--red)',
                      letterSpacing:'0.05em',
                    }}>
                      {netP50 >= 0 ? 'PROFITABLE' : 'BURNING'}
                    </span>
                  )}
                </div>
                <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.85rem 1rem' }}>
                  {/* Inputs */}
                  <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.6rem', marginBottom:'0.7rem'}}>
                    <div>
                      <div style={{fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.12em', color:'var(--text-2)', textTransform:'uppercase', marginBottom:4}}>
                        POWER (W)
                      </div>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={burnWatts || ''}
                        onChange={(e) => setBurnWatts(parseFloat(e.target.value) || 0)}
                        placeholder="3500"
                        min="0"
                        step="50"
                        style={{
                          width:'100%',
                          fontFamily:'var(--fm)', fontSize:'0.95rem', fontWeight:700,
                          color:'var(--amber)',
                          background:'var(--bg-deep)', border:'1px solid var(--border)',
                          padding:'7px 10px', boxSizing:'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <div style={{fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.12em', color:'var(--text-2)', textTransform:'uppercase', marginBottom:4}}>
                        ELECTRICITY ($/kWh)
                      </div>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={burnRate || ''}
                        onChange={(e) => setBurnRate(parseFloat(e.target.value) || 0)}
                        placeholder="0.12"
                        min="0"
                        step="0.01"
                        style={{
                          width:'100%',
                          fontFamily:'var(--fm)', fontSize:'0.95rem', fontWeight:700,
                          color:'var(--amber)',
                          background:'var(--bg-deep)', border:'1px solid var(--border)',
                          padding:'7px 10px', boxSizing:'border-box',
                        }}
                      />
                    </div>
                  </div>

                  {!haveBurn && (
                    <div style={{
                      fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-2)',
                      lineHeight:1.5, marginTop:6,
                    }}>
                      Enter your rig's total wattage and your $/kWh rate to see the real cost of mining and your break-even electricity price.
                    </div>
                  )}

                  {haveBurn && (
                    <>
                      {/* Daily/monthly burn rate */}
                      <div style={{
                        display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.5rem',
                        marginBottom:'0.7rem',
                      }}>
                        <div style={{textAlign:'center', padding:'0.5rem 0.4rem', background:'var(--bg-deep)', border:'1px solid var(--border)'}}>
                          <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--text-2)', textTransform:'uppercase'}}>PER DAY</div>
                          <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', fontWeight:700, color:'var(--text-1)', marginTop:3}}>
                            {fmtFiat(costPerDay, currency)}
                          </div>
                        </div>
                        <div style={{textAlign:'center', padding:'0.5rem 0.4rem', background:'var(--bg-deep)', border:'1px solid var(--border)'}}>
                          <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--text-2)', textTransform:'uppercase'}}>PER MONTH</div>
                          <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', fontWeight:700, color:'var(--text-1)', marginTop:3}}>
                            {fmtFiat(costPerMonth, currency)}
                          </div>
                        </div>
                        <div style={{textAlign:'center', padding:'0.5rem 0.4rem', background:'var(--bg-deep)', border:'1px solid var(--border)'}}>
                          <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.1em', color:'var(--text-2)', textTransform:'uppercase'}}>PER YEAR</div>
                          <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', fontWeight:700, color:'var(--text-1)', marginTop:3}}>
                            {fmtFiat(costPerYear, currency)}
                          </div>
                        </div>
                      </div>

                      {/* Net profit calculation — main reveal */}
                      {netP50 != null && (
                        <div style={{
                          background:'var(--bg-deep)',
                          border:`1px solid ${netP50 >= 0 ? 'var(--green)' : 'var(--red)'}`,
                          padding:'0.85rem 1rem',
                          marginBottom:'0.7rem',
                        }}>
                          <div style={{fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.12em', color:'var(--text-2)', textTransform:'uppercase', marginBottom:8, textAlign:'center'}}>
                            IF YOU STRIKE AT THE 50% MARK
                          </div>
                          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6, alignItems:'center'}}>
                            <div style={{textAlign:'center'}}>
                              <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-2)', letterSpacing:'0.1em', textTransform:'uppercase'}}>STRIKE PAYS</div>
                              <div style={{fontFamily:'var(--fd)', fontSize:'0.95rem', fontWeight:700, color:'var(--amber)', marginTop:3}}>
                                {fmtFiat(rewardFiat, currency)}
                              </div>
                            </div>
                            <div style={{textAlign:'center', fontFamily:'var(--fd)', fontSize:'1.2rem', color:'var(--text-2)'}}>−</div>
                            <div style={{textAlign:'center'}}>
                              <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-2)', letterSpacing:'0.1em', textTransform:'uppercase'}}>POWER COST</div>
                              <div style={{fontFamily:'var(--fd)', fontSize:'0.95rem', fontWeight:700, color:'var(--text-1)', marginTop:3}}>
                                {fmtFiat(costToP50, currency)}
                              </div>
                            </div>
                          </div>
                          <div style={{
                            marginTop:9, paddingTop:9, borderTop:'1px dashed rgba(245,166,35,0.18)',
                            textAlign:'center',
                          }}>
                            <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-2)', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:3}}>
                              NET {netP50 >= 0 ? 'PROFIT' : 'LOSS'}
                            </div>
                            <div style={{
                              fontFamily:'var(--fd)', fontSize:'1.4rem', fontWeight:800,
                              color: netP50 >= 0 ? 'var(--green)' : 'var(--red)',
                              textShadow: netP50 >= 0 ? '0 0 10px rgba(57,255,106,0.4)' : '0 0 10px rgba(255,71,87,0.4)',
                              lineHeight:1.1,
                            }}>
                              {netP50 >= 0 ? '+' : ''}{fmtFiat(netP50, currency)}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Break-even electricity rate */}
                      {breakEvenRate != null && (
                        <div style={{
                          fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-1)',
                          lineHeight:1.5,
                        }}>
                          Your <span style={{color:'var(--amber)', fontWeight:600}}>break-even rate</span> is{' '}
                          <span style={{color: rateNum < breakEvenRate ? 'var(--green)' : 'var(--red)', fontWeight:700}}>
                            {fmtFiat(breakEvenRate, currency)}/kWh
                          </span>.{' '}
                          {rateNum < breakEvenRate ? (
                            <>You're <span style={{color:'var(--green)', fontWeight:600}}>under</span> that — every strike pays for itself with profit left over.</>
                          ) : (
                            <>You're <span style={{color:'var(--red)', fontWeight:600}}>above</span> that — at this rate, even a strike at the 50% horizon won't cover your power bill. Consider cheaper power, lower-wattage miners, or treating mining as a long-shot lottery.</>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>


              {/* Footer description */}
              <div style={{
                borderTop:'1px dashed rgba(245,166,35,0.18)',
                paddingTop:'0.7rem',
                fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-1)',
                lineHeight:1.5,
                paddingRight:'5rem',
              }}>
                The Reckoning is a forecast, not a promise. <span style={{color:'var(--amber)', fontWeight:600}}>The next block is always a coin flip.</span>
                <div style={{marginTop:6, fontSize:'0.68rem', color:'var(--text-2)', lineHeight:1.5}}>
                  Math assumes constant network difficulty and your simulated hashrate. Real strikes can come tomorrow or in a decade — the math is the average across many possible timelines, not yours specifically.
                </div>
              </div>
            </>
          )}

        </div>
      </div>
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

  const host = loadStratumHost() || 'umbrel.local';
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
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:250,padding:'calc(env(safe-area-inset-top) + 1rem) 0.75rem 0.75rem',overflowY:'auto'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:560,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',boxShadow:'var(--glow-a)',maxHeight:'calc(100dvh - 4rem)',overflowY:'auto'}}>
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
const DEFAULT_ORDER = ['hashrate','strikevel','pulse','workers','stratum','vein','network','node','luck','retarget','shares','best','closestcalls','jumpers','recent'];
function loadOrder() {
  try {
    const s = localStorage.getItem(LS_CARD_ORDER);
    if (!s) return DEFAULT_ORDER;
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return DEFAULT_ORDER;
    const migrated = migrateCardIds(parsed);
    const known = migrated.filter(id => DEFAULT_ORDER.includes(id));
    // v1.8.0: when adding new cards (e.g. strikevel), splice them in right
    // after their canonical neighbor instead of bolting them onto the end —
    // gives the user the intended layout adjacencies.
    DEFAULT_ORDER.forEach((id, idx) => {
      if (known.includes(id)) return;
      // Find the previous card in DEFAULT_ORDER that the user DOES have, and
      // insert the missing one right after it.
      let insertAt = known.length; // default: end
      for (let j = idx - 1; j >= 0; j--) {
        const prev = DEFAULT_ORDER[j];
        const prevPos = known.indexOf(prev);
        if (prevPos >= 0) { insertAt = prevPos + 1; break; }
      }
      known.splice(insertAt, 0, id);
    });
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
  const [showStrikers, setShowStrikers] = useState(false);
  const [showReckoning, setShowReckoning] = useState(false);
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

  // ── Update banner state ──────────────────────────────────────────────
  // Hard updates only. When server's composeVersion exceeds what this UI
  // build was compiled with, a cyan wrench banner prompts the user to
  // update via the Umbrel app store. Soft updates via service worker
  // events were removed in v1.7.15 — iOS PWA SW timing is too unreliable
  // to surface a banner before the page silently reloads. Cold launches
  // pick up new bundles naturally; for breaking infrastructure changes,
  // this banner ensures users know to use Umbrel.
  const BUILT_COMPOSE_VERSION = '1.7.10'; // bump only when manifest/compose breaks
  const [bannerExpanded, setBannerExpanded] = useState(false);
  const [bannerDismissedFor, setBannerDismissedFor] = useState(() => {
    try { return localStorage.getItem('ss_banner_dismissed_v1') || ''; } catch { return ''; }
  });

  // Decide whether to show the (hard) update banner.
  const updateTier = useMemo(() => {
    const cmpVersion = (a, b) => {
      const pa = String(a||'0.0.0').split('.').map(n => parseInt(n,10)||0);
      const pb = String(b||'0.0.0').split('.').map(n => parseInt(n,10)||0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const da = pa[i]||0, db = pb[i]||0;
        if (da !== db) return da > db ? 1 : -1;
      }
      return 0;
    };
    const serverCompose = poolState?.composeVersion;
    if (serverCompose && cmpVersion(serverCompose, BUILT_COMPOSE_VERSION) > 0) {
      return 'hard';
    }
    return null;
  }, [poolState?.composeVersion]);

  const updateUrgency = poolState?.urgency || 'normal';
  const updateVersion = poolState?.version || '';
  const updateNotes = poolState?.releaseNotes || '';

  // Banner is suppressed if user already dismissed it for this exact version.
  // Critical urgency overrides dismissal.
  const bannerSuppressed = (
    updateTier &&
    updateUrgency !== 'critical' &&
    bannerDismissedFor === `${updateTier}:${updateVersion}`
  );

  const applySoftUpdate = useCallback(() => {
    // Plain reload — soft-update path removed in v1.7.15. Kept as a fallback
    // action wired into the banner; only used if/when hard-tier banner shows.
    try { window.location.reload(); } catch {}
  }, []);

  const dismissBanner = useCallback(() => {
    if (!updateTier) return;
    const key = `${updateTier}:${updateVersion}`;
    try { localStorage.setItem('ss_banner_dismissed_v1', key); } catch {}
    setBannerDismissedFor(key);
  }, [updateTier, updateVersion]);

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

  // ── Stratum first-then-rotate effect (v1.7.17) ──────────────────────────
  // Must be declared BEFORE early returns to comply with Rules of Hooks.
  // v1.7.22: Stratum auto-rotation removed entirely. The user's drag-to-reorder
  // choice is fully respected from the start. (Previously, on first configure,
  // Stratum would auto-rotate to the end. This was surprising for users who
  // had already moved it elsewhere.)
  // Rotation flag still saved on first launch to prevent any legacy reset.
  useEffect(() => {
    if (!loadStratumRotated()) saveStratumRotated();
  }, []);

  // ── Carousel hooks (v1.7.17) ────────────────────────────────────────────
  // Also must live BEFORE early returns. The actual carousel render uses
  // these hook outputs, but the hooks themselves are unconditional.
  const isMobile = useIsMobile();
  const [carouselEnabled, setCarouselEnabled] = useState(() => loadCarouselEnabled());
  const onCarouselChange = useCallback((v) => {
    saveCarouselEnabled(v);
    setCarouselEnabled(!!v);
  }, []);
  const [pulseAnim, setPulseAnim] = useState(() => loadPulseAnim());
  const onPulseAnimChange = useCallback((v) => {
    savePulseAnim(v);
    setPulseAnim(v);
  }, []);
  const [useBitcoinSymbols, setUseBitcoinSymbols] = useState(() => loadPulseBitcoinSymbols());
  const onBitcoinSymbolsChange = useCallback((v) => {
    savePulseBitcoinSymbols(v);
    setUseBitcoinSymbols(!!v);
  }, []);
  const useCarousel = isMobile && carouselEnabled;
  const carouselRef = useRef(null);
  const headerRef = useRef(null);
  const footerRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  // v1.7.22-iter: tag the body AND html with the active layout mode so CSS
  // can apply different sizing rules without needing :has() support
  // (Umbrel's webview may not have it). Carousel mode locks body height to
  // its container (fixes Umbrel iframe leaving empty space at the bottom).
  // Vertical mode lets the body grow with content for natural page scrolling.
  useEffect(() => {
    document.body.classList.toggle('ss-mode-carousel', useCarousel);
    document.body.classList.toggle('ss-mode-vertical', !useCarousel);
    document.documentElement.classList.toggle('ss-mode-carousel', useCarousel);
    document.documentElement.classList.toggle('ss-mode-vertical', !useCarousel);
  }, [useCarousel]);

  // Detect if we're rendering inside an iframe (i.e. Umbrel's webview).
  // Same code runs both in iOS Safari/PWA and in Umbrel — but Umbrel embeds
  // us inside an iframe, while Safari/PWA doesn't. window.self !== window.top
  // is the simplest reliable signal. Cross-origin throw means YES iframe.
  // Adds `ss-in-iframe` class to <body> so CSS can apply Umbrel-only tweaks
  // (currently: small top inset on the header to push it below Umbrel's chrome).
  useEffect(() => {
    let inIframe = false;
    try {
      inIframe = window.self !== window.top;
    } catch (_) {
      // Cross-origin access throws — that means we're definitely in an iframe
      inIframe = true;
    }
    document.body.classList.toggle('ss-in-iframe', inIframe);
    document.documentElement.classList.toggle('ss-in-iframe', inIframe);
  }, []);

  // Track which card is centered as the user swipes.
  // v1.8.1: dep array includes poolState._loaded so the effect re-runs after
  // the loading screen unmounts and the carousel <div ref={carouselRef}>
  // actually exists. Without this, the effect fired during the loading-screen
  // render with carouselRef.current === null, early-returned, and never
  // re-attached the scroll listener — leaving the dots dead until the user
  // toggled vertical→carousel mode (which flipped useCarousel and forced
  // a re-run after the ref had populated).
  useEffect(() => {
    if (!useCarousel) return;
    const el = carouselRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const w = el.clientWidth;
        if (!w) return;
        const idx = Math.round(el.scrollLeft / w);
        setActiveIndex(prev => prev === idx ? prev : Math.max(0, idx));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [useCarousel, poolState._loaded]);

  // Reset to first card when entering carousel mode (covers viewport rotate case)
  useEffect(() => {
    if (useCarousel && carouselRef.current) {
      carouselRef.current.scrollLeft = 0;
      setActiveIndex(0);
    }
  }, [useCarousel]);

  // Measure actual header/footer heights and set --carousel-h on the carousel
  // element. Replaces the CSS fallback `calc(100dvh - 246px)` which assumes
  // a fixed 246px for header+footer combined. In Umbrel's iframe and on
  // different devices the actual heights vary — measuring directly avoids
  // wasted space at the bottom (when 246px overestimated) and overflow
  // (when underestimated). Re-runs on viewport resize, orientation change,
  // and whenever the header/footer size shifts (e.g. when minimal mode is
  // toggled and the top strip disappears).
  //
  // ALSO sets body padding-bottom = footer height in vertical mode, so the
  // fixed-position footer doesn't cover the last row of content.
  useEffect(() => {
    const update = () => {
      const headerEl = headerRef.current;
      const footerEl = footerRef.current;
      const carouselEl = carouselRef.current;
      const headerH = headerEl ? headerEl.getBoundingClientRect().height : 0;
      const footerH = footerEl ? footerEl.getBoundingClientRect().height : 0;
      // Body padding-bottom = footer height (so content doesn't hide under
      // the fixed-position footer in vertical mode). In carousel mode the
      // carousel-h already accounts for footer, so no body padding needed.
      if (useCarousel) {
        document.body.style.paddingBottom = '0px';
      } else {
        document.body.style.paddingBottom = `${footerH}px`;
      }
      if (!carouselEl || !useCarousel) return;
      // documentElement.clientHeight is the iframe's content area in Umbrel
      // (or the viewport in Safari) — the actual usable height. NOT 100dvh
      // which can resolve differently in webviews.
      const containerH = document.documentElement.clientHeight;
      const carouselH = Math.max(200, containerH - headerH - footerH);
      carouselEl.style.setProperty('--carousel-h', `${carouselH}px`);
      carouselEl.style.height = `${carouselH}px`;
    };
    // Run once now and again after layout settles
    update();
    const raf1 = requestAnimationFrame(update);
    const t1 = setTimeout(update, 100);
    const t2 = setTimeout(update, 500);
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      if (headerRef.current) ro.observe(headerRef.current);
      if (footerRef.current) ro.observe(footerRef.current);
      ro.observe(document.documentElement);
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      if (ro) ro.disconnect();
      cancelAnimationFrame(raf1);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [useCarousel, minimalMode, stripSettings.enabled]);

  const jumpToCard = useCallback((idx) => {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
  }, []);

  if (!poolState._loaded) {
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
            carouselEnabled={carouselEnabled} onCarouselChange={onCarouselChange}
            pulseAnim={pulseAnim} onPulseAnimChange={onPulseAnimChange}
            useBitcoinSymbols={useBitcoinSymbols} onBitcoinSymbolsChange={onBitcoinSymbolsChange}
          />
        )}
      </>
    );
  }

  const status = poolState?.status || 'loading';
  const ns = poolState?.networkStats || {};

  const cardComponents = {
    hashrate: <HashrateChart
      history={poolState?.hashrate?.history}
      week={poolState?.hashrate?.week}
      current={poolState?.hashrate?.current||0}
      averages={poolState?.hashrate?.averages}
    />,
    strikevel: <StrikeVelocityChart
      spsHistory={poolState?.shares?.spsHistory}
      currentSps={poolState?.shares?.sps1m}
      hashrate={poolState?.hashrate?.current||0}
    />,
    pulse: <PulsePanel
      networkStats={poolState?.networkStats}
      onOpenSettings={()=>setShowSettings(true)}
      onOpenStrikers={()=>setShowStrikers(true)}
      pulseAnim={pulseAnim}
      onPulseAnimChange={onPulseAnimChange}
      useBitcoinSymbols={useBitcoinSymbols}
    />,
    workers: <WorkerGrid workers={workers} aliases={aliases} onWorkerClick={setSelectedWorker}/>,
    network: <NetworkStats network={poolState?.network} blockReward={poolState?.blockReward} mempool={poolState?.mempool} prices={poolState?.prices} currency={currency} privateMode={!!poolState?.privateMode} latestBlock={poolState?.latestBlock}/>,
    node: <BitcoinNodePanel nodeInfo={poolState?.nodeInfo}/>,
    stratum: <StratumPanel payoutAddress={poolState?.payoutAddress} stratumHealth={stratumHealth} startedAt={poolState?.shareStatsStartedAt}/>,
    vein: <VeinPanel odds={poolState?.odds} hashrate={poolState?.hashrate?.current} netHashrate={poolState?.network?.hashrate} blockReward={poolState?.blockReward} mempool={poolState?.mempool} prices={poolState?.prices} currency={currency} onOpen={()=>setShowReckoning(true)}/>,
    luck: <LuckGauge luck={poolState?.luck}/>,
    retarget: <RetargetPanel retarget={poolState?.retarget}/>,
    shares: <ShareStats shares={poolState?.shares} hashrate={poolState?.hashrate?.current} bestshare={poolState?.bestshare} onOpen={()=>setShowShareStats(true)}/>,
    best: <BestShareLeaderboard workers={workers} poolBest={poolState?.bestshare} aliases={aliases}/>,
    closestcalls: <ClosestCallsPanel closestCalls={poolState?.snapshots?.closestCalls} aliases={aliases} networkDifficulty={poolState?.network?.difficulty}/>,
    jumpers: <JumpersPanel
      topFinders={poolState?.topFinders}
      netBlocks={poolState?.netBlocks}
      blocks={poolState?.blocks}
      blockAlert={blockAlert}
    />,
    recent: <RecentBlocksPanel netBlocks={poolState?.netBlocks}/>,
  };

  const visibleSet = new Set(minimalMode ? MINIMAL_PRESET : visibleCards);
  const baseOrder = order.filter(id => visibleSet.has(id) && cardComponents[id]);

  // v1.7.22: Stratum no longer auto-pins to first slot. Whatever order the
  // user has set (default or customized via Settings → Display) is used as-is.
  // Removes the surprise of Stratum jumping to front on first launch.
  const renderableOrder = baseOrder;

  return (
    <>
     <div ref={headerRef} className="ss-app-header" style={{ position:'sticky', top:0, zIndex:50, background:'rgba(6,7,8,0.92)', backdropFilter:'blur(10px)', WebkitBackdropFilter:'blur(10px)', width:'100%', maxWidth:'100%', boxSizing:'border-box', overflow:'hidden', paddingTop:'env(safe-area-inset-top)' }}>
        {updateTier && !bannerSuppressed && (
          <UpdateBanner
            tier={updateTier}
            urgency={updateUrgency}
            version={updateVersion}
            notes={updateNotes}
            expanded={bannerExpanded}
            onToggleExpanded={() => setBannerExpanded(v => !v)}
            onApply={applySoftUpdate}
            onDismiss={dismissBanner}
          />
        )}
        <Header
          connected={connected}
          status={status}
          onSettings={()=>setShowSettings(true)}
          privateMode={!!poolState?.privateMode}
          minimalMode={minimalMode}
          zmq={poolState?.zmq}
          blocksFound={Array.isArray(poolState?.blocks) ? poolState.blocks.length : null}
          retargetPct={poolState?.retarget?.difficultyChange ?? null}
          retargetBlocks={poolState?.retarget?.remainingBlocks ?? null}
        />
        {!minimalMode && (
          <>
            <Ticker snapshotText={tickerText} enabled={tickerSettings.enabled} speedSec={tickerSettings.speedSec}/>
            <LatestBlockStrip netBlocks={poolState?.netBlocks} blockReward={poolState?.blockReward}/>
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
            <SyncWarningBanner sync={poolState?.sync}/>
          </>
        )}
      </div>

      <main style={{padding: useCarousel ? 0 : '0.65rem'}} className={useCarousel ? 'ss-carousel-wrap' : ''}>
        <div
          ref={carouselRef}
          className={useCarousel ? 'ss-carousel' : 'ss-grid'}
        >
          {renderableOrder.map(id => (
            <DraggableCard key={id} id={id} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={()=>{setDraggedId(null); setOverId(null);}} draggedId={draggedId}>
              {cardComponents[id]}
            </DraggableCard>
          ))}
        </div>
        {useCarousel && (
          <CarouselDots
            count={renderableOrder.length}
            activeIndex={activeIndex}
            onJump={jumpToCard}
          />
        )}
      </main>
        <footer ref={footerRef} style={{borderTop:'1px solid var(--border)',padding:'0.35rem 0.75rem',paddingBottom:'calc(0.35rem + env(safe-area-inset-bottom))',display:'flex',justifyContent:'space-between',alignItems:'center',fontFamily:'var(--fd)',fontSize:'0.5rem',color:'var(--text-3)',letterSpacing:'0.06em',textTransform:'uppercase',gap:'0.5rem',flexWrap:'nowrap',width:'100%',maxWidth:'100%',boxSizing:'border-box',whiteSpace:'nowrap',position:'fixed',left:0,right:0,bottom:0,background:'rgba(6,7,8,0.92)',backdropFilter:'blur(10px)',WebkitBackdropFilter:'blur(10px)',zIndex:50}}>
        <span>SoloStrike v1.8.1 — ckpool-solo{poolState?.privateMode && ' · 🔒 PRIVATE'}{minimalMode && ' · MIN'}</span>
        <a href="https://github.com/danhaus93-ops/solostrike-umbrel" target="_blank" rel="noopener noreferrer" title="View source on GitHub" style={{display:'inline-flex', alignItems:'center', justifyContent:'center', color:'var(--text-2)', textDecoration:'none', padding:'2px 6px', lineHeight:1, flexShrink:0}}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
        <span>Ports <CopyablePort health={stratumHealth} port="3333"/> · <CopyablePort health={stratumHealth} port="3334"/> · 🔒 <CopyablePort health={stratumHealth} port="4333" ssl/></span>
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
       {showStrikers && (
        <StrikersModal
          networkStats={poolState?.networkStats}
          onClose={()=>setShowStrikers(false)}/>
      )}
      {showReckoning && (
        <ReckoningModal
          poolState={poolState}
          currency={currency}
          onClose={()=>setShowReckoning(false)}/>
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
          carouselEnabled={carouselEnabled} onCarouselChange={onCarouselChange}
          pulseAnim={pulseAnim} onPulseAnimChange={onPulseAnimChange}
          useBitcoinSymbols={useBitcoinSymbols} onBitcoinSymbolsChange={onBitcoinSymbolsChange}
        />
      )}
    </>
  );
}
