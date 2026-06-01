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
import { makeTT } from '../i18n.js';

/* ---------- formatters ---------- */
const TH = h => (h ? h / 1e12 : 0);
function hrShort(h){ if(h==null||h<=0)return '—'; const u=['H','K','M','G','T','P','E']; let i=0,v=h; while(v>=1000&&i<u.length-1){v/=1000;i++;} return `${v.toFixed(v<10?2:0)} ${u[i]}`; }
function fmtTH(h){ return TH(h).toFixed(1); }
function fmtUptime(s){ if(s==null)return '—'; if(s<60)return Math.floor(s)+'s'; if(s<3600)return Math.floor(s/60)+'m'; if(s<86400)return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'; return Math.floor(s/86400)+'d '+Math.floor((s%86400)/3600)+'h'; }
function fmtDurationMs(ms){ if(!ms||ms<0)return '—'; const s=Math.floor(ms/1000); const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60); if(d>0)return `${d}d ${h}h`; if(h>0)return `${h}h ${m}m`; return `${m}m`; }
function fmtNum(n){ return n==null?'—':Number(n).toLocaleString(); }
const avgKeyFor = lab => ({'1M':'hr1m','5M':'hr5m','15M':'hr15m','1H':'hr1h','6H':'hr6h','24H':'hr1d','7D':'hr7d'}[lab]||'hr1h');
// v1.12.x: stable color per mining pool for the Ledger chips
function poolColor(name){
  const m={foundry:'#f5a623',antpool:'#ff5252',viabtc:'#3da6ff',f2pool:'#00ffd1',sbi:'#b06bff',mara:'#39ff6a',spiderpool:'#ff8a3d',luxor:'#ffe14d',binance:'#f3ba2f',braiins:'#7cc4ff',slush:'#7cc4ff',ocean:'#3da6ff'};
  const n=(name||'').toLowerCase();
  const key=Object.keys(m).find(k=>n.includes(k));
  if(key)return m[key];
  let h=0; for(let i=0;i<n.length;i++)h=(h*31+n.charCodeAt(i))>>>0;
  return `hsl(${h%360},65%,60%)`;
}

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
.ssdesk{--hair:rgba(var(--amber-rgb),0.14);position:fixed;inset:0;z-index:1;overflow:hidden;display:flex;flex-direction:column;background:radial-gradient(1100px 600px at 72% -5%,rgba(var(--amber-rgb),0.08),transparent 60%),radial-gradient(800px 520px at -5% 105%,rgba(0,255,209,0.04),transparent 55%),var(--bg-void)}
.ssdesk .scaler{width:100%;flex:1;min-height:0;overflow:hidden}
.ssdesk .pages{display:flex;width:100%;height:100%;transition:transform .42s cubic-bezier(.6,.02,.2,1)}
.ssdesk .pages.p2{transform:translateX(-100%)}.ssdesk .pages.p3{transform:translateX(-200%)}.ssdesk .pages.p4{transform:translateX(-300%)}
.ssdesk .viewport.vitals{grid-template-rows:auto minmax(0,1.25fr) minmax(0,1fr);row-gap:16px}
.ssdesk .viewport.vitals .b-data{align-self:stretch}
.ssdesk .viewport.vitals .b-data .col{display:flex;flex-direction:column}
.ssdesk .viewport.vitals .b-data .col .ch{margin-bottom:10px}
.ssdesk .viewport.vitals .b-data .col .dl{flex:1 1 0;align-items:center;font-size:.74rem}
.ssdesk .viewport.vitals .band:last-of-type{align-self:stretch}
.ssdesk .viewport.vitals .band:last-of-type .col{display:flex;flex-direction:column}
.ssdesk .viewport.vitals .band:last-of-type .ch{margin-bottom:10px}
.ssdesk .viewport.vitals .band:last-of-type .status{margin-top:auto;font-size:.66rem;gap:10px}
.ssdesk .ss-foot{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:5px 18px;border-top:1px solid var(--border);background:rgba(6,7,8,.92);backdrop-filter:blur(10px);font-family:var(--fd);font-size:.54rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-3);white-space:nowrap;overflow:hidden}
.ssdesk .ss-foot .ff-brand{color:var(--text-3)}
.ssdesk .ss-foot .ff-gh{display:inline-flex;align-items:center;color:var(--text-2);text-decoration:none;padding:2px 6px;flex:none}
.ssdesk .ss-foot .ff-gh:hover{color:var(--amber)}
.ssdesk .ss-foot .ff-r{display:flex;align-items:center;gap:6px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis}
.ssdesk .ss-foot .port{color:var(--amber);font-weight:700;cursor:pointer}
.ssdesk .ss-foot .port:hover{text-decoration:underline}
.ssdesk .ss-foot .tls{padding:1px 5px;border-radius:3px;font-size:.5rem;letter-spacing:.14em;color:var(--cyan);border:1px solid rgba(0,255,209,0.45);background:rgba(0,255,209,0.05)}
.ssdesk .ss-foot b{color:var(--text-1);font-weight:700}
.ssdesk .viewport{flex:0 0 100%;width:100%;height:100%;background:transparent;border:none;border-radius:0;overflow:hidden;position:relative;display:grid;grid-template-rows:auto 210px minmax(0,1fr);padding:14px 10px;row-gap:12px}
.ssdesk .viewport.p2,.ssdesk .viewport.p3{grid-template-rows:auto minmax(0,1fr) minmax(0,1fr) auto}
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
.ssdesk .ah-gear{background:none;border:none;color:var(--text-2);cursor:pointer;font-size:17px;padding:0 2px;margin-right:2px;line-height:1;flex:none}
@keyframes ss-pulse{0%,100%{opacity:1}50%{opacity:.55}}

.ssdesk .band{display:grid;gap:16px;min-height:0}
.ssdesk .b-charts{grid-template-columns:1fr 1fr;min-height:0;overflow:hidden}
.ssdesk .b-feat{grid-template-columns:218px 320px 1fr;min-height:0;overflow:hidden}
.ssdesk .b-data{grid-template-columns:repeat(8,1fr);min-height:0;align-self:end}
.ssdesk .b-data-7{grid-template-columns:repeat(7,1fr)}
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
.ssdesk .sv-leg{display:flex;align-items:center;gap:10px;font-family:var(--fd);font-size:.46rem;color:var(--text-2);flex-wrap:wrap}.ssdesk .sv-leg b{display:inline-block;width:6px;height:6px;border-radius:2px;margin-right:3px}
.ssdesk .sv-median{margin-left:auto;color:var(--text-2);white-space:nowrap}
.ssdesk .sv-samples{font-family:var(--fd);font-size:.5rem;font-weight:600;letter-spacing:.06em;color:var(--text-2);text-transform:uppercase}

