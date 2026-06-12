import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { isValidBtcAddress } from '../utils.js';
import { SUPPORTED, LANG_META } from '../i18n.js';

// ═══════════════════════════════════════════════════════════════════════════
// SoloStrike Onboarding Wizard — 6 steps (language picker first), localStorage
// gated, appears once. v1.12.x: fully translatable; language chosen up front
// applies to every setup screen and persists to app start. Back navigation on
// every step, including Welcome → back to the language picker.
// ═══════════════════════════════════════════════════════════════════════════

const LS_WIZARD_COMPLETED = 'ss_wizard_completed_v1';

export function hasCompletedWizard() {
  try { return localStorage.getItem(LS_WIZARD_COMPLETED) === 'true'; } catch { return false; }
}
export function markWizardCompleted() {
  try { localStorage.setItem(LS_WIZARD_COMPLETED, 'true'); } catch {}
}

// ── Shared style tokens (match dashboard visual language) ──────────────────
const layoutOuter = {
  position:'fixed', inset:0,
  background:'var(--bg-void)',
  display:'flex', flexDirection:'column',
  alignItems:'center', justifyContent:'flex-start',
  padding:'2rem 1rem',
  overflowY:'auto',
  zIndex:100,
};
const layoutCard = {
  width:'100%', maxWidth:560,
  background:'var(--bg-surface)',
  border:'1px solid var(--border-hot)',
  padding:'2rem',
  boxShadow:'var(--glow-a)',
  marginTop:'1rem',
};
const heading = {
  fontFamily:'var(--fd)', fontSize:'1.4rem', fontWeight:700,
  letterSpacing:'0.04em', color:'var(--amber)',
  textShadow:'0 0 12px rgba(245,166,35,0.25)',
  marginBottom:'0.4rem',
};
const subheading = {
  fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.15em',
  textTransform:'uppercase', color:'var(--text-2)',
  marginBottom:'1.5rem',
};
const body = {
  fontFamily:'var(--fm)', fontSize:'0.85rem',
  color:'var(--text-1)', lineHeight:1.6,
};
const btnPrimary = {
  flex:1, padding:'0.9rem',
  background:'var(--amber)', color:'#000',
  border:'none', fontFamily:'var(--fd)', fontSize:'0.85rem',
  fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase',
  cursor:'pointer',
};
const btnSecondary = {
  padding:'0.9rem 1.2rem',
  background:'var(--bg-raised)', color:'var(--text-2)',
  border:'1px solid var(--border)',
  fontFamily:'var(--fd)', fontSize:'0.75rem', fontWeight:600,
  letterSpacing:'0.1em', textTransform:'uppercase',
  cursor:'pointer',
};
const skipLink = {
  fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.15em',
  textTransform:'uppercase', color:'var(--text-3)',
  textAlign:'center', marginTop:'1rem',
  cursor:'pointer', textDecoration:'underline',
};

// ── Progress dots ──────────────────────────────────────────────────────────
function ProgressDots({ current, total }) {
  return (
    <div style={{display:'flex', gap:8, justifyContent:'center', marginBottom:'1.5rem'}}>
      {Array.from({length: total}).map((_, i) => (
        <div key={i} style={{
          width:8, height:8, borderRadius:'50%',
          background: i < current ? 'var(--amber)' : i === current ? 'var(--cyan)' : 'var(--bg-raised)',
          boxShadow: i === current ? '0 0 8px var(--cyan)' : 'none',
          border: i >= current ? '1px solid var(--border)' : 'none',
          transition:'all 0.3s',
        }}/>
      ))}
    </div>
  );
}

