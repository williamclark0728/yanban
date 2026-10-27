// Keeps the app shell available offline so the installed app (Android, desktop browsers) opens without a network.
// Model calls, search and everything under /api/ always go to the network.
const CACHE = "yanban-shell-v1";
const SHELL = ["/", "/icon.svg", "/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = (request, response) => {
  if (response.ok) caches.open(CACHE).then((c) => c.put(request, response.clone()));
  return response;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  // Pages: the newest version when online, the cached shell when not.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then((r) => put("/", r)).catch(() => caches.match("/")));
    return;
  }
  // Built files have content hashes in their names, so a cached copy never goes stale.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/pdfjs/")) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then((r) => put(request, r))));
    return;
  }
  event.respondWith(fetch(request).then((r) => put(request, r)).catch(() => caches.match(request)));
});
