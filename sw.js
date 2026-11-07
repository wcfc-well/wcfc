// 离线缓存页面本身（数据始终从云端读取）
const CACHE = 'ledger-v19';
const FILES = ['./', './index.html', './confirm.html', './app.css', './app.js', './confirm.js', './calc.js', './store.js', './config.js', './manifest.json', './vendor/supabase.js', './apple-touch-icon.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
