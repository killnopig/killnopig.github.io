/* 點數、BMR／TDEE、週點數池（純函數，不碰畫面與儲存） */
import { POINTS, BUDGET, SAFETY } from './config.js';

export const NUTRIENTS = ['kcal', 'protein', 'carb', 'fat', 'fiber'];

export function roundTo(x, step = POINTS.roundTo) {
  if (!Number.isFinite(x)) return 0;
  return Math.round(x / step) * step;
}

/** 一組營養素（g）→ 點數，不小於 0，四捨五入到 0.5 */
export function pointsOf(n) {
  const p = (+n.protein || 0) * POINTS.proteinKcalPerG / POINTS.proteinKcalPerPoint
    + (+n.carb || 0) * POINTS.carbKcalPerG / POINTS.carbKcalPerPoint
    + (+n.fat || 0) * POINTS.fatKcalPerG / POINTS.fatKcalPerPoint
    - (+n.fiber || 0) / POINTS.fiberGPerPoint;
  return Math.max(0, roundTo(p));
}

/** 一份的營養素 × 倍率 */
export function scale(per, factor) {
  const o = {};
  for (const k of NUTRIENTS) o[k] = (+per?.[k] || 0) * factor;
  return o;
}

export function sumNutrients(list) {
  const o = { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0 };
  for (const n of list) for (const k of NUTRIENTS) o[k] += +n[k] || 0;
  return o;
}

/** Mifflin-St Jeor：男 +5，女 −161 */
export function bmrMifflin({ weight, height, age, sex }) {
  if (!(weight > 0 && height > 0 && age > 0)) return 0;
  const base = 10 * weight + 6.25 * height - 5 * age;
  return Math.round(base + (sex === 'F' ? -161 : 5));
}

export function ageFrom(birthYear, now = new Date()) {
  return birthYear > 1900 ? now.getFullYear() - birthYear : 0;
}

/**
 * 依個人資料算出每日與每週預算。
 * @param {object} p profile；weight 為目前體重（由呼叫端決定來自記錄或 profile）
 * @returns {{bmr, bmrSource, tdee, weeklyLossKg, weeklyLossPct, capped, deficitKcal, poolPoints, floorPoints, proteinTarget, ok}}
 */
export function budget(p, now = new Date()) {
  const weight = +p.weight || 0;
  const age = ageFrom(+p.birthYear, now);
  let bmr = +p.bmrManual || 0, bmrSource = 'manual';
  if (!bmr) { bmr = bmrMifflin({ weight, height: +p.height, age, sex: p.sex }); bmrSource = 'estimate'; }
  if (!bmr) return { ok: false };
  const activity = +p.activity || BUDGET.activityDefault;
  const tdeeFormula = Math.round(bmr * activity);
  const tdee = +p.tdeeOverride > 0 ? Math.round(+p.tdeeOverride) : tdeeFormula;   // 「依我的記錄」：用 adaptive.js 反推的消耗

  const toLose = Math.max(0, weight - (+p.targetWeight || weight));
  let weeklyLossKg, wantedPct;
  if (toLose > 0 && +p.targetWeeks > 0) {
    weeklyLossKg = toLose / +p.targetWeeks;
    wantedPct = weeklyLossKg / weight * 100;
  } else if (toLose > 0) {
    wantedPct = +p.weeklyLossPct > 0 ? +p.weeklyLossPct : BUDGET.defaultWeeklyLossPct;
    weeklyLossKg = weight * wantedPct / 100;
  } else { weeklyLossKg = 0; wantedPct = 0; }
  let capped = false;
  const maxKg = weight * BUDGET.maxWeeklyLossPct / 100;
  if (weeklyLossKg > maxKg) { capped = weeklyLossKg - maxKg > 0.02; weeklyLossKg = maxKg; } // 差 20 g 以內不提示
  weeklyLossKg = Math.min(weeklyLossKg, toLose); // 不要超過剩下要減的量
  const deficitKcal = Math.round(weeklyLossKg * BUDGET.kcalPerKgFat);
  const poolPoints = Math.max(0, roundTo((tdee * 7 - deficitKcal) / BUDGET.kcalPerPoint));
  const floorPoints = +p.floorPoints > 0 ? +p.floorPoints : roundTo(bmr / BUDGET.kcalPerPoint);
  const proteinTarget = proteinGoal(weight, +p.height, +p.proteinPerKg || BUDGET.proteinPerKgDefault).target;
  return {
    ok: true, bmr, bmrSource, tdee, tdeeFormula, tdeeSource: +p.tdeeOverride > 0 ? 'adaptive' : 'formula', weeklyLossKg, weeklyLossPct: weight ? weeklyLossKg / weight * 100 : 0,
    wantedPct, capped, deficitKcal, poolPoints, floorPoints, proteinTarget,
    dailyPoints: roundTo(poolPoints / 7),
  };
}

/**
 * 每天蛋白質目標：體重超過理想體重（BMI 22）時，用「調整體重」＝理想 + 0.4 ×（實際 − 理想）來乘，
 * 不然體重很重的人會算出很誇張的量（脂肪組織本身不太需要蛋白質）。沒有身高就用實際體重。
 */
export function proteinGoal(weight, heightCm, perKg = BUDGET.proteinPerKgDefault, cfg = SAFETY) {
  const w = +weight || 0, m = (+heightCm || 0) / 100;
  const ibw = m > 0 ? cfg.ibwBmi * m * m : 0;
  const adjusted = ibw > 0 && w > ibw;
  const basis = adjusted ? ibw + cfg.abwFactor * (w - ibw) : w;
  return { target: Math.round(basis * perKg), basis: Math.round(basis * 10) / 10, ibw: Math.round(ibw * 10) / 10, adjusted, perKg };
}

/** 本機日期字串 YYYY-MM-DD */
export function localDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const p = n => String(n).padStart(2, '0');
  return x.getFullYear() + '-' + p(x.getMonth() + 1) + '-' + p(x.getDate());
}

/** 某天往前推 n 天的日期字串 */
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return localDate(new Date(y, m - 1, d + n));
}

/**
 * 7 天滾動（今天往前 6 天加今天）與今日統計
 * @param meals [{at, points, kcal, protein, ...}] 已算好合計的餐點
 */
export function usage(meals, todayStr, days = BUDGET.rollingDays) {
  const from = addDays(todayStr, -(days - 1));
  let rolling = 0;
  const today = { points: 0, kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0, count: 0 };
  for (const m of meals) {
    const d = localDate(m.at);
    if (d < from || d > todayStr) continue;
    rolling += +m.points || 0;
    if (d === todayStr) {
      today.count++;
      today.points += +m.points || 0;
      for (const k of ['kcal', 'protein', 'carb', 'fat', 'fiber']) today[k] += +m[k] || 0;
    }
  }
  return { rolling, today, from };
}

/** 運動回補點數：近 7 天與今天（activity: [{date, kcal}]） */
export function exerciseRefund(activity, todayStr, coef = BUDGET.exerciseRefund, days = BUDGET.rollingDays) {
  const from = addDays(todayStr, -(days - 1));
  let rolling = 0, today = 0, todayKcal = 0;
  for (const a of activity || []) {
    if (a.date < from || a.date > todayStr) continue;
    const p = (+a.kcal || 0) * coef / BUDGET.kcalPerPoint;
    rolling += p;
    if (a.date === todayStr) { today += p; todayKcal += +a.kcal || 0; }
  }
  return { rolling: roundTo(rolling), today: roundTo(today), todayKcal };
}
