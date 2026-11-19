/* 飲食頁的週報：收起時一行；點開看記錄天數、達標天數、運動賺取、體重變化、每天的剩餘點數（以 0 為線），以及 AI 總結 */
import { S, L, commitLocal, plan } from '../state.js';
import { h, fold, toast } from './common.js';
import { weekReport, WEEK_MODES } from '../ledger.js';
import { localDate } from '../points.js';
import { weeklySummary } from '../gemini.js';

const fmt = x => (Math.round(x * 2) / 2).toString();
const sgn = x => (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(x));
const WD = '日一二三四五六';
const wdOf = d => { const [y, m, dd] = d.split('-').map(Number); return WD[new Date(y, m - 1, dd).getDay()]; };

function cmp(cur, prev, unit) {
  const d = cur - prev;
  if (!d) return h('span.mu.tiny', '和上一段一樣');
  return h('span.tiny', { style: { color: d > 0 ? 'var(--ac-tx)' : 'var(--warn)' } }, '較上一段 ' + (d > 0 ? '▲' : '▼') + Math.abs(d) + unit);
}
const tile = (label, value, unit, extra) => h('div', { style: { background: 'var(--soft)', borderRadius: '12px', padding: '10px 12px' } },
  h('div.mu.tiny', label), h('div.num', h('b', { style: { fontSize: '22px' } }, value), h('span.mu.small', ' ' + unit)), extra || null);

/** 每天的剩餘點數長條：0 為線，綠＝達標、黃＝超標，今天用淡色 */
function bars(days, today) {
  const W = 320, H0 = 120, mid = 64, max = Math.max(10, ...days.map(d => Math.abs(d.logged ? d.left : 0)));
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H0 + 18)); svg.style.width = '100%'; svg.style.display = 'block'; svg.style.marginTop = '10px';
  const el = (t, a, txt) => { const x = document.createElementNS(ns, t); for (const k in a) x.setAttribute(k, a[k]); if (txt != null) x.textContent = txt; svg.appendChild(x); return x; };
  el('line', { x1: 0, x2: W, y1: mid, y2: mid, stroke: 'var(--mu)', 'stroke-width': 1, 'stroke-dasharray': '3 3' });
  const bw = W / days.length;
  days.forEach((d, i) => {
    const x = i * bw + bw * 0.25, w = bw * 0.5;
    if (d.logged) {
      const v = d.left, hgt = Math.max(2, Math.abs(v) / max * (mid - 6));
      el('rect', { x, y: v >= 0 ? mid - hgt : mid, width: w, height: hgt, rx: 3, fill: v >= 0 ? 'var(--ac)' : '#e0a800', opacity: d.date === today ? 0.45 : 1 });
    }
    el('text', { x: x + w / 2, y: H0 + 14, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--mu)' }, wdOf(d.date));
  });
  return svg;
}

