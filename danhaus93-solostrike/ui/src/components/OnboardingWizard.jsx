import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { isValidBtcAddress } from '../utils.js';

// ═══════════════════════════════════════════════════════════════════════════
// SoloStrike Onboarding Wizard — 5 steps, localStorage-gated, appears once
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

// ── STEP 1: Welcome ───────────────────────────────────────────────────────
function StepWelcome({ onNext, onSkip }) {
  return (
    <>
      <div style={{textAlign:'center', marginBottom:'1.5rem'}}>
        <div style={{fontSize:48, marginBottom:'0.5rem'}}>⛏</div>
        <div style={heading}>Welcome to SoloStrike</div>
        <div style={subheading}>Your zero-fee solo Bitcoin pool</div>
      </div>
      <div style={{...body, marginBottom:'1.5rem'}}>
        SoloStrike runs a private solo mining pool on your Umbrel, using your own
        Bitcoin node. When one of your miners solves a block, <b style={{color:'var(--amber)'}}>you keep 100% of
        the reward</b> — no pool operator, no fees, no middleman.
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:'0.75rem', marginBottom:'1.75rem'}}>
        {[
          ['💰', 'Full block reward', 'Every satoshi of every block your pool finds goes directly to your address.'],
          ['🔒', 'True self-custody', 'Your node, your rules. Optional Private Mode blocks all outbound API calls.'],
          ['⚡', 'Works with any miner', 'ASICs, BitAxe, NerdQaxe, Braiins rentals — all supported out of the box.'],
        ].map(([icon, title, desc]) => (
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
        <button style={btnPrimary} onClick={onNext}>Get Started →</button>
      </div>
      <div style={skipLink} onClick={onSkip}>Skip setup</div>
    </>
  );
}

// ── STEP 2: Payout Address ────────────────────────────────────────────────
function StepAddress({ addr, setAddr, onNext, onBack, onSkip, loading, error }) {
  const valid = addr.trim().length > 0 && isValidBtcAddress(addr.trim());
  return (
    <>
      <div style={heading}>Your Payout Address</div>
      <div style={subheading}>Step 2 · Bitcoin Address</div>
      <div style={{...body, marginBottom:'1.25rem'}}>
        Enter the Bitcoin address where your block rewards will go. This is the address
        hardcoded into every mining job your pool creates. When your pool finds a block,
        the reward goes straight here — no intermediate wallet.
      </div>
      <div style={{background:'rgba(0,255,209,0.04)', border:'1px solid rgba(0,255,209,0.2)',
        padding:'0.6rem 0.8rem', marginBottom:'1rem'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.55rem', letterSpacing:'0.12em',
          textTransform:'uppercase', color:'var(--cyan)', marginBottom:4}}>💡 Tip</div>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.7rem', color:'var(--text-1)', lineHeight:1.5}}>
          Use a <b>fresh, dedicated address</b> from your own wallet — not an exchange.
          Bech32 (starts with <code style={{color:'var(--amber)'}}>bc1...</code>) is cheapest and works best.
        </div>
      </div>
      <label style={{display:'block', fontFamily:'var(--fd)', fontSize:'0.6rem',
        letterSpacing:'0.15em', textTransform:'uppercase', color:'var(--text-2)', marginBottom:6}}>
        Bitcoin Payout Address
      </label>
      <input
        type="text" value={addr}
        onChange={e=>setAddr(e.target.value)}
        onKeyDown={e=>e.key==='Enter' && valid && onNext()}
        placeholder="bc1q… or 1… or 3…"
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
          ✓ Valid Bitcoin address
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
        <button style={btnSecondary} onClick={onBack}>← Back</button>
        <button
          style={{...btnPrimary, opacity: (valid && !loading) ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed'}}
          onClick={() => valid && onNext()}
          disabled={!valid || loading}
        >
          {loading ? 'SAVING…' : 'Continue →'}
        </button>
      </div>
      <div style={skipLink} onClick={onSkip}>Skip setup</div>
    </>
  );
}

// ── STEP 3: Connect Your Miners ───────────────────────────────────────────
function StepConnect({ onNext, onBack, onSkip }) {
  const host = typeof window !== 'undefined' ? window.location.hostname : 'umbrel.local';
  const urlAsic  = `stratum+tcp://${host}:3333`;
  const urlHobby = `stratum+tcp://${host}:3334`;
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
          textTransform:'uppercase', color:'var(--text-3)', marginBottom:3}}>Stratum URL</div>
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
        {copied===lbl ? '✓ Copied' : `Copy URL`}
      </button>
    </div>
  );

  return (
    <>
      <div style={heading}>Connect Your Miners</div>
      <div style={subheading}>Step 3 · Stratum Configuration</div>
      <div style={{...body, marginBottom:'1.25rem'}}>
        Point your miners at one of these URLs. Most ASICs (S19, S21, Whatsminer) use port 3333;
        hobby miners (BitAxe, NerdQaxe, Avalon Nano) use 3334 with lower starting difficulty.
      </div>
      <div style={{display:'flex', gap:'0.75rem', marginBottom:'1.25rem', flexWrap:'wrap'}}>
        {minerCard('ASIC Port', urlAsic, 3333, 'asic')}
        {minerCard('Hobby Port', urlHobby, 3334, 'hobby')}
      </div>
      <div style={{background:'var(--bg-deep)', border:'1px solid var(--border)',
        padding:'0.75rem', marginBottom:'1.25rem'}}>
        <div style={{fontFamily:'var(--fd)', fontSize:'0.58rem', letterSpacing:'0.12em',
          textTransform:'uppercase', color:'var(--text-2)', marginBottom:6}}>Miner Credentials</div>
        <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-1)', lineHeight:1.6}}>
          <div><span style={{color:'var(--text-3)'}}>User:</span> <span style={{color:'var(--cyan)'}}>anything.worker_name</span></div>
          <div><span style={{color:'var(--text-3)'}}>Password:</span> <span style={{color:'var(--cyan)'}}>x</span></div>
          <div style={{color:'var(--text-3)', fontSize:'0.62rem', marginTop:6, lineHeight:1.5}}>
            The "user" field can be anything — SoloStrike doesn't check it. The part after the dot is the worker label shown on your dashboard.
          </div>
        </div>
      </div>
      <div style={{display:'flex', gap:8}}>
        <button style={btnSecondary} onClick={onBack}>← Back</button>
        <button style={btnPrimary} onClick={onNext}>I've Connected My Miners →</button>
      </div>
      <div style={skipLink} onClick={onSkip}>Skip setup</div>
    </>
  );
}

