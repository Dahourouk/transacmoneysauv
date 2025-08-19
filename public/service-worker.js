
const CACHE_NAME = 'om-cache-v2';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/service-worker.js',
  '/_redirects',
  // Fichiers générés par Vite
  '/dist/index.html',
  '/dist/manifest.json',
  '/dist/service-worker.js',
  '/dist/assets/index-HLPfRb6J.css',
  '/dist/assets/index-HxX_gya9.js',
  '/dist/assets/index.es-D8PF3V3o.js',
  '/dist/assets/html2canvas.esm-CBrSDip1.js',
  '/dist/assets/purify.es-CQJ0hv7W.js',
];


self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        await cache.addAll(PRECACHE_URLS);
        // Cache tous les fichiers assets générés (JS/CSS/images)
        // On récupère la liste via fetch de index.html et parse, ou on laisse le cache dynamique le gérer
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Pour les navigations (SPA): toujours servir index.html en fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(resp => {
          // Met en cache la page si succès
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
          }
          return resp;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }
  // Pour les assets (JS/CSS/images): cache-first, puis réseau, puis rien
  event.respondWith(
    caches.match(req).then(cachedResp => {
      return cachedResp || fetch(req).then(networkResp => {
        // Met en cache les nouvelles ressources GET
        if (req.method === 'GET' && networkResp && networkResp.status === 200 && req.url.startsWith(self.location.origin)) {
          const clone = networkResp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return networkResp;
      });
    })
  );
});
