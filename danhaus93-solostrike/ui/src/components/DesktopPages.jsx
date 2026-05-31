// ============================================================================
// SoloStrike Desktop — 3-page dashboard (v1.12.x) — CONTAINED REBUILD
// ----------------------------------------------------------------------------
// Layout = the preview template (box-free hairline zones). Content = real data.
// CONTAINMENT: exactly ONE page is rendered at a time (no sliding track, no
// 1280×860 scaler) — so pages can NEVER overlap again. Each page is a CSS grid
// that fills the viewport; every zone is overflow:hidden so nothing spills.
// The Pulse + Hunt zones host the REAL components (real WebGL globe / lightning)
// passed in via cardComponents, clipped to their zone. Everything else is the
// template's own compact widgets wired to live poolState (sized to fit).
// Desktop/tablet only — mobile keeps the .ss-carousel.
// ============================================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';

const CSS = `
.ssdesk{position:relative;width:100%;height:100%;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;
  --hair:rgba(var(--amber-rgb),0.14);
  background:radial-gradient(1100px 600px at 72% -12%,rgba(var(--amber-rgb),0.08),transparent 60%),radial-gradient(800px 520px at -10% 112%,rgba(0,255,209,0.04),transparent 55%),var(--bg-void)}
.ssdesk .ssd-head{display:flex;align-items:center;gap:.5rem;flex:0 0 auto;min-height:42px;padding:6px 16px;border-bottom:1px solid var(--hair)}
.ssdesk .ssd-pick{font-size:16px;filter:drop-shadow(0 0 8px rgba(var(--amber-rgb),0.7))}
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
.ssdesk .ssd-page{position:absolute;inset:0;display:grid;padding:10px 16px 22px;row-gap:10px;column-gap:18px;overflow:hidden}
.ssdesk .zone{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column}
/* real cards (pulse/hunt) dropped into a zone: strip chrome + clip */
.ssdesk .zone.real>*{min-height:0;height:100%;width:100%;overflow:hidden;background:transparent!important;border:none!important;border-radius:0!important;box-shadow:none!important;padding:0!important}

.ssdesk .zlabel{font-family:var(--fd);font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;color:var(--text-2);margin:0 0 6px;padding-bottom:.3rem;flex:0 0 auto;
  background-image:linear-gradient(90deg,rgba(var(--amber-rgb),0.5),rgba(var(--amber-rgb),0.12) 60%,transparent);background-repeat:no-repeat;background-size:100% 1px;background-position:bottom left}
.ssdesk .zbody{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.ssdesk .amber{color:var(--amber)}.ssdesk .cyan{color:var(--cyan)}.ssdesk .green{color:var(--green)}.ssdesk .red{color:var(--red)}.ssdesk .unit{color:var(--text-3);font-weight:400}
.ssdesk .goldnum{background:linear-gradient(180deg,var(--amber-hot),var(--amber) 55%,var(--amber-dim));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}

.ssdesk .bignum{font-family:var(--fd);font-weight:700;font-size:1.5rem;line-height:.95}
.ssdesk .subtxt{font-family:var(--fm);font-size:.52rem;color:var(--amber-dim)}
.ssdesk .fpchart{flex:1;min-height:24px;position:relative}.ssdesk .fpchart svg{position:absolute;inset:0;width:100%;height:100%}
.ssdesk .avgs{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;flex:0 0 auto}
.ssdesk .avg .al{font-family:var(--fd);font-size:.46rem;font-weight:700;color:var(--text-2);text-align:center}
.ssdesk .avg.on .al{color:var(--amber)}
.ssdesk .avg .bar{height:4px;border-radius:2px;background:var(--bg-deep);overflow:hidden;margin:2px 0}.ssdesk .avg .bar i{display:block;height:100%;background:linear-gradient(90deg,rgba(var(--amber-rgb),.35),var(--amber))}
.ssdesk .avg .av{font-family:var(--fd);font-size:.52rem;font-weight:700;color:var(--amber);text-align:center}
.ssdesk .svhist{flex:1;min-height:24px;display:flex;align-items:flex-end;gap:1px}.ssdesk .svhist i{flex:1;border-radius:1px 1px 0 0;background:var(--green)}.ssdesk .svhist i.out{background:var(--amber)}.ssdesk .svhist i.down{background:var(--red)}
.ssdesk .rng{display:flex;gap:4px}.ssdesk .rng span{font-family:var(--fd);font-size:.46rem;font-weight:700;padding:1px 5px;border-radius:4px;border:1px solid var(--border-hot);color:var(--text-2)}.ssdesk .rng span.on{color:var(--amber);background:rgba(var(--amber-rgb),.08)}

.ssdesk .crew{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(0,1fr);gap:4px 10px;flex:1;min-height:0;overflow:hidden}
.ssdesk .miner{border-radius:6px;padding:3px 5px;display:flex;flex-direction:column;justify-content:center;gap:3px;min-width:0}
.ssdesk .miner .top{display:flex;align-items:center;gap:5px}
.ssdesk .miner .dot{width:5px;height:5px;border-radius:50%;background:var(--green);box-shadow:0 0 5px var(--green);flex:none}.ssdesk .miner.off .dot{background:var(--red);box-shadow:0 0 5px var(--red)}
.ssdesk .miner .nm{font-family:var(--fd);font-size:.55rem;font-weight:700;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ssdesk .miner .hash{margin-left:auto;font-family:var(--fd);font-size:.58rem;color:var(--amber);flex-shrink:0}
.ssdesk .tele{display:grid;grid-template-columns:repeat(4,1fr);gap:2px}
.ssdesk .tele div{font-size:.4rem;color:var(--text-2);text-align:center;line-height:1.1;overflow:hidden}.ssdesk .tele b{display:block;font-family:var(--fd);font-size:.5rem;color:var(--text-1);white-space:nowrap}.ssdesk .tele .warm b{color:var(--amber)}.ssdesk .tele .hot b{color:var(--red)}
.ssdesk .up{display:flex;height:3px;gap:1px;margin-top:2px}.ssdesk .up i{flex:1;border-radius:.5px;background:var(--bg-deep)}.ssdesk .up i.on{background:rgba(57,255,106,.65)}.ssdesk .up i.dn{background:rgba(232,67,67,.7)}

.ssdesk .cols{display:grid;min-height:0;align-self:stretch}
.ssdesk .col{padding:0 10px;border-left:1px solid var(--hair);min-width:0;overflow:hidden}
.ssdesk .col:first-child{padding-left:0;border-left:0}
.ssdesk .col .ch{font-family:var(--fd);font-size:.48rem;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--amber);margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssdesk .dl{display:flex;justify-content:space-between;align-items:baseline;padding:2px 0;font-size:.58rem;gap:4px}
.ssdesk .dl+.dl{border-top:1px solid rgba(var(--amber-rgb),0.06)}
.ssdesk .dl .k{color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ssdesk .dl .v{color:var(--text-1);font-weight:500;font-family:var(--fd);white-space:nowrap;flex-shrink:0}
.ssdesk .st{display:flex;align-items:center;gap:5px;font-size:.52rem;color:var(--text-2)}
.ssdesk .st .d{width:5px;height:5px;border-radius:50%;background:var(--green);box-shadow:0 0 5px var(--green)}

.ssdesk .gauges{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;flex:1;align-content:center}
.ssdesk .gauge{display:flex;flex-direction:column;align-items:center;gap:2px}.ssdesk .gauge svg{width:100%;max-width:78px}
.ssdesk .gauge .gw{font-family:var(--fd);font-size:.46rem;color:var(--text-2);text-transform:uppercase}
.ssdesk .gauge .gv{font-family:var(--fd);font-size:.66rem;font-weight:700;color:var(--text-1)}
.ssdesk .gauge .gp{font-family:var(--fd);font-size:.56rem;font-weight:700;color:var(--amber)}
.ssdesk .spswins{display:flex;flex-direction:column;justify-content:center;gap:8px;flex:1}
.ssdesk .spsrow{display:flex;align-items:center;gap:8px}.ssdesk .spsrow .sl{font-family:var(--fd);font-size:.56rem;font-weight:700;color:var(--text-2);width:30px}
.ssdesk .spsrow .sbar{flex:1;height:7px;background:var(--bg-deep);border-radius:4px;overflow:hidden}.ssdesk .spsrow .sbar i{display:block;height:100%;background:linear-gradient(90deg,rgba(0,255,209,.4),var(--cyan))}
.ssdesk .spsrow .sv{font-family:var(--fd);font-size:.62rem;font-weight:700;color:var(--cyan);width:64px;text-align:right}
.ssdesk .donutwrap{display:flex;align-items:center;justify-content:center;gap:12px;flex:1}.ssdesk .donutwrap svg{width:104px;height:104px;flex:none}
.ssdesk .dlg{display:flex;align-items:center;gap:6px;font-size:.6rem;color:var(--text-2)}.ssdesk .dlg .sw{width:8px;height:8px;border-radius:2px}.ssdesk .dlg b{color:var(--text-1);font-family:var(--fd);margin-left:3px}

.ssdesk .wtable{width:100%;border-collapse:collapse;font-size:.58rem}
.ssdesk .wtable th{font-family:var(--fd);font-size:.46rem;letter-spacing:.08em;text-transform:uppercase;color:var(--text-2);text-align:left;padding:4px 6px;border-bottom:1px solid var(--border-hot);position:sticky;top:0;background:var(--bg-surface)}
.ssdesk .wtable td{padding:3px 6px;border-bottom:1px solid rgba(var(--amber-rgb),.07);font-family:var(--fm);color:var(--text-1);white-space:nowrap}
.ssdesk .wtable td.nm{font-family:var(--fd);font-weight:700}.ssdesk .wtable td.hr{color:var(--amber);font-family:var(--fd);font-weight:700}
.ssdesk .wtable td.hot{color:var(--red)}.ssdesk .wtable td.warm{color:var(--amber)}
.ssdesk .wscroll{overflow:auto;min-height:0;flex:1}

.ssdesk .effortwrap{flex:1;display:flex;align-items:flex-end;gap:5px;min-height:0;padding-top:6px}
.ssdesk .ebar{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;justify-content:flex-end;height:100%}
.ssdesk .ebar .col2{width:100%;border-radius:2px 2px 0 0;min-height:3px}.ssdesk .ebar .pct{font-family:var(--fd);font-size:.5rem;font-weight:700}.ssdesk .ebar .lab{font-family:var(--fd);font-size:.44rem;color:var(--text-3)}
.ssdesk .rejrow{display:flex;align-items:center;gap:8px;font-size:.58rem;padding:3px 0}.ssdesk .rejrow .rl{font-family:var(--fd);width:58px;color:var(--text-2);text-transform:uppercase;letter-spacing:.05em;font-size:.5rem}
.ssdesk .rejrow .rbar{flex:1;height:6px;background:var(--bg-deep);border-radius:4px;overflow:hidden}.ssdesk .rejrow .rbar i{display:block;height:100%;border-radius:4px}
.ssdesk .rejrow .rv{font-family:var(--fd);width:34px;text-align:right;color:var(--text-1);font-weight:700}
.ssdesk .tschart{width:100%;flex:1;min-height:30px}.ssdesk .tschart svg{display:block;width:100%;height:100%}

.ssdesk .ssd-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:55;width:30px;height:64px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:none;border:none;color:var(--amber);font-size:30px;opacity:.4;transition:opacity .18s;user-select:none;text-shadow:0 0 12px rgba(var(--amber-rgb),.55)}
.ssdesk .ssd-nav:hover{opacity:.95}.ssdesk .ssd-nav.l{left:10px}.ssdesk .ssd-nav.r{right:10px}.ssdesk .ssd-nav.hidden{opacity:0;pointer-events:none}
.ssdesk .ssd-dots{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);z-index:55;display:flex;gap:8px;align-items:center}
.ssdesk .ssd-dots i{width:8px;height:8px;border-radius:50%;background:rgba(var(--amber-rgb),.3);cursor:pointer;transition:all .2s}
.ssdesk .ssd-dots i.on{width:20px;border-radius:4px;background:var(--amber);box-shadow:0 0 8px var(--amber)}
`;

