var CACHE_NAME = "unko-nippo-react-v2";
var CORE_ASSETS = ["/", "/manifest.json", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  var isSameOrigin = url.origin === self.location.origin;
  var shouldUseNetworkFirst =
    req.mode === "navigate" ||
    req.destination === "document" ||
    req.destination === "script" ||
    req.destination === "style" ||
    req.destination === "manifest";

  if (!isSameOrigin) {
    event.respondWith(networkWithCacheFallback(req));
    return;
  }

  if (shouldUseNetworkFirst) {
    event.respondWith(networkWithCacheFallback(req));
    return;
  }

  event.respondWith(cacheFirst(req));
});

function networkWithCacheFallback(req) {
  return fetch(req)
    .then(function (res) {
      var resClone = res.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(req, resClone);
      });
      return res;
    })
    .catch(function () {
      return caches.match(req).then(function (cached) {
        return cached || caches.match("/");
      });
    });
}

function cacheFirst(req) {
  return caches.match(req).then(function (cached) {
    if (cached) return cached;

    return fetch(req)
      .then(function (res) {
        var resClone = res.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(req, resClone);
        });
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (cachedFallback) {
          return cachedFallback || caches.match("/");
        });
      });
  });
}
