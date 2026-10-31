// Service worker: cache vỏ app để mở nhanh/offline; luôn thử mạng trước để nhận bản mới.
const CACHE = 'mah-shell-v1';
const SHELL = ['./', './index.html', './style.css', './app.js', './version.js', './whatsnew.json', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/favicon-32.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;             // GitHub API: không cache ở đây
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
