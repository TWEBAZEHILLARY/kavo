// sw.js — minimal offline shell for the Cavort app.
// Network-first for same-origin GETs (so admin-published changes always win),
// with a cache fallback so the app still opens without a connection.
const CACHE = 'kavogrid-v2';
const SHELL = ['/', 'index.html', 'manifest.webmanifest', 'lib/shared.jsx', 'lib/brand.jsx', 'lib/commerce.jsx', 'lib/receipt.jsx', 'lib/app-shell.jsx', 'screens/home-a.jsx', 'images/brand/app-icon-192.png', 'images/brand/app-icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); return res; })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('/')))
  );
});
