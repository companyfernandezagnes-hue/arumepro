// ==========================================
// 📱 Service Worker — Arume PRO
// Push Notifications + Offline Cache
// ==========================================

const CACHE_NAME = 'arume-pro-v3';
// Derivar la base del scope del propio SW (p.ej. /arumepro/ en GitHub Pages, / en dev)
const BASE = new URL(self.registration?.scope || self.location.href).pathname;
const OFFLINE_URL = BASE;

// Assets to cache for offline
const PRECACHE_URLS = [
  BASE,
  `${BASE}manifest.json`,
];

// ── Install: cache core assets ──
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch(() => {
        // Ignore cache errors during install (dev mode may not have all files)
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first with cache fallback ──
self.addEventListener('fetch', (event) => {
  // Skip non-GET and chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('chrome-extension://')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses for offline
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline: try cache
        return caches.match(event.request).then((cached) => {
          return cached || caches.match(OFFLINE_URL);
        });
      })
  );
});

// ── Push Notification handler ──
self.addEventListener('push', (event) => {
  let data = { title: 'Arume PRO', body: 'Nueva notificación', icon: '/arumepro/icon-192x192.png' };

  try {
    if (event.data) {
      const payload = event.data.json();
      data = {
        title: payload.title || data.title,
        body: payload.body || data.body,
        icon: payload.icon || data.icon,
        tag: payload.tag || 'arume-notification',
        data: payload.data || {},
        ...payload,
      };
    }
  } catch {
    if (event.data) {
      data.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: '/arumepro/icon-192x192.png',
      tag: data.tag || 'arume-default',
      vibrate: [200, 100, 200],
      requireInteraction: false,
      actions: data.actions || [],
      data: data.data || {},
    })
  );
});

// ── Notification click handler ──
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = event.notification.data?.url || BASE;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes('/arumepro') && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open new window
      return self.clients.openWindow(urlToOpen);
    })
  );
});
