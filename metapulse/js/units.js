/* 份量單位：份（serving）、克（g）、拳頭（fist）。營養素一律以「一份」為基準。 */
import { pointsOf, scale, roundTo } from './points.js';

export const UNIT_LABEL = { serving: '份', g: 'g', fist: '拳頭' };

export const fistOk = food => +food.fistsPerServing > 0;

export function unitsFor(food) {
  const u = ['serving'];
  if (+food.servingGrams > 0) u.push('g');
  if (fistOk(food)) u.push('fist');
  return u;
}

/** 輸入的數量 → 份數倍率 */
export function servingsOf(unit, qty, food) {
  qty = +qty || 0;
  if (unit === 'g') return +food.servingGrams > 0 ? qty / food.servingGrams : 0;
  if (unit === 'fist') return fistOk(food) ? qty / food.fistsPerServing : 0;
  return qty;
}

/** 份數 → 某單位的數量 */
export function qtyIn(unit, servings, food) {
  if (unit === 'g') return servings * (+food.servingGrams || 0);
  if (unit === 'fist') return servings * (+food.fistsPerServing || 0);
  return servings;
}

/** 切換單位時換算數量，實際份量不變 */
export function convertQty(qty, from, to, food) {
  if (from === to) return qty;
  return tidy(qtyIn(to, servingsOf(from, qty, food), food), to);
}

/** 顯示用的整齊數字：克取整數，其他到 0.1 */
export function tidy(x, unit) {
  if (!Number.isFinite(x)) return 0;
  return unit === 'g' ? Math.round(x) : Math.round(x * 10) / 10;
}

export function fmtQty(x, unit) {
  const v = tidy(x, unit);
  return unit === 'g' ? v + ' g' : v + ' ' + UNIT_LABEL[unit];
}

/** 「1 份 ≈ 180 g ≈ 1 個拳頭」 */
export function describe(food) {
  const parts = ['1 份'];
  if (+food.servingGrams > 0) parts.push(Math.round(food.servingGrams) + ' g');
  if (fistOk(food)) parts.push(tidy(food.fistsPerServing, 'fist') + ' 個拳頭');
  return parts.join(' ≈ ');
}

/**
 * 依品項（一份營養素 + 單位 + 數量 + 滑桿倍率）算出最終合計
 * item: {per, unit, qty, slider, servingGrams, fistsPerServing}
 */
export function itemTotals(item) {
  const servings = servingsOf(item.unit, item.qty, item) * (+item.slider || 1);
  const n = scale(item.per, servings);
  return { servings, ...n, points: pointsOf(n), finalQty: qtyIn(item.unit, servings, item) };
}

export { roundTo };
