// Paper Dashboard — Service Worker
//
// OneSignal SW logic is layered ON TOP of our cache strategies so push events
// keep working alongside the dashboard's offline behaviour. This must be the
// first import or push events won't reach the page reliably.
try { importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js"); }
catch (e) { /* OneSignal not configured / offline first-load → ignore */ }

// Strategies:
//   1. Static + CDN assets   → cache-first, network fallback
//   2. Navigation (HTML)     → network-first so updates show without manual reload
//   3. GAS JSON endpoint     → NETWORK-FIRST: prefer fresh data; only fall back
//                              to the cache when the network throws (offline,
//                              DNS error, etc). On fallback, postMessage
//                              `data-stale` so the UI can show an error chip.
//
// Bump CACHE_VERSION when you change static assets to force clients to refresh.

const CACHE_VERSION = "v4";
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

  if (GAS_HOSTS.includes(url.host)) {
    event.respondWith(handleGas(req));
    return;
  }

  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(handleNetworkFirst(req));
    return;
  }

  event.respondWith(handleStatic(req));
});

async function handleNetworkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === "opaque")) {
      const cache = await caches.open(STATIC_CACHE);
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
  try {
    const res = await fetch(req, { redirect: "follow" });
    if (res && (res.ok || res.type === "opaqueredirect")) {
      try { await cache.put(req, res.clone()); } catch (e) {}
    }
    return res;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) {
      const clients = await self.clients.matchAll();
      clients.forEach((c) => c.postMessage({
        type: "data-stale",
        reason: String((err && err.message) || err) || "network error"
      }));
      return cached;
    }
    throw err;
  }
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

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "skip-waiting") self.skipWaiting();
});
