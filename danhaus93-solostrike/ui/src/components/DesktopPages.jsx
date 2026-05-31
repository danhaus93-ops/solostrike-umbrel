// ============================================================================
// SoloStrike Desktop 3-Page Layout (v1.12.0) — HARDENED containment build
// ============================================================================
// Desktop/tablet only. Mobile keeps the .ss-carousel system. Arranges the
// existing card components into three horizontally-sliding pages.
//
// HARDENING (fixes "all 3 pages tile side-by-side" + "mobile shows pages"):
//   1. The slider ROOT is fully self-contained — does NOT rely on a parent
//      <main> being display:flex or width-clamped. It sets its own width:100%,
//      maxWidth:100%, overflow:hidden, and a concrete height. The clip layer
//      pins overflow:hidden so the width:300% track can never spill.
//   2. Internal width guard: ≤767px renders null so the mobile carousel
//      (rendered separately) is what shows, even if App.jsx mis-gates.
// ============================================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';

const PAGE_META = [
  { key: 'glance',    title: 'My rig at a glance' },
  { key: 'internals', title: 'Pool internals' },
  { key: 'analytics', title: 'Luck & analytics' },
];

const DEFAULT_PAGE_ASSIGN = {
  hashrate: 0, strikevel: 0, pulse: 0, hunt: 0, workers: 0,
  network: 0, node: 0, stratum: 0, shares: 0, closestcalls: 0,
  jumpers: 0, recent: 0, health: 0, best: 0, luck: 0,
  hashwindows: 1, spswindows: 1, connstates: 1, besttrend: 1,
  effort: 2, stability: 2, rejects: 2, retarget: 2, fleeteff: 2, reliability: 2,
};

function useIsNarrow() {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const on = (e) => setNarrow(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', on); else mq.addListener(on);
    return () => { if (mq.removeEventListener) mq.removeEventListener('change', on); else mq.removeListener(on); };
  }, []);
  return narrow;
}

export default function DesktopPages({ cardComponents, order, visibleSet, pageAssign, persistedOrder, onOrderChange }) {
  const assign = pageAssign || DEFAULT_PAGE_ASSIGN;
  const [page, setPage] = useState(0);
  const NPAGES = PAGE_META.length;
  const isNarrow = useIsNarrow();

  const buildPages = useCallback(() => {
    const pages = [[], [], []];
    const seen = new Set();
    (order || []).forEach(id => {
      if (!visibleSet.has(id)) return;
      if (!cardComponents[id]) return;
      const p = assign[id]; if (p == null) return;
      pages[p].push(id); seen.add(id);
    });
    Object.keys(assign).forEach(id => {
      if (seen.has(id)) return;
      if (!visibleSet.has(id)) return;
      if (!cardComponents[id]) return;
      pages[assign[id]].push(id);
    });
    return pages;
  }, [order, visibleSet, cardComponents, assign]);

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

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight') go(page + 1);
      else if (e.key === 'ArrowLeft') go(page - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, go]);

  const dragRef = useRef({ pageIdx: null, fromId: null });
  const onDragStart = (pageIdx, id) => { dragRef.current = { pageIdx, fromId: id }; };
  const onDragOverCard = (e) => { e.preventDefault(); };
  const onDropCard = (pageIdx, overId) => {
    const { pageIdx: fromPage, fromId } = dragRef.current;
    if (fromPage !== pageIdx || !fromId || fromId === overId) return;
    setPageOrders(prev => {
      const next = prev.map(arr => arr.slice());
      const arr = next[pageIdx];
      const fi = arr.indexOf(fromId), oi = arr.indexOf(overId);
      if (fi < 0 || oi < 0) return prev;
      arr.splice(fi, 1);
      arr.splice(oi, 0, fromId);
      if (typeof onOrderChange === 'function') onOrderChange(next);
      return next;
    });
    dragRef.current = { pageIdx: null, fromId: null };
  };

  // HARDENING #2: internal mobile guard.
  if (isNarrow) return null;

  return (
    <div style={{
      position:'relative', width:'100%', maxWidth:'100%',
      height:'calc(100vh - 190px)', minHeight:0, overflow:'hidden', boxSizing:'border-box',
    }}>
      <div style={{ position:'absolute', inset:0, width:'100%', height:'100%', overflow:'hidden' }}>
        <div style={{
          display:'flex', flexWrap:'nowrap',
          width:`${NPAGES * 100}%`, height:'100%',
          transform:`translateX(-${page * (100 / NPAGES)}%)`,
          transition:'transform 0.42s cubic-bezier(.6,.02,.2,1)', willChange:'transform',
        }}>
          {PAGE_META.map((meta, pIdx) => (
            <section key={meta.key} style={{
              width:`${100 / NPAGES}%`, flex:`0 0 ${100 / NPAGES}%`,
              height:'100%', overflowY:'auto', overflowX:'hidden',
              padding:'0.65rem', boxSizing:'border-box',
            }}>
              <div style={{
                fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.2em',
                textTransform:'uppercase', color:'var(--text-3)', marginBottom:'0.6rem',
              }}>
                {meta.title} · page {pIdx + 1} / {NPAGES}
              </div>
              <div style={{
                display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(300px, 1fr))',
                gap:'0.65rem', alignItems:'start',
              }}>
                {(pageOrders[pIdx] || []).map(id => (
                  <div key={id} draggable
                       onDragStart={() => onDragStart(pIdx, id)}
                       onDragOver={onDragOverCard}
                       onDrop={() => onDropCard(pIdx, id)}
                       style={{
                         background:'linear-gradient(180deg, var(--bg-raised), var(--bg-surface))',
                         border:'1px solid var(--border)', borderRadius:'12px',
                         padding:'0.9rem', cursor:'grab', minWidth:0,
                       }}>
                    {cardComponents[id]}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      {page > 0 && (
        <button onClick={() => go(page - 1)} aria-label="Previous page" style={chevronStyle('left')}>❮</button>
      )}
      {page < NPAGES - 1 && (
        <button onClick={() => go(page + 1)} aria-label="Next page" style={chevronStyle('right')}>❯</button>
      )}

      <div style={{ position:'absolute', bottom:6, left:'50%', transform:'translateX(-50%)', display:'flex', gap:7, zIndex:6 }}>
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
