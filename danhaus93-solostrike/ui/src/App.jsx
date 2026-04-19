import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { usePool } from './hooks/usePool.js';
import { fmtHr, fmtDiff, fmtNum, fmtUptime, fmtOdds, timeAgo, fmtPct, fmtDurationMs, fmtSats, fmtBtc, fmtFiat, CURRENCIES, blockTimeAgo } from './utils.js';

// ── Style tokens ──────────────────────────────────────────────────────────────
const card = { background:'var(--bg-surface)', border:'1px solid var(--border)', padding:'1.25rem' };
const cardTitle = { fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.2em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:'1rem' };
const statRow = { display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0.5rem 0.75rem', background:'var(--bg-raised)', border:'1px solid var(--border)', marginBottom:'0.35rem' };
const label = { fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--text-2)' };

const HEALTH_COLOR = { green:'var(--green)', amber:'var(--amber)', red:'var(--red)' };

function shortName(fullName) {
  if (!fullName || typeof fullName !== 'string') return fullName || '';
  const dot = fullName.indexOf('.');
  if (dot === -1) return fullName;
  return fullName.slice(dot + 1);
}

function fmtBytes(bytes) {
  if (!bytes) return '—';
  const mb = bytes / 1_000_000;
  if (mb < 1) return `${(bytes/1000).toFixed(0)} KB`;
  if (mb < 1000) return `${mb.toFixed(1)} MB`;
  return `${(mb/1000).toFixed(2)} GB`;
}

function parseClient(subversion) {
  if (!subversion) return { name:'—', version:'' };
  // Subversion looks like: /Satoshi:28.0.0/
  const m = subversion.match(/\/([^:]+):([^/]+)\//);
  if (!m) return { name:subversion, version:'' };
  const name = m[1] === 'Satoshi' ? 'Bitcoin Core' : m[1];
  return { name, version:m[2] };
}

const BTC_ADDR_RE = /^(bc1[a-z0-9]{6,87}|tb1[a-z0-9]{6,87}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/;
function isValidBtcAddress(a){ if(!a||typeof a!=='string')return false; const t=a.trim(); return t.length>=26&&t.length<=90&&BTC_ADDR_RE.test(t); }

const LS_CARD_ORDER = 'ss_card_order_v1';
const LS_CURRENCY   = 'ss_currency_v1';

// ── DraggableCard wrapper ─────────────────────────────────────────────────────
function DraggableCard({ id, onDragStart, onDragOver, onDrop, draggedId, children, spanTwo }) {
  const isDragging = draggedId === id;
  const classes = ['ss-card', spanTwo?'ss-span-2':'', isDragging?'ss-dragging':''].filter(Boolean).join(' ');
  return (
    <div className={classes}
      onDragOver={e=>{e.preventDefault(); onDragOver(id);}}
      onDrop={e=>{e.preventDefault(); onDrop(id);}}
    >
      <span className="ss-drag-handle" draggable
        onDragStart={e=>{ e.dataTransfer.effectAllowed='move'; try{e.dataTransfer.setData('text/plain', id);}catch{} onDragStart(id); }}
        title="Drag to reorder">≡</span>
      {children}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ uptime, connected, status, onSettings }) {
  const statusMap = { running:{c:'var(--green)',t:'MINING'}, mining:{c:'var(--green)',t:'MINING'}, no_address:{c:'var(--amber)',t:'SETUP'}, setup:{c:'var(--amber)',t:'SETUP'}, starting:{c:'var(--amber)',t:'STARTING'}, error:{c:'var(--red)',t:'ERROR'}, loading:{c:'var(--text-2)',t:'...'} };
  const st = statusMap[status] || statusMap.loading;
  return (
    <header style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 1rem', height:52, borderBottom:'1px solid var(--border)', background:'rgba(6,7,8,0.95)', backdropFilter:'blur(8px)', position:'sticky', top:0, zIndex:50, gap:'0.5rem' }}>
      <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', minWidth:0 }}>
        <span style={{ fontSize:18, color:'var(--amber)', filter:'drop-shadow(0 0 8px rgba(245,166,35,0.7))', animation:'pulse 3s ease-in-out infinite' }}>⛏</span>
        <span style={{ fontFamily:'var(--fd)', fontSize:'1rem', fontWeight:700, letterSpacing:'0.08em', color:'var(--amber)', textTransform:'uppercase' }}>SoloStrike</span>
        <div style={{ width:1, height:18, background:'var(--border)' }}/>
        <div style={{ display:'flex', alignItems:'center', gap:5, fontFamily:'var(--fd)', fontSize:'0.6rem', letterSpacing:'0.15em', textTransform:'uppercase' }}>
          <div style={{ width:6, height:6, borderRadius:'50%', background:st.c, boxShadow:`0 0 8px ${st.c}`, animation:'pulse 2s ease-in-out infinite' }}/>
          <span style={{ color:st.c }}>{st.t}</span>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:'0.6rem', fontFamily:'var(--fd)', fontSize:'0.58rem', color:'var(--text-2)', letterSpacing:'0.08em' }}>
        <span>UP {fmtUptime(uptime)}</span>
        <div style={{ width:1, height:14, background:'var(--border)' }}/>
        <span style={{ color: connected?'var(--cyan)':'var(--text-2)' }}>{connected?'● LIVE':'○ RECONN'}</span>
        <button onClick={onSettings} style={{ background:'none', border:'none', color:'var(--text-2)', cursor:'pointer', fontSize:16, padding:'4px 8px' }}>⚙</button>
      </div>
    </header>
  );
}

// ── Latest Block hero strip (NEW) ─────────────────────────────────────────────
function LatestBlockStrip({ netBlocks, blockReward }) {
  const latest = netBlocks?.[0];
  if (!latest) return null;
  const rewardBtc = latest.reward != null ? (latest.reward / 1e8) : blockReward?.totalBtc;
  return (
    <div style={{
      background:'linear-gradient(90deg, rgba(245,166,35,0.06) 0%, rgba(6,7,8,0.95) 60%)',
      borderBottom:'1px solid var(--border)',
      padding:'0.55rem 1rem',
      display:'flex', alignItems:'center', gap:'0.75rem',
      fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.08em',
      textTransform:'uppercase',
      overflowX:'auto', whiteSpace:'nowrap',
    }}>
      <span style={{color:'var(--amber)', fontWeight:700}}>⛏ LATEST BLOCK</span>
      <span style={{color:'var(--text-2)'}}>·</span>
      <span style={{color:'var(--cyan)', fontFamily:'var(--fm)', fontWeight:700}}>#{fmtNum(latest.height)}</span>
      <span style={{color:'var(--text-2)'}}>·</span>
      <span style={{color: latest.isSolo?'var(--amber)':'var(--text-1)', fontWeight:600}}>
        {latest.pool}{latest.isSolo && <span style={{marginLeft:6, fontSize:'0.52rem', border:'1px solid var(--amber)', padding:'1px 4px'}}>SOLO</span>}
      </span>
      <span style={{color:'var(--text-2)'}}>·</span>
      <span style={{color:'var(--text-1)', fontFamily:'var(--fm)'}}>{blockTimeAgo(latest.timestamp)}</span>
      {rewardBtc && (<>
        <span style={{color:'var(--text-2)'}}>·</span>
        <span style={{color:'var(--green)', fontFamily:'var(--fm)'}}>{rewardBtc.toFixed(3)} BTC</span>
      </>)}
      <a href={`https://mempool.space/block/${latest.id}`} target="_blank" rel="noopener noreferrer" style={{marginLeft:'auto', color:'var(--text-2)', fontSize:13, fontFamily:'var(--fm)'}}>↗</a>
    </div>
  );
}

// ── Ticker ────────────────────────────────────────────────────────────────────
function Ticker({ state }) {
  const online = (state.workers||[]).filter(w=>w.status!=='offline').length;
  const luckVal = state.luck?.luck;
  const items = [
    `WORKERS ${online}/${(state.workers||[]).length}`,
    `HEIGHT ${fmtNum(state.network?.height)}`,
    `DIFFICULTY ${fmtDiff(state.network?.difficulty)}`,
    `NET HASHRATE ${fmtHr(state.network?.hashrate)}`,
    `WORK ${fmtDiff(state.shares?.accepted || 0)}`,
    `EXPECTED ${fmtOdds(state.odds?.expectedDays)}`,
    `BEST ${fmtDiff(state.bestshare||0)}`,
    luckVal!=null ? `LUCK ${fmtPct(luckVal,1)}` : null,
    state.retarget ? `RETARGET ${state.retarget.remainingBlocks}B (${fmtPct(state.retarget.difficultyChange,2)})` : null,
  ].filter(Boolean);
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
    <div style={card} className="fade-in">
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

// ── Worker grid (NOW WITH SEARCH) ─────────────────────────────────────────────
function WorkerGrid({ workers }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const sorted = [...(workers||[])].sort(
    (a,b)=>(a.status==='offline'?1:-1)-(b.status==='offline'?1:-1)||(b.hashrate||0)-(a.hashrate||0)
  );
  const filtered = q
    ? sorted.filter(w =>
        (w.name||'').toLowerCase().includes(q) ||
        (shortName(w.name)||'').toLowerCase().includes(q) ||
        (w.minerType||'').toLowerCase().includes(q)
      )
    : sorted;
  const online = sorted.filter(w=>w.status!=='offline').length;

  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>▸ Connected Workers</span>
        <span style={{color:'var(--amber)'}}>{online}/{sorted.length} online</span>
      </div>

      {sorted.length > 3 && (
        <div style={{position:'relative', marginBottom:'0.5rem'}}>
          <span style={{position:'absolute', left:10, top:'50%', transform:'translateY(-50%)', fontSize:12, color:'var(--text-2)', pointerEvents:'none'}}>🔍</span>
          <input
            type="text"
            value={query}
            onChange={e=>setQuery(e.target.value)}
            placeholder="Filter workers by name or miner type…"
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
            style={{
              width:'100%',
              background:'var(--bg-deep)',
              border:'1px solid var(--border)',
              color:'var(--text-1)',
              fontFamily:'var(--fm)',
              fontSize:'0.75rem',
              padding:'0.5rem 0.6rem 0.5rem 2rem',
              outline:'none',
            }}
          />
          {query && (
            <button onClick={()=>setQuery('')}
              style={{position:'absolute', right:6, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', color:'var(--text-2)', cursor:'pointer', fontSize:14, padding:'4px 6px'}}>✕</button>
          )}
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)',lineHeight:2}}>
          {q
            ? <>No workers match "<span style={{color:'var(--amber)'}}>{query}</span>"</>
            : <>No miners connected yet.<br/>
                <span style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--cyan)'}}>stratum+tcp://umbrel.local:3333</span>
                <br/><span style={{color:'var(--text-3)',fontSize:'0.65rem'}}>user: worker_name · pass: x</span></>
          }
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem'}}>
          {filtered.map(w=>{
            const on=w.status!=='offline';
            const workAccepted = w.shares || 0;
            const workRejected = w.rejected || 0;
            const totalWork = workAccepted + workRejected || 1;
            const healthC = HEALTH_COLOR[w.health] || 'var(--text-3)';
            const icon = w.minerIcon || '▪';
            return(
              <div key={w.name} style={{display:'flex',alignItems:'center',gap:'0.6rem',padding:'0.6rem 0.875rem',background:'var(--bg-raised)',border:`1px solid ${on?'rgba(57,255,106,0.12)':'transparent'}`,opacity:on?1:0.45}}>
                <div title={w.health||'unknown'} style={{width:8,height:8,borderRadius:'50%',flexShrink:0,background:on?healthC:'var(--text-3)',boxShadow:on?`0 0 6px ${healthC}`:'none',animation:on?'pulse 2s ease-in-out infinite':'none'}}/>
                <span title={w.minerType||'Unknown'} style={{fontSize:13,color:on?'var(--cyan)':'var(--text-3)',width:16,textAlign:'center',flexShrink:0}}>{icon}</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:'var(--fm)',fontSize:'0.82rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontWeight:500}} title={w.name}>
                    {shortName(w.name)}
                    {w.minerType && <span style={{fontFamily:'var(--fd)',fontSize:'0.54rem',letterSpacing:'0.1em',color:'var(--text-3)',marginLeft:8,textTransform:'uppercase'}}>{w.minerType}</span>}
                  </div>
                  <div style={{display:'flex',gap:8,alignItems:'center',marginTop:3}}>
                    <div style={{flex:1,height:2,background:'var(--bg-deep)',borderRadius:1,overflow:'hidden'}}>
                      <div style={{height:'100%',width:`${(workAccepted/totalWork)*100}%`,background:'var(--green)',borderRadius:1}}/>
                    </div>
                    {w.diff>0 && <span style={{fontFamily:'var(--fm)',fontSize:'0.55rem',color:'var(--text-3)',whiteSpace:'nowrap'}}>diff {fmtDiff(w.diff)}</span>}
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:1}}>
                  <span style={{fontFamily:'var(--fm)',fontSize:'0.62rem',color:'var(--text-2)'}}>
                    <span style={{color:'var(--green)'}}>{fmtDiff(workAccepted)}</span>/<span style={{color:'var(--red)'}}>{fmtDiff(workRejected)}</span>
                  </span>
                  {w.bestshare>0 && <span style={{fontFamily:'var(--fm)',fontSize:'0.55rem',color:'var(--amber)'}}>best {fmtDiff(w.bestshare)}</span>}
                </div>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.78rem',fontWeight:600,color:on?'var(--amber)':'var(--text-2)',minWidth:72,textAlign:'right'}}>
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

// ── Bitcoin Network ───────────────────────────────────────────────────────────
function NetworkStats({ network, blockReward, mempool, prices, currency }) {
  const price = prices?.[currency];
  const rewardUsd = price && blockReward ? blockReward.totalBtc * price : null;
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Bitcoin Network</div>
      {[['Block Height', fmtNum(network?.height), 'var(--text-1)'],
        ['Difficulty', fmtDiff(network?.difficulty), 'var(--text-1)'],
        ['Net Hashrate', fmtHr(network?.hashrate), 'var(--cyan)']].map(([l,v,c])=>(
        <div key={l} style={statRow}>
          <span style={label}>{l}</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:c,textShadow:c==='var(--cyan)'?'0 0 10px rgba(0,255,209,0.3)':'none'}}>{v}</span>
        </div>
      ))}
      <div style={{height:1,background:'var(--border)',margin:'0.7rem 0'}}/>
      {blockReward && (
        <div style={statRow}>
          <span style={label}>Block Reward</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.82rem',fontWeight:600,color:'var(--amber)',textAlign:'right'}}>
            {fmtBtc(blockReward.totalBtc, 3)}
            {rewardUsd!=null && <div style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',fontWeight:400,marginTop:2}}>{fmtFiat(rewardUsd, currency)}</div>}
          </span>
        </div>
      )}
      {price!=null && (
        <div style={statRow}>
          <span style={label}>BTC Price</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:'var(--cyan)'}}>{fmtFiat(price, currency)}</span>
        </div>
      )}
      {mempool?.totalFeesBtc>0 && (
        <div style={statRow}>
          <span style={label}>Mempool Fees</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--amber)'}}>{fmtBtc(mempool.totalFeesBtc, 2)}</span>
        </div>
      )}
      {mempool?.feeRate!=null && (
        <div style={statRow}>
          <span style={label}>Priority Fee</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--amber)'}}>{mempool.feeRate} sat/vB</span>
        </div>
      )}
    </div>
  );
}

// ── Bitcoin Node panel (NEW) ──────────────────────────────────────────────────
function BitcoinNodePanel({ nodeInfo }) {
  const ni = nodeInfo || {};
  const client = parseClient(ni.subversion);
  const connected = ni.connected;
  const relayStr = ni.relayFee != null ? `${(ni.relayFee * 1e5).toFixed(2)} sat/vB` : '—';
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <span>▸ Bitcoin Node</span>
        <span style={{display:'inline-flex', alignItems:'center', gap:5, color: connected?'var(--green)':'var(--red)', fontSize:'0.55rem', letterSpacing:'0.12em'}}>
          <span style={{width:6, height:6, borderRadius:'50%', background: connected?'var(--green)':'var(--red)', boxShadow: connected?'0 0 6px var(--green)':'0 0 6px var(--red)', animation: connected?'pulse 2s ease-in-out infinite':'none'}}/>
          {connected ? 'CONNECTED' : 'OFFLINE'}
        </span>
      </div>
      <div style={statRow}>
        <span style={label}>Client</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)',textAlign:'right'}}>
          {client.name}
          {client.version && <div style={{fontSize:'0.6rem',color:'var(--text-2)',marginTop:2}}>v{client.version}</div>}
        </span>
      </div>
      <div style={statRow}>
        <span style={label}>Peers</span>
        <span style={{fontFamily:'var(--fd)',fontSize:'0.88rem',fontWeight:600,color:'var(--cyan)'}}>
          {fmtNum(ni.peers || 0)}
          {(ni.peersIn > 0 || ni.peersOut > 0) && (
            <span style={{fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',fontWeight:400,marginLeft:6}}>
              {ni.peersOut}↑ · {ni.peersIn}↓
            </span>
          )}
        </span>
      </div>
      <div style={statRow}>
        <span style={label}>Relay Fee</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--amber)'}}>{relayStr}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Mempool TXs</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{fmtNum(ni.mempoolCount || 0)}</span>
      </div>
      <div style={statRow}>
        <span style={label}>Mempool Size</span>
        <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--cyan)'}}>{fmtBytes(ni.mempoolBytes || 0)}</span>
      </div>
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
      </div>
    </div>
  );
}

