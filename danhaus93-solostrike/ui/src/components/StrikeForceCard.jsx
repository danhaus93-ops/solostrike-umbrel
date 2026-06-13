// StrikeForceCard.jsx — v2.3.0 (animated sky scene)
// Auto-populating "Strike Force" card for rented hashrate (NiceHash / Braiins /
// MiningRigRentals). When a worker on the high-diff rental port (>4000) whose
// minerVendor is "Rented" or "Braiins" is online, a card is inserted at the
// TOP of the card list visualising its climb toward a block — modelled on
// NiceHash EasyMining — plus a full rental ledger:
//   · RENTAL TELEMETRY  — live firepower, share of pool, hourly block odds
//   · VALUE ACCOUNTING  — session clock, total hashes delivered, delivered-vs-
//                          live hashrate (catches sellers shorting you),
//                          wasted work, accumulated session odds, EV in sats
//   · TOP STRIKES       — session's 3 best shares, log-scaled ladder
//
// Data (all already in the per-worker payload, no API changes):
//   se.recentSdiffs   → per-share achieved diffs (rental port only, cap 512)
//   se.bestSinceReset → best share diff (resettable)
//   se.accepted/rejected/stale → counts
//   se.sdiffSum       → Σ TARGET diffs of accepted shares (unbiased work sum,
//                        v1.8.3-rev24) → hashes = sdiffSum × 2^32
//   se.firstSeen      → session clock / strike-rate / delivered-avg
//   worker.hashrate   → ckpool live hashrate (H/s)
//   network.difficulty, blockReward.totalBtc, fiatPrice+currency (props)
//
// Layout: .cs-main (head/headline/histogram/legend) + .cs-ledger (all chips &
// sections). Mobile stacks them; the desktop SV-slot lays them out as two
// columns via CSS in DesktopPages so the whole ledger fits without scrolling.

import React, { useRef, useEffect } from 'react';

// Real bright-star catalog (Orion region: Sirius, Rigel, Betelgeuse, the belt,
// Canopus, …) projected to 0..1 x/y with brightness b — used for the sky.
const STAR_MAP = [{"x": 0.672, "y": 0.6309, "b": 0.99, "n": "Sirius"}, {"x": 0.5711, "y": 0.9871, "b": 0.81, "n": "Canopus"}, {"x": 0.2406, "y": 0.5466, "b": 0.58, "n": "Rigel"}, {"x": 0.434, "y": 0.392, "b": 0.49, "n": "Betelgeuse"}, {"x": 0.93, "y": 0.4136, "b": 0.53, "n": "Procyon"}, {"x": 0.2509, "y": 0.0099, "b": 0.59, "n": "Capella"}, {"x": 0.0569, "y": 0.3019, "b": 0.4, "n": "Aldebaran"}, {"x": 0.2909, "y": 0.4025, "b": 0.25, "n": "Bellatrix"}, {"x": 0.2966, "y": 0.1821, "b": 0.25, "n": "Elnath"}, {"x": 0.344, "y": 0.4772, "b": 0.25, "n": "Alnilam"}, {"x": 0.3654, "y": 0.4846, "b": 0.25, "n": "Alnitak"}, {"x": 0.3237, "y": 0.4683, "b": 0.25, "n": "Mintaka"}, {"x": 0.3989, "y": 0.5611, "b": 0.25, "n": "Saiph"}, {"x": 0.9586, "y": 0.1879, "b": 0.32, "n": "Pollux"}, {"x": 0.9077, "y": 0.1496, "b": 0.25, "n": "Castor"}, {"x": 0.7363, "y": 0.7522, "b": 0.25, "n": "Adhara"}, {"x": 0.5651, "y": 0.6431, "b": 0.25, "n": "Mirzam"}, {"x": 0.7829, "y": 0.7267, "b": 0.25, "n": "Wezen"}];

// Platform detect: Apple renders 🛰️ as a crisp 3D satellite, so use the emoji
// on iOS/macOS and an SVG twin everywhere else for visual parity.
const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');

const MOON_SRC = '/moon.png';
const T232 = 4294967296;


