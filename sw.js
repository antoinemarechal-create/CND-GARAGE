const CACHE = "cnd4-garage-v3-1";
const ASSETS = ["./","./index.html","./styles.css","./app.js","./manifest.webmanifest","./logo-cnd4-garage.png"];
self.addEventListener("install", event => { self.skipWaiting(); event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", event => {
  const req = event.request; if (req.method !== "GET") return;
  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(fetch(req).then(resp => { const copy=resp.clone(); caches.open(CACHE).then(cache=>cache.put("./index.html",copy)); return resp; }).catch(()=>caches.match("./index.html"))); return;
  }
  event.respondWith(caches.match(req).then(cached => { const network=fetch(req).then(resp=>{ const copy=resp.clone(); caches.open(CACHE).then(cache=>cache.put(req,copy)); return resp; }).catch(()=>cached); return cached || network; }));
});
