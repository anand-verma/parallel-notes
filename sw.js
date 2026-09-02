importScripts("./assets/js/sw-config.js");

self.addEventListener("install", event => {
  event.waitUntil(caches.open(SW_SHELL_CACHE).then(cache => cache.addAll(SW_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("pns-shell-v") && key !== SW_SHELL_CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const cache = await caches.open(SW_SHELL_CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return cached || (request.mode === "navigate" ? caches.match("./index.html") : Response.error());
    }
  })());
});
