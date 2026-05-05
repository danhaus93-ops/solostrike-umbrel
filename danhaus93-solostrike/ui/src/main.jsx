import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/global.css'
import { createAnimatedBackground } from './animated-bg-webgl.js'

// rev63 premium pass — animated WebGL background mounted behind #root.
// Canvas is appended directly to document.body so it sits as a sibling
// to #root with `position:fixed; inset:0; z-index:-1`. App content
// stacks on top automatically. Body bg-color is removed in global.css
// so the canvas paint shows through.
;(() => {
  if (typeof document === 'undefined') return;
  const bgCanvas = document.createElement('canvas');
  bgCanvas.id = 'ss-animated-bg';
  bgCanvas.setAttribute('aria-hidden', 'true');
  // Insert as the FIRST child of body so it renders before #root markup.
  document.body.insertBefore(bgCanvas, document.body.firstChild);
  // Defer init to next tick so React mount isn't blocked by GL setup
  setTimeout(() => createAnimatedBackground(bgCanvas), 0);
})();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
)