// ── STEP 1: Language picker ────────────────────────────────────────────────
function StepLanguage({ tt = (x)=>x, lang = 'en', onLangChange, onNext }) {
  return (
    <>
      <div style={{textAlign:'center', marginBottom:'1.25rem'}}>
        <div style={{fontSize:40, marginBottom:'0.4rem'}}>🌐</div>
        <div style={heading}>{tt('Choose your language')}</div>
        <div style={subheading}>{tt('You can change this later in Settings')}</div>
      </div>
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))', gap:'0.5rem', marginBottom:'1.5rem'}}>
        {SUPPORTED.map(code => {
          const active = code === lang;
          return (
            <button key={code} onClick={()=>onLangChange && onLangChange(code)}
              style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.5rem',
                padding:'0.7rem 0.8rem', borderRadius:8, cursor:'pointer', textAlign:'left',
                background: active?'rgba(var(--amber-rgb),0.12)':'var(--bg-raised)',
                border:`1px solid ${active?'rgba(var(--amber-rgb),0.5)':'var(--border)'}`,
                color: active?'var(--amber)':'var(--text-1)', fontFamily:'var(--fd)', fontSize:'0.8rem', fontWeight:active?700:500}}>
              <span style={{overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{LANG_META[code]?.name || code}</span>
              {active && <span style={{color:'var(--amber)', flexShrink:0}}>●</span>}
            </button>
          );
        })}
      </div>
      <div style={{display:'flex', gap:8}}>
        <button style={btnPrimary} onClick={onNext}>{tt('Continue')} →</button>
      </div>
    </>
  );
}

// ── STEP 2: Welcome ───────────────────────────────────────────────────────
function StepWelcome({ tt = (x)=>x, onNext, onBack, onSkip }) {
  const features = [
    ['💰', tt('Full block reward'), tt('Every satoshi of every block your pool finds goes directly to your address.')],
    ['🔒', tt('True self-custody'), tt('Your node, your rules. Optional Private Mode blocks all outbound API calls.')],
    ['⚡', tt('Works with any miner'), tt('ASICs, BitAxe, NerdQaxe, Braiins rentals — all supported out of the box.')],
  ];
  return (
    <>
      <div style={{textAlign:'center', marginBottom:'1.5rem'}}>
        <div style={{marginBottom:'0.5rem', display:'flex', justifyContent:'center'}}>
          <img src="/pickaxe-icon.png" alt="⛏" draggable={false} style={{width:56, height:56, objectFit:'contain', filter:'drop-shadow(0 0 14px rgba(245,166,35,0.55)) drop-shadow(0 1px 2px rgba(0,0,0,0.4))'}}/>
        </div>
        <div style={heading}>{tt('Welcome to SoloStrike')}</div>
        <div style={subheading}>{tt('Your zero-fee solo Bitcoin pool')}</div>
      </div>
      <div style={{...body, marginBottom:'1.5rem'}}>
        {tt('SoloStrike runs a private solo mining pool on your Umbrel, using your own Bitcoin node. When one of your miners solves a block, you keep 100% of the reward — no pool operator, no fees, no middleman.')}
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:'0.75rem', marginBottom:'1.75rem'}}>
        {features.map(([icon, title, desc]) => (
          <div key={title} style={{display:'flex', gap:'0.75rem', alignItems:'flex-start',
            padding:'0.75rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
            <div style={{fontSize:22, flexShrink:0}}>{icon}</div>
            <div>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.72rem', letterSpacing:'0.12em',
                textTransform:'uppercase', color:'var(--amber)', fontWeight:700, marginBottom:3}}>{title}</div>
              <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-2)', lineHeight:1.5}}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:'flex', gap:8}}>
        <button style={btnSecondary} onClick={onBack}>← {tt('Back')}</button>
        <button style={btnPrimary} onClick={onNext}>{tt('Get Started')} →</button>
      </div>
      <div style={skipLink} onClick={onSkip}>{tt('Skip setup')}</div>
    </>
  );
}

