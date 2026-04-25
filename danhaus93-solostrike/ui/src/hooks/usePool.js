import { useState, useEffect, useRef, useCallback } from 'react';
const WS = `${location.protocol==='https:'?'wss':'ws'}://${location.host}/api/ws`;
const DEF = {
  config:    { poolName:'SoloStrike', hasAddress:false },
  status:    'loading',
  hashrate:  { current:0, history:[] },
  workers:   [],
  shares:    { accepted:0, rejected:0, stale:0 },
  blocks:    [],
  network:   { height:0, difficulty:0, hashrate:0 },
  odds:      { perBlock:0, expectedDays:null },
  luck:      { progress:0, blocksExpected:0, blocksFound:0, luck:null },
  retarget:  null,
  netBlocks: [],
  mempool:   { feeRate:null, size:null, unconfirmedCount:null },
  privateMode: false,
  uptime:    Date.now(),
};

export function usePool() {
  const [state, setState]           = useState(DEF);
  const [connected, setConnected]   = useState(false);
  const [blockAlert, setBlockAlert] = useState(null);
  const wsRef       = useRef(null);
  const retryRef    = useRef(null);
  const retryCount  = useRef(0);

  useEffect(() => {
    fetch('/api/state').then(r => r.json()).then(d => setState(p => ({ ...p, ...d }))).catch(() => {});
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS); wsRef.current = ws;
    ws.onopen = () => {
      setConnected(true);
      retryCount.current = 0;
      clearTimeout(retryRef.current);
    };
    ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'STATE_UPDATE') {
          setState(p => ({ ...p, ...msg.data }));
        }
        else if (msg.type === 'BLOCK_FOUND') {
          setBlockAlert(msg.data);
          setTimeout(() => setBlockAlert(null), 8000);
        }
        else if (msg.type === 'CONFIG') {
          // Merge privateMode to top-level so header badge + cards read it consistently
          setState(p => ({
            ...p,
            config: { ...p.config, ...msg.data },
            privateMode: msg.data.privateMode === true,
          }));
        }
      } catch {}
    };
    ws.onclose = () => {
      setConnected(false);
      const delay = Math.min(30000, 3000 * Math.pow(2, retryCount.current));
      retryCount.current = Math.min(4, retryCount.current + 1);
      retryRef.current = setTimeout(connect, delay);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }, []);

  useEffect(() => { connect(); return () => { clearTimeout(retryRef.current); wsRef.current?.close(); }; }, [connect]);

  const saveConfig = useCallback(async (payload) => {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || 'Failed'); }
    return res.json();
  }, []);

  const getConfig = useCallback(() => fetch('/api/config').then(r => r.json()), []);

  return { state, connected, blockAlert, saveConfig, getConfig };
}
