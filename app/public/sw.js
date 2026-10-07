/*
 * Service worker: makes the web app work offline and load instantly on slow
 * connections. The file list and build id are injected at build time
 * (build/sw-manifest.ts). API calls (/api/…) are never cached.
 */
const PRECACHE = self.__PRECACHE__;
const BUILD = self.__BUILD__;
const CACHE = `tally-${BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tally-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return;

  // App shell: cache first (instant start, works offline); new versions arrive via SW update.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./', { ignoreSearch: true }).then((hit) => hit || fetch(req)),
    );
    return;
  }
  // Static assets: cache first, then network (and remember it).
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
