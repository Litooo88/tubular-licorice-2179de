const CACHE_NAME = "nordic-admin-shell-v5";
const SHELL_FILES = ["/admin/", "/admin/index.html", "/logo.png", "/nordic_logo_transparent.png"];
const SHELL_SET = new Set(SHELL_FILES);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only ever touch same-origin GET requests. This skips chrome-extension://
  // (Cache API rejects it on put), cross-origin analytics, and non-GET calls.
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  // NEVER cache API or serverless-function responses — they must always hit the
  // network. Caching them made the admin serve stale data from an old deploy.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return;
  if (url.pathname === "/admin/" || url.pathname === "/admin/index.html") {
    // Network-first with offline fallback. Cache/match on the pathname (not the
    // full URL) so deep links like /admin/?case=X reuse the cached shell instead
    // of missing the fallback and piling up one cache entry per query string.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/admin/index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("/admin/index.html").then((cached) => cached || caches.match("/admin/"))),
    );
    return;
  }

  // Cache-first ONLY for the fixed shell assets (logos). Everything else
  // (e.g. /assets/analytics.js, manifest) goes straight to the network so a
  // deploy is picked up without bumping CACHE_NAME.
  if (!SHELL_SET.has(url.pathname)) return;
  event.respondWith(
    caches.match(url.pathname).then((cached) =>
      cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(url.pathname, copy));
        }
        return response;
      }),
    ),
  );
});