// String form of the shuttle for innerHTML (animation layer), nose-up so a 90°
// rotation makes it fly nose-right. Same artwork as the original card shuttle.
const SHUTTLE_HTML = `
<svg viewBox="0 0 44 62" width="38" height="53" style="display:block;filter:drop-shadow(0 0 6px var(--amber));overflow:visible">
 <defs>
  <linearGradient id="csa-tk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#E8822F"/><stop offset=".5" stop-color="#C75D1B"/><stop offset="1" stop-color="#984510"/></linearGradient>
  <linearGradient id="csa-sb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#C2C9D1"/></linearGradient>
  <linearGradient id="csa-ob" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#CBD3DB"/></linearGradient>
  <linearGradient id="csa-fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".3" stop-color="#FFD24A"/><stop offset=".65" stop-color="#FF7A00"/><stop offset="1" stop-color="#E53E3E" stop-opacity="0"/></linearGradient>
 </defs>
 <path class="cs-flame" d="M13 47 C15 60 18 53 22 62 C26 53 29 60 31 47 Z" fill="url(#csa-fl)"/>
 <path class="cs-flame2" d="M17.5 47 C19 57 21 52 22 59 C23 52 25 57 26.5 47 Z" fill="#FFF6D8" opacity=".9"/>
 <path d="M10 11 C9 11 8.3 13 8.3 15 L8.3 47 L13.7 47 L13.7 15 C13.7 13 13 11 12 11 Z" fill="url(#csa-sb)" stroke="#7c8792" stroke-width=".4"/>
 <path d="M32 11 C31 11 30.3 13 30.3 15 L30.3 47 L35.7 47 L35.7 15 C35.7 13 35 11 34 11 Z" fill="url(#csa-sb)" stroke="#7c8792" stroke-width=".4"/>
 <rect x="8.3" y="20" width="5.4" height="1.4" fill="#9aa3ad"/><rect x="30.3" y="20" width="5.4" height="1.4" fill="#9aa3ad"/>
 <path d="M22 3 C18.4 3 16.4 8 16.4 13 L16.4 48 L27.6 48 L27.6 13 C27.6 8 25.6 3 22 3 Z" fill="url(#csa-tk)" stroke="#6e3208" stroke-width=".5"/>
 <path d="M18 13 L18 47" stroke="#F6B27A" stroke-width="1" opacity=".5"/>
 <path d="M22 31 L13 49 L31 49 Z" fill="url(#csa-ob)" stroke="#7c8792" stroke-width=".4"/>
 <path d="M22 31 L13 49 L15 49 Z" fill="#15181d" opacity=".85"/><path d="M22 31 L31 49 L29 49 Z" fill="#15181d" opacity=".85"/>
 <path d="M22 21 C20.4 21 19.4 24 19.4 28 L19.4 49 L24.6 49 L24.6 28 C24.6 24 23.6 21 22 21 Z" fill="url(#csa-ob)" stroke="#7c8792" stroke-width=".4"/>
 <path d="M22 21 C20.4 21 19.4 24 19.4 27 L24.6 27 C24.6 24 23.6 21 22 21 Z" fill="#15181d"/>
 <rect x="20.5" y="27.6" width="3" height="1.5" rx=".5" fill="#3a4756"/>
 <path d="M22 23 L20.8 27 L23.2 27 Z" fill="#fff" opacity=".25"/>
</svg>`;

// SVG twin of the Apple 🛰️ emoji for non-Apple platforms: gold cube body,
// two blue solar panels, white dish, red sensor.
const SAT_SVG = `
<svg viewBox="0 0 64 52" width="30" height="24" style="display:block">
 <defs>
  <linearGradient id="css-np" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f8bf5"/><stop offset=".5" stop-color="#2155c4"/><stop offset="1" stop-color="#10336e"/></linearGradient>
  <linearGradient id="css-ng" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE08A"/><stop offset=".5" stop-color="#F2B01E"/><stop offset="1" stop-color="#A06E10"/></linearGradient>
  <radialGradient id="css-nd" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fdfefe"/><stop offset="1" stop-color="#9aa3ad"/></radialGradient>
 </defs>
 <g transform="translate(2,16) rotate(-10)"><rect width="19" height="15" fill="url(#css-np)" stroke="#10336e" stroke-width=".6"/><line x1="6.3" y1="0" x2="6.3" y2="15" stroke="#6f9ce8" stroke-width=".5"/><line x1="12.6" y1="0" x2="12.6" y2="15" stroke="#6f9ce8" stroke-width=".5"/><line x1="0" y1="7.5" x2="19" y2="7.5" stroke="#6f9ce8" stroke-width=".5"/></g>
 <line x1="21" y1="24" x2="26" y2="24" stroke="#b9b189" stroke-width="1.3"/>
 <g transform="translate(43,16) rotate(10)"><rect width="19" height="15" fill="url(#css-np)" stroke="#10336e" stroke-width=".6"/><line x1="6.3" y1="0" x2="6.3" y2="15" stroke="#6f9ce8" stroke-width=".5"/><line x1="12.6" y1="0" x2="12.6" y2="15" stroke="#6f9ce8" stroke-width=".5"/><line x1="0" y1="7.5" x2="19" y2="7.5" stroke="#6f9ce8" stroke-width=".5"/></g>
 <line x1="38" y1="24" x2="43" y2="24" stroke="#b9b189" stroke-width="1.3"/>
 <path d="M26 19 L32 15.5 L38 19 L38 30 L32 33.5 L26 30 Z" fill="url(#css-ng)" stroke="#7a4a10" stroke-width=".7"/>
 <path d="M32 15.5 L38 19 L38 30 L32 33.5 Z" fill="#C9881A" opacity=".5"/>
 <rect x="30.7" y="11" width="2.6" height="5" fill="#9aa3ad"/>
 <circle cx="32" cy="10.5" r="2.6" fill="#E5413B" stroke="#7a1310" stroke-width=".5" style="filter:drop-shadow(0 0 3px #E5413B)"/>
 <line x1="27" y1="28" x2="19" y2="36" stroke="#9aa3ad" stroke-width="1.2"/>
 <ellipse cx="15" cy="39" rx="10" ry="7" fill="url(#css-nd)" stroke="#7c8792" stroke-width=".6" transform="rotate(-22 15 39)"/>
 <ellipse cx="15" cy="39" rx="5" ry="3.4" fill="none" stroke="#9aa3ad" stroke-width=".4" transform="rotate(-22 15 39)"/>
 <line x1="15" y1="39" x2="10" y2="45" stroke="#9aa3ad" stroke-width=".7"/>
</svg>`;

