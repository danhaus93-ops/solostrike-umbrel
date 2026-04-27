// SoloStrike Service Worker
// Caches the app shell so it loads instantly even on shaky connections.
// Never caches API or WebSocket traffic — those always go to the network.
// Update detection was removed in v1.7.15 — new versions take over naturally
// on cold launch. The cache name still bumps per release to invalidate the
// shell cache when assets change.

const CACHE_NAME = 'solostrike-v1.7.22';
const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon-32.png',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
];

// Install: pre-cache the shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  // Don't auto-activate; let the page decide when to swap (avoids reload loops)
});

// Activate: clean up old caches from previous versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith('solostrike-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

// Fetch strategy:
// - API and WebSocket: never cached, always network (let browser handle natively)
// - Shell assets: stale-while-revalidate (fast load, fresh in background)
// - Cross-origin (Google Fonts, etc): pass through, no caching
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests entirely
  if (request.method !== 'GET') return;

  // Skip API and WebSocket requests — always live data
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws')) {
    return;
  }

  // Skip cross-origin (Google Fonts CDN, etc)
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate for shell
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(request).then((cached) => {
        const networkFetch = fetch(request)
          .then((response) => {
            // Only cache successful, basic-type responses
            if (response && response.status === 200 && response.type === 'basic') {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => cached); // Offline? return cached if we have it
        return cached || networkFetch;
      })
    )
  );
});
