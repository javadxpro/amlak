// املاک حامدی - Service Worker برای PWA
const CACHE_NAME = 'amlak-hamedi-v27';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './properties.json',
  './manifest.json',
  './sitemap.xml',
  './robots.txt'
];

self.addEventListener('install', event => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app shell');
        return cache.addAll(URLS_TO_CACHE.map(url => new Request(url, {cache: 'reload'}))).catch(err => {
          console.warn('[SW] Cache addAll failed', err);
          // Try individual
          return Promise.all(URLS_TO_CACHE.map(url => 
            cache.add(url).catch(e => console.warn('Failed to cache', url))
          ));
        });
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  
  // Skip non-GET and chrome extensions
  if (req.method !== 'GET' || url.protocol === 'chrome-extension:') return;
  
  // For properties.json, network first, then cache
  if (url.pathname.endsWith('properties.json')) {
    event.respondWith(
      fetch(req, {cache: 'no-store'})
        .then(res => {
          // Update cache
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
          return res;
        })
        .catch(() => {
          return caches.match(req).then(cached => cached || fetch(req));
        })
    );
    return;
  }
  
  // صفحه‌ی اصلی (HTML): اول شبکه تا همیشه آخرین نسخه نمایش داده شود، بعد کش برای حالت آفلاین
  if (req.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
          return res;
        })
        .catch(() => caches.match(req).then(cached => cached || caches.match('./index.html') || caches.match('./')))
    );
    return;
  }

  // سایر درخواست‌ها: اول کش، بعد شبکه
  event.respondWith(
    caches.match(req)
      .then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          // Cache successful responses
          if (res.ok && req.url.startsWith(self.location.origin)) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
          }
          return res;
        }).catch(() => {
          // Fallback to index.html for navigation requests
          if (req.mode === 'navigate') {
            return caches.match('./index.html') || caches.match('./');
          }
        });
      })
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
