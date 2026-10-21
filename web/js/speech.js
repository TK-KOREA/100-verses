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

let job = null; // 읽는 중인 글 {pieces, i, onEnd, timer, poll}

function koVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((x) => /^ko(-|_|$)/i.test(x.lang)) || null;
}

/** 긴 글을 문장·쉼표 단위의 짧은 조각으로 나눈다(50자 안팎).
 * 한 번에 길게 넘기면 Chrome은 15초쯤에서 말을 멈추고 끝 알림도 주지 않는다. */
export function pieces(text) {
  const parts = text.replace(/\n/g, ' ').split(/(?<=[.?!,”’])\s+/).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const last = out[out.length - 1];
    if (last && last.length + p.length < 50 && !/[.?!”]$/.test(last)) out[out.length - 1] = last + ' ' + p;
    else out.push(p);
  }
  return out.flatMap(cutLong);
}

/** 쉼표 없이 긴 조각(45자 넘음)은 이어 주는 말(-며, -니, -고 ...) 뒤에서 한 번 더 나눈다. */
function cutLong(p) {
  if (p.length <= 45) return [p];
  const words = p.split(' ');
  let best = -1;
  let bestScore = Infinity;
  let len = 0;
  for (let i = 0; i < words.length - 1; i++) {
    len += words[i].length + 1;
    const score = Math.abs(len - p.length / 2) - (/(며|니|고|서|면|나|데|지만|으로|어)$/.test(words[i]) ? 12 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = i;
    }
  }
  if (best < 0) return [p];
  return [...cutLong(words.slice(0, best + 1).join(' ')), ...cutLong(words.slice(best + 1).join(' '))];
}

/** 글을 읽는다. 끝나면 onEnd를 부른다. 조각마다 지킴이를 두어, 브라우저가 말을 멈추고
 * 끝 알림을 주지 않아도(Chrome·iOS에서 생긴다) 다음 조각으로 넘어간다. */
export function speakText(text, onEnd) {
  if (!canSpeak) return false;
  stop();
  const me = { pieces: pieces(text), i: 0, onEnd: onEnd || null, timer: 0, poll: 0 };
  job = me;
  sayNext(me);
  return true;
}

function sayNext(me) {
  if (job !== me) return;
  clearTimeout(me.timer);
  clearInterval(me.poll);
  if (me.i >= me.pieces.length) {
    job = null;
    if (me.onEnd) me.onEnd();
    return;
  }
  const text = me.pieces[me.i++];
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ko-KR';
  const voice = koVoice();
  if (voice) u.voice = voice;
  u.rate = isSlow() ? 0.7 : 0.95;
  let done = false;
  const next = () => {
    if (done) return;
    done = true;
    sayNext(me);
  };
  u.onend = next;
  u.onerror = next;
  // 지킴이: 한 글자 0.35초(느리게는 0.5초) + 4초 안에 안 끝나면 넘어간다.
  me.timer = setTimeout(() => {
    if (job === me && !done) {
      speechSynthesis.cancel();
      next();
    }
  }, text.length * (isSlow() ? 500 : 350) + 4000);
  // 말이 멈췄는데 끝 알림이 없으면(1.5초 넘게 말하지 않음) 넘어간다.
  const t0 = Date.now();
  me.poll = setInterval(() => {
    if (job !== me || done) return clearInterval(me.poll);
    if (Date.now() - t0 > 1500 && !speechSynthesis.speaking && !speechSynthesis.pending) next();
  }, 500);
  speechSynthesis.speak(u);
}

/** iOS는 누른 순간에 한 번 말해야 그 뒤에도 말한다. 빈 글로 미리 열어 둔다. */
export function unlock() {
  if (!canSpeak || job) return;
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  } catch (e) { /* 열지 못해도 그냥 둔다 */ }
}

/** 읽기를 멈춘다. 끝 알림(onEnd)은 부르지 않는다. */
export function stop() {
  if (!canSpeak) return;
  if (job) {
    clearTimeout(job.timer);
    clearInterval(job.poll);
  }
  job = null;
  // 말하고 있지 않을 때 cancel하면 바로 다음 말이 잘리는 브라우저가 있어, 말하는 중일 때만 멈춘다.
  if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
}
