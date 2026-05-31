// ============================================================================
// SoloStrike Desktop — 3-page dashboard (v1.12.x) — TEMPLATE-FAITHFUL BUILD
// ----------------------------------------------------------------------------
// This is a 1:1 port of solostrike-desktop-preview.html: the SAME bands, grid
// proportions (b-charts 1fr/1fr, b-feat 218px/320px/1fr, b-data 8col, etc.),
// the SAME compact widgets (firepower area chart + 7 avg bars + LAVA dist,
// strike-velocity histogram, gauges, sps bars, donut, fleet wtable, effort
// bars, reject bars, tsLine charts), at the SAME sizes — but fed by the REAL
// poolState instead of mock data.
//
// The two slots that are genuinely WebGL (Pulse globe + Hunt) mount the REAL
// production components passed in via cardComponents (mountPulse / mountHunt),
// sized into the template's canvas footprints. Clicks open the REAL modals via
// the openModal(name) callback the app provides.
//
// Fixed 1280×860 viewport, scaled-to-fit (transform:scale) exactly like the
// template's fit(). Single track translateX between pages. Desktop only (≥600).
// ============================================================================

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

/* ---------- formatters ---------- */
const TH = h => (h ? h / 1e12 : 0);
function hrShort(h){ if(h==null||h<=0)return '—'; const u=['H','K','M','G','T','P','E']; let i=0,v=h; while(v>=1000&&i<u.length-1){v/=1000;i++;} return `${v.toFixed(v<10?2:0)} ${u[i]}`; }
function fmtTH(h){ return TH(h).toFixed(1); }
function fmtUptime(s){ if(s==null)return '—'; if(s<60)return Math.floor(s)+'s'; if(s<3600)return Math.floor(s/60)+'m'; if(s<86400)return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'; return Math.floor(s/86400)+'d '+Math.floor((s%86400)/3600)+'h'; }
function fmtNum(n){ return n==null?'—':Number(n).toLocaleString(); }
const avgKeyFor = lab => ({'1M':'hr1m','5M':'hr5m','15M':'hr15m','1H':'hr1h','6H':'hr6h','24H':'hr1d','7D':'hr7d'}[lab]||'hr1h');

/* ---------- area-chart path (firepower / tsLine style) ---------- */
function linePath(vals, W=400, H=70, pad=0){
  const pts=(vals||[]).filter(Number.isFinite);
  if(pts.length<2) return null;
  const lo=Math.min(...pts), hi=Math.max(...pts), rng=(hi-lo)||1;
  const xy=pts.map((v,i)=>[+(i*(W/(pts.length-1))).toFixed(1), +(H-pad-((v-lo)/rng)*(H-pad*2)).toFixed(1)]);
  const ln='M'+xy.map(p=>p.join(' ')).join(' L');
  return { ln, fill:`${ln} L${W} ${H} L0 ${H} Z`, lo, hi, now:pts[pts.length-1] };
}

/* ---------- tsLine SVG (with lo/now/hi caption) ---------- */
function TsLine({ data, color='var(--chart1)', H=80, fmt, unit, fill=true }){
  const p=linePath(data, 400, H, 8);
  const gid='g'+color.replace(/\W/g,'')+H;
  return (
    <>
      <div className="tschart" style={{height:H<70?54:62}}>
        <svg viewBox={`0 0 400 ${H}`} preserveAspectRatio="none">
          {p && <>
            <defs><linearGradient id={gid} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".35"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
            {fill && <path d={p.fill} fill={`url(#${gid})`}/>}
            <path d={p.ln} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
          </>}
        </svg>
      </div>
      {p && fmt && <div className="tsc-cap"><span className="lo">lo {fmt(p.lo)}</span><span className="now" style={{color}}>now {fmt(p.now)}{unit?' '+unit:''}</span><span className="hi">hi {fmt(p.hi)}</span></div>}
    </>
  );
}

/* ---------- hooks ---------- */
function useNow(){ const [t,setT]=useState(()=>new Date()); useEffect(()=>{const id=setInterval(()=>setT(new Date()),1000);return()=>clearInterval(id);},[]); return t; }
function useIsNarrow(){ const [n,setN]=useState(()=>typeof window!=='undefined'&&window.matchMedia('(max-width: 599px)').matches);
  useEffect(()=>{ if(typeof window==='undefined')return; const mq=window.matchMedia('(max-width: 599px)'); const on=e=>setN(e.matches);
    mq.addEventListener?mq.addEventListener('change',on):mq.addListener(on); return()=>{mq.removeEventListener?mq.removeEventListener('change',on):mq.removeListener(on);}; },[]); return n; }

/* ============================ CSS (ported 1:1) ============================ */
const CSS = `
.ssdesk{--hair:rgba(var(--amber-rgb),0.14);position:fixed;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;overflow:hidden;background:#000}
.ssdesk .scaler{width:1280px;height:860px;transform-origin:center center;flex:none;overflow:hidden;border-radius:14px}
.ssdesk .pages{display:flex;width:3840px;height:860px;transition:transform .42s cubic-bezier(.6,.02,.2,1)}
.ssdesk .pages.p2{transform:translateX(-1280px)}.ssdesk .pages.p3{transform:translateX(-2560px)}
.ssdesk .viewport{width:1280px;flex:0 0 1280px;height:860px;background:radial-gradient(1100px 600px at 72% -12%,rgba(var(--amber-rgb),0.10),transparent 60%),radial-gradient(800px 520px at -10% 112%,rgba(0,255,209,0.05),transparent 55%),var(--bg-void);border:1px solid var(--border-hot);border-radius:14px;overflow:hidden;position:relative;display:grid;grid-template-rows:auto 168px minmax(0,1fr) auto auto;padding:14px 20px;row-gap:8px}
.ssdesk .viewport.p2,.ssdesk .viewport.p3{grid-template-rows:auto 1fr 1fr auto}
.ssdesk .viewport::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.24;background-image:linear-gradient(rgba(var(--amber-rgb),0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--amber-rgb),0.05) 1px,transparent 1px);background-size:44px 44px}
.ssdesk .viewport>*{position:relative;z-index:1}

.ssdesk .apphead{display:flex;align-items:center;gap:.4rem;min-height:42px;border-bottom:1px solid var(--hair);padding-bottom:6px}
.ssdesk .ah-left{display:flex;align-items:center;gap:.5rem;flex:0 0 auto}
.ssdesk .ah-pick{width:16px;height:16px;object-fit:contain;display:block;filter:drop-shadow(0 0 8px rgba(var(--amber-rgb),0.7));animation:ss-pulse 3s ease-in-out infinite}
.ssdesk .ah-wordmark{font-family:var(--fd);font-size:.92rem;font-weight:700;letter-spacing:.06em;color:var(--amber);text-transform:uppercase}
.ssdesk .ah-div{width:1px;height:16px;background:rgba(var(--amber-rgb),0.2)}
.ssdesk .ah-status{font-family:var(--fd);font-size:.56rem;letter-spacing:.12em;text-transform:uppercase;color:var(--green);text-shadow:0 0 6px var(--green);animation:ss-pulse 2s ease-in-out infinite;white-space:nowrap}
.ssdesk .ah-zmq{font-family:var(--fd);font-size:.48rem;letter-spacing:.1em;text-transform:uppercase;color:var(--cyan);border:1px solid rgba(0,255,209,.3);border-radius:4px;padding:1px 5px;white-space:nowrap}
.ssdesk .ah-strikes{font-family:var(--fd);font-size:.58rem;letter-spacing:.1em;color:var(--text-2);white-space:nowrap}.ssdesk .ah-strikes b{color:var(--text-1)}
.ssdesk .ah-mq{position:relative;flex:1;min-width:0;max-width:720px;margin:0 auto;height:30px;display:flex;align-items:center}
.ssdesk .ah-mq>.ss-marquee{flex:1;min-width:0}
.ssdesk .ah-right{display:flex;align-items:center;gap:.5rem;flex:0 0 auto}
.ssdesk .ah-clock{display:flex;flex-direction:column;align-items:flex-end;font-family:var(--fd)}
.ssdesk .ah-clock .lv{font-size:.56rem;letter-spacing:.12em;color:var(--cyan);text-shadow:0 0 6px var(--cyan)}
.ssdesk .ah-clock .tm{font-size:.5rem;color:var(--amber);font-family:var(--fm)}
.ssdesk .ah-gear{background:none;border:none;color:var(--text-2);cursor:pointer;font-size:17px}
@keyframes ss-pulse{0%,100%{opacity:1}50%{opacity:.55}}

.ssdesk .band{display:grid;gap:16px;min-height:0}
.ssdesk .b-charts{grid-template-columns:1fr 1fr;min-height:0;overflow:hidden}
.ssdesk .b-feat{grid-template-columns:218px 320px 1fr;min-height:0;overflow:hidden}
.ssdesk .b-data{grid-template-columns:repeat(8,1fr);min-height:0;align-self:end}
.ssdesk .panel{min-height:0;display:flex;flex-direction:column;overflow:hidden}
.ssdesk .zlabel{font-family:var(--fd);font-size:.62rem;font-weight:400;letter-spacing:.2em;text-transform:uppercase;color:var(--text-2);margin:0 0 7px;padding-bottom:.35rem;background-image:linear-gradient(90deg,rgba(var(--amber-rgb),0.55),rgba(var(--amber-rgb),0.45) 30%,rgba(var(--amber-rgb),0.12) 70%,rgba(var(--amber-rgb),0) 100%);background-repeat:no-repeat;background-size:100% 1px;background-position:bottom left;flex:0 0 auto}
.ssdesk .clk{cursor:pointer;border-radius:9px;transition:background .15s,box-shadow .15s;position:relative}
.ssdesk .clk:hover{background:rgba(var(--amber-rgb),0.06);box-shadow:inset 0 0 0 1px rgba(var(--amber-rgb),0.2)}
.ssdesk .clk::after{content:"⤢";position:absolute;top:4px;right:6px;font-size:.56rem;color:var(--amber);opacity:.35}.ssdesk .clk:hover::after{opacity:1}
.ssdesk .goldnum{background:linear-gradient(180deg,var(--amber-hot),var(--amber) 50%,var(--amber-dim));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 14px rgba(var(--amber-rgb),0.35))}
.ssdesk .unit{color:var(--text-3);font-weight:400}.ssdesk .amber{color:var(--amber)}.ssdesk .cyan{color:var(--cyan)}.ssdesk .green{color:var(--green)}.ssdesk .red{color:var(--red)}

.ssdesk .fp,.ssdesk .sv{display:flex;flex-direction:column;gap:6px;height:100%}
.ssdesk .fp-top,.ssdesk .sv-top{display:flex;align-items:baseline;justify-content:space-between}
.ssdesk .fp-num,.ssdesk .sv-num{font-family:var(--fd);font-weight:700;font-size:1.5rem;line-height:.95}.ssdesk .sv-num{color:var(--text-1)}
.ssdesk .fp-peak{font-family:var(--fm);font-size:.52rem;color:var(--amber-dim)}
.ssdesk .fp-chart{position:relative;flex:1;min-height:40px}.ssdesk .fp-chart svg{position:absolute;inset:0;width:100%;height:100%}
.ssdesk .avgs{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.ssdesk .avg .al{font-family:var(--fd);font-size:.48rem;font-weight:700;color:var(--text-2);text-align:center;margin-bottom:2px}.ssdesk .avg.on .al{color:var(--amber)}
.ssdesk .avg .bar{height:5px;border-radius:3px;background:var(--bg-deep);overflow:hidden}.ssdesk .avg .bar i{display:block;height:100%;background:linear-gradient(90deg,rgba(var(--amber-rgb),0.35),var(--amber))}
.ssdesk .avg .av{font-family:var(--fd);font-size:.56rem;font-weight:700;color:var(--amber);text-align:center;margin-top:2px}
.ssdesk .dist{display:flex;height:8px;border-radius:3px;overflow:hidden;margin-top:2px;gap:1px}.ssdesk .dist i{display:block;height:100%}
.ssdesk .dist-lbl{font-family:var(--fd);font-size:.46rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-3);margin-top:3px}
.ssdesk .sv-rng{display:flex;gap:4px}.ssdesk .sv-rng span{font-family:var(--fd);font-size:.48rem;font-weight:700;padding:2px 6px;border-radius:5px;border:1px solid var(--border-hot);color:var(--text-2)}.ssdesk .sv-rng span.on{color:var(--amber);background:rgba(var(--amber-rgb),.08)}
.ssdesk .sv-hist{flex:1;min-height:40px;display:flex;align-items:flex-end;gap:2px}.ssdesk .sv-hist i{flex:1;border-radius:1px 1px 0 0;background:var(--green)}.ssdesk .sv-hist i.out{background:var(--amber)}.ssdesk .sv-hist i.down{background:var(--red)}
.ssdesk .sv-empty{flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-3);font-family:var(--fd);font-size:.6rem;letter-spacing:.1em}
.ssdesk .sv-leg{display:flex;gap:10px;font-family:var(--fd);font-size:.46rem;color:var(--text-2)}.ssdesk .sv-leg b{display:inline-block;width:6px;height:6px;border-radius:2px;margin-right:3px}

.ssdesk .body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:0;border-radius:11px}
.ssdesk .slot-globe{width:100%;flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center}
.ssdesk .slot-hunt{width:100%;flex:1;min-height:0;position:relative;overflow:hidden}
.ssdesk .slot-globe>*,.ssdesk .slot-hunt>*{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;background:transparent!important;border:none!important;box-shadow:none!important;border-radius:0!important;padding:0!important;margin:0!important}
.ssdesk .pulse-read{display:flex;width:100%}.ssdesk .pulse-read .pr{flex:1;text-align:center;padding:0 5px;border-left:1px solid var(--hair)}.ssdesk .pulse-read .pr:first-child{border-left:0}
.ssdesk .pulse-read .prl{font-family:var(--fd);font-size:.44rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2)}
.ssdesk .pulse-read .prv{font-family:var(--fd);font-size:.78rem;font-weight:700;color:var(--amber)}
.ssdesk .hunt-face{width:100%;display:flex;flex-direction:column;gap:5px}
.ssdesk .hf-reward{display:flex;align-items:baseline;justify-content:space-between}.ssdesk .hf-reward .lbl{font-family:var(--fd);font-size:.48rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-2)}
.ssdesk .hf-sub{font-family:var(--fm);font-size:.54rem;color:var(--text-2)}.ssdesk .hf-sub b{color:var(--text-1)}.ssdesk .hf-sub .fee{color:var(--cyan)}
.ssdesk .hf-fees{display:flex}.ssdesk .hf-fees .ft{flex:1;text-align:center;border-left:1px solid var(--hair);padding:1px 0}.ssdesk .hf-fees .ft:first-child{border-left:0}
.ssdesk .hf-fees .ftl{font-family:var(--fd);font-size:.44rem;text-transform:uppercase}.ssdesk .hf-fees .ftl.fast{color:var(--green)}.ssdesk .hf-fees .ftl.mid{color:var(--amber)}.ssdesk .hf-fees .ftl.low{color:var(--text-2)}
.ssdesk .hf-fees .ftv{font-family:var(--fd);font-size:.72rem;font-weight:700;color:var(--text-1)}.ssdesk .hf-fees .ftu{font-family:var(--fm);font-size:.44rem;color:var(--text-2)}
.ssdesk .hf-odds{display:flex;border-top:1px solid var(--hair);padding-top:3px}.ssdesk .hf-odds .o{flex:1;text-align:center;border-left:1px solid var(--hair)}.ssdesk .hf-odds .o:first-child{border-left:0}
.ssdesk .hf-odds .ol{font-family:var(--fd);font-size:.44rem;text-transform:uppercase;color:var(--text-2)}.ssdesk .hf-odds .ov{font-family:var(--fd);font-size:.68rem;font-weight:700;color:var(--cyan)}

.ssdesk .crew{display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:minmax(0,1fr);gap:5px 12px;min-height:0;overflow:hidden;flex:1}
.ssdesk .miner{cursor:pointer;border-radius:7px;padding:5px 7px;transition:background .15s,box-shadow .15s;display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:0}
.ssdesk .miner:hover{background:rgba(var(--amber-rgb),0.06);box-shadow:inset 0 0 0 1px rgba(var(--amber-rgb),0.18)}
.ssdesk .miner .top{display:flex;align-items:center;gap:6px}
.ssdesk .miner .dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);flex:none}.ssdesk .miner.off .dot{background:var(--red);box-shadow:0 0 6px var(--red)}
.ssdesk .miner .nm{font-family:var(--fd);font-size:.58rem;font-weight:700;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.ssdesk .miner .hash{margin-left:auto;font-family:var(--fd);font-size:.62rem;color:var(--amber);flex-shrink:0}
.ssdesk .tele{display:grid;grid-template-columns:repeat(4,1fr);gap:2px;border-top:1px solid rgba(var(--amber-rgb),0.06);padding-top:3px}
.ssdesk .tele div{font-size:.42rem;color:var(--text-2);text-align:center;line-height:1.2;overflow:hidden}.ssdesk .tele b{display:block;font-family:var(--fd);font-size:.54rem;color:var(--text-1);white-space:nowrap}.ssdesk .tele .warm b{color:var(--amber)}.ssdesk .tele .hot b{color:var(--red)}
.ssdesk .uptime{display:flex;height:5px;gap:1px;margin-top:4px;width:100%;min-width:0}.ssdesk .uptime i{flex:1 1 0;min-width:0;border-radius:.5px;background:var(--bg-deep)}.ssdesk .uptime i.on{background:rgba(57,255,106,0.65)}.ssdesk .uptime i.dn{background:rgba(232,67,67,0.7)}

.ssdesk .col{padding:0 12px;border-left:1px solid var(--hair);min-width:0}.ssdesk .col:first-child{padding-left:0;border-left:0}
.ssdesk .col .ch{font-family:var(--fd);font-size:.5rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin-bottom:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssdesk .dl{display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;font-size:.62rem;gap:4px}.ssdesk .dl+.dl{border-top:1px solid rgba(var(--amber-rgb),0.06)}
.ssdesk .dl .k{color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ssdesk .dl .v{color:var(--text-1);font-weight:500;font-family:var(--fd);white-space:nowrap;flex-shrink:0}
.ssdesk .status{display:flex;flex-direction:row;flex-wrap:wrap;gap:6px 16px}.ssdesk .st{display:flex;align-items:center;gap:6px;font-size:.56rem;color:var(--text-2)}
.ssdesk .st .dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);flex:none}.ssdesk .st.warn .dot{background:var(--amber);box-shadow:0 0 6px var(--amber)}.ssdesk .st.bad .dot{background:var(--red);box-shadow:0 0 6px var(--red)}
.ssdesk .barrow{display:flex;align-items:center;gap:5px;padding:2px 0;font-size:.56rem}.ssdesk .barrow .nm{color:var(--text-1);font-family:var(--fd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}.ssdesk .barrow .ct{color:var(--amber);font-family:var(--fd);font-weight:700;flex-shrink:0}
.ssdesk .solo{font-size:.42rem;color:var(--amber);border:1px solid var(--amber);padding:0 3px;margin-left:4px}

.ssdesk .gauges{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;flex:1;align-content:center}
.ssdesk .gauge{display:flex;flex-direction:column;align-items:center;gap:3px}.ssdesk .gauge svg{width:100%;max-width:84px}
.ssdesk .gauge .gw{font-family:var(--fd);font-size:.5rem;letter-spacing:.08em;color:var(--text-2);text-transform:uppercase}
.ssdesk .gauge .gv{font-family:var(--fd);font-size:.74rem;font-weight:700;color:var(--text-1)}.ssdesk .gauge .gp{font-family:var(--fd);font-size:.62rem;font-weight:700;color:var(--amber)}
.ssdesk .spswins{display:flex;flex-direction:column;justify-content:center;gap:10px;flex:1}
.ssdesk .spsrow{display:flex;align-items:center;gap:10px}.ssdesk .spsrow .sl{font-family:var(--fd);font-size:.6rem;font-weight:700;color:var(--text-2);width:34px}
.ssdesk .spsrow .sbar{flex:1;height:8px;background:var(--bg-deep);border-radius:4px;overflow:hidden}.ssdesk .spsrow .sbar i{display:block;height:100%;background:linear-gradient(90deg,rgba(0,255,209,.4),var(--cyan))}
.ssdesk .spsrow .sv{font-family:var(--fd);font-size:.72rem;font-weight:700;color:var(--cyan);width:64px;text-align:right}
.ssdesk .tschart{width:100%;display:block}.ssdesk .tschart svg{display:block;width:100%;height:100%}
.ssdesk .tsc-cap{display:flex;justify-content:space-between;align-items:baseline;font-family:var(--fd);font-size:9px;letter-spacing:.04em;padding:3px 2px 0;margin-top:2px}.ssdesk .tsc-cap .lo,.ssdesk .tsc-cap .hi{color:var(--text-3);opacity:.8}.ssdesk .tsc-cap .now{font-weight:700;font-size:11px}
.ssdesk .donutwrap{display:flex;align-items:center;gap:14px;flex:1;justify-content:center}
.ssdesk .donut-cg{position:relative;width:104px;height:104px;flex:none}
.ssdesk .donut-ring{width:100%;height:100%;border-radius:50%}
.ssdesk .donut-hole{position:absolute;inset:22%;border-radius:50%;background:var(--bg-void);display:flex;flex-direction:column;align-items:center;justify-content:center}
.ssdesk .donut-hole .dn-tot{font-family:var(--fd);font-size:1.3rem;font-weight:700;color:var(--text-1);line-height:1}
.ssdesk .donut-hole .dn-lbl{font-family:var(--fd);font-size:.45rem;letter-spacing:.1em;color:var(--text-3);text-transform:uppercase}
.ssdesk .donutlegend{display:flex;flex-direction:column;gap:7px}.ssdesk .dlg{display:flex;align-items:center;gap:7px;font-size:.64rem;color:var(--text-2)}.ssdesk .dlg .sw{width:9px;height:9px;border-radius:2px}.ssdesk .dlg b{color:var(--text-1);font-family:var(--fd);margin-left:3px}

.ssdesk .wtable{width:100%;border-collapse:collapse;font-size:.62rem}
.ssdesk .wtable th{font-family:var(--fd);font-size:.5rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2);text-align:left;padding:5px 8px;border-bottom:1px solid var(--border-hot);position:sticky;top:0;background:var(--bg-surface);cursor:pointer;user-select:none;white-space:nowrap}
.ssdesk .wtable th:hover{color:var(--amber)}.ssdesk .wtable th .sortcaret{opacity:.6;font-size:.8em;margin-left:3px;color:var(--amber)}
.ssdesk .wtable td{padding:5px 8px;border-bottom:1px solid rgba(var(--amber-rgb),.07);font-family:var(--fm);color:var(--text-1);white-space:nowrap}
.ssdesk .wtable td.nm{font-family:var(--fd);font-weight:700}.ssdesk .wtable td.hr{color:var(--amber);font-family:var(--fd);font-weight:700}
.ssdesk .wtable tr.off td{opacity:.45}.ssdesk .wtable tbody tr{cursor:pointer}.ssdesk .wtable tbody tr:hover td{background:rgba(var(--amber-rgb),.05)}
.ssdesk .wtable .cell-hot{color:var(--red)!important;font-weight:700}.ssdesk .wtable .cell-warm{color:var(--amber)!important}
.ssdesk .wtable tfoot td{border-top:1px solid var(--border-hot);border-bottom:0;font-family:var(--fd);color:var(--text-2);font-size:.58rem;letter-spacing:.06em;padding-top:6px;background:var(--bg-surface)}.ssdesk .wtable tfoot td b{color:var(--amber)}

.ssdesk .effortwrap{flex:1;display:flex;align-items:flex-end;gap:5px;min-height:0;padding-top:8px}
.ssdesk .ebar{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end;height:100%}
.ssdesk .ebar .col2{width:100%;border-radius:2px 2px 0 0;min-height:3px}.ssdesk .ebar .pct{font-family:var(--fd);font-size:.52rem;font-weight:700}.ssdesk .ebar .lab{font-family:var(--fd);font-size:.46rem;color:var(--text-3)}
.ssdesk .effort-note{font-size:.55rem;color:var(--text-3);line-height:1.5;margin-top:6px}
.ssdesk .rejtrend{flex:1;display:flex;flex-direction:column;justify-content:center;gap:9px}
.ssdesk .rejrow{display:flex;align-items:center;gap:8px;font-size:.6rem}.ssdesk .rejrow .rl{font-family:var(--fd);width:62px;color:var(--text-2);text-transform:uppercase;letter-spacing:.06em;font-size:.52rem}
.ssdesk .rejrow .rbar{flex:1;height:7px;background:var(--bg-deep);border-radius:4px;overflow:hidden}.ssdesk .rejrow .rbar i{display:block;height:100%;border-radius:4px}
.ssdesk .rejrow .rv{font-family:var(--fd);width:36px;text-align:right;color:var(--text-1);font-weight:700}

.ssdesk .nav{position:absolute;top:50%;transform:translateY(-50%);z-index:55;width:30px;height:64px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:none;border:none;color:var(--amber);font-size:30px;line-height:1;opacity:.35;transition:opacity .18s;user-select:none;text-shadow:0 0 12px rgba(var(--amber-rgb),.55)}
.ssdesk .nav:hover{opacity:.95}.ssdesk .nav.l{left:10px}.ssdesk .nav.r{right:10px}.ssdesk .nav.hidden{opacity:0;pointer-events:none}
.ssdesk .pagedots{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:55;display:flex;gap:8px;padding:6px 10px;border-radius:12px;background:rgba(11,13,15,.55);backdrop-filter:blur(4px);opacity:1;transition:opacity .6s ease}
.ssdesk .pagedots.hide{opacity:0;pointer-events:none}
.ssdesk .pagedots i{width:8px;height:8px;border-radius:50%;background:rgba(var(--amber-rgb),.3);cursor:pointer}.ssdesk .pagedots i.on{width:20px;border-radius:4px;background:var(--amber);box-shadow:0 0 8px var(--amber)}

/* clickable trend avg cells */
.ssdesk .avg.clk-avg{cursor:pointer;border-radius:5px;padding:1px;transition:background .12s}
.ssdesk .avg.clk-avg:hover{background:rgba(var(--amber-rgb),.08)}
.ssdesk .avg.clk-avg.on{background:rgba(var(--amber-rgb),.12);box-shadow:inset 0 0 0 1px rgba(var(--amber-rgb),.3)}
.ssdesk .sv-rng span{cursor:pointer}

/* expand button on pulse/hunt labels */
.ssdesk .zlabel-row{display:flex;align-items:center;justify-content:space-between}
.ssdesk .expand-btn{background:rgba(var(--amber-rgb),.08);border:1px solid var(--border-hot);color:var(--amber);cursor:pointer;font-size:.7rem;line-height:1;border-radius:5px;padding:2px 7px;flex:none;transition:background .12s}
.ssdesk .expand-btn:hover{background:rgba(var(--amber-rgb),.2)}

/* fullscreen overlay for globe / hunt */
.ssdesk .fs-overlay{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.82);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:3vh 3vw}
.ssdesk .fs-inner{width:min(1100px,94vw);height:min(86vh,820px);background:linear-gradient(180deg,var(--bg-raised),var(--bg-surface));border:1px solid var(--border-hot);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.7);display:flex;flex-direction:column;overflow:hidden}
.ssdesk .fs-head{display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-bottom:1px solid var(--hair);font-family:var(--fd);font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;color:var(--amber);flex:none}
.ssdesk .fs-close{background:none;border:none;color:var(--text-2);cursor:pointer;font-size:1.3rem;line-height:1}
.ssdesk .fs-stage{flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;padding:14px}
.ssdesk .fs-stage>*{position:absolute!important;inset:14px!important;width:auto!important;height:auto!important;background:transparent!important;border:none!important;box-shadow:none!important}
`;

/* ---------- AppHead (real ticker in marquee slot) ---------- */
function AppHead({ page, status, zmqOk, strikes, ticker, now, onOpenSettings }){
  const statusTxt = page===1?'Pool Internals':page===2?'Luck & Analytics':status;
  const zmqTxt = page===1?'ckpool':page===2?'stats':`ZMQ ${zmqOk?'●':'○'}`;
  return (
    <div className="apphead">
      <div className="ah-left">
        <img className="ah-pick" src="/pickaxe-icon.png" alt="⛏" draggable={false}/>
        <span className="ah-wordmark">SoloStrike</span><span className="ah-div"/>
        <span className="ah-status">{statusTxt}</span>
        <span className="ah-zmq">{zmqTxt}</span>
        <span className="ah-strikes">{page===0?<>STRIKES <b>{strikes}</b></>:<>PAGE <b>{page+1} / 3</b></>}</span>
      </div>
      <div className="ah-mq">{ticker}</div>
      <div className="ah-right">
        <div className="ah-clock"><span className="lv">LIVE</span><span className="tm">{now.toLocaleTimeString('en-US',{hour12:false})}</span></div>
        <button className="ah-gear" title="Settings" onClick={onOpenSettings}>⚙</button>
      </div>
    </div>
  );
}

/* ---------- Crew tile grid (real workers) ---------- */
function Crew({ workers, aliases, displayName, onWorkerClick }){
  const list=(workers||[]).slice(0,12);
  return (
    <div className="crew">
      {list.map((w,i)=>{
        const live=w.live||{}; const on=(w.hashrate||0)>0 && w.status!=='offline';
        const tC=Number.isFinite(live.tempC)?Math.round(live.tempC):null;
        const tcls=tC>=70?'hot':tC>=60?'warm':'';
        const fan=Number.isFinite(live.fanPct)?live.fanPct+'%':(Number.isFinite(live.fanRpm)?fmtNum(live.fanRpm):'—');
        const fw=(live.firmwareVersion||w.minerVendor||'—').toString().split(' ')[0];
        const acc=Number.isFinite(w.acceptRate)?(w.acceptRate*100).toFixed(1)+'%':'—';
        const SLOTS=96; const samples=(Array.isArray(w.statusHistory)?w.statusHistory:[]).slice(-SLOTS); const ph=SLOTS-samples.length;
        const name=(displayName?displayName(w.name,aliases):w.name)||'—';
        return (
          <div key={w.name||i} className={`miner${on?'':' off'}`} onClick={()=>onWorkerClick&&onWorkerClick(w)} title={w.minerType||''}>
            <div className="top"><span className="dot"/><span className="nm">{name}</span><span className="hash">{on?hrShort(w.hashrate):'off'}</span></div>
            <div className="tele"><div className={tcls}><b>{tC!=null?tC+'°':'—'}</b>temp</div><div><b>{fan}</b>fan</div><div><b>{fw}</b>fw</div><div><b>{acc}</b>acc</div></div>
            <div className="uptime" title={`Uptime over last 24h · ${samples.length}/${SLOTS} samples`}>{Array.from({length:SLOTS}).map((_,j)=>{const isPh=j<ph;const s=isPh?null:samples[j-ph];const cls=isPh?'':(s&&s.status==='online'?'on':'dn');return <i key={j} className={cls}/>;})}</div>
          </div>
        );
      })}
      {list.length===0 && <div style={{gridColumn:'1/-1',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-3)',fontFamily:'var(--fd)',fontSize:'.6rem'}}>No miners connected yet.</div>}
    </div>
  );
}

/* ---------- Fleet comparison table (real workers) ---------- */
function FleetTable({ workers, aliases, displayName, onWorkerClick }){
  const [sortKey,setSortKey]=useState('hashrate');
  const [sortDir,setSortDir]=useState(-1);
  const rows=useMemo(()=>(Array.isArray(workers)?workers:[]).map(w=>{
    const live=w.live||{};
    return {
      w, name:(displayName?displayName(w.name,aliases):w.name)||'—', type:w.minerType||'',
      hashrate:w.hashrate||0, asic:Number.isFinite(live.tempC)?Math.round(live.tempC):null,
      vr:Number.isFinite(live.vrTempC)?Math.round(live.vrTempC):null,
      fan:Number.isFinite(live.fanRpm)?live.fanRpm:null,
      boards:Array.isArray(live.tempDetails)&&live.tempDetails.length?live.tempDetails.map(td=>Math.round(td.tempC)).join('·'):'—',
      best:w.bestshare||0, diff:w.diff||0, fw:live.firmwareVersion||'—', up:live.uptimeSec,
      online:(w.hashrate||0)>0 && w.status!=='offline',
    };
  }),[workers,aliases,displayName]);
  const sorted=useMemo(()=>[...rows].sort((a,b)=>{ let av=a[sortKey],bv=b[sortKey]; if(av==null)return 1; if(bv==null)return -1; if(typeof av==='string')return sortDir*String(av).localeCompare(String(bv)); return sortDir*((av||0)-(bv||0)); }),[rows,sortKey,sortDir]);
  const live=rows.filter(r=>r.online); const totHr=live.reduce((s,r)=>s+r.hashrate,0);
  const temps=live.map(r=>r.asic).filter(n=>n!=null); const avgT=temps.length?Math.round(temps.reduce((s,t)=>s+t,0)/temps.length):null; const maxT=temps.length?Math.max(...temps):null;
  const tcls=t=>t==null?'':t>=70?'cell-hot':t>=60?'cell-warm':'';
  const COLS=[['name','Worker'],['hashrate','Hashrate'],['asic','ASIC °C'],['vr','VR °C'],['fan','Fan RPM'],['boards','Boards (°C)'],['best','Best Ever'],['diff','Last Diff'],['fw','Firmware'],['up','Uptime']];
  const sort=k=>{ if(k===sortKey)setSortDir(d=>-d); else {setSortKey(k);setSortDir(k==='name'?1:-1);} };
  return (
    <div style={{overflow:'auto',minHeight:0,flex:1}}>
      <table className="wtable">
        <thead><tr>{COLS.map(([k,l])=><th key={k} onClick={()=>sort(k)}>{l}{k===sortKey?<span className="sortcaret">{sortDir<0?'▼':'▲'}</span>:null}</th>)}</tr></thead>
        <tbody>
          {sorted.map((r,i)=>(
            <tr key={r.w.name||i} className={r.online?'':'off'} onClick={()=>onWorkerClick&&onWorkerClick(r.w)}>
              <td className="nm">{r.name}{r.type?<span style={{color:'var(--text-3)',fontSize:'.85em',marginLeft:4}}>{r.type}</span>:null}</td>
              <td className="hr">{r.hashrate>0?fmtTH(r.hashrate)+' T':'—'}</td>
              <td className={tcls(r.asic)}>{r.asic!=null?r.asic+'°':'—'}</td>
              <td className={tcls(r.vr)}>{r.vr!=null?r.vr+'°':'—'}</td>
              <td>{r.fan!=null?fmtNum(r.fan):'—'}</td>
              <td>{r.boards}</td>
              <td className="hr" style={{color:'var(--cyan)'}}>{r.best>0?hrShort(r.best):'—'}</td>
              <td>{r.diff>0?hrShort(r.diff):'—'}</td>
              <td>{r.fw}</td>
              <td>{fmtUptime(r.up)}</td>
            </tr>
          ))}
          {sorted.length===0 && <tr><td colSpan={10} style={{textAlign:'center',color:'var(--text-3)',padding:18}}>No miners connected yet.</td></tr>}
        </tbody>
        {sorted.length>0 && <tfoot><tr>
          <td><b>FLEET</b></td><td><b>{fmtTH(totHr)} T</b></td>
          <td colSpan={2}>{avgT!=null?<>avg <b>{avgT}°</b> · max <b className={maxT>=70?'cell-hot':''}>{maxT}°</b></>:'—'}</td>
          <td colSpan={2}>{live.length}/{rows.length} online</td>
          <td colSpan={4}>tap any rig for full single-rig telemetry →</td>
        </tr></tfoot>}
      </table>
    </div>
  );
}

/* ---------- Gauges (real hashrate windows) ---------- */
function Gauges({ windows, pct }){
  const W=[['1M','hr1m'],['5M','hr5m'],['15M','hr15m'],['1HR','hr1h'],['6HR','hr6h'],['1D','hr1d'],['7D','hr7d']];
  const peak=Math.max(...W.map(([,k])=>windows?.[k]||0),1);
  return (
    <div className="gauges">
      {W.map(([lab,key])=>{
        const v=windows?.[key]; const p=pct?.[key]!=null?Math.round(pct[key]):(Number.isFinite(v)?Math.round((v/peak)*100):0);
        const r=34,c=Math.PI*r,off=c*(1-Math.max(0,Math.min(100,p))/100);
        return (
          <div className="gauge" key={key}>
            <svg viewBox="0 0 80 48"><path d="M6 44 A34 34 0 0 1 74 44" fill="none" stroke="var(--bg-deep)" strokeWidth="7" strokeLinecap="round"/><path d="M6 44 A34 34 0 0 1 74 44" fill="none" stroke="var(--amber)" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} style={{filter:'drop-shadow(0 0 4px rgba(var(--amber-rgb),.4))'}}/></svg>
            <div className="gw">{lab}</div><div className="gv">{Number.isFinite(v)?hrShort(v):'—'}</div><div className="gp">{p}%</div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Donut (real connection states) ---------- */
function Donut({ pool }){
  const active=Math.max(0,(pool?.workers||0)-(pool?.idle||0)-(pool?.disconnected||0));
  const idle=pool?.idle||0, disc=pool?.disconnected||0; const total=active+idle+disc||1;
  const segs=[['Active',active,'var(--green)'],['Idle',idle,'var(--amber)'],['Disconnected',disc,'var(--red)']];
  let acc=0; const stops=segs.map(([,n,c])=>{const s=(acc/total)*100;acc+=n;const e=(acc/total)*100;return `${c} ${s}% ${e}%`;}).join(', ');
  return (
    <div className="donutwrap">
      <div className="donut-cg">
        <div className="donut-ring" style={{background:`conic-gradient(${stops})`}}/>
        <div className="donut-hole"><span className="dn-tot">{active+idle+disc}</span><span className="dn-lbl">workers</span></div>
      </div>
      <div className="donutlegend">
        <div className="dlg"><span className="sw" style={{background:'var(--green)'}}/>Active <b>{active}</b></div>
        <div className="dlg"><span className="sw" style={{background:'var(--amber)'}}/>Idle <b>{idle}</b></div>
        <div className="dlg"><span className="sw" style={{background:'var(--red)'}}/>Disconnected <b>{disc}</b></div>
      </div>
    </div>
  );
}

const DL=(k,v,cls)=> <div className="dl"><span className="k">{k}</span><span className={`v ${cls||''}`}>{v}</span></div>;

/* ============================ MAIN ============================ */
export default function DesktopPages({
  cardComponents = {}, poolState, workers = [], aliases = {}, displayName,
  stratumHealth, ticker = null, onOpenSettings, openModal, onWorkerClick,
  status = 'Mining Live', zmq = null, strikes = 0,
}){
  const narrow=useIsNarrow();
  const now=useNow();
  const [page,setPage]=useState(0);
  const [dotsVisible,setDotsVisible]=useState(true);
  const dotsTimer=useRef(null);
  const pokeDots=useCallback(()=>{ setDotsVisible(true); clearTimeout(dotsTimer.current); dotsTimer.current=setTimeout(()=>setDotsVisible(false),2500); },[]);
  const [fsCard,setFsCard]=useState(null); // 'pulse' | 'hunt' | null — fullscreen overlay
  const [svRange,setSvRange]=useState('1H'); // strike-velocity window
  const [fpTrend,setFpTrend]=useState('live'); // firepower trend window
  const NP=3;
  const startX=useRef(null);
  const fitRef=useRef(null);
  const scalerRef=useRef(null);
  const go=useCallback(p=>{setPage(Math.max(0,Math.min(NP-1,p)));},[]);
  const M=(name)=>()=>openModal&&openModal(name);

  useEffect(()=>{ pokeDots(); return ()=>clearTimeout(dotsTimer.current); },[page,pokeDots]);
  useEffect(()=>{ const on=e=>{if(e.key==='ArrowRight')go(page+1);if(e.key==='ArrowLeft')go(page-1);}; window.addEventListener('keydown',on); return()=>window.removeEventListener('keydown',on); },[page,go]);
  useEffect(()=>{ const el=document.getElementById('ssdesk-css'); if(el)el.remove(); const s=document.createElement('style');s.id='ssdesk-css';s.textContent=CSS;document.head.appendChild(s); },[]);
  useEffect(()=>{
    const fit=()=>{ const f=fitRef.current,sc=scalerRef.current; if(!f||!sc)return; const k=Math.min(f.clientWidth/1280,f.clientHeight/860); sc.style.transform=`scale(${k})`; };
    fit(); window.addEventListener('resize',fit); return()=>window.removeEventListener('resize',fit);
  },[narrow]);

  if(narrow) return null;

  /* ---- real data ---- */
  const hr=poolState?.hashrate||{}, pool=poolState?.pool||{}, shares=poolState?.shares||{}, ns=poolState?.networkStats||{};
  const net=poolState?.network||{}, snap=poolState?.snapshots||{}, odds=poolState?.odds||{}, reward=poolState?.blockReward||{}, mp=poolState?.mempool||{}, retarget=poolState?.retarget||{};
  const blocks=Array.isArray(poolState?.netBlocks)?poolState.netBlocks:(Array.isArray(poolState?.blocks)?poolState.blocks:[]);
  const cur=hr.current||0, peak=pool.hashratePeak||hr.peak||0;
  const windows=pool.hashrateWindows||{}, wpct=pool.hashrateWindowPct||{};
  const liveW=(workers||[]).filter(w=>(w.hashrate||0)>0 && w.status!=='offline').length, totW=(workers||[]).length;
  const zmqOk=zmq&&(zmq.connected||zmq.synced||zmq===true);

  // firepower chart + avgs
  const hrHist=(Array.isArray(hr.history)?hr.history:[]).map(h=>h.hr).filter(Number.isFinite);
  const fp=linePath(hrHist);
  const avgW=[['1M','hr1m'],['5M','hr5m'],['15M','hr15m'],['1H','hr1h'],['6H','hr6h'],['24H','hr1d'],['7D','hr7d']];
  const wmax=Math.max(cur,...Object.values(windows).filter(Number.isFinite),1);

  // strike velocity
  const sps=shares.sps1m||0;
  const spsHist=(Array.isArray(shares.spsHistory)?shares.spsHistory:[]).slice(-64);
  const spsMax=Math.max(...spsHist.map(p=>p.sps||0),1);

  // share stats
  const _ta=shares.acceptedCount||0, _tr=shares.rejectedCount||0, _ts=shares.stale||0, _gt=_ta+_tr+_ts;
  const acc=_gt>0?((_ta/_gt)*100).toFixed(2)+'%':'—';
  const rej=_gt>0?((_tr/_gt)*100).toFixed(2)+'%':'—';

  // health flags
  const H=stratumHealth||{};
  const healthItems=[['API',true],['ckpool',H.ckpool!==false],['stunnel',H.tls!==false],['TLS :4333',H.tls!==false],['node RPC',poolState?.nodeInfo?.connected!==false],['ZMQ synced',zmqOk]];

  // top miners
  const topMiners=[...(workers||[])].filter(w=>(w.bestshare||0)>0).sort((a,b)=>(b.bestshare||0)-(a.bestshare||0)).slice(0,3);

  // closest calls
  const cc=Array.isArray(snap.closestCalls)?snap.closestCalls:[];

  return (
    <div className="ssdesk" ref={fitRef}
      onTouchStart={e=>{startX.current=e.touches[0].clientX;pokeDots();}}
      onTouchEnd={e=>{if(startX.current==null)return;const dx=e.changedTouches[0].clientX-startX.current;if(Math.abs(dx)>60)go(dx<0?page+1:page-1);startX.current=null;}}>
      <div className="scaler" ref={scalerRef}>
        <div className={`pages${page===1?' p2':page===2?' p3':''}`}>

          {/* ============ PAGE 1 — LIVE ============ */}
          <div className="viewport">
            <AppHead page={0} status={status} zmqOk={zmqOk} strikes={snap.totalStrikes??strikes??0} ticker={page===0?ticker:null} now={now} onOpenSettings={onOpenSettings}/>

            {/* BAND 1 */}
            <div className="band b-charts">
              <div className="panel">
                <div className="zlabel">Firepower — {fpTrend==='live'?'Live':fpTrend.toUpperCase()}</div>
                <div className="fp">
                  <div className="fp-top"><span className="fp-num goldnum">{fmtTH(fpTrend==='live'?cur:(windows[avgKeyFor(fpTrend)]??cur))}<span className="unit" style={{fontSize:'.5em'}}> TH/s</span></span><span className="fp-peak">PEAK {fmtTH(peak)} · LIVE {liveW}/{totW}</span></div>
                  <div className="fp-chart"><svg viewBox="0 0 400 70" preserveAspectRatio="none">{fp&&<><defs><linearGradient id="hrG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--amber)" stopOpacity="0.28"/><stop offset="95%" stopColor="var(--amber)" stopOpacity="0.02"/></linearGradient></defs><path d={fp.fill} fill="url(#hrG)"/><path d={fp.ln} fill="none" stroke="var(--amber)" strokeWidth="2"/></>}</svg></div>
                  <div className="avgs">{avgW.map(([l,k])=>{const v=windows[k];return <div className={`avg clk-avg${fpTrend===l?' on':''}`} key={k} onClick={()=>setFpTrend(fpTrend===l?'live':l)} title={`Show ${l} trend`}><div className="al">{l}</div><div className="bar"><i style={{width:`${Math.min(100,((v||0)/wmax)*100)}%`}}/></div><div className="av">{Number.isFinite(v)?fmtTH(v):'—'}</div></div>;})}</div>
                </div>
              </div>
              <div className="panel">
                <div className="zlabel">Strike Velocity</div>
                <div className="sv">
                  <div className="sv-top"><span className="sv-num">{sps>=1000?(sps/1000).toFixed(2)+'k':sps.toFixed(1)}<span className="unit" style={{fontSize:'.42em'}}> shares/s</span></span><div className="sv-rng">{['1H','6H','24H'].map(r=><span key={r} className={svRange===r?'on':''} onClick={()=>setSvRange(r)}>{r}</span>)}</div></div>
                  {spsHist.length===0
                    ? <div className="sv-empty">{cur>0?'COLLECTING SAMPLES…':'NO MINERS'}</div>
                    : <div className="sv-hist">{spsHist.map((p,i)=><i key={i} style={{height:`${Math.max(3,((p.sps||0)/spsMax)*100)}%`}}/>)}</div>}
                  <div className="sv-leg"><span><b style={{background:'var(--green)'}}/>normal</span><span><b style={{background:'var(--amber)'}}/>spike/dip</span><span><b style={{background:'var(--red)'}}/>downtime</span></div>
                </div>
              </div>
            </div>

            {/* BAND 2 — Pulse (REAL globe) · Hunt (REAL) · Crew */}
            <div className="band b-feat">
              <div className="panel">
                <div className="zlabel zlabel-row">Solostrike Pulse<button className="expand-btn" title="Expand globe" onClick={()=>setFsCard('pulse')}>⤢</button></div>
                <div className="body">
                  <div className="slot-globe">{fsCard==='pulse'?null:cardComponents['pulse']||null}</div>
                  <div className="pulse-read">
                    <div className="pr"><div className="prl">Strikers</div><div className="prv">{ns.peers?.length??ns.strikers??'—'}</div></div>
                    <div className="pr"><div className="prl">Net Pulse</div><div className="prv">{ns.networkHashrate?hrShort(ns.networkHashrate):(net.hashrate?hrShort(net.hashrate):'—')}</div></div>
                    <div className="pr"><div className="prl">Your Pin</div><div className="prv" style={{color:'var(--cyan)',fontSize:'.58rem'}}>{poolState?.poolPin?'PINNED':'—'}</div></div>
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="zlabel zlabel-row">The Hunt<button className="expand-btn" title="Expand Hunt" onClick={()=>setFsCard('hunt')}>⤢</button></div>
                <div className="body">
                  <div className="slot-hunt">{fsCard==='hunt'?null:cardComponents['hunt']||null}</div>
                  <div className="hunt-face">
                    <div className="hf-reward"><span className="lbl">Block Reward</span><span className="goldnum" style={{fontFamily:'var(--fd)',fontSize:'.98rem',fontWeight:800}}>{reward.totalBtc!=null?reward.totalBtc.toFixed(4):'—'}<span className="unit" style={{fontSize:'.6em'}}> BTC</span></span></div>
                    <div className="hf-sub">subsidy <b>{reward.subsidy??'—'}</b> · fees <span className="fee">{reward.feesBtc!=null?'+'+reward.feesBtc.toFixed(4):(reward.totalBtc!=null&&reward.subsidy!=null?'+'+(reward.totalBtc-reward.subsidy).toFixed(4):'—')}</span></div>
                    <div className="hf-fees"><div className="ft"><div className="ftl fast">⚡Fast</div><div className="ftv">{mp.feeFast??'—'}</div><div className="ftu">sat/vB</div></div><div className="ft"><div className="ftl mid">◐Mid</div><div className="ftv">{mp.feeMid??'—'}</div><div className="ftu">sat/vB</div></div><div className="ft"><div className="ftl low">◯Low</div><div className="ftv">{mp.feeLow??'—'}</div><div className="ftu">sat/vB</div></div></div>
                    <div className="hf-odds"><div className="o"><div className="ol">Yearly</div><div className="ov">{odds.yearly!=null?(odds.yearly*100).toFixed(2)+'%':'—'}</div></div><div className="o"><div className="ol">Daily</div><div className="ov">{odds.daily!=null?(odds.daily*100).toFixed(3)+'%':'—'}</div></div><div className="o"><div className="ol">Sats/d</div><div className="ov">{odds.satsPerDay??'—'}</div></div></div>
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="zlabel">The Crew · live telemetry · {liveW}/{totW}</div>
                <Crew workers={workers} aliases={aliases} displayName={displayName} onWorkerClick={onWorkerClick}/>
              </div>
            </div>

            {/* BAND 3 — 8 data cols */}
            <div className="band b-data">
              <div className="col"><div className="ch">Bitcoin Network</div>{DL('Difficulty',net.difficulty?hrShort(net.difficulty):'—')}{DL('Hashrate',net.hashrate?hrShort(net.hashrate):'—')}{DL('Mempool',mp.count!=null?fmtNum(mp.count):'—')}{DL('Retarget',retarget.difficultyChange!=null?(retarget.difficultyChange>=0?'+':'')+retarget.difficultyChange.toFixed(1)+'%':'—',retarget.difficultyChange>=0?'red':'green')}</div>
              <div className="col"><div className="ch">Bitcoin Node</div>{DL('Status',poolState?.nodeInfo?.connected?'LIVE':'—',poolState?.nodeInfo?.connected?'green':'')}{DL('Height',net.height!=null?fmtNum(net.height):'—')}{DL('Peers',poolState?.nodeInfo?.peers!=null?fmtNum(poolState.nodeInfo.peers):'—')}{DL('ZMQ',zmqOk?'● sync':'○',zmqOk?'green':'')}</div>
              <div className="col"><div className="ch">Stratum</div>{DL('TCP',':3333','cyan')}{DL('Alt',':3334')}{DL('TLS',':4333','cyan')}{DL('Workers',`${liveW}/${totW}`)}</div>
              <div className="col"><div className="ch">Strikes</div>{DL('Closest',cc[0]?.pct!=null?cc[0].pct.toFixed(4)+'%':'—','cyan')}{DL('Workers',`${liveW}/${totW}`)}{DL('Solo 30d',snap.soloBlocks30d??'—','amber')}{DL('Yours',snap.totalStrikes??0,'amber')}</div>
              <div className="col"><div className="ch">Near Strikes</div>{cc.length?cc.slice(0,4).map((c,i)=>{const netDiff=net.difficulty>0?net.difficulty:null;const pct=netDiff?(c.diff/netDiff)*100:null;return DL('#'+(i+1)+' '+((displayName?displayName(c.workerName,aliases):c.workerName)||'').slice(0,6),pct!=null?pct.toFixed(4)+'%':hrShort(c.diff),i===0?'cyan':'');}):<div style={{fontSize:'.58rem',color:'var(--text-3)'}}>No near-misses yet.</div>}</div>
              <div className="col"><div className="ch">Top Miners</div>{topMiners.length?<>{topMiners.map((w,i)=>DL((i+1)+'·'+((displayName?displayName(w.name,aliases):w.name)||'—').slice(0,7),hrShort(w.bestshare),i===0?'amber':'cyan'))}{DL('Pool best',poolState?.bestshare?hrShort(poolState.bestshare):'—')}</>:<div style={{fontSize:'.58rem',color:'var(--text-3)'}}>No shares submitted yet.</div>}</div>
              <div className="col"><div className="ch">Claim Jumpers</div>{(()=>{const tf=Array.isArray(poolState?.topFinders)?poolState.topFinders:[];return tf.length?<>{tf.slice(0,4).map((f,i)=><div className="barrow" key={i}><span className="nm">{f.name||'—'}{f.isSolo&&<span className="solo">SOLO</span>}</span><span className="ct">{f.count??0}</span></div>)}</>:<div style={{fontSize:'.58rem',color:'var(--text-3)'}}>Awaiting block data…</div>;})()}</div>
              <div className="col clk" onClick={M('Share Stats')}><div className="ch">Share Stats</div>{DL('Total',shares.acceptedCount?(shares.acceptedCount/1e6).toFixed(1)+' M':'—')}{DL('Best',poolState?.bestshare?hrShort(poolState.bestshare):'—','amber')}{DL('Accept',acc,'green')}{DL('Reject',rej)}</div>
            </div>

            {/* BAND 4 — ledger + health */}
            <div className="band" style={{gridTemplateColumns:'2.2fr 1.2fr',borderTop:'1px solid var(--hair)',paddingTop:8}}>
              <div className="col" style={{paddingLeft:0,borderLeft:0}}><div className="ch">The Ledger — Recent Blocks</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'0 14px'}}>
                  {blocks.slice(0,6).map((b,i)=><div className="dl" key={i} style={{border:0}}><span className="k">{fmtNum(b.height)}</span><span className="v">{(b.miner||b.pool||'—').toString().slice(0,10)}</span></div>)}
                  {blocks.length===0&&<div className="dl" style={{border:0}}><span className="k">—</span><span className="v">waiting</span></div>}
                </div>
              </div>
              <div className="col clk" onClick={M('System Health')}><div className="ch">System Health</div>
                <div className="status">{healthItems.map(([l,ok],i)=><div className={`st${ok?'':' bad'}`} key={i}><span className="dot"/>{l}</div>)}</div>
              </div>
            </div>
          </div>

          {/* ============ PAGE 2 — POOL INTERNALS ============ */}
          <div className="viewport p2">
            <AppHead page={1} zmqOk={zmqOk} ticker={page===1?ticker:null} now={now} onOpenSettings={onOpenSettings}/>
            <div className="band" style={{gridTemplateColumns:'1.5fr 1fr 1fr',minHeight:0}}>
              <div className="panel"><div className="zlabel">Hashrate Windows — % of Pool Peak</div><Gauges windows={windows} pct={wpct}/></div>
              <div className="panel"><div className="zlabel">Shares / Second — Windows</div>
                <div className="spswins">{[['1M','sps1m'],['5M','sps5m'],['15M','sps15m'],['1H','sps1h']].map(([l,k])=>{const v=pool.spsWindows?.[k]||0;const mx=Math.max(...Object.values(pool.spsWindows||{}).filter(Number.isFinite),1);return <div className="spsrow" key={k}><span className="sl">{l}</span><span className="sbar"><i style={{width:`${Math.min(100,(v/mx)*100)}%`}}/></span><span className="sv">{v>=1000?(v/1000).toFixed(2)+'k':v.toFixed(1)} sh/s</span></div>;})}</div>
              </div>
              <div className="panel"><div className="zlabel">Connection States</div><Donut pool={pool}/></div>
            </div>
            <div className="panel" style={{minHeight:0}}>
              <div className="zlabel">Fleet Comparison — All Rigs at a Glance <span style={{color:'var(--text-3)',fontSize:'.85em'}}>(scan side-by-side · tap a rig for one-rig depth)</span></div>
              <FleetTable workers={workers} aliases={aliases} displayName={displayName} onWorkerClick={onWorkerClick}/>
            </div>
            <div className="band b-data" style={{gridTemplateColumns:'1fr 1fr 1fr 1fr',minHeight:0,alignSelf:'end'}}>
              <div className="col" style={{paddingLeft:0,borderLeft:0}}><div className="ch">General Info</div>{DL('Pool runtime',poolState?.shareStatsStartedAt?fmtUptime((Date.now()-poolState.shareStatsStartedAt)/1000):'—')}{DL('Workers',`${liveW}/${totW}`)}{DL('Accept',acc,'cyan')}{DL('ckpool','solo 2.x')}</div>
              <div className="col"><div className="ch">Shares Since Last Block</div>{DL('Accepted',shares.acceptedCount?(shares.acceptedCount/1e6).toFixed(2)+' M':'—','green')}{DL('Rejected',fmtNum(shares.rejectedCount))}{DL('Accept',acc,'cyan')}{DL('Reject',rej)}</div>
              <div className="col"><div className="ch">Best Share — Trend</div><TsLine data={(Array.isArray(shares.bestHistory)?shares.bestHistory:[]).map(b=>b.best).filter(Number.isFinite)} color="var(--chart1)" fmt={v=>hrShort(v)}/></div>
              <div className="col"><div className="ch">Users + Workers History</div><TsLine data={(Array.isArray(pool.workersHistory)?pool.workersHistory:[]).map(p=>p.workers).filter(Number.isFinite)} color="var(--chart2)" fmt={v=>Math.round(v)} unit="wkrs"/></div>
            </div>
          </div>

          {/* ============ PAGE 3 — LUCK & ANALYTICS ============ */}
          <div className="viewport p3">
            <AppHead page={2} zmqOk={zmqOk} ticker={page===2?ticker:null} now={now} onOpenSettings={onOpenSettings}/>
            <div className="band" style={{gridTemplateColumns:'1.7fr 1fr',minHeight:0}}>
              <div className="panel"><div className="zlabel">Block Effort / Luck — per strike <span style={{color:'var(--text-3)',fontSize:'.85em'}}>(shares-to-find vs expected · &lt;100% = lucky)</span></div>
                <div className="effortwrap">{(()=>{const rounds=Array.isArray(snap.blockEffort)?snap.blockEffort.slice(-6):[];const arr=[...Array(Math.max(0,6-rounds.length)).fill(null),...rounds];arr.push(snap.openEffortPct??null);const col=p=>p==null?'var(--bg-raised)':p<100?'var(--green)':p<=200?'var(--amber)':'var(--red)';return arr.slice(0,7).map((p,i)=>{const h=p==null?14:Math.min(100,(p/250)*100);return <div className="ebar" key={i}><div className="pct" style={{color:col(p)}}>{p==null?'':Math.round(p)+'%'}</div><div className="col2" style={{height:`${h}%`,background:col(p)}}/><div className="lab">{i===6?'NOW':'—'}</div></div>;});})()}</div>
                {(!snap.blockEffort||!snap.blockEffort.length)&&<div className="effort-note">No blocks found yet — history fills in as you strike. The NOW bar shows the current open round's effort.</div>}
              </div>
              <div className="panel"><div className="zlabel">Hashrate Stability</div>
                <div style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:10,flex:1}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:10}}><span className="goldnum" style={{fontFamily:'var(--fd)',fontSize:'2rem',fontWeight:700}}>{hr.stabilityPct!=null?hr.stabilityPct.toFixed(1):'—'}<span className="unit" style={{fontSize:'.4em'}}> %</span></span><span style={{fontSize:'.62rem',color:'var(--text-2)'}}>consistency (7d)</span></div>
                  <TsLine data={hrHist} color="var(--chart1)" H={80} fmt={v=>fmtTH(v)+'T'}/>
                  <div style={{display:'flex'}}>
                    <div style={{flex:1,textAlign:'center',borderRight:'1px solid var(--hair)'}}><div style={{fontFamily:'var(--fd)',fontSize:'.5rem',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'.1em'}}>Std Dev</div><div style={{fontFamily:'var(--fd)',fontSize:'.8rem',fontWeight:700,color:'var(--amber)'}}>{hr.stdDev!=null?'±'+fmtTH(hr.stdDev)+' T':'—'}</div></div>
                    <div style={{flex:1,textAlign:'center',borderRight:'1px solid var(--hair)'}}><div style={{fontFamily:'var(--fd)',fontSize:'.5rem',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'.1em'}}>Min / Max</div><div style={{fontFamily:'var(--fd)',fontSize:'.8rem',fontWeight:700,color:'var(--text-1)'}}>{hrHist.length?fmtTH(Math.min(...hrHist))+' / '+fmtTH(Math.max(...hrHist))+' T':'—'}</div></div>
                    <div style={{flex:1,textAlign:'center'}}><div style={{fontFamily:'var(--fd)',fontSize:'.5rem',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'.1em'}}>Dips 24h</div><div style={{fontFamily:'var(--fd)',fontSize:'.8rem',fontWeight:700,color:'var(--red)'}}>{hr.dips24h??'—'}</div></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="band" style={{gridTemplateColumns:'1fr 1fr 1fr',minHeight:0}}>
              <div className="panel"><div className="zlabel">Reject Reasons — Trend (24h)</div>
                <div className="rejtrend">{(()=>{const rr=shares.rejectReasons||{};const ent=Object.entries(rr).sort((a,b)=>b[1]-a[1]).slice(0,3);const tot=ent.reduce((s,[,n])=>s+n,0)||1;const cols=['var(--amber)','var(--cyan)','var(--text-2)'];return ent.length?<>{ent.map(([n,c],i)=>{const p=Math.round((c/tot)*100);return <div className="rejrow" key={n}><span className="rl">{n}</span><span className="rbar"><i style={{width:p+'%',background:cols[i]}}/></span><span className="rv">{p}%</span></div>;})}<div style={{fontSize:'.54rem',color:'var(--text-3)',marginTop:2}}>of {fmtNum(shares.rejectedCount)} rejected shares · last 24h</div></>:<div style={{fontSize:'.6rem',color:'var(--text-3)'}}>No rejected shares recorded.</div>;})()}</div>
              </div>
              <div className="panel"><div className="zlabel">Mempool Fee</div>
                <div style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:8,flex:1}}>
                  <div className="hf-fees" style={{borderTop:0}}><div className="ft"><div className="ftl fast">⚡Fast</div><div className="ftv">{mp.feeFast??'—'}</div><div className="ftu">sat/vB</div></div><div className="ft"><div className="ftl mid">◐Mid</div><div className="ftv">{mp.feeMid??'—'}</div><div className="ftu">sat/vB</div></div><div className="ft"><div className="ftl low">◯Low</div><div className="ftv">{mp.feeLow??'—'}</div><div className="ftu">sat/vB</div></div></div>
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:'.6rem',fontFamily:'var(--fm)',color:'var(--text-2)'}}><span>Mempool</span><span style={{color:'var(--text-1)'}}>{mp.count!=null?fmtNum(mp.count)+' tx':'—'}</span></div>
                </div>
              </div>
              <div className="panel"><div className="zlabel">Difficulty Retarget</div>
                <div style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:9,flex:1}}>
                  <div style={{textAlign:'center'}}><div style={{fontFamily:'var(--fd)',fontSize:'1.7rem',fontWeight:700,color:retarget.difficultyChange>=0?'var(--red)':'var(--green)',lineHeight:1}}>{retarget.difficultyChange!=null?(retarget.difficultyChange>=0?'+':'')+retarget.difficultyChange.toFixed(2)+'%':'—'}</div><div style={{fontSize:'.55rem',letterSpacing:'.15em',textTransform:'uppercase',color:'var(--text-2)',marginTop:3}}>estimated change</div>{retarget.prevDifficultyChange!=null&&<div style={{fontFamily:'var(--fm)',fontSize:'.62rem',color:'var(--text-2)',marginTop:4}}>Last epoch: <span style={{color:retarget.prevDifficultyChange>=0?'var(--red)':'var(--green)',fontWeight:600}}>{(retarget.prevDifficultyChange>=0?'+':'')+retarget.prevDifficultyChange.toFixed(2)+'%'}</span></div>}</div>
                  {retarget.progressPercent!=null&&<div><div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'.52rem',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:3}}><span>Epoch progress</span><span style={{color:'var(--cyan)'}}>{retarget.progressPercent.toFixed(1)}%</span></div><div style={{height:3,background:'var(--bg-deep)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.max(0,Math.min(100,retarget.progressPercent))}%`,background:'var(--cyan)',boxShadow:'0 0 8px rgba(0,255,209,0.5)'}}/></div></div>}
                  {retarget.remainingBlocks!=null&&<div style={{display:'flex',justifyContent:'space-between',fontSize:'.6rem',fontFamily:'var(--fm)'}}><span style={{color:'var(--text-2)'}}>Remaining Blocks <b style={{color:'var(--text-1)',fontWeight:600}}>{fmtNum(retarget.remainingBlocks)}</b></span></div>}
                </div>
              </div>
            </div>
            <div className="band b-data" style={{gridTemplateColumns:'1fr 1fr 1fr 1fr',minHeight:0,alignSelf:'end'}}>
              <div className="col" style={{paddingLeft:0,borderLeft:0}}><div className="ch">Lifetime Records</div>{DL('Best ever (fleet)',poolState?.bestshare?hrShort(poolState.bestshare):'—','amber')}{DL('Best worker',topMiners[0]?(displayName?displayName(topMiners[0].name,aliases):topMiners[0].name):'—')}{DL('Closest to block',cc[0]?.pct!=null?cc[0].pct.toFixed(4)+'%':'—','cyan')}{DL('Peak hashrate',fmtTH(peak)+' T')}</div>
              <div className="col"><div className="ch">Luck Summary</div>{DL('Avg effort',snap.avgEffortPct!=null?Math.round(snap.avgEffortPct)+'%':'—','amber')}{DL('Blocks found',snap.blocksFound??0)}{DL('Best round luck',snap.bestRoundLuck!=null?Math.round(snap.bestRoundLuck)+'%':'—')}{DL('Shares this round',shares.acceptedCount?(shares.acceptedCount/1e6).toFixed(2)+' M':'—')}</div>
              <div className="col"><div className="ch">Fleet Efficiency</div>{DL('Total power',poolState?.fleet?.totalW?fmtNum(poolState.fleet.totalW)+' W':'—')}{DL('Avg J/TH',poolState?.fleet?.avgJTH?.toFixed?.(1)??'—','amber')}{DL('Best rig J/TH',poolState?.fleet?.bestJTH?.toFixed?.(2)??'—','green')}{DL('Cost / interval','power-based')}</div>
              <div className="col"><div className="ch">Reliability</div>{DL('Fleet uptime',totW?((liveW/totW)*100).toFixed(1)+'%':'—','green')}{DL('Workers online',`${liveW}/${totW}`)}{DL('Outages 7d',poolState?.fleet?.outages7d??'—')}{DL('Pool restarts',poolState?.fleet?.poolRestarts??'—')}</div>
            </div>
          </div>

        </div>
      </div>

      <button className={`nav l${page===0?' hidden':''}`} onClick={()=>go(page-1)}>❮</button>
      <button className={`nav r${page===NP-1?' hidden':''}`} onClick={()=>go(page+1)}>❯</button>
      <div className={`pagedots${dotsVisible?'':' hide'}`} onMouseEnter={pokeDots}>{[0,1,2].map(i=><i key={i} className={i===page?'on':''} onClick={()=>go(i)}/>)}</div>

      {fsCard && (
        <div className="fs-overlay" onClick={e=>{if(e.target===e.currentTarget)setFsCard(null);}}>
          <div className="fs-inner">
            <div className="fs-head"><span>{fsCard==='pulse'?'Solostrike Pulse':'The Hunt'}</span><button className="fs-close" onClick={()=>setFsCard(null)}>✕</button></div>
            <div className="fs-stage">{cardComponents[fsCard]||null}</div>
          </div>
        </div>
      )}
    </div>
  );
}
