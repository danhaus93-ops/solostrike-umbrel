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
  payoutAddress: null,
  _loaded: false,
};

export function usePool() {
  const [state, setState]           = useState(DEF);
  const [connected, setConnected]   = useState(false);
  const [blockAlert, setBlockAlert] = useState(null);
  const wsRef       = useRef(null);
  const retryRef    = useRef(null);
  const retryCount  = useRef(0);

  useEffect(() => {
    // v1.10.1 SECURITY: payoutAddress no longer comes from /api/state (which
    // is on Umbrel's auth whitelist for read-only access). It now comes from
    // /api/config which requires an Umbrel session. Both fetches happen in
    // parallel; their results are merged into state. The webhooks tab and
    // settings flow still use /api/config for cfg.payoutAddress, /api/state
    // for everything else.
    //
    // v1.11.9: 8s abort timeout on these initial fetches. Without this, if
    // iOS suspended the page mid-fetch and resumed later, the dead TCP
    // connection holds the request for 20-30s before the browser gives up.
    // 8s is generous for local Umbrel (which responds in <500ms typically)
    // while killing zombie requests fast.
    const ctrl = new AbortController();
    const killTimer = setTimeout(() => ctrl.abort(), 8000);
    Promise.all([
      fetch('/api/state',  { signal: ctrl.signal }).then(r => r.json()).catch(() => ({})),
      fetch('/api/config', { signal: ctrl.signal }).then(r => r.json()).catch(() => ({})),
    ]).then(([stateData, configData]) => {
      clearTimeout(killTimer);
      setState(p => ({
        ...p,
        ...stateData,
        // Merge payoutAddress from /api/config (auth-gated). If session
        // failed (configData empty), payoutAddress stays null and the
        // UI will treat it as not-yet-set, which is the correct fallback.
        payoutAddress: configData.payoutAddress || null,
        _loaded: true,
      }));
    });
    return () => { clearTimeout(killTimer); ctrl.abort(); };
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS); wsRef.current = ws;
    // v1.11.30: instrumentation — count every WS spawn to detect duplicates
    // in production. If wsSpawnCount climbs while only one socket is expected,
    // we have a bug. Visible in window._ssDebug.wsSpawnCount and in the
    // debug dump's `wsSpawnCount` field.
    if (typeof window !== 'undefined' && window._ssDebug) {
      window._ssDebug.wsSpawnCount = (window._ssDebug.wsSpawnCount || 0) + 1;
      window._ssDebug.wsSpawnLog = window._ssDebug.wsSpawnLog || [];
      window._ssDebug.wsSpawnLog.push({
        ts: Date.now(),
        spawn: window._ssDebug.wsSpawnCount,
        reason: window._ssDebug.__lastSpawnReason || 'connect()',
      });
      if (window._ssDebug.wsSpawnLog.length > 20) window._ssDebug.wsSpawnLog.shift();
      window._ssDebug.__lastSpawnReason = null;
    }
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
          // Merge privateMode to top-level so header badge + cards read it consistently.
          // v1.10.1 SECURITY: payoutAddress now arrives via auth-gated CONFIG message
          // (ws path is not on the auth whitelist). Merge to top-level so the
          // StratumPanel and onboarding flow keep working unchanged.
          setState(p => ({
            ...p,
            config: { ...p.config, ...msg.data },
            privateMode: msg.data.privateMode === true,
            payoutAddress: msg.data.payoutAddress != null ? msg.data.payoutAddress : p.payoutAddress,
          }));
        }
      } catch {}
    };
    ws.onclose = () => {
      setConnected(false);
      const delay = Math.min(30000, 3000 * Math.pow(2, retryCount.current));
      retryCount.current = Math.min(4, retryCount.current + 1);
      retryRef.current = setTimeout(() => {
        if (typeof window !== 'undefined' && window._ssDebug) {
          window._ssDebug.__lastSpawnReason = 'onclose-retry';
        }
        connect();
      }, delay);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && window._ssDebug) {
      window._ssDebug.__lastSpawnReason = 'initial-mount';
    }
    connect();
    // v1.11.9: After iOS Safari suspend, the WebSocket can be silently
    // dead while readyState still reports OPEN — iOS freezes JS execution
    // so the onclose handler never fires even when TCP is killed at the
    // network level. The previous rev70d fix bailed early if readyState
    // looked healthy, leaving users stuck on a zombie socket for 20-30s
    // until the browser's own keep-alive timeout finally noticed.
    //
    // Fix: on every transition to 'visible', ALWAYS force-close any
    // existing socket and reconnect fresh. Closing a zombie socket is
    // a no-op; closing a healthy socket and reopening costs ~50ms on
    // local network. Net effect: reconnect is near-instant when user
    // returns to the app instead of taking up to 30s.
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      // Reset backoff state — any timer queued from a prior onclose
      // would otherwise extend the reconnect wait.
      clearTimeout(retryRef.current);
      retryCount.current = 0;
      // v1.11.30 FIX — duplicate-socket bug. ws.close() is async: it puts
      // the socket into CLOSING state but doesn't fire onclose synchronously.
      // If we immediately call connect(), we get Socket #2. Then Socket #1's
      // onclose fires later and schedules ITS OWN retry via setTimeout —
      // which creates Socket #3. End result: 2 (or more) parallel sockets
      // all receiving broadcasts → JSON.parse + setState run TWICE per
      // server broadcast → main thread saturated → ticker drops frames.
      //
      // Fix: detach the OLD socket's onclose/onerror handlers BEFORE closing
      // it. Without the onclose handler, the old socket can die in peace
      // and won't queue a competing reconnect.
      const old = wsRef.current;
      if (old) {
        old.onopen = null;
        old.onmessage = null;
        old.onclose = null;
        old.onerror = null;
        try { old.close(); } catch {}
      }
      // v1.11.30: tag the spawn reason so wsSpawnLog explains each event
      if (typeof window !== 'undefined' && window._ssDebug) {
        window._ssDebug.__lastSpawnReason = 'visibilitychange';
      }
      connect();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

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
