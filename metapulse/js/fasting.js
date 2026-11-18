/* 斷食：距上一餐的時間、階段、每小時提示、三種模式（純函數，不碰畫面與儲存） */
import { FASTING } from './config.js';

const H = 3600000;
const pad = n => String(n).padStart(2, '0');
const dnLocal = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
const dnStr = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };

/**
 * 目前的斷食狀態
 * - 平常：從最後一筆餐點算起
 * - 按了「開始斷食」且之後沒有記餐：從按下的時間算起
 * - 按了「結束斷食」但還沒記餐：從結束的時間重新算（視為吃過了）
 * @returns {{start:number|null, hours:number, manual:boolean, lastMeal:object[]|null}}
 */
export function currentFast(meals, fasts, now = Date.now(), override = null) {
  let lastAt = -Infinity, lastGroup = null;
  for (const m of meals) {
    const t = new Date(m.at).getTime();
    if (t <= now && t > lastAt) { lastAt = t; lastGroup = m.group || m.id; }
  }
  const lastMeal = lastGroup ? meals.filter(m => (m.group || m.id) === lastGroup) : null;
  const f = (fasts || []).filter(x => x && x.start).reduce((a, b) => (!a || new Date(b.start) > new Date(a.start) ? b : a), null);
  let start = lastAt, manual = false, source = lastGroup ? { type: 'meal', group: lastGroup } : null;
  if (f) {
    const fs = new Date(f.start).getTime();
    if (!f.end && fs > lastAt && fs <= now) { start = fs; manual = true; source = { type: 'manual', id: f.id }; }
    else if (f.end) { const fe = new Date(f.end).getTime(); if (fe > start && fe <= now) { start = fe; source = { type: 'end', id: f.id }; } }
  }
  // 使用者手動改過的時間最優先（記下一餐之前都有效）
  const ov = overrideValid(override, lastGroup) ? override : null;
  if (ov && Number.isFinite(ov.start) && ov.start <= now) { start = ov.start; source = { type: 'override' }; }
  if (!Number.isFinite(start)) return { start: null, hours: 0, manual: false, lastMeal: null, source: null, override: ov };
  return { start, hours: Math.max(0, (now - start) / H), manual, lastMeal: source.type === 'meal' ? lastMeal : null, source, override: ov };
}

/** 手動修改只對「改的時候的那一餐之後」有效；記了新的一餐就失效 */
export function overrideValid(ov, lastGroup) {
  return !!ov && (ov.group || null) === (lastGroup || null) && (Number.isFinite(ov.start) || Number.isFinite(ov.end));
}

/**
 * 記一餐：結束在這一餐之前開始、還在進行的手動斷食，並記下是哪一餐結束的（刪掉那一餐時才接得回來）
 * 會直接改 fasts 裡的物件
 */
export function closeFastsForMeal(fasts, at, group) {
  for (const x of fasts || []) if (x && x.start && !x.end && x.start < at) { x.end = at; x.endedBy = group; }
}

/**
 * 刪掉（或改時間）一餐：被這一餐結束的斷食接回來。之後又開始了別的斷食的話不接，免得同時有兩個進行中
 * @returns {number} 接回來幾筆
 */
export function reopenFastsForMeal(fasts, group) {
  const list = (fasts || []).filter(x => x && x.start);
  const latest = list.reduce((a, x) => (x.start > a ? x.start : a), '');
  let n = 0;
  for (const x of list) {
    if (x.endedBy !== group) continue;
    delete x.endedBy;
    if (x.start === latest) { x.end = null; n++; }
  }
  return n;
}

/** 目前模式的斷食目標（小時）：圖表和「以前的斷食」判斷達標用 */
export function targetHours(prefs = {}, cfg = FASTING) {
  const mode = prefs.fastMode || 'PURE_DYNAMIC';
  return mode === 'STRICT_MANUAL' ? cfg.plans[prefs.strictPlan || '16:8'] : mode === 'HYBRID_GUIDED' ? 16 : (+prefs.fastTarget || cfg.freeTargetDefault);
}

/** 存這一餐會不會結束斷食：斷食中，而且用餐時間在斷食開始之後（補記更早的一餐不會） */
export function mealEndsFast(fi, at) {
  return !!(fi && fi.fasting && Number.isFinite(fi.start) && Number.isFinite(at) && at >= fi.start);
}

/** 目前最後一餐的 group（存手動修改時用） */
export function lastMealGroup(meals, now = Date.now()) {
  let lastAt = -Infinity, g = null;
  for (const m of meals) { const t = new Date(m.at).getTime(); if (t <= now && t > lastAt) { lastAt = t; g = m.group || m.id; } }
  return g;
}

/**
 * 預計結束與進度。手動改過的結束時間最優先，否則 開始 + 目標時數
 * @returns {{end, left(小時，負數＝已超過), pct, custom}}
 */
export function fastEnd(start, targetHours, override, now = Date.now()) {
  let end = start + targetHours * H, custom = false;
  if (override && Number.isFinite(override.end) && override.end > start) { end = override.end; custom = true; }
  const pct = Math.max(0, (now - start) / (end - start) * 100);
  return { end, left: (end - now) / H, pct, custom };
}

/** 上一餐偏大時，階段整體往後挪幾小時（0、1、2） */
export function mealShift(lastMeal, cfg = FASTING) {
  if (!lastMeal || !lastMeal.length) return 0;
  const kcal = lastMeal.reduce((a, m) => a + (+m.kcal || 0), 0), carb = lastMeal.reduce((a, m) => a + (+m.carb || 0), 0);
  if (kcal > cfg.hugeMeal.kcal || carb > cfg.hugeMeal.carb) return cfg.hugeMeal.shift;
  if (kcal > cfg.bigMeal.kcal || carb > cfg.bigMeal.carb) return cfg.bigMeal.shift;
  return 0;
}

