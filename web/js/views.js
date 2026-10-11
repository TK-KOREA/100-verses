// 화면들: 오늘, 연습(+축하), 모든 구절, 내 계단, 설정, 처음.
// 각 화면은 {el, title, after?, update?, cleanup?}를 돌려준다.
import { h, icon, art, toast } from './ui.js';
import * as P from './progress.js';
import * as S from './speech.js';
import * as L from './listen.js';

const STEP_NAMES = ['읽기', '첫 글자', '빈칸', '혼자'];
const HINTS = [
  '소리 내어 세 번 읽어 봐요',
  '첫 글자를 보고 말해 봐요',
  '가려진 곳을 누르면 보여요',
  '안 보고 말해 봐요. 막히면 눌러서 살짝 봐요',
];
const STEP_COUNT = 100;

const FONT_LEVELS = [[1, '보통'], [2, '크게'], [3, '아주 크게']];
export const fontLevel = () => {
  const v = Number(P.load('font', 1));
  return v === 2 || v === 3 ? v : 1;
};
export function applyFontLevel() {
  document.documentElement.dataset.font = String(fontLevel());
}
function setFontLevel(v) {
  P.save('font', v);
  applyFontLevel();
}

/** 글자 크기 3단계 고르기. 구절·장절·안내 글자만 키우고 버튼은 그대로 둔다. 설정과 처음 화면에서 쓴다. */
function fontPicker() {
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '글자 크기', style: 'margin-top:0' });
  const paint = () => {
    const cur = fontLevel();
    seg.replaceChildren(...FONT_LEVELS.map(([val, label]) => h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(cur === val),
      onclick: () => {
        setFontLevel(val);
        paint();
      },
    }, label)));
  };
  paint();
  return seg;
}

const topicLabel = (v) => (v.subtopic ? `${v.topic} · ${v.subtopic}` : v.topic);

/** 숫자로 끝나는 장절 뒤 조사: 7(칠)을, 5(오)를. 0으로 끝나면 십·백이라 '을'. */
function eulReul(ref) {
  const d = ref.replace(/\D+$/, '').slice(-1);
  return '0136780'.includes(d) && d !== '' ? '을' : '를';
}

function speakButton(v, iconOnly = false) {
  if (!S.canSpeak) return null;
  const btn = h('button', { type: 'button', class: iconOnly ? 'icon-btn' : 'btn secondary small' });
  const paint = (on) => {
    btn.setAttribute('aria-pressed', String(on));
    btn.replaceChildren(icon(on ? 'stop' : 'speak'));
    if (iconOnly) btn.setAttribute('aria-label', on ? '멈추기' : '들어 보기');
    else btn.append(on ? '멈추기' : '들어 보기');
  };
  paint(false);
  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-pressed') === 'true') {
      S.stop();
    } else if (S.speak(v, () => paint(false))) {
      paint(true);
    }
  });
  return btn;
}

/** 오늘(KST) 외운 구절. 외운 순서대로. */
/** 오늘보다 앞선 날 가운데 가장 최근에 외운 날의 구절들. {label, list} 또는 null */
function lastDayDone() {
  const t = P.kstToday();
  const before = P.doneList().filter((m) => m.at.slice(0, 10) < t);
  if (!before.length) return null;
  const day = before.reduce((a, m) => (m.at.slice(0, 10) > a ? m.at.slice(0, 10) : a), '');
  return {
    label: day === P.addDays(t, -1) ? '어제 외운 말씀' : '지난번 외운 말씀',
    list: before.filter((m) => m.at.slice(0, 10) === day),
  };
}

function doneToday() {
  const t = P.kstToday();
  return P.doneList().filter((m) => m.at.slice(0, 10) === t);
}

// ---------- 홈 화면 추가 안내 ----------

const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

/**
 * 브라우저로 열었을 때만 오늘 화면 맨 위에 한 줄. iPhone은 Safari와 홈 화면 앱이 저장소를 따로 쓰므로
 * 처음부터 홈 화면에서 쓰게 하려는 것이다. 닫으면 다시 띄우지 않고, 설치하면 저절로 사라진다.
 */
function installHint({ closable = true } = {}) {
  if (isInstalled() || (closable && P.load('install_hint_closed', false))) return null;
  const line = h('div', { class: 'install-hint', role: 'note' },
    h('a', { class: 'install-link', href: '#/settings?home' }, '홈 화면에 추가하는 방법 ›'));
  if (closable) {
    line.append(h('button', {
      type: 'button',
      class: 'install-close',
      'aria-label': '닫기',
      onclick: () => {
        P.save('install_hint_closed', true);
        line.remove();
      },
    }, icon('x')));
  }
  return line;
}

/** 다 했어요 화면: 지난번 외운 말씀을 다시 들어 보기(기획서 2차 "복습"의 가장 작은 형태). */
function lastBlock(app) {
  const last = lastDayDone();
  if (!last) return null;
  return h('section', null,
    h('h2', { class: 'group-head' }, h('span', null, last.label)),
    h('div', { class: 'group' }, last.list.map((m) => {
      const lv = app.byId[m.id];
      return h('div', { class: 'row-wrap' },
        h('button', { type: 'button', class: 'row', onclick: () => app.go('#/verse/' + lv.id) },
          h('span', { class: 'num done', 'aria-hidden': 'true' }, '✓'),
          h('span', { class: 'row-t' }, h('b', null, lv.refLong), h('p', null, lv.text.split('\n')[0])),
        ),
        speakButton(lv, true),
      );
    })),
  );
}