// ── STEP 3: Payout Address ────────────────────────────────────────────────
function StepAddress({ tt = (x)=>x, addr, setAddr, onNext, onBack, onSkip, loading, error }) {
  const valid = addr.trim().length > 0 && isValidBtcAddress(addr.trim());
  return (
    <>
      <div style={heading}>{tt('Your Payout Address')}</div>
      <div style={subheading}>{tt('Bitcoin Address')}</div>
      <div style={{...body, marginBottom:'1.25rem'}}>
        {tt('Enter the Bitcoin address where your block rewards will go. This is the address hardcoded into every mining job your pool creates. When your pool finds a block, the reward goes straight here — no intermediate wallet.')}
      </div>
      <div style={{background:'rgba(0,255,209,0.04)', border:'1px solid rgba(0,255,209,0.2)',
        padding:'0.6rem 0.8rem', marginBottom:'1rem'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em',
          textTransform:'uppercase', color:'var(--cyan)', marginBottom:4}}>💡 {tt('Tip')}</div>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-1)', lineHeight:1.5}}>
          {tt('Use a fresh, dedicated address from your own wallet — not an exchange. Bech32 (starts with bc1…) is cheapest and works best.')}
        </div>
      </div>
      <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem',
        letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:6}}>
        {tt('Bitcoin Payout Address')}
      </label>
      <input
        type="text" value={addr}
        onChange={e=>setAddr(e.target.value)}
        onKeyDown={e=>e.key==='Enter' && valid && onNext()}
        placeholder="bc1q… / 1… / 3…"
        spellCheck={false} autoCorrect="off" autoCapitalize="off"
        style={{
          width:'100%', boxSizing:'border-box',
          background:'var(--bg-deep)',
          border:`1px solid ${error ? 'rgba(255,59,59,0.5)' : valid ? 'var(--green)' : addr ? 'var(--border-hot)' : 'var(--border)'}`,
          color:'var(--text-1)',
          fontFamily:'var(--fm)', fontSize:'0.85rem',
          padding:'0.85rem 1rem', outline:'none',
        }}
      />
      {valid && (
        <div style={{fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.12em',
          textTransform:'uppercase', color:'var(--green)', marginTop:6}}>
          ✓ {tt('Valid Bitcoin address')}
        </div>
      )}
      {error && (
        <div style={{background:'rgba(255,59,59,0.08)', border:'1px solid rgba(255,59,59,0.3)',
          padding:'0.6rem 0.8rem', fontSize:'0.75rem', color:'var(--red)', marginTop:'0.7rem',
          fontFamily:'var(--fm)'}}>
          ⚠ {error}
        </div>
      )}
      <div style={{display:'flex', gap:8, marginTop:'1.5rem'}}>
        <button style={btnSecondary} onClick={onBack}>← {tt('Back')}</button>
        <button
          style={{...btnPrimary, opacity: (valid && !loading) ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed'}}
          onClick={() => valid && onNext()}
          disabled={!valid || loading}
        >
          {loading ? tt('Saving…') : `${tt('Continue')} →`}
        </button>
      </div>
      <div style={skipLink} onClick={onSkip}>{tt('Skip setup')}</div>
    </>
  );
}

