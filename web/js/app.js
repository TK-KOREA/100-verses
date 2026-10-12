// 시작, 화면 이동, 아래 탭.
import { h, icon, hideToast } from './ui.js';
import * as P from './progress.js';
import * as S from './speech.js';
import * as V from './views.js';

V.applyFontLevel(); // 첫 화면을 그리기 전에 글자 크기를 맞춘다.

const main = document.getElementById('app');
const tabbar = document.getElementById('tabbar');

const TABS = [
  ['today', '#/', '오늘', 'today'],
  ['list', '#/list', '구절', 'list'],
  ['stairs', '#/stairs', '계단', 'stairs'],
  ['settings', '#/settings', '설정', 'gear'],
];

const app = {
  verses: [],
  byId: {},
  groups: [],
  listFilter: 'all',
  listQuery: '',
  scrolls: {},
  navCount: 0,
  current: null,
  overlay: null,
  afterWelcome: null, // 받은 구절 주소로 처음 열었으면 시작하기 뒤에 그 구절로 간다.
};

// 바꿔 끼운 이동(location.replace)은 앱 안 이동 수에 넣지 않는다. 넣으면 받은 링크로 처음 연 뒤
// "뒤로"가 앱 밖 이전 페이지로 나간다.
let replacing = false;
app.go = (hash, { replace = false } = {}) => {
  if (replace) {
    if (hash !== location.hash) replacing = true;
    location.replace(hash);
  } else {
    location.hash = hash;
  }
};

/** 앱 안에서 온 화면이면 이전 화면으로, 처음 연 화면이면 오늘로. */
app.back = () => {
  if (app.navCount > 0) history.back();
  else app.go('#/', { replace: true });
};

let lastFocus = null;
app.openOverlay = (el, focusEl) => {
  app.closeOverlay();
  lastFocus = document.activeElement;
  app.overlay = el;
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  main.setAttribute('aria-hidden', 'true');
  tabbar.setAttribute('aria-hidden', 'true');
  (focusEl || el).focus({ preventScroll: true });
};
app.closeOverlay = () => {
  if (!app.overlay) return;
  app.overlay.remove();
  app.overlay = null;
  document.body.style.overflow = '';
  main.removeAttribute('aria-hidden');
  tabbar.removeAttribute('aria-hidden');
  if (lastFocus && lastFocus.isConnected) lastFocus.focus({ preventScroll: true });
};

function parse(hash) {
  const [path, query = ''] = (hash || '').replace(/^#/, '').split('?');
  const p = path || '/';
  let m;
  if (p === '/') return { name: 'today', tab: true, key: 'today' };
  if (p === '/list') return { name: 'list', tab: true, key: 'list' };
  if (p === '/stairs') return { name: 'stairs', tab: true, key: 'stairs' };
  if (p === '/settings') return { name: 'settings', tab: true, key: 'settings', query };
  if (p === '/welcome') return { name: 'welcome', key: 'welcome' };
  if ((m = p.match(/^\/verse\/(\d{1,3})$/))) return { name: 'verse', param: Number(m[1]), key: 'verse' };
  return { name: 'notFound', key: 'notFound' };
}

function paintTabs(activeKey) {
  tabbar.replaceChildren(...TABS.map(([key, href, label, ic]) => h('a', {
    class: 'tab',
    href,
    'aria-current': key === activeKey ? 'page' : null,
  }, icon(ic), label)));
}

let signature = '';
// 날짜도 넣는다: 자정이 지나면 "오늘은 다 했어요"가 새 오늘의 구절로 바뀌어야 한다.
const sig = () => JSON.stringify([P.doneList(), P.nickname(), P.kstToday()]);

function render({ keepScroll = false, first = false } = {}) {
  const r = parse(location.hash);
  if (!P.welcomed() && r.name !== 'welcome' && r.name !== 'settings') {
    if (r.name === 'verse') app.afterWelcome = location.hash;
    app.go('#/welcome', { replace: true });
    return;
  }
  const prev = app.current;
  if (prev) {
    if (!keepScroll) app.scrolls[prev.route.key] = window.scrollY;
    prev.view.cleanup?.();
  }
  if (!keepScroll) {
    S.stop();
    hideToast();
    app.closeOverlay();
  }
  const y = window.scrollY;
  const view = V[r.name](app, r.param, r.query);
  app.current = { route: r, view };
  signature = sig();
  main.replaceChildren(view.el);
  tabbar.hidden = !r.tab;
  main.classList.toggle('no-tabbar', !r.tab);
  document.body.classList.toggle('no-tabbar', !r.tab);
  if (r.tab) paintTabs(r.name);
  document.title = view.title && r.name !== 'today' ? `${view.title} · 말씀 100계단` : '말씀 100계단';

  let restored = false;
  if (keepScroll) {
    window.scrollTo(0, y);
    restored = true;
  } else if (r.tab && app.scrolls[r.key] != null) {
    window.scrollTo(0, app.scrolls[r.key]);
    restored = true;
  } else {
    window.scrollTo(0, 0);
  }
  if (!first && !keepScroll) main.querySelector('h1')?.focus({ preventScroll: true });
  view.after?.(restored);
}

// 진도가 바뀌면 지금 화면을 새로 그린다. 연습·설정 화면은 스스로 일부만 고친다.
P.onChange(() => {
  const cur = app.current;
  if (!cur) return;
  if (cur.view.update) {
    cur.view.update();
    return;
  }
  if (sig() === signature) return;
  render({ keepScroll: true });
});

window.addEventListener('hashchange', () => {
  if (replacing) replacing = false;
  else app.navCount++;
  render();
});

window.addEventListener('online', () => P.sync());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    P.sync();
    const cur = app.current;
    if (cur && !cur.view.update && !app.overlay && sig() !== signature) render({ keepScroll: true });
  } else {
    S.stop();
  }
});

async function boot() {
  try {
    const r = await fetch('data/verses.json');
    const data = await r.json();
    app.verses = data.verses;
  } catch (e) {
    main.replaceChildren(h('div', { class: 'empty' },
      h('h1', { class: 'empty-t' }, '말씀을 불러오지 못했어요'),
      h('p', { class: 'sub' }, '인터넷에 연결한 뒤 다시 열어 주세요.'),
      h('button', { type: 'button', class: 'btn primary small', onclick: () => location.reload() }, '다시 열기')));
    return;
  }
  for (const v of app.verses) {
    app.byId[v.id] = v;
    const g = app.groups[app.groups.length - 1];
    if (g && g.topic === v.topic) g.verses.push(v);
    else app.groups.push({ topic: v.topic, verses: [v] });
  }
  render({ first: true });
  P.sync();
}

// 오프라인 저장. 내 컴퓨터에서 고치는 동안에는 옛 파일이 보이지 않게 ?sw=1일 때만 켠다.
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!isLocal || new URLSearchParams(location.search).has('sw'))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot();
