// 열두 보석(계 21:19-20의 기초 보석 이름과 순서)과 말씀 주머니(상황별 말씀).
// 100구절을 주제가 끊기지 않게 열두 묶음으로 나누고, 묶음마다 보석 이름을 첫째부터 붙였다.
// 색은 보석을 짐작한 것이다. 그림은 코드 안의 고정 SVG만 쓴다.
import { h } from './ui.js';
import * as P from './progress.js';

export const FOUNDS = [
  { no: 1, name: '벽옥', color: '#7FC8B2', from: 1, to: 6, what: '창조와 말씀' },
  { no: 2, name: '청옥', color: '#2F5FD0', from: 7, to: 14, what: '주님의 돌보심' },
  { no: 3, name: '옥수', color: '#9FB2C8', from: 15, to: 21, what: '주님을 찾고 사랑함' },
  { no: 4, name: '비취옥', color: '#1E9E5A', from: 22, to: 32, what: '예수 그리스도와 구원' },
  { no: 5, name: '홍마노', color: '#A9583E', from: 33, to: 38, what: '하나님의 영과 사람의 영' },
  { no: 6, name: '홍옥수', color: '#D9412E', from: 39, to: 45, what: '그리스도인의 인성 ①' },
  { no: 7, name: '귀감람석', color: '#B3BC2E', from: 46, to: 52, what: '그리스도인의 인성 ②' },
  { no: 8, name: '녹주석', color: '#38B3C6', from: 53, to: 63, what: '영적인 생활' },
  { no: 9, name: '황옥', color: '#E3A72F', from: 64, to: 71, what: '주님이 거하심, 먹고 마심' },
  { no: 10, name: '녹옥수', color: '#6FA83A', from: 72, to: 82, what: '이름 부름과 기도' },
  { no: 11, name: '풍신자석', color: '#E07B39', from: 83, to: 90, what: '섬김, 드림, 세상, 침례' },
  { no: 12, name: '자수정', color: '#8E5BD9', from: 91, to: 100, what: '집회, 교회, 왕국, 새 예루살렘' },
];

export const ORD = ['첫째', '둘째', '셋째', '넷째', '다섯째', '여섯째', '일곱째', '여덟째', '아홉째', '열째', '열한째', '열두째'];

const ROUND_ORD = ['첫', '두', '세', '네', '다섯', '여섯', '일곱', '여덟', '아홉', '열'];
/** 바퀴 이름: 2 → "두 번째 바퀴" */
export const roundName = (r) => (ROUND_ORD[r - 1] ? `${ROUND_ORD[r - 1]} 번째 바퀴` : `${r}번째 바퀴`);

/** 말씀 주머니: 이럴 때 꺼내는 말씀. 내가 외운 구절만 보여 준다. */
export const SITUATIONS = [
  { key: 'scared', emoji: '😨', label: '무서울 때', ids: [7, 8, 12, 37, 61] },
  { key: 'worry', emoji: '😟', label: '걱정될 때', ids: [9, 10, 13, 63, 77] },
  { key: 'angry', emoji: '😤', label: '화가 날 때', ids: [41, 42, 49, 50, 52] },
  { key: 'sorry', emoji: '😢', label: '잘못했을 때', ids: [19, 29, 79, 81] },
  { key: 'hard', emoji: '😮‍💨', label: '힘들 때', ids: [11, 14, 44, 54, 67] },
  { key: 'glad', emoji: '😊', label: '기쁠 때', ids: [21, 71, 74, 78] },
];

export const foundOf = (id) => FOUNDS.find((f) => id >= f.from && id <= f.to);
export const foundIds = (f) => Array.from({ length: f.to - f.from + 1 }, (_, i) => f.from + i);

/** 지금 외우는 보석 번호(아직 안 외운 첫 구절의 묶음). 다 외웠으면 마지막 보석. 보석빛 테마의 색을 정한다. */
export function currentFoundNo() {
  for (let id = 1; id <= 100; id++) if (!P.isDone(id)) return foundOf(id).no;
  return FOUNDS.length;
}

