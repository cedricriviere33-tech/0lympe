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
/* ═══════════════════════════════════════════════════════════════════════
   Olympe — handlers PUSH à AJOUTER À LA FIN de ton sw.js EXISTANT.
   Ne remplace pas ton sw.js : ajoute juste ces deux blocs.
   (Ton offline/cache reste intact.)
   ═══════════════════════════════════════════════════════════════════════ */

// Réception d'un push → notification système (son + vibration gérés par l'OS)
self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  var title = data.title || '☎️ Messenger';
  var body  = data.body  || 'Nouveau message';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      // App déjà au premier plan sur cet appareil ? La bulle in-app suffit, pas de notif système.
      var visible = list.some(function (c) { return c.visibilityState === 'visible'; });
      if (visible) return;
      return self.registration.showNotification(title, {
        body: body,
        icon: data.icon || '/apple-touch-icon.png',
        badge: '/apple-touch-icon.png',
        tag: 'olympe-mg',
        renotify: true,
        vibrate: [180, 90, 180],
        data: { url: data.url || '/' }
      });
    })
  );
});

// Clic sur la notification → ouvre / focus Olympe
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if ('focus' in c) { try { c.navigate(target); } catch (e) {} return c.focus(); }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
