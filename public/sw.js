/* SkyWatch Australia — offline shell + cache-first immutable weather assets */
const SHELL_CACHE = "skywatch-shell-v3";
const FRAME_CACHE = "skywatch-frames-v3";
/** Do not precache HTML routes — that trapped navigations on stale shells. */
const SHELL_URLS = ["/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== SHELL_CACHE && k !== FRAME_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isImmutableWeatherAsset(url) {
  // Content-addressed frame/tile URLs — safe to serve from cache first.
  return (
    url.pathname.startsWith("/api/weather/frame") ||
    url.pathname.startsWith("/api/weather/radar-tile")
  );
}

function isMapsCatalog(url) {
  return url.pathname.startsWith("/api/weather/maps");
}

function trimCache(cache, maxEntries) {
  return cache.keys().then((keys) => {
    if (keys.length <= maxEntries) return;
    return Promise.all(
      keys.slice(0, keys.length - maxEntries).map((k) => cache.delete(k)),
    );
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isImmutableWeatherAsset(url)) {
    event.respondWith(
      caches.open(FRAME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              void cache.put(req, copy).then(() => trimCache(cache, 48));
            }
            return res;
          });
        }),
      ).catch(() => caches.match("/")),
    );
    return;
  }

  if (isMapsCatalog(url)) {
    // Stale-while-revalidate: show CDN/cache quickly, refresh in background.
    event.respondWith(
      caches.open(FRAME_CACHE).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res.ok) {
                void cache.put(req, res.clone());
              }
              return res;
            })
            .catch(() => cached || Response.error());
          return cached || network;
        }),
      ),
    );
    return;
  }

  // Navigation: always network. Do not cache HTML documents — serving a
  // cached "/" /radar shell for other routes breaks client-side routing.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match(req).then((c) => c || caches.match("/")),
      ),
    );
  }
});
