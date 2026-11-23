/* 斷食：距上一餐的時間、階段、每小時提示、三種模式（純函數，不碰畫面與儲存） */
import { FASTING } from './config.js';

const H = 3600000;
const pad = n => String(n).padStart(2, '0');
const dnLocal = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
const md = t => { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); };
const dnStr = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };

/**
 * 目前的斷食狀態：只看斷食記錄（使用者自己按的「開始斷食」「結束斷食」），不從餐點去猜、不自動開始
 * - 有進行中的斷食記錄（有開始、沒結束）→ 斷食中，從那筆的開始算
 * - 沒有 → 進食中。進食窗口從上一次斷食結束的時間算；從來沒有斷食記錄時，用最近 24 小時的第一餐
 * @returns {{fasting, start:number|null, hours, rec, lastMeal:object[]|null, lastMealAt:number|null}}
 */
export function currentFast(meals, fasts, now = Date.now()) {
  const rec = openFast(fasts, now);
  const until = rec ? new Date(rec.start).getTime() : now;
  let lastAt = -Infinity, lastGroup = null, firstRecent = Infinity;
  for (const m of meals || []) {
    if (m.pending) continue;   // 先存、還沒吃的餐點不算
    const t = new Date(m.at).getTime();
    if (t <= until && t > lastAt) { lastAt = t; lastGroup = m.group || m.id; }
    if (t <= now && t > now - 24 * H && t < firstRecent) firstRecent = t;
  }
  const lastMeal = lastGroup ? meals.filter(m => (m.group || m.id) === lastGroup && !m.pending) : null;
  const lastMealAt = Number.isFinite(lastAt) ? lastAt : null;
  if (rec) {
    const start = new Date(rec.start).getTime();
    return { fasting: true, start, hours: Math.max(0, (now - start) / H), rec, lastMeal, lastMealAt };
  }
  const closed = lastClosedFast(fasts, now);
  let start = closed ? new Date(closed.end).getTime() : null;
  if (start == null && Number.isFinite(firstRecent)) start = firstRecent;
  return { fasting: false, start, hours: start == null ? 0 : Math.max(0, (now - start) / H), rec: null, lastMeal, lastMealAt, lastEnd: closed ? start : null };
}

/** 進行中的斷食記錄（有開始、沒結束，開始不晚於現在）：有好幾筆時取最新的 */
export function openFast(fasts, now = Date.now()) {
  let r = null;
  for (const x of fasts || []) {
    if (!x || !x.start || x.end) continue;
    const t = new Date(x.start).getTime();
    if (t <= now && (!r || t > new Date(r.start).getTime())) r = x;
  }
  return r;
}

/** 最近一筆結束了的斷食記錄（結束不晚於現在） */
export function lastClosedFast(fasts, now = Date.now()) {
  let r = null;
  for (const x of fasts || []) {
    if (!x || !x.start || !x.end) continue;
    const t = new Date(x.end).getTime();
    if (t <= now && (!r || t > new Date(r.end).getTime())) r = x;
  }
  return r;
}

/** 結束了的斷食記錄，新的在前：[{rec, start, end, hours}] */
export function fastSegments(fasts) {
  const out = [];
  for (const x of fasts || []) {
    if (!x || !x.start || !x.end) continue;
    const s = new Date(x.start).getTime(), e = new Date(x.end).getTime();
    if (e > s) out.push({ rec: x, start: s, end: e, hours: (e - s) / H });
  }
  return out.sort((a, b) => b.end - a.end);
}

/**
 * 檢查一段斷食能不能存：結束要晚於開始、不能晚於現在、不能跟別的記錄重疊
 * @param end null＝還在斷食
 * @returns {string} 錯誤訊息；空字串＝可以存
 */
export function checkFast(fasts, start, end, now = Date.now(), selfId = null) {
  if (!Number.isFinite(start)) return '請選開始時間';
  if (start > now + 60000) return '開始時間不能晚於現在';
  if (end != null) {
    if (!Number.isFinite(end)) return '請選結束時間';
    if (end <= start) return '結束時間要晚於開始時間';
    if (end > now + 60000) return '結束時間不能晚於現在';
  }
  const e1 = end == null ? Infinity : end;
  for (const x of fasts || []) {
    if (!x || !x.start || x.id === selfId) continue;
    const s2 = new Date(x.start).getTime(), e2 = x.end ? new Date(x.end).getTime() : Infinity;
    if (end == null && !x.end) return '已經有一段進行中的斷食';
    if (start < e2 && s2 < e1) return '跟另一段斷食（' + md(s2) + ' ' + hm(s2) + ' 開始）時間重疊';
  }
  return '';
}