// ── formatters ──
const TH = h => (h ? h / 1e12 : 0);
function hrShort(h){ if(!h||h<=0)return '—'; const u=['H','K','M','G','T','P','E']; let i=0,v=h; while(v>=1000&&i<u.length-1){v/=1000;i++;} return `${v.toFixed(v<10?1:0)}${u[i]}`; }
function fmtTH(h){ return TH(h).toFixed(1); }

function useNow(){ const [t,setT]=useState(()=>new Date()); useEffect(()=>{const id=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(id);},[]); return t; }
function useIsNarrow(){ const [n,setN]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(max-width: 767px)').matches);
  useEffect(()=>{ if(typeof window==='undefined')return; const mq=window.matchMedia('(max-width: 767px)'); const on=e=>setN(e.matches);
    mq.addEventListener?mq.addEventListener('change',on):mq.addListener(on); return()=>{mq.removeEventListener?mq.removeEventListener('change',on):mq.removeListener(on);}; },[]); return n; }

// area-chart path from history [{hr}]
function areaPath(hist, field){
  const pts=(Array.isArray(hist)?hist:[]).map(h=>h[field]??h.hr??h.value).filter(Number.isFinite);
  if(pts.length<2)return null;
  const W=400,H=70,lo=Math.min(...pts),hi=Math.max(...pts),rng=(hi-lo)||1;
  const xy=pts.map((v,i)=>[ (i*(W/(pts.length-1))).toFixed(1), (H-((v-lo)/rng)*H).toFixed(1) ]);
  const ln='M'+xy.map(p=>p.join(' ')).join(' L');
  return {ln, fill:`${ln} L${W} ${H} L0 ${H} Z`};
}
function Spark({ data, field='hr', color='var(--amber)', fmt, unit }){
  const p=areaPath(data, field);
  return (
    <div className="tschart"><svg viewBox="0 0 400 70" preserveAspectRatio="none">
      {p && <><defs><linearGradient id={'g'+color.replace(/\W/g,'')} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".35"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      <path d={p.fill} fill={`url(#g${color.replace(/\W/g,'')})`}/><path d={p.ln} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/></>}
    </svg></div>
  );
}

