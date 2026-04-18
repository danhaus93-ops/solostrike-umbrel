import { useState, useEffect, useRef, useCallback } from 'react';

const WS = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

const DEF = {
  config: { poolName: 'SoloStrike', hasAddress: false },
  status: 'loading',
  hashrate: { current: 0, history: [] },
  workers: [],
  shares: { accepted: 0, rejected: 0, stale: 0 },
  blocks: [],
  network: { height: 0, difficulty: 0, hashrate: 0 },
  odds: { perBlock: 0, expectedDays: null },
  uptime: Date.now(),
};

export function usePool() {
  const [state, setState] = useState(DEF);
  const [connected, setConnected] = useState(false);
  const [blockAlert, setBlockAlert] = useState(null);

  const wsRef = useRef(null);
  const retryRef = useRef(null);

  useEffect(() => {
    fetch('/api/state')
      .then((r) => r.json())
      .then((d) => setState(d))
      .catch(() => {});
  }, []);

  const connect = useCallback(() => {
    const ws = new WebSocket(WS);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      clearTimeout(retryRef.current);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);

        if (msg.type === 'STATE' || msg.type === 'STATE_UPDATE') {
          setState(msg.data);
        } else if (msg.type === 'BLOCK_FOUND') {
          setBlockAlert(msg.data);
          setTimeout(() => setBlockAlert(null), 8000);
        } else if (msg.type === 'CONFIG_UPDATED' || msg.type === 'CONFIG') {
          setState((p) => ({
            ...p,
            config: {
              ...p.config,
              ...msg.data,
            },
          }));
        }
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      retryRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
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

    if (!res.ok) {
      const e = await res.json();
      throw new Error(e.error || 'Failed');
    }

    return res.json();
  }, []);

  const getConfig = useCallback(() => {
    return fetch('/api/config').then((r) => r.json());
  }, []);

  return { state, connected, blockAlert, saveConfig, getConfig };
}
