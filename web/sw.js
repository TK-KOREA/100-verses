// 오프라인 저장. 처음 열 때 모든 파일과 구절 데이터를 저장하고, 다음부터는 저장한 것을 먼저 보여 준 뒤
// 뒤에서 새 파일을 받아 둔다(다음에 열 때 반영). 파일을 바꾸면 VERSION을 올린다.
const VERSION = 'v100-2026-10-23-1';
// 들어 보기 음원(web/audio/**/*.m4a, *.aac)은 크고 잘 안 바뀌어서 VERSION과 따로 둔다. 한 번 받은 것은 계속 쓴다.
// 음원을 다시 만들면(같은 주소에 새 소리) AUDIO 이름을 올린다.
const AUDIO = 'audio-1';
const ROOT = new URL('./', self.location).pathname; // 앱이 놓인 경로(/100-verses/)
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
  'js/player.js',
  'js/sheet.js',
  'js/listen.js',
  'js/gems.js',
  'data/verses.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'audio/gap-0.5.m4a',
  'audio/gap-1.m4a',
  'audio/gap-2.m4a',
  'audio/gap-4.m4a',
  'audio/gap-0.5.aac',
  'audio/gap-1.aac',
  'audio/gap-2.aac',
  'audio/gap-4.aac',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — 브라우저 캐시(GitHub Pages는 10분)를 거치지 않고 새로 받는다.
  // 안 그러면 배포 직후에 연 기기가 옛 파일을 새 버전 이름으로 저장해 버린다.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== AUDIO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // 서버(Apps Script) 요청은 그대로 보낸다.
  // 앱 화면이 아닌 페이지(알림 0단계 시험 앱 push0/ 등)는 앱 화면으로 바꾸지 않고 그대로 받는다.
  if (req.mode === 'navigate' && url.pathname !== ROOT && url.pathname !== ROOT + 'index.html') return;
  if (url.pathname.startsWith(ROOT + 'push0/')) return;
  if (url.pathname.startsWith(ROOT + 'audio/') && /\.(m4a|aac)$/.test(url.pathname)) {
    e.respondWith(audio(req, url));
    return;
  }
  const key = req.mode === 'navigate' ? 'index.html' : req;
  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(key, { ignoreSearch: true });
      // 화면 이동 요청은 옵션을 붙여 다시 만들 수 없는 브라우저가 있어 주소로 받는다.
      const fresh = fetch(req.mode === 'navigate' ? req.url : req, { cache: 'no-cache' })
        .then(async (res) => {
          // 주소 끝 /가 빠져 넘겨받은 응답은 그대로 쓰면 Safari가 화면을 열지 않는다. 새 응답으로 옮긴다.
          if (res.redirected) res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
          if (res.ok) await cache.put(key, res.clone());
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

/** 음원: 저장해 둔 것을 먼저 쓰고, 없으면 통째로 받아 저장한다. Safari는 음원을 조각(Range)으로
 * 달라고 하므로 조각 요청에는 206으로 잘라 준다(통째로 200을 주면 Safari가 틀지 않는다). */
async function audio(req, url) {
  const cache = await caches.open(url.pathname.includes('/gap-') ? VERSION : AUDIO);
  const key = url.pathname + url.search; // ?v=는 소리가 바뀌면 바뀐다
  let res = await cache.match(key);
  if (!res) {
    try {
      res = await fetch(key, { cache: 'no-cache' });
    } catch (e) {
      return Response.error();
    }
    if (!res.ok) return res;
    await cache.put(key, res.clone());
  }
  const range = req.headers.get('range');
  if (!range) return res;
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  const size = buf.byteLength;
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : size - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; } // bytes=-500
  end = Math.min(end, size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': url.pathname.endsWith('.aac') ? 'audio/aac' : 'audio/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