function Crew({ workers, displayName, aliases }){
  const list=(workers||[]).slice(0,12);
  return (
    <div className="crew">
      {list.map((w,i)=>{
        const on=(w.hashrate||0)>0;
        const tC=w.live&&Number.isFinite(w.live.tempC)?Math.round(w.live.tempC):null;
        const tcls=tC>=70?'hot':tC>=60?'warm':'';
        const fan=w.live&&Number.isFinite(w.live.fanPct)?Math.round(w.live.fanPct)+'%':(w.live&&Number.isFinite(w.live.fanRpm)?w.live.fanRpm:'—');
        const acc=Number.isFinite(w.acceptRate)?(w.acceptRate*100).toFixed(1)+'%':'—';
        const hist=(Array.isArray(w.statusHistory)?w.statusHistory:[]).slice(-20);
        const type=(w.minerType||'—').replace(/Antminer |BitAxe |Avalon /,'');
        return (
          <div key={w.name||i} className={`miner${on?'':' off'}`} title={w.minerType||''}>
            <div className="top"><span className="dot"/><span className="nm">{(w.minerIcon||'▪')+' '+(displayName?displayName(w.name,aliases):w.name||'—')}</span><span className="hash">{on?hrShort(w.hashrate):'off'}</span></div>
            <div className="tele"><div className={tcls}><b>{tC!=null?tC+'°':'—'}</b>temp</div><div><b>{fan}</b>fan</div><div><b>{type}</b>type</div><div><b>{acc}</b>acc</div></div>
            {hist.length>0&&<div className="up">{hist.map((h,j)=>{const up=typeof h==='object'?(h.status!=='offline'&&h.status!=='disconnected'):!!h;return <i key={j} className={up?'on':'dn'}/>;})}</div>}
          </div>
        );
      })}
    </div>
  );
}