// ── Luck gauge ────────────────────────────────────────────────────────────────
function LuckGauge({ luck }) {
  const { progress=0, blocksExpected=0, blocksFound=0, luck: luckVal=null } = luck||{};
  const visualPct = Math.min(300, progress);
  const w = Math.min(100, visualPct/3);
  const barColor = luckVal==null ? 'var(--amber)' : (luckVal>=100 ? 'var(--green)' : luckVal>=50 ? 'var(--amber)' : 'var(--red)');
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Luck — Since Pool Start</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.6rem'}}>
        <div style={{textAlign:'center',padding:'0.6rem 0'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'2rem',fontWeight:700,color:barColor,textShadow:`0 0 20px ${barColor}50`,lineHeight:1}}>
            {luckVal==null ? '—' : fmtPct(luckVal, 1)}
          </div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginTop:4}}>
            {luckVal==null ? 'warming up' : luckVal>=100 ? 'lucky' : 'unlucky so far'}
          </div>
        </div>
        <div>
          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:4}}>
            <span>Progress to next block</span>
            <span style={{color:'var(--amber)'}}>{fmtPct(progress,2)}</span>
          </div>
          <div style={{height:4,background:'var(--bg-deep)',borderRadius:2,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${w}%`,background:barColor,boxShadow:`0 0 8px ${barColor}80`,transition:'width 0.6s ease'}}/>
          </div>
        </div>
        <div style={{...statRow,marginBottom:0}}>
          <span style={label}>Blocks Expected</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{blocksExpected.toFixed(3)}</span>
        </div>
        <div style={{...statRow,marginBottom:0}}>
          <span style={label}>Blocks Found</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:blocksFound>0?'var(--green)':'var(--text-1)'}}>{blocksFound}</span>
        </div>
      </div>
    </div>
  );
}

// ── Retarget ──────────────────────────────────────────────────────────────────
function RetargetPanel({ retarget }) {
  if (!retarget) return null;
  const { progressPercent=0, difficultyChange=0, remainingBlocks=0, remainingTime=0, nextRetargetHeight } = retarget;
  const changeColor = difficultyChange>=0 ? 'var(--red)' : 'var(--green)';
  const pct = Math.max(0, Math.min(100, progressPercent));
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Difficulty Retarget</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.5rem'}}>
        <div style={{textAlign:'center',padding:'0.25rem 0'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.6rem',fontWeight:700,color:changeColor,textShadow:`0 0 14px ${changeColor}50`,lineHeight:1}}>
            {difficultyChange>=0?'+':''}{difficultyChange.toFixed(2)}%
          </div>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginTop:4}}>estimated change</div>
        </div>
        <div>
          <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:4}}>
            <span>Epoch progress</span>
            <span style={{color:'var(--cyan)'}}>{pct.toFixed(1)}%</span>
          </div>
          <div style={{height:3,background:'var(--bg-deep)',borderRadius:2,overflow:'hidden'}}>
            <div style={{height:'100%',width:`${pct}%`,background:'var(--cyan)',boxShadow:'0 0 8px rgba(0,255,209,0.5)',transition:'width 0.6s ease'}}/>
          </div>
        </div>
        <div style={{...statRow,marginBottom:0}}>
          <span style={label}>Remaining Blocks</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)'}}>{fmtNum(remainingBlocks)}</span>
        </div>
        <div style={{...statRow,marginBottom:0}}>
          <span style={label}>ETA</span>
          <span style={{fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--amber)'}}>{fmtDurationMs(remainingTime)}</span>
        </div>
      </div>
    </div>
  );
}

// ── Share stats ───────────────────────────────────────────────────────────────
function ShareStats({ shares, hashrate, bestshare }) {
  const s = shares || {};
  const workAccepted = s.accepted || 0;
  const workRejected = s.rejected || 0;
  const stale = s.stale || 0;
  const total = workAccepted + workRejected || 1;
  const acceptRate = ((workAccepted / total) * 100).toFixed(2);
  const sharesPerMin = hashrate > 0 ? (hashrate / 4294967296 * 60).toFixed(1) : '0';
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>▸ Share Stats</span>
        <a href="/api/export/workers.csv" download style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',color:'var(--cyan)',textDecoration:'none',border:'1px solid var(--border)',padding:'2px 6px',background:'var(--bg-raised)'}}>⬇ CSV</a>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.6rem'}}>
        <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.875rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Work Accepted</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.8rem',fontWeight:700,color:'var(--green)',lineHeight:1}}>{fmtDiff(workAccepted)}</div>
          <div style={{fontFamily:'var(--fm)',fontSize:'0.7rem',color:'var(--text-2)',marginTop:6}}>
            <span style={{color:'var(--red)'}}>{fmtDiff(workRejected)}</span> rejected
            {stale>0 && <> · <span style={{color:'var(--amber)'}}>{fmtDiff(stale)}</span> stale</>}
            {workAccepted>0 && <> · <span style={{color:parseFloat(acceptRate)>99.9?'var(--green)':'var(--amber)'}}>{acceptRate}%</span> accept</>}
          </div>
        </div>
        <div style={{background:'var(--bg-raised)',border:'1px solid var(--border)',padding:'0.875rem'}}>
          <div style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.15em',color:'var(--text-2)',textTransform:'uppercase',marginBottom:6}}>Best Difficulty</div>
          <div style={{fontFamily:'var(--fd)',fontSize:'1.8rem',fontWeight:700,color:'var(--amber)',lineHeight:1,textShadow:'0 0 14px rgba(245,166,35,0.3)'}}>{fmtDiff(bestshare||0)}<span style={{fontSize:'0.6rem',color:'var(--text-2)',marginLeft:6,fontWeight:400}}>all-time</span></div>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontFamily:'var(--fm)',fontSize:'0.6rem',color:'var(--text-2)',marginTop:'0.2rem'}}>
          <span>Shares / min (est.)</span>
          <span style={{color:'var(--cyan)'}}>{sharesPerMin}</span>
        </div>
      </div>
    </div>
  );
}

// ── Best Share Leaderboard (UPGRADED — now shows hashrate, miner, status) ────
function BestShareLeaderboard({ workers, poolBest }) {
  const sorted = [...(workers || [])]
    .filter(w => (w.bestshare||0) > 0)
    .sort((a, b) => (b.bestshare || 0) - (a.bestshare || 0))
    .slice(0, 5);
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Leaderboard — Best Difficulties</div>
      {sorted.length === 0 ? (
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.72rem',fontFamily:'var(--fd)'}}>
          No shares submitted yet<br/>
          <span style={{color:'var(--amber)',fontSize:'0.65rem'}}>Keep mining ⛏</span>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'0.35rem'}}>
          {sorted.map((w, i) => {
            const on = w.status !== 'offline';
            const healthC = HEALTH_COLOR[w.health] || 'var(--text-3)';
            return (
              <div key={w.name} style={{padding:'0.55rem 0.7rem',background:'var(--bg-raised)',border:`1px solid ${i===0?'rgba(245,166,35,0.3)':'var(--border)'}`,opacity:on?1:0.55}}>
                <div style={{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:3}}>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.7rem',fontWeight:700,color:i===0?'var(--amber)':'var(--text-2)',minWidth:20}}>#{i+1}</span>
                  <div style={{flex:1,minWidth:0,fontFamily:'var(--fm)',fontSize:'0.78rem',color:'var(--text-1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={w.name}>
                    {shortName(w.name)}
                  </div>
                  <span style={{fontFamily:'var(--fd)',fontSize:'0.82rem',fontWeight:700,color:i===0?'var(--amber)':'var(--cyan)'}}>
                    {fmtDiff(w.bestshare || 0)}
                  </span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'0.5rem',paddingLeft:25,fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-2)'}}>
                  <div title={w.health||'unknown'} style={{width:6,height:6,borderRadius:'50%',background:on?healthC:'var(--text-3)',boxShadow:on?`0 0 4px ${healthC}`:'none',flexShrink:0}}/>
                  {w.minerType && <span style={{color:'var(--text-3)',letterSpacing:'0.05em',textTransform:'uppercase',fontSize:'0.55rem'}}>{w.minerType}</span>}
                  {w.minerType && <span style={{color:'var(--text-3)'}}>·</span>}
                  <span style={{color: on?'var(--amber)':'var(--text-3)'}}>{on ? fmtHr(w.hashrate) : 'offline'}</span>
                </div>
              </div>
            );
          })}
          <div style={{...statRow,marginTop:'0.4rem',borderColor:'var(--border-hot)'}}>
            <span style={label}>Pool Best</span>
            <span style={{fontFamily:'var(--fd)',fontSize:'0.9rem',fontWeight:700,color:'var(--amber)',textShadow:'0 0 8px rgba(245,166,35,0.4)'}}>
              {fmtDiff(poolBest || 0)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Top Pool Finders ──────────────────────────────────────────────────────────
function TopFindersPanel({ topFinders, netBlocks }) {
  const list = topFinders || [];
  const totalSample = (netBlocks||[]).length;
  if (!list.length) return null;
  const maxCount = list[0]?.count || 1;
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Top Pool Finders — Last {totalSample} Blocks</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.35rem'}}>
        {list.map((p,i)=>{
          const pct = (p.count/maxCount)*100;
          const color = p.isSolo ? 'var(--amber)' : (i===0 ? 'var(--cyan)' : 'var(--text-1)');
          return (
            <div key={p.name} style={{padding:'0.5rem 0.8rem',background:'var(--bg-raised)',border:`1px solid ${i===0?'rgba(0,255,209,0.2)':'var(--border)'}`,position:'relative',overflow:'hidden'}}>
              <div style={{position:'absolute',inset:0,width:`${pct}%`,background:p.isSolo?'rgba(245,166,35,0.06)':'rgba(0,255,209,0.04)',transition:'width 0.6s ease'}}/>
              <div style={{position:'relative',display:'flex',alignItems:'center',gap:'0.6rem'}}>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.65rem',fontWeight:700,color:i===0?'var(--cyan)':'var(--text-2)',width:18}}>#{i+1}</span>
                <div style={{flex:1,minWidth:0,fontFamily:'var(--fd)',fontSize:'0.72rem',color,letterSpacing:'0.05em',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',textTransform:'uppercase'}}>
                  {p.name}
                  {p.isSolo && <span style={{fontSize:'0.5rem',color:'var(--amber)',marginLeft:6,border:'1px solid var(--amber)',padding:'0 4px'}}>SOLO</span>}
                </div>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:700,color}}>{p.count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Block feed ────────────────────────────────────────────────────────────────
function BlockFeed({ blocks, blockAlert }) {
  return (
    <div style={card} className="fade-in">
      <div style={{...cardTitle,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span>▸ Blocks Found — {(blocks||[]).length} total</span>
        {(blocks||[]).length>0 && <a href="/api/export/blocks.csv" download style={{fontFamily:'var(--fd)',fontSize:'0.55rem',letterSpacing:'0.1em',color:'var(--cyan)',textDecoration:'none',border:'1px solid var(--border)',padding:'2px 6px',background:'var(--bg-raised)'}}>⬇ CSV</a>}
      </div>
      {!(blocks||[]).length?(
        <div style={{textAlign:'center',padding:'1.5rem',border:'1px dashed var(--border)',color:'var(--text-2)',fontSize:'0.75rem',fontFamily:'var(--fd)'}}>
          No blocks found yet.<br/><span style={{color:'var(--amber)',fontSize:'0.68rem'}}>Keep mining ⛏</span>
        </div>
      ):(
        <div style={{display:'flex',flexDirection:'column',gap:'0.4rem',maxHeight:240,overflowY:'auto'}}>
          {blocks.map((b,i)=>(
            <div key={b.hash} style={{display:'flex',alignItems:'center',gap:'0.75rem',padding:'0.7rem 1rem',background:'var(--bg-raised)',border:`1px solid ${blockAlert&&i===0?'var(--green)':'rgba(57,255,106,0.15)'}`,animation:blockAlert&&i===0?'blockBoom 0.6s ease':'none'}}>
              <span style={{fontSize:16}}>💎</span>
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

// ── Recent network blocks ─────────────────────────────────────────────────────
function RecentBlocksPanel({ netBlocks }) {
  const list = netBlocks || [];
  if (!list.length) return null;
  return (
    <div style={card} className="fade-in">
      <div style={cardTitle}>▸ Recent Network Blocks — Solo Winners ⚡</div>
      <div style={{display:'flex',flexDirection:'column',gap:'0.35rem',maxHeight:300,overflowY:'auto'}}>
        {list.slice(0,15).map(b=>(
          <div key={b.id} style={{display:'flex',alignItems:'center',gap:'0.6rem',padding:'0.55rem 0.8rem',background:'var(--bg-raised)',border:`1px solid ${b.isSolo?'rgba(245,166,35,0.35)':'var(--border)'}`,boxShadow:b.isSolo?'0 0 10px rgba(245,166,35,0.12)':'none'}}>
            <span style={{fontSize:13,color:b.isSolo?'var(--amber)':'var(--text-3)',flexShrink:0}}>{b.isSolo?'⚡':'▪'}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.78rem',fontWeight:600,color:b.isSolo?'var(--amber)':'var(--text-1)'}}>#{fmtNum(b.height)}</span>
                <span style={{fontFamily:'var(--fd)',fontSize:'0.58rem',letterSpacing:'0.1em',color:b.isSolo?'var(--amber)':'var(--text-2)',textTransform:'uppercase'}}>{b.pool}</span>
                {b.isSolo && <span style={{fontFamily:'var(--fd)',fontSize:'0.52rem',color:'var(--amber)',border:'1px solid var(--amber)',padding:'1px 5px',letterSpacing:'0.12em'}}>SOLO</span>}
              </div>
              <div style={{fontFamily:'var(--fm)',fontSize:'0.58rem',color:'var(--text-3)',marginTop:2}}>
                {fmtNum(b.tx_count||0)} tx · {blockTimeAgo(b.timestamp)}
                {b.reward!=null && <> · <span style={{color:'var(--cyan)'}}>{fmtSats(b.reward)}</span></>}
              </div>
            </div>
            <a href={`https://mempool.space/block/${b.id}`} target="_blank" rel="noopener noreferrer" style={{color:'var(--text-2)',fontSize:12,flexShrink:0}}>↗</a>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Confetti + BlockAlert ─────────────────────────────────────────────────────
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
function BlockAlert({ block, onDismiss }) {
  if(!block) return null;
  return(<>
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
  </>);
}

// ── Setup & Settings (unchanged) ──────────────────────────────────────────────
function SetupScreen({ onComplete }) {
  const [addr,setAddr]=useState(''); const [loading,setLoading]=useState(false); const [error,setError]=useState('');
  const looksValid = isValidBtcAddress(addr);
  const submit = async () => {
    if(!addr.trim()){setError('Please enter a Bitcoin address.');return;}
    if(!looksValid){setError("That doesn't look like a valid Bitcoin address.");return;}
    setLoading(true);setError('');
    try{ const r=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payoutAddress:addr.trim()})}); const d=await r.json(); if(!r.ok){setError(d.error||'Invalid address.');return;} onComplete(); }
    catch{setError('Cannot reach pool API.');} finally{setLoading(false);}
  };
  return (
    <div style={{position:'fixed',inset:0,background:'var(--bg-void)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100,padding:'1rem'}}>
      <div style={{width:'100%',maxWidth:500,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',padding:'2rem',boxShadow:'var(--glow-a)'}}>
        <div style={{display:'flex',alignItems:'center',gap:'0.75rem',marginBottom:'0.5rem'}}>
          <span style={{fontSize:22,color:'var(--amber)'}}>⛏</span>
          <span style={{fontFamily:'var(--fd)',fontSize:'1.6rem',fontWeight:700,color:'var(--amber)',letterSpacing:'0.08em'}}>SOLOSTRIKE</span>
        </div>
        <p style={{fontFamily:'var(--fd)',fontSize:'0.65rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'2rem'}}>Initial Setup — Enter Payout Address</p>
        <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.62rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem'}}>Bitcoin Payout Address</label>
        <input style={{width:'100%',background:'var(--bg-deep)',border:`1px solid ${error?'rgba(255,59,59,0.5)':addr?'var(--border-hot)':'var(--border)'}`,color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.82rem',padding:'0.75rem 1rem',outline:'none'}}
          type="text" placeholder="bc1q… or 1… or 3…" value={addr} onChange={e=>{setAddr(e.target.value);setError('');}} onKeyDown={e=>e.key==='Enter'&&submit()} spellCheck={false} autoCorrect="off" autoCapitalize="off"/>
        {error&&<div style={{background:'rgba(255,59,59,0.08)',border:'1px solid rgba(255,59,59,0.3)',padding:'0.6rem 0.875rem',fontSize:'0.75rem',color:'var(--red)',marginTop:'0.75rem'}}>⚠ {error}</div>}
        <button onClick={submit} disabled={loading} style={{width:'100%',marginTop:'1.5rem',padding:'0.875rem',background:'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:700,letterSpacing:'0.15em',textTransform:'uppercase',cursor:'pointer',opacity:loading?0.6:1}}>
          {loading?'SAVING…':'START MINING →'}
        </button>
      </div>
    </div>
  );
}

function SettingsModal({ onClose, saveConfig, currentConfig, currency, onCurrencyChange, onResetLayout }) {
  const [addr,setAddr]=useState(''); const [poolName,setPoolName]=useState(currentConfig?.poolName||'SoloStrike');
  const [show,setShow]=useState(false); const [loading,setLoading]=useState(false); const [saved,setSaved]=useState(false); const [error,setError]=useState('');
  const submit = async () => {
    setLoading(true);setError('');setSaved(false);
    try{
      const p={poolName}; const trimmed=addr.trim();
      if(trimmed){ if(!isValidBtcAddress(trimmed)){setError("That doesn't look like a valid Bitcoin address.");setLoading(false);return;} p.payoutAddress=trimmed; }
      await saveConfig(p); setSaved(true); setAddr(''); setTimeout(()=>setSaved(false),3000);
    } catch(e){setError(e.message);} finally{setLoading(false);}
  };
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(6,7,8,0.88)',backdropFilter:'blur(4px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:'1rem'}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{width:'100%',maxWidth:460,background:'var(--bg-surface)',border:'1px solid var(--border-hot)',padding:'1.75rem',boxShadow:'var(--glow-a)',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'1.5rem'}}>
          <span style={{fontFamily:'var(--fd)',fontSize:'0.85rem',fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--amber)'}}>⚙ Settings</span>
          <button onClick={onClose} style={{background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:18}}>✕</button>
        </div>
        {saved&&<div style={{background:'rgba(57,255,106,0.06)',border:'1px solid rgba(57,255,106,0.2)',padding:'0.5rem 0.75rem',fontSize:'0.72rem',color:'var(--green)',marginBottom:'1rem'}}>✓ Saved successfully</div>}
        {error&&<div style={{background:'rgba(255,59,59,0.06)',border:'1px solid rgba(255,59,59,0.2)',padding:'0.5rem 0.75rem',fontSize:'0.72rem',color:'var(--red)',marginBottom:'1rem'}}>⚠ {error}</div>}
        <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem'}}>New Payout Address</label>
        <div style={{position:'relative'}}>
          <input style={{width:'100%',background:'var(--bg-deep)',border:`1px solid ${addr?'var(--border-hot)':'var(--border)'}`,color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.8rem',padding:'0.7rem 2.5rem 0.7rem 0.875rem',outline:'none'}}
            type={show?'text':'password'} placeholder="Leave blank to keep current" value={addr} onChange={e=>setAddr(e.target.value)} spellCheck={false} autoCorrect="off" autoCapitalize="off"/>
          <button onClick={()=>setShow(v=>!v)} style={{position:'absolute',right:8,top:'50%',transform:'translateY(-50%)',background:'none',border:'none',color:'var(--text-2)',cursor:'pointer',fontSize:12}}>{show?'🙈':'👁'}</button>
        </div>
        <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem',marginTop:'1rem'}}>Pool Name</label>
        <input style={{width:'100%',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.8rem',padding:'0.7rem 0.875rem',outline:'none'}} maxLength={32} value={poolName} onChange={e=>setPoolName(e.target.value)}/>
        <label style={{display:'block',fontFamily:'var(--fd)',fontSize:'0.6rem',letterSpacing:'0.15em',textTransform:'uppercase',color:'var(--text-2)',marginBottom:'0.4rem',marginTop:'1rem'}}>BTC Price Currency</label>
        <select value={currency} onChange={e=>onCurrencyChange(e.target.value)} style={{width:'100%',background:'var(--bg-deep)',border:'1px solid var(--border)',color:'var(--text-1)',fontFamily:'var(--fm)',fontSize:'0.8rem',padding:'0.7rem 0.875rem',outline:'none'}}>
          {CURRENCIES.map(c=><option key={c} value={c}>{c}</option>)}
        </select>
        <div style={{height:1,background:'var(--border)',margin:'1.25rem 0'}}/>
        <button onClick={onResetLayout} style={{width:'100%',padding:'0.6rem',background:'var(--bg-raised)',color:'var(--text-2)',border:'1px solid var(--border)',fontFamily:'var(--fd)',fontSize:'0.7rem',fontWeight:600,letterSpacing:'0.1em',textTransform:'uppercase',cursor:'pointer',marginBottom:'0.75rem'}}>↺ Reset Card Layout</button>
        <button onClick={submit} disabled={loading} style={{width:'100%',padding:'0.75rem',background:saved?'var(--green)':'var(--amber)',color:'#000',border:'none',fontFamily:'var(--fd)',fontSize:'0.8rem',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',cursor:'pointer',opacity:loading?0.6:1}}>
          {loading?'SAVING…':saved?'✓ SAVED':'SAVE SETTINGS'}
        </button>
      </div>
    </div>
  );
}

// ── Card order & localStorage ─────────────────────────────────────────────────
const DEFAULT_ORDER = [
  'hashrate', 'workers', 'network', 'node', 'odds', 'luck', 'retarget',
  'shares', 'best', 'blocks', 'topfinders', 'recent',
];
function loadOrder() {
  try {
    const saved = localStorage.getItem(LS_CARD_ORDER);
    if (!saved) return DEFAULT_ORDER;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return DEFAULT_ORDER;
    const merged = [...parsed];
    DEFAULT_ORDER.forEach(k => { if (!merged.includes(k)) merged.push(k); });
    return merged.filter(k => DEFAULT_ORDER.includes(k));
  } catch { return DEFAULT_ORDER; }
}
function saveOrder(order) { try { localStorage.setItem(LS_CARD_ORDER, JSON.stringify(order)); } catch {} }
function loadCurrency() { try { return localStorage.getItem(LS_CURRENCY) || 'USD'; } catch { return 'USD'; } }
function saveCurrency(c) { try { localStorage.setItem(LS_CURRENCY, c); } catch {} }

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const { state, connected, blockAlert, saveConfig, getConfig } = usePool();
  const [showSettings, setShowSettings] = useState(false);
  const [settingsCfg, setSettingsCfg] = useState(null);
  const [dismissedAlert, setDismissedAlert] = useState(false);
  const [order, setOrder] = useState(loadOrder);
  const [currency, setCurrency] = useState(loadCurrency);
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  useEffect(()=>{ if(blockAlert) setDismissedAlert(false); }, [blockAlert]);

  const openSettings = async () => {
    try { const c=await getConfig(); setSettingsCfg(c); } catch {}
    setShowSettings(true);
  };
  const handleCurrencyChange = (c) => { setCurrency(c); saveCurrency(c); };
  const handleResetLayout = () => { setOrder(DEFAULT_ORDER); saveOrder(DEFAULT_ORDER); };

  const onDragStart = (id) => setDraggedId(id);
  const onDragOver  = (id) => { if (id !== dragOverId) setDragOverId(id); };
  const onDrop      = (targetId) => {
    if (!draggedId || draggedId === targetId) { setDraggedId(null); setDragOverId(null); return; }
    const next = [...order];
    const from = next.indexOf(draggedId);
    const to   = next.indexOf(targetId);
    if (from < 0 || to < 0) { setDraggedId(null); setDragOverId(null); return; }
    next.splice(from, 1);
    next.splice(to, 0, draggedId);
    setOrder(next); saveOrder(next); setDraggedId(null); setDragOverId(null);
  };
  useEffect(() => {
    const endDrag = () => { setDraggedId(null); setDragOverId(null); };
    window.addEventListener('dragend', endDrag);
    return () => window.removeEventListener('dragend', endDrag);
  }, []);

  if (state.status==='loading') return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'var(--fd)',fontSize:'0.75rem',letterSpacing:'0.2em',color:'var(--text-2)',textTransform:'uppercase',animation:'pulse 1.5s ease-in-out infinite'}}>
      Connecting to pool…
    </div>
  );
  if (state.status==='no_address'||state.status==='setup') return <SetupScreen onComplete={()=>window.location.reload()}/>;

  const cards = {
    hashrate:   { spanTwo:true,  el:<HashrateChart history={state.hashrate?.history} current={state.hashrate?.current}/> },
    workers:    { spanTwo:true,  el:<WorkerGrid workers={state.workers}/> },
    network:    { spanTwo:false, el:<NetworkStats network={state.network} blockReward={state.blockReward} mempool={state.mempool} prices={state.prices} currency={currency}/> },
    node:       { spanTwo:false, el:<BitcoinNodePanel nodeInfo={state.nodeInfo}/> },
    odds:       { spanTwo:false, el:<OddsDisplay odds={state.odds} hashrate={state.hashrate?.current} netHashrate={state.network?.hashrate}/> },
    luck:       { spanTwo:false, el:<LuckGauge luck={state.luck}/> },
    retarget:   { spanTwo:false, el:<RetargetPanel retarget={state.retarget}/> },
    shares:     { spanTwo:false, el:<ShareStats shares={state.shares} hashrate={state.hashrate?.current} bestshare={state.bestshare}/> },
    best:       { spanTwo:false, el:<BestShareLeaderboard workers={state.workers} poolBest={state.bestshare}/> },
    blocks:     { spanTwo:false, el:<BlockFeed blocks={state.blocks} blockAlert={blockAlert&&!dismissedAlert?blockAlert:null}/> },
    topfinders: { spanTwo:false, el:<TopFindersPanel topFinders={state.topFinders} netBlocks={state.netBlocks}/> },
    recent:     { spanTwo:true,  el:<RecentBlocksPanel netBlocks={state.netBlocks}/> },
  };

  return (
    <>
      <div style={{minHeight:'100vh',display:'flex',flexDirection:'column'}}>
        <Header uptime={state.uptime} connected={connected} status={state.status} onSettings={openSettings}/>
        <Ticker state={state}/>
        <LatestBlockStrip netBlocks={state.netBlocks} blockReward={state.blockReward}/>
        <main style={{flex:1,padding:'1rem',maxWidth:1400,margin:'0 auto',width:'100%'}}>
          <div className="ss-grid">
            {order.map(id=>{
              const c = cards[id];
              if (!c || !c.el) return null;
              return (
                <DraggableCard key={id} id={id} spanTwo={c.spanTwo} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} draggedId={draggedId}>
                  {c.el}
                </DraggableCard>
              );
            })}
          </div>
        </main>
        <footer style={{borderTop:'1px solid var(--border)',padding:'0.6rem 1rem',display:'flex',justifyContent:'space-between',fontFamily:'var(--fd)',fontSize:'0.55rem',color:'var(--text-3)',letterSpacing:'0.08em',textTransform:'uppercase',gap:'0.5rem',flexWrap:'wrap'}}>
          <span>SoloStrike v1.2.3 — ckpool-solo</span>
          <span>Stratum · Port <span style={{color:'var(--cyan)'}}>3333</span></span>
        </footer>
      </div>
      {showSettings&&<SettingsModal onClose={()=>setShowSettings(false)} saveConfig={saveConfig} currentConfig={settingsCfg} currency={currency} onCurrencyChange={handleCurrencyChange} onResetLayout={handleResetLayout}/>}
      {blockAlert&&!dismissedAlert&&<BlockAlert block={blockAlert} onDismiss={()=>setDismissedAlert(true)}/>}
    </>
  );
}
