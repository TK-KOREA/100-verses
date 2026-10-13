// 알림 0단계 시험 앱. 알림 허용 → FCM 토큰 받기 → 서버(Apps Script push0)에 "지금" 또는 "1분 뒤" 보내 달라고 한다.
// 서버 주소는 앱과 같은 ../js/config.js를 쓴다(localhost에서는 ?api= 흉내 서버만).
import { FIREBASE, VAPID_KEY } from './firebase-config.js';
import { post } from '../js/api.js';
import { API_URL } from '../js/config.js';

const $ = (id) => document.getElementById(id);
const store = {
  get: (k) => { try { return localStorage.getItem('push0_' + k) || ''; } catch (e) { return ''; } },
  set: (k, v) => { try { localStorage.setItem('push0_' + k, v); } catch (e) { /* 저장 못 해도 이번에는 쓴다 */ } },
};

function deviceId() {
  let id = store.get('device');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    id = 'p0_' + Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => chars[b % chars.length]).join('');
    store.set('device', id);
  }
  return id;
}

function log(msg) {
  const t = new Date().toTimeString().slice(0, 8);
  $('log').textContent = `${t} ${msg}\n` + $('log').textContent;
}

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const configured = () => !!(FIREBASE.projectId && FIREBASE.apiKey && VAPID_KEY);
let token = store.get('token');
let reg = null;

function paint() {
  const perm = 'Notification' in window ? Notification.permission : '없음';
  const rows = [
    ['홈 화면 앱으로 열림', standalone() ? '예' : '아니오', standalone()],
    ['알림 기능', 'PushManager' in window && 'serviceWorker' in navigator ? '있음' : '없음', 'PushManager' in window],
    ['알림 허용', { granted: '허용', denied: '거절', default: '아직' }[perm] || perm, perm === 'granted'],
    ['알림 토큰', token ? token.slice(0, 10) + '…' : '없음', !!token],
    ['Firebase 설정', configured() ? FIREBASE.projectId : '아직 비어 있음', configured()],
    ['서버', API_URL ? '연결' : '없음(localhost는 ?api=)', !!API_URL],
  ];
  $('status').replaceChildren(...rows.map(([k, v, good]) => {
    const row = document.createElement('div');
    row.className = 'st';
    const a = document.createElement('span');
    a.textContent = k;
    const b = document.createElement('b');
    b.textContent = v;
    b.className = good ? 'yes' : 'no';
    row.append(a, b);
    return row;
  }));
  $('now').disabled = !token;
  $('later').disabled = !token;
}

async function ensureRegistration() {
  if (!reg) reg = await navigator.serviceWorker.register('sw.js', { scope: './' });
  await navigator.serviceWorker.ready;
  return reg;
}

// 아이폰은 사용자가 누른 바로 그 순간에 허용을 물어야 한다. 그래서 다른 await보다 먼저 requestPermission을 부른다.
$('prepare').addEventListener('click', () => {
  if (!('Notification' in window)) {
    log('이 브라우저는 알림을 지원하지 않아요. 아이폰은 홈 화면에 추가한 앱에서 열어 주세요.');
    return;
  }
  const asking = Notification.requestPermission();
  (async () => {
    const perm = await asking;
    paint();
    if (perm !== 'granted') {
      log('알림 허용: ' + perm);
      return;
    }
    if (!configured()) {
      log('Firebase 설정이 아직 비어 있어요(firebase-config.js).');
      return;
    }
    try {
      const r = await ensureRegistration();
      if (!firebase.apps.length) firebase.initializeApp(FIREBASE);
      token = await firebase.messaging().getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: r });
      store.set('token', token);
      log('토큰 받음: ' + token.slice(0, 16) + '…');
    } catch (e) {
      log('토큰 받기 실패: ' + (e.code || e.name) + ' ' + e.message);
    }
    paint();
  })();
});

async function send(delay) {
  const btn = delay ? $('later') : $('now');
  btn.disabled = true;
  try {
    const d = await post('push0', { device_id: deviceId(), token, delay });
    log(delay ? `1분 뒤 보내기 예약(${d.due.slice(11, 19)}). 지금 앱을 닫고 화면을 끄세요.` : '서버가 보냈어요. 알림이 오는지 보세요.');
  } catch (e) {
    log('보내기 실패: ' + e.code + ' ' + e.message);
  } finally {
    btn.disabled = false;
  }
}
$('now').addEventListener('click', () => send(0));
$('later').addEventListener('click', () => send(60));

const opened = new URLSearchParams(location.search).get('opened');
if (opened) {
  $('opened').hidden = false;
  $('opened').textContent = opened === 'later' ? '✓ 1분 뒤 알림을 눌러서 열렸어요' : '✓ 알림을 눌러서 열렸어요';
}

if ('serviceWorker' in navigator) ensureRegistration().catch((e) => log('서비스 워커 등록 실패: ' + e.message));
paint();