function Gauges({ windows, pct }){
  const W=[['1M','hr1m'],['5M','hr5m'],['15M','hr15m'],['1H','hr1h'],['6H','hr6h'],['1D','hr1d'],['7D','hr7d']];
  return (
    <div className="gauges">
      {W.map(([lab,key])=>{
        const v=windows?.[key], p=Math.max(0,Math.min(100,Math.round(pct?.[key]??0)));
        const r=34,c=Math.PI*r,off=c*(1-p/100);
        return (
          <div className="gauge" key={key}>
            <svg viewBox="0 0 80 48"><path d="M6 44 A34 34 0 0 1 74 44" fill="none" stroke="var(--bg-deep)" strokeWidth="7" strokeLinecap="round"/>
              <path d="M6 44 A34 34 0 0 1 74 44" fill="none" stroke="var(--amber)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}/></svg>
            <div className="gw">{lab}</div><div className="gv">{Number.isFinite(v)?fmtTH(v)+' T':'—'}</div><div className="gp">{p}%</div>
          </div>
        );
      })}
    </div>
  );
}

function Donut({ pool }){
  const active=Math.max(0,(pool?.workers||0)-(pool?.idle||0)-(pool?.disconnected||0));
  const idle=pool?.idle||0, disc=pool?.disconnected||0, tot=active+idle+disc||1;
  const segs=[[active,'var(--green)'],[idle,'var(--amber)'],[disc,'var(--red)']];
  const r=44,c=2*Math.PI*r; let off=0;
  return (
    <div className="donutwrap">
      <svg viewBox="0 0 120 120">
        {segs.map(([val,col],i)=>{const len=c*(val/tot);const el=<circle key={i} cx="60" cy="60" r={r} fill="none" stroke={col} strokeWidth="14" strokeDasharray={`${len} ${c-len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)"/>;off+=len;return el;})}
        <text x="60" y="58" textAnchor="middle" fontFamily="var(--fd)" fontSize="20" fontWeight="700" fill="var(--text-1)">{active+idle+disc}</text>
        <text x="60" y="74" textAnchor="middle" fontFamily="var(--fd)" fontSize="7" letterSpacing="1.5" fill="var(--text-3)">WORKERS</text>
      </svg>
      <div><div className="dlg"><span className="sw" style={{background:'var(--green)'}}/>Active <b>{active}</b></div>
        <div className="dlg"><span className="sw" style={{background:'var(--amber)'}}/>Idle <b>{idle}</b></div>
        <div className="dlg"><span className="sw" style={{background:'var(--red)'}}/>Disconnected <b>{disc}</b></div></div>
    </div>
  );
}

const Z = ({ label, children, className }) => (
  <div className={`zone${className?' '+className:''}`}>{label && <div className="zlabel">{label}</div>}<div className="zbody">{children}</div></div>
);
const DL = (k,v,cls)=> <div className="dl"><span className="k">{k}</span><span className={`v ${cls||''}`}>{v}</span></div>;

export default function DesktopPages({
  cardComponents = {}, poolState, workers = [], aliases = {}, displayName, stratumHealth,
  ticker = null, onOpenSettings, status = 'Mining Live', zmq = null, strikes = 0,
}){
  const narrow=useIsNarrow();
  const now=useNow();
  const [page,setPage]=useState(0);
  const NP=3;
  const startX=useRef(null);
  const go=useCallback(p=>setPage(Math.max(0,Math.min(NP-1,p))),[]);

  useEffect(()=>{ const on=e=>{if(e.key==='ArrowRight')go(page+1);if(e.key==='ArrowLeft')go(page-1);}; window.addEventListener('keydown',on); return()=>window.removeEventListener('keydown',on); },[page,go]);
  useEffect(()=>{ if(document.getElementById('ssdesk-css'))return; const el=document.createElement('style');el.id='ssdesk-css';el.textContent=CSS;document.head.appendChild(el); },[]);

  if(narrow) return null;

  const hr=poolState?.hashrate||{}, pool=poolState?.pool||{}, shares=poolState?.shares||{}, ns=poolState?.networkStats||{};
  const net=poolState?.network||{}, snap=poolState?.snapshots||{}, blocks=Array.isArray(poolState?.blocks)?poolState.blocks:[];
  const cur=hr.current||0, peak=pool.hashratePeak||hr.peak||0;
  const windows=pool.hashrateWindows||{}, pct=pool.hashrateWindowPct||{};
  const liveW=(workers||[]).filter(w=>(w.hashrate||0)>0).length, totW=(workers||[]).length;
  const sps=shares.sps1m||0;
  const spsHist=(Array.isArray(shares.spsHistory)?shares.spsHistory:[]).slice(-64);
  const spsMax=Math.max(...spsHist.map(p=>p.sps||0),1);
  const fp=areaPath(hr.history,'hr');
  const avgW=[['1M','hr1m'],['5M','hr5m'],['15M','hr15m'],['1H','hr1h'],['6H','hr6h'],['24H','hr1d'],['7D','hr7d']];
  const wmax=Math.max(cur,...Object.values(windows).filter(Number.isFinite),1);
  const acc=Number.isFinite(shares.acceptRate)?(shares.acceptRate*100).toFixed(2)+'%':'—';
  const zmqOk=zmq&&(zmq.connected||zmq.synced||zmq===true);

  // health flags
  const H=stratumHealth||{};
  const healthItems=[['API',true],['ckpool',H.ckpool!==false],['stunnel',H.tls!==false],['TLS :4333',H.tls!==false],['node RPC',poolState?.nodeLive!==false],['ZMQ',zmqOk]];

  return (
    <div className="ssdesk"
      onTouchStart={e=>{startX.current=e.touches[0].clientX;}}
      onTouchEnd={e=>{if(startX.current==null)return;const dx=e.changedTouches[0].clientX-startX.current;if(Math.abs(dx)>60)go(dx<0?page+1:page-1);startX.current=null;}}>

      <div className="ssd-head">
        <span className="ssd-pick">⛏</span><span className="ssd-wm">SoloStrike</span><span className="ssd-div"/>
        <span className="ssd-status">{page===1?'Pool Internals':page===2?'Luck & Analytics':status}</span>
        <span className="ssd-zmq">{page===1?'ckpool':page===2?'stats':`ZMQ ${zmqOk?'●':'○'}`}</span>
        <span className="ssd-pl">{page===0?<>STRIKES <b>{snap.totalStrikes??0}</b></>:<>PAGE <b>{page+1} / 3</b></>}</span>
        <div className="ssd-mq">{ticker}</div>
        <div className="ssd-right"><div className="ssd-clock"><span className="lv">LIVE</span><span className="tm">{now.toLocaleTimeString('en-US',{hour12:false})}</span></div><button className="ssd-gear" title="Settings" onClick={()=>onOpenSettings&&onOpenSettings()}>⚙</button></div>
      </div>

      <div className="ssd-stage">
        {/* ───── PAGE 1 — LIVE ───── */}
        {page===0 && (
          <div className="ssd-page" style={{gridTemplateRows:'minmax(0,1.1fr) minmax(0,1.5fr) minmax(0,0.95fr) minmax(0,0.7fr)'}}>
            {/* band1: firepower | strike velocity */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18,minHeight:0}}>
              <Z label="Firepower — Live">
                <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between'}}>
                  <span className="bignum goldnum">{fmtTH(cur)}<span className="unit" style={{fontSize:'.5em'}}> TH/s</span></span>
                  <span className="subtxt">PEAK {fmtTH(peak)} · LIVE {liveW}/{totW}</span>
                </div>
                <div className="fpchart"><svg viewBox="0 0 400 70" preserveAspectRatio="none">
                  {fp&&<><defs><linearGradient id="fpg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--amber)" stopOpacity=".28"/><stop offset="95%" stopColor="var(--amber)" stopOpacity=".02"/></linearGradient></defs>
                  <path d={fp.fill} fill="url(#fpg)"/><path d={fp.ln} fill="none" stroke="var(--amber)" strokeWidth="2" vectorEffect="non-scaling-stroke"/></>}
                </svg></div>
                <div className="avgs">{avgW.map(([lab,key])=>{const v=windows[key];return(
                  <div className={`avg${key==='hr1m'?' on':''}`} key={key}><div className="al">{lab}</div><div className="bar"><i style={{width:`${Math.min(100,((v||0)/wmax)*100)}%`}}/></div><div className="av">{Number.isFinite(v)?fmtTH(v):'—'}</div></div>
                );})}</div>
              </Z>
              <Z label="Strike Velocity">
                <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between'}}>
                  <span className="bignum" style={{color:'var(--text-1)'}}>{sps.toFixed(1)}<span className="unit" style={{fontSize:'.42em'}}> shares/s</span></span>
                  <div className="rng"><span className="on">1H</span><span>6H</span><span>24H</span></div>
                </div>
                <div className="svhist">{spsHist.length===0
                  ? <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-3)',fontFamily:'var(--fd)',fontSize:'.55rem',letterSpacing:'.1em'}}>{cur>0?'COLLECTING SAMPLES…':'NO MINERS'}</div>
                  : spsHist.map((p,i)=><i key={i} style={{height:`${Math.max(3,((p.sps||0)/spsMax)*100)}%`}}/>)}</div>
              </Z>
            </div>
            {/* band2: pulse (REAL globe) | hunt (REAL) | crew */}
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1.4fr',gap:18,minHeight:0}}>
              <div className="zone real"><div className="zlabel">Solostrike Pulse</div><div className="zbody">{cardComponents['pulse']||null}</div></div>
              <div className="zone real"><div className="zlabel">The Hunt</div><div className="zbody">{cardComponents['hunt']||null}</div></div>
              <Z label={`The Crew · live telemetry · ${liveW}/${totW}`}><Crew workers={workers} displayName={displayName} aliases={aliases}/></Z>
            </div>
            {/* band3: 8 data cols */}
            <div className="cols" style={{gridTemplateColumns:'repeat(8,1fr)'}}>
              <div className="col"><div className="ch">Bitcoin Network</div>{DL('Difficulty',net.difficulty?(net.difficulty/1e12).toFixed(1)+' T':'—')}{DL('Hashrate',hrShort(net.hashrate||0))}{DL('Mempool',net.mempoolTx?.toLocaleString?.()||'—')}{DL('Height',net.height?.toLocaleString?.()||'—')}</div>
              <div className="col"><div className="ch">Bitcoin Node</div>{DL('Status',poolState?.nodeLive?'LIVE':'—','green')}{DL('Peers',poolState?.node?.peers??'—')}{DL('Height',net.height?.toLocaleString?.()||'—')}{DL('ZMQ','● sync','green')}</div>
              <div className="col"><div className="ch">Stratum</div>{DL('TCP',':3333','cyan')}{DL('Alt',':3334')}{DL('TLS',':4333','cyan')}{DL('Accept',acc,'green')}</div>
              <div className="col"><div className="ch">Strikes</div>{DL('Closest',snap.closestCalls?.[0]?.pct?snap.closestCalls[0].pct.toFixed(4)+'%':'—','cyan')}{DL('Workers',`${liveW}/${totW}`)}{DL('Solo 30d',snap.soloBlocks30d??'—','amber')}{DL('Yours',snap.totalStrikes??0,'amber')}</div>
              <div className="col"><div className="ch">Near Strikes</div>{(snap.closestCalls||[]).slice(0,4).map((c,i)=>DL('#'+(i+1),c.pct?c.pct.toFixed(4)+'%':'—',i===0?'cyan':''))}{(!snap.closestCalls||!snap.closestCalls.length)&&DL('—','—')}</div>
              <div className="col"><div className="ch">Top Miners</div>{[...(workers||[])].sort((a,b)=>(b.hashrate||0)-(a.hashrate||0)).slice(0,4).map((w,i)=>DL((i+1)+'·'+((displayName?displayName(w.name,aliases):w.name)||'—').slice(0,6),hrShort(w.hashrate),i===0?'amber':'cyan'))}</div>
              <div className="col"><div className="ch">Claim Jumpers</div>{DL('Network solo',snap.soloBlocks30d??'—')}{DL('You',snap.totalStrikes??0,'amber')}{DL('Window','30d')}</div>
              <div className="col"><div className="ch">Share Stats</div>{DL('Total',shares.acceptedCount?(shares.acceptedCount/1e6).toFixed(1)+' M':'—')}{DL('Best',poolState?.bestshare?hrShort(poolState.bestshare):'—','amber')}{DL('Accept',acc,'green')}{DL('Reject',Number.isFinite(shares.rejectRate)?(shares.rejectRate*100).toFixed(2)+'%':'—')}</div>
            </div>
            {/* band4: ledger | health */}
            <div style={{display:'grid',gridTemplateColumns:'2.2fr 1.2fr',gap:18,minHeight:0,borderTop:'1px solid var(--hair)',paddingTop:6}}>
              <div className="col" style={{paddingLeft:0,borderLeft:0}}><div className="ch">The Ledger — Recent Blocks</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'0 12px'}}>
                  {blocks.slice(0,6).map((b,i)=><div className="dl" key={i} style={{border:0}}><span className="k">{b.height?.toLocaleString?.()||b.height||'—'}</span><span className="v">{b.miner||b.pool||'—'}</span></div>)}
                  {blocks.length===0&&<div className="dl" style={{border:0}}><span className="k">—</span><span className="v">waiting</span></div>}
                </div>
              </div>
              <div className="col"><div className="ch">System Health</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:'4px 14px'}}>{healthItems.map(([l,ok],i)=><div className="st" key={i}><span className="d" style={{background:ok?'var(--green)':'var(--red)',boxShadow:`0 0 5px ${ok?'var(--green)':'var(--red)'}`}}/>{l}</div>)}</div>
              </div>
            </div>
          </div>
        )}

        {/* ───── PAGE 2 — POOL INTERNALS ───── */}
        {page===1 && (
          <div className="ssd-page" style={{gridTemplateRows:'minmax(0,1fr) minmax(0,1.2fr) minmax(0,0.7fr)'}}>
            <div style={{display:'grid',gridTemplateColumns:'1.5fr 1fr 1fr',gap:18,minHeight:0}}>
              <Z label="Hashrate Windows — % of Pool Peak"><Gauges windows={windows} pct={pct}/></Z>
              <Z label="Shares / Second — Windows"><div className="spswins">{[['1M','sps1m'],['5M','sps5m'],['15M','sps15m'],['1H','sps1h']].map(([l,k])=>{const v=pool.spsWindows?.[k]||0;const mx=Math.max(...Object.values(pool.spsWindows||{}).filter(Number.isFinite),1);return(<div className="spsrow" key={k}><span className="sl">{l}</span><span className="sbar"><i style={{width:`${Math.min(100,(v/mx)*100)}%`}}/></span><span className="sv">{v>=1000?(v/1000).toFixed(2)+'k':v.toFixed(1)} sh/s</span></div>);})}</div></Z>
              <Z label="Connection States"><Donut pool={pool}/></Z>
            </div>
            <Z label="Fleet Comparison — All Rigs at a Glance">
              <div className="wscroll"><table className="wtable">
                <thead><tr><th>Worker</th><th>Hashrate</th><th>ASIC °C</th><th>Fan</th><th>Best Ever</th><th>Firmware</th><th>Uptime</th></tr></thead>
                <tbody>{[...(workers||[])].sort((a,b)=>(b.hashrate||0)-(a.hashrate||0)).map((w,i)=>{const tC=w.live&&Number.isFinite(w.live.tempC)?Math.round(w.live.tempC):null;return(
                  <tr key={w.name||i}><td className="nm">{(displayName?displayName(w.name,aliases):w.name)||'—'}</td><td className="hr">{(w.hashrate||0)>0?fmtTH(w.hashrate)+' T':'—'}</td><td className={tC>=70?'hot':tC>=60?'warm':''}>{tC!=null?tC+'°':'—'}</td><td>{w.live&&Number.isFinite(w.live.fanRpm)?w.live.fanRpm:(w.live&&Number.isFinite(w.live.fanPct)?w.live.fanPct+'%':'—')}</td><td className="hr" style={{color:'var(--cyan)'}}>{w.bestShare?hrShort(w.bestShare):'—'}</td><td>{w.minerType||'—'}</td><td>{w.uptime||'—'}</td></tr>
                );})}</tbody>
              </table></div>
            </Z>
            <div className="cols" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
              <div className="col"><div className="ch">General Info</div>{DL('Pool runtime',poolState?.uptimeSec?Math.floor(poolState.uptimeSec/86400)+'d '+Math.floor((poolState.uptimeSec%86400)/3600)+'h':'—')}{DL('Workers',`${liveW}/${totW}`)}{DL('ckpool','solo 2.x')}</div>
              <div className="col"><div className="ch">Shares Since Block</div>{DL('Accepted',shares.acceptedCount?(shares.acceptedCount/1e6).toFixed(1)+' M':'—','green')}{DL('Rejected',shares.rejectedCount?.toLocaleString?.()||'—')}{DL('Accept',acc,'cyan')}</div>
              <div className="col"><div className="ch">Best Share — Trend</div><Spark data={shares.bestHistory} field="best" color="var(--cyan)"/></div>
              <div className="col"><div className="ch">Reliability</div>{DL('Fleet uptime',totW?((liveW/totW)*100).toFixed(0)+'%':'—','green')}{DL('Online',`${liveW}/${totW}`)}</div>
            </div>
          </div>
        )}

        {/* ───── PAGE 3 — LUCK & ANALYTICS ───── */}
        {page===2 && (
          <div className="ssd-page" style={{gridTemplateRows:'minmax(0,1fr) minmax(0,1fr) minmax(0,0.7fr)'}}>
            <div style={{display:'grid',gridTemplateColumns:'1.7fr 1fr',gap:18,minHeight:0}}>
              <Z label="Block Effort / Luck — per strike">
                <div className="effortwrap">{(()=>{const rounds=Array.isArray(snap.blockEffort)?snap.blockEffort.slice(0,6):[]; const arr=[...Array(6)].map((_,i)=>rounds[i]??null); arr.push(snap.openEffortPct??null);
                  return arr.map((p,i)=>{const col=p==null?'var(--bg-raised)':p<100?'var(--green)':p<=200?'var(--amber)':'var(--red)';const h=p==null?14:Math.min(100,(p/250)*100);return(<div className="ebar" key={i}><div className="pct" style={{color:col}}>{p==null?'':Math.round(p)+'%'}</div><div className="col2" style={{height:`${h}%`,background:col}}/><div className="lab">{i===6?'NOW':'—'}</div></div>);});})()}</div>
              </Z>
              <Z label="Hashrate Stability">
                <div style={{display:'flex',alignItems:'baseline',gap:8}}><span className="bignum goldnum">{poolState?.hashrate?.stabilityPct?poolState.hashrate.stabilityPct.toFixed(1):'—'}<span className="unit" style={{fontSize:'.45em'}}> %</span></span><span style={{fontSize:'.58rem',color:'var(--text-2)'}}>consistency</span></div>
                <Spark data={hr.history} field="hr" color="var(--cyan)"/>
              </Z>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:18,minHeight:0}}>
              <Z label="Reject Reasons — Trend">
                {(()=>{const rr=shares.rejectReasons||{};const ent=Object.entries(rr).sort((a,b)=>b[1]-a[1]).slice(0,3);const tot=ent.reduce((s,[,n])=>s+n,0)||1;const cols=['var(--amber)','var(--cyan)','var(--text-2)'];
                  return ent.length?ent.map(([n,c],i)=>{const p=Math.round((c/tot)*100);return(<div className="rejrow" key={n}><span className="rl">{n}</span><span className="rbar"><i style={{width:p+'%',background:cols[i]}}/></span><span className="rv">{p}%</span></div>);}):<div style={{fontSize:'.55rem',color:'var(--text-3)'}}>No rejected shares recorded.</div>;})()}
              </Z>
              <Z label="Mempool Fee — Trend"><Spark data={(net.feeHistory||[]).map(v=>({hr:v}))} field="hr" color="var(--amber)"/></Z>
              <Z label="Difficulty Retarget">
                <div style={{textAlign:'center'}}><div style={{fontFamily:'var(--fd)',fontSize:'1.5rem',fontWeight:700,color:'var(--amber)'}}>{net.retargetPct!=null?(net.retargetPct>0?'+':'')+net.retargetPct.toFixed(2)+'%':'—'}</div><div style={{fontSize:'.5rem',letterSpacing:'.12em',textTransform:'uppercase',color:'var(--text-2)'}}>estimated change</div></div>
              </Z>
            </div>
            <div className="cols" style={{gridTemplateColumns:'repeat(4,1fr)'}}>
              <div className="col"><div className="ch">Lifetime Records</div>{DL('Best ever',poolState?.bestshare?hrShort(poolState.bestshare):'—','amber')}{DL('Peak HR',fmtTH(peak)+' T')}{DL('Closest',snap.closestCalls?.[0]?.pct?snap.closestCalls[0].pct.toFixed(4)+'%':'—','cyan')}</div>
              <div className="col"><div className="ch">Luck Summary</div>{DL('Blocks found',snap.blocksFound??0)}{DL('Shares round',shares.acceptedCount?(shares.acceptedCount/1e6).toFixed(1)+' M':'—')}</div>
              <div className="col"><div className="ch">Fleet Efficiency</div>{DL('Total power',poolState?.fleet?.totalW?poolState.fleet.totalW+' W':'—')}{DL('Avg J/TH',poolState?.fleet?.avgJTH?.toFixed?.(1)||'—','amber')}</div>
              <div className="col"><div className="ch">Reliability</div>{DL('Fleet uptime',totW?((liveW/totW)*100).toFixed(0)+'%':'—','green')}{DL('Online',`${liveW}/${totW}`)}</div>
            </div>
          </div>
        )}
      </div>

      <button className={`ssd-nav l${page===0?' hidden':''}`} onClick={()=>go(page-1)}>❮</button>
      <button className={`ssd-nav r${page===NP-1?' hidden':''}`} onClick={()=>go(page+1)}>❯</button>
      <div className="ssd-dots">{[0,1,2].map(i=><i key={i} className={i===page?'on':''} onClick={()=>go(i)}/>)}</div>
    </div>
  );
}