// ── STEP 4: Waiting for first connection ─────────────────────────────────
function StepWaiting({ onNext, onBack, onSkip }) {
  const [elapsed, setElapsed] = useState(0);
  const [firstWorker, setFirstWorker] = useState(null);
  const tickRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    // Elapsed counter
    tickRef.current = setInterval(() => setElapsed(s => s + 1), 1000);

    // Poll API for workers every 3 seconds
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
        {firstWorker ? 'Miner Connected!' : 'Waiting for your first miner…'}
      </div>
      <div style={subheading}>Step 4 · Verification</div>

      <div style={{textAlign:'center', padding:'2rem 1rem',
        background:'var(--bg-raised)', border:`1px solid ${firstWorker ? 'var(--green)' : 'var(--border)'}`,
        marginBottom:'1.25rem'}}>
        {firstWorker ? (
          <>
            <div style={{fontSize:56, marginBottom:'0.5rem', animation:'pulse 2s ease-in-out infinite'}}>✅</div>
            <div style={{fontFamily:'var(--fd)', fontSize:'1rem', fontWeight:700,
              color:'var(--green)', marginBottom:'0.4rem'}}>
              Got it!
            </div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.85rem', color:'var(--text-1)'}}>
              <div style={{color:'var(--amber)', fontWeight:600}}>{firstWorker.name.split('.').pop() || firstWorker.name}</div>
              <div style={{fontSize:'0.7rem', color:'var(--text-2)', marginTop:4}}>is submitting shares</div>
            </div>
          </>
        ) : (
          <>
            <div style={{fontSize:56, marginBottom:'0.5rem', animation:'pulse 1.5s ease-in-out infinite'}}>📡</div>
            <div style={{fontFamily:'var(--fd)', fontSize:'0.9rem', fontWeight:600,
              color:'var(--text-1)', marginBottom:'0.25rem'}}>
              Listening for stratum connections…
            </div>
            <div style={{fontFamily:'var(--fm)', fontSize:'0.72rem', color:'var(--text-3)'}}>
              Elapsed: {elapsed}s
            </div>
          </>
        )}
      </div>

      <div style={{...body, fontSize:'0.75rem', color:'var(--text-2)', marginBottom:'1.25rem'}}>
        {firstWorker
          ? 'Your pool is live. You can always come back to the onboarding or check the Workers card for more detail.'
          : 'No rush — miners sometimes take a minute to negotiate and authenticate. If you haven\'t configured them yet, that\'s fine too — you can always set them up later.'}
      </div>

      <div style={{display:'flex', gap:8}}>
        <button style={btnSecondary} onClick={onBack}>← Back</button>
        {showContinue && (
          <button style={btnPrimary} onClick={onNext}>
            {firstWorker ? "Let's Go →" : 'Continue anyway →'}
          </button>
        )}
      </div>
      <div style={skipLink} onClick={onSkip}>Skip setup</div>
    </>
  );
}

