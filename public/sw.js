/* SkyWatch Australia — minimal offline shell + last weather frame cache */
const SHELL_CACHE = "skywatch-shell-v1";
const FRAME_CACHE = "skywatch-frames-v1";
const SHELL_URLS = ["/", "/radar", "/satellite", "/manifest.webmanifest"];

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

function isFrameRequest(url) {
  return (
    url.pathname.startsWith("/api/weather/frame") ||
    url.pathname.startsWith("/api/weather/radar-tile") ||
    url.pathname.startsWith("/api/weather/maps")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isFrameRequest(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(FRAME_CACHE).then((cache) => {
              cache.put(req, copy);
              // Keep cache small — delete oldest when over ~24 entries
              cache.keys().then((keys) => {
                if (keys.length > 24) {
                  cache.delete(keys[0]);
                }
              });
            });
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("/"))),
    );
    return;
  }

  // Navigation / shell: network first, cache fallback
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((c) => c || caches.match("/")),
        ),
    );
  }
});
