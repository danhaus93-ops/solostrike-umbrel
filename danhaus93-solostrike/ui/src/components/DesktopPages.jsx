// ============================================================================
// SoloStrike Desktop — 3-page dashboard (v1.12.x)
// ----------------------------------------------------------------------------
// Layout = the preview template (box-free hairline zones, exact band grid).
// Content = the REAL card components, dropped into each zone. This gives the
// real WebGL globe (PulsePanel), real Hunt (HuntPanel), the real Crew
// (WorkerGrid), real metrics, and every click→modal — all his tested code,
// because each cardComponents[id] is already built in App with its data +
// modal callbacks wired.
//
// Why the globe was blank before: stripping the card chrome with
// `height/padding: !important` collapsed PulsePanel's ResizeObserver-measured
// canvas to 0. Fix: neutralize ONLY background/border/shadow (the "box" look),
// never dimensions — so the globe sizes correctly and the layout stays box-free.
//
// CONTAINMENT: one page rendered at a time (no track, no scaler); .ssdesk has a
// definite height so the stage can't collapse; zones clip overflow.
// Desktop/tablet only (≥600px) — narrower keeps the mobile layout.
// ============================================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';

// preview zones → real card ids (mirrors the template band layout)
const PAGES = [
  { // PAGE 1 — Live
    rows: 'minmax(140px,1fr) minmax(0,1.7fr) minmax(0,0.95fr) minmax(0,0.62fr)',
    bands: [
      { cols: '1fr 1fr', ids: ['hashrate', 'strikevel'] },
      { cols: '1fr 1fr 1.4fr', ids: ['pulse', 'hunt', 'workers'] },
      { cols: 'repeat(8,1fr)', data: true, ids: ['network', 'node', 'stratum', 'closestcalls', 'best', 'luck', 'jumpers', 'shares'] },
      { cols: '2.2fr 1.2fr', data: true, top: true, ids: ['recent', 'health'] },
    ],
  },
  { // PAGE 2 — Pool Internals
    rows: 'minmax(0,1fr) minmax(0,1.25fr) minmax(0,0.7fr)',
    bands: [
      { cols: '1.5fr 1fr 1fr', ids: ['hashwindows', 'spswindows', 'connstates'] },
      { cols: '1fr', ids: ['workers'] },
      { cols: 'repeat(4,1fr)', data: true, ids: ['besttrend', 'shares', 'reliability', 'retarget'] },
    ],
  },
  { // PAGE 3 — Luck & Analytics
    rows: 'minmax(0,1fr) minmax(0,1fr) minmax(0,0.7fr)',
    bands: [
      { cols: '1.7fr 1fr', ids: ['effort', 'stability'] },
      { cols: '1fr 1fr 1fr', ids: ['rejects', 'retarget', 'fleeteff'] },
      { cols: 'repeat(4,1fr)', data: true, ids: ['best', 'luck', 'fleeteff', 'reliability'] },
    ],
  },
];
const LABELS = ['Live', 'Pool Internals', 'Luck & Analytics'];

