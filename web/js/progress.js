// 진도: 기기에 먼저 쓰고, 뒤에서 서버(Apps Script → 구글 시트)와 주고받는다(기획서 "진도 저장").
// 저장소가 막혀 있어도 화면은 돌아가야 하므로 읽기·쓰기는 모두 try로 감싼다.
import { API_URL } from './config.js';
import { get, post, ApiError } from './api.js';

const P = 'v100_';

export function load(key, fallback) {
  try {
    const v = localStorage.getItem(P + key);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

export function save(key, value) {
  try {
    if (value === undefined) localStorage.removeItem(P + key);
    else localStorage.setItem(P + key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

export function randomId(n = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** 기기 키: 횟수 제한에만 쓰는 무작위 글자. 기기 고유 번호가 아니다. */
export function deviceId() {
  let id = load('device_id', '');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = randomId(20);
    save('device_id', id);
  }
  return id;
}

// ---------- 시간 (KST) ----------

export function kstNow() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';
}
export const kstToday = () => kstNow().slice(0, 10);
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function dateLabel(at) {
  const [, m, d] = at.slice(0, 10).split('-').map(Number);
  return `${m}월 ${d}일`;
}

// ---------- 상태 ----------

let marks = load('marks', {}); // {구절 id: {done, at}} 구절마다 마지막 기록
let outbox = load('outbox', []); // 아직 서버에 못 보낸 기록 [{verse_id, action, at, request_id}]
let profile = { code: '', nickname: '', nameDirty: false, registerRid: '', ...load('profile', {}) };
let sync$ = { state: API_URL ? 'idle' : 'local', at: load('synced_at', ''), error: '' };

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => fn());
}
function persist() {
  save('marks', marks);
  save('outbox', outbox);
  save('profile', profile);
}

export const isDone = (id) => !!marks[id]?.done;
export const doneAt = (id) => (marks[id]?.done ? marks[id].at : '');

/** 외운 구절을 외운 순서대로. 계단은 이 순서대로 아래부터 채운다. */
export function doneList() {
  return Object.entries(marks)
    .filter(([, m]) => m.done)
    .map(([id, m]) => ({ id: Number(id), at: m.at }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
}
export const doneCount = () => doneList().length;

/** 오늘의 구절: 번호 순서로 아직 안 외운 첫 구절. 다 외웠으면 null. */
export function nextVerseId(verses) {
  const v = verses.find((x) => !isDone(x.id));
  return v ? v.id : null;
}

/** 연속 일수: 오늘(없으면 어제)부터 거꾸로, 외운 기록이 있는 날이 이어진 수. */
export function streak() {
  const days = new Set(doneList().map((m) => m.at.slice(0, 10)));
  let d = kstToday();
  if (!days.has(d)) d = addDays(d, -1);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

function enqueue(id, done, at) {
  outbox.push({ verse_id: id, action: done ? 'done' : 'undo', at, request_id: randomId(20) });
}

/** "외웠어요!"(done=true) 또는 취소(done=false). 기기에 바로 쓰고, 서버로는 뒤에서 보낸다. */
export function setMark(id, done) {
  if (isDone(id) === done) return;
  const at = kstNow();
  marks[id] = { done, at };
  enqueue(id, done, at);
  persist();
  emit();
  sync();
}

export const code = () => profile.code;
export const nickname = () => profile.nickname;
export function setNickname(name) {
  profile.nickname = name;
  profile.nameDirty = true;
  persist();
  emit();
  sync();
}

export const pendingCount = () => outbox.length;
export const syncState = () => ({ ...sync$, pending: outbox.length, hasServer: !!API_URL });

/**
 * 홈 화면 앱이면 브라우저가 저장 공간이 모자랄 때 기록과 오프라인 파일을 지우지 않게 해 달라고 한다.
 * 브라우저 안에서는 묻지 않는다(Firefox는 창을 띄워 묻는다).
 */
export async function keepStorage() {
  try {
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (!standalone || !navigator.storage?.persist) return;
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch (e) {
    /* 지원하지 않으면 그대로 둔다 */
  }
}

export const welcomed = () => load('welcomed', false);
export const setWelcomed = () => save('welcomed', true);

// ---------- 서버와 주고받기 ----------

/** 서버 상태를 합친다. 구절마다 더 늦은 기록이 이긴다. */
function merge(serverMarks) {
  let changed = false;
  for (const s of serverMarks) {
    const local = marks[s.verse_id];
    if (!local || s.at > local.at) {
      if (!local || local.done !== s.done || local.at !== s.at) changed = true;
      marks[s.verse_id] = { done: s.done, at: s.at };
    }
  }
  return changed;
}

function setSync(state, error = '') {
  sync$ = { ...sync$, state, error };
  if (state === 'ok') {
    sync$.at = kstNow();
    save('synced_at', sync$.at);
  }
  emit();
}

let running = null;
let again = false;
let retryTimer = null;
let retryDelay = 30000;

// navigator.onLine이 false면 확실히 끊긴 것이다(true는 연결됐다는 보장이 없다).
export const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export function sync() {
  if (!API_URL) return Promise.resolve();
  if (isOffline()) {
    // 보내 보지 않는다. 다시 연결되면 online 알림(app.js)으로 보낸다.
    if (sync$.state !== 'offline') setSync('offline');
    return running || Promise.resolve();
  }
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    setSync('syncing');
    try {
      let rounds = 0;
      do {
        again = false;
        await syncOnce();
      } while ((again || outbox.length) && ++rounds < 5);
      setSync('ok');
      retryDelay = 30000;
    } catch (e) {
      if (e.code === 'NETWORK' && isOffline()) {
        setSync('offline');
      } else {
        setSync(e.code === 'NETWORK' ? 'pending' : 'error', e.code || 'NETWORK');
        // 앱을 다시 열기 전에도 다시 보낸다(약한 연결, 횟수 제한). 30초부터 두 배씩, 10분까지.
        if (!retryTimer) {
          retryTimer = setTimeout(() => { retryTimer = null; sync(); }, retryDelay);
          retryDelay = Math.min(retryDelay * 2, 600000);
        }
      }
    } finally {
      running = null;
    }
  })();
  return running;
}

async function syncOnce() {
  if (!profile.code) {
    // 보낼 것이 생겼을 때만 계단 코드를 만든다(열어 보기만 한 기기나 코드로 불러올 기기에 빈 코드가 생기지 않게).
    if (!outbox.length && !profile.nameDirty && !Object.keys(marks).length) return;
    if (!profile.registerRid) {
      profile.registerRid = randomId(20);
      persist();
    }
    const d = await post('register', { device_id: deviceId(), request_id: profile.registerRid, nickname: profile.nickname });
    profile.code = d.code;
    profile.nameDirty = false;
    requeueAll(); // 새 코드에는 아무 기록도 없으므로 이 기기의 기록을 모두 보낸다.
    persist();
    emit();
  }
  const batch = outbox.slice(0, 200);
  const body = { code: profile.code, device_id: deviceId(), marks: batch };
  const sentName = profile.nameDirty ? profile.nickname : null;
  if (sentName !== null) body.nickname = sentName;
  let d;
  try {
    d = await post('sync', body);
  } catch (e) {
    if (e.code !== 'NOT_FOUND') throw e;
    // 시트에서 코드가 지워진 경우: 새 코드를 받고 이 기기 기록을 모두 다시 보낸다.
    profile.code = '';
    profile.registerRid = '';
    requeueAll();
    persist();
    again = true;
    return;
  }
  const sent = new Set(batch.map((m) => m.request_id));
  outbox = outbox.filter((m) => !sent.has(m.request_id));
  if (sentName !== null && profile.nickname === sentName) profile.nameDirty = false;
  if (!profile.nameDirty && d.nickname !== profile.nickname) profile.nickname = d.nickname;
  merge(d.marks);
  persist();
  emit();
}

function requeueAll() {
  const queued = new Set(outbox.map((m) => m.verse_id + '|' + m.at));
  for (const [id, m] of Object.entries(marks)) {
    if (!queued.has(id + '|' + m.at)) enqueue(Number(id), m.done, m.at);
  }
}

/**
 * 다른 기기의 계단 코드로 불러오기. 두 기기의 기록을 합친다(구절마다 늦은 기록).
 * 이 기기에만 있는 기록은 그 코드로 다시 보낸다.
 */
export async function restore(typed) {
  const d = await get('load', { code: typed, device_id: deviceId() });
  const server = {};
  d.marks.forEach((m) => { server[m.verse_id] = m; });
  const queued = new Set(outbox.map((m) => m.verse_id + '|' + m.at));
  for (const [id, m] of Object.entries(marks)) {
    const s = server[id];
    if ((!s || m.at > s.at) && !queued.has(id + '|' + m.at)) enqueue(Number(id), m.done, m.at);
  }
  profile.code = d.code;
  profile.registerRid = '';
  if (d.nickname) {
    profile.nickname = d.nickname;
    profile.nameDirty = false;
  }
  merge(d.marks);
  persist();
  emit();
  sync();
  return d;
}

// 같은 기기에서 앱을 탭 두 개로 열었을 때, 다른 탭이 쓴 기록을 덮어쓰지 않게 다시 읽는다.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key && !e.key.startsWith(P)) return;
    marks = load('marks', {});
    outbox = load('outbox', []);
    profile = { code: '', nickname: '', nameDirty: false, registerRid: '', ...load('profile', {}) };
    emit();
  });
}

export { ApiError };