// ── STEP 5: Tour preview ──────────────────────────────────────────────────
function StepTour({ onDone }) {
  const features = [
    ['📊', 'Live Hashrate', 'Real-time pool hashrate chart with 1h / 6h / 24h / 7d views.'],
    ['🎯', 'Closest Calls', 'Top 10 best difficulty shares across your entire fleet — historical leaderboard.'],
    ['💎', 'Block Celebration', 'If you find a block, the entire UI erupts with confetti. Pure celebration.'],
    ['⚙️', 'Deep Settings', 'Customize cards, top strip, ticker, webhooks, worker aliases, Private Mode.'],
  ];
  return (
    <>
      <div style={{textAlign:'center', marginBottom:'1.5rem'}}>
        <div style={{fontSize:48, marginBottom:'0.5rem'}}>🚀</div>
        <div style={heading}>You're All Set!</div>
        <div style={subheading}>Ready to mine</div>
      </div>
      <div style={{...body, fontSize:'0.82rem', marginBottom:'1.5rem', textAlign:'center'}}>
        A quick tour of what you'll find on your dashboard:
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
      <button style={btnPrimary} onClick={onDone}>Enter Dashboard →</button>
    </>
  );
}

// ── Main wizard component ────────────────────────────────────────────────
export default function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [addr, setAddr] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const totalSteps = 5;

  const submitAddress = async () => {
    const trimmed = addr.trim();
    if (!trimmed) { setError('Please enter a Bitcoin address.'); return; }
    if (!isValidBtcAddress(trimmed)) { setError("That doesn't look like a valid Bitcoin address."); return; }
    setLoading(true); setError('');
    try {
      const r = await fetch('/api/setup', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ payoutAddress: trimmed }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Could not save address.'); return; }
      setStep(3);
    } catch {
      setError('Cannot reach pool API. Is the pool service running?');
    } finally {
      setLoading(false);
    }
  };

  const finish = () => {
    markWizardCompleted();
    onComplete();
  };
  const skip = () => { finish(); };

  return (
    <div style={layoutOuter}>
      <div style={{width:'100%', maxWidth:560}}>
        <div style={{textAlign:'center', marginBottom:'0.5rem'}}>
          <span style={{fontFamily:'var(--fd)', fontSize:'0.92rem', fontWeight:700,
            letterSpacing:'0.08em', color:'var(--amber)', textTransform:'uppercase'}}>
            ⛏ SoloStrike
          </span>
        </div>
        <ProgressDots current={step - 1} total={totalSteps}/>
      </div>
      <div style={layoutCard}>
        {step === 1 && <StepWelcome onNext={()=>setStep(2)} onSkip={skip}/>}
        {step === 2 && <StepAddress
          addr={addr} setAddr={(v)=>{setAddr(v); setError('');}}
          onNext={submitAddress} onBack={()=>setStep(1)} onSkip={skip}
          loading={loading} error={error}
        />}
        {step === 3 && <StepConnect onNext={()=>setStep(4)} onBack={()=>setStep(2)} onSkip={skip}/>}
        {step === 4 && <StepWaiting onNext={()=>setStep(5)} onBack={()=>setStep(3)} onSkip={skip}/>}
        {step === 5 && <StepTour onDone={finish}/>}
      </div>
    </div>
  );
}