const CSS = `
.cs-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:0.8rem 0.95rem 0.85rem;margin-bottom:0.6rem;}
.cs-main{min-width:0;}
.cs-ledger{min-width:0;}
.cs-head{display:flex;align-items:center;gap:0.5rem;margin-bottom:0.45rem;}
.cs-glyph{width:22px;height:22px;object-fit:contain;filter:drop-shadow(0 0 5px var(--btc-orange));}
.cs-title{font-family:var(--fd,inherit);font-size:0.9rem;font-weight:700;letter-spacing:0.03em;color:var(--text-1);}
.cs-prov{font-family:var(--fd,inherit);font-size:0.45rem;letter-spacing:0.13em;text-transform:uppercase;padding:3px 6px;border-radius:4px;border:1px solid var(--border);color:var(--text-2);display:inline-flex;align-items:center;gap:4px;}
.cs-prov i{width:5px;height:5px;border-radius:50%;background:var(--cyan);display:inline-block;}
.cs-sp{flex:1;}
.cs-badge{font-family:var(--fd,inherit);font-size:0.46rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--bg-deep);background:var(--amber);padding:3px 7px;border-radius:5px;font-weight:700;}
.cs-hl{display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.1rem;}
.cs-big{font-family:var(--fd,inherit);font-size:1.5rem;font-weight:800;color:var(--amber);line-height:1;}
.cs-cap{font-family:var(--fd,inherit);font-size:0.46rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-3);}
.cs-sub{font-family:var(--fd,inherit);font-size:0.48rem;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-2);margin-bottom:0.5rem;}
.cs-sub b{color:var(--btc-orange);}
.cs-hist{position:relative;height:clamp(128px,17vh,142px);background:#060709;border:1px solid var(--border);border-radius:8px;overflow:hidden;}
.cs-aurora{position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden;}
.cs-curtain{position:absolute;top:-6px;bottom:28%;mix-blend-mode:screen;filter:blur(6px);transform-origin:bottom center;border-radius:50% 50% 0 0 / 16% 16% 0 0;}
.cs-sky{position:absolute;inset:0;z-index:2;pointer-events:none;}
.cs-star{position:absolute;border-radius:50%;background:#eaf0ff;}
.cs-net{position:absolute;left:8px;right:8px;top:11px;border-top:2px dashed var(--text-1);opacity:0.5;z-index:2;}
.cs-netlbl{position:absolute;left:9px;top:7px;font-family:var(--fd,inherit);font-size:0.42rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-2);z-index:8;background:rgba(6,7,9,0.82);padding:2px 6px;border-radius:3px;}
.cs-moon{position:absolute;right:10px;top:13px;width:23px;height:23px;z-index:9;filter:drop-shadow(0 0 4px rgba(244,242,235,0.6)) drop-shadow(0 0 8px var(--btc-orange));}
.cs-moon img{display:block;width:23px;height:23px;border-radius:50%;}
.cs-sat{position:absolute;right:44px;top:14px;z-index:12;font-size:24px;line-height:1;animation:cs-bob 4.5s ease-in-out infinite;}
.cs-smoke{position:absolute;inset:0;z-index:11;pointer-events:none;}
.cs-shipwrap{position:absolute;inset:0;z-index:10;pointer-events:none;}
.cs-ship{position:absolute;left:0;top:0;will-change:transform;}
.cs-vp{position:absolute;left:8px;right:8px;top:34px;bottom:6px;overflow:hidden;z-index:3;}
.cs-inner{display:flex;align-items:flex-end;height:100%;width:max-content;min-width:100%;padding-bottom:5px;}
@keyframes cs-bob{0%,100%{transform:translateY(0) rotate(-3deg);}50%{transform:translateY(-2.5px) rotate(3deg);}}
@keyframes cs-sway{0%,100%{transform:translateX(0) scaleX(1) scaleY(1);}50%{transform:translateX(var(--sx)) scaleX(var(--scx)) scaleY(1.07);}}
@keyframes cs-shimmer{0%,100%{opacity:var(--o0);}50%{opacity:var(--o1);}}
@keyframes cs-twk{0%,100%{opacity:0.45;}50%{opacity:1;}}
.cs-bar{width:5px;margin-right:2px;flex:0 0 auto;background:#8b9098;border-radius:1px 1px 0 0;height:0;transition:height 0.45s cubic-bezier(0.2,0.8,0.2,1),background 0.3s;}
.cs-bar.cs-best{background:var(--amber);box-shadow:0 0 8px var(--amber);}
.cs-lgnd{display:flex;gap:0.8rem;flex-wrap:wrap;margin-bottom:0.5rem;}
.cs-lg{display:flex;align-items:center;gap:4px;font-family:var(--fd,inherit);font-size:0.42rem;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-3);}
.cs-lg i{width:7px;height:7px;border-radius:1px;display:inline-block;}
.cs-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;}
.cs-kv{display:flex;justify-content:space-between;align-items:center;padding:0.36rem 0.5rem;background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;min-width:0;overflow:hidden;}
.cs-kv .k{font-family:var(--fd,inherit);font-size:0.44rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3);}
.cs-kv .v{font-family:var(--fm,monospace);font-size:0.7rem;color:var(--text-1);font-weight:600;white-space:nowrap;}
.cs-kv .v.am{color:var(--amber);}
.cs-kv .v.cy{color:var(--cyan);}
.cs-kv .v.gr{color:var(--green,#39FF6A);}
.sf-divider{display:flex;align-items:center;gap:8px;margin:0.5rem 0 0.35rem;}
.sf-divider span{font-family:var(--fd,inherit);font-size:0.4rem;letter-spacing:0.16em;text-transform:uppercase;color:var(--text-3);white-space:nowrap;}
.sf-divider i{flex:1;height:1px;background:var(--border);}
.sf-odds{display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.5rem;background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;margin-top:5px;min-width:0;}
.sf-odds .k{font-family:var(--fd,inherit);font-size:0.44rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3);}
.sf-odds .v{font-family:var(--fm,monospace);font-size:0.72rem;font-weight:700;color:var(--cyan);white-space:nowrap;}
.sf-odds .v small{font-size:0.55em;color:var(--text-3);font-weight:500;}
.sf-odds .v.ev{color:var(--green,#39FF6A);}
.sf-top{margin-top:0.45rem;}
.sf-row{display:flex;align-items:center;gap:7px;padding:3px 0;}
.sf-rank{font-family:var(--fd,inherit);font-size:0.5rem;color:var(--text-3);width:14px;}
.sf-row.first .sf-rank{color:var(--amber);}
.sf-track{flex:1;height:8px;background:var(--bg-deep);border:1px solid var(--border);border-radius:4px;overflow:hidden;position:relative;}
.sf-track i{position:absolute;left:0;top:0;bottom:0;background:#7b8088;border-radius:3px;transition:width 0.5s cubic-bezier(0.2,0.8,0.2,1);}
.sf-row.first .sf-track i{background:var(--amber);box-shadow:0 0 7px var(--amber);}
.sf-val{font-family:var(--fm,monospace);font-size:0.6rem;color:var(--text-2);width:54px;text-align:right;font-weight:600;}
.sf-row.first .sf-val{color:var(--amber);}
.sf-pct{font-family:var(--fd,inherit);font-size:0.46rem;color:var(--text-3);width:34px;text-align:right;}
.cs-flame{transform-origin:22px 48px;animation:cs-flame 0.32s ease-in-out infinite alternate;}
.cs-flame2{transform-origin:22px 48px;animation:cs-flame2 0.22s ease-in-out infinite alternate;}
@keyframes cs-launch{0%,100%{transform:translateY(3px) rotate(-1.5deg);}50%{transform:translateY(-10px) rotate(1.5deg);}}
@keyframes cs-flame{from{transform:scaleY(0.55) scaleX(0.9);opacity:0.6;}to{transform:scaleY(1.25) scaleX(1.05);opacity:1;}}
@keyframes cs-flame2{from{transform:scaleY(0.6);opacity:0.7;}to{transform:scaleY(1.15);opacity:1;}}
`;

