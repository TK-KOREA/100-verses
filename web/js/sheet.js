// 듣기 판(아래에서 올라오는 판), 작은 재생 줄, 들어 보기 버튼. 읽기는 player.js가 한다.
import { h, icon } from './ui.js';
import * as Pl from './player.js';
import * as S from './speech.js';

export const canListen = () => !!(typeof Audio !== 'undefined' || S.canSpeak);

let appRef = null;
let sheet = null; // 열려 있는 판 {el, paint}

/** 지금 이 구절을 읽고 있으면 true. */
const playingThis = (s, v) => s.on && s.verse.id === v.id;

/**
 * 들어 보기 버튼. 누르면 읽기 시작하고 듣기 판을 연다. 읽는 중이면 멈춘다.
 * ctx = {pocket: {key, label, ids}} 말씀 주머니에서 열면 "이 주머니 이어서"를 고를 수 있다.
 */
export function speakButton(v, iconOnly = false, ctx = null) {
  if (!canListen()) return null;
  const btn = h('button', { type: 'button', class: iconOnly ? 'icon-btn' : 'btn secondary small' });
  let seen = false;
  const paint = (s) => {
    const on = playingThis(s, v);
    btn.setAttribute('aria-pressed', String(on));
    btn.replaceChildren(icon(on ? 'stop' : 'speak'));
    if (iconOnly) btn.setAttribute('aria-label', on ? '멈추기' : '들어 보기');
    else btn.append(on ? '멈추기' : '들어 보기');
  };
  paint(Pl.state());
  const unsub = Pl.subscribe((s) => {
    if (!btn.isConnected) {
      if (seen) unsub(); // 화면이 바뀌어 사라진 버튼
      return;
    }
    seen = true;
    paint(s);
  });
  btn.addEventListener('click', () => {
    if (playingThis(Pl.state(), v)) {
      Pl.stop();
      return;
    }
    Pl.play(v, ctx);
    openSheet();
  });
  return btn;
}

// ---------- 고르기 ----------

function choice(label, opts, value, onPick, cols) {
  const seg = h('div', {
    class: 'seg listen-seg', role: 'radiogroup', 'aria-label': label,
    style: `grid-template-columns:repeat(${cols || opts.length},1fr)`,
  }, opts.map(([text, val]) => h('button', {
    type: 'button', role: 'radio', 'aria-checked': String(val === value),
    onclick: () => onPick(val),
  }, text)));
  return h('div', { class: 'listen-group' }, h('p', { class: 'listen-label' }, label), seg);
}

const TIMES = [['1번', 1], ['2번', 2], ['3번', 3], ['5번', 5], ['계속', 0]];

function nextOpts(ctx) {
  return [
    ['멈추기', 'stop'],
    ['외운 말씀 이어서', 'learned'],
    ...(ctx?.pocket ? [[`${ctx.pocket.label} 이어서`, 'pocket']] : []),
    ['1~100번 이어서', 'all'],
  ];
}

function statusText(s) {
  if (!s.on) return '';
  const r = s.times === 0 ? `${s.rep}번째 듣는 중` : `${s.times}번 가운데 ${s.rep}번째`;
  return s.paused ? `멈춤 · ${r}` : r;
}

function verseText(s, v) {
  const p = h('p', { class: 'verse listen-verse', lang: 'ko' });
  const e = s.on && s.verse.id === v.id ? Pl.entryFor(v.id) : null;
  if (e && s.audio) {
    e.chunks.forEach((c, i) => p.append(h('span', { class: 'ck', 'data-i': String(i) }, c.t), ' '));
  } else {
    p.textContent = v.text;
  }
  return p;
}

// ---------- 듣기 판 ----------

