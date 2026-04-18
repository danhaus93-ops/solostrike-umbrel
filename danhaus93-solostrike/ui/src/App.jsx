import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { usePool } from './hooks/usePool.js';
import { fmtHr, fmtDiff, fmtNum, fmtUptime, fmtOdds, timeAgo } from './utils.js';

// ── Shared style tokens ───────────────────────────────────────────────────────
const card = { background:'var(--bg-surface)', border:'1px solid var(--border)', padding:'1.25rem' };
const cardTitle = { fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:'1rem' };
const statRow = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.5rem 0.75rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:'0.35rem' };
const label = { fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ uptime, connected, status, onSettings }) {
  const statusMap = { running:{c:'var(--green)',t:'MINING'}, mining:{c:'var(--green)',t:'MINING'}, no_address:{c:'var(--amber)',t:'SETUP'}, setup:{c:'var(--amber)',t:'SETUP'}, starting:{c:'var(--amber)',t:'STARTING'}, error:{c:'var(--red)',t:'ERROR'}, loading:{c:'var(--text-2)',t:'...'} };
  const st = statusMap[status] || statusMap.loading;
  return (
    <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 1.5rem', height:52, borderBottom:'1px solid var(--border)', background:'rgba(6,7,8,0.95)', backdropFilter:'blur(8px)', position:'sticky', top:0, zIndex:50 }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem' }}>
        <span style={{ fontSize:18, color:'var(--amber)', filter:'drop-shadow(0 0 8px rgba(245,166,35,0.7))', animation:'pulse 3s ease-in-out infinite' }}>⛏</span>
        <span style={{ fontFamily:'var(--fd)', fontSize:'1.05rem', fontWeight:700, letterSpacing:'0.1em', color:'var(--amber)', textTransform:'uppercase' }}>SoloStrike</span>
        <div style={{ width:1, height:20, background:'var(--border)' }}/>
        <div style={{ display:'flex', alignItems:'center', gap:6, fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.15em', textTransform:'uppercase' }}>
          <div style={{ width:6, height:6, borderRadius:'50%', background:st.c, boxShadow:`0 0 8px ${st.c}`, animation:'pulse 2s ease-in-out infinite' }}/>
          <span style={{ color:st.c }}>{st.t}</span>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', fontFamily:'var(--fd)', fontSize:'0.6rem', color:'var(--text-2)', letterSpacing:'0.08em' }}>
        <span>UP {fmtUptime(uptime)}</span>
        <div style={{ width:1, height:16, background:'var(--border)' }}/>
        <span style={{ color: connected?'var(--cyan)':'var(--text-2)' }}>{connected?'● LIVE':'○ RECONNECTING'}</span>
        <button onClick={onSettings} style={{ background:'none', border:'none', color:'var(--text-2)', cursor:'pointer', fontSize:16, padding:'2px 6px', transition:'color 0.15s' }}
          onMouseOver={e=>e.currentTarget.style.color='var(--amber)'} onMouseOut={e=>e.currentTarget.style.color='var(--text-2)'}>⚙</button>
      </div>
    </header>
  );
}

