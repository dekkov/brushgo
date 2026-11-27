// Only this public fallback is stored. App pages, API calls and photos stay on the network.
const CACHE_PREFIX = "brushy-offline-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = "/offline.html";
const APP_PATHS = new Set(["/", "/calendar", "/capture", "/friends", "/settings"]);
const UUID = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const SELFIE_PATH = new RegExp(`^/selfie/${UUID}/${UUID}$`, "i");
const PUSH_COPY = {
  reminder: { body: "It’s time for a Brushy check-in.", path: "/capture" },
  request: { body: "You have a new friend request.", path: "/friends" },
  heart: { body: "Someone liked your selfie." },
};

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
    !(
      APP_PATHS.has(url.pathname) ||
      /^\/friends\/[0-9a-f-]{36}$/i.test(url.pathname) ||
      SELFIE_PATH.test(url.pathname)
    ) ||
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

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload;
      try {
        payload = event.data?.json();
      } catch {
        return;
      }
      if (!payload || typeof payload.kind !== "string" || !Object.hasOwn(PUSH_COPY, payload.kind))
        return;
      const copy = PUSH_COPY[payload.kind];
      const path = copy.path ?? `/selfie/${payload.target}/${payload.revision}`;
      if (payload.kind === "heart" && !SELFIE_PATH.test(path)) return;
      await self.registration.showNotification("Brushy", {
        body: copy.body,
        icon: "/icons/icon-192.png",
        data: { path },
      });
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "brushy-push-ready") event.ports[0]?.postMessage(true);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data?.path;
  if (
    typeof path !== "string" ||
    (path !== "/capture" && path !== "/friends" && !SELFIE_PATH.test(path))
  )
    return;
  event.waitUntil(
    (async () => {
      const url = new URL(path, self.location.origin).href;
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const match = windows.find((client) => client.url === url);
      if (match) await match.focus();
      else await self.clients.openWindow(url);
    })(),
  );
});