.ssdesk .body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:0;border-radius:11px}
.ssdesk .slot-globe{width:100%;flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ssdesk .slot-hunt{width:100%;flex:1;min-height:0;position:relative;overflow:hidden}
/* mounted Pulse/Hunt panels render their own "▸ Title" as first child — hide it
   (our zlabel above already provides a translated, deduped title). */
.ssdesk .slot-globe > * > *:first-child,
.ssdesk .slot-hunt  > * > *:first-child{display:none!important}
/* let the panel body fill the freed space */
.ssdesk .slot-globe > *,.ssdesk .slot-hunt > *{height:100%!important;background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important}
.ssdesk .slot-globe>*,.ssdesk .slot-hunt>*{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;background:transparent!important;border:none!important;box-shadow:none!important;border-radius:0!important;padding:0!important;margin:0!important}
/* desktop pulse slot: the mounted PulsePanel renders its own bottom stats +
   "TAP TO SEE STRIKERS" disclaimer which gets clipped by the fixed slot height.
   We already show a pulse-read strip below, so let the globe own the slot and
   hide the panel's non-canvas children (text/stat strips) here. */
.ssdesk .slot-globe canvas{position:absolute!important;inset:0!important;width:100%!important;height:100%!important}
/* desktop hunt slot: keep ONLY the NonceField canvas — the mounted HuntPanel's
   PER-BLOCK ODDS header + BLOCK REWARD strip duplicate (and clip against) the
   desktop hunt-face readout below. Force the canvas to fill the slot. */
.ssdesk .slot-hunt canvas{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;object-fit:cover}
/* hide the HuntPanel's text rows inside the slot so only the canvas shows.
   The panel content is: [odds-header row][nonce canvas][block-reward strip].
   We keep the wrapper that contains the canvas; hide the reward strip (its
   sibling) and the odds-header text row. */
.ssdesk .slot-hunt > * > * > div:last-child{display:none!important}
.ssdesk .slot-hunt > * > * > div:first-child > div:first-child{visibility:hidden!important}
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

.ssdesk .crew{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));grid-auto-rows:max-content;align-content:start;gap:6px 12px;min-height:0;overflow-y:auto;flex:1;padding-right:2px}
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
/* v1.12.x Vitals visuals */
.ssdesk .dbar{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:.56rem}
.ssdesk .dbar .dnm{color:var(--text-1);font-family:var(--fd);flex:0 0 auto;max-width:54px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssdesk .dbar .dtrack{flex:1;height:6px;background:var(--bg-deep);border-radius:3px;overflow:hidden;min-width:0}
.ssdesk .dbar .dtrack i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,rgba(0,255,209,.3),var(--cyan))}
.ssdesk .dbar .dtrack i.hot{background:linear-gradient(90deg,rgba(var(--amber-rgb),.4),var(--amber));box-shadow:0 0 6px rgba(var(--amber-rgb),.5)}
.ssdesk .dbar .dval{color:var(--text-2);font-family:var(--fm);font-size:.52rem;flex:none}
.ssdesk .accbar{display:flex;height:8px;border-radius:4px;overflow:hidden;margin-top:9px;background:var(--bg-deep)}
.ssdesk .accbar i.acc{background:linear-gradient(90deg,rgba(57,255,106,.5),var(--green))}
.ssdesk .accbar i.rej{background:var(--red)}
.ssdesk .lchip{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:5px;vertical-align:middle;flex:none}

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
.ssdesk .pagedots{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);z-index:55;display:flex;gap:8px;padding:6px 10px;border-radius:12px;background:rgba(11,13,15,.55);backdrop-filter:blur(4px);opacity:1;transition:opacity .6s ease}
.ssdesk .pagedots.hide{opacity:0;pointer-events:none}
.ssdesk .pagedots i{width:8px;height:8px;border-radius:50%;background:rgba(var(--amber-rgb),.3);cursor:pointer}.ssdesk .pagedots i.on{width:20px;border-radius:4px;background:var(--amber);box-shadow:0 0 8px var(--amber)}

