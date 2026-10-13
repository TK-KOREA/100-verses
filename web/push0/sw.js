// 알림 0단계 시험 앱의 서비스 워커. 오프라인 저장은 하지 않고 알림만 받는다.
// 서버는 FCM에 data만 담아 보내고(title, body, url), 알림은 여기서 띄운다. 아이폰은 받은 알림을 반드시 보여 줘야 한다.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try {
    const j = e.data ? e.data.json() : {};
    d = j.data || j.notification || j;
  } catch (err) {
    d = { body: e.data ? e.data.text() : '' };
  }
  const url = new URL(d.url || './', self.registration.scope).href;
  const title = d.title || '말씀 보석 100';
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: d.body || '',
      icon: new URL('../icons/icon-192.png', self.registration.scope).href,
      data: { url },
    }),
    // 받은 알림을 기록해 둔다. 알림 띠를 놓쳐도 앱을 열면 "마지막으로 받은 알림"에서 확인한다.
    caches.open('push0-log').then((c) => c.put('last', new Response(JSON.stringify({ title, at: new Date().toISOString() })))),
  ]));
});

// 알림을 누르면 시험 앱을 그 주소로 연다(이미 열려 있으면 그 창을 옮긴다).
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || self.registration.scope;
  e.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) {
      if (c.url.startsWith(self.registration.scope) && 'navigate' in c) {
        const moved = await c.navigate(url);
        return (moved || c).focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
