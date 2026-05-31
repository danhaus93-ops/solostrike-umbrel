// ============================================================================
// SoloStrike Desktop — single-screen 3-page dashboard (v1.12.x)
// Matches the approved preview: a fixed 1280×860 viewport scaled to fit, three
// horizontally-paged screens (Live / Pool Internals / Luck & Analytics), edge
// chevrons + dots + swipe. Box-free zones, selective ⤢ drill-down into the
// EXISTING modals. Desktop/tablet only — mobile keeps the .ss-carousel system.
//
// STAGING NOTE: Page 1 (this build) is fully reproduced + wired to live data.
// Pages 2 and 3 temporarily render the existing card components stacked so no
// functionality is lost; they get rebuilt to the preview's Pool-Internals and
// Luck-&-Analytics layouts next, once Page 1 is verified on desktop.
// ============================================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';

const CSS = `
.ssdesk{--hair:rgba(var(--amber-rgb),0.14);width:100%;height:100%;font-family:var(--fm)}
.ssdesk .amber{color:var(--amber)}.ssdesk .cyan{color:var(--cyan)}.ssdesk .green{color:var(--green)}.ssdesk .red{color:var(--red)}.ssdesk .btc{color:var(--btc-orange)}.ssdesk .unit{color:var(--text-3);font-weight:400}
.ssdesk .goldnum{background:linear-gradient(180deg,var(--amber-hot) 0%,var(--amber) 50%,var(--amber-dim) 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 14px rgba(var(--amber-rgb),0.35))}
.ssdesk .goldnum .unit{-webkit-text-fill-color:var(--amber-dim);color:var(--amber-dim)}
.ssdesk .fit{position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden}
.ssdesk .scaler{width:1280px;height:860px;transform-origin:center center;flex:none;overflow:hidden;border-radius:14px}
.ssdesk .pages{display:flex;width:3840px;height:100%;transition:transform .42s cubic-bezier(.6,.02,.2,1)}
.ssdesk .pages.p2{transform:translateX(-1280px)}.ssdesk .pages.p3{transform:translateX(-2560px)}
.ssdesk .pages>.viewport{width:1280px;flex:0 0 1280px}
.ssdesk .viewport{height:860px;background:radial-gradient(1100px 600px at 72% -12%,rgba(var(--amber-rgb),0.10),transparent 60%),radial-gradient(800px 520px at -10% 112%,rgba(0,255,209,0.05),transparent 55%),var(--bg-void);border:1px solid var(--border-hot);border-radius:14px;overflow:hidden;position:relative;display:grid;grid-template-rows:auto 180px 1fr auto auto;padding:14px 20px;row-gap:10px}
.ssdesk .viewport::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.24;background-image:linear-gradient(rgba(var(--amber-rgb),0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--amber-rgb),0.05) 1px,transparent 1px);background-size:44px 44px}
.ssdesk .viewport>*{position:relative;z-index:1}
.ssdesk .apphead{display:flex;align-items:center;gap:.4rem;min-height:42px;border-bottom:1px solid var(--hair);padding-bottom:6px}
.ssdesk .ah-left{display:flex;align-items:center;gap:.5rem;flex:0 0 auto}
.ssdesk .ah-pick{font-size:16px;filter:drop-shadow(0 0 8px rgba(var(--amber-rgb),0.7));animation:ssd-pulse 3s ease-in-out infinite}
.ssdesk .ah-wordmark{font-family:var(--fd);font-size:.92rem;font-weight:700;letter-spacing:.06em;color:var(--amber);text-transform:uppercase}
.ssdesk .ah-div{width:1px;height:16px;background:rgba(var(--amber-rgb),0.2)}
.ssdesk .ah-status{font-family:var(--fd);font-size:.56rem;letter-spacing:.12em;text-transform:uppercase;color:var(--green);text-shadow:0 0 6px var(--green);animation:ssd-pulse 2s ease-in-out infinite}
.ssdesk .ah-zmq{font-family:var(--fd);font-size:.48rem;letter-spacing:.1em;text-transform:uppercase;color:var(--cyan);border:1px solid rgba(0,255,209,.3);border-radius:4px;padding:1px 5px}
.ssdesk .ah-strikes{font-family:var(--fd);font-size:.58rem;letter-spacing:.1em;color:var(--text-2)}.ssdesk .ah-strikes b{color:var(--text-1)}
.ssdesk .ah-right{display:flex;align-items:center;gap:.5rem;flex:0 0 auto;margin-left:auto}
.ssdesk .ah-clock{display:flex;flex-direction:column;align-items:flex-end;gap:0;font-family:var(--fd)}
.ssdesk .ah-clock .lv{font-size:.56rem;letter-spacing:.12em;color:var(--cyan);text-shadow:0 0 6px var(--cyan)}
.ssdesk .ah-clock .tm{font-size:.5rem;color:var(--amber);font-family:var(--fm)}
@keyframes ssd-pulse{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes ssd-flow{from{transform:translate3d(720px,0,0)}to{transform:translate3d(-100%,0,0)}}
.ssdesk .ss-marquee{position:relative;flex:1;min-width:0;max-width:720px;margin:0 auto;height:30px;overflow:hidden;background:#060305;border-top:2px solid #1a1a1a;border-bottom:2px solid #1a1a1a;box-shadow:inset 0 0 20px rgba(0,0,0,.8);border-radius:3px}
.ssdesk .ss-marquee::before,.ssdesk .ss-marquee::after{content:'';position:absolute;top:0;bottom:0;width:28px;z-index:5;pointer-events:none}
.ssdesk .ss-marquee::before{left:0;background:linear-gradient(90deg,#060305,transparent)}
.ssdesk .ss-marquee::after{right:0;background:linear-gradient(270deg,#060305,transparent)}
.ssdesk .ss-track{position:absolute;top:0;left:0;height:30px;display:flex;align-items:center;white-space:nowrap;will-change:transform;animation:ssd-flow 90s linear infinite}
.ssdesk .ss-pill{height:30px;line-height:30px;display:inline-flex;align-items:center;gap:7px;padding:0 15px;font-family:var(--fm);font-weight:700;font-size:.66rem;letter-spacing:.1em}
.ssdesk .ss-pill-lbl{color:var(--amber);letter-spacing:.16em;opacity:.8}
.ssdesk .ss-pill-val{color:var(--text-1)}.ssdesk .ss-pill-val.cyan{color:var(--cyan)}.ssdesk .ss-pill-val.green{color:var(--green)}
.ssdesk .zlabel{font-family:var(--fd);font-size:.62rem;font-weight:400;letter-spacing:.2em;text-transform:uppercase;color:var(--text-2);margin:0 0 7px;padding-bottom:.35rem;background-image:linear-gradient(90deg,rgba(var(--amber-rgb),0.55) 0%,rgba(var(--amber-rgb),0.45) 30%,rgba(var(--amber-rgb),0.12) 70%,rgba(var(--amber-rgb),0) 100%);background-repeat:no-repeat;background-size:100% 1px;background-position:bottom left}
.ssdesk .clk{cursor:pointer;border-radius:9px;transition:background .15s,box-shadow .15s;position:relative}
.ssdesk .clk:hover{background:rgba(var(--amber-rgb),0.06);box-shadow:inset 0 0 0 1px rgba(var(--amber-rgb),0.2)}
.ssdesk .clk::after{content:"⤢";position:absolute;top:4px;right:6px;font-size:.56rem;color:var(--amber);opacity:.35}.ssdesk .clk:hover::after{opacity:1}
.ssdesk .band{display:grid;gap:16px;min-height:0}
.ssdesk .b-charts{grid-template-columns:1fr 1fr;min-height:0;overflow:hidden}
.ssdesk .panel{min-height:0;display:flex;flex-direction:column;overflow:hidden}
.ssdesk .fp,.ssdesk .sv{display:flex;flex-direction:column;gap:6px;height:100%}
.ssdesk .fp-top,.ssdesk .sv-top{display:flex;align-items:baseline;justify-content:space-between}
.ssdesk .fp-num,.ssdesk .sv-num{font-family:var(--fd);font-weight:700;font-size:1.5rem;line-height:.95}
.ssdesk .sv-num{color:var(--text-1)}
.ssdesk .fp-peak{font-family:var(--fm);font-size:.52rem;color:var(--amber-dim)}
.ssdesk .fp-chart{position:relative;flex:1;min-height:40px}.ssdesk .fp-chart svg{position:absolute;inset:0;width:100%;height:100%}
.ssdesk .avgs{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.ssdesk .avg .al{font-family:var(--fd);font-size:.48rem;font-weight:700;color:var(--text-2);text-align:center;margin-bottom:2px}
.ssdesk .avg.on .al{color:var(--amber)}
.ssdesk .avg .bar{height:5px;border-radius:3px;background:var(--bg-deep);overflow:hidden}.ssdesk .avg .bar i{display:block;height:100%;background:linear-gradient(90deg,rgba(var(--amber-rgb),0.35),var(--amber))}
.ssdesk .avg .av{font-family:var(--fd);font-size:.56rem;font-weight:700;color:var(--amber);text-align:center;margin-top:2px}
.ssdesk .sv-rng{display:flex;gap:4px}.ssdesk .sv-rng span{font-family:var(--fd);font-size:.48rem;font-weight:700;padding:2px 6px;border-radius:5px;border:1px solid var(--border-hot);color:var(--text-2)}.ssdesk .sv-rng span.on{color:var(--amber);background:rgba(var(--amber-rgb),.08)}
.ssdesk .sv-hist{flex:1;min-height:40px;display:flex;align-items:flex-end;gap:2px}.ssdesk .sv-hist i{flex:1;border-radius:1px 1px 0 0;background:var(--green)}.ssdesk .sv-hist i.out{background:var(--amber)}.ssdesk .sv-hist i.down{background:var(--red)}
.ssdesk .sv-leg{display:flex;gap:10px;font-family:var(--fd);font-size:.46rem;color:var(--text-2)}.ssdesk .sv-leg b{display:inline-block;width:6px;height:6px;border-radius:2px;margin-right:3px}
.ssdesk .b-feat{grid-template-columns:218px 320px 1fr;min-height:0;overflow:hidden}
.ssdesk .body{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:0;border-radius:11px}
.ssdesk canvas{display:block;max-width:100%}
.ssdesk .pulse-read{display:flex;width:100%}.ssdesk .pulse-read .pr{flex:1;text-align:center;padding:0 5px;border-left:1px solid var(--hair)}.ssdesk .pulse-read .pr:first-child{border-left:0}
.ssdesk .pulse-read .prl{font-family:var(--fd);font-size:.44rem;letter-spacing:.1em;text-transform:uppercase;color:var(--text-2)}
.ssdesk .pulse-read .prv{font-family:var(--fd);font-size:.78rem;font-weight:700;color:var(--amber)}
.ssdesk .hunt-face{width:100%;display:flex;flex-direction:column;gap:5px}
.ssdesk .hf-reward{display:flex;align-items:baseline;justify-content:space-between}.ssdesk .hf-reward .lbl{font-family:var(--fd);font-size:.48rem;letter-spacing:.12em;text-transform:uppercase;color:var(--text-2)}
.ssdesk .hf-sub{font-family:var(--fm);font-size:.54rem;color:var(--text-2)}.ssdesk .hf-sub b{color:var(--text-1)}.ssdesk .hf-sub .fee{color:var(--cyan)}
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
.ssdesk .b-data{grid-template-columns:repeat(8,1fr);min-height:0;align-self:end}
.ssdesk .col{padding:0 12px;border-left:1px solid var(--hair);min-width:0}
.ssdesk .col:first-child{padding-left:0;border-left:0}
.ssdesk .col .ch{font-family:var(--fd);font-size:.5rem;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);margin-bottom:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ssdesk .dl{display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;font-size:.62rem;gap:4px}
.ssdesk .dl+.dl{border-top:1px solid rgba(var(--amber-rgb),0.06)}
.ssdesk .dl .k{color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ssdesk .dl .v{color:var(--text-1);font-weight:500;font-family:var(--fd);white-space:nowrap;flex-shrink:0}
.ssdesk .status{display:flex;flex-direction:column;gap:4px}.ssdesk .st{display:flex;align-items:center;gap:6px;font-size:.56rem;color:var(--text-2)}
.ssdesk .st .dot{width:6px;height:6px;border-radius:50%;background:var(--green);box-shadow:0 0 6px var(--green);flex:none}.ssdesk .st.warn .dot{background:var(--amber);box-shadow:0 0 6px var(--amber)}
.ssdesk .barrow{display:flex;align-items:center;gap:5px;padding:2px 0;font-size:.56rem}
.ssdesk .barrow .nm{color:var(--text-1);font-family:var(--fd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}
.ssdesk .barrow .ct{color:var(--amber);font-family:var(--fd);font-weight:700;flex-shrink:0}
.ssdesk .solo{font-size:.42rem;color:var(--amber);border:1px solid var(--amber);padding:0 3px;margin-left:4px}
.ssdesk .nav{position:absolute;top:50%;transform:translateY(-50%);z-index:55;width:30px;height:64px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:none;border:none;color:var(--amber);font-size:30px;line-height:1;opacity:.35;transition:opacity .18s,transform .18s;user-select:none;text-shadow:0 0 12px rgba(var(--amber-rgb),.55)}
.ssdesk .nav:hover{opacity:.95}.ssdesk .nav.l{left:10px}.ssdesk .nav.r{right:10px}.ssdesk .nav.hidden{opacity:0;pointer-events:none}
.ssdesk .pagedots{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:55;display:flex;gap:8px}
.ssdesk .pagedots i{width:8px;height:8px;border-radius:50%;background:rgba(var(--amber-rgb),.3);cursor:pointer}.ssdesk .pagedots i.on{background:var(--amber);box-shadow:0 0 8px var(--amber)}
.ssdesk .stub{padding:16px;display:flex;flex-direction:column;gap:12px;overflow:auto;height:100%}
.ssdesk .stub .stub-h{font-family:var(--fd);font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;color:var(--amber)}
`;