/** 各階段的開始小時（第一個階段固定從 0 開始，其他加上 shift） */
export const stageStarts = (shift = 0, cfg = FASTING) => cfg.stages.map((s, i) => (i ? s.from + shift : 0));

export function stageAt(hours, shift = 0, cfg = FASTING) {
  const st = stageStarts(shift, cfg);
  let i = 0;
  for (let k = 0; k < st.length; k++) if (hours >= st[k]) i = k;
  return { index: i, text: cfg.stages[i].text, nextAt: st[i + 1] ?? null };
}

function hash(s) { let x = 2166136261; for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 16777619); } return x >>> 0; }

/** 每小時提示：同一次斷食的同一小時固定同一句 */
export function hourlyMessage(hours, start, messages) {
  const h = Math.min(24, Math.max(0, Math.floor(hours)));
  let k = h;
  while (k > 0 && !(messages[k] && messages[k].length)) k--;
  const list = messages[k] || [''];
  return list[hash(String(start) + ':' + h) % list.length];
}

/**
 * 依施打週期建議（HYBRID_GUIDED）。只建議、不自動切換。
 * @param flags {fastLoss:boolean, lowIntake:boolean} 減重太快、長期指數有提示
 */
export function hybridSuggestion(entries, todayStr, flags = {}, cfg = FASTING) {
  const doses = entries.filter(e => e.dose > 0).map(e => e.date).sort();
  const last = doses[doses.length - 1];
  const hy = cfg.hybrid;
  if (!last) return { plan: hy.fallback, day: null, hasDose: false, reason: '還沒有施打記錄，先用 ' + hy.fallback + ' 當參考。' };
  const day = dnStr(todayStr) - dnStr(last) + 1;
  if (flags.fastLoss || flags.lowIntake) {
    return { plan: hy.safer, day, hasDose: true, reason: (flags.fastLoss ? '最近體重下降偏快' : '最近一段時間熱量偏低') + '，建議用比較溫和的 ' + hy.safer + '。' };
  }
  const r = hy.rules.find(x => day >= x.fromDay && day <= x.toDay);
  if (r) return { plan: r.plan, day, hasDose: true, reason: '施打後第 ' + day + ' 天，建議 ' + r.plan + '。' };
  return { plan: hy.fallback, day, hasDose: true, reason: '距離上次施打已第 ' + day + ' 天，建議 ' + hy.fallback + '。' };
}

/**
 * 自選固定（STRICT_MANUAL）的進食窗口
 * @param plan '16:8' | '18:6' | '20:4' | '24H'；windowStart 'HH:MM'
 * @returns {{inWindow, opensAt, closesAt, eatHours, fastHours}} 時間都是毫秒
 */
export function eatingWindow(plan, windowStart, now = Date.now(), cfg = FASTING) {
  const fastHours = cfg.plans[plan] ?? 16, eatHours = 24 - fastHours;
  const [hh, mm] = String(windowStart || '12:00').split(':').map(Number);
  const base = new Date(now); base.setHours(hh || 0, mm || 0, 0, 0);
  let cur = null, next = null;
  for (const off of [-1, 0, 1]) {
    const o = new Date(base); o.setDate(o.getDate() + off);
    const open = o.getTime(), close = open + eatHours * H;
    if (open <= now && now < close) cur = { open, close };
    if (open > now && (!next || open < next)) next = open;
  }
  if (cur) return { inWindow: true, opensAt: cur.open, closesAt: cur.close, eatHours, fastHours };
  return { inWindow: false, opensAt: next, closesAt: next + eatHours * H, eatHours, fastHours };
}

export const hm = t => { const d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
export const dur = hours => { const h = Math.floor(hours), m = Math.floor((hours - h) * 60); return h ? h + ' 小時 ' + pad(m) + ' 分' : m + ' 分'; };   // 不到 1 小時只寫分鐘
export { dnLocal };

/** 時間是否落在勿擾時段（例如 23:00～07:00，可跨午夜） */
export function inQuiet(t, qs = '23:00', qe = '07:00') {
  const d = new Date(t), m = d.getHours() * 60 + d.getMinutes();
  const a = +qs.slice(0, 2) * 60 + +qs.slice(3), b = +qe.slice(0, 2) * 60 + +qe.slice(3);
  return a === b ? false : a < b ? m >= a && m < b : m >= a || m < b;
}

/**
 * 斷食通知的時間點（純函數）
 * @param fi {start, end, shift}：這次斷食的開始、預計結束、階段往後挪幾小時
 * @param freq 'hourly'（每小時）| 'phase'（階段轉換＋達標）| 'off'
 * @returns [{at, kind:'stage'|'done'|'hour', hours, index}]，只留未來 36 小時內、不在勿擾時段的
 */
export function fastNotes(fi, now, freq = 'phase', qs = '23:00', qe = '07:00', cfg = FASTING) {
  if (!fi || !fi.start || freq === 'off') return [];
  const H = 3600000, out = [], until = now + 36 * H;
  const starts = stageStarts(fi.shift || 0, cfg);
  if (freq === 'hourly') {
    for (let h = Math.ceil((now - fi.start) / H); h <= 30; h++) { const at = fi.start + h * H; if (h >= 1) out.push({ at, kind: 'hour', hours: h }); }
  } else {
    starts.forEach((s, i) => { if (i > 0) out.push({ at: fi.start + s * H, kind: 'stage', hours: s, index: i }); });
  }
  if (fi.end > fi.start) out.push({ at: fi.end, kind: 'done', hours: (fi.end - fi.start) / H });
  return out.filter(x => x.at > now + 30000 && x.at <= until && !inQuiet(x.at, qs, qe)).sort((a, b) => a.at - b.at);
}
