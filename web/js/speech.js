// 들어 보기: 기기에 들어 있는 한국어 음성(Web Speech API)으로 읽는다.
import { load, save } from './progress.js';

export const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

export const isSlow = () => load('slow', false);
export const setSlow = (v) => save('slow', !!v);

/** "롬 1:20" 대신 "로마서 1장 20절", "딤후 3:16-17"은 "3장 16절에서 17절"로 읽는다. */
export function spokenRef(v) {
  const range = v.verseEnd !== v.verseStart ? `${v.verseStart}절에서 ${v.verseEnd}절` : `${v.verseStart}절`;
  return `${v.book} ${v.chapter}장 ${range}`;
}

let current = null;
let onEndCb = null;

function koVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((x) => /^ko(-|_|$)/i.test(x.lang)) || null;
}

/** 읽기 시작. 끝나거나 멈추면 onEnd를 부른다. */
export function speak(v, onEnd) {
  if (!canSpeak) return false;
  stop();
  const text = `${spokenRef(v)}. ${v.text.replace(/\n/g, ' ')}`;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  const voice = koVoice();
  if (voice) u.voice = voice;
  u.rate = isSlow() ? 0.7 : 0.95;
  onEndCb = onEnd || null;
  const done = () => {
    if (current !== u) return;
    current = null;
    const cb = onEndCb;
    onEndCb = null;
    if (cb) cb();
  };
  u.onend = done;
  u.onerror = done;
  current = u;
  speechSynthesis.speak(u);
  return true;
}

export function stop() {
  if (!canSpeak) return;
  const cb = onEndCb;
  current = null;
  onEndCb = null;
  speechSynthesis.cancel();
  if (cb) cb();
}

export const speaking = () => current !== null;