/**
 * 以前沒有按鈕記錄的日子：用「兩餐之間」猜出來的斷食，給使用者勾選要不要留下
 * 只列 minH～48 小時、而且跟現有斷食記錄不重疊的。新的在前：[{start, end, hours}]
 */
export function guessFasts(meals, fasts, minH = 8, maxH = 48) {
  const g = new Map();
  for (const m of meals || []) {
    if (m.pending) continue;
    const k = m.group || m.id, t = new Date(m.at).getTime();
    const x = g.get(k) || { first: t, last: t };
    x.first = Math.min(x.first, t); x.last = Math.max(x.last, t); g.set(k, x);
  }
  const ms = [...g.values()].sort((a, b) => a.first - b.first);
  const recs = (fasts || []).filter(x => x && x.start).map(x => [new Date(x.start).getTime(), x.end ? new Date(x.end).getTime() : Infinity]);
  const out = [];
  for (let i = 1; i < ms.length; i++) {
    const s = ms[i - 1].last, e = ms[i].first, hrs = (e - s) / H;
    if (hrs < minH || hrs > maxH) continue;
    if (recs.some(([a, b]) => s < b && a < e)) continue;
    out.push({ start: s, end: e, hours: hrs });
  }
  return out.reverse();
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

/**
 * 「先存，等一下吃」的餐點（pending）：不影響斷食，等使用者自己按「結束斷食」。
 * 依 group 分組、照預計時間排序：[{group, at, items}]
 */
export function pendingMeals(meals) {
  const g = new Map();
  for (const m of meals || []) {
    if (!m.pending) continue;
    const k = m.group || m.id;
    if (!g.has(k)) g.set(k, { group: k, at: m.at, items: [] });
    g.get(k).items.push(m);
  }
  return [...g.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/**
 * 真的開始吃了：把先存的餐點（group＝null 是全部，否則只有那一餐）改成這一刻吃的，拿掉 pending，並結束進行中的手動斷食。
 * 會直接改 meals、fasts 裡的物件。回傳改了幾組
 */
export function eatPending(meals, fasts, at, group = null) {
  const list = pendingMeals(meals).filter(p => group == null || p.group === group);
  for (const p of list) {
    for (const m of p.items) { m.at = at; delete m.pending; }
    closeFastsForMeal(fasts, at, p.group);
  }
  return list.length;
}

/**
 * 預計結束與進度。使用者自己設的預計結束（斷食記錄的 goalEnd）最優先，否則 開始 + 目標時數
 * @param goalEnd 毫秒或 ISO 字串；沒有就給 null
 * @returns {{end, left(小時，負數＝已超過), pct, custom}}
 */
export function fastEnd(start, targetHours, goalEnd, now = Date.now()) {
  let end = start + targetHours * H, custom = false;
  const g = goalEnd == null ? NaN : new Date(goalEnd).getTime();
  if (Number.isFinite(g) && g > start) { end = g; custom = true; }
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
 * @param flags {fastLoss, lowIntake, doseUp:{day,until}|null, custom} 減重太快、長期指數有提示、剛加劑量（custom＝自己排過，不改只標記）
 */
export function hybridSuggestion(entries, todayStr, flags = {}, cfg = FASTING) {
  const doses = entries.filter(e => e.dose > 0).map(e => e.date).sort();
  const last = doses[doses.length - 1];
  const hy = cfg.hybrid;
  if (!last) return { plan: hy.fallback, day: null, hasDose: false, reason: '還沒有施打記錄，先用 ' + hy.fallback + ' 當參考。' };
  const day = dnStr(todayStr) - dnStr(last) + 1;
  const up = flags.doseUp && !flags.custom && dnStr(todayStr) <= dnStr(flags.doseUp.until);
  if (flags.fastLoss || flags.lowIntake || up) {
    if (up && !(flags.fastLoss || flags.lowIntake)) return { plan: hy.safer, day, hasDose: true, up: true, reason: '剛加劑量（第 ' + flags.doseUp.day + ' 天），建議用比較溫和的 ' + hy.safer + '。' };
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
  if (!fi || !fi.start || fi.fasting === false || freq === 'off') return [];   // 進食中不排斷食通知
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

/**
 * 「斷食與飲食記錄」用：把時間切成斷食段和進食段，交替排列，新的在前
 * - 斷食段＝一筆斷食記錄（進行中的 end＝null）；斷食中補記的餐點掛在那一段的 meals；跟別段時間重疊的 overlap＝true
 * - 進食段＝上一段斷食結束到下一段斷食開始，中間吃的都在同一段；最新的一段 end＝null（進行中）
 * - 沒有斷食記錄的日子，或兩段斷食中間隔了超過 24 小時（忘了按），進食段依「每天」分開（loose＝true）
 * - 兩段斷食中間沒記食物：empty＝true 的空白段
 * @param groups 一餐一筆：[{group, at, ...}]（先存、還沒吃的不要放進來）
 * @returns [{type:'fast'|'eat', start, end|null, hours, meals:[], rec?, loose?}]
 */
export function periods(groups, fasts, now = Date.now()) {
  const fs = (fasts || []).filter(x => x && x.start).map(x => ({ rec: x, start: new Date(x.start).getTime(), end: x.end ? new Date(x.end).getTime() : null }))
    .filter(x => x.start <= now).sort((a, b) => a.start - b.start);
  const ms = (groups || []).map(g => ({ g, t: new Date(g.at).getTime() })).filter(x => x.t <= now).sort((a, b) => a.t - b.t);
  const out = [];
  const used = new Set();
  for (const f of fs) {
    const e = f.end == null ? now : f.end;
    const inside = ms.filter(x => x.t > f.start && x.t < e);   // 剛好在開始那一刻記的餐點算進食段（是結束上一段斷食的那一餐）
    inside.forEach(x => used.add(x));
    const overlap = fs.some(o => o !== f && o.start < e && f.start < (o.end == null ? now : o.end));
    out.push({ type: 'fast', start: f.start, end: f.end, hours: (e - f.start) / H, meals: inside.map(x => x.g), rec: f.rec, overlap });
  }
  // 進食段：斷食之間的空檔
  const gaps = [];
  let prev = null;
  for (const f of fs) { gaps.push({ start: prev, end: f.start }); prev = f.end == null ? Infinity : f.end; }
  if (prev !== Infinity) gaps.push({ start: prev, end: null });
  for (const gp of gaps) {
    const a = gp.start == null ? -Infinity : gp.start, b = gp.end == null ? Infinity : gp.end;
    const inside = ms.filter(x => !used.has(x) && x.t >= a && x.t <= b);   // 剛好在下一段斷食開始那一刻的也算這一段
    inside.forEach(x => used.add(x));   // 一餐只放在一段裡
    const open = gp.end == null;
    // 兩段斷食中間沒記任何食物：顯示成空白（提醒可以補記，不強迫）
    if (!inside.length && !open && gp.start != null) { if (b > a) out.push({ type: 'eat', start: a, end: b, hours: (b - a) / H, meals: [], empty: true }); continue; }
    const span = (open ? now : b) - (gp.start == null ? (inside[0] ? inside[0].t : now) : a);
    if (gp.start != null && span <= 24 * H) {
      if (inside.length || open) out.push({ type: 'eat', start: a, end: open ? null : b, hours: ((open ? now : b) - a) / H, meals: inside.map(x => x.g) });
      continue;
    }
    // 沒有斷食記錄、或忘了按很久：每天一段
    const byDay = new Map();
    for (const x of inside) { const d = new Date(x.t); const k = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x); }
    for (const list of byDay.values()) out.push({ type: 'eat', start: list[0].t, end: list[list.length - 1].t, hours: (list[list.length - 1].t - list[0].t) / H, meals: list.map(x => x.g), loose: true });
  }
  return out.sort((p, q) => q.start - p.start || (p.type === 'fast' ? -1 : 1));   // 同一刻開始：進食段（結束上一段斷食那一餐）排在斷食段下面
}

/**
 * 接起來：兩段斷食中間只隔 gapMin 分鐘以內、而且中間沒吃東西（多半是測試或按錯），合成一段
 * 會直接改 fasts（前一段的結束改成後一段的結束），回傳要刪掉的後一段記錄
 */
export function mergeFasts(fasts, meals, gapMin = 30) {
  const list = (fasts || []).filter(x => x && x.start).sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const eats = (meals || []).filter(m => !m.pending).map(m => new Date(m.at).getTime());
  const removed = [];
  let cur = null;
  for (const x of list) {
    if (cur && cur.end) {
      const e = new Date(cur.end).getTime(), s = new Date(x.start).getTime();
      if (s >= e && s - e <= gapMin * 60000 && !eats.some(t => t >= e && t <= s)) {
        cur.end = x.end || null; delete cur.endedBy;
        if (x.endedBy) cur.endedBy = x.endedBy;
        if (x.goalEnd) cur.goalEnd = x.goalEnd;
        removed.push(x);
        continue;
      }
    }
    cur = x;
  }
  return removed;
}

/**
 * 記錄頁拖拉合併兩段斷食：從比較早的開始到比較晚的結束（有一段還在進行就是進行中）。
 * 被包進來的其他斷食記錄也一起拿掉（免得重疊）；中間的餐點不動。會直接改 keep，回傳要刪掉的記錄
 */
export function mergeTwoFasts(fasts, a, b) {
  const t = x => new Date(x).getTime();
  const keep = t(a.start) <= t(b.start) ? a : b, other = keep === a ? b : a;
  const start = Math.min(t(a.start), t(b.start));
  const end = a.end == null || b.end == null ? null : Math.max(t(a.end), t(b.end));
  keep.start = new Date(start).toISOString(); keep.end = end == null ? null : new Date(end).toISOString();
  delete keep.endedBy; if (end == null && other.goalEnd) keep.goalEnd = other.goalEnd;
  const rm = (fasts || []).filter(x => x && x !== keep && x.start && (x === other || (t(x.start) >= start && (end == null || (x.end && t(x.end) <= end)))));
  return rm;
}

/**
 * 記錄頁拖拉合併兩段進食：兩段中間的斷食記錄拿掉，整段都算進食。回傳要刪掉的記錄
 * @param p, q periods() 給的進食段（{start, end}；end＝null 是進行中）
 */
export function fastsBetween(fasts, p, q, now = Date.now()) {
  const early = p.start <= q.start ? p : q, late = early === p ? q : p;
  const from = early.start, to = late.start;
  return (fasts || []).filter(x => x && x.start && x.end && new Date(x.start).getTime() >= from && new Date(x.end).getTime() <= to + 60000);
}

/**
 * 「依施打週期」的一週建議表：從最近一次施打那天（第 1 天）排到第 7 天（今天更晚就排到今天）
 * 今天和之後如果有安全提醒（減重太快、長期吃太少），改成比較溫和的方案並標 safer
 * @returns [{date, day, plan, today, dose, safer}]；沒有施打記錄回傳 []
 */
export function hybridWeek(entries, todayStr, flags = {}, cfg = FASTING) {
  const doses = (entries || []).filter(e => e.dose > 0 && e.date <= todayStr).map(e => e.date).sort();
  const last = doses[doses.length - 1];
  if (!last) return [];
  const hy = cfg.hybrid, T = dnStr(todayStr), L0 = dnStr(last), out = [];
  const warn = !!(flags.fastLoss || flags.lowIntake);
  const upTo = flags.doseUp ? dnStr(flags.doseUp.until) : -1;   // 剛加劑量：到這天為止標「剛加量」
  for (let n = L0; n <= Math.max(L0 + 6, T); n++) {
    const day = n - L0 + 1, r = hy.rules.find(x => day >= x.fromDay && day <= x.toDay);
    let plan = r ? r.plan : hy.fallback, safer = false;
    const up = n <= upTo;
    if ((warn || (up && !flags.custom)) && n >= T && plan !== hy.safer) { plan = hy.safer; safer = true; }   // 自己排過的照你排的，只標記
    const d = new Date(n * 864e5), date = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
    out.push({ date, day, plan, today: n === T, dose: n === L0, safer, up });
  }
  return out;
}

/**
 * 使用者自訂的「依施打週期」：prefs.hybridDays＝第 1～7 天各用哪一種（'16:8' 或 '18:6'），沒設就用 config 的預設。
 * 回傳一份 cfg（只換 hybrid.rules），給 hybridSuggestion／hybridWeek 用
 */
export const HYBRID_CHOICES = ['16:8', '18:6'];
export function hybridDaysOf(prefs = {}, cfg = FASTING) {
  const d = prefs.hybridDays;
  if (Array.isArray(d) && d.length === 7 && d.every(x => HYBRID_CHOICES.includes(x))) return d.slice();
  return [1, 2, 3, 4, 5, 6, 7].map(n => { const r = cfg.hybrid.rules.find(x => n >= x.fromDay && n <= x.toDay); return r ? r.plan : cfg.hybrid.fallback; });
}
export function hybridCfg(prefs = {}, cfg = FASTING) {
  const days = hybridDaysOf(prefs, cfg);
  return { ...cfg, hybrid: { ...cfg.hybrid, rules: days.map((plan, i) => ({ fromDay: i + 1, toDay: i + 1, plan })) } };
}

/** 把一段時間切成每天一段（畫時間軸用）：[{ day0（當天 0 點的毫秒）, len（當天毫秒數）, a, b }]，a、b 是當天 0–1 的位置 */
export function daySlices(start, end) {
  const out = [];
  if (!(end > start)) return out;
  const d = new Date(start); d.setHours(0, 0, 0, 0);
  for (let day0 = d.getTime(); day0 < end;) {
    const n = new Date(day0); n.setDate(n.getDate() + 1); const next = n.getTime(), len = next - day0;   // 用日期加一天，避開日光節約
    out.push({ day0, len, a: Math.max(0, (start - day0) / len), b: Math.min(1, (end - day0) / len) });
    day0 = next;
  }
  return out;
}
