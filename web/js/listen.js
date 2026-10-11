// 말해 보기: 기기·브라우저의 음성 인식으로 아이가 외워 말한 것을 듣고, 맞게 말한 어절을 연다.
// 음성은 브라우저가 처리한다(Chrome은 Google, Safari는 Apple 서버로 보낼 수 있다). 앱은 녹음하거나 저장하지 않는다.

const Recognition = () => (typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null);
export const canListen = () => !!Recognition();

/** 글자와 숫자만 남긴다. 띄어쓰기와 문장부호가 달라도 같은 말로 본다. */
export const norm = (s) => String(s).replace(/[^\p{L}\p{N}]/gu, '');

/**
 * 말한 글에서 어절을 앞에서부터 차례로 찾는다.
 * words: [{idx, text}] 순서대로, spoken: 지금까지 말한 글 전체. 찾은 어절의 idx 배열을 돌려준다.
 * - 띄어쓰기·문장부호는 보지 않는다.
 * - 끝말이 조금 다르게 들려도(십시오/십시요) 세 글자 이상이면 마지막 한 글자를 빼고 한 번 더 찾는다.
 * - 지금 위치에서 앞으로 10어절 안의 후보 가운데, 말한 글에서 가장 먼저 나오는 어절을 고른다.
 *   그래서 어절을 빠뜨려도 이어지고, 같은 말이 두 번 나오는 구절(시편 73:25)에서 뒷줄만 말해도 앞줄이 열리지 않는다.
 * - 찾은 어절은 바로 뒤에 다음(또는 그다음) 어절이 이어지거나, 말한 글이 거기서 끝날 때만 연다.
 *   그래서 "하나님께서"를 말했을 때 "하나님께" 빈칸이 열리지 않는다.
 */
export function matchSpoken(words, spoken) {
  const s = norm(spoken);
  const ts = words.map((w) => norm(w.text));
  const n = words.length;
  const find = (k, from, maxGap) => {
    const t = ts[k];
    if (!t) return null;
    const tries = t.length >= 3 ? [[t, false], [t.slice(0, -1), true]] : [[t, false]];
    for (const [q, trimmed] of tries) {
      const j = s.indexOf(q, from);
      if (j >= 0 && j - from <= maxGap) return { j, end: j + q.length, trimmed };
    }
    return null;
  };
  const confirmed = (k, m) => {
    // 말한 글의 끝: 정확히 끝나야 한다(끝말을 뺀 경우만 한 글자 여유).
    if (m.trimmed ? m.end >= s.length - 1 : m.end === s.length) return true;
    if (k === n - 1) return true;
    return !!(find(k + 1, m.end, 2) || (k + 2 < n && find(k + 2, m.end, 2)));
  };
  const found = [];
  let i = 0;
  let pos = 0;
  while (i < n) {
    let best = null;
    for (let k = i; k < Math.min(n, i + 10); k++) {
      const m = find(k, pos, 400);
      if (!m || !confirmed(k, m)) continue;
      if (!best || m.j < best.m.j || (m.j === best.m.j && m.end > best.m.end)) best = { k, m };
    }
    if (!best) break;
    found.push(words[best.k].idx);
    pos = best.m.end;
    i = best.k + 1;
  }
  return found;
}

const ERROR_TEXT = {
  'not-allowed': '마이크를 쓸 수 있게 허용해 주세요',
  'service-not-allowed': '이 브라우저에서는 말해 보기를 쓸 수 없어요',
  'no-speech': '잘 안 들렸어요. 다시 눌러 말해 봐요',
  'audio-capture': '마이크를 찾지 못했어요',
  network: '인터넷에 연결되어야 들을 수 있어요',
};
export const errorText = (code) => ERROR_TEXT[code] || '지금은 들을 수 없어요. 다시 눌러 봐요';

/** 듣기 시작. 멈추는 함수를 돌려준다. */
export function listen({ onText, onError, onEnd }) {
  const R = Recognition();
  const r = new R();
  r.lang = 'ko-KR';
  r.interimResults = true;
  r.continuous = true;
  let finalText = '';
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t + ' ';
      else interim += t;
    }
    onText(finalText + interim);
  };
  r.onerror = (e) => {
    if (e.error !== 'aborted') onError(e.error);
  };
  r.onend = () => onEnd();
  try {
    r.start();
  } catch (e) {
    onError('start');
    return () => {};
  }
  return () => {
    try { r.stop(); } catch (e) { /* 이미 멈춤 */ }
  };
}
