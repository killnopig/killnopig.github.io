/* 今日頁：斷食卡片（計時、階段進度條、每小時提示、三種模式）與長期指數提示 */
import { S, L, commit, commitLocal, plan, uid } from '../state.js';
import { h, fold, pills, toast, tip, info3, timePick } from './common.js';
import { FASTING } from '../config.js';
import { HOURLY_MESSAGES, OMAD_DONE } from '../messages.js';
import { fuelText, eatingTip, eatingText } from '../lines.js';
import { currentFast, fastEnd, lastMealGroup, eatPending, pendingMeals, mealShift, stageAt, stageStarts, hourlyMessage, hybridSuggestion, eatingWindow, hm, dur, targetHours } from '../fasting.js';
import { openAddMeal } from './addMeal.js';
import { timeStop, gears } from './fx.js';
import { longTermIndex, weightTrend, longTermMessage, leanTrend, leanSummary } from '../longterm.js';
import { usage, localDate, roundTo } from '../points.js';
import { onBoard, dn, md, wdOf } from '../records.js';
import { recentFasts } from '../summary.js';

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

/** 階段進度條：0～24 小時，階段之間用漸層銜接，不畫硬線 */
function stageBar(hours, shift) {
  const max = FASTING.barHours, st = stageStarts(shift);
  const cols = ['var(--c1)', 'var(--ac)', 'var(--c4)', 'var(--c3)', 'var(--warn)'];
  const pct = x => Math.min(100, x / max * 100);
  const stops = [];
  st.forEach((s, i) => {
    const a = pct(s), b = pct(st[i + 1] ?? max);
    stops.push(cols[i] + ' ' + (i ? a + 3 : 0) + '%', cols[i] + ' ' + Math.max(a, b - 3) + '%');
  });
  const bar = h('div', { style: { position: 'relative', height: '10px', borderRadius: '99px', background: 'linear-gradient(90deg,' + stops.join(',') + ')', opacity: 0.85, marginTop: '14px' } });
  bar.append(h('div', { style: { position: 'absolute', top: '-5px', left: 'calc(' + pct(hours) + '% - 2px)', width: '4px', height: '20px', borderRadius: '2px', background: 'var(--tx)' } }));
  const ticks = h('div', { style: { position: 'relative', height: '16px', marginTop: '4px' } });
  st.forEach(s => ticks.append(h('span.mu.tiny', { style: { position: 'absolute', left: pct(s) + '%', transform: s ? 'translateX(-50%)' : 'none' } }, s + 'h')));
  return [bar, ticks];
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
  const wrap = h('div', { style: { position: 'relative', width: '240px', maxWidth: '78vw', margin: '6px auto 0' } });
  svg.style.width = '100%'; svg.style.height = 'auto'; svg.style.display = 'block';
  wrap.append(svg, h('div', { style: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1.15 } }, ...center));
  return wrap;
}

/** 階段進度條，加上預計結束的標記 */
function stageBarWithTarget(hours, shift, targetH) {
  const [bar, ticks] = stageBar(hours, shift);
  if (targetH > 0 && targetH <= FASTING.barHours) {
    bar.append(h('div', { style: { position: 'absolute', top: '-3px', left: 'calc(' + (targetH / FASTING.barHours * 100) + '% - 1px)', width: '2px', height: '16px', background: 'var(--tx)', opacity: 0.45 } }));
  }
  return [bar, ticks];
}

/** 斷食現況（今日頁排順序用）：fasting＝正在斷食、reached＝已達目標 */
/** 記完餐沒按「結束進餐」時，幾小時後自動算斷食（設定可改；0＝不自動） */
export const AUTO_START = [[1, '1'], [1.5, '1.5'], [2, '2'], [3, '3'], [4, '4'], [0, '不自動']]   // 單位：小時;
export function autoStartHours() {
  const v = S.prefs.fastAutoHours;
  return v === 0 ? 0 : (+v > 0 ? +v : FASTING.fastingFromHours);
}
const autoReached = hours => { const a = autoStartHours(); return a > 0 && hours >= a; };