function fmtHr(hps) {
  if (!hps || hps <= 0) return '0';
  const u = ['H/s', 'KH/s', 'MH/s', 'GH/s', 'TH/s', 'PH/s', 'EH/s'];
  let i = 0, v = hps;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
}
function fmtHrShort(hps) {
  if (!hps || hps <= 0) return '—';
  const u = ['H', 'K', 'M', 'G', 'T', 'P', 'E'];
  let i = 0, v = hps;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)}${u[i]}`;
}
function thHps(hps) { return hps ? hps / 1e12 : 0; }

function useNow() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return t;
}
function useIsNarrow() {
  const [n, setN] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 767px)');
    const on = e => setN(e.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on); };
  }, []);
  return n;
}

function useGlobe(ref) {
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const x = c.getContext('2d'); const R = c.width / 2, cx = R, cy = R, rad = R - 5;
    const land = []; for (let i = 0; i < 7; i++) land.push({ lon: Math.random() * 360, lat: (Math.random() - 0.5) * 150, s: 12 + Math.random() * 16 });
    let rot = 0, raf;
    const d = () => {
      x.clearRect(0, 0, c.width, c.height);
      x.beginPath(); x.arc(cx, cy, rad, 0, 7); x.fillStyle = '#000'; x.fill();
      x.strokeStyle = 'rgba(245,166,35,.25)'; x.lineWidth = 1; x.stroke();
      x.strokeStyle = 'rgba(245,166,35,.1)';
      for (let k = 0; k < 3; k++) { x.beginPath(); x.ellipse(cx, cy, Math.abs(rad * Math.cos((rot * .6 + k * 60) * Math.PI / 180)), rad, 0, 0, 7); x.stroke(); }
      land.forEach(L => {
        const a = (L.lon + rot) * Math.PI / 180, px = Math.sin(a), pz = Math.cos(a); if (pz < -.1) return;
        const sx = cx + px * rad * Math.cos(L.lat * Math.PI / 180) * .92, sy = cy + (L.lat / 90) * rad * .82, sc = .5 + pz * .6;
        x.beginPath(); x.arc(sx, sy, L.s * sc, 0, 7); x.fillStyle = 'rgba(245,166,35,' + (.55 + pz * .35) + ')'; x.fill();
      });
      const pa = (40 + rot) * Math.PI / 180;
      if (Math.cos(pa) > -.1) { x.beginPath(); x.arc(cx + Math.sin(pa) * rad * .55, cy - rad * .25, 3, 0, 7); x.fillStyle = '#00FFD1'; x.shadowColor = '#00FFD1'; x.shadowBlur = 8; x.fill(); x.shadowBlur = 0; }
      rot = (rot + .35) % 360; raf = requestAnimationFrame(d);
    };
    d();
    return () => cancelAnimationFrame(raf);
  }, [ref]);
}

function useNonceField(ref) {
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const x = c.getContext('2d'); const W = c.width, H = c.height, P = [];
    for (let i = 0; i < 90; i++) P.push({ x: Math.random() * W, y: Math.random() * H, v: .6 + Math.random() * 2.2, r: .6 + Math.random() * 1.6, hit: Math.random() < .04 });
    let raf; x.fillStyle = '#060708'; x.fillRect(0, 0, W, H);
    const d = () => {
      x.fillStyle = 'rgba(6,7,8,.3)'; x.fillRect(0, 0, W, H);
      P.forEach(p => {
        p.x += p.v; if (p.x > W) { p.x = -4; p.y = Math.random() * H; p.hit = Math.random() < .04; }
        if (p.hit) { x.fillStyle = 'rgba(0,255,209,.95)'; x.shadowColor = '#00FFD1'; x.shadowBlur = 7; }
        else { x.fillStyle = 'rgba(245,166,35,' + (.25 + p.r * .3) + ')'; x.shadowBlur = 0; }
        x.beginPath(); x.arc(p.x, p.y, p.r, 0, 7); x.fill(); x.shadowBlur = 0;
      });
      raf = requestAnimationFrame(d);
    };
    d();
    return () => cancelAnimationFrame(raf);
  }, [ref]);
}

function hrPaths(history) {
  const pts = Array.isArray(history) ? history.filter(h => h && Number.isFinite(h.hashrate ?? h.value)) : [];
  if (pts.length < 2) return { line: '', fill: '' };
  const vals = pts.map(h => h.hashrate ?? h.value);
  const max = Math.max(...vals) * 1.1 || 1, min = Math.min(...vals) * 0.9;
  const span = (max - min) || 1;
  const W = 400, Hh = 70;
  const coord = (v, i) => [(i / (vals.length - 1)) * W, Hh - ((v - min) / span) * Hh];
  let line = '', fill = `M0 ${Hh} `;
  vals.forEach((v, i) => { const [px, py] = coord(v, i); line += (i ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1) + ' '; fill += 'L' + px.toFixed(1) + ' ' + py.toFixed(1) + ' '; });
  fill += `L${W} ${Hh} Z`;
  return { line: line.trim(), fill };
}

function CrewMiner({ w, name, onClick }) {
  const on = (w.hashrate || 0) > 0;
  const temp = w.live && Number.isFinite(w.live.tempC) ? `${Math.round(w.live.tempC)}°` : '—';
  const tempClass = w.live && w.live.tempC >= 75 ? 'hot' : (w.live && w.live.tempC >= 65 ? 'warm' : '');
  const fan = w.live && Number.isFinite(w.live.fanPct) ? `${Math.round(w.live.fanPct)}%` : (w.live && Number.isFinite(w.live.fanRpm) ? `${w.live.fanRpm}` : '—');
  const acc = Number.isFinite(w.acceptRate) ? `${(w.acceptRate * 100).toFixed(1)}%` : '—';
  const hist = Array.isArray(w.statusHistory) ? w.statusHistory.slice(-16) : [];
  return (
    <div className={`miner${on ? '' : ' off'}`} onClick={onClick} title={w.minerType || 'Unknown miner'}>
      <div className="top">
        <span className="dot" />
        <span className="nm">{(w.minerIcon || '▪') + ' ' + (name || w.name || '—')}</span>
        <span className="hash">{on ? fmtHrShort(w.hashrate) : 'off'}</span>
      </div>
      <div className="tele">
        <div className={tempClass}><b>{temp}</b>temp</div>
        <div><b>{fan}</b>fan</div>
        <div><b>{(w.minerType || '—').replace(/Antminer |BitAxe |Avalon /, '')}</b>type</div>
        <div><b>{acc}</b>acc</div>
      </div>
      {hist.length > 0 && (
        <div className="uptime" style={{ display: 'flex', height: 4, gap: 1, marginTop: 4 }}>
          {hist.map((h, i) => <i key={i} style={{ flex: '1 1 0', borderRadius: .5, background: h ? 'rgba(57,255,106,0.65)' : 'rgba(232,67,67,0.7)' }} />)}
        </div>
      )}
    </div>
  );
}

function PageLive({ poolState, workers, aliases, stratumHealth, displayName, onOpen, onSelectWorker }) {
  const now = useNow();
  const globeRef = useRef(null); const huntRef = useRef(null);
  useGlobe(globeRef); useNonceField(huntRef);

  const hr = poolState?.hashrate || {};
  const pool = poolState?.pool || {};
  const ns = poolState?.networkStats || {};
  const shares = poolState?.shares || {};
  const blocks = Array.isArray(poolState?.blocks) ? poolState.blocks : [];
  const cur = hr.current || 0;
  const peak = pool.hashratePeak || hr.peak || 0;
  const windows = pool.hashrateWindows || {};
  const wkeys = [['1m', '1m'], ['5m', '5m'], ['15m', '15m'], ['1h', '1h'], ['6h', '6h'], ['1d', '24h'], ['7d', '7d']];
  const wmax = Math.max(cur, ...Object.values(windows).filter(Number.isFinite), 1);
  const { line, fill } = hrPaths(hr.history);
  const liveWorkers = (workers || []).filter(w => (w.hashrate || 0) > 0).length;
  const totalWorkers = (workers || []).length;
  const sps = shares.sps1m || 0;
  const spsHist = Array.isArray(shares.spsHistory) ? shares.spsHistory.slice(-60) : [];
  const spsMax = Math.max(...spsHist.map(p => p.sps || 0), 1);

  return (
    <div className="viewport" id="page1">
      <div className="apphead">
        <div className="ah-left">
          <span className="ah-pick">⛏</span><span className="ah-wordmark">SoloStrike</span>
          <span className="ah-div" /><span className="ah-status">Mining Live</span>
          <span className="ah-zmq">ZMQ ●</span>
          <span className="ah-strikes">STRIKES <b>{poolState?.snapshots?.totalStrikes ?? 0}</b></span>
        </div>
        <div className="ss-marquee"><div className="ss-track">
          {[
            ['HASHRATE', fmtHr(cur), 'amber'], ['WORKERS', `${liveWorkers}/${totalWorkers}`, ''],
            ['SPS', `${sps.toFixed(1)}/s`, 'cyan'], ['PEAK', fmtHr(peak), ''],
            ['HASHRATE', fmtHr(cur), 'amber'], ['WORKERS', `${liveWorkers}/${totalWorkers}`, ''],
            ['SPS', `${sps.toFixed(1)}/s`, 'cyan'], ['PEAK', fmtHr(peak), ''],
          ].map((p, i) => (
            <span className="ss-pill" key={i}><span className="ss-pill-lbl">{p[0]}</span><span className={`ss-pill-val ${p[2]}`}>{p[1]}</span></span>
          ))}
        </div></div>
        <div className="ah-right"><div className="ah-clock"><span className="lv">LIVE</span><span className="tm">{now.toLocaleTimeString()}</span></div></div>
      </div>

      <div className="band b-charts">
        <div className="panel">
          <div className="zlabel">Firepower — Live</div>
          <div className="fp">
            <div className="fp-top"><span className="fp-num goldnum">{thHps(cur).toFixed(1)}<span className="unit" style={{ fontSize: '.5em' }}> TH/s</span></span><span className="fp-peak">PEAK {thHps(peak).toFixed(1)} · LIVE {liveWorkers}/{totalWorkers}</span></div>
            <div className="fp-chart"><svg viewBox="0 0 400 70" preserveAspectRatio="none"><defs><linearGradient id="hrG" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--amber)" stopOpacity="0.28" /><stop offset="95%" stopColor="var(--amber)" stopOpacity="0.02" /></linearGradient></defs><path d={fill} fill="url(#hrG)" /><path d={line} fill="none" stroke="var(--amber)" strokeWidth="2" /></svg></div>
            <div className="avgs">
              {wkeys.map(([k, lab]) => {
                const v = windows[k];
                return (
                  <div className={`avg${k === '1m' ? ' on' : ''}`} key={k}>
                    <div className="al">{lab}</div>
                    <div className="bar"><i style={{ width: `${Math.min(100, ((v || 0) / wmax) * 100)}%` }} /></div>
                    <div className="av">{Number.isFinite(v) ? thHps(v).toFixed(1) : '—'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="zlabel">Strike Velocity</div>
          <div className="sv">
            <div className="sv-top"><span className="sv-num">{sps.toFixed(1)}<span className="unit" style={{ fontSize: '.42em' }}> shares/s</span></span><div className="sv-rng"><span className="on">1H</span><span>6H</span><span>24H</span></div></div>
            <div className="sv-hist">
              {spsHist.length === 0
                ? <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontFamily: 'var(--fd)', fontSize: '.6rem', letterSpacing: '.1em' }}>{cur > 0 ? 'COLLECTING SAMPLES…' : 'NO MINERS'}</div>
                : spsHist.map((p, i) => <i key={i} style={{ height: `${Math.max(3, ((p.sps || 0) / spsMax) * 100)}%` }} />)}
            </div>
            <div className="sv-leg"><span><b style={{ background: 'var(--green)' }} />normal</span><span><b style={{ background: 'var(--amber)' }} />spike/dip</span><span><b style={{ background: 'var(--red)' }} />downtime</span></div>
          </div>
        </div>
      </div>

      <div className="band b-feat">
        <div className="panel">
          <div className="zlabel">Solostrike Pulse</div>
          <div className="body clk" onClick={() => onOpen('pulse')}>
            <canvas ref={globeRef} width="150" height="150" />
            <div className="pulse-read">
              <div className="pr"><div className="prl">Strikers</div><div className="prv">{ns.strikerCount ?? (Array.isArray(ns.peers) ? ns.peers.length : 0)}</div></div>
              <div className="pr"><div className="prl">Net Pulse</div><div className="prv">{fmtHrShort(ns.totalHashrate || 0)}</div></div>
              <div className="pr"><div className="prl">Your Pin</div><div className="prv" style={{ color: 'var(--cyan)', fontSize: '.58rem' }}>PINNED</div></div>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="zlabel">The Hunt</div>
          <div className="body clk" onClick={() => onOpen('hunt')}>
            <canvas ref={huntRef} width="300" height="64" />
            <div className="hunt-face">
              <div className="hf-reward"><span className="lbl">Block Reward</span><span className="goldnum" style={{ fontFamily: 'var(--fd)', fontSize: '.98rem', fontWeight: 800 }}>{(poolState?.blockPrizeBtc || 3.125).toFixed(4)}<span className="unit" style={{ fontSize: '.6em' }}> BTC</span></span></div>
              <div className="hf-sub">subsidy <b>3.125</b> · fees <span className="fee">+{(poolState?.totalFeesBtc || 0).toFixed(4)}</span></div>
              <div className="hf-odds">
                <div className="o"><div className="ol">Workers</div><div className="ov">{liveWorkers}/{totalWorkers}</div></div>
                <div className="o"><div className="ol">Accept</div><div className="ov">{Number.isFinite(shares.acceptRate) ? (shares.acceptRate * 100).toFixed(2) + '%' : '—'}</div></div>
                <div className="o"><div className="ol">Best</div><div className="ov">{poolState?.bestshare ? fmtHrShort(poolState.bestshare) : '—'}</div></div>
              </div>
            </div>
          </div>
        </div>
        <div className="panel">
          <div className="zlabel">The Crew · live telemetry · {liveWorkers}/{totalWorkers}</div>
          <div className="crew">
            {(workers || []).slice(0, 12).map((w, i) => (
              <CrewMiner key={w.name || i} w={w} name={displayName ? displayName(w.name, aliases) : w.name} onClick={() => onSelectWorker && onSelectWorker(w)} />
            ))}
          </div>
        </div>
      </div>

      <div className="band b-data">
        <div className="col"><div className="ch">Bitcoin Network</div>
          <div className="dl"><span className="k">Difficulty</span><span className="v">{poolState?.network?.difficulty ? (poolState.network.difficulty / 1e12).toFixed(1) + ' T' : '—'}</span></div>
          <div className="dl"><span className="k">Hashrate</span><span className="v">{fmtHrShort(poolState?.network?.hashrate || 0)}</span></div>
          <div className="dl"><span className="k">Mempool</span><span className="v">{poolState?.network?.mempoolTx?.toLocaleString?.() || '—'}</span></div>
          <div className="dl"><span className="k">Height</span><span className="v">{poolState?.network?.height?.toLocaleString?.() || '—'}</span></div></div>
        <div className="col"><div className="ch">Bitcoin Node</div>
          <div className="dl"><span className="k">Status</span><span className="v green">{poolState?.nodeLive ? 'LIVE' : '—'}</span></div>
          <div className="dl"><span className="k">Height</span><span className="v">{poolState?.network?.height?.toLocaleString?.() || '—'}</span></div>
          <div className="dl"><span className="k">Peers</span><span className="v">{poolState?.node?.peers ?? '—'}</span></div>
          <div className="dl"><span className="k">ZMQ</span><span className="v green">● sync</span></div></div>
        <div className="col clk" onClick={() => onOpen('stratum')}><div className="ch">Stratum</div>
          <div className="dl"><span className="k">TCP</span><span className="v cyan">:3333</span></div>
          <div className="dl"><span className="k">Alt</span><span className="v">:3334</span></div>
          <div className="dl"><span className="k">TLS</span><span className="v cyan">:4333</span></div>
          <div className="dl"><span className="k">Accept</span><span className="v green">{Number.isFinite(shares.acceptRate) ? (shares.acceptRate * 100).toFixed(2) + '%' : '—'}</span></div></div>
        <div className="col"><div className="ch">Strikes</div>
          <div className="dl"><span className="k">Closest</span><span className="v cyan">{poolState?.snapshots?.closestCalls?.[0]?.pct ? poolState.snapshots.closestCalls[0].pct.toFixed(4) + '%' : '—'}</span></div>
          <div className="dl"><span className="k">Workers</span><span className="v">{liveWorkers}/{totalWorkers}</span></div>
          <div className="dl"><span className="k">Solo 30d</span><span className="v amber">{poolState?.snapshots?.soloBlocks30d ?? '—'}</span></div>
          <div className="dl"><span className="k">Yours</span><span className="v amber">{poolState?.snapshots?.totalStrikes ?? 0}</span></div></div>
        <div className="col"><div className="ch">Near Strikes</div>
          {(poolState?.snapshots?.closestCalls || []).slice(0, 4).map((c, i) => (
            <div className="dl" key={i}><span className="k">#{i + 1}</span><span className={`v ${i === 0 ? 'cyan' : ''}`}>{c.pct ? c.pct.toFixed(4) + '%' : '—'}</span></div>
          ))}
          {(!poolState?.snapshots?.closestCalls || poolState.snapshots.closestCalls.length === 0) && <div className="dl"><span className="k">—</span><span className="v">—</span></div>}
        </div>
        <div className="col"><div className="ch">Top Miners</div>
          {[...(workers || [])].sort((a, b) => (b.hashrate || 0) - (a.hashrate || 0)).slice(0, 4).map((w, i) => (
            <div className="dl" key={w.name || i}><span className="k">{i + 1}·{(displayName ? displayName(w.name, aliases) : w.name || '—').slice(0, 7)}</span><span className={`v ${i === 0 ? 'amber' : 'cyan'}`}>{fmtHrShort(w.hashrate)}</span></div>
          ))}
        </div>
        <div className="col clk" onClick={() => onOpen('jumpers')}><div className="ch">Claim Jumpers</div>
          <div className="barrow"><span className="nm">Network solo</span><span className="ct">{poolState?.snapshots?.soloBlocks30d ?? '—'}</span></div>
          <div className="barrow"><span className="nm">You<span className="solo">SOLO</span></span><span className="ct">{poolState?.snapshots?.totalStrikes ?? 0}</span></div>
          <div className="dl" style={{ marginTop: 2 }}><span className="k">Window</span><span className="v">30d</span></div></div>
        <div className="col clk" onClick={() => onOpen('sharestats')}><div className="ch">Share Stats</div>
          <div className="dl"><span className="k">Total</span><span className="v">{shares.acceptedCount ? (shares.acceptedCount / 1e6).toFixed(1) + ' M' : '—'}</span></div>
          <div className="dl"><span className="k">Best</span><span className="v amber">{poolState?.bestshare ? fmtHrShort(poolState.bestshare) : '—'}</span></div>
          <div className="dl"><span className="k">Accept</span><span className="v green">{Number.isFinite(shares.acceptRate) ? (shares.acceptRate * 100).toFixed(2) + '%' : '—'}</span></div>
          <div className="dl"><span className="k">Reject</span><span className="v">{Number.isFinite(shares.rejectRate) ? (shares.rejectRate * 100).toFixed(2) + '%' : '—'}</span></div></div>
      </div>

      <div className="band" style={{ gridTemplateColumns: '2.2fr 1.2fr', borderTop: '1px solid var(--hair)', paddingTop: 8 }}>
        <div className="col" style={{ paddingLeft: 0, borderLeft: 0 }}><div className="ch">The Ledger — Recent Blocks</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: '0 14px' }}>
            {blocks.slice(0, 6).map((b, i) => (
              <div className="dl" key={i} style={{ border: 0 }}><span className="k">{b.height?.toLocaleString?.() || b.height || '—'}</span><span className="v">{b.miner || b.pool || '—'}</span></div>
            ))}
            {blocks.length === 0 && <div className="dl" style={{ border: 0 }}><span className="k">—</span><span className="v">waiting</span></div>}
          </div>
        </div>
        <div className="col clk" onClick={() => onOpen('health')}><div className="ch">System Health</div>
          <div className="status" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: '6px 16px' }}>
            <div className="st"><span className="dot" />API</div><div className="st"><span className="dot" />ckpool</div>
            <div className="st"><span className="dot" />stunnel</div><div className="st"><span className="dot" />TLS :4333</div>
            <div className="st"><span className="dot" />node RPC</div><div className="st"><span className="dot" />ZMQ</div>
            {poolState?.uptimeSec ? <div className="st warn"><span className="dot" />uptime {Math.floor(poolState.uptimeSec / 86400)}d {Math.floor((poolState.uptimeSec % 86400) / 3600)}h</div> : null}
          </div></div>
      </div>
    </div>
  );
}

function StubPage({ title, ids, cardComponents }) {
  return (
    <div className="viewport"><div className="stub">
      <div className="stub-h">{title} — rebuilding to the preview layout next</div>
      {ids.map(id => cardComponents[id] ? <div key={id}>{cardComponents[id]}</div> : null)}
    </div></div>
  );
}

export default function DesktopPages({
  cardComponents = {}, order = [],
  poolState, workers = [], aliases = {}, stratumHealth, displayName,
  onOpen = () => {}, onSelectWorker,
}) {
  const narrow = useIsNarrow();
  const [page, setPage] = useState(0);
  const NP = 3;
  const startX = useRef(null);
  const go = useCallback(p => setPage(Math.max(0, Math.min(NP - 1, p))), []);

  useEffect(() => {
    const on = e => { if (e.key === 'ArrowRight') go(page + 1); if (e.key === 'ArrowLeft') go(page - 1); };
    window.addEventListener('keydown', on); return () => window.removeEventListener('keydown', on);
  }, [page, go]);

  useEffect(() => {
    if (document.getElementById('ssdesk-css')) return;
    const el = document.createElement('style'); el.id = 'ssdesk-css'; el.textContent = CSS; document.head.appendChild(el);
  }, []);

  const fitRef = useRef(null); const scalerRef = useRef(null);
  useEffect(() => {
    const fit = () => {
      const f = fitRef.current, s = scalerRef.current; if (!f || !s) return;
      const sc = Math.min(f.clientWidth / 1280, f.clientHeight / 860, 1);
      s.style.transform = `scale(${sc})`;
    };
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit);
  }, [narrow]);

  if (narrow) return null;

  const ids2 = order.filter(id => ['hashwindows', 'spswindows', 'connstates', 'besttrend', 'workers', 'stratum'].includes(id));
  const ids3 = order.filter(id => ['effort', 'stability', 'rejects', 'retarget', 'fleeteff', 'reliability', 'luck'].includes(id));

  return (
    <div className="ssdesk">
      <div className="fit" ref={fitRef}
        onTouchStart={e => { startX.current = e.touches[0].clientX; }}
        onTouchEnd={e => { if (startX.current == null) return; const dx = e.changedTouches[0].clientX - startX.current; if (Math.abs(dx) > 60) go(dx < 0 ? page + 1 : page - 1); startX.current = null; }}>
        <div className="scaler" ref={scalerRef}>
          <div className={`pages${page === 1 ? ' p2' : page === 2 ? ' p3' : ''}`}>
            <PageLive poolState={poolState} workers={workers} aliases={aliases} stratumHealth={stratumHealth}
              displayName={displayName} onOpen={onOpen} onSelectWorker={onSelectWorker} />
            <StubPage title="Pool Internals" ids={ids2} cardComponents={cardComponents} />
            <StubPage title="Luck & Analytics" ids={ids3} cardComponents={cardComponents} />
          </div>
        </div>
        <button className={`nav l${page === 0 ? ' hidden' : ''}`} onClick={() => go(page - 1)}>❮</button>
        <button className={`nav r${page === NP - 1 ? ' hidden' : ''}`} onClick={() => go(page + 1)}>❯</button>
        <div className="pagedots">{[0, 1, 2].map(i => <i key={i} className={i === page ? 'on' : ''} onClick={() => go(i)} />)}</div>
      </div>
    </div>
  );
}
