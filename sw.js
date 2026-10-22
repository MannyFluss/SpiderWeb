const base = new URL(".", self.location.href);
const hosted = true;
const CACHE = "spider-code-v22:" + base.pathname;
const shell = hosted
  ? [
      ".",
      "app.js",
      "companion-ui.js",
      "companion-ui.css",
      "knowledge-panel.js",
      "knowledge-panel.css",
      "launcher.js",
      "client-storage.js",
      "desktop.js",
      "gestures.js",
      "style.css",
      "shared.css",
      "sdk.js",
      "export.js",
      "download.js",
      "connection.js",
      "site-config.js",
    ]
  : [
      ".",
      "apps/spider.frontend/app.js",
      "apps/spider.frontend/companion-ui.js",
      "apps/spider.frontend/companion-ui.css",
      "apps/spider.frontend/knowledge-panel.js",
      "apps/spider.frontend/knowledge-panel.css",
      "apps/spider.frontend/launcher.js",
      "apps/spider.frontend/client-storage.js",
      "apps/spider.frontend/desktop.js",
      "apps/spider.frontend/gestures.js",
      "apps/spider.frontend/style.css",
      "apps/spider.frontend/shared.css",
      "apps/spider.frontend/sdk.js",
      "apps/spider.frontend/export.js",
      "apps/spider.frontend/download.js",
      "apps/spider.frontend/connection.js",
      "apps/spider.frontend/site-config.js",
    ];
const bundles = ["spider.chat", "spider.calculator", "spider.connections", "spider.ingestion", "spider.encyclopedia", "spider.canvas", "spider.experiments", "spider.reader", "spider.sandbox", "spider.builder", "spider.openrig", "spider.poetry", "spider.notes"].map(
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
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('spider-code-') && key.endsWith(':'+base.pathname) && key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())),
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
