// Paper Dashboard — Service Worker
//
// Strategies:
//   1. Static + CDN assets   → cache-first, network fallback
//   2. GAS JSON endpoint     → stale-while-revalidate, postMessage on update
//
// Bump CACHE_VERSION when you change static assets to force clients to refresh.

const CACHE_VERSION = "v2";
const STATIC_CACHE = "dashboard-static-" + CACHE_VERSION;
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json"
];
const GAS_HOSTS = ["script.google.com", "script.googleusercontent.com"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // === GAS JSON: stale-while-revalidate ===
  if (GAS_HOSTS.includes(url.host)) {
    event.respondWith(handleGas(req));
    return;
  }

  // === Navigation (HTML): network-first so updates show without manual reload ===
  if (req.mode === "navigate" || (req.destination === "document")) {
    event.respondWith(handleNetworkFirst(req));
    return;
  }

  // === Static assets + CDN (JS / CSS / fonts): cache-first ===
  event.respondWith(handleStatic(req));
});

async function handleNetworkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      const cache = await caches.open(STATIC);
      try { await cache.put(req, res.clone()); } catch (e) {}
    }
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    return cached || Response.error();
  }
}

async function handleGas(req) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(req);

  const networkPromise = fetch(req, { redirect: "follow" })
    .then(async (res) => {
      // Only cache successful or opaque-redirect responses.
      if (res && (res.ok || res.type === "opaqueredirect")) {
        try { await cache.put(req, res.clone()); } catch (e) {}
        // Notify all clients so they re-render with fresh data.
        const clients = await self.clients.matchAll();
        clients.forEach((c) => c.postMessage({ type: "data-updated" }));
      }
      return res;
    })
    .catch(() => cached || Promise.reject(new Error("offline")));

  return cached || networkPromise;
}

async function handleStatic(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      const cache = await caches.open(STATIC_CACHE);
      try { await cache.put(req, res.clone()); } catch (e) {}
    }
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}
