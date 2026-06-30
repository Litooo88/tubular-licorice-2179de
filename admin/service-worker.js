const CACHE_NAME = "nordic-admin-shell-v4";
const SHELL_FILES = ["/admin/", "/admin/index.html", "/logo.png", "/nordic_logo_transparent.png"];

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
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // Static shell assets only (logo, etc.): cache-first.
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }),
    ),
  );
});
