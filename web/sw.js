// 오프라인 저장. 처음 열 때 모든 파일과 구절 데이터를 저장하고, 다음부터는 저장한 것을 먼저 보여 준 뒤
// 뒤에서 새 파일을 받아 둔다(다음에 열 때 반영). 파일을 바꾸면 VERSION을 올린다.
const VERSION = 'v100-2026-10-11-5';
const FILES = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/app.js',
  'js/views.js',
  'js/ui.js',
  'js/progress.js',
  'js/api.js',
  'js/config.js',
  'js/speech.js',
  'data/verses.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // 서버(Apps Script) 요청은 그대로 보낸다.
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(key, { ignoreSearch: true });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        e.waitUntil(fresh);
        return hit;
      }
      return (await fresh) || Response.error();
    }),
  );
});