const CSS = `
.ssdesk{position:relative;width:100%;height:100dvh;min-height:0;display:flex;flex-direction:column;overflow:hidden;
  --hair:rgba(var(--amber-rgb),0.14);
  background:radial-gradient(1100px 600px at 72% -12%,rgba(var(--amber-rgb),0.07),transparent 60%),radial-gradient(800px 520px at -10% 112%,rgba(0,255,209,0.04),transparent 55%),var(--bg-void)}
.ssdesk .ssd-head{display:flex;align-items:center;gap:.5rem;flex:0 0 auto;min-height:42px;padding:6px 16px;border-bottom:1px solid var(--hair)}
.ssdesk .ssd-pick{width:16px;height:16px;object-fit:contain;display:block;flex:none;filter:drop-shadow(0 0 8px rgba(var(--amber-rgb),0.7))}
.ssdesk .ssd-wm{font-family:var(--fd);font-size:.92rem;font-weight:700;letter-spacing:.06em;color:var(--amber);text-transform:uppercase}
.ssdesk .ssd-div{width:1px;height:16px;background:rgba(var(--amber-rgb),0.2)}
.ssdesk .ssd-status{font-family:var(--fd);font-size:.56rem;letter-spacing:.12em;text-transform:uppercase;color:var(--green);text-shadow:0 0 6px var(--green);white-space:nowrap}
.ssdesk .ssd-zmq{font-family:var(--fd);font-size:.48rem;letter-spacing:.1em;text-transform:uppercase;color:var(--cyan);border:1px solid rgba(0,255,209,.3);border-radius:4px;padding:1px 5px;white-space:nowrap}
.ssdesk .ssd-pl{font-family:var(--fd);font-size:.58rem;letter-spacing:.1em;color:var(--text-2);white-space:nowrap}.ssdesk .ssd-pl b{color:var(--text-1)}
.ssdesk .ssd-mq{flex:1;min-width:0;max-width:760px;margin:0 auto;height:30px;display:flex;align-items:center}
.ssdesk .ssd-mq>.ss-marquee{flex:1;min-width:0}
.ssdesk .ssd-right{display:flex;align-items:center;gap:.6rem;flex:0 0 auto;margin-left:auto}
.ssdesk .ssd-clock{display:flex;flex-direction:column;align-items:flex-end;line-height:1.05;font-family:var(--fd)}
.ssdesk .ssd-clock .lv{font-size:.5rem;letter-spacing:.12em;color:var(--cyan);text-shadow:0 0 6px var(--cyan)}
.ssdesk .ssd-clock .tm{font-size:.5rem;color:var(--amber);font-family:var(--fm)}
.ssdesk .ssd-gear{background:none;border:none;color:var(--text-2);cursor:pointer;font-size:16px}

.ssdesk .ssd-stage{flex:1;min-height:0;overflow:hidden;position:relative}
.ssdesk .ssd-page{position:absolute;inset:0;display:grid;padding:8px 14px 20px;row-gap:9px;overflow:hidden}
.ssdesk .band{display:grid;gap:14px;min-height:0}
.ssdesk .band.top{border-top:1px solid var(--hair);padding-top:6px}
.ssdesk .zone{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}
/* box-free hairline separators for the small data rows */
.ssdesk .band.data{gap:0}
.ssdesk .band.data .zone{padding:0 10px;border-left:1px solid var(--hair)}
.ssdesk .band.data .zone:first-child{padding-left:0;border-left:0}

/* host the REAL card: fill the zone, but neutralize ONLY the box chrome.
   Never touch height/padding/display — that is what collapsed the globe. */
.ssdesk .zone > *{flex:1;min-height:0;width:100%;max-width:100%;
  background:transparent!important;background-image:none!important;
  border-color:transparent!important;box-shadow:none!important;border-radius:0!important}

.ssdesk .ssd-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:55;width:30px;height:64px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:none;border:none;color:var(--amber);font-size:30px;opacity:.4;transition:opacity .18s;user-select:none;text-shadow:0 0 12px rgba(var(--amber-rgb),.55)}
.ssdesk .ssd-nav:hover{opacity:.95}.ssdesk .ssd-nav.l{left:8px}.ssdesk .ssd-nav.r{right:8px}.ssdesk .ssd-nav.hidden{opacity:0;pointer-events:none}
.ssdesk .ssd-dots{position:absolute;bottom:7px;left:50%;transform:translateX(-50%);z-index:55;display:flex;gap:8px;align-items:center}
.ssdesk .ssd-dots i{width:8px;height:8px;border-radius:50%;background:rgba(var(--amber-rgb),.3);cursor:pointer;transition:all .2s}
.ssdesk .ssd-dots i.on{width:20px;border-radius:4px;background:var(--amber);box-shadow:0 0 8px var(--amber)}
`;

