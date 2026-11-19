/* 點數帳（純函數）：每天有固定的每日點數，加上運動加回，減去吃掉的；
 * 每天剩下的累積成「存摺」。存摺的期間可選：最近 7 天滾動、每週日開始、每週一開始。
 * 每日點數＝7 天點數額度 ÷ 7（已經內含熱量赤字），所以吃到剛好就是照計畫減重，存越多赤字越大。
 * 沒有記錄的日子不算（不算預算、也不算省下來），免得忘了記的日子變成「存了一整天」；
 * 今天一定算（今日剩餘）；整天都在斷食記錄裡的日子算「有記錄、吃 0 點」。 */
import { BUDGET } from './config.js';
import { localDate, addDays, roundTo } from './points.js';

/** Health Connect 的每日運動消耗＋手動記的運動 */
export const allActivity = S => [...(S.activity || []), ...(S.exercise || [])];

export const WEEK_MODES = [['roll', '最近 7 天（滾動）'], ['sun', '每週日開始'], ['mon', '每週一開始']];

const dow = d => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).getDay(); };

/** 存摺的第一天：滾動＝今天往前 6 天；週日／週一＝這週的第一天 */
export function windowStart(today, mode = 'roll') {
  if (mode === 'sun') return addDays(today, -dow(today));
  if (mode === 'mon') return addDays(today, -((dow(today) + 6) % 7));
  return addDays(today, -(BUDGET.rollingDays - 1));
}

/** 每天吃了幾點、運動加回幾點（activity 可以混 Health Connect 的每日消耗與手動記的運動，都用 date＋kcal） */
function perDay(meals, activity, fasts, now) {
  const eat = {}, ref = {}, kcal = {}, prot = {}, cnt = {};
  for (const f of fasts || []) {                                       // 整天都在斷食：那天算有記錄
    if (!f || !f.start) continue;
    const s = new Date(f.start).getTime(), e = f.end ? new Date(f.end).getTime() : now;
    let d = addDays(localDate(new Date(s)), 1);
    for (let i = 0; i < 60; i++, d = addDays(d, 1)) {
      const [y, m, dd] = d.split('-').map(Number);
      if (new Date(y, m - 1, dd + 1).getTime() > e) break;
      cnt[d] = cnt[d] || 0.5;
    }
  }
  for (const m of meals || []) { if (m.pending) continue; const d = localDate(m.at); eat[d] = (eat[d] || 0) + (+m.points || 0); kcal[d] = (kcal[d] || 0) + (+m.kcal || 0); prot[d] = (prot[d] || 0) + (+m.protein || 0); cnt[d] = (cnt[d] || 0) + 1; }
  for (const a of activity || []) ref[a.date] = (ref[a.date] || 0) + (+a.kcal || 0) * BUDGET.exerciseRefund / BUDGET.kcalPerPoint;
  return { eat, ref, kcal, prot, cnt };
}

/**
 * @param daily 每日點數（plan().dailyPoints）
 * @returns {{from, days:[{date,budget,eaten,refund,left,logged}], today:{...}, balance, total}}
 *   balance＝存摺餘額（從第一天到今天，每天剩下的加總）；total＝這段期間的總點數
 */
export function ledger(meals, activity, daily, today, mode = 'roll', from = null, fasts = null, now = Date.now()) {
  const start = from || windowStart(today, mode), x = perDay(meals, activity, fasts, now), days = [], realToday = localDate(new Date(now));
  for (let d = start; d <= today; d = addDays(d, 1)) {
    const logged = !!x.cnt[d], counted = logged || d === realToday;    // 沒記錄的日子不算；今天一定算
    const refund = counted ? x.ref[d] || 0 : 0, eaten = x.eat[d] || 0, budget = counted ? daily + refund : 0;
    days.push({ date: d, budget, eaten, refund, left: budget - eaten, logged, counted, kcal: x.kcal[d] || 0, protein: x.prot[d] || 0 });
  }
  const sum = k => days.reduce((a, y) => a + y[k], 0);
  return { from: start, days, today: days[days.length - 1], balance: roundTo(sum('left')), total: roundTo(sum('budget')), refund: roundTo(sum('refund')) };
}

/**
 * 週報：這段期間與上一段期間比較
 * 「達標」＝有記錄、而且當天剩餘 ≥ 0；今天還沒結束不算進達標與記錄天數
 */
export function weekReport(S, daily, today, mode = 'roll') {
  const start = windowStart(today, mode), prevStart = addDays(start, -7), prevEnd = addDays(start, -1);
  const act = allActivity(S);
  const cur = ledger(S.meals, act, daily, today, mode, start, S.fasts);
  const prev = ledger(S.meals, act, daily, prevEnd, mode, prevStart, S.fasts);
  const done = l => l.days.filter(d => d.date < today);
  const stat = l => { const ds = done(l); return { logged: ds.filter(d => d.logged).length, healthy: ds.filter(d => d.logged && d.left >= 0).length, refund: roundTo(l.days.reduce((a, d) => a + d.refund, 0)), days: ds.length }; };
  const wAvg = (a, b) => { const v = (S.entries || []).filter(e => e.wt > 0 && e.date >= a && e.date <= b).map(e => e.wt); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
  const wNow = wAvg(start, today), wPrev = wAvg(prevStart, prevEnd);
  return { from: start, to: today, cur: { ...stat(cur), balance: cur.balance }, prev: stat(prev), days: cur.days, weight: wNow, weightPrev: wPrev, weightChange: wNow != null && wPrev != null ? wNow - wPrev : null };
}

/**
 * 圖表用：from～to 每天的存摺（每天剩多少＋當天的存摺餘額，餘額算法跟今日頁一樣，照 mode 分期）
 * 沒記錄的日子照今日頁的算法不算（logged＝false，圖上不畫長條，也不加進存摺）
 * @returns {[{date,budget,eaten,refund,left,logged,balance}]}
 */
export function ledgerSeries(meals, activity, daily, from, to, mode = 'roll', fasts = null) {
  const out = [];
  if (!from || from > to) return out;
  let first = windowStart(from, mode);
  const all = ledger(meals, activity, daily, to, mode, first, fasts).days, by = {};
  for (const d of all) by[d.date] = d;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const ws = windowStart(d, mode);
    let bal = 0; for (let x = ws; x <= d; x = addDays(x, 1)) bal += by[x].left;
    out.push({ ...by[d], balance: roundTo(bal) });
  }
  return out;
}

/** 圖表用：每天運動消耗，分成 Health Connect（hc）和手動記錄（manual），refund＝加回幾點 */
export function activityByDay(hcActivity, exercise) {
  const o = {};
  const add = (list, k) => { for (const a of list || []) { if (!a || !a.date) continue; const x = o[a.date] || (o[a.date] = { hc: 0, manual: 0, refund: 0 }); x[k] += +a.kcal || 0; x.refund += (+a.kcal || 0) * BUDGET.exerciseRefund / BUDGET.kcalPerPoint; } };
  add(hcActivity, 'hc'); add(exercise, 'manual');
  for (const d in o) o[d].refund = roundTo(o[d].refund);
  return o;
}