// ---------- 오늘 ----------

export function today(app) {
  const count = P.doneCount();
  const streak = P.streak();
  const nextId = P.nextVerseId(app.verses);
  const name = P.nickname();
  const root = h('div', { class: 'today' });

  if (nextId == null) {
    root.append(
      h('h1', { class: 'sr-only', tabindex: '-1' }, '오늘'),
      h('div', { style: 'text-align:center;margin-top:32px' },
        art('crown'),
        h('p', { class: 'eyebrow', style: 'margin-top:24px;font-size:18px' }, '100번째 계단'),
        h('h2', { class: 'title', style: 'margin-top:6px' }, '꼭대기에 올라왔어요!'),
        h('p', { class: 'sub', style: 'margin-top:12px;font-size:20px' }, '100구절을 모두 마음에 담았어요.'),
      ),
      h('div', { class: 'actions stack' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => app.go('#/stairs') }, '내 계단 보기'),
        h('button', { type: 'button', class: 'btn secondary small', onclick: () => app.go('#/list') }, '모든 구절 다시 보기'),
      ),
    );
    return { el: root, title: '오늘' };
  }

  const chipsNow = () => {
    const c = [];
    if (count > 0) c.push(h('span', { class: 'chip accent' }, `지금 ${count}계단`));
    if (streak >= 2) c.push(h('span', { class: 'chip' }, `🔥 ${streak}일 연속`));
    return c;
  };

  // 오늘 한 계단이라도 올랐으면 "오늘은 다 했어요". 더 하고 싶은 아이는 링크로 이어 간다.
  const todayList = doneToday();
  if (todayList.length) {
    root.append(...[
      h('h1', { class: 'sr-only', tabindex: '-1' }, '오늘은 다 했어요'),
      installHint(),
      h('div', { class: 'chips' }, chipsNow()),
      h('section', { class: 'card done-card' },
        h('div', { class: 'done-badge', 'aria-hidden': 'true' }, icon('check')),
        h('h2', { class: 'title' }, '오늘은 다 했어요!'),
        h('p', { class: 'sub', style: 'margin-top:6px' }, todayList.length >= 2 ? `오늘 ${todayList.length}계단 올랐어요` : '오늘 한 계단 올랐어요'),
      ),
      h('h2', { class: 'group-head' }, h('span', null, '오늘 외운 말씀')),
      h('div', { class: 'group' }, todayList.map((m) => {
        const tv = app.byId[m.id];
        return h('button', { type: 'button', class: 'row', onclick: () => app.go('#/verse/' + tv.id) },
          h('span', { class: 'num done', 'aria-hidden': 'true' }, '✓'),
          h('span', { class: 'row-t' }, h('b', null, tv.refLong), h('p', null, tv.text.split('\n')[0])),
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
        );
      })),
      lastBlock(app),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn secondary small', onclick: () => app.go('#/verse/' + nextId) }, '한 계단 더 오르기'),
      ),
    ].filter(Boolean));
    return { el: root, title: '오늘' };
  }

  const v = app.byId[nextId];
  const hello = count === 0 ? '첫 계단을 올라 볼까요?' : '오늘도 한 계단 올라가요';
  const chips = chipsNow();

  root.append(...[
    h('h1', { class: 'sr-only', tabindex: '-1' }, '오늘의 말씀'),
    installHint(),
    h('p', { class: 'sub hello' }, name ? `안녕, ${name}! ${hello}` : `안녕! ${hello}`),
    chips.length ? h('div', { class: 'chips' }, chips) : h('div', { style: 'height:12px' }),
    h('article', { class: 'card' },
      h('p', { class: 'eyebrow' }, `${count + 1}번째 계단 · ${topicLabel(v)}`),
      h('h2', { class: 'ref' }, v.refLong),
      h('p', { class: 'verse' }, v.text),
      v.excerpt ? h('p', { class: 'excerpt' }, `말씀 일부: ${v.excerptNote}`) : null,
    ),
    h('div', { class: 'actions stack' },
      speakButton(v),
      h('button', { type: 'button', class: 'btn primary', onclick: () => app.go('#/verse/' + v.id) }, '외우러 가기'),
    ),
  ].filter(Boolean));
  return { el: root, title: '오늘' };
}

// ---------- 연습 ----------

const FIRST = /^([^\p{L}\p{N}]*)([\p{L}\p{N}])(.*)$/u;