function fmtDiff(d) {
  if (!d || d <= 0) return '—';
  if (d >= 1e15) return (d / 1e15).toFixed(1) + ' P';
  if (d >= 1e12) return (d / 1e12).toFixed(1) + ' T';
  if (d >= 1e9) return (d / 1e9).toFixed(1) + ' G';
  if (d >= 1e6) return (d / 1e6).toFixed(1) + ' M';
  if (d >= 1e3) return (d / 1e3).toFixed(0) + ' K';
  return Math.round(d).toString();
}

function fmtPctToBlock(p) {
  if (!p || p <= 0) return '—';
  if (p >= 1) return p.toFixed(2) + '%';
  if (p >= 0.001) return p.toFixed(3) + '%';
  // Never show e-notation (e.g. "7.5e-4%") — show a plain floor instead.
  return '<0.001%';
}

function fmtHr(hs) {
  if (!hs || hs <= 0) return '—';
  if (hs >= 1e15) return (hs / 1e15).toFixed(2) + ' PH/s';
  if (hs >= 1e12) return (hs / 1e12).toFixed(1) + ' TH/s';
  if (hs >= 1e9) return (hs / 1e9).toFixed(1) + ' GH/s';
  return (hs / 1e6).toFixed(0) + ' MH/s';
}

function fmtHashes(h) {
  if (!h || h <= 0) return '—';
  if (h >= 1e21) return (h / 1e21).toFixed(2) + ' ZH';
  if (h >= 1e18) return (h / 1e18).toFixed(2) + ' EH';
  if (h >= 1e15) return (h / 1e15).toFixed(1) + ' PH';
  return (h / 1e12).toFixed(0) + ' TH';
}

function fmtDur(ms) {
  if (!ms || ms <= 0) return '—';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return d + 'd ' + (h % 24) + 'h';
  if (h > 0) return h + 'h ' + (m % 60) + 'm';
  return Math.max(m, 1) + 'm';
}

function fmtOneIn(p) { // probability → "1 : N" (language-neutral)
  if (!p || p <= 0) return '—';
  const n = 1 / p;
  if (n >= 1e12) return '1 : ' + (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return '1 : ' + (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return '1 : ' + (n / 1e6).toFixed(1) + 'M';
  return '1 : ' + Math.round(n).toLocaleString();
}

function fmtFiatLocal(v, currency) {
  if (v == null || !(v > 0)) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 2 }).format(v);
  } catch (e) {
    return '$' + v.toFixed(2);
  }
}