/**
 * 외운 순서가 아니라 구절 번호로 센다(목록에서 앞 구절을 먼저 외워도 맞게).
 * got·full은 이번 바퀴, stars는 이 보석을 다 외운 바퀴 수.
 */
export function gemStat(f) {
  const n = f.to - f.from + 1;
  const ids = foundIds(f);
  const got = ids.filter(P.isDone).length;
  let stars = 0;
  for (let r = 1; r <= P.round(); r++) if (ids.every((id) => P.isDoneIn(id, r))) stars++;
  return { n, got, full: got === n, stars };
}

/** 이/가 */
export const iGa = (word) => ((word.charCodeAt(word.length - 1) - 0xac00) % 28 ? '이' : '가');

const NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
}

let uid = 0;
const UNDER = 0.3; // 앞 바퀴 색을 까는 진하기
const GEM = '10,2 30,2 38,12 20,34 2,12';

/**
 * 아래부터 차오르는 보석 하나. fill: 0~1
 * under: 2바퀴부터 앞 바퀴의 색을 흐리게 깔아 둔다(보석을 비우지 않고 그 위에 다시 밝게 찬다).
 */
export function gemArt(f, fill, width = 44, { animate = false, under = false } = {}) {
  const id = 'gem' + ++uid;
  const s = svg('svg', { viewBox: '0 0 40 36', width, height: Math.round(width * 0.9), 'aria-hidden': 'true', class: 'gem-art' });
  const clip = svg('clipPath', { id });
  clip.append(svg('rect', { x: 0, y: 2 + 32 * (1 - fill), width: 40, height: 40 }));
  const defs = svg('defs', {});
  defs.append(clip);
  s.append(defs);
  const lit = fill > 0 || under;
  s.append(svg('polygon', {
    points: GEM, fill: 'var(--surface-2)', 'stroke-width': 1.6, 'stroke-linejoin': 'round',
    stroke: lit ? f.color : 'var(--line-strong)', 'stroke-dasharray': lit ? null : '3 2',
  }));
  if (under) s.append(svg('polygon', { points: GEM, fill: f.color, opacity: UNDER }));
  // 움직임은 안쪽 묶음에 건다. 바깥 묶음에 CSS clip-path를 걸면 차오른 높이(clip-path 속성)를 덮어쓴다.
  const body = svg('g', { 'clip-path': `url(#${id})` });
  const fillG = svg('g', { class: animate ? 'gem-fill' : null });
  fillG.append(
    svg('polygon', { points: GEM, fill: f.color }),
    svg('path', { d: 'M2 12h36M10 2l4 10 6-10 6 10 4-10M14 12l6 22 6-22', fill: 'none', stroke: '#fff', 'stroke-opacity': '.55', 'stroke-width': 1 }),
  );
  body.append(fillG);
  s.append(body);
  if (fill >= 1) s.append(svg('path', { d: 'M33 1l1.2 2.8L37 5l-2.8 1.2L33 9l-1.2-2.8L29 5l2.8-1.2Z', fill: '#fff', class: animate ? 'gem-spark' : null }));
  return s;
}

/**
 * 열두 보석 원. 맨 위 첫째부터 시계 방향, 외울수록 안쪽에서 바깥으로 찬다.
 * cur: 지금 외우는 보석 번호(주황 테두리), sel: 고른 보석 번호(검은 테두리), onPick이 있으면 조각을 누를 수 있다.
 */