export function verse(app, id) {
  const v = app.byId[id];
  if (!v) return notFound(app);
  let stage = 1;
  let lastDone = null;
  // 두 번 누름 막기: 아래 버튼이 바뀐 직후 0.4초 동안은 누름을 받지 않는다.
  // (안 막으면 "다음 단계"를 두 번 눌러 한 단계를 건너뛰거나, 4단계의 "처음부터 다시"가 눌린다)
  let lockUntil = 0;
  const guard = (fn) => () => {
    if (performance.now() < lockUntil) return;
    fn();
  };
  const opened = new Set();
  let reads = 0; // 1단계: 소리 내어 읽은 횟수(아이가 눌러 센다)
  let stopListen = null; // 4단계 말해 보기
  let listenMsg = '';

  const root = h('div', { class: 'page-practice' });
  const title = h('h1', { tabindex: '-1' }, v.refLong);
  const steps = h('div', { class: 'steps', role: 'group', 'aria-label': '연습 단계' });
  const hint = h('p', { class: 'hint', 'aria-live': 'polite' });
  const text = h('p', { class: 'practice-verse', lang: 'ko' });
  const tools = h('div', { class: 'practice-tools' });
  const doneNote = h('div', { class: 'done-note' });
  const actions = h('div', { class: 'practice-actions stack' });

  root.append(...[
    h('header', { class: 'navbar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '뒤로', onclick: () => app.back() }, icon('back')),
      title,
      speakButton(v, true) || h('span'),
    ),
    h('div', { class: 'practice-meta' },
      h('span', { class: 'eyebrow' }, topicLabel(v)),
      v.excerpt ? h('span', { class: 'tag', style: 'margin-left:0' }, '일부') : null,
    ),
    steps, hint, tools, text,
    v.excerpt ? h('p', { class: 'excerpt' }, `말씀 일부: ${v.excerptNote}`) : null,
    doneNote,
    h('div', { class: 'grow' }),
    actions,
  ].filter(Boolean)); // DOM append는 null을 "null" 글자로 넣는다

  function setStage(s) {
    endListen();
    stage = s;
    opened.clear();
    reads = 0;
    listenMsg = '';
    render();
  }

  // ---- 1단계: 아래 주황 버튼 하나로 센다. "읽었어요 1/3" → … → 세 번째에 "다음 단계"로 바뀐다.
  // 건너뛰고 싶은 아이는 위쪽 단계 표시로 넘어갈 수 있다.
  function readButton() {
    const doneReading = reads >= 3;
    return h('button', {
      type: 'button',
      class: 'btn primary',
      'aria-label': doneReading ? '다음 단계' : `읽었어요, ${reads}번 읽음. 세 번 읽으면 다음 단계`,
      onclick: guard(() => {
        if (reads >= 3) {
          setStage(2);
          return;
        }
        reads++;
        // 세 번째에 버튼이 "다음 단계"로 바뀌므로, 같은 자리를 연달아 누른 것이 바로 넘어가지 않게 잠깐 막는다.
        if (reads >= 3) lockUntil = performance.now() + 400;
        actions.replaceChildren(readButton());
      }),
    }, doneReading ? '다음 단계' : `읽었어요 ${reads}/3`);
  }

  // ---- 4단계: 말해 보기. 맞게 말한 어절의 빈칸을 앞에서부터 연다.
  function hiddenWords() {
    const words = [];
    let k = 0;
    v.text.split('\n').forEach((line) => line.split(' ').filter(Boolean).forEach((w) => {
      const idx = k++;
      if (!opened.has(idx)) words.push({ idx, text: w });
    }));
    return { words, total: k };
  }
  function endListen() {
    if (stopListen) {
      const stop = stopListen;
      stopListen = null;
      stop();
    }
  }
  function paintListen() {
    if (stage !== 4 || !L.canListen()) return;
    const on = !!stopListen;
    tools.replaceChildren(
      h('button', {
        type: 'button',
        class: 'text-btn listen-btn',
        'aria-pressed': String(on),
        onclick: () => (stopListen ? (endListen(), paintListen()) : startListen()),
      }, icon('mic'), on ? '그만 듣기' : '말해 보기'),
      ...(listenMsg ? [h('p', { class: 'listen-msg', role: 'status' }, listenMsg)] : []), // replaceChildren은 null을 "null" 글자로 넣는다
    );
  }
  function startListen() {
    S.stop();
    const before = new Set(opened);
    listenMsg = '듣고 있어요. 외운 대로 말해 봐요';
    stopListen = L.listen({
      onText: (said) => {
        // 이번에 듣기 시작할 때 아직 가려져 있던 어절만 맞춰 본다(처음부터 다시 말해도 이어진다).
        const { total } = hiddenWords();
        const words = [];
        let k = 0;
        v.text.split('\n').forEach((line) => line.split(' ').filter(Boolean).forEach((w) => {
          const idx = k++;
          if (!before.has(idx)) words.push({ idx, text: w });
        }));
        L.matchSpoken(words, said).forEach((idx) => opened.add(idx));
        renderText();
        if (opened.size >= total) {
          listenMsg = '다 맞았어요! 🎉';
          endListen();
        } else {
          listenMsg = `${opened.size} / ${total} 열렸어요`;
        }
        paintListen();
      },
      onError: (code) => {
        listenMsg = L.errorText(code);
        stopListen = null;
        paintListen();
      },
      onEnd: () => {
        if (stopListen) {
          stopListen = null;
          if (hiddenWords().words.length) listenMsg = '다시 누르면 이어서 들어요';
        }
        paintListen();
      },
    });
    paintListen();
  }

  function renderText() {
    text.replaceChildren();
    let k = 0;
    v.text.split('\n').forEach((line) => {
      const lineEl = h('span', { class: 'line' });
      line.split(' ').filter(Boolean).forEach((w, i) => {
        const idx = k++;
        if (i > 0) lineEl.append(' ');
        if (stage === 1) {
          lineEl.append(w);
        } else if (stage === 2) {
          const m = w.match(FIRST);
          lineEl.append(m ? h('span', { class: 'w' }, m[1] + m[2], m[3] ? h('span', { class: 'rest' }, m[3]) : null) : w);
        } else if (stage === 3 && idx % 2 === 0) {
          lineEl.append(w);
        } else {
          const open = opened.has(idx);
          lineEl.append(h('button', {
            type: 'button',
            class: 'blank',
            'aria-pressed': String(open),
            'aria-label': open ? null : '가려진 말',
            onclick: (e) => {
              if (opened.has(idx)) opened.delete(idx);
              else opened.add(idx);
              const b = e.currentTarget;
              const now = opened.has(idx);
              b.setAttribute('aria-pressed', String(now));
              if (now) b.removeAttribute('aria-label');
              else b.setAttribute('aria-label', '가려진 말');
            },
          }, w));
        }
      });
      text.append(lineEl);
    });
  }

  function render() {
    steps.replaceChildren(...STEP_NAMES.map((name, i) => {
      const s = i + 1;
      return h('button', {
        type: 'button',
        class: s < stage ? 'done' : null,
        'aria-current': s === stage ? 'step' : null,
        'aria-label': `${s}단계 ${name}`,
        onclick: () => setStage(s),
      }, h('span', { 'aria-hidden': 'true' }, s < stage ? '✓' : String(s)), h('span', { 'aria-hidden': 'true', style: 'font-size:16px;font-weight:700' }, name));
    }));
    hint.textContent = HINTS[stage - 1];
    tools.replaceChildren();
    renderText();
    paintListen();

    const done = P.isDone(v.id);
    lastDone = done;
    doneNote.replaceChildren();
    if (done) {
      doneNote.append(
        h('span', null, `✓ ${P.dateLabel(P.doneAt(v.id))}에 외웠어요`),
        h('button', {
          type: 'button',
          class: 'link',
          onclick: () => {
            P.setMark(v.id, false);
            toast('외운 기록을 취소했어요', { label: '되돌리기', run: () => P.setMark(v.id, true) });
          },
        }, '외웠어요 취소'),
      );
    }

    actions.replaceChildren();
    lockUntil = performance.now() + 400;
    if (stage === 1) {
      actions.append(readButton());
    } else if (stage < 4) {
      actions.append(h('button', { type: 'button', class: 'btn primary', onclick: guard(() => setStage(stage + 1)) }, '다음 단계'));
    } else if (!done) {
      actions.append(
        h('button', { type: 'button', class: 'btn primary', onclick: guard(climb) }, '외웠어요!'),
        h('button', { type: 'button', class: 'btn secondary small', onclick: guard(() => setStage(1)) }, '처음부터 다시'),
      );
    } else {
      actions.append(
        h('button', { type: 'button', class: 'btn primary', onclick: guard(() => app.back()) }, '다 했어요'),
        h('button', { type: 'button', class: 'btn secondary small', onclick: guard(() => setStage(1)) }, '처음부터 다시'),
      );
    }
  }

  function climb() {
    S.stop();
    endListen();
    P.setMark(v.id, true);
    celebrate(app, v);
  }

  render();
  // 서버와 주고받을 때마다 다시 그리면 열어 둔 빈칸이 닫히므로, 외운 상태가 바뀔 때만 그린다.
  return {
    el: root,
    title: v.refLong,
    update: () => { if (P.isDone(v.id) !== lastDone) render(); },
    cleanup: endListen,
  };
}

function celebrate(app, v) {
  const n = P.doneCount();
  const streak = P.streak();
  const next = P.nextVerseId(app.verses);
  const all = next == null;
  // arming: 뜬 직후 0.7초는 버튼이 눌리지 않는다("외웠어요!" 두 번 누름이 아래 버튼에 닿지 않게).
  const ov = h('div', { class: 'overlay arming' + (all ? ' summit' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cel-title' });
  setTimeout(() => ov.classList.remove('arming'), 700);
  const inner = h('div', { class: 'overlay-inner' });
  const title = h('h2', { class: 'title', id: 'cel-title', tabindex: '-1', style: 'margin-top:8px' });

  const undo = () => {
    app.closeOverlay();
    P.setMark(v.id, false);
    toast('취소했어요. 다시 외워 봐요');
  };

  if (all) {
    title.textContent = '꼭대기에 올라왔어요!';
    inner.append(
      h('div', { class: 'grow' }),
      art('crown'),
      h('p', { class: 'eyebrow', style: 'margin-top:28px;font-size:18px' }, '100번째 계단'),
      title,
      h('p', { class: 'sub', style: 'font-size:20px;margin-top:16px;line-height:1.6' }, '100구절을 모두 마음에 담았어요.', h('br'), '정말 잘했어요.'),
      h('div', { class: 'grow' }),
      h('div', { class: 'stack' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => app.go('#/stairs') }, '내 계단 보기'),
        h('button', { type: 'button', class: 'btn secondary small', onclick: () => app.go('#/') }, '처음 화면으로'),
      ),
      h('button', { type: 'button', class: 'link', style: 'margin-top:8px', onclick: undo }, '잘못 눌렀어요'),
    );
  } else {
    const landing = n % 10 === 0;
    title.textContent = landing ? '쉬는 참에 도착했어요!' : '계단 올라왔어요!';
    const lines = [`${v.refLong}${eulReul(v.refLong)} 외웠어요`];
    if (landing) lines.unshift(`벌써 ${n}계단이에요.`);
    if (streak >= 2) lines.push(`🔥 ${streak}일 연속이에요`);
    inner.append(
      h('div', { class: 'grow' }),
      art('climb'),
      h('p', { class: 'big-num pop', 'aria-hidden': 'true' }, String(n)),
      h('p', { class: 'sr-only' }, `${n}번째`),
      title,
      h('p', { class: 'sub', style: 'font-size:20px;margin-top:12px;line-height:1.6' }, lines.flatMap((l, i) => (i ? [h('br'), l] : [l]))),
      h('div', { class: 'grow' }),
      h('div', { class: 'stack' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => app.go('#/') }, '오늘은 여기까지'),
        h('button', { type: 'button', class: 'btn secondary small', onclick: () => app.go('#/verse/' + next, { replace: true }) }, '한 계단 더 오르기'),
      ),
      h('button', { type: 'button', class: 'link', style: 'margin-top:8px', onclick: undo }, '잘못 눌렀어요'),
    );
  }
  ov.append(inner);
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') app.closeOverlay();
  });
  app.openOverlay(ov, title);
}