export function fastInfo(now = Date.now()) {
  const P = S.prefs, mode = P.fastMode || 'PURE_DYNAMIC';
  const f = currentFast(S.meals, S.fasts, now, P.fastOverride);
  if (!f.start) return { fasting: false, reached: false };
  const tg = targetOf(mode, f, now), win = tg.win || null, ov = f.override;
  const e = fastEnd(f.start, tg.hours, ov, now);
  const fasting = !!((ov && Number.isFinite(ov.start)) || f.manual || (win ? !win.inWindow : autoReached(f.hours)));
  return { fasting, reached: e.left <= 0, hours: f.hours, left: e.left, start: f.start, end: e.end, shift: mealShift(f.lastMeal) };
}

export function fastingCard() {
  const now = Date.now();
  const P = S.prefs;
  const mode = P.fastMode || 'PURE_DYNAMIC';
  const f = currentFast(S.meals, S.fasts, now, P.fastOverride);
  const card = h('div.card');
  if (!f.start) {
    card.append(h('h2', { style: { margin: 0 } }, '斷食'), h('div.mu.small.one', { style: { margin: '2px 0 4px' } }, '記餐後自動從上一餐開始計時'), startBtn());
    return card;
  }
  const shift = mealShift(f.lastMeal);
  const st = stageAt(f.hours, shift);
  const tg = targetOf(mode, f, now);
  const win = tg.win || null;
  const ov = f.override;
  const e = fastEnd(f.start, tg.hours, ov, now);
  const over = e.left < 0;
  const pct = Math.round(e.pct);
  const fasting = (ov && Number.isFinite(ov.start)) || f.manual || (win ? !win.inWindow : autoReached(f.hours));
  const shortStage = FASTING.stages[st.index].short || st.text.split('，')[0];
  const eatLine = win && win.inWindow ? '進食窗口到 ' + hm(win.closesAt) : '上一餐 ' + hm(f.start) + '・已經 ' + dur(f.hours);
  const summary = !fasting ? eatLine : (over ? '已超過 ' + dur(-e.left) : '還剩 ' + dur(e.left)) + '（' + pct + '%）・' + shortStage;

  const body = h('div', { style: { marginTop: '10px' } });
  if (!fasting) {
    // 第 0 階段「進食中」：還沒按「結束進餐」，不倒數、不顯示百分比和階段
    body.append(h('div.small.one', { style: { fontWeight: 600 } }, eatingTip(now, f.start)),   // 每 2 分鐘換一句（今日頁每分鐘重畫）
      h('div', { style: { margin: '12px 0 4px', color: 'var(--ac-tx)', fontWeight: 650, fontSize: '17px', lineHeight: 1.6 } }, eatingText(now, f.start)),
      tip('記完餐後是第 0 階段「進食中」。吃完按「結束進餐，開始斷食」，斷食就從按的那一刻開始算。' + (autoStartHours() ? '忘了按的話，距上一餐 ' + autoStartHours() + ' 小時後會自動從上一餐開始算。' : '目前設定「不自動」：一定要按才會開始。') + '可以到「設定」→「斷食」修改。'));
  } else {
  // 1. 斷食環：中間是還剩多久與百分比
  const totalH = (e.end - f.start) / H;
  body.append(fastRing(f.hours, totalH, shift, st.index, [
    h('span.small', { style: { fontWeight: 600, color: over ? 'var(--warn)' : 'var(--mu)' } }, over ? '已超過' : '還剩'),
    h('b.num', { style: { fontSize: '40px', color: over ? 'var(--warn)' : 'var(--tx)' } }, clock(e.left)),
    h('b.num', { style: { fontSize: '18px', color: 'var(--ac-tx)', marginTop: '2px' } }, pct + '%'),
    h('span.mu.tiny', { style: { marginTop: '4px' } }, '已斷食 ' + clock(f.hours))]));
  body.append(h('div.mu.small', { style: { textAlign: 'center', marginTop: '6px' } },
    hm(f.start) + ' 開始 → ' + hm(e.end) + ' 結束' + ((ov && (Number.isFinite(ov.start) || Number.isFinite(ov.end))) ? '（已修改）' : '')));
  // 3. 身體現在的狀態
  body.append(h('div', { style: { marginTop: '6px', fontWeight: 650 } }, '身體現在：' + st.text),
    h('div.small.one', { style: { fontWeight: 600 } }, fuelText(st.index, f.start + stageStarts(shift)[st.index] * H, Date.now(), f.start)),  // 每 2 分鐘換一句（今日頁每分鐘重畫）
    h('div.mu.tiny.one', st.nextAt != null ? '再 ' + dur(st.nextAt - f.hours) + ' 進入「' + FASTING.stages[st.index + 1].short + '」' + (Math.abs(f.start + st.nextAt * H - e.end) < 5 * 60000 ? '（剛好達標）' : '') : '已是最後階段'),
    tip('階段時間因人而異，僅供參考。' + (shift ? '上一餐比較豐盛，階段往後挪約 ' + shift + ' 小時。' : '')));
  // 4. 心靈雞湯
  body.append(h('div', { style: { margin: '14px 0 4px', color: 'var(--ac-tx)', fontWeight: 650, fontSize: '17px', lineHeight: 1.6 } }, hourlyMessage(f.hours, f.start, HOURLY_MESSAGES)));
  if (mode === 'STRICT_MANUAL' && (P.strictPlan || '16:8') === '24H' && f.hours >= FASTING.plans['24H']) body.append(h('div.notice.ok', { style: { marginTop: '8px' } }, OMAD_DONE[0]));
  }
  // 5. 主要按鈕
  body.append(fasting ? endFastBtn(f) : startBtn());

  // 6. 收起的三區：時間、全部階段、模式
  const sec = h('div', { style: { marginTop: '12px', borderTop: '1px solid var(--ln)', paddingTop: '4px' } });
  const sIn = h('input', { type: 'datetime-local', value: toInput(f.start) });
  const eIn = h('input', { type: 'datetime-local', value: toInput(e.end) });
  const saveT = h('button.pri.full', { type: 'button' }, '儲存並重新計算');
  saveT.onclick = () => {
    const ns = new Date(sIn.value).getTime(), ne = new Date(eIn.value).getTime();
    if (!Number.isFinite(ns) || ns > Date.now()) { toast('開始時間不能晚於現在', true); return; }
    if (!Number.isFinite(ne) || ne <= ns) { toast('結束時間要晚於開始時間', true); return; }
    const o = { group: lastMealGroup(S.meals) };
    const prev = ov || {};
    if (Math.abs(ns - f.start) >= 60000) o.start = ns; else if (Number.isFinite(prev.start)) o.start = prev.start;
    if (Math.abs(ne - e.end) >= 60000) o.end = ne; else if (Number.isFinite(prev.end)) o.end = prev.end;
    P.fastOverride = (Number.isFinite(o.start) || Number.isFinite(o.end)) ? o : null;
    L.collapsed['fast-time'] = 0; L.fastForced = null; commit(); toast('已重新計算');
  };
  const timeBody = [h('div', { style: { marginTop: '8px' } },
    h('label', { style: { marginTop: 0 } }, '開始時間'), sIn,
    h('label', '預計結束時間'), eIn,
    tip('改過的時間最優先：經過時間、還剩多久、百分比、階段和提示文字都會照新的時間重新計算；記下一餐時自動回到從上一餐開始算。'),
    saveT,
    ov ? h('button.link.small', { type: 'button', onclick: () => { P.fastOverride = null; commit(); toast('已改回自動計算'); } }, '改回自動計算') : null)];
  if (fasting) sec.append(fold('fast-time', h('span.small', h('b', '時間'), h('span.mu', '・' + hm(f.start) + ' → ' + hm(e.end) + (ov ? '（已修改）' : ''))), timeBody));

  const starts = stageStarts(shift);
  // 一個表格排齊：時間那一欄不換行
  const list = h('div.small', { style: { marginTop: '6px', display: 'grid', gridTemplateColumns: '16px max-content 1fr', gap: '6px 8px' } });
  const row = (mark, range, text, cur, done) => {
    const st0 = { color: cur ? 'var(--tx)' : 'var(--mu)', fontWeight: cur ? 650 : 400, opacity: done ? 0.6 : 1 };
    list.append(h('span', { style: { ...st0, color: 'var(--ac-tx)' } }, mark), h('span.num', { style: { ...st0, whiteSpace: 'nowrap' } }, range), h('span', { style: st0 }, text));
  };
  row(!fasting ? '▶' : '✓', '進食中', '按「結束進餐」前（第 0 階段）', !fasting, fasting);
  FASTING.stages.forEach((sg, i) => {
    const cur = fasting && i === st.index, done = fasting && i < st.index;
    row(cur ? '▶' : done ? '✓' : '', starts[i] + (starts[i + 1] != null ? '–' + starts[i + 1] : '+') + ' 小時', sg.text, cur, done);
  });
  sec.append(fold('fast-stages', h('span.small', h('b', '全部階段'), h('span.mu', '・現在第 ' + (fasting ? st.index + 1 : 0) + ' 階段')), [list]));

  const pickMode = v => { P.fastMode = v; L.collapsed['fast-mode'] = 0; commit(); };
  const modeBody = [h('div', { style: { marginTop: '8px' } }, pills(MODES, mode, pickMode))];
  if (mode === 'PURE_DYNAMIC') modeBody.push(h('div', { style: { marginTop: '8px' } }, h('div.mu.tiny', '目標（小時）'), pills(FASTING.freeTargets.map(t => [t, String(t)]), +P.fastTarget || FASTING.freeTargetDefault, v => { P.fastTarget = v; L.collapsed['fast-mode'] = 0; commit(); })));
  if (mode === 'STRICT_MANUAL') {
    const timeIn = timePick(P.windowStart || '12:00', v => { P.windowStart = v; L.collapsed['fast-mode'] = 1; commit(); });
    modeBody.push(h('div', { style: { marginTop: '8px' } }, pills(PLANS.map(p => [p, p === '24H' ? '一天一餐' : p]), P.strictPlan || '16:8', v => { P.strictPlan = v; L.collapsed['fast-mode'] = 0; commit(); })),
      h('div.row', { style: { marginTop: '8px' } }, h('span.small.mu', '進食窗口從'), timeIn, h('span.small.mu', '開始，' + win.eatHours + ' 小時')),
      h('div.small', { style: { marginTop: '6px' } }, win.inWindow ? '現在在進食窗口中，到 ' + hm(win.closesAt) + ' 結束' : '進食窗口 ' + dayLabel(win.opensAt) + ' 開始'));
    if ((P.strictPlan || '16:8') === '24H') {
      const b = plan(), u = usage(S.meals, localDate(new Date()));
      if (b.ok) modeBody.push(h('div.small', { style: { marginTop: '6px', lineHeight: 1.7 } },
        '一天一餐的檢查：蛋白質 ' + Math.round(u.today.protein) + '／' + b.proteinTarget + ' g' + (u.today.protein >= b.proteinTarget ? ' ✓' : '') +
        '・點數 ' + roundTo(u.today.points) + '／保底 ' + b.floorPoints + (u.today.points >= b.floorPoints ? ' ✓' : '')));
    }
  }
  if (mode === 'HYBRID_GUIDED') {
    const sg = tg.sg;
    modeBody.push(h('div.notice.ok', { style: { marginTop: '10px' } }, sg.reason + '只是建議，可以依身體狀況調整。',
      !sg.hasDose ? h('div.tiny.mu', '有施打記錄後，會依照「施打後第幾天」給建議：第 1～3 天 18:6、第 4～7 天 16:8。') : null));
    const sp = residualSpark(); if (sp) modeBody.push(sp);
  }
  sec.append(fold('fast-mode', h('span.small', h('b', '模式：' + MODE_NAME[mode]), h('span.mu', '・' + tg.label)), modeBody));

  // 以前的斷食：最近 14 天，每天一行（跟圖表的斷食時間同一套算法），只能看
  const past = recentFasts(S.meals, S.fasts, localDate(new Date()));
  if (past.length) {
    const goal = targetHours(P), met = past.filter(x => x.hours >= goal).length;
    const rows = past.map(x => h('div.small.num.one', { style: { padding: '3px 0', color: x.hours >= goal ? 'var(--ac-tx)' : 'var(--tx)', fontWeight: x.hours >= goal ? 600 : 400 } },
      md(x.date) + '（' + wdOf(x.date) + '）' + hm(x.start) + ' → ' + hm(x.end) + '・' + dur(x.hours)));
    sec.append(fold('fast-past', h('span.small', h('b', '以前的斷食'), h('span.mu', '・近 14 天達標 ' + met + '/' + past.length + ' 天')),
      [h('div', { style: { marginTop: '6px' } }, ...rows,
        tip('每天一行：那天結束的最長一段斷食（兩餐之間），跟「圖表」的斷食時間一樣。按過「結束進餐」就從按的時間算，按過「結束斷食」就算到按的時間。達到目標 ' + goal + ' 小時的用主色。漏記一餐時會算得太長。'))]));
  }
  body.append(sec);

  // 斷食中而且還沒達標：一直展開；其他時候收成一行（使用者自己開合的照舊記住）
  const force = !fasting || !over;
  card.append(fold('fast-card', h('div.grow', h('h2', { style: { margin: 0 } }, fasting ? '斷食中' : '進食中・第 0 階段'), h('div.small.num', { style: { marginTop: '2px' } }, summary)), [body], { open: false, force }));
  return card;
}

