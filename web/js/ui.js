// 화면 도우미. 사용자가 쓴 글(별칭, 코드)은 textContent로만 넣는다.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : String(c));
  }
  return el;
}

// 아이콘은 코드 안의 고정 SVG만 쓴다.
const ICONS = {
  today: '<path d="M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  list: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 8h7M9 12h5"/>',
  stairs: '<path d="M3 21h5v-5h5v-5h5V6h3"/><path d="M3 21h18"/>',
  speak: '<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
};

export function icon(name) {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return t.content.firstChild;
}

// 그림(축하·꼭대기)도 고정 SVG.
export function art(name) {
  const t = document.createElement('template');
  if (name === 'climb') {
    t.innerHTML = `<svg width="200" height="150" viewBox="0 0 200 150" aria-hidden="true">
      <path d="M10 140 H60 V110 H100 V80 H140 V50 H190" fill="none" stroke="var(--accent)" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
      <g class="climb-figure"><circle cx="120" cy="34" r="12" fill="var(--text)"/><rect x="111" y="48" width="18" height="32" rx="9" fill="var(--text)"/></g>
      <path class="pop" d="M150 20 l6 -12 M164 30 l12 -6 M160 14 l6 -6" stroke="var(--accent)" stroke-width="4" stroke-linecap="round"/>
    </svg>`;
  } else if (name === 'crown') {
    t.innerHTML = `<svg class="pop" width="140" height="140" viewBox="0 0 140 140" aria-hidden="true">
      <circle cx="70" cy="70" r="66" fill="var(--accent)"/>
      <path d="M38 92 h64 l-6 -40 -16 16 -10 -26 -10 26 -16 -16 z" fill="var(--accent-on)" stroke="var(--accent-on)" stroke-width="4" stroke-linejoin="round"/>
    </svg>`;
  }
  return t.content.firstChild;
}

let toastTimer = null;
/** 아래쪽 알림. action = {label, run} 이면 버튼을 하나 붙인다. */
export function toast(text, action) {
  const el = document.getElementById('toast');
  clearTimeout(toastTimer);
  el.replaceChildren(h('span', { text }));
  if (action) {
    el.append(h('button', {
      type: 'button',
      onclick: () => {
        hideToast();
        action.run();
      },
    }, action.label));
  }
  el.hidden = false;
  toastTimer = setTimeout(hideToast, action ? 6000 : 3000);
}
export function hideToast() {
  clearTimeout(toastTimer);
  const el = document.getElementById('toast');
  if (el) el.hidden = true;
}
