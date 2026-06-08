const CACHE_NAME = "smithers-v2";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

// Only same-origin, OK, basic responses are safe to cache. This refuses to pin
// opaque/cross-origin responses or error pages (e.g. a 404) into the cache.
function isCacheable(request, response) {
  return (
    response &&
    response.ok &&
    response.type === "basic" &&
    new URL(request.url).origin === self.location.origin
  );
}

// Navigations are network-first: fetch the live shell so a fresh deploy can
// purge old hashed bundles without stranding returning users on a stale
// index.html. Falls back to the precached shell only when the network fails.
async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(request, response)) {
      const copy = response.clone();
      const cache = await caches.open(CACHE_NAME);
      // Store under "/" so the offline fallback always finds the shell, even for
      // deep-link navigations to client-routed paths.
      await cache.put("/", copy);
    }
    return response;
  } catch {
    const cached = await caches.match("/");
    if (cached) {
      return cached;
    }
    throw new Error("offline and no cached shell available");
  }
}

// Hashed static assets under /assets/ are content-addressed and immutable, so
// cache-first is safe and fast. Populate the cache on the first miss.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  const response = await fetch(request);
  if (isCacheable(request, response)) {
    const copy = response.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, copy);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") {
    return;
  }

  const isNavigation =
    request.mode === "navigate" || request.destination === "document";
  if (isNavigation) {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Everything else (cross-origin, and non-asset same-origin like /api/*,
  // /health, /workflows) is dynamic and often user-specific. Pass it straight
  // through to the network and never write it to the cache, so authenticated
  // GETs (e.g. /api/user) can never be pinned and served stale across logins.
});
