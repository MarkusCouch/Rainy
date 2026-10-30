const VERSION = "rainy-v11";
const APP_CACHE = `${VERSION}-app`;
const DATA_CACHE = `${VERSION}-data`;
const TILE_CACHE = `${VERSION}-tiles`;
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest?v=icons2",
  "./src/app.js",
  "./src/forecast.js",
  "./src/motion.js",
  "./src/wind.js",
  "./src/palette.js",
  "./src/presentation.js",
  "./src/radar.js",
  "./src/sheet.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/icon-maskable-192.png",
  "./assets/icons/icon-maskable-512.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/favicon.ico",
  "./assets/icons/favicon-32.png",
  "./assets/icons/favicon-16.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

async function networkFirst(request, cacheName, timeoutMs = 4500) {
  const cache = await caches.open(cacheName);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timeout);
    if (response.ok || response.type === "opaque") cache.put(request, response.clone());
    return response;
  } catch (error) {
    clearTimeout(timeout);
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const update = fetch(request)
    .then((response) => {
      if (response.ok || response.type === "opaque") cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || update;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request, APP_CACHE).catch(() => caches.match("./index.html")));
    return;
  }

  if (url.hostname === "api.rainviewer.com") {
    event.respondWith(networkFirst(event.request, DATA_CACHE, 5000));
    return;
  }

  if (url.hostname.includes("rainviewer.com") || url.hostname.includes("tiles.openfreemap.org")) {
    event.respondWith(staleWhileRevalidate(event.request, TILE_CACHE));
    event.waitUntil(trimCache(TILE_CACHE, 180));
    return;
  }

  if (url.origin === self.location.origin || url.hostname === "unpkg.com") {
    event.respondWith(staleWhileRevalidate(event.request, APP_CACHE));
  }
});
