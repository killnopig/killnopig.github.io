/* 飲食頁的週報：收起時一行；點開看記錄天數、達標天數、運動賺取、體重變化、每天的剩餘點數（以 0 為線），以及 AI 總結 */
import { S, L, commitLocal, plan } from '../state.js';
import { h, fold, toast, tip } from './common.js';
import { weekReport } from '../ledger.js';
import { localDate } from '../points.js';
import { weeklySummary } from '../gemini.js';
import { dailyFastDetail } from '../summary.js';
import { targetHours } from '../fasting.js';
import { weeklyTrend } from '../adaptive.js';
import { ADAPT } from '../config.js';

const fmt = x => (Math.round(x * 2) / 2).toString();
const sgn = x => (x > 0 ? '+' : x < 0 ? '−' : '') + fmt(Math.abs(x));
const WD = '日一二三四五六';
const wdOf = d => { const [y, m, dd] = d.split('-').map(Number); return WD[new Date(y, m - 1, dd).getDay()]; };

function cmp(cur, prev, unit, hasPrev = true) {
  if (!hasPrev) return h('span.mu.tiny', '—');
  const d = cur - prev;
  if (!d) return h('span.mu.tiny', '持平');
  return h('span.tiny', { style: { color: d > 0 ? 'var(--ac-tx)' : 'var(--warn)' } }, (d > 0 ? '▲' : '▼') + Math.abs(d) + unit);
}
const tile = (label, value, unit, extra) => h('div.wtile',
  h('div.mu.tiny.one', label), h('div.num.one', h('b', value), h('span.mu.tiny', unit)), h('div.one', extra || null));

/** 每天的剩餘點數長條：0 為線，綠＝達標、黃＝超標，今天用淡色 */
function bars(days, today, first) {
  const W = 320, H0 = 84, mid = 44, max = Math.max(10, ...days.map(d => Math.abs(d.logged ? d.left : 0)));
  const room = mid - 16;                                 // 長條上下留位置寫數字
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (H0 + 18)); svg.style.width = '100%'; svg.style.display = 'block'; svg.style.marginTop = '10px';
  const el = (t, a, txt) => { const x = document.createElementNS(ns, t); for (const k in a) x.setAttribute(k, a[k]); if (txt != null) x.textContent = txt; svg.appendChild(x); return x; };
  el('line', { x1: 0, x2: W, y1: mid, y2: mid, stroke: 'var(--mu)', 'stroke-width': 1, 'stroke-dasharray': '3 3' });
  const bw = W / days.length;
  days.forEach((d, i) => {
    const x = i * bw + bw * 0.25, w = bw * 0.5;
    if (d.logged) {
      const v = d.left, hgt = Math.max(2, Math.abs(v) / max * room);
      el('rect', { x, y: v >= 0 ? mid - hgt : mid, width: w, height: hgt, rx: 3, fill: v >= 0 ? 'var(--ac)' : 'var(--warn)', opacity: d.date === today ? 0.45 : 1 });
      el('text', { x: x + w / 2, y: v >= 0 ? mid - hgt - 4 : mid + hgt + 12, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 600, fill: 'var(--tx)' }, sgn(v));
    } else if (d.date < today && (!first || d.date >= first)) {   // 開始記錄以前的日子不寫「沒記」
      el('text', { x: x + w / 2, y: mid - 5, 'text-anchor': 'middle', 'font-size': 10, fill: 'var(--mu)' }, '沒記');
    }
    el('text', { x: x + w / 2, y: H0 + 14, 'text-anchor': 'middle', 'font-size': 11, fill: 'var(--mu)' }, wdOf(d.date));
  });
  return svg;
}

