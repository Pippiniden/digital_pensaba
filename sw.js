// Pensaba Duel service worker: stale-while-revalidate for same-origin GETs (no build step, so no file list to maintain).
// Bump CACHE only to force-drop old caches.
const CACHE = 'pensaba-duel-v2';
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'css/base.css', 'css/game.css', 'css/buttons.css',
  'js/rules.js', 'js/units.js', 'js/masters.js', 'js/common.js', 'js/engine.js', 'js/cpu.js', 'js/cutin.js', 'js/fx.js', 'js/guide.js', 'js/game-ui.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(PRECACHE.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const url = new URL(r.url);
  if (url.origin !== location.origin) return; // Web fonts etc. go straight to the network
  e.respondWith(caches.open(CACHE).then(async c => {
    // ?v= 付きのURLは別のファイルとして扱う（ignoreSearch すると、古い版が返って新旧のスクリプトが混ざる）
    const hit = await c.match(r);
    const net = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => null);
    if (hit) { e.waitUntil(net); return hit; }
    return (await net) || (await c.match(r, {ignoreSearch: true})) || (r.mode === 'navigate' ? c.match('index.html') : Response.error()); // オフラインのときだけ検索文字列を無視して探す
  }));
});
