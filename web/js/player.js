// 들어 보기: 미리 만든 음원(web/audio/<목소리>/)으로 몇 번이고, 다음 말씀으로 이어서 읽는다.
// 음원이 없는 구절이나 "기기 목소리"는 speech.js로 읽는다. 화면은 sheet.js가 그린다.
//
// 한 번 읽기 = [주소] 본문 [주소]. 정한 횟수만큼 읽고 다음 말씀으로 간다.
// 쉼도 소리 없는 음원으로 채운다. 그래야 화면이 꺼져도 다음 소리로 넘어간다(setTimeout은 멈춘다).
import { load, save, isLearned } from './progress.js';
import * as S from './speech.js';

export const VOICES = [
  { key: 'teacher', name: '주일학교 선생님', who: '다정한 여자 선생님' },
  { key: 'sister', name: '다정한 언니', who: '밝은 고등학생 언니' },
  { key: 'dad', name: '든든한 아빠', who: '자기 전에 읽어 주는 아빠' },
  { key: 'clear', name: '또박또박 선생님', who: '또렷한 여자 선생님' },
  { key: 'storyteller', name: '이야기 할아버지', who: '부드러운 할아버지' },
  { key: 'device', name: '기기 목소리', who: '이 기기에 들어 있는 목소리' },
];
const voiceName = (k) => (VOICES.find((x) => x.key === k) || VOICES[0]).name;

const DEFAULTS = { times: 1, next: 'stop', order: 'seq', ref: 'front', gap: 'short', sleep: 0, voice: 'teacher' };
const SLOW_RATE = 0.8;
const GAPS = { short: { rep: 1, verse: 2 }, long: { rep: 2, verse: 4 } };

export function prefs() {
  const p = { ...DEFAULTS, ...load('listen', {}) };
  if (!VOICES.some((x) => x.key === p.voice)) p.voice = DEFAULTS.voice;
  return p;
}

let byId = {};
let ids = [];
export function init(app) {
  byId = app.byId;
  ids = app.verses.map((v) => v.id);
  manifest(prefs().voice); // 처음 누를 때 기다리지 않게 미리 받아 둔다.
}

// ---------- 음원 ----------