// ── STEP 4: Connect Your Miners ───────────────────────────────────────────
function StepConnect({ tt = (x)=>x, onNext, onBack, onSkip }) {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'umbrel.local';
  const urlAsic  = `stratum+tcp://${host}:3333`;
  const urlHobby = `stratum+tcp://${host}:3334`;
  const urlNicehash = `stratum+tcp://${host}:4334`;
  const [copied, setCopied] = useState('');

  const copy = async (val, lbl) => {
    try { await navigator.clipboard.writeText(val); setCopied(lbl); setTimeout(()=>setCopied(''),1500); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = val; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setCopied(lbl); setTimeout(()=>setCopied(''),1500); } catch {}
      document.body.removeChild(ta);
    }
  };

  const minerCard = (title, url, port, lbl) => (
    <div style={{
      flex:1, minWidth:0,
      background:'var(--bg-raised)', border:'1px solid var(--border)',
      padding:'1rem', display:'flex', flexDirection:'column', gap:'0.75rem',
    }}>
      <div style={{fontFamily:'var(--fd)', fontSize:'0.65rem', letterSpacing:'0.15em',
        textTransform:'uppercase', color:'var(--amber)', fontWeight:700}}>
        {title}
      </div>
      <div style={{display:'flex', justifyContent:'center', padding:'0.5rem',
        background:'#fff', borderRadius:4}}>
        <QRCodeSVG value={url} size={120} level="M" bgColor="#fff" fgColor="#000"/>
      </div>
      <div>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.5rem', letterSpacing:'0.1em',
          textTransform:'uppercase', color:'var(--text-3)', marginBottom:3}}>{tt('Stratum URL')}</div>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.65rem', color:'var(--cyan)',
          wordBreak:'break-all', lineHeight:1.4}}>{url}</div>
      </div>
      <button onClick={()=>copy(url, lbl)} style={{
        padding:'0.5rem', background:copied===lbl?'var(--green)':'var(--bg-deep)',
        color:copied===lbl?'#000':'var(--text-1)',
        border:'1px solid var(--border)', cursor:'pointer',
        fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.1em',
        textTransform:'uppercase', fontWeight:600,
      }}>
        {copied===lbl ? `✓ ${tt('Copied')}` : tt('Copy URL')}
      </button>
    </div>
  );

  return (
    <>
      <div style={heading}>{tt('Connect Your Miners')}</div>
      <div style={subheading}>{tt('Stratum Configuration')}</div>
      <div style={{...body, marginBottom:'1.25rem'}}>
        {tt('Point your miners at one of these URLs. Most ASICs (S19, S21, Whatsminer) use port 3333; hobby miners (BitAxe, NerdQaxe, Avalon Nano) use 3334 with lower starting difficulty.')}
      </div>
      <div style={{display:'flex', gap:'0.75rem', marginBottom:'1.25rem', flexWrap:'wrap'}}>
        {minerCard(tt('ASIC Port'), urlAsic, 3333, 'asic')}
        {minerCard(tt('Hobby Port'), urlHobby, 3334, 'hobby')}
        {minerCard(tt('NiceHash Port'), urlNicehash, 4334, 'nicehash')}
      </div>
      <div style={{background:'var(--bg-deep)', border:'1px solid var(--border)',
        padding:'0.75rem', marginBottom:'1.25rem'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.12em',
          textTransform:'uppercase', color:'var(--amber)', marginBottom:6}}>{tt('Renting hashrate from NiceHash?')}</div>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.68rem', color:'var(--text-1)', lineHeight:1.6}}>
          {tt('Use port 4334 for NiceHash, not 3333/3334. In NiceHash, add a SHA-256 pool with this URL; Username = your BTC payout address (a worker suffix like .nh is optional); Password = x. Port 4334 is a high-difficulty port that starts every connection at 500,000 difficulty — sized for large rented hashrate, so NiceHash will not flood the pool. Your block stays 100% yours.')}
        </div>
      </div>
      <div style={{background:'var(--bg-deep)', border:'1px solid var(--border)',
        padding:'0.75rem', marginBottom:'1.25rem'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.12em',
          textTransform:'uppercase', color:'var(--text-2)', marginBottom:6}}>{tt('Miner Credentials')}</div>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-1)', lineHeight:1.6}}>
          <div><span style={{color:'var(--text-3)'}}>{tt('User')}:</span> <span style={{color:'var(--cyan)'}}>anything.worker_name</span></div>
          <div><span style={{color:'var(--text-3)'}}>{tt('Password')}:</span> <span style={{color:'var(--cyan)'}}>x</span></div>
          <div style={{color:'var(--text-3)', fontSize:'0.62rem', marginTop:6, lineHeight:1.5}}>
            {tt('The "user" field can be anything — SoloStrike doesn\'t check it. The part after the dot is the worker label shown on your dashboard.')}
          </div>
        </div>
      </div>
      <div style={{display:'flex', gap:8}}>
        <button style={btnSecondary} onClick={onBack}>← {tt('Back')}</button>
        <button style={btnPrimary} onClick={onNext}>{tt("I've Connected My Miners")} →</button>
      </div>
      <div style={skipLink} onClick={onSkip}>{tt('Skip setup')}</div>
    </>
  );
}

