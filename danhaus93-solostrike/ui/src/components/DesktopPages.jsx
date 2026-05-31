// ============================================================================
// SoloStrike Desktop — 3-page dashboard (v1.12.x)
// ----------------------------------------------------------------------------
// The attached solostrike-desktop-preview.html is the TEMPLATE: its exact bands,
// grid proportions, hairline zones, apphead and 3-page nav define WHERE things
// go. This component reproduces that skeleton and INSERTS the real card
// components into each zone — real WebGL globe (PulsePanel) in the Pulse slot,
// real Hunt (HuntPanel) in the Hunt slot, real Firepower / Crew / analytics /
// data everywhere else, and the real <Ticker> in the apphead. Box-free: the
// inserted cards have their box chrome stripped so they read as the template's
// hairline zones. Stage scales 1280×860 to fit, like the template.
// Desktop/tablet only — mobile keeps the .ss-carousel.
// ============================================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';

// zone → real card id, per page, mirroring the template's band layout
const P1 = {
  charts:  ['hashrate', 'strikevel'],
  feature: ['pulse', 'hunt', 'workers'],
  data:    ['network', 'node', 'stratum', 'closestcalls', 'best', 'luck', 'jumpers', 'shares'],
  ledger:  ['recent', 'health'],
};
const P2 = {
  top:     ['hashwindows', 'spswindows', 'connstates'],
  fleet:   ['workers'],
  bottom:  ['besttrend', 'shares', 'reliability', 'retarget'],
};
const P3 = {
  top:     ['effort', 'stability'],
  mid:     ['rejects', 'retarget', 'fleeteff'],
  bottom:  ['best', 'luck', 'fleeteff', 'reliability'],
};

const CSS = `
.ssdesk{position:relative;width:100%;height:100%;flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;--hair:rgba(var(--amber-rgb),0.14)}
.ssdesk .ssd-scaler{width:1280px;height:860px;transform-origin:center center;flex:none;display:flex;flex-direction:column;
  background:radial-gradient(1100px 600px at 72% -12%,rgba(var(--amber-rgb),0.10),transparent 60%),radial-gradient(800px 520px at -10% 112%,rgba(0,255,209,0.05),transparent 55%),var(--bg-void);
  border:1px solid var(--border-hot);border-radius:14px;overflow:hidden;position:relative}
.ssdesk .ssd-scaler::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.24;background-image:linear-gradient(rgba(var(--amber-rgb),0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(var(--amber-rgb),0.05) 1px,transparent 1px);background-size:44px 44px}
.ssdesk .ssd-scaler>*{position:relative;z-index:1}

/* apphead (single, scaled, hosts the real ticker) */
.ssdesk .ssd-head{display:flex;align-items:center;gap:.5rem;min-height:42px;padding:8px 20px 6px;border-bottom:1px solid var(--hair);flex:0 0 auto}
.ssdesk .ssd-pick{font-size:16px;filter:drop-shadow(0 0 8px rgba(var(--amber-rgb),0.7));animation:ssd-pulse 3s ease-in-out infinite}
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
@keyframes ssd-pulse{0%,100%{opacity:1}50%{opacity:.55}}

/* paged stage */
.ssdesk .ssd-stage{flex:1;min-height:0;overflow:hidden;position:relative}
.ssdesk .ssd-track{display:flex;width:300%;height:100%;transition:transform .42s cubic-bezier(.6,.02,.2,1);will-change:transform}
.ssdesk .ssd-vp{flex:0 0 33.3333%;width:33.3333%;height:100%;min-height:0;display:grid;padding:12px 20px 18px;row-gap:12px;overflow:hidden}

/* template bands */
.ssdesk .band{display:grid;gap:18px;min-height:0}
.ssdesk .b-charts{grid-template-columns:1fr 1fr}
.ssdesk .b-feat{grid-template-columns:1fr 1fr 1.4fr}
.ssdesk .b-data{grid-template-columns:repeat(8,1fr);align-self:end}
.ssdesk .zone{min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;position:relative}
/* hairline separators like the preview's box-free zones */
.ssdesk .b-data .zone{padding:0 12px;border-left:1px solid var(--hair)}
.ssdesk .b-data .zone:first-child{padding-left:0;border-left:0}

/* BOX-FREE insert: real cards, chrome stripped, fill their zone */
.ssdesk .zone>*{min-height:0;height:100%;width:100%;overflow:hidden;background:transparent!important;border:none!important;border-radius:0!important;box-shadow:none!important;padding:0!important}

/* nav + dots (outside the scaled stage so they stay crisp) */
.ssdesk .ssd-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:55;width:30px;height:64px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:none;border:none;color:var(--amber);font-size:30px;line-height:1;opacity:.4;transition:opacity .18s;user-select:none;text-shadow:0 0 12px rgba(var(--amber-rgb),.55)}
.ssdesk .ssd-nav:hover{opacity:.95}.ssdesk .ssd-nav.l{left:10px}.ssdesk .ssd-nav.r{right:10px}.ssdesk .ssd-nav.hidden{opacity:0;pointer-events:none}
.ssdesk .ssd-dots{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:55;display:flex;gap:8px;align-items:center}
.ssdesk .ssd-dots i{width:8px;height:8px;border-radius:50%;background:rgba(var(--amber-rgb),.3);cursor:pointer;transition:all .2s}
.ssdesk .ssd-dots i.on{width:20px;border-radius:4px;background:var(--amber);box-shadow:0 0 8px var(--amber)}
`;

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

// insert a real card (chrome stripped) into a template zone
function Zone({ cardComponents, id, className }) {
  return <div className={`zone${className ? ' ' + className : ''}`}>{cardComponents[id] || null}</div>;
}

