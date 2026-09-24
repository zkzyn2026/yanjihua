/* 离线缓存：预缓存应用外壳。改版时把 CACHE 版本号 +1 就会自动换新。 */
// 项目铁律：改了任何被缓存的静态文件就必须升版本号，否则手机端继续用旧缓存，用户看不到更新。
const CACHE = "yanjihua-v9";
const SHELL = [
  "./", "./index.html", "./app.css",
  "./config.js", "./io.js", "./db.js", "./bib.js", "./ui.js",
  "./home.js", "./papers.js", "./contests.js", "./projects.js", "./exams.js", "./stats.js", "./app.js",
  "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png",
  "./vendor/pdf.min.js", "./vendor/pdf.worker.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 「检查更新」靠带查询参数的 config.js?nocache=... 探测线上版本号：
  // 这类请求必须走网络，一旦命中缓存就永远比不出新版，按钮会一直说「已是最新」。
  if (url.search) { e.respondWith(fetch(req)); return; }
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