// ── STEP 5: Waiting for first connection ─────────────────────────────────
function StepWaiting({ tt = (x)=>x, onNext, onBack, onSkip }) {
  const [elapsed, setElapsed] = useState(0);
  const [firstWorker, setFirstWorker] = useState(null);
  const tickRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    tickRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    const poll = async () => {
      try {
        const r = await fetch('/api/state');
        if (r.ok) {
          const s = await r.json();
          const workers = s.workers || [];
          const online = workers.find(w => w.status !== 'offline');
          if (online) setFirstWorker(online);
        }
      } catch {}
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      clearInterval(tickRef.current);
      clearInterval(pollRef.current);
    };
  }, []);

  const showContinue = elapsed >= 30 || firstWorker;

  return (
    <>
      <div style={heading}>
        {firstWorker ? tt('Miner Connected!') : tt('Waiting for your first miner…')}
      </div>
      <div style={subheading}>{tt('Verification')}</div>

      <div style={{textAlign:'center', padding:'2rem 1rem',
        background:'var(--bg-raised)', border:`1px solid ${firstWorker ? 'var(--green)' : 'var(--border)'}`,
        marginBottom:'1.25rem'}}>
        {firstWorker ? (
          <>
            <div style={{fontSize:56, marginBottom:'0.5rem', animation:'pulse 2s ease-in-out infinite'}}>✅</div>
            <div style={{fontFamily:'var(--fd)', fontSize:'1rem', fontWeight:700,
              color:'var(--green)', marginBottom:'0.4rem'}}>
              {tt('Got it!')}
            </div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.85rem', color:'var(--text-1)'}}>
              <div style={{color:'var(--amber)', fontWeight:600}}>{firstWorker.name.split('.').pop() || firstWorker.name}</div>
              <div style={{fontSize:'0.7rem', color:'var(--text-2)', marginTop:4}}>{tt('is submitting shares')}</div>
            </div>
          </>
        ) : (
          <>
            <div style={{fontSize:56, marginBottom:'0.5rem', animation:'pulse 1.5s ease-in-out infinite'}}>📡</div>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.9rem', fontWeight:600,
              color:'var(--text-1)', marginBottom:'0.25rem'}}>
              {tt('Listening for stratum connections…')}
            </div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-3)'}}>
              {tt('Elapsed')}: {elapsed}s
            </div>
          </>
        )}
      </div>

      <div style={{...body, fontSize:'0.75rem', color:'var(--text-2)', marginBottom:'1.25rem'}}>
        {firstWorker
          ? tt('Your pool is live. You can always come back to the onboarding or check the Workers card for more detail.')
          : tt("No rush — miners sometimes take a minute to negotiate and authenticate. If you haven't configured them yet, that's fine too — you can always set them up later.")}
      </div>

      <div style={{display:'flex', gap:8}}>
        <button style={btnSecondary} onClick={onBack}>← {tt('Back')}</button>
        {showContinue && (
          <button style={btnPrimary} onClick={onNext}>
            {firstWorker ? `${tt("Let's Go")} →` : `${tt('Continue anyway')} →`}
          </button>
        )}
      </div>
      <div style={skipLink} onClick={onSkip}>{tt('Skip setup')}</div>
    </>
  );
}

