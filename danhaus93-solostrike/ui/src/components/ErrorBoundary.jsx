import React from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// ErrorBoundary — catches rendering errors in children, shows fallback UI.
//
// Two usage modes:
//   <ErrorBoundary fullscreen>  → wraps <App /> in main.jsx, viewport-sized
//                                  fallback if anything anywhere crashes
//   <ErrorBoundary label={id}>  → wraps each carousel slot in App.jsx, a
//                                  per-card fallback if one card crashes
//                                  while the other 13 keep working
//
// Caught errors are pushed to the existing _ssDebug.errors stream so they
// appear in debug exports (the same place window.onerror entries land).
// ═══════════════════════════════════════════════════════════════════════════

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Hook into the existing debug stream — keeps a single source of truth
    // for "what went wrong recently" that testers can export and share.
    if (typeof window !== 'undefined' && window._ssDebug && Array.isArray(window._ssDebug.errors)) {
      try {
        window._ssDebug.errors.push({
          ts: Date.now(),
          msg: String(error?.message || 'React error').slice(0, 200),
          src: 'ErrorBoundary' + (this.props.label ? `:${this.props.label}` : ''),
          lineno: 0,
          colno: 0,
          stack: String(errorInfo?.componentStack || '').slice(0, 500),
        });
        // Keep the array bounded (matches the 30-item cap used elsewhere)
        while (window._ssDebug.errors.length > 30) window._ssDebug.errors.shift();
      } catch {}
    }
    // Always log so it shows up in container logs / DevTools / iOS console wrap
    console.error('[ErrorBoundary]', this.props.label || '(root)', error);
  }

  handleRetry = () => {
    // Resets state — children re-mount fresh. If the error is deterministic
    // (bad state), this'll just re-trigger and the user can FULL RELOAD.
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const fullscreen = !!this.props.fullscreen;
    const label = this.props.label || '';
    const _t = this.props.tt || ((x) => x);

    const fallback = (
      <div style={{
        background: 'var(--bg-surface, #171717)',
        border: '1px solid var(--amber, #f59e0b)',
        borderRadius: 6,
        padding: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        height: '100%',
        boxSizing: 'border-box',
        fontFamily: "var(--fm, ui-monospace, 'SF Mono', Menlo, Consolas, monospace)",
        minWidth: 0,
        maxWidth: '100%',
        overflow: 'hidden',
      }}>
        <div style={{
          color: 'var(--amber, #f59e0b)',
          fontSize: '0.75rem',
          fontWeight: 'bold',
          letterSpacing: '0.05em',
        }}>
          {_t('▸ ERROR')}{label ? ` — ${label}` : ''}
        </div>
        <div style={{
          color: 'var(--text-2, #a3a3a3)',
          fontSize: '0.75rem',
          lineHeight: 1.4,
        }}>
          {_t('A rendering error was caught before it could crash the app.')}
        </div>
        {this.state.error?.message && (
          <div style={{
            background: 'var(--bg-void, #0a0a0a)',
            border: '1px solid var(--border, #262626)',
            borderRadius: 4,
            padding: '0.4rem 0.6rem',
            fontSize: '0.65rem',
            color: 'var(--text-2, #a3a3a3)',
            wordBreak: 'break-word',
            maxHeight: 120,
            overflow: 'auto',
          }}>
            {this.state.error.message}
          </div>
        )}
        <div style={{
          display: 'flex',
          gap: '0.4rem',
          marginTop: 'auto',
          paddingTop: '0.5rem',
          flexWrap: 'wrap',
        }}>
          <button
            onClick={this.handleRetry}
            style={{
              background: 'var(--amber, #f59e0b)',
              color: 'var(--bg-void, #0a0a0a)',
              border: 'none',
              borderRadius: 4,
              padding: '0.4rem 1rem',
              fontFamily: 'inherit',
              fontSize: '0.7rem',
              fontWeight: 'bold',
              cursor: 'pointer',
              letterSpacing: '0.05em',
            }}
          >
            {_t('RETRY')}
          </button>
          <button
            onClick={this.handleReload}
            style={{
              background: 'transparent',
              color: 'var(--text-2, #a3a3a3)',
              border: '1px solid var(--text-3, #737373)',
              borderRadius: 4,
              padding: '0.4rem 0.75rem',
              fontFamily: 'inherit',
              fontSize: '0.7rem',
              cursor: 'pointer',
            }}
          >
            {_t('RELOAD')}
          </button>
        </div>
      </div>
    );

    // Fullscreen mode: wrap in viewport-filling container. Used by main.jsx
    // outer boundary so the fallback fills the screen instead of collapsing
    // to content height.
    if (fullscreen) {
      return (
        <div style={{
          minHeight: '100vh',
          background: 'var(--bg-void, #0a0a0a)',
          padding: '1rem',
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{ width: '100%', maxWidth: 480 }}>{fallback}</div>
        </div>
      );
    }

    return fallback;
  }
}