let aiBusy = '';
export function weeklyCard(bare = false) {
  const P = plan();
  if (!P.ok) return null;
  const today = localDate(new Date()), mode = S.prefs.weekStart || 'roll';
  const r = weekReport(S, P.dailyPoints, today, mode);
  if (!r.days.some(d => d.logged && d.date < today)) return null;
  const label = mode === 'roll' ? '近 7 天' : '本週';
  // 只算有記錄、而且已經過完的日子；記錄太少就不給數字（才記一天的存摺沒有意義）
  const fd = dailyFastDetail(S.meals, S.fasts), goal = targetHours(S.prefs);
  const doneDays = r.days.filter(d => d.date < today), fastMet = doneDays.filter(d => fd[d.date] && fd[d.date].hours >= goal).length;
  const few = r.cur.logged < 3, tLeft = r.days[r.days.length - 1].left;
  const title = mode === 'roll' ? '最近 7 天' : '本週（從週' + (mode === 'sun' ? '日' : '一') + '開始）';
  const sw = c => h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '2px', background: c, verticalAlign: '-1px' } });
  const sum = r.newbie && few ? '開始記錄第 ' + r.dayNo + ' 天・已記 ' + r.cur.logged + ' 天，滿 3 天有週報'
    : few ? label + '：記了 ' + r.cur.logged + ' 天，記滿 3 天就有週報'
    : label + '：記 ' + r.cur.logged + ' 天・沒超吃 ' + r.cur.healthy + ' 天・斷食達標 ' + fastMet + ' 天';
  const ai = h('div', { style: { marginTop: '10px' } });
  const key = r.from;                                    // 同一段期間（同一週）只產生一次
  const showAI = x => { ai.textContent = ''; ai.append(h('div', { style: { background: 'var(--ac-soft)', borderRadius: '12px', padding: '8px 12px', lineHeight: 1.45 } }, h('div.tiny', { style: { color: 'var(--ac-tx)', fontWeight: 700 } }, 'AI 週報'), h('div.small', x.summary), x.tip ? h('div.small', { style: { marginTop: '4px', fontWeight: 650 } }, '下週試試：' + x.tip) : null, h('div.mu.tiny', { style: { marginTop: '4px' } }, '此內容由 AI 產生，僅供參考'))); };
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
  const wt = weeklyTrend(S.entries, today);   // 趨勢體重：跟 7 天前比
  const wNote = !wt ? h('span.mu.tiny', '沒量') : wt.pct == null ? h('span.mu.tiny', '剛開始') : h('span.tiny', { style: { color: wt.pct > ADAPT.fastWeekPct ? 'var(--warn)' : wt.pct >= 0 ? 'var(--ac-tx)' : 'var(--mu)' } }, (wt.pct >= 0 ? '▼' : '▲') + Math.abs(wt.pct).toFixed(1) + '%／週');
  const body = [h('div.wbody', { style: { marginTop: '6px' } },
    ai,
    h('div.wtiles',
      tile('有記錄', r.cur.logged, '天', cmp(r.cur.logged, r.prev.logged, '', r.hasPrev)),
      tile('沒超吃', r.cur.healthy, '天', cmp(r.cur.healthy, r.prev.healthy, '', r.hasPrev)),
      tile('運動賺', fmt(r.cur.refund), '點', cmp(Math.round(r.cur.refund), Math.round(r.prev.refund), '', r.hasPrev)),
      tile('趨勢體重', wt ? wt.trend.toFixed(1) : '--', 'kg', wNote)),
    h('div.small.one', { style: { marginTop: '12px', fontWeight: 650 } }, '每天剩下的點數・' + title),
    bars(r.days, today, r.first),
    h('div.mu.tiny.one', sw('var(--ac)'), ' 有剩　', sw('var(--warn)'), ' 超吃（用存摺補）　淡色＝今天'),
    h('div.tiprow', { style: { marginTop: '6px' } }, h('div.small.num.one', few ? '存摺：過完的日子記滿 3 天才算（目前 ' + r.cur.logged + ' 天）' : '存摺 ' + sgn(r.cur.balance) + ' 點（只算有記錄的日子）'), tip('格子裡的 ▲▼ 是跟上一段比多或少；「沒超吃」＝那天剩下的點數 ≥ 0。趨勢體重＝把每天的體重平滑過（水分造成的跳動會被抹平），下面寫的是跟 7 天前比、每週變化體重的幾 %；超過 ' + ADAPT.fastWeekPct + '% 變橘色（一般建議每週 0.5～1%）。', h('br'), '長條上的數字是那天剩下的點數，正的是有剩、負的是超吃；「沒記」的日子不算；開始記錄以前的日子不會算成沒記。存摺要等已經過完的日子記滿 3 天才算，今天還沒結束，先另外顯示。只算有記錄的日子：沒記的日子不算預算，也不算省下來。整天都在斷食的日子算「有記錄、吃 0 點」。斷食達標＝那天結束的最長一段斷食到了目標 ' + goal + ' 小時。'))),
    few ? h('div.mu.tiny.num.one', '今天先算 ' + sgn(tLeft) + ' 點（還沒結束）') : null].filter(Boolean);
  const d = fold('week-card', h('div.small.one', { style: { fontWeight: 600 } }, sum), body);
  if (auto) { if (d.open) auto(); d.addEventListener('toggle', () => { if (d.open && auto) { const f = auto; auto = null; f(); } }); }
  return bare ? d : h('div.card', d);
}
