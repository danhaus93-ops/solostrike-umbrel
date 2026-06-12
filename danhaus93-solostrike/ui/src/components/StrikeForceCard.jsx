// StrikeForceCard.jsx — v2.1.0
// Auto-populating "Strike Force" card for rented hashrate (NiceHash / Braiins /
// MiningRigRentals). When a worker whose minerVendor is "Rented" or "Braiins"
// is online, a card is inserted at the TOP of the card list visualising its
// climb toward a block — modelled on NiceHash EasyMining.
//
// Data (all already on the worker, no new wiring needed beyond the API ring
// buffer added to share-watcher.js):
//   worker.shareEvents.recentSdiffs  → real per-share achieved difficulties
//                                       (rental high-diff port only, cap 256)
//   worker.shareEvents.bestSinceReset → best share diff (resettable)
//   worker.shareEvents.accepted       → accepted share count (monotonic)
//   worker.shareEvents.firstSeen      → for strike-rate
//   network.difficulty                → the "network difficulty" line / block
//   blockReward.totalBtc              → potential block reward
//
// Histogram model (mirrors NiceHash): bars are log-scaled share difficulty
// (ln(sdiff)/ln(netDiff)); the dashed network-difficulty line sits at the top
// (100% = a block); the best share is highlighted "close to reward". Bars are
// kept (no downsampling) and the strip scrolls horizontally — auto-pinned to
// the newest, swipe left for history. We also surface the app's native linear
// "% to block" so it stays consistent with the closest-calls / rarity system.

import React, { useRef, useEffect } from 'react';

const MOON_SRC = '/moon.png';

const SHUTTLE = (
  <svg viewBox="0 0 44 62" width="42" height="57" aria-hidden="true" style={{ display: 'block', filter: 'drop-shadow(0 0 7px var(--amber))' }}>
    <defs>
      <linearGradient id="cs-tk" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#E8822F" /><stop offset=".5" stopColor="#C75D1B" /><stop offset="1" stopColor="#984510" /></linearGradient>
      <linearGradient id="cs-sb" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#C2C9D1" /></linearGradient>
      <linearGradient id="cs-ob" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#CBD3DB" /></linearGradient>
      <linearGradient id="cs-fl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset=".3" stopColor="#FFD24A" /><stop offset=".65" stopColor="#FF7A00" /><stop offset="1" stopColor="#E53E3E" stopOpacity="0" /></linearGradient>
    </defs>
    <path className="cs-flame" d="M13 47 C15 60 18 53 22 62 C26 53 29 60 31 47 Z" fill="url(#cs-fl)" />
    <path className="cs-flame2" d="M17.5 47 C19 57 21 52 22 59 C23 52 25 57 26.5 47 Z" fill="#FFF6D8" opacity=".9" />
    <path d="M10 11 C9 11 8.3 13 8.3 15 L8.3 47 L13.7 47 L13.7 15 C13.7 13 13 11 12 11 Z" fill="url(#cs-sb)" stroke="#7c8792" strokeWidth=".4" />
    <path d="M32 11 C31 11 30.3 13 30.3 15 L30.3 47 L35.7 47 L35.7 15 C35.7 13 35 11 34 11 Z" fill="url(#cs-sb)" stroke="#7c8792" strokeWidth=".4" />
    <rect x="8.3" y="20" width="5.4" height="1.4" fill="#9aa3ad" /><rect x="30.3" y="20" width="5.4" height="1.4" fill="#9aa3ad" />
    <path d="M22 3 C18.4 3 16.4 8 16.4 13 L16.4 48 L27.6 48 L27.6 13 C27.6 8 25.6 3 22 3 Z" fill="url(#cs-tk)" stroke="#6e3208" strokeWidth=".5" />
    <path d="M18 13 L18 47" stroke="#F6B27A" strokeWidth="1" opacity=".5" />
    <path d="M22 31 L13 49 L31 49 Z" fill="url(#cs-ob)" stroke="#7c8792" strokeWidth=".4" />
    <path d="M22 31 L13 49 L15 49 Z" fill="#15181d" opacity=".85" /><path d="M22 31 L31 49 L29 49 Z" fill="#15181d" opacity=".85" />
    <path d="M22 21 C20.4 21 19.4 24 19.4 28 L19.4 49 L24.6 49 L24.6 28 C24.6 24 23.6 21 22 21 Z" fill="url(#cs-ob)" stroke="#7c8792" strokeWidth=".4" />
    <path d="M22 21 C20.4 21 19.4 24 19.4 27 L24.6 27 C24.6 24 23.6 21 22 21 Z" fill="#15181d" />
    <rect x="20.5" y="27.6" width="3" height="1.5" rx=".5" fill="#3a4756" />
    <path d="M22 23 L20.8 27 L23.2 27 Z" fill="#fff" opacity=".25" />
  </svg>
);

