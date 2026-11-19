/* 今日頁：斷食卡片（只照使用者按的「開始斷食」「結束斷食」計時）、斷食記錄的修改與補記、長期指數提示 */
import { S, L, commit, commitLocal, plan, uid } from '../state.js';
import { h, fold, pills, toast, tip, info3, timePick, openSheet, closeSheet } from './common.js';
import { FASTING } from '../config.js';
import { OMAD_DONE } from '../messages.js';
import { fuelText, eatingText, soupText } from '../lines.js';
import { hybridWeek, currentFast, openFast, checkFast, periods, mergeFasts, mergeTwoFasts, fastsBetween, targetHours, fastEnd, eatPending, pendingMeals, mealShift, stageAt, stageStarts, hybridSuggestion, eatingWindow, hm, dur } from '../fasting.js';
import { openAddMeal } from './addMeal.js';
import { timeStop, gears } from './fx.js';
import { longTermIndex, weightTrend, longTermMessage, leanTrend, leanSummary } from '../longterm.js';
import { usage, localDate, roundTo } from '../points.js';
import { onBoard, dn, md, wdOf } from '../records.js';

const MODES = [['PURE_DYNAMIC', '自由斷食'], ['HYBRID_GUIDED', '依施打週期'], ['STRICT_MANUAL', '自選固定']];
const PLANS = ['16:8', '18:6', '20:4', '24H'];
const H = 3600000;

/** 長期指數與體重速度（今日頁、圖表頁共用） */
export function longTermStatus() {
  const today = localDate(new Date());
  const b = plan();
  const lt = longTermIndex(S.meals, b.ok ? b.bmr : 0, today);
  const wt = weightTrend(S.entries, today);
  return { lt, wt, msg: longTermMessage(lt, wt) };
}

/** 迷你殘留曲線：過去 14 天到未來 7 天 */
function residualSpark() {
  const ds = S.entries.filter(e => e.dose > 0);
  if (!ds.length) return null;
  const today = dn(localDate(new Date())), hl = +S.profile.halfLife || 120;
  const pts = [];
  for (let d = today - 14; d <= today + 7; d++) pts.push(onBoard(S.entries, d, hl));
  const mx = Math.max(...pts, 0.1), W = 300, Hh = 44;
  const xy = pts.map((v, i) => (i / (pts.length - 1) * W).toFixed(1) + ',' + (Hh - v / mx * (Hh - 4) - 2).toFixed(1));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + Hh); svg.style.width = '100%'; svg.style.height = Hh + 'px';
  const pl = document.createElementNS(ns, 'polyline'); pl.setAttribute('points', xy.join(' ')); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', 'var(--warn)'); pl.setAttribute('stroke-width', '2');
  const nowX = 14 / (pts.length - 1) * W;
  const ln = document.createElementNS(ns, 'line'); ln.setAttribute('x1', nowX); ln.setAttribute('x2', nowX); ln.setAttribute('y1', 0); ln.setAttribute('y2', Hh); ln.setAttribute('stroke', 'var(--mu)'); ln.setAttribute('stroke-dasharray', '3 3');
  svg.append(ln, pl);
  return h('div', { style: { marginTop: '10px' } }, h('div.mu.tiny', '預估體內藥量（前 14 天到後 7 天，虛線是今天）'), svg);
}