// ── STEP 6: Tour preview ──────────────────────────────────────────────────
function StepTour({ tt = (x)=>x, onDone, onBack }) {
  const features = [
    ['📊', tt('Live Hashrate'), tt('Real-time pool hashrate chart with 1h / 6h / 24h / 7d views.')],
    ['🎯', tt('Closest Calls'), tt('Top 10 best difficulty shares across your entire fleet — historical leaderboard.')],
    ['💎', tt('Block Celebration'), tt('If you find a block, the entire UI erupts with confetti. Pure celebration.')],
    ['⚙️', tt('Deep Settings'), tt('Customize cards, top strip, ticker, webhooks, worker aliases, Private Mode.')],
  ];
  return (
    <>
      <div style={{textAlign:'center', marginBottom:'1.5rem'}}>
        <div style={{fontSize:48, marginBottom:'0.5rem'}}>🚀</div>
        <div style={heading}>{tt("You're All Set!")}</div>
        <div style={subheading}>{tt('Ready to mine')}</div>
      </div>
      <div style={{...body, fontSize:'0.82rem', marginBottom:'1.5rem', textAlign:'center'}}>
        {tt("A quick tour of what you'll find on your dashboard:")}
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:'0.7rem', marginBottom:'1.75rem'}}>
        {features.map(([icon, title, desc]) => (
          <div key={title} style={{display:'flex', gap:'0.75rem', alignItems:'flex-start',
            padding:'0.75rem', background:'var(--bg-raised)', border:'1px solid var(--border)'}}>
            <div style={{fontSize:22, flexShrink:0}}>{icon}</div>
            <div>
              <div style={{fontFamily:'var(--fd)', fontSize:'0.72rem', letterSpacing:'0.12em',
                textTransform:'uppercase', color:'var(--amber)', fontWeight:700, marginBottom:3}}>{title}</div>
              <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-2)', lineHeight:1.5}}>{desc}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:'flex', gap:8}}>
        <button style={btnSecondary} onClick={onBack}>← {tt('Back')}</button>
        <button style={btnPrimary} onClick={onDone}>{tt('Enter Dashboard')} →</button>
      </div>
    </>
  );
}

// ── Main wizard component ────────────────────────────────────────────────
export default function OnboardingWizard({ onComplete, onSkip: onSkipProp, tt = (x)=>x, lang = 'en', onLangChange }) {
  const [step, setStep] = useState(1);
  const [addr, setAddr] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const totalSteps = 6;

  const submitAddress = async () => {
    const trimmed = addr.trim();
    if (!trimmed) { setError(tt('Please enter a Bitcoin address.')); return; }
    if (!isValidBtcAddress(trimmed)) { setError(tt("That doesn't look like a valid Bitcoin address.")); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/setup', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ payoutAddress: trimmed }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || tt('Could not save address.')); return; }
      setStep(4);
    } catch {
      setError(tt('Cannot reach pool API. Is the pool service running?'));
    } finally {
      setLoading(false);
    }
  };

  const finish = () => {
    markWizardCompleted();
    if (onComplete) onComplete();
  };
  const skip = () => { if (onSkipProp) onSkipProp(); else finish(); };

  return (
    <div style={layoutOuter}>
      <div style={{width:'100%', maxWidth:560}}>
        <div style={{textAlign:'center', marginBottom:'0.5rem'}}>
          <span style={{fontFamily:'var(--fd)', fontSize:'0.92rem', fontWeight:700,
            letterSpacing:'0.08em', color:'var(--amber)', textTransform:'uppercase',
            display:'inline-flex', alignItems:'center', gap:'0.4rem'}}>
            <img src="/pickaxe-icon.png" alt="" draggable={false} style={{width:'1rem', height:'1rem', objectFit:'contain', filter:'drop-shadow(0 0 6px rgba(245,166,35,0.5))'}}/>
            SoloStrike
          </span>
        </div>
        <ProgressDots current={step - 1} total={totalSteps}/>
      </div>
      <div style={layoutCard}>
        {step === 1 && <StepLanguage tt={tt} lang={lang} onLangChange={onLangChange} onNext={()=>setStep(2)}/>}
        {step === 2 && <StepWelcome tt={tt} onNext={()=>setStep(3)} onBack={()=>setStep(1)} onSkip={skip}/>}
        {step === 3 && <StepAddress
          tt={tt}
          addr={addr} setAddr={(v)=>{setAddr(v); setError('');}}
          onNext={submitAddress} onBack={()=>setStep(2)} onSkip={skip}
          loading={loading} error={error}
        />}
        {step === 4 && <StepConnect tt={tt} onNext={()=>setStep(5)} onBack={()=>setStep(3)} onSkip={skip}/>}
        {step === 5 && <StepWaiting tt={tt} onNext={()=>setStep(6)} onBack={()=>setStep(4)} onSkip={skip}/>}
        {step === 6 && <StepTour tt={tt} onDone={finish} onBack={()=>setStep(5)}/>}
      </div>
    </div>
  );
}
