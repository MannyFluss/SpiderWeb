const base = new URL(".", self.location.href);
const hosted = base.pathname !== "/";
const CACHE = "spider-code-v6:" + base.pathname;
const shell = hosted
  ? [
      ".",
      "app.js",
      "style.css",
      "shared.css",
      "sdk.js",
      "export.js",
      "connection.js",
    ]
  : [
      ".",
      "apps/spider.frontend/app.js",
      "apps/spider.frontend/style.css",
      "apps/spider.frontend/shared.css",
      "apps/spider.frontend/sdk.js",
      "apps/spider.frontend/export.js",
      "apps/spider.frontend/connection.js",
    ];
const bundles = ["spider.chat", "spider.calculator", "spider.connections", "spider.ingestion"].map(
  (id) => `apps/${id}/dist/index.html`,
);
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(
          [...shell, ...bundles].map((file) => new URL(file, base).href),
        ),
      )
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== base.origin ||
    !url.pathname.startsWith(base.pathname) ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/health"
  )
    return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok)
          caches
            .open(CACHE)
            .then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(
        async () =>
          (await caches.match(event.request)) ||
          new Response(
            "This code has not been saved on this browser yet. Reconnect once to load it.",
            { status: 503, headers: { "Content-Type": "text/plain" } },
          ),
      ),
  );
});