/* clickable trend avg cells */
.ssdesk .avg.clk-avg{cursor:pointer;border-radius:5px;padding:1px;transition:background .12s}
.ssdesk .avg.clk-avg:hover{background:rgba(var(--amber-rgb),.08)}
.ssdesk .avg.clk-avg.on{background:rgba(var(--amber-rgb),.12);box-shadow:inset 0 0 0 1px rgba(var(--amber-rgb),.3)}
/* compact segmented trend control */
.ssdesk .fp-seg{display:flex;gap:3px;flex:none}
.ssdesk .fp-seg span{font-family:var(--fd);font-size:.46rem;font-weight:700;letter-spacing:.05em;padding:2px 6px;border-radius:4px;border:1px solid var(--border-hot);color:var(--text-2);cursor:pointer;transition:all .12s}
.ssdesk .fp-seg span:hover{color:var(--amber)}
.ssdesk .fp-seg span.on{color:var(--amber);background:rgba(var(--amber-rgb),.12);box-shadow:inset 0 0 0 1px rgba(var(--amber-rgb),.3)}
/* health card mount (real HealthStatusCard) */
.ssdesk .health-col{overflow:hidden}
.ssdesk .health-mount{min-height:0;overflow:hidden;flex:1}
.ssdesk .health-mount>*{background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important;height:auto!important}
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
.ssdesk .fs-stage{flex:1;min-height:0;position:relative;display:flex;align-items:center;justify-content:center;padding:14px;overflow:hidden}
.ssdesk .fs-stage>*{position:relative!important;width:100%!important;height:100%!important;background:transparent!important;border:none!important;box-shadow:none!important;padding:0!important;margin:0!important}
`;

/* ---------- AppHead (real ticker in marquee slot) ---------- */
function AppHead({ page, status, zmqOk, strikes, ticker, now, onOpenSettings }){
  const statusTxt = page===1?_tt('Vitals'):page===2?_tt('Pool Internals'):page===3?_tt('Luck & Analytics'):_tt(status);
  const zmqTxt = page===1?'node':page===2?'ckpool':page===3?'stats':`ZMQ ${zmqOk?'●':'○'}`;
  return (
    <div className="apphead">
      <div className="ah-left">
        <img className="ah-pick" src="/pickaxe-icon.png" alt="⛏" draggable={false}/>
        <span className="ah-wordmark">SoloStrike</span><span className="ah-div"/>
        <span className="ah-status">{statusTxt}</span>
        <span className="ah-zmq">{zmqTxt}</span>
        <span className="ah-strikes">{page===0?<>{_tt('STRIKES')} <b>{strikes}</b></>:<>{_tt('PAGE')} <b>{page+1} / 4</b></>}</span>
      </div>
      <div className="ah-mq">{ticker}</div>
      <div className="ah-right">
        <div className="ah-clock"><span className="lv">{_tt('LIVE')}</span><span className="tm">{now.toLocaleTimeString('en-US',{hour12:false})}</span></div>
        <button className="ah-gear" title="Settings" onClick={onOpenSettings}>⚙</button>
      </div>
    </div>
  );
}

/* ---------- Crew tile grid (real workers) ---------- */
function Crew({ workers, aliases, displayName, onWorkerClick }){
  const list=(workers||[]).slice(0,60);
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
            <div className="tele"><div className={tcls}><b>{tC!=null?tC+'°':'—'}</b>{_tt('temp')}</div><div><b>{fan}</b>{_tt('fan')}</div><div><b>{fw}</b>{_tt('fw')}</div><div><b>{acc}</b>{_tt('acc')}</div></div>
            <div className="uptime" title={`Uptime over last 24h · ${samples.length}/${SLOTS} samples`}>{Array.from({length:SLOTS}).map((_,j)=>{const isPh=j<ph;const s=isPh?null:samples[j-ph];const cls=isPh?'':(s&&s.status==='online'?'on':'dn');return <i key={j} className={cls}/>;})}</div>
          </div>
        );
      })}
      {list.length===0 && <div style={{gridColumn:'1/-1',display:'flex',alignItems:'center',justifyContent:'center',color:'var(--text-3)',fontFamily:'var(--fd)',fontSize:'.6rem'}}>{_tt('No miners connected yet.')}</div>}
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
  const COLS=[['name',_tt('Worker')],['hashrate',_tt('Hashrate')],['asic','ASIC °C'],['vr','VR °C'],['fan','Fan RPM'],['boards',_tt('Boards (°C)')],['best',_tt('Best Ever')],['diff',_tt('Last Diff')],['fw',_tt('Firmware')],['up',_tt('Uptime')]];
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
          {sorted.length===0 && <tr><td colSpan={10} style={{textAlign:'center',color:'var(--text-3)',padding:18}}>{_tt('No miners connected yet.')}</td></tr>}
        </tbody>
        {sorted.length>0 && <tfoot><tr>
          <td><b>FLEET</b></td><td><b>{fmtTH(totHr)} T</b></td>
          <td colSpan={2}>{avgT!=null?<>avg <b>{avgT}°</b> · max <b className={maxT>=70?'cell-hot':''}>{maxT}°</b></>:'—'}</td>
          <td colSpan={2}>{live.length}/{rows.length} online</td>
          <td colSpan={4}>{_tt('tap any rig for full single-rig telemetry')} →</td>
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
  const idle=pool?.idle||0, disc=pool?.disconnected||0; const real=active+idle+disc;
  const total=real||1;
  const segs=[['Active',active,'var(--green)'],['Idle',idle,'var(--amber)'],['Disconnected',disc,'var(--red)']];
  let acc=0; const stops=real>0?segs.map(([,n,c])=>{const s=(acc/total)*100;acc+=n;const e=(acc/total)*100;return `${c} ${s}% ${e}%`;}).join(', '):`var(--bg-deep) 0% 100%`;
  return (
    <div className="donutwrap">
      <div className="donut-cg">
        <div className="donut-ring" style={{background:`conic-gradient(${stops})`}}/>
        <div className="donut-hole"><span className="dn-tot">{real}</span><span className="dn-lbl">workers</span></div>
      </div>
      <div className="donutlegend">
        <div className="dlg"><span className="sw" style={{background:'var(--green)'}}/>{_tt('Active')} <b>{active}</b></div>
        <div className="dlg"><span className="sw" style={{background:'var(--amber)'}}/>{_tt('Idle')} <b>{idle}</b></div>
        <div className="dlg"><span className="sw" style={{background:'var(--red)'}}/>{_tt('Disconnected')} <b>{disc}</b></div>
      </div>
    </div>
  );
}

let _tt = (s)=>s; // set each render by DesktopPages so DL labels translate
const DL=(k,v,cls)=> <div className="dl"><span className="k">{_tt(k)}</span><span className={`v ${cls||''}`}>{v}</span></div>;

/* ============================ MAIN ============================ */
export default function DesktopPages({
  cardComponents = {}, poolState, workers = [], aliases = {}, displayName,
  stratumHealth, ticker = null, onOpenSettings, openModal, onWorkerClick,
  status = 'Mining Live', zmq = null, strikes = 0, lang = 'en',
}){
  const tt = useMemo(()=>makeTT(lang),[lang]);
  _tt = tt;
  const narrow=useIsNarrow();
  const now=useNow();
  const [page,setPage]=useState(0);
  const [dotsVisible,setDotsVisible]=useState(true);
  const dotsTimer=useRef(null);
  const pokeDots=useCallback(()=>{ setDotsVisible(true); clearTimeout(dotsTimer.current); dotsTimer.current=setTimeout(()=>setDotsVisible(false),2500); },[]);
  const [fsCard,setFsCard]=useState(null); // 'pulse' | 'hunt' | null — fullscreen overlay
  const [svRange,setSvRange]=useState('1H'); // strike-velocity window
  const [fpTrend,setFpTrend]=useState('live'); // firepower trend window
  const NP=4;
  const startX=useRef(null);
  const fitRef=useRef(null);
  const scalerRef=useRef(null);
  const go=useCallback(p=>{setPage(Math.max(0,Math.min(NP-1,p)));},[]);
  const M=(name)=>()=>openModal&&openModal(name);

  useEffect(()=>{ pokeDots(); return ()=>clearTimeout(dotsTimer.current); },[page,pokeDots]);
  useEffect(()=>{ const on=e=>{if(e.key==='ArrowRight')go(page+1);if(e.key==='ArrowLeft')go(page-1);}; window.addEventListener('keydown',on); return()=>window.removeEventListener('keydown',on); },[page,go]);
  useEffect(()=>{ const el=document.getElementById('ssdesk-css'); if(el)el.remove(); const s=document.createElement('style');s.id='ssdesk-css';s.textContent=CSS;document.head.appendChild(s); },[]);
  useEffect(()=>{
    const fit=()=>{ const sc=scalerRef.current; if(sc) sc.style.transform=''; };
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

  // firepower chart — mirror production HashrateChart: the 7D range pulls from
  // a SEPARATE weekly series (hr.week); shorter ranges time-filter hr.history
  // (which only holds recent samples). Using history for 7D = flat/empty chart.
  const hrHistFull=(Array.isArray(hr.history)?hr.history:[]).filter(h=>h&&Number.isFinite(h.hr));
  const hrWeek=(Array.isArray(hr.week)?hr.week:[]).filter(h=>h&&Number.isFinite(h.hr));
  const FP_WIN_MS={'live':null,'1H':3600e3,'24H':24*3600e3,'7D':7*24*3600e3};
  const fpCut=FP_WIN_MS[fpTrend];
  const fpSource=fpTrend==='7D'?(hrWeek.length?hrWeek:hrHistFull):hrHistFull;
  const hrHistW=(fpCut==null)?fpSource:(()=>{const now=Date.now();const w=fpSource.filter(h=>h.ts&&(now-h.ts)<=fpCut);return w.length>=2?w:fpSource;})();
  const hrHist=hrHistW.map(h=>h.hr).filter(Number.isFinite);
  const fp=linePath(hrHist);
  const avgW=[['1M','hr1m'],['5M','hr5m'],['15M','hr15m'],['1H','hr1h'],['6H','hr6h'],['24H','hr1d'],['7D','hr7d']];
  const wmax=Math.max(cur,...Object.values(windows).filter(Number.isFinite),1);

  // strike velocity — window spsHistory by the selected range pill (1H/6H/24H).
  const sps=shares.sps1m||0;
  const spsFull=(Array.isArray(shares.spsHistory)?shares.spsHistory:[]).filter(p=>p&&Number.isFinite(p.sps));
  const SV_WIN_MS={'1H':3600e3,'6H':6*3600e3,'24H':24*3600e3};
  const svCut=SV_WIN_MS[svRange]||3600e3;
  const spsWindowed=(()=>{const now=Date.now();const w=spsFull.filter(p=>p.ts&&(now-p.ts)<=svCut);return w.length?w:spsFull;})();
  const spsHist=spsWindowed.slice(-96);
  const spsMax=Math.max(...spsHist.map(p=>p.sps||0),1);
  // v1.12.x: match production mobile SV readouts — median (for coloring +
  // footer), per-bar anomaly color, and "each bar = N min".
  const svSorted=spsHist.map(p=>p.sps||0).filter(v=>v>0).sort((a,b)=>a-b);
  const svMedian=svSorted.length?svSorted[Math.floor(svSorted.length/2)]:(sps||0);
  const svBarMin={'1H':1,'6H':4,'24H':11}[svRange]||1;
  const svColor=v=>{ if(v<=0)return 'var(--red)'; if(svMedian<=0)return 'var(--amber)'; if(v>svMedian*1.5||v<svMedian*0.5)return 'var(--amber)'; return 'var(--green)'; };
  const svFmt=v=>v>0?(v>=1?v.toFixed(1)+'/s':(v*60).toFixed(1)+'/m'):'—';

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
        <div className={`pages${page===1?' p2':page===2?' p3':page===3?' p4':''}`}>

          {/* ============ PAGE 1 — LIVE ============ */}
          <div className="viewport">
            <AppHead page={0} status={status} zmqOk={zmqOk} strikes={snap.totalStrikes??strikes??0} ticker={page===0?ticker:null} now={now} onOpenSettings={onOpenSettings}/>

            {/* BAND 1 */}
            <div className="band b-charts">
              <div className="panel">
                <div className="zlabel zlabel-row">{tt('Firepower')} — {fpTrend==='live'?'Live':fpTrend.toUpperCase()}<div className="fp-seg">{['live','1H','24H','7D'].map(r=><span key={r} className={fpTrend===r?'on':''} onClick={()=>setFpTrend(r)}>{r==='live'?'LIVE':r}</span>)}</div></div>
                <div className="fp">
                  <div className="fp-top"><span className="fp-num goldnum">{fmtTH(fpTrend==='live'?cur:(windows[avgKeyFor(fpTrend)]??cur))}<span className="unit" style={{fontSize:'.5em'}}> TH/s</span></span><span className="fp-peak">PEAK {fmtTH(peak)} · LIVE {liveW}/{totW}</span></div>
                  <div className="fp-chart"><svg viewBox="0 0 400 70" preserveAspectRatio="none">{fp&&<><defs><linearGradient id="hrG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--amber)" stopOpacity="0.28"/><stop offset="95%" stopColor="var(--amber)" stopOpacity="0.02"/></linearGradient></defs><path d={fp.fill} fill="url(#hrG)"/><path d={fp.ln} fill="none" stroke="var(--amber)" strokeWidth="2"/></>}</svg></div>
                </div>
              </div>
              <div className="panel">
                <div className="zlabel zlabel-row">{tt('Strike Velocity')}{spsHist.length>0&&<span className="sv-samples">{spsHist.length} {_tt('samples')}</span>}</div>
                <div className="sv">
                  <div className="sv-top"><span className="sv-num">{sps>=1000?(sps/1000).toFixed(2)+'k':sps.toFixed(1)}<span className="unit" style={{fontSize:'.42em'}}> shares/s</span></span><div className="sv-rng">{['1H','6H','24H'].map(r=><span key={r} className={svRange===r?'on':''} onClick={()=>setSvRange(r)}>{r}</span>)}</div></div>
                  {spsHist.length===0
                    ? <div className="sv-empty">{cur>0?'COLLECTING SAMPLES…':'NO MINERS'}</div>
                    : <div className="sv-hist">{spsHist.map((p,i)=><i key={i} title={svFmt(p.sps||0)} style={{height:`${Math.max(3,((p.sps||0)/spsMax)*100)}%`,background:svColor(p.sps||0)}}/>)}</div>}
                  <div className="sv-leg"><span>each bar = {svBarMin} min</span><span><b style={{background:'var(--green)'}}/>{_tt('normal')}</span><span><b style={{background:'var(--amber)'}}/>{_tt('anomaly')}</span><span><b style={{background:'var(--red)'}}/>{_tt('offline')}</span><span className="sv-median">median ≈ {svFmt(svMedian)}</span></div>
                </div>
              </div>
            </div>

            {/* BAND 2 — Pulse (REAL globe) · Hunt (REAL) · Crew */}
            <div className="band b-feat">
              <div className="panel">
                <div className="zlabel zlabel-row">{tt('Pulse')}<button className="expand-btn" title="Expand globe" onClick={()=>setFsCard('pulse')}>⤢</button></div>
                <div className="body">
                  <div className="slot-globe">{fsCard==='pulse'?null:cardComponents['pulse']||null}</div>
                  <div className="pulse-read">
                    <div className="pr"><div className="prl">{_tt('Strikers')}</div><div className="prv">{ns.peers?.length??ns.strikers??'—'}</div></div>
                    <div className="pr"><div className="prl">{_tt('Net Pulse')}</div><div className="prv">{ns.networkHashrate?hrShort(ns.networkHashrate):(net.hashrate?hrShort(net.hashrate):'—')}</div></div>
                    <div className="pr"><div className="prl">{_tt('Your Pin')}</div><div className="prv" style={{color:'var(--cyan)',fontSize:'.58rem'}}>{poolState?.poolPin?_tt('PINNED'):'—'}</div></div>
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="zlabel zlabel-row">{tt('The Hunt')}<button className="expand-btn" title="Expand Hunt" onClick={()=>setFsCard('hunt')}>⤢</button></div>
                <div className="body">
                  <div className="slot-hunt">{fsCard==='hunt'?null:cardComponents['hunt']||null}</div>
                  <div className="hunt-face">
                    <div className="hf-reward"><span className="lbl">{_tt('Block Reward')}</span><span className="goldnum" style={{fontFamily:'var(--fd)',fontSize:'.98rem',fontWeight:800}}>{reward.totalBtc!=null?reward.totalBtc.toFixed(4):'—'}<span className="unit" style={{fontSize:'.6em'}}> BTC</span></span></div>
                    <div className="hf-sub">{_tt('subsidy')} <b>{reward.subsidy??'—'}</b> · {_tt('fees')} <span className="fee">{reward.feesBtc!=null?'+'+reward.feesBtc.toFixed(4):(reward.totalBtc!=null&&reward.subsidy!=null?'+'+(reward.totalBtc-reward.subsidy).toFixed(4):'—')}</span></div>
                    <div className="hf-fees"><div className="ft"><div className="ftl fast">⚡{_tt('Fast')}</div><div className="ftv">{mp.feeFast??'—'}</div><div className="ftu">sat/vB</div></div><div className="ft"><div className="ftl mid">◐{_tt('Mid')}</div><div className="ftv">{mp.feeMid??'—'}</div><div className="ftu">sat/vB</div></div><div className="ft"><div className="ftl low">◯{_tt('Low')}</div><div className="ftv">{mp.feeLow??'—'}</div><div className="ftu">sat/vB</div></div></div>
                    <div className="hf-odds"><div className="o"><div className="ol">{_tt('Yearly')}</div><div className="ov">{odds.yearly!=null?(odds.yearly*100).toFixed(2)+'%':'—'}</div></div><div className="o"><div className="ol">{_tt('Daily')}</div><div className="ov">{odds.daily!=null?(odds.daily*100).toFixed(3)+'%':'—'}</div></div><div className="o"><div className="ol">{_tt('Sats/d')}</div><div className="ov">{odds.satsPerDay??'—'}</div></div></div>
                  </div>
                </div>
              </div>
              <div className="panel">
                <div className="zlabel">{tt('The Crew · live telemetry')} · {liveW}/{totW}</div>
                <Crew workers={workers} aliases={aliases} displayName={displayName} onWorkerClick={onWorkerClick}/>
              </div>
            </div>
          </div>

          {/* ============ PAGE 2 — VITALS ============ */}
          <div className="viewport vitals">
            <AppHead page={1} status={status} zmqOk={zmqOk} ticker={page===1?ticker:null} now={now} onOpenSettings={onOpenSettings}/>

            {/* BAND 3 — 7 data cols (Stratum removed — ports live in the footer) */}
            <div className="band b-data b-data-7">
              <div className="col"><div className="ch">{tt('Bitcoin Network')}</div>{DL(_tt('Difficulty'),net.difficulty?hrShort(net.difficulty):'—')}{DL(_tt('Hashrate'),net.hashrate?hrShort(net.hashrate):'—')}{DL(_tt('Mempool'),mp.count!=null?fmtNum(mp.count):'—')}{DL(_tt('Retarget'),retarget.difficultyChange!=null?(retarget.difficultyChange>=0?'+':'')+retarget.difficultyChange.toFixed(1)+'%':'—',retarget.difficultyChange>=0?'red':'green')}</div>
              <div className="col"><div className="ch">{tt('Bitcoin Node')}</div>{DL(_tt('Status'),poolState?.nodeInfo?.connected?'LIVE':'—',poolState?.nodeInfo?.connected?'green':'')}{DL(_tt('Height'),net.height!=null?fmtNum(net.height):'—')}{DL(_tt('Peers'),poolState?.nodeInfo?.peers!=null?fmtNum(poolState.nodeInfo.peers):'—')}{DL(_tt('ZMQ'),zmqOk?'● sync':'○',zmqOk?'green':'')}</div>
              <div className="col"><div className="ch">{tt('Strikes')}</div>{DL(_tt('Closest'),cc[0]?.pct!=null?cc[0].pct.toFixed(4)+'%':'—','cyan')}{DL(_tt('Workers'),`${liveW}/${totW}`)}{DL(_tt('Solo 30d'),snap.soloBlocks30d??'—','amber')}{DL(_tt('Yours'),snap.totalStrikes??0,'amber')}</div>
              <div className="col"><div className="ch">{tt('Near Strikes')}</div>{cc.length?(()=>{const netDiff=net.difficulty>0?net.difficulty:null;const top=Math.max(...cc.slice(0,4).map(c=>c.diff||0),1);return cc.slice(0,4).map((c,i)=>{const pct=netDiff?(c.diff/netDiff)*100:null;const w=Math.max(5,Math.min(100,((c.diff||0)/top)*100));const nm=((displayName?displayName(c.workerName,aliases):c.workerName)||'—').slice(0,7);return <div className="dbar" key={i}><span className="dnm">{nm}</span><span className="dtrack"><i className={i===0?'hot':''} style={{width:w+'%'}}/></span><span className="dval">{pct!=null?pct.toFixed(3)+'%':hrShort(c.diff)}</span></div>;});})():<div style={{fontSize:'.58rem',color:'var(--text-3)'}}>{_tt('No near-misses yet.')}</div>}</div>
              <div className="col"><div className="ch">{tt('Top Miners')}</div>{topMiners.length?(()=>{const top=Math.max(...topMiners.map(w=>w.bestshare||0),1);return <>{topMiners.map((w,i)=>{const bw=Math.max(6,Math.min(100,((w.bestshare||0)/top)*100));const nm=(i+1)+'·'+((displayName?displayName(w.name,aliases):w.name)||'—').slice(0,6);return <div className="dbar" key={i}><span className="dnm">{nm}</span><span className="dtrack"><i className={i===0?'hot':''} style={{width:bw+'%'}}/></span><span className="dval">{hrShort(w.bestshare)}</span></div>;})}{DL(_tt('Pool best'),poolState?.bestshare?hrShort(poolState.bestshare):'—')}</>;})():<div style={{fontSize:'.58rem',color:'var(--text-3)'}}>{_tt('No shares submitted yet.')}</div>}</div>
              <div className="col"><div className="ch">{tt('Claim Jumpers')}</div>{(()=>{const tf=Array.isArray(poolState?.topFinders)?poolState.topFinders:[];if(!tf.length)return <div style={{fontSize:'.58rem',color:'var(--text-3)'}}>{_tt('Awaiting block data…')}</div>;const top=Math.max(...tf.slice(0,8).map(x=>x.count||0),1);return <>{tf.slice(0,8).map((f,i)=>{const w=Math.max(8,((f.count||0)/top)*100);return <div className="dbar" key={i}><span className="dnm">{(f.name||'—').slice(0,8)}{f.isSolo&&<span className="solo">SOLO</span>}</span><span className="dtrack"><i className={f.isSolo?'hot':''} style={{width:w+'%'}}/></span><span className="dval">{f.count??0}</span></div>;})}</>;})()}</div>
              <div className="col clk" onClick={M('Share Stats')}><div className="ch">{tt('Share Stats')}</div>{DL(_tt('Total'),shares.acceptedCount?(shares.acceptedCount/1e6).toFixed(1)+' M':'—')}{DL(_tt('Best'),poolState?.bestshare?hrShort(poolState.bestshare):'—','amber')}{DL(_tt('Accept'),acc,'green')}{DL(_tt('Reject'),rej)}{(()=>{const a=shares.acceptedCount||0;const r=(shares.rejectedCount||0)+(shares.stale||0);const tot=a+r;const ap=tot>0?(a/tot)*100:100;return <div className="accbar" title={`Accept ${ap.toFixed(2)}%`}><i className="acc" style={{width:ap+'%'}}/><i className="rej" style={{width:(100-ap)+'%'}}/></div>;})()}</div>
            </div>

            {/* BAND 4 — ledger (+ pool tally) + health (+ detail) */}
            <div className="band" style={{gridTemplateColumns:'2.2fr 1.2fr',borderTop:'1px solid var(--hair)',paddingTop:8}}>
              <div className="col" style={{paddingLeft:0,borderLeft:0,display:'flex',flexDirection:'column'}}><div className="ch">{tt('The Ledger — Recent Blocks')}</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(6,1fr)',gap:'2px 14px'}}>
                  {blocks.slice(0,12).map((b,i)=>{const who=(b.miner||b.pool||'—').toString();return <div className="dl" key={i} style={{border:0}}><span className="k"><span className="lchip" style={{background:poolColor(who)}}/>{fmtNum(b.height)}</span><span className="v">{who.slice(0,10)}</span></div>;})}
                  {blocks.length===0&&<div className="dl" style={{border:0}}><span className="k">—</span><span className="v">waiting</span></div>}
                </div>
                {/* pool tally — who's claiming the last N blocks, as a stacked share bar */}
                {blocks.length>0&&(()=>{const tally={};blocks.slice(0,20).forEach(b=>{const who=(b.miner||b.pool||'—').toString().slice(0,12);tally[who]=(tally[who]||0)+1;});const entries=Object.entries(tally).sort((a,b)=>b[1]-a[1]).slice(0,6);const total=entries.reduce((s,[,n])=>s+n,0)||1;return <div style={{marginTop:'auto',paddingTop:8}}><div style={{fontSize:'.46rem',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--text-3)',marginBottom:5}}>Last {Math.min(20,blocks.length)} blocks · pool share</div><div style={{display:'flex',height:9,borderRadius:5,overflow:'hidden',background:'var(--bg-deep)'}}>{entries.map(([who,n],i)=><div key={i} title={`${who} · ${n}`} style={{width:`${(n/total)*100}%`,background:poolColor(who)}}/>)}</div><div style={{display:'flex',flexWrap:'wrap',gap:'2px 12px',marginTop:6}}>{entries.map(([who,n],i)=><span key={i} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:'.5rem',color:'var(--text-2)'}}><span className="lchip" style={{background:poolColor(who),marginRight:0}}/>{who} <b style={{color:'var(--text-1)'}}>{n}</b></span>)}</div></div>;})()}
              </div>
              <div className="col clk" onClick={M('System Health')} style={{display:'flex',flexDirection:'column'}}><div className="ch">{tt('System Health')}</div>
                <div className="status" style={{marginBottom:10}}>{healthItems.map(([l,ok],i)=><div className={`st${ok?'':' bad'}`} key={i}><span className="dot"/>{l}</div>)}</div>
                {/* fill the box with real service detail rows */}
                <div style={{marginTop:6,display:'flex',flexDirection:'column'}}>
                  {DL(_tt('Pool uptime'),poolState?.pool?.runtimeSec?fmtUptime(poolState.pool.runtimeSec):'—','green')}
                  {DL(_tt('Node height'),net.height!=null?fmtNum(net.height):'—')}
                  {DL(_tt('Node peers'),poolState?.nodeInfo?.peers!=null?`${fmtNum(poolState.nodeInfo.peers)}${poolState?.nodeInfo?.peersOut!=null?` (${poolState.nodeInfo.peersIn||0}↓ ${poolState.nodeInfo.peersOut||0}↑)`:''}`:'—')}
                  {DL(_tt('TLS :4333'),H.ports&&H.ports['4333']?.status==='healthy'?'● secure':(H.tls!==false?'● up':'○'),H.ports&&H.ports['4333']?.status==='healthy'?'green':'')}
                  {DL(_tt('ZMQ'),zmqOk?'● synced':'○',zmqOk?'green':'red')}
                  {DL(_tt('Workers live'),`${liveW}/${totW}`,liveW>0?'green':'')}
                </div>
                <div style={{marginTop:'auto',paddingTop:8,fontSize:'.5rem',color:'var(--text-3)',letterSpacing:'.06em'}}>{_tt('Tap for full diagnostics')} ▸</div>
              </div>
            </div>
          </div>

          {/* ============ PAGE 3 — POOL INTERNALS ============ */}
          <div className="viewport p2">
            <AppHead page={2} zmqOk={zmqOk} ticker={page===2?ticker:null} now={now} onOpenSettings={onOpenSettings}/>
            <div className="band" style={{gridTemplateColumns:'1.5fr 1fr 1fr',minHeight:0}}>
              <div className="panel"><div className="zlabel">{tt('Hashrate Windows — % of Pool Peak')}</div><Gauges windows={windows} pct={wpct}/></div>
              <div className="panel"><div className="zlabel">{tt('Shares / Second — Windows')}</div>
                <div className="spswins">{[['1M','sps1m'],['5M','sps5m'],['15M','sps15m'],['1H','sps1h']].map(([l,k])=>{const v=pool.spsWindows?.[k]||0;const mx=Math.max(...Object.values(pool.spsWindows||{}).filter(Number.isFinite),1);return <div className="spsrow" key={k}><span className="sl">{l}</span><span className="sbar"><i style={{width:`${Math.min(100,(v/mx)*100)}%`}}/></span><span className="sv">{v>=1000?(v/1000).toFixed(2)+'k':v.toFixed(1)} sh/s</span></div>;})}</div>
              </div>
              <div className="panel"><div className="zlabel">{tt('Connection States')}</div><Donut pool={pool}/></div>
            </div>
            <div className="panel" style={{minHeight:0}}>
              <div className="zlabel">{tt('Fleet Comparison — All Rigs at a Glance')} <span style={{color:'var(--text-3)',fontSize:'.85em'}}>{_tt('(scan side-by-side · tap a rig for one-rig depth)')}</span></div>
              <FleetTable workers={workers} aliases={aliases} displayName={displayName} onWorkerClick={onWorkerClick}/>
            </div>
            <div className="band b-data" style={{gridTemplateColumns:'1fr 1fr 1fr 1fr',minHeight:0,alignSelf:'end'}}>
              <div className="col" style={{paddingLeft:0,borderLeft:0}}><div className="ch">{tt('General Info')}</div>{DL(_tt('Pool runtime'),pool.runtimeSec?fmtUptime(pool.runtimeSec):'—')}{DL(_tt('Workers'),`${liveW}/${totW}`)}{DL(_tt('Accept'),acc,'cyan')}{DL(_tt('ckpool'),'solo 2.x')}</div>
              <div className="col"><div className="ch">{tt('Shares Since Last Block')}</div>{DL(_tt('Accepted'),shares.acceptedCount?(shares.acceptedCount/1e6).toFixed(2)+' M':'—','green')}{DL(_tt('Rejected'),fmtNum(shares.rejectedCount))}{DL(_tt('Accept'),acc,'cyan')}{DL(_tt('Reject'),rej)}</div>
              <div className="col"><div className="ch">{tt('Best Share — Trend')}</div><TsLine data={(()=>{const a=Array.isArray(shares.bestHistory)?shares.bestHistory:(Array.isArray(shares.bestHistoryTail)?shares.bestHistoryTail:[]);return a.map(b=>b.best).filter(Number.isFinite);})()} color="var(--chart1)" fmt={v=>hrShort(v)}/></div>
              <div className="col"><div className="ch">{tt('Users + Workers History')}</div><TsLine data={(()=>{const a=Array.isArray(pool.workersHistory)?pool.workersHistory:(Array.isArray(pool.workersHistoryTail)?pool.workersHistoryTail:[]);return a.map(p=>p.workers).filter(Number.isFinite);})()} color="var(--chart2)" fmt={v=>Math.round(v)} unit="wkrs"/></div>
            </div>
          </div>

          {/* ============ PAGE 4 — LUCK & ANALYTICS ============ */}
          <div className="viewport p3">
            <AppHead page={3} zmqOk={zmqOk} ticker={page===3?ticker:null} now={now} onOpenSettings={onOpenSettings}/>
            <div className="band" style={{gridTemplateColumns:'1.7fr 1fr',minHeight:0}}>
              <div className="panel"><div className="zlabel">{tt('Block Effort / Luck — per strike')} <span style={{color:'var(--text-3)',fontSize:'.85em'}}>(shares-to-find vs expected · &lt;100% = lucky)</span></div>
                <div className="effortwrap">{(()=>{const rounds=Array.isArray(snap.blockEffort)?snap.blockEffort.slice(-6):[];const arr=[...Array(Math.max(0,6-rounds.length)).fill(null),...rounds];arr.push(snap.openEffortPct??null);const col=p=>p==null?'var(--bg-raised)':p<100?'var(--green)':p<=200?'var(--amber)':'var(--red)';return arr.slice(0,7).map((p,i)=>{const h=p==null?14:Math.min(100,(p/250)*100);return <div className="ebar" key={i}><div className="pct" style={{color:col(p)}}>{p==null?'':Math.round(p)+'%'}</div><div className="col2" style={{height:`${h}%`,background:col(p)}}/><div className="lab">{i===6?'NOW':'—'}</div></div>;});})()}</div>
                {(!snap.blockEffort||!snap.blockEffort.length)&&<div className="effort-note">No blocks found yet — history fills in as you strike. The NOW bar shows the current open round's effort.</div>}
              </div>
              <div className="panel"><div className="zlabel">{tt('Hashrate Stability')}</div>
                <div style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:10,flex:1}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:10}}><span className="goldnum" style={{fontFamily:'var(--fd)',fontSize:'2rem',fontWeight:700}}>{hr.stabilityPct!=null?hr.stabilityPct.toFixed(1):'—'}<span className="unit" style={{fontSize:'.4em'}}> %</span></span><span style={{fontSize:'.62rem',color:'var(--text-2)'}}>{_tt('consistency (7d)')}</span></div>
                  <TsLine data={hrHist} color="var(--chart1)" H={80} fmt={v=>fmtTH(v)+'T'}/>
                  <div style={{display:'flex'}}>
                    <div style={{flex:1,textAlign:'center',borderRight:'1px solid var(--hair)'}}><div style={{fontFamily:'var(--fd)',fontSize:'.5rem',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'.1em'}}>{_tt('Std Dev')}</div><div style={{fontFamily:'var(--fd)',fontSize:'.8rem',fontWeight:700,color:'var(--amber)'}}>{hr.stdDev!=null?'±'+fmtTH(hr.stdDev)+' T':'—'}</div></div>
                    <div style={{flex:1,textAlign:'center',borderRight:'1px solid var(--hair)'}}><div style={{fontFamily:'var(--fd)',fontSize:'.5rem',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'.1em'}}>{_tt('Min / Max')}</div><div style={{fontFamily:'var(--fd)',fontSize:'.8rem',fontWeight:700,color:'var(--text-1)'}}>{hrHist.length?fmtTH(Math.min(...hrHist))+' / '+fmtTH(Math.max(...hrHist))+' T':'—'}</div></div>
                    <div style={{flex:1,textAlign:'center'}}><div style={{fontFamily:'var(--fd)',fontSize:'.5rem',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'.1em'}}>{_tt('Dips 24h')}</div><div style={{fontFamily:'var(--fd)',fontSize:'.8rem',fontWeight:700,color:'var(--red)'}}>{hr.dips24h??'—'}</div></div>
                  </div>
                </div>
              </div>
            </div>
            <div className="band" style={{gridTemplateColumns:'1fr 1fr 1fr',minHeight:0}}>
              <div className="panel"><div className="zlabel">{tt('Reject Reasons — Trend (24h)')}</div>
                <div className="rejtrend">{(()=>{const rr=shares.rejectReasons||{};const ent=Object.entries(rr).sort((a,b)=>b[1]-a[1]).slice(0,3);const tot=ent.reduce((s,[,n])=>s+n,0)||1;const cols=['var(--amber)','var(--cyan)','var(--text-2)'];return ent.length?<>{ent.map(([n,c],i)=>{const p=Math.round((c/tot)*100);return <div className="rejrow" key={n}><span className="rl">{n}</span><span className="rbar"><i style={{width:p+'%',background:cols[i]}}/></span><span className="rv">{p}%</span></div>;})}<div style={{fontSize:'.54rem',color:'var(--text-3)',marginTop:2}}>of {fmtNum(shares.rejectedCount)} rejected shares · last 24h</div></>:<div style={{fontSize:'.6rem',color:'var(--text-3)'}}>No rejected shares recorded.</div>;})()}</div>
              </div>
              <div className="panel"><div className="zlabel">{tt('Your Edge — Network Position')}</div>
                <div style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:11,flex:1}}>
                  <div style={{textAlign:'center'}}><div style={{fontFamily:'var(--fd)',fontSize:'1.5rem',fontWeight:700,color:'var(--amber)',lineHeight:1}}>{odds.perBlock!=null&&odds.perBlock>0?'1 in '+fmtNum(Math.round(1/odds.perBlock)):'—'}</div><div style={{fontSize:'.52rem',letterSpacing:'.15em',textTransform:'uppercase',color:'var(--text-2)',marginTop:3}}>{_tt('per-block odds')}</div></div>
                  {(()=>{const poolHr=cur||0;const netHr=net.hashrate||0;const share=netHr>0?(poolHr*1e12/netHr)*100:null;return <>
                    <div><div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'.52rem',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:3}}><span>{_tt('Your share of network')}</span><span style={{color:'var(--cyan)'}}>{share!=null?(share<0.0001?share.toExponential(2):share.toFixed(6))+'%':'—'}</span></div><div style={{height:3,background:'var(--bg-deep)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.max(0.5,Math.min(100,(share||0)*1e6))}%`,background:'var(--cyan)',boxShadow:'0 0 8px rgba(0,255,209,0.5)'}}/></div></div>
                    <div style={{display:'flex'}}>
                      <div style={{flex:1,textAlign:'center',borderRight:'1px solid var(--hair)'}}><div style={{fontFamily:'var(--fd)',fontSize:'.5rem',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'.1em'}}>{_tt('Your power')}</div><div style={{fontFamily:'var(--fd)',fontSize:'.82rem',fontWeight:700,color:'var(--amber)'}}>{fmtTH(poolHr)} TH/s</div></div>
                      <div style={{flex:1,textAlign:'center'}}><div style={{fontFamily:'var(--fd)',fontSize:'.5rem',color:'var(--text-2)',textTransform:'uppercase',letterSpacing:'.1em'}}>{_tt('Expected')}</div><div style={{fontFamily:'var(--fd)',fontSize:'.82rem',fontWeight:700,color:'var(--text-1)'}}>{odds.expectedDays!=null&&odds.expectedDays>0?(odds.expectedDays>=365?(odds.expectedDays/365).toFixed(1)+' yr':Math.round(odds.expectedDays)+' d'):'—'}</div></div>
                    </div></>;})()}
                </div>
              </div>
              <div className="panel"><div className="zlabel">{tt('Difficulty Retarget')}</div>
                <div style={{display:'flex',flexDirection:'column',justifyContent:'center',gap:9,flex:1}}>
                  <div style={{textAlign:'center'}}><div style={{fontFamily:'var(--fd)',fontSize:'1.7rem',fontWeight:700,color:retarget.difficultyChange>=0?'var(--red)':'var(--green)',lineHeight:1}}>{retarget.difficultyChange!=null?(retarget.difficultyChange>=0?'+':'')+retarget.difficultyChange.toFixed(2)+'%':'—'}</div><div style={{fontSize:'.55rem',letterSpacing:'.15em',textTransform:'uppercase',color:'var(--text-2)',marginTop:3}}>{_tt('estimated change')}</div>{retarget.prevDifficultyChange!=null&&<div style={{fontFamily:'var(--fm)',fontSize:'.62rem',color:'var(--text-2)',marginTop:4}}>Last epoch: <span style={{color:retarget.prevDifficultyChange>=0?'var(--red)':'var(--green)',fontWeight:600}}>{(retarget.prevDifficultyChange>=0?'+':'')+retarget.prevDifficultyChange.toFixed(2)+'%'}</span></div>}</div>
                  {retarget.progressPercent!=null&&<div><div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'.52rem',letterSpacing:'.1em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:3}}><span>Epoch progress</span><span style={{color:'var(--cyan)'}}>{retarget.progressPercent.toFixed(1)}%</span></div><div style={{height:3,background:'var(--bg-deep)',borderRadius:2,overflow:'hidden'}}><div style={{height:'100%',width:`${Math.max(0,Math.min(100,retarget.progressPercent))}%`,background:'var(--cyan)',boxShadow:'0 0 8px rgba(0,255,209,0.5)'}}/></div></div>}
                  {retarget.remainingBlocks!=null&&<div style={{display:'flex',justifyContent:'space-between',fontSize:'.6rem',fontFamily:'var(--fm)'}}><span style={{color:'var(--text-2)'}}>Remaining Blocks <b style={{color:'var(--text-1)',fontWeight:600}}>{fmtNum(retarget.remainingBlocks)}</b></span></div>}
                  {retarget.remainingTime!=null&&retarget.remainingTime>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:'.6rem',fontFamily:'var(--fm)'}}><span style={{color:'var(--text-2)'}}>ETA</span><b style={{color:'var(--amber)',fontWeight:600}}>{fmtDurationMs(retarget.remainingTime)}</b></div>}
                </div>
              </div>
            </div>
            <div className="band b-data" style={{gridTemplateColumns:'1fr 1fr 1fr 1fr',minHeight:0,alignSelf:'end'}}>
              <div className="col" style={{paddingLeft:0,borderLeft:0}}><div className="ch">{tt('Lifetime Records')}</div>{DL(_tt('Best ever (fleet)'),poolState?.bestshare?hrShort(poolState.bestshare):'—','amber')}{DL(_tt('Best worker'),topMiners[0]?(displayName?displayName(topMiners[0].name,aliases):topMiners[0].name):'—')}{DL(_tt('Closest to block'),cc[0]?.pct!=null?cc[0].pct.toFixed(4)+'%':'—','cyan')}{DL(_tt('Peak hashrate'),fmtTH(peak)+' T')}</div>
              <div className="col"><div className="ch">{tt('Luck Summary')}</div>{DL(_tt('Avg effort'),snap.avgEffortPct!=null?Math.round(snap.avgEffortPct)+'%':'—','amber')}{DL(_tt('Blocks found'),snap.blocksFound??0)}{DL(_tt('Best round luck'),snap.bestRoundLuck!=null?Math.round(snap.bestRoundLuck)+'%':'—')}{DL(_tt('Shares this round'),shares.acceptedCount?(shares.acceptedCount/1e6).toFixed(2)+' M':'—')}</div>
              <div className="col"><div className="ch">{tt('Fleet Efficiency')}</div>{DL(_tt('Total power'),poolState?.fleet?.totalW?fmtNum(poolState.fleet.totalW)+' W':'—')}{DL(_tt('Avg J/TH'),poolState?.fleet?.avgJTH?.toFixed?.(1)??'—','amber')}{DL(_tt('Best rig J/TH'),poolState?.fleet?.bestJTH?.toFixed?.(2)??'—','green')}{DL(_tt('Cost / interval'),'power-based')}</div>
              <div className="col"><div className="ch">{tt('Reliability')}</div>{DL(_tt('Fleet uptime'),totW?((liveW/totW)*100).toFixed(1)+'%':'—','green')}{DL(_tt('Workers online'),`${liveW}/${totW}`)}{DL(_tt('Outages 7d'),poolState?.fleet?.outages7d??'—')}{DL(_tt('Pool restarts'),poolState?.fleet?.poolRestarts??'—')}</div>
            </div>
          </div>

        </div>
      </div>

      <footer className="ss-foot">
        <span className="ff-brand">SoloStrike v1.11.61 — ckpool-solo{poolState?.privateMode?' · 🔒 PRIVATE':''}</span>
        <a className="ff-gh" href="https://github.com/danhaus93-ops/solostrike-umbrel" target="_blank" rel="noopener noreferrer" title="View source on GitHub">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>
        </a>
        <span className="ff-r">Ports
          {[['3333','3333'],['3334','3334'],['4333','4333']].map(([p,lbl],i)=>{const st=H.ports&&H.ports[p]&&H.ports[p].status;const c=st==='healthy'?'var(--green)':st==='degraded'?'var(--amber)':st==='down'?'var(--red)':'var(--cyan)';const glow=st==='healthy'||st==='degraded'||st==='down';return <React.Fragment key={p}>{i>0&&(i===2?<span className="tls">TLS</span>:<span style={{opacity:.5}}> · </span>)}<b className="port" style={{color:c,textShadow:glow?`0 0 6px ${c}`:'none'}} onClick={()=>{try{navigator.clipboard.writeText(`stratum+${p==='4333'?'ssl':'tcp'}://umbrel.local:${p}`);}catch(e){}}} title={st?`Port ${p} — ${st}`:`Port ${p} — checking…`}>{lbl}</b></React.Fragment>;})}
        </span>
      </footer>

      <button className={`nav l${page===0?' hidden':''}`} onClick={()=>go(page-1)}>❮</button>
      <button className={`nav r${page===NP-1?' hidden':''}`} onClick={()=>go(page+1)}>❯</button>
      <div className={`pagedots${dotsVisible?'':' hide'}`} onMouseEnter={pokeDots}>{[0,1,2,3].map(i=><i key={i} className={i===page?'on':''} onClick={()=>go(i)}/>)}</div>

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