// ---------- 모든 구절 ----------

const FILTERS = [['all', '전체'], ['done', '외운 것'], ['todo', '안 외운 것']];

export function list(app) {
  const nextId = P.nextVerseId(app.verses);
  const counts = { all: app.verses.length, done: P.doneCount() };
  counts.todo = counts.all - counts.done;

  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '보기' });
  const topics = h('div', { class: 'topics', role: 'group', 'aria-label': '주제 바로가기' });
  const head = h('div', { class: 'list-head' }, h('h1', { class: 'title', tabindex: '-1' }, '모든 구절'), seg, topics);
  const body = h('div');
  const root = h('div', null, head, body);

  const keep = (v) => (app.listFilter === 'done' ? P.isDone(v.id) : app.listFilter === 'todo' ? !P.isDone(v.id) : true);

  function render() {
    seg.replaceChildren(...FILTERS.map(([k, label]) => h('button', {
      type: 'button',
      role: 'radio',
      'aria-checked': String(app.listFilter === k),
      onclick: () => {
        app.listFilter = k;
        render();
        window.scrollTo(0, 0);
      },
    }, label, h('span', null, String(counts[k])))));

    const shown = app.groups.map((g, gi) => ({ ...g, gi, items: g.verses.filter(keep) })).filter((g) => g.items.length);
    topics.replaceChildren(...shown.map((g) => h('button', {
      type: 'button',
      'data-g': String(g.gi),
      'aria-selected': 'false',
      onclick: () => jump(g.gi),
    }, g.topic)));

    body.replaceChildren();
    if (!shown.length) {
      body.append(app.listFilter === 'done'
        ? h('div', { class: 'empty' },
          h('p', { class: 'empty-t' }, '아직 외운 구절이 없어요'),
          h('p', { class: 'sub' }, '오늘의 구절부터 올라가 볼까요?'),
          h('button', { type: 'button', class: 'btn primary small', onclick: () => app.go('#/') }, '오늘의 구절 보기'))
        : h('div', { class: 'empty' }, h('p', { class: 'empty-t' }, '100구절을 모두 외웠어요!')));
      return;
    }
    shown.forEach((g) => {
      const doneN = g.verses.filter((v) => P.isDone(v.id)).length;
      body.append(h('section', { 'data-g': String(g.gi) },
        h('h2', { class: 'group-head' }, h('span', null, g.topic), h('small', { 'aria-label': `${g.verses.length}구절 중 ${doneN}구절 외움` }, `${doneN}/${g.verses.length}`)),
        h('div', { class: 'group' }, g.items.map((v) => {
          const d = P.isDone(v.id);
          const nx = v.id === nextId;
          return h('button', { type: 'button', class: 'row', onclick: () => app.go('#/verse/' + v.id) },
            h('span', { class: 'num' + (d ? ' done' : nx ? ' next' : ''), 'aria-hidden': 'true' }, d ? '✓' : String(v.id)),
            h('span', { class: 'row-t' },
              h('b', null, v.ref, v.subtopic ? h('span', { class: 'tag' }, v.subtopic) : null),
              h('p', null, v.text.split('\n')[0])),
            h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
            h('span', { class: 'sr-only' }, d ? ', 외웠어요' : nx ? ', 오늘의 구절' : ''),
          );
        })),
      ));
    });
    requestAnimationFrame(spy);
  }

  function setActive(gi) {
    topics.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.g === String(gi);
      if ((b.getAttribute('aria-selected') === 'true') === on) return;
      b.setAttribute('aria-selected', String(on));
      if (on) topics.scrollTo({ left: b.offsetLeft - 16, behavior: 'smooth' });
    });
  }
  // 칩으로 이동한 주제. 끝쪽 주제는 목록이 바닥에 닿아 제목 줄까지 못 올라오므로, 바닥에서는 누른 칩을 그대로 둔다.
  let jumped = null;
  function spy() {
    if (!root.isConnected) return;
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (atBottom) {
      const secs = body.querySelectorAll('section');
      if (jumped != null && body.querySelector(`section[data-g="${jumped}"]`)) setActive(jumped);
      else if (secs.length) setActive(secs[secs.length - 1].dataset.g);
      return;
    }
    const line = head.getBoundingClientRect().bottom + 8;
    let cur = body.querySelector('section');
    body.querySelectorAll('section').forEach((s) => {
      if (s.getBoundingClientRect().top <= line) cur = s;
    });
    if (cur) setActive(cur.dataset.g);
  }
  function jump(gi) {
    const sec = body.querySelector(`section[data-g="${gi}"]`);
    if (!sec) return;
    const top = sec.getBoundingClientRect().top + window.scrollY - head.offsetHeight + 1;
    jumped = String(gi);
    window.scrollTo({ top, behavior: 'smooth' });
    setActive(gi);
  }
  // 손으로 스크롤하기 시작하면 칩 고정을 푼다.
  const release = () => { jumped = null; };
  window.addEventListener('touchstart', release, { passive: true });
  window.addEventListener('wheel', release, { passive: true });
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      spy();
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  render();
  return {
    el: root,
    title: '모든 구절',
    cleanup: () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('touchstart', release);
      window.removeEventListener('wheel', release);
    },
  };
}

