// 离线缓存页面本身（数据始终从云端读取）
const CACHE = 'ledger-v46';
const FILES = ['./', './index.html', './confirm.html', './app.css', './app.js', './confirm.js', './calc.js', './store.js', './config.js', './manifest.json', './manifest-confirm.json', './vendor/supabase.js', './apple-touch-icon.png', './icon-192.png', './icon-512.png', './icon-144.png', './icon-96.png', './favicon.ico', './manifest-confirm.json'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request, { cache: 'no-cache' }).then((r) => { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});

// 锁屏通知：店面点“一起催办”时，业务员手机（iPhone 要从桌面图标打开过）收到提醒
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '文城房产 · 店面提醒', { body: d.body || '您有事情还没做完，点开看看', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'nudge', renotify: true, data: { url: d.url || './confirm.html' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './confirm.html', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    const c = cs.find((x) => x.url.includes('confirm.html'));
    return c ? c.focus().then((w) => w && w.navigate ? w.navigate(url) : w) : self.clients.openWindow(url);
  }));
});
