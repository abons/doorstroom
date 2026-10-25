/* Netwerk-eerst voor de app zelf (zodat een nieuwe versie direct werkt), cache als terugval: zo werkt de app ook
 * offline. Tegels en API's gaan er langs; Overpass-antwoorden bewaart osm.js zelf in de Cache API. */
const VERSIE = 'v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'geo.js', 'net.js', 'sim.js', 'teken.js', 'osm.js', 'meet.js', 'meet-worker.js', 'bewerk.js', 'kosten.js', 'manifest.webmanifest', 'icon.svg', 'demo/amersfoort.json'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSIE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSIE && k !== 'doorstroom-osm').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const kopie = r.clone(); caches.open(VERSIE).then((c) => c.put(e.request, kopie)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ?? caches.match('./'))));
});
