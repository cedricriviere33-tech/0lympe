/* 0lympe — service worker PWA
   Stratégie NETWORK-FIRST : en ligne = toujours la version fraîche (ne casse pas
   le no-cache Netlify) ; le cache n'est servi QUE si le réseau échoue (hors-ligne).
   Suffisant pour rendre l'app installable (manifest + SW + fetch handler). */
const CACHE = 'olympe-shell-v1';
const SHELL = [
  '/', '/index.html', '/index2.html',
  '/manifest.json',
  '/icon-192.png', '/icon-512.png',
  '/apple-touch-icon.png', '/favicon.ico'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return; // ne jamais intercepter Supabase & CDN

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('/index.html')))
  );
});