export function openSheet() {
  if (!appRef) return;
  const ov = h('div', { class: 'listen-ov', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'listen-title' });
  const back = h('div', { class: 'listen-dim', onclick: closeSheet });
  const panel = h('div', { class: 'listen-sheet' });
  ov.append(back, panel);
  let more = false;
  let raf = 0;

  const paint = () => {
    const s = Pl.state();
    const v = s.on ? s.verse : s.last?.verse;
    if (!v) return closeSheet();
    const ctx = s.on ? s.ctx : s.last?.ctx;
    const p = Pl.prefs();
    const title = h('h2', { id: 'listen-title', class: 'listen-ref', tabindex: '-1' }, v.refLong);
    const head = h('div', { class: 'listen-head' },
      h('div', { class: 'listen-head-t' },
        s.on && s.total > 1 ? h('p', { class: 'eyebrow' }, `${s.index + 1} / ${s.total}`) : null,
        title),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': '판 닫기', onclick: closeSheet }, icon('x')));

    const txt = verseText(s, v);
    const status = h('p', { class: 'listen-status', 'aria-live': 'polite' },
      statusText(s),
      s.on && s.sleepLeft ? ` · ${s.sleepLeft}분 뒤 멈춰요` : '',
      s.on && s.next ? h('span', { class: 'listen-next' }, `다음: ${s.next.refLong}`) : null);

    const ctrls = s.on
      ? h('div', { class: 'listen-ctrls' },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': s.index > 0 ? '앞 말씀' : '처음부터', onclick: () => Pl.prev() }, icon('prev')),
        h('button', {
          type: 'button', class: 'icon-btn big', 'aria-label': s.paused ? '이어 듣기' : '잠깐 멈추기',
          onclick: () => (s.paused ? Pl.resume() : Pl.pause()),
        }, icon(s.paused ? 'play' : 'pause')),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': '다음 말씀', disabled: !s.next, onclick: () => Pl.next() }, icon('next')))
      : null;

    const groups = [
      choice('몇 번 들을까요?', TIMES, p.times, (x) => Pl.setPref('times', x)),
      choice('다 들으면', nextOpts(ctx), p.next === 'pocket' && !ctx?.pocket ? 'learned' : p.next, (x) => Pl.setPref('next', x), 2),
      choice('빠르기', [['보통', false], ['천천히', true]], S.isSlow(), (x) => Pl.setSlow(x)),
    ];
    const moreBox = more ? [
      choice('목소리', Pl.VOICES.map((x) => [x.name, x.key]), p.voice, (x) => Pl.setPref('voice', x), 2),
      choice('주소 읽기', [['앞에', 'front'], ['앞뒤로', 'both'], ['안 읽기', 'none']], p.ref, (x) => Pl.setPref('ref', x)),
      choice('순서', [['차례대로', 'seq'], ['섞어서', 'shuffle']], p.order, (x) => Pl.setPref('order', x)),
      choice('쉬는 틈', [['짧게', 'short'], ['길게', 'long']], p.gap, (x) => Pl.setPref('gap', x)),
      choice('잠잘 때 끄기', [['끄기', 0], ['10분', 10], ['20분', 20], ['30분', 30]], p.sleep, (x) => Pl.setPref('sleep', x)),
    ] : [];

    const focusInside = panel.contains(document.activeElement);
    const keepLabel = focusInside ? document.activeElement.getAttribute('aria-label') || document.activeElement.textContent : null;
    const scroll = panel.scrollTop;
    panel.replaceChildren(
      h('div', { class: 'listen-grab', 'aria-hidden': 'true' }),
      head, txt, status, ctrls,
      ...groups,
      h('button', {
        type: 'button', class: 'link listen-more', 'aria-expanded': String(more),
        onclick: () => { more = !more; paint(); },
      }, more ? '접기' : '더 고르기 · 목소리, 주소, 잠잘 때'),
      ...moreBox,
      s.on
        ? h('button', { type: 'button', class: 'btn secondary small', onclick: () => Pl.stop() }, icon('stop'), '그만 듣기')
        : h('button', { type: 'button', class: 'btn primary small', onclick: () => Pl.play(v, ctx) }, icon('speak'), '다시 듣기'),
    );
    panel.scrollTop = scroll;
    if (keepLabel) {
      const same = [...panel.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent) === keepLabel);
      same?.focus({ preventScroll: true });
    }
    tickChunks();
  };

  // 지금 읽는 덩어리에 빛을 둔다.
  const tickChunks = () => {
    cancelAnimationFrame(raf);
    const spans = panel.querySelectorAll('.ck');
    if (!spans.length) return;
    let last = -2;
    const loop = () => {
      if (!ov.isConnected) return;
      const i = Pl.chunkNow();
      if (i !== last) {
        spans.forEach((sp, k) => sp.classList.toggle('on', k === i));
        last = i;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  };

  const unsub = Pl.subscribe(() => {
    if (!ov.isConnected) return unsub();
    paint();
  });
  ov.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSheet();
  });
  sheet = { el: ov };
  paint();
  appRef.openOverlay(ov, panel.querySelector('#listen-title'));
  paintMini();
}

export function closeSheet() {
  if (!sheet || !appRef) return;
  if (appRef.overlay === sheet.el) appRef.closeOverlay();
  else sheet.el.remove();
  sheet = null;
  paintMini();
}

// ---------- 작은 재생 줄 ----------

let mini = null;

function paintMini() {
  if (!mini) return;
  const s = Pl.state();
  const show = s.on && !sheet && !appRef?.overlay;
  mini.hidden = !show;
  document.body.classList.toggle('has-mini', show);
  if (!show) return;
  mini.replaceChildren(
    h('button', { type: 'button', class: 'mini-open', onclick: openSheet, 'aria-label': `듣기 판 열기, ${s.verse.refLong}` },
      icon('speak'),
      h('span', { class: 'mini-t' }, h('b', null, s.verse.refLong), h('small', null, statusText(s)))),
    h('button', {
      type: 'button', class: 'icon-btn', 'aria-label': s.paused ? '이어 듣기' : '잠깐 멈추기',
      onclick: () => (s.paused ? Pl.resume() : Pl.pause()),
    }, icon(s.paused ? 'play' : 'pause')),
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': '그만 듣기', onclick: () => Pl.stop() }, icon('x')),
  );
}

/** 앱을 열 때 한 번. 화면이 바뀌어도 읽기는 이어지고, 판을 닫으면 작은 재생 줄이 남는다. */
export function init(app) {
  appRef = app;
  Pl.init(app);
  mini = h('div', { class: 'mini', role: 'region', 'aria-label': '듣는 중', hidden: true });
  document.body.append(mini);
  Pl.subscribe(paintMini);
}

/** 화면이 바뀔 때(app.js render) 부른다. 판이 닫혔으면 작은 재생 줄을 다시 맞춘다. */
export function afterRender() {
  if (sheet && !sheet.el.isConnected) sheet = null;
  paintMini();
}
