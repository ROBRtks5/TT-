
/**
 * TITAN SERVICE WORKER
 * Version: 43.3.0 (GOLD MASTER)
 * Strategy: Network First for HTML, Stale-While-Revalidate for Assets.
 * Cleanup: Auto-deletes old caches on activation.
 */

const CACHE_NAME = 'titan-v43.3.0';
const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/vite.svg'
];

self.addEventListener('install', (event) => {
  self.skipWaiting(); // Force activation immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching assets for v43.3.0');
      return cache.addAll(URLS_TO_CACHE);
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(), // Take control of all clients immediately
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Cleaning up old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
    ])
  );
});

self.addEventListener('fetch', (event) => {
  // 1. Navigation requests (HTML): Network First, fallback to Cache
  // Ensures user always gets the latest version if online.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return caches.match('/index.html');
        })
    );
    return;
  }

  // 2. Asset requests: Stale-While-Revalidate
  // Serve fast from cache, then update in background.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        // Only cache valid responses
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
           const responseToCache = networkResponse.clone();
           caches.open(CACHE_NAME).then((cache) => {
             cache.put(event.request, responseToCache);
           });
        }
        return networkResponse;
      }).catch(err => {
          // Network failed, nothing to update
          return cachedResponse; 
      });
      
      return cachedResponse || fetchPromise;
    })
  );
});
