// ============================================================================
// SoloStrike Desktop 3-Page Layout (v1.12.0)
// ============================================================================
// Desktop/tablet only (rendered when !useCarousel). Mobile keeps the existing
// .ss-carousel card system untouched. This arranges the existing card
// components into three horizontally-sliding pages:
//   Page 1 "My rig at a glance"  — the daily-driver cards
//   Page 2 "Pool internals"      — ckpool-native windows, fleet, internals
//   Page 3 "Luck & analytics"    — effort/luck, stability, trends, efficiency
//
// Behaviour mirrors the validated preview:
//   - one page visible at a time (overflow clipped); others slide in
//   - free-floating semi-transparent amber chevrons (no box), 3 dots
//   - ArrowLeft/ArrowRight keys + dot taps navigate
//   - drag-to-rearrange WITHIN a page only (never across pages)
//   - cards that the user hides via Settings simply don't appear on their page
//
// Cards are passed in as a { id -> ReactNode } map (cardComponents from App).
// Each page lists the card ids it wants, in order; missing/hidden ids are
// skipped. Drag reorder mutates a per-page order kept in component state and
// is purely visual (does not persist) — the desktop pages are a fixed
// editorial grouping, unlike the user-orderable mobile carousel.
// ============================================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';

const PAGE_META = [
  { key: 'glance',    title: 'My rig at a glance' },
  { key: 'internals', title: 'Pool internals' },
  { key: 'analytics', title: 'Luck & analytics' },
];

// default editorial assignment of card ids → page index.
// Page 1: the existing glance cards. Page 2/3: internals + analytics.
const DEFAULT_PAGE_ASSIGN = {
  // page 0 — glance
  hashrate: 0, strikevel: 0, pulse: 0, hunt: 0, workers: 0,
  network: 0, node: 0, stratum: 0, shares: 0, closestcalls: 0,
  jumpers: 0, recent: 0, health: 0, best: 0, luck: 0,
  // page 1 — internals
  hashwindows: 1, spswindows: 1, connstates: 1, besttrend: 1,
  // page 2 — analytics
  effort: 2, stability: 2, rejects: 2, retarget: 2, fleeteff: 2, reliability: 2,
};