function useNow(){ const [t,setT]=useState(()=>new Date()); useEffect(()=>{const id=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(id);},[]); return t; }
function useIsNarrow(){ const [n,setN]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(max-width: 599px)').matches);
  useEffect(()=>{ if(typeof window==='undefined')return; const mq=window.matchMedia('(max-width: 599px)'); const on=e=>setN(e.matches);
    mq.addEventListener?mq.addEventListener('change',on):mq.addListener(on); return()=>{mq.removeEventListener?mq.removeEventListener('change',on):mq.removeListener(on);}; },[]); return n; }

export default function DesktopPages({
  cardComponents = {}, ticker = null, onOpenSettings,
  status = 'Mining Live', zmq = null, strikes = 0,
}){
  const narrow=useIsNarrow();
  const now=useNow();
  const [page,setPage]=useState(0);
  const NP=3;
  const startX=useRef(null);
  const go=useCallback(p=>setPage(Math.max(0,Math.min(NP-1,p))),[]);

  useEffect(()=>{ const on=e=>{if(e.key==='ArrowRight')go(page+1);if(e.key==='ArrowLeft')go(page-1);}; window.addEventListener('keydown',on); return()=>window.removeEventListener('keydown',on); },[page,go]);
  useEffect(()=>{ const el=document.getElementById('ssdesk-css'); if(el)el.remove(); const s=document.createElement('style');s.id='ssdesk-css';s.textContent=CSS;document.head.appendChild(s); },[]);

  if(narrow) return null;

  const zmqOk=zmq&&(zmq.connected||zmq.synced||zmq===true);
  const cfg=PAGES[page];

  return (
    <div className="ssdesk"
      onTouchStart={e=>{startX.current=e.touches[0].clientX;}}
      onTouchEnd={e=>{if(startX.current==null)return;const dx=e.changedTouches[0].clientX-startX.current;if(Math.abs(dx)>60)go(dx<0?page+1:page-1);startX.current=null;}}>

      <div className="ssd-head">
        <img className="ssd-pick" src="/pickaxe-icon.png" alt="⛏" draggable={false}/><span className="ssd-wm">SoloStrike</span><span className="ssd-div"/>
        <span className="ssd-status">{page===0?status:LABELS[page]}</span>
        <span className="ssd-zmq">{page===1?'ckpool':page===2?'stats':`ZMQ ${zmqOk?'●':'○'}`}</span>
        <span className="ssd-pl">{page===0?<>STRIKES <b>{strikes ?? 0}</b></>:<>PAGE <b>{page+1} / 3</b></>}</span>
        <div className="ssd-mq">{ticker}</div>
        <div className="ssd-right"><div className="ssd-clock"><span className="lv">LIVE</span><span className="tm">{now.toLocaleTimeString('en-US',{hour12:false})}</span></div><button className="ssd-gear" title="Settings" onClick={()=>onOpenSettings&&onOpenSettings()}>⚙</button></div>
      </div>

      <div className="ssd-stage">
        <div className="ssd-page" style={{gridTemplateRows:cfg.rows}}>
          {cfg.bands.map((band,bi)=>(
            <div key={bi} className={`band${band.data?' data':''}${band.top?' top':''}`} style={{gridTemplateColumns:band.cols}}>
              {band.ids.map((id,i)=>(
                <div key={id+'-'+i} className="zone">{cardComponents[id] || null}</div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <button className={`ssd-nav l${page===0?' hidden':''}`} onClick={()=>go(page-1)}>❮</button>
      <button className={`ssd-nav r${page===NP-1?' hidden':''}`} onClick={()=>go(page+1)}>❯</button>
      <div className="ssd-dots">{[0,1,2].map(i=><i key={i} className={i===page?'on':''} onClick={()=>go(i)} title={LABELS[i]}/>)}</div>
    </div>
  );
}
