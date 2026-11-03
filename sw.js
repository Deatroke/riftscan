/* Network first, cache as the offline fallback. Same-origin GETs only (OCR and exchange rate go straight to the network).
   data/myp.json is generated and optional, so it is left out of the precache (a 404 there would fail the whole install);
   the fetch handler caches it the first time it loads. */
const CACHE = 'riftscan-v13';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', 'index.html', 'styles.css', 'theme.js', 'fonts/Geist-Variable.woff2', 'core.js', 'myp.js', 'config.js', 'app.js', 'manifest.webmanifest', 'data/cards.json', 'data/prices.json'])));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