// ── Ticker ────────────────────────────────────────────────────────────────────
function Ticker({ state }) {
  const online = (state.workers||[]).filter(w=>w.status!=='offline').length;
  const items = [`WORKERS ${online}/${(state.workers||[]).length}`, `HEIGHT ${fmtNum(state.network?.height)}`, `DIFFICULTY ${fmtDiff(state.network?.difficulty)}`, `NET HASHRATE ${fmtHr(state.network?.hashrate)}`, `ACCEPTED ${fmtNum(state.shares?.accepted)}`, `EXPECTED ${fmtOdds(state.odds?.expectedDays)}`, `BEST ${fmtNum(Math.round(state.bestshare||0))}`];
  const t = items.join('   ·   ');
  return (
    <div style={{ background:'var(--bg-deep)', borderBottom:'1px solid var(--border)', overflow:'hidden', height:26, display:'flex', alignItems:'center' }}>
      <div style={{ whiteSpace:'nowrap', animation:'ticker 30s linear infinite', fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.15em', color:'var(--text-2)', textTransform:'uppercase', display:'inline-block' }}>
        {t}&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{t}
      </div>
    </div>
  );
}

// ── Hashrate chart ────────────────────────────────────────────────────────────
function HashrateChart({ history, current }) {
  const data = (history||[]).filter((_,i)=>i%2===0).map(p=>({hr:p.hr}));
  const [p0, p1] = fmtHr(current).split(' ');
  return (
    <div style={{...card, gridColumn:'span 2'}} className="fade-in">
      <div style={cardTitle}>▸ Pool Hashrate — Live</div>
      <div style={{ fontFamily:'var(--fd)', fontSize:'2.6rem', fontWeight:700, color:'var(--amber)', letterSpacing:'0.01em', lineHeight:1, textShadow:'0 0 30px rgba(245,166,35,0.35)', marginBottom:'1.25rem' }}>
        {p0}<span style={{ fontSize:'1rem', color:'var(--amber-dim)', marginLeft:4 }}>{p1}</span>
      </div>
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={data} margin={{top:4,right:0,left:0,bottom:0}}>
          <defs>
            <linearGradient id="hrG" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F5A623" stopOpacity={0.28}/>
              <stop offset="95%" stopColor="#F5A623" stopOpacity={0.02}/>
            </linearGradient>
          </defs>
          <XAxis hide/><YAxis hide domain={['auto','auto']}/>
          <Tooltip content={({active,payload})=>active&&payload?.length?<div style={{background:'var(--bg-elevated)',border:'1px solid var(--border-hot)',padding:'3px 8px',fontSize:'0.7rem',fontFamily:'var(--fm)',color:'var(--amber)'}}>{fmtHr(payload[0].value)}</div>:null}/>
          <Area type="monotone" dataKey="hr" stroke="#F5A623" strokeWidth={2} fill="url(#hrG)" dot={false} isAnimationActive={false}/>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Worker grid ───────────────────────────────────────────────────────────────
function WorkerGrid({ workers }) {
  const sorted = [...(workers||[])].sort((a,b)=>(a.status==='offline'?1:-1)-(b.status==='offline'?1:-1)||(b.hashrate||0)-(a.hashrate||0));
  const online = sorted.filter(w=>w.status!=='offline').length;
  return (
    <div style={{...card, gridColumn:'span 2'}} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between'}}>
        <span>▸ Connected Workers</span>
        <span style={{color:'var(--amber)'}}>{online}/{sorted.length} online</span>
      </div>
      {sorted.length===0?(
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)',lineHeight:2}}>
          No miners connected yet.<br/>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--cyan)'}}>stratum+tcp://umbrel.local:3333</span>
          <br/><span style={{color:'var(--text-3)',fontSize:'0.65rem'}}>user: worker_name · pass: x</span>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem'}}>
          {sorted.map(w=>{
            const on=w.status!=='offline';
            const total=(w.shares||0)+(w.rejected||0)||1;
            return(
              <div key={w.name} style={{display:'flex',alignItems:'center',gap:'0.6rem',padding:'0.6rem 0.875rem',background:'var(--bg-raised)',border:`1px solid ${on?'rgba(57,255,106,0.12)':'transparent'}`,opacity:on?1:0.45}}>
                <div style={{width:6,height:6,borderRadius:'50%',flexShrink:0,background:on?'var(--green)':'var(--text-3)',boxShadow:on?'0 0 6px var(--green)':'none',animation:on?'pulse 2s ease-in-out infinite':'none'}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.75rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{w.name}</div>
                  <div style={{height:2,background:'var(--bg-deep)',marginTop:4,borderRadius:1,overflow:'hidden'}}>
                    <div style={{height:'100%',width:`${(w.shares/total)*100}%`,background:'var(--green)',borderRadius:1}}/>
                  </div>
                </div>
                <span style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-2)'}}>
                  <span style={{color:'var(--green)'}}>{fmtNum(w.shares||0)}</span>/<span style={{color:'var(--red)'}}>{w.rejected||0}</span>
                </span>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.8rem',fontWeight:600,color:on?'var(--amber)':'var(--text-2)',minWidth:80,textAlign:'right'}}>
                  {on?fmtHr(w.hashrate):'offline'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Network stats ─────────────────────────────────────────────────────────────
function NetworkStats({ network }) {
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Bitcoin Network</div>
      {[['Block Height', fmtNum(network?.height), 'var(--text-1)'],['Difficulty', fmtDiff(network?.difficulty), 'var(--text-1)'],['Net Hashrate', fmtHr(network?.hashrate), 'var(--cyan)']].map(([l,v,c])=>(
        <div key={l} style={statRow}>
          <span style={label}>{l}</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.9rem',fontWeight:600,color:c,textShadow:c==='var(--cyan)'?'0 0 10px rgba(0,255,209,0.3)':'none'}}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ── Odds ──────────────────────────────────────────────────────────────────────
function OddsDisplay({ odds, hashrate, netHashrate }) {
  const { perBlock=0, expectedDays=null } = odds||{};
  const R=48, C=2*Math.PI*R;
  const scale=perBlock>0?Math.min(1,Math.log10(1+perBlock*1e9)/3):0;
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Block Probability</div>
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:'0.875rem'}}>
        <div style={{position:'relative',width:110,height:110,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <svg width="110" height="110" viewBox="0 0 110 110" style={{position:'absolute'}}>
            <circle cx="55" cy="55" r={R} fill="none" stroke="var(--bg-raised)" strokeWidth="7"/>
            {[0,90,180,270].map(d=><line key={d} x1="55" y1="4" x2="55" y2="12" stroke="var(--border)" strokeWidth="1" transform={`rotate(${d} 55 55)`}/>)}
            <circle cx="55" cy="55" r={R} fill="none" stroke="var(--amber)" strokeWidth="7" strokeLinecap="round"
              strokeDasharray={`${C*scale} ${C}`} style={{filter:'drop-shadow(0 0 5px rgba(245,166,35,0.6))',transition:'stroke-dasharray 1.2s ease'}} transform="rotate(-90 55 55)"/>
          </svg>
          <div style={{textAlign:'center'}}>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.65rem',fontWeight:700,color:'var(--amber)',lineHeight:1.2}}>
              {perBlock>0?`${(perBlock*100).toExponential(1)}%`:'—'}
            </div>
            <div style={{fontFamily:'var(--fd)',fontSize:'0.5rem',color:'var(--text-2)',letterSpacing:'0.08em',textTransform:'uppercase',marginTop:2}}>per block</div>
          </div>
        </div>
        {[['Expected', fmtOdds(expectedDays), 'var(--amber)'],['Per Day', perBlock>0?`${(perBlock*144*100).toFixed(4)}%`:'—','var(--text-1)'],['Pool Share', netHashrate>0&&hashrate>0?`${((hashrate/netHashrate)*100).toExponential(2)}%`:'—','var(--text-1)']].map(([l,v,c])=>(
          <div key={l} style={{...statRow,width:'100%',marginBottom:0}}>
            <span style={label}>{l}</span>
            <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:c}}>{v}</span>
          </div>
        ))}
        <p style={{fontSize:'0.58rem',color:'var(--text-3)',fontFamily:'var(--fm)',textAlign:'center',lineHeight:1.5}}>
          probability is statistical — blocks can<br/>be found at any time or never ⛏
        </p>
      </div>
    </div>
  );
}

// ── Share stats (now with shares-per-minute) ──────────────────────────────────
function ShareStats({ shares, hashrate }) {
  const { accepted=0, rejected=0, stale=0 } = shares||{};
  const total=accepted+rejected+stale||1;
  const rate=((accepted/total)*100).toFixed(2);
  // Approx raw diff-1 share submissions per minute based on current hashrate
  // (hashrate / 2^32) × 60 seconds — matches what miners display locally
  const sharesPerMin = hashrate > 0 ? (hashrate / 4294967296 * 60).toFixed(1) : '0';
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Share Stats</div>
      <div style={{display:'flex',gap:'0.5rem',marginBottom:'0.75rem'}}>
        {[['✓','Accepted',fmtNum(accepted),'var(--green)'],['✕','Rejected',fmtNum(rejected),'var(--red)'],['⏱','Stale',fmtNum(stale),'var(--amber)']].map(([icon,lbl,val,c])=>(
          <div key={lbl} style={{flex:1,background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.65rem',display:'flex',flexDirection:'column',alignItems:'center',gap:'0.2rem'}}>
            <span style={{fontSize:12,color:c}}>{icon}</span>
            <span style={{fontFamily:'var(--fd)',fontSize:'1.1rem',fontWeight:700,color:c}}>{val}</span>
            <span style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text-2)'}}>{lbl}</span>
          </div>
        ))}
      </div>
      <div style={{height:3,background:'var(--bg-deep)',borderRadius:2,overflow:'hidden',display:'flex'}}>
        <div style={{height:'100%',width:`${(accepted/total)*100}%`,background:'var(--green)',transition:'width 0.5s'}}/>
        <div style={{height:'100%',width:`${(rejected/total)*100}%`,background:'var(--red)'}}/>
        <div style={{height:'100%',width:`${(stale/total)*100}%`,background:'var(--amber)'}}/>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:'0.4rem',fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)'}}>
        <span>Accept rate</span>
        <span style={{color:parseFloat(rate)>99?'var(--green)':'var(--amber)'}}>{rate}%</span>
      </div>
      <div style={{display:'flex',justifyContent:'space-between',marginTop:'0.25rem',fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)'}}>
        <span>Shares / min (est.)</span>
        <span style={{color:'var(--cyan)'}}>{sharesPerMin}</span>
      </div>
    </div>
  );
}

// ── Best Share Leaderboard ────────────────────────────────────────────────────
function BestShareLeaderboard({ workers, poolBest }) {
  const sorted = [...(workers || [])]
    .filter(w => (w.bestshare||0) > 0)
    .sort((a, b) => (b.bestshare || 0) - (a.bestshare || 0))
    .slice(0, 5);
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Best Shares — All-Time</div>
      {sorted.length === 0 ? (
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.72rem',fontFamily:'var(--fd)'}}>
          No shares submitted yet<br/>
          <span style={{color:'var(--amber)',fontSize:'0.65rem'}}>Keep mining ⛏</span>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'0.35rem'}}>
          {sorted.map((w, i) => (
            <div key={w.name} style={{display:'flex',alignItems:'center',gap:'0.6rem',padding:'0.55rem 0.8rem',background:'var(--bg-raised)',border:`1px solid ${i===0?'rgba(245,166,35,0.3)':'var(--border)'}`}}>
              <span style={{fontFamily:'var(--fd)',fontSize:'0.7rem',fontWeight:700,color:i===0?'var(--amber)':'var(--text-2)',width:18}}>#{i+1}</span>
              <div style={{flex:1,minWidth:0,fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                {w.name.includes('.') ? w.name.split('.').pop() : w.name.slice(0,14)+'…'}
              </div>
              <span style={{fontFamily:'var(--fd)',fontSize:'0.75rem',fontWeight:600,color:i===0?'var(--amber)':'var(--cyan)'}}>
                {fmtNum(Math.round(w.bestshare || 0))}
              </span>
            </div>
          ))}
          <div style={{...statRow,marginTop:'0.4rem',borderColor:'var(--border-hot)'}}>
            <span style={label}>Pool Best</span>
            <span style={{fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:700,color:'var(--amber)',textShadow:'0 0 8px rgba(245,166,35,0.4)'}}>
              {fmtNum(Math.round(poolBest || 0))}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mempool fees (if Mempool app installed) ───────────────────────────────────
function MempoolPanel({ mempool }) {
  if (!mempool || mempool.feeRate == null) return null;
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Next Block — Potential Reward</div>
      <div style={statRow}>
        <span style={label}>Priority Fee</span>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.9rem',fontWeight:600,color:'var(--amber)'}}>
          {mempool.feeRate} sat/vB
        </span>
      </div>
      {mempool.unconfirmedCount && (
        <div style={statRow}>
          <span style={label}>Mempool TX</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--cyan)'}}>
            {fmtNum(mempool.unconfirmedCount)}
          </span>
        </div>
      )}
      <p style={{fontSize:'0.58rem',color:'var(--text-3)',fontFamily:'var(--fm)',textAlign:'center',lineHeight:1.5,marginTop:'0.5rem'}}>
        coinbase reward + fees<br/>go 100% to you if you find it ⛏
      </p>
    </div>
  );
}

// ── Block feed ────────────────────────────────────────────────────────────────
function BlockFeed({ blocks, blockAlert }) {
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Blocks Found — {(blocks||[]).length} total</div>
      {!(blocks||[]).length?(
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)'}}>
          No blocks found yet.<br/><span style={{color:'var(--amber)',fontSize:'0.68rem'}}>Keep mining ⛏</span>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem',maxHeight:240,overflowY:'auto'}}>
          {blocks.map((b,i)=>(
            <div key={b.hash} style={{display:'flex',alignItems:'center',gap:'0.75rem',padding:'0.7rem 1rem',background:'var(--bg-raised)',border:`1px solid ${blockAlert&&i===0?'var(--green)':'rgba(57,255,106,0.15)'}`,animation:blockAlert&&i===0?'blockBoom 0.6s ease':'none'}}>
              <span style={{fontSize:16,filter:'drop-shadow(0 0 4px rgba(57,255,106,0.5))'}}>💎</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:'var(--green)'}}>#{fmtNum(b.height)}</div>
                <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{b.hash?.slice(0,24)}…</div>
              </div>
              <span style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-2)',flexShrink:0}}>{timeAgo(b.ts)}</span>
              <a href={`https://mempool.space/block/${b.hash}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--text-2)',fontSize:12}}>↗</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Confetti ──────────────────────────────────────────────────────────────────
function Confetti() {
  const ref = useRef(null);
  useEffect(()=>{
    const canvas=ref.current; if(!canvas)return;
    const ctx=canvas.getContext('2d'); canvas.width=window.innerWidth; canvas.height=window.innerHeight;
    const colors=['#F5A623','#00FFD1','#39FF6A','#FF7A00','#fff'];
    const pts=Array.from({length:150},()=>({x:Math.random()*canvas.width,y:-10,vy:3+Math.random()*5,vx:(Math.random()-.5)*4,s:3+Math.random()*6,c:colors[Math.floor(Math.random()*colors.length)],r:Math.random()*360,rv:(Math.random()-.5)*8,op:1}));
    let frame; const draw=()=>{ ctx.clearRect(0,0,canvas.width,canvas.height); let alive=false;
      pts.forEach(p=>{p.y+=p.vy;p.x+=p.vx;p.r+=p.rv;p.op-=0.007; if(p.y<canvas.height&&p.op>0)alive=true;
        ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.r*Math.PI/180);ctx.globalAlpha=Math.max(0,p.op);ctx.fillStyle=p.c;ctx.fillRect(-p.s/2,-p.s/2,p.s,p.s*.5);ctx.restore();});
      if(alive)frame=requestAnimationFrame(draw);};
    frame=requestAnimationFrame(draw); return()=>cancelAnimationFrame(frame);
  },[]);
  return <canvas ref={ref} style={{position:'fixed',inset:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:299}}/>;
}

// ── Block alert ───────────────────────────────────────────────────────────────
function BlockAlert({ block, onDismiss }) {
  if(!block) return null;
  return(
    <>
      <Confetti/>
      <div style={{position:'fixed',inset:0,display:'flex',alignItems:'center',justifyContent:'center',zIndex:300,pointerEvents:'none'}}>
        <div onClick={onDismiss} style={{background:'var(--bg-surface)',border:'2px solid var(--green)',padding:'2.5rem 4rem',textAlign:'center',boxShadow:'0 0 60px rgba(57,255,106,0.4)',animation:'blockBoom 0.5s ease',pointerEvents:'auto',cursor:'pointer'}}>
          <div style={{fontSize:'3.5rem',marginBottom:'0.5rem'}}>💎</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.7rem',letterSpacing:'0.3em',textTransform:'uppercase',color:'var(--green)',marginBottom:'0.25rem'}}>⚡ BLOCK FOUND ⚡</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'2.8rem',fontWeight:700,color:'#fff',textShadow:'0 0 24px rgba(57,255,106,0.6)'}}>#{fmtNum(block.height)}</div>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.65rem',color:'var(--text-2)',marginTop:'0.4rem'}}>{block.hash?.slice(0,20)}…</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--text-3)',marginTop:'1rem',letterSpacing:'0.1em'}}>TAP TO DISMISS</div>
        </div>
      </div>
    </>
  );
}

// ── Setup screen ──────────────────────────────────────────────────────────────
function SetupScreen({ onComplete }) {
  const [addr, setAddr] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if(!addr.trim()){setError('Please enter a Bitcoin address.');return;}
    setLoading(true);setError('');
    try{
      const r=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payoutAddress:addr.trim()})});
      const d=await r.json();
      if(!r.ok){setError(d.error||'Invalid address.');return;}
      onComplete();
    } catch{setError('Cannot reach pool API.');}
    finally{setLoading(false);}
  };
  return (
    <div style={{position:'fixed',inset:0,background:'var(--bg-void)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
      <div style={{width:'100%',maxWidth:500,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',padding:'2.5rem',boxShadow:'var(--glow-a)',position:'relative'}}>
        {[[0,0,'2px 0 0 2px'],[0,'r','2px 2px 0 0'],['b',0,'0 0 2px 2px'],['b','r','0 2px 2px 0']].map(([t,r,bw],i)=>(
          <div key={i} style={{position:'absolute',top:t==='b'?undefined:0,bottom:t==='b'?0:undefined,left:r==='r'?undefined:0,right:r==='r'?0:undefined,width:14,height:14,borderColor:'var(--amber)',borderStyle:'solid',borderWidth:bw}}/>
        ))}
        <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.5rem'}}>
          <span style={{fontSize:22,color:'var(--amber)'}}>⛏</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'1.6rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.08em'}}>SOLOSTRIKE</span>
        </div>
        <p style={{fontFamily:'var(--fd)',fontSize:'0.65rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'2rem'}}>Initial Setup — Enter Payout Address</p>
        <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.62rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem'}}>Bitcoin Payout Address</label>
        <input style={{width:'100%',background:'var(--bg-deep)',border:`1px solid ${error?'rgba(255,59,59,0.5)':addr?'var(--border-hot)':'var(--border)'}`,color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.82rem',padding:'0.75rem 1rem',outline:'none'}}
          type="text" placeholder="bc1q… or 1… or 3…" value={addr} onChange={e=>{setAddr(e.target.value);setError('');}} onKeyDown={e=>e.key==='Enter'&&submit()} spellCheck={false} autoCorrect="off" autoCapitalize="off"/>
        <p style={{fontSize:'0.62rem',color:'var(--text-3)',fontFamily:'var(--fm)',marginTop:'0.35rem',lineHeight:1.5}}>All block rewards pay 100% to this address. Changeable anytime in Settings.</p>
        {error&&<div style={{background:'rgba(255,59,59,0.08)',border:'1px solid rgba(255,59,59,0.3)',padding:'0.6rem 0.875rem',fontSize:'0.75rem',color:'var(--red)',marginTop:'0.75rem'}}>⚠ {error}</div>}
        <button onClick={submit} disabled={loading} style={{width:'100%',marginTop:'1.5rem',padding:'0.875rem',background:'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:700,letterSpacing:'0.15em',textTransform:'uppercase',cursor:'pointer',opacity:loading?0.6:1}}>
          {loading?'SAVING…':'START MINING →'}
        </button>
      </div>
    </div>
  );
}

// ── Settings modal ────────────────────────────────────────────────────────────
function SettingsModal({ onClose, saveConfig, currentConfig }) {
  const [addr, setAddr] = useState('');
  const [poolName, setPoolName] = useState(currentConfig?.poolName||'SoloStrike');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setLoading(true);setError('');setSaved(false);
    try{const p={poolName};if(addr.trim())p.payoutAddress=addr.trim();await saveConfig(p);setSaved(true);setAddr('');setTimeout(()=>setSaved(false),3000);}
    catch(e){setError(e.message);}finally{setLoading(false);}
  };
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:460,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',padding:'1.75rem',boxShadow:'var(--glow-a)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--amber)'}}>⚙ Settings</span>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:18}} onMouseOver={e=>e.currentTarget.style.color='var(--amber)'} onMouseOut={e=>e.currentTarget.style.color='var(--text-2)'}>✕</button>
        </div>
        {currentConfig?.addressMasked&&<div style={statRow}><span style={label}>Current Address</span><span style={{fontFamily:'var(--fm)',color:'var(--cyan)',fontSize:'0.75rem'}}>{currentConfig.addressMasked}</span></div>}
        <div style={{background:'rgba(245,166,35,0.05)',border:'1px solid rgba(245,166,35,0.15)',padding:'0.6rem 0.875rem',margin:'1rem 0',fontSize:'0.7rem',color:'var(--amber)',fontFamily:'var(--fd)',lineHeight:1.5}}>
          ⚠ Changing address restarts the pool backend briefly
        </div>
        {saved&&<div style={{background:'rgba(57,255,106,0.06)',border:'1px solid rgba(57,255,106,0.2)',padding:'0.5rem 0.75rem',fontSize:'0.72rem',color:'var(--green)',marginBottom:'1rem'}}>✓ Saved successfully</div>}
        {error&&<div style={{background:'rgba(255,59,59,0.06)',border:'1px solid rgba(255,59,59,0.2)',padding:'0.5rem 0.75rem',fontSize:'0.72rem',color:'var(--red)',marginBottom:'1rem'}}>⚠ {error}</div>}
        <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem'}}>New Payout Address</label>
        <div style={{position:'relative'}}>
          <input style={{width:'100%',background:'var(--bg-deep)',border:`1px solid ${addr?'var(--border-hot)':'var(--border)'}`,color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.8rem',padding:'0.7rem 2.5rem 0.7rem 0.875rem',outline:'none'}}
            type={show?'text':'password'} placeholder="Leave blank to keep current" value={addr} onChange={e=>setAddr(e.target.value)} spellCheck={false} autoCorrect="off" autoCapitalize="off"/>
          <button onClick={()=>setShow(v=>!v)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:12}}>
            {show?'🙈':'👁'}
          </button>
        </div>
        <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem',marginTop:'1rem'}}>Pool Name</label>
        <input style={{width:'100%',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.8rem',padding:'0.7rem 0.875rem',outline:'none'}} maxLength={32} value={poolName} onChange={e=>setPoolName(e.target.value)}/>
        <div style={{height:1,background:'var(--border)',margin:'1.25rem 0'}}/>
        {[['Stratum Port','3333'],['Dashboard Port','1234'],['Protocol','Stratum V1']].map(([l,v])=>(
          <div key={l} style={{...statRow,marginBottom:'0.35rem'}}><span style={label}>{l}</span><span style={{fontFamily:'var(--fm)',color:'var(--cyan)',fontSize:'0.75rem'}}>{v}</span></div>
        ))}
        <button onClick={submit} disabled={loading} style={{width:'100%',marginTop:'1.25rem',padding:'0.75rem',background:saved?'var(--green)':'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.8rem',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',cursor:'pointer',opacity:loading?0.6:1,transition:'background 0.2s'}}>
          {loading?'SAVING…':saved?'✓ SAVED':'SAVE SETTINGS'}
        </button>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { state, connected, blockAlert, saveConfig, getConfig } = usePool();
  const [showSettings, setShowSettings] = useState(false);
  const [settingsCfg, setSettingsCfg] = useState(null);
  const [dismissedAlert, setDismissedAlert] = useState(false);

  useEffect(()=>{ if(blockAlert) setDismissedAlert(false); }, [blockAlert]);

  const openSettings = async () => {
    try { const c=await getConfig(); setSettingsCfg(c); } catch {}
    setShowSettings(  if (state.status==='loading') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--fd)',fontSize:'0.75rem',letterSpacing:'0.2em',color:'var(--text-2)',textTransform:'uppercase',animation:'pulse 1.5s ease-in-out infinite'}}>
      Connecting to pool…
    </div>
  );

  if (state.status==='no_address'||state.status==='setup') return <SetupScreen onComplete={()=>window.location.reload()}/>;

  return (
    <>
      <div style={{minHeight:'100vh',display:'flex',flexDirection:'column'}}>
        <Header uptime={state.uptime} connected={connected} status={state.status} onSettings={openSettings}/>
        <Ticker state={state}/>
        <main style={{flex:1,padding:'1.25rem',maxWidth:1400,margin:'0 auto',width:'100%'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:'0.875rem'}}>
            <div style={{gridColumn:'span 2'}}><HashrateChart history={state.hashrate?.history} current={state.hashrate?.current}/></div>
            <div style={{gridColumn:'span 2'}}><WorkerGrid workers={state.workers}/></div>
            <NetworkStats network={state.network}/>
            <OddsDisplay odds={state.odds} hashrate={state.hashrate?.current} netHashrate={state.network?.hashrate}/>
            <ShareStats shares={state.shares} hashrate={state.hashrate?.current}/>
            <BestShareLeaderboard workers={state.workers} poolBest={state.bestshare}/>
            <BlockFeed blocks={state.blocks} blockAlert={blockAlert&&!dismissedAlert?blockAlert:null}/>
            <MempoolPanel mempool={state.mempool}/>
          </div>
        </main>
        <footer style={{borderTop:'1px solid var(--border)',padding:'0.6rem 1.5rem',display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'0.58rem',color:'var(--text-3)',letterSpacing:'0.08em',textTransform:'uppercase'}}>
          <span>SoloStrike v1.1 — ckpool-solo</span>
          <span>Stratum · Port <span style={{color:'var(--cyan)'}}>3333</span></span>
        </footer>
      </div>
      {showSettings&&<SettingsModal onClose={()=>setShowSettings(false)} saveConfig={saveConfig} currentConfig={settingsCfg}/>}
      {blockAlert&&!dismissedAlert&&<BlockAlert block={blockAlert} onDismiss={()=>setDismissedAlert(true)}/>}
    </>
  );
}

