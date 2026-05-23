import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { usePool } from './hooks/usePool.js';
import { fmtHr, fmtDiff, fmtNum, fmtOdds, fmtOddsInverse, timeAgo, fmtAgoShort, fmtPct, fmtDurationMs, fmtSats, fmtBtc, fmtFiat, CURRENCIES, blockTimeAgo } from './utils.js';
import { METRICS, METRIC_MAP, METRIC_CATEGORIES, DEFAULT_STRIP_METRICS, DEFAULT_CHUNK_SIZE, DEFAULT_FADE_MS } from './metrics.js';
import OnboardingWizard, { hasCompletedWizard } from './components/OnboardingWizard.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { createGlobeWebGL, bakeWorldMapTexture } from './globe-webgl.js';
import { createConstellationCube } from './constellation-cube.js';
import { createLightningWebGL } from './lightning-webgl.js';
import { createNonceFieldWebGL } from './nonce-field-webgl.js';

// ── BTC glyph image (canvas-rendered animations use this in place of ₿) ──────
// Loaded once at module level. Falls back to fillText('₿') if not yet ready or
// if the SVG fails to decode.
const __btcGlyphImg = (typeof window !== 'undefined') ? new Image() : null;
let __btcGlyphReady = false;
if (__btcGlyphImg) {
  __btcGlyphImg.decoding = 'async';
  __btcGlyphImg.onload = () => { __btcGlyphReady = true; };
  __btcGlyphImg.onerror = () => { __btcGlyphReady = false; };
  __btcGlyphImg.src = '/btc-glyph.png';
}
// Draw the custom B glyph centered at (x, y) at the given size. Honors the
// canvas's current textBaseline ('top' vs 'middle'), textAlign is assumed
// 'center'. globalAlpha + shadowBlur/shadowColor still apply.
function drawBtcGlyph(ctx, x, y, size) {
  if (!__btcGlyphReady) {
    ctx.fillText('\u20BF', x, y);
    return;
  }
  const dx = x - size / 2;
  const dy = ctx.textBaseline === 'top' ? y : y - size / 2;
  ctx.drawImage(__btcGlyphImg, dx, dy, size, size);
}

// ── Pickaxe icon (used by Hunt 'pickaxe' animation) ──────────────────────────
// Pre-loaded once; falls back to a procedural pickaxe shape if not ready.
const __pickaxeImg = (typeof window !== 'undefined') ? new Image() : null;
let __pickaxeReady = false;
if (__pickaxeImg) {
  __pickaxeImg.decoding = 'async';
  __pickaxeImg.onload = () => { __pickaxeReady = true; };
  __pickaxeImg.onerror = () => { __pickaxeReady = false; };
  __pickaxeImg.src = '/pickaxe-icon.png';

// v1.11.x BFM: splash-pickaxe.png has the correct orientation (head top, grip
// bottom-right) needed for the new Variant-25 BFM celebration animation.
// pickaxe-icon.png is square/cartoonish and used elsewhere — kept separate.
}
const __splashPickaxeImg = (typeof window !== 'undefined') ? new Image() : null;
let __splashPickaxeReady = false;
if (__splashPickaxeImg) {
  __splashPickaxeImg.decoding = 'async';
  __splashPickaxeImg.onload = () => { __splashPickaxeReady = true; };
  __splashPickaxeImg.onerror = () => { __splashPickaxeReady = false; };
  __splashPickaxeImg.src = '/splash-pickaxe.png';
}

// ── BTC celebrate glyph (the user's exact icon, transparent bg) ──────────────
// Used by the BlockFoundModal celebrations — bigger, gradient, with soft glow
// halo around the B. PNG (not SVG) so the color/glow render exactly as drawn.
const __btcCelebrateImg = (typeof window !== 'undefined') ? new Image() : null;
let __btcCelebrateReady = false;
if (__btcCelebrateImg) {
  __btcCelebrateImg.decoding = 'async';
  __btcCelebrateImg.onload = () => { __btcCelebrateReady = true; };
  __btcCelebrateImg.onerror = () => { __btcCelebrateReady = false; };
  __btcCelebrateImg.src = '/btc-glyph-celebrate.png';
}
// Draw the celebrate glyph at (cx, cy) at the given size. brightness > 1 adds
// a 'lighter'-composite re-stamp on top to brighten the B (used during the
// lightning-strike ignition).
function drawBtcCelebrate(ctx, cx, cy, size, brightness) {
  if (!__btcCelebrateReady) {
    // Fallback to vector glyph
    const prevAlign = ctx.textAlign, prevBaseline = ctx.textBaseline;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `bold ${size}px ${'-apple-system, sans-serif'}`;
    ctx.fillStyle = '#F7931A';
    ctx.fillText('\u20BF', cx, cy);
    ctx.textAlign = prevAlign; ctx.textBaseline = prevBaseline;
    return;
  }
  const dx = cx - size / 2, dy = cy - size / 2;
  ctx.drawImage(__btcCelebrateImg, dx, dy, size, size);
  if (brightness && brightness > 1) {
    const prevComp = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (brightness - 1) * 0.7;
    ctx.drawImage(__btcCelebrateImg, dx, dy, size, size);
    ctx.globalAlpha = prevAlpha;
    ctx.globalCompositeOperation = prevComp;
  }
}

// ── Style tokens ──────────────────────────────────────────────────────────────
// rev63 premium pass — Forge Tile treatment.
// Multi-layer background: hot amber edge along top + soft inner glow
// fading from top + base vertical fill gradient. Multiple inset/outer
// shadows give the card pronounced "lifted from the surface" depth.
// 16px border-radius reads as a polished tile rather than a tech border.
//
// The "hot top edge" is a 1.5px amber gradient line painted as a
// background-image at the top center (10%-90% width, transparent at
// edges). Inner glow is a radial gradient ellipse at top-center. Both
// are built into the background shorthand so no pseudo-elements are
// needed — works with all the existing `style={{...card, ...}}` spreads.
//
// rev64: dropped `position: relative` and `overflow: hidden` — they were
// breaking the carousel page-indicator dots. iOS Safari's scroll-snap
// detection mis-fires when a snap-target's child has overflow:hidden,
// causing the parent .ss-carousel scroll handler to stop receiving
// scroll events mid-swipe → activeIndex never updates → dots froze.
// Background-image layers are clipped to border-radius automatically
// without overflow:hidden, so the visual is preserved. The radial inner
// glow fades to transparent within ~70% of its ellipse, well inside the
// card so corner-bleed isn't visible. Cards that genuinely need
// overflow:hidden (e.g., the StampSolo wrapper) set it inline locally.
//
// rev67: card height is now stretched to fill the wrapper via a CSS
// flex rule on .ss-carousel .ss-card (display:flex column) + .ss-card>div
// (flex:1 0 auto). Inline `min-height: 100%` was tried in rev66 but didn't
// resolve because the wrapper has `height: auto` (CSS spec: percentage
// min-height resolves to auto when parent height is auto).
const card = {
  background:
    /* Hot amber edge along the top (centered, fading out at the sides) */
    'linear-gradient(90deg, transparent 10%, rgba(245,166,35,0.45) 50%, transparent 90%) top center / 100% 1.5px no-repeat, ' +
    /* Soft inner glow fading from the top edge into the card */
    'radial-gradient(ellipse 70% 90px at 50% 0%, rgba(245,166,35,0.13) 0%, transparent 70%), ' +
    /* Base vertical fill */
    'linear-gradient(180deg, var(--bg-raised) 0%, var(--bg-surface) 100%)',
  border:'1px solid rgba(245,166,35,0.22)',
  borderRadius:'16px',
  padding:'1.3rem',
  boxShadow:
    'inset 0 1px 0 rgba(245,166,35,0.18), '   /* sheen along very top edge */ +
    'inset 0 0 0 1px rgba(0,0,0,0.4), '       /* dark inner ring (depth) */ +
    '0 8px 24px rgba(0,0,0,0.6), '            /* main drop shadow */ +
    '0 0 32px rgba(245,166,35,0.06)',         /* faint amber halo */
};
// v1.10.0 Visual polish #6: gradient header underline. Replaces the previous
// flat marginBottom-only style with a fading amber-to-transparent line drawn
// at the bottom of every section title via background-image (since inline
// React styles can't use ::after pseudo-elements). The 1px line at 100% sits
// just above the title's marginBottom so the text isn't pushed.
const cardTitle = {
  fontFamily: 'var(--fd)',
  fontSize: '0.7rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: 'var(--text-2)',
  marginBottom: '0.7rem',
  paddingBottom: '0.45rem',
  backgroundImage:
    'linear-gradient(90deg, rgba(245,166,35,0.55) 0%, rgba(245,166,35,0.45) 30%, rgba(245,166,35,0.12) 70%, rgba(245,166,35,0) 100%)',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 1px',
  backgroundPosition: 'bottom left',
};
const statRow = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.55rem 0.8rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:'0.3rem', borderRadius:'4px' };
const label = { fontFamily:'var(--fd)', fontSize:'0.7rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };
const HEALTH_COLOR = { green:'var(--green)', amber:'var(--amber)', red:'var(--red)' };

// ── Modal section styles (v1.9.0 hoist) ──────────────────────────────────────
// These were originally local consts inside ShareStatsModal and
// HealthDetailModal. Hoisted to module scope so PoolAlignmentBlock and
// LiveStatsBlock (and any future modal sub-components) can reuse them
// without duplication.
const section  = { marginBottom:'1rem' };
// v1.10.0 #6: same gradient-underline treatment as cardTitle but compact
// (smaller padding to fit narrower modal sections).
const secTitle = {
  fontFamily: 'var(--fd)',
  fontSize: '0.55rem',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  color: 'var(--amber)',
  marginBottom: '0.5rem',
  paddingBottom: '0.35rem',
  backgroundImage:
    'linear-gradient(90deg, rgba(245,166,35,0.55) 0%, rgba(245,166,35,0.45) 30%, rgba(245,166,35,0.12) 70%, rgba(245,166,35,0) 100%)',
  backgroundRepeat: 'no-repeat',
  backgroundSize: '100% 1px',
  backgroundPosition: 'bottom left',
};
const kvRow    = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.4rem 0.6rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:3 };
const kvLabel  = { fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };
const kvVal    = { fontFamily:'var(--fm)', fontSize:'0.75rem', color:'var(--text-1)', textAlign:'right' };

// ── Pool alignment helpers (v1.9.0) ──────────────────────────────────────────
// Convert miner-poller alignment status into UI elements.
//
//   aligned       → green ✓   "Pointed at SoloStrike, currently active"
//   backup        → amber ⚠   "Configured but a different pool is active"
//   misaligned    → red ✗     "NOT pointed at SoloStrike — check miner config"
//   unreachable   → gray ⊘    "Couldn't reach miner on port 4028"
//   disabled      → gray ⊘    "Miner's API is locked or disabled"
//   unknown       → null      "No data yet (don't render a badge)"
//   esp-no-pools  → null      "ESP-Miner doesn't expose pools — silently skip"
const POOL_ALIGN_META = {
  // v1.9.3: labels explicitly name SoloStrike so the GOOD case reads as a
  // clear "yes this miner is on SoloStrike" message, not just an abstract
  // "OK". shortLabels stay terse for the tiny inline worker-row badges.
  aligned:     { color:'var(--green)', glyph:'✓',  label:'Aligned with SoloStrike', shortLabel:'OK' },
  backup:      { color:'var(--amber)', glyph:'⚠',  label:'SoloStrike is backup',    shortLabel:'BACKUP' },
  misaligned:  { color:'var(--red)',   glyph:'✗',  label:'Not on SoloStrike',       shortLabel:'WRONG' },
  unreachable: { color:'var(--text-3)',glyph:'⊘',  label:'Can\u2019t reach miner',shortLabel:'NO API' },
  disabled:    { color:'var(--text-3)',glyph:'⊘',  label:'Miner API disabled',   shortLabel:'NO API' },
  // v1.9.2: 'unverifiable' = firmware responded but didn't include User
  // credentials in the pools list (Avalon Nano 3S, some Goldshell etc).
  // We can't determine alignment from URL alone, so don't accuse it.
  unverifiable:{ color:'var(--text-3)',glyph:'?',  label:'Can\u2019t verify pool',shortLabel:'?' },
  // 'unknown' and 'esp-no-pools' intentionally have no entry — no badge rendered.
};
function poolAlignMeta(status) { return POOL_ALIGN_META[status] || null; }

// ── Temperature thresholds (v1.9.0) ──────────────────────────────────────────
// Configurable later if anyone asks; hardcoded for v1.
const TEMP_AMBER_C = 75;
const TEMP_RED_C   = 80;
// v1.11.x: tempBadgeMeta() helper deleted (was declared, never invoked).
// Inline temp-tier styling lives at line ~2221 directly using TEMP_AMBER_C
// and TEMP_RED_C constants — no helper needed.

// ── localStorage keys ─────────────────────────────────────────────────────────
const LS_CARD_ORDER      = 'ss_card_order_v1';
const LS_CURRENCY        = 'ss_currency_v1';
const LS_ALIASES         = 'ss_worker_aliases_v1';
const LS_NOTES           = 'ss_worker_notes_v1';
const LS_STRIP_METRICS   = 'ss_strip_metrics_v1';
const LS_STRIP_CHUNK     = 'ss_strip_chunk_v1';
const LS_STRIP_FADE      = 'ss_strip_fade_v1';
const LS_STRIP_ENABLED   = 'ss_strip_enabled_v1';
const LS_TICKER_ENABLED  = 'ss_ticker_enabled_v1';
const LS_TICKER_SPEED    = 'ss_ticker_speed_v1';
const LS_TICKER_METRICS  = 'ss_ticker_metrics_v1';
const LS_MINIMAL_MODE    = 'ss_minimal_mode_v1';
const LS_PERFORMANCE_MODE = 'ss_performance_mode_v1'; // v1.11.39: Performance Mode toggle
const LS_VISIBLE_CARDS   = 'ss_visible_cards_v1';
const LS_DEBUG_SETTINGS  = 'ss_debug_settings_v1';

const DEFAULT_TICKER_SPEED = 30;
const DEFAULT_TICKER_METRICS = ['pool_hashrate', 'worker_health', 'accept_rate', 'next_block_prize', 'btc_price', 'time_since_block', 'halving', 'blocks_found_total'];

const ALL_CARDS = [
  { id:'hashrate',      label:'Firepower' },
  { id:'strikevel',     label:'Strike Velocity' },
  { id:'pulse',         label:'Solostrike Pulse' },
  { id:'workers',       label:'The Crew' },
  { id:'stratum',       label:'Stratum Connection' },
  { id:'hunt',          label:'The Hunt' },
  { id:'network',       label:'Bitcoin Network' },
  { id:'node',          label:'Bitcoin Node' },
  { id:'luck',          label:'Hot Streak' },
  { id:'retarget',      label:'Difficulty Retarget' },
  { id:'shares',        label:'Share Stats' },
  { id:'best',          label:'Top Miners' },
  { id:'closestcalls',  label:'Near Strikes' },
  { id:'jumpers',       label:'Claim Jumpers + Solo Strikes' },
  { id:'recent',        label:'The Ledger' },
  { id:'health',        label:'System Health' },
];
const ALL_CARD_IDS    = ALL_CARDS.map(c => c.id);
const MINIMAL_PRESET  = ['hashrate', 'pulse', 'workers', 'jumpers'];
const DEFAULT_PRESET  = ['hashrate', 'strikevel', 'pulse', 'workers', 'stratum', 'hunt', 'network', 'shares', 'best', 'closestcalls', 'jumpers', 'health'];
const EVERYTHING_PRESET = [...ALL_CARD_IDS];

// v1.7.6 migration — rename "odds" card id to "vein" in any persisted layouts.
// v1.11.x — extends migration to rename "vein" → "hunt" (gold-mining vocab
// retired in favor of brand-aligned "Hunt").
// Idempotent and safe even if user hasn't seen the old id.
function migrateCardIds(arr) {
  if (!Array.isArray(arr)) return arr;
  const seen = new Set();
  const out = [];
  for (const id of arr) {
    // v1.7.x → v1.11.x migrations:
    //   'odds'       -> 'hunt'        (older rename via 'vein' interim)
    //   'vein'       -> 'hunt'        (v1.11.x: gold-mining vocab retired)
    //   'hashpulse'  -> 'hashrate' + 'pulse' (v1.7.22-iter23: split back into two cards)
    //   'topfinders' -> 'jumpers'     (v1.7.22: merged Claim Jumpers + Gold Strikes)
    //   'blocks'     -> 'jumpers'     (v1.7.22: merged Claim Jumpers + Gold Strikes)
    //   'netstrikes' -> 'network'     (v1.7.22: split unwound; the strikes
    //                                  half goes into 'jumpers', so we add
    //                                  jumpers separately below)
    if (id === 'odds' || id === 'vein') {
      if (!seen.has('hunt')) { seen.add('hunt'); out.push('hunt'); }
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
// v1.11.39: Performance Mode — replaces animated Pulse/Hunt canvases with
// static baked frames. Strike pulse rings stay live (information-bearing).
// Header pickaxe pulse + glow auto-suppressed (already handled via the
// existing minimalMode ternary; performanceMode joins it).
function loadPerformanceMode()   { try { const v = localStorage.getItem(LS_PERFORMANCE_MODE); return v === 'true'; } catch { return false; } }
function savePerformanceMode(v)  { try { localStorage.setItem(LS_PERFORMANCE_MODE, String(!!v)); } catch {} }
function loadVisibleCards()  { try { const s = localStorage.getItem(LS_VISIBLE_CARDS); if (!s) return EVERYTHING_PRESET; const p = JSON.parse(s); const migrated = migrateCardIds(Array.isArray(p) ? p : []); return migrated.length ? migrated.filter(id => ALL_CARD_IDS.includes(id)) : EVERYTHING_PRESET; } catch { return EVERYTHING_PRESET; } }
function saveVisibleCards(list) { try { localStorage.setItem(LS_VISIBLE_CARDS, JSON.stringify(list)); } catch {} }

// Debug overlay settings (rev70). One persisted JSON object so we can ship a
// "complete and thorough" debug system that survives across revs without
// adding/removing diagnostic code each iteration. Sections can be toggled
// individually from Settings → Debug. Defaults: enabled is OFF for fresh
// installs (the overlay is for power users), but if a user is upgrading from
// rev69 — where the overlay defaulted ON via the ss_debug_layout_hide flag —
// we respect their prior choice: if they DIDN'T dismiss it, keep it on; if
// they DID, keep it off. After this rev the localStorage flag is obsolete.
const DEBUG_DEFAULTS = {
  enabled:     false,  // master toggle
  // Page-level inspection
  layout:      true,   // carousel / slot / card dimensions
  state:       true,   // mode flags, indices, body classes
  network:     true,   // pool state, stratum ports, last update
  build:       true,   // cache name, version, SW state + all registrations
  // Diagnostic streams (continuously captured at module load)
  performance: false,  // FPS, memory, long tasks, DOM nodes, page-load timing
  errors:      false,  // window errors + unhandled promise rejections
  consoleLog:  false,  // captured console.log/warn/error rolling buffer
  api:         false,  // fetch() trace
  transport:   false,  // NEW: WebSocket + EventSource state, message counts
  resources:   false,  // NEW: slow/large resource loads via PerformanceObserver
  // Environment & resources
  device:      false,  // UA, DPR, online, connection, prefs, safe-area
  visibility:  false,  // NEW: page visibility transitions + wake lock state
  battery:     false,  // NEW: level, charging, time remaining
  webgl:       false,  // NEW: canvas inventory, GPU renderer, context-loss count
  caches:      false,  // Cache Storage entries + storage estimate
  capabilities:false,  // NEW: feature support matrix (one-time probe)
  theme:       false,  // NEW: every --ss-* CSS custom property at :root
  pool:        false,  // worker/hashrate/share/block detail
  interaction: false,  // last tap coords + idle time
  storage:     false,  // localStorage browser
};
function loadDebugSettings() {
  // rev70c: master toggle is PER-SESSION — always defaults to false on each
  // app load. Section preferences (which sub-toggles are on/off) DO persist,
  // so once you flip master on you immediately see the sections you chose
  // last time. This stops the overlay from auto-restoring on every PWA
  // relaunch (it was surprising users who had enabled it once and now
  // saw a debug panel every time they opened the app).
  // The rev69→rev70 migration that auto-enabled based on the legacy
  // `ss_debug_layout_hide` flag is removed — that flag is no longer used.
  try {
    const raw = localStorage.getItem(LS_DEBUG_SETTINGS);
    const p = raw ? JSON.parse(raw) : {};
    return { ...DEBUG_DEFAULTS, ...(p && typeof p === 'object' ? p : {}), enabled: false };
  } catch { return { ...DEBUG_DEFAULTS }; }
}
function saveDebugSettings(s) {
  // Persist everything EXCEPT `enabled` — see loadDebugSettings comment.
  // Stripping it here keeps the master toggle ephemeral while letting users
  // pre-configure their preferred section layout.
  try {
    if (!s || typeof s !== 'object') return;
    const { enabled, ...rest } = s;
    localStorage.setItem(LS_DEBUG_SETTINGS, JSON.stringify(rest));
  } catch {}
}

// ── Module-level diagnostic store (rev70) ────────────────────────────────────
// Hooks below install ONCE at module load and run continuously regardless of
// whether the debug overlay is open. That way, when a user notices something
// odd and flips the overlay on, they immediately see the recent history of
// errors/console-logs/API calls — not just events that happened after they
// enabled it. Buffer sizes are capped to bound memory.
const _ssDebug = {
  errors:        [],   // {ts, msg, src, lineno, colno, stack}
  rejections:    [],   // {ts, reason}
  consoleLog:    [],   // {ts, level, text}
  apiCalls:      [],   // {ts, method, url, status, ms}
  longTasks:     0,    // total long-task count since page load
  fps:           60,   // current rolling-second FPS
  fpsSamples:    [],   // last ~30s of per-second FPS samples
  ctxLoss:       [],   // {ts, canvasIdx} WebGL context-lost events
  lastTap:       { ts: 0, type: null, x: 0, y: 0 },
  installedAt:   Date.now(),
  // rev70 expansion:
  wsInstances:   [],   // {ws, url, msgCount, lastMsgTs, openTs, closeCode, closeReason}
  esInstances:   [],   // {es, url, msgCount, lastMsgTs, openTs}
  resources:     [],   // {ts, name, dur, size, type}  — only slow/large
  visibility:    { state: 'visible', transitions: 0, lastChangeTs: Date.now() },
  battery:       null, // { level, charging, chargingTime, dischargingTime } when supported
  // v1.11.39 — ticker / stutter diagnosis streams
  tickerFrames:  [],   // {ts, dt, x, hw}      — sliding window, last ~150 rAF ticks
  longTaskList:  [],   // {ts, dur, attrib}    — last ~30 PerformanceObserver longtask entries
  wsEvents:      [],   // {ts, size, type}     — last ~50 WS message arrivals with byte size
  tickerStalls:  [],   // {ts, gap, x}         — detected ticker stalls (gap > 33ms between frames)
  // v1.11.39 — WebSocket spawn tracking (duplicate-socket bug detection)
  wsSpawnCount:  0,    // total number of new WebSocket() calls since page load
  wsSpawnLog:    [],   // {ts, spawn, reason}  — last 20 spawn events with reason tag
};
// v1.11.39 FIX: expose _ssDebug to window so cross-module instrumentation
// (in usePool.js, etc) can write to it. Without this, the previous tracking
// in usePool.js silently no-op'd because `window._ssDebug` was undefined,
// leaving wsSpawnCount=0 and wsSpawnLog=[] in every debug dump.
if (typeof window !== 'undefined') {
  window._ssDebug = _ssDebug;
}
function _ssTruncate(s, max = 200) {
  s = String(s == null ? '' : s);
  return s.length > max ? s.slice(0, max) + '…' : s;
}
function _ssSerializeArg(arg) {
  try {
    if (arg == null) return String(arg);
    if (typeof arg === 'string') return _ssTruncate(arg);
    if (arg instanceof Error) return _ssTruncate(arg.stack || arg.message);
    if (typeof arg === 'object') return _ssTruncate(JSON.stringify(arg));
    return _ssTruncate(String(arg));
  } catch { return '[unserializable]'; }
}
function _ssPushBounded(arr, item, cap) {
  arr.push(item);
  while (arr.length > cap) arr.shift();
}
// Install hooks exactly once per page (window guard survives hot reload).
if (typeof window !== 'undefined' && !window._ssDebugHooksInstalled) {
  window._ssDebugHooksInstalled = true;

  // 1. window.onerror — uncaught JS errors. Useful when something silently
  //    breaks the UI without showing a visible failure.
  window.addEventListener('error', (e) => {
    _ssPushBounded(_ssDebug.errors, {
      ts: Date.now(),
      msg: _ssTruncate(e?.message || 'unknown error'),
      src: _ssTruncate(e?.filename || '', 80),
      lineno: e?.lineno || 0,
      colno: e?.colno || 0,
      stack: e?.error?.stack ? _ssTruncate(e.error.stack, 300) : '',
    }, 30);
  }, { capture: true });

  // 2. unhandledrejection — promise rejections nobody caught. Common cause
  //    of "API call silently failed and UI shows stale data forever".
  window.addEventListener('unhandledrejection', (e) => {
    let reason = '';
    try {
      const r = e?.reason;
      reason = r instanceof Error ? (r.stack || r.message) : (typeof r === 'string' ? r : JSON.stringify(r));
    } catch { reason = '[unserializable rejection]'; }
    _ssPushBounded(_ssDebug.rejections, {
      ts: Date.now(),
      reason: _ssTruncate(reason, 300),
    }, 20);
  });

  // 3. console wrap — captures every log/info/warn/error/debug call with a
  //    truncated string repr. Indispensable on iOS where reaching DevTools
  //    over USB is non-trivial. Keeps original behavior; just adds a tap.
  ['log', 'info', 'warn', 'error', 'debug'].forEach((level) => {
    const orig = console[level];
    if (typeof orig !== 'function') return;
    console[level] = function patched(...args) {
      try {
        _ssPushBounded(_ssDebug.consoleLog, {
          ts: Date.now(),
          level,
          text: args.map(_ssSerializeArg).join(' '),
        }, 50);
      } catch (_) {}
      return orig.apply(console, args);
    };
  });

  // 4. fetch wrap — every API call gets logged with timing + status. Skip
  //    if fetch is missing (very old browsers, doesn't apply here but safe).
  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch.bind(window);
    window.fetch = function patchedFetch(input, init) {
      let url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || String(input); }
      catch { url = '?'; }
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const t0 = (performance && performance.now) ? performance.now() : Date.now();
      const finish = (status, err) => {
        const ms = Math.round(((performance && performance.now) ? performance.now() : Date.now()) - t0);
        _ssPushBounded(_ssDebug.apiCalls, {
          ts: Date.now(),
          method,
          url: _ssTruncate(url, 80),
          status,
          ms,
          err: err ? _ssTruncate(err, 60) : null,
        }, 30);
      };
      try {
        return origFetch(input, init).then(
          (res) => { finish(res.status); return res; },
          (err) => { finish('ERR', err && (err.message || String(err))); throw err; }
        );
      } catch (sync) {
        finish('THROW', sync && (sync.message || String(sync)));
        throw sync;
      }
    };
  }

  // 5. PerformanceObserver(longtask) — counts blocking JS tasks >50ms. High
  //    counts correlate with jank in the WebGL bg or carousel scroll feel.
  try {
    if ('PerformanceObserver' in window) {
      const po = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        _ssDebug.longTasks += entries.length;
        for (const e of entries) {
          const attrib = (e.attribution && e.attribution[0])
            ? `${e.attribution[0].name || ''}/${e.attribution[0].containerType || ''}`
            : '';
          _ssPushBounded(_ssDebug.longTaskList, {
            ts: Math.round(performance.timeOrigin + e.startTime),
            dur: Math.round(e.duration),
            attrib,
          }, 30);
        }
      });
      po.observe({ entryTypes: ['longtask'] });
    }
  } catch (_) { /* longtask not supported (Safari < 15ish) */ }

  // 6. FPS via requestAnimationFrame. ~60 callbacks/sec is negligible cost
  //    and gives historical samples even when the panel is closed.
  let _fpsLast = (performance && performance.now) ? performance.now() : Date.now();
  let _fpsFrames = 0;
  function _fpsTick(now) {
    _fpsFrames++;
    const elapsed = now - _fpsLast;
    if (elapsed >= 1000) {
      _ssDebug.fps = Math.round((_fpsFrames * 1000) / elapsed);
      _ssPushBounded(_ssDebug.fpsSamples, _ssDebug.fps, 30);
      _fpsFrames = 0;
      _fpsLast = now;
    }
    requestAnimationFrame(_fpsTick);
  }
  requestAnimationFrame(_fpsTick);

  // 7. Last-interaction tracking — useful for "the swipe didn't register"
  //    style debugging. Uses passive capture so we don't interfere with
  //    real handlers.
  const onTap = (e) => {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]) || e;
    _ssDebug.lastTap = {
      ts: Date.now(),
      type: e.type,
      x: Math.round(t.clientX || 0),
      y: Math.round(t.clientY || 0),
    };
  };
  ['click', 'touchstart', 'touchend', 'pointerdown'].forEach((ev) => {
    window.addEventListener(ev, onTap, { passive: true, capture: true });
  });

  // 8. WebSocket wrap — most live pool/Stratum data flows through WS, and
  //    "data went stale" without a console error is almost always a closed
  //    socket nobody noticed. Wrap the constructor; preserve prototype and
  //    static constants so `instanceof` and ws.OPEN-style checks still work.
  if (typeof window.WebSocket === 'function') {
    const OrigWS = window.WebSocket;
    function PatchedWS(url, protocols) {
      const ws = protocols !== undefined ? new OrigWS(url, protocols) : new OrigWS(url);
      const entry = {
        ws,
        url: _ssTruncate(String(url), 80),
        msgCount: 0,
        lastMsgTs: 0,
        openTs: 0,
        closeCode: null,
        closeReason: null,
      };
      _ssPushBounded(_ssDebug.wsInstances, entry, 10);
      ws.addEventListener('open',    () => { entry.openTs = Date.now(); });
      ws.addEventListener('message', (ev) => {
        entry.msgCount++;
        entry.lastMsgTs = Date.now();
        let size = 0;
        let type = '';
        try {
          if (typeof ev.data === 'string') {
            size = ev.data.length;
            const m = ev.data.match(/"(?:type|event|kind)"\s*:\s*"([^"]+)"/);
            if (m) type = m[1].slice(0, 40);
          } else if (ev.data && ev.data.byteLength != null) {
            size = ev.data.byteLength;
            type = 'binary';
          }
        } catch (_) { /* ignore */ }
        _ssPushBounded(_ssDebug.wsEvents, { ts: Date.now(), size, type }, 50);
      });
      ws.addEventListener('close',   (e) => { entry.closeCode = e.code; entry.closeReason = _ssTruncate(e.reason || '', 40); });
      return ws;
    }
    PatchedWS.prototype = OrigWS.prototype;
    PatchedWS.CONNECTING = OrigWS.CONNECTING;
    PatchedWS.OPEN       = OrigWS.OPEN;
    PatchedWS.CLOSING    = OrigWS.CLOSING;
    PatchedWS.CLOSED     = OrigWS.CLOSED;
    try { window.WebSocket = PatchedWS; } catch (_) { /* read-only env */ }
  }

  // 9. EventSource wrap — same idea for SSE-based feeds (less common but
  //    some pool APIs use it). Same caveats; we just count messages.
  if (typeof window.EventSource === 'function') {
    const OrigES = window.EventSource;
    function PatchedES(url, init) {
      const es = init !== undefined ? new OrigES(url, init) : new OrigES(url);
      const entry = { es, url: _ssTruncate(String(url), 80), msgCount: 0, lastMsgTs: 0, openTs: 0 };
      _ssPushBounded(_ssDebug.esInstances, entry, 5);
      es.addEventListener('open',    () => { entry.openTs = Date.now(); });
      es.addEventListener('message', () => { entry.msgCount++; entry.lastMsgTs = Date.now(); });
      return es;
    }
    PatchedES.prototype = OrigES.prototype;
    PatchedES.CONNECTING = OrigES.CONNECTING;
    PatchedES.OPEN       = OrigES.OPEN;
    PatchedES.CLOSED     = OrigES.CLOSED;
    try { window.EventSource = PatchedES; } catch (_) {}
  }

  // 10. PerformanceObserver(resource) — captures script/img/css/fetch entries
  //     that were slow (>500ms) or large (>100KB). Diagnoses CDN issues,
  //     unoptimized bundle splits, oversized images dragged in by mistake.
  try {
    if ('PerformanceObserver' in window) {
      const ro2 = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const dur = Math.round(entry.duration || 0);
          const size = entry.transferSize || 0;
          if (dur > 500 || size > 102400) {
            _ssPushBounded(_ssDebug.resources, {
              ts: Date.now(),
              name: _ssTruncate(entry.name || '', 80),
              dur,
              size,
              type: entry.initiatorType || 'other',
            }, 20);
          }
        }
      });
      ro2.observe({ entryTypes: ['resource'] });
    }
  } catch (_) {}

  // 11. Page visibility — counts every transition between visible/hidden.
  //     Spike in transitions correlates with iOS/Android suspend/resume,
  //     which is the most common cause of "the data froze" reports.
  try {
    _ssDebug.visibility.state = document.visibilityState;
    document.addEventListener('visibilitychange', () => {
      _ssDebug.visibility.transitions++;
      _ssDebug.visibility.lastChangeTs = Date.now();
      _ssDebug.visibility.state = document.visibilityState;
    }, { passive: true });
  } catch (_) {}

  // 12. Battery — async; subscribes to level/charging changes once and
  //     refreshes the cached struct. iOS Safari doesn't expose this; we
  //     just leave _ssDebug.battery null in that case.
  try {
    if (typeof navigator.getBattery === 'function') {
      navigator.getBattery().then((bm) => {
        const refresh = () => {
          _ssDebug.battery = {
            level: Math.round((bm.level || 0) * 100),
            charging: !!bm.charging,
            chargingTime: bm.chargingTime === Infinity ? '∞' : Math.round(bm.chargingTime / 60) + 'm',
            dischargingTime: bm.dischargingTime === Infinity ? '∞' : Math.round(bm.dischargingTime / 60) + 'm',
          };
        };
        refresh();
        ['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) =>
          bm.addEventListener(ev, refresh)
        );
      }).catch(() => {});
    }
  } catch (_) {}
}

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
      <span style={{ fontSize:'1.1rem', filter:'drop-shadow(0 0 4px rgba(255,59,59,0.8))', animation:'pulse 1.4s ease-in-out infinite', willChange:'opacity' }}>🚨</span>
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
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0, color:'var(--amber)', filter:'drop-shadow(0 0 6px rgba(245,166,35,0.55))', animation:'pulse 2.2s ease-in-out infinite', willChange:'opacity' }}>
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
      willChange: isCritical ? 'opacity' : 'auto',
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
function Header({ connected, status, onSettings, privateMode, minimalMode, performanceMode, zmq, blocksFound, retargetPct, retargetBlocks }) {
  const now = useNow(30000);
  const statusMap = { running:{c:'var(--green)',t:'MINING'}, mining:{c:'var(--green)',t:'MINING'}, no_address:{c:'var(--amber)',t:'SETUP'}, setup:{c:'var(--amber)',t:'SETUP'}, starting:{c:'var(--amber)',t:'STARTING'}, error:{c:'var(--red)',t:'ERROR'}, loading:{c:'var(--text-2)',t:'...'} };
  const st = statusMap[status] || statusMap.loading;
  // Retarget direction colors
  // v1.11.9: Retarget color semantics fixed to match RetargetPanel card.
  // Difficulty going UP (+%) makes mining HARDER → RED. Difficulty going
  // DOWN (-%) makes mining EASIER → GREEN. Header was previously inverted
  // (green for +, red for -), causing it to disagree with the card on the
  // same number. The card's framing — "do I want easy diff?" — is correct
  // from a solo miner's perspective and is now the consistent semantics
  // across the entire dashboard.
  const retargetColor = (retargetPct == null) ? 'var(--text-2)' : (retargetPct > 0 ? 'var(--red)' : retargetPct < 0 ? 'var(--green)' : 'var(--text-2)');
  const retargetSign = (retargetPct != null && retargetPct > 0) ? '+' : '';
  // v1.11.6: STRIKES celebration — when blocksFound increments (our install
  // just found a block!) pulse the badge dramatically. The rarest, most
  // important moment in solo mining gets a visceral visual reward.
  const [strikesPulseKey, setStrikesPulseKey] = useState(0);
  const prevBlocksRef = useRef(blocksFound);
  useEffect(() => {
    if (blocksFound != null && prevBlocksRef.current != null && blocksFound > prevBlocksRef.current) {
      setStrikesPulseKey(k => k + 1);
    }
    prevBlocksRef.current = blocksFound;
  }, [blocksFound]);
  return (
    <header style={{ ...STRIP_FULL_WIDTH, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 0.5rem', minHeight:58, borderBottom:'1px solid var(--border)', gap:'0.4rem' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', minWidth:0, flex:1, flexWrap:'wrap' }}>
        <img src="/pickaxe-icon.png" alt="⛏" draggable={false} style={{ width:18, height:18, objectFit:'contain', filter: (minimalMode||performanceMode)?'none':'drop-shadow(0 0 8px rgba(245,166,35,0.7))', animation: (minimalMode||performanceMode)?'none':'pulse 3s ease-in-out infinite', willChange: (minimalMode||performanceMode)?'auto':'opacity', flexShrink:0 }}/>
        <span style={{ fontFamily:'var(--fd)', fontSize:'0.92rem', fontWeight:700, letterSpacing:'0.06em', color:'var(--amber)', textTransform:'uppercase', flexShrink:0 }}>SoloStrike</span>
        {!minimalMode && (
          <>
            <div style={{ width:1, height:16, background:'var(--border)', flexShrink:0 }}/>
            <span style={{ fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.12em', textTransform:'uppercase', color:st.c, textShadow:`0 0 6px ${st.c}`, animation:'pulse 2s ease-in-out infinite', willChange:'opacity', flexShrink:0 }}>{st.t}</span>
            <ZmqBadge zmq={zmq}/>
            {privateMode && (
              <span title="Private Mode" style={{ display:'inline-flex', alignItems:'center', gap:3, color:'var(--cyan)', fontFamily:'var(--fd)', fontSize:'0.54rem', letterSpacing:'0.12em', textTransform:'uppercase', textShadow:'0 0 6px rgba(0,255,209,0.4)', animation:'pulse 3s ease-in-out infinite', willChange:'opacity', flexShrink:0, marginLeft:4 }}>🔒</span>
            )}
            {/* Strikes counter — total blocks found by this install */}
            {blocksFound != null && (
              <span key={strikesPulseKey} className={strikesPulseKey > 0 ? 'ss-strikes-celebrate' : ''} title="Total blocks struck" style={{ display:'inline-flex', alignItems:'center', gap:3, fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color: blocksFound > 0 ? 'var(--amber)' : 'var(--text-2)', textShadow: blocksFound > 0 ? '0 0 6px rgba(245,166,35,0.5)' : 'none', flexShrink:0, marginLeft:4 }}>
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
// v1.11.39 (Option B): CSS @keyframes with iteration-synchronized text update.
// Replaces the JS rAF version that caused visible "restart" stutters in sync
// with WS broadcasts (every 3s).
//
// HOW IT WORKS:
//   - Animation runs on GPU compositor thread (not main thread). No JS per
//     frame. Survives any main-thread stall, JSON.parse load, React reflow,
//     backdrop-filter layer re-rasterization, GC pauses, etc.
//   - Content is doubled `[text][text]` and animation is `0% → -50%`. The
//     visual content at -50% is identical to content at 0%, so the loop
//     wrap is invisible to the eye.
//   - `snapshotText` is held in a ref so React prop changes DO NOT
//     re-render the track DOM element. The CSS animation stays alive
//     indefinitely with stable element identity.
//   - When new snapshotText arrives, it's QUEUED. On the next
//     `animationiteration` event (fires at every loop wrap), we swap the
//     DOM textContent imperatively. The swap lands at the exact moment
//     the animation visually resets to 0% — so it just looks like the
//     ticker naturally cycled with slightly updated numbers.
//   - Result: zero visible "restart" event. Mining metrics tick at the
//     natural loop boundary, invisible to the user.
const Ticker = React.memo(function Ticker({ snapshotText, enabled, speedSec }) {
  const trackRef = useRef(null);
  const pendingTextRef = useRef(snapshotText || '');
  const currentTextRef = useRef(snapshotText || '');
  const duration = speedSec || DEFAULT_TICKER_SPEED;

  // Apply text to the DOM (doubled, with spacer). Bypasses React reconciliation
  // so the track element keeps the same identity → CSS animation never restarts.
  const applyText = (text) => {
    const track = trackRef.current;
    if (!track) return;
    const spacer = '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0'; // 6× &nbsp;
    track.textContent = `${text}${spacer}${text}${spacer}`;
    currentTextRef.current = text;
  };

  // Initial paint + iteration listener (mount once, never re-run during life)
  useEffect(() => {
    if (!enabled) return;
    const track = trackRef.current;
    if (!track) return;
    applyText(pendingTextRef.current);

    // Swap pending text into DOM at every animation loop boundary.
    // The boundary is where -50% wraps to 0% — content visually identical,
    // so swapping textContent here is invisible to the eye.
    const onIteration = () => {
      if (pendingTextRef.current !== currentTextRef.current) {
        applyText(pendingTextRef.current);
      }
      // v1.11.39: instrument iteration cadence for debug
      if (typeof window !== 'undefined' && window._ssDebug?.tickerFrames) {
        const dbg = window._ssDebug;
        dbg.tickerFrames.push({
          ts: Date.now(),
          iter: true,
          textLen: currentTextRef.current.length,
        });
        if (dbg.tickerFrames.length > 150) dbg.tickerFrames.shift();
      }
    };
    track.addEventListener('animationiteration', onIteration);
    return () => track.removeEventListener('animationiteration', onIteration);
  }, [enabled]);

  // Queue new text when prop changes. Actual DOM swap happens at the
  // next animation iteration boundary (invisible to the user).
  useEffect(() => {
    pendingTextRef.current = snapshotText || '';
    // If no animation running yet (initial paint), apply immediately
    if (!currentTextRef.current && snapshotText) {
      applyText(snapshotText);
    }
  }, [snapshotText]);

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
      <div
        ref={trackRef}
        className="ss-ticker-track"
        style={{
          whiteSpace:'nowrap',
          fontFamily:'var(--fd)',
          fontSize:'0.55rem',
          letterSpacing:'0.15em',
          color:'var(--text-2)',
          textTransform:'uppercase',
          display:'inline-block',
          flexShrink:0,
          willChange:'transform',
          // GPU-compositor CSS animation — runs independent of main thread.
          // Duration is set via inline style so user's speedSec preference
          // takes effect without rebuilding the stylesheet.
          animation: `ss-ticker-scroll ${duration}s linear infinite`,
        }}
      />
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
          background:'#000',
          border:'1px solid var(--btc-orange)',
          boxShadow:'0 0 8px var(--btc-orange-glow)',
          flexShrink:0,
        }}>
          <img src="/btc-glyph.png" alt="₿" width={12} height={12} style={{display:'block'}}/>
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
      <span style={{fontWeight:700, animation:'pulse 2s ease-in-out infinite', willChange:'opacity', flexShrink:0}}>⚠ BITCOIN CORE SYNCING</span>
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

// ── Hot-miner banner (v1.9.0) ────────────────────────────────────────────────
// Shows a single dismissible banner at the top of the screen when one or more
// workers report tempC ≥ TEMP_RED_C. The banner collapses multiple hot miners
// into one entry with a count + tap-to-expand. Mirrors the style/behavior of
// OfflineToasts so the two banners coexist visually. Dismissal is per-session
// (in component state) — re-mounts on next page reload.
function HotMinerBanner({ workers, aliases }) {
  const [dismissed, setDismissed] = useState(new Set());
  const [expanded, setExpanded]   = useState(false);

  const hot = (workers || []).filter(w => {
    if (!w || !w.live) return false;
    const t = w.live.tempC;
    return Number.isFinite(t) && t >= TEMP_RED_C;
  });
  const visible = hot.filter(w => !dismissed.has(w.name));
  if (visible.length === 0) return null;

  const dismiss = (name) => {
    setDismissed(prev => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  };

  const dismissAll = () => {
    setDismissed(new Set(visible.map(w => w.name)));
  };

  return (
    <div style={{
      position:'fixed', top:'calc(env(safe-area-inset-top) + 0.5rem)',
      left:'0.75rem', right:'0.75rem',
      zIndex:240,
      pointerEvents:'auto',
    }}>
      <div style={{
        background:'rgba(40,15,15,0.95)',
        border:'1px solid var(--red)',
        boxShadow:'0 0 16px rgba(255,77,77,0.35)',
        borderRadius:6,
        padding:'0.6rem 0.8rem',
        backdropFilter:'blur(6px)',
        WebkitBackdropFilter:'blur(6px)',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:'0.6rem'}}>
          <span style={{fontSize:18}}>🔥</span>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.62rem',letterSpacing:'0.1em',color:'var(--red)',textTransform:'uppercase'}}>
              {visible.length === 1
                ? `Hot miner: ${displayName(visible[0].name, aliases)} at ${Math.round(visible[0].live.tempC)}°C`
                : `${visible.length} miners running hot (≥${TEMP_RED_C}°C)`}
            </div>
            {visible.length > 1 && (
              <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',marginTop:2,cursor:'pointer'}}
                   onClick={()=>setExpanded(v=>!v)}>
                {expanded ? '▾ Tap to collapse' : '▸ Tap to expand'}
              </div>
            )}
          </div>
          <button onClick={dismissAll}
                  style={{background:'transparent',border:'none',color:'var(--text-2)',cursor:'pointer',
                          fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',padding:'2px 6px'}}>
            DISMISS
          </button>
        </div>
        {visible.length > 1 && expanded && (
          <div style={{marginTop:'0.5rem',paddingTop:'0.5rem',borderTop:'1px solid rgba(255,77,77,0.2)'}}>
            {visible.map(w => (
              <div key={w.name} style={{display:'flex',alignItems:'center',gap:'0.5rem',padding:'0.25rem 0'}}>
                <span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-1)',flex:1}}>
                  {displayName(w.name, aliases)}
                </span>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.7rem',color:'var(--red)',fontWeight:700}}>
                  {Math.round(w.live.tempC)}°C
                </span>
                <button onClick={()=>dismiss(w.name)}
                        style={{background:'transparent',border:'none',color:'var(--text-3)',cursor:'pointer',fontSize:14,padding:'0 4px'}}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
          // v1.8.3-rev27: stamp recoveredAt so the auto-dismiss interval can age
          // each banner independently. Previous per-effect setTimeout approach
          // reset timers whenever banners[] changed, so during flapping the
          // green banners never expired and piled up.
          next = next.slice();
          next[idx] = { ...next[idx], recovered:true, recoveredAt: Date.now() };
        }
        prevRef.current[w.name] = w.status;
      });
      return next;
    });
  }, [workers, aliases]);

  // v1.8.3-rev27: auto-dismiss recovered banners 5s after recoveredAt stamp.
  // Single 1s tick checks all recovered banners — robust against banner-array
  // changes since timestamps live on each banner, not as external timers.
  useEffect(() => {
    const tick = setInterval(() => {
      setBanners(curr => {
        const now = Date.now();
        const filtered = curr.filter(b => !b.recovered || (now - (b.recoveredAt || 0)) < 5000);
        return filtered.length === curr.length ? curr : filtered;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  const dismiss = (name) => setBanners(b => b.filter(x => x.name !== name));
  const dismissAll = () => setBanners([]);

  if (!banners.length) return null;

  const offlineBanners   = banners.filter(b => !b.recovered);
  const recoveredBanners = banners.filter(b => b.recovered);
  const offlineCount     = offlineBanners.length;

  return (
    <div style={{
      position:'fixed', top:'calc(env(safe-area-inset-top) + 4px)', left:'50%',
      transform:'translateX(-50%)', zIndex:1000, maxWidth:'min(96vw, 480px)',
      width:'calc(100% - 16px)', display:'flex', flexDirection:'column', gap:6,
      pointerEvents:'none',
    }}>
      {recoveredBanners.map(b => (
        <div key={b.name+':rec'} onClick={() => dismiss(b.name)} style={{
          pointerEvents:'auto',
          // v1.8.3-rev25: matched opaque background with the offline banner
          background:'rgba(6, 26, 12, 0.96)',
          backdropFilter:'blur(8px)',
          WebkitBackdropFilter:'blur(8px)',
          border:'1px solid rgba(57,255,106,0.5)',
          padding:'0.5rem 0.75rem', display:'flex', alignItems:'center', gap:'0.5rem',
          animation:'slideUp 0.3s ease both',
          boxShadow:'0 4px 18px rgba(0,0,0,0.6)',
          borderRadius:6,
          // v1.8.3-rev27: tap-to-dismiss for when banners pile up before
          // the 5-second auto-dismiss kicks in.
          cursor:'pointer',
          WebkitTapHighlightColor:'transparent',
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
          // v1.8.3-rev25: opaque background + backdrop blur so the banner is
          // legible even when overlapping the SOLOSTRIKE header. Previous
          // gradient was 5–18% opacity, letting header text bleed through.
          background:'rgba(28, 18, 4, 0.96)',
          backdropFilter:'blur(8px)',
          WebkitBackdropFilter:'blur(8px)',
          border:'1px solid rgba(245,166,35,0.55)',
          boxShadow:'0 4px 18px rgba(0,0,0,0.6), 0 0 14px rgba(245,166,35,0.18)',
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
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
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
          flex:'1 1 0', height: 'auto', minHeight: chartHeight,
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

      <div style={{
        display:'flex', justifyContent:'space-between', alignItems:'center',
        fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.13em',
        textTransform:'uppercase', color:'var(--text-3)',
        marginTop:5, flexShrink:0,
        gap:'8px', flexWrap:'wrap',
      }}>
        {/* v1.8.2-rev19: legend dots reference the same color tokens
            classify() returns (var(--green/amber/red)) — single source of
            truth. flexWrap on parent lets median drop to a second line on
            narrow viewports without growing the card or clipping the chart
            (chart is flex:1 and absorbs the change automatically). */}
        <div style={{display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap'}}>
          <span>Each bar = {bars.length > 0 && all.length > maxBars ? Math.ceil(filtered.length / maxBars) : 1} min</span>
          <span style={{display:'inline-flex', alignItems:'center', gap:'5px'}}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)', display:'inline-block', flexShrink:0}}/>
            Normal
          </span>
          <span style={{display:'inline-flex', alignItems:'center', gap:'5px'}}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'var(--amber)', display:'inline-block', flexShrink:0}}/>
            Anomaly
          </span>
          <span style={{display:'inline-flex', alignItems:'center', gap:'5px'}}>
            <span style={{width:6, height:6, borderRadius:'50%', background:'var(--red)', display:'inline-block', flexShrink:0}}/>
            Offline
          </span>
        </div>
        <span style={{color:'var(--text-2)', whiteSpace:'nowrap'}}>median ≈ {median > 0 ? (median >= 1 ? median.toFixed(1) + '/s' : (median * 60).toFixed(1) + '/m') : '—'}</span>
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
  // v1.11.6: animate the main Firepower hashrate number — the most-watched
  // number in the app. Smooth tween on change creates a "system is alive"
  // feel. Uses the same useAnimatedNumber hook as the Pulse modal.
  const animatedCurrent = useAnimatedNumber(current || 0);
  const [p0, p1] = fmtHr(animatedCurrent).split(' ');

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
      <div style={{ fontFamily:'var(--fd)', fontSize:numberSize, fontWeight:700, letterSpacing:'0.01em', lineHeight:1, marginBottom:numberMarginBottom, display:'flex', alignItems:'baseline', flexWrap:'wrap', gap:'0.4rem', fontVariantNumeric:'tabular-nums' }}>
        {/* rev62 premium pass — metallic gold gradient on hero hashrate
            number (the most-stared-at element in the app). Flat #F5A623
            amber → 3-stop gradient (#FFD27F → #F5A623 → #B27414) gives a
            brushed-gold weight that flat color can't reach. The numeric
            portion (p0) wears the gradient via background-clip:text; the
            unit (p1) stays solid amber-dim because units look better not
            metallic. text-shadow doesn't apply to clipped text so glow
            comes from filter:drop-shadow on the wrapper. */}
        <span style={{
          background:'linear-gradient(180deg, #FFD27F 0%, #F5A623 50%, #B27414 100%)',
          WebkitBackgroundClip:'text', backgroundClip:'text',
          WebkitTextFillColor:'transparent',
          filter:'drop-shadow(0 0 30px rgba(245,166,35,0.35))',
        }}>{p0}</span>
        <span style={{ fontSize: compact ? '0.85rem' : '1rem', color:'var(--amber-dim)', marginLeft:4 }}>{p1}</span>
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
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      {inner}
      <div style={{flex:1,minHeight:0}}/>
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

  // v1.11.6: pop-pop animation when online worker count changes.
  // Reinforces "fleet is alive" signal when a miner comes online/offline.
  const [workersPulseKey, setWorkersPulseKey] = useState(0);
  const prevOnlineRef = useRef(online);
  useEffect(() => {
    if (online !== prevOnlineRef.current) {
      prevOnlineRef.current = online;
      setWorkersPulseKey(k => k + 1);
    }
  }, [online]);

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)', flexShrink:0}}>
        <span>▸ The Crew</span>
        <span key={workersPulseKey} className={workersPulseKey > 0 ? 'ss-pop-pop' : ''} style={{color:'var(--amber)', marginRight:'14px', whiteSpace:'nowrap', display:'inline-block'}}>{online}/{sorted.length} online</span>
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
                {/* v1.10.0 #5: status dot uses .ss-status-dot for layered breath +
                    ping animation. healthC determines the color tier:
                    green (healthy) → breath + ping; amber (warm) → breath only;
                    red/offline → static (true "dead" indicator). Renamed from
                    .ss-dot to avoid collision with the carousel page-indicator
                    dots which also use .ss-dot. */}
                <span title={w.health||'unknown'}
                      className={
                        !on ? 'ss-status-dot ss-status-dot-red'
                        : healthC === 'var(--amber)' ? 'ss-status-dot ss-status-dot-amber'
                        : healthC === 'var(--red)'   ? 'ss-status-dot ss-status-dot-red'
                        : 'ss-status-dot ss-status-dot-green'
                      }/>
                <span title={w.minerType||'Unknown'} style={{fontSize:11,color:on?'var(--cyan)':'var(--text-3)',width:12,textAlign:'center',flexShrink:0}}>{icon}</span>
                {/* Middle: name + miner type stacked, with thin progress bar below */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:6,minWidth:0}}>
                    <span style={{fontFamily:'var(--fm)',fontSize:'0.72rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500,minWidth:0}} title={w.name}>{disp}</span>
                    {w.minerType && <span style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.08em',color:'var(--text-3)',textTransform:'uppercase',whiteSpace:'nowrap',flexShrink:0}}>{w.minerType}</span>}
                    {(() => {
                      // v1.9.0: tiny pool-alignment badge — only renders when
                      // miner-poller has produced a result. Tap the row to see
                      // full details + recheck.
                      const pa = w.poolAlignment;
                      if (!pa || !pa.status) return null;
                      const m = poolAlignMeta(pa.status);
                      if (!m) return null;
                      return (
                        <span title={m.label}
                              style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.06em',color:m.color,
                                      border:`1px solid ${m.color}`,borderRadius:2,padding:'0 4px',
                                      whiteSpace:'nowrap',flexShrink:0,opacity:0.85}}>
                          {m.glyph} {m.shortLabel}
                        </span>
                      );
                    })()}
                    {(() => {
                      // v1.9.6: temp display moved to right column (alongside
                      // hashrate + best share). Title row now keeps just the
                      // alignment badge to avoid double-displaying temp.
                      return null;
                    })()}
                  </div>
                  <div style={{display:'flex',gap:5,alignItems:'center',marginTop:2,minWidth:0}}>
                    <div style={{flex:1,height:1.5,background:'var(--bg-deep)',borderRadius:1,overflow:'hidden',minWidth:0}}>
                      <div style={{height:'100%',width:`${(workAccepted/totalWork)*100}%`,background:'var(--green)',borderRadius:1}}/>
                    </div>
                    <span style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-3)',whiteSpace:'nowrap',flexShrink:0}}>{lastShareAgo}</span>
                  </div>
                  {/* iter28-fix-B: 24h uptime sparkline */}
                  <div style={{marginTop:3, minWidth:0}}>
                    <UptimeSparkline history={w.statusHistory}/>
                  </div>
                </div>
                {/* Right: hashrate (top) + best-share (middle) + temp (bottom) */}
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:0,flexShrink:0,minWidth:48}}>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.72rem',fontWeight:700,color:on?'var(--amber)':'var(--text-2)',whiteSpace:'nowrap',lineHeight:1.1}}>
                    {on?fmtHr(w.hashrate):'offline'}
                  </span>
                  {w.bestshare>0 && (
                    <span style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--amber)',whiteSpace:'nowrap',opacity:0.8,lineHeight:1.2}}>
                      ★ {fmtDiff(w.bestshare)}
                    </span>
                  )}
                  {(() => {
                    // v1.9.7: temp on its own third line below best-share.
                    // Color tiers:
                    //   < 70°C  → green   (cool, normal)
                    //   70-75°C → cyan    (mild warm)
                    //   75-80°C → amber   (warm)
                    //   ≥ 80°C  → red 🔥  (hot)
                    // Hides when no live data — row stays compact for miners
                    // that aren't reachable (NO API).
                    const t = w.live?.tempC;
                    if (t == null || !Number.isFinite(t) || t <= 0) return null;
                    const tColor = t >= TEMP_RED_C   ? 'var(--red)'
                                 : t >= TEMP_AMBER_C ? 'var(--amber)'
                                 : t >= 70           ? 'var(--cyan)'
                                                     : 'var(--green)';
                    return (
                      <span style={{fontFamily:'var(--fm)',fontSize:'0.6rem',fontWeight:600,color:tColor,whiteSpace:'nowrap',lineHeight:1.2,marginTop:1}}>
                        {t >= TEMP_RED_C ? '🔥 ' : ''}{Math.round(t)}°C
                      </span>
                    );
                  })()}
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
  // iter28: avoid scientific notation — auto-scale precision for tiny pcts.
  const decimals = Math.min(10, Math.max(5, -Math.floor(Math.log10(pct)) + 1));
  return pct.toFixed(decimals) + '%';
}

function ClosestCallsPanel({ closestCalls, aliases, networkDifficulty }) {
  const list = closestCalls || [];
  if (!list.length) {
    return (
      <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
        <div style={{...cardTitle, color:'var(--amber)', flexShrink:0}}>▸ Near Strikes</div>
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.72rem',fontFamily:'var(--fd)'}}>
          Building leaderboard…<br/>
          <span style={{color:'var(--amber)',fontSize:'0.65rem'}}>Shares tracked as they come in</span>
        </div>
      </div>
    );
  }

  const netDiff = networkDifficulty && networkDifficulty > 0 ? networkDifficulty : null;

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)', flexShrink:0}}>
        <span>▸ Near Strikes</span>
        <span style={{color:'var(--amber)', fontFamily:'var(--fm)', fontSize:'0.6rem', letterSpacing:'0.08em', marginRight:'14px', whiteSpace:'nowrap'}}>fleet-wide</span>
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:'0.35rem', flex:1, minHeight:0, overflowY:'auto'}}>
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
                    <span style={{fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.08em', color:'var(--text-3)', textTransform:'uppercase', whiteSpace:'nowrap', flexShrink:0}}>
                      {c.minerType}
                    </span>
                  )}
                  <span style={{fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.10em', color:tier.color, textTransform:'uppercase', whiteSpace:'nowrap', flexShrink:0, fontWeight:700, textShadow: tier.glow ? `0 0 4px ${tier.color}` : 'none'}}>
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
  // Subsidy/fees breakdown and fee tiers live in the Hunt card — not duplicated here.
  const lb = latestBlock || {};
  const blkWeight = lb.weight || lb.blockWeight || null;
  const blkTxs    = lb.txCount || lb.txs || lb.tx_count || null;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, color:'var(--amber)', flexShrink:0}}>▸ Bitcoin Network</div>
      {[['Block Height', fmtNum(network?.height), 'var(--text-1)'],
        ['Difficulty', fmtDiff(network?.difficulty), 'var(--text-1)'],
        ['Net Hashrate', fmtHr(network?.hashrate), 'var(--cyan)']].map(([l,v,c])=>(
        <div key={l} style={statRow}>
          <span style={label}>{l}</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.95rem',fontWeight:600,color:c,textShadow:c==='var(--cyan)'?'0 0 10px rgba(0,255,209,0.3)':'none'}}>{v}</span>
        </div>
      ))}
      {/* iter26: latest block weight + tx count */}
      {(blkWeight || blkTxs) && (
        <>
          {blkWeight && (
            <div style={statRow}>
              <span style={label}>Block Weight</span>
              <span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--text-1)'}}>{fmtNum(blkWeight)} WU</span>
            </div>
          )}
          {blkTxs != null && (
            <div style={statRow}>
              <span style={label}>Block Txs</span>
              <span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--text-1)'}}>{fmtNum(blkTxs)}</span>
            </div>
          )}
        </>
      )}
      <div style={{height:1,background:'var(--border)',margin:'0.7rem 0',flexShrink:0}}/>
      {blockReward && (
        <div style={{...statRow, background:'var(--bg-deep)', borderColor:'rgba(245,166,35,0.25)'}}>
          <span style={{...label, color:'var(--amber)'}}>🏆 Next Block Prize</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'1.2rem',fontWeight:700,color:'var(--amber)',textShadow:'0 0 12px rgba(245,166,35,0.4)',textAlign:'right'}}>
            {fmtBtc(blockReward.totalBtc, 3)}
            {rewardUsd!=null && <div style={{fontFamily:'var(--fm)',fontSize:'0.75rem',color:'var(--green)',fontWeight:600,marginTop:2,textShadow:'0 0 8px rgba(57,255,106,0.2)'}}>{fmtFiat(rewardUsd, currency)}</div>}
          </span>
        </div>
      )}
      {!privateMode && price!=null && (
        <div style={statRow}>
          <span style={label}>BTC Price</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.95rem',fontWeight:600,color:'var(--cyan)'}}>{fmtFiat(price, currency)}</span>
        </div>
      )}
      {mempool?.totalFeesBtc>0 && (
        <div style={statRow}>
          <span style={label}>Mempool Fees</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--amber)'}}>{fmtBtc(mempool.totalFeesBtc, 2)}</span>
        </div>
      )}
      {privateMode && (
        <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--cyan)',marginTop:'0.5rem',textAlign:'center',letterSpacing:'0.1em'}}>
          🔒 PRICE HIDDEN — PRIVATE MODE
        </div>
      )}
      <div style={{flex:1,minHeight:0}}/>
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
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, color:'var(--amber)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0}}>
        <span>▸ Bitcoin Node</span>
        <span style={{display:'inline-flex', alignItems:'center', gap:5, color: connected?'var(--green)':'var(--red)', fontSize:'0.55rem', letterSpacing:'0.12em'}}>
          <span style={{width:6, height:6, borderRadius:'50%', background: connected?'var(--green)':'var(--red)', boxShadow: `0 0 6px ${connected?'var(--green)':'var(--red)'}`, animation: connected?'pulse 2s ease-in-out infinite':'none', willChange: connected?'opacity':'auto'}}/>
          {connected ? 'CONNECTED' : 'OFFLINE'}
        </span>
      </div>
      <div style={statRow}>
        <span style={label}>Client</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--text-1)',textAlign:'right', minWidth:0, overflow:'hidden'}}>
          {client.name}
          {client.version && <div style={{fontSize:'0.65rem',color:'var(--text-2)',marginTop:2}}>v{client.version}</div>}
          {/* iter26: full subversion string (typically /Satoshi:29.2.0/) when present */}
          {ni.subversion && <div style={{fontSize:'0.6rem',color:'var(--text-3)',marginTop:1, fontFamily:'var(--fm)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'14rem'}}>{ni.subversion.replace(/^\/|\/$/g,'')}</div>}
        </span>
      </div>
      <div style={statRow}>
        <span style={label}>Peers</span>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.95rem',fontWeight:600,color:'var(--cyan)'}}>
          {fmtNum(ni.peers || 0)}
          {(ni.peersIn > 0 || ni.peersOut > 0) && <span style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-2)',fontWeight:400,marginLeft:6}}>{ni.peersOut}↑ · {ni.peersIn}↓</span>}
        </span>
      </div>
      <div style={statRow}><span style={label}>Relay Fee</span><span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--amber)'}}>{relayStr}</span></div>
      <div style={statRow}><span style={label}>Mempool TXs</span><span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--text-1)'}}>{fmtNum(ni.mempoolCount || 0)}</span></div>
      <div style={statRow}><span style={label}>Mempool Size</span><span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--cyan)'}}>{fmtBytes(ni.mempoolBytes || 0)}</span></div>
      <div style={{flex:1,minHeight:0}}/>
    </div>
  );
}

// ── Strike Odds ───────────────────────────────────────────────────────────────
// ── The Hunt — Block Potential card (v1.7.6) ─────────────────────────────
// Replaces the old "Strike Odds" card. Fuses Strike Odds' orbital gauge with
// reward breakdown (subsidy + fees), expected daily sats, and live fee tier
// strip. Tap to open The Reckoning. Same readability standard as Strikers/
// Reckoning modals (no var(--text-3) ghost gray, body text >= 0.7rem).
// ── NonceField — Bitcoin-native visualization for The Hunt (iter27c) ─────
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
function NonceField({ hashrate, huntAnim, performanceMode }) {
  const canvasRef = useRef(null);
  const lightningGLCanvasRef = useRef(null);   // rev54: WebGL canvas for lightning mode
  const lightningGLRef = useRef(null);          // rev54: WebGL renderer instance
  const nonceFieldGLCanvasRef = useRef(null);   // rev55+: WebGL canvas for noncefield (particle stream)
  const nonceFieldGLRef = useRef(null);          // rev55+: WebGL renderer instance
  const containerRef = useRef(null);
  const animRef = useRef(0);
  const dimsRef = useRef({ w: 600, h: 130, dpr: 1 });
  // Per-animation state refs (each only initialized when its animation runs)
  const cellsRef = useRef(null);             // nonce field cells
  const strikeRef = useRef({ active: false, t: 0, x: 0, y: 0 });
  const scanXRef = useRef(0);
  const lightningRef = useRef({ bolts: null, megaBolt: null });
  const pickaxeRef = useRef({ strikes: null, megaStrike: null });
  // v1.11.x: ticker state. Same pattern as constellation-2d.js — persists
  // canvas-local arrays under refs so the animation useEffect doesn't need
  // to rebuild on every prop change.
  const tickerColumnsRef = useRef(null);
  const tickerWinnerAccumRef = useRef(0);
  // v1.11.x: Block-found celebration moved to a proper full-screen BFM
  // celebration (drawBFMTicker) matching the format of the other animations.
  // The in-card overlay was dropped — it duplicated the BFM modal's purpose
  // and didn't match the established celebration format.
  const lastFrameRef = useRef(performance.now());
  const hrRef = useRef(hashrate || 0);
  const huntAnimRef = useRef(huntAnim || 'noncefield');

  // Keep latest props accessible inside the rAF loop without triggering re-mount
  useEffect(() => {
    hrRef.current = hashrate || 0;
  }, [hashrate]);
  useEffect(() => { huntAnimRef.current = huntAnim || 'noncefield'; }, [huntAnim]);

  // v1.11.39: Performance Mode ref — checked inside the rAF body to bail
  // out of heavy draw work without restarting the loop. Live updates via
  // useEffect mean the toggle takes effect on the next frame (<16ms).
  const perfModeRef = useRef(!!performanceMode);
  useEffect(() => { perfModeRef.current = !!performanceMode; }, [performanceMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // v1.11.x: Visibility gate. The carousel keeps non-active panels mounted
    // (transformed off-screen) so React doesn't pay re-mount cost on slide
    // changes — but the rAF loop continues running, burning GPU + battery
    // for animations the user can't see. IntersectionObserver flips a ref
    // when the panel intersects the viewport; the draw loop checks the
    // ref and skips the heavy body when off-screen, while still scheduling
    // the next frame so animation resumes instantly on scroll-back. A
    // small threshold (0.01) avoids flicker at edges.
    //
    // CRITICAL: Observe `container`, NOT `canvas`. When huntAnim ===
    // 'lightning' the 2D canvas is set to `display: none` (the WebGL
    // canvas is shown instead). IntersectionObserver reports any
    // display:none element as NOT intersecting, which would freeze the
    // lightning draw permanently. The container holds both canvases and
    // is always rendered, so observing it gives accurate viewport state
    // regardless of which animation is active.
    const isVisibleRef = { current: true };
    let intersectionObserver = null;
    if (typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver((entries) => {
        for (const e of entries) isVisibleRef.current = e.isIntersecting;
      }, { threshold: 0.01 });
      intersectionObserver.observe(container);
    }

    // Nonce-field grid params (only used by 'noncefield' draw fn)
    const COLS = 32;
    const ROWS = 6;
    const TOTAL_CELLS = COLS * ROWS;
    if (!cellsRef.current || cellsRef.current.length !== TOTAL_CELLS) {
      cellsRef.current = new Float32Array(TOTAL_CELLS);
    }

    const resize = () => {
      // v1.8.5: read actual container height (mirrors Pulse pattern at line ~5499).
      // Previously hardcoded 130, which kept the canvas backing-store fixed even
      // when the wrapping container had grown taller. With HuntPanel now letting
      // this container flex-grow into the leftover card space, we must size the
      // canvas to the rendered rect or the bottom of the visible area would be
      // empty / clipped.
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cssWidth  = Math.max(120, rect.width);
      const cssHeight = Math.max(80,  rect.height);
      canvas.style.width  = cssWidth  + 'px';
      canvas.style.height = cssHeight + 'px';
      canvas.width  = Math.round(cssWidth  * dpr);
      canvas.height = Math.round(cssHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dimsRef.current = { w: cssWidth, h: cssHeight, dpr };
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // ─── Nonce Field (original) ───────────────────────────────────────────
    const drawNonceField = (dt, W, H) => {
      const cells = cellsRef.current;
      // Decay all cells slowly
      const decay = Math.min(1, dt * 1.4);
      for (let i = 0; i < cells.length; i++) {
        if (cells[i] > 0) cells[i] = Math.max(0, cells[i] - decay * cells[i]);
      }
      const ths = (hrRef.current || 0) / 1e12;
      const cellsPerSec = ths > 0 ? Math.min(160, 18 + ths * 1.2) : 4;
      const expectedSpawns = cellsPerSec * dt;
      let spawns = Math.floor(expectedSpawns);
      if (Math.random() < (expectedSpawns - spawns)) spawns += 1;
      for (let i = 0; i < spawns; i++) {
        const idx = Math.floor(Math.random() * TOTAL_CELLS);
        cells[idx] = Math.min(1, cells[idx] + 0.6 + Math.random() * 0.4);
      }
      scanXRef.current = (scanXRef.current + dt / 6) % 1;
      const scanX = scanXRef.current * W;
      const cellW = W / COLS;
      const cellH = H / ROWS;
      const dotMaxR = Math.min(cellW, cellH) * 0.32;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c;
          const x = c * cellW + cellW / 2;
          const y = r * cellH + cellH / 2;
          const v = cells[idx];
          const distToScan = Math.abs(x - scanX);
          const scanBoost = distToScan < cellW * 1.5 ? (1 - distToScan / (cellW * 1.5)) * 0.25 : 0;
          const lit = Math.min(1, v + scanBoost);
          if (lit < 0.05) {
            ctx.fillStyle = 'rgba(120, 90, 30, 0.18)';
            ctx.beginPath(); ctx.arc(x, y, dotMaxR * 0.35, 0, Math.PI * 2); ctx.fill();
          } else {
            const alpha = 0.25 + lit * 0.75;
            ctx.fillStyle = `rgba(245, 166, 35, ${alpha})`;
            ctx.shadowColor = 'rgba(245, 166, 35, 0.6)';
            ctx.shadowBlur = lit > 0.7 ? 8 : 4;
            ctx.beginPath(); ctx.arc(x, y, dotMaxR * (0.45 + lit * 0.55), 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
          }
        }
      }
      // Strike — rare bright burst
      if (!strikeRef.current.active && ths > 0) {
        const strikeRate = Math.min(0.25, 0.04 + ths * 0.0015);
        if (Math.random() < strikeRate * dt) {
          const idx = Math.floor(Math.random() * TOTAL_CELLS);
          const r = Math.floor(idx / COLS);
          const c = idx % COLS;
          strikeRef.current = { active: true, t: 0, x: c * cellW + cellW / 2, y: r * cellH + cellH / 2 };
          cells[idx] = 1;
        }
      }
      if (strikeRef.current.active) {
        const s = strikeRef.current;
        s.t += dt;
        const life = 0.55;
        if (s.t > life) { s.active = false; }
        else {
          const p = s.t / life;
          const ringR = 3 + p * 30;
          const ringAlpha = (1 - p) * 0.85;
          ctx.strokeStyle = `rgba(255, 220, 140, ${ringAlpha})`;
          ctx.lineWidth = 1.4;
          ctx.shadowColor = 'rgba(255, 210, 122, 0.75)';
          ctx.shadowBlur = 10;
          ctx.beginPath(); ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2); ctx.stroke();
          ctx.shadowBlur = 0;
          const burstAlpha = (1 - p) * 0.95;
          ctx.fillStyle = `rgba(255, 240, 200, ${burstAlpha})`;
          ctx.shadowColor = 'rgba(255, 240, 200, 0.9)';
          ctx.shadowBlur = 16;
          ctx.beginPath(); ctx.arc(s.x, s.y, 2.5 + (1 - p) * 2, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
        }
      }
      // Scan line itself
      const scanGrad = ctx.createLinearGradient(scanX - 4, 0, scanX + 4, 0);
      scanGrad.addColorStop(0, 'rgba(245, 166, 35, 0)');
      scanGrad.addColorStop(0.5, 'rgba(245, 166, 35, 0.18)');
      scanGrad.addColorStop(1, 'rgba(245, 166, 35, 0)');
      ctx.fillStyle = scanGrad;
      ctx.fillRect(scanX - 4, 0, 8, H);
    };

    // ─── Lightning Strike Field ───────────────────────────────────────────
    // Crackling bolts of lightning fork down the canvas. Most are thin pale
    // strikes; rare gold mega-bolt is thicker and longer-lived = "strike".
    const drawLightning = (dt, W, H) => {
      const ths = (hrRef.current || 0) / 1e12;
      if (!lightningRef.current.bolts) lightningRef.current.bolts = [];
      const bolts = lightningRef.current.bolts;

      // Generate a jagged zigzag from (sx, sy=0) down to ~H, with optional fork.
      const genBolt = (sx, sy, gold) => {
        const pts = [{ x: sx, y: sy }];
        let x = sx, y = sy;
        const targetY = H + 4;
        const jitter = 0.55;
        const stepMin = gold ? 5 : 4;
        const stepRange = gold ? 9 : 8;
        while (y < targetY) {
          const dy = stepMin + Math.random() * stepRange;
          y += dy;
          x += (Math.random() - 0.5) * jitter * dy;
          pts.push({ x, y });
        }
        // Optional single fork from a midpoint
        let fork = null;
        if (Math.random() < (gold ? 0.85 : 0.35) && pts.length > 4) {
          const fi = 2 + Math.floor(Math.random() * (pts.length - 4));
          const fp = pts[fi];
          const fpts = [{ x: fp.x, y: fp.y }];
          let fx = fp.x, fy = fp.y;
          const dir = Math.random() < 0.5 ? -1 : 1;
          const flen = 3 + Math.floor(Math.random() * 5);
          for (let i = 0; i < flen; i++) {
            const dy = stepMin + Math.random() * stepRange;
            fy += dy;
            fx += dir * (1.5 + Math.random() * 2.0);
            fpts.push({ x: fx, y: fy });
            if (fy > targetY) break;
          }
          fork = fpts;
        }
        return { pts, fork };
      };

      // Spawn rate scales with hashrate
      const spawnRate = 1.5 + Math.min(8, ths * 0.08); // bolts per second
      const expected = spawnRate * dt;
      let toSpawn = Math.floor(expected) + (Math.random() < (expected - Math.floor(expected)) ? 1 : 0);
      for (let i = 0; i < toSpawn; i++) {
        const sx = 8 + Math.random() * (W - 16);
        const isGold = Math.random() < 0.05;
        const b = genBolt(sx, 0, isGold);
        bolts.push({
          pts: b.pts, fork: b.fork,
          life: 0,
          maxLife: isGold ? 0.65 : 0.32,
          gold: isGold,
        });
      }

      // Update + draw bolts
      for (let i = bolts.length - 1; i >= 0; i--) {
        const b = bolts[i];
        b.life += dt;
        if (b.life >= b.maxLife) { bolts.splice(i, 1); continue; }
        const p = b.life / b.maxLife;
        // Bolt stays bright then snaps off
        const alpha = p < 0.25 ? 1 : Math.pow(1 - (p - 0.25) / 0.75, 0.7);
        if (b.gold) {
          ctx.strokeStyle = `rgba(255, 235, 170, ${alpha})`;
          ctx.shadowColor = 'rgba(255, 220, 130, 0.95)';
          ctx.shadowBlur = 14;
          ctx.lineWidth = 2.0;
        } else {
          ctx.strokeStyle = `rgba(245, 200, 110, ${alpha * 0.85})`;
          ctx.shadowColor = 'rgba(245, 166, 35, 0.6)';
          ctx.shadowBlur = 6;
          ctx.lineWidth = 1.1;
        }
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Main path
        ctx.beginPath();
        ctx.moveTo(b.pts[0].x, b.pts[0].y);
        for (let j = 1; j < b.pts.length; j++) ctx.lineTo(b.pts[j].x, b.pts[j].y);
        ctx.stroke();

        // Fork branch
        if (b.fork && b.fork.length > 1) {
          ctx.lineWidth = b.gold ? 1.4 : 0.8;
          ctx.beginPath();
          ctx.moveTo(b.fork[0].x, b.fork[0].y);
          for (let j = 1; j < b.fork.length; j++) ctx.lineTo(b.fork[j].x, b.fork[j].y);
          ctx.stroke();
        }

        // Bright origin dot
        if (b.gold) {
          ctx.fillStyle = `rgba(255, 240, 200, ${alpha})`;
          ctx.shadowColor = 'rgba(255, 240, 200, 1)';
          ctx.shadowBlur = 12;
          ctx.beginPath(); ctx.arc(b.pts[0].x, b.pts[0].y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.shadowBlur = 0;
      }
    };

    // ─── Pickaxe Strike Field ────────────────────────────────────────────
    // Pickaxe icons appear at random spots across a dark field. Each strike
    // leaves a fading impact crater glow. Rare gold strike with shockwave.
    const drawPickaxe = (dt, W, H) => {
      // v1.8.5-rev70e: clear instead of fill so the card surface shows
      // through. Was: fillStyle '#0e1218' + fillRect (cool tint specific to
      // pickaxe). The brown handle now reads against the card's bg-raised
      // gradient instead of a custom backdrop.
      ctx.clearRect(0, 0, W, H);

      const ths = (hrRef.current || 0) / 1e12;
      if (!pickaxeRef.current.strikes) pickaxeRef.current.strikes = [];
      const strikes = pickaxeRef.current.strikes;

      // rev61: 1.25× speed multiplier across the lifecycle. Spawn rate scaled
      // up; per-strike maxLife scaled down — both compound so the swing AND
      // the cadence feel ~25% snappier.
      const SPEED_MULT = 1.25;
      const spawnRate = (1.4 + Math.min(7, ths * 0.07)) * SPEED_MULT;
      const expected = spawnRate * dt;
      let toSpawn = Math.floor(expected) + (Math.random() < (expected - Math.floor(expected)) ? 1 : 0);
      for (let i = 0; i < toSpawn; i++) {
        const isGold = Math.random() < 0.05;
        // rev61: pre-bake polygon shard shapes at spawn (each strike gets
        // 7-11 unique irregular polygons — like real rock fragments).
        const numShards = 7 + Math.floor(Math.random() * 5);
        const shards = [];
        for (let k = 0; k < numShards; k++) {
          const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.2;
          const speed = 30 + Math.random() * 55;
          const sz = 1.2 + Math.random() * 1.8;
          const numVerts = 3 + Math.floor(Math.random() * 3);
          const verts = [];
          for (let v = 0; v < numVerts; v++) {
            const vAng = (v / numVerts) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
            const vR = sz * (0.6 + Math.random() * 0.7);
            verts.push({ x: Math.cos(vAng) * vR, y: Math.sin(vAng) * vR });
          }
          shards.push({
            vx: Math.cos(ang) * speed,
            vy: Math.sin(ang) * speed - 18,
            sz, verts,
            rot: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 14,
            shade: Math.random(),
          });
        }
        strikes.push({
          x: 22 + Math.random() * (W - 44),
          y: 18 + Math.random() * (H - 36),
          life: 0,
          maxLife: (isGold ? 1.8 : 1.1) / SPEED_MULT,
          gold: isGold,
          size: isGold ? 28 : 22,
          blockSize: isGold ? 18 : 13,
          shards,                                      // rev61: pre-baked shard polygons
        });
      }

      for (let i = strikes.length - 1; i >= 0; i--) {
        const s = strikes[i];
        s.life += dt;
        if (s.life >= s.maxLife) { strikes.splice(i, 1); continue; }
        const p = s.life / s.maxLife;

        // Phase boundaries
        const blockIn = Math.min(1, p / 0.20);
        const swingFrom = 0.40, swingTo = 0.55;
        const swing = Math.max(0, Math.min(1, (p - swingFrom) / (swingTo - swingFrom)));
        const strike = p >= swingTo ? Math.min(1, (p - swingTo) / 0.30) : 0;
        const fadeOut = Math.max(0, (p - 0.70) / 0.30);

        const blockAlpha = blockIn * (1 - fadeOut * 0.85);
        let blockScale = 0.6 + 0.4 * blockIn;
        if (swing >= 1 && strike < 0.4) {
          blockScale *= 1 + Math.sin(strike / 0.4 * Math.PI) * 0.25;
        }
        const bs = s.blockSize * blockScale;

        // ── ORANGE BTC BLOCK with halo ──
        if (blockAlpha > 0.05) {
          const haloR = bs * 1.3;
          const haloAlpha = blockAlpha * 0.35 * (s.gold ? 1.4 : 1.0);
          const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
          halo.addColorStop(0, `rgba(255, 165, 60, ${haloAlpha})`);
          halo.addColorStop(0.5, `rgba(247, 147, 26, ${haloAlpha * 0.5})`);
          halo.addColorStop(1, 'rgba(247, 147, 26, 0)');
          ctx.fillStyle = halo;
          ctx.beginPath(); ctx.arc(s.x, s.y, haloR, 0, Math.PI * 2); ctx.fill();

          ctx.save();
          ctx.globalAlpha = blockAlpha;
          const bx = s.x - bs / 2, by = s.y - bs / 2;
          const r = Math.max(2, bs * 0.16);
          const g = ctx.createLinearGradient(bx, by, bx + bs, by + bs);
          g.addColorStop(0, s.gold ? '#FFE4A0' : '#FFB347');
          g.addColorStop(0.45, s.gold ? '#FFC85A' : '#FF8C1A');
          g.addColorStop(1, s.gold ? '#A0680A' : '#C95800');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(bx + r, by);
          ctx.lineTo(bx + bs - r, by);
          ctx.quadraticCurveTo(bx + bs, by, bx + bs, by + r);
          ctx.lineTo(bx + bs, by + bs - r);
          ctx.quadraticCurveTo(bx + bs, by + bs, bx + bs - r, by + bs);
          ctx.lineTo(bx + r, by + bs);
          ctx.quadraticCurveTo(bx, by + bs, bx, by + bs - r);
          ctx.lineTo(bx, by + r);
          ctx.quadraticCurveTo(bx, by, bx + r, by);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = `rgba(255, 220, 150, ${blockAlpha * 0.4})`;
          ctx.lineWidth = 0.8;
          ctx.stroke();
          if (strike > 0.2) {
            const crackAlpha = (strike - 0.2) * 1.5 * (1 - fadeOut);
            ctx.strokeStyle = `rgba(80, 30, 0, ${crackAlpha * 0.65})`;
            ctx.lineWidth = 0.7;
            ctx.beginPath();
            ctx.moveTo(s.x - bs * 0.3, s.y - bs * 0.1);
            ctx.lineTo(s.x + bs * 0.1, s.y + bs * 0.2);
            ctx.lineTo(s.x + bs * 0.3, s.y - bs * 0.05);
            ctx.stroke();
          }
          ctx.restore();
        }

        // (NO crater)

        // Gold shockwave ring
        if (s.gold && strike > 0 && strike < 0.7) {
          const ringR = 6 + strike * 36;
          const ringAlpha = (1 - strike / 0.7) * 0.85;
          ctx.strokeStyle = `rgba(255, 220, 140, ${ringAlpha})`;
          ctx.lineWidth = 1.5;
          ctx.shadowColor = 'rgba(255, 220, 140, 0.8)';
          ctx.shadowBlur = 8;
          ctx.beginPath(); ctx.arc(s.x, s.y, ringR, 0, Math.PI * 2); ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // ── rev61: POLYGON SHARDS on impact ──
        if (s.shards && strike > 0) {
          const shardElapsed = strike * 0.30 * s.maxLife;
          const shardLife = 0.85;
          for (const sh of s.shards) {
            const px = s.x + sh.vx * shardElapsed;
            const py = (s.y - bs * 0.2) + sh.vy * shardElapsed + 0.5 * 200 * shardElapsed * shardElapsed;
            const alpha = Math.max(0, 1 - shardElapsed / shardLife) * (1 - fadeOut);
            if (alpha < 0.05) continue;
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(sh.rot + sh.spin * shardElapsed);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = sh.shade < 0.33 ? '#FFC25A' : sh.shade < 0.66 ? '#FF8C1A' : '#C9500F';
            ctx.beginPath();
            ctx.moveTo(sh.verts[0].x, sh.verts[0].y);
            for (let v = 1; v < sh.verts.length; v++) ctx.lineTo(sh.verts[v].x, sh.verts[v].y);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = `rgba(40,15,0,${alpha * 0.85})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
            ctx.restore();
          }
        }

        // ── PICKAXE: rise → hold wound back → swing down → impact → fade ──
        const pickaxeAlpha = blockIn * (1 - fadeOut);
        if (pickaxeAlpha > 0.05) {
          let yOffset, xOffset, rotation;
          if (p < 0.20) {
            yOffset = -s.size * (0.4 + blockIn * 1.0);
            xOffset = s.size * 0.25 * blockIn;
            rotation = -0.7;
          } else if (p < swingFrom) {
            const wob = Math.sin((p - 0.20) * 14) * 0.04;
            yOffset = -s.size * 1.4;
            xOffset = s.size * 0.25;
            rotation = -0.7 + wob;
          } else if (p < swingTo) {
            const eased = swing * swing;
            yOffset = -s.size * 1.4 * (1 - eased);
            xOffset = s.size * 0.25 * (1 - eased);
            rotation = -0.7 + eased * 1.1;
          } else {
            yOffset = -fadeOut * s.size * 0.5;
            xOffset = 0;
            rotation = 0.4;
          }

          ctx.save();
          ctx.translate(s.x + xOffset, s.y + yOffset);
          ctx.rotate(rotation);
          ctx.globalAlpha = pickaxeAlpha;
          // Sharper rendering: no shadow blur, high-quality smoothing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          if (__pickaxeReady) {
            ctx.drawImage(__pickaxeImg, -s.size / 2, -s.size / 2, s.size, s.size);
          } else {
            const sz = s.size;
            ctx.strokeStyle = s.gold ? 'rgba(255, 235, 170, 1)' : 'rgba(220, 200, 170, 1)';
            ctx.lineCap = 'round';
            ctx.lineWidth = sz * 0.13;
            ctx.beginPath();
            ctx.moveTo(-sz * 0.35, sz * 0.35);
            ctx.lineTo(sz * 0.30, -sz * 0.30);
            ctx.stroke();
            ctx.lineWidth = sz * 0.18;
            ctx.beginPath();
            ctx.moveTo(sz * 0.10, -sz * 0.42);
            ctx.lineTo(sz * 0.50, -sz * 0.18);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          ctx.restore();
        }
      }
    };

    // ─── Hash Ticker (Matrix Rain) ──────────────────────────
    // v1.11.x: ported from PulsePanel. Hashrate-driven hex/BTC-glyph rain
    // with periodic gold "winner" highlights. State held on tickerColumnsRef
    // (per-column drop arrays) and tickerWinnerAccumRef (accumulator for
    // periodic winner spawns). Block-found events fire the full-screen
    // BFM modal (drawBFMTicker) — the in-card surface stays as the
    // running hash rain only.
    const HEX_CHARS = '0123456789abcdef';
    const drawTicker = (dt, W, H) => {
      // v1.11.x: BTC symbols are hardcoded ON (no toggle). Winner drops
      // and gold-idx positions render as Bitcoin (₿) glyph; other positions
      // render as hex characters. Decided to drop the toggle entirely —
      // one less knob, and the BTC glyphs make the ticker feel like
      // "Bitcoin streaming through your fleet" which is the point.
      if (!tickerColumnsRef.current) tickerColumnsRef.current = [];
      const columns = tickerColumnsRef.current;

      const CHAR_W = 9;
      const CHAR_H = 11;

      // Hunt animations don't have an "enabled" flag like Pulse did
      // (Pulse's enabled=false dimmed everything when network broadcasting
      // was off). Hunt's ticker is always-on — it visualizes your hashrate
      // which always exists. Hardcoding enabled=true.
      const ths = (hrRef.current || 0) / 1e12;
      const maxColumns = Math.floor(W / CHAR_W);
      const columnCount = Math.min(maxColumns, 10 + Math.floor(ths * 0.4));
      const fallSpeed = 35 + Math.min(120, ths * 0.8);
      const winnerRate = 0.3 + Math.min(8, ths * 0.04);

      while (columns.length < columnCount) {
        columns.push({ drops: [], spawnAccum: Math.random() });
      }
      while (columns.length > columnCount) columns.pop();
      const spacing = columnCount > 0 ? W / columnCount : W;
      for (let i = 0; i < columns.length; i++) {
        columns[i].x = spacing * i + spacing / 2;
      }

      tickerWinnerAccumRef.current += dt * winnerRate;
      while (tickerWinnerAccumRef.current >= 1) {
        tickerWinnerAccumRef.current -= 1;
        if (columns.length > 0) {
          const col = columns[Math.floor(Math.random() * columns.length)];
          if (col.drops.length > 0) {
            col.drops[0].isWinner = true;
            col.drops[0].winnerLife = 0;
          }
        }
      }

      const rowsOnScreen = Math.max(8, Math.floor(H / CHAR_H));
      const maxDropsPerCol = Math.max(3, Math.ceil(rowsOnScreen / 2.5));
      const spawnGap = Math.max(0.25, 1.6 / (rowsOnScreen / 8));

      for (const col of columns) {
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

      for (const col of columns) {
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
              r = 255; g = 215; b = 90;
              a = (i === len - 1 ? 1 : 0.7 - fromHead * 0.6) * winnerFade;
              ctx.shadowColor = `rgba(${r},${g},${b},0.8)`;
              ctx.shadowBlur = 6;
            } else {
              // v1.11.x: non-winner hex characters use amber instead of
              // cool blue-grey. Head of drop is bright amber, trail fades
              // to deep amber. Winners (255,215,90 gold) still stand out
              // because they're more saturated yellow vs the warmer amber
              // here, plus they get the shadowBlur halo. Whole ticker now
              // reads as a warm cascade rather than a cyberpunk Matrix.
              if (i === len - 1) { r = 240; g = 180; b = 80; a = 0.90; }
              else { r = 160; g = 110; b = 45; a = (1 - fromHead * 0.85) * 0.60; }
              ctx.shadowBlur = 0;
            }
            ctx.fillStyle = `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`;
            // BTC glyph at winner-head and gold-idx positions; hex char elsewhere
            const showGlyph = (
              (d.isWinner && i === len - 1) ||
              (!d.isWinner && d.goldIdx === i && d.y > 0)
            );
            if (showGlyph) {
              drawBtcGlyph(ctx, col.x, charY, 11);
            } else {
              ctx.fillText(d.chars[i], col.x, charY);
            }
          }
        }
      }
      ctx.shadowBlur = 0;
    };

    const draw = (now) => {
      const dt = Math.min(0.1, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;

      // v1.11.x: Skip heavy draw work when panel is off-screen (carousel
      // non-active slot) or page is hidden. Still schedule next frame so
      // animation resumes immediately on scroll-back / focus-return.
      if (!isVisibleRef.current || (typeof document !== 'undefined' && document.hidden)) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }
      // Self-heal stale dims. v1.8.8-rev15: in vertical-scroll (non-carousel)
      // mode the parent flex chain occasionally finishes laying out AFTER the
      // initial ResizeObserver callback fires, leaving dimsRef pointing at the
      // 600×130 default. Detect mismatch and re-measure inline.
      const live = container.getBoundingClientRect();
      if (live.width >= 60 && live.height >= 60
          && (Math.abs(live.width  - dimsRef.current.w) > 2
           || Math.abs(live.height - dimsRef.current.h) > 2)) {
        resize();
      }
      const { w: W, h: H } = dimsRef.current;

      // v1.8.5-rev70e: clear to transparent so card shows through.
      // Each animation draws full coverage so no ghosting.
      ctx.clearRect(0, 0, W, H);

      const a = huntAnimRef.current;

      // rev54: WebGL lightning path. Init lazily on first lightning frame.
      // If init fails, fall through to 2D drawLightning (keeps old behavior).
      if (a === 'lightning') {
        if (!lightningGLRef.current && lightningGLCanvasRef.current) {
          const r = createLightningWebGL(lightningGLCanvasRef.current, { scale: 'hunt' });
          if (r && !r.failed) lightningGLRef.current = r;
          else lightningGLRef.current = { failed: true };
        }
        if (lightningGLRef.current && !lightningGLRef.current.failed) {
          // Drive WebGL renderer; 2D canvas is hidden via display:none in JSX
          lightningGLRef.current.step(dt, (hrRef.current || 0) / 1e12, true);
          animRef.current = requestAnimationFrame(draw);
          return;
        }
        // Fallback: continue into 2D path
      }

      // rev55+: WebGL noncefield path (Particle Stream). Init lazily on first
      // noncefield frame; fall back to existing 2D grid drawNonceField if init
      // fails. Block-found spikes are forwarded to the renderer's strike fn.
      if (a === 'noncefield') {
        if (!nonceFieldGLRef.current && nonceFieldGLCanvasRef.current) {
          const r = createNonceFieldWebGL(nonceFieldGLCanvasRef.current, { mode: 'hunt' });
          if (r && !r.failed) nonceFieldGLRef.current = r;
          else nonceFieldGLRef.current = { failed: true };
        }
        if (nonceFieldGLRef.current && !nonceFieldGLRef.current.failed) {
          // rev60 fix: removed broken spikesRef.current loop — that ref
          // doesn't exist in NonceField scope (it lives on the main app
          // component), so the for-of threw ReferenceError every frame and
          // crashed the rAF loop. Block-found events visually escalate via
          // the full-screen BFM Convergence Storm anyway, so the in-card
          // strike trigger isn't needed for the user-facing experience.
          //
          // rev59 fix: opts={} — the previous { enabled: enabled } also
          // referenced an undefined variable. Renderer dims itself when
          // hashrate hits 0.
          nonceFieldGLRef.current.step(dt, (hrRef.current || 0) / 1e12, {});
          animRef.current = requestAnimationFrame(draw);
          return;
        }
        // Fallback: continue into 2D drawNonceField path
      }

      // v1.8.5-rev70e: clear to transparent so card shows through.
      ctx.clearRect(0, 0, W, H);

      // v1.11.39: Performance Mode short-circuit. Skip all draw work — the
      // static <img> overlay in JSX covers the canvas surface. We still
      // schedule the next frame (cheap when there's nothing to draw) so
      // toggling Performance Mode off resumes animation instantly without
      // remounting the component.
      if (perfModeRef.current) {
        animRef.current = requestAnimationFrame(draw);
        return;
      }

      // v1.11.x: 'sonar' was removed from Hunt animations. Any user with
      // 'sonar' previously selected migrates here to 'lightning' (closest
      // visual cousin — center-focused energy/strike). Persistent migration
      // happens in the loadHuntAnim() function via fallback chain.
      if (a === 'lightning') drawLightning(dt, W, H);
      else if (a === 'pickaxe') drawPickaxe(dt, W, H);
      else if (a === 'ticker') drawTicker(dt, W, H);
      else drawNonceField(dt, W, H);

      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
      if (intersectionObserver) intersectionObserver.disconnect();
      // rev54: tear down WebGL on unmount
      if (lightningGLRef.current && !lightningGLRef.current.failed) {
        try { lightningGLRef.current.destroy(); } catch {}
        lightningGLRef.current = null;
      }
      // rev55+: same for noncefield WebGL
      if (nonceFieldGLRef.current && !nonceFieldGLRef.current.failed) {
        try { nonceFieldGLRef.current.destroy(); } catch {}
        nonceFieldGLRef.current = null;
      }
    };
  }, []); // mount-once; reads vary via refs

  return (
    <div ref={containerRef} style={{
      // v1.8.5: container fills its parent slot. HuntPanel wraps this in a
      // flex:1 div, so the canvas now grows into whatever vertical space is
      // left in the card after the header / reward / fees / stats rows have
      // taken theirs. Floor of 130 preserves the original look on short
      // viewports and matches the old hardcoded height.
      // v1.8.8-rev15: maxHeight ceiling prevents runaway growth when the
      // outer flex chain has no parent height bound (vertical-scroll mode
      // on iOS PWA). Without this cap, `height:100%` of an unbounded parent
      // can land on the canvas's natural pre-render content size and create
      // a feedback loop.
      width: '100%',
      height: '100%',
      flex: '1 1 auto',
      minHeight: 130,
      maxHeight: 280,
      position: 'relative',
      overflow: 'hidden',
      // v1.8.5-rev70e: bg transparent so Hunt animations composite onto
      // the card surface. 2D canvas now uses clearRect, lightning-webgl
      // clears with alpha 0, nonce-field shader outputs alpha=inBlock so
      // gaps between blocks reveal the card behind.
      background: 'transparent',
    }}>
      <canvas ref={canvasRef} style={{
        display: huntAnim === 'lightning' ? 'none' : 'block',
        width: '100%', height: '100%',
      }}/>
      {/* rev54: dedicated WebGL canvas for lightning mode. Layered separately
          because once a canvas has a 2D context you can't get a WebGL one. */}
      <canvas ref={lightningGLCanvasRef} style={{
        display: huntAnim === 'lightning' ? 'block' : 'none',
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
      }}/>
      {/* rev55+: dedicated WebGL canvas for noncefield (Particle Stream).
          Same separation rationale as lightning above. */}
      <canvas ref={nonceFieldGLCanvasRef} style={{
        display: huntAnim === 'noncefield' ? 'block' : 'none',
        position: 'absolute', inset: 0,
        width: '100%', height: '100%',
      }}/>
      {/* v1.11.39: Performance Mode static frame — overlays all canvases
          with a baked PNG matching the selected huntAnim. Loaded only when
          performanceMode is on, so it costs nothing for default users. */}
      {performanceMode && (
        <img
          src={`/static/hunt-${huntAnim === 'lightning' ? 'lightning'
                              : huntAnim === 'pickaxe'   ? 'pickaxe'
                              : huntAnim === 'ticker'    ? 'ticker'
                              : 'noncefield'}.png`}
          alt=""
          draggable={false}
          style={{
            position: 'absolute', inset: 0,
            width: '100%', height: '100%',
            objectFit: 'cover',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
      )}
    </div>
  );
}

function HuntPanel({ odds, hashrate, blockReward, mempool, prices, currency, huntAnim, performanceMode, onOpen }) {
  const { perBlock=0, expectedDays=null, perDay=0, perWeek=0, perMonth=0, perYear=0 } = odds||{};
  // iter27c: `scale` (logarithmic mapping for the odds SVG fill width)
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
      style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', cursor: onOpen ? 'pointer' : 'default', display:'flex', flexDirection:'column', height:'100%'}}
      className="fade-in ss-card-chrome"
      onClick={onOpen}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } } : undefined}
      title={onOpen ? 'Tap to open The Reckoning' : undefined}
    >
      <div style={{...cardTitle, color:'var(--amber)', display:'flex', justifyContent:'space-between', alignItems:'center', flexShrink:0}}>
        <span>▸ The Hunt</span>
        {onOpen && (
          <span style={{
            fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.12em',
            color:'var(--amber)', textTransform:'uppercase',
          }}>
            ▸ Tap for the Reckoning
          </span>
        )}
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:'0.55rem', flex:1, minHeight:0}}>

        {/* iter27c / v1.8.5: PER-BLOCK ODDS / NONCE FIELD
            Visualizes the nonce space (2^32 possibilities per block header).
            Each cell in the grid represents ~33M nonces. Cells flicker as
            we hash, brighter cells are "recently checked." A subtle scan
            line sweeps L→R representing nonce iteration order. The density
            of activity scales with your live hashrate.

            v1.8.5: this section is now flex:1 with a minHeight floor so the
            canvas grows into whatever empty card space exists below the
            stats grid. Mirrors how PulsePanel sizes its waveform. The label
            row stays flexShrink:0 at the top of the section; the NonceField
            wrapper takes the remaining space inside via flex:1, minHeight:0. */}
        <div style={{display:'flex', flexDirection:'column', flex:1, minHeight:240}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6, flexShrink:0}}>
            <span style={{fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--text-2)'}}>
              Per-Block Odds
            </span>
            <span style={{fontFamily:'var(--fd)', fontSize:'0.92rem', fontWeight:700, color:'var(--amber)', textShadow:'0 0 8px rgba(245,166,35,0.4)', fontVariantNumeric:'tabular-nums'}}>
              {perBlock>0 ? fmtOddsInverse(perBlock) : '—'}
            </span>
          </div>
          <div style={{flex:1, minHeight:0, display:'flex'}}>
            <NonceField hashrate={hashrate} huntAnim={huntAnim} performanceMode={performanceMode}/>
          </div>
        </div>

        {/* Block reward — COMPACT: 2-row inline layout to free up vertical space for the animation */}
        <div style={{
          background:'linear-gradient(135deg, rgba(245,166,35,0.08) 0%, rgba(245,166,35,0.02) 100%)',
          border:'1px solid var(--amber)',
          padding:'0.45rem 0.7rem',
          flexShrink:0,
        }}>
          {/* Row 1: label + BTC value (left) · fiat (right) */}
          <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10}}>
            <div style={{display:'flex', alignItems:'baseline', gap:8, flex:1, minWidth:0}}>
              <span style={{fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.13em', textTransform:'uppercase', color:'var(--text-2)', whiteSpace:'nowrap'}}>
                BLOCK REWARD
              </span>
              <span style={{
                fontFamily:'var(--fd)', fontSize:'1.05rem', fontWeight:800, lineHeight:1,
                fontVariantNumeric:'tabular-nums',
                /* rev62 premium pass — same metallic gold gradient as the
                   live hashrate. Block reward is the second-most stared-at
                   number; gradient unifies them as a hero pair. */
                background:'linear-gradient(180deg, #FFD27F 0%, #F5A623 50%, #B27414 100%)',
                WebkitBackgroundClip:'text', backgroundClip:'text',
                WebkitTextFillColor:'transparent',
                filter:'drop-shadow(0 0 8px rgba(245,166,35,0.4))',
              }}>
                {totalBtc > 0 ? totalBtc.toFixed(4) : '—'}<span style={{fontSize:'0.65rem', marginLeft:2, WebkitTextFillColor:'var(--amber-dim)'}}>BTC</span>
              </span>
            </div>
            {fiatPrice > 0 && totalBtc > 0 && (
              <span style={{fontFamily:'var(--fd)', fontSize:'0.78rem', color:'var(--text-1)', fontWeight:600, whiteSpace:'nowrap'}}>
                {fmtFiat(totalFiat, currency)}
              </span>
            )}
          </div>
          {/* Row 2: subsidy · fees (only if data present) */}
          {(subsidyBtc > 0 || feesBtc > 0) && (
            <div style={{display:'flex', gap:10, justifyContent:'center', alignItems:'baseline', marginTop:5, paddingTop:5, borderTop:'1px dashed rgba(245,166,35,0.18)', fontSize:'0.65rem'}}>
              <span style={{color:'var(--text-2)', letterSpacing:'0.08em', textTransform:'uppercase'}}>Subsidy</span>
              <span style={{fontFamily:'var(--fm)', color:'var(--text-1)', fontWeight:600}}>{subsidyBtc.toFixed(3)}</span>
              <span style={{color:'var(--text-3)'}}>·</span>
              <span style={{color:'var(--text-2)', letterSpacing:'0.08em', textTransform:'uppercase'}}>Fees</span>
              <span style={{fontFamily:'var(--fm)', color:'var(--cyan)', fontWeight:600}}>+{feesBtc.toFixed(4)}</span>
            </div>
          )}
        </div>

        {/* Fee tier strip — Fast / Mid / Low (sat/vB) (UNCHANGED) */}
        {(feeFast || feeMid || feeLow) && (
          <div style={{display:'flex', gap:6, flexShrink:0}}>
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
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:4, flexShrink:0}}>
          <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.35rem 0.3rem', textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.08em', color:'var(--text-2)', textTransform:'uppercase'}}>Expected</div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--amber)', fontWeight:700, marginTop:2}}>
              {fmtOdds(expectedDays)}
            </div>
          </div>
          <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.35rem 0.3rem', textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.08em', color:'var(--text-2)', textTransform:'uppercase'}}>Yearly</div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-1)', fontWeight:700, marginTop:2}}>
              {perYear>0 ? (perYear < 0.0001 ? (perYear*100).toFixed(Math.min(10, Math.max(5, -Math.floor(Math.log10(perYear*100)) + 1))) + '%' : fmtPct(perYear*100, perYear < 0.01 ? 3 : 2)) : '—'}
            </div>
          </div>
          <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.35rem 0.3rem', textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.08em', color:'var(--text-2)', textTransform:'uppercase'}}>Daily</div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-1)', fontWeight:700, marginTop:2}}>
              {perDay>0 ? fmtPct(perDay*100, 3) : '—'}
            </div>
          </div>
          <div style={{background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.35rem 0.3rem', textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.08em', color:'var(--text-2)', textTransform:'uppercase'}}>Sats/d</div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--cyan)', fontWeight:700, marginTop:2}}>
              {expectedDailySats > 0 ? expectedDailySats.toLocaleString() : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK FOUND CELEBRATION MODAL
// ─────────────────────────────────────────────────────────────────────────────
// Fullscreen takeover that fires when poolState.blocks.length grows. Plays
// the user's selected Hunt animation theme (lightning / noncefield /
// pickaxe) at full screen size with phase progression:
//   0.0 – 0.5s  buildup begin
//   0.5 – 1.2s  target appears
//   1.2 – 1.8s  CLIMAX (strike, sweep, ripple, shatter)
//   1.8 – 3.0s  B holds bright at center
//   3.0 – 4.5s  themed text fades in
//   4.5 – 5.5s  fade out
// Then 10s detail-hold so user can read block info, then auto-dismiss.
// Tap-anywhere or Continue button dismisses earlier.
//
// ─── BFM constellation pattern (32×6 grid that spells B) ───
const BFM_COLS = 32, BFM_ROWS = 6, BFM_TOTAL = BFM_COLS * BFM_ROWS;
const BFM_B_CELLS = (() => {
  const set = new Set();
  const startCol = 14;
  // 4-col-wide × 6-row B pattern
  const pat = [
    [1,1,1,1],
    [1,0,0,1],
    [1,1,1,1],
    [1,0,0,1],
    [1,0,0,1],
    [1,1,1,1],
  ];
  for (let r = 0; r < BFM_ROWS; r++)
    for (let c = 0; c < 4; c++)
      if (pat[r][c]) set.add((startCol + c) + r * BFM_COLS);
  return set;
})();
const BFM_DURATION = 5.5; // seconds

// ─── Lightning celebration ───
function drawBFMLightning(ctx, W, H, t, state) {
  ctx.fillStyle = 'rgba(8,8,10,1)';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const iconSize = Math.min(H * 0.55, W * 0.7);
  const iconTopY = cy - iconSize / 2;

  // Buildup bolts at ramping rate
  const spawnRate = t < 1.2 ? (3 + t * 30) : (t < 1.8 ? 60 : 5);
  if (Math.random() < spawnRate * (1 / 60)) {
    const sx = 8 + Math.random() * (W - 16);
    const pts = [{ x: sx, y: 0 }];
    let x = sx, y = 0;
    while (y < H + 4) {
      const dy = 8 + Math.random() * 14;
      y += dy;
      x += (Math.random() - 0.5) * dy * 0.6;
      pts.push({ x, y });
    }
    state.bolts.push({ pts, life: 0, maxLife: 0.32 });
  }
  for (let i = state.bolts.length - 1; i >= 0; i--) {
    const b = state.bolts[i];
    b.life += 1 / 60;
    if (b.life >= b.maxLife) { state.bolts.splice(i, 1); continue; }
    const p = b.life / b.maxLife;
    const alpha = p < 0.25 ? 1 : Math.pow(1 - (p - 0.25) / 0.75, 0.7);
    ctx.strokeStyle = `rgba(245, 200, 110, ${alpha * 0.7})`;
    ctx.shadowColor = 'rgba(245, 166, 35, 0.6)';
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2.0;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.pts[0].x, b.pts[0].y);
    for (let j = 1; j < b.pts.length; j++) ctx.lineTo(b.pts[j].x, b.pts[j].y);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  let iconAlpha = 0, iconBrightness = 1, haloR = 0, haloAlpha = 0, iconScale = 1;
  // Target phase — ghostly icon
  if (t >= 0.5 && t < 1.4) iconAlpha = (t - 0.5) / 0.9 * 0.40;

  // Mega-bolt + ignition (1.4 – 1.9s)
  if (t >= 1.4 && t < 1.9) {
    const sp = (t - 1.4) / 0.5;
    if (!state.megaBolt) {
      const startX = cx + (Math.random() - 0.5) * 60;
      const targetY = iconTopY - 4;
      const pts = [{ x: startX, y: 0 }];
      let x = startX, y = 0;
      while (y < targetY) {
        const dy = 9 + Math.random() * 14;
        y += dy;
        if (y > targetY) y = targetY;
        x += (Math.random() - 0.5) * dy * 0.5;
        x += (cx - x) * 0.10;
        pts.push({ x, y });
      }
      pts[pts.length - 1] = { x: cx, y: targetY };
      const forks = [];
      for (let f = 0; f < 4; f++) {
        const fi = Math.floor(2 + Math.random() * (pts.length - 4));
        const fp = pts[fi];
        const fpts = [{ x: fp.x, y: fp.y }];
        let fx = fp.x, fy = fp.y;
        const dir = Math.random() < 0.5 ? -1 : 1;
        for (let k = 0; k < 5; k++) {
          fy += 8 + Math.random() * 12;
          fx += dir * (4 + Math.random() * 6);
          fpts.push({ x: fx, y: fy });
          if (fy > targetY) break;
        }
        forks.push(fpts);
      }
      state.megaBolt = { pts, forks };
    }
    const mb = state.megaBolt;
    const alpha = sp < 0.1 ? sp / 0.1 : (sp < 0.7 ? 1 : (1 - sp) / 0.3);
    ctx.strokeStyle = `rgba(255, 240, 180, ${alpha * 0.4})`;
    ctx.shadowColor = 'rgba(255, 220, 130, 1.0)';
    ctx.shadowBlur = 50;
    ctx.lineWidth = 16;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(mb.pts[0].x, mb.pts[0].y);
    for (let j = 1; j < mb.pts.length; j++) ctx.lineTo(mb.pts[j].x, mb.pts[j].y);
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 250, 220, ${alpha})`;
    ctx.shadowBlur = 28;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(mb.pts[0].x, mb.pts[0].y);
    for (let j = 1; j < mb.pts.length; j++) ctx.lineTo(mb.pts[j].x, mb.pts[j].y);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (const fk of mb.forks) {
      ctx.beginPath();
      ctx.moveTo(fk[0].x, fk[0].y);
      for (let j = 1; j < fk.length; j++) ctx.lineTo(fk[j].x, fk[j].y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    if (sp < 0.3) {
      ctx.fillStyle = `rgba(255, 240, 180, ${(0.3 - sp) * 1.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    iconAlpha = 0.40 + sp * 0.60;
    iconBrightness = 1 + sp * 0.8;
    haloR = iconSize * 0.6 + sp * iconSize * 1.4;
    haloAlpha = (1 - sp) * 0.55;
    iconScale = 1 + sp * 0.10 - Math.max(0, sp - 0.4) * 0.05;
  } else {
    state.megaBolt = null;
  }

  // Blazing phase — sparks + fade
  if (t >= 1.9 && t < 4.5) {
    iconAlpha = 1;
    const dt2 = t - 1.9;
    iconBrightness = 1 + Math.max(0, 0.6 - dt2 * 0.4);
    haloR = iconSize * (1.4 - Math.min(0.4, dt2 * 0.2));
    haloAlpha = Math.max(0, 0.55 - dt2 * 0.30);
    if (t > 4.0) {
      const fadeAlpha = (4.5 - t) / 0.5;
      iconAlpha = fadeAlpha;
      haloAlpha *= fadeAlpha;
    }
    if (Math.random() < 0.4) {
      const ang = Math.random() * Math.PI * 2;
      const dist = iconSize * 0.55 + Math.random() * 40;
      state.sparks.push({
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist,
        life: 0, maxLife: 0.4 + Math.random() * 0.3,
      });
    }
    for (let i = state.sparks.length - 1; i >= 0; i--) {
      const s = state.sparks[i];
      s.life += 1 / 60;
      if (s.life >= s.maxLife) { state.sparks.splice(i, 1); continue; }
      const sa = (1 - s.life / s.maxLife);
      ctx.fillStyle = `rgba(255, 240, 180, ${sa})`;
      ctx.shadowColor = 'rgba(255, 220, 140, 0.95)';
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  if (haloAlpha > 0.01 && haloR > 0) {
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
    halo.addColorStop(0, `rgba(255, 220, 130, ${haloAlpha})`);
    halo.addColorStop(0.4, `rgba(255, 165, 60, ${haloAlpha * 0.7})`);
    halo.addColorStop(1, 'rgba(247, 147, 26, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2); ctx.fill();
  }
  if (iconAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = iconAlpha;
    drawBtcCelebrate(ctx, cx, cy, iconSize * iconScale, iconBrightness);
    ctx.restore();
  }
  drawBFMText(ctx, W, H, t, 'THE STRIKE', cy, iconSize);
}

// rev54: Overlay-only version of the BFM lightning. Used when the WebGL
// renderer is driving the bolts/clouds/flash on a separate canvas behind
// this 2D canvas. This function only draws the icon, halo, sparks around
// the icon during blazing phase, and the title text. Bolts and screen
// flash are drawn by the WebGL canvas behind. The 2D canvas should be
// cleared (clearRect) before calling this so the WebGL canvas shows
// through.
function drawBFMLightningOverlay(ctx, W, H, t, state) {
  const cx = W / 2, cy = H / 2;
  const iconSize = Math.min(H * 0.55, W * 0.7);

  let iconAlpha = 0, iconBrightness = 1, haloR = 0, haloAlpha = 0, iconScale = 1;

  // Target phase — ghostly icon
  if (t >= 0.5 && t < 1.4) iconAlpha = (t - 0.5) / 0.9 * 0.40;

  // Ignition phase (1.4–1.9): icon brightens, halo grows
  if (t >= 1.4 && t < 1.9) {
    const sp = (t - 1.4) / 0.5;
    iconAlpha = 0.40 + sp * 0.60;
    iconBrightness = 1 + sp * 0.8;
    haloR = iconSize * 0.6 + sp * iconSize * 1.4;
    haloAlpha = (1 - sp) * 0.55;
    iconScale = 1 + sp * 0.10 - Math.max(0, sp - 0.4) * 0.05;
  }

  // Blazing phase (1.9–4.5): sparks + fade
  if (t >= 1.9 && t < 4.5) {
    iconAlpha = 1;
    const dt2 = t - 1.9;
    iconBrightness = 1 + Math.max(0, 0.6 - dt2 * 0.4);
    haloR = iconSize * (1.4 - Math.min(0.4, dt2 * 0.2));
    haloAlpha = Math.max(0, 0.55 - dt2 * 0.30);
    if (t > 4.0) {
      const fadeAlpha = (4.5 - t) / 0.5;
      iconAlpha = fadeAlpha;
      haloAlpha *= fadeAlpha;
    }
    if (Math.random() < 0.4) {
      const ang = Math.random() * Math.PI * 2;
      const dist = iconSize * 0.55 + Math.random() * 40;
      state.sparks.push({
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist,
        life: 0, maxLife: 0.4 + Math.random() * 0.3,
      });
    }
    for (let i = state.sparks.length - 1; i >= 0; i--) {
      const s = state.sparks[i];
      s.life += 1 / 60;
      if (s.life >= s.maxLife) { state.sparks.splice(i, 1); continue; }
      const sa = (1 - s.life / s.maxLife);
      ctx.fillStyle = `rgba(255, 240, 180, ${sa})`;
      ctx.shadowColor = 'rgba(255, 220, 140, 0.95)';
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // Halo
  if (haloAlpha > 0.01 && haloR > 0) {
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
    halo.addColorStop(0, `rgba(255, 220, 130, ${haloAlpha})`);
    halo.addColorStop(0.4, `rgba(255, 165, 60, ${haloAlpha * 0.7})`);
    halo.addColorStop(1, 'rgba(247, 147, 26, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2); ctx.fill();
  }

  // Icon
  if (iconAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = iconAlpha;
    drawBtcCelebrate(ctx, cx, cy, iconSize * iconScale, iconBrightness);
    ctx.restore();
  }

  drawBFMText(ctx, W, H, t, 'THE STRIKE', cy, iconSize);
}

// ─── Nonce Field celebration ───
function drawBFMNonce(ctx, W, H, t, state) {
  ctx.fillStyle = 'rgba(8,8,10,1)';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const cw = W / BFM_COLS, ch = H / BFM_ROWS;
  const iconSize = Math.min(H * 0.6, W * 0.85);

  if (t < 0.5) {
    for (let i = 0; i < BFM_TOTAL; i++) if (Math.random() < 0.25) state.cells[i] = 1;
  }
  if (t >= 0.5 && t < 1.2) {
    for (let i = 0; i < BFM_TOTAL; i++) {
      if (BFM_B_CELLS.has(i)) state.cells[i] = Math.min(1, state.cells[i] + 0.04);
      else state.cells[i] = Math.max(0, state.cells[i] - 0.05);
    }
  }
  if (t >= 1.2 && t < 1.8) {
    for (let i = 0; i < BFM_TOTAL; i++) {
      if (BFM_B_CELLS.has(i))
        state.cells[i] = Math.max(0.5 + Math.sin(t * 8 + i) * 0.15, state.cells[i] * 0.97);
      else state.cells[i] *= 0.85;
    }
  }
  if (t >= 1.8) {
    for (let i = 0; i < BFM_TOTAL; i++) {
      const target = BFM_B_CELLS.has(i) ? Math.max(0, 0.4 - (t - 1.8) * 0.35) : 0;
      state.cells[i] = state.cells[i] * 0.96 + target * 0.04;
    }
  }

  const dotR = Math.min(cw, ch) * 0.34;
  for (let r = 0; r < BFM_ROWS; r++) for (let c = 0; c < BFM_COLS; c++) {
    const idx = r * BFM_COLS + c;
    const x = c * cw + cw / 2, y = r * ch + ch / 2;
    const v = state.cells[idx];
    if (v < 0.05) {
      ctx.fillStyle = 'rgba(120,90,30,0.18)';
      ctx.beginPath(); ctx.arc(x, y, dotR * 0.35, 0, Math.PI * 2); ctx.fill();
    } else {
      const alpha = 0.35 + v * 0.65;
      ctx.fillStyle = `rgba(245,166,35,${alpha})`;
      ctx.shadowColor = 'rgba(245,166,35,0.7)';
      ctx.shadowBlur = v > 0.7 ? 12 : 6;
      ctx.beginPath(); ctx.arc(x, y, dotR * (0.5 + v * 0.5), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  let bAlpha = 0;
  if (t >= 1.2 && t < 4.5) {
    if (t < 1.8) bAlpha = (t - 1.2) / 0.6 * 0.95;
    else if (t < 4.0) bAlpha = 1;
    else bAlpha = (4.5 - t) / 0.5;
  }
  if (bAlpha > 0.05) {
    ctx.save();
    ctx.globalAlpha = bAlpha;
    drawBtcCelebrate(ctx, cx, cy, iconSize, 1);
    ctx.restore();
  }
  drawBFMText(ctx, W, H, t, 'NONCE FOUND', cy, iconSize);
}

// ─── Pickaxe celebration ───
function drawBFMPickaxe(ctx, W, H, t, state) {
  // ─────────────────────────────────────────────────────────────────────
  // v1.11.x — VARIANT 25: "THE EVERYTHING" — max drama strike
  //   - Wide wind-up (pickaxe pulls back tilted right, upper-right)
  //   - Brief shake during hold (charging energy)
  //   - Fast violent swing into block top, straightens at impact
  //   - Heavy recoil bounce
  //   - Block shakes hard, then fades away
  //   - 45 explosive polygon shards + 25 sparkles fly in wide spread
  //   - Intense full-screen flash + large shockwave ring
  //   - BTC ₿ glyph rises from the rubble at 1.4s, halos, holds, fades
  //   - "BLOCK STRUCK" text rendered by drawBFMText
  //
  // Phase timeline (impact at t=1.0):
  //   0.0–0.2s : wind-up hold with shake
  //   0.2–1.0s : fast swing (easeInQuint) + rotation straightens (easeOutCubic)
  //   1.0–1.15s: impact + recoil bounce (30px rise, sin curve)
  //   1.0+     : block shakes 0.25s, then fades 0.55s
  //   1.0+     : 45 shards + 25 sparkles fly, gravity, fade over 2.5s
  //   1.3–4.5s : ₿ glyph emerges, halos, holds, fades
  // ─────────────────────────────────────────────────────────────────────

  ctx.fillStyle = 'rgba(8,8,10,1)';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const iconSize = Math.min(H * 0.55, W * 0.7);

  // ── Block growth + shake + fade ──────────────────────────────────────
  // Block grows at start (0.0–0.5), holds, then at impact (1.0) shakes
  // hard for 0.25s and starts a 0.55s fade.
  let blockSize = 0, blockAlpha = 0;
  let blockOffsetX = 0, blockOffsetY = 0;
  if (t < 1.0) {
    const growT = Math.min(1, t / 0.5);
    const eased = 1 - Math.pow(1 - growT, 3);
    blockSize = Math.min(H * 0.45, W * 0.6) * eased;
    blockAlpha = eased;
    if (t > 1.0 && t < 1.2) {
      const sq = (t - 1.0) / 0.2;
      blockSize *= 1 + Math.sin(sq * Math.PI) * 0.25;
    }
  } else {
    blockSize = Math.min(H * 0.45, W * 0.6);
    // Fade after impact over 0.55s
    blockAlpha = Math.max(0, 1 - (t - 1.0) / 0.55);
    // Hard shake for 0.25s after impact
    if (t < 1.25) {
      const sp = (t - 1.0) / 0.25;
      const shakeAmp = (1 - sp) * 8;
      blockOffsetX = Math.sin(t * 80) * shakeAmp;
      blockOffsetY = Math.cos(t * 75) * shakeAmp * 0.7;
    }
  }
  if (blockAlpha > 0.05 && blockSize > 2) {
    const bx = cx + blockOffsetX - blockSize / 2;
    const by = cy + blockOffsetY - blockSize / 2;
    const r = Math.max(3, blockSize * 0.12);
    ctx.save();
    ctx.globalAlpha = blockAlpha;
    const haloR = blockSize * 1.5;
    const halo = ctx.createRadialGradient(cx + blockOffsetX, cy + blockOffsetY, 0, cx + blockOffsetX, cy + blockOffsetY, haloR);
    halo.addColorStop(0, 'rgba(255, 165, 60, 0.5)');
    halo.addColorStop(0.5, 'rgba(247, 147, 26, 0.2)');
    halo.addColorStop(1, 'rgba(247, 147, 26, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx + blockOffsetX, cy + blockOffsetY, haloR, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createLinearGradient(bx, by, bx + blockSize, by + blockSize);
    g.addColorStop(0, '#FFB347');
    g.addColorStop(0.45, '#FF8C1A');
    g.addColorStop(1, '#C95800');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + blockSize - r, by);
    ctx.quadraticCurveTo(bx + blockSize, by, bx + blockSize, by + r);
    ctx.lineTo(bx + blockSize, by + blockSize - r);
    ctx.quadraticCurveTo(bx + blockSize, by + blockSize, bx + blockSize - r, by + blockSize);
    ctx.lineTo(bx + r, by + blockSize);
    ctx.quadraticCurveTo(bx, by + blockSize, bx, by + blockSize - r);
    ctx.lineTo(bx, by + r);
    ctx.quadraticCurveTo(bx, by, bx + r, by);
    ctx.closePath();
    ctx.fill();
    if (t > 1.0) {
      // Crack pattern overlay
      ctx.strokeStyle = `rgba(80, 30, 0, ${blockAlpha * 0.85})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + blockOffsetX - blockSize * 0.3, cy + blockOffsetY - blockSize * 0.1);
      ctx.lineTo(cx + blockOffsetX + blockSize * 0.05, cy + blockOffsetY + blockSize * 0.18);
      ctx.lineTo(cx + blockOffsetX + blockSize * 0.25, cy + blockOffsetY - blockSize * 0.05);
      ctx.lineTo(cx + blockOffsetX + blockSize * 0.4, cy + blockOffsetY + blockSize * 0.25);
      ctx.stroke();
      // Secondary crack
      ctx.beginPath();
      ctx.moveTo(cx + blockOffsetX - blockSize * 0.15, cy + blockOffsetY + blockSize * 0.3);
      ctx.lineTo(cx + blockOffsetX + blockSize * 0.1, cy + blockOffsetY - blockSize * 0.2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ── Variant 25 pickaxe: wide wind-up + shake + fast violent swing ────
  // Block top is at: cy - blockSize/2 (when fully grown ≈ cy - H*0.225)
  // Strike contact target = (cx, cy - blockSize*0.45) ≈ block top center
  const targetBlockSize = Math.min(H * 0.45, W * 0.6);
  const impactX = cx;
  const impactY = cy - targetBlockSize / 2;
  const pickSize = Math.min(H * 0.5, W * 0.6);

  // V25 params (matching the preview):
  //   windOffsetX: 110, windOffsetY: -135, windRot: 1.3
  //   windHoldEnd: 0.2 (in absolute time, t<0.2)
  //   impactAt: 0.55 in normalized [0,1] cycle — but our cycle is t=0..1.0
  //   So scale: windHoldEnd = 0.2 of 1.0 = 0.2, impactAt = 0.55 of 1.0 = 0.55
  //   We'll use t=0.55 as impact instead of t=1.0. But the rest of the
  //   celebration (shards, BTC reveal, text) was timed around impact=1.0.
  //   To preserve that, treat the "impact" of the whole celebration as t=1.0
  //   and have the pickaxe land at t=1.0. Compress the V25 motion accordingly:
  //   Map V25 timeline (0..0.55 wind+swing, 0.55..0.67 recoil, 0.67..fade)
  //   to absolute (0..1.0 wind+swing, 1.0..1.15 recoil, 1.15..fade).
  const WIND_HOLD_END = 0.2;       // pickaxe holds wind-up until t=0.2
  const IMPACT_TIME = 1.0;         // pickaxe impacts at t=1.0
  const RECOIL_END = 1.15;         // recoil bounce ends
  const PICKAXE_FADE_END = 1.45;   // fully faded
  const windX = impactX + pickSize * 0.8;  // pickaxe wound back right (scaled for big pickaxe)
  const windY = impactY - pickSize * 1.0;  // pickaxe wound back up
  const windRot = 1.3;
  const shakeAmp = 3;

  // Compute pickaxe position+rotation at current t
  let pCx = impactX, pCy = impactY, pRot = 0, pAlpha = 0;
  if (t < WIND_HOLD_END) {
    // Wind-up hold with shake
    const sk = t * 30;
    pCx = windX + Math.sin(sk) * shakeAmp;
    pCy = windY + Math.cos(sk * 0.9) * shakeAmp * 0.5;
    pRot = windRot;
    pAlpha = 1;
  } else if (t < IMPACT_TIME) {
    // Fast swing: easeInQuint on position, easeOutCubic on rotation
    const phase = (t - WIND_HOLD_END) / (IMPACT_TIME - WIND_HOLD_END);
    const pPos = phase * phase * phase * phase * phase;  // easeInQuint
    const pRotEase = 1 - Math.pow(1 - phase, 3);          // easeOutCubic
    pCx = windX + (impactX - windX) * pPos;
    pCy = windY + (impactY - windY) * pPos;
    pRot = windRot + (0 - windRot) * pRotEase;
    pAlpha = 1;
  } else if (t < RECOIL_END) {
    // Recoil bounce upward
    const rp = (t - IMPACT_TIME) / (RECOIL_END - IMPACT_TIME);
    pCx = impactX;
    pCy = impactY - 30 * Math.sin(rp * Math.PI);
    pRot = 0;
    pAlpha = 1;
  } else if (t < PICKAXE_FADE_END) {
    pCx = impactX;
    pCy = impactY;
    pRot = 0;
    pAlpha = Math.max(0, 1 - (t - RECOIL_END) / (PICKAXE_FADE_END - RECOIL_END));
  }

  if (pAlpha > 0.05 && __splashPickaxeReady) {
    // Draw splash-pickaxe.png with head-tip at (pCx, pCy), rotated by pRot.
    // The PNG has aspect ~0.75 (W/H). Head contact point is at roughly
    // (28%, 22%) of image dimensions. To position the head tip at (pCx, pCy),
    // we translate to (pCx, pCy), rotate, then draw the image with offset
    // so its contact point sits at (0,0) in local frame.
    const pickH = pickSize;
    const pickW = pickH * 0.75;
    const HEAD_X_FRAC = 0.28;
    const HEAD_Y_FRAC = 0.22;
    ctx.save();
    ctx.translate(pCx, pCy);
    ctx.rotate(pRot);
    ctx.globalAlpha = pAlpha;
    ctx.shadowColor = 'rgba(255, 220, 140, 0.9)';
    ctx.shadowBlur = 20;
    ctx.drawImage(__splashPickaxeImg, -HEAD_X_FRAC * pickW, -HEAD_Y_FRAC * pickH, pickW, pickH);
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ── Intense flash at impact (V25 flashIntensity = 1.7) ──────────────
  if (Math.abs(t - IMPACT_TIME) < 0.15) {
    const fs = 1 - Math.abs(t - IMPACT_TIME) / 0.15;
    ctx.fillStyle = `rgba(255, 230, 180, ${fs * 0.55 * 1.7})`;
    ctx.fillRect(0, 0, W, H);
  }

  // ── Shockwave ring (expanding circle at impact point) ───────────────
  if (t >= IMPACT_TIME && t < IMPACT_TIME + 0.5) {
    const ringT = (t - IMPACT_TIME) / 0.5;
    ctx.save();
    ctx.strokeStyle = `rgba(255, 220, 140, ${0.7 * (1 - ringT) * 1.5})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(impactX, impactY, 30 + ringT * 120, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ── 45 polygon shards + 25 sparkles (V25 debris config) ─────────────
  if (t >= IMPACT_TIME && t < IMPACT_TIME + 3.0) {
    if (!state.shards) {
      state.shards = [];
      state.sparkles = [];
      const numShards = 45;
      for (let i = 0; i < numShards; i++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.9;
        const speed = 140 + Math.random() * 220;
        const sz = 4 + Math.random() * 7;
        const numVerts = 3 + Math.floor(Math.random() * 3);
        const verts = [];
        for (let v = 0; v < numVerts; v++) {
          const vAng = (v / numVerts) * Math.PI * 2 + (Math.random() - 0.5) * 0.7;
          const vR = sz * (0.6 + Math.random() * 0.7);
          verts.push({ x: Math.cos(vAng) * vR, y: Math.sin(vAng) * vR });
        }
        state.shards.push({
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          verts,
          rot: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 12,
          shade: Math.random(),
        });
      }
      // 25 sparkles
      for (let i = 0; i < 25; i++) {
        const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.6;
        const speed = 120 + Math.random() * 220;
        state.sparkles.push({
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          size: 1 + Math.random() * 2,
          life: 0.5 + Math.random() * 0.3,
        });
      }
    }
    const shardT = t - IMPACT_TIME;
    const shardLife = 2.5;
    // Draw sparkles first (behind shards)
    for (const sp of state.sparkles) {
      if (shardT > sp.life) continue;
      const px = impactX + sp.vx * shardT;
      const py = impactY + sp.vy * shardT + 0.5 * 200 * shardT * shardT;
      const a = Math.max(0, 1 - shardT / sp.life);
      if (a < 0.05) continue;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.shadowColor = '#FFE6A0';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#FFF5C2';
      ctx.beginPath();
      ctx.arc(px, py, sp.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Shards
    for (const sh of state.shards) {
      const px = impactX + sh.vx * shardT;
      const py = impactY + sh.vy * shardT + 0.5 * 280 * shardT * shardT;
      const alpha = Math.max(0, 1 - shardT / shardLife);
      if (alpha < 0.05) continue;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(sh.rot + sh.spin * shardT);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = sh.shade < 0.33 ? '#FFC25A' : sh.shade < 0.66 ? '#FF8C1A' : '#C9500F';
      ctx.beginPath();
      ctx.moveTo(sh.verts[0].x, sh.verts[0].y);
      for (let v = 1; v < sh.verts.length; v++) ctx.lineTo(sh.verts[v].x, sh.verts[v].y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(40,15,0,${alpha * 0.85})`;
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();
    }
  } else if (t < IMPACT_TIME) {
    state.shards = null;
    state.sparkles = null;
  }

  // ── BTC ₿ glyph emerges from rubble (same timing as before) ─────────
  let bAlpha = 0, bScale = 1;
  if (t >= 1.3 && t < 4.5) {
    if (t < 1.7) {
      const ep = (t - 1.3) / 0.4;
      bAlpha = ep; bScale = 0.5 + ep * 0.55;
    } else if (t < 1.9) {
      bAlpha = 1; bScale = 1.05 - (t - 1.7) / 0.2 * 0.05;
    } else if (t < 4.0) {
      bAlpha = 1; bScale = 1;
    } else {
      bAlpha = (4.5 - t) / 0.5; bScale = 1;
    }
  }
  if (bAlpha > 0.05) {
    if (t >= 1.3 && t < 2.5) {
      const haloR = iconSize * (0.7 + (t - 1.3) * 0.5);
      const haloAlpha = bAlpha * Math.max(0, 0.55 - (t - 1.3) * 0.3);
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
      halo.addColorStop(0, `rgba(255, 220, 130, ${haloAlpha})`);
      halo.addColorStop(0.5, `rgba(255, 165, 60, ${haloAlpha * 0.5})`);
      halo.addColorStop(1, 'rgba(247, 147, 26, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.globalAlpha = bAlpha;
    drawBtcCelebrate(ctx, cx, cy, iconSize * bScale, 1);
    ctx.restore();
  }

  drawBFMText(ctx, W, H, t, 'BLOCK STRUCK', cy, iconSize);
}
// v1.11.x: drawBFMTicker — Hash Ticker block-found celebration in BFM modal.
// Visual concept: VOLCANO ERUPTION. Bottom-center fountain of ₿ glyphs
// erupts upward, gravity arcs them down, central icon ignites at 1.4s,
// blazing phase shows crackling sparks + halo, fades by 4.5s, "BLOCK
// STRUCK" letter-spaced text via drawBFMText. Format mirrors
// drawBFMLightning/drawBFMPickaxe exactly: same phase timing, same
// iconAlpha/Brightness/Scale/haloR/haloAlpha vocabulary, same drawBtcCelebrate
// + drawBFMText calls. State.particles holds active ₿ glyph particles.
function drawBFMTicker(ctx, W, H, t, state) {
  // Background — match other BFM celebrations
  ctx.fillStyle = 'rgba(8,8,10,1)';
  ctx.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const iconSize = Math.min(H * 0.55, W * 0.7);

  // Lazy-init particle arrays on the per-celebration state
  if (!state.particles) state.particles = [];
  if (!state.embers) state.embers = [];

  // ── Buildup (0.0 – 1.4s): ramping eruption ───────────────────────────
  // Particle spawn rate ramps from low → very high during buildup, then
  // slows to a baseline trickle for the rest of the celebration. Mirrors
  // drawBFMLightning's bolt spawn ramp.
  const spawnRate = t < 1.2 ? (8 + t * 90) : (t < 1.8 ? 140 : 22);
  const spawnExpected = spawnRate * (1 / 60);
  let spawnCount = Math.floor(spawnExpected);
  if (Math.random() < (spawnExpected - spawnCount)) spawnCount++;
  for (let k = 0; k < spawnCount; k++) {
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;
    const speed = 320 + Math.random() * 360;
    state.particles.push({
      x: cx + (Math.random() - 0.5) * 100,
      y: H + 6,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      size: 12 + Math.random() * 8,
      life: 0,
      maxLife: 1.5 + Math.random() * 0.8,
    });
  }

  // Update + draw particles. Gravity arcs them back down so the fountain
  // visually loops. Render with bitcoin orange glow, fade as life
  // approaches maxLife.
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.x += p.vx * (1 / 60);
    p.y += p.vy * (1 / 60);
    p.vy += 700 * (1 / 60);
    p.life += 1 / 60;
    if (p.y > H + 30 || p.life >= p.maxLife) {
      state.particles.splice(i, 1);
      continue;
    }
    const a = Math.max(0, 1 - p.life / p.maxLife);
    ctx.shadowColor = 'rgba(255, 165, 60, 0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = `rgba(245, 200, 110, ${a})`;
    drawBtcGlyph(ctx, p.x, p.y, p.size);
  }
  ctx.shadowBlur = 0;

  let iconAlpha = 0, iconBrightness = 1, haloR = 0, haloAlpha = 0, iconScale = 1;

  // ── Target phase (0.5 – 1.4s): ghostly icon fades in ──────────────────
  if (t >= 0.5 && t < 1.4) iconAlpha = (t - 0.5) / 0.9 * 0.40;

  // ── Mega eruption (1.4 – 1.9s): icon ignites, halo blooms ─────────────
  if (t >= 1.4 && t < 1.9) {
    const sp = (t - 1.4) / 0.5;
    // Bright flash on first frame of mega phase — like drawBFMLightning
    if (sp < 0.3) {
      ctx.fillStyle = `rgba(255, 240, 180, ${(0.3 - sp) * 1.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    iconAlpha = 0.40 + sp * 0.60;
    iconBrightness = 1 + sp * 0.8;
    haloR = iconSize * 0.6 + sp * iconSize * 1.4;
    haloAlpha = (1 - sp) * 0.55;
    iconScale = 1 + sp * 0.10 - Math.max(0, sp - 0.4) * 0.05;
  }

  // ── Blazing phase (1.9 – 4.5s): sparks + slow fade ────────────────────
  if (t >= 1.9 && t < 4.5) {
    iconAlpha = 1;
    const dt2 = t - 1.9;
    iconBrightness = 1 + Math.max(0, 0.6 - dt2 * 0.4);
    haloR = iconSize * (1.4 - Math.min(0.4, dt2 * 0.2));
    haloAlpha = Math.max(0, 0.55 - dt2 * 0.30);
    if (t > 4.0) {
      const fadeAlpha = (4.5 - t) / 0.5;
      iconAlpha = fadeAlpha;
      haloAlpha *= fadeAlpha;
    }
    // Crackling embers around the icon — visually echoes the eruption
    if (Math.random() < 0.5) {
      const ang = Math.random() * Math.PI * 2;
      const dist = iconSize * 0.55 + Math.random() * 50;
      state.embers.push({
        x: cx + Math.cos(ang) * dist,
        y: cy + Math.sin(ang) * dist,
        life: 0,
        maxLife: 0.4 + Math.random() * 0.35,
      });
    }
    for (let i = state.embers.length - 1; i >= 0; i--) {
      const e = state.embers[i];
      e.life += 1 / 60;
      if (e.life >= e.maxLife) { state.embers.splice(i, 1); continue; }
      const ea = (1 - e.life / e.maxLife);
      ctx.fillStyle = `rgba(255, 220, 130, ${ea})`;
      ctx.shadowColor = 'rgba(255, 200, 100, 0.95)';
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(e.x, e.y, 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  // ── Halo behind icon ──────────────────────────────────────────────────
  if (haloAlpha > 0.01 && haloR > 0) {
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
    halo.addColorStop(0, `rgba(255, 220, 130, ${haloAlpha})`);
    halo.addColorStop(0.4, `rgba(255, 165, 60, ${haloAlpha * 0.7})`);
    halo.addColorStop(1, 'rgba(247, 147, 26, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2); ctx.fill();
  }

  // ── Icon (BTC celebrate glyph) ────────────────────────────────────────
  if (iconAlpha > 0.02) {
    ctx.save();
    ctx.globalAlpha = iconAlpha;
    drawBtcCelebrate(ctx, cx, cy, iconSize * iconScale, iconBrightness);
    ctx.restore();
  }

  // ── Title text (3.0 – 5.5s) ───────────────────────────────────────────
  drawBFMText(ctx, W, H, t, 'BLOCK STRUCK', cy, iconSize);
}

// rev57: Overlay-only version of the BFM Nonce celebration. Used when the
// WebGL Convergence Storm renderer (nonce-field-webgl in BFM mode) is
// active. The 2D canvas only draws the ₿ glyph + halo + title text;
// particles, gold ring, bloom rays, and shockwave are all rendered on the
// WebGL canvas behind.
function drawBFMNonceOverlay(ctx, W, H, t) {
  const cx = W / 2, cy = H / 2;
  const iconSize = Math.min(H * 0.55, W * 0.7);

  // Glyph fade — visible 1.5..4.5s, fade in/out at the edges.
  // Matches the WebGL formation-phase ring (1.5–2.5s) and outburst (4.0–5.5s).
  let glyphAlpha = 0;
  if (t >= 1.5 && t < 4.5) {
    if (t < 2.2) glyphAlpha = (t - 1.5) / 0.7;
    else if (t < 4.0) glyphAlpha = 1;
    else glyphAlpha = (4.5 - t) / 0.5;
  }

  // Halo around glyph during hold (2.5..4.0s)
  if (t >= 2.5 && t < 4.0) {
    const haloT = (t - 2.5) / 1.5;
    const haloR = iconSize * (0.65 + Math.sin(t * 4) * 0.04);
    const haloAlpha = (1 - haloT) * 0.45;
    if (haloAlpha > 0.02) {
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloR);
      halo.addColorStop(0, `rgba(255, 220, 130, ${haloAlpha})`);
      halo.addColorStop(0.5, `rgba(255, 165, 60, ${haloAlpha * 0.5})`);
      halo.addColorStop(1, 'rgba(247, 147, 26, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(cx, cy, haloR, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ₿ glyph — scale up briefly during outburst for impact
  if (glyphAlpha > 0.02) {
    let scale = 1;
    if (t > 4.0 && t < 4.5) scale = 1 + (t - 4.0) / 0.5 * 0.15;
    ctx.save();
    ctx.globalAlpha = glyphAlpha;
    drawBtcCelebrate(ctx, cx, cy, iconSize * scale, 1);
    ctx.restore();
  }

  // Themed title — 'NONCE FOUND' (drawBFMText handles 3.0–5.5s reveal)
  drawBFMText(ctx, W, H, t, 'NONCE FOUND', cy, iconSize);
}

// ─── Shared themed text reveal (3.0 → 5.5s) ───
function drawBFMText(ctx, W, H, t, text, cy, iconSize) {
  if (t < 3.0) return;
  let alpha;
  if (t < 3.5) alpha = (t - 3.0) / 0.5;
  else if (t < 4.5) alpha = 1;
  else alpha = Math.max(0, (5.5 - t) / 1.0);
  if (alpha < 0.05) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const fontSize = Math.min(H * 0.05, 22);
  ctx.font = `bold ${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = '#F7931A';
  ctx.shadowColor = 'rgba(255, 165, 60, 0.9)';
  ctx.shadowBlur = 16;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.split('').join(' '), W / 2, cy + iconSize * 0.6);
  ctx.shadowBlur = 0;
  ctx.restore();
}

// ─── Modal component ───
const BFM_HOLD_MS = 10000; // Keep details visible 10s after celebration
const LS_LAST_CELEBRATED_BLOCK = 'ss_last_celebrated_block_height_v1';

function BlockFoundModal({ animType, block, prices, currency, onDismiss }) {
  const canvasRef = useRef(null);
  const lightningGLCanvasRef = useRef(null);  // rev54: WebGL canvas for lightning
  const lightningGLRef = useRef(null);         // rev54: WebGL renderer instance
  const bfmNonceGLCanvasRef = useRef(null);    // rev57: WebGL canvas for noncefield BFM
  const bfmNonceGLRef = useRef(null);           // rev57: WebGL renderer instance
  const containerRef = useRef(null);
  const animRef = useRef(0);
  const startedAtRef = useRef(performance.now());
  const stateRef = useRef(null);
  const [closing, setClosing] = useState(false);
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Reset state on (re)mount
  useEffect(() => {
    stateRef.current = {
      lightning: { bolts: [], megaBolt: null, sparks: [], megaBoltFired: false },
      noncefield:{ cells: new Float32Array(BFM_TOTAL) },
      pickaxe:   { shards: null },
      ticker:    { particles: [], embers: [] },
    };
    startedAtRef.current = performance.now();
  }, [animType]);

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const r = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = r.width * dpr;
      canvas.height = r.height * dpr;
      canvas.style.width = r.width + 'px';
      canvas.style.height = r.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const draw = () => {
      const r = container.getBoundingClientRect();
      const W = r.width, H = r.height;
      const t = (performance.now() - startedAtRef.current) / 1000;

      if (t < BFM_DURATION) {
        const st = stateRef.current;

        // rev54: WebGL path for lightning. Drives bolts/clouds/flash on a
        // dedicated WebGL canvas behind this 2D canvas; the 2D canvas
        // renders only the BTC icon, halo, sparks, and title text.
        if (animType === 'lightning') {
          if (!lightningGLRef.current && lightningGLCanvasRef.current) {
            const r2 = createLightningWebGL(lightningGLCanvasRef.current, { scale: 'bfm' });
            if (r2 && !r2.failed) lightningGLRef.current = r2;
            else lightningGLRef.current = { failed: true };
          }
          const glr = lightningGLRef.current;
          if (glr && !glr.failed) {
            // Phase-aware spawn rate, matching original BFM cadence
            let spawnRate;
            if (t < 1.2) spawnRate = 3 + t * 30;
            else if (t < 1.8) spawnRate = 60;
            else spawnRate = 5;
            // Mega-bolt at t=1.4, fired once, aimed at icon top-center
            if (t >= 1.4 && !st.lightning.megaBoltFired) {
              const cx = W / 2, cy = H / 2;
              const iconSize = Math.min(H * 0.55, W * 0.7);
              const iconTopY = cy - iconSize / 2;
              glr.spawnBolt({ type: 'mega', x: cx, targetY: iconTopY - 4 });
              st.lightning.megaBoltFired = true;
            }
            const glDt = 1 / 60;
            glr.step(glDt, 0, true, { spawnRateOverride: spawnRate });
            // Now overlay on 2D canvas: clear (transparent) + draw icon/halo/text
            ctx.clearRect(0, 0, W, H);
            drawBFMLightningOverlay(ctx, W, H, t, st.lightning);
            animRef.current = requestAnimationFrame(draw);
            return;
          }
          // Fallback: 2D path
        }

        // rev57: WebGL path for noncefield BFM (Convergence Storm). Drives
        // particles, gold ring, bloom rays, and burst shockwave on the
        // dedicated WebGL canvas. The 2D canvas overlays only the ₿ glyph
        // + halo + title text via drawBFMNonceOverlay. Uses the same
        // nonce-field-webgl module as the in-card animation, just with
        // mode='bfm' to switch shader programs (matches lightning pattern).
        if (animType === 'noncefield') {
          if (!bfmNonceGLRef.current && bfmNonceGLCanvasRef.current) {
            const r3 = createNonceFieldWebGL(bfmNonceGLCanvasRef.current, { mode: 'bfm' });
            if (r3 && !r3.failed) bfmNonceGLRef.current = r3;
            else bfmNonceGLRef.current = { failed: true };
          }
          const glr2 = bfmNonceGLRef.current;
          if (glr2 && !glr2.failed) {
            // Pass BFM time directly so phase boundaries are precise.
            glr2.step(1 / 60, 0, { bfmTime: t });
            ctx.clearRect(0, 0, W, H);
            drawBFMNonceOverlay(ctx, W, H, t);
            animRef.current = requestAnimationFrame(draw);
            return;
          }
          // Fallback: 2D path (existing drawBFMNonce)
        }

        const fn = animType === 'lightning' ? drawBFMLightning
                 : animType === 'pickaxe'   ? drawBFMPickaxe
                 : animType === 'ticker'    ? drawBFMTicker
                 :                            drawBFMNonce;
        const stateKey = animType === 'lightning' ? 'lightning'
                       : animType === 'pickaxe' ? 'pickaxe'
                       : animType === 'ticker'  ? 'ticker'
                       : 'noncefield';
        fn(ctx, W, H, t, st[stateKey]);
      } else {
        // After the celebration, render a simple dark canvas (block details remain visible)
        ctx.fillStyle = 'rgba(8,8,10,1)';
        ctx.fillRect(0, 0, W, H);
      }
      animRef.current = requestAnimationFrame(draw);
    };
    animRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
      // rev54: tear down WebGL on unmount
      if (lightningGLRef.current && !lightningGLRef.current.failed) {
        try { lightningGLRef.current.destroy(); } catch {}
        lightningGLRef.current = null;
      }
      // rev57: same for noncefield BFM WebGL
      if (bfmNonceGLRef.current && !bfmNonceGLRef.current.failed) {
        try { bfmNonceGLRef.current.destroy(); } catch {}
        bfmNonceGLRef.current = null;
      }
    };
  }, [animType]);

  // Auto-dismiss timer (5.5s celebration + 10s hold)
  useEffect(() => {
    const totalMs = BFM_DURATION * 1000 + BFM_HOLD_MS;
    const id = setTimeout(() => {
      setClosing(true);
      setTimeout(() => onDismiss && onDismiss(), 240);
    }, totalMs);
    return () => clearTimeout(id);
  }, [onDismiss]);

  // Live "found N seconds ago"
  useEffect(() => {
    const baseMs = block?.ts ? new Date(block.ts).getTime() : Date.now();
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - baseMs) / 1000));
      setSecondsAgo(sec);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [block]);

  const handleDismiss = (e) => {
    if (e) e.stopPropagation();
    if (closing) return;
    setClosing(true);
    setTimeout(() => onDismiss && onDismiss(), 240);
  };

  // Block details
  const height = block?.height ?? null;
  const reward = block?.reward ?? 0;
  const fiatPrice = (prices && prices[currency]) || (prices && prices.USD) || 0;
  const fiat = reward * fiatPrice;
  const heightStr = height != null ? '#' + Number(height).toLocaleString() : '#—';
  const btcStr = reward > 0 ? Number(reward).toFixed(8).replace(/0+$/, '').replace(/\.$/, '') : '—';
  const fiatStr = fiat > 0 ? new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0 }).format(fiat) : '';
  const totalSec = Math.floor(BFM_DURATION + BFM_HOLD_MS / 1000);
  const remaining = Math.max(0, totalSec - secondsAgo);

  return (
    <div
      onClick={handleDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'var(--bg-void, #06070a)',
        display: 'flex', flexDirection: 'column',
        opacity: closing ? 0 : 1,
        transition: 'opacity 240ms ease',
        animation: closing ? undefined : 'bfmFadeIn 320ms ease',
      }}
    >
      <style>{`
        @keyframes bfmFadeIn { from { opacity: 0 } to { opacity: 1 } }
      `}</style>
      <div
        onClick={handleDismiss}
        style={{
          position: 'absolute', top: 14, right: 14, zIndex: 5,
          width: 36, height: 36,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-3, #7a6d5e)', fontSize: 22,
          border: '1px solid rgba(245,166,35,0.18)', borderRadius: 18,
          background: 'rgba(0,0,0,0.4)', cursor: 'pointer', userSelect: 'none',
        }}
      >✕</div>

      <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {/* rev54: WebGL canvas behind the 2D canvas. Visible only during
            lightning animType. Renders bolts/clouds/flash; 2D canvas on
            top renders BTC icon + halo + sparks + title text. */}
        <canvas ref={lightningGLCanvasRef} style={{
          display: animType === 'lightning' ? 'block' : 'none',
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
        }} />
        {/* rev57: WebGL canvas for noncefield BFM (Convergence Storm).
            Same layering rationale as lightning above. Renders particles,
            gold ring, bloom rays, shockwave; 2D canvas overlays the ₿
            glyph + halo + title text. */}
        <canvas ref={bfmNonceGLCanvasRef} style={{
          display: animType === 'noncefield' ? 'block' : 'none',
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
        }} />
        <canvas ref={canvasRef} style={{
          display: 'block', width: '100%', height: '100%',
          position: 'relative',
        }} />
      </div>

      <div style={{
        height: 1, background: 'linear-gradient(90deg, transparent, rgba(245,166,35,0.3), transparent)',
        margin: '0 24px',
      }} />

      <div style={{ padding: '20px 24px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontFamily: 'var(--fd)', fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-2)', textTransform: 'uppercase' }}>
          Block Height
        </div>
        <div style={{ fontFamily: 'var(--fd)', fontSize: 28, fontWeight: 800, color: 'var(--amber)', textShadow: '0 0 12px rgba(245,166,35,0.4)', lineHeight: 1, letterSpacing: '0.02em' }}>
          {heightStr}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-1)' }}>
            {btcStr}<span style={{ fontFamily: 'var(--fd)', fontSize: 11, color: 'var(--amber)', marginLeft: 3, letterSpacing: '0.1em' }}>BTC</span>
          </div>
          {fiatStr && <div style={{ fontSize: 14, color: 'var(--text-2)' }}>{fiatStr}</div>}
        </div>
        <div style={{ fontFamily: 'var(--fd)', fontSize: 11, color: 'var(--text-3)', letterSpacing: '0.06em', marginTop: 4 }}>
          Found {secondsAgo === 0 ? 'just now' : `${secondsAgo} second${secondsAgo === 1 ? '' : 's'} ago`}
          {remaining > 0 ? ` · auto-dismiss in ${remaining}s` : ''}
        </div>
      </div>

      <div style={{ padding: '0 24px 28px' }}>
        <button
          onClick={handleDismiss}
          style={{
            width: '100%', padding: 16,
            background: 'linear-gradient(180deg, rgba(245,166,35,0.15), rgba(245,166,35,0.06))',
            border: '1px solid var(--amber)',
            color: 'var(--amber)',
            fontFamily: 'var(--fd)', fontSize: 13, fontWeight: 700,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            cursor: 'pointer',
            boxShadow: '0 0 18px rgba(245,166,35,0.18)',
          }}
        >Continue</button>
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
const LS_PULSE_ANIM              = 'ss_pulse_anim_v1';         // 'ticker' | 'globe' | 'block'
function loadCarouselEnabled() { try { const v = localStorage.getItem(LS_CAROUSEL_ENABLED); return v === null ? true : v === 'true'; } catch { return true; } }
function saveCarouselEnabled(v){ try { localStorage.setItem(LS_CAROUSEL_ENABLED, String(!!v)); } catch {} }
function loadStratumRotated()  { try { return localStorage.getItem(LS_STRATUM_ROTATED) === '1'; } catch { return false; } }
function saveStratumRotated()  { try { localStorage.setItem(LS_STRATUM_ROTATED, '1'); } catch {} }
const PULSE_ANIM_OPTIONS = [
  // rev61: removed 'sluice' (Sluice Box), 'glimmers' (Cave Glimmers),
  // 'embers' (Forge Embers) — they didn't fit the BTC-mining aesthetic.
  // v1.11.0: added 'block' (Strike Mesh) — peers progressively form
  // a 3D Bitcoin block as Pulse grows. Gold/amber cubes that arrange
  // themselves into corners → edges → faces → volume of a cube. Tap a cube
  // to fly the camera to it.
  // v1.11.1: removed earlier 'constellation' (Striker Constellation) option
  // since 'block' supersedes it on the same canvas + event-flow surface.
  // v1.11.x: removed 'ticker' (Hash Ticker) — moved to Hunt where the
  // network-state visualization belongs. Pulse is now exclusively
  // peer/community: Solo Strike Map shows where miners are; Block
  // Constellation shows who is mining and how the network forms.
  // Cleanup complete: constellation-2d.js deleted, all dual-mode checks
  // collapsed to single-mode. Existing users with stored 'constellation'
  // OR 'ticker' setting get auto-migrated to 'block' below.
  { id: 'globe', label: 'Solo Strike Map' },
  { id: 'block', label: 'Strike Mesh' },
];
const PULSE_ANIM_DEFAULT = 'block';
function loadPulseAnim() {
  try {
    const v = localStorage.getItem(LS_PULSE_ANIM);
    // v1.11.1: 'constellation' was removed in favor of 'block'.
    // v1.11.x: 'ticker' was moved to Hunt — for stored Pulse setting we
    // fall through to the new default ('block'). Users who liked the
    // ticker can re-enable it under Hunt → Hash Ticker.
    if (v === 'constellation' || v === 'ticker') return 'block';
    return PULSE_ANIM_OPTIONS.some(o => o.id === v) ? v : PULSE_ANIM_DEFAULT;
  } catch { return PULSE_ANIM_DEFAULT; }
}
function savePulseAnim(v) { try { localStorage.setItem(LS_PULSE_ANIM, String(v)); } catch {} }
// v1.11.x: useBitcoinSymbols toggle removed entirely. Was a Pulse-only
// option (₿ glyph vs shape) but the toggle was hidden from settings months
// ago and defaulted to false (shapes). All Pulse animations now render the
// shape variant always. Hash Ticker + Strike Mesh use ₿ glyphs natively
// without consulting this flag.

// User's approximate pool pin location. Stored as { lat, lon } in decimal
// degrees, snapped to a 5° grid (~500km cells, US-state-sized) before save.
// The same value also broadcasts over nostr when set, so other Strikers see
// our marker on the globe — but resolution is deliberately coarse so it
// reveals only country/region, never city or address.
const LS_POOL_PIN = 'ss_pool_pin_v1';
const POOL_PIN_GRID_DEG = 5;
function snapPinTo5Deg(lat, lon) {
  return {
    lat: Math.round(lat / POOL_PIN_GRID_DEG) * POOL_PIN_GRID_DEG,
    lon: Math.round(lon / POOL_PIN_GRID_DEG) * POOL_PIN_GRID_DEG,
  };
}
function loadPoolPin() {
  try {
    const raw = localStorage.getItem(LS_POOL_PIN);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return null;
    if (v.lat < -90 || v.lat > 90 || v.lon < -180 || v.lon > 180) return null;
    return snapPinTo5Deg(v.lat, v.lon);
  } catch { return null; }
}
function savePoolPin(pin) {
  try {
    if (pin) localStorage.setItem(LS_POOL_PIN, JSON.stringify(pin));
    else localStorage.removeItem(LS_POOL_PIN);
  } catch {}
}
// Push the user's pin to the API so it gets included in nostr broadcasts.
// Fire-and-forget — UI is the source of truth via localStorage; this just
// notifies the back-end so the next broadcast cycle includes it.
async function publishPoolPinToApi(pin) {
  try {
    const body = pin ? { lat: pin.lat, lon: pin.lon } : { lat: null, lon: null };
    await fetch('/api/network-stats/location', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.warn('Pool pin sync to API failed:', e);
  }
}

// Hunt card animation style (mirrors Pulse pattern)
const LS_HUNT_ANIM = 'ss_hunt_anim_v1';   // 'noncefield' | 'lightning' | 'pickaxe' | 'ticker'
const HUNT_ANIM_OPTIONS = [
  { id: 'noncefield', label: 'Nonce Field' },
  // v1.11.x: 'sonar' was removed — weakest mining metaphor (echo detection
  // doesn't match compute-grinding) and visually redundant with Nonce Field's
  // grid scan. Saved 'sonar' values migrate to 'lightning' via loadHuntAnim.
  { id: 'lightning',  label: 'The Strike' },
  { id: 'pickaxe',    label: 'Pickaxe Strike' },
  // v1.11.x: 'ticker' moved here from Pulse. The Hash Ticker is a network-
  // state visualization (hashrate-driven hex/BTC glyph rain), which belongs
  // with Hunt's other network-oriented animations rather than Pulse's
  // peer/community visualizations.
  { id: 'ticker',     label: 'Hash Ticker' },
];
// v1.11.x: Default changed from 'noncefield' to 'ticker'. Hash Ticker is
// the most recognizable / branded animation (hex chars + ₿ glyphs cascading)
// and it tells new users immediately "this is mining" — vs noncefield's
// abstract grid which requires explanation. Existing users keep their
// chosen animation; only first-install users hit this default.
const HUNT_ANIM_DEFAULT = 'ticker';
function loadHuntAnim() {
  try {
    const v = localStorage.getItem(LS_HUNT_ANIM);
    // v1.11.x: 'sonar' was removed — migrate any stored sonar value to
    // 'lightning' (closest visual cousin: center-focused energy/strike).
    // Persist the migration so subsequent reads return the new value.
    if (v === 'sonar') {
      try { localStorage.setItem(LS_HUNT_ANIM, 'lightning'); } catch {}
      return 'lightning';
    }
    return HUNT_ANIM_OPTIONS.some(o => o.id === v) ? v : HUNT_ANIM_DEFAULT;
  } catch { return HUNT_ANIM_DEFAULT; }
}
function saveHuntAnim(v) { try { localStorage.setItem(LS_HUNT_ANIM, String(v)); } catch {} }

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

// ── Debug Overlay (rev70) ────────────────────────────────────────────────────
// Persistent floating diagnostic panel. Toggle from Settings → Debug. Each
// section can be enabled independently. The panel updates every 500ms plus on
// every relevant event (scroll/resize/visualViewport). Latest snapshot is
// also stashed at window._ssDebugSnapshot so the "Copy snapshot" button in
// settings can dump it to clipboard for sharing.
//
// SECTIONS:
//   layout   — viewport, header/footer, carousel/slot/inner card metrics
//   state    — display mode, indices, splash flag, body classes
//   network  — pool loaded, stratum ports, last-update timestamp
//   build    — compose version, cache name, SW state, current path
//   storage  — every ss_* localStorage key + value (verbose; off by default)
//
// COLOR CODES:
//   green   — normal value
//   orange  — value flagged as anomalous (e.g., WASTED > 20px)
//   gray    — label
//
// HISTORY: replaces DebugLayoutOverlay from rev68/69 which was URL-hash- and
// localStorage-flag-toggled. This version is driven by ss_debug_settings_v1.
function DebugOverlay({ settings, onSettingsChange, appState }) {
  const [d, setD] = useState({});
  const [cacheName, setCacheName] = useState('…');
  const [cacheDetails, setCacheDetails] = useState([]); // [[name, count], ...]
  const [storageEstimate, setStorageEstimate] = useState(null);
  const [swRegs, setSwRegs] = useState([]);
  const [gpuRenderer, setGpuRenderer] = useState('');
  const [capabilities, setCapabilities] = useState(null);
  const [themeVars, setThemeVars] = useState({});

  // One-time GPU + capability probe. Done with a throwaway canvas so we
  // don't disturb any of the four real WebGL canvases the app uses.
  useEffect(() => {
    if (!settings.enabled) return;
    // GPU renderer
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl') || probe.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) {
          const r = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
          if (r) setGpuRenderer(String(r).slice(0, 60));
        }
        // Force context loss + cleanup so we don't leak
        const lc = gl.getExtension('WEBGL_lose_context');
        if (lc) lc.loseContext();
      }
    } catch (_) {}

    // Feature detection — synchronous, tiny.
    setCapabilities({
      WebGL:          !!window.WebGLRenderingContext,
      WebGL2:         !!window.WebGL2RenderingContext,
      WebAssembly:    typeof WebAssembly === 'object',
      ServiceWorker:  'serviceWorker' in navigator,
      CacheAPI:       'caches' in window,
      IndexedDB:      !!window.indexedDB,
      StorageManager: !!(navigator.storage && navigator.storage.estimate),
      Persistent:     !!(navigator.storage && navigator.storage.persist),
      WakeLock:       'wakeLock' in navigator,
      BatteryAPI:     'getBattery' in navigator,
      WebShare:       !!navigator.share,
      Clipboard:      !!(navigator.clipboard && navigator.clipboard.writeText),
      Notifications:  'Notification' in window,
      PushManager:    'PushManager' in window,
      VisualViewport: !!window.visualViewport,
      MediaSession:   'mediaSession' in navigator,
      'isSecure':     !!window.isSecureContext,
      'crossOriginIsolated': !!window.crossOriginIsolated,
    });
  }, [settings.enabled]);

  // CSS custom properties at :root — scans loaded stylesheets for any
  // `:root` rule and reads each declared `--*` property's computed value.
  // Refreshed only when the theme section is actually visible.
  useEffect(() => {
    if (!settings.enabled || !settings.theme) return;
    const refresh = () => {
      const out = {};
      try {
        const root = document.documentElement;
        const cs = window.getComputedStyle(root);
        const seen = new Set();
        for (const sheet of (document.styleSheets || [])) {
          let rules = null;
          try { rules = sheet.cssRules; } catch (_) { continue; /* CORS */ }
          if (!rules) continue;
          for (const rule of rules) {
            if (!rule || !rule.style) continue;
            if (rule.selectorText && rule.selectorText.includes(':root')) {
              for (let i = 0; i < rule.style.length; i++) {
                const name = rule.style[i];
                if (name && name.startsWith('--') && !seen.has(name)) {
                  seen.add(name);
                  out[name] = cs.getPropertyValue(name).trim();
                }
              }
            }
          }
        }
      } catch (_) {}
      setThemeVars(out);
    };
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [settings.enabled, settings.theme]);

  // SW registrations — every controller, including waiting/installing
  // workers (essential for catching "update available but page never
  // reloaded" states).
  useEffect(() => {
    if (!settings.enabled || !settings.build) return;
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistrations) {
      setSwRegs([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        if (cancelled) return;
        setSwRegs(regs.map((r) => ({
          scope: r.scope,
          installing: r.installing && r.installing.state,
          waiting:    r.waiting && r.waiting.state,
          active:     r.active && r.active.state,
          scriptURL:  (r.active && r.active.scriptURL) || (r.waiting && r.waiting.scriptURL) || '',
        })));
      } catch (_) {}
    };
    refresh();
    const id = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [settings.enabled, settings.build]);

  // Storage estimate — origin-wide quota + usage. Critical for diagnosing
  // SW cache eviction (Safari can silently evict if the device is low).
  useEffect(() => {
    if (!settings.enabled || !settings.caches) return;
    if (!navigator.storage || !navigator.storage.estimate) {
      setStorageEstimate({ note: 'StorageManager API unavailable' });
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const est = await navigator.storage.estimate();
        if (cancelled) return;
        const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
        setStorageEstimate({
          usage: est.usage != null ? (est.usage / 1048576).toFixed(1) + ' MB' : '?',
          quota: est.quota != null ? (est.quota / 1048576).toFixed(0) + ' MB' : '?',
          pct:   (est.usage && est.quota) ? ((est.usage / est.quota) * 100).toFixed(1) + '%' : '?',
          persisted,
        });
      } catch (_) {}
    };
    refresh();
    const id = setInterval(refresh, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [settings.enabled, settings.caches]);

  // Cache name is async (caches.keys() returns a Promise). Read it once when
  // the build section becomes visible — it doesn't change without a SW
  // update, so polling every 500ms would be wasteful.
  useEffect(() => {
    if (!settings.enabled || !settings.build) return;
    if (typeof window === 'undefined' || !('caches' in window)) {
      setCacheName('caches API unavailable');
      return;
    }
    let cancelled = false;
    window.caches.keys().then((keys) => {
      if (cancelled) return;
      const ssCaches = (keys || []).filter((k) => k && k.startsWith('solostrike-'));
      setCacheName(ssCaches[ssCaches.length - 1] || '(none)');
    }).catch(() => { if (!cancelled) setCacheName('error'); });
    return () => { cancelled = true; };
  }, [settings.enabled, settings.build]);

  // Cache detail enumeration — opens each cache and counts entries. Heavier
  // than name lookup so we only do it when the caches section is on, and
  // refresh every few seconds rather than every tick.
  useEffect(() => {
    if (!settings.enabled || !settings.caches) return;
    if (typeof window === 'undefined' || !('caches' in window)) {
      setCacheDetails([['caches API', 'unavailable']]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const names = await window.caches.keys();
        const details = await Promise.all(
          (names || []).map(async (name) => {
            try {
              const cache = await window.caches.open(name);
              const reqs = await cache.keys();
              return [name, reqs.length];
            } catch { return [name, '?']; }
          })
        );
        if (!cancelled) setCacheDetails(details);
      } catch (_) { if (!cancelled) setCacheDetails([['error', 'enumeration failed']]); }
    };
    refresh();
    const id = setInterval(refresh, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [settings.enabled, settings.caches]);

  useEffect(() => {
    if (!settings.enabled) return;

    const update = () => {
      const cs = (el) => el ? window.getComputedStyle(el) : null;
      const dims = (el) => {
        if (!el) return 'none';
        const r = el.getBoundingClientRect();
        return `${Math.round(r.width)}×${Math.round(r.height)}`;
      };

      // ── Carousel / slot / inner card ────────────────────────────────
      const carousel = document.querySelector('.ss-carousel');
      const slots = carousel ? carousel.querySelectorAll(':scope > *') : [];
      const idx = carousel && carousel.clientWidth
        ? Math.round(carousel.scrollLeft / carousel.clientWidth)
        : 0;
      const slot = slots[idx];
      const inner = slot ? slot.querySelector(':scope > div') : null;

      const headerEl = document.querySelector('.ss-app-header') || document.querySelector('header');
      const footerEl = document.querySelector('footer');
      const headerH = headerEl ? Math.round(headerEl.getBoundingClientRect().height) : 0;
      const footerH = footerEl ? Math.round(footerEl.getBoundingClientRect().height) : 0;

      // Probe 100dvh: the spec says it == innerHeight in modern Safari, but
      // older WebKits diverge. Inserting an element sized to 100dvh and
      // measuring it is the only way to know what the CSS engine actually
      // resolves it to (relevant for the rev70 fix verification).
      let dvh = 'n/a';
      try {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;top:-99999px;left:0;height:100dvh;width:1px;pointer-events:none';
        document.body.appendChild(probe);
        dvh = Math.round(probe.getBoundingClientRect().height) + 'px';
        document.body.removeChild(probe);
      } catch (_) {}

      let carouselHVar = 'n/a';
      if (carousel) {
        const v = window.getComputedStyle(carousel).getPropertyValue('--carousel-h').trim();
        carouselHVar = v || '(unset, using fallback)';
      }

      const cInner = cs(inner);
      const cSlot = cs(slot);

      // ── Display mode (PWA / browser / iframe) ───────────────────────
      // PWA detection: matchMedia covers all modern browsers; navigator.standalone
      // is the legacy iOS-Safari API. Either being true means we're in PWA mode.
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
      let isIframe = false;
      try { isIframe = window.self !== window.top; } catch { isIframe = true; }
      const mode = isIframe ? 'iframe' : (isStandalone ? 'PWA' : 'browser');

      // ── Service Worker state ────────────────────────────────────────
      let swState = 'n/a';
      let swScope = 'n/a';
      if ('serviceWorker' in navigator) {
        const ctrl = navigator.serviceWorker.controller;
        swState = ctrl ? ctrl.state : 'no controller';
        try { swScope = ctrl ? new URL(ctrl.scriptURL).pathname : '—'; } catch { swScope = '—'; }
      }

      // ── Storage section (verbose; only collect if enabled) ──────────
      let storageEntries = [];
      let storageSize = 0;
      if (settings.storage) {
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith('ss_')) continue;
            const v = localStorage.getItem(k);
            storageSize += (k.length + (v ? v.length : 0));
            const truncated = v && v.length > 60 ? v.slice(0, 60) + '…' : (v || '');
            storageEntries.push([k, truncated]);
          }
          storageEntries.sort((a, b) => a[0].localeCompare(b[0]));
        } catch (_) { storageEntries = [['error', 'localStorage blocked']]; }
      }

      // ── Performance ─────────────────────────────────────────────────
      // FPS samples are accumulated by the module-level rAF tick. Memory
      // is Chrome-only (Safari returns undefined for performance.memory).
      const fpsAvg = _ssDebug.fpsSamples.length
        ? Math.round(_ssDebug.fpsSamples.reduce((a, b) => a + b, 0) / _ssDebug.fpsSamples.length)
        : _ssDebug.fps;
      const mem = (performance && performance.memory) ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB',
        total: Math.round(performance.memory.totalJSHeapSize / 1048576) + ' MB',
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576) + ' MB',
      } : null;
      const domNodes = document.getElementsByTagName('*').length;
      // Page-load timing — captured once but only when navigation timing exists
      let nav = null;
      try {
        const ne = performance.getEntriesByType('navigation')[0];
        if (ne) {
          nav = {
            ttfb: Math.round(ne.responseStart - ne.requestStart) + 'ms',
            dcl: Math.round(ne.domContentLoadedEventEnd) + 'ms',
            load: Math.round(ne.loadEventEnd) + 'ms',
            type: ne.type,
          };
        }
      } catch (_) {}

      // ── Device / environment ────────────────────────────────────────
      // Probe safe-area-insets by inserting a probe styled with env(...) and
      // measuring its dimensions (CSS env vars aren't exposed via JS otherwise).
      const safeArea = (() => {
        try {
          const probe = document.createElement('div');
          probe.style.cssText = 'position:fixed;top:-99999px;left:-99999px;padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);width:0;height:0;pointer-events:none';
          document.body.appendChild(probe);
          const cs2 = window.getComputedStyle(probe);
          const sa = `${parseInt(cs2.paddingTop)||0}/${parseInt(cs2.paddingRight)||0}/${parseInt(cs2.paddingBottom)||0}/${parseInt(cs2.paddingLeft)||0}`;
          document.body.removeChild(probe);
          return sa;
        } catch { return 'n/a'; }
      })();
      const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      const orient = (() => {
        try { return (window.screen && window.screen.orientation && window.screen.orientation.type) || (window.orientation != null ? `${window.orientation}°` : 'n/a'); }
        catch { return 'n/a'; }
      })();

      // ── Pool / mining detail ────────────────────────────────────────
      // Worker breakdown comes from appState.workers (passed as poolStateLoaded
      // proxy below). For richer detail we'd need direct poolState access; here
      // we lean on the appState the overlay was given.
      const workers = appState?.workers || [];
      const workerCounts = workers.reduce((acc, w) => {
        const s = w?.status || (w?.connected === false ? 'offline' : 'online');
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {});
      const totalHr = appState?.totalHashrate;
      const lastShareAge = (() => {
        if (!workers.length) return null;
        let mostRecent = 0;
        for (const w of workers) if (w?.lastSeen && w.lastSeen > mostRecent) mostRecent = w.lastSeen;
        if (!mostRecent) return null;
        const sec = Math.round((Date.now() - mostRecent) / 1000);
        return sec < 60 ? sec + 's' : Math.round(sec / 60) + 'm';
      })();

      // ── Interaction ─────────────────────────────────────────────────
      const idleMs = _ssDebug.lastTap.ts ? (Date.now() - _ssDebug.lastTap.ts) : null;
      const idleStr = idleMs == null ? '—'
        : idleMs < 1000 ? idleMs + 'ms'
        : idleMs < 60000 ? Math.round(idleMs / 1000) + 's'
        : Math.round(idleMs / 60000) + 'm';

      // ── Transport (WS / SSE) ────────────────────────────────────────
      // Read live readyState by dereferencing the actual instance — the
      // value flips between connecting/open/closing/closed without firing
      // additional events, so the cached value would lag.
      const wsState = ['CONNECTING','OPEN','CLOSING','CLOSED'];
      const wsList = _ssDebug.wsInstances.map((e) => ({
        url: e.url,
        state: wsState[e.ws.readyState] || '?',
        msgs: e.msgCount,
        lastMsg: e.lastMsgTs ? Math.round((Date.now() - e.lastMsgTs) / 1000) + 's ago' : '—',
        closeCode: e.closeCode,
        closeReason: e.closeReason,
      }));
      const esState = ['CONNECTING','OPEN','CLOSED'];
      const esList = _ssDebug.esInstances.map((e) => ({
        url: e.url,
        state: esState[e.es.readyState] || '?',
        msgs: e.msgCount,
        lastMsg: e.lastMsgTs ? Math.round((Date.now() - e.lastMsgTs) / 1000) + 's ago' : '—',
      }));

      // ── WebGL canvas inventory ──────────────────────────────────────
      // Canvases live in the DOM; we just enumerate. We DO NOT call
      // getContext on them — that would either return existing context
      // (fine) or attach a new context type and break the existing one.
      const canvases = Array.from(document.querySelectorAll('canvas')).map((c, i) => {
        const r = c.getBoundingClientRect();
        return {
          i,
          intrinsic: `${c.width}×${c.height}`,
          rendered: `${Math.round(r.width)}×${Math.round(r.height)}`,
          cls: _ssTruncate(c.className || '(no class)', 30),
        };
      });

      // ── Visibility / wake lock ──────────────────────────────────────
      const visTransitionAge = _ssDebug.visibility.lastChangeTs
        ? Math.round((Date.now() - _ssDebug.visibility.lastChangeTs) / 1000)
        : null;
      // Wake lock state can't be queried directly but if the app held one,
      // it's in a known global. We just report API availability here.
      const wakeLockSupported = 'wakeLock' in navigator;

      // ── Resource timing recap ───────────────────────────────────────
      const resourceList = _ssDebug.resources.slice(-10).reverse();

      // ── Time / locale ───────────────────────────────────────────────
      let tz = 'n/a';
      let locale = 'n/a';
      try {
        const opts = Intl.DateTimeFormat().resolvedOptions();
        tz = opts.timeZone || 'n/a';
        locale = opts.locale || 'n/a';
      } catch (_) {}
      const uptimeMs = Date.now() - _ssDebug.installedAt;
      const uptime = uptimeMs < 60000 ? Math.round(uptimeMs / 1000) + 's'
        : uptimeMs < 3600000 ? Math.round(uptimeMs / 60000) + 'm'
        : (uptimeMs / 3600000).toFixed(1) + 'h';

      const next = {
        // viewport
        win: `${window.innerWidth}×${window.innerHeight}`,
        docEl: `${document.documentElement.clientWidth}×${document.documentElement.clientHeight}`,
        dvh,
        headerH: headerH + 'px',
        footerH: footerH + 'px',
        // carousel
        carouselHVar,
        cssH: carousel ? cs(carousel).height : 'no carousel',
        carouselR: dims(carousel),
        // WASTED uses 30px reserve to match the DOTS_RESERVE constant in the
        // carousel-h measurement effect — anything ≤30 here is "fine, the dots
        // just fit there." Above that = real wasted space.
        wasted: (() => {
          if (!carousel) return 'n/a';
          const target = window.innerHeight - headerH - footerH - 30;
          const actual = Math.round(carousel.getBoundingClientRect().height);
          return Math.max(0, target - actual) + 'px';
        })(),
        // slot
        slotIdx: idx,
        slotCount: slots.length,
        slotR: dims(slot),
        slotH: cSlot ? cSlot.height : 'none',
        slotMinH: cSlot ? cSlot.minHeight : 'none',
        slotDisp: cSlot ? cSlot.display : 'none',
        slotDir: cSlot ? cSlot.flexDirection : 'none',
        // inner
        innerR: dims(inner),
        innerFlex: cInner ? cInner.flex : 'none',
        innerH: cInner ? cInner.height : 'none',
        gap: (slot && inner)
          ? Math.round(slot.getBoundingClientRect().height - inner.getBoundingClientRect().height) + 'px'
          : 'n/a',
        // mode / state
        mode,
        cMatch: window.matchMedia('(max-width: 767px)').matches,
        gMatch: window.matchMedia('(min-width: 768px)').matches,
        body: document.body.className.split(' ').filter((c) => c.startsWith('ss-')).join(' '),
        // sw / build
        swState,
        swScope,
        href: window.location.pathname + window.location.hash,
        ts: new Date().toLocaleTimeString(),
        // performance
        fps: _ssDebug.fps,
        fpsAvg,
        longTasks: _ssDebug.longTasks,
        mem,
        domNodes,
        nav,
        // errors
        errCount: _ssDebug.errors.length,
        rejCount: _ssDebug.rejections.length,
        recentErrors: _ssDebug.errors.slice(-3).reverse(),
        recentRejections: _ssDebug.rejections.slice(-2).reverse(),
        // console
        consoleEntries: _ssDebug.consoleLog.slice(-15).reverse(),
        // api
        apiEntries: _ssDebug.apiCalls.slice(-12).reverse(),
        // device
        ua: navigator.userAgent,
        dpr: window.devicePixelRatio,
        online: navigator.onLine,
        connType: conn ? (conn.effectiveType || 'unknown') : 'n/a',
        connDownlink: conn && conn.downlink ? conn.downlink + ' Mbps' : 'n/a',
        connSaveData: conn ? !!conn.saveData : 'n/a',
        prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        prefersDark: window.matchMedia('(prefers-color-scheme: dark)').matches,
        touchPoints: navigator.maxTouchPoints || 0,
        orient,
        safeArea,
        vvOffset: window.visualViewport
          ? `${Math.round(window.visualViewport.offsetTop)},${Math.round(window.visualViewport.offsetLeft)}`
          : 'n/a',
        vvScale: window.visualViewport ? window.visualViewport.scale.toFixed(2) : 'n/a',
        vvSize: window.visualViewport
          ? `${Math.round(window.visualViewport.width)}×${Math.round(window.visualViewport.height)}`
          : 'n/a',
        // pool detail
        workerCounts,
        totalWorkers: workers.length,
        totalHr,
        lastShareAge,
        recentBlocks: appState?.recentBlocks,
        // interaction
        lastTap: _ssDebug.lastTap.ts ? `${_ssDebug.lastTap.type} @${_ssDebug.lastTap.x},${_ssDebug.lastTap.y}` : '—',
        idle: idleStr,
        // storage
        storageEntries,
        storageSizeKB: storageSize ? (storageSize / 1024).toFixed(1) + ' KB' : null,
        // transport
        wsList,
        esList,
        // webgl
        canvases,
        ctxLoss: _ssDebug.ctxLoss.length,
        gpuRenderer,
        // visibility
        visState: _ssDebug.visibility.state,
        visTransitions: _ssDebug.visibility.transitions,
        visAge: visTransitionAge != null ? (visTransitionAge < 60 ? visTransitionAge + 's' : Math.round(visTransitionAge/60) + 'm') : '—',
        wakeLockSupported,
        // battery
        battery: _ssDebug.battery,
        // resources
        resourceList,
        // time / uptime
        tz,
        locale,
        uptime,
      };
      setD(next);
      // Stash latest for the Settings → "Copy snapshot" button to grab.
      try { window._ssDebugSnapshot = next; } catch (_) {}
    };

    update();
    const interval = setInterval(update, 500);
    const carousel = document.querySelector('.ss-carousel');
    if (carousel) carousel.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const vv = window.visualViewport || null;
    if (vv) vv.addEventListener('resize', update);
    return () => {
      clearInterval(interval);
      if (carousel) carousel.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      if (vv) vv.removeEventListener('resize', update);
    };
  }, [settings.enabled, settings.storage]);

  if (!settings.enabled) return null;

  const Row = ({ k, v, hi }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: '#888' }}>{k}</span>
      <span style={{ color: hi ? '#FF7A00' : '#39ff6a', fontWeight: hi ? 700 : 400, textAlign: 'right', wordBreak: 'break-all' }}>{String(v ?? '')}</span>
    </div>
  );
  const Section = ({ title }) => (
    <div style={{ color: '#F5A623', fontWeight: 700, letterSpacing: '0.08em', marginTop: 6, marginBottom: 2, fontSize: 9 }}>
      ── {title} ──
    </div>
  );

  // GAP threshold: slot has padding 0.65rem 0.65rem 4px 0.65rem (~14.4px total
  // top+bottom). The "gap" between slot and inner card IS that padding, not a
  // real bug — flag only when materially larger than expected.
  const gapPx = parseInt(d.gap, 10);
  const hasGap = !isNaN(gapPx) && gapPx > 20;
  const wastedPx = parseInt(d.wasted, 10);
  const hasWasted = !isNaN(wastedPx) && wastedPx > 20;

  return (
    <div style={{
      position: 'fixed',
      top: 60,
      right: 8,
      zIndex: 9999,
      background: 'rgba(0,0,0,0.92)',
      color: '#39ff6a',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 9.5,
      padding: '8px 10px',
      border: '1px solid #39ff6a',
      borderRadius: 4,
      lineHeight: 1.45,
      maxWidth: 260,
      maxHeight: 'calc(100dvh - 100px)',
      overflowY: 'auto',
      pointerEvents: 'auto',
      boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ color: '#F5A623', fontWeight: 700, letterSpacing: '0.08em' }}>DEBUG · {d.ts || '—'}</span>
        <button
          onClick={() => onSettingsChange({ ...settings, enabled: false })}
          style={{
            background: 'transparent',
            border: '1px solid #39ff6a',
            color: '#39ff6a',
            fontFamily: 'inherit',
            fontSize: 11,
            cursor: 'pointer',
            padding: '0 6px',
            borderRadius: 3,
            lineHeight: 1,
          }}
          aria-label="Close debug overlay"
        >×</button>
      </div>

      {settings.layout && (
        <>
          <Section title="layout · viewport" />
          <Row k="win" v={d.win}/>
          <Row k="docEl" v={d.docEl}/>
          <Row k="100dvh" v={d.dvh}/>
          <Row k="header.h" v={d.headerH}/>
          <Row k="footer.h" v={d.footerH}/>
          <Section title="layout · carousel" />
          <Row k="--carousel-h" v={d.carouselHVar}/>
          <Row k="cs.height" v={d.cssH}/>
          <Row k="rect" v={d.carouselR}/>
          <Row k="WASTED" v={d.wasted} hi={hasWasted}/>
          <Section title={`layout · slot[${d.slotIdx}/${d.slotCount}]`} />
          <Row k="rect" v={d.slotR}/>
          <Row k="cs.height" v={d.slotH}/>
          <Row k="cs.min-h" v={d.slotMinH}/>
          <Row k="cs.display" v={d.slotDisp} hi={d.slotDisp !== 'flex'}/>
          <Row k="cs.flex-dir" v={d.slotDir} hi={d.slotDir !== 'column'}/>
          <Section title="layout · inner card" />
          <Row k="rect" v={d.innerR}/>
          <Row k="cs.flex" v={d.innerFlex}/>
          <Row k="cs.height" v={d.innerH}/>
          <Row k="GAP (slot-inner)" v={d.gap} hi={hasGap}/>
        </>
      )}

      {settings.state && (
        <>
          <Section title="state" />
          <Row k="mode" v={d.mode}/>
          <Row k="≤767px" v={d.cMatch}/>
          <Row k="≥768px" v={d.gMatch}/>
          <Row k="body" v={d.body}/>
          <Row k="useCarousel" v={appState?.useCarousel}/>
          <Row k="minimalMode" v={appState?.minimalMode}/>
          <Row k="splash done" v={appState?.minSplashElapsed}/>
          <Row k="carouselEnabled" v={appState?.carouselEnabled}/>
          <Row k="uptime" v={d.uptime}/>
          <Row k="timezone" v={d.tz}/>
          <Row k="locale" v={d.locale}/>
        </>
      )}

      {settings.network && (
        <>
          <Section title="network" />
          <Row k="pool loaded" v={appState?.poolStateLoaded}/>
          <Row k="last update" v={appState?.poolLastUpdate || '—'}/>
          <Row k="connected" v={appState?.connected}/>
          <Row k="status" v={appState?.poolStatus || '—'}/>
          <Row k="ports" v={(() => {
            const p = appState?.stratumHealth?.ports;
            if (!p || typeof p !== 'object') return '—';
            const entries = Object.entries(p);
            if (!entries.length) return '—';
            return entries.map(([k,v]) => `${k}:${v?.healthy ? '✓' : '✗'}`).join(' ');
          })()}/>
        </>
      )}

      {settings.build && (
        <>
          <Section title="build" />
          <Row k="compose v" v={appState?.composeVersion || '—'}/>
          <Row k="cache" v={cacheName}/>
          <Row k="sw state" v={d.swState}/>
          <Row k="sw scope" v={d.swScope}/>
          <Row k="path" v={d.href}/>
          {swRegs.length > 0 && (
            <>
              <Section title={`SW registrations (${swRegs.length})`} />
              {swRegs.map((r, i) => (
                <React.Fragment key={i}>
                  <Row k={`#${i} scope`} v={r.scope}/>
                  <Row k="  active" v={r.active || '—'}/>
                  <Row k="  waiting" v={r.waiting || '—'} hi={!!r.waiting}/>
                  <Row k="  installing" v={r.installing || '—'} hi={!!r.installing}/>
                </React.Fragment>
              ))}
            </>
          )}
        </>
      )}

      {settings.performance && (
        <>
          <Section title="performance" />
          <Row k="fps" v={`${d.fps ?? '—'} (avg ${d.fpsAvg ?? '—'})`} hi={typeof d.fps === 'number' && d.fps < 30}/>
          <Row k="long tasks" v={d.longTasks} hi={d.longTasks > 20}/>
          <Row k="DOM nodes" v={d.domNodes}/>
          {d.mem && <Row k="mem used" v={d.mem.used}/>}
          {d.mem && <Row k="mem total" v={d.mem.total}/>}
          {d.mem && <Row k="mem limit" v={d.mem.limit}/>}
          {!d.mem && <Row k="mem" v="(Safari/FF — n/a)"/>}
          {d.nav && <Row k="ttfb" v={d.nav.ttfb}/>}
          {d.nav && <Row k="dcl" v={d.nav.dcl}/>}
          {d.nav && <Row k="load" v={d.nav.load}/>}
          {d.nav && <Row k="nav type" v={d.nav.type}/>}
        </>
      )}

      {settings.errors && (
        <>
          <Section title={`errors (${d.errCount || 0} err · ${d.rejCount || 0} rej)`} />
          {(!d.errCount && !d.rejCount) && <Row k="status" v="clean ✓"/>}
          {(d.recentErrors || []).map((e, i) => (
            <Row key={'e'+i} k={new Date(e.ts).toLocaleTimeString()} v={`${e.msg} @${e.src.split('/').pop()}:${e.lineno}`} hi/>
          ))}
          {(d.recentRejections || []).map((r, i) => (
            <Row key={'r'+i} k={new Date(r.ts).toLocaleTimeString()} v={`reject: ${r.reason}`} hi/>
          ))}
        </>
      )}

      {settings.consoleLog && (
        <>
          <Section title={`console (${(d.consoleEntries || []).length})`} />
          {!d.consoleEntries?.length && <Row k="—" v="(no logs captured)"/>}
          {(d.consoleEntries || []).map((c, i) => (
            <Row key={'c'+i}
              k={new Date(c.ts).toLocaleTimeString().slice(0,8) + ' ' + c.level}
              v={c.text}
              hi={c.level === 'error' || c.level === 'warn'}/>
          ))}
        </>
      )}

      {settings.api && (
        <>
          <Section title={`api (${(d.apiEntries || []).length} recent)`} />
          {!d.apiEntries?.length && <Row k="—" v="(no fetch calls)"/>}
          {(d.apiEntries || []).map((a, i) => (
            <Row key={'a'+i}
              k={`${a.method} ${a.url.replace(/^https?:\/\/[^/]+/, '')}`}
              v={`${a.status} · ${a.ms}ms`}
              hi={typeof a.status === 'number' ? (a.status >= 400 || a.ms > 1000) : true}/>
          ))}
        </>
      )}

      {settings.device && (
        <>
          <Section title="device" />
          <Row k="DPR" v={d.dpr}/>
          <Row k="online" v={d.online} hi={d.online === false}/>
          <Row k="connection" v={d.connType}/>
          <Row k="downlink" v={d.connDownlink}/>
          <Row k="save-data" v={d.connSaveData}/>
          <Row k="touch pts" v={d.touchPoints}/>
          <Row k="orientation" v={d.orient}/>
          <Row k="prefers-dark" v={d.prefersDark}/>
          <Row k="reduced-motion" v={d.prefersReducedMotion}/>
          <Row k="safe-area t/r/b/l" v={d.safeArea}/>
          <Row k="vv size" v={d.vvSize}/>
          <Row k="vv offset" v={d.vvOffset}/>
          <Row k="vv scale" v={d.vvScale}/>
          <Row k="UA" v={d.ua}/>
        </>
      )}

      {settings.caches && (
        <>
          <Section title={`cache storage (${cacheDetails.length})`} />
          {!cacheDetails.length && <Row k="—" v="(none)"/>}
          {cacheDetails.map(([name, count]) => (
            <Row key={name} k={name} v={count + ' entries'}/>
          ))}
          <Section title="storage estimate" />
          {storageEstimate ? (
            <>
              {storageEstimate.note && <Row k="note" v={storageEstimate.note}/>}
              {!storageEstimate.note && <Row k="usage" v={storageEstimate.usage}/>}
              {!storageEstimate.note && <Row k="quota" v={storageEstimate.quota}/>}
              {!storageEstimate.note && <Row k="used %" v={storageEstimate.pct} hi={parseFloat(storageEstimate.pct) > 80}/>}
              {!storageEstimate.note && <Row k="persisted" v={String(storageEstimate.persisted)}/>}
            </>
          ) : <Row k="…" v="loading"/>}
        </>
      )}

      {settings.transport && (
        <>
          <Section title={`transport · WS (${d.wsList?.length || 0})`} />
          {!d.wsList?.length && <Row k="—" v="(no WebSockets)"/>}
          {(d.wsList || []).map((w, i) => (
            <React.Fragment key={'ws'+i}>
              <Row k={`#${i} url`} v={w.url}/>
              <Row k="  state" v={w.state} hi={w.state !== 'OPEN'}/>
              <Row k="  msgs" v={w.msgs}/>
              <Row k="  last msg" v={w.lastMsg}/>
              {w.closeCode != null && <Row k="  close code" v={w.closeCode} hi/>}
              {w.closeReason && <Row k="  close reason" v={w.closeReason}/>}
            </React.Fragment>
          ))}
          <Section title={`transport · SSE (${d.esList?.length || 0})`} />
          {!d.esList?.length && <Row k="—" v="(no EventSources)"/>}
          {(d.esList || []).map((e, i) => (
            <React.Fragment key={'es'+i}>
              <Row k={`#${i} url`} v={e.url}/>
              <Row k="  state" v={e.state} hi={e.state !== 'OPEN'}/>
              <Row k="  msgs" v={e.msgs}/>
              <Row k="  last msg" v={e.lastMsg}/>
            </React.Fragment>
          ))}
        </>
      )}

      {settings.resources && (
        <>
          <Section title={`resources (slow/large, ${d.resourceList?.length || 0})`} />
          {!d.resourceList?.length && <Row k="—" v="(none flagged)"/>}
          {(d.resourceList || []).map((r, i) => {
            const path = r.name.replace(/^https?:\/\/[^/]+/, '');
            const sizeKB = r.size ? (r.size / 1024).toFixed(0) + 'KB' : '?';
            return (
              <Row key={'r'+i}
                k={`${r.type} ${path.split('/').pop() || path}`}
                v={`${r.dur}ms · ${sizeKB}`}
                hi={r.dur > 1000 || r.size > 524288}/>
            );
          })}
        </>
      )}

      {settings.visibility && (
        <>
          <Section title="visibility" />
          <Row k="state" v={d.visState} hi={d.visState !== 'visible'}/>
          <Row k="transitions" v={d.visTransitions}/>
          <Row k="last change" v={d.visAge}/>
          <Row k="wakeLock API" v={d.wakeLockSupported}/>
          <Row k="uptime" v={d.uptime}/>
        </>
      )}

      {settings.battery && (
        <>
          <Section title="battery" />
          {!d.battery && <Row k="—" v="(API unavailable on this browser)"/>}
          {d.battery && <Row k="level" v={d.battery.level + '%'} hi={d.battery.level < 20}/>}
          {d.battery && <Row k="charging" v={d.battery.charging}/>}
          {d.battery && d.battery.charging && <Row k="time to full" v={d.battery.chargingTime}/>}
          {d.battery && !d.battery.charging && <Row k="time remain" v={d.battery.dischargingTime}/>}
        </>
      )}

      {settings.webgl && (
        <>
          <Section title={`webgl · canvases (${d.canvases?.length || 0})`} />
          {!d.canvases?.length && <Row k="—" v="(no canvas elements)"/>}
          {(d.canvases || []).map((c) => (
            <React.Fragment key={c.i}>
              <Row k={`#${c.i} cls`} v={c.cls}/>
              <Row k="  intrinsic" v={c.intrinsic}/>
              <Row k="  rendered" v={c.rendered}/>
            </React.Fragment>
          ))}
          <Section title="webgl · gpu" />
          <Row k="renderer" v={gpuRenderer || '(unmasked info unavailable)'}/>
          <Row k="ctx loss" v={d.ctxLoss || 0} hi={d.ctxLoss > 0}/>
        </>
      )}

      {settings.capabilities && (
        <>
          <Section title="capabilities" />
          {!capabilities && <Row k="…" v="probing"/>}
          {capabilities && Object.entries(capabilities).map(([k, v]) => (
            <Row key={k} k={k} v={v ? '✓' : '✗'} hi={!v && (k === 'isSecure' || k === 'ServiceWorker')}/>
          ))}
        </>
      )}

      {settings.theme && (
        <>
          <Section title={`theme vars (${Object.keys(themeVars).length})`} />
          {!Object.keys(themeVars).length && <Row k="—" v="(none found in :root rules)"/>}
          {Object.entries(themeVars).map(([k, v]) => (
            <Row key={k} k={k} v={v}/>
          ))}
        </>
      )}

      {settings.pool && (
        <>
          <Section title="pool detail" />
          <Row k="workers" v={d.totalWorkers ?? '—'}/>
          {d.workerCounts && Object.entries(d.workerCounts).map(([s, n]) => (
            <Row key={s} k={`  ${s}`} v={n}/>
          ))}
          <Row k="hashrate" v={d.totalHr != null ? d.totalHr : '—'}/>
          <Row k="last share" v={d.lastShareAge ?? '—'}/>
          <Row k="recent blocks" v={d.recentBlocks ?? '—'}/>
        </>
      )}

      {settings.interaction && (
        <>
          <Section title="interaction" />
          <Row k="last tap" v={d.lastTap}/>
          <Row k="idle" v={d.idle}/>
        </>
      )}

      {settings.storage && (
        <>
          <Section title={`storage (${(d.storageEntries || []).length}${d.storageSizeKB ? ' · ' + d.storageSizeKB : ''})`} />
          {(d.storageEntries || []).map(([k, v]) => (
            <Row key={k} k={k.replace(/^ss_/, '')} v={v}/>
          ))}
        </>
      )}
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
// v1.11.39: memoized to skip re-renders when props unchanged across WS broadcasts
const StratumPanel = React.memo(function StratumPanel_Impl({ payoutAddress, stratumHealth, startedAt }) {
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
          {ssl && <span style={{fontSize:'0.45rem', letterSpacing:'0.14em', opacity:0.85, marginRight:3}}>TLS</span>}{port}
        </span>
        <span style={{fontSize:'0.5rem', letterSpacing:'0.08em', color: ps.color}}>
          {isCopied ? '✓ COPIED' : `${ps.dot} ${ps.status || 'tap to copy'}`}
        </span>
      </button>
    );
  };

  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, color:'var(--amber)', marginBottom:'0.5rem', flexShrink:0}}>▸ Stratum Connection</div>

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
        <div style={{...helperStyle, marginTop:5, fontSize:'0.6rem'}}>
          3333 ASIC · 3334 Hobby · <span style={{display:'inline-block', padding:'1px 5px', borderRadius:3, fontSize:'0.55rem', letterSpacing:'0.14em', color:'var(--cyan)', border:'1px solid rgba(0,255,209,0.45)', background:'rgba(0,255,209,0.05)', verticalAlign:'1px', marginRight:4}}>TLS</span>4333 SSL
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

      {/* v1.8.3-rev23: removed <PoolUptimeStrip> (was originally removed in
          rev20 but the change got lost in the rev21/rev22 build chain).
          Pool uptime/start data is shown in the Share Diagnostics modal. */}
    </div>
  );
});
StratumPanel.displayName = "StratumPanel";

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
    <div style={{...card, display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, color:'var(--amber)', flexShrink:0}}>▸ Hot Streak</div>
      <div style={{position:'relative', height:22, background:'var(--bg-deep)', border:'1px solid var(--border)', overflow:'hidden', marginBottom:8, flexShrink:0}}>
        <div style={{ height:'100%', width:`${pct}%`, background:'linear-gradient(90deg, var(--amber-glow, rgba(245,166,35,0.4)) 0%, var(--amber) 100%)', boxShadow:'0 0 8px rgba(245,166,35,0.4)', transition:'width 0.4s ease' }}/>
        <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--fd)', fontSize:'0.72rem', letterSpacing:'0.1em', color:'#000', fontWeight:700, mixBlendMode:'screen'}}>
          {pct.toFixed(1)}% to next
        </div>
      </div>
      <div style={statRow}>
        <span style={label}>Expected</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--text-1)'}}>{(luck.blocksExpected||0).toFixed(2)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Found</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--cyan)'}}>{luck.blocksFound||0}</span>
      </div>
      <div style={{...statRow, borderColor:'var(--border-hot, rgba(245,166,35,0.3))'}}>
        <span style={label}>Streak</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:luckColor,fontWeight:600}}>{luckLabel}</span>
      </div>
      <div style={{flex:1,minHeight:0}}/>
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
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, color:'var(--amber)', flexShrink:0}}>▸ Difficulty Retarget</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
        <div style={{textAlign:'center',padding:'0.25rem 0'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'2rem',fontWeight:700,color:changeColor,textShadow:`0 0 14px ${changeColor}50`,lineHeight:1}}>
            {difficultyChange>=0?'+':''}{difficultyChange.toFixed(2)}%
          </div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginTop:4}}>estimated change</div>
          {/* iter26: previous epoch comparison */}
          {prevDifficultyChange != null && (
            <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-2)', marginTop:6}}>
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
        <div style={{...statRow,marginBottom:0}}><span style={label}>Remaining Blocks</span><span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--text-1)'}}>{fmtNum(remainingBlocks)}</span></div>
        <div style={{...statRow,marginBottom:0}}><span style={label}>ETA</span><span style={{fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--amber)'}}>{fmtDurationMs(remainingTime)}</span></div>
      </div>
      <div style={{flex:1,minHeight:0}}/>
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
              // v1.8.3-rev22: use acceptedSdiffSum (session-scoped, from
              // share-watcher) instead of sh.accepted (lifetime sum from
              // ckpool's pool.status, which never resets and would inflate
              // both avgDiff and impliedHr by orders of magnitude).
              const acceptedDiff = sh.acceptedSdiffSum || 0;
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
    <div onClick={onOpen} style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', cursor: onOpen ? 'pointer' : 'default', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, color:'var(--amber)', display:'flex',justifyContent:'space-between',alignItems:'center',flexShrink:0}}>
        <span>▸ Share Stats</span>
        <a href="/api/export/workers.csv" download onClick={e=>e.stopPropagation()} style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.1em',color:'var(--cyan)',textDecoration:'none',padding:'4px 8px',marginRight:'14px',whiteSpace:'nowrap'}}>⬇ CSV</a>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.6rem'}}>
        <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.875rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Accepted Work</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'2.1rem',fontWeight:700,color:'var(--green)',lineHeight:1}}>{fmtDiff(workAccepted)}</div>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.75rem',color:'var(--text-2)',marginTop:6}}>
            {workRejected>0 && <><span style={{color:'var(--red)'}}>{fmtDiff(workRejected)}</span> rejected</>}
       <> · <span style={{color:stale>0?'var(--amber)':'var(--text-2)'}}>{fmtDiff(stale)}</span> stale</>
          </div>
        </div>
        {/* iter26: Reject Rate top-line + lifetime share counter */}
        {(rejectPct !== null || lifeAccepted > 0) && (
          <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.5rem'}}>
            {rejectPct !== null && (
              <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.65rem 0.5rem', minWidth:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.13em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:4}}>Reject Rate</div>
                <div style={{fontFamily:'var(--fd)',fontSize:'1.25rem',fontWeight:700,lineHeight:1,color: rejectPct < 0.5 ? 'var(--green)' : rejectPct < 2 ? 'var(--amber)' : 'var(--red)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {rejectPct < 0.001 ? rejectPct.toFixed(Math.min(10, Math.max(4, -Math.floor(Math.log10(rejectPct)) + 1))) : rejectPct.toFixed(rejectPct < 0.1 ? 3 : 2)}%
                </div>
              </div>
            )}
            {lifeAccepted > 0 && (
              <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.65rem 0.5rem', minWidth:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.13em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:4}}>Lifetime Shares</div>
                <div style={{fontFamily:'var(--fd)',fontSize:'1.25rem',fontWeight:700,lineHeight:1,color:'var(--cyan)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>
                  {fmtNum(lifeAccepted)}
                </div>
              </div>
            )}
          </div>
        )}
        <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.875rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Best Difficulty</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'2.1rem',fontWeight:700,color:'var(--amber)',lineHeight:1,textShadow:'0 0 14px rgba(245,166,35,0.3)'}}>{fmtDiff(bestshare||0)}<span style={{fontSize:'0.65rem',color:'var(--text-2)',marginLeft:6,fontWeight:400}}>all-time</span></div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-2)',marginTop:'0.2rem'}}>
          <span>{spsLabel}</span><span style={{color:'var(--cyan)'}}>{sharesPerMin}</span>
        </div>
        {onOpen && (
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',color:'var(--cyan)',textTransform:'uppercase',textAlign:'center',paddingTop:4,borderTop:'1px dashed var(--border)',marginTop:2}}>
            Tap for diagnostics ↗
          </div>
        )}
      </div>
      <div style={{flex:1,minHeight:0}}/>
    </div>
  );
}

// ── Top Miners (best share leaderboard) ──────────────────────────────────────
function BestShareLeaderboard({ workers, poolBest, aliases }) {
  const sorted = [...(workers || [])].filter(w => (w.bestshare||0) > 0).sort((a, b) => (b.bestshare || 0) - (a.bestshare || 0)).slice(0, 5);
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, color:'var(--amber)', flexShrink:0}}>▸ Top Miners — Best Difficulties</div>
      {sorted.length === 0 ? (
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.72rem',fontFamily:'var(--fd)'}}>No shares submitted yet<br/><span style={{color:'var(--amber)',fontSize:'0.65rem',display:'inline-flex',alignItems:'center',gap:4}}>Keep mining <img src="/pickaxe-icon.png" alt="⛏" draggable={false} style={{width:'0.85rem',height:'0.85rem',objectFit:'contain',verticalAlign:'middle'}}/></span></div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'0.35rem',flex:1,minHeight:0,overflowY:'auto'}}>
          {sorted.map((w, i) => {
            const on = w.status !== 'offline';
            const healthC = HEALTH_COLOR[w.health] || 'var(--text-3)';
            return (
              <div key={w.name} style={{padding:'0.55rem 0.7rem',background:'var(--bg-raised)',border:`1px solid ${i===0?'rgba(245,166,35,0.3)':'var(--border)'}`,opacity:on?1:0.55, minWidth:0, overflow:'hidden'}}>
                <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:3}}>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.78rem',fontWeight:700,color:i===0?'var(--amber)':'var(--text-2)',minWidth:22, flexShrink:0}}>#{i+1}</span>
                  <div style={{flex:1,minWidth:0,fontFamily:'var(--fm)',fontSize:'0.85rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={w.name}>{displayName(w.name, aliases)}</div>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.92rem',fontWeight:700,color:i===0?'var(--amber)':'var(--cyan)', flexShrink:0}}>{fmtDiff(w.bestshare || 0)}</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'0.5rem',paddingLeft:27,fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)'}}>
                  <div title={w.health||'unknown'} style={{width:6,height:6,borderRadius:'50%',background:on?healthC:'var(--text-3)',boxShadow:on?`0 0 4px ${healthC}`:'none',flexShrink:0}}/>
                  {w.minerType && <><span style={{color:'var(--text-3)',letterSpacing:'0.05em',textTransform:'uppercase',fontSize:'0.58rem'}}>{w.minerType}</span><span style={{color:'var(--text-3)'}}>·</span></>}
                  <span style={{color: on?'var(--amber)':'var(--text-3)'}}>{on ? fmtHr(w.hashrate) : 'offline'}</span>
                </div>
              </div>
            );
          })}
          <div style={{...statRow,marginTop:'0.4rem',borderColor:'var(--border-hot)',flexShrink:0}}>
            <span style={label}>Pool Best</span>
            <span style={{fontFamily:'var(--fd)',fontSize:'1.05rem',fontWeight:700,color:'var(--amber)',textShadow:'0 0 8px rgba(245,166,35,0.4)'}}>{fmtDiff(poolBest || 0)}</span>
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
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      {inner}
      <div style={{flex:1,minHeight:0}}/>
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
        <div style={{textAlign:'center',padding: compact ? '0.9rem' : '1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)'}}>No block hit yet.<br/><span style={{color:'var(--amber)',fontSize:'0.68rem',display:'inline-flex',alignItems:'center',gap:4}}>Keep mining <img src="/pickaxe-icon.png" alt="⛏" draggable={false} style={{width:'0.9rem',height:'0.9rem',objectFit:'contain',verticalAlign:'middle'}}/></span></div>
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
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      {inner}
      <div style={{flex:1,minHeight:0}}/>
    </div>
  );
}

// ── Recent network blocks ─────────────────────────────────────────────────────
function RecentBlocksPanel({ netBlocks }) {
  const list = netBlocks || [];
  if (!list.length) return null;
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      <div style={{...cardTitle, color:'var(--amber)', flexShrink:0}}>▸ The Ledger — Solo Winners ⚡</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.35rem',flex:1,minHeight:0,overflowY:'auto'}}>
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
          <div style={{fontSize:60,animation:'pulse 1.2s infinite',willChange:'opacity'}}>⚡</div>
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
        <h2 style={{fontFamily:'var(--fd)', color:'var(--amber)', letterSpacing:'0.1em', fontSize:'1.1rem', display:'flex', alignItems:'center', gap:'0.5rem'}}>
          <img src="/pickaxe-icon.png" alt="" draggable={false} style={{width:'1.2rem', height:'1.2rem', objectFit:'contain', filter:'drop-shadow(0 0 6px rgba(245,166,35,0.5))', flexShrink:0}}/>
          SoloStrike Setup
        </h2>
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

// ── System Health Card (v1.8.4) ───────────────────────────────────────────────
// Surfaces operational health metrics in the dashboard. Polls /api/health/detailed
// every 5s. Six indicator rows: containers, api, persistence, ckpool, zmq, disk.
// Headline state aggregates: ALL SYSTEMS GO / MINOR ISSUES / DEGRADED.
// Tap card → opens HealthDetailModal with full diagnostic info.
function HealthStatusCard({ onOpen }) {
  const [health, setHealth] = useState(null);
  const [errored, setErrored] = useState(false);
  // v1.11.9: track in-flight AbortController so we can kill zombie fetches.
  // After iOS Safari suspends and resumes, prior fetches sit on dead TCP
  // for 20-30s before browser timeout — confirmed in debug log
  // (21094ms hang on /api/health/detailed). Aborting on every new fetch
  // attempt clears the zombie immediately so the new request goes through.
  const inflightRef = useRef(null);

  const fetchHealth = useCallback(async () => {
    try { inflightRef.current?.abort(); } catch {}
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    const killTimer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch('/api/health/detailed', { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(killTimer);
      const data = await res.json();
      setHealth(data);
      setErrored(false);
    } catch (e) {
      // AbortError from our 8s killtimer or a real network failure both land here.
      // Don't clobber existing health state on abort — wait for the next poll cycle.
      if (e.name === 'AbortError') return;
      setErrored(true);
      // Show degraded state in card if endpoint is unreachable.
      setHealth({ overall: 'red', checks: {}, error: e.message });
    } finally {
      clearTimeout(killTimer);
      if (inflightRef.current === ctrl) inflightRef.current = null;
    }
  }, []);

  // Tiered polling per the handoff: 120s active, 480s hidden, instant refresh
  // on tab focus. The 120s cadence is calibrated to the ckpool amber zone
  // (2-10min): polling at 120s guarantees catching at least one sample inside
  // that 8-min window before it flips red. Going faster wastes battery without
  // improving warning fidelity; going slower (>150s) risks green→red transitions
  // without ever showing amber. iOS Safari already throttles background timers
  // heavily, so 480s when hidden respects that. The visibilitychange listener
  // gives the user instant fresh data the moment they look at the dashboard.
  useEffect(() => {
    let mounted = true;
    let interval;

    const safeFetch = () => { if (mounted) fetchHealth(); };

    const setupPolling = () => {
      clearInterval(interval);
      const rate = document.visibilityState === 'visible' ? 120000 : 480000;
      interval = setInterval(safeFetch, rate);
    };

    const onVis = () => {
      if (document.visibilityState === 'visible') {
        // Refresh immediately when user returns to tab — they want fresh data NOW.
        safeFetch();
      }
      setupPolling();
    };

    safeFetch();          // immediate first fetch on mount
    setupPolling();       // start the appropriate-rate interval
    document.addEventListener('visibilitychange', onVis);

    return () => {
      mounted = false;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [fetchHealth]);

  if (!health) {
    return (
      <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
        <div style={{...cardTitle, color:'var(--amber)', flexShrink:0}}>▸ System Health</div>
        <div style={{color:'var(--text-2)', fontFamily:'var(--fm)', fontSize:'0.8rem', padding:'0.5rem 0'}}>
          Checking…
        </div>
        <div style={{flex:1, minHeight:0}}/>
      </div>
    );
  }

  const headlineMap = {
    green: { text: 'ALL SYSTEMS GO', color: 'var(--green)' },
    amber: { text: 'MINOR ISSUES',    color: 'var(--amber)' },
    red:   { text: 'DEGRADED',        color: 'var(--red)' },
  };
  const headline = headlineMap[health.overall] || headlineMap.amber;

  const dotColor = (status) => HEALTH_COLOR[status] || 'var(--text-3)';
  const Dot = ({ color }) => (
    <span style={{
      display:'inline-block', width:8, height:8, borderRadius:'50%',
      background:color, marginRight:10,
      boxShadow:`0 0 6px ${color}`,
      verticalAlign:'middle', flexShrink:0,
    }}/>
  );

  const rows = [
    { key:'containers',  label:'CONTAINERS' },
    { key:'api',         label:'API' },
    { key:'persistence', label:'PERSISTENCE' },
    { key:'ckpool',      label:'CKPOOL' },
    { key:'zmq',         label:'ZMQ' },
    { key:'disk',        label:'DISK' },
  ];

  return (
    <div
      onClick={() => { if (onOpen) onOpen(health); }}
      style={{
        ...card, minWidth:0, maxWidth:'100%', overflow:'hidden',
        display:'flex', flexDirection:'column', height:'100%',
        cursor:'pointer',
      }}
      className="fade-in ss-card-chrome"
    >
      <div style={{...cardTitle, color:'var(--amber)', flexShrink:0}}>▸ System Health</div>
      <div style={{
        fontFamily:'var(--fd)', fontSize:'1.1rem', fontWeight:700,
        color:headline.color,
        textShadow:`0 0 10px ${headline.color}66`,
        letterSpacing:'0.08em',
        marginBottom:10,
      }}>
        {headline.text}
        {errored && (
          <span style={{
            fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-3)',
            marginLeft:8, fontWeight:400, letterSpacing:0,
          }}>
            · endpoint unreachable
          </span>
        )}
      </div>

      <div style={{borderTop:'1px solid var(--border)', opacity:0.6, marginBottom:8}}/>

      <div style={{display:'flex', flexDirection:'column', gap:5}}>
        {rows.map(row => {
          const check = health.checks?.[row.key];
          const status = check?.status || 'red';
          const value  = check?.value  || '—';
          return (
            <div key={row.key} style={{
              display:'flex', alignItems:'center', justifyContent:'space-between',
              fontFamily:'var(--fd)', fontSize:'0.7rem', letterSpacing:'0.08em',
              padding:'0.25rem 0',
            }}>
              <span style={{display:'flex', alignItems:'center', color:'var(--text-2)'}}>
                <Dot color={dotColor(status)}/>
                {row.label}
              </span>
              <span style={{
                fontFamily:'var(--fm)', fontSize:'0.72rem',
                color:'var(--text-1)', letterSpacing:0,
                textAlign:'right', maxWidth:'60%', overflow:'hidden',
                textOverflow:'ellipsis', whiteSpace:'nowrap',
              }}>
                {value}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{flex:1, minHeight:0}}/>

      <div style={{
        textAlign:'center', color:'var(--text-3)', fontFamily:'var(--fd)',
        fontSize:'0.6rem', letterSpacing:'0.15em',
        marginTop:12, paddingTop:10, borderTop:'1px solid var(--border)',
      }}>
        Tap for detailed diagnostic ▸
      </div>
    </div>
  );
}

// ── System Health Detail Modal (v1.8.4) ───────────────────────────────────────
// Pattern matches existing ShareStatsModal (fixed-overlay, click-outside-to-close).
function HealthDetailModal({ initialHealth, onClose }) {
  const [health, setHealth] = useState(initialHealth);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    // v1.11.9: 8s timeout — same iOS-suspend zombie-TCP pattern applies.
    const ctrl = new AbortController();
    const killTimer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch('/api/health/detailed', { cache: 'no-store', signal: ctrl.signal });
      const data = await res.json();
      setHealth(data);
    } catch {}
    finally { clearTimeout(killTimer); }
    setTimeout(() => setRefreshing(false), 300);
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const dotColor = (status) => HEALTH_COLOR[status] || 'var(--text-3)';
  const Dot = ({ color }) => (
    <span style={{
      display:'inline-block', width:10, height:10, borderRadius:'50%',
      background:color, marginRight:10, boxShadow:`0 0 8px ${color}`,
      flexShrink:0,
    }}/>
  );

  const fmtBytes = (b) => {
    if (!b || !Number.isFinite(b)) return '—';
    if (b < 1024) return `${b} B`;
    if (b < 1024*1024) return `${(b/1024).toFixed(1)} KB`;
    if (b < 1024*1024*1024) return `${(b/(1024*1024)).toFixed(1)} MB`;
    return `${(b/(1024*1024*1024)).toFixed(2)} GB`;
  };
  const fmtDuration = (ms) => {
    if (!ms || !Number.isFinite(ms)) return '—';
    const s = Math.floor(ms / 1000);
    if (s < 60)        return `${s}s`;
    if (s < 3600)      return `${Math.floor(s/60)}m ${s%60}s`;
    if (s < 86400)     return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
    return `${Math.floor(s/86400)}d ${Math.floor((s%86400)/3600)}h`;
  };

  const checks = health?.checks || {};
  const details = health?.details || {};
  const recentErrors = details.recentErrors || [];

  const headlineMap = {
    green: { text: 'ALL SYSTEMS GO', color: 'var(--green)' },
    amber: { text: 'MINOR ISSUES',    color: 'var(--amber)' },
    red:   { text: 'DEGRADED',        color: 'var(--red)' },
  };
  const headline = headlineMap[health?.overall] || headlineMap.amber;

  const checkRows = [
    { key:'containers',  label:'CONTAINERS' },
    { key:'api',         label:'API' },
    { key:'persistence', label:'PERSISTENCE' },
    { key:'ckpool',      label:'CKPOOL' },
    { key:'zmq',         label:'ZMQ' },
    { key:'disk',        label:'DISK' },
  ];

  const section   = { marginBottom:'1rem' };
  const secTitle  = { fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--amber)', marginBottom:'0.5rem' };
  const kvRow     = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.4rem 0.6rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:3 };
  const kvLabel   = { fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };
  const kvVal     = { fontFamily:'var(--fm)', fontSize:'0.75rem', color:'var(--text-1)', textAlign:'right' };

  return (
    <div
      style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',display:'flex',alignItems:'flex-start',justifyContent:'center',zIndex:250,padding:'calc(env(safe-area-inset-top) + 1rem) 0.75rem 0.75rem',overflowY:'auto'}}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div style={{
        background:'var(--bg-surface)', border:'1px solid var(--border)',
        width:'100%', maxWidth:560, padding:'1.25rem 1.1rem 1rem',
        boxShadow:'0 0 40px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.85rem'}}>
          <span style={{fontFamily:'var(--fd)', fontSize:'0.7rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--amber)'}}>
            ▸ System Diagnostics
          </span>
          <button onClick={onClose} style={{background:'transparent', border:'none', color:'var(--text-2)', fontSize:'1.4rem', cursor:'pointer', lineHeight:1, padding:'0 4px'}}>×</button>
        </div>

        {/* Headline */}
        <div style={{textAlign:'center', padding:'0.4rem 0 0.8rem'}}>
          <div style={{
            fontFamily:'var(--fd)', fontSize:'1.4rem', fontWeight:700,
            color:headline.color, textShadow:`0 0 14px ${headline.color}66`,
            letterSpacing:'0.08em',
          }}>
            {headline.text}
          </div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-3)', marginTop:4}}>
            v{details.version || '—'} · uptime {fmtDuration(details.uptime)}
          </div>
        </div>

        {/* Checks */}
        <div style={section}>
          <div style={secTitle}>Health checks</div>
          {checkRows.map(row => {
            const check = checks[row.key];
            const status = check?.status || 'red';
            const value = check?.value || '—';
            return (
              <div key={row.key} style={{
                display:'flex', alignItems:'center', justifyContent:'space-between',
                padding:'0.5rem 0.6rem', background:'var(--bg-raised)',
                border:'1px solid var(--border)', marginBottom:3,
              }}>
                <span style={{display:'flex', alignItems:'center', fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.08em', color:'var(--text-2)'}}>
                  <Dot color={dotColor(status)}/>{row.label}
                </span>
                <span style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-1)', textAlign:'right'}}>
                  {value}
                </span>
              </div>
            );
          })}
        </div>

        {/* Recent errors */}
        {recentErrors.length > 0 && (
          <div style={section}>
            <div style={secTitle}>Recent errors ({recentErrors.length})</div>
            <div style={{maxHeight:180, overflowY:'auto', background:'var(--bg-deep)', border:'1px solid var(--border)', padding:'0.5rem'}}>
              {recentErrors.map((err, i) => (
                <div key={i} style={{
                  fontFamily:'var(--fm)', fontSize:'0.68rem', color:'var(--text-2)',
                  padding:'0.3rem 0', borderBottom: i < recentErrors.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <div style={{color:'var(--red)'}}>{err.msg || '—'}</div>
                  <div style={{color:'var(--text-3)', fontSize:'0.6rem', marginTop:2}}>
                    {err.path || '—'} · {fmtDuration(Date.now() - (err.ts || 0))} ago
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Diagnostics */}
        <div style={section}>
          <div style={secTitle}>Diagnostics</div>
          <div style={kvRow}>
            <span style={kvLabel}>Memory · RSS</span>
            <span style={kvVal}>{fmtBytes(details.memoryUsage?.rss)}</span>
          </div>
          <div style={kvRow}>
            <span style={kvLabel}>Memory · Heap</span>
            <span style={kvVal}>{fmtBytes(details.memoryUsage?.heapUsed)} / {fmtBytes(details.memoryUsage?.heapTotal)}</span>
          </div>
          <div style={kvRow}>
            <span style={kvLabel}>WebSocket Clients</span>
            <span style={kvVal}>{details.wsClients ?? 0}</span>
          </div>
          <div style={kvRow}>
            <span style={kvLabel}>Persist file age</span>
            <span style={kvVal}>{details.persistMtimeAge != null ? fmtDuration(details.persistMtimeAge) : '—'}</span>
          </div>
          <div style={kvRow}>
            <span style={kvLabel}>Private Mode</span>
            <span style={kvVal}>{details.privateMode ? 'ON' : 'OFF'}</span>
          </div>
          {details.zmqEndpoint && (
            <div style={kvRow}>
              <span style={kvLabel}>ZMQ endpoint</span>
              <span style={{...kvVal, fontSize:'0.65rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'60%'}}>{details.zmqEndpoint}</span>
            </div>
          )}
        </div>

        {/* Refresh button */}
        <button
          onClick={refresh}
          disabled={refreshing}
          style={{
            width:'100%', padding:'0.7rem',
            background:'transparent', color:'var(--amber)',
            border:'1px solid var(--amber)',
            fontFamily:'var(--fd)', fontWeight:700,
            letterSpacing:'0.15em', fontSize:'0.7rem',
            cursor: refreshing ? 'wait' : 'pointer',
            textTransform:'uppercase',
            opacity: refreshing ? 0.6 : 1,
            marginTop:'0.5rem',
          }}
        >
          {refreshing ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>
    </div>
  );
}

// ── Settings Modal ────────────────────────────────────────────────────────────
function SettingsModal({ onClose, saveConfig, currentConfig, currency, onCurrencyChange, onResetLayout, workers, aliases, onAliasesChange, stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, performanceMode, onPerformanceModeChange, visibleCards, onVisibleCardsChange, networkStats, onNetworkStatsRefresh, carouselEnabled, onCarouselChange, pulseAnim, onPulseAnimChange, huntAnim, onHuntAnimChange, onPreviewCelebration, poolPin, onPoolPinChange, debugSettings, onDebugSettingsChange }) {
  const [tab, setTab] = useState('main');
  const [addr, setAddr] = useState(currentConfig?.payoutAddress || '');
  // v1.11.4: poolName field removed from settings — was only used in webhook payloads
  // where 'SoloStrike' is now hardcoded server-side. No user-facing effect lost.
  const [privateMode, setPrivateMode] = useState(!!currentConfig?.privateMode);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setLoading(true);
    try {
      await saveConfig({ payoutAddress: addr || undefined, privateMode });
      setSaved(true); setTimeout(()=>setSaved(false), 2000);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'calc(env(safe-area-inset-top) + 1rem) 1rem 1rem',overflowY:'auto'}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:'var(--bg-elevated, #15161a)',border:'1px solid var(--border)',maxWidth:680,width:'100%',padding:'1.4rem',marginTop:'2rem',marginBottom:'2rem'}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <h3 style={{margin:0,fontFamily:'var(--fd)',fontSize:'0.85rem',letterSpacing:'0.18em',color:'var(--amber)', display:'flex', alignItems:'center', gap:'0.5rem'}}>
            <img src="/pickaxe-icon.png" alt="" draggable={false} style={{width:'1rem', height:'1rem', objectFit:'contain', filter:'drop-shadow(0 0 6px rgba(245,166,35,0.5))', flexShrink:0}}/>
            Settings
          </h3>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:'1.2rem',lineHeight:1,padding:0}}>✕</button>
        </div>

        <div style={{display:'flex',gap:0,borderBottom:'1px solid var(--border)',marginBottom:14, flexWrap:'wrap'}}>
          {[
            ['main','Main'],
            ['display','Display'],
            ['privacy','Privacy'],
            ['pulse','Pulse'],
            ['hunt','Hunt'],
            ['aliases','Aliases'],
            ['webhooks','Webhooks'],
            ['debug','Debug'],
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
          <MainTab addr={addr} setAddr={setAddr}
            currency={currency} onCurrencyChange={onCurrencyChange} onResetLayout={onResetLayout}
            submit={submit} saved={saved} loading={loading}/>
        )}
        {tab==='display' && (
          <DisplayTab stripSettings={stripSettings} onStripSettingsChange={onStripSettingsChange}
            tickerSettings={tickerSettings} onTickerSettingsChange={onTickerSettingsChange}
            minimalMode={minimalMode} onMinimalModeChange={onMinimalModeChange}
            performanceMode={performanceMode} onPerformanceModeChange={onPerformanceModeChange}
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
            poolPin={poolPin} onPoolPinChange={onPoolPinChange}/>
        )}
        {tab==='hunt' && (
          <HuntTab huntAnim={huntAnim} onHuntAnimChange={onHuntAnimChange} onPreviewCelebration={onPreviewCelebration}/>
        )}
        {tab==='aliases' && (
          <AliasesTab workers={workers} aliases={aliases} onAliasesChange={onAliasesChange}/>
        )}
        {tab==='webhooks' && (
          <WebhooksTab/>
        )}
        {tab==='debug' && (
          <DebugTab settings={debugSettings} onSettingsChange={onDebugSettingsChange}/>
        )}
      </div>
    </div>
  );
}

// ── Main settings tab ─────────────────────────────────────────────────────────
function MainTab({addr,setAddr,currency,onCurrencyChange,onResetLayout,submit,saved,loading}) {
  return (
    <>
      <div style={{marginBottom:14}}>
        <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', color:'var(--text-2)', marginBottom:4, textTransform:'uppercase'}}>Bitcoin Payout Address</label>
        <input type="text" value={addr} onChange={e=>setAddr(e.target.value)} placeholder="bc1q..."
          style={{width:'100%',padding:'0.55rem',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.78rem',outline:'none',boxSizing:'border-box'}}/>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-3)', marginTop:5}}>Where block rewards go. Use a fresh, dedicated address from your own wallet.</div>
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
function DisplayTab({ stripSettings, onStripSettingsChange, tickerSettings, onTickerSettingsChange, minimalMode, onMinimalModeChange, performanceMode, onPerformanceModeChange, visibleCards, onVisibleCardsChange, carouselEnabled, onCarouselChange }) {
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

      {/* v1.11.39: Performance Mode — freezes decorative animations while
          keeping information-bearing animations (strike pulse) alive.
          Mirrors Minimal Mode UI pattern for visual consistency. */}
      <div style={firstSectionTitle}>▸ Performance Mode</div>
      <div style={{display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'0.5rem', padding:'0.75rem 0.8rem', background: performanceMode?'rgba(0,255,209,0.06)':'var(--bg-raised)', border:`1px solid ${performanceMode?'rgba(0,255,209,0.35)':'var(--border)'}`}}>
        <div style={{flex:1}}>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.78rem', color: performanceMode?'var(--cyan)':'var(--text-1)', fontWeight:700, letterSpacing:'0.08em', textTransform:'uppercase'}}>Static Mode</div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)', marginTop:3, lineHeight:1.4}}>
            Replaces animated Pulse globe and Hunt canvases with static baked frames. Reduces battery drain and heat on older devices. Strike pulse rings stay live (information-bearing).
          </div>
        </div>
        <button onClick={()=>onPerformanceModeChange(!performanceMode)}
          style={{width:46, height:26, borderRadius:13, background: performanceMode?'var(--cyan)':'var(--bg-deep)', border:'1px solid var(--border)', position:'relative', cursor:'pointer', flexShrink:0}}>
          <div style={{position:'absolute', top:2, left: performanceMode?22:2, width:20, height:20, borderRadius:'50%', background: performanceMode?'#000':'var(--text-2)', transition:'left 0.2s'}}/>
        </button>
      </div>
      {performanceMode && (
        <div style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--cyan)', marginBottom:'0.5rem', padding:'0.4rem 0.6rem', background:'rgba(0,255,209,0.04)', border:'1px dashed rgba(0,255,209,0.2)'}}>
          ⚡ Performance Mode is on — animations frozen for older or battery-throttled iPhones, budget Android, Pi 4/5, and DIY Umbrel hosts. Live strikes still pulse.
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

// ── Hunt tab — animation chooser for The Hunt card ────────────────────────────
function HuntTab({ huntAnim, onHuntAnimChange, onPreviewCelebration }) {
  return (
    <>
      <div style={{
        fontFamily: 'var(--fd)', fontSize: '0.6rem', letterSpacing: '0.12em',
        color: 'var(--text-2)', marginBottom: 8, textTransform: 'uppercase',
      }}>
        The Hunt — Animation Style
      </div>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: '0.4rem',
      }}>
        {HUNT_ANIM_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => onHuntAnimChange(opt.id)}
            style={{
              background: huntAnim === opt.id ? 'rgba(245,166,35,0.18)' : 'transparent',
              border: `1px solid ${huntAnim === opt.id ? 'var(--amber)' : 'var(--border)'}`,
              color: huntAnim === opt.id ? 'var(--amber)' : 'var(--text-2)',
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
        marginTop: 6, lineHeight: 1.5,
      }}>
        Choose how the nonce-search visualization on the Hunt card is rendered.
      </div>

      {/* v1.11.x: Bitcoin Symbols toggle removed entirely. The Hash Ticker
          always renders winner positions as Bitcoin (₿) glyphs — making it
          a permanent part of the visual identity rather than a setting. */}

      {/* ── Block-found celebration preview ─────────────────────────────── */}
      {onPreviewCelebration && (
        <>
          <div style={{
            fontFamily: 'var(--fd)', fontSize: '0.6rem', letterSpacing: '0.12em',
            color: 'var(--text-2)', marginTop: '1.4rem', marginBottom: 8, textTransform: 'uppercase',
          }}>
            Block-Found Celebration
          </div>
          <button
            onClick={onPreviewCelebration}
            style={{
              width: '100%', padding: '0.7rem 1rem',
              background: 'linear-gradient(180deg, rgba(245,166,35,0.10), rgba(245,166,35,0.04))',
              border: '1px solid var(--amber)',
              color: 'var(--amber)',
              fontFamily: 'var(--fd)', fontSize: '0.7rem', fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              cursor: 'pointer',
            }}
          >▸ Preview Celebration</button>
          <div style={{
            fontFamily: 'var(--fm)', fontSize: '0.62rem', color: 'var(--text-3)',
            marginTop: 6, lineHeight: 1.5,
          }}>
            Replays the fullscreen celebration that fires on a real block discovery, using the animation theme selected above.
          </div>
        </>
      )}

      <div style={{fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-3)', marginTop:'1.4rem', textAlign:'center', lineHeight:1.4}}>
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
function PulseTab({ networkStats, onRefresh, pulseAnim, onPulseAnimChange, poolPin, onPoolPinChange }) {
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
                // rev55 #2: Server requires explicit confirmation string in
                // body (defense against CSRF/XSS triggering this silently).
                const r = await fetch('/api/network-stats/export-backup', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ confirm: 'I-UNDERSTAND-EXPORT-MY-NOSTR-KEY' }),
                });
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

      {/* v1.11.x: Bitcoin Symbols toggle moved to Hunt → it now controls
          the Hash Ticker (which moved with it). PulseTab no longer surfaces
          this option. */}

      {/* ─── Your Pool Location ─────────────────────────────────────────── */}
      {onPoolPinChange && (
        <div style={{
          marginTop: 18, padding: '0.8rem',
          border: '1px solid var(--border)', borderRadius: 4,
          background: 'rgba(245,166,35,0.04)',
        }}>
          <div style={{
            fontFamily: 'var(--fd)', fontSize: '0.72rem', letterSpacing: '0.08em',
            color: 'var(--amber)', textTransform: 'uppercase', marginBottom: 8,
          }}>
            Your Pool Location
          </div>
          <div style={{
            fontFamily: 'var(--fm)', fontSize: '0.62rem', color: 'var(--text-3)',
            lineHeight: 1.5, marginBottom: 8,
          }}>
            {poolPin ? (
              <>
                Pinned to <span style={{ color: 'var(--text-1)' }}>
                  {Math.abs(poolPin.lat)}°{poolPin.lat >= 0 ? 'N' : 'S'},{' '}
                  {Math.abs(poolPin.lon)}°{poolPin.lon >= 0 ? 'E' : 'W'}
                </span>{' · '}snapped to a 5° grid (~500km cells). Country/region only — no city or GPS.
              </>
            ) : (
              <>Pin shows other Strikers where your pool is. Resolution is fuzzy to ~500km — country / region only, never a city or address. Switch the Pulse animation to <span style={{ color: 'var(--text-1)' }}>Globe</span>, then tap "Pin My Pool" below the globe.</>
            )}
          </div>
          {poolPin && (
            <button
              onClick={() => onPoolPinChange(null)}
              style={{
                background: 'transparent',
                border: '1px solid rgba(225,80,80,0.5)',
                color: '#ff8a8a',
                fontFamily: 'var(--fd)', fontSize: '0.62rem',
                letterSpacing: '0.08em', textTransform: 'uppercase',
                padding: '0.4rem 0.7rem',
                cursor: 'pointer', borderRadius: 2,
              }}
            >Remove Pin</button>
          )}
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

// v1.11.6: tween a numeric value smoothly over ~600ms with ease-out curve.
// Returns the in-flight animated value, which re-renders the component each
// animation frame. When `value` prop changes, animation restarts from current
// displayed value to the new target. Useful for hashrate displays that
// otherwise snap when peers update — animating creates a "system is alive"
// feel without being distracting. Used sparingly: only on the 2-3 highest
// impact numbers, not every value in the UI.
function useAnimatedNumber(value, durationMs = 600) {
  const [displayValue, setDisplayValue] = useState(value);
  const fromRef = useRef(value);
  const startedAtRef = useRef(0);
  const rafRef = useRef(0);
  useEffect(() => {
    if (value === displayValue) return;
    fromRef.current = displayValue;
    startedAtRef.current = performance.now();
    // Ease-out cubic: starts fast, decelerates to land softly.
    const tick = (now) => {
      const elapsed = now - startedAtRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = fromRef.current + (value - fromRef.current) * eased;
      setDisplayValue(next);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);
  return displayValue;
}

// ── PulsePanel — Heartbeat dashboard card (v1.7.0) ────────────────────────
// ── Strike Mesh Simulator (v1.11.x) ──────────────────────────
// Full-screen modal for previewing how the cube forms at peer counts the
// user won't realistically hit alone. Real network is 2 peers today; the
// simulator scrubs from 1 → 5K to showcase Bar → Corners → Edges → Faces
// → Volume formation with all the live effects (worker flashes, plasma
// bolts, energy packets, peer-cube glow pulse).
//
// Architecture:
//   - Mounted only when simulatorOpen=true (no cost when closed).
//   - Owns its own canvas + createConstellationCube renderer instance —
//     fully decoupled from the live Pulse cube underneath.
//   - Synthesizes peer worker counts from a deterministic seed based on
//     peerCount, so toggling chips gives a stable layout (no jitter when
//     re-selecting the same count).
//   - Synthesizes share events at a peer-density-scaled rate so flashes/
//     bolts/packets fire continuously. Burst button injects a wave.
//   - Sliding logarithmic scrub: peerCount maps to slider via log scale
//     so 1-2-8-20-50-200-1K-5K stages are roughly evenly spaced.
// v1.11.39: memoized to skip re-renders when props unchanged across WS broadcasts
const BlockSimulatorModal = React.memo(function BlockSimulatorModal_Impl({ onClose }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const animFrameRef = useRef(0);
  const lastFrameRef = useRef(performance.now());
  const burstUntilRef = useRef(0);

  const [peerCount, setPeerCount] = useState(2);
  const [density, setDensity] = useState('real');  // 'real' | 'cinematic'
  // Refs that mirror state — read inside the rAF loop without forcing
  // useEffect re-mount when the user changes peer count or density.
  const peerCountRef = useRef(peerCount);
  const densityRef = useRef(density);
  useEffect(() => { peerCountRef.current = peerCount; }, [peerCount]);
  useEffect(() => { densityRef.current = density; }, [density]);

  // Stable rng helper — seed derived from peer count + density so layouts
  // are reproducible. Lifted outside the loop body so the per-frame cost
  // is just a couple of integer ops.
  const synthPoolWorkers = useCallback((n, d) => {
    let s = (n * 17 + (d === 'cinematic' ? 99 : 7)) | 0;
    function rng() {
      s = (s + 0x6D2B79F5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    function rollWorkers() {
      if (d === 'cinematic') return 8 + Math.floor(rng() * 8);
      const roll = rng();
      return roll < 0.55 ? (1 + Math.floor(rng() * 2))
           : roll < 0.85 ? (3 + Math.floor(rng() * 3))
           : roll < 0.97 ? (6 + Math.floor(rng() * 3))
                         : (9 + Math.floor(rng() * 4));
    }
    const out = [];
    out.push(13);  // Own pool — fixed at 13 workers (matches real fleet size)
    for (let i = 1; i < n; i++) out.push(rollWorkers());
    return out;
  }, []);

  // Mount renderer once on open
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const r = createConstellationCube(canvas);
    rendererRef.current = r;
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (r && typeof r.destroy === 'function') r.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Animation loop — drives the renderer with synthesized peer + flash data
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const tick = (now) => {
      const dt = Math.min(0.05, (now - lastFrameRef.current) / 1000);
      lastFrameRef.current = now;
      const r = rendererRef.current;
      if (!r) { animFrameRef.current = requestAnimationFrame(tick); return; }

      const n = peerCountRef.current;
      const d = densityRef.current;
      const poolWorkers = synthPoolWorkers(n, d);
      const totalWorkers = poolWorkers.reduce((a, b) => a + b, 0);

      // Synthesize share events. Same flow as real Pulse but locally driven.
      const flashPoolIndices = [];
      const flashStrikerEvents = [];
      const baseRate = n > 200 ? 0.20 : 0.7;  // shares/sec/worker
      const totalPerSec = totalWorkers * baseRate;
      // Burst injects extra events for ~600ms after Burst button tap
      const burstActive = now < burstUntilRef.current;
      const burstMul = burstActive ? 4.0 : 1.0;

      const ownExp = totalPerSec * (poolWorkers[0] / totalWorkers) * dt * burstMul;
      let nOwn = Math.floor(ownExp);
      if (Math.random() < (ownExp - nOwn)) nOwn++;
      for (let k = 0; k < nOwn; k++) {
        flashStrikerEvents.push({
          poolIdx: 0,
          strikerIdx: Math.floor(Math.random() * Math.max(1, poolWorkers[0])),
        });
      }
      for (let p = 1; p < poolWorkers.length; p++) {
        const peerExp = totalPerSec * (poolWorkers[p] / totalWorkers) * dt * burstMul;
        let nP = Math.floor(peerExp);
        if (Math.random() < (peerExp - nP)) nP++;
        for (let k = 0; k < nP; k++) flashPoolIndices.push(p);
      }

      const rect = container.getBoundingClientRect();
      r.update({
        dpr: window.devicePixelRatio || 1,
        width: rect.width,
        height: rect.height,
        poolWorkers,
        dt,
        flashPoolIndices,
        flashStrikerEvents,
        ownPoolIdx: 0,
      });
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Logarithmic peer-count slider. Maps slider 1-100 → peers 1-5000 with
  // a log distribution so the interesting stages (2/8/20/50/200/1K/5K)
  // are roughly evenly spaced along the slider.
  const sliderToPeers = (v) => {
    const min = Math.log(1), max = Math.log(5000);
    return Math.max(1, Math.round(Math.exp(min + (max - min) * v / 100)));
  };
  const peersToSlider = (p) => {
    const min = Math.log(1), max = Math.log(5000);
    return Math.round(((Math.log(p) - min) / (max - min)) * 100);
  };

  const STAGES = [2, 8, 20, 50, 200, 1000, 5000];
  const stageName = peerCount <= 2 ? 'Bar'
                  : peerCount <= 8 ? 'Corners'
                  : peerCount <= 20 ? 'Edges'
                  : peerCount <= 56 ? 'Edges-Full'
                  : peerCount <= 200 ? 'Faces'
                                      : 'Volume';

  // Pointer interaction (drag-rotate / pinch-zoom / tap-to-focus).
  // Matches the live PulsePanel cube behavior — camera-style drag,
  // pinch zoom, tap a cube to fly the camera to it.
  const pointerStateRef = useRef({ down: false, lastX: 0, lastY: 0, didDrag: false, dsX: 0, dsY: 0 });
  const pinchStateRef = useRef({ active: false, lastDist: 0 });

  const onPointerDown = (e) => {
    const ps = pointerStateRef.current;
    ps.down = true;
    ps.lastX = e.clientX; ps.lastY = e.clientY;
    ps.dsX = e.clientX; ps.dsY = e.clientY; ps.didDrag = false;
    e.target.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const ps = pointerStateRef.current;
    if (!ps.down) return;
    const dx = e.clientX - ps.lastX, dy = e.clientY - ps.lastY;
    const tdx = e.clientX - ps.dsX, tdy = e.clientY - ps.dsY;
    if (tdx * tdx + tdy * tdy > 25) ps.didDrag = true;
    const r = rendererRef.current;
    if (r && typeof r.addRotation === 'function') r.addRotation(dx, dy);
    ps.lastX = e.clientX; ps.lastY = e.clientY;
  };
  const onPointerUp = (e) => {
    const ps = pointerStateRef.current;
    ps.down = false;
    if (!ps.didDrag) {
      const r = rendererRef.current;
      const canvas = canvasRef.current;
      if (r && canvas && typeof r.hitTestPeer === 'function' && typeof r.focusPeer === 'function') {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        const idx = r.hitTestPeer(x, y, 30);
        if (idx >= 0) r.focusPeer(idx, 4.0);
      }
    }
  };
  const onTouchStart = (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStateRef.current = { active: true, lastDist: Math.sqrt(dx * dx + dy * dy) };
    }
  };
  const onTouchMove = (e) => {
    const ps = pinchStateRef.current;
    if (e.touches.length === 2 && ps.active) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = rendererRef.current;
      if (r && typeof r.multiplyZoom === 'function') r.multiplyZoom(dist / ps.lastDist);
      ps.lastDist = dist;
    }
  };
  const onTouchEnd = (e) => {
    if (e.touches.length < 2) pinchStateRef.current = { active: false, lastDist: 0 };
  };
  const onWheel = (e) => {
    e.preventDefault();
    const r = rendererRef.current;
    if (r && typeof r.multiplyZoom === 'function') r.multiplyZoom(e.deltaY < 0 ? 1.12 : 0.89);
  };

  return (
    /* v1.11.x: Render via createPortal to document.body so the modal
       escapes the carousel's `transform` parent. CSS spec: a parent with
       transform creates a containing block for `position: fixed`
       descendants, which was trapping the modal inside the carousel
       slot — visible as the SoloStrike header showing above and the
       footer + carousel dots clipping the bottom of the modal. Portal
       renders the modal as a sibling of the React root, escaping that
       containing-block trap. */
    createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#000', display: 'flex', flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0)',
      paddingBottom: 'env(safe-area-inset-bottom, 0)',
      paddingLeft: 'env(safe-area-inset-left, 0)',
      paddingRight: 'env(safe-area-inset-right, 0)',
    }}>
      {/* Header bar */}
      <div style={{
        flexShrink: 0, padding: '0.8rem 1rem',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(8,8,12,0.95)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{
          color: 'var(--amber)', fontFamily: 'var(--fd)',
          fontSize: '0.65rem', letterSpacing: '0.2em',
          textTransform: 'uppercase', fontWeight: 700,
        }}>◈ Simulate · Strike Mesh</span>
        <button
          onClick={onClose}
          style={{
            color: 'var(--text-1)', fontSize: '1.2rem', cursor: 'pointer',
            padding: '4px 14px', userSelect: 'none',
            background: 'transparent', border: '1px solid var(--border)',
            borderRadius: 3,
          }}
          aria-label="Close simulator"
        >✕</button>
      </div>

      {/* Cube canvas */}
      <div ref={containerRef} style={{
        flex: 1, position: 'relative',
        background: '#050505', overflow: 'hidden',
      }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => { pointerStateRef.current.down = false; }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onWheel={onWheel}
          style={{
            width: '100%', height: '100%', display: 'block',
            touchAction: 'none', cursor: 'grab',
          }}
        />
        {/* Stage label (top-left) */}
        <div style={{
          position: 'absolute', top: 12, left: 14,
          background: 'rgba(8,8,12,0.85)', border: '1px solid var(--border)',
          padding: '5px 10px', borderRadius: 3,
          color: 'var(--amber)', fontFamily: 'var(--fd)',
          fontSize: '0.6rem', letterSpacing: '0.15em',
          textTransform: 'uppercase', pointerEvents: 'none',
        }}>
          {peerCount > 999 ? (peerCount / 1000).toFixed(0) + 'K' : peerCount} peers · {stageName}
        </div>
        {/* Reset overlay (bottom-left) */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            const r = rendererRef.current;
            if (r && typeof r.resetView === 'function') r.resetView();
          }}
          style={{
            position: 'absolute', bottom: 14, left: 16,
            color: 'var(--text-2)', fontSize: '0.65rem',
            letterSpacing: '0.18em', cursor: 'pointer',
            userSelect: 'none', fontWeight: 700,
            textShadow: '0 0 6px rgba(0,0,0,0.9)',
          }}
          role="button"
          aria-label="Reset view"
        >⟲ Reset</div>
        {/* Find Me overlay (bottom-right) */}
        <div
          onClick={(e) => {
            e.stopPropagation();
            const r = rendererRef.current;
            if (r && typeof r.focusPeer === 'function') r.focusPeer(0, 4.0);
          }}
          style={{
            position: 'absolute', bottom: 14, right: 16,
            color: '#ffe07a', fontSize: '0.65rem',
            letterSpacing: '0.18em', cursor: 'pointer',
            userSelect: 'none', fontWeight: 700,
            textShadow: '0 0 8px rgba(212,164,55,0.7)',
          }}
          role="button"
          aria-label="Find own pool"
        >◎ Find Me</div>
      </div>

      {/* Picker drawer */}
      <div style={{
        flexShrink: 0, padding: '0.7rem 0.9rem 1rem',
        borderTop: '1px solid var(--amber)',
        background: 'rgba(8,8,12,0.95)',
      }}>
        {/* Stage chips row */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.55rem' }}>
          <span style={{
            color: 'var(--text-2)', fontFamily: 'var(--fd)',
            fontSize: '0.5rem', letterSpacing: '0.16em',
            textTransform: 'uppercase', flexShrink: 0, width: 50,
          }}>Peers <b style={{ color: 'var(--amber)', marginLeft: 4 }}>{peerCount > 999 ? (peerCount / 1000).toFixed(0) + 'K' : peerCount}</b></span>
          {STAGES.map(n => (
            <button
              key={n}
              onClick={() => setPeerCount(n)}
              style={{
                flex: 1, minWidth: 32,
                background: peerCount === n ? 'rgba(212,164,55,0.30)' : 'rgba(212,164,55,0.08)',
                border: '1px solid var(--amber)',
                color: peerCount === n ? '#fff' : 'var(--amber)',
                fontFamily: 'var(--fd)', fontSize: '0.55rem',
                letterSpacing: '0.1em', padding: '0.45rem 0.2rem',
                borderRadius: 3, cursor: 'pointer', textTransform: 'uppercase',
              }}
            >{n > 999 ? (n / 1000).toFixed(0) + 'K' : n}</button>
          ))}
        </div>

        {/* Fine-tune slider */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.55rem' }}>
          <span style={{
            color: 'var(--text-2)', fontFamily: 'var(--fd)',
            fontSize: '0.5rem', letterSpacing: '0.16em',
            textTransform: 'uppercase', flexShrink: 0, width: 65,
          }}>Fine-tune</span>
          <input
            type="range"
            min="1"
            max="100"
            step="1"
            value={peersToSlider(peerCount)}
            onChange={(e) => setPeerCount(sliderToPeers(parseInt(e.target.value, 10)))}
            style={{ flex: 1, accentColor: 'var(--amber)', height: 4 }}
          />
        </div>

        {/* Density toggle + Burst */}
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{
            color: 'var(--text-2)', fontFamily: 'var(--fd)',
            fontSize: '0.5rem', letterSpacing: '0.16em',
            textTransform: 'uppercase', flexShrink: 0, width: 65,
          }}>Density</span>
          <button
            onClick={() => setDensity('real')}
            style={{
              flex: 1,
              background: density === 'real' ? 'rgba(212,164,55,0.20)' : 'transparent',
              border: '1px solid ' + (density === 'real' ? 'var(--amber)' : 'var(--text-3)'),
              color: density === 'real' ? 'var(--amber)' : 'var(--text-2)',
              fontFamily: 'var(--fd)', fontSize: '0.5rem',
              letterSpacing: '0.1em', padding: '0.4rem 0.3rem',
              borderRadius: 3, cursor: 'pointer', textTransform: 'uppercase',
            }}
          >Realistic</button>
          <button
            onClick={() => setDensity('cinematic')}
            style={{
              flex: 1,
              background: density === 'cinematic' ? 'rgba(212,164,55,0.20)' : 'transparent',
              border: '1px solid ' + (density === 'cinematic' ? 'var(--amber)' : 'var(--text-3)'),
              color: density === 'cinematic' ? 'var(--amber)' : 'var(--text-2)',
              fontFamily: 'var(--fd)', fontSize: '0.5rem',
              letterSpacing: '0.1em', padding: '0.4rem 0.3rem',
              borderRadius: 3, cursor: 'pointer', textTransform: 'uppercase',
            }}
          >Cinematic</button>
          <button
            onClick={() => { burstUntilRef.current = performance.now() + 600; }}
            style={{
              background: 'transparent', border: '1px solid #ffeaa0',
              color: '#ffeaa0', fontFamily: 'var(--fd)',
              fontSize: '0.55rem', letterSpacing: '0.1em',
              padding: '0.4rem 0.7rem', borderRadius: 3, cursor: 'pointer',
              textTransform: 'uppercase',
            }}
          >⚡ Burst</button>
        </div>
      </div>
    </div>,
    document.body
    )
  );
});
BlockSimulatorModal.displayName = "BlockSimulatorModal";



// ── v1.11.39 ── Static Pulse Strikes (Performance Mode overlay) ─────────────
// DOM-based strike markers shown over the baked equirectangular world map
// when performanceMode is on. Replaces the WebGL strikes that get frozen
// when the canvas rAF is bailed out.
//
// Why DOM not canvas: CSS keyframes run on the compositor thread, immune
// to main-thread jank. Even on a Pi 4 / older iPhone, a few dozen markers
// pulsing simultaneously cost effectively zero main-thread work. That's the
// whole reason Performance Mode exists — kill the expensive WebGL loop,
// keep cheap compositor-thread animation that still conveys information.
//
// Each peer gets one marker positioned by equirectangular projection:
//   left = (lon + 180) / 360 * 100%
//   top  = (90 - lat)  / 180 * 100%
// Each marker has 3 expanding amber rings on staggered delays (0, 0.73s,
// 1.46s) mirroring the look of the original WebGL strikes, plus a center
// dot. Own pool's marker uses red instead of amber.
//
// `peers` is the same `ns.peers` array the WebGL renderer consumes, with
// pre-filtered (no `filtered:true`) entries. We render up to PEER_CAP
// markers to keep the DOM lightweight even if the network is huge.
const PEER_CAP_STATIC = 60;
// ── v1.11.39 ── Static Pulse Strikes — DOM divs ────────────────────────────
// DOM-based peer markers using HTML divs with border-radius:50%. Unlike SVG
// circles, DOM divs aren't subject to the parent's coordinate system — they
// stay perfectly round in CSS pixels regardless of how the underlying map
// is stretched (object-fit: fill stretches the map, but %-positioned divs
// on top stay circular and land at the correct visual location).
//
// Color/animation mirror the LIVE globe (App.jsx line 9665-9697):
//   - ALL peer dots are crimson #A8170E (matches globe markers)
//   - Only OWN gets gold echo pulse: 3 staggered rings, 2.5s period,
//     1/3 phase offset, scale 1 → 3 with fade-out
//   - Static gold halo always visible between echo pulses
function StaticPulseStrikes({ peers, ownPin }) {
  const markers = [];
  const hasLocalPin = ownPin
    && Number.isFinite(ownPin.lat) && Number.isFinite(ownPin.lon);
  let ownIncluded = false;
  if (Array.isArray(peers)) {
    for (const p of peers.slice(0, PEER_CAP_STATIC)) {
      if (!p || !Array.isArray(p.loc) || p.loc.length !== 2) continue;
      if (hasLocalPin && p.isOwn) continue;
      const lat = p.loc[0], lon = p.loc[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      markers.push({ lat, lon, isOwn: !!p.isOwn, key: p.pubkey || `peer-${markers.length}` });
      if (p.isOwn) ownIncluded = true;
    }
  }
  if (hasLocalPin && !ownIncluded) {
    markers.push({ lat: ownPin.lat, lon: ownPin.lon, isOwn: true, key: '__own_local__' });
  }
  if (markers.length === 0) return null;

  return (
    <div style={{
      position:'absolute', inset:0,
      pointerEvents:'none', zIndex:2,
      overflow:'hidden',
    }}>
      {markers.map(m => {
        const left = ((m.lon + 180) / 360) * 100;
        const top  = ((90 - m.lat) / 180) * 100;
        if (left < 0 || left > 100 || top < 0 || top > 100) return null;
        return (
          <div key={m.key}
            className={'ss-static-strike-marker' + (m.isOwn ? ' own' : '')}
            style={{ left: `${left}%`, top: `${top}%` }}>
            <span className="dot" />
            {m.isOwn && (
              <>
                <span className="halo" />
                <span className="ring" />
                <span className="ring d1" />
                <span className="ring d2" />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── v1.11.39 — Static Pulse Mesh helpers (restored) ────────────────────────
// Cube layout constants — must match constellation-cube.js byte-for-byte
// so the static mesh visualization mirrors the live constellation animation.
const CUBE_CORNERS = [
  {x:-1,y:-1,z:-1}, {x: 1,y:-1,z:-1}, {x: 1,y: 1,z:-1}, {x:-1,y: 1,z:-1},
  {x:-1,y:-1,z: 1}, {x: 1,y:-1,z: 1}, {x: 1,y: 1,z: 1}, {x:-1,y: 1,z: 1},
];
const CUBE_EDGES = [
  [0,1],[1,2],[2,3],[3,0],
  [4,5],[5,6],[6,7],[7,4],
  [0,4],[1,5],[2,6],[3,7],
];

function placeMeshPeers(n) {
  const out = [];
  if (n <= 0) return out;
  if (n <= 2) {
    out.push({ x:-0.4, y:0, z:0, isOwn:true });
    if (n === 2) out.push({ x: 0.4, y:0, z:0, isOwn:false });
    return out;
  }
  if (n <= 8) {
    out.push({ ...CUBE_CORNERS[0], isOwn:true });
    for (let i = 1; i < n; i++) out.push({ ...CUBE_CORNERS[i], isOwn:false });
    return out;
  }
  if (n <= 20) {
    out.push({ ...CUBE_CORNERS[0], isOwn:true });
    for (let i = 1; i < 8 && out.length < n; i++) out.push({ ...CUBE_CORNERS[i], isOwn:false });
    let e = 0;
    while (out.length < n && e < CUBE_EDGES.length) {
      const [a,b] = CUBE_EDGES[e];
      const ca = CUBE_CORNERS[a], cb = CUBE_CORNERS[b];
      out.push({ x:(ca.x+cb.x)/2, y:(ca.y+cb.y)/2, z:(ca.z+cb.z)/2, isOwn:false });
      e++;
    }
    return out;
  }
  // 21-56+ — corners + N per edge
  out.push({ ...CUBE_CORNERS[0], isOwn:true });
  for (let i = 1; i < 8 && out.length < n; i++) out.push({ ...CUBE_CORNERS[i], isOwn:false });
  const remaining = n - out.length;
  const perEdge = Math.ceil(remaining / 12);
  for (let e = 0; e < 12 && out.length < n; e++) {
    const [a,b] = CUBE_EDGES[e];
    const ca = CUBE_CORNERS[a], cb = CUBE_CORNERS[b];
    for (let p = 1; p <= perEdge && out.length < n; p++) {
      const t = p / (perEdge + 1);
      out.push({ x:ca.x+(cb.x-ca.x)*t, y:ca.y+(cb.y-ca.y)*t, z:ca.z+(cb.z-ca.z)*t, isOwn:false });
    }
  }
  return out;
}

// Isometric projection — fixed tilt for static look
const MESH_TILT_X = 0.45;
const MESH_ROT_Y  = 0.6;
function meshProject(v) {
  const cosY = Math.cos(MESH_ROT_Y), sinY = Math.sin(MESH_ROT_Y);
  const cosT = Math.cos(MESH_TILT_X), sinT = Math.sin(MESH_TILT_X);
  const x1 = v.x * cosY - v.z * sinY;
  const z1 = v.x * sinY + v.z * cosY;
  const y1 = v.y * cosT - z1 * sinT;
  const z2 = v.y * sinT + z1 * cosT;
  return { x: x1, y: y1, z: z2 };
}

// Build 6 faces of a cube at (cx,cy) with depth-sorted ordering
function buildCubeFaces(cx, cy, sizePx, isOwn) {
  const PAL = isOwn
    ? { top:'#FFE07A', left:'#D4A437', right:'#9B6E19', deep:'#50370A' }
    : { top:'#FFB350', left:'#F7931A', right:'#B45F0F', deep:'#6E3705' };
  const s = sizePx;
  const localVerts = [
    {x:-s, y:-s, z:-s}, {x: s, y:-s, z:-s},
    {x: s, y: s, z:-s}, {x:-s, y: s, z:-s},
    {x:-s, y:-s, z: s}, {x: s, y:-s, z: s},
    {x: s, y: s, z: s}, {x:-s, y: s, z: s},
  ];
  const proj = localVerts.map(v => {
    const p = meshProject(v);
    return { x: cx + p.x, y: cy + p.y, z: p.z };
  });
  const faces = [
    { vs:[4,5,6,7], name:'front' },
    { vs:[1,0,3,2], name:'back'  },
    { vs:[0,4,7,3], name:'left'  },
    { vs:[5,1,2,6], name:'right' },
    { vs:[3,7,6,2], name:'top'   },
    { vs:[0,1,5,4], name:'bottom'},
  ];
  function colorFor(name) {
    if (name === 'top') return PAL.top;
    if (name === 'bottom') return PAL.deep;
    if (name === 'front' || name === 'right') return PAL.left;
    return PAL.right;
  }
  return faces
    .map(f => ({
      pts: f.vs.map(i => proj[i]),
      avgZ: f.vs.reduce((s, i) => s + proj[i].z, 0) / 4,
      color: colorFor(f.name),
      stroke: PAL.deep,
    }))
    .sort((a, b) => a.avgZ - b.avgZ);
}

function StaticPulseMesh({ peers, ownPin }) {
  // Build node list — own peer always shown (synthetic if not in peers).
  const nodes = [];
  let ownIncluded = false;
  if (Array.isArray(peers)) {
    for (const p of peers.slice(0, PEER_CAP_STATIC)) {
      if (!p) continue;
      nodes.push({ isOwn: !!p.isOwn, key: p.pubkey || `peer-${nodes.length}` });
      if (p.isOwn) ownIncluded = true;
    }
  }
  if (!ownIncluded) {
    nodes.unshift({ isOwn: true, key: '__own_local__' });
  }

  const N = nodes.length;
  // Get 3D positions for this peer count (matches live mesh staging)
  const positions = placeMeshPeers(N);
  // Map nodes → positions (own first)
  const ownNode = nodes.find(n => n.isOwn);
  const peerNodes = nodes.filter(n => !n.isOwn);
  const layout = [];
  if (ownNode && positions[0]) {
    const p = meshProject(positions[0]);
    layout.push({ ...ownNode, pos3d: positions[0], pos2d: p });
  }
  for (let i = 0; i < peerNodes.length && i + 1 < positions.length; i++) {
    const p3 = positions[i + 1];
    layout.push({ ...peerNodes[i], pos3d: p3, pos2d: meshProject(p3) });
  }

  // Cube size by peer count — shrink as crowd grows (matches comment intent
  // about scene not getting busy). Own cube stays a touch larger.
  // Sizes are in % of viewBox space (viewBox is 200×100 for 2:1 aspect).
  const peerSize = N <= 2  ? 9
                 : N <= 8  ? 6
                 : N <= 20 ? 4.5
                 : N <= 56 ? 3
                            : 2;
  const ownSize = peerSize * 1.25;

  // Center the layout in the viewBox. World coords range ~[-1,1] for
  // cube; project at scale ~30 fits nicely in 200×100 viewBox.
  const VB_W = 200, VB_H = 100;
  const cx = VB_W / 2, cy = VB_H / 2;
  const worldScale = N <= 2 ? 28 : 26;

  // Build all cubes, depth-sort across scene so closer cubes occlude farther.
  const cubeRenders = layout.map(node => {
    const screenX = cx + node.pos2d.x * worldScale;
    const screenY = cy + node.pos2d.y * worldScale;
    const sz = node.isOwn ? ownSize : peerSize;
    const faces = buildCubeFaces(screenX, screenY, sz, node.isOwn);
    return { key: node.key, isOwn: node.isOwn, depth: node.pos2d.z, faces, screenX, screenY };
  });
  // Depth sort: back to front (smaller z = farther)
  cubeRenders.sort((a, b) => a.depth - b.depth);

  return (
    <div style={{
      position:'absolute', inset:0, pointerEvents:'none', zIndex:1,
      background:'radial-gradient(circle at center, rgba(245,166,35,0.08), var(--bg-void) 75%)',
    }}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet"
        style={{ position:'absolute', inset:0, width:'100%', height:'100%' }}>
        {cubeRenders.map(c => (
          <g key={c.key}
            className={c.isOwn ? 'ss-mesh-own-cube' : 'ss-mesh-peer-cube'}
            style={c.isOwn ? { transformOrigin: `${c.screenX}px ${c.screenY}px` } : undefined}>
            {c.faces.map((f, i) => (
              <polygon
                key={i}
                points={f.pts.map(p => `${p.x},${p.y}`).join(' ')}
                fill={f.color}
                stroke={f.stroke}
                strokeWidth="0.15"
                strokeOpacity="0.5"
              />
            ))}
          </g>
        ))}
        <text x={VB_W - 2} y={VB_H - 3} textAnchor="end"
          fontFamily="JetBrains Mono, monospace" fontSize="3"
          fill="var(--text-2)" letterSpacing="0.2" opacity="0.7">
          {N} {N === 1 ? 'NODE' : 'NODES'}
        </text>
      </svg>
    </div>
  );
}


// v1.11.39: memoized to skip re-renders when props unchanged across WS broadcasts
const PulsePanel = React.memo(function PulsePanel_Impl({ networkStats, onOpenSettings, onOpenStrikers, pulseAnim = 'block', performanceMode = false, compact = false, poolPin = null, onPoolPinChange = null, lastShareAt = null, acceptedCount = 0, workers = null }) {
  const ns = networkStats || { enabled: false, pools: 0, hashrate: 0, workers: 0, blocks: 0, versions: {}, relayStatus: {} };
  const enabled = !!ns.enabled;

  // v1.11.x: Strike Mesh Simulator. Opens a full-screen modal
  // showing the cube formation at user-selected peer counts (2 → 5K).
  // Decoupled from real network data — synthesizes peers + share traffic
  // internally so users can preview Bar/Corners/Edges/Faces/Volume stages
  // without waiting for the network to grow.
  const [simulatorOpen, setSimulatorOpen] = useState(false);

  // v1.11.x: latest-value refs. The Pulse animation useEffect (line ~8134)
  // used to depend on [ns.hashrate, ns.pools, ns.workers, ns.peers, workers,
  // pulseAnim, enabled]. Every WebSocket STATE_UPDATE
  // (every ~2s) caused those values to change, the useEffect to tear down,
  // and the animation to RESTART FROM ZERO — visible as the Hash Ticker
  // resetting its drops and the Constellation losing animation continuity.
  // Fix: hold latest values in refs that the draw functions read each frame.
  // The animation useEffect now mounts once and lives for the component's
  // full lifetime. Visible behavior is identical (still reactive, still
  // updates within 16ms of state change), but no teardown thrash.
  const nsRef = useRef(ns);
  const enabledRef = useRef(enabled);
  const workersInputRef = useRef(workers);
  // pulseAnimRef is declared further down (rev70k, used by pointer handlers).
  // We sync it in this same batch below.
  // Sync refs every render — cheap, just assignment. No deps array means
  // this runs after every render, exactly when refs need to catch up.
  useEffect(() => {
    nsRef.current = ns;
    enabledRef.current = enabled;
    workersInputRef.current = workers;
    // pulseAnimRef already gets synced by its own useEffect below.
  });

  // Canvas refs for the EKG-style waveform
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animationFrameRef = useRef(null);
  // v1.11.x: spikesRef + lastBroadcastRef removed — see leak fix comment near
  // the deleted producer effect below. The consumer was deleted in rev60 but
  // the producer was left, causing unbounded array growth.
  const lastTickRef = useRef(performance.now());
  const canvasWidthRef = useRef(0);
  const canvasHeightRef = useRef(0);
  const dprRef = useRef(window.devicePixelRatio || 1);

  // v1.8.8-rev42 (rev27 restoration): WebGL canvas + renderer.
  const webglCanvasRef = useRef(null);
  const webglRendererRef = useRef(null);
  const webglTextureReadyRef = useRef(false);

  // v1.8.5-rev70i: Striker Constellation pulse animation. Separate WebGL
  // canvas so we don't share contexts with the globe (avoids ctx-loss when
  // switching back and forth between modes).
  const constellationCanvasRef = useRef(null);
  const constellationRendererRef = useRef(null);
  // rev70k: track active pointers on the constellation canvas. Used to
  // distinguish drag (1 pointer) from pinch-zoom (2 pointers). Map from
  // pointerId -> { x, y } in CSS pixels.
  const constellationPointersRef = useRef(new Map());
  const constellationPinchPrevDistRef = useRef(0);
  // v1.11.0: tap detection for Strike Mesh focus-on-tap.
  // Set on pointerDown; cleared on pointerUp; updated as didDrag=true
  // when pointerMove travels > 5px from the start. If pointerUp finds
  // didDrag=false, the gesture was a tap and we fly camera to the
  // nearest peer (handled by handleConstellationPointerUp).
  const constellationTapStartRef = useRef(null);
  // rev70u: real share-flash detection state.
  // - peerLastSeenRef tracks each peer's last observed lastSeenAgoSec value (broadcasts from other pools)
  const peerLastSeenRef = useRef(new Map());
  // rev71f: per-peer Poisson schedule for synthesized share flashes between
  // broadcasts. Map<pubkey, { timeoutId, expiresAt }>. Cleared/rescheduled
  // when a fresh broadcast arrives, drained on unmount.
  const peerSynthRef = useRef(new Map());
  // rev71i: per-worker accepted-share counter tracking. Map<workerName, count>.
  // Each worker gets its own striker; when a worker's count increments we
  // flash THEIR specific striker, not a random one in the pool.
  const workerAcceptedRef = useRef(new Map());
  // rev70y: queue of pending flashes - decoupled from draw loop. Detection
  // effect pushes pool indices here; draw loop drains and dispatches.
  const pendingFlashesRef = useRef([]);
  // rev70x→A1: active plasma bolts. Each entry: { fromIdx, toIdx, start }.
  // Drained by the 2D canvas draw step when in constellation mode.
  const plasmaBoltsRef = useRef([]);

  // ─── Pin placement mode (globe only) ───────────────────────────────────
  // When `placingPin` is true, the globe stops rotating, an overlay prompts
  // the user to tap, and the next tap on the canvas converts screen coords
  // → 3D unit sphere → lat/lon → 5° grid snap → poolPin update.
  const [placingPin, setPlacingPin] = useState(false);
  // v1.11.39 — Pinch-zoom + pan state for Performance Mode static
  // visualization. Applies to BOTH the static map (pulseAnim==='globe')
  // and the static mesh cube (pulseAnim==='block'). Zoom is clamped
  // 1.0×–5.0×. Pan keeps content within the visible container.
  // Double-tap to reset. Single-finger pan only engages when zoomed.
  // Reset on pulseAnim change so switching modes feels fresh.
  const [staticZoom, setStaticZoom] = useState(1);
  const [staticPan, setStaticPan] = useState({ x: 0, y: 0 });
  const pinchStartRef = useRef(null);
  const panStartRef = useRef(null);
  const didPinchRef = useRef(false);
  const lastTapRef = useRef(0);
  useEffect(() => {
    // Reset zoom on mode switch
    setStaticZoom(1);
    setStaticPan({ x: 0, y: 0 });
  }, [pulseAnim, performanceMode]);
  // v1.11.x: Strike Mesh Simulator. Tap "◈ Simulate" in the top-right
  // overlay to open a full-screen modal that lets the user (and reviewers)
  // preview how the cube forms at peer counts they'll never realistically hit
  // alone. Real network is 2 peers today; the simulator scrubs from 1 → 5K to
  // showcase Bar → Corners → Edges → Faces → Volume formation. Modal
  // synthesizes its own peer/share data — fully decoupled from real network
  // state, so opening it doesn't disrupt the live Pulse cube underneath.
  // (state declared above with main hook block)
  const placingPinRef = useRef(false);
  // rev70k: track pulseAnim in a ref so the stable pointer handlers can
  // branch behavior between globe (drag-rotate, pin tap) and constellation
  // (drag-rotate the WebGL camera, pinch-zoom).
  const pulseAnimRef = useRef(pulseAnim);
  useEffect(() => { pulseAnimRef.current = pulseAnim; }, [pulseAnim]);
  // v1.11.39: Performance Mode ref — same pattern as NonceField. Live
  // updates via useEffect; rAF checks the ref each frame and bails out
  // when on, while still rescheduling the next frame.
  const perfModeRef = useRef(!!performanceMode);
  useEffect(() => { perfModeRef.current = !!performanceMode; }, [performanceMode]);
  // rev70k: pinch-zoom state. Tracks all active pointer IDs and their
  // positions so we can compute pinch distance from 2-finger gestures.
  const pointersRef = useRef(new Map());
  const pinchRef = useRef({ active: false, lastDist: 0 });
  const poolPinRef = useRef(poolPin);
  const globeRotYRef = useRef(0);
  // rev42: kept as ref but always 0 (no user pitch in rev27).
  const globeRotXRef = useRef(0);
  const dragStateRef = useRef({ active: false, lastX: 0, lastY: 0, totalMoved: 0, pointerId: null });
  const globeGeomRef = useRef({ cx: 0, cy: 0, radius: 1 });
  useEffect(() => { placingPinRef.current = placingPin; }, [placingPin]);
  useEffect(() => { poolPinRef.current = poolPin; }, [poolPin]);

  // v1.8.8-rev47: debug overlay opt-in via URL hash '#debug-globe'.
  // Default OFF for production rendering.
  useEffect(() => {
    if (!webglCanvasRef.current) return;
    const debugMode = typeof window !== 'undefined'
      && window.location.hash.includes('debug-globe');
    const renderer = createGlobeWebGL(webglCanvasRef.current, { debug: debugMode });
    if (renderer) {
      webglRendererRef.current = renderer;
    } else {
      webglRendererRef.current = null;
      console.warn('WebGL globe init failed; falling back to vector renderer');
    }
    return () => {
      if (webglRendererRef.current) {
        webglRendererRef.current.destroy();
        webglRendererRef.current = null;
      }
      webglTextureReadyRef.current = false;
    };
  }, []);

  // v1.11.0: Strike Mesh init. Mount-once on canvas ref ready,
  // re-mounts only if pulseAnim changes to/from 'block'. Renders only
  // when pulseAnim === 'block' (canvas display:none otherwise — context
  // stays alive but no draw calls happen).
  useEffect(() => {
    if (!constellationCanvasRef.current) return;
    if (pulseAnim !== 'block') return;
    const factory = createConstellationCube;
    const renderer = factory(constellationCanvasRef.current);
    if (renderer && !renderer.failed) {
      constellationRendererRef.current = renderer;
    } else {
      constellationRendererRef.current = null;
      console.warn('Constellation renderer init failed (' + pulseAnim + ')');
    }
    return () => {
      if (constellationRendererRef.current) {
        constellationRendererRef.current.destroy();
        constellationRendererRef.current = null;
      }
    };
  }, [pulseAnim]);

  // Inverse orthographic projection — converts a tap on the canvas to
  // lat/lon (in degrees), un-rotated against the current globe rotation,
  // then snapped to a 5° grid for the privacy guarantee. Returns null if
  // the tap missed the globe disk or pin placement isn't active.
  const handleCanvasTap = useCallback((e) => {
    if (!placingPinRef.current || !onPoolPinChange) return;
    e.stopPropagation();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // v1.11.39: Performance Mode uses a flat equirectangular map (not a
    // globe disk). Use 2D projection instead of inverse orthographic math.
    // The visible map fills the container exactly (objectFit:contain on a
    // 2:1 aspect container = no letterbox), so canvas dimensions match
    // visible map dimensions. Tap (x, y) → (lon, lat) directly.
    //
    // NOTE: The baked pulse-map.png uses a shifted latitude range
    // [-84, +90] instead of [-90, +90] so Antarctica's coastline reaches
    // the bottom edge of the image. The inverse projection must use the
    // same range or pins drift south.
    if (perfModeRef.current) {
      // v1.11.39: Suppress tap-to-pin if the user just finished a pinch
      // gesture (didPinchRef gets set on 2-finger touchend).
      if (didPinchRef.current) {
        didPinchRef.current = false;
        return;
      }
      // v1.11.39: Inverse-transform click coords if user has zoomed/panned.
      // Wrapper transform is: translate(panX, panY) scale(zoom)
      // with origin 50% 50%. To recover pre-transform coords:
      //   cx = (clickX - W/2 - pan.x) / zoom + W/2
      //   cy = (clickY - H/2 - pan.y) / zoom + H/2
      const W = rect.width, H = rect.height;
      const cx = (clickX - W/2 - staticPan.x) / staticZoom + W/2;
      const cy = (clickY - H/2 - staticPan.y) / staticZoom + H/2;
      // v1.11.39: Standard equirectangular [-90, +90] — keeps pin
      // placement aligned with the live globe's sphere projection.
      const lonDeg = (cx / W) * 360 - 180;
      const latDeg = 90 - (cy / H) * 180;
      if (latDeg > 90 || latDeg < -90 || lonDeg > 180 || lonDeg < -180) return;
      const pinned = snapPinTo5Deg(latDeg, lonDeg);
      onPoolPinChange(pinned);
      setPlacingPin(false);
      return;
    }

    const { cx, cy, radius, useWebGL } = globeGeomRef.current;
    if (!radius) return;
    // v1.8.8-rev31: when WebGL is active, the visible globe disk has
    // radius = canvas-HEIGHT * 0.36 (matches uScale 0.72 in the vertex
    // shader). The X axis is divided by aspect (W/H), so both X and Y
    // disk radius equal H*0.36 regardless of W. This MUST stay in sync
    // with atmRadius and the shader's uScale — otherwise pins land at
    // one place and render at another (the drift bug from rev29). The
    // legacy `radius` field uses 0.42 for the 2D fallback.
    // Both in CSS pixels (matching gBCR).
    // rev52: matches atmRadius formula. Disk radius = min(W,H) * 0.46.
    const tapRadius = useWebGL
      ? Math.min(rect.width, rect.height) * 0.46
      : radius;
    const nx = (clickX - cx) / tapRadius;
    const ny = -(clickY - cy) / tapRadius;
    const r2 = nx * nx + ny * ny;
    if (r2 > 0.985) return; // tap missed the globe disk
    const nz = Math.sqrt(Math.max(0, 1 - r2));

    // (nx, ny, nz) is the screen-space normal. To recover the geographic
    // (lat, lon) of where the user tapped, INVERT the renderer's full
    // transformation chain. Forward is YAW → TILT(Z, 23.5°) → PITCH(X);
    // inverse is inv-PITCH → inv-TILT → inv-YAW.
    let sx = nx, sy = ny, sz = nz;
    if (useWebGL) {
      const debugMode = typeof window !== 'undefined'
        && window.location.hash.includes('debug-globe');
      const tiltRad = debugMode ? 0 : (23.5 * Math.PI / 180);

      // 1) Inverse PITCH — rotate (sy, sz) by -uRotX
      const pitch = globeRotXRef.current;
      const cp = Math.cos(-pitch);
      const sp = Math.sin(-pitch);
      const py1 = sy * cp - sz * sp;
      const pz1 = sy * sp + sz * cp;
      sy = py1; sz = pz1;

      // 2) Inverse TILT — rotate (sx, sy) by -tiltRad around Z
      const ct = Math.cos(-tiltRad);
      const st = Math.sin(-tiltRad);
      const tx = sx * ct - sy * st;
      const ty = sx * st + sy * ct;
      sx = tx; sy = ty;

      // 3) Inverse YAW — rotate (sx, sz) by -uRotY around Y
      const yaw = globeRotYRef.current;
      const cyy = Math.cos(-yaw);
      const syy = Math.sin(-yaw);
      const yx = sx * cyy + sz * syy;
      const yz = -sx * syy + sz * cyy;
      sx = yx; sz = yz;
    }
    // (sx, sy, sz) is now in OBJECT space — the un-rotated unit sphere.
    const latRad = Math.asin(Math.max(-1, Math.min(1, sy)));
    const lonRad = Math.atan2(sx, sz);
    let lonDeg = lonRad * 180 / Math.PI;
    // Normalize to [-180, 180]
    lonDeg = ((lonDeg + 540) % 360) - 180;
    const latDeg = latRad * 180 / Math.PI;
    const pinned = snapPinTo5Deg(latDeg, lonDeg);
    onPoolPinChange(pinned);
    setPlacingPin(false);
  }, [onPoolPinChange, staticZoom, staticPan]);

  // v1.11.39 — Pinch-zoom + pan touch handlers for the Performance Mode
  // static visualization wrapper. Native touch events (not React synthetic)
  // because we need passive:false on touchmove to preventDefault during pinch.
  const staticWrapperRef = useRef(null);
  useEffect(() => {
    if (!performanceMode) return;
    const el = staticWrapperRef.current;
    if (!el) return;

    const onTouchStart = (e) => {
      if (e.touches.length === 2) {
        const t0 = e.touches[0], t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX;
        const dy = t0.clientY - t1.clientY;
        pinchStartRef.current = {
          distance: Math.hypot(dx, dy),
          zoom: staticZoom,
        };
      } else if (e.touches.length === 1 && staticZoom > 1.01) {
        panStartRef.current = {
          x: e.touches[0].clientX,
          y: e.touches[0].clientY,
          panX: staticPan.x,
          panY: staticPan.y,
        };
      }
    };

    const onTouchMove = (e) => {
      if (e.touches.length === 2 && pinchStartRef.current) {
        e.preventDefault();
        const t0 = e.touches[0], t1 = e.touches[1];
        const dx = t0.clientX - t1.clientX;
        const dy = t0.clientY - t1.clientY;
        const dist = Math.hypot(dx, dy);
        const next = pinchStartRef.current.zoom * (dist / pinchStartRef.current.distance);
        setStaticZoom(Math.max(1, Math.min(5, next)));
      } else if (e.touches.length === 1 && panStartRef.current && staticZoom > 1.01) {
        e.preventDefault();
        const dx = e.touches[0].clientX - panStartRef.current.x;
        const dy = e.touches[0].clientY - panStartRef.current.y;
        const rect = el.getBoundingClientRect();
        const maxX = (rect.width * (staticZoom - 1)) / 2;
        const maxY = (rect.height * (staticZoom - 1)) / 2;
        setStaticPan({
          x: Math.max(-maxX, Math.min(maxX, panStartRef.current.panX + dx)),
          y: Math.max(-maxY, Math.min(maxY, panStartRef.current.panY + dy)),
        });
      }
    };

    const onTouchEnd = (e) => {
      // Set didPinch only if a true pinch (2-finger) or significant pan happened.
      // Stationary single-finger taps should still place pins.
      if (pinchStartRef.current && e.touches.length < 2) {
        didPinchRef.current = true;
        setTimeout(() => { didPinchRef.current = false; }, 300);
        pinchStartRef.current = null;
      }
      if (e.touches.length === 0) {
        // If we were panning, suppress the click. Single-tap (no move) → click fires normally.
        if (panStartRef.current) {
          didPinchRef.current = true;
          setTimeout(() => { didPinchRef.current = false; }, 300);
        }
        panStartRef.current = null;
      }
    };

    // Double-tap to reset zoom and pan
    const onDoubleClick = (e) => {
      if (staticZoom > 1.01 || staticPan.x !== 0 || staticPan.y !== 0) {
        e.preventDefault();
        e.stopPropagation();
        setStaticZoom(1);
        setStaticPan({ x: 0, y: 0 });
      }
    };

    // v1.11.39: Click → place pin in Performance Mode (when pulseAnim is
    // globe). Uses container rect (NOT wrapper rect, which is transformed)
    // for accurate inverse projection.
    const onClick = (e) => {
      if (didPinchRef.current) {
        didPinchRef.current = false;
        return;
      }
      if (pulseAnim !== 'globe' || !onPoolPinChange) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();  // NOT el (wrapper) — it's scaled
      const W = rect.width, H = rect.height;
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;
      const cx = (clickX - W/2 - staticPan.x) / staticZoom + W/2;
      const cy = (clickY - H/2 - staticPan.y) / staticZoom + H/2;
      const lonDeg = (cx / W) * 360 - 180;
      const latDeg = 90 - (cy / H) * 180;
      if (latDeg > 90 || latDeg < -90 || lonDeg > 180 || lonDeg < -180) return;
      onPoolPinChange(snapPinTo5Deg(latDeg, lonDeg));
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('dblclick', onDoubleClick);
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('dblclick', onDoubleClick);
      el.removeEventListener('click', onClick);
    };
  }, [performanceMode, staticZoom, staticPan, pulseAnim, onPoolPinChange]);

  // ── v1.8.8-rev36: pointer-driven drag rotation ───────────────────────
  // The canvas now responds to drag gestures: horizontal motion updates
  // YAW (uRotY), vertical motion updates PITCH (uRotX). Auto-spin pauses
  // while the pointer is down and resumes on release.
  //
  // Tap-vs-drag is decided by total movement during the press: under 6px
  // (CSS) is a tap and routes to handleCanvasTap (only does anything in
  // pin-placement mode); 6px+ is a drag and consumes the gesture so it
  // does NOT also fire a pin tap.
  const handlePointerDown = useCallback((e) => {
    // Mouse: only respond to primary button. Touch/pen: always.
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget;
    try { target.setPointerCapture(e.pointerId); } catch { /* old Safari */ }

    // rev70k: track pointer for pinch-zoom in any mode (only constellation
    // uses it for now, but cheap to keep state).
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pulseAnimRef.current === 'block') {
      // Constellation: ping interaction so auto-rotate pauses. If two
      // pointers are now active, set up pinch-zoom baseline.
      // rev71e: 2D constellation renderer has no auto-rotate so it doesn't
      // ship `pingInteraction`. Guard the call to avoid TypeError that was
      // aborting the pointer handler before pan/zoom logic could run.
      if (constellationRendererRef.current && constellationRendererRef.current.pingInteraction) {
        constellationRendererRef.current.pingInteraction();
      }
      if (pointersRef.current.size === 2) {
        const pts = Array.from(pointersRef.current.values());
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        pinchRef.current.active = true;
        pinchRef.current.lastDist = Math.sqrt(dx * dx + dy * dy);
        // Cancel any in-progress single-finger drag.
        dragStateRef.current.active = false;
        dragStateRef.current.pointerId = null;
        return;
      }
    }

    dragStateRef.current = {
      active: true,
      lastX: e.clientX,
      lastY: e.clientY,
      totalMoved: 0,
      pointerId: e.pointerId,
    };
  }, []);

  const handlePointerMove = useCallback((e) => {
    // rev70k: keep pointer position fresh for pinch-zoom calc, regardless
    // of mode. Cheap (Map.set is O(1)).
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // rev70k: pinch-zoom path — applies only in constellation mode when
    // 2 pointers are down. Computes distance delta and feeds to renderer.
    if (pulseAnimRef.current === 'block' && pinchRef.current.active
        && pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const last = pinchRef.current.lastDist;
      if (last > 0 && dist > 0 && constellationRendererRef.current) {
        const factor = dist / last;
        // Soften (raise to power < 1) so pinch feels less twitchy
        const softened = Math.pow(factor, 0.85);
        constellationRendererRef.current.multiplyZoom(softened);
      }
      pinchRef.current.lastDist = dist;
      return;
    }

    const drag = dragStateRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    drag.totalMoved += Math.abs(dx) + Math.abs(dy);

    // rev70k: in constellation mode, drag rotates the WebGL camera via the
    // renderer's interaction API instead of the globe rot refs.
    if (pulseAnimRef.current === 'block') {
      if (constellationRendererRef.current) {
        // Negate dx so dragging right rotates scene right (direct manip).
        constellationRendererRef.current.addRotation(-dx, -dy);
      }
      return;
    }

    // ─── Globe drag-to-rotate (default) ─────────────────────────────────
    // Drag-to-rotate sensitivity. ~0.008 rad per CSS px ≈ 90° per ~200px
    // of drag, which feels natural for both mouse and touch.
    const SENS = 0.008;
    // Horizontal drag → YAW. Direction: dragging right rotates the globe
    // such that content under the finger moves with the finger (direct
    // manipulation). This is opposite to incrementing rotY, hence -=.
    const canvas = canvasRef.current;
    if (canvas) {
      canvas._globeRotY = (canvas._globeRotY || 0) - dx * SENS;
    }
    // Vertical drag → PITCH. Clamp to ±85° so the user can't roll past
    // straight up/down (which would invert the world and confuse the
    // tap math). Direction: drag DOWN tilts forward (pitch increases).
    // rev43-debug: full pitch enabled so user can drag straight up/down
    // to look directly at north/south poles. Combined with debug
    // wireframe, this lets us inspect pole topology at any angle.
    const PITCH_LIMIT = Math.PI / 2;  // ±90° = full vertical range
    globeRotXRef.current = Math.max(
      -PITCH_LIMIT,
      Math.min(PITCH_LIMIT, globeRotXRef.current - dy * SENS)
    );
  }, []);

  const handlePointerUp = useCallback((e) => {
    // rev70k: remove pointer from tracking map. If pinch was active and
    // we drop below 2 pointers, end pinch — but don't restart drag (user
    // would need to lift and re-press to drag).
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current.active && pointersRef.current.size < 2) {
      pinchRef.current.active = false;
      pinchRef.current.lastDist = 0;
    }

    const drag = dragStateRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    const wasTap = drag.totalMoved < 6;
    drag.active = false;
    drag.pointerId = null;
    // Pin tap only fires in globe pin-placement mode. Constellation
    // doesn't have pin placement, so this never triggers there.
    if (wasTap && placingPinRef.current) {
      handleCanvasTap(e);
    }
  }, [handleCanvasTap]);

  const handlePointerCancel = useCallback((e) => {
    // rev70k: clear pointer tracking + pinch state on cancel too.
    pointersRef.current.delete(e.pointerId);
    if (pinchRef.current.active && pointersRef.current.size < 2) {
      pinchRef.current.active = false;
      pinchRef.current.lastDist = 0;
    }
    const drag = dragStateRef.current;
    if (drag.pointerId === e.pointerId) {
      drag.active = false;
      drag.pointerId = null;
    }
  }, []);

  // rev70k: wheel-zoom for desktop browsers in constellation mode. iOS
  // doesn't deliver wheel events from trackpad pinch, but it does from
  // 2-finger scroll on a Magic Mouse / trackpad (via deltaY). Keeps the
  // zoom feel consistent with pinch-to-zoom on touch.
  const handleWheel = useCallback((e) => {
    if (pulseAnimRef.current !== 'block') return;
    if (!constellationRendererRef.current) return;
    e.preventDefault();
    // deltaY > 0 = scroll down = zoom out.
    // Convert to multiplicative factor with damping.
    const factor = Math.exp(-e.deltaY * 0.0025);
    constellationRendererRef.current.multiplyZoom(factor);
  }, []);

  // ── rev70k: Constellation interaction handlers ────────────────────
  // Live drag-to-rotate + pinch-to-zoom on the constellation WebGL canvas.
  // Drag (1 pointer): rotate scene via renderer.addRotation(dx, dy)
  // Pinch (2 pointers): zoom via renderer.multiplyZoom(distRatio)
  // Wheel (desktop): zoom via renderer.multiplyZoom(wheelFactor)
  // Double-click (desktop): resetView()
  const handleConstellationPointerDown = useCallback((e) => {
    if (!constellationRendererRef.current) return;
    e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    constellationPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // v1.11.0: track start position so pointerUp can detect a tap
    // (movement < 5px from start) vs a drag. Used by Strike Mesh
    // mode to fly the camera to the tapped peer.
    constellationTapStartRef.current = {
      x: e.clientX, y: e.clientY,
      didDrag: false,
      pointerId: e.pointerId,
    };
    if (constellationPointersRef.current.size === 2) {
      const pts = Array.from(constellationPointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      constellationPinchPrevDistRef.current = Math.sqrt(dx * dx + dy * dy);
    }
    if (constellationRendererRef.current.pingInteraction) {
      constellationRendererRef.current.pingInteraction();
    }
  }, []);

  const handleConstellationPointerMove = useCallback((e) => {
    const pts = constellationPointersRef.current;
    const prev = pts.get(e.pointerId);
    if (!prev) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // v1.11.0: track movement to disambiguate tap vs drag in pointerUp.
    const tapStart = constellationTapStartRef.current;
    if (tapStart && tapStart.pointerId === e.pointerId && !tapStart.didDrag) {
      const tdx = e.clientX - tapStart.x;
      const tdy = e.clientY - tapStart.y;
      if (tdx * tdx + tdy * tdy > 25) tapStart.didDrag = true; // > 5px
    }

    const renderer = constellationRendererRef.current;
    if (!renderer) return;

    if (pts.size >= 2) {
      // Pinch — compute current distance, compare to previous
      const all = Array.from(pts.values());
      const dx = all[0].x - all[1].x;
      const dy = all[0].y - all[1].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const prevDist = constellationPinchPrevDistRef.current || dist;
      if (prevDist > 1) {
        const factor = dist / prevDist;
        renderer.multiplyZoom(factor);
      }
      constellationPinchPrevDistRef.current = dist;
    } else if (pts.size === 1) {
      // Single-pointer drag — rotate
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      renderer.addRotation(dx, dy);
    }
  }, []);

  const handleConstellationPointerUp = useCallback((e) => {
    constellationPointersRef.current.delete(e.pointerId);
    // If we drop from 2 to 1 pointer, reset pinch reference distance so
    // the remaining pointer's next move doesn't get treated as a huge zoom.
    if (constellationPointersRef.current.size < 2) {
      constellationPinchPrevDistRef.current = 0;
    }
    // v1.11.0: tap-to-focus for Strike Mesh mode. If the user
    // tapped without dragging (< 5px movement) and the renderer supports
    // hit-testing, find the nearest peer cube and fly the camera to it.
    const tapStart = constellationTapStartRef.current;
    if (tapStart && tapStart.pointerId === e.pointerId && !tapStart.didDrag) {
      const renderer = constellationRendererRef.current;
      if (renderer && typeof renderer.hitTestPeer === 'function' &&
          typeof renderer.focusPeer === 'function') {
        const rect = e.currentTarget && e.currentTarget.getBoundingClientRect
          ? e.currentTarget.getBoundingClientRect() : null;
        if (rect) {
          const tapX = e.clientX - rect.left;
          const tapY = e.clientY - rect.top;
          const peerIdx = renderer.hitTestPeer(tapX, tapY, 30);
          if (peerIdx >= 0) renderer.focusPeer(peerIdx, 4.0);
        }
      }
    }
    constellationTapStartRef.current = null;
  }, []);

  const handleConstellationWheel = useCallback((e) => {
    const renderer = constellationRendererRef.current;
    if (!renderer) return;
    e.preventDefault();
    // Negative deltaY = wheel up = zoom in (factor > 1). Tuned for trackpads.
    const factor = Math.exp(-e.deltaY * 0.0015);
    renderer.multiplyZoom(factor);
  }, []);

  const handleConstellationDoubleClick = useCallback(() => {
    if (constellationRendererRef.current?.resetView) {
      constellationRendererRef.current.resetView();
    }
  }, []);

  // Toggle pin placement mode. Stop propagation so the click doesn't
  // bubble to the parent's "open strikers" handler.
  const togglePlacingPin = useCallback((e) => {
    e.stopPropagation();    setPlacingPin(prev => !prev);
  }, []);

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

    // v1.11.x: Visibility gate (mirror of NonceField). Skip the heavy draw
    // body when the panel is off-screen (carousel non-active slot). Keeps
    // the rAF chain alive so animation resumes instantly when scrolled
    // back into view. See NonceField for fuller commentary.
    //
    // CRITICAL: Observe the container (via containerRef), NOT the canvas.
    // PulsePanel canvases aren't currently toggled display:none, but the
    // pattern matches NonceField for consistency and safety in case future
    // changes hide the canvas (which would freeze the draw loop). The
    // container is always visible whenever the panel is mounted.
    const containerEl = containerRef.current;
    const isVisibleRef = { current: true };
    let pulseIntersectionObserver = null;
    if (containerEl && typeof IntersectionObserver !== 'undefined') {
      pulseIntersectionObserver = new IntersectionObserver((entries) => {
        for (const e of entries) isVisibleRef.current = e.isIntersecting;
      }, { threshold: 0.01 });
      pulseIntersectionObserver.observe(containerEl);
    }

    // v1.11.x: animation state-reset block removed. Was resetting
    // canvas._flakes/_glints/_embers/_chunks/_timeAccum from the old
    // Sluice Box / Cave Glimmers / Forge Embers Pulse animations, which
    // were dispatch-removed in rev61 and now have their function bodies
    // deleted too. Globe + Strike Mesh handle their own state internally.
    // ─── Solo Strike Map (Globe) ──────────────────────────────
    // Slowly-rotating 3D globe with real Natural Earth coastline outlines
    // drawn as faint amber lines + glowing amber pool dots pulsing on the
    // visible hemisphere at approximate (not exact) regional locations.
    // Coastline TopoJSON fetched once from CDN, cached on the canvas element.
    const drawGlobe = (dt, W, H) => {
      const ns = nsRef.current, enabled = enabledRef.current, workers = workersInputRef.current;
      // First-call initialization (one-time per canvas)
      if (canvas._globeInit === undefined) {
        canvas._globeInit = false;
        canvas._globeRings = null;
        canvas._globePools = [];
        canvas._globeT = 0;

        // ─ Decode TopoJSON helpers ────────────────────────────
        const decodeArcs = (topo) => {
          const { scale, translate } = topo.transform;
          return topo.arcs.map(arc => {
            let x = 0, y = 0;
            return arc.map(([dx, dy]) => {
              x += dx; y += dy;
              return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
            });
          });
        };
        const arcsToRing = (arcIndices, decodedArcs) => {
          const ring = [];
          for (const idx of arcIndices) {
            const reverse = idx < 0;
            const arc = decodedArcs[reverse ? ~idx : idx];
            const pts = reverse ? arc.slice().reverse() : arc;
            if (ring.length === 0) ring.push(...pts);
            else ring.push(...pts.slice(1));
          }
          return ring;
        };
        const geometryRings = (geom, decodedArcs) => {
          const rings = [];
          const collect = (a) => rings.push(arcsToRing(a, decodedArcs));
          if (geom.type === 'Polygon') geom.arcs.forEach(collect);
          else if (geom.type === 'MultiPolygon') geom.arcs.forEach(p => p.forEach(collect));
          return rings;
        };

        // ─ Async fetch coastline data ─
        // v1.8.8-rev17: 50m TopoJSON (~250KB, 1424 arcs). 10m caused
        // ticker stalls on iPhone main thread. 50m is plenty of detail
        // at 380px globe size and runs smooth.
        // rev55: Self-hosted world atlas. Removes runtime CDN trust from
        // jsdelivr.net. Bundled at /world-atlas-land-50m.json by Dockerfile.
        // CDN fallback is intentionally allowed via CSP connect-src for
        // robustness; if the local copy is somehow missing (mis-configured
        // deploy), the globe still renders.
        // rev59 fix: removed duplicate .then(r => r.json()) — both the local
        // fetch and the CDN fallback already return parsed JSON, so calling
        // .json() again on already-parsed data threw TypeError and broke the
        // globe whenever the local file wasn't bundled.
        fetch('/world-atlas-land-50m.json')
          .then(r => r.ok ? r.json() : Promise.reject(new Error('local atlas missing')))
          .catch(() => fetch('https://cdn.jsdelivr.net/npm/world-atlas@2/land-50m.json').then(r => r.json()))
          .then(topo => {
            const decodedArcs = decodeArcs(topo);
            const rings = [];
            for (const geom of topo.objects.land.geometries) {
              rings.push(...geometryRings(geom, decodedArcs));
            }
            canvas._globeRings = rings;

            // Precompute sin(lat), cos(lat), sin(lon), cos(lon) per
            // vertex once at load. Per-frame loop uses angle-sum
            // identity to rotate, no Math.sin/cos calls per vertex.
            const ringTrigs = rings.map(ring => {
              const n = ring.length;
              const sinLat = new Float32Array(n);
              const cosLat = new Float32Array(n);
              const sinLon = new Float32Array(n);
              const cosLon = new Float32Array(n);
              for (let i = 0; i < n; i++) {
                const lat = ring[i][1] * Math.PI / 180;
                const lon = ring[i][0] * Math.PI / 180;
                sinLat[i] = Math.sin(lat);
                cosLat[i] = Math.cos(lat);
                sinLon[i] = Math.sin(lon);
                cosLon[i] = Math.cos(lon);
              }
              return { sinLat, cosLat, sinLon, cosLon, n };
            });
            canvas._globeRingTrigs = ringTrigs;

            // Pool of candidate vertices for marker placement (sampled from
            // landmasses, skipping tiny islands). Cached so we can regenerate
            // _globePools whenever ns.pools changes without re-fetching.
            const allVerts = [];
            for (const ring of rings) {
              if (ring.length < 8) continue;
              for (let i = 0; i < ring.length; i += 2) allVerts.push(ring[i]);
            }
            canvas._globeAllVerts = allVerts;
            canvas._globeInit = true;

            // v1.8.8-rev24: bake the equirectangular world map texture
            // and upload to the WebGL renderer. Uses the SAME rings we
            // just built, so no second fetch. ~30ms one-time work.
            try {
              const renderer = webglRendererRef.current;
              if (renderer && renderer.isReady()) {
                const texCanvas = bakeWorldMapTexture(rings);
                renderer.setTexture(texCanvas);
                webglTextureReadyRef.current = true;
              }
            } catch (e) {
              console.warn('WebGL texture bake failed:', e);
              webglTextureReadyRef.current = false;
            }
          })
          .catch(e => {
            console.warn('Globe coastline fetch failed:', e);
            canvas._globeInit = true; // proceed without coastlines
          });
      }

      canvas._globeT += dt;
      const t = canvas._globeT;
      const cx = W / 2, cy = H / 2;
      const radius = Math.min(W, H) * 0.42;
      // Advance YAW (auto-spin) only when not in pin-placement mode AND
      // not currently being dragged. Freezing during placement gives the
      // user a stable target to tap; freezing during drag keeps user
      // input from fighting the auto-rotation.
      // PITCH is never auto-driven — it stays wherever the user dragged
      // it (or 0, the default upright).
      if (!placingPinRef.current && !dragStateRef.current.active) {
        canvas._globeRotY = (canvas._globeRotY || 0) + dt * 0.15;
      }
      const rotY = canvas._globeRotY || 0;
      const rotX = globeRotXRef.current;
      // Cache globe geometry for the tap-to-place handler (it runs outside
      // the animation loop but needs to invert the projection).
      const useWebGL = !!(webglRendererRef.current
                          && webglRendererRef.current.isReady()
                          && webglTextureReadyRef.current);
      globeRotYRef.current = rotY;
      globeGeomRef.current = { cx, cy, radius, useWebGL };

      // v1.8.8-rev25: atmospheric halo ALWAYS drawn on 2D canvas as a
      // halo OUTSIDE the disk. In WebGL mode this is the "atmosphere" the
      // user sees — same warm amber radial gradient as the old vector
      // globe. WebGL Fresnel rim glow is too subtle on its own.
      // rev52: atmRadius = min(W,H) * 0.46. Bumped from 0.42. Halo
      // outer ratio further reduced to 1.08 to compensate (0.46 *
      // 1.08 = 0.497, just inside canvas edge at 0.5).
      const atmRadius = useWebGL ? Math.min(W, H) * 0.46 : radius;

      if (useWebGL) {
        // Drive the WebGL renderer with the same rotation.
        // v1.8.8-rev30: W/H here are CSS pixels (canvasWidthRef.current,
        // see line 6757). The renderer's update() multiplies by dpr
        // internally to compute backing-store size. Previously we passed
        // W/dpr — the renderer then multiplied by dpr getting CSS_W
        // (not CSS_W*dpr) for canvas.width, so the globe rendered at
        // half-resolution on retina screens and looked pixelated.
        webglRendererRef.current.update({
          rotY,
          rotX,
          dpr: dprRef.current || 1,
          width: W,
          height: H,
        });
        // Clear 2D canvas to transparent so WebGL shows through behind.
        ctx.clearRect(0, 0, W, H);
      } else {
        // ─── Legacy 2D path (fallback if WebGL fails to init) ──────────
        ctx.fillStyle = 'rgba(4,5,8,1)';
        ctx.fillRect(0, 0, W, H);
      }

      // rev27 atmospheric halo. Drawn on the 2D canvas (which sits in
      // front of the WebGL canvas with a transparent background) as a
      // radial gradient ring centered on the globe.
      if (useWebGL) {
        const haloInner = atmRadius * 0.96;
        const haloOuter = atmRadius * 1.08;
        const halo = ctx.createRadialGradient(cx, cy, haloInner, cx, cy, haloOuter);
        halo.addColorStop(0.00, 'rgba(245,166,35,0.00)');
        halo.addColorStop(0.18, 'rgba(245,166,35,0.22)');
        halo.addColorStop(0.45, 'rgba(245,166,35,0.08)');
        halo.addColorStop(1.00, 'rgba(245,166,35,0.00)');
        ctx.fillStyle = halo;
        ctx.fillRect(0, 0, W, H);
      }

      if (!useWebGL) {

      // 1b) Ocean disk — radial gradient inside the globe creates limb
      // darkening (brighter at center, dark at edge). Pure 2D canvas, near
      // zero cost. The "lit from above" feel is what makes the globe feel
      // 3D rather than a circle drawn on a screen.
      const oceanGrad = ctx.createRadialGradient(
        cx - radius * 0.25, cy - radius * 0.25, 0,
        cx, cy, radius
      );
      oceanGrad.addColorStop(0,   'rgba(20, 18, 14, 1)');
      oceanGrad.addColorStop(0.7, 'rgba(10, 9, 7, 1)');
      oceanGrad.addColorStop(1,   'rgba(4, 4, 6, 1)');
      ctx.fillStyle = oceanGrad;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.fill();

      // 1) Faint lat/lon dot grid (z-modulated brightness)
      for (let lat = -Math.PI/2; lat <= Math.PI/2 + 0.01; lat += Math.PI/12) {
        for (let lon = 0; lon < Math.PI*2; lon += Math.PI/24) {
          const lonR = lon + rotY;
          const x3 = Math.cos(lat) * Math.sin(lonR);
          const y3 = Math.sin(lat);
          const z3 = Math.cos(lat) * Math.cos(lonR);
          if (z3 < 0) continue;
          const px = cx + x3 * radius;
          const py = cy - y3 * radius;
          const alpha = 0.04 + z3 * 0.06;
          ctx.fillStyle = `rgba(245,166,35,${alpha})`;
          ctx.fillRect(Math.floor(px), Math.floor(py), 1, 1);
        }
      }

      // 2) Globe rim — slightly brighter than before to anchor the disk
      ctx.strokeStyle = 'rgba(245,166,35,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2); ctx.stroke();

      // 3) Continent outlines + subtle fill — uses precomputed sin/cos
      // per vertex. Per-frame cost is multiplies-only (no Math.sin/cos
      // in the hot loop).
      // v1.8.8-rev22: subtle land shading. Two-step approach to avoid
      // the polygon-wrap bleed bug from earlier attempts:
      //   1) ctx.clip() to the visible disk circle so any polygon
      //      that wraps around the back can't bleed onto blank canvas
      //   2) Fill at a very low alpha (0.06) so any residual wrap
      //      artifacts inside the disk are masked by the dark ocean
      //      gradient — basically invisible to the eye.
      // Net result: continents read as gently lit shapes instead of
      // bare line drawings, without the patchy fill bug that killed
      // earlier rev16 attempts.
      const rings = canvas._globeRings;
      const trigs = canvas._globeRingTrigs;
      if (rings && trigs) {
        const cosR = Math.cos(rotY);
        const sinR = Math.sin(rotY);
        const MAX_SEG_DIST_SQ = 2500;

        // Pre-allocate scratch arrays sized to the largest ring once.
        let scratchN = canvas._globeScratchN || 0;
        for (const ring of rings) {
          if (ring.length > scratchN) scratchN = ring.length;
        }
        if (scratchN > (canvas._globeScratchN || 0)) {
          canvas._globeScratchX = new Float32Array(scratchN);
          canvas._globeScratchY = new Float32Array(scratchN);
          canvas._globeScratchVis = new Uint8Array(scratchN);
          canvas._globeScratchN = scratchN;
        }
        const sx = canvas._globeScratchX;
        const sy = canvas._globeScratchY;
        const sv = canvas._globeScratchVis;

        // Clip to the visible disk for the entire continent pass.
        // Anything outside the disk gets discarded automatically — no
        // way for a wrapped polygon to bleed across blank canvas.
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip();

        for (let r = 0; r < rings.length; r++) {
          const t = trigs[r];
          const n = t.n;
          // Project once, reuse for fill + stroke.
          for (let i = 0; i < n; i++) {
            const sLon = t.sinLon[i] * cosR + t.cosLon[i] * sinR;
            const cLon = t.cosLon[i] * cosR - t.sinLon[i] * sinR;
            const x3 = t.cosLat[i] * sLon;
            const y3 = t.sinLat[i];
            const z3 = t.cosLat[i] * cLon;
            sx[i] = cx + x3 * radius;
            sy[i] = cy - y3 * radius;
            sv[i] = z3 > -0.02 ? 1 : 0;
          }

          // ── Fill pass — only large rings, alpha 0.06 ──
          // Tiny islands skip this; their fill would be invisible anyway
          // and just costs paint. Big landmasses get the warm wash so
          // continents read as solid gentle shapes.
          if (rings[r].length >= 12) {
            ctx.fillStyle = 'rgba(245,166,35,0.06)';
            ctx.beginPath();
            let started = false;
            for (let i = 0; i < n; i++) {
              if (sv[i]) {
                if (!started) {
                  ctx.moveTo(sx[i], sy[i]);
                  started = true;
                } else {
                  // Cull polygon-wrap jumps inside the fill path
                  const dx = sx[i] - sx[i-1];
                  const dy = sy[i] - sy[i-1];
                  if (dx*dx + dy*dy < MAX_SEG_DIST_SQ) {
                    ctx.lineTo(sx[i], sy[i]);
                  } else {
                    ctx.moveTo(sx[i], sy[i]);
                  }
                }
              } else {
                started = false;
              }
            }
            ctx.fill();
          }
        }

        // ── Stroke pass — coastline outlines on top of fill ──
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(245,166,35,0.50)';
        for (let r = 0; r < rings.length; r++) {
          const t = trigs[r];
          const n = t.n;
          // Re-project (cheap — angle-sum identity, no trig).
          for (let i = 0; i < n; i++) {
            const sLon = t.sinLon[i] * cosR + t.cosLon[i] * sinR;
            const cLon = t.cosLon[i] * cosR - t.sinLon[i] * sinR;
            const x3 = t.cosLat[i] * sLon;
            const y3 = t.sinLat[i];
            const z3 = t.cosLat[i] * cLon;
            sx[i] = cx + x3 * radius;
            sy[i] = cy - y3 * radius;
            sv[i] = z3 > -0.02 ? 1 : 0;
          }

          let pathOpen = false;
          let prevVis = false;
          for (let i = 0; i < n; i++) {
            if (sv[i] && prevVis) {
              const dx = sx[i] - sx[i-1];
              const dy = sy[i] - sy[i-1];
              if (dx*dx + dy*dy < MAX_SEG_DIST_SQ) {
                if (!pathOpen) {
                  ctx.beginPath();
                  ctx.moveTo(sx[i-1], sy[i-1]);
                  pathOpen = true;
                }
                ctx.lineTo(sx[i], sy[i]);
              } else if (pathOpen) {
                ctx.stroke(); pathOpen = false;
              }
            } else if (pathOpen) {
              ctx.stroke(); pathOpen = false;
            }
            prevVis = !!sv[i];
          }
          if (pathOpen) { ctx.stroke(); pathOpen = false; }
        }

        ctx.restore(); // release the disk clip
      }

      } // ── end if (!useWebGL) — coastline rendering only in 2D fallback ──

      // Pool markers — peer-aware sync. Each broadcast peer becomes a
      // dot. If a peer broadcasts a `loc` (5°-snapped lat/lon), we use it;
      // otherwise we generate a stable random landmass position keyed by
      // their pubkey (so it doesn't jitter every frame). Own pin from
      // localStorage takes precedence over any echoed-back broadcast.
      if (canvas._globeAllVerts) {
        const peers = Array.isArray(ns.peers)
          ? ns.peers.filter(p => !p.filtered)
          : [];
        const verts = canvas._globeAllVerts;
        const ourPin = poolPinRef.current;          // {lat, lon} or null
        const prevByPk = new Map();
        for (const p of canvas._globePools) {
          if (p.pubkey) prevByPk.set(p.pubkey, p);
        }
        const nextPools = [];
        let ownIncluded = false;

        for (const peer of peers) {
          const prev = prevByPk.get(peer.pubkey);
          const isOwn = !!peer.isOwn;
          let lat, lon;
          let realLoc = false;

          if (isOwn && ourPin) {
            // Use local pin even before our broadcast cycle echoes back
            lat = ourPin.lat;
            lon = ourPin.lon;
            realLoc = true;
            ownIncluded = true;
          } else if (Array.isArray(peer.loc) && peer.loc.length === 2
                     && Number.isFinite(peer.loc[0]) && Number.isFinite(peer.loc[1])) {
            lat = peer.loc[0];
            lon = peer.loc[1];
            realLoc = true;
            if (isOwn) ownIncluded = true;
          } else if (prev) {
            // Reuse prior random position for stability
            nextPools.push({ ...prev, isOwn });
            if (isOwn) ownIncluded = true;
            continue;
          } else {
            // Generate new random landmass position
            const v = verts[Math.floor(Math.random() * verts.length)];
            lon = v[0] + (Math.random() - 0.5) * 4;
            lat = v[1] + (Math.random() - 0.5) * 4;
          }

          nextPools.push({
            pubkey: peer.pubkey,
            isOwn,
            realLoc,
            lat: lat * Math.PI / 180,
            lon: lon * Math.PI / 180,
            rate: prev ? prev.rate : 0.4 + Math.random() * 1.6,
            phase: prev ? prev.phase : Math.random() * Math.PI * 2,
            bright: prev ? prev.bright : 0.45 + Math.random() * 0.5,
          });
        }

        // If user has a pin but no own peer entry yet (broadcast not echoed
        // back), still render their pin so the placement feels instant.
        if (ourPin && !ownIncluded) {
          nextPools.push({
            pubkey: '__own_local__',
            isOwn: true,
            realLoc: true,
            lat: ourPin.lat * Math.PI / 180,
            lon: ourPin.lon * Math.PI / 180,
            rate: 1.0,
            phase: 0,
            bright: 0.85,
          });
        }

        canvas._globePools = nextPools;
      }

      // 4) Render pool markers — crimson dots for high contrast against
      // the strong amber land. Solid #A8170E with thin green outline on
      // the user's own pin.
      // v1.8.8-rev46: marker transform chain MUST match shader exactly:
      // (1) yaw around Y, (2) axial tilt around Z, (3) user pitch around X.
      // Earlier revs were missing the tilt and had pitch in the wrong
      // order, causing dots to slide off the continents during drag.
      const markerRadius = useWebGL ? atmRadius : radius;
      const pitch = useWebGL ? globeRotXRef.current : 0;
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      // Tilt: 23.5° in normal mode, 0° in debug mode (matches shader).
      const debugMode = typeof window !== 'undefined'
        && window.location.hash.includes('debug-globe');
      const tiltRad = (useWebGL && !debugMode) ? (23.5 * Math.PI / 180) : 0;
      const cosTilt = Math.cos(tiltRad);
      const sinTilt = Math.sin(tiltRad);
      const cosYaw = Math.cos(rotY);
      const sinYaw = Math.sin(rotY);

      const pools = canvas._globePools;
      for (const p of pools) {
        // Object-space position from lat/lon
        const ox = Math.cos(p.lat) * Math.sin(p.lon);
        const oy = Math.sin(p.lat);
        const oz = Math.cos(p.lat) * Math.cos(p.lon);
        // Step 1: YAW around Y
        const yx = ox * cosYaw + oz * sinYaw;
        const yy = oy;
        const yz = -ox * sinYaw + oz * cosYaw;
        // Step 2: TILT around Z
        const tx = yx * cosTilt - yy * sinTilt;
        const ty = yx * sinTilt + yy * cosTilt;
        const tz = yz;
        // Step 3: PITCH around X
        const x3 = tx;
        const y3 = ty * cosPitch - tz * sinPitch;
        const z3 = ty * sinPitch + tz * cosPitch;
        if (z3 < -0.05) continue;
        const px = cx + x3 * markerRadius;
        const py = cy - y3 * markerRadius;
        ctx.fillStyle = '#A8170E';
        ctx.beginPath();
        ctx.arc(px, py, 3.4, 0, Math.PI*2);
        ctx.fill();
        if (p.isOwn) {
          // v1.11.2: GOLD ECHO PULSE — three rings staggered out by 1/3 of
          // the cycle each. Creates a continuous sonar-echo effect where
          // ripples expand from your pin outward. Pure gold (#FFD700) so
          // it pops against the warm amber globe. Each ring is independent:
          // ring 0 starts at phase 0, ring 1 at phase 1/3, ring 2 at phase
          // 2/3. As one fades out at the edge, the next is mid-expansion
          // and the third is just emerging — no gap, no break.
          const PULSE_PERIOD_S = 2.5;
          const baseT = (canvas._globeT || 0);
          for (let i = 0; i < 3; i++) {
            const offset = i / 3;                                          // 0, 0.33, 0.66
            const phase = ((baseT / PULSE_PERIOD_S) + offset) % 1;          // 0..1
            const ringR = 6 + phase * 14;                                   // 6 → 20 px
            const ringAlpha = 0.85 * (1 - phase);                           // fade out
            ctx.strokeStyle = `rgba(255, 215, 0, ${ringAlpha.toFixed(3)})`; // pure gold
            ctx.lineWidth = 1.4;
            ctx.beginPath(); ctx.arc(px, py, ringR, 0, Math.PI*2); ctx.stroke();
          }
          // Inner static halo — gold marker around the pin between pulses
          // so the "I am you" identity is always visible.
          ctx.strokeStyle = 'rgba(255, 215, 0, 0.55)';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI*2); ctx.stroke();
        }
      }

      // Pin-placement overlay — dim the globe and prompt to tap
      if (placingPinRef.current) {
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(245,166,35,0.95)';
        ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('TAP ANYWHERE ON THE GLOBE', cx, cy - 8);
        ctx.fillStyle = 'rgba(245,166,35,0.55)';
        ctx.font = '500 9px ui-monospace, SFMono-Regular, Menlo, monospace';
        ctx.fillText('Snapped to ~500km region', cx, cy + 8);
      }
    };
    // ─── Master draw — picks the right one ────────────────────
    const draw = (now) => {
      const dt = Math.min(0.05, (now - lastTickRef.current) / 1000);
      lastTickRef.current = now;

      // v1.11.x: Skip work when off-screen / page hidden. Same pattern as
      // NonceField — keeps animation responsive on scroll-back without
      // burning GPU on invisible slots.
      if (!isVisibleRef.current || (typeof document !== 'undefined' && document.hidden)) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      let W = canvasWidthRef.current;
      let H = canvasHeightRef.current;
      // Self-heal stale dims. v1.8.8-rev15: ResizeObserver sometimes misses
      // the post-layout resize in vertical-scroll mode, leaving W/H = 0 and
      // the canvas stuck blank. Inline re-measure if values look wrong, then
      // re-read. Keeps cost trivial in steady state (one rect read per frame).
      if (!W || !H || W < 60 || H < 60) {
        const c = containerRef.current;
        if (c) {
          const r = c.getBoundingClientRect();
          if (r.width >= 60 && r.height >= 60) {
            const dpr = window.devicePixelRatio || 1;
            canvas.style.width = r.width + 'px';
            canvas.style.height = r.height + 'px';
            canvas.width = Math.round(r.width * dpr);
            canvas.height = Math.round(r.height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            canvasWidthRef.current = r.width;
            canvasHeightRef.current = r.height;
            W = r.width; H = r.height;
          }
        }
      }
      if (!W || !H) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }
      ctx.clearRect(0, 0, W, H);

      // v1.11.39: Performance Mode short-circuit. The static <img> overlay
      // in JSX (below) replaces the globe/block animation. Schedule next
      // frame anyway so toggling Performance Mode off resumes instantly.
      if (perfModeRef.current) {
        animationFrameRef.current = requestAnimationFrame(draw);
        return;
      }

      // v1.11.x: refresh closure-captured values from refs once per frame
      // before dispatching to sub-draws. Re-shadows `pulseAnim`, `ns`,
      // `workers` so the dispatch + the sub-draws (which look up `ns.peers`
      // and `workers` directly when in 'block' mode) see live data without
      // forcing a useEffect rebuild on every STATE_UPDATE.
      const pulseAnim = pulseAnimRef.current;
      const ns = nsRef.current;
      const workers = workersInputRef.current;
      // rev61: dispatch trimmed — sluice/glimmers/embers removed.
      // v1.11.x: 'ticker' moved to Hunt; the dispatch is now {globe, block}
      // only. Any stale stored value falls through to drawGlobe (the safer
      // default — Pulse's default is 'block' but globe was the prior default
      // before block existed and it's stable for legacy users).
      // rev70i: 'block' drives a separate WebGL renderer; the 2D canvas
      // just stays cleared underneath.
      if (pulseAnim === 'globe') drawGlobe(dt, W, H);
      else if (pulseAnim === 'block') {
        // rev70u: Drive WebGL renderer with real share-flash data.
        if (constellationRendererRef.current) {
          const peerList = Array.isArray(ns.peers)
            ? ns.peers.filter(p => p && !p.filtered)
            : [];
          const poolWorkers = peerList.map(p => Math.max(0, p.workers | 0));

          // rev70y: drain pendingFlashesRef. Detection effects pushed
          // 'own' / 'peer:PUBKEY' / 'worker:NAME' tags. Translate to renderer
          // params here where peerList + workers are in scope.
          // rev71i: 'worker:NAME' becomes a specific {poolIdx, strikerIdx}
          // event (1:1 mapping). Worker order in poolState.workers gives a
          // stable index within their pool.
          const flashPoolIndices = [];
          const flashStrikerEvents = [];
          const workersList = Array.isArray(workers) ? workers : [];
          if (pendingFlashesRef.current.length > 0) {
            for (const tag of pendingFlashesRef.current) {
              if (tag === 'own') {
                // Legacy fallback (random striker in own pool)
                let ourIdx = peerList.findIndex(p => p.isOwn);
                if (ourIdx < 0 && peerList.length > 0) ourIdx = 0;
                if (ourIdx >= 0) flashPoolIndices.push(ourIdx);
              } else if (typeof tag === 'string' && tag.startsWith('peer:')) {
                const pubkey = tag.slice(5);
                const idx = peerList.findIndex(p => p.pubkey === pubkey);
                if (idx >= 0) flashPoolIndices.push(idx);
              } else if (typeof tag === 'string' && tag.startsWith('worker:')) {
                const workerName = tag.slice(7);
                const workerIdx = workersList.findIndex(w => w && w.name === workerName);
                if (workerIdx < 0) continue; // worker no longer in list
                let ourIdx = peerList.findIndex(p => p.isOwn);
                if (ourIdx < 0 && peerList.length > 0) ourIdx = 0;
                if (ourIdx < 0) continue;
                // Striker count for our pool. If worker index exceeds
                // available strikers (count mismatch), clamp to a stable
                // mapping rather than skipping silently.
                const strikerCount = poolWorkers[ourIdx] | 0;
                if (strikerCount <= 0) continue;
                const strikerIdx = workerIdx < strikerCount
                  ? workerIdx
                  : (workerIdx % strikerCount);
                flashStrikerEvents.push({ poolIdx: ourIdx, strikerIdx });
              }
            }
            pendingFlashesRef.current = [];
          }

          // rev70x→A1: queue plasma bolts for any flash event. Each flash
          // arcs a bolt between the flashing pool and the OTHER pool.
          // rev71i: also fire bolt for worker-specific events.
          for (const idx of flashPoolIndices) {
            const otherIdx = (idx === 0 ? 1 : 0);
            if (otherIdx < peerList.length && otherIdx !== idx) {
              plasmaBoltsRef.current.push({
                fromIdx: idx,
                toIdx: otherIdx,
                start: performance.now(),
                duration: 500,
              });
            }
          }
          for (const evt of flashStrikerEvents) {
            const idx = evt.poolIdx;
            const otherIdx = (idx === 0 ? 1 : 0);
            if (otherIdx < peerList.length && otherIdx !== idx) {
              plasmaBoltsRef.current.push({
                fromIdx: idx,
                toIdx: otherIdx,
                start: performance.now(),
                duration: 500,
              });
            }
          }

          // rev71j: tell renderer which pool is "ours" so it can render
          // the cyan accent ring marker.
          let ownIdx = peerList.findIndex(p => p.isOwn);
          if (ownIdx < 0 && peerList.length > 0) ownIdx = 0;

          constellationRendererRef.current.update({
            dpr: dprRef.current || 1,
            width: W,
            height: H,
            poolWorkers,
            flashPoolIndices,
            flashStrikerEvents,
            ownPoolIdx: ownIdx,
            dt,
          });

          // rev70x→A1: render plasma bolts on the 2D canvas overlay using
          // the exact preview algorithm — recursive midpoint displacement,
          // two-pass: outer thick blue glow + inner thin white core.
          // WebGL gl.lineWidth doesn't support thick lines, hence 2D canvas.
          if (plasmaBoltsRef.current.length > 0 && constellationRendererRef.current.getPoolScreenPositions) {
            const screenPositions = constellationRendererRef.current.getPoolScreenPositions(W, H);
            const tNow = performance.now();
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            for (let i = plasmaBoltsRef.current.length - 1; i >= 0; i--) {
              const b = plasmaBoltsRef.current[i];
              const age = (tNow - b.start) / b.duration;
              if (age >= 1) { plasmaBoltsRef.current.splice(i, 1); continue; }
              const alpha = Math.min(1, (1 - age) * 1.4);
              const fromPool = screenPositions[b.fromIdx];
              const toPool = screenPositions[b.toIdx];
              if (!fromPool || !toPool) continue;
              // Recursive midpoint displacement (matches preview's makeJaggedPath)
              const segs = [];
              const recurse = (p1, p2, d, depthLeft) => {
                if (depthLeft === 0) { segs.push(p1, p2); return; }
                const mx = (p1.x + p2.x) / 2 + (Math.random() - 0.5) * d;
                const my = (p1.y + p2.y) / 2 + (Math.random() - 0.5) * d;
                const m = { x: mx, y: my };
                recurse(p1, m, d * 0.5, depthLeft - 1);
                recurse(m, p2, d * 0.5, depthLeft - 1);
              };
              recurse(fromPool, toPool, 18, 4);
              // Outer blue glow
              ctx.strokeStyle = 'rgba(170,200,255,' + (alpha * 0.85) + ')';
              ctx.lineWidth = 3.0;
              ctx.beginPath();
              for (let j = 0; j < segs.length; j += 2) {
                if (j === 0) ctx.moveTo(segs[j].x, segs[j].y);
                ctx.lineTo(segs[j + 1].x, segs[j + 1].y);
              }
              ctx.stroke();
              // Inner white core
              ctx.strokeStyle = 'rgba(255,255,255,' + (alpha * 0.95) + ')';
              ctx.lineWidth = 1.2;
              ctx.beginPath();
              for (let j = 0; j < segs.length; j += 2) {
                if (j === 0) ctx.moveTo(segs[j].x, segs[j].y);
                ctx.lineTo(segs[j + 1].x, segs[j + 1].y);
              }
              ctx.stroke();
            }
            ctx.restore();
          }
        }
      }
      // v1.11.x: ticker moved to Hunt; this fallthrough used to default
      // to drawTicker. Stored 'ticker' value gets migrated to 'block'
      // by loadPulseAnim, so realistically this `else` is unreachable —
      // but defensively render the globe (the original v1.8 default) for
      // any unforeseen stale state, rather than silently drawing nothing.
      else drawGlobe(dt, W, H);
      animationFrameRef.current = requestAnimationFrame(draw);
    };

    animationFrameRef.current = requestAnimationFrame(draw);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (pulseIntersectionObserver) pulseIntersectionObserver.disconnect();
    };
  // v1.11.x: dependency array is intentionally empty. Previously this
  // useEffect rebuilt on every change to ns.hashrate/ns.pools/ns.workers/
  // ns.peers/workers/pulseAnim/enabled — which fires on
  // every WebSocket STATE_UPDATE (~every 2s). The teardown reset
  // canvas._columns/_winnerAccum/_glints/etc. to undefined and the new
  // effect re-initialized them, which is what made the Hash Ticker drops
  // visibly RESTART every couple seconds and the Constellation lose
  // animation continuity.
  // The animation now mounts once for the lifetime of PulsePanel and
  // reads live state via refs (nsRef, enabledRef, workersInputRef,
  // pulseAnimRef) updated each render. Visible
  // behavior is identical (still updates within 16ms of state change),
  // but no teardown thrash.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rev71i: per-worker share detection. Each worker's shareEvents.accepted
  // counter increments per accepted share. When it goes up by N, we schedule
  // N flashes tagged with that worker's name. The dispatch translates
  // 'worker:NAME' → a specific striker index so individual miners light up,
  // 1:1 with their actual share submissions. Replaces the rev71d acceptedCount
  // path which was pool-level (random striker pick).
  useEffect(() => {
    if (!enabled) return;
    const list = Array.isArray(workers) ? workers : [];
    const seen = new Set();

    for (const w of list) {
      const name = w?.name;
      if (!name) continue;
      seen.add(name);
      const accepted = (w.shareEvents && w.shareEvents.accepted) | 0;
      const prev = workerAcceptedRef.current.get(name);
      if (prev == null) {
        // First observation — record without firing (these shares are historical)
        workerAcceptedRef.current.set(name, accepted);
        continue;
      }
      const delta = accepted - prev;
      if (delta > 0) {
        // Stagger this worker's flashes across most of the WS push window
        // (5s) so a burst doesn't all land in one frame.
        const WINDOW_MS = 4500;
        const MIN_GAP_MS = 150;
        const N = Math.min(delta, Math.floor(WINDOW_MS / MIN_GAP_MS));
        const stagger = N > 1 ? WINDOW_MS / N : 0;
        pendingFlashesRef.current.push('worker:' + name);
        for (let k = 1; k < N; k++) {
          setTimeout(() => {
            pendingFlashesRef.current.push('worker:' + name);
          }, k * stagger);
        }
      }
      workerAcceptedRef.current.set(name, accepted);
    }

    // Drop workers that left
    for (const name of Array.from(workerAcceptedRef.current.keys())) {
      if (!seen.has(name)) workerAcceptedRef.current.delete(name);
    }
  }, [workers, enabled]);

  // rev71f: peer synthesis. When a peer broadcast arrives (lastSeenAgoSec
  // drops), we know their reported hashrate. Mining is a Poisson process,
  // so we can schedule statistically-faithful flashes between broadcasts:
  //   shares/sec = hashrate / (sharediff × 2^32)
  // We use ckpool's typical sharediff = 16384 as the assumed denominator.
  // This isn't per-event verification, but it IS a true statement: a peer
  // claiming 200 TH/s must be submitting ~2.8 shares/sec to maintain it.
  // The flashes are visually identical to observed-share flashes — Pulse
  // is showing aggregate network reality, not an evidence log.
  //
  // Each peer gets a single self-rearming setTimeout (one timer in flight
  // at a time, not pre-scheduled, so no timer-storm at high rates). When
  // the same peer broadcasts again, the existing timer is cleared and a
  // fresh schedule starts. Schedule expires after 4 min (relay broadcast
  // ceiling) — if we don't get a fresh broadcast by then, we stop synth-
  // esizing rather than guess at stale rates.
  useEffect(() => {
    if (!enabled) return;
    const peers = Array.isArray(ns.peers) ? ns.peers.filter(p => p && !p.filtered) : [];
    const newSeen = new Map();

    const ASSUMED_SHAREDIFF = 16384;
    const TWO_32 = Math.pow(2, 32);
    const VISUAL_RATE_CAP = 6;        // flashes/sec ceiling per peer
    const VISUAL_RATE_FLOOR = 0.05;   // floor so very low hashrate peers still flash
    const SCHEDULE_DURATION_MS = 4 * 60 * 1000; // align with broadcast ceiling

    for (const peer of peers) {
      const cur = peer.lastSeenAgoSec | 0;
      newSeen.set(peer.pubkey, cur);
      if (peer.isOwn) continue; // own pool flashes via acceptedCount path

      const prev = peerLastSeenRef.current.get(peer.pubkey);
      const droppedJustNow = (prev != null && cur < prev);

      // First time we see this peer (no prev), OR they just broadcast.
      // Either way, (re)start their synthesis schedule.
      const shouldSchedule = droppedJustNow || prev == null;
      if (!shouldSchedule) continue;

      // Cancel any existing schedule for this peer
      const existing = peerSynthRef.current.get(peer.pubkey);
      if (existing) clearTimeout(existing.timeoutId);

      // Compute Poisson rate from reported hashrate
      const hashrate = Math.max(0, peer.hashrate || 0);
      const ratePerSec = hashrate / (ASSUMED_SHAREDIFF * TWO_32);
      const visualRate = Math.max(VISUAL_RATE_FLOOR, Math.min(VISUAL_RATE_CAP, ratePerSec));
      const meanIntervalMs = 1000 / visualRate;
      const expiresAt = Date.now() + SCHEDULE_DURATION_MS;

      // First flash: confirm the broadcast we just received.
      pendingFlashesRef.current.push('peer:' + peer.pubkey);

      const scheduleNext = () => {
        if (Date.now() >= expiresAt) {
          peerSynthRef.current.delete(peer.pubkey);
          return;
        }
        // Exponential interval = -ln(U) * mean → Poisson process timing
        const u = Math.max(1e-9, Math.random()); // avoid log(0)
        const intervalMs = -Math.log(u) * meanIntervalMs;
        const id = setTimeout(() => {
          pendingFlashesRef.current.push('peer:' + peer.pubkey);
          scheduleNext();
        }, intervalMs);
        peerSynthRef.current.set(peer.pubkey, { timeoutId: id, expiresAt });
      };
      scheduleNext();
    }

    // Drop schedules for peers no longer in the list (left the network)
    for (const [pubkey, sched] of peerSynthRef.current) {
      if (!newSeen.has(pubkey)) {
        clearTimeout(sched.timeoutId);
        peerSynthRef.current.delete(pubkey);
      }
    }

    peerLastSeenRef.current = newSeen;
    // rev71k: NO cleanup function here. The previous version cleared all
    // peer synth timers on every dep change (which fires every 5s when
    // ns.peers gets a new reference from each WS push). That killed the
    // self-rearming Poisson chain after the first broadcast — the schedule
    // would only restart when a peer actually broadcast (every 4 min),
    // which is exactly what we were trying to AVOID. Peer departure is
    // already handled inline above. Component-unmount cleanup is in the
    // separate effect below.
  }, [ns.peers, enabled]);

  // rev71k: dedicated unmount cleanup for peer synth timers. Empty deps so
  // it runs once on mount and once on unmount, never on dep changes.
  useEffect(() => {
    return () => {
      for (const sched of peerSynthRef.current.values()) {
        clearTimeout(sched.timeoutId);
      }
      peerSynthRef.current.clear();
    };
  }, []);







  // v1.11.x MEMORY LEAK FIX: removed the spikesRef.current.push effect
  // here. The consumer was deleted in rev60 (see comment in NonceField
  // useEffect around line 3172: "removed broken spikesRef.current loop"),
  // but this producer effect was left behind. Every hashrate/pools/workers
  // change pushed an entry that was never read or popped, growing the
  // array unboundedly across a long-running session.

  // Bottom-right "100% SOLO" stamp — rotated, amber, glowing
  // iter27c: bumped up from 0.2rem to 0.6rem so it's no longer clipped
  // at the card's bottom edge on mobile.
  const StampSolo = () => (
    <div style={{
      position:'absolute', right:'0.5rem', bottom:'0.6rem',
      transform:'rotate(-12deg)',
      fontFamily:'var(--fd)', fontSize:'0.6rem', fontWeight:800,
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
      willChange:'opacity',
    }}>
      <div>100%</div>
      <div>SOLO</div>
    </div>
  );

  if (!enabled) {
    return (
      <div style={{...card, position:'relative', minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
        <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)', flexShrink:0}}>
          <span>▸ SoloStrike Pulse</span>
          <span style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em', color:'var(--text-3)', marginRight:14}}>OFF</span>
        </div>
        <div style={{textAlign:'center', padding:'1.5rem 0.75rem', color:'var(--text-2)'}}>
          <div style={{ fontSize: '1.8rem', marginBottom: 6 }}>📡</div>
          <div style={{fontFamily:'var(--fd)', fontSize:'0.85rem', color:'var(--text-1)', marginBottom: 6, fontWeight:600}}>Pulse is offline</div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-2)', lineHeight:1.5, maxWidth:300, margin:'0 auto'}}>
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
    <>
      {compact ? (
      <div style={{position:'relative'}}>
        {/* v1.11.1: title bar is the dedicated tap-to-open-strikers target,
            NOT the canvas. See full-branch comment below for rationale. */}
        <div
          onClick={onOpenStrikers}
          role={onOpenStrikers ? 'button' : undefined}
          tabIndex={onOpenStrikers ? 0 : undefined}
          onKeyDown={onOpenStrikers ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStrikers(); } } : undefined}
          style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)', marginBottom:'0.4rem', cursor: onOpenStrikers ? 'pointer' : 'default'}}
          title={onOpenStrikers ? 'Tap to view all Strikers' : undefined}
        >
          <span>▸ SoloStrike Pulse</span>
          <span style={{display:'inline-flex', alignItems:'center', gap:5, fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.15em', color:'var(--green)', textShadow:'0 0 6px var(--green)', marginRight:14}}>
            <span style={{width:5, height:5, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 6px var(--green)', animation:'pulse 2s ease-in-out infinite', willChange:'opacity'}}/>
            LIVE
          </span>
        </div>
        {/* Canvas region — NOT clickable (handled by canvas itself). */}
        <div>
        {/* Smaller waveform for embedded mode.
            v1.8.5-rev70e: bg transparent + no border so the globe sphere
            (and other animations) sit directly on the card surface.
            All canvases inside are alpha-transparent. */}
        <div ref={containerRef} style={{
          width:'100%',
          // v1.11.39: Compact layout — mirror the live globe sizing.
          // The non-perf branch uses height:88 (small embedded mode);
          // perf mode mirrors that single-height behavior with a small
          // bump for the map to be readable.
          ...(performanceMode
            ? { height: 140 }
            : { height: 88 }),
          background:'transparent',
          marginBottom:'0.6rem',
          position:'relative', overflow:'hidden',
        }}>

          {/* v1.8.8-rev42 (rev27 restoration): WebGL globe canvas behind
              transparent 2D canvas. The 2D canvas handles markers, pin
              tap overlay, and pointer events for drag rotation. */}
          <canvas ref={webglCanvasRef} style={{
            position:'absolute', inset:0, width:'100%', height:'100%',
            pointerEvents:'none',
            display: pulseAnim === 'globe' ? 'block' : 'none',
          }}/>
          {/* v1.8.5-rev70i: Constellation WebGL canvas. Sibling of globe;
              only one is display:block at a time.
              rev70k: receives pointer events when active; supports drag
              to rotate + pinch / wheel to zoom + double-click to reset. */}
          <canvas
            ref={constellationCanvasRef}
            onPointerDown={handleConstellationPointerDown}
            onPointerMove={handleConstellationPointerMove}
            onPointerUp={handleConstellationPointerUp}
            onPointerCancel={handleConstellationPointerUp}
            onPointerLeave={handleConstellationPointerUp}
            onWheel={handleConstellationWheel}
            onDoubleClick={handleConstellationDoubleClick}
            style={{
              position:'absolute', inset:0, width:'100%', height:'100%',
              pointerEvents: pulseAnim === 'block' ? 'auto' : 'none',
              touchAction: 'none', // disable browser default pinch/scroll
              cursor: pulseAnim === 'block' ? 'grab' : 'default',
              display: pulseAnim === 'block' ? 'block' : 'none',
            }}
          />
          {/* v1.11.39: Performance Mode static Pulse map (compact layout). */}
          {/* v1.11.39 — Pinch-zoom wrapper (same as full layout below). */}
          {performanceMode && (
            <div
              ref={staticWrapperRef}
              style={{
                position:'absolute', inset:0, zIndex:1,
                transform: `translate(${staticPan.x}px, ${staticPan.y}px) scale(${staticZoom})`,
                transformOrigin: '50% 50%',
                transition: (pinchStartRef.current || panStartRef.current) ? 'none' : 'transform 0.18s ease-out',
                touchAction: 'none',
                pointerEvents: 'auto',
              }}
            >
              {pulseAnim === 'globe' && (
                <img
                  src="/static/pulse-map.png"
                  alt=""
                  draggable={false}
                  style={{
                    position:'absolute', inset:0,
                    width:'100%', height:'100%',
                    objectFit:'fill',
                    pointerEvents:'none',
                    background:'var(--bg-void)',
                  }}
                />
              )}
              {pulseAnim === 'block' && (
                <StaticPulseMesh peers={Array.isArray(ns.peers) ? ns.peers.filter(p => p && !p.filtered) : []} ownPin={poolPin} />
              )}
              {pulseAnim === 'globe' && (
                <StaticPulseStrikes peers={Array.isArray(ns.peers) ? ns.peers.filter(p => p && !p.filtered) : []} ownPin={poolPin} />
              )}
            </div>
          )}
          {/* v1.11.39: DOM strike markers — CSS-keyframe animated rings
              positioned via equirectangular projection. Only mounted when
              performanceMode is on (zero cost otherwise). */}

          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onWheel={handleWheel}
            style={{
              position:'relative', display:'block',
              width:'100%', height:'100%',
              touchAction:'none',
              cursor: placingPin ? 'crosshair' : 'grab',
              // rev70k: 2D canvas always receives pointer events. The
              // mode-aware handlers internally route input to the globe
              // (drag-rotate, pin tap) or to the constellation renderer
              // (drag-rotate via addRotation, pinch-zoom via multiplyZoom).
            }}
          />
          {/* rev70u: pin button restored to icon-only overlay inside the
              canvas wrap (top-right). The earlier text-below-canvas variant
              ate vertical space, shrinking the globe. */}
          {pulseAnim === 'globe' && onPoolPinChange && (
            <button
              onClick={togglePlacingPin}
              style={{
                position:'absolute', bottom:4, right:6,
                background:'transparent',
                border:'none',
                padding:0, cursor:'pointer',
                color: placingPin ? '#ff8a8a' : 'var(--amber)',
                fontSize:'1rem', lineHeight:1,
                display:'flex', alignItems:'center', justifyContent:'center',
                zIndex:5,
                textShadow: placingPin ? '0 0 6px rgba(225,80,80,0.7)' : '0 0 6px rgba(245,166,35,0.6)',
              }}
              aria-label={placingPin ? 'Cancel pin placement' : (poolPin ? 'Move pin' : 'Pin my pool')}
              title={placingPin ? 'Cancel' : (poolPin ? 'Move pin' : 'Pin my pool')}
            >
              {placingPin ? '✕' : (poolPin ? '↻' : '📍')}
            </button>
          )}
          {/* v1.11.0: Strike Mesh overlays for the compact card. */}
          {pulseAnim === 'block' && (
            <>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setSimulatorOpen(true);
                }}
                style={{
                  position: 'absolute', top: 8, right: 10,
                  color: '#ffe07a', fontSize: '0.55rem',
                  letterSpacing: '0.16em', cursor: 'pointer',
                  userSelect: 'none', fontWeight: 600, zIndex: 5,
                  textShadow: '0 0 8px rgba(212,164,55,0.7)',
                }}
                role="button"
                aria-label="Open block constellation simulator"
              >◈ Simulate Mesh</div>
              {/* v1.11.x: Find Me only shown when peer count > 2. With 2 peers
                  the cube is in Bar stage taking up most of the canvas — the
                  button does nothing useful. Hidden until peers grow. */}
              {(ns.peers?.length || 0) > 2 && (
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  const r = constellationRendererRef.current;
                  if (r && typeof r.focusPeer === 'function') r.focusPeer(0, 4.0);
                }}
                style={{
                  position: 'absolute', bottom: 8, right: 10,
                  color: '#ffe07a', fontSize: '0.55rem',
                  letterSpacing: '0.16em', cursor: 'pointer',
                  userSelect: 'none', fontWeight: 600, zIndex: 5,
                  textShadow: '0 0 8px rgba(212,164,55,0.7)',
                }}
                role="button"
                aria-label="Find my pool"
              >◎ Find Me</div>
              )}
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  const r = constellationRendererRef.current;
                  if (r && typeof r.resetView === 'function') r.resetView();
                }}
                style={{
                  position: 'absolute', bottom: 8, left: 10,
                  color: 'var(--text-2)', fontSize: '0.55rem',
                  letterSpacing: '0.16em', cursor: 'pointer',
                  userSelect: 'none', fontWeight: 600, zIndex: 5,
                  textShadow: '0 0 6px rgba(0,0,0,0.9)',
                }}
                role="button"
                aria-label="Reset view"
              >⟲ Reset</div>
              {/* v1.11.x: Simulator overlay was added here as a duplicate
                  during patch development. The pre-existing one above
                  already provides the same functionality — removed
                  duplicate to avoid two stacked tap targets. */}
            </>
          )}
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

        {/* Footer tagline — single line in compact, leave room for stamp on right.
            v1.8.8-globe-rev7: when 'Solo Strike Map' is the active animation we
            swap in a privacy disclaimer (locations are approximate, miners stay
            private). Other animations keep the existing 100% SOLO tagline.
            v1.11.1: footer is the second tap-target for opening strikers
            (the first being the title bar). Canvas region between is reserved
            for direct interaction. */}
        <div
          onClick={onOpenStrikers}
          role={onOpenStrikers ? 'button' : undefined}
          tabIndex={onOpenStrikers ? 0 : undefined}
          onKeyDown={onOpenStrikers ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStrikers(); } } : undefined}
          title={onOpenStrikers ? 'Tap to view all Strikers' : undefined}
          style={{
          borderTop:'1px dashed rgba(245,166,35,0.18)',
          paddingTop:'0.4rem',
          fontFamily:'var(--fm)', fontSize:'0.55rem', color:'var(--text-2)',
          lineHeight:1.4, paddingRight:'4rem',
          cursor: onOpenStrikers ? 'pointer' : 'default',
        }}>
          {pulseAnim === 'globe' ? (
            <span style={{fontStyle:'italic', letterSpacing:'0.04em'}}>
              Pool locations are approximate, not exact — miners remain private.
            </span>
          ) : (
            <>
              <span style={{color:'var(--amber)', fontWeight:600}}>100% SOLO ·</span> Your blocks stay yours.
            </>
          )}
          {onOpenStrikers && (ns.peers && ns.peers.length > 0) && (
            <span style={{marginLeft:6, color:'var(--amber)', fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em'}}>▸ TAP STRIKERS</span>
          )}
        </div>
        </div>
        <StampSolo/>
      </div>
    ) : (
    <div style={{...card, position:'relative', minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      {/* v1.11.1: title bar is now the dedicated tap-to-open-strikers
          target, NOT the canvas region. Previously the entire body of
          the card was wrapped in onClick={onOpenStrikers}, which made
          the Strike Mesh overlays (◎ Find Me / ⟲ Reset) bubble
          up and accidentally open the panel on tap. By moving the
          onClick to the title bar + below-canvas caption only, the
          canvas itself is reserved for direct interaction (drag, pinch,
          tap-to-focus on a peer cube). */}
      <div
        onClick={onOpenStrikers}
        role={onOpenStrikers ? 'button' : undefined}
        tabIndex={onOpenStrikers ? 0 : undefined}
        onKeyDown={onOpenStrikers ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStrikers(); } } : undefined}
        style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center', color:'var(--amber)', flexShrink:0, cursor: onOpenStrikers ? 'pointer' : 'default'}}
        title={onOpenStrikers ? 'Tap to view all Strikers' : undefined}
      >
        <span>▸ SoloStrike Pulse</span>
        <span style={{display:'inline-flex', alignItems:'center', gap:5, fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.15em', color:'var(--green)', textShadow:'0 0 6px var(--green)', marginRight:14}}>
          <span style={{width:6, height:6, borderRadius:'50%', background:'var(--green)', boxShadow:'0 0 6px var(--green)', animation:'pulse 2s ease-in-out infinite', willChange:'opacity'}}/>
          LIVE
        </span>
      </div>

      {/* Canvas region — NOT wrapped in onClick. Tap events on the canvas
          are handled by the renderer (focus-on-tap for Block mode); taps
          on the Find Me/Reset overlays trigger their own handlers without
          opening the strikers panel. */}
      <div
        style={{
          // v1.11.39: Restored flex:1 always — the inner containerRef now
          // flex-grows to fill the card's available height instead of
          // locking to 2:1 aspect ratio. Map image inside uses object-fit:
          // contain to scale up without distortion.
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
        }}
      >
      {/* The heartbeat waveform itself — flex-grows to fill available card height (min 240, max 380 to prevent runaway growth in vertical-scroll mode).
          v1.8.5-rev70e: bg transparent + no border so the globe sphere
          (and other animations) sit directly on the card surface. */}
      <div ref={containerRef} style={{
        width:'100%',
        // v1.11.39: Mirror the LIVE GLOBE sizing exactly — flex:1 with
        // minHeight:240, maxHeight:380. Previously locked perf mode to
        // aspect-ratio 2/1 which collapsed the container to ~half the
        // card height, leaving a huge dead-space gap below. The map
        // <img> already has object-fit:contain, so it preserves its
        // true 2:1 equirectangular proportions inside whatever rect
        // the container becomes — same way the round globe centers
        // itself in its container.
        flex: 1, minHeight: 240, maxHeight: 380,
        background:'transparent',
        marginBottom:'0.7rem',
        position:'relative', overflow:'hidden',
      }}>
        {/* v1.8.8-rev42 (rev27 restoration): WebGL globe canvas. */}
        <canvas ref={webglCanvasRef} style={{
          position:'absolute', inset:0, width:'100%', height:'100%',
          pointerEvents:'none',
          display: pulseAnim === 'globe' ? 'block' : 'none',
        }}/>
        {/* v1.8.5-rev70i: Constellation WebGL canvas. Sibling of globe;
            only one is display:block at a time.
            rev70k: receives pointer events when active. */}
        <canvas
          ref={constellationCanvasRef}
          onPointerDown={handleConstellationPointerDown}
          onPointerMove={handleConstellationPointerMove}
          onPointerUp={handleConstellationPointerUp}
          onPointerCancel={handleConstellationPointerUp}
          onPointerLeave={handleConstellationPointerUp}
          onWheel={handleConstellationWheel}
          onDoubleClick={handleConstellationDoubleClick}
          style={{
            position:'absolute', inset:0, width:'100%', height:'100%',
            pointerEvents: pulseAnim === 'block' ? 'auto' : 'none',
            touchAction: 'none',
            cursor: pulseAnim === 'block' ? 'grab' : 'default',
            display: pulseAnim === 'block' ? 'block' : 'none',
          }}
        />
        {/* v1.11.39: Performance Mode static Pulse map. Overlays globe and
            constellation WebGL canvases with a baked equirectangular world.
            Pointer events disabled so the 2D canvas below still handles
            pin placement. */}
        {/* v1.11.39 — Pinch-zoom + pan wrapper. Map, mesh, and SVG strikes
            all transform together so they stay aligned at any zoom level.
            Inverse transform applied to handleCanvasTap for accurate pin
            placement when zoomed. Double-tap to reset. */}
        {performanceMode && (
          <div
            ref={staticWrapperRef}
            style={{
              position:'absolute', inset:0, zIndex:1,
              transform: `translate(${staticPan.x}px, ${staticPan.y}px) scale(${staticZoom})`,
              transformOrigin: '50% 50%',
              transition: (pinchStartRef.current || panStartRef.current) ? 'none' : 'transform 0.18s ease-out',
              touchAction: 'none',
              pointerEvents: 'auto',
            }}
          >
            {pulseAnim === 'globe' && (
              <img
                src="/static/pulse-map.png"
                alt=""
                draggable={false}
                style={{
                  position:'absolute', inset:0,
                  width:'100%', height:'100%',
                  objectFit:'fill',
                  pointerEvents:'none',
                  background:'var(--bg-void)',
                }}
              />
            )}
            {pulseAnim === 'block' && (
              <StaticPulseMesh peers={Array.isArray(ns.peers) ? ns.peers.filter(p => p && !p.filtered) : []} ownPin={poolPin} />
            )}
            {pulseAnim === 'globe' && (
              <StaticPulseStrikes peers={Array.isArray(ns.peers) ? ns.peers.filter(p => p && !p.filtered) : []} ownPin={poolPin} />
            )}
          </div>
        )}
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onWheel={handleWheel}
          style={{
            position:'relative', display:'block',
            width:'100%', height:'100%',
            touchAction:'none',
            cursor: placingPin ? 'crosshair' : 'grab',
            // rev70k: see compact branch above — handlers route by mode.
          }}
        />
        {/* rev70u: pin button restored to icon-only overlay inside the
            canvas wrap (top-right). Replaces the earlier text-below variant
            that ate vertical space. */}
        {pulseAnim === 'globe' && onPoolPinChange && (
          <button
            onClick={togglePlacingPin}
            style={{
              position:'absolute', bottom:6, right:8,
              background:'transparent',
              border:'none',
              padding:0, cursor:'pointer',
              color: placingPin ? '#ff8a8a' : 'var(--amber)',
              fontSize:'1.15rem', lineHeight:1,
              display:'flex', alignItems:'center', justifyContent:'center',
              zIndex:5,
              textShadow: placingPin ? '0 0 8px rgba(225,80,80,0.7)' : '0 0 8px rgba(245,166,35,0.6)',
            }}
            aria-label={placingPin ? 'Cancel pin placement' : (poolPin ? 'Move pin' : 'Pin my pool')}
            title={placingPin ? 'Cancel' : (poolPin ? 'Move pin' : 'Pin my pool')}
          >
            {placingPin ? '✕' : (poolPin ? '↻' : '📍')}
          </button>
        )}
        {/* v1.11.0: Strike Mesh overlays. ◎ Find Me snaps the
            camera to your gold cube (peer 0); ⟲ Reset returns to the
            overview. Naked text styling (no box) — gold glow on Find Me,
            dim grey on Reset to indicate hierarchy. Only render when
            block mode is active so they don't clash with the globe pin. */}
        {pulseAnim === 'block' && (
          <>
            <div
              onClick={(e) => {
                e.stopPropagation();
                setSimulatorOpen(true);
              }}
              style={{
                position: 'absolute', top: 10, right: 12,
                color: '#ffe07a', fontSize: '0.6rem',
                letterSpacing: '0.18em', cursor: 'pointer',
                userSelect: 'none', fontWeight: 600, zIndex: 5,
                textShadow: '0 0 8px rgba(212,164,55,0.7)',
              }}
              role="button"
              aria-label="Open block constellation simulator"
            >◈ Simulate Mesh</div>
            {/* v1.11.x: Find Me only shown when peer count > 2. See compact
                branch comment for rationale. */}
            {(ns.peers?.length || 0) > 2 && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                const r = constellationRendererRef.current;
                if (r && typeof r.focusPeer === 'function') r.focusPeer(0, 4.0);
              }}
              style={{
                position: 'absolute', bottom: 10, right: 12,
                color: '#ffe07a', fontSize: '0.6rem',
                letterSpacing: '0.18em', cursor: 'pointer',
                userSelect: 'none', fontWeight: 600, zIndex: 5,
                textShadow: '0 0 8px rgba(212,164,55,0.7)',
              }}
              role="button"
              aria-label="Find my pool"
            >◎ Find Me</div>
            )}
            <div
              onClick={(e) => {
                e.stopPropagation();
                const r = constellationRendererRef.current;
                if (r && typeof r.resetView === 'function') r.resetView();
              }}
              style={{
                position: 'absolute', bottom: 10, left: 12,
                color: 'var(--text-2)', fontSize: '0.6rem',
                letterSpacing: '0.18em', cursor: 'pointer',
                userSelect: 'none', fontWeight: 600, zIndex: 5,
                textShadow: '0 0 6px rgba(0,0,0,0.9)',
              }}
              role="button"
              aria-label="Reset view"
            >⟲ Reset</div>
            {/* v1.11.x: Simulator overlay was added here as a duplicate
                during patch development. The pre-existing one above
                already provides the same functionality. */}
          </>
        )}
      </div>
      {/* rev70u: external pin button removed — now inside canvas wrap above. */}

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

      {/* Footer tagline.
          v1.8.8-globe-rev7: privacy caption replaces the 'census' tagline when
          'Solo Strike Map' is the active animation. Other animations unchanged.
          v1.11.1: this footer tagline is now the second tap-target for
          opening the Strikers modal (the first being the title bar). The
          canvas region between them is reserved for direct interaction. */}
      <div
        onClick={onOpenStrikers}
        role={onOpenStrikers ? 'button' : undefined}
        tabIndex={onOpenStrikers ? 0 : undefined}
        onKeyDown={onOpenStrikers ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenStrikers(); } } : undefined}
        title={onOpenStrikers ? 'Tap to view all Strikers' : undefined}
        style={{
        borderTop:'1px dashed rgba(245,166,35,0.18)',
        paddingTop:'0.5rem',
        fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)',
        lineHeight:1.5, paddingRight:'4rem' /* leave room for the rotated stamp */,
        cursor: onOpenStrikers ? 'pointer' : 'default',
      }}>
        {pulseAnim === 'globe' ? (
          <span style={{fontStyle:'italic', letterSpacing:'0.04em'}}>
            Pool locations are approximate, not exact — miners remain private.
          </span>
        ) : (
          <>
            Pulse is a census, not a pool. <span style={{color:'var(--amber)', fontWeight:600}}>Your blocks stay 100% yours.</span>
          </>
        )}
        {onOpenStrikers && (ns.peers && ns.peers.length > 0) && (
          <span style={{display:'block', marginTop:4, color:'var(--amber)', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em'}}>▸ TAP TO SEE STRIKERS</span>
        )}
      </div>
      </div>
      <StampSolo/>
    </div>
    )}
    {/* v1.11.x: Strike Mesh Simulator — full-screen modal mounted
        only when simulatorOpen is true. Decoupled from real network state;
        synthesizes peers + share traffic internally. Closes via the X
        button or by tapping outside the picker drawer. */}
    {simulatorOpen && (
      <BlockSimulatorModal onClose={() => setSimulatorOpen(false)}/>
    )}
    </>
  );
});
PulsePanel.displayName = "PulsePanel";

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
// v1.11.x: HashPulsePanel deleted (17 lines). Was a wrapper combining
// HashrateChart + PulsePanel; never mounted anywhere. Card composition
// happens inline in the carousel card map now.

// ── Jumpers — Combined Claim Jumpers + Gold Strikes card (v1.7.22) ──────────
// Stacks Claim Jumpers (top — pool find counts) with Gold Strikes (bottom —
// our own found blocks). Both sections render compact (no outer card wrapper,
// smaller padding/font, internal scroll caps). Section names preserved.
function JumpersPanel({ topFinders, netBlocks, blocks, blockAlert }) {
  return (
    <div style={{...card, minWidth:0, maxWidth:'100%', overflow:'hidden', display:'flex', flexDirection:'column', height:'100%'}} className="fade-in ss-card-chrome">
      {/* Claim Jumpers section (top) */}
      <TopFindersPanel topFinders={topFinders} netBlocks={netBlocks} compact />

      {/* Divider */}
      <div style={{
        height:1, background:'linear-gradient(90deg, transparent, rgba(245,166,35,0.25), transparent)',
        margin:'0.7rem 0',
        flexShrink:0,
      }}/>

      {/* Gold Strikes section (bottom) */}
      <BlockFeed blocks={blocks} blockAlert={blockAlert} compact />
      <div style={{flex:1,minHeight:0}}/>
    </div>
  );
}


// Shows every Striker (anonymous SoloStrike operator) currently on the network.
// You're pinned at the top, then everyone else by hashrate descending.
// Outlier-filtered peers hidden by default; toggle reveals them.
function StrikersModal({ networkStats, onClose }) {
  const [showFiltered, setShowFiltered] = useState(false);

  // v1.11.2: ENGAGEMENT FEATURES
  // - showOnboard: first-time "WHAT IS PULSE?" tooltip (localStorage gated)
  // - drillPeer: currently-tapped Striker to expand in bottom sheet (null = no expansion)
  // - hashGoal: user's personal hashrate target in TH/s, localStorage-persisted
  // - heartbeatSec: countdown to next outbound broadcast; ticks down once/sec
  const [showOnboard, setShowOnboard] = useState(false);
  const [drillPeer, setDrillPeer] = useState(null);
  const [hashGoal, setHashGoal] = useState(() => {
    try { const v = localStorage.getItem('ss_hash_goal_v1'); return v ? parseFloat(v) : 0; } catch { return 0; }
  });
  const [heartbeatSec, setHeartbeatSec] = useState(150); // ~2.5min broadcast cycle

  // Persist hashGoal changes
  useEffect(() => {
    try { localStorage.setItem('ss_hash_goal_v1', String(hashGoal || 0)); } catch {}
  }, [hashGoal]);

  // Heartbeat countdown — fires once/sec, wraps to 150 when it hits 0
  useEffect(() => {
    const t = setInterval(() => {
      setHeartbeatSec(s => s <= 0 ? 150 : s - 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // First-time onboarding trigger (one-shot, localStorage gated)
  useEffect(() => {
    try {
      const seen = localStorage.getItem('ss_pulse_onboard_seen_v1');
      if (!seen) setShowOnboard(true);
    } catch {}
  }, []);
  const dismissOnboard = () => {
    setShowOnboard(false);
    try { localStorage.setItem('ss_pulse_onboard_seen_v1', '1'); } catch {}
  };

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
  // v1.11.6: animated versions for smooth UX (tween 600ms on change)
  const animatedDispHash = useAnimatedNumber(dispHash);
  const animatedDispWorkers = useAnimatedNumber(dispWorkers);
  const animatedDispCount = useAnimatedNumber(dispCount);
  // v1.11.6: ATH + cumulative strikes from server-tracked persistent state
  const peakHr = ns.peakHashrate || 0;
  const peakTs = ns.peakHashrateTs || 0;
  const totalStrikes = ns.totalStrikesEver || 0;
  // Small inline helper for ATH timestamp ("Peak X · 3d ago")
  const fmtRelativeTime = (ts) => {
    if (!ts) return '';
    const diff = Math.max(0, Date.now() - ts);
    const s = Math.floor(diff / 1000);
    if (s < 60) return 'now';
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  };

  // ── v1.11.6: pop-pop animation trigger on Strikers count change ───────
  // When dispCount increments (peer joined) or decrements (peer left), we
  // briefly add a class to the Strikers number that scales + flashes it.
  // Different from the smooth tween — this is a discrete "something just
  // happened" pulse, not a value transition.
  const [strikersPulseKey, setStrikersPulseKey] = useState(0);
  const prevDispCountRef = useRef(dispCount);
  useEffect(() => {
    if (dispCount !== prevDispCountRef.current) {
      prevDispCountRef.current = dispCount;
      setStrikersPulseKey(k => k + 1); // re-mount the element via key to retrigger CSS animation
    }
  }, [dispCount]);

  // ── v1.11.6: strike celebration banner ────────────────────────────────
  // When totalStrikes increments (any peer found a block), show a
  // celebration banner that animates in for ~6 seconds, then fades.
  const [strikeBannerShown, setStrikeBannerShown] = useState(false);
  const prevStrikesRef = useRef(totalStrikes);
  useEffect(() => {
    if (totalStrikes > prevStrikesRef.current) {
      prevStrikesRef.current = totalStrikes;
      setStrikeBannerShown(true);
      const t = setTimeout(() => setStrikeBannerShown(false), 6000);
      return () => clearTimeout(t);
    }
    prevStrikesRef.current = totalStrikes;
  }, [totalStrikes]);

  // ── v1.11.6: badge unlock animation tracking ──────────────────────────
  // Track previously-seen badge set for YOUR row. When the set grows,
  // mark the newly-earned badges so they render with a pop-in animation.
  // Use localStorage to persist across reloads (so badges don't re-animate
  // every tab open).
  const [newlyEarnedBadges, setNewlyEarnedBadges] = useState(new Set());

  // v1.11.x: rank by hashrate descending. Used for #1/#2/#3 badges + LAVA
  // distribution bar coloring. Strikers with hashrate=0 sort to bottom.
  const ranked = [...shownPeers].sort((a, b) => (b.hashrate || 0) - (a.hashrate || 0));
  const rankByPubkey = new Map();
  ranked.forEach((p, i) => rankByPubkey.set(p.pubkey, i));

  // ── v1.11.6: detect newly-earned badges for YOUR row ──────────────────
  // We can only compute badges once `ranked` exists (deriveBadges needs it).
  // Compare against previously-seen set from localStorage; flag the diff
  // as "newly earned" for animation, then update localStorage.
  useEffect(() => {
    if (!ownPeer) return;
    let prevSeen = [];
    try {
      const raw = localStorage.getItem('ss_badges_seen_v1');
      if (raw) prevSeen = JSON.parse(raw);
    } catch {}
    const currentBadges = deriveBadges(ownPeer, ranked);
    const newOnes = currentBadges.filter(b => !prevSeen.includes(b));
    if (newOnes.length > 0) {
      setNewlyEarnedBadges(new Set(newOnes));
      try {
        localStorage.setItem('ss_badges_seen_v1', JSON.stringify(currentBadges));
      } catch {}
      // Clear the animation flag after animation completes (~1s)
      const t = setTimeout(() => setNewlyEarnedBadges(new Set()), 1500);
      return () => clearTimeout(t);
    } else if (prevSeen.length !== currentBadges.length) {
      // No new badges earned, but length differs (e.g., lost a badge) — sync state
      try {
        localStorage.setItem('ss_badges_seen_v1', JSON.stringify(currentBadges));
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownPeer?.hashrate, ownPeer?.firstSeen, ownPeer?.loc, ownPeer?.workers, ranked.length]);

  // v1.12.x: hashrate trend — compare current network hashrate to ~1h ago.
  // networkStats.hashrateHistory is a rolling buffer of {ts, hr, peers} samples
  // (max 60, ~1 per minute). Pick the oldest sample with at least 30 min lag
  // for a stable trend signal; if buffer is too short, no trend shown.
  //
  // v1.11.5: trust the math. Big swings ARE the signal — a peer joining
  // with substantial hashrate is real network growth. A peer leaving is
  // real network shrinkage. Rental hashrate spikes are real changes.
  // Hiding any of these would suppress the most interesting trends.
  // The only legitimate filters: insufficient history, sub-3% noise,
  // and non-finite math.
  const computeTrend = () => {
    const hist = Array.isArray(ns.hashrateHistory) ? ns.hashrateHistory : [];
    if (hist.length < 10) return null;  // need at least ~10 min of history
    const now = Date.now();
    const targetAgo = now - 60 * 60 * 1000; // 1h ago
    // Pick sample closest to (but not after) targetAgo
    let old = hist[0];
    for (const s of hist) {
      if (s.ts <= targetAgo) old = s;
      else break;
    }
    // Require at least 30 min of separation for meaningful trend
    if (now - old.ts < 30 * 60 * 1000) return null;
    if (!old.hr || old.hr <= 0) return null;
    const pct = ((dispHash - old.hr) / old.hr) * 100;
    if (!Number.isFinite(pct)) return null;
    // Don't show micro-changes (<3%) — they're noise
    if (Math.abs(pct) < 3) return null;
    return Math.round(pct);
  };
  const trendPct = computeTrend();

  // v1.12.x LAVA palette — bright yellow → orange → red → deep brick.
  // Top hashrate gets the hottest color, descending by rank.
  const LAVA_STOPS = [
    '#FFD700', // bright gold (rank #1)
    '#FFA500', // pure orange
    '#FF8C1A', // amber-orange
    '#FF6B1A', // hot orange
    '#FF4500', // orange-red
    '#E63946', // crimson
    '#B83228', // brick red
    '#8B2222', // deep dark red (rank last+)
  ];
  const lavaColor = (rank) => LAVA_STOPS[Math.min(rank, LAVA_STOPS.length - 1)];

  // v1.12.x: convert peer.loc ([lat, lon] on 5° grid) → flag emoji + region label.
  // Coverage is approximate but good enough for "wow, global network" feel.
  // Returns null if loc is missing or invalid.
  const flagFromLoc = (loc) => {
    if (!Array.isArray(loc) || loc.length !== 2) return null;
    const [lat, lon] = loc;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // Continental buckets — coarse, since loc grid is 5° (~500km cells).
    if (lat >= 25 && lat <= 50 && lon >= -125 && lon <= -65) return { flag: '🇺🇸', label: 'US' };
    if (lat >= 45 && lat <= 70 && lon >= -140 && lon <= -55) return { flag: '🇨🇦', label: 'CA' };
    if (lat >= -35 && lat <= 15 && lon >= -85 && lon <= -35)  return { flag: '🇧🇷', label: 'SA' };
    if (lat >= 35 && lat <= 70 && lon >= -10 && lon <= 30)    return { flag: '🇪🇺', label: 'EU' };
    if (lat >= 50 && lat <= 60 && lon >= -10 && lon <= 5)     return { flag: '🇬🇧', label: 'UK' };
    if (lat >= 30 && lat <= 50 && lon >= 125 && lon <= 150)   return { flag: '🇯🇵', label: 'JP' };
    if (lat >= 15 && lat <= 55 && lon >= 70 && lon <= 135)    return { flag: '🌏', label: 'Asia' };
    if (lat >= -45 && lat <= -10 && lon >= 110 && lon <= 180) return { flag: '🇦🇺', label: 'AU' };
    if (lat >= -35 && lat <= 35 && lon >= -20 && lon <= 50)   return { flag: '🌍', label: 'AF' };
    return { flag: '🌐', label: '' };
  };

  const fmtAgo = (sec) => {
    if (!sec || sec < 60) return 'now';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    return Math.floor(sec / 3600) + 'h ago';
  };

  // v1.11.2: derive badges from already-broadcast peer data — no new
  // protocol fields needed. Returns array of badge IDs.
  //   🥇 OG          → joined > 90 days ago
  //   ⚡ WHALE       → top 10% of network hashrate (or top 1 if ≤10 peers)
  //   🌍 GLOBETROTTER → has a loc pin, AND not in the common US/EU buckets
  //   🆕 NEW         → joined < 7 days ago
  //   💀 GHOST       → has hashrate but 0 workers broadcast (privacy mode)
  const BADGE_META = {
    OG:           { emoji: '🥇', label: 'OG Striker',     desc: 'Broadcasting > 90 days' },
    WHALE:        { emoji: '⚡', label: 'Whale',           desc: 'Top 10% network hashrate' },
    GLOBETROTTER: { emoji: '🌍', label: 'Globetrotter',   desc: 'Outside common regions' },
    NEW:          { emoji: '🆕', label: 'New Striker',    desc: 'Joined < 7 days ago' },
    GHOST:        { emoji: '💀', label: 'Ghost',          desc: 'Hashrate without worker count' },
  };

  const deriveBadges = (p, allPeersSorted) => {
    const badges = [];
    const now = Date.now() / 1000;
    const ageDays = p.firstSeen ? (now - p.firstSeen) / 86400 : 0;
    if (ageDays >= 90) badges.push('OG');
    if (ageDays < 7 && ageDays >= 0) badges.push('NEW');
    // Whale: top 10% of peers by hashrate (or rank 1 if very few peers)
    const myRank = allPeersSorted.findIndex(x => x.pubkey === p.pubkey);
    const whaleCutoff = Math.max(1, Math.floor(allPeersSorted.length * 0.1));
    if (myRank >= 0 && myRank < whaleCutoff && p.hashrate > 0) badges.push('WHALE');
    // Globetrotter: has loc, but NOT in the dense US/EU buckets
    if (Array.isArray(p.loc) && p.loc.length === 2) {
      const [lat, lon] = p.loc;
      const isCommon = (lat >= 25 && lat <= 50 && lon >= -125 && lon <= -65)  // US
                   || (lat >= 35 && lat <= 70 && lon >= -10 && lon <= 30);    // EU
      if (!isCommon) badges.push('GLOBETROTTER');
    }
    // Ghost: hashrate > 0 but workers === 0 (deliberately privacy-broadcasting)
    if (p.hashrate > 0 && (p.workers === 0 || p.workers == null)) badges.push('GHOST');
    return badges;
  };

  // v1.12.x: "Joined Nd ago" formatter. Takes unix seconds, returns short
  // label. Hides if <1 day (just shows 'new') or older than 999d (caps).
  const fmtJoined = (firstSeenSec) => {
    if (!Number.isFinite(firstSeenSec) || firstSeenSec <= 0) return null;
    const ageDays = (Date.now() / 1000 - firstSeenSec) / 86400;
    if (ageDays < 1) return 'new';
    return `${Math.min(999, Math.floor(ageDays))}d`;
  };

  // v1.12.x: aggregate Recent Strikes from all peers' lastStrike fields.
  // Each peer broadcasts their most recent block found (if any). We dedupe
  // by height, sort newest first, and show top 3-5. Also assign the row to
  // a striker label (its rank index) so it matches the roster display.
  const recentStrikes = (() => {
    const strikes = [];
    for (const p of shownPeers) {
      if (!p.lastStrike || !Number.isFinite(p.lastStrike.height)) continue;
      strikes.push({
        height: p.lastStrike.height,
        ts: p.lastStrike.ts,
        isOwn: !!p.isOwn,
        // v1.11.2: anonymize block-finder label. The pubkey is on the wire
        // (Nostr signs every event) but the UI no longer reveals which Striker
        // found the block. Maintains the "celebrate together but stay private"
        // ethos. YOU stays as YOU since you already know it's you.
        label: p.isOwn ? 'YOU' : '⛏ A STRIKER',
        pubkey: p.pubkey,
      });
    }
    // Dedupe by height (one Striker per block — first wins, that's the legit finder)
    const byHeight = new Map();
    for (const s of strikes) {
      if (!byHeight.has(s.height)) byHeight.set(s.height, s);
    }
    return [...byHeight.values()]
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 5);
  })();

  const fmtStrikeAgo = (ts) => {
    if (!Number.isFinite(ts)) return '';
    const secs = Math.floor(Date.now() / 1000 - ts);
    if (secs < 60) return 'just now';
    if (secs < 3600) return Math.floor(secs / 60) + 'm ago';
    if (secs < 86400) return Math.floor(secs / 3600) + 'h ago';
    const days = Math.floor(secs / 86400);
    return days + 'd ago';
  };

  const section = { marginBottom:'1rem' };
  const secTitle = { fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--amber)', marginBottom:'0.5rem' };
  const heroBox = { background:'var(--bg-raised)', border:'1px solid var(--border)', padding:'0.7rem', textAlign:'center' };
  const heroLbl = { fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:4 };
  const heroVal = { fontFamily:'var(--fd)', fontSize:'1.1rem', fontWeight:700, lineHeight:1, color:'var(--amber)' };

  // v1.11.x: LAVA hashrate distribution bar. Renders only when ≥3 Strikers
  // (with 1-2 it's just a "domination meter" without much info value).
  // Each segment colored by LAVA gradient — brightest gold = top hashrate,
  // descending through orange/red/brick to the smallest contributor.
  const DistributionBar = () => {
    if (ranked.length < 3 || dispHash <= 0) return null;
    return (
      <div style={section}>
        <div style={secTitle}>▸ Hashrate Distribution</div>
        <div style={{
          display:'flex', height:12, borderRadius:4, overflow:'hidden',
          background:'rgba(20,20,22,0.6)',
          border:'1px solid rgba(245,166,35,0.18)',
          boxShadow:'0 0 12px rgba(245,100,25,0.15)',
        }}>
          {ranked.map((p, i) => {
            const color = lavaColor(i);
            return (
              <div key={p.pubkey} style={{
                width: `${((p.hashrate || 0) / dispHash) * 100}%`,
                background: color,
                borderRight: i < ranked.length - 1 ? '1px solid rgba(8,8,10,0.5)' : 'none',
                boxShadow: `inset 0 -2px 4px ${color}aa, inset 0 1px 2px rgba(255,255,255,0.15)`,
              }}/>
            );
          })}
        </div>
        <div style={{
          display:'flex', flexWrap:'wrap', gap:'0.4rem 0.7rem', marginTop:8,
          fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-2)',
        }}>
          {ranked.map((p, i) => {
            const color = lavaColor(i);
            const pct = ((p.hashrate || 0) / dispHash) * 100;
            const label = p.isOwn ? 'YOU' : `#${String(i + 1).padStart(2, '0')}`;
            return (
              <div key={p.pubkey} style={{display:'flex', alignItems:'center', gap:4}}>
                <span style={{
                  width:9, height:9, background:color, borderRadius:2, display:'inline-block',
                  boxShadow:`0 0 4px ${color}88`,
                }}/>
                <span>{label} {pct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // v1.12.x: Recent Strikes ticker — shows recent blocks found by network peers
  // (and yourself). Each row shows the Striker label + block height + "Xd ago".
  // Renders only when at least one strike is known.
  const RecentStrikesTicker = () => {
    if (recentStrikes.length === 0) return null;
    return (
      <div style={section}>
        <div style={secTitle}>▸ Recent Strikes</div>
        {recentStrikes.map(s => (
          <div key={s.pubkey + '-' + s.height} style={{
            display:'flex', justifyContent:'space-between', alignItems:'center',
            padding:'0.5rem 0.7rem',
            background:'var(--bg-raised)',
            border:'1px solid var(--border)',
            marginBottom:'0.35rem',
          }}>
            <div style={{display:'flex', alignItems:'center', gap:8, fontFamily:'var(--fm)', fontSize:'0.72rem', minWidth:0}}>
              <span style={{color:'var(--amber)', fontWeight:700, flexShrink:0}}>⛏</span>
              <span style={{
                color: s.isOwn ? 'var(--amber)' : 'var(--text-1)',
                fontWeight: s.isOwn ? 700 : 500,
                fontFamily:'var(--fd)', letterSpacing:'0.06em',
              }}>{s.label}</span>
              <span style={{color:'var(--text-3)'}}>·</span>
              <span style={{color:'var(--text-2)'}}>#{s.height.toLocaleString()}</span>
            </div>
            <span style={{fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-2)', flexShrink:0}}>
              {fmtStrikeAgo(s.ts)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  // Single row component — v1.11.x: rank badge, geo flag, % of network,
  // LAVA color stripe on left edge (when ≥3 Strikers so it matches the bar).
  // v1.12.x: Joined Nd ago badge.
  // v1.11.2: earned badges (🥇⚡🌍🆕💀), tappable for drill-down.
  const Row = ({ p, idx }) => {
    const isOwn = !!p.isOwn;
    const rank = rankByPubkey.get(p.pubkey) ?? idx;
    const pct = dispHash > 0 ? (p.hashrate / dispHash) * 100 : 0;
    const geo = flagFromLoc(p.loc);
    const joined = fmtJoined(p.firstSeen);
    const showStripe = ranked.length >= 3;
    const stripeColor = showStripe ? lavaColor(rank) : null;
    const badges = deriveBadges(p, ranked);
    return (
      <div
        onClick={() => setDrillPeer(p)}
        style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding: isOwn ? '0.7rem 0.8rem' : '0.6rem 0.8rem',
        background: isOwn ? 'rgba(245,166,35,0.08)' : 'var(--bg-raised)',
        border: isOwn ? '1px solid var(--amber)' : '1px solid var(--border)',
        boxShadow: isOwn ? '0 0 12px rgba(245,166,35,0.2)' : 'none',
        marginBottom: isOwn ? '0.5rem' : '0.35rem',
        opacity: p.filtered && !isOwn ? 0.55 : 1,
        position:'relative',
        overflow:'hidden',
        cursor:'pointer',
        transition:'transform 0.08s ease',
      }}
      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.99)'}
      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
      onTouchStart={e => e.currentTarget.style.transform = 'scale(0.99)'}
      onTouchEnd={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {stripeColor && (
          <div style={{
            position:'absolute', left:0, top:0, bottom:0,
            width:4, background:stripeColor,
            boxShadow:`0 0 8px ${stripeColor}66`,
          }}/>
        )}
        <div style={{display:'flex', flexDirection:'column', gap:3, minWidth:0, flex:'1 1 auto', marginLeft: stripeColor ? 6 : 0}}>
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
            {geo && (
              <span style={{fontSize:'0.85rem', lineHeight:1}} title={geo.label}>{geo.flag}</span>
            )}
            {ranked.length >= 2 && (
              <span style={{
                fontFamily:'var(--fd)', fontSize:'0.55rem', color:'rgba(245,166,35,0.65)',
                background:'rgba(245,166,35,0.1)', border:'1px solid rgba(245,166,35,0.2)',
                padding:'1px 6px', letterSpacing:'0.06em', borderRadius:2,
              }}>
                #{rank + 1}
              </span>
            )}
            {/* v1.11.2: badges */}
            {/* v1.11.6: newly-earned badges (YOUR row only) get a pop-in animation */}
            {badges.map(b => (
              <span
                key={b}
                title={`${BADGE_META[b].label} — ${BADGE_META[b].desc}`}
                className={isOwn && newlyEarnedBadges.has(b) ? 'ss-badge-unlock' : ''}
                style={{
                  fontSize:'0.7rem', lineHeight:1,
                  background:'rgba(245,166,35,0.08)',
                  border:'1px solid rgba(245,166,35,0.2)',
                  borderRadius:2, padding:'1px 4px',
                  display: 'inline-block',
                }}
              >
                {BADGE_META[b].emoji}
              </span>
            ))}
            {p.filtered && !isOwn && (
              <span style={{fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--text-2)', letterSpacing:'0.12em', background:'rgba(255,255,255,0.05)', border:'1px solid var(--border)', padding:'1px 6px'}}>FILTERED</span>
            )}
          </div>
          <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-2)'}}>
            {p.workers} worker{p.workers===1?'':'s'} · v{p.version || '?'}
            {joined && (<> · <span title="Joined">{joined}</span></>)}
            {dispHash > 0 && ranked.length >= 2 && (
              <> · <span style={{color:'rgba(245,166,35,0.65)'}}>{pct.toFixed(1)}% of network</span></>
            )}
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
            {/* v1.11.2: help icon → opens onboarding */}
            <button
              onClick={() => setShowOnboard(true)}
              aria-label="What is Pulse?"
              style={{
                background:'none', border:'1px solid var(--border)',
                color:'var(--text-2)', cursor:'pointer',
                width:18, height:18, borderRadius:'50%',
                display:'inline-flex', alignItems:'center', justifyContent:'center',
                fontSize:'0.7rem', fontFamily:'var(--fd)',
                padding:0, lineHeight:1,
              }}
            >?</button>
          </div>
          <div style={{display:'flex', alignItems:'center', gap:8}}>
            {/* v1.11.2: heartbeat indicator — visual proof of broadcasting */}
            <div style={{
              display:'inline-flex', alignItems:'center', gap:4,
              fontFamily:'var(--fm)', fontSize:'0.55rem', color:'var(--text-2)',
              padding:'2px 6px', background:'var(--bg-raised)',
              border:'1px solid var(--border)', borderRadius:2,
              letterSpacing:'0.08em',
            }}>
              <span style={{
                width:6, height:6, borderRadius:'50%',
                background: heartbeatSec < 3 ? 'var(--green)' : 'var(--amber)',
                boxShadow: heartbeatSec < 3 ? '0 0 8px var(--green)' : '0 0 4px var(--amber)',
                transition:'all 0.3s',
              }}/>
              <span>{heartbeatSec < 3 ? 'BROADCASTING' : `BEAT ${heartbeatSec}s`}</span>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:22,padding:'0 4px'}}>✕</button>
          </div>
        </div>

        <div style={{padding:'1rem 1.25rem 4.5rem 1.25rem'}}>

          {/* v1.11.6: strike celebration banner — fires when totalStrikes
              increments (any peer found a block). Shows for ~6s then fades. */}
          {strikeBannerShown && (
            <div className="ss-strike-celebrate" style={{
              background: 'linear-gradient(90deg, #FF6B1A, #FFD700)',
              color: '#000',
              fontFamily: 'var(--fd)',
              fontWeight: 700,
              fontSize: '0.85rem',
              textAlign: 'center',
              padding: '12px 16px',
              borderRadius: 4,
              marginBottom: 14,
              letterSpacing: '0.1em',
              boxShadow: '0 0 24px rgba(255, 140, 26, 0.6)',
            }}>
              ⛏ STRIKE! · NETWORK FOUND A BLOCK
            </div>
          )}

          <div style={section}>
            <div style={secTitle}>▸ Network Snapshot</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'0.5rem'}}>
              <div style={heroBox}>
                <div style={heroLbl}>Strikers</div>
                <div key={strikersPulseKey} className="ss-pop-pop" style={heroVal}>
                  {Math.round(animatedDispCount)}
                </div>
              </div>
              <div style={heroBox}>
                <div style={heroLbl}>Hashrate</div>
                <div style={{...heroVal, fontSize:'0.95rem', display:'flex', alignItems:'center', justifyContent:'center', gap:4}}>
                  <span>{fmtPulseHr(animatedDispHash)}</span>
                  {trendPct !== null && (
                    <span style={{
                      fontFamily:'var(--fm)', fontSize:'0.55rem', fontWeight:600,
                      color: trendPct > 0 ? 'var(--green)' : '#FF6B6B',
                    }}>
                      {trendPct > 0 ? '↑' : '↓'}{Math.abs(trendPct)}%
                    </span>
                  )}
                </div>
              </div>
              <div style={heroBox}><div style={heroLbl}>Miners</div><div style={heroVal}>{Math.round(animatedDispWorkers)}</div></div>
            </div>
            {/* v1.11.6: network ATH + total strikes (small text below hero grid) */}
            {(peakHr > 0 || totalStrikes > 0) && (
              <div style={{
                marginTop:8, display:'flex', justifyContent:'space-between',
                fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-2)',
              }}>
                {peakHr > 0 && (
                  <span>◇ Peak {fmtPulseHr(peakHr)}{peakTs > 0 ? ` · ${fmtRelativeTime(peakTs)}` : ''}</span>
                )}
                {totalStrikes > 0 && (
                  <span style={{color:'var(--green)'}}>⛏ {totalStrikes} {totalStrikes === 1 ? 'strike' : 'strikes'}</span>
                )}
              </div>
            )}
          </div>

          <DistributionBar/>

          {/* v1.11.2: personal hashrate goal tracker */}
          {/* v1.11.6: convert ownPeer.hashrate from raw H/s to TH/s (peer
              hashrates are canonical H/s; user enters goal in TH/s). */}
          {ownPeer && (() => {
            const yourHr = (ownPeer.hashrate || 0) / 1e12;
            const goal = hashGoal || 0;
            return (
              <div style={section}>
                <div style={{...secTitle, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                  <span>▸ Personal Goal {goal > 0 && <>· {goal} TH/s</>}</span>
                  <input
                    type="number"
                    min="0"
                    step="10"
                    placeholder="Goal (TH/s)"
                    value={hashGoal || ''}
                    onChange={e => setHashGoal(parseFloat(e.target.value) || 0)}
                    style={{
                      background:'var(--bg-raised)',
                      border:'1px solid var(--border)',
                      color:'var(--amber)',
                      fontFamily:'var(--fm)', fontSize:'0.65rem',
                      padding:'2px 6px', width:90, textAlign:'right',
                      borderRadius:2,
                    }}
                  />
                </div>
                {goal > 0 && (
                  <>
                    <div style={{
                      height:8, background:'var(--bg-raised)',
                      border:'1px solid var(--border)', borderRadius:3,
                      overflow:'hidden', marginBottom:6,
                    }}>
                      <div style={{
                        width:`${Math.min(100, (yourHr / goal) * 100)}%`,
                        height:'100%',
                        background:'linear-gradient(90deg, #FF6B1A, #FFD700)',
                        boxShadow:'0 0 8px #FF8C1A88',
                        transition:'width 0.5s ease',
                      }}/>
                    </div>
                    <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)'}}>
                      {yourHr >= goal
                        ? <span style={{color:'var(--green)'}}>✓ Goal reached! You're at {yourHr.toFixed(1)} TH/s ({((yourHr/goal)*100).toFixed(0)}% of goal).</span>
                        : <>+{(goal - yourHr).toFixed(1)} TH/s to go · {((yourHr/goal)*100).toFixed(0)}% there</>
                      }
                    </div>
                  </>
                )}
                {!goal && (
                  <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)'}}>
                    Set a target hashrate to track your progress.
                  </div>
                )}
              </div>
            );
          })()}

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
              <div style={{
                textAlign:'center', padding:'1.5rem 0.5rem',
                background:'var(--bg-raised)',
                border:'1px dashed rgba(245,166,35,0.18)',
                marginBottom:'0.35rem',
              }}>
                <div style={{
                  fontFamily:'var(--fd)', fontSize:'0.7rem', color:'var(--amber)',
                  letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:6,
                }}>
                  Scanning for peers
                </div>
                <div style={{
                  fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-2)',
                  lineHeight:1.5,
                }}>
                  Your pulse broadcasts every 2.5 min over nostr.<br/>
                  Other Strikers will appear here as they come online.
                </div>
              </div>
            )}

            {shownPeers.length === 1 && shownPeers[0].isOwn && (
              <>
                <Row p={shownPeers[0]} idx={0}/>
                <div style={{
                  textAlign:'center', padding:'1rem 0.5rem',
                  background:'var(--bg-raised)',
                  border:'1px dashed rgba(245,166,35,0.18)',
                  marginTop:'0.35rem',
                }}>
                  <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-2)', lineHeight:1.5}}>
                    You're broadcasting solo. Other Strikers will appear here as they come online.
                  </div>
                </div>
              </>
            )}

            {!(shownPeers.length === 1 && shownPeers[0].isOwn) && shownPeers.map((p, i) => (
              <Row key={p.pubkey} p={p} idx={i}/>
            ))}

          </div>

          <RecentStrikesTicker/>

          <div style={{
            borderTop:'1px dashed rgba(245,166,35,0.18)',
            paddingTop:'0.7rem',
            fontFamily:'var(--fm)', fontSize:'0.75rem', color:'var(--text-1)',
            lineHeight:1.5,
            paddingRight:'5rem',
          }}>
            Pulse is a census, not a pool. <span style={{color:'var(--amber)', fontWeight:600}}>Your blocks stay 100% yours.</span>
            <div style={{marginTop:8, fontSize:'0.68rem', color:'var(--text-2)', lineHeight:1.5}}>
              Strikers are anonymous SoloStrike operators broadcasting hashrate via nostr. No names, no IPs, no pool affiliation. Identities rotate periodically.
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
            willChange:'opacity',
          }}>
            <div>100%</div>
            <div>SOLO</div>
          </div>

        </div>
      </div>

      {/* v1.11.2: ONBOARDING MODAL — first-time + ? button trigger */}
      {showOnboard && (
        <div
          onClick={dismissOnboard}
          style={{
            position:'fixed', inset:0, background:'rgba(0,0,0,0.85)',
            display:'flex', alignItems:'center', justifyContent:'center',
            zIndex:260, padding:'1rem',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background:'var(--bg-surface)', border:'1px solid var(--border-hot)',
              maxWidth:380, padding:'1.5rem', borderRadius:6,
              boxShadow:'0 0 40px rgba(245,166,35,0.2)',
            }}
          >
            <div style={{
              color:'var(--amber)', fontFamily:'var(--fd)', fontSize:'1.05rem',
              fontWeight:700, letterSpacing:'0.08em', marginBottom:'0.75rem',
            }}>
              WHAT IS PULSE?
            </div>
            <p style={{color:'var(--text-1)', fontFamily:'var(--fm)', fontSize:'0.75rem', lineHeight:1.6, margin:'0 0 0.75rem 0'}}>
              Pulse is an <strong style={{color:'var(--amber)'}}>anonymous census</strong> of solo Bitcoin miners running SoloStrike. Hashrate is broadcast over <strong style={{color:'var(--amber)'}}>nostr</strong> — no names, no IPs, no pool affiliation.
            </p>
            <p style={{color:'var(--text-2)', fontFamily:'var(--fm)', fontSize:'0.7rem', lineHeight:1.6, margin:'0 0 1rem 0'}}>
              You see who else is broadcasting, roughly where they are, and how the network grows. <strong style={{color:'var(--text-1)'}}>Your blocks always stay 100% yours.</strong> Tap any Striker for details.
            </p>
            <button
              onClick={dismissOnboard}
              style={{
                width:'100%', padding:'0.6rem',
                background:'var(--amber)', color:'#000',
                border:'none', borderRadius:3,
                fontFamily:'var(--fd)', fontSize:'0.7rem', letterSpacing:'0.15em',
                cursor:'pointer', fontWeight:700,
              }}
            >GOT IT</button>
          </div>
        </div>
      )}

      {/* v1.11.2: DRILL-DOWN SHEET — tap any Striker row to expand */}
      {drillPeer && (() => {
        const p = drillPeer;
        const isOwn = !!p.isOwn;
        const rank = rankByPubkey.get(p.pubkey) ?? 0;
        const pct = dispHash > 0 ? (p.hashrate / dispHash) * 100 : 0;
        const geo = flagFromLoc(p.loc);
        const joined = fmtJoined(p.firstSeen);
        const badges = deriveBadges(p, ranked);
        return (
          <div
            onClick={() => setDrillPeer(null)}
            style={{
              position:'fixed', inset:0, background:'rgba(0,0,0,0.7)',
              display:'flex', alignItems:'flex-end', justifyContent:'center',
              zIndex:260, padding:'1rem',
            }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{
                width:'100%', maxWidth:480,
                background:'var(--bg-surface)', border:'1px solid var(--border-hot)',
                borderRadius:'8px 8px 0 0', padding:'1.25rem',
                maxHeight:'80dvh', overflowY:'auto',
              }}
            >
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1rem'}}>
                <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                  <span style={{
                    color:isOwn ? 'var(--amber)' : 'var(--text-1)',
                    fontFamily:'var(--fd)', fontSize:'1rem',
                    fontWeight:700, letterSpacing:'0.08em',
                  }}>
                    {isOwn ? 'YOU' : `STRIKER ${String(rank + 1).padStart(2, '0')}`}
                  </span>
                  {geo && <span style={{fontSize:'1.1rem'}}>{geo.flag}</span>}
                  <span style={{
                    color:'rgba(245,166,35,0.65)', fontSize:'0.6rem', fontFamily:'var(--fd)',
                    background:'rgba(245,166,35,0.1)', border:'1px solid rgba(245,166,35,0.2)',
                    padding:'2px 8px', borderRadius:2, letterSpacing:'0.08em',
                  }}>RANK #{rank + 1}</span>
                </div>
                <button
                  onClick={() => setDrillPeer(null)}
                  style={{background:'none', border:'none', color:'var(--text-2)', fontSize:22, cursor:'pointer', padding:'0 4px'}}
                >✕</button>
              </div>

              {/* hashrate hero */}
              <div style={{
                textAlign:'center', padding:'0.75rem', marginBottom:'1rem',
                background:'var(--bg-raised)', border:'1px solid var(--border)',
              }}>
                <div style={{
                  fontFamily:'var(--fd)', fontSize:'1.6rem', fontWeight:700,
                  color:'var(--amber)', lineHeight:1,
                }}>{fmtPulseHr(p.hashrate)}</div>
                {dispHash > 0 && (
                  <div style={{fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-2)', marginTop:4}}>
                    {pct.toFixed(1)}% of network
                  </div>
                )}
              </div>

              {/* stat grid */}
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:'1rem'}}>
                <div style={{padding:'0.5rem 0.65rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
                  <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', color:'var(--text-2)', letterSpacing:'0.15em', marginBottom:3}}>WORKERS</div>
                  <div style={{fontFamily:'var(--fd)', fontSize:'0.9rem', fontWeight:700, color:'var(--amber)'}}>{p.workers || 0}</div>
                </div>
                <div style={{padding:'0.5rem 0.65rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
                  <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', color:'var(--text-2)', letterSpacing:'0.15em', marginBottom:3}}>VERSION</div>
                  <div style={{fontFamily:'var(--fd)', fontSize:'0.9rem', fontWeight:700, color:'var(--amber)'}}>v{p.version || '?'}</div>
                </div>
                <div style={{padding:'0.5rem 0.65rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
                  <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', color:'var(--text-2)', letterSpacing:'0.15em', marginBottom:3}}>JOINED</div>
                  <div style={{fontFamily:'var(--fd)', fontSize:'0.9rem', fontWeight:700, color:'var(--amber)'}}>{joined || '—'}</div>
                </div>
                <div style={{padding:'0.5rem 0.65rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
                  <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', color:'var(--text-2)', letterSpacing:'0.15em', marginBottom:3}}>LAST SEEN</div>
                  <div style={{fontFamily:'var(--fd)', fontSize:'0.9rem', fontWeight:700, color:'var(--amber)'}}>{fmtAgo(p.lastSeenAgoSec)}</div>
                </div>
              </div>

              {/* badges expanded */}
              {badges.length > 0 && (
                <div style={{marginBottom:'1rem'}}>
                  <div style={{
                    fontFamily:'var(--fd)', fontSize:'0.55rem', color:'var(--amber)',
                    letterSpacing:'0.2em', marginBottom:8,
                  }}>▸ BADGES</div>
                  {badges.map(b => {
                    const m = BADGE_META[b];
                    return (
                      <div key={b} style={{
                        display:'flex', alignItems:'center', gap:10,
                        padding:'0.5rem 0.65rem',
                        background:'var(--bg-raised)', border:'1px solid var(--border)',
                        marginBottom:4,
                      }}>
                        <span style={{fontSize:'1.2rem'}}>{m.emoji}</span>
                        <div style={{flex:1, minWidth:0}}>
                          <div style={{fontFamily:'var(--fd)', fontSize:'0.7rem', fontWeight:600, color:'var(--text-1)', letterSpacing:'0.05em'}}>{m.label}</div>
                          <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-2)'}}>{m.desc}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {badges.length === 0 && (
                <div style={{
                  textAlign:'center', padding:'0.75rem',
                  background:'var(--bg-raised)', border:'1px dashed var(--border)',
                  fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--text-2)',
                  marginBottom:'1rem',
                }}>
                  No badges yet. Broadcast longer to earn 🥇 OG status.
                </div>
              )}
            </div>
          </div>
        );
      })()}
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
    // iter28: avoid scientific notation — show plain decimals with auto-scaled
    // precision so very small percentages stay readable at a glance.
    if (v < 0.0001) {
      const decimals = Math.min(10, Math.max(4, -Math.floor(Math.log10(v)) + 1));
      return v.toFixed(decimals) + '%';
    }
    if (v < 0.01) return v.toFixed(4) + '%';
    return v.toFixed(digits) + '%';
  };
  // iter28: helper to format probabilities as "1 in N" lottery-style.
  // Used for Strike Odds tiles where the lottery framing is clearer than
  // tiny percentages like "0.0012%".
  const fmtOddsIn = (probability) => {
    if (!isFinite(probability) || probability <= 0) return '—';
    if (probability >= 1) return 'certain';
    const n = 1 / probability;
    if (n >= 1e9) return `1 in ${(n/1e9).toFixed(1)}B`;
    if (n >= 1e6) return `1 in ${(n/1e6).toFixed(1)}M`;
    return `1 in ${Math.round(n).toLocaleString()}`;
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
                <div style={secTitle}>▸ Short-Term Strike Odds</div>
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'0.55rem'}}>
                  <div style={heroBox}>
                    <div style={heroLbl}>This Day</div>
                    <div style={{...heroVal, fontSize: probDay >= 0.01 ? '1.05rem' : '0.9rem'}}>{fmtOddsIn(probDay)}</div>
                  </div>
                  <div style={heroBox}>
                    <div style={heroLbl}>This Week</div>
                    <div style={{...heroVal, fontSize: probWeek >= 0.01 ? '1.05rem' : '0.9rem'}}>{fmtOddsIn(probWeek)}</div>
                  </div>
                  <div style={heroBox}>
                    <div style={heroLbl}>This Month</div>
                    <div style={{...heroVal, fontSize: probMonth >= 0.01 ? '1.05rem' : '0.9rem'}}>{fmtOddsIn(probMonth)}</div>
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
                        {basePoolSharePct >= 0.0001
                          ? basePoolSharePct.toFixed(6) + '%'
                          : basePoolSharePct.toFixed(Math.min(10, Math.max(4, -Math.floor(Math.log10(basePoolSharePct)) + 1))) + '%'}
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
  // v1.10.1 SECURITY: opt-in toggle for sending webhooks to private/LAN URLs.
  // Default OFF — server rejects private-IP URLs unless this flag is set.
  // Users targeting Home Assistant on 192.168.x.y or self-hosted ntfy.sh on
  // their local network must enable this explicitly.
  const [allowInternal, setAllowInternal] = useState(false);
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
        body: JSON.stringify({op:'add', name: name||'Webhook', url, events: evList, allowInternal}),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      setName(''); setUrl(''); setAllowInternal(false); load();
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
      {/* v1.10.1 SECURITY: opt-in toggle for sending to private/LAN URLs.
          Default OFF protects against SSRF (server-side request forgery)
          attacks where a webhook would otherwise be used to probe internal
          services. Users targeting their own self-hosted services on the
          LAN can enable it explicitly. */}
      <div style={{padding:'0.55rem 0.6rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:14, borderRadius:0}}>
        <label style={{display:'flex', alignItems:'flex-start', gap:8, cursor:'pointer'}}>
          <input type="checkbox" checked={allowInternal} onChange={e=>setAllowInternal(e.target.checked)} style={{accentColor:'var(--amber)', marginTop:2, flexShrink:0}}/>
          <div style={{flex:1, minWidth:0}}>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-1)', fontWeight:600, marginBottom:2}}>
              Allow internal/LAN URL
            </div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-2)', lineHeight:1.5}}>
              Required for self-hosted services on your local network — Home Assistant on 192.168.x.x, self-hosted ntfy on a Pi, etc. Leave OFF for public services like Discord, Slack, or hosted ntfy.sh.
              <span style={{color:'var(--amber)', display:'block', marginTop:3}}>
                ⚠ Only enable if you trust the URL. Internal URLs can be abused to probe services on your home network.
              </span>
            </div>
          </div>
        </label>
      </div>
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
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-2)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{h.urlPreview || h.url}</div>
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

// ── Debug settings tab (rev70) ────────────────────────────────────────────────
// Persistent toggle UI for the debug overlay. Settings save to localStorage
// (LS_DEBUG_SETTINGS) the moment they change, so flipping a switch is instant
// across reloads. The "Copy snapshot" button reads from window._ssDebugSnapshot
// — populated by DebugOverlay on every update tick — and serializes it for
// pasting into a chat or bug report.
function DebugTab({ settings, onSettingsChange }) {
  const [copied, setCopied] = useState(false);

  // rev70b: Toggle is always interactive. Two reasons:
  //   1. The "disabled" state from rev70 was visually confusing — looked
  //      like the toggles were broken rather than gated.
  //   2. Users can now pre-configure section visibility while master is off.
  // Bonus: tapping a section ON while master is OFF auto-enables master, so
  // there's no "I tapped Performance and nothing showed up" confusion.
  const Toggle = ({ k, label, helper }) => (
    <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0.7rem 0', borderBottom:'1px solid var(--border)'}}>
      <div style={{flex:1, paddingRight:'0.75rem'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.72rem', color:'var(--text-1)', letterSpacing:'0.04em'}}>{label}</div>
        {helper && <div style={{fontFamily:'var(--fm)', fontSize:'0.62rem', color:'var(--text-3)', marginTop:3, lineHeight:1.4}}>{helper}</div>}
      </div>
      <button
        onClick={() => {
          const newVal = !settings[k];
          const updated = { ...settings, [k]: newVal };
          // Tapping any section ON while the master is OFF flips the master
          // automatically — otherwise the toggle would feel non-responsive
          // (the overlay stays hidden until master is enabled).
          if (k !== 'enabled' && newVal && !settings.enabled) {
            updated.enabled = true;
          }
          onSettingsChange(updated);
        }}
        style={{
          width:40, height:22, borderRadius:11,
          background: settings[k] ? 'var(--cyan)' : 'var(--bg-deep)',
          border:'1px solid var(--border)',
          position:'relative',
          cursor:'pointer',
          flexShrink:0,
        }}
      >
        <div style={{
          position:'absolute', top:1,
          left: settings[k] ? 20 : 2,
          width:18, height:18, borderRadius:'50%',
          background: settings[k] ? '#000' : 'var(--text-2)',
          transition:'left 0.2s',
        }}/>
      </button>
    </div>
  );

  const copySnapshot = async () => {
    try {
      const snap = (typeof window !== 'undefined' && window._ssDebugSnapshot) || {};
      const lines = [
        `# SoloStrike debug snapshot — ${new Date().toISOString()}`,
        `# UA: ${navigator.userAgent}`,
        `# href: ${window.location.href}`,
        '',
        JSON.stringify(snap, null, 2),
      ].join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(lines);
      } else {
        // Fallback for older Safari without clipboard permissions
        const ta = document.createElement('textarea');
        ta.value = lines; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      }
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      alert('Copy failed: ' + e.message);
    }
  };

  const resetDefaults = () => {
    onSettingsChange({ ...DEBUG_DEFAULTS });
  };

  // Download every captured stream + the latest snapshot as a single JSON
  // file. This is more useful than copySnapshot for sharing — error stack
  // traces, console history, and API trace are usually too long to paste
  // legibly into a chat message.
  const downloadLogs = () => {
    try {
      const bundle = {
        meta: {
          ts: new Date().toISOString(),
          ua: navigator.userAgent,
          href: window.location.href,
          appUptimeMs: Date.now() - (_ssDebug.installedAt || Date.now()),
        },
        snapshot: (typeof window !== 'undefined' && window._ssDebugSnapshot) || {},
        streams: {
          errors:      _ssDebug.errors,
          rejections:  _ssDebug.rejections,
          consoleLog:  _ssDebug.consoleLog,
          apiCalls:    _ssDebug.apiCalls,
          resources:   _ssDebug.resources,
          fpsSamples:  _ssDebug.fpsSamples,
          longTasks:   _ssDebug.longTasks,
          // Strip the live ws/es objects — they contain non-serializable
          // refs to the WebSocket itself.
          wsInstances: _ssDebug.wsInstances.map(({ ws, ...rest }) => rest),
          esInstances: _ssDebug.esInstances.map(({ es, ...rest }) => rest),
          visibility:  _ssDebug.visibility,
          battery:     _ssDebug.battery,
          lastTap:     _ssDebug.lastTap,
          // v1.11.39 — stutter diagnosis streams
          tickerFrames:  _ssDebug.tickerFrames  || [],
          tickerStalls:  _ssDebug.tickerStalls  || [],
          longTaskList:  _ssDebug.longTaskList  || [],
          wsEvents:      _ssDebug.wsEvents      || [],
          // v1.11.39 — WS spawn tracking
          wsSpawnCount:  _ssDebug.wsSpawnCount  || 0,
          wsSpawnLog:    _ssDebug.wsSpawnLog    || [],
        },
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `solostrike-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after a tick so Safari has time to actually start the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      alert('Download failed: ' + e.message);
    }
  };

  return (
    <>
      <div style={{padding:'0.65rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:14, fontFamily:'var(--fm)', fontSize:'0.66rem', color:'var(--text-2)', lineHeight:1.5}}>
        Floating diagnostic overlay. 13 toggleable sections covering layout, state, performance, errors, console, network, device, caches, and more. Diagnostic streams (errors, console, fetch) are captured continuously starting at page load — flipping a section ON instantly shows pre-existing history.
      </div>

      <div style={{fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.12em', color:'var(--text-3)', textTransform:'uppercase', marginBottom:4}}>Master</div>
      <Toggle k="enabled" label="Show debug overlay" helper="Top-right green panel that updates live."/>

      <div style={{fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.12em', color:'var(--text-3)', textTransform:'uppercase', marginTop:'1.2rem', marginBottom:4}}>Page</div>
      <Toggle k="layout"  label="Layout"   helper="Viewport, header/footer, carousel/slot/card metrics. WASTED >20px = under-fill bug."/>
      <Toggle k="state"   label="State"    helper="Display mode (PWA/browser/iframe), breakpoint, body classes, useCarousel."/>
      <Toggle k="network" label="Network"  helper="Pool loaded, last update, connection status, stratum port health."/>
      <Toggle k="build"   label="Build"    helper="Compose version, active SW cache name, SW state, current path."/>

      <div style={{fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.12em', color:'var(--text-3)', textTransform:'uppercase', marginTop:'1.2rem', marginBottom:4}}>Diagnostic streams</div>
      <Toggle k="performance" label="Performance" helper="FPS (current + 30s avg), JS memory (Chrome only), long-task count, DOM nodes, page-load timing."/>
      <Toggle k="errors"      label="Errors"      helper="window.error count + last few, plus unhandled promise rejections."/>
      <Toggle k="consoleLog"  label="Console capture" helper="Last 15 console.log/warn/error messages with timestamps. Critical when iOS DevTools isn't an option."/>
      <Toggle k="api"         label="API trace"   helper="Every fetch() call: method, path, status, latency. Status ≥400 or >1s flagged."/>
      <Toggle k="transport"   label="Transport (WS/SSE)" helper="Every WebSocket and EventSource: URL, ready state, message count, time since last frame, close code/reason. Catches stale-data bugs from silently closed sockets."/>
      <Toggle k="resources"   label="Resource timing" helper="Last 10 slow (>500ms) or large (>100KB) resource loads. Diagnoses CDN issues and oversized assets."/>

      <div style={{fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.12em', color:'var(--text-3)', textTransform:'uppercase', marginTop:'1.2rem', marginBottom:4}}>Environment</div>
      <Toggle k="device"       label="Device"      helper="UA, DPR, online, connection type/downlink, touch points, orientation, prefers-* settings, safe-area insets, visualViewport."/>
      <Toggle k="visibility"   label="Visibility"  helper="Page visible/hidden state, transition count, time since last change. Catches iOS PWA suspend/resume."/>
      <Toggle k="battery"      label="Battery"     helper="Level, charging state, time-to-full or time-remaining. Not exposed by iOS Safari."/>
      <Toggle k="webgl"        label="WebGL"       helper="Every <canvas> with intrinsic + rendered size, GPU renderer string, context-loss event count."/>
      <Toggle k="caches"       label="Cache storage" helper="Every Cache Storage cache + entry count, plus origin storage usage/quota/persisted-flag from StorageManager."/>
      <Toggle k="capabilities" label="Capabilities" helper="Feature support matrix: WebGL2, Wasm, ServiceWorker, Cache, IDB, WakeLock, Push, Clipboard, isSecureContext, etc."/>
      <Toggle k="theme"        label="Theme vars"  helper="Every --ss-* CSS custom property declared at :root, with computed values. Useful for skin/theme debugging."/>
      <Toggle k="pool"         label="Pool detail" helper="Worker count breakdown (online/stale/offline), hashrate, last share age, recent block count."/>
      <Toggle k="interaction"  label="Interaction" helper="Last tap coords + idle time. Useful for swipe/touch debugging."/>
      <Toggle k="storage"      label="LocalStorage" helper="Every ss_* localStorage key + value + total size. Verbose."/>

      <div style={{display:'flex', gap:8, marginTop:'1.2rem', flexWrap:'wrap'}}>
        <button onClick={copySnapshot} style={{
          flex:'1 1 130px', padding:'0.55rem', background: copied ? 'var(--green)' : 'var(--bg-raised)',
          border:`1px solid ${copied ? 'var(--green)' : 'var(--border)'}`,
          color: copied ? '#000' : 'var(--text-1)',
          fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.1em',
          textTransform:'uppercase', cursor:'pointer',
        }}>
          {copied ? '✓ Copied' : 'Copy snapshot'}
        </button>
        <button onClick={downloadLogs} style={{
          flex:'1 1 130px', padding:'0.55rem', background:'var(--bg-raised)',
          border:'1px solid var(--border)', color:'var(--text-1)',
          fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.1em',
          textTransform:'uppercase', cursor:'pointer',
        }}>
          Download logs
        </button>
        <button onClick={resetDefaults} style={{
          padding:'0.55rem 0.9rem', background:'var(--bg-raised)',
          border:'1px solid var(--border)', color:'var(--text-2)',
          fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.1em',
          textTransform:'uppercase', cursor:'pointer',
        }}>
          Reset
        </button>
      </div>

      <div style={{marginTop:'1rem', fontFamily:'var(--fm)', fontSize:'0.6rem', color:'var(--text-3)', lineHeight:1.5}}>
        Snapshot is the latest values from the overlay (regardless of which sections are on screen). Paste into a chat to share a complete diagnostic.
      </div>
    </>
  );
}

// ── Worker detail modal ───────────────────────────────────────────────────────
// ── Pool alignment block (v1.9.3) ────────────────────────────────────────────
// Verifies the miner is pointed at SoloStrike by reading its configured pool
// list via the local cgminer-JSON API. The section TITLE is the status — so
// the GOOD case reads as "✓ ALIGNED WITH SOLOSTRIKE" in green, immediately
// visible without parsing a small pill. The whole section hides when there's
// nothing meaningful to show (ESP-Miner family devices that don't expose pool
// config, or first-poll-pending state).
function PoolAlignmentBlock({ worker }) {
  const [busy, setBusy]   = React.useState(false);
  const [error, setError] = React.useState('');
  const [override, setOverride] = React.useState(null); // optimistic recheck result

  const pa   = override || worker.poolAlignment;
  const meta = pa && pa.status ? poolAlignMeta(pa.status) : null;

  // Hide the entire section when there's nothing meaningful to show:
  //   - no record at all (polling off / first poll pending)
  //   - 'unknown' (no data yet)
  //   - 'esp-no-pools' (ESP-Miner devices like BitAxe/NerdQaxe don't expose
  //      pool config — no need to render a section that says "we can't tell")
  if (!pa || !pa.status || pa.status === 'unknown' || pa.status === 'esp-no-pools') {
    return null;
  }
  if (!meta) return null;

  const recheck = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/miners/poll/${encodeURIComponent(worker.name)}`, { method:'POST' });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Recheck failed');
      // v1.9.0 sent {alignment}; v1.9.1+ sends {record} — tolerate both.
      const next = data.record ? (data.record.alignment || null) : (data.alignment || null);
      if (next) setOverride({ ...next, lastCheckedAt: Date.now() });
    } catch (e) {
      setError(e.message || 'Recheck failed');
    } finally {
      setBusy(false);
    }
  };

  const checkedAt = pa.lastCheckedAt ? `Last checked ${fmtAgoShort(pa.lastCheckedAt)}` : null;

  return (
    <div style={section}>
      {/* Section title IS the status — color-coded, with glyph. The user
          shouldn't need to read further to see whether this miner is OK. */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'0.5rem',marginBottom:'0.5rem'}}>
        <div style={{
          fontFamily:'var(--fd)', fontSize:'0.7rem', letterSpacing:'0.15em',
          textTransform:'uppercase', color: meta.color, fontWeight:600,
          display:'flex', alignItems:'center', gap:'0.4rem',
        }}>
          <span style={{fontSize:'0.85rem'}}>{meta.glyph}</span>
          <span>{meta.label}</span>
        </div>
        <button onClick={recheck} disabled={busy}
                style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',
                        background:'transparent',border:'1px solid var(--border)',
                        color:busy?'var(--text-3)':'var(--cyan)',padding:'2px 8px',
                        cursor:busy?'wait':'pointer',borderRadius:2}}>
          {busy ? 'CHECKING\u2026' : 'RECHECK'}
        </button>
      </div>

      {checkedAt && (
        <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-3)',marginBottom:'0.5rem'}}>{checkedAt}</div>
      )}

      {(pa.status === 'aligned' || pa.status === 'backup' || pa.status === 'misaligned' || pa.status === 'unverifiable') && pa.activePool && (
        <div style={kvRow}>
          <span style={kvLabel}>Active pool</span>
          <span style={{...kvVal,fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--cyan)',overflow:'hidden',textOverflow:'ellipsis'}}>
            {pa.activePool}
          </span>
        </div>
      )}

      {pa.status === 'misaligned' && (
        <div style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--red)',padding:'0.4rem 0',lineHeight:1.5}}>
          This miner is not configured to point at SoloStrike. Open the
          miner web UI and add SoloStrike as a pool to bring it home.
        </div>
      )}

      {pa.status === 'backup' && (
        <div style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--amber)',padding:'0.4rem 0',lineHeight:1.5}}>
          SoloStrike is configured but a different pool is currently
          active. The miner will switch to SoloStrike if its primary
          fails \u2014 or you can promote it to primary in the miner UI.
        </div>
      )}

      {pa.status === 'unverifiable' && (
        <div style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-3)',padding:'0.4rem 0',lineHeight:1.5}}>
          This miner&rsquo;s firmware reports its configured pool URLs but
          redacts the username, so we can&rsquo;t prove which one is
          SoloStrike. If shares are landing in your dashboard, the miner
          is fine \u2014 just not auto-verifiable.
        </div>
      )}

      {(pa.status === 'unreachable' || pa.status === 'disabled') && (
        <div style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-3)',padding:'0.4rem 0',lineHeight:1.5}}>
          {pa.status === 'unreachable'
            ? 'Couldn\u2019t reach the miner on TCP 4028. Check the miner is online and on the same LAN.'
            : 'The miner\u2019s local API responded but didn\u2019t speak the cgminer JSON protocol. Some firmware ships the API disabled by default \u2014 enable it in the miner\u2019s settings.'}
        </div>
      )}

      {Array.isArray(pa.configuredPools) && pa.configuredPools.length > 0 && (
        <details style={{marginTop:'0.4rem'}}>
          <summary style={{fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.1em',color:'var(--text-2)',cursor:'pointer',padding:'0.3rem 0'}}>
            Configured pools ({pa.configuredPools.length})
          </summary>
          <div style={{padding:'0.3rem 0'}}>
            {pa.configuredPools.map((p, i) => (
              <div key={i} style={{padding:'0.3rem 0',borderTop:i>0?'1px solid var(--border)':'none'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.05em',
                                color:p.active?'var(--green)':'var(--text-3)',
                                border:`1px solid ${p.active?'var(--green)':'var(--text-3)'}`,
                                padding:'1px 5px',borderRadius:2}}>
                    {p.active ? 'ACTIVE' : `PRIO ${p.priority ?? '?'}`}
                  </span>
                  <span style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-3)'}}>{p.status || ''}</span>
                </div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-1)',wordBreak:'break-all'}}>{p.url || '\u2014'}</div>
                {p.user && <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-3)',wordBreak:'break-all',marginTop:1}}>user: {p.user}</div>}
              </div>
            ))}
          </div>
        </details>
      )}

      {pa.error && pa.status !== 'aligned' && (
        <div style={{fontFamily:'var(--fm)',fontSize:'0.55rem',color:'var(--text-3)',marginTop:'0.3rem'}}>
          Code: {pa.error}
        </div>
      )}

      {error && <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--red)',marginTop:'0.3rem'}}>{error}</div>}
    </div>
  );
}

function LiveStatsBlock({ worker }) {
  const live = worker.live;
  if (!live) return null;
  // Hide if there's truly nothing to show (all fields null)
  const hasAny = (live.tempC != null) || (live.fanRpm != null) || (live.fanPct != null)
              || (live.hashrateReported != null) || (live.hwErrors != null)
              || (live.uptimeSec != null) || (live.firmwareVersion != null)
              || (Array.isArray(live.tempDetails) && live.tempDetails.length > 0);
  if (!hasAny) return null;

  const t   = live.tempC;
  const tColor = t == null ? 'var(--text-2)'
              : t >= TEMP_RED_C   ? 'var(--red)'
              : t >= TEMP_AMBER_C ? 'var(--amber)'
              : 'var(--green)';
  const fanLine = (() => {
    if (live.fanRpm != null && live.fanPct != null) return `${live.fanPct}% · ${fmtNum(live.fanRpm)} rpm`;
    if (live.fanRpm != null) return `${fmtNum(live.fanRpm)} rpm`;
    if (live.fanPct != null) return `${live.fanPct}%`;
    return null;
  })();

  // Format reported hashrate at appropriate scale
  const hrReported = live.hashrateReported;
  const hrLine = hrReported != null ? fmtHr(hrReported) : null;

  // Uptime → human-friendly
  const uptimeLine = (() => {
    if (live.uptimeSec == null) return null;
    const s = live.uptimeSec;
    if (s < 60) return `${Math.floor(s)}s`;
    if (s < 3600) return `${Math.floor(s/60)}m`;
    if (s < 86400) return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
    return `${Math.floor(s/86400)}d ${Math.floor((s%86400)/3600)}h`;
  })();

  return (
    <div style={section}>
      <div style={secTitle}>▸ Live telemetry</div>

      {t != null && (
        <div style={kvRow}>
          <span style={kvLabel}>Temperature</span>
          <span style={{...kvVal, color: tColor, fontWeight:600}}>{Math.round(t)}°C</span>
        </div>
      )}
      {Array.isArray(live.tempDetails) && live.tempDetails.length > 1 && (
        <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-3)',padding:'0.2rem 0',lineHeight:1.5}}>
          {live.tempDetails.map(td => `${td.id}: ${Math.round(td.tempC)}°`).join('  ·  ')}
        </div>
      )}
      {fanLine && (
        <div style={kvRow}>
          <span style={kvLabel}>Fan</span>
          <span style={kvVal}>{fanLine}</span>
        </div>
      )}
      {hrLine && (
        <div style={kvRow}>
          <span style={kvLabel}>Reported Hashrate</span>
          <span style={{...kvVal, color: 'var(--cyan)'}}>{hrLine}</span>
        </div>
      )}
      {live.hwErrors != null && (
        <div style={kvRow}>
          <span style={kvLabel}>Hardware Errors</span>
          <span style={{...kvVal, color: live.hwErrors > 0 ? 'var(--amber)' : 'var(--text-2)'}}>
            {fmtNum(live.hwErrors)}
          </span>
        </div>
      )}
      {uptimeLine && (
        <div style={kvRow}>
          <span style={kvLabel}>Miner Uptime</span>
          <span style={kvVal}>{uptimeLine}</span>
        </div>
      )}
      {live.firmwareVersion && (
        <div style={kvRow}>
          <span style={kvLabel}>Firmware</span>
          <span style={{...kvVal, fontFamily:'var(--fm)', fontSize:'0.65rem'}}>{live.firmwareVersion}</span>
        </div>
      )}
    </div>
  );
}

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
              <span style={{width:6,height:6,borderRadius:'50%',background:on?'var(--green)':'var(--red)',boxShadow:`0 0 6px ${on?'var(--green)':'var(--red)'}`,animation:on?'pulse 2s ease-in-out infinite':'none',willChange:on?'opacity':'auto'}}/>
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

          {/* v1.9.0: Pool alignment — verify miner is pointed at SoloStrike via TCP 4028 */}
          <PoolAlignmentBlock worker={w}/>
          {/* v1.9.0: Live telemetry — temps, fans, hardware errors from the miner's local API */}
          <LiveStatsBlock worker={w}/>

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
const DEFAULT_ORDER = ['hashrate','strikevel','pulse','workers','stratum','hunt','network','node','luck','retarget','shares','best','closestcalls','jumpers','recent','health'];
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
  // v1.8.4: System Health card detail modal. State holds the snapshot of
  // /api/health/detailed at the moment the user tapped — null when closed.
  const [healthDetailSnapshot, setHealthDetailSnapshot] = useState(null);
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
  const [performanceMode, setPerformanceMode] = useState(loadPerformanceMode()); // v1.11.39
  const [visibleCards, setVisibleCards] = useState(loadVisibleCards());
  // rev70: persistent debug overlay settings. See DEBUG_DEFAULTS / loadDebugSettings.
  const [debugSettings, setDebugSettings] = useState(loadDebugSettings);
  const onDebugSettingsChange = useCallback((next) => {
    setDebugSettings(next);
    saveDebugSettings(next);
  }, []);
  const [stratumHealth, setStratumHealth] = useState({ ports: {} });
  // v1.8.3-rev29: minimum splash duration. Without this, on fast pool-load
  // the splash unmounts in <1s, often before the pickaxe completes a full
  // strike cycle. 1500ms guarantees the user sees at least one impact-hold
  // (the strike lands at ~420ms, holds through ~910ms in the new keyframe).
  const [minSplashElapsed, setMinSplashElapsed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMinSplashElapsed(true), 1500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    let cancelled = false;
    let inflight = null; // v1.11.9: track AbortController for in-flight fetch
    async function fetchHealth() {
      // v1.11.9: cancel any prior in-flight fetch — fixes iOS PWA hang
      // where post-suspend zombie TCP connections held requests for 20+s.
      // Confirmed in debug log: 20976ms hang on /api/stratum-health after
      // ~5min app backgrounding. AbortController + 8s timeout makes
      // zombie fetches die fast so new ones can proceed.
      try { inflight?.abort(); } catch {}
      const ctrl = new AbortController();
      inflight = ctrl;
      const killTimer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const r = await fetch('/api/stratum-health', { cache: 'no-store', signal: ctrl.signal });
        clearTimeout(killTimer);
        if (!r.ok) return;
        const j = await r.json();
        if (!cancelled) setStratumHealth(j || { ports: {} });
      } catch (_) { /* network blip or abort — keep last known state */ }
      finally { clearTimeout(killTimer); if (inflight === ctrl) inflight = null; }
    }
    fetchHealth();
    const id = setInterval(fetchHealth, 30000);
    return () => { cancelled = true; clearInterval(id); try { inflight?.abort(); } catch {} };
  }, []);

  // ── Update banner state ──────────────────────────────────────────────
  // Hard updates only. When server's composeVersion exceeds what this UI
  // build was compiled with, a cyan wrench banner prompts the user to
  // update via the Umbrel app store. Soft updates via service worker
  // events were removed in v1.7.15 — iOS PWA SW timing is too unreliable
  // to surface a banner before the page silently reloads. Cold launches
  // pick up new bundles naturally; for breaking infrastructure changes,
  // this banner ensures users know to use Umbrel.
  const BUILT_COMPOSE_VERSION = '1.8.5'; // bump only when manifest/compose breaks
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
  const onPerformanceModeChange = (v) => { setPerformanceMode(v); savePerformanceMode(v); }; // v1.11.39
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
  // v1.11.39: tickerText is recomputed on every poolState change, but the
  // new CSS-keyframes Ticker (line 1195) only swaps the actual DOM text
  // at animation-iteration boundaries — so frequent updates here are
  // harmless and the ticker stays silky. The Ticker itself absorbs the
  // update lifecycle, no throttling needed.
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
  const [huntAnim, setHuntAnim] = useState(() => loadHuntAnim());
  const onHuntAnimChange = useCallback((v) => {
    saveHuntAnim(v);
    setHuntAnim(v);
  }, []);
  // Pool pin location — user's approximate location on the Pulse globe.
  // localStorage is the source of truth; updates also POST to the API so
  // the next nostr broadcast includes it.
  const [poolPin, setPoolPin] = useState(() => loadPoolPin());
  const onPoolPinChange = useCallback((nextPin) => {
    // nextPin: { lat, lon } or null
    const snapped = nextPin ? snapPinTo5Deg(nextPin.lat, nextPin.lon) : null;
    savePoolPin(snapped);
    setPoolPin(snapped);
    publishPoolPinToApi(snapped);
  }, []);

  // ─── BLOCK FOUND modal state + trigger ─────────────────────────────────────
  // Opens BlockFoundModal when poolState.blocks.length grows by 1+.
  // Uses a null sentinel for lastBlockHeightRef so the first arrival of
  // poolState data does NOT trigger a celebration (only real subsequent
  // increments do). localStorage records the last celebrated block height
  // so a page refresh right after a block-found event won't re-fire the modal.
  const [blockFoundCelebration, setBlockFoundCelebration] = useState(null);
  const lastBlockHeightRef = useRef(null);
  useEffect(() => {
    const blocks = Array.isArray(poolState?.blocks) ? poolState.blocks : null;
    if (!blocks || blocks.length === 0) return;
    const newest = blocks[0];
    if (!newest || typeof newest.height !== 'number') return;
    const height = newest.height;

    // First time we see real data → record sentinel, don't celebrate
    if (lastBlockHeightRef.current === null) {
      lastBlockHeightRef.current = height;
      return;
    }
    // Only celebrate if the newest block height is HIGHER than what we've seen
    if (height > lastBlockHeightRef.current) {
      lastBlockHeightRef.current = height;
      // Refresh-protection: don't re-trigger for same block height
      try {
        const last = parseInt(localStorage.getItem(LS_LAST_CELEBRATED_BLOCK), 10);
        if (Number.isFinite(last) && last >= height) return;
        localStorage.setItem(LS_LAST_CELEBRATED_BLOCK, String(height));
      } catch {}
      // Open modal with current Hunt animation theme
      setBlockFoundCelebration({ animType: huntAnim, block: newest });
    }
  }, [poolState?.blocks, huntAnim]);
  const dismissBlockFound = useCallback(() => setBlockFoundCelebration(null), []);
  // Settings preview button: opens modal with mock block data using current theme
  const onPreviewCelebration = useCallback(() => {
    const mock = {
      height: poolState?.network?.height || 947128,
      reward: poolState?.blockReward?.totalBtc || 3.13024891,
      ts: new Date().toISOString(),
      hash: '0000000000000000000pre00view0celebrationdataonlyaaaaaaaaaaaa',
    };
    setBlockFoundCelebration({ animType: huntAnim, block: mock });
  }, [poolState, huntAnim]);
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
  //
  // v1.11.13: self-healing scroll listener — retries via rAF until the
  // carouselRef.current is populated, instead of relying on dep array hacks
  // (poolState._loaded + minSplashElapsed) to time effect re-runs against
  // splash unmount. The previous approach kept regressing whenever the
  // splash/loading sequence timing changed. This version:
  //   1. Only depends on useCarousel (single source of truth)
  //   2. Retries attachment on each animation frame until ref is ready
  //   3. Properly cancels both the retry loop and the scroll-rAF on cleanup
  // Result: dots track activeIndex deterministically regardless of mount
  // order, container restarts, or async data-load timing.
  useEffect(() => {
    if (!useCarousel) return;
    let cancelled = false;
    let attachRaf = 0;
    let cleanup = null;

    const tryAttach = () => {
      if (cancelled) return;
      const el = carouselRef.current;
      if (!el) {
        attachRaf = requestAnimationFrame(tryAttach);
        return;
      }
      let scrollRaf = 0;
      const onScroll = () => {
        cancelAnimationFrame(scrollRaf);
        scrollRaf = requestAnimationFrame(() => {
          const w = el.clientWidth;
          if (!w) return;
          const idx = Math.round(el.scrollLeft / w);
          setActiveIndex(prev => prev === idx ? prev : Math.max(0, idx));
        });
      };
      el.addEventListener('scroll', onScroll, { passive: true });
      onScroll();
      cleanup = () => {
        el.removeEventListener('scroll', onScroll);
        cancelAnimationFrame(scrollRaf);
      };
    };

    tryAttach();

    return () => {
      cancelled = true;
      cancelAnimationFrame(attachRaf);
      if (cleanup) cleanup();
    };
  }, [useCarousel]);

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
      // rev70: re-enabled JS measurement to fix Safari browser carousel under-fill.
      //
      // Diagnostic from rev69 debug overlay screenshots:
      //   Safari browser: 100dvh=628, header=123, footer=30 → real chrome 153px
      //   PWA          : 100dvh=812, header=210, footer=59 → real chrome 269px
      // The CSS fallback `calc(100dvh - 296px)` was tuned for PWA's tall chrome.
      // In Safari it over-deducted by ~143px, leaving 93px of empty space below
      // cards (visible WASTED=93px in the overlay). Hard-coded constants can't
      // satisfy both modes — actual measurement is the only reliable answer.
      //
      // rev14 historical note: an earlier JS measurement was removed because
      // `documentElement.clientHeight` returned 759 in iOS PWA when 100dvh was
      // 841 (an 82px discrepancy). That bug doesn't affect `window.innerHeight`,
      // which the rev69 overlay confirms matches 100dvh exactly in both modes
      // (win 812 == 100dvh 812 in PWA; win 628 == 100dvh 628 in Safari browser).
      //
      // DOTS_RESERVE=30: dots are position:fixed at bottom 40px+safeAreaInsetBottom
      // and float over content anyway; we just need enough clearance that text in
      // the bottom of the card doesn't sit directly behind them. PWA's effective
      // reserve under the 296 fallback was 27px (812-210-59-516); 30 stays within
      // 3px of the current PWA layout while recovering 113px in Safari browser.
      const vh = window.innerHeight;
      if (vh > 0) {
        const DOTS_RESERVE = 30;
        const target = Math.max(200, Math.round(vh - headerH - footerH - DOTS_RESERVE));
        carouselEl.style.setProperty('--carousel-h', target + 'px');
      }
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
    // rev70: visualViewport tracks Safari browser's URL-bar collapse/expand
    // during scroll. Without this, the height we measured at mount goes stale
    // when the user scrolls and the toolbar shrinks (or vice versa) — cards
    // would briefly under- or over-fill until a manual resize.
    const vv = (typeof window !== 'undefined') ? window.visualViewport : null;
    if (vv) vv.addEventListener('resize', update);
    return () => {
      if (ro) ro.disconnect();
      cancelAnimationFrame(raf1);
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      if (vv) vv.removeEventListener('resize', update);
    };
    // v1.8.1-rev12: added poolState._loaded — same dep-array bug we hit for
    // activeIndex tracking in rev1. Without this, the effect fires once on
    // initial mount with carouselRef.current === null, hits the early return,
    // and never re-runs (none of [useCarousel, minimalMode, stripSettings.enabled]
    // change when poolState loads). Result: JS measurement never sets
    // --carousel-h, cards fall back to CSS calc(100dvh - 296px), and the
    // DIAG-B1 overlay shows all zeros. Adding poolState._loaded forces the
    // effect to re-run after the loading splash unmounts and the carousel
    // ref is finally populated.
    //
    // v1.8.3-rev29b: ALSO depend on minSplashElapsed for the same reason as
    // the scroll-handler effect above — _loaded alone now flips true while
    // the splash is still showing (waiting for min duration), so the carousel
    // ref is still null when this effect re-runs. Need minSplashElapsed too.
  }, [useCarousel, minimalMode, stripSettings.enabled, poolState._loaded, minSplashElapsed]);

  const jumpToCard = useCallback((idx) => {
    const el = carouselRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
  }, []);

  if (!poolState._loaded || !minSplashElapsed) {
    return (
      <div style={{
        height:'100vh', width:'100vw',
        display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        background:'var(--bg-void)',
        color:'var(--text-2)', fontFamily:'var(--fd)',
        letterSpacing:'0.15em',
        gap:'1.5rem',
      }}>
        {/* v1.8.1-rev15: Strike animation — pickaxe swings down onto a glowing
            ₿. The two glyphs are stacked in a small relative-positioned box so
            the pickaxe's bottom-right transform-origin pivots toward the ₿
            below it, simulating impact. The ₿'s glow spikes at the moment
            of pickaxe contact via synchronized keyframes (both 1.4s cycle).
            Splash unmounts as soon as poolState._loaded flips true — the
            animation keeps looping while we wait, but doesn't artificially
            hold up the dashboard. */}
        <div style={{
          position:'relative',
          width:'5.5rem', height:'6.5rem',
          display:'flex', alignItems:'flex-end', justifyContent:'center',
          /* v1.8.3-rev31i: 3D perspective for the shard fly-toward-camera
             effect. Only affects children with translateZ (the 4 shards);
             the ₿, block, and pickaxe use 2D transforms only and render
             unchanged. */
          perspective:'500px',
          perspectiveOrigin:'50% 50%',
        }}>
          {/* v1.8.5-splash-rev4: Bitcoin ₿ — uses the exact PNG asset
              (/splash-btc.png) instead of a recreated SVG. Background was
              stripped from the source icon; the PNG already contains the
              full amber gradient + shading from the original artwork.

              v1.8.5-splash-rev4: wrapper repositioned to exactly match
              the block's bounding box (absolute, bottom:0.3rem,
              left:50%, marginLeft:-2.2rem, 4.4rem × 4.4rem). Previously
              the wrapper sat flush with stage bottom (4.5rem tall) while
              the block sat 0.3rem above, so the ₿ bottom strokes poked
              out below the block during rest. Now ₿ lives entirely
              within the block's bounds — fully hidden during rest,
              fully revealed when the block explodes.

              The btcImpact keyframe drives filter:drop-shadow on this
              wrapper to glow the image — see global.css. */}
          <div style={{
            position:'absolute',
            bottom:'0.45rem',           /* v1.8.5-splash-rev6: bumped 0.3→0.45rem so ₿ wrapper center matches block center (both at y=2.65rem from stage bottom). Without this, ₿ at scale 1.06 (impact-hold phase, 45-65% of cycle) peeked ~1.4px below block bottom because the wrappers shared a bottom anchor instead of a center anchor */
            left:'50%',
            marginLeft:'-2.2rem',
            width:'4.4rem', height:'4.4rem',
            display:'flex', alignItems:'center', justifyContent:'center',
            animation:'btcImpact 1.4s ease-in-out infinite',
            animationDelay:'0s',
            zIndex:1,
          }}>
            <img
              src="/splash-btc.png"
              alt="₿"
              style={{ width:'100%', height:'100%', objectFit:'contain', display:'block' }}
              draggable={false}
            />
          </div>
          {/* v1.8.3-rev31g: orange glowing block + matched -0.7s
              animationDelay on all three animated elements. Without the
              delay, splash mounts at cycle 0% (mid-explosion, block
              invisible), so the user briefly sees ₿ alone before the
              block first appears. With the delay, splash mounts at
              cycle 50% (block already solid, pickaxe held wound-back) —
              the natural starting state. The same negative delay is
              applied to ₿ and pickaxe so all three stay in sync. See
              blockBust keyframe in global.css. */}
          <div style={{
            position:'absolute',
            bottom:'0.3rem',
            left:'50%',
            marginLeft:'-2.35rem',
            width:'4.7rem',
            height:'4.7rem',
            background:'linear-gradient(135deg, #FFB347 0%, #FF8C1A 45%, #C95800 100%)',
            borderRadius:'6px',
            boxShadow:'0 0 22px rgba(255,140,0,0.75), inset 0 0 14px rgba(255,210,130,0.45)',
            animation:'blockBust 1.4s ease-in-out infinite',
            animationDelay:'0s',
            transformOrigin:'center',
            zIndex:2,
          }} />
          {/* v1.8.53-splash: crack overlay — three crossing dark gradient
              lines that flash for ~3% of cycle at impact, simulating cracks
              appearing on the block surface just before it shatters. The
              gradients use multiply blend so they darken the block surface.
              Same position + dimensions as the block. */}
          <div style={{
            position:'absolute',
            bottom:'0.3rem', left:'50%', marginLeft:'-2.35rem',
            width:'4.7rem', height:'4.7rem',
            background:
              'linear-gradient(85deg, transparent 47%, rgba(0,0,0,0.7) 49%, transparent 51%),'
              + 'linear-gradient(35deg, transparent 30%, rgba(0,0,0,0.5) 32%, transparent 34%),'
              + 'linear-gradient(-25deg, transparent 60%, rgba(0,0,0,0.5) 62%, transparent 64%)',
            borderRadius:'6px',
            mixBlendMode:'multiply',
            opacity:0,
            animation:'crackFlash 1.4s ease-in-out infinite',
            animationDelay:'0s',
            zIndex:3,
            pointerEvents:'none',
          }} />
          {/* v1.8.3-rev31i: 4 flying shard fragments. Same fly-out window
              as rev31h (cycle 95% → 12% of next cycle), but now using
              translate3d with a positive Z value so they fly TOWARD the
              viewer in 3D — the parent stage div has perspective:500px,
              so the shards' apparent size and offset both grow as Z
              increases. Bumped from 0.8rem to 1.3rem for a more
              substantial fragment feel. */}
          {(() => {
            const shardBase = {
              position: 'absolute',
              bottom: '2rem',             /* v1.8.5-splash-rev5: block center y minus half shard. Block grew to 4.7rem, center now at 2.65rem; shard center stays at block center, so shard bottom = 2.65 - 0.65 = 2rem */
              left: '50%',
              marginLeft: '-0.65rem',     /* half of 1.3rem to center horizontally */
              width: '1.3rem',
              height: '1.3rem',
              background: 'linear-gradient(135deg, #FFB347 0%, #FF8C1A 50%, #C95800 100%)',
              borderRadius: '3px',
              boxShadow: '0 0 10px rgba(255,140,0,0.9)',
              animationDuration: '1.4s',
              animationTimingFunction: 'ease-in-out',
              animationIterationCount: 'infinite',
              animationDelay: '0s',
              transformOrigin: 'center',
              zIndex: 2,
              pointerEvents: 'none',
            };
            return (
              <>
                <div style={{ ...shardBase, animationName: 'shardTL' }} />
                <div style={{ ...shardBase, animationName: 'shardTR' }} />
                <div style={{ ...shardBase, animationName: 'shardBL' }} />
                <div style={{ ...shardBase, animationName: 'shardBR' }} />
              </>
            );
          })()}
          {/* v1.8.5-splash-rev3: Pickaxe — uses the exact PNG asset
              (/splash-pickaxe.png) instead of a recreated SVG. Wrapper
              bumped from 3rem to 4.5rem (matches ₿) per user feedback —
              previous 3rem felt too small visually. The image's grip
              end is at its bottom-right corner; we use
              objectPosition:'right bottom' so that point sits at the
              wrapper's bottom-right (which is the transform-origin for
              the pickaxeStrike rotation), keeping the swing pivot
              correct. */}
          <div style={{
            position:'absolute',
            top:0, left:'50%',
            transform:'translateX(-90%)',     /* offset slightly left so the head lands center */
            width:'4.5rem', height:'4.5rem',
            transformOrigin:'bottom right',
            animation:'pickaxeStrike 1.4s ease-in-out infinite',
            animationDelay:'0s',
            filter:'drop-shadow(0 0 14px rgba(245,166,35,0.55)) drop-shadow(0 1px 2px rgba(0,0,0,0.4))',
            zIndex:3,
          }}>
            <img
              src="/splash-pickaxe.png"
              alt="⛏"
              style={{ width:'100%', height:'100%', objectFit:'contain', objectPosition:'right bottom', display:'block' }}
              draggable={false}
            />
          </div>
        </div>
        <div style={{
          fontFamily:'var(--fd)',
          fontSize:'1rem',
          fontWeight:700,
          color:'var(--amber)',
          letterSpacing:'0.4em',
          textShadow:'0 0 14px rgba(245,166,35,0.35)',
        }}>
          SOLOSTRIKE
        </div>
        <div style={{
          fontFamily:'var(--fd)',
          fontSize:'0.65rem',
          color:'var(--text-3)',
          letterSpacing:'0.2em',
          textTransform:'uppercase',
        }}>
          Connecting to pool…
        </div>
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
        <Header connected={connected} status="setup" onSettings={()=>setShowSettings(true)} privateMode={!!poolState.privateMode} minimalMode={minimalMode} performanceMode={performanceMode} zmq={poolState?.zmq}/>
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
            performanceMode={performanceMode} onPerformanceModeChange={onPerformanceModeChange}
            visibleCards={visibleCards} onVisibleCardsChange={onVisibleCardsChange}
            networkStats={poolState?.networkStats}
            onNetworkStatsRefresh={refreshConfig}
            carouselEnabled={carouselEnabled} onCarouselChange={onCarouselChange}
            pulseAnim={pulseAnim} onPulseAnimChange={onPulseAnimChange}
            huntAnim={huntAnim} onHuntAnimChange={onHuntAnimChange}
            poolPin={poolPin} onPoolPinChange={onPoolPinChange}
            debugSettings={debugSettings} onDebugSettingsChange={onDebugSettingsChange}
          />
        )}
      </>
    );
  }

  const status = poolState?.status || 'loading';
  const ns = poolState?.networkStats || {};

  const cardComponents = {
    // ── ERROR BOUNDARY TEST ────────────────────────────────────────────────
    // Always throws when rendered. Only inserted into renderableOrder when
    // the URL contains ?testcrash=1 (see below). To dismiss: remove the
    // ?testcrash=1 from your URL and reload. Safe to leave in production —
    // it's gated by URL param and never appears unless explicitly triggered.
    testbomb: (() => {
      const TestBomb = () => {
        throw new Error('ErrorBoundary test — triggered via ?testcrash=1 — works as expected if you see this in a fallback card!');
      };
      return <TestBomb />;
    })(),
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
      performanceMode={performanceMode}
      onPulseAnimChange={onPulseAnimChange}
      poolPin={poolPin}
      onPoolPinChange={onPoolPinChange}
      lastShareAt={poolState?.shares?.lastShareAt}
      acceptedCount={poolState?.shares?.acceptedCount}
      workers={poolState?.workers}
    />,
    workers: <WorkerGrid workers={workers} aliases={aliases} onWorkerClick={setSelectedWorker}/>,
    network: <NetworkStats network={poolState?.network} blockReward={poolState?.blockReward} mempool={poolState?.mempool} prices={poolState?.prices} currency={currency} privateMode={!!poolState?.privateMode} latestBlock={poolState?.latestBlock}/>,
    node: <BitcoinNodePanel nodeInfo={poolState?.nodeInfo}/>,
    stratum: <StratumPanel payoutAddress={poolState?.payoutAddress} stratumHealth={stratumHealth} startedAt={poolState?.shareStatsStartedAt}/>,
    hunt: <HuntPanel odds={poolState?.odds} hashrate={poolState?.hashrate?.current} blockReward={poolState?.blockReward} mempool={poolState?.mempool} prices={poolState?.prices} currency={currency} huntAnim={huntAnim} performanceMode={performanceMode} onOpen={()=>setShowReckoning(true)}/>,
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
    health: <HealthStatusCard onOpen={(snap) => setHealthDetailSnapshot(snap)}/>,
  };

  const visibleSet = new Set(minimalMode ? MINIMAL_PRESET : visibleCards);
  const baseOrder = order.filter(id => visibleSet.has(id) && cardComponents[id]);

  // v1.7.22: Stratum no longer auto-pins to first slot. Whatever order the
  // user has set (default or customized via Settings → Display) is used as-is.
  // Removes the surprise of Stratum jumping to front on first launch.
  // ── ERROR BOUNDARY TEST: prepend testbomb when URL has ?testcrash=1 ─────
  const _testBombActive = typeof window !== 'undefined' && window.location.search.includes('testcrash=1');
  const renderableOrder = _testBombActive ? ['testbomb', ...baseOrder] : baseOrder;

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
          performanceMode={performanceMode}
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
              <ErrorBoundary label={id}>
                {cardComponents[id]}
              </ErrorBoundary>
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
        <span>SoloStrike v1.11.39 — ckpool-solo{poolState?.privateMode && ' · 🔒 PRIVATE'}{minimalMode && ' · MIN'}</span>
        <a href="https://github.com/danhaus93-ops/solostrike-umbrel" target="_blank" rel="noopener noreferrer" title="View source on GitHub" style={{display:'inline-flex', alignItems:'center', justifyContent:'center', color:'var(--text-2)', textDecoration:'none', padding:'2px 6px', lineHeight:1, flexShrink:0}}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/>
          </svg>
        </a>
        <span>Ports <CopyablePort health={stratumHealth} port="3333"/> · <CopyablePort health={stratumHealth} port="3334"/> · <span title="TLS encryption via stunnel" style={{display:'inline-block', padding:'1px 5px', borderRadius:3, fontSize:'0.5rem', letterSpacing:'0.14em', color:'var(--cyan)', border:'1px solid rgba(0,255,209,0.45)', background:'rgba(0,255,209,0.05)', verticalAlign:'1px', marginRight:4}}>TLS</span><CopyablePort health={stratumHealth} port="4333" ssl/></span>
      </footer>

      <BlockAlert show={!!blockAlert} block={lastBlock} onDismiss={()=>setBlockAlert(false)}/>
      <OfflineToasts workers={workers} aliases={aliases}/>
      <HotMinerBanner workers={workers} aliases={aliases}/>
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

      {healthDetailSnapshot && (
        <HealthDetailModal
          initialHealth={healthDetailSnapshot}
          onClose={()=>setHealthDetailSnapshot(null)}/>
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
            performanceMode={performanceMode} onPerformanceModeChange={onPerformanceModeChange}
          visibleCards={visibleCards} onVisibleCardsChange={onVisibleCardsChange}
          networkStats={poolState?.networkStats}
          onNetworkStatsRefresh={refreshConfig}
          carouselEnabled={carouselEnabled} onCarouselChange={onCarouselChange}
          pulseAnim={pulseAnim} onPulseAnimChange={onPulseAnimChange}
          huntAnim={huntAnim} onHuntAnimChange={onHuntAnimChange}
            poolPin={poolPin} onPoolPinChange={onPoolPinChange}
          onPreviewCelebration={onPreviewCelebration}
          debugSettings={debugSettings} onDebugSettingsChange={onDebugSettingsChange}
        />
      )}
      {blockFoundCelebration && (
        <BlockFoundModal
          animType={blockFoundCelebration.animType}
          block={blockFoundCelebration.block}
          prices={poolState?.prices}
          currency={currency}
          onDismiss={dismissBlockFound}
        />
      )}
      <DebugOverlay
        settings={debugSettings}
        onSettingsChange={onDebugSettingsChange}
        appState={{
          useCarousel,
          minimalMode,
          carouselEnabled,
          minSplashElapsed,
          poolStateLoaded: !!poolState?._loaded,
          poolStatus: poolState?.status,
          poolLastUpdate: poolState?.lastUpdate
            ? new Date(poolState.lastUpdate).toLocaleTimeString()
            : null,
          connected,
          stratumHealth,
          composeVersion: BUILT_COMPOSE_VERSION,
          // pool detail (for the 'pool' section)
          workers,
          totalHashrate: (() => {
            const h = poolState?.hashrate?.current;
            if (typeof h !== 'number' || !isFinite(h)) return null;
            try { return fmtHr(h); } catch { return h.toFixed(0); }
          })(),
          recentBlocks: Array.isArray(poolState?.blocks) ? poolState.blocks.length : null,
        }}
      />
    </>
  );
}