const toInput = t => { const d = new Date(t), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const dayLabel = t => { const d = new Date(t), n = new Date(); const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5); return (diff === 0 ? '今天 ' : diff === 1 ? '明天 ' : diff === -1 ? '昨天 ' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + hm(t); };
const clock = hours => { const a = Math.abs(hours), h0 = Math.floor(a), m = Math.floor((a - h0) * 60); return h0 + ':' + String(m).padStart(2, '0'); };
const MODE_NAME = Object.fromEntries(MODES);

/** 依模式決定目標時數（手動改過的結束時間會在 fastEnd 裡優先） */
function targetOf(mode, f, now) {
  const P = S.prefs;
  if (mode === 'STRICT_MANUAL') {
    const w = eatingWindow(P.strictPlan || '16:8', P.windowStart || '12:00', now);
    // 進食窗口還沒開：目標＝到窗口開始；窗口中：用方案的斷食時數
    const hours = w.inWindow ? w.fastHours : Math.max(0.1, (w.opensAt - f.start) / H);
    return { hours, label: (P.strictPlan || '16:8') + '・窗口 ' + (P.windowStart || '12:00'), win: w };
  }
  if (mode === 'HYBRID_GUIDED') {
    const { lt, wt } = longTermStatus();
    const sg = hybridSuggestion(S.entries, localDate(new Date()), { fastLoss: wt.fast, lowIntake: lt.ready && lt.level !== 'ok' });
    return { hours: FASTING.plans[sg.plan], label: '建議 ' + sg.plan, sg };
  }
  const t = +P.fastTarget || FASTING.freeTargetDefault;
  return { hours: t, label: '目標 ' + t + ' 小時' };
}

/** 斷食環：一整圈＝這一次斷食（開始→預計結束）；走過的部分依階段上色；超過時外圈加橘色 */
function fastRing(hours, totalH, shift, stIndex, center) {
  const ns = 'http://www.w3.org/2000/svg', S0 = 240, C = S0 / 2, R = 92, R2 = 108, W = 16;
  const cols = ['var(--c1)', 'var(--ac)', 'var(--c4)', 'var(--c3)', 'var(--warn)'];
  const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 ' + S0 + ' ' + S0);
  const el = (tag, at) => { const x = document.createElementNS(ns, tag); for (const k in at) x.setAttribute(k, at[k]); svg.appendChild(x); return x; };
  const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const arc = (r, d0, d1, stroke, w, extra) => {
    if (d1 - d0 <= 0.05) return;
    if (d1 - d0 >= 359.9) { el('circle', { cx: C, cy: C, r, fill: 'none', stroke, 'stroke-width': w, ...(extra || {}) }); return; }
    const [x0, y0] = pt(r, d0), [x1, y1] = pt(r, d1);
    el('path', { d: 'M' + x0 + ' ' + y0 + ' A' + r + ' ' + r + ' 0 ' + (d1 - d0 > 180 ? 1 : 0) + ' 1 ' + x1 + ' ' + y1, fill: 'none', stroke, 'stroke-width': w, ...(extra || {}) });
  };
  const deg = h0 => Math.max(0, Math.min(360, h0 / totalH * 360));
  el('circle', { cx: C, cy: C, r: R, fill: 'none', stroke: 'var(--soft)', 'stroke-width': W });
  const starts = stageStarts(shift);
  // 未走到的部分：各階段淡色
  starts.forEach((s0, i) => { const e0 = starts[i + 1] ?? 1e9; arc(R, deg(s0), deg(e0), cols[i], W, { opacity: 0.18 }); });
  // 已走過的部分：各階段實色
  const done = Math.min(hours, totalH);
  starts.forEach((s0, i) => { const e0 = Math.min(starts[i + 1] ?? 1e9, done); if (e0 > s0) arc(R, deg(s0), deg(e0), cols[i], W); });
  // 階段轉換點
  starts.slice(1).forEach(s0 => { if (s0 < totalH) { const [x, y] = pt(R, deg(s0)); el('circle', { cx: x, cy: y, r: 3.5, fill: 'var(--card)', stroke: 'var(--mu)', 'stroke-width': 1.5 }); } });
  // 超過預計：外圈橘色
  if (hours > totalH) { el('circle', { cx: C, cy: C, r: R2, fill: 'none', stroke: 'var(--soft)', 'stroke-width': 6 }); arc(R2, 0, deg(hours - totalH), 'var(--warn)', 6, { 'stroke-linecap': 'round' }); }
  // 目前位置
  const [cx, cy] = pt(R, deg(done));
  el('circle', { cx, cy, r: 9, fill: 'var(--card)', stroke: cols[stIndex], 'stroke-width': 4 });
  const wrap = h('div', { style: { position: 'relative', width: '200px', maxWidth: '64vw', margin: '6px auto 0' } });
  svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
  wrap.append(svg, h('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1.15 } }, ...center));
  return wrap;
}

/** 斷食現況（今日頁、小工具、通知用）：fasting＝有進行中的斷食記錄（使用者按了「開始斷食」）、reached＝已達目標 */
export function fastInfo(now = Date.now()) {
  const P = S.prefs, mode = P.fastMode || 'PURE_DYNAMIC';
  const f = currentFast(S.meals, S.fasts, now);
  if (!f.start) return { fasting: false, reached: false };
  const tg = targetOf(mode, f, now);
  const e = fastEnd(f.start, tg.hours, f.rec && f.rec.goalEnd, now);
  return { fasting: f.fasting, reached: f.fasting && e.left <= 0, hours: f.hours, left: e.left, start: f.start, end: e.end, shift: mealShift(f.lastMeal) };
}

/** 進食窗口可以吃幾小時（依模式與目標：16:8 → 8 小時） */
function eatHoursOf(mode, tg) {
  if (mode === 'STRICT_MANUAL') return eatingWindow(S.prefs.strictPlan || '16:8', S.prefs.windowStart || '12:00').eatHours;
  return Math.max(1, 24 - (mode === 'HYBRID_GUIDED' ? FASTING.plans[tg.sg.plan] : tg.hours));
}

/** ① 現在：斷食中或進食中（只看你按的按鈕，不會自己開始），先存的餐點也放在這裡 */
export function fastingCard() {
  tidyFasts();
  const now = Date.now();
  const P = S.prefs;
  const mode = P.fastMode || 'PURE_DYNAMIC';
  const f = currentFast(S.meals, S.fasts, now);
  const card = h('div.card.tight');
  const pend = pendingRows(f.fasting, now);
  const tg = targetOf(mode, f, now);
  if (!f.fasting) {
    const eh = eatHoursOf(mode, tg), planName = mode === 'STRICT_MANUAL' ? (P.strictPlan || '16:8') : (24 - eh) + ':' + eh;
    let line;
    if (!f.start) line = '吃完今天最後一餐，按「開始斷食」';
    else {
      const until = f.start + eh * H, left = (until - now) / H;
      line = (f.hours >= 24 ? '上次斷食在 ' + md(localDate(new Date(f.start))) + ' ' + hm(f.start) + ' 結束' : '從 ' + hm(f.start) + ' 開始・' + planName + ' 可吃到 ' + hm(until))
        + (f.hours >= 24 ? '' : left > 0 ? '（還剩 ' + dur(left) + '）' : '（已超過 ' + dur(-left) + '）');
    }
    card.append(h('div.row.between', h('h2', { style: { margin: 0 } }, '進食中'), f.lastMealAt ? h('span.mu.small.num', '上一餐 ' + hm(f.lastMealAt)) : null),
      h('div.small.num.one', { style: { marginTop: '2px' } }, line));
    if (f.start) card.append(h('div.small.two.ln-eat', { 'data-s': f.start, style: { marginTop: '8px', color: 'var(--ac-tx)', fontWeight: 600 } }, eatingText(now, f.start)));
    if (pend) card.append(pend);
    card.append(startBtn(),
      h('div.row.between', { style: { marginTop: '2px' } },
        tip('斷食只照你按的按鈕算：按「開始斷食」才開始，按「結束斷食」才結束，不會自己開始。進食窗口裡吃幾餐都可以，不會切成很多段。時間記錯了，到「斷食與飲食記錄」裡改。'),
        journalLink()));
    return card;
  }
  const shift = mealShift(f.lastMeal);
  const st = stageAt(f.hours, shift);
  const e = fastEnd(f.start, tg.hours, f.rec.goalEnd, now);
  const over = e.left < 0;
  const pct = Math.round(e.pct);
  const shortStage = FASTING.stages[st.index].short || st.text.split('，')[0];
  card.append(h('div.row.between', h('h2', { style: { margin: 0 } }, '斷食中'), h('span.mu.small.num', tg.label)));
  const totalH = (e.end - f.start) / H;
  card.append(fastRing(f.hours, totalH, shift, st.index, [
    h('span.small', { style: { fontWeight: 600, color: over ? 'var(--warn)' : 'var(--mu)' } }, over ? '已超過' : '還剩'),
    h('b.num', { style: { fontSize: '36px', color: over ? 'var(--warn)' : 'var(--tx)' } }, clock(e.left)),
    h('b.num', { style: { fontSize: '17px', color: 'var(--ac-tx)', marginTop: '2px' } }, pct + '%'),
    h('span.mu.tiny', { style: { marginTop: '4px' } }, '已斷食 ' + clock(f.hours))]));
  card.append(h('div.mu.small.num', { style: { textAlign: 'center', marginTop: '6px' } }, hm(f.start) + ' 開始 → ' + hm(e.end) + ' 預計' + (e.custom ? '（自己設的）' : '')),
    h('div.small.one', { style: { marginTop: '8px', fontWeight: 650 } }, '身體現在：' + shortStage),
    h('div.small.one.ln-fuel', { 'data-i': st.index, 'data-ss': f.start + stageStarts(shift)[st.index] * H, 'data-s': f.start, style: { fontWeight: 600 } }, fuelText(st.index, f.start + stageStarts(shift)[st.index] * H, now, f.start)),
    h('div.two.ln-soup', { 'data-s': f.start, style: { margin: '8px 0 2px', color: 'var(--ac-tx)', fontWeight: 650 } }, soupText(now, f.start)));   // 雞湯：每 30 秒換一句、整次不重複，最多兩行
  if (mode === 'STRICT_MANUAL' && (P.strictPlan || '16:8') === '24H' && f.hours >= FASTING.plans['24H']) card.append(h('div.notice.ok', { style: { marginTop: '8px' } }, OMAD_DONE[0]));
  if (pend) card.append(pend);
  card.append(endFastBtn(f));
  // 剛按下 30 分鐘內：按錯了可以取消
  const age = now - new Date(f.rec.start).getTime(), justNow = f.rec.at ? now - f.rec.at : age;
  const row2 = h('div.row.between', { style: { marginTop: '4px' } },
    h('button.link.small', { type: 'button', onclick: () => openFastEditor(f.rec) }, '改時間'),
    journalLink(),
    justNow < 30 * 60000 ? h('button.link.small', { type: 'button', onclick: () => { S.fasts = S.fasts.filter(x => x !== f.rec); commit(); toast('已取消這次斷食'); } }, '按錯了，取消') : null);
  card.append(row2);
  card.append(stagesFold(f.hours, shift, st.index));
  return card;
}

/** 只隔一下、中間沒吃東西的兩段斷食接成一段（今日頁、記錄頁打開時檢查；有改才存） */
export function tidyFasts() {
  const rm = mergeFasts(S.fasts, S.meals);
  if (!rm.length) return;
  S.fasts = S.fasts.filter(x => !rm.includes(x));
  setTimeout(() => commit(), 0);
}

/** 打開「斷食與飲食記錄」的連結 */
export const journalLink = () => h('button.link.small', { type: 'button', style: { flex: '0 0 auto' }, onclick: () => openJournal() }, '斷食與飲食記錄 ›');

/** 全部階段（收起來一行） */
function stagesFold(hours, shift, idx) {
  const starts = stageStarts(shift);
  const list = h('div.small', { style: { marginTop: '6px', display: 'grid', gridTemplateColumns: '16px max-content 1fr', gap: '6px 8px' } });
  FASTING.stages.forEach((sg, i) => {
    const cur = i === idx, done = i < idx;
    const st0 = { color: cur ? 'var(--tx)' : 'var(--mu)', fontWeight: cur ? 650 : 400, opacity: done ? 0.6 : 1 };
    list.append(h('span', { style: { ...st0, color: 'var(--ac-tx)' } }, cur ? '▶' : done ? '✓' : ''),
      h('span.num', { style: { ...st0, whiteSpace: 'nowrap' } }, starts[i] + (starts[i + 1] != null ? '–' + starts[i + 1] : '+') + ' 小時'), h('span', { style: st0 }, sg.text));
  });
  return h('div', { style: { marginTop: '8px', borderTop: '1px solid var(--ln)', paddingTop: '2px' } },
    fold('fast-stages', h('span.small', h('b', '全部階段'), h('span.mu', '・現在第 ' + (idx + 1) + ' 階段')), [list, tip('階段時間因人而異，僅供參考。' + (shift ? '上一餐比較豐盛，階段往後挪約 ' + shift + ' 小時。' : ''))]));
}

/** 設定頁：斷食模式與目標（從今日頁搬過來） */
export function fastModeBody() {
  const P = S.prefs, mode = P.fastMode || 'PURE_DYNAMIC', now = Date.now();
  const f = currentFast(S.meals, S.fasts, now), tg = targetOf(mode, f.start ? f : { start: now }, now), win = tg.win || null;
  const pickMode = v => { P.fastMode = v; commit(); };
  const body = [h('div', { style: { marginTop: '8px' } }, pills(MODES, mode, pickMode))];
  if (mode === 'PURE_DYNAMIC') body.push(h('div', { style: { marginTop: '8px' } }, h('div.mu.tiny', '目標（小時）'), pills(FASTING.freeTargets.map(t => [t, String(t)]), +P.fastTarget || FASTING.freeTargetDefault, v => { P.fastTarget = v; commit(); })));
  if (mode === 'STRICT_MANUAL') {
    const timeIn = timePick(P.windowStart || '12:00', v => { P.windowStart = v; commit(); });
    body.push(h('div', { style: { marginTop: '8px' } }, pills(PLANS.map(p => [p, p === '24H' ? '一天一餐' : p]), P.strictPlan || '16:8', v => { P.strictPlan = v; commit(); })),
      h('div.row', { style: { marginTop: '8px' } }, h('span.small.mu', '進食窗口從'), timeIn, h('span.small.mu', '開始，' + win.eatHours + ' 小時')),
      h('div.small', { style: { marginTop: '6px' } }, win.inWindow ? '現在在進食窗口中，到 ' + hm(win.closesAt) + ' 結束' : '進食窗口 ' + dayLabel(win.opensAt) + ' 開始'));
  }
  if (mode === 'HYBRID_GUIDED') {
    const sg = tg.sg;
    const { lt, wt } = longTermStatus();
    const flags = { fastLoss: wt.fast, lowIntake: lt.ready && lt.level !== 'ok' };
    const week = hybridWeek(S.entries, localDate(new Date()), flags);
    body.push(h('div', { style: { marginTop: '10px', fontWeight: 700, fontSize: '17px' } }, '今天建議 ' + sg.plan));
    if (week.length) {
      // 一週建議表：每天一格，今天框起來，打針那天 💉，被安全提醒改掉的 ⚠
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(' + week.length + ', 1fr)', gap: '3px', marginTop: '8px', textAlign: 'center' } });
      for (const x of week) grid.append(h('div', { style: { border: x.today ? '2px solid var(--ac)' : '1px solid var(--ln)', borderRadius: '8px', padding: '4px 0', background: x.today ? 'var(--ac-soft)' : 'transparent', minWidth: 0 } },
        h('div.tiny.mu', '第' + x.day + '天'),
        h('div.tiny.num', { style: { color: 'var(--mu)' } }, md(x.date)),
        h('div.small.num', { style: { fontWeight: 700, color: x.plan === '18:6' ? 'var(--ac-tx)' : 'var(--tx)' } }, x.plan),
        h('div.tiny', x.dose ? '💉' : x.safer ? '⚠' : x.today ? '今天' : '\u00a0')));
      body.push(grid);
      if (week.some(x => x.safer)) body.push(h('div.small', { style: { marginTop: '6px', color: 'var(--warn)' } }, '⚠ ' + (flags.fastLoss ? '最近體重下降偏快' : '最近一段時間熱量偏低') + '，先用比較溫和的 16:8'));
    } else body.push(h('div.small.mu', { style: { marginTop: '4px' } }, '還沒有施打記錄，先用 16:8。記了注射後，第 1～3 天建議 18:6、第 4～7 天 16:8。'));
    const sp = residualSpark();
    body.push(tip('打針那天算第 1 天：第 1～3 天藥效比較強、通常比較不餓，建議 18:6；第 4～7 天建議 16:8。體重掉太快或長期吃太少時，今天以後一律改成 16:8。只是建議，可以依身體狀況調整；模式只用來算目標，不會自己開始或結束斷食。', ...(sp ? [sp] : [])));
  }
  if (mode !== 'HYBRID_GUIDED') body.push(tip('模式只用來算目標和進食窗口，不會自己開始或結束斷食；一定要你按「開始斷食」「結束斷食」。'));
  return { label: MODE_NAME[mode] + '・' + tg.label, body };
}

/** 結束斷食：斷食停在這一刻；先存的餐點算成這一刻吃的 */
function endFastBtn(f) {
  return h('button.pri.full', {
    type: 'button', style: { background: 'var(--warn)', color: 'var(--on-warn)', marginTop: '10px' },
    onclick: () => {
      const now = new Date().toISOString();
      f.rec.end = now;
      const n = eatPending(S.meals, S.fasts, now);
      if (n) S.meals.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
      commit();
      gears();
      if (n) toast('先存的餐點已記為現在吃');
    },
  }, '結束斷食');
}

/** 先存、還沒吃的餐點（放在 ① 裡面）：不影響斷食，等你按「結束斷食」或「開始吃」 */
function pendingRows(fasting, now) {
  const list = pendingMeals(S.meals);
  if (!list.length) return null;
  const box = h('div', { style: { marginTop: '10px', border: '2px solid var(--ac)', borderRadius: '12px', padding: '8px 10px' } });
  for (const p of list) {
    const t = new Date(p.at).getTime(), pts = p.items.reduce((a, m) => a + (+m.points || 0), 0);
    box.append(h('div.row', { style: { gap: '10px', cursor: 'pointer' }, onclick: () => openAddMeal({ group: p.group }) },
      h('div.grow',
        h('div.small.one', { style: { fontWeight: 650 } }, '先存・預計 ' + hm(t) + ' 吃・' + p.items.map(m => m.name).join('、')),
        h('div.mu.tiny.one', fasting ? '要吃時按「結束斷食」才算開始吃' : '點這裡改時間或刪除')),
      h('span.pts.num', { style: { flex: '0 0 auto' } }, roundTo(pts), h('span.mu.tiny', ' 點'))));
  }
  if (!fasting) box.append(h('button.ghost.full', { type: 'button', style: { marginTop: '8px' }, onclick: () => {
    const at = new Date().toISOString();
    eatPending(S.meals, S.fasts, at); S.meals.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
    commit(); toast('已記為現在吃');
  } }, '開始吃，記為現在'));
  return box;
}

/** 開始斷食：只有按這個才開始。時間停止特效＋音效 */
function startBtn() {
  return h('button.pri.full', {
    type: 'button', style: { marginTop: '10px' },
    onclick: () => {
      if (openFast(S.fasts)) { toast('已經在斷食中', true); return; }
      S.fasts.push({ id: uid('f'), start: new Date().toISOString(), end: null, at: Date.now(), mode: S.prefs.fastMode || 'PURE_DYNAMIC' });
      commit();
      timeStop();
    },
  }, '開始斷食');
}

/**
 * 修改／補記一段斷食。rec＝null 是補記新的一段；進行中的那一段只能改開始和預計結束
 */
export function openFastEditor(rec, onDone, overlap = false) {
  const isOpen = !!(rec && !rec.end);
  const now = Date.now();
  openSheet(sh => {
    sh.append(h('div.sheet-h', h('b', !rec ? '補記一段斷食' : isOpen ? '修改這次斷食' : '修改斷食記錄'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')));
    const sIn = h('input', { type: 'datetime-local', value: toInput(rec ? new Date(rec.start).getTime() : now - 16 * H) });
    const eIn = h('input', { type: 'datetime-local', value: toInput(rec && rec.end ? new Date(rec.end).getTime() : isOpen && rec.goalEnd ? new Date(rec.goalEnd).getTime() : now) });
    const lens = h('div.mu.small.num', { style: { marginTop: '8px' } });
    const drawLen = () => { const a = new Date(sIn.value).getTime(), b = new Date(eIn.value).getTime(); lens.textContent = Number.isFinite(a) && Number.isFinite(b) && b > a ? (isOpen ? '預計 ' : '共 ') + dur((b - a) / H) : ''; };
    sIn.oninput = drawLen; eIn.oninput = drawLen; drawLen();
    const save = h('button.pri.full', { type: 'button', style: { marginTop: '12px' } }, '儲存');
    save.onclick = () => {
      const s = new Date(sIn.value).getTime(), e = new Date(eIn.value).getTime();
      if (isOpen) {
        const err = checkFast(S.fasts, s, null, Date.now(), rec.id);
        if (err) { toast(err, true); return; }
        if (Number.isFinite(e) && e <= s) { toast('預計結束要晚於開始', true); return; }
        rec.start = new Date(s).toISOString();
        if (Number.isFinite(e)) rec.goalEnd = new Date(e).toISOString(); else delete rec.goalEnd;
      } else {
        const err = checkFast(S.fasts, s, e, Date.now(), rec ? rec.id : null);
        if (err) { toast(err, true); return; }
        if (rec) { rec.start = new Date(s).toISOString(); rec.end = new Date(e).toISOString(); delete rec.endedBy; }
        else S.fasts.push({ id: uid('f'), start: new Date(s).toISOString(), end: new Date(e).toISOString(), mode: S.prefs.fastMode || 'PURE_DYNAMIC', added: true });
      }
      commit(); closeSheet(); toast(rec ? '已修改' : '已補記');
    };
    sh.append(h('label', { style: { marginTop: 0 } }, '開始時間'), sIn, h('label', isOpen ? '預計結束（只用來倒數）' : '結束時間'), eIn, lens, save);
    if (isOpen && rec.goalEnd) sh.append(h('button.link.small', { type: 'button', onclick: () => { delete rec.goalEnd; commit(); closeSheet(); toast('預計結束改回照目標算'); } }, '預計結束改回照目標算'));
    if (rec) {
      const del = h('button.danger.full', { type: 'button', style: { marginTop: overlap ? '0' : '16px' } }, isOpen ? '刪除這次斷食（當作沒開始）' : '刪除這段斷食');
      del.onclick = () => {
        if (!del.dataset.c) { del.dataset.c = 1; del.textContent = '再按一次確認刪除'; setTimeout(() => { del.dataset.c = ''; del.textContent = isOpen ? '刪除這次斷食（當作沒開始）' : '刪除這段斷食'; }, 3000); return; }
        S.fasts = S.fasts.filter(x => x !== rec); commit(); closeSheet(); toast('已刪除');
      };
      if (overlap) { const head = sh.querySelector('.sheet-h'); head.after(h('div.notice', { style: { margin: '0 0 8px' } }, h('div.small.one', { style: { fontWeight: 600 } }, '⚠ 這段跟別段時間重疊，多半是記了兩次')), del); }
      else sh.append(del);
    }
    sh.append(tip('時間不能跟別的斷食重疊，也不能晚於現在。圖表的斷食時間就是照這些記錄畫的。'));
  }, onDone ? () => setTimeout(onDone, 350) : null);
}

/** 以前沒按按鈕的日子：用「兩餐之間」猜出來的斷食，勾選要留下的才變成記錄 */
export function openGuessSheet(cands) {
  openSheet(sh => {
    sh.append(h('div.sheet-h', h('b', '整理以前的斷食'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')));
    sh.append(h('div.small', { style: { lineHeight: 1.7 } }, '下面是用「兩餐之間」猜的，勾選真的有斷食的才會留下（12 小時以上的先幫你勾好）。留下的之後都可以再改。'));
    const boxes = cands.map(c => {
      const cb = h('input', { type: 'checkbox' }); cb.checked = c.hours >= 12;
      return [c, cb, h('label.row', { style: { gap: '10px', margin: '8px 0 0', fontWeight: 400 } }, cb, h('span.small.num', md(localDate(new Date(c.start))) + ' ' + hm(c.start) + ' → ' + md(localDate(new Date(c.end))) + ' ' + hm(c.end) + '・' + dur(c.hours)))];
    });
    const keep = h('button.pri.full', { type: 'button', style: { marginTop: '14px' } }, '留下勾選的');
    keep.onclick = () => {
      const ids = [];
      for (const [c, cb] of boxes) if (cb.checked) { const id = uid('f'); ids.push(id); S.fasts.push({ id, start: new Date(c.start).toISOString(), end: new Date(c.end).toISOString(), mode: S.prefs.fastMode || 'PURE_DYNAMIC', guess: true }); }
      S.prefs.fastGuessDone = true;
      L.fastGuessUndo = ids; commitLocal(); commit(); closeSheet();
      toast('已留下 ' + ids.length + ' 段；可以到「設定 → 斷食」復原');
    };
    const none = h('button.ghost.full', { type: 'button', style: { marginTop: '8px' } }, '都不要');
    none.onclick = () => { S.prefs.fastGuessDone = true; L.fastGuessUndo = []; commitLocal(); commit(); closeSheet(); toast('好，以前的都不算斷食'); };
    sh.append(...boxes.map(b => b[2]), keep, none);
  });
}

/** 長期指數提示：沒觸發時不顯示；觸發時一行，點開看說明 */
export function longTermCard() {
  const { lt, wt, msg } = longTermStatus();
  if (!msg) return null;
  const short = (lt.level === 'veryLow' ? '熱量長期明顯偏低' : '熱量長期偏低') + (wt && wt.fast ? '・體重掉太快' : '');
  return h('div.card', { style: { borderColor: 'var(--warn)' } }, fold('lt-card', h('div.small', { style: { fontWeight: 600 } }, short), [ltBody(lt, wt, msg)]));
}

/** 長期攝取指數的說明：現況／建議／說明 */
function ltBody(lt, wt, msg, chartNote = '') {
  const ABOUT = ['這不是每天要達到的目標，是「長期吃太少」的警報：斷食的日子低於 1.0 很正常，平均起來一直偏低才會提醒。', h('br'), ...(chartNote ? [chartNote, h('br')] : []), '每天算一次：當天吃進的熱量 ÷ 基礎代謝，再慢慢平均成長期指數（1.0＝平均每天剛好吃到基礎代謝）。', h('br'),
    '沒有記錄的日子會跳過；當天記錄的熱量不到基礎代謝的 30%，視為「沒記完整」也跳過。今天還沒過完，不列入。', h('br'),
    '至少要 21 個有效記錄日，而且最近 28 天有 70% 以上的日子有記錄，才會開始提醒。低於 1.0：最近熱量偏低；低於 0.8：熱量持續明顯偏低。這只是提醒，不是診斷。'];
  const wtLine = wt.weeklyPct !== null ? '體重（14 天平均）最近每週變化約 ' + (-wt.weeklyPct).toFixed(1) + '%' : null;
  if (!lt.ready) return info3({ now: ['資料累積中：有效記錄 ' + lt.validDays + '／21 天，最近 28 天有 ' + lt.recentValid + ' 天', ...(wtLine ? [wtLine] : [])], tone: 'var(--mu)', about: ABOUT });
  return info3({
    now: ['指數 ' + lt.index.toFixed(2) + '：' + (msg || '正常範圍'), ...(wtLine ? [wtLine] : [])],
    tone: msg ? 'var(--warn)' : 'var(--ac)',
    advice: msg ? '每天至少吃到基本需要的點數，蛋白質吃夠；如果覺得疲倦、怕冷或掉髮，可以和醫師聊聊。' : '照現在的節奏就好。',
    about: ABOUT,
  });
}

/** 圖表頁：長期攝取指數的狀態（資料累積中也顯示） */
export function longTermStatusCard(pre = [], chartNote = '') {
  const { lt, wt, msg } = longTermStatus();
  const sum = !lt.ready
    ? '資料累積中 ' + lt.validDays + '/21 天'
    : (msg ? '有提醒・指數 ' : '正常・指數 ') + lt.index.toFixed(2);
  return h('div.card', fold('lt-status', h('div.grow', h('h2', { style: { margin: 0 } }, '吃太少警報'), h('div.mu.small.one', { style: { marginTop: '2px' } }, sum)), [...pre, ltBody(lt, wt, msg, chartNote)]));
}

/* ---------- 淨體重趨勢 ---------- */
const f1 = x => (Math.round(x * 10) / 10).toFixed(1);
const sg1 = x => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(1);
const TONE = { good: 'var(--ac-tx)', mid: '#ca8a04', warn: 'var(--warn)' };
export function leanStatus() {
  const b = plan();
  return leanTrend(S.entries, S.meals, b.ok ? b.proteinTarget : 0, localDate(new Date()));
}
const LEAN_MSG = '淨體重可能在下降，建議留意蛋白質攝取';
const dot = c => h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: c, marginRight: '8px', flex: '0 0 auto' } });

function leanBody(t) {
  const m = leanSummary(t);
  const box = (c, ...k) => h('div', { style: { borderLeft: '4px solid ' + c, background: 'var(--soft)', borderRadius: '10px', padding: '8px 10px', marginTop: '8px', color: 'var(--tx)' } }, ...k);
  void box;
  const ABOUT = ['淨體重＝體重 ×（1 − 體脂率），也就是扣掉脂肪後剩下的重量（肌肉、骨頭、水分等）。體脂機每天的數字會跳動，所以只比較兩段 28 天的平均：±0.5% 以內算持平，下降 0.5～1.5% 算小幅，超過 1.5% 算明顯。', h('br'),
    t.ready ? '最近 28 天平均 ' + f1(t.cur) + ' kg（' + t.curDays + ' 天有量），再前 28 天 ' + f1(t.prev) + ' kg（' + t.prevDays + ' 天）。' : '',
    t.protein !== null ? '最近 28 天平均每天蛋白質 ' + Math.round(t.protein) + ' g（目標 ' + plan().proteinTarget + ' g，' + t.mealDays + ' 天有記錄）。' : '最近 28 天的餐點記錄少於 10 天，暫時不判斷蛋白質。',
    h('br'), '這只是提醒，不會自動改點數。'];
  if (!m) return info3({ now: '資料累積中' + (t.readyIn ? '，約 ' + t.readyIn + ' 天後有判讀' : ''), tone: 'var(--mu)', about: ABOUT });
  const now = [sg1(t.change) + ' kg（' + sg1(t.pct) + '%）：' + m.levelText];
  if (m.lost) now.push(h('div.small', { style: { marginTop: '4px' } }, m.lost));
  const advice = t.alert ? '最近 28 天蛋白質平均沒達到目標：' + LEAN_MSG + '，也可以加一點肌力運動。'
    : t.level === 'drop' || t.level === 'down' ? '吃夠蛋白質、做一點肌力運動，有助於保住肌肉。'
    : '維持現在的蛋白質和活動量。';
  return info3({ now, advice, about: ABOUT, tone: TONE[m.tone] });
}
/** 今日頁：資料夠了就固定顯示一行（顏色表示結果），有提醒時自動展開一次 */
export function leanCard() {
  const t = leanStatus();
  const m = leanSummary(t);
  if (!m) return null;
  let force = false;
  if (t.alert && L.leanForced !== localDate(new Date())) { force = true; L.leanForced = localDate(new Date()); commitLocal(); }
  return h('div.card', { style: t.alert ? { borderColor: 'var(--warn)' } : null },
    fold('lean-card', h('div.row', { style: { alignItems: 'center' } }, dot(TONE[m.tone]), h('span.small.num', { style: { fontWeight: 600 } }, m.line)), [h('div', { style: { marginTop: '4px' } }, leanBody(t))], { force }));
}
/** 圖表頁：淨體重卡的摘要一行與說明（和淨體重圖放在同一張卡） */
export function leanParts() {
  const t = leanStatus();
  const m = leanSummary(t);
  const sum = !m ? '資料累積中' + (t.readyIn ? '，約 ' + t.readyIn + ' 天後有判讀' : '') : m.line.replace('淨體重 28 天：', '28 天 ');
  return { sum: h('div.mu.small.row', { style: { marginTop: '2px', alignItems: 'center' } }, m ? dot(TONE[m.tone]) : null, h('span.one', sum)), body: leanBody(t) };
}

/* ---------- 斷食與飲食記錄：斷食段、進食段交替排列，全部可以在這裡改 ---------- */
const mdT = t => { const x = new Date(t); return (x.getMonth() + 1) + '/' + x.getDate(); };
const span = (a, b) => mdT(a) + ' ' + hm(a) + ' → ' + (b == null ? '進行中' : (mdT(a) === mdT(b) ? '' : mdT(b) + ' ') + hm(b));
export function openJournal(journalDays = 14) {
  tidyFasts();
  const now = Date.now(), goal = targetHours(S.prefs);
  const g = new Map();
  for (const m of S.meals) {
    if (m.pending) continue;
    const k = m.group || m.id;
    if (!g.has(k)) g.set(k, { group: k, at: m.at, names: [], points: 0 });
    const x = g.get(k); x.names.push(m.name); x.points += +m.points || 0; if (m.at < x.at) x.at = m.at; if (m.notDup) x.notDup = true;
  }
  const all = periods([...g.values()], S.fasts, now);
  // 同一分鐘、同樣內容的兩餐：可能存了兩次
  const seen = new Map();
  const dkey = m => String(m.at).slice(0, 16) + '|' + m.names.join('、');
  for (const m of g.values()) if (!m.notDup) seen.set(dkey(m), (seen.get(dkey(m)) || 0) + 1);
  const dup = m => !m.notDup && seen.get(dkey(m)) > 1;
  // 「不是重複」：同一分鐘同樣的那幾餐都標起來，之後不再提示
  const notDup = m => { const k = dkey(m), gs = new Set([...g.values()].filter(x => dkey(x) === k).map(x => x.group)); for (const x of S.meals) if (gs.has(x.group || x.id)) x.notDup = true; commit(); closeSheet(); setTimeout(() => openJournal(journalDays), 350); };
  const from = now - journalDays * 864e5;
  const list = all.filter(p => (p.end == null ? now : p.end) >= from);
  const back = () => openJournal(journalDays);
  /** 放手後：確認框，按「合併」才改；改完可以復原 */
  const askMerge = (sh, a, b) => {
    let msg, apply;
    if (a.type === 'fast') {
      const st = Math.min(a.start, b.start), en = a.end == null || b.end == null ? null : Math.max(a.end, b.end);
      const mids = [...g.values()].filter(m => { const t = new Date(m.at).getTime(); return t > st && (en == null || t < en); });
      msg = '合併成一段斷食：' + span(st, en) + (mids.length ? '。中間有 ' + mids.length + ' 餐（' + mids.slice(0, 2).map(m => m.names[0]).join('、') + (mids.length > 2 ? '…' : '') + '），會留著放在斷食段裡' : '');
      apply = () => { const rm = mergeTwoFasts(S.fasts, a.rec, b.rec); S.fasts = S.fasts.filter(x => !rm.includes(x)); };
    } else {
      const rm = fastsBetween(S.fasts, a, b, now);
      if (!rm.length) { toast('這兩段中間沒有斷食，不用合併'); return; }
      const st = Math.min(a.start, b.start);
      msg = '合併成一段進食（從 ' + mdT(st) + ' ' + hm(st) + ' 開始）。中間的斷食 ' + rm.map(x => span(new Date(x.start).getTime(), new Date(x.end).getTime())).join('、') + ' 會刪掉';
      apply = () => { S.fasts = S.fasts.filter(x => !rm.includes(x)); };
    }
    sh.querySelector('.mergebar')?.remove();
    const bar = h('div.mergebar', h('div.small', { style: { fontWeight: 600, lineHeight: 1.5 } }, msg),
      h('div.grid2', { style: { marginTop: '8px' } },
        h('button.pri', { type: 'button', onclick: () => {
          const snap = JSON.parse(JSON.stringify(S.fasts));
          apply(); commit(); closeSheet();
          setTimeout(() => { openJournal(journalDays); undoBar('已合併', () => restoreFasts(snap)); }, 350);
        } }, '合併'),
        h('button.ghost', { type: 'button', onclick: () => bar.remove() }, '取消')));
    sh.append(bar);
  };
  openSheet(sh => {
    sh.append(h('div.sheet-h', h('b', '斷食與飲食記錄'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')),
      h('div.row.between', { style: { marginBottom: '6px' } },
        h('span.mu.tiny.one', '點一下改，長按拖到另一段可以合併'),
        h('button.link.small', { type: 'button', onclick: () => { closeSheet(); setTimeout(() => openFastEditor(null, back), 350); } }, '＋ 補記斷食')));
    const mealLine = m => h('div.row', { style: { gap: '8px', padding: '5px 0 5px 12px', cursor: 'pointer' }, onclick: () => { closeSheet(); setTimeout(() => openAddMeal({ group: m.group, onDone: back }), 350); } },
      h('span.small.num.mu', { style: { flex: '0 0 auto' } }, hm(m.at)), h('span.small.one.grow', dup(m) ? h('span', { style: { color: 'var(--warn)', fontWeight: 650 } }, '⚠ 可能重複 ') : null, m.names.join('、')),
      dup(m) ? h('button.link.small', { type: 'button', style: { flex: '0 0 auto', padding: '0 2px' }, onclick: e => { e.stopPropagation(); notDup(m); } }, '不是重複') : null,
      h('span.small.num', { style: { flex: '0 0 auto', fontWeight: 650 } }, roundTo(m.points) + ' 點'));
    const wrapEl = h('div'), items = [];
    for (const p of list.slice().reverse()) {   // 舊的在上、新的在下：整頁從上往下讀，時間往前走
      const box = h('div.jbox', { style: { borderLeft: '4px solid ' + (p.type === 'fast' ? 'var(--c1)' : 'var(--ac)'), padding: '4px 0 4px 10px', margin: '8px 0' } });
      items.push({ el: box, p });
      if (p.type === 'fast') {
        const ok = p.end != null && p.hours >= goal;
        box.append(h('div.row.between', { style: { cursor: 'pointer', gap: '8px' }, onclick: () => { closeSheet(); setTimeout(() => openFastEditor(p.rec, back, p.overlap), 350); } },
          h('div.grow', h('div.small.one', { style: { fontWeight: 650 } }, '斷食段', p.overlap ? h('span', { style: { color: 'var(--warn)' } }, '・⚠ 跟別段重疊') : null), h('div.mu.tiny.num.one', span(p.start, p.end))),
          h('span.small.num', { style: { flex: '0 0 auto', fontWeight: 650, color: ok ? 'var(--ac-tx)' : '' } }, (p.end == null ? '已 ' : '') + (Math.round(p.hours * 10) / 10).toFixed(1) + ' 小時' + (ok ? ' ✓' : '')),
          h('span.mu', { style: { flex: '0 0 auto' } }, '›')));
        if (p.meals.length) box.append(h('div.mu.tiny', { style: { marginTop: '2px' } }, '斷食中補記的：'), ...p.meals.map(mealLine));
      } else if (p.empty) {
        box.style.borderLeftColor = 'var(--ln)';
        box.append(h('div.row.between', { style: { gap: '8px' } },
          h('div.grow', h('div.small.mu', { style: { fontWeight: 650 } }, '空白'), h('div.mu.tiny.num.one', span(p.start, p.end) + '・這段有吃東西嗎？')),
          h('button.link.small', { type: 'button', style: { flex: '0 0 auto' }, onclick: () => { closeSheet(); setTimeout(() => openAddMeal({ at: new Date(p.start + Math.min(30 * 60000, (p.end - p.start) / 2)).toISOString(), onDone: back }), 350); } }, '＋記一餐')));
      } else {
        const pts = p.meals.reduce((a, m) => a + m.points, 0);
        box.append(h('div.row.between', { style: { gap: '8px' } },
          h('div.grow', h('div.small', { style: { fontWeight: 650 } }, p.loose ? mdT(p.start) + ' 的飲食' : '進食段'), p.loose ? null : h('div.mu.tiny.num.one', span(p.start, p.end))),
          h('span.small.num', { style: { flex: '0 0 auto' } }, p.meals.length + ' 餐・' + roundTo(pts) + ' 點')));
        if (p.meals.length) box.append(...p.meals.map(mealLine));
        else box.append(h('div.mu.tiny', { style: { padding: '4px 0 0 12px' } }, '還沒有記錄食物'));
      }
      wrapEl.append(box);
    }
    if (all.length > list.length) sh.append(h('button.ghost.full', { type: 'button', style: { margin: '0 0 6px' }, onclick: () => { closeSheet(); setTimeout(() => openJournal(journalDays + 30), 350); } }, '看更早'));
    sh.append(wrapEl);
    dragMerge(sh, wrapEl, items, (a, b) => askMerge(sh, a, b));
    if (!list.length) sh.append(h('div.empty', '還沒有記錄'));
    sh.append(tip('長按一段拖到同一種的另一段上放開，可以合併：兩段斷食合併，中間吃的東西會留著；兩段進食合併，中間的斷食會刪掉。斷食段＝按「開始斷食」到「結束斷食」，中間只隔 30 分鐘以內又沒吃東西的兩段會自動接成一段。空白＝兩段斷食中間沒記食物，有吃可以補記，不記也沒關係。⚠ 跟別段重疊＝同一段時間記了兩次，刪掉多的那筆；⚠ 可能重複＝同一分鐘記了一樣的餐點；真的吃了兩份就按「不是重複」，記錯了就點進去刪掉一筆。進食段＝上一段斷食結束到下一段斷食開始，中間吃幾次都在同一段。以前沒有斷食記錄的日子，照每天分。'));
  });
  setTimeout(() => { const sh = document.getElementById('sheet'); sh.scrollTop = sh.scrollHeight; }, 60);   // 一打開就看到最下面的「現在」
}

/** 復原合併：改過的記錄照原樣改回來；刪掉的換新 id 加回來（舊 id 已記為刪除，同步時會被拿掉） */
function restoreFasts(snap) {
  for (const r of snap) {
    const i = S.fasts.findIndex(x => x.id === r.id);
    if (i >= 0) S.fasts[i] = r; else S.fasts.push({ ...r, id: uid('f') });
  }
  commit(); toast('已復原');
  if (document.getElementById('sheet').classList.contains('on')) { closeSheet(); setTimeout(() => openJournal(), 350); }
}

/** 畫面下方的「已合併・復原」（6 秒後消失） */
function undoBar(text, onUndo) {
  document.querySelector('.undobar')?.remove();
  const bar = h('div.undobar', h('span', text), h('button.link', { type: 'button', style: { color: 'inherit', textDecoration: 'underline' }, onclick: () => { bar.remove(); onUndo(); } }, '復原'));
  document.body.append(bar);
  setTimeout(() => bar.remove(), 6000);
}

/**
 * 長按拖拉：按住約半秒那一段浮起來（震一下），拖到同一種的另一段上（出現框），放手就呼叫 onDrop。
 * 浮起來之後擋掉捲動，靠近上下邊緣會自動捲；長按過就不算點一下
 */
function dragMerge(scroller, wrapEl, items, onDrop) {
  let timer = null, lifted = null, y0 = 0, s0 = 0, target = null, suppress = false, lastY = 0;
  const clear = () => { clearTimeout(timer); timer = null; };
  const lift = it => { lifted = it; s0 = scroller.scrollTop; it.el.classList.add('lifted'); try { navigator.vibrate && navigator.vibrate(15); } catch (e) { /* 不支援震動 */ } };
  const hit = y => items.find(it => it !== lifted && it.p.type === lifted.p.type && (r => y >= r.top && y <= r.bottom)(it.el.getBoundingClientRect()));
  const move = y => {
    lastY = y;
    if (!lifted) { if (timer && Math.abs(y - y0) > 8) clear(); return; }
    const r = scroller.getBoundingClientRect();
    if (y < r.top + 70) scroller.scrollTop -= 10; else if (y > r.bottom - 70) scroller.scrollTop += 10;
    lifted.el.style.transform = 'translateY(' + (y - y0 + scroller.scrollTop - s0) + 'px) scale(1.02)';
    const t = hit(y);
    if (t !== target) { if (target) target.el.classList.remove('drop'); target = t; if (t) t.el.classList.add('drop'); }
  };
  const end = () => {
    clear();
    if (!lifted) return;
    const src = lifted, dst = target;
    src.el.classList.remove('lifted'); src.el.style.transform = '';
    if (dst) dst.el.classList.remove('drop');
    lifted = null; target = null; suppress = true; setTimeout(() => { suppress = false; }, 400);
    if (dst) onDrop(src.p, dst.p);
  };
  const begin = (it, y) => { y0 = lastY = y; clear(); timer = setTimeout(() => lift(it), 450); };
  for (const it of items) {
    it.el.addEventListener('touchstart', e => begin(it, e.touches[0].clientY), { passive: true });
    it.el.addEventListener('mousedown', e => begin(it, e.clientY));
    it.el.addEventListener('click', e => { if (suppress) { e.stopPropagation(); e.preventDefault(); } }, true);
    it.el.addEventListener('contextmenu', e => e.preventDefault());
  }
  wrapEl.addEventListener('touchmove', e => { if (lifted) e.preventDefault(); move(e.touches[0].clientY); }, { passive: false });
  wrapEl.addEventListener('touchend', end); wrapEl.addEventListener('touchcancel', end);
  wrapEl.addEventListener('mousemove', e => move(e.clientY));
  wrapEl.addEventListener('mouseup', end); wrapEl.addEventListener('mouseleave', end);
}

/** 每 30 秒換句子：只改文字，不重畫整頁（app.js 計時呼叫） */
export function tickLines(now = Date.now()) {
  for (const el of document.querySelectorAll('.ln-soup')) el.textContent = soupText(now, +el.dataset.s);
  for (const el of document.querySelectorAll('.ln-eat')) el.textContent = eatingText(now, +el.dataset.s);
  for (const el of document.querySelectorAll('.ln-fuel')) el.textContent = fuelText(+el.dataset.i, +el.dataset.ss, now, +el.dataset.s);
}