// ---------- 내 계단 ----------

export function stairs(app) {
  const done = P.doneList();
  const n = done.length;
  const streak = P.streak();
  const nextId = P.nextVerseId(app.verses);

  const wrap = h('div', { class: 'stairs' });
  wrap.append(h('p', { class: 'ground' }, '출발'));
  for (let s = 1; s < STEP_COUNT; s++) {
    const flight = Math.floor((s - 1) / 10);
    const pos = (s - 1) % 10;
    const x = flight % 2 === 0 ? pos : 9 - pos;
    const left = `calc((100% - 92px) * ${x} / 9)`;
    let btn;
    if (s <= n) {
      const v = app.byId[done[s - 1].id];
      btn = h('button', { type: 'button', class: 'done', style: `left:${left}`, 'aria-label': `${s}번째 계단, ${v.ref}`, onclick: () => app.go('#/verse/' + v.id) }, `✓ ${s}`);
    } else if (s === n + 1 && nextId != null) {
      btn = h('button', { type: 'button', class: 'now', style: `left:${left}`, 'aria-label': `${s}번째 계단, 지금 여기. 오늘의 구절 열기`, onclick: () => app.go('#/verse/' + nextId) }, String(s));
    } else {
      btn = h('button', { type: 'button', style: `left:${left}`, disabled: true, 'aria-label': `${s}번째 계단, 아직 못 올랐어요` }, String(s));
    }
    const step = h('div', { class: 'stair' }, btn);
    if (s === n + 1) step.append(h('span', { class: 'here', style: `left:min(${left}, calc(100% - 80px))`, 'aria-hidden': 'true' }, '지금 여기'));
    wrap.append(step);
    if (s % 10 === 0) wrap.append(h('div', { class: 'landing' + (s <= n ? ' reached' : '') }, `쉬는 참 · ${s}계단`));
  }
  const summitCls = n >= STEP_COUNT ? ' done' : n === STEP_COUNT - 1 ? ' now' : '';
  wrap.append(h('button', {
    type: 'button',
    class: 'summit-step' + summitCls,
    disabled: n < STEP_COUNT - 1,
    'aria-label': n >= STEP_COUNT ? '100번째 계단, 꼭대기에 올랐어요' : '100번째 계단, 꼭대기',
    onclick: () => app.go(n >= STEP_COUNT ? '#/' : '#/verse/' + nextId),
  }, n >= STEP_COUNT ? '👑 100 · 꼭대기' : '100 · 꼭대기'));

  const root = h('div', null,
    // 계단 중간으로 스크롤해도 몇 계단인지 보이게 제목 줄을 위에 붙인다.
    h('div', { class: 'head-row stairs-head' },
      h('h1', { class: 'title', tabindex: '-1' }, '내 계단', h('span', { class: 'head-count' }, `${n} / ${STEP_COUNT}`)),
      h('a', { class: 'text-btn', href: '#/settings' }, icon('gear'), '설정'),
    ),
    h('div', { class: 'card stairs-card', style: 'margin-top:4px;padding:20px' },
      h('div', { class: 'summary' },
        h('p', { class: 'count' }, String(n), h('small', null, ` / ${STEP_COUNT}계단`)),
        streak >= 2 ? h('span', { class: 'chip' }, `🔥 ${streak}일 연속`) : h('span'),
      ),
      h('div', { class: 'bar', role: 'progressbar', 'aria-label': '오른 계단', 'aria-valuemin': '0', 'aria-valuemax': String(STEP_COUNT), 'aria-valuenow': String(n) },
        h('i', { style: `width:${n}%` })),
      P.code() ? h('a', { class: 'code-line', href: '#/settings' }, h('span', null, '내 계단 코드'), h('b', null, P.code())) : null,
    ),
    wrap,
  );

  // 머리줄 숫자는 아래 카드(같은 숫자를 크게 보여 줌)가 화면 밖으로 나갔을 때만 보인다.
  const headRow = root.querySelector('.stairs-head');
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver(([e]) => headRow.classList.toggle('show-count', !e.isIntersecting), { rootMargin: '-72px 0px 0px 0px' })
    : null;
  if (io) io.observe(root.querySelector('.stairs-card'));
  else headRow.classList.add('show-count');

  return {
    el: root,
    title: '내 계단',
    cleanup: () => io && io.disconnect(),
    after: (restored) => {
      if (restored) return;
      const target = wrap.querySelector('.now') || wrap.querySelector('.summit-step.done') || wrap.querySelector('.ground');
      const y = target.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.55;
      window.scrollTo(0, Math.max(0, y));
    },
  };
}

