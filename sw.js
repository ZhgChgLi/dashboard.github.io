// Paper Dashboard — Service Worker
//
// Strategies:
//   1. Static + CDN assets   → cache-first, network fallback
//   2. Navigation (HTML)     → network-first so updates show without manual reload
//   3. GAS JSON endpoint     → STALE-WHILE-REVALIDATE: respond immediately with
//                              the cached payload (if any), kick off a network
//                              fetch in the background, postMessage `data-fresh`
//                              when the new payload lands so the page can
//                              re-read it from cache and update state without
//                              blocking the user. On network failure with a
//                              cached fallback, postMessage `data-stale`.
//
// Bump CACHE_VERSION when you change static assets to force clients to refresh.

const CACHE_VERSION = "v15";
const STATIC_CACHE = "dashboard-static-" + CACHE_VERSION;
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./sw.js"
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
    // Offline: try exact match first (preserves ?key=…), then ignore the
    // query string so a fresh `?key=abc` install still finds the precached
    // shell, then fall through to the bare index.html / scope root.
    const cached =
      (await caches.match(req)) ||
      (await caches.match(req, { ignoreSearch: true })) ||
      (await caches.match("./index.html")) ||
      (await caches.match("./"));
    return cached || Response.error();
  }
}

async function handleGas(req) {
  const cache = await caches.open(STATIC_CACHE);
  // If the page asked for a fresh round-trip (cache: 'reload' on the
  // Request), bypass SWR and behave network-first — used by the manual
  // refresh button. Detected via the cache mode rather than a custom
  // header so we don't have to mutate every fetch site.
  if (req.cache === "reload" || req.cache === "no-store") {
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

  // SWR path: serve cached payload immediately (if any), refresh in the
  // background. On successful revalidate, ship the parsed JSON inline via
  // postMessage so the page updates state directly — we deliberately do
  // NOT ask the page to re-fetch (that would loop: re-fetch → SW SWR →
  // background fetch → another 'data-fresh' → re-fetch → ...). On
  // network failure with a cached fallback, post 'data-stale' so the UI
  // can show a "from cache" chip.
  const cached = await cache.match(req);
  const network = fetch(req, { redirect: "follow" })
    .then(async (res) => {
      if (res && (res.ok || res.type === "opaqueredirect")) {
        try { await cache.put(req, res.clone()); } catch (e) {}
        let payload = null;
        try { payload = await res.clone().json(); } catch (e) { /* opaque or non-JSON; leave null */ }
        const clients = await self.clients.matchAll();
        clients.forEach((c) => c.postMessage({ type: "data-fresh", payload: payload }));
      }
      return res;
    })
    .catch(async (err) => {
      const fallback = await cache.match(req);
      if (fallback) {
        const clients = await self.clients.matchAll();
        clients.forEach((c) => c.postMessage({
          type: "data-stale",
          reason: String((err && err.message) || err) || "network error"
        }));
        return fallback;
      }
      throw err;
    });

  return cached || network;
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
