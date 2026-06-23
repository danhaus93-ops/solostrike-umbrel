// StrikeForceCard.jsx — animated sky scene (Strike Force rental card)
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

const F22_VB = '34 -219 867 1142';
const F22_SYMBOL = `<path fill="#181e22" d="m467-173 14 15q8 11 11 24l9 29 8 40 4 29 2 16 1 10 1 14 2 16 1 31v17l1 12q-1 8 3 14l-2 1q-5-6-4-13a1112 1112 0 0 0-18-175l-2-9 2-2h-2q-7-26-18-49-5-9-13-16-9 9-15 20-10 23-15 45h-2l1 2-4 17q-13 69-15 140l-1 36q-5 3-6 7v5l-1 2v-7l-32 26-1-2-1 4q-7 5-12 12l-2 12-3 2 2-15 10-10 14-13 25-21q4-2 4-5l2-47 3-44 3-26 4-30 4-25 14-51a127 127 0 0 1 16-31l3-4z"/><path fill="#b2b2b2" d="M467-169q8 7 13 16 11 23 18 49l-10 10-11-8-10 8-10-8-10 8-10-10q5-22 15-45 6-11 15-20"/><path fill="#060606" d="M498-104h2l-2 2-4 4 9 56 1 15 7 89 2 40 11 10V96l-2-2 3-1 23 20 16 14 10 10q2 6 2 14l1 6-3 1-6-5-17-15v11q6 4 7 9l1 20-17 16-15-8v-15l23-22v-13l-24-21v24l-1 8-10 13 1 33 4 3 5-3 4 4 5-4 5 5 6-4 4 3 1-5 5 3 5-3 4 3 11-9 2 1v1q-4 0-4 4v97l24 23 4 5-27-26 1 120v94-1q-2-3-6-2h-18v33l-2 2v-49q0-4-5-7l-5 4-4-3-6 4-4-4-5 3-4-3-6 4-4-4-5 4-5-4-5 4-4-4q-4 2-4 5l2 160 20 16 2-2 5-2-7 6-21-16-5 4v-2l4-3v-72l-8-7-8 7-8-7c-3 3-8 5-7 10l-1 55v13l-3 3-19 15-17-16-16 13-2-1v-1 1q10-6 18-14l17 16 20-15 2-163-4-3-4 4-5-4-5 4-4-4-5 4-5-4-5 3-5-3-4 4-5-4-5 3-5-4-5 5v59l1 10 4 17-2 2-2-11-79 69v20q3 2 5 6l-5-4 1 4 61 50 13 13q2 2 1 5l-4 28 6 5 1 3-7-6-3 13v1h-3l1-3 2-13-70-59v-29l-1-7-8-6v-24l-31-11q-2-2-1-5h1v3l30 11 3-3 2-2 5-5 2-2 44-40v-86l2 1v83l12-11v-49l-7-9 2-213-28 26 1-2 27-26 1-97q-1-4-4-6l-3-1v-2l3-26v-5l3-2 15-12-1-12 1-4 1 2v7l32-26 1-2 1 9 10-10 3-51 6-85 1-7 9-57-4-4-1-2h2l10 10 10-8 10 8 10-8 11 8zm-5 7-4 4v69l13-14-6-41-1 5-4-5 1-2 2 3-1-3-1-2q0 3-2 4v-7l5 4zm-16-4q-4 5-10 9l-9-9-11 8v70l19-18h2l19 18v-69zm19 22q0-1 0 0m-54-18-3 15 5-5 1 4q-1 5-5 9l-1-5-7 41 14 14v-68zm60 61-13 14 10 42 1 10 2 42 7-8 1-5zm-59-47q-3 2-2 5 2-2 2-5m24 43-17 16-3 4-10 39-1 5-2 47 1 9 4 43 1 4 27 22 28-24 5-51-1-48-1-8-11-39zm-35 4-8 98 9 10 1-43 1-9 11-42zm78 101-9 9-4 53v66l4 4 5-5 4 5 5-4zm49 61v12l14 12-1-12q-6-7-13-12m-33-28-1 6 32 27v-7zm26 30-1 5q2 5 6 8v-8zm-26-21v6l24 21v-7zm34 34v2l12 9zm-47-37 1 39 10-11v-18zm15 67v13l29-25q-1-5-6-9zm28-9-27 24 12 7 17-15zm-32-28-9 12v11l9-10zm47 57-6 6-5-3-5 3-4-2-2 72 5-5 5 5 5-5 3 5q4-4 5-9zm-76-63-14 12-11 19 4 6q12-10 22-21zm-70-63-5 128 4 4 4-5 5 5 4-4v-66l-4-53zm71 82-21 20v27l3-2 4 5 5-4 5 4 4-4zm49 49-6 3-5-4-5 4-4-4-5 3-3-2-1 3v35q1 3 4 4l5-4 4 5 6-4 4 3 5-4 3 3 2-38zm-68-53-10 7-9-6 9 15-6 8v19l-1 9 2 1 5-3q3 0 5 4l2-2v-28l-6-8zm38 52-5 4-4-5-5 5-4-4-6 4-4-4-4 3v40l4-3 5 4 5-4 4 4 5-5 5 5 4-4zm-94-90-11 9v16q0 3 4 6l-1 1-3-3 1 12 8 11 1-11-7-8h2l5 5 1-34zm18 23v16l21 21 5-6-11-19zm108 109-3-1-5 4-4-4-6 5-4-5-5 4-4-3-6 3-4-4-5 5-5-4-4 4-5-4-4 3v103l4-3 5 4 4-4 5 4 5-5 4 5 6-4 4 3 5-4 4 5 6-4 4 3 6-5q-1-50 2-101m25 27-5 5-3-4-5 4-5-5c-2 2-4 7-7 3v73l4-5 7 6 6-7 5 3v70l4 4v-39zM409 107l-24 20v7l24-21zm0 8-24 21v13l23 22v16l-15 7-17-16 1-20c-1-4 4-6 6-9v-11l-22 19-3 25 1 3 11 10 4-3 5 3 6-3v5l4-3 7 4 5-5 4 4 4-4 5 3 4-3 1-33q-4-7-10-13zm30 32v46l4 4 4-4 5 4 4-4q2-2 3 1v-27zm39 47-6 4-5-4-5 4-5-4q-3 2-4 6v38l4-4 5 4 6-3 4 3 6-4 3 4v-40zm-95-66-6 6v7l6-6zm64 67-4 4-5-4-5 4-5-5-4 5-4-4v40l4 4 4-5 5 5 5-4 5 4 4-4 5 3v-40zm30 41-5 4-5-4-5 4-5-4-4 4v103l4-4 5 4 6-3 4 3 6-4 3 4V242q0-4-4-6m-102-95-13 11-1 3 12-11q3-2 2-3m9 9-6 6q-1 3 1 5l27 23v-13zm180 186-5 7-8-6-4 5 2 60 7-8 12 12v-68zM418 195l-4 3-4-4-5 5-4-4-5 4-7-3-3 3 2 37 2-2 5 4 4-3 6 4 4-4 6 3 3-4zm-40-33-1 16 16 15 13-7zm69 74-4 5-5-4-5 4-5-5-4 5-5-4-5 3-4-4-5 5-5-5-5 4-5-4-2 2q2 49 1 100l6 5 4-3 6 4 4-5 5 4 5-3 5 4 4-5 5 5 5-4 5 4 4-4 4 3 1-103zm97 105-5 4-4-4-6 5-4-5-5 4-4-3-6 3-4-4-5 5-5-4-5 4-4-4-5 4-5-5-5 4-5-4-5 4-5-4-5 5-5-4-4 4-5-4-5 4-5-5-4 5-5-4-5 3-4-4-5 5-5-5-5 4-5-4-1 3-2 58 7 8 5-4 6 4 4-4 5 3 5-3 5 4 4-5 5 5 5-4 5 4 4-4 5 4 5-5 5 4 5-3 5 3 6-4 4 5 5-4 5 4 5-4 4 4 5-5q2 4 5 4l4-3 5 3 5-3 5 4 5-5 5 5 7-7-2-56zM384 195l-5 2-5-3-4 3-6-6-1 67q0 5 4 9l3-5 6 5 4-5 5 5q3-1 2-4zm156 217v28l34 30-1-53q1-3-1-5-7-8-16-15zm-5-5-6 5-4-5-5 4-4-3-6 4-4-5-5 5-5-4-5 4-4-4-4 3v39l1 33 3-3 4 4 5-4 5 4 5-4 4 4 6-4 4 4 5-4 4 4 6-4 4 4 5-5 5 5v-34l-10-9v-30zM387 267l-2 2-5-5-5 5-5-4-3 4-4-5v4l-3 232h23l1-42v-9l10-9v-28l-28-33-1-6v-36l5-3v-41l7-7 8 8v10l-1 32 4 4zm164 185v48h23v-25l-1-4zM377 288l-6 6v39q1 4 5 7l7-5v-41zm100 119-5 4-5-4-5 4-5-4q-3 2-4 6v37l4 4 5-5 5 5 5-5 5 5 5-4-1-39zm-94-70-7 6-6-7q-3 1-3 4v37l18 23q2-5 1-11l2-44q-1-5-5-8m60 75-5-4-5 4-4-5-5 5-5-4-5 3-4-4-5 5-5-5-5 4 1 30-11 9v34l5-5 5 4 5-3 5 4 4-4 5 4 5-4 5 4 5-4 4 4 5-4 5 4 4-4 4 3v-11l1-61-5-3zm39 40-5 4-5-5-4 5q-4-1-6-5l-5 5-4-4v32l4-5 5 5 5-4 5 4 5-4 5 4zm-5 29-5 5-5-4-5 4-5-5q-4 3-5 7v86l7-7 8 7 8-7 7 7 1-7-1-79q-1-4-5-7m-116 21-1 2 8 9v47l14-12 2 1v-47zm20 49-81 76v24l5 4 1-2v-22l79-70zm-23 152-51-41v32l69 58q4-14 4-29z"/><path fill="#b2b2b2" d="m498-102 2 9q7 32 11 64 6 60 7 120l4 3 2 2v16l-11-10-2-40-7-89-1-15-9-56zm-5 5 2 15-5-4v7q3-1 2-4l1 2 1 3-2-3-1 2 4 5 1-5 6 41-13 14v-69zm-16-4 10 9v69l-19-18h-2l-19 18v-70l11-8 9 9q6-4 10-9"/><path fill="#717171" d="M496-79q0-1 0 0"/><path fill="#b2b2b1" d="m436-102 4 4-9 57-1 7-6 85-3 51-10 10-1-9v-5q1-4 6-7l1-36q2-71 15-140z"/><path fill="#b2b2b2" d="m442-97 4 5v68l-14-14 7-41 1 5q4-4 5-9l-1-4-5 5zm60 61 8 95-1 5-7 8-2-42-1-10-10-42z"/><path fill="#3c3d3b" d="M443-83q1 3-2 5-1-3 2-5"/><path fill="#b2b2b2" d="m467-40 20 19 11 39 1 8 1 48-5 51-28 24-27-22-1-4-4-43-1-9 2-47 1-5 10-39 3-4zm0 9-15 12-5 7-8 37-1 8a571 571 0 0 0 5 84q2 5 7 9l17 14q13-8 23-20 5-10 6-21 2-35 0-71l-9-40-5-7zm0 2q10 6 16 14 4 3 4 8-8-11-20-20l-16 15-4 9q0-6 3-11zm-35-7 14 14-11 42-1 9-1 43-9-10zm78 101 5 128-5 4-4-5-5 5-4-4v-66l4-53z"/><path fill="#b3b3b2" d="M559 126q7 5 13 12l1 12-14-12z"/><path fill="#b2b2b2" d="m526 98 31 26v7l-32-27z"/><path fill="#b3b3b1" d="m552 128 5 5v8q-4-3-6-8z"/><path fill="#b2b2b2" d="m526 107 24 20v7l-24-21zm34 34 12 11q3 1 2 3z"/><path fill="#191e21" d="m577 157 4 46 9 91q1 3 4 5l254 226q4 2 4 5v60l-11 11-21 19-15 13-10 4-25 8-32 11-13 4-1-2 77-26q0 2 2 1l1-3 45-40v-29l1-8q2-2-1-4v-20L615 322l-3-3v-3l-3 1-19-18-3-3-10-108v-1l-2-1q2-1 1-3l-2-25z"/><path fill="#b2b2b2" d="m551 138 17 15 6 5 2 25q1 1-1 3l-11 9-4-3-5 3-5-3-1 5-4-3-6 4-5-5-5 4-4-4-5 3-4-3-1-33 10-13 1-8v-24l24 21v13l-23 22v15l15 8 17-16-1-20q-1-5-7-9zm-38-34 11 10v18l-10 11zm15 67 23-21q4 4 6 9l-29 25zm28-9 2 16-17 15-12-7zm0 5-5 4-10 9-6 5 6 4 15-14zm-32-33v13l-9 10v-11z"/><path fill="#0c0c0c" d="M556 167v8l-15 14-6-4 6-5-3 5 2 2 15-14-1-2-10 8 7-8z"/><path fill="#b2b2b2" d="M573 192q0-4 4-4l10 108 3 3 19 18 1 7-13-12-24-23z"/><path fill="#3c3c3b" d="m554 171 1 2-15 14-2-2 3-5 10-9-7 8z"/><path fill="#b2b2b2" d="m571 191 1 67q-1 5-5 9l-3-5-5 5-5-5-5 5-2-4 4-68 4 2 5-3 5 3zm-76-63 1 16q-10 11-22 21l-4-6 11-19zm-70-63 8 9 4 53v66l-4 4-5-5-4 5-4-4zm71 82v46l-4 4-5-4-5 4-4-5-3 2v-27zm49 49 4 3-2 38-3-3-5 4-4-3-6 4-4-5-5 4q-3-1-4-4v-35l1-3 3 2 5-3 4 4 5-4 5 4z"/><path d="m496 28-9-40-5-7-15-12-15 12-5 7-8 37-1 8a571 571 0 0 0 5 84q2 5 7 9l17 14q13-8 23-20 5-10 6-21 2-35 0-71m-56 56v-1zm27-111-16 15-4 9q0-5 3-11l17-15q10 6 16 14 4 3 4 8-8-11-20-20m24 37v1zm3 19"/><path fill="#b2b2b2" d="m477 143-9 16 6 8v28l-2 2q-2-4-5-4l-5 3-2-1 1-9v-19l6-8-9-15 9 6zm38 52v40l-4 4-5-5-5 5-4-4-5 4-5-4-4 3v-40l4-3 4 4 6-4 4 4 5-5 4 5zm-10 4-4 4-4-4-4 3-4-2-3 2v25l4 4 5-3 3 3 3-2 4 4q4-3 4-7v-19q0-4-4-8m110 123 234 207v20l-21-18v-9h-4L612 334v-15zM421 105v4l-1 34-5-5h-2l7 8-1 11-8-11-1-12 3 3 1-1-4-6v-16zm18 23 15 12 11 19-5 6-21-21zm-62-4 32-26v7l-32 26zm170 113q-2 50-2 101l-6 5-4-3-6 4-4-5-5 4-4-3-6 4-4-5-5 5-5-4-4 4-5-4-4 3V240l4-3 5 4 4-4 5 4 5-5 4 4 6-3 4 3 5-4 4 5 6-5 4 4 5-4z"/><path fill="#1e1e1b" d="M505 199q4 4 4 8v19q0 4-4 7l-4-4-3 2-3-3-5 3-4-4v-25l3-2 4 2 4-3 4 4zm0 3-4 4-4-4-4 2-4-3-2 2v21l3 5 5-3 3 2 4-1 3 3 3-4v-19z"/><path fill="#b2b2b2" d="m572 264 1 108v39l-4-4v-70l-5-3-6 7-7-6-4 5v-73c3 4 5-1 7-3l5 5 5-4 3 4z"/><path fill="#010101" d="M824 522h4v9l21 18q3 2 1 4l-21-18-1 39q1 3-1 6l-19 26-1-2 20-25-12-9v-20l12 10v-23l-2-2 2-1-133-118 13 13 116 102-2 1-9-9-121-106-82-72-10 10 19 19-16 17v78l-20 20v85l-2-1h1v-83q-1-2 3-5l16-16v-78l-20-20 27-26 3-4v-15l-9-9-4-5 13 12-1-7 3-1v18zm0 1L613 336l-1 5 215 188v-6zM624 355l17 15 51 46q-2-4-6-7zm-12-11h-2l11 10 1-1zm205 209v16l10 8v-15zM597 356l-15 15 19 19 15-16z"/><path fill="#6f6f6f" d="m505 202 3 5v19l-3 4-3-3-4 1-3-2-5 3-3-5 2-23 4 3 4-2 4 4z"/><path fill="#b2b2b2" d="M824 523h3v6L612 341l1-5zM409 107v6l-24 21v-7zm420 428 21 18-1 8v29l-45 40-1-17q1-4 5-7-2 0-5 3l1-49 11-14q4-7 11-12-1-3-4-2l-11 15-11 11-174 57-44-41v-85l20-20v-78l16-17-19-19 10-10 82 72 121 106 9 9 2-1-116-102-13-13 133 118-2 1 2 2v23l-12-10v20l12 9-20 25 1 2 19-26q2-3 1-6zM409 115v32q6 6 10 13l-1 33-4 3-5-3-4 4-4-4-5 5-7-4-4 3v-5l-6 3-5-3-4 3-11-10-1-3 3-25 22-19v11c-2 3-7 5-6 9l-1 20 17 16 15-7v-16l-23-22v-13zm30 32 20 20v27q-1-3-3-1l-4 4-5-4-4 4-4-4z"/><path fill="#020202" d="M822 532q3 0 4 2-7 5-11 12l-11 14-1 49q3-3 5-3-4 3-5 7v20q-2 1-2-1v-19l-77 26v19l1 2-3 1-2-2h2l-1-19-83 28v-2l83-28v-33l-1-11-1 8-12 3-1-5-3 1v5l-30 11v-6l-3 2h-1l-33 11-3-2 90-31 1 22 38-14v-7l34-12v7l5-2v-24l-124 41-49 15-2-2 174-57 11-11zm-23 55-74 26q-2 3-1 5l77-26c-1-2 1-6-2-5m-5-5-31 11v5l32-11zm-70 38v17l77-25v-19zm-7-24-9 3v4l10-2zm-16 6-27 9v4l27-10z"/><path fill="#b2b2b2" d="m478 194 3 4v40l-3-4-6 4-4-3-6 3-5-4-4 4v-38q0-4 4-6l5 4 5-4 5 4zm123 123 9 9v15l-3 4-27 26 20 20v78l-16 16q-4 3-3 5v83l-13-11v-49l7-8v-94l-1-120zm23 38 62 54q4 3 6 7l-51-46z"/><path fill="#6c6c6c" d="m612 344 10 9-1 1-11-10z"/><path fill="#b2b2b2" d="m817 553 10 9v15l-10-8z"/><path fill="#b4b4b4" d="M383 128v7l-6 6v-7z"/><path fill="#b2b2b2" d="m447 195 5 3v40l-5-3-4 4-5-4-5 4-5-5-4 5-4-4v-40l4 4 4-5 5 5 5-4 5 4zm-2 5-4 2-4-3-3 5-5-5-4 8v19q1 4 4 7l4-4 3 2 4-3 4 3 5-4v-25z"/><path fill="#b2b2b1" d="M363 138q5-7 12-12l1 12-15 12z"/><path fill="#1e1e1b" d="m445 200 4 2v25l-5 4-4-3-4 3-3-2-4 4q-3-3-4-7v-19l4-8 5 5 3-5 4 3zm-4 4-3-2-4 4-5-4-2 5v19l2 4 5-4 2 3 3-3 5 3 3-3v-23c-2-3-4 1-6 1"/><path fill="#6f6f6f" d="M441 204c2 0 4-4 6-1v23l-3 3-5-3-3 3-2-3-5 4-2-4v-19l2-5 5 4 4-4z"/><path fill="#b2b2b2" d="M477 236q4 2 4 6v101l-3-4-6 4-4-3-6 3-5-4-4 4V240l4-4 5 4 5-4 5 4zm120 120 19 18-15 16-19-19zm80 246 124-41v24l-5 2v-7l-34 12v7l-38 14-1-22-90 31-5-5zM375 141q1 2-2 3l-12 11 1-3zm9 9 22 21v13l-27-23q-2-2-1-5zm180 186 4 2v68l-12-12-7 8-2-60 4-5 8 6zM418 195v39l-3 4-6-3-4 4-6-4-4 3-5-4-2 2-2-37 3-3 7 3 5-4 4 4 5-5 4 4zm-40-33 28 24-13 7-16-15zm1 5-1 8 16 14 5-4z"/><path fill="#191919" d="m379 167 20 18-5 4-16-14zm2 4q-2 2-1 3l14 13 2-2z"/><path fill="#b2b2b2" d="M799 587c3-1 1 3 2 5l-77 26q-1-2 1-5z"/><path fill="#3c3c3c" d="m381 171 15 14-2 2-14-13q-1-1 1-3"/><path fill="#b2b2b2" d="m794 582 1 5-32 11v-5zM447 236l5 4v103l-5-3-4 4-5-4-5 4-5-5-4 5-5-4-5 3-5-4-4 5-6-4-4 3-6-5q1-51-1-100l2-2 5 4 5-4 5 5 5-5 4 4 5-3 5 4 4-5 5 5 5-4 5 4zm277 384 77-27v19l-77 25zM544 341l1 6 2 56-7 7-5-4-5 4-5-4-5 3-5-3-4 3q-2 0-5-4l-5 5-4-4-5 4-5-4-5 4-4-5-6 4-5-3-5 3-5-4-5 5-5-4-4 4-5-4-5 4-5-5-4 5-5-4-5 3-5-3-4 4-6-4-5 4-7-8 3-61 5 4 5-4 5 5 5-5 4 4 5-3 5 4 4-5 5 5 5-4 5 4 4-4 5 4 5-5 5 4 5-4 5 4 5-4 5 5 5-4 4 4 5-4 5 4 5-5 4 4 6-3 4 3 5-4 4 5 6-5 4 4zm-15 14-7 7-6-6-6 6-5-5-6 6-7-7-1 34 8 7 6-6 5 5 7-7 6 6 7-7zm-86 1-8 7-5-6-5 5-7-6-6 6-7-7v33l6 7 6-6 7 7 5-5 6 6 8-7zm-59-161 1 72-5-5-4 5-6-5-3 5q-4-4-4-9l1-67 6 6 4-3 5 3zm340 444 77-26v19l-77 26z"/><path fill="#040404" d="m529 355 1 33-7 7-6-6-7 7-5-5-6 6-8-7 1-34 7 7 6-6 5 5 6-6 6 6zm-1 4-6 5-6-6-6 6-5-4-6 5-6-6v8l6 6 6-6 6 5 6-6 6 6 5-5zm0 11-5 4-6-6-6 6-6-5-6 6-6-6v8l6 6 6-6 6 6 6-6 6 6 5-6zm0 10-5 5-6-6-6 6-6-5-6 5-6-6v10l6 6 6-6 5 5 7-7 6 6 5-5z"/><path fill="#b2b2b2" d="M358 186q3 2 4 6l-1 97-27 26-9 9v-7l18-16q4-2 4-6z"/><path fill="#191e20" d="m355 185 3 1-11 109q-1 4-4 6l-18 16-3-1v3L85 529v20q-2 2 0 4v37l34 30 12 10v4q-10-7-17-15l-24-21-8-8v-60q2-4 6-7l26-23 26-23 24-21 19-17 13-12 15-13 20-18 23-20 11-10 17-15 13-11 15-14 17-15 16-14q3-2 2-5l3-32 2-26 3-28z"/><path fill="#575757" d="M528 359v8l-5 5-6-6-6 6-6-5-6 6-6-6v-8l6 6 6-5 5 4 6-6 6 6z"/><path fill="#b2b2b2" d="m540 412 16-15q9 7 16 15 2 2 1 5l1 53-34-30zm18-4-15 12v11l14 14 14-13v-11z"/><path fill="#575757" d="M528 370v7l-5 6-6-6-6 6-6-6-6 6-6-6v-8l6 6 6-6 6 5 6-6 6 6z"/><path fill="#151515" d="m558 408 13 13v11l-14 13-14-14v-11zm0 3-12 9q-2 2-1 6-1 3 1 5l11 11 12-11v-9z"/><path fill="#3c3c3c" d="m558 411 11 11v9l-12 11-11-11q-2-2-1-5-1-4 1-6z"/><path fill="#575757" d="M528 380v8l-5 5-6-6-7 7-5-5-6 6-6-6v-10l6 6 6-5 6 5 6-6 6 6z"/><path fill="#b2b2b2" d="m535 407 4 4v30l10 9v34l-5-5-5 5-4-4-6 4-4-4-5 4-4-4-6 4-4-4-5 4-5-4-5 4-4-4-3 3-1-33v-39l4-3 4 4 5-4 5 4 5-5 4 5 6-4 4 3 5-4 4 5zm185 187 1 11v33l-83 28-1-13 1-2v-21l2-2 28-10q3-1 2-5l3-2v6l30-11v-5l3-1 1 5 12-3zm-3 2 1 5-10 2v-4zM387 267l1 73-4-4 1-32v-10l-8-8-7 7v41l-5 3v36l1 6 28 33v28l-10 9v9l-1 42h-23l3-232v-4l4 5 3-4 5 4 5-5 5 5zm164 185 22 19 1 4v25h-23zm150 150v3l-27 10v-4z"/><path fill="#3c3c3c" d="m377 288 6 6v41l-7 5q-4-3-5-7v-39z"/><path fill="#1a1a19" d="M443 356v34l-8 7-6-6-5 5-7-7-6 6-6-7v-33l7 7 6-6 7 6 5-5 5 6zm-2 4-6 5-5-5-5 5-7-7-6 6-5-5v8l4 5 7-6 6 6 5-5 6 6 6-6zm0 9-6 6-5-6-6 6-6-6-6 5-5-4v7l5 5 6-5 6 6 5-6 6 6 6-6zm0 11-5 5-6-5-6 5-6-6-7 6-4-5v6c-1 3 3 5 4 7l6-6 7 6 5-5 7 7 5-6z"/><path fill="#575757" d="M441 360v7l-6 6-6-6-5 5-6-6-7 6-4-5v-8l5 5 6-6 7 7 5-5 5 5z"/><path fill="#b2b2b2" d="m638 668 83-28 1 19h-2l-82 28z"/><path fill="#575757" d="M441 369v8l-6 6-6-6-5 6-6-6-6 5-5-5v-7l5 4 6-5 6 6 6-6 5 6z"/><path fill="#b2b2b2" d="M569 502q4-1 6 2-5 4-8 9l-1 46-13-11-2 1v-47zm-10 16-5 5v10l4 4 4-5q2-8-3-14m-82-111 4 4 1 39-5 4-5-5-5 5-5-5-5 5-4-4v-37q1-4 4-6l5 4 5-4 5 4z"/><path fill="#1a1d1d" d="M575 504v1l-7 8v49l13 11h-1l2 1 44 41 2 2 5 5 3 2 2 3 30-11 1-3h1q1 4-2 5l-28 10-2 2v21h-4l1-24-82-76-4 10h-1v3q-7 54-4 108l1 45 2 1-1 1-1 1q-1 20 3 40l1-1-1 3 3 13 7-6 3 1-11 10v7l28 28 1-60-18 15v-3l74-66v-46l2-2 1 13v21l82-28 2 2-6 3-30 10-21 6-14 5-13 5-1 13 82 74v14l-3 1v-13l-79-72q-1-3-4-1l80 72 2 7 2 59-88 27-42-37v-2l42 37h3l83-26-2-63-81-73-52 46v62l-2 2-28-28v14l-1 3-1-4v-22l-3-20q-4-23-3-46l-1-31 1-1-2-2q2-5 1-11l-19-14-17 16-21-16-4 3 4-5 20 16 18-16 19 14v-3l-19-15-10 10-5 2 15-14 19 14q-2-31 1-63 1-20 6-41 2-9 1-20l2-2v14l2-1 13 11 1-46q3-5 8-9"/><path fill="#b2b2b2" d="m361 291-2 213 7 9v49l-12 11v-83l-3-5-17-16v-78l20-20-27-27-2-3v-15l8-9zm183 190q5 3 5 7v49q1 11-1 20-5 21-6 41-3 32-1 63l-19-14-15 14-2 2-20-16-2-160q1-3 4-5l4 4 5-4 5 4 5-4 4 4 6-4 4 3 5-3 4 4 6-4 4 3z"/><path fill="#575757" d="M441 380v9l-5 6-7-7-5 5-7-6-6 6c-1-2-5-4-4-7v-6l4 5 7-6 6 6 6-5 6 5z"/><path fill="#b3b3b2" d="m636 624 33-11-1 3-30 11z"/><path fill="#b2b2b2" d="M383 337q4 2 5 8l-2 44q1 5-1 11l-18-23v-37q0-3 3-4l6 7z"/><path fill="#1e1e1b" d="M559 518q4 6 3 14l-4 5-4-4v-10zm0 2q-4 3-3 5-1 7 2 10l3-5q1-5-2-10"/><path fill="#b2b2b2" d="m443 412 4-4 5 3-1 61v11l-4-3-4 4-5-4-5 4-4-4-5 4-5-4-5 4-5-4-4 4-5-4-5 3-5-4-5 5v-34l11-9-1-30 5-4 5 5 5-5 4 4 5-3 5 4 5-5 4 5 5-4z"/><path fill="#868686" d="M559 520q3 5 2 10l-3 5q-3-3-2-10-1-2 3-5"/><path fill="#b2b2b2" d="M482 452v32l-5-4-5 4-5-4-5 4-5-5-4 5v-32l4 4 5-5q2 4 6 5l4-5 5 5z"/><path fill="#010101" d="m334 315-1 2-8 9v15l2 3 27 27-20 20v78l17 16 3 5-2-1-19-20-1-78-16-17 20-19-10-10-2 1v-3l-3 2-46 41-168 147 2 2q-2 2-2 6l1 19 11-10v20l-11 9 23 30v-45l-1-5-19-23-2-3 69-60 50-45v3L112 533l19 22 4 4 173 56-2 2-164-53-8-3v24l4 2 1-7 30 11 3 2v6l39 14v-22l90 31-2 2-33-11h-1q-1-2-3-1v5l-30-11v-5l-4-1v5l-13-3q1-5-1-7l-1 43 84 28-1 2-83-28v19l-3 1v-21l-76-26v19l-3 2v-22l-25-33v-44l-21 18q-2-2 0-4l21-18v-9h4l212-188v-18l3 1v7zm-12 21L111 524h-4l1 5 214-188zm15 20-19 18 15 16 19-19zM233 602v3l27 10v-4zm-16-6v5l9 2v-4zm-83-9v5l77 26v-4zm0 6v19l76 25 1-17zm6-11v5l31 11v-5zm-22-29-10 9v15l10-8z"/><path fill="#b2b2b2" d="m553 551 82 76-1 24-5 4v-24l-80-70zM85 529l237-210v15L110 522h-4v9l-21 18z"/><path fill="#010101" d="m549 561 80 70v24l5-4h4l-1 2-2 2q-5 2-6 6v34l-71 59 3 13v3l-3-1-2-13-8 6 1-3 6-5-4-28 1-5 11-11 63-52q2-2 1-4l-57 48c-4 4-12 3-16 9q-3 5-8 8l1-1 8-11 16-7 56-48 1-20-79-69-1 1zm78 99-63 53-10 10q1 15 4 29l70-58z"/><path fill="#b2b2b2" d="M477 481q4 3 5 7l1 79-1 7-7-7-8 7-8-7-7 7v-86q1-4 5-7l5 5 5-4 5 4zm72 82 79 69-1 20-56 48-16 7-8 11-2-1-1-45q-3-54 4-108zM322 336v5L108 529l-1-5h4z"/><path fill="#404040" d="M324 343v3l-3 3v-4z"/><path fill="#b2b2b2" d="m337 356 15 15-19 19-15-16zm-11-11 10 10-20 19 16 17 1 78 19 20v86l-44 40-173-56-4-4-19-22 116-102v-3l-50 45-69 60 2 3 19 23 1 5v45l-23-30 11-9v-20l-11 10-1-19q0-4 2-6l-2-2 168-147 46-41v1l-22 20 1 1 24-21zm-29 22-9 9v2l11-10zm-22 20 1 1 12-11c-5 1-8 7-13 10m-6 5-41 36 2 1 10-9 30-27 6-5q-4 1-7 4m366 263v46l-74 66-3-13 71-59v-34q2-4 6-6"/><path fill="#1e1e1b" d="M321 346v3l-21 18-1-1z"/><path fill="#b2b2b2" d="M627 654q1 2-1 4l-63 52-11 11-1 5 4 28-7 6q-4-20-3-40l1-1q5-2 8-8c4-6 12-5 16-9zm0 6 1 34-70 58-4-29 10-10zM447 482l4 3-2 163-20 15-17-16q-8 8-18 14v-1q1-43-4-88l-4-17-1-10v-59l5-5 5 4 5-3 5 4 4-4 5 3 5-3 5 4 5-4 4 4 5-4 5 4z"/><path fill="#afb3b2" d="m637 707 79 72v13l2 42-1 11-87 29-50-44v-2l7 6 42 37 88-27-2-59-2-7-80-72q3-2 4 1"/><path fill="#b2b2b2" d="m632 707 81 73 2 63-83 26h-3l-42-37-6-6-1-11v-62z"/><path fill="#1e1e1b" d="m297 367 2 1-11 10v-2z"/><path fill="#181e20" d="M719 791v2l1 26 1 28-1 1-30 9-21 7-39 13-17-15-75-65-3-5-1-14-1-35-19 11c-3 1-6 5-9 3l-28-14 3-1 25 12h3l25-14 3 2 2 51 12 10 29 26-1-12 2-2 1 11 6 6v2l-7-6v2l50 44 87-29 1-11-2-42z"/><path fill="#1e1e1b" d="M275 387c5-3 8-9 13-10l-12 11z"/><path fill="#b2b2b2" d="m475 569 8 7v72l-4 3-12 11-16-15v-13l1-55c-1-5 4-7 7-10l8 7z"/><path fill="#1e1e1b" d="M269 392q3-3 7-4l-6 5-30 27-10 9-2-1z"/><path fill="#b2b2b2" d="M361 502h23v47l-2-1-14 12v-47l-8-9zm15 16q-6 6-4 14l4 5 4-4v-10zm146 131 19 15v3l-19-14-17 16-21-16-15 13v-4l10-9 5-4 21 16 7-6zm0 6 19 14q1 6-1 11l-23 19-11-12-11 12-26-18v-13l11-10 4-3 21 16z"/><path fill="#010101" d="m540 680 2 2-1 1-5 4v55l-3-2v-18l-16-6-11 5-10-5-16 6v20l-3 1v55q-5 7-10 11l-2-1v-25l-2-11-1-33-2 2-2-1 7-6-4-4-1-42-2 2v52h-3v-20l-17-6-10 5-11-5-16 6v18l-2 1v-54l-5-4-1-2 1-1 23 19 12-12 11 12 26-18v-13l-15-13-21 15-18-15-15 11 2-3 13-10 18 16 21-16 15 13q1-4-5-7l-11-10-2 1 3-3 16 15 12-11v2l-10 9v4l15-13-4 5-11 10v13l26 18 11-12 11 12zm-7 10-16 13-11-12-11 11-15-10v15l16 5 11-5 10 5 16-5zm0 19-16 5-10-5-11 5-16-5v11l16-5 10 5 11-5 16 5zm-59-21v42l-4 4q3 4 7 6v-50zm-7-5-5 4v41q1 4 5 5l-4 5 3 41c1 9-2 19 1 27q2-6 1-14t1-17q3-18 2-36l-3-5 4-5 1-42zm-13 9-15 10-10-11-11 12-16-13-1 17 17 5 10-5 10 5 17-5zm-16 22-10-5-10 5-17-5v11l16-5 11 5zl17 5v-11zm35 25q0 18-3 37v27q4-2 4-6v-54z"/><path fill="#1e1e1b" d="m376 518 4 5v10l-4 4-4-5q-2-8 4-14m0 2-2 4q-2 6 3 11c3-3 1-8 2-12z"/><path fill="#b2b2b2" d="m541 683 1 31q-1 23 3 46l3 20v22l-10-9-2-51v-55z"/><path fill="#878787" d="m376 520 3 3c-1 4 1 9-2 12q-4-5-3-11z"/><path fill="#b2b2b2" d="M533 690v17l-16 5-10-5-11 5-16-5v-15l15 10 11-11 11 12zM381 551l4 10-79 70v22l-1 2-5-4v-24zm152 158v11l-16-5-11 5-10-5-16 5v-11l16 5 11-5 10 5zm46 46-1 60-28-28v-7l11-10zM385 563l3 11q5 57 2 113v30l-1 1-10-11-13-5-52-43q0 3 3 4l46 39 16 7 8 10h1l2 1-3 40-2-1-6-5 4-28q1-3-1-5l-13-13-61-50-1-4 5 4q-2-4-5-6v-20z"/><path fill="#1c1c1c" d="M390 572q5 45 4 88v1l2 1q-3 2-3 5l6-4-2 3q-4 1-3 4v10l-1 1 1 2-1 36-3 37-3 16-1 14-1 1v-7l-12-10h3v-1l7 6q3-6 3-13l-1-3 2 1 3-40-2-1 1-1 1-1v-30q3-56-2-113z"/><path fill="#b2b2b2" d="m517 716 16 6v18l-25 14h-3l-25-12v-20l16-6 10 5z"/><path fill="#b3b3b3" d="M461 659q5 3 5 7l-15-13-21 16-18-16-13 10-6 4q0-3 3-5l16-13 17 16 19-15 2-1z"/><path fill="#b3b2b3" d="m556 756 2 13-7 6-3-13z"/><path fill="#b2b2b2" d="m451 655 15 13v13l-26 18-11-12-12 12-23-19v-10q-1-3 3-4l15-11 18 15zm23 33 3 2v50q-4-2-7-6l4-4zm-7-5 6 4-1 42-4 5 3 5q1 18-2 36-2 9-1 17t-1 14c-3-8 0-18-1-27l-3-19v-22q1-3 4-5-4-1-5-5v-41zm-7 5 1 42 4 4-7 6v-50zm-6 4v14l-17 5-10-5-10 5-17-5 1-17 16 13 11-12 10 11zm96 97 28 28 1 12-29-26zm-112-75 17-5v11zl-10 5-11-5-16 5v-11l17 5 10-5z"/><path fill="#b3b2af" d="m473 739 1 4v54q0 4-4 6v-27q3-18 3-37"/><path fill="#b2b2b2" d="m438 716 17 6v20l-28 13-26-15v-18l16-6 11 5z"/><path fill="#b3b2b1" d="m462 739 1 33 2 11v20l-5-5v-57z"/><path fill="#181f23" d="M460 741v57l5 5v5c-2-4-8-7-7-12v-53l-29 14q-2 1-5-1l-22-12-1 20-1 14v16l-19 17-15 13-20 18-13 12-11 11-11 8q-4 3-9 4-4-3-9-3l-4-2 1 2-14-6-12-4-8-2-20-7q-10-4-21-6l-1-3-1-14 1-15v-2q-1-3 1-8l-1-11 1-9v-10l8-8 15-13 12-11 11-10 18-16 18-17v-10q-1-4-4-4l-61-20-21-7-53-17-22-7-5-3 3-2 76 26v-1 3l3-1 8 2 76 26v-18l-1-1 1-2v-13l3 2v49l-82 75-1 53v13l88 29q17-17 36-32l4-4 9-7h1l1-2 28-25 1-14 1 1 1 11 10-9 2-52 2-1 26 15 28-13h3v-3 1z"/><path fill="#b2b2b2" d="m394 683 5 4v54l-2 52-10 9-1-11v-5l1-14 3-16 3-37zM142 564l164 53-5 5-90-31v22l-39-14v-6l-3-2-30-11-1 7-4-2v-24zm124 49 33 11-3 3-30-11z"/><path fill="#1e1e1b" d="m366 702 13 5 10 11-1 1h-1l-8-10-16-7-46-39q-3-1-3-4z"/><path fill="#b2b2b2" d="m266 618 31 11v37l-84-28 1-43q2 2 1 7l13 3v-5l4 1v5l30 11v-5q2-1 3 1-1 2 1 5m92 85 22 20q0 15-4 29l-69-58v-32l1-1zM233 602l27 9v4l-27-10zm67 53 5 4 1 7v29l70 59-2 13-55-49q-11-8-19-17zm-87-15 83 28 1 1v18l-76-26-8-2z"/><path fill="#b3b3b3" d="m217 596 9 3v4l-9-2z"/><path fill="#b2b2b1" d="m379 756 7 6q0 7-3 13l-7-6z"/><path fill="#1d1d1b" d="m319 718 55 49-1 3-16-14-1 1v58l29-28 1-1v5l-1-1-29 27v12l-1 2h-1v-3l-9 9v1l-4 4 2-3v-1l-38 33-87-27 2-62 1-3 80-73-1-2v-3zm-17-11-80 73-3 63 86 27 49-43v-74z"/><path fill="#b2b2b2" d="m357 756 16 14 12 10v7l-29 28v-58zm-55-49 52 46v74l-49 43-86-27 3-63zM134 587l77 27v4l-77-26zm222 230 29-27-1 14-28 25z"/><path fill="#b1b3b2" d="m300 704 1 2-80 73-1 3-2 62 87 27 38-33v1l-2 3q-19 15-36 32l-88-29v-13l1-53z"/><path fill="#b2b2b2" d="m134 593 77 27-1 17-76-25zm6-11 31 11v5l-31-11zm-34-47v44l25 33v18l-12-10-34-30v-37zm28 78 76 26v19l-76-26zm-16-60v16l-10 8v-15zm236 275v3l-9 7v-1z"/>`;

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
.cs-netlbl{position:absolute;left:9px;top:7px;font-family:var(--fd,inherit);font-size:0.42rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-2);z-index:8;background:rgba(6,7,9,0.82);padding:2px 6px;border-radius:3px;}
.cs-moon{position:absolute;right:10px;top:13px;width:23px;height:23px;z-index:9;filter:drop-shadow(0 0 4px rgba(244,242,235,0.6)) drop-shadow(0 0 8px var(--btc-orange));}
.cs-moon img{display:block;width:23px;height:23px;border-radius:50%;}
.cs-sat{position:absolute;right:44px;top:14px;z-index:12;font-size:24px;line-height:1;animation:cs-bob 4.5s ease-in-out infinite;}
.cs-smoke{position:absolute;inset:0;z-index:11;pointer-events:none;}
.cs-jets{position:absolute;inset:0;z-index:10;pointer-events:none;overflow:hidden;}
.cs-jet{position:absolute;left:0;top:0;will-change:transform;backface-visibility:hidden;}
.cs-evfx{position:absolute;inset:0;z-index:13;pointer-events:none;}
.cs-shipwrap{position:absolute;inset:0;z-index:10;pointer-events:none;}
.cs-ship{position:absolute;left:0;top:0;will-change:transform;}
.cs-flame{transform-box:fill-box;transform-origin:center top;animation:cs-fl 0.3s ease-in-out infinite alternate;}
.cs-flame2{transform-box:fill-box;transform-origin:center top;animation:cs-fl2 0.22s ease-in-out infinite alternate;}
.cs-jflame{animation:cs-jglow 0.55s ease-in-out infinite;}
@keyframes cs-fl{from{transform:scaleY(0.6) scaleX(0.92);opacity:0.6;}to{transform:scaleY(1.35) scaleX(1.06);opacity:1;}}
@keyframes cs-fl2{from{transform:scaleY(0.65);opacity:0.7;}to{transform:scaleY(1.2);opacity:1;}}
@keyframes cs-jglow{0%,100%{opacity:0.9;}50%{opacity:1;}}
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
  const jetsRef = useRef(null);
  const evfxRef = useRef(null);
  const ascentRef = useRef(0);
  const blockSigRef = useRef(0);
  const flareRef = useRef(null);

  const se = worker.shareEvents || {};
  const accepted = se.accepted || 0;
  const rejected = (se.rejected || 0) + (se.stale || 0);
  const best = se.bestSinceReset || se.bestSdiff || 0;
  const netDiff = (network && network.difficulty) || 0;
  const recent = Array.isArray(se.recentSdiffs) ? se.recentSdiffs : [];

  // NiceHash-style log ascent (the dramatic "close to reward" number) …
  const ascentPct = netDiff > 1 && best > 0 ? Math.min((Math.log(best) / Math.log(netDiff)) * 100, 100) : 0;
  ascentRef.current = ascentPct;

  // Block celebration trigger: a share that meets or beats network difficulty IS a
  // solved block. Bump the signal once per such event; the scene loop reads it and
  // fires the gold flash + shooting-star burst. Guarded so it fires only on a fresh
  // best that crosses the threshold, never repeatedly.
  useEffect(() => {
    if (netDiff > 0 && best >= netDiff) blockSigRef.current += 1;
  }, [best, netDiff]);
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
        // best-strike flare: a shooting star when a new best lands live (not on
        // the initial seed rebuild, where `animate` is false).
        if (animate && flareRef.current) flareRef.current();
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

  // ── Animated sky scene: aurora, stars, shuttle (smoke = difficulty line),
  //    F-22 squadron, and event-driven effects (best-strike flare, %-reaction,
  //    milestone pulse, sonic-boom ring, block celebration). ──
  useEffect(() => {
    const hist = histRef.current, ship = shipRef.current, smoke = smokeRef.current;
    if (!hist || !ship || !smoke) return;
    const W = hist.clientWidth || 320, H = hist.clientHeight || 140;
    const LINE_Y = 28, X0 = 2, SLOT = 2.4;
    const NS = 'http://www.w3.org/2000/svg';
    const jetsEl = jetsRef.current, evfx = evfxRef.current;

    // ── stars (full height) into .cs-sky ──
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

    // ── full-spectrum aurora curtains into .cs-aurora ──
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

    // ── satellite (emoji on Apple, SVG twin elsewhere) ──
    const satEl = hist.querySelector('.cs-sat');
    if (satEl && !satEl.dataset.built) {
      satEl.innerHTML = IS_APPLE ? '🛰️' : SAT_SVG;
      satEl.dataset.built = '1';
    }

    // ── the flying shuttle (rotated 90° so the nose points right) ──
    ship.innerHTML = '<div style="transform:rotate(90deg);transform-origin:center center">' + SHUTTLE_HTML + '</div>';
    ship.style.top = (LINE_Y - 27) + 'px';
    const shipFlame = ship.querySelector('.cs-flame');

    // ── smoke SVG layer (the difficulty line) ──
    let svg = smoke.querySelector('svg');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%');
      smoke.appendChild(svg);
    }
    const slots = {};
    const moonCx = W - 21, ZONE_HALF = 18, FAST = 1.0, SLOW = 0.13;
    const GAP = 16, FWD = 16;
    const ensurePuff = (x) => {
      const slot = Math.round(x / SLOT);
      const inMoon = Math.abs(x - moonCx) <= ZONE_HALF;
      if (slots[slot]) { const e = slots[slot]; e.freshAt = performance.now(); e.fast = inMoon; return; }
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

    // ── F-22 squadron (line abreast, 5 jets) flying L→R, in front of moon ──
    const FORM = [
      { dx: 0, dy: 30, px: 15 }, { dx: 14, dy: 54, px: 16 }, { dx: 30, dy: 42, px: 14 },
      { dx: 48, dy: 66, px: 15 }, { dx: 64, dy: 50, px: 13 },
    ];
    const JET_SPEED = 2.8;
    const jetEls = [];
    if (jetsEl && !jetsEl.dataset.built) {
      // shared defs (F-22 symbol + flame gradient) injected once
      jetsEl.insertAdjacentHTML('beforeend',
        '<svg width="0" height="0" style="position:absolute"><defs>' +
        '<symbol id="cs-f22" viewBox="' + F22_VB + '">' + F22_SYMBOL + '</symbol>' +
        '<linearGradient id="cs-jflame" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#FFF6D8"/><stop offset=".3" stop-color="#FFC04A"/><stop offset=".7" stop-color="#FF6A1E"/><stop offset="1" stop-color="#FF6A1E" stop-opacity="0"/></linearGradient>' +
        '</defs></svg>');
      FORM.forEach((j) => {
        const px = j.px, h = px * 1.32, fw = px * 1.05, cy = px * 0.5, sep = px * 0.11;
        const tipR = fw * 0.66, mid = fw * 0.34;
        const plume = (yc) => '<path class="cs-jflame" d="M' + tipR + ' ' + yc + ' C' + mid + ' ' + (yc - 1.4) + ' ' + (mid * 0.5) + ' ' + yc + ' 0 ' + yc + ' C' + (mid * 0.5) + ' ' + yc + ' ' + mid + ' ' + (yc + 1.4) + ' ' + tipR + ' ' + yc + ' Z" fill="url(#cs-jflame)"/>';
        const core = (yc) => '<path class="cs-jflame" d="M' + (tipR * 0.9) + ' ' + yc + ' C' + mid + ' ' + (yc - 0.7) + ' ' + (mid * 0.6) + ' ' + yc + ' ' + (fw * 0.12) + ' ' + yc + ' C' + (mid * 0.6) + ' ' + yc + ' ' + mid + ' ' + (yc + 0.7) + ' ' + (tipR * 0.9) + ' ' + yc + ' Z" fill="#FFF3D0" opacity=".85"/>';
        const el = document.createElement('div');
        el.className = 'cs-jet';
        el.style.opacity = '0.92';
        el.innerHTML =
          '<div style="position:relative;width:' + px + 'px;height:' + px + 'px;">' +
            '<svg viewBox="0 0 ' + fw + ' ' + px + '" width="' + fw + 'px" height="' + px + 'px" style="position:absolute;left:' + (-fw * 0.6) + 'px;top:0;overflow:visible">' +
              plume(cy - sep) + plume(cy + sep) + core(cy - sep) + core(cy + sep) +
            '</svg>' +
            '<svg viewBox="' + F22_VB + '" width="' + px + '" height="' + h + '" style="position:absolute;left:0;top:' + ((px - h) / 2) + 'px;transform:rotate(90deg);transform-origin:center center;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))"><use href="#cs-f22"/></svg>' +
          '</div>';
        jetsEl.appendChild(el);
        jetEls.push({ el, j, boost: 0 });
      });
      jetsEl.dataset.built = '1';
    } else if (jetsEl) {
      jetsEl.querySelectorAll('.cs-jet').forEach((el, i) => { if (FORM[i]) jetEls.push({ el, j: FORM[i], boost: 0 }); });
    }

    // ── event effects helpers ──
    const flare = () => {
      if (!evfx || !W) return;
      const y = 10 + Math.random() * 40;
      const star = document.createElement('div');
      star.style.cssText = 'position:absolute;left:' + (W + 10) + 'px;top:' + y + 'px;width:16px;height:2px;background:linear-gradient(90deg,transparent,#fff);border-radius:2px;box-shadow:0 0 6px #fff;transform:rotate(12deg)';
      evfx.appendChild(star);
      const t0 = performance.now(), dur = 700;
      const go = (t) => { const k = Math.min((t - t0) / dur, 1); star.style.left = (W + 10 - (W + 40) * k) + 'px'; star.style.opacity = String(1 - k); if (k < 1) requestAnimationFrame(go); else star.remove(); };
      requestAnimationFrame(go);
    };
    // expose flare so the bars effect can fire it on a new best
    flareRef.current = flare;
    let blockUntil = 0, lastBlockSig = blockSigRef.current, lastPct = ascentRef.current;
    const celebrate = () => {
      blockUntil = performance.now() + 2600;
      if (evfx) {
        const flash = document.createElement('div');
        flash.style.cssText = 'position:absolute;inset:0;background:radial-gradient(circle at 70% 30%,rgba(255,200,70,.6),transparent 60%)';
        evfx.appendChild(flash);
        flash.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 900 }).onfinish = () => flash.remove();
      }
      for (let i = 0; i < 14; i++) setTimeout(flare, i * 90);
    };

    let x = -40, lastx, lead = -80, raf = 0;
    const speed = 1.1, xRight = W - 2, xWrap = W + 40;
    const tick = () => {
      const now = performance.now();
      const pct = ascentRef.current;

      // shuttle + clear-gap smoke (the difficulty line)
      x += speed; if (x > xWrap) x = -40;
      ship.style.transform = 'translate3d(' + Math.round(x - 19) + 'px,0,0)';
      const layX = x - 12 - GAP; if (layX >= X0 && layX <= xRight) ensurePuff(layX);
      const nose = x + 19, clearFrom = x - 12 - GAP, clearTo = nose + FWD, ramp = 10;
      for (const k in slots) {
        const pf = slots[k]; const px2 = (+k) * SLOT; const age = (now - pf.freshAt) / 1000;
        const rate = pf.fast ? FAST : SLOW, floor = pf.fast ? 0.0 : 0.16;
        let op = Math.max(0.7 - age * rate, floor);
        if (px2 >= clearFrom && px2 <= clearTo) op = 0;
        else if (px2 > clearTo && px2 < clearTo + ramp) op *= (px2 - clearTo) / ramp;
        else if (px2 < clearFrom && px2 > clearFrom - ramp) op *= (clearFrom - px2) / ramp;
        pf.el.forEach(n => n.setAttribute('opacity', op.toFixed(2)));
        if (pf.fast && op <= 0.02) { pf.el.forEach(n => n.remove()); delete slots[k]; }
      }

      // shuttle reacts to close-to-reward %
      if (shipFlame) shipFlame.style.filter = 'drop-shadow(0 0 ' + (2 + pct / 12).toFixed(1) + 'px #FFB23E)';
      ship.style.filter = pct >= 90 ? 'drop-shadow(0 0 8px #FFD24A)' : 'none';

      // sonic-boom ring as the shuttle crosses mid-screen
      const mid = W / 2;
      if (lastx !== undefined && lastx < mid && x >= mid && evfx) {
        const ring = document.createElement('div');
        ring.style.cssText = 'position:absolute;left:' + (x - 6) + 'px;top:' + (LINE_Y - 6) + 'px;width:12px;height:12px;border:1.5px solid rgba(255,255,255,.8);border-radius:50%;';
        evfx.appendChild(ring);
        ring.animate([{ transform: 'scale(.4)', opacity: .9 }, { transform: 'scale(2.6)', opacity: 0 }], { duration: 600 }).onfinish = () => ring.remove();
      }
      lastx = x;

      // milestone pulse when % crosses 90 upward
      if (lastPct < 90 && pct >= 90 && evfx) {
        const p = document.createElement('div');
        p.style.cssText = 'position:absolute;right:20px;top:14px;width:18px;height:18px;border:2px solid #FFD24A;border-radius:50%;box-shadow:0 0 8px #FFD24A;';
        evfx.appendChild(p);
        p.animate([{ transform: 'scale(.5)', opacity: 1 }, { transform: 'scale(3)', opacity: 0 }], { duration: 800 }).onfinish = () => p.remove();
      }
      lastPct = pct;

      // block celebration when a block-found signal arrives
      if (blockSigRef.current !== lastBlockSig) { lastBlockSig = blockSigRef.current; celebrate(); }
      if (now < blockUntil) hist.style.boxShadow = 'inset 0 0 40px rgba(255,200,70,.5)';
      else if (hist.style.boxShadow) hist.style.boxShadow = '';

      // squadron: advance lead, jets faster than shuttle, recycle as a unit
      lead += JET_SPEED;
      const maxDx = 64;
      if (lead - maxDx > W + 50) lead = -50;
      // occasional jet boost surge
      jetEls.forEach((je) => {
        if (je.boost <= 0 && Math.random() < 0.0008) je.boost = 1;
        if (je.boost > 0) je.boost -= 0.012;
      });
      jetEls.forEach((je) => {
        const surge = je.boost > 0 ? Math.sin(je.boost * Math.PI) * 26 : 0;
        const jx = Math.round(lead - je.j.dx + surge);
        je.el.style.transform = 'translate3d(' + jx + 'px,' + je.j.dy + 'px,0)';
        je.el.style.filter = surge > 2 ? 'drop-shadow(-6px 0 8px rgba(255,150,60,.5))' : 'none';
      });

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); flareRef.current = null; };
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
          <div className="cs-netlbl">{tt('network difficulty')} {fmtDiff(netDiff)}</div>
          <div className="cs-jets" ref={jetsRef} />
          <div className="cs-smoke" ref={smokeRef} />
          <div className="cs-shipwrap"><div className="cs-ship" ref={shipRef} /></div>
          <div className="cs-moon"><img src={MOON_SRC} alt={tt('network difficulty')} /></div>
          <div className="cs-sat" aria-hidden="true" />
          <div className="cs-evfx" ref={evfxRef} />
          <div className="cs-vp" ref={vpRef}><div className="cs-inner" ref={innerRef} /></div>
        </div>

        <div className="cs-lgnd">
          <span className="cs-lg"><i style={{ background: '#8b9098' }} />{tt('share difficulty')}</span>
          <span className="cs-lg"><i style={{ background: 'var(--amber)' }} />{tt('best · close to reward')}</span>
          <span className="cs-lg"><i style={{ background: 'linear-gradient(90deg, transparent, #cfd4da)', height: 3, width: 11, borderRadius: 2 }} />{tt('network difficulty')}</span>
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
    // v2.3.1: the high-diff RENTAL port (>4000, i.e. 4334) is the authoritative
    // "a rental is in" signal — owned miners connect on 3333/3334 and never hit
    // it. Earlier builds also required minerVendor==='rented'|'braiins', but
    // NiceHash often sends a generic/empty stratum user-agent so its vendor
    // stays null, which wrongly excluded it. The port alone qualifies now;
    // vendor is used only to *label* the card, not to gate it.
    const port = w.shareEvents && w.shareEvents.port;
    return !!port && port > 4000;
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