const manifests = {};
function manifest(voice) {
  if (voice === 'device') return Promise.resolve(null);
  if (!manifests[voice]) {
    manifests[voice] = fetch(`audio/${voice}/manifest.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((m) => {
        if (!m) delete manifests[voice]; // 다음에 다시 받아 본다
        manifests[voice + ':v'] = m;
        return m;
      });
  }
  return manifests[voice];
}
const manifestNow = (voice) => manifests[voice + ':v'] || null;

/** 이 구절을 그 목소리 음원으로 읽을 수 있으면 시간표를, 아니면 null. */
export function entryFor(id, voice = prefs().voice) {
  return usable(manifestNow(voice)?.verses?.[id], byId[id]);
}

/** 음원 길이가 글자 수에 견주어 말이 안 되면(모델이 오래 멈춘 음원) 쓰지 않고 기기 목소리로 읽는다. */
function usable(e, v) {
  if (!e || !v) return null;
  const n = v.text.replace(/[^0-9A-Za-z가-힣]/g, '').length;
  return e.dur > n * 0.6 + 6 ? null : e;
}

// 음원은 통째로 받아 blob으로 튼다. 다음 구절을 미리 받아 두면 화면이 꺼져 있어도 끊기지 않는다.
const blobs = new Map();
function clip(path) {
  if (!blobs.has(path)) {
    const p = fetch(path)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => URL.createObjectURL(b));
    p.catch(() => blobs.delete(path));
    blobs.set(path, p);
    while (blobs.size > 16) {
      const [k, old] = blobs.entries().next().value;
      blobs.delete(k);
      old.then((u) => URL.revokeObjectURL(u), () => {});
    }
  }
  return blobs.get(path);
}
const pad3 = (n) => String(n).padStart(3, '0');
const clipPath = (voice, id, part) => `audio/${voice}/${pad3(id)}/${part}.m4a?v=${entryFor(id, voice)?.v || ''}`;
const gapPath = (sec) => `audio/gap-${sec}.m4a`;

// ---------- 상태 ----------

const audio = typeof Audio !== 'undefined' ? new Audio() : null;
if (audio) audio.preload = 'auto';

let st = null; // 읽는 중일 때만 있다
let gen = 0; // 멈추거나 건너뛰면 늘려서 늦게 온 끝 알림을 버린다
let timer = 0;
const subs = new Set();

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
function emit() {
  const s = state();
  subs.forEach((fn) => fn(s));
}

/** 화면에 보여 줄 지금 상태. */
export function state() {
  if (!st) return { on: false, last: lastPlayed };
  const v = byId[st.queue[st.qi]];
  const p = prefs();
  return {
    on: true,
    paused: st.paused,
    verse: v,
    rep: st.rep,
    times: p.times,
    index: st.qi,
    total: st.queue.length,
    next: byId[st.queue[st.qi + 1]] || null,
    ctx: st.ctx,
    audio: !!st.entry,
    part: st.part,
    sleepLeft: st.sleepEnd ? Math.max(0, Math.ceil((st.sleepEnd - Date.now()) / 60000)) : 0,
  };
}
let lastPlayed = null; // 멈춘 뒤 "다시 듣기"에 쓴다 {verse, ctx}

/** 지금 읽고 있는 덩어리 번호(본문 음원일 때만), 아니면 -1. */
export function chunkNow() {
  if (!st || !st.entry || st.part !== 'text' || !audio) return -1;
  const t = audio.currentTime;
  const ch = st.entry.chunks;
  for (let i = 0; i < ch.length; i++) if (t >= ch[i].s - 0.05 && t < (ch[i + 1] ? ch[i + 1].s - 0.05 : Infinity)) return i;
  return -1;
}

// ---------- 차례 ----------

function rotateAfter(list, id) {
  const after = list.filter((x) => x > id);
  const before = list.filter((x) => x < id);
  return [...after, ...before];
}
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/** 이어 듣기 고른 것에 맞춰 읽을 차례를 만든다. 첫 구절은 늘 누른 구절. */
function buildQueue(id, ctx) {
  const p = prefs();
  let next = p.next;
  if (next === 'pocket' && !ctx?.pocket) next = 'learned';
  let rest = [];
  if (next === 'learned') rest = rotateAfter(ids.filter(isLearned), id);
  else if (next === 'pocket') rest = rotateAfter(ctx.pocket.ids.filter(isLearned), id);
  else if (next === 'all') rest = ids.filter((x) => x > id);
  if (p.order === 'shuffle') rest = shuffle(rest);
  return [id, ...rest];
}

function readingParts() {
  const r = prefs().ref;
  const parts = [];
  if (r !== 'none') parts.push('ref', 'gap:0.5');
  parts.push('text');
  if (r === 'both') parts.push('gap:0.5', 'ref');
  return parts;
}

// ---------- 읽기 ----------

/** 누른 순간에 부른다(iOS는 누른 순간에만 소리를 열어 준다). ctx = {pocket: {key, label, ids}} */
export function play(v, ctx = null) {
  stopNow();
  unlockAudio();
  const p = prefs();
  st = {
    ctx,
    queue: buildQueue(v.id, ctx),
    qi: 0,
    rep: 1,
    parts: [],
    pi: 0,
    part: null,
    entry: null,
    voice: p.voice,
    paused: false,
    sleepEnd: p.sleep ? Date.now() + p.sleep * 60000 : 0,
  };
  lastPlayed = { verse: v, ctx };
  startVerse();
}

function unlockAudio() {
  if (prefs().voice === 'device' || !audio) {
    S.unlock();
    return;
  }
  // 소리 없는 짧은 음원을 누른 순간에 틀어 두면, 받기를 기다린 뒤에도 이어서 틀 수 있다.
  audio.src = gapPath(0.5);
  audio.playbackRate = 1;
  audio.play().catch(() => {});
  S.unlock(); // 음원이 없는 구절은 기기 목소리로 읽으므로 같이 열어 둔다.
}

async function startVerse() {
  const my = ++gen;
  const v = byId[st.queue[st.qi]];
  st.rep = 1;
  st.part = null;
  st.voice = prefs().voice;
  const m = await manifest(st.voice);
  if (my !== gen || !st) return;
  st.entry = usable(m?.verses?.[v.id], v);
  st.parts = readingParts();
  st.pi = 0;
  mediaInfo(v);
  emit();
  prefetchNext();
  step();
}

function prefetchNext() {
  const nid = st.queue[st.qi + 1];
  if (!nid || !entryFor(nid, st.voice)) return;
  clip(clipPath(st.voice, nid, 'ref')).catch(() => {});
  clip(clipPath(st.voice, nid, 'text')).catch(() => {});
}

function step() {
  if (!st || st.paused) return;
  const my = gen;
  const part = st.parts[st.pi];
  st.part = part;
  const v = byId[st.queue[st.qi]];
  const done = () => {
    if (my === gen && st) advance();
  };
  if (part.startsWith('gap:')) return gap(Number(part.slice(4)), done);
  emit();
  if (st.entry) {
    playClip(clipPath(st.voice, v.id, part), true, done, () => {
      // 받지 못했으면(인터넷 끊김 등) 이 구절은 기기 목소리로 읽는다.
      if (my !== gen || !st) return;
      st.entry = null;
      step();
    });
  } else if (!S.speakText(part === 'ref' ? S.spokenRef(v) : v.text, done)) {
    stopNow();
    emit();
  }
}

let watch = 0;
/** 틀고 있는 음원이 6초 넘게 나아가지 않으면(받다 멈춤 등) 실패로, 끝에 닿았는데 끝 알림이 없으면 끝으로 본다. */
function guard(my, onEnd, onFail) {
  clearInterval(watch);
  let lastT = -1;
  let still = 0;
  let fired = false;
  const once = (fn) => () => {
    if (fired) return;
    fired = true;
    clearInterval(watch);
    fn();
  };
  const end = once(onEnd);
  const fail = once(onFail);
  watch = setInterval(() => {
    if (my !== gen || !st) return clearInterval(watch);
    if (st.paused || audio.paused) return;
    const t = audio.currentTime;
    if (audio.duration && t >= audio.duration - 0.05) return end();
    still = t === lastT ? still + 1 : 0;
    lastT = t;
    if (still >= 6) fail();
  }, 1000);
  return { end, fail };
}

function playClip(path, speech, onEnd, onFail) {
  const my = gen;
  clip(path).then((url) => {
    if (my !== gen || !st || st.paused) return;
    const g = guard(my, onEnd, onFail);
    audio.onended = g.end;
    audio.onerror = g.fail;
    audio.src = url;
    audio.playbackRate = speech && S.isSlow() ? SLOW_RATE : 1;
    if ('preservesPitch' in audio) audio.preservesPitch = true;
    audio.play().catch(() => {
      // 틀지 못하게 막혔으면(누르지 않고 시작한 경우) 멈춤으로 둔다. 다시 누르면 이어 읽는다.
      if (my === gen && st) {
        st.paused = true;
        emit();
      }
    });
  }, onFail);
}

function gap(sec, then) {
  if (st.entry && audio) {
    // 0.5, 1, 2, 4초 음원을 이어 붙여 원하는 만큼 쉰다.
    const seq = [];
    let left = sec;
    for (const s of [4, 2, 1, 0.5]) while (left >= s - 0.01) { seq.push(s); left -= s; }
    const next = () => (seq.length ? playClip(gapPath(seq.shift()), false, next, next) : then());
    next();
  } else {
    clearTimeout(timer);
    timer = setTimeout(then, sec * 1000);
  }
}

function sleepDue() {
  return st.sleepEnd && Date.now() >= st.sleepEnd;
}

function advance() {
  st.pi++;
  if (st.pi < st.parts.length) return step();
  const p = prefs();
  const g = GAPS[p.gap] || GAPS.short;
  if (sleepDue()) return finish();
  if (p.times === 0 || st.rep < p.times) {
    st.rep++;
    st.parts = readingParts();
    st.pi = 0;
    emit();
    const my = gen;
    return gap(g.rep, () => my === gen && st && step());
  }
  if (st.qi + 1 >= st.queue.length) return finish();
  const my = gen;
  gap(g.verse, () => {
    if (my !== gen || !st) return;
    st.qi++;
    startVerse();
  });
}

function finish() {
  stopNow();
  emit();
}

function stopNow() {
  gen++;
  clearInterval(watch);
  clearTimeout(timer);
  if (audio) {
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
  }
  S.stop();
  st = null;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'none';
}

export function stop() {
  if (!st) return;
  stopNow();
  emit();
}

export function pause() {
  if (!st || st.paused) return;
  st.paused = true;
  gen++; // 쉼 타이머와 기기 목소리 끝 알림을 버린다
  clearTimeout(timer);
  if (audio) audio.pause();
  S.stop();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
  emit();
}

/** 멈춘 자리에서 이어 읽는다. 음원은 그 자리부터, 기기 목소리와 쉼은 그 부분 처음부터. */
export function resume() {
  if (!st || !st.paused) return;
  st.paused = false;
  gen++;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  emit();
  const part = st.parts[st.pi];
  if (st.entry && audio && audio.src && !part.startsWith('gap:') && audio.currentTime > 0 && !audio.ended) {
    const my = gen;
    const g = guard(my, () => my === gen && st && advance(), () => {
      if (my !== gen || !st) return;
      st.entry = null; // 이어 틀지 못하면 이 구절은 기기 목소리로
      step();
    });
    audio.onended = g.end;
    audio.onerror = g.fail;
    audio.play().catch(() => {});
  } else {
    step();
  }
}

export function next() {
  if (!st) return;
  if (st.qi + 1 >= st.queue.length) return stop();
  stopAudioOnly();
  st.qi++;
  st.paused = false;
  startVerse();
}

export function prev() {
  if (!st) return;
  stopAudioOnly();
  if (st.qi > 0) st.qi--;
  st.paused = false;
  startVerse();
}

function stopAudioOnly() {
  gen++;
  clearInterval(watch);
  clearTimeout(timer);
  if (audio) audio.pause();
  S.stop();
}

/** 듣기 판에서 고른 것을 저장하고, 읽는 중이면 바로 반영한다. */
export function setPref(key, value) {
  save('listen', { ...load('listen', {}), [key]: value });
  if (key === 'voice') manifest(value);
  if (st) {
    if (key === 'next' || key === 'order') {
      const cur = st.queue[st.qi];
      st.queue = buildQueue(cur, st.ctx);
      st.qi = 0;
    } else if (key === 'sleep') {
      st.sleepEnd = value ? Date.now() + value * 60000 : 0;
    } else if (key === 'voice') {
      stopAudioOnly();
      st.paused = false;
      if (value === 'device') S.unlock();
      startVerse();
      return;
    }
  }
  emit();
}

export function setSlow(v) {
  S.setSlow(v);
  if (st && audio && st.part && !st.part.startsWith('gap:') && st.entry) audio.playbackRate = v ? SLOW_RATE : 1;
  emit();
}

/** 설정 화면 목소리 미리 듣기: 창세기 28:15 앞 두 덩어리. */
export async function preview(voice) {
  stop();
  if (voice === 'device') {
    S.unlock();
    S.speakText('보아라, 내가 너와 함께 있으면서');
    return;
  }
  unlockAudio();
  const m = await manifest(voice);
  const e = m?.verses?.[8];
  if (!e) return;
  const my = gen;
  const url = await clip(clipPath(voice, 8, 'text')).catch(() => null);
  if (!url || my !== gen) return;
  const end = e.chunks[1].e + 0.1;
  audio.onended = null;
  audio.src = url;
  audio.playbackRate = S.isSlow() ? SLOW_RATE : 1;
  audio.play().catch(() => {});
  const watch = () => {
    if (my !== gen) return;
    if (audio.currentTime >= end) audio.pause();
    else if (!audio.paused) requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}

// ---------- 잠금 화면 ----------

function mediaInfo(v) {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({
      title: v.refLong,
      artist: voiceName(st.voice),
      album: '말씀 보석 100',
      artwork: [{ src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' }],
    });
    ms.playbackState = 'playing';
  } catch (e) { /* 잠금 화면 정보가 없어도 읽기는 된다 */ }
}

if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
  const set = (a, fn) => {
    try {
      navigator.mediaSession.setActionHandler(a, fn);
    } catch (e) { /* 지원하지 않는 동작 */ }
  };
  set('play', () => resume());
  set('pause', () => pause());
  set('stop', () => stop());
  set('nexttrack', () => next());
  set('previoustrack', () => prev());
}