let aiBusy = '';
export function weeklyCard() {
  const P = plan();
  if (!P.ok) return null;
  const today = localDate(new Date()), mode = S.prefs.weekStart || 'roll';
  const r = weekReport(S, P.dailyPoints, today, mode);
  if (!r.days.some(d => d.logged)) return null;
  const label = mode === 'roll' ? '近 7 天' : '本週';
  const sum = label + '：達標 ' + r.cur.healthy + '/' + r.cur.days + ' 天・存摺 ' + sgn(r.cur.balance) + ' 點';
  const ai = h('div', { style: { marginTop: '10px' } });
  const key = r.from;                                    // 同一段期間（同一週）只產生一次
  const showAI = x => { ai.textContent = ''; ai.append(h('div', { style: { background: 'var(--ac-soft)', borderRadius: '12px', padding: '10px 12px', lineHeight: 1.7 } }, h('div.tiny', { style: { color: 'var(--ac-tx)', fontWeight: 700 } }, 'AI 週報'), h('div.small', x.summary), x.tip ? h('div.small', { style: { marginTop: '4px', fontWeight: 650 } }, '下週試試：' + x.tip) : null, h('div.mu.tiny', { style: { marginTop: '4px' } }, '此內容由 AI 產生，僅供參考'))); };
  const gen = async () => {
    if (aiBusy === key) {                                // 畫面重畫時已經在產生：等結果出來再顯示
      ai.textContent = ''; ai.append(h('div.row.small.mu', h('span.spin'), 'AI 正在寫這週的總結…'));
      let n = 0; const t = setInterval(() => { if (L.weekAI && L.weekAI.key === key) { clearInterval(t); showAI(L.weekAI); } else if (++n > 40) clearInterval(t); }, 1000);
      return;
    }
    aiBusy = key;
    ai.textContent = ''; ai.append(h('div.row.small.mu', h('span.spin'), 'AI 正在寫這週的總結…'));
    try {
      const stats = { 期間: r.from + ' 到 ' + today, 每日點數: P.dailyPoints, 記錄天數: r.cur.logged, 達標天數: r.cur.healthy, 已結束天數: r.cur.days, 存摺: r.cur.balance, 運動加回點數: r.cur.refund, 上一段: r.prev, 體重變化: r.weightChange, 蛋白質目標: P.proteinTarget, 每天: r.days.map(d => ({ 日期: d.date, 吃了: Math.round(d.eaten), 剩下: Math.round(d.left), 蛋白質: Math.round(d.protein), 有記錄: d.logged })) };
      const x = await weeklySummary({ key: L.geminiKey, model: L.geminiModel, api: L.geminiApi, prefer: L.geminiApiOk, fast: L.geminiFast !== false }, stats);
      L.weekAI = { key, ...x }; commitLocal(); showAI(x);
    } catch (e) {
      ai.textContent = ''; ai.append(h('div.notice', 'AI 週報失敗：' + (e.message || e)), h('button.link.small', { type: 'button', onclick: () => { aiBusy = ''; gen(); } }, '再試一次'));
    }
    aiBusy = '';
  };
  let auto = null;
  if (L.weekAI && L.weekAI.key === key) showAI(L.weekAI);
  else if (L.geminiKey) auto = gen;                      // 點開週報時自動產生
  else ai.append(h('div.notice', { style: { cursor: 'pointer' }, onclick: () => document.querySelector('nav.tabs button[data-t="set"]').click() }, '到「設定 → AI 辨識食物」貼上 Gemini 金鑰後，這裡會有 AI 總結 ›'));
  const wc = r.weightChange;
  const body = [h('div', { style: { marginTop: '6px' } },
    ai,
    h('div.grid2', { style: { gap: '8px', marginTop: '10px' } },
      tile('記錄飲食', r.cur.logged, '天', cmp(r.cur.logged, r.prev.logged, ' 天')),
      tile('達標（剩餘 ≥ 0）', r.cur.healthy, '天', cmp(r.cur.healthy, r.prev.healthy, ' 天')),
      tile('運動賺取', fmt(r.cur.refund), '點', cmp(Math.round(r.cur.refund), Math.round(r.prev.refund), ' 點')),
      tile('體重（平均）', r.weight != null ? r.weight.toFixed(1) : '--', 'kg', wc != null ? h('span.tiny', { style: { color: wc <= 0 ? 'var(--ac-tx)' : 'var(--warn)' } }, '較上一段 ' + (wc <= 0 ? '▼' : '▲') + Math.abs(wc).toFixed(1) + ' kg') : h('span.mu.tiny', '這段沒有量'))),
    h('div.small', { style: { marginTop: '12px', fontWeight: 650 } }, '每天剩下的點數（' + (WEEK_MODES.find(m => m[0] === mode) || WEEK_MODES[0])[1] + '）'),
    bars(r.days, today),
    h('div.mu.tiny.one', '綠＝達標・黃＝超標（用存摺補）・今天較淡'))];
  const d = fold('week-card', h('div.small.one', { style: { fontWeight: 600 } }, sum), body);
  if (auto) { if (d.open) auto(); d.addEventListener('toggle', () => { if (d.open && auto) { const f = auto; auto = null; f(); } }); }
  return h('div.card', d);
}