/** 結束斷食：斷食停在這一刻（記成一次斷食），齒輪加速轉動的特效；要記餐請另外按「記一餐」 */
function endFastBtn(f) {
  return h('button.pri.full', {
    type: 'button', style: { background: 'var(--warn)', color: 'var(--on-warn)' },
    onclick: () => {
      const now = new Date().toISOString();
      const open = S.fasts.find(z => !z.end);
      if (open && f.source && f.source.type === 'manual') open.end = now;
      else { if (open) open.end = now; S.fasts.push({ id: uid('f'), start: new Date(f.start).toISOString(), end: now, mode: S.prefs.fastMode || 'PURE_DYNAMIC' }); }
      S.prefs.fastOverride = null;
      // 先存、等一下吃的餐點：算成按下這一刻吃的
      const n = eatPending(S.meals, S.fasts, now);
      if (n) S.meals.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
      commit();
      gears();
      if (n) toast('先存的餐點已記為現在吃');
    },
  }, '結束斷食');
}

/** 今天頁：先存、還沒吃的餐點（不影響斷食，等你按「結束斷食」） */
export function pendingCard() {
  const list = pendingMeals(S.meals);
  if (!list.length) return null;
  const fasting = fastInfo().fasting, now = Date.now();
  const card = h('div.card', { style: { borderColor: 'var(--ac)', borderWidth: '2px' } });
  for (const p of list) {
    const t = new Date(p.at).getTime(), pts = p.items.reduce((a, m) => a + (+m.points || 0), 0);
    const names = p.items.map(m => m.name).join('、');
    card.append(h('div.row', { style: { gap: '10px', cursor: 'pointer' }, onclick: () => openAddMeal({ group: p.group }) },
      h('div.grow',
        h('div.small.one', { style: { fontWeight: 650 } }, '預計 ' + hm(t) + ' 吃・' + names),
        h('div.mu.tiny.one', fasting ? (t <= now ? '時間到了，按「結束斷食」開始吃' : '要吃時按「結束斷食」才算開始') : '點這裡改時間或刪除')),
      h('span.pts.num', { style: { flex: '0 0 auto' } }, roundTo(pts), h('span.mu.tiny', ' 點'))));
  }
  // 沒在斷食（例如已經按過結束進餐）：沒有「結束斷食」可按，給一個直接記成現在吃的按鈕
  if (!fasting) card.append(h('button.ghost.full', { type: 'button', style: { marginTop: '8px' }, onclick: () => {
    const at = new Date().toISOString();
    eatPending(S.meals, S.fasts, at); S.meals.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
    commit(); toast('已記為現在吃');
  } }, '已經吃了，記為現在'));
  return card;
}

/** 結束進餐：斷食從這一刻開始，時間停止特效＋音效 */
function startBtn() {
  return h('button.pri.full', {
    type: 'button',
    onclick: () => {
      S.fasts.push({ id: uid('f'), start: new Date().toISOString(), end: null, mode: S.prefs.fastMode || 'PURE_DYNAMIC' });
      S.prefs.fastOverride = null; commit();
      timeStop();
    },
  }, '結束進餐，開始斷食');
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
  const ABOUT = [...(chartNote ? [chartNote, h('br')] : []), '每天算一次：當天吃進的熱量 ÷ 基礎代謝，再慢慢平均成長期指數（1.0＝平均每天剛好吃到基礎代謝）。', h('br'),
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
    ? '資料累積中（有效記錄 ' + lt.validDays + '／21 天，最近 28 天 ' + lt.recentValid + ' 天）'
    : '指數 ' + lt.index.toFixed(2) + '・' + (msg ? '有提醒' : '正常範圍');
  return h('div.card', fold('lt-status', h('div.grow', h('h2', { style: { margin: 0 } }, '長期攝取指數'), h('div.mu.small.one', { style: { marginTop: '2px' } }, sum)), [...pre, ltBody(lt, wt, msg, chartNote)]));
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
