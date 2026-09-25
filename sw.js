// Offline support: network first (so updates show up immediately), cache as the offline fallback.
const VERSION = 'meridian-v7';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'js/ui.js', 'js/engine.js', 'js/tz.js', 'js/sun.js',
  'js/cities.js', 'js/ics.js', 'manifest.webmanifest', 'icons/favicon.svg', 'icons/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;
  const key = sameOrigin && req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(caches.open(VERSION).then(async (cache) => {
    try {
      // revalidate with the server every time (cheap 304s) so new deploys show up immediately
      const res = await fetch(req, sameOrigin ? { cache: 'no-cache' } : undefined);
      if (res && (res.ok || res.type === 'opaque')) cache.put(key, res.clone());
      return res;
    } catch {
      const cached = await cache.match(key, { ignoreSearch: sameOrigin });
      return cached || Response.error();
    }
  }));
});