export function StrikeForceCard({ worker, network, blockReward, poolHashrate, fiatPrice, currency, t, GLYPH_SRC }) {
  const tt = typeof t === 'function' ? t : (k) => k;
  const innerRef = useRef(null);
  const vpRef = useRef(null);
  const mountedRef = useRef(false);
  const prevAcceptedRef = useRef(0);
  const bestValRef = useRef(0);
  const bestElRef = useRef(null);
  const histRef = useRef(null);
  const shipRef = useRef(null);
  const smokeRef = useRef(null);

  const se = worker.shareEvents || {};
  const accepted = se.accepted || 0;
  const rejected = (se.rejected || 0) + (se.stale || 0);
  const best = se.bestSinceReset || se.bestSdiff || 0;
  const netDiff = (network && network.difficulty) || 0;
  const recent = Array.isArray(se.recentSdiffs) ? se.recentSdiffs : [];

  // NiceHash-style log ascent (the dramatic "close to reward" number) …
  const ascentPct = netDiff > 1 && best > 0 ? Math.min((Math.log(best) / Math.log(netDiff)) * 100, 100) : 0;
  // … and the app-native linear "% to block" (matches closest-calls / rarity).
  const pctToBlock = netDiff > 0 && best > 0 ? (best / netDiff) * 100 : 0;

  const providerLabel = worker.minerType || worker.minerVendor || tt('Rented');
  const rewardBtc = blockReward && typeof blockReward.totalBtc === 'number' ? blockReward.totalBtc : null;

  const firstSeen = se.firstSeen || 0;
  const elapsedMs = firstSeen ? Math.max(Date.now() - firstSeen, 6000) : 0;
  const mins = elapsedMs / 60000;
  const strikeRate = mins > 0 ? Math.round(accepted / Math.max(mins, 0.1)) : null;

  // ── RENTAL TELEMETRY ──────────────────────────────────────────────────
  const rentalHr = worker.hashrate || 0; // H/s, ckpool live
  const poolPct = poolHashrate > 0 && rentalHr > 0 ? Math.min((rentalHr / poolHashrate) * 100, 100) : null;
  // Block odds in the next hour at current rate: P = HR·3600 / (D·2^32)
  const hourP = netDiff > 0 && rentalHr > 0 ? (rentalHr * 3600) / (netDiff * T232) : 0;

  // ── VALUE ACCOUNTING — what your sats bought ─────────────────────────
  // se.sdiffSum sums TARGET diffs of accepted shares (v1.8.3-rev24), the
  // unbiased work estimator: hashes = Σtarget × 2^32.
  const targetSum = se.sdiffSum || 0;
  const workHashes = targetSum * T232;
  const deliveredAvg = elapsedMs > 0 ? workHashes / (elapsedMs / 1000) : 0; // H/s
  const wastedPct = accepted + rejected > 0 ? (rejected / (accepted + rejected)) * 100 : 0;
  // Accumulated session block probability: every accepted share at target d
  // was a d/D lottery ticket → ΣP = Σtarget / D.
  const sessP = netDiff > 0 ? targetSum / netDiff : 0;
  const evSats = sessP > 0 && rewardBtc ? sessP * rewardBtc * 1e8 : 0;
  const evFiat = sessP > 0 && rewardBtc && fiatPrice > 0 ? sessP * rewardBtc * fiatPrice : null;
  const evFiatStr = fmtFiatLocal(evFiat, currency);

  // ── TOP STRIKES — session's best three from the ring ─────────────────
  const lnNetTop = netDiff > 1 ? Math.log(netDiff) : 0;
  const topStrikes = lnNetTop > 0
    ? [...recent].sort((a, b) => b - a).slice(0, 3).map((d) => ({ d, pct: Math.min((Math.log(d) / lnNetTop) * 100, 100) }))
    : [];

  useEffect(() => {
    const inner = innerRef.current, vp = vpRef.current;
    if (!inner) return;
    const lnNet = netDiff > 1 ? Math.log(netDiff) : 0;
    const hOf = (sd) => (lnNet > 0 && sd > 0 ? Math.min(Math.log(sd) / lnNet, 1) : 0);

    const mkBar = (sd, animate) => {
      const v = hOf(sd);
      const el = document.createElement('div');
      el.className = 'cs-bar';
      const pct = (v * 100).toFixed(2) + '%';
      el.style.height = animate ? '0%' : pct;
      inner.appendChild(el);
      if (animate) requestAnimationFrame(() => { el.style.height = pct; });
      if (v > bestValRef.current) {
        bestValRef.current = v;
        if (bestElRef.current) bestElRef.current.classList.remove('cs-best');
        bestElRef.current = el;
        el.classList.add('cs-best');
      }
    };

    if (!mountedRef.current || accepted < prevAcceptedRef.current) {
      // First mount, OR a server-side reset (accepted went down): rebuild
      // the histogram from the authoritative ring so no stale bars linger.
      inner.innerHTML = '';
      bestValRef.current = 0;
      bestElRef.current = null;
      for (const sd of recent) mkBar(sd, false);
      mountedRef.current = true;
    } else {
      const delta = Math.max(0, accepted - prevAcceptedRef.current);
      const n = Math.min(delta, recent.length);
      for (let i = recent.length - n; i < recent.length; i++) mkBar(recent[i], true);
      // Mirror the API's 512 ring cap: trim oldest DOM bars to match the window.
      let trimmedBest = false;
      while (inner.children.length > 512) {
        const removed = inner.firstChild;
        if (removed === bestElRef.current) { bestElRef.current = null; trimmedBest = true; }
        inner.removeChild(removed);
      }
      if (trimmedBest) {
        let bv = 0, be = null;
        for (const c of inner.children) {
          const hh = parseFloat(c.style.height) || 0;
          if (hh > bv) { bv = hh; be = c; }
        }
        bestValRef.current = bv / 100;
        bestElRef.current = be;
        if (be) be.classList.add('cs-best');
      }
    }
    prevAcceptedRef.current = accepted;
    if (vp) {
      const nearEnd = vp.scrollWidth - vp.clientWidth - vp.scrollLeft < 60;
      if (nearEnd) vp.scrollLeft = vp.scrollWidth;
    }
  }, [accepted, netDiff, worker]);

  // ── Animated sky scene: aurora curtains, full-height stars, and the shuttle
  // flying across (in front of the words & moon, behind the satellite) laying a
  // dense smoke "difficulty line" that persists, fading fast only over the moon.
  useEffect(() => {
    const hist = histRef.current, ship = shipRef.current, smoke = smokeRef.current;
    if (!hist || !ship || !smoke) return;
    const W = hist.clientWidth || 320, H = hist.clientHeight || 140;
    const LINE_Y = 28, X0 = 2, SLOT = 2.4;
    const NS = 'http://www.w3.org/2000/svg';

    // build stars (full height) into .cs-sky
    const sky = hist.querySelector('.cs-sky');
    if (sky && !sky.dataset.built) {
      let html = '';
      for (const st of STAR_MAP) {
        const x = 8 + st.x * (W - 16), y = 4 + st.y * (H - 28);
        const sz = (0.8 + st.b * 1.8).toFixed(1);
        html += '<div class="cs-star" style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;width:' + sz + 'px;height:' + sz + 'px;opacity:' + (0.4 + st.b * 0.55).toFixed(2) + ';animation:cs-twk ' + (2 + Math.random() * 2).toFixed(1) + 's ease-in-out ' + (Math.random() * 3).toFixed(1) + 's infinite"></div>';
      }
      for (let i = 0; i < 24; i++) {
        const x = 6 + Math.random() * (W - 12), y = 2 + Math.random() * (H - 24);
        const sz = (0.6 + Math.random() * 1.3).toFixed(1);
        html += '<div class="cs-star" style="left:' + x.toFixed(1) + 'px;top:' + y.toFixed(1) + 'px;width:' + sz + 'px;height:' + sz + 'px;opacity:' + (0.25 + Math.random() * 0.4).toFixed(2) + ';animation:cs-twk ' + (2 + Math.random() * 2).toFixed(1) + 's ease-in-out ' + (Math.random() * 3).toFixed(1) + 's infinite"></div>';
      }
      sky.innerHTML = html; sky.dataset.built = '1';
    }

    // build full-spectrum aurora curtains into .cs-aurora
    const aur = hist.querySelector('.cs-aurora');
    if (aur && !aur.dataset.built) {
      const palettes = [
        ['#39FF7A', '#36e0ff', '#ff6bd0', 'transparent'],
        ['#52ffa0', '#b06bff', 'transparent'],
        ['#36c9ff', '#ff7ad0', '#9b5cff', 'transparent'],
        ['#39FF7A', '#ffd24a', '#ff6bd0', 'transparent'],
      ];
      const base = 0.40; let html = ''; const N = 9;
      for (let i = 0; i < N; i++) {
        const stops = palettes[i % palettes.length];
        const x = 4 + (W - 8) * (i + 0.5) / N + (Math.random() * 14 - 7);
        const w = 14 + Math.random() * 22;
        const o0 = (base * (0.6 + Math.random() * 0.5)).toFixed(2), o1 = (base * (0.95 + Math.random() * 0.4)).toFixed(2);
        const sx = (Math.random() * 16 - 8).toFixed(0) + 'px', scx = (0.9 + Math.random() * 0.25).toFixed(2);
        const dur = (7 + Math.random() * 6).toFixed(1), shdur = (3 + Math.random() * 3).toFixed(1);
        const n = stops.length; let g = 'linear-gradient(to top';
        stops.forEach((c, j) => { const pos = Math.round(j / (n - 1) * 100); const a = c === 'transparent' ? '' : (j === 0 ? 'cc' : j === 1 ? '99' : '66'); g += ', ' + c + a + ' ' + pos + '%'; });
        g += ')';
        html += '<div class="cs-curtain" style="left:' + x.toFixed(0) + 'px;width:' + w.toFixed(0) + 'px;background:' + g + ';--sx:' + sx + ';--scx:' + scx + ';--o0:' + o0 + ';--o1:' + o1 + ';opacity:' + o0 + ';animation:cs-sway ' + dur + 's ease-in-out infinite, cs-shimmer ' + shdur + 's ease-in-out infinite"></div>';
      }
      html += '<div style="position:absolute;left:0;right:0;top:44%;height:38%;background:radial-gradient(120% 80% at 50% 100%, #39FF7A22, transparent 70%);filter:blur(8px)"></div>';
      aur.innerHTML = html; aur.dataset.built = '1';
    }

    // place the satellite (emoji on Apple, SVG twin elsewhere)
    const satEl = hist.querySelector('.cs-sat');
    if (satEl && !satEl.dataset.built) {
      satEl.innerHTML = IS_APPLE ? '🛰️' : SAT_SVG;
      satEl.dataset.built = '1';
    }

    // the flying shuttle (rotated 90° so the nose points right)
    ship.innerHTML = '<div style="transform:rotate(90deg);transform-origin:center center">' + SHUTTLE_HTML + '</div>';
    ship.style.top = (LINE_Y - 27) + 'px';

    // smoke SVG layer
    let svg = smoke.querySelector('svg');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%');
      smoke.appendChild(svg);
    }
    const slots = {};
    const moonCx = W - 21, ZONE_HALF = 18, FAST = 1.0, SLOW = 0.13;
    const ensurePuff = (x) => {
      const slot = Math.round(x / SLOT);
      const inMoon = Math.abs(x - moonCx) <= ZONE_HALF;
      if (slots[slot]) { const e = slots[slot]; e.freshAt = performance.now(); e.fast = inMoon; e.el.forEach(n => n.setAttribute('opacity', '0.7')); return; }
      const nodes = []; const n = 2 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const c = document.createElementNS(NS, 'circle'); const r = 2.2 + Math.random() * 2.6;
        c.setAttribute('cx', (slot * SLOT + (Math.random() * 2.4 - 1.2)).toFixed(1));
        c.setAttribute('cy', (LINE_Y + (Math.random() * 3.4 - 1.7)).toFixed(1));
        c.setAttribute('r', r.toFixed(1)); c.setAttribute('fill', '#cfd4da'); c.setAttribute('opacity', '0.7');
        c.setAttribute('style', 'filter:blur(0.4px)');
        svg.appendChild(c); nodes.push(c);
      }
      slots[slot] = { el: nodes, freshAt: performance.now(), fast: inMoon };
    };

    let x = -40, raf = 0; const speed = 1.1, xRight = W - 2, xWrap = W + 40;
    const tick = () => {
      const now = performance.now();
      x += speed; if (x > xWrap) x = -40;
      ship.style.transform = 'translate(' + (x - 19) + 'px,0)';
      const layX = x - 12; if (layX >= X0 && layX <= xRight) ensurePuff(layX);
      for (const k in slots) {
        const pf = slots[k]; const age = (now - pf.freshAt) / 1000;
        const rate = pf.fast ? FAST : SLOW, floor = pf.fast ? 0.0 : 0.16;
        const op = Math.max(0.7 - age * rate, floor);
        pf.el.forEach(n => n.setAttribute('opacity', op.toFixed(2)));
        if (pf.fast && op <= 0.02) { pf.el.forEach(n => n.remove()); delete slots[k]; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // v2.2.0 worker-name fix: long bc1q… users blew out the grid column (grid
  // items default min-width:auto). Middle-truncate so the address head and
  // .SUFFIX both stay visible; full string on long-press via title.
  const wFull = (worker.displayName || worker.name || '').toString();
  const wShort = wFull.length > 22 ? wFull.slice(0, 9) + '…' + wFull.slice(-9) : wFull;

  return (
    <div className="cs-card">
      <div className="cs-main">
        <div className="cs-head">
          {GLYPH_SRC ? <img className="cs-glyph" src={GLYPH_SRC} alt="" /> : null}
          <div className="cs-title">{tt('Strike Force')}</div>
          <div className="cs-prov"><i />{String(providerLabel).toUpperCase()}</div>
          <div className="cs-sp" />
          <div className="cs-badge">{tt('live')}</div>
        </div>

        <div className="cs-hl">
          <span className="cs-big">{ascentPct > 0 ? Math.round(ascentPct) + '%' : '—'}</span>
          <span className="cs-cap">{tt('close to reward')}</span>
        </div>
        {rewardBtc != null && (
          <div className="cs-sub">{tt('potential block reward')} <b>{rewardBtc.toFixed(4)} BTC</b></div>
        )}

        <div className="cs-hist" ref={histRef}>
          <div className="cs-aurora" />
          <div className="cs-sky" />
          <div className="cs-net" />
          <div className="cs-netlbl">{tt('network difficulty')} {fmtDiff(netDiff)}</div>
          <div className="cs-smoke" ref={smokeRef} />
          <div className="cs-shipwrap"><div className="cs-ship" ref={shipRef} /></div>
          <div className="cs-moon"><img src={MOON_SRC} alt={tt('network difficulty')} /></div>
          <div className="cs-sat" aria-hidden="true" />
          <div className="cs-vp" ref={vpRef}><div className="cs-inner" ref={innerRef} /></div>
        </div>

        <div className="cs-lgnd">
          <span className="cs-lg"><i style={{ background: '#8b9098' }} />{tt('share difficulty')}</span>
          <span className="cs-lg"><i style={{ background: 'var(--amber)' }} />{tt('best · close to reward')}</span>
          <span className="cs-lg"><i style={{ background: 'transparent', borderTop: '2px dashed var(--text-1)', height: 0, width: 9 }} />{tt('network difficulty')}</span>
        </div>
      </div>

      <div className="cs-ledger">
        <div className="cs-grid">
          <div className="cs-kv"><span className="k">{tt('Network diff')}</span><span className="v">{fmtDiff(netDiff)}</span></div>
          <div className="cs-kv"><span className="k">{tt('Best share')}</span><span className="v am">{fmtDiff(best)}</span></div>
          <div className="cs-kv"><span className="k">{tt('To block')}</span><span className="v">{fmtPctToBlock(pctToBlock)}</span></div>
          <div className="cs-kv"><span className="k">{tt('Shares accepted')}</span><span className="v">{accepted.toLocaleString()}</span></div>
          <div className="cs-kv"><span className="k">{tt('Strike rate')}</span><span className="v">{strikeRate != null ? strikeRate + ' /min' : '—'}</span></div>
          <div className="cs-kv"><span className="k">{tt('Worker')}</span><span className="v" title={wFull} style={{ fontSize: '0.58rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: '1 1 auto', minWidth: 0, textAlign: 'right', marginLeft: '0.4rem' }}>{wShort}</span></div>
        </div>

        <div className="sf-divider"><i /><span>{tt('rental telemetry')}</span><i /></div>
        <div className="cs-grid">
          <div className="cs-kv"><span className="k">{tt('Rental firepower')}</span><span className="v">{fmtHr(rentalHr)}</span></div>
          <div className="cs-kv"><span className="k">{tt('Pool share')}</span><span className="v cy">{poolPct != null ? poolPct.toFixed(1) + '%' : '—'}</span></div>
        </div>
        <div className="sf-odds"><span className="k">{tt('Block odds · this hour')}</span><span className="v">{fmtOneIn(hourP)} <small>{tt('at current rate')}</small></span></div>

        <div className="sf-divider"><i /><span>{tt('value accounting · what your sats bought')}</span><i /></div>
        <div className="cs-grid">
          <div className="cs-kv"><span className="k">{tt('Session')}</span><span className="v">{fmtDur(elapsedMs)}</span></div>
          <div className="cs-kv"><span className="k">{tt('Work delivered')}</span><span className="v">{fmtHashes(workHashes)}</span></div>
          <div className="cs-kv"><span className="k">{tt('Delivered avg')}</span><span className="v gr">{fmtHr(deliveredAvg)}</span></div>
          <div className="cs-kv"><span className="k">{tt('Wasted (rejects)')}</span><span className="v">{(accepted + rejected) > 0 ? wastedPct.toFixed(1) + '%' : '—'}</span></div>
        </div>
        <div className="sf-odds"><span className="k">{tt('Session odds · accumulated')}</span><span className="v">{fmtOneIn(sessP)} <small>{tt('so far')}</small></span></div>
        <div className="sf-odds"><span className="k">{tt('EV of work delivered')}</span><span className="v ev">{evSats > 0 ? '≈ ' + Math.round(evSats).toLocaleString() + ' sats' : '—'} {evFiatStr ? <small>({evFiatStr})</small> : null}</span></div>

        {topStrikes.length > 0 && (
          <>
            <div className="sf-divider"><i /><span>{tt('top strikes · session')}</span><i /></div>
            <div className="sf-top">
              {topStrikes.map((s, i) => (
                <div key={i} className={'sf-row' + (i === 0 ? ' first' : '')}>
                  <span className="sf-rank">#{i + 1}</span>
                  <span className="sf-track"><i style={{ width: s.pct.toFixed(1) + '%' }} /></span>
                  <span className="sf-val">{fmtDiff(s.d)}</span>
                  <span className="sf-pct">{Math.round(s.pct)}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Wrapper: renders a Strike Force card for every online rented/Braiins worker,
// newest-best first. Returns null (renders nothing) when none are active, so it
// naturally disappears from the top of the card list when no rental is hashing.
export function StrikeForceCards({ workers, network, blockReward, fiatPrice, currency, t, GLYPH_SRC }) {
  const list = Array.isArray(workers) ? workers : [];
  // Σ live hashrate of the whole fleet → denominator for "Pool share".
  const poolHashrate = list.reduce((s, w) => s + ((w && w.hashrate) || 0), 0);
  const rented = list.filter((w) => {
    if (!w || w.status === 'offline') return false;
    // v2.1.1: only workers on the high-diff rental port (>4000, i.e. 4334)
    // qualify. Owned miners — even on Braiins OS — never trigger the card.
    const port = w.shareEvents && w.shareEvents.port;
    if (!port || port <= 4000) return false;
    const v = (w.minerVendor || '').toString().toLowerCase();
    return v === 'rented' || v === 'braiins';
  });
  if (!rented.length) return null;
  rented.sort((a, b) => ((b.shareEvents && b.shareEvents.bestSinceReset) || 0) - ((a.shareEvents && a.shareEvents.bestSinceReset) || 0));
  return (
    <>
      <style>{CSS}</style>
      {rented.map((w) => (
        <StrikeForceCard key={w.name} worker={w} network={network} blockReward={blockReward} poolHashrate={poolHashrate} fiatPrice={fiatPrice} currency={currency} t={t} GLYPH_SRC={GLYPH_SRC} />
      ))}
    </>
  );
}

export default StrikeForceCards;
