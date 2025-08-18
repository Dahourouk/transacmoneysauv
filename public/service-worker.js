self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  clients.claim();
});

// Basic fetch handler: try cache first or network fallback. For prototype we keep it minimal.
self.addEventListener('fetch', (event) => {
  // You can add caching strategies here with Workbox for a production app.
});
