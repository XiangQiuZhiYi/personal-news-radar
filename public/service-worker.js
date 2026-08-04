const CACHE = "news-radar-v6";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./speech.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

function normalizedDataRequest(request) {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url.toString(), { method: "GET" });
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const cacheKey = normalizedDataRequest(request);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(cacheKey, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isLatest = url.pathname.endsWith("/data/latest.json");
  const isHistory = url.pathname === "/api/history" || url.pathname.startsWith("/api/history/");
  if (isLatest || isHistory) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
