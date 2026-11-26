const CACHE = 'starsprout-v5';
const SHELL = ['/', '/device', '/device.html', '/styles.css', '/theme.css', '/device.css', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
  '/js/app.js', '/js/api.js', '/js/ui.js', '/js/assets.js', '/js/device.js',
  '/js/views/home.js', '/js/views/curriculum.js', '/js/views/learn.js', '/js/views/plans.js', '/js/views/agent.js', '/js/pet3d.js', '/js/views/registry.js',
  '/js/views/community.js', '/js/views/devices.js', '/js/views/account.js', '/js/views/admin.js', '/js/views/pet.js', '/js/views/child.js', '/js/views/childModal.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.allSettled(SHELL.map(asset => cache.add(asset)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  // Network-first keeps the app fresh during iteration while still supporting offline screens.
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') return caches.match(url.pathname.startsWith('/device') ? '/device' : '/');
      return new Response('离线内容暂不可用', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    })
  );
});
