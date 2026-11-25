// Only this public fallback is stored. App pages, API calls and photos stay on the network.
const CACHE_PREFIX = "brushy-offline-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = "/offline.html";
const APP_PATHS = new Set(["/", "/calendar", "/capture", "/friends"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" }))),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  // Query strings can contain auth callback codes or server-function parameters.
  if (
    request.method !== "GET" ||
    request.mode !== "navigate" ||
    url.origin !== self.location.origin ||
    !(APP_PATHS.has(url.pathname) || /^\/friends\/[0-9a-f-]{36}$/i.test(url.pathname)) ||
    url.search
  )
    return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const fallback = await cache.match(OFFLINE_URL);
      // Static hosts may redirect .html URLs. A fresh response is safe for navigations.
      return fallback
        ? new Response(fallback.body, {
            headers: fallback.headers,
            status: 503,
            statusText: "Service Unavailable",
          })
        : Response.error();
    }),
  );
});