const CSS = `
.cs-card{background:var(--bg-surface);border:1px solid var(--border);border-radius:12px;padding:0.95rem 1.05rem 1.05rem;margin-bottom:0.6rem;}
.cs-head{display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;}
.cs-glyph{width:22px;height:22px;object-fit:contain;filter:drop-shadow(0 0 5px var(--btc-orange));}
.cs-title{font-family:var(--fd,inherit);font-size:0.9rem;font-weight:700;letter-spacing:0.03em;color:var(--text-1);}
.cs-prov{font-family:var(--fd,inherit);font-size:0.45rem;letter-spacing:0.13em;text-transform:uppercase;padding:3px 6px;border-radius:4px;border:1px solid var(--border);color:var(--text-2);display:inline-flex;align-items:center;gap:4px;}
.cs-prov i{width:5px;height:5px;border-radius:50%;background:var(--cyan);display:inline-block;}
.cs-sp{flex:1;}
.cs-badge{font-family:var(--fd,inherit);font-size:0.46rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--bg-deep);background:var(--amber);padding:3px 7px;border-radius:5px;font-weight:700;}
.cs-hl{display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.12rem;}
.cs-big{font-family:var(--fd,inherit);font-size:1.55rem;font-weight:800;color:var(--amber);line-height:1;}
.cs-cap{font-family:var(--fd,inherit);font-size:0.48rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-3);}
.cs-sub{font-family:var(--fd,inherit);font-size:0.5rem;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-2);margin-bottom:0.65rem;}
.cs-sub b{color:var(--btc-orange);}
.cs-hist{position:relative;height:142px;background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:0.45rem;}
.cs-net{position:absolute;left:8px;right:8px;top:10px;border-top:2px dashed var(--text-1);opacity:0.85;}
.cs-netlbl{position:absolute;right:30px;top:13px;font-family:var(--fd,inherit);font-size:0.42rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-2);}
.cs-moon{position:absolute;right:3px;top:1px;width:21px;height:21px;z-index:4;filter:drop-shadow(0 0 4px rgba(244,242,235,0.6)) drop-shadow(0 0 8px var(--btc-orange));}
.cs-moon img{display:block;width:21px;height:21px;border-radius:50%;}
.cs-trav{position:absolute;top:5%;right:9%;z-index:3;pointer-events:none;animation:cs-launch 3.4s ease-in-out infinite;}
.cs-vp{position:absolute;left:8px;right:8px;top:17px;bottom:6px;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;}
.cs-vp::-webkit-scrollbar{height:5px;}
.cs-vp::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px;}
.cs-vp::-webkit-scrollbar-track{background:transparent;}
.cs-inner{display:flex;align-items:flex-end;height:100%;width:max-content;min-width:100%;padding-bottom:5px;}
.cs-bar{width:5px;margin-right:2px;flex:0 0 auto;background:#8b9098;border-radius:1px 1px 0 0;height:0;transition:height 0.45s cubic-bezier(0.2,0.8,0.2,1),background 0.3s;}
.cs-bar.cs-best{background:var(--amber);box-shadow:0 0 8px var(--amber);}
.cs-lgnd{display:flex;gap:0.8rem;flex-wrap:wrap;margin-bottom:0.6rem;}
.cs-lg{display:flex;align-items:center;gap:4px;font-family:var(--fd,inherit);font-size:0.42rem;letter-spacing:0.06em;text-transform:uppercase;color:var(--text-3);}
.cs-lg i{width:7px;height:7px;border-radius:1px;display:inline-block;}
.cs-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;}
.cs-kv{display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0.55rem;background:var(--bg-deep);border:1px solid var(--border);border-radius:6px;}
.cs-kv .k{font-family:var(--fd,inherit);font-size:0.46rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-3);}
.cs-kv .v{font-family:var(--fm,monospace);font-size:0.74rem;color:var(--text-1);font-weight:600;}
.cs-kv .v.am{color:var(--amber);}
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
  return p.toExponential(1) + '%';
}

export function StrikeForceCard({ worker, network, blockReward, t, GLYPH_SRC }) {
  const tt = typeof t === 'function' ? t : (k) => k;
  const innerRef = useRef(null);
  const vpRef = useRef(null);
  const mountedRef = useRef(false);
  const prevAcceptedRef = useRef(0);
  const bestValRef = useRef(0);
  const bestElRef = useRef(null);

  const se = worker.shareEvents || {};
  const accepted = se.accepted || 0;
  const best = se.bestSinceReset || se.bestSdiff || 0;
  const netDiff = (network && network.difficulty) || 0;

  // NiceHash-style log ascent (the dramatic "close to reward" number) …
  const ascentPct = netDiff > 1 && best > 0 ? Math.min((Math.log(best) / Math.log(netDiff)) * 100, 100) : 0;
  // … and the app-native linear "% to block" (matches closest-calls / rarity).
  const pctToBlock = netDiff > 0 && best > 0 ? (best / netDiff) * 100 : 0;

  const providerLabel = worker.minerType || worker.minerVendor || tt('Rented');
  const rewardBtc = blockReward && typeof blockReward.totalBtc === 'number' ? blockReward.totalBtc : null;

  const firstSeen = se.firstSeen || 0;
  const mins = firstSeen ? Math.max((Date.now() - firstSeen) / 60000, 0.1) : 0;
  const strikeRate = mins > 0 ? Math.round(accepted / mins) : null;

  useEffect(() => {
    const inner = innerRef.current, vp = vpRef.current;
    if (!inner) return;
    const recent = (worker.shareEvents && worker.shareEvents.recentSdiffs) || [];
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

  return (
    <div className="cs-card">
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

      <div className="cs-hist">
        <div className="cs-net" />
        <div className="cs-moon"><img src={MOON_SRC} alt={tt('network difficulty')} /></div>
        <div className="cs-netlbl">{tt('network difficulty')} {fmtDiff(netDiff)}</div>
        <div className="cs-trav">{SHUTTLE}</div>
        <div className="cs-vp" ref={vpRef}><div className="cs-inner" ref={innerRef} /></div>
      </div>

      <div className="cs-lgnd">
        <span className="cs-lg"><i style={{ background: '#8b9098' }} />{tt('share difficulty')}</span>
        <span className="cs-lg"><i style={{ background: 'var(--amber)' }} />{tt('best · close to reward')}</span>
        <span className="cs-lg"><i style={{ background: 'transparent', borderTop: '2px dashed var(--text-1)', height: 0, width: 9 }} />{tt('network difficulty')}</span>
      </div>

      <div className="cs-grid">
        <div className="cs-kv"><span className="k">{tt('Network diff')}</span><span className="v">{fmtDiff(netDiff)}</span></div>
        <div className="cs-kv"><span className="k">{tt('Best share')}</span><span className="v am">{fmtDiff(best)}</span></div>
        <div className="cs-kv"><span className="k">{tt('To block')}</span><span className="v">{fmtPctToBlock(pctToBlock)}</span></div>
        <div className="cs-kv"><span className="k">{tt('Shares accepted')}</span><span className="v">{accepted.toLocaleString()}</span></div>
      </div>
      {strikeRate != null && (
        <div className="cs-grid" style={{ marginTop: 5 }}>
          <div className="cs-kv"><span className="k">{tt('Strike rate')}</span><span className="v">{strikeRate} /min</span></div>
          <div className="cs-kv"><span className="k">{tt('Worker')}</span><span className="v" style={{ fontSize: '0.6rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{worker.displayName || worker.name}</span></div>
        </div>
      )}
    </div>
  );
}

// Wrapper: renders a Strike Force card for every online rented/Braiins worker,
// newest-best first. Returns null (renders nothing) when none are active, so it
// naturally disappears from the top of the card list when no rental is hashing.
export function StrikeForceCards({ workers, network, blockReward, t, GLYPH_SRC }) {
  const list = Array.isArray(workers) ? workers : [];
  const rented = list.filter((w) => {
    if (!w || w.status === 'offline') return false;
    const v = (w.minerVendor || '').toString().toLowerCase();
    return v === 'rented' || v === 'braiins';
  });
  if (!rented.length) return null;
  rented.sort((a, b) => ((b.shareEvents && b.shareEvents.bestSinceReset) || 0) - ((a.shareEvents && a.shareEvents.bestSinceReset) || 0));
  return (
    <>
      <style>{CSS}</style>
      {rented.map((w) => (
        <StrikeForceCard key={w.name} worker={w} network={network} blockReward={blockReward} t={t} GLYPH_SRC={GLYPH_SRC} />
      ))}
    </>
  );
}

export default StrikeForceCards;
