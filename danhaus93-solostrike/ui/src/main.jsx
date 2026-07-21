import React from 'react'
import ReactDOM from 'react-dom/client'
import App, { ensureApiKey, loadPorts } from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './styles/global.css'
import { createAnimatedBackground } from './animated-bg-webgl.js'
import { loadTheme, getThemeById, applyThemeCSS, applyThemeColorMeta } from './themes.js'

// v1.11.47: apply the persisted theme BEFORE the animated bg initializes,
// so the bg sees the correct theme.special flag (Paper Light needs the
// 2D blueprint branch instead of WebGL).
;(() => {
  if (typeof document === 'undefined') return;
  const themeId = loadTheme();
  applyThemeCSS(themeId);
  // v1.11.47: also sync the <meta name="theme-color"> on boot so the OS-level
  // chrome (status bar background, PWA splash, etc.) matches the active theme.
  // The static default in index.html (#F5A623 / Classic amber) covers the
  // window before this script runs.
  applyThemeColorMeta(themeId);
  // Expose for App.jsx to read on mount
  window.__ssCurrentThemeId = themeId;
})();

// rev63 premium pass — animated WebGL background mounted behind #root.
;(() => {
  if (typeof document === 'undefined') return;
  const bgCanvas = document.createElement('canvas');
  bgCanvas.id = 'ss-animated-bg';
  bgCanvas.setAttribute('aria-hidden', 'true');
  document.body.insertBefore(bgCanvas, document.body.firstChild);
  // v1.11.47: pass theme to bg renderer (handles Paper Light's blueprint branch)
  setTimeout(() => {
    const theme = getThemeById(window.__ssCurrentThemeId || 'classic');
    const bgInstance = createAnimatedBackground(bgCanvas, { theme });
    // Expose bg instance so App.jsx can call setTheme() on theme switch.
    // For Paper Light <-> dark theme transitions the bg needs full rebuild
    // (one is WebGL, the other is canvas 2D); App.jsx handles that via a
    // page-level reload trigger if special flag differs.
    window.__ssAnimatedBg = bgInstance;
  }, 0);
})();

// v3.3.0: claim the API key (TOFU) BEFORE first render so the initial /api
// burst and the WebSocket carry it. finally() not then(): render even if the
// claim fails (already claimed elsewhere / offline) — App then prompts for a
// paste, the intended additional-device flow, rather than hard-failing.
Promise.allSettled([ensureApiKey(), loadPorts()]).then(() => {
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary fullscreen>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
})