// ---------- 설정 ----------

const RESTORE_MSG = {
  NOT_FOUND: '그런 코드가 없어요. 글자와 숫자를 다시 확인해 주세요.',
  LOCKED_OUT: '여러 번 틀려서 10분 동안 쉬어요. 잠시 뒤 다시 해 주세요.',
  INVALID: '코드는 "해바라기-4827"처럼 낱말과 숫자 네 자리예요.',
  NETWORK: '지금은 연결이 어려워요. 잠시 뒤 다시 눌러 주세요.',
  OFFLINE_ONLY: '아직 서버가 연결되지 않아 불러올 수 없어요.',
};

export function settings(app, _id, query) {
  const root = h('div');
  const nameInput = h('input', { class: 'input', id: 'nick', type: 'text', maxlength: '12', autocomplete: 'off', placeholder: '예: 하늘이', value: P.nickname() });
  const nameMsg = h('p', { class: 'msg', role: 'status' });
  const codeBox = h('div');
  const restoreInput = h('input', { class: 'input', id: 'restore', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: '예: 해바라기-4827' });
  const restoreBtn = h('button', { type: 'button', class: 'btn primary' }, '불러오기');
  const restoreMsg = h('p', { class: 'msg', role: 'status' });
  const statusBox = h('div');

  function paintCode() {
    const c = P.code();
    const st = P.syncState();
    codeBox.replaceChildren();
    if (c) {
      codeBox.append(
        h('p', { class: 'code-big' }, c),
        h('p', { class: 'help' }, '다른 기기에서 이 코드를 넣으면 계단이 이어져요. 꼭 적어 두세요.'),
        h('button', {
          type: 'button',
          class: 'text-btn',
          style: 'margin-top:12px',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(c);
              toast('계단 코드를 복사했어요');
            } catch (e) {
              toast('복사하지 못했어요. 코드를 적어 두세요');
            }
          },
        }, '코드 복사'),
      );
    } else {
      codeBox.append(h('p', { class: 'help', style: 'margin-top:0' }, st.hasServer
        ? '첫 계단을 오르면 계단 코드가 만들어져요.'
        : '아직 서버가 연결되지 않아 이 기기에만 저장돼요. 연결되면 계단 코드가 생겨요.'));
    }
  }

  function paintStatus() {
    const st = P.syncState();
    let dot = '';
    let line;
    let action = null;
    if (!st.hasServer) {
      line = '이 기기에만 저장돼요 (서버 연결 전)';
    } else if (st.state === 'syncing') {
      line = '보내는 중…';
    } else if (st.pending > 0) {
      dot = 'wait';
      line = `아직 보내지 못한 기록이 ${st.pending}개 있어요. 인터넷에 연결되면 보내요.`;
      action = h('button', { type: 'button', class: 'text-btn', style: 'margin-top:12px', onclick: () => P.sync() }, '지금 보내기');
    } else if (st.state === 'error') {
      dot = 'wait';
      line = '저장하다 문제가 생겼어요. 잠시 뒤 다시 보낼게요.';
      action = h('button', { type: 'button', class: 'text-btn', style: 'margin-top:12px', onclick: () => P.sync() }, '다시 보내기');
    } else {
      dot = 'ok';
      line = st.at ? `모두 저장됐어요 (${P.dateLabel(st.at)} ${st.at.slice(11, 16)})` : '모두 저장됐어요';
    }
    statusBox.replaceChildren(h('p', { style: 'font-size:18px;font-weight:700' }, h('span', { class: 'status-dot ' + dot, 'aria-hidden': 'true' }), line), ...(action ? [action] : []));
  }

  async function doRestore() {
    const typed = restoreInput.value.trim();
    restoreMsg.className = 'msg err';
    if (!/^[가-힣]{1,6}\s*-?\s*\d{4}$/.test(typed)) {
      restoreMsg.textContent = RESTORE_MSG.INVALID;
      return;
    }
    restoreBtn.disabled = true;
    restoreMsg.className = 'msg';
    restoreMsg.textContent = '불러오는 중…';
    try {
      await P.restore(typed);
      restoreMsg.textContent = `불러왔어요! 지금 ${P.doneCount()}계단이에요.`;
      restoreInput.value = '';
      nameInput.value = P.nickname();
    } catch (e) {
      restoreMsg.className = 'msg err';
      restoreMsg.textContent = RESTORE_MSG[e.code] || RESTORE_MSG.NETWORK;
    } finally {
      restoreBtn.disabled = false;
    }
  }
  restoreBtn.addEventListener('click', doRestore);
  restoreInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doRestore();
  });

  function saveName() {
    const name = nameInput.value.replace(/\s+/g, ' ').trim();
    if (Array.from(name).length > 12) {
      nameMsg.className = 'msg err';
      nameMsg.textContent = '12자까지 쓸 수 있어요.';
      return;
    }
    P.setNickname(name);
    nameMsg.className = 'msg';
    nameMsg.textContent = name ? '저장했어요.' : '이름을 지웠어요.';
  }
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveName();
  });

  const fontSeg = fontPicker();

  const speedSeg = S.canSpeak ? h('div', { class: 'seg', role: 'radiogroup', 'aria-label': '읽어 주는 빠르기', style: 'margin-top:0' }) : null;
  function paintSpeed() {
    if (!speedSeg) return;
    const slow = S.isSlow();
    speedSeg.replaceChildren(
      ...[['보통', false], ['느리게', true]].map(([label, val]) => h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(slow === val),
        onclick: () => {
          S.setSlow(val);
          paintSpeed();
        },
      }, label)),
    );
  }

  root.append(...[
    h('header', { class: 'navbar' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '뒤로', onclick: () => app.back() }, icon('back')),
      h('h1', { tabindex: '-1' }, '설정'),
      h('span'),
    ),
    h('section', { class: 'section' },
      h('h2', null, h('label', { for: 'nick' }, '불러 줄 이름')),
      h('div', { class: 'card' },
        h('div', { class: 'input-row', style: 'margin-top:0' }, nameInput, h('button', { type: 'button', class: 'btn secondary', onclick: saveName }, '저장')),
        nameMsg,
        h('p', { class: 'help', style: 'margin-top:0' }, '진짜 이름 대신 별명도 좋아요.'),
      ),
    ),
    h('section', { class: 'section' }, h('h2', null, '내 계단 코드'), h('div', { class: 'card' }, codeBox)),
    h('section', { class: 'section', id: 'restore-section' },
      h('h2', null, h('label', { for: 'restore' }, '다른 기기에서 이어 하기')),
      h('div', { class: 'card' },
        h('p', { class: 'help', style: 'margin-top:0' }, '쓰던 계단 코드를 넣으면 이 기기의 기록과 합쳐져요.'),
        h('div', { class: 'input-row' }, restoreInput, restoreBtn),
        restoreMsg,
      ),
    ),
    h('section', { class: 'section' },
      h('h2', null, '글자 크기'),
      fontSeg,
      h('div', { class: 'card', style: 'margin-top:12px;padding:16px 20px' },
        h('p', { class: 'ref', style: 'margin-top:0' }, '베드로전서 5:7'),
        h('p', { class: 'verse', style: 'margin-top:8px' }, '여러분의 모든 염려를 하나님께 맡기십시오.'),
      ),
    ),
    speedSeg ? h('section', { class: 'section' }, h('h2', null, '읽어 주는 빠르기'), speedSeg) : null,
    h('section', { class: 'section' }, h('h2', null, '저장 상태'), h('div', { class: 'card' }, statusBox)),
    h('section', { class: 'section', id: 'home-section' },
      h('h2', null, '홈 화면에 추가하기'),
      h('div', { class: 'card' },
        h('p', { style: 'font-size:18px;font-weight:800' }, 'iPhone'),
        h('ol', { class: 'steps-help' }, h('li', null, 'Safari로 이 주소를 열어요'), h('li', null, '아래쪽 공유 버튼을 눌러요'), h('li', null, '"홈 화면에 추가"를 눌러요')),
        h('p', { style: 'font-size:18px;font-weight:800;margin-top:16px' }, 'Android'),
        h('ol', { class: 'steps-help' }, h('li', null, 'Chrome 오른쪽 위 ⋮ 메뉴를 눌러요'), h('li', null, '"앱 설치" 또는 "홈 화면에 추가"를 눌러요')),
        h('p', { class: 'help' }, '홈 화면에서 열어야 기록이 오래 남아요.'),
      ),
    ),
  ].filter(Boolean));

  paintCode();
  paintStatus();
  paintSpeed();
  return {
    el: root,
    title: '설정',
    update: () => {
      paintCode();
      paintStatus();
    },
    after: () => {
      if (query === 'restore') {
        document.getElementById('restore-section').scrollIntoView({ block: 'start' });
        restoreInput.focus({ preventScroll: true });
      } else if (query === 'home') {
        document.getElementById('home-section').scrollIntoView({ block: 'start' });
      }
    },
  };
}

