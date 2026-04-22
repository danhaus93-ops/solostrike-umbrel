// TopStrip.jsx — CustomizableTopStrip + AnimatedChartMarker
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { METRIC_MAP } from '../metrics.js';

// ── CustomizableTopStrip ──────────────────────────────────────────────────────
// Shows a user-selected list of metrics, chunked into groups, crossfading.
export function CustomizableTopStrip({
  state,
  aliases,
  currency,
  uptime,
  enabled = true,
  metricIds = [],
  chunkSize = 2,
  fadeMs = 5000,
}) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  // Build list of valid metrics (filter out any that reference removed ids)
  const validMetrics = useMemo(
    () => metricIds.map(id => METRIC_MAP[id]).filter(Boolean),
    [metricIds]
  );

  // Chunk into groups of `chunkSize`. If chunkSize is 0 or >= total, show all at once.
  const groups = useMemo(() => {
    if (!validMetrics.length) return [];
    if (!chunkSize || chunkSize >= validMetrics.length) return [validMetrics];
    const out = [];
    for (let i = 0; i < validMetrics.length; i += chunkSize) {
      out.push(validMetrics.slice(i, i + chunkSize));
    }
    return out;
  }, [validMetrics, chunkSize]);

  // Rotate groups via crossfade. Only run when > 1 group.
  useEffect(() => {
    if (groups.length <= 1) return;
    const fadeDuration = 400; // ms for the out/in transition halves
    const holdDuration = Math.max(1000, fadeMs - fadeDuration * 2);

    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % groups.length);
        setVisible(true);
      }, fadeDuration);
    }, holdDuration + fadeDuration);

    return () => clearInterval(id);
  }, [groups.length, fadeMs]);

  if (!enabled || !groups.length) return null;

  const currentGroup = groups[idx] || groups[0];

  return (
    <div style={{
      background:'linear-gradient(90deg, rgba(245,166,35,0.04) 0%, rgba(6,7,8,0.95) 60%)',
      borderBottom:'1px solid var(--border)',
      padding:'0.5rem 1rem',
      width:'100%',
      boxSizing:'border-box',
      display:'flex', alignItems:'center', gap:'1rem',
      fontFamily:'var(--fd)', fontSize:'0.62rem', letterSpacing:'0.08em',
      textTransform:'uppercase',
      minHeight:32,
      overflow:'hidden', whiteSpace:'nowrap',
    }}>
      <div style={{
        display:'flex', alignItems:'center', gap:'1rem',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(-4px)',
        transition: 'opacity 0.4s ease, transform 0.4s ease',
        minWidth:0,
        flex:1,
        overflowX:'auto',
      }} className="ss-hide-scrollbar">
        {currentGroup.map((m, i) => {
          const out = m.render(state, aliases, currency, uptime);
          const value = out?.value ?? '—';
          const prefix = out?.prefix ?? m.label.toUpperCase();
          return (
            <React.Fragment key={m.id}>
              {i > 0 && <span style={{color:'var(--text-3)'}}>·</span>}
              <span style={{display:'inline-flex', gap:6, alignItems:'baseline', flexShrink:0}}>
                <span style={{color:'var(--text-2)'}}>{prefix}</span>
                <span style={{color:m.color || 'var(--text-1)', fontFamily:'var(--fm)', textTransform:'none', letterSpacing:0, fontWeight:600}}>
                  {value}
                </span>
              </span>
            </React.Fragment>
          );
        })}
      </div>
      {groups.length > 1 && (
        <div style={{display:'flex', gap:3, flexShrink:0}}>
          {groups.map((_, i) => (
            <span key={i} style={{
              width:4, height:4, borderRadius:'50%',
              background: i === idx ? 'var(--amber)' : 'var(--text-3)',
              transition:'background 0.3s',
            }}/>
          ))}
        </div>
      )}
    </div>
  );
}

// ── AnimatedChartMarker ───────────────────────────────────────────────────────
// Replaces the static ₿ marker on the hashrate chart with a rotating emoji.
// Designed to be used inside Recharts' <ReferenceDot shape={...}/>.
export function useAnimatedSymbol(symbols = ['₿'], intervalMs = 4000) {
  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!symbols || symbols.length <= 1) return;
    const fadeDuration = 300;
    const holdDuration = Math.max(800, intervalMs - fadeDuration * 2);

    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIdx(i => (i + 1) % symbols.length);
        setVisible(true);
      }, fadeDuration);
    }, holdDuration + fadeDuration);

    return () => clearInterval(id);
  }, [symbols, intervalMs]);

  const current = (symbols && symbols[idx]) || '₿';
  return { symbol: current, visible };
}

// Render function for Recharts ReferenceDot — pass from parent chart component.
// Usage: <ReferenceDot shape={(props) => <AnimatedDotShape {...props} symbol={sym} visible={vis} />} />
export function AnimatedDotShape({ cx, cy, symbol = '₿', visible = true }) {
  if (cx == null || cy == null) return null;
  return (
    <g style={{filter:'drop-shadow(0 0 8px rgba(245,166,35,0.8))', opacity: visible ? 1 : 0, transition:'opacity 0.3s ease'}}>
      <circle cx={cx} cy={cy} r={11} fill="rgba(6,7,8,0.95)" stroke="#F5A623" strokeWidth="1.5"/>
      <text x={cx} y={cy+4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#F5A623" fontFamily="var(--fm)">
        {symbol}
      </text>
    </g>
  );
}
