/* 共用畫面工具：建立元素、toast、底部面板、可記住狀態的收合區塊、圖示 */
import { L, commitLocal } from '../state.js';

export const $ = id => document.getElementById(id);

/** h('div.card', {onclick}, child, 'text', ...) */
export function h(tag, props, ...kids) {
  const [t, ...cls] = tag.split('.');
  const el = document.createElement(t || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { kids.unshift(props); props = null; }
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el[k] = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const ICONS = {
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  text: '<path d="M5 6h14M5 11h14M5 16h9"/>',
  star: '<path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.3L12 16l-4.9 2.6 1.1-5.3-4-3.7 5.4-.6z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-8 8"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  edit: '<path d="M5 19h4L19 9l-4-4L5 15z"/>',
  run: '<circle cx="14.5" cy="4.5" r="1.8"/><path d="M8 21l3-6 3 2.5V21M6 10.5l3.5-2.5h4l2.5 3.5 3 1M11 15l1.5-6.5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
};
export function icon(name, cls = 'i') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', cls); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name] || '';
  return s;
}

let toastTmr = null;
export function toast(text, bad) {
  const el = $('toast'); el.textContent = text; el.className = bad ? 'bad' : ''; el.style.display = 'block';
  clearTimeout(toastTmr); toastTmr = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

/** 底部面板 */
let sheetClose = null;
export function openSheet(build, onClose) {
  const sh = $('sheet'), bg = $('sheet-bg');
  sh.textContent = '';
  sh.append(h('div.grab'));
  build(sh);
  sh.classList.add('on'); bg.classList.add('on'); sh.scrollTop = 0;
  document.body.style.overflow = 'hidden';
  sheetClose = onClose || null;
  history.pushState({ sheet: 1 }, '');
}
export function closeSheet(fromPop) {
  const sh = $('sheet');
  if (!sh.classList.contains('on')) return;
  sh.classList.remove('on'); $('sheet-bg').classList.remove('on');
  document.body.style.overflow = '';
  const f = sheetClose; sheetClose = null; if (f) f();
  if (!fromPop && history.state && history.state.sheet) history.back();
}
export const sheetOpen = () => $('sheet').classList.contains('on');
window.addEventListener('popstate', () => closeSheet(true));
document.addEventListener('DOMContentLoaded', () => { $('sheet-bg').onclick = () => closeSheet(); });
if (document.readyState !== 'loading') $('sheet-bg').onclick = () => closeSheet();

/** 可記住開合狀態的收合區塊；force=true 時強制展開一次 */
export function fold(key, summary, body, { open = false, force = false, cls = '' } = {}) {
  const st = L.collapsed[key];
  const d = h('details' + (cls ? '.' + cls : ''));
  d.open = force || (st === undefined ? open : st === 1);
  d.append(h('summary', summary), ...[].concat(body));
  d.ontoggle = () => {
    L.collapsed[key] = d.open ? 1 : 0; commitLocal();
    const i = openStack.indexOf(d); if (i >= 0) openStack.splice(i, 1);
    if (d.dataset.bulk) { delete d.dataset.bulk; return; }   // 一鍵全開／全收改的，已整組記好
    if (d.open && d.dataset.ready) openStack.push(d);   // 使用者自己打開的才記（返回手勢一層一層收起）
  };
  setTimeout(() => { d.dataset.ready = 1; }, 0);         // 畫面剛建好時的預設展開不算
  return d;
}

/* 返回手勢（Android App）：每滑一次退一層
 * 面板裡自己打開的區塊 → 面板 → 頁面裡自己打開的區塊；都沒有就回傳 false（交給 app.js 決定回第一頁或離開） */
const openStack = [];   // 每一層是一個 details，或一鍵全開的一組 details（陣列）
const alive = d => d.isConnected && d.open && d.offsetParent !== null;
export function backLayer() {
  const sh = $('sheet'), inSheet = sheetOpen();
  for (let i = openStack.length - 1; i >= 0; i--) {
    const ds = [].concat(openStack[i]).filter(alive);
    if (!ds.length) { openStack.splice(i, 1); continue; }
    if (inSheet !== sh.contains(ds[0])) continue;
    ds.forEach(d => { d.open = false; });
    ds[0].querySelector('summary')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return true;
  }
  if (inSheet) { closeSheet(); return true; }
  return false;
}

/** 一鍵全開／全收：打開的那些算返回手勢的同一層（滑一次全部收起） */
export function setFolds(list, open) {
  const ch = [...list].filter(d => d.open !== open);
  ch.forEach(d => { d.dataset.bulk = 1; d.open = open; });
  if (open && ch.length) openStack.push(ch);
  return ch.length;
}

/** 設定頁用的區塊：收合時只顯示標題與一行摘要 sumEl（由呼叫端更新文字） */
export const sectionBudget = { left: 1 };
export function section(key, title, sumEl, body, open = false) {
  // 一次最多自動展開一張（使用者自己開合過的，以使用者的為準）
  if (L.collapsed[key] === undefined) { if (open && sectionBudget.left > 0) sectionBudget.left--; else open = false; }
  return h('div.card', fold(key, h('div.grow', h('h2', { style: { margin: 0 } }, title), sumEl),
    [h('div', { style: { marginTop: '12px' } }, ...[].concat(body))], { open }));
}
/**
 * 資訊卡三段：現況（粗體、最重要）→ 建議（一句話、強調色）→ 說明（收在 ⓘ）
 * now / advice 可以是字串或元素陣列；tone 是現況左邊色條的顏色
 */
export function info3({ now, advice, about, tone = 'var(--ac)' }) {
  const blk = (label, color, kids, bold) => h('div', { style: { borderLeft: '4px solid ' + color, background: 'var(--soft)', borderRadius: '10px', padding: '8px 10px', marginTop: '8px', lineHeight: 1.7 } },
    h('div.tiny', { style: { color, fontWeight: 700, letterSpacing: '1px' } }, label), ...[].concat(kids).map(k => (typeof k === 'string' ? h('div.small', { style: { fontWeight: bold ? 650 : 400 } }, k) : k)));
  return h('div', blk('現況', tone, now, true), advice ? blk('建議', 'var(--c1)', advice, false) : null, about ? tip(...[].concat(about)) : null);
}

/**
 * 24 小時制的時間選單（時 00～23、分每 5 分鐘）；手機內建的時間選擇器會照地區顯示上午／下午，所以自己做
 * value 'HH:MM'；onChange(新的 'HH:MM')
 */
export function timePick(value, onChange) {
  const [h0, m0] = (/^\d{1,2}:\d{2}$/.test(value || '') ? value : '19:00').split(':').map(Number);
  const pad = n => String(n).padStart(2, '0');
  const hs = h('select', { 'aria-label': '時', style: { width: '76px', textAlign: 'center' } }, ...Array.from({ length: 24 }, (_, i) => h('option', { value: pad(i) }, pad(i))));
  const mins = Array.from({ length: 12 }, (_, i) => i * 5); if (!mins.includes(m0)) mins.push(m0); mins.sort((a, b) => a - b);
  const ms = h('select', { 'aria-label': '分', style: { width: '76px', textAlign: 'center' } }, ...mins.map(m => h('option', { value: pad(m) }, pad(m))));
  hs.value = pad(h0); ms.value = pad(m0);
  const fire = () => onChange(hs.value + ':' + ms.value);
  hs.onchange = fire; ms.onchange = fire;
  return h('div.row', { style: { gap: '4px', flex: '0 0 auto' } }, hs, h('b', ':'), ms);
}

/** 說明收在一行「ⓘ 說明」裡，點了才展開（不記住開合） */
export function tip(...kids) {
  return h('details.tip', h('summary', 'ⓘ 說明'), h('div', ...kids));
}
export const sumLine = () => h('div.mu.small', { style: { marginTop: '2px', fontWeight: 400 } });

/** 數值表：小數點對齊。rows: [label, number, decimals, unit, sub?] */
export function kvTable(rows) {
  const t = h('div.kv');
  for (const [k, v, dec, unit, sub] of rows) {
    const s = typeof v === 'number' ? v.toFixed(dec || 0) : String(v);
    const [i, f] = s.split('.');
    t.append(h('span.k', k), h('span.i.num', i), h('span.f.num', f != null ? '.' + f : ''), h('span.u', unit || ''));
    if (sub) t.append(h('span.sub', sub));
  }
  return t;
}

/** 膠囊／分段按鈕 */
export function pills(opts, value, onPick, cls = 'pills') {
  const box = h('div.' + cls);
  const draw = v => {
    box.textContent = '';
    for (const [val, label] of opts) {
      const b = h('button' + (val === v ? '.on' : ''), { type: 'button', onclick: () => { draw(val); onPick(val); } });
      b.append(...[].concat(label));
      box.append(b);
    }
  };
  draw(value);
  return box;
}

export const fmt1 = x => (Math.round(x * 10) / 10).toString();
export const fmtPts = x => (Math.round(x * 2) / 2).toString();
export const pad = n => String(n).padStart(2, '0');
export const hm = d => { const x = new Date(d); return pad(x.getHours()) + ':' + pad(x.getMinutes()); };
export const WD = '日一二三四五六';
export function toLocalInput(d) {
  const x = new Date(d);
  return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()) + 'T' + hm(x);
}

/** 數字輸入：空白回傳 0 */
export const val = el => { const v = parseFloat(el.value); return Number.isFinite(v) ? v : 0; };
