/*
 * Caches the app shell so the home-screen app opens instantly, even on a weak
 * signal. Same-origin files are served from cache and refreshed in the
 * background (a new deploy shows up on the next launch). API calls to Apps
 * Script are POSTs to another origin and always go straight to the network,
 * so trade data is never cached.
 */
const CACHE = 'wheel-tracker-v1';
const SHELL = [
  './', './index.html', './api.js', './manifest.webmanifest',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.open(CACHE).then((cache) =>
      cache.match(req).then((cached) => {
        const network = fetch(req)
          .then((res) => { if (res && res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => cached || cache.match('./index.html'));
        return cached || network;
      })
    )
  );
});
