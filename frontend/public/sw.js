const CACHE_NAME = 'getsubscribed-cache-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) {
    return;
  }
  
  const isHtml = e.request.mode === 'navigate' || e.request.url.endsWith('.html') || e.request.url === self.location.origin + '/';
  
  if (isHtml) {
    // Network-first for HTML pages (prevents cached index.html referencing old hashed JS bundles)
    e.respondWith(
      fetch(e.request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
        return response;
      }).catch(() => {
        return caches.match(e.request);
      })
    );
  } else {
    // Cache-first for static assets
    e.respondWith(
      caches.match(e.request).then((cachedResponse) => {
        return cachedResponse || fetch(e.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy));
          return response;
        });
      })
    );
  }
});