export default function DesktopPages({ cardComponents, order, visibleSet, pageAssign, persistedOrder, onOrderChange }) {
  const assign = pageAssign || DEFAULT_PAGE_ASSIGN;
  const [page, setPage] = useState(0);
  const NPAGES = PAGE_META.length;

  // Build per-page ordered id lists from the global order, filtered to visible
  // + assigned to that page. Kept in state so within-page drag can reorder.
  const buildPages = useCallback(() => {
    const pages = [[], [], []];
    // honor the user's global `order` for page 1 glance cards; pages 2/3 use
    // a fixed editorial order from assign insertion.
    const seen = new Set();
    (order || []).forEach(id => {
      if (!visibleSet.has(id)) return;
      if (!cardComponents[id]) return;
      const p = assign[id]; if (p == null) return;
      pages[p].push(id); seen.add(id);
    });
    // append any assigned-but-not-in-order ids (new analytics cards)
    Object.keys(assign).forEach(id => {
      if (seen.has(id)) return;
      if (!visibleSet.has(id)) return;
      if (!cardComponents[id]) return;
      pages[assign[id]].push(id);
    });
    return pages;
  }, [order, visibleSet, cardComponents, assign]);

  // Merge persisted order with the freshly-built default: keep persisted
  // sequence for ids still present, append any new/unseen ids in default order,
  // drop ids no longer visible/available. This survives card-visibility changes
  // and app updates that add new cards.
  const reconcile = useCallback(() => {
    const def = buildPages();
    if (!Array.isArray(persistedOrder) || persistedOrder.length !== def.length) return def;
    return def.map((defArr, pIdx) => {
      const saved = Array.isArray(persistedOrder[pIdx]) ? persistedOrder[pIdx] : [];
      const avail = new Set(defArr);
      const kept = saved.filter(id => avail.has(id));
      const keptSet = new Set(kept);
      const appended = defArr.filter(id => !keptSet.has(id));
      return [...kept, ...appended];
    });
  }, [buildPages, persistedOrder]);

  const [pageOrders, setPageOrders] = useState(reconcile);
  useEffect(() => { setPageOrders(reconcile()); }, [reconcile]);

  const go = useCallback((p) => setPage(Math.max(0, Math.min(NPAGES - 1, p))), [NPAGES]);

  // keyboard nav
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(page + 1);
      else if (e.key === 'ArrowLeft') go(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, go]);

  // ── within-page drag reorder ──────────────────────────────────────────────
  const dragRef = useRef({ pageIdx: null, fromId: null });
  const onDragStart = (pageIdx, id) => { dragRef.current = { pageIdx, fromId: id }; };
  const onDragOverCard = (e) => { e.preventDefault(); };
  const onDropCard = (pageIdx, overId) => {
    const { pageIdx: fromPage, fromId } = dragRef.current;
    if (fromPage !== pageIdx || !fromId || fromId === overId) return; // same page only
    setPageOrders(prev => {
      const next = prev.map(arr => arr.slice());
      const arr = next[pageIdx];
      const fi = arr.indexOf(fromId), oi = arr.indexOf(overId);
      if (fi < 0 || oi < 0) return prev;
      arr.splice(fi, 1);
      arr.splice(oi, 0, fromId);
      // v1.12.0: persist the new per-page order across reloads.
      if (typeof onOrderChange === 'function') onOrderChange(next);
      return next;
    });
    dragRef.current = { pageIdx: null, fromId: null };
  };

  return (
    <div style={{ position:'relative', width:'100%', flex:1, minHeight:0 }}>
      {/* clipped viewport: only the active page shows */}
      <div style={{ width:'100%', height:'100%', overflow:'hidden' }}>
        <div style={{
          display:'flex',
          width:`${NPAGES * 100}%`,
          height:'100%',
          transform:`translateX(-${page * (100 / NPAGES)}%)`,
          transition:'transform 0.42s cubic-bezier(.6,.02,.2,1)',
        }}>
          {PAGE_META.map((meta, pIdx) => (
            <section key={meta.key} style={{ width:`${100 / NPAGES}%`, height:'100%', overflowY:'auto', padding:'0.65rem' }}>
              <div style={{
                fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.2em',
                textTransform:'uppercase', color:'var(--text-3)', marginBottom:'0.6rem',
              }}>
                {meta.title} · page {pIdx + 1} / {NPAGES}
              </div>
              <div style={{
                display:'grid',
                gridTemplateColumns:'repeat(auto-fill, minmax(320px, 1fr))',
                gap:'0.65rem',
                alignItems:'start',
              }}>
                {(pageOrders[pIdx] || []).map(id => (
                  <div key={id}
                       draggable
                       onDragStart={() => onDragStart(pIdx, id)}
                       onDragOver={onDragOverCard}
                       onDrop={() => onDropCard(pIdx, id)}
                       style={{
                         background:'linear-gradient(180deg, var(--bg-raised), var(--bg-surface))',
                         border:'1px solid var(--border)',
                         borderRadius:'12px',
                         padding:'0.9rem',
                         cursor:'grab',
                       }}>
                    {cardComponents[id]}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* floating chevrons — no box, semi-transparent amber */}
      {page > 0 && (
        <button onClick={() => go(page - 1)} aria-label="Previous page"
                style={chevronStyle('left')}>❮</button>
      )}
      {page < NPAGES - 1 && (
        <button onClick={() => go(page + 1)} aria-label="Next page"
                style={chevronStyle('right')}>❯</button>
      )}

      {/* page dots */}
      <div style={{
        position:'absolute', bottom:6, left:'50%', transform:'translateX(-50%)',
        display:'flex', gap:7, zIndex:6,
      }}>
        {PAGE_META.map((_, i) => (
          <button key={i} onClick={() => go(i)} aria-label={`Page ${i+1}`}
                  style={{
                    width: i === page ? 18 : 7, height:7, borderRadius:4, border:'none',
                    background: i === page ? 'var(--amber)' : 'rgba(var(--amber-rgb),0.3)',
                    boxShadow: i === page ? '0 0 7px var(--amber)' : 'none',
                    cursor:'pointer', padding:0, transition:'all 0.2s ease',
                  }}/>
        ))}
      </div>
    </div>
  );
}

function chevronStyle(side) {
  return {
    position:'absolute', top:'50%', [side]: 8, transform:'translateY(-50%)',
    background:'transparent', border:'none', cursor:'pointer', zIndex:6,
    fontSize:'2.4rem', lineHeight:1, color:'var(--amber)', opacity:0.45,
    padding:'0 0.4rem', fontFamily:'var(--fd)', transition:'opacity 0.2s ease',
  };
}

export { DEFAULT_PAGE_ASSIGN, PAGE_META };