// ---------- 처음 ----------

export function welcome(app) {
  const input = h('input', { class: 'input', id: 'welcome-name', type: 'text', maxlength: '12', autocomplete: 'off', placeholder: '예: 하늘이' });
  const start = () => {
    const name = input.value.replace(/\s+/g, ' ').trim();
    if (name) P.setNickname(name);
    P.setWelcomed();
    app.go('#/', { replace: true });
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') start();
  });
  const root = h('div', { class: 'welcome' },
    h('div', { class: 'welcome-mark' }, icon('stairs')),
    h('h1', { class: 'title', tabindex: '-1' }, '말씀 100계단'),
    h('p', { class: 'sub', style: 'margin-top:8px;font-size:20px;line-height:1.6' }, '하루에 한 구절씩 외우며', h('br'), '꼭대기까지 올라가요.'),
    installHint({ closable: false }),
    h('label', { class: 'field', style: 'margin-top:40px' },
      h('span', { class: 'field-label' }, '뭐라고 불러 줄까요?'),
      input,
    ),
    h('p', { class: 'help' }, '안 써도 돼요. 진짜 이름 대신 별명도 좋아요.'),
    h('p', { class: 'field-label', style: 'margin-top:24px' }, '글자 크기'),
    fontPicker(),
    h('div', { class: 'grow' }),
    h('button', { type: 'button', class: 'btn primary', onclick: start }, '시작하기'),
    h('button', {
      type: 'button',
      class: 'link',
      style: 'margin-top:8px',
      onclick: () => {
        P.setWelcomed();
        app.go('#/settings?restore', { replace: true });
      },
    }, '다른 기기에서 쓰던 계단 코드가 있어요'),
  );
  return { el: root, title: '시작하기' };
}

export function notFound(app) {
  return {
    el: h('div', { class: 'empty' },
      h('h1', { class: 'empty-t', tabindex: '-1' }, '찾는 화면이 없어요'),
      h('button', { type: 'button', class: 'btn primary small', onclick: () => app.go('#/', { replace: true }) }, '오늘의 구절 보기')),
    title: '없는 화면',
  };
}
