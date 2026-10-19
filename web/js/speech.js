// 기기 목소리: 기기에 들어 있는 한국어 음성(Web Speech API). 미리 만든 음원이 없을 때나
// "기기 목소리"를 골랐을 때 player.js가 쓴다.
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

/** 글을 읽는다. 끝나거나 멈추면 onEnd를 부른다. */
export function speakText(text, onEnd) {
  if (!canSpeak) return false;
  stop();
  const u = new SpeechSynthesisUtterance(text.replace(/\n/g, ' '));
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

/** iOS는 누른 순간에 한 번 말해야 그 뒤에도 말한다. 빈 글로 미리 열어 둔다. */
export function unlock() {
  if (!canSpeak || current) return;
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  } catch (e) { /* 열지 못해도 그냥 둔다 */ }
}

/** 읽기를 멈춘다. 끝 알림(onEnd)은 부르지 않는다. */
export function stop() {
  if (!canSpeak) return;
  current = null;
  onEndCb = null;
  speechSynthesis.cancel();
}
