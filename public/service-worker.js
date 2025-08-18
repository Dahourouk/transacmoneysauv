
const CACHE_NAME = 'om-cache-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/main.jsx',
  '/App.jsx',
  '/mobile_money.jsx',
  '/src/index.css',
  '/public/manifest.json',
  '/public/service-worker.js',
  '/public/_redirects',
  // Ajoutez ici d'autres fichiers statiques ou assets si besoin
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  event.respondWith(
    caches.match(req).then(cachedResp => {
      return cachedResp || fetch(req).then(networkResp => {
        // Met en cache les nouvelles ressources GET
        if (req.method === 'GET' && networkResp && networkResp.status === 200 && req.url.startsWith(self.location.origin)) {
          const clone = networkResp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return networkResp;
      }).catch(() => {
        // Fallback hors-ligne : retourne la page d'accueil si dispo
        if (req.mode === 'navigate') {
          return caches.match('/');
        }
      });
    })
  );
});