export default function DesktopPages({
  cardComponents = {},
  ticker = null,
  onOpenSettings,
  status = 'Mining Live',
  zmq = null,
  strikes = 0,
}) {
  const narrow = useIsNarrow();
  const now = useNow();
  const [page, setPage] = useState(0);
  const NP = 3;
  const startX = useRef(null);
  const fitRef = useRef(null);
  const scalerRef = useRef(null);
  const go = useCallback(p => setPage(Math.max(0, Math.min(NP - 1, p))), []);

  useEffect(() => {
    const on = e => { if (e.key === 'ArrowRight') go(page + 1); if (e.key === 'ArrowLeft') go(page - 1); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [page, go]);

  useEffect(() => {
    if (document.getElementById('ssdesk-css')) return;
    const el = document.createElement('style'); el.id = 'ssdesk-css'; el.textContent = CSS; document.head.appendChild(el);
  }, []);

  // scale 1280×860 to fit available space (like the template's fit())
  useEffect(() => {
    const fit = () => {
      const f = fitRef.current, s = scalerRef.current; if (!f || !s) return;
      const sc = Math.min(f.clientWidth / 1280, f.clientHeight / 860, 1);
      s.style.transform = `scale(${sc})`;
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [narrow]);

  if (narrow) return null;

  const zmqOk = zmq && (zmq.connected || zmq.synced || zmq === true);
  const pageLabel = ['Live', 'Pool Internals', 'Luck & Analytics'][page];

  return (
    <div className="ssdesk" ref={fitRef}
      onTouchStart={e => { startX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (startX.current == null) return;
        const dx = e.changedTouches[0].clientX - startX.current;
        if (Math.abs(dx) > 60) go(dx < 0 ? page + 1 : page - 1);
        startX.current = null;
      }}>
      <div className="ssd-scaler" ref={scalerRef}>
        {/* apphead — single, hosts the real ticker */}
        <div className="ssd-head">
          <span className="ssd-pick">⛏</span><span className="ssd-wm">SoloStrike</span>
          <span className="ssd-div" /><span className="ssd-status">{status}</span>
          <span className="ssd-zmq">{page === 1 ? 'ckpool' : page === 2 ? 'stats' : `ZMQ ${zmqOk ? '●' : '○'}`}</span>
          <span className="ssd-pl">{page === 0 ? <>STRIKES <b>{strikes ?? 0}</b></> : <>PAGE <b>{page + 1} / 3</b></>}</span>
          <div className="ssd-mq">{ticker}</div>
          <div className="ssd-right">
            <div className="ssd-clock"><span className="lv">LIVE</span><span className="tm">{now.toLocaleTimeString('en-US', { hour12: false })}</span></div>
            <button className="ssd-gear" title="Settings" onClick={() => onOpenSettings && onOpenSettings()}>⚙</button>
          </div>
        </div>

        <div className="ssd-stage">
          <div className="ssd-track" style={{ transform: `translateX(-${page * 33.3333}%)` }}>

            {/* ───────── PAGE 1 — Live ───────── */}
            <div className="ssd-vp" style={{ gridTemplateRows: '180px 1fr auto auto' }}>
              <div className="band b-charts">
                {P1.charts.map(id => <Zone key={id} cardComponents={cardComponents} id={id} />)}
              </div>
              <div className="band b-feat">
                {P1.feature.map(id => <Zone key={id} cardComponents={cardComponents} id={id} />)}
              </div>
              <div className="band b-data">
                {P1.data.map(id => <Zone key={id} cardComponents={cardComponents} id={id} />)}
              </div>
              <div className="band" style={{ gridTemplateColumns: '2.2fr 1.2fr', borderTop: '1px solid var(--hair)', paddingTop: 8 }}>
                {P1.ledger.map(id => <Zone key={id} cardComponents={cardComponents} id={id} />)}
              </div>
            </div>

            {/* ───────── PAGE 2 — Pool Internals ───────── */}
            <div className="ssd-vp" style={{ gridTemplateRows: '1fr 1fr auto' }}>
              <div className="band" style={{ gridTemplateColumns: '1.5fr 1fr 1fr' }}>
                {P2.top.map(id => <Zone key={id} cardComponents={cardComponents} id={id} />)}
              </div>
              <div className="band" style={{ gridTemplateColumns: '1fr' }}>
                {P2.fleet.map(id => <Zone key={id} cardComponents={cardComponents} id={id} />)}
              </div>
              <div className="band b-data" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                {P2.bottom.map(id => <Zone key={id} cardComponents={cardComponents} id={id} />)}
              </div>
            </div>

            {/* ───────── PAGE 3 — Luck & Analytics ───────── */}
            <div className="ssd-vp" style={{ gridTemplateRows: '1fr 1fr auto' }}>
              <div className="band" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
                {P3.top.map(id => <Zone key={id} cardComponents={cardComponents} id={id} />)}
              </div>
              <div className="band" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                {P3.mid.map((id, i) => <Zone key={id + i} cardComponents={cardComponents} id={id} />)}
              </div>
              <div className="band b-data" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                {P3.bottom.map((id, i) => <Zone key={id + i} cardComponents={cardComponents} id={id} />)}
              </div>
            </div>

          </div>
        </div>
      </div>

      <button className={`ssd-nav l${page === 0 ? ' hidden' : ''}`} onClick={() => go(page - 1)}>❮</button>
      <button className={`ssd-nav r${page === NP - 1 ? ' hidden' : ''}`} onClick={() => go(page + 1)}>❯</button>
      <div className="ssd-dots">
        {[0, 1, 2].map(i => <i key={i} className={i === page ? 'on' : ''} onClick={() => go(i)} title={['Live', 'Pool Internals', 'Luck & Analytics'][i]} />)}
      </div>
    </div>
  );
}