export function gemRing({ cur = 0, sel = 0, onPick = null, count = null } = {}) {
  const cx = 170, cy = 165, r0 = 64, r1 = 122, gap = 1.6;
  const pt = (r, a) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
  const f1 = (n) => n.toFixed(1);
  const sector = (ra, rb, a0, a1) => {
    const [x0, y0] = pt(ra, a0), [x1, y1] = pt(rb, a0), [x2, y2] = pt(rb, a1), [x3, y3] = pt(ra, a1);
    return `M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}A${rb} ${rb} 0 0 1 ${f1(x2)} ${f1(y2)}L${f1(x3)} ${f1(y3)}A${ra} ${ra} 0 0 0 ${f1(x0)} ${f1(y0)}Z`;
  };
  const total = count ?? P.doneCount();
  const round = P.round();
  const roundLabel = round > 1 ? `${roundName(round)}, ` : '';
  const root = svg('svg', { viewBox: '0 0 340 330', class: 'gem-ring', role: onPick ? 'group' : 'img', 'aria-label': `열두 보석, ${roundLabel}100구절 중 ${total}구절` });
  FOUNDS.forEach((f, i) => {
    const st = gemStat(f), a0 = i * 30 + gap, a1 = (i + 1) * 30 - gap;
    const g = svg('g', { class: 'ring-part' });
    g.append(svg('path', { d: sector(r0, r1, a0, a1), fill: 'var(--step-todo)' }));
    if (round > 1) g.append(svg('path', { d: sector(r0, r1, a0, a1), fill: f.color, opacity: UNDER }));
    if (st.got) g.append(svg('path', { d: sector(r0, r0 + ((r1 - r0) * st.got) / st.n, a0, a1), fill: f.color }));
    // ✦ 하나가 이 보석을 다 외운 바퀴 하나. 셋까지 그린다.
    for (let k = 0; k < Math.min(st.stars, 3); k++) {
      const [sx, sy] = pt(r1 - 14 - k * 17, i * 30 + 15);
      g.append(svg('path', { d: `M${f1(sx)} ${f1(sy - 7)}l1.7 4.3 4.3 1.7-4.3 1.7-1.7 4.3-1.7-4.3-4.3-1.7 4.3-1.7Z`, fill: '#fff', stroke: f.color, 'stroke-width': 1.2, 'paint-order': 'stroke' }));
    }
    if (f.no === sel && f.no !== cur) g.append(svg('path', { d: sector(r0, r1, a0, a1), fill: 'none', stroke: 'var(--text)', 'stroke-width': 3 }));
    if (f.no === cur) g.append(svg('path', { d: sector(r0, r1, a0, a1), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 3 }));
    const [lx, ly] = pt(r1 + 20, i * 30 + 15);
    const label = svg('text', {
      x: f1(lx), y: f1(ly + 4), 'text-anchor': 'middle', 'font-size': 12.5, 'font-weight': f.no === sel ? 900 : 800,
      fill: st.got || f.no === sel ? 'var(--text)' : 'var(--text-2)',
    });
    label.textContent = f.name;
    g.append(label);
    if (onPick) {
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', `${ORD[i]} 보석 ${f.name}, ${st.n}구절 중 ${st.got}구절` + (st.stars > 1 ? `, ${st.stars}번 다 외움` : ''));
      if (f.no === sel) g.setAttribute('aria-pressed', 'true');
      g.addEventListener('click', () => onPick(f.no));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick(f.no);
        }
      });
    }
    root.append(g);
  });
  const big = svg('text', { x: cx, y: cy + 8, 'text-anchor': 'middle', 'font-size': 44, 'font-weight': 900, fill: 'var(--accent)', 'aria-hidden': 'true' });
  big.textContent = String(total);
  const small = svg('text', { x: cx, y: cy + 32, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 800, fill: 'var(--text-2)', 'aria-hidden': 'true' });
  small.textContent = '/ 100';
  root.append(big, small);
  if (round > 1) {
    const top = svg('text', { x: cx, y: cy - 32, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800, fill: 'var(--text-2)', 'aria-hidden': 'true' });
    top.textContent = roundName(round);
    root.append(top);
  }
  return root;
}

/** 말씀 주머니 단추 여섯 개 */
export function pocketGrid(app) {
  return h('div', { class: 'pocket' }, SITUATIONS.map((s) => {
    const n = s.ids.filter(P.isLearned).length;
    return h('button', {
      type: 'button',
      class: n ? '' : 'none',
      'aria-label': `${s.label}, 외운 말씀 ${n}개`,
      onclick: () => app.go('#/pocket/' + s.key),
    },
    n ? h('span', { class: 'n', 'aria-hidden': 'true' }, String(n)) : null,
    h('span', { class: 'e', 'aria-hidden': 'true' }, s.emoji),
    h('span', null, s.label));
  }));
}
