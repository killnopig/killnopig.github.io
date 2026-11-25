/* 推薦這週吃什麼：整理給 AI 的資料，以及沒有 AI 時用常吃組合排 7 天（純函數） */
import { frequentMeals } from './foods.js';
import { localDate, addDays } from './points.js';

/** 推薦時可以勾的選項（key、按鈕文字、給 AI 的說明） */
export const RECIPE_OPTS = [
  ['often', '常吃的', '多用使用者常吃的組合，可以稍微調整份量'],
  ['new', '沒吃過的', '加入使用者沒吃過的食物（避開「吃過的食物」清單），每天至少一餐'],
  ['protein', '補蛋白質', '每一餐蛋白質盡量 20～30 g，讓每天接近蛋白質目標'],
  ['out', '外食／超商', '可以有台灣外食或便利商店買得到的組合'],
  ['cook', '自己煮', '可以有自己在家簡單煮的菜，how 欄寫 1～2 句做法'],
];
export const DAYS = 7;
const half = x => Math.round(x * 2) / 2;

/** 一天平均吃幾餐：看最近 14 天有記錄的日子，四捨五入，限制 1～3，沒資料就 2 */
export function mealsPerDay(meals, todayStr, days = 14) {
  const from = addDays(todayStr, -days), per = new Map();
  for (const m of meals || []) {
    if (m.pending) continue;
    const d = localDate(m.at);
    if (d < from || d >= todayStr) continue;
    if (!per.has(d)) per.set(d, new Set());
    per.get(d).add(m.group || m.id);
  }
  if (!per.size) return 2;
  const avg = [...per.values()].reduce((a, s) => a + s.size, 0) / per.size;
  return Math.max(1, Math.min(3, Math.round(avg)));
}

/** 給 AI 的資料：只放食物名稱、點數和目標，不放日期與身體數據 */
export function recipeContext(st, b, opts, todayStr, now = Date.now()) {
  const n = mealsPerDay(st.meals, todayStr);
  const often = frequentMeals(st.meals, now, 12).map(s => ({ 組合: s.label, 點數: half(s.points), 次數: s.count }));
  const ctx = {
    天數: DAYS, 每天餐數: n,
    每日點數: b.dailyPoints, 每日蛋白質目標g: Math.round(b.proteinTarget),
    每餐大約點數: half(b.dailyPoints / n),
    選項: RECIPE_OPTS.filter(o => opts.includes(o[0])).map(o => o[1] + '：' + o[2]),
    常吃組合: often,
  };
  if (opts.includes('new')) ctx.吃過的食物 = [...new Set((st.foodLibrary || []).map(f => String(f.name || '').trim()).filter(Boolean))].slice(0, 300);
  return ctx;
}

/** 沒有 AI 時：把常吃組合輪流排進 7 天，點數接近每餐份量的優先。沒有常吃組合就回傳 null */
export function fallbackPlan(st, b, todayStr, now = Date.now()) {
  const n = mealsPerDay(st.meals, todayStr);
  const target = b.dailyPoints / n;
  const sets = frequentMeals(st.meals, now, 12)
    .map(s => ({ name: s.label, points: half(s.points), protein: Math.round(s.items.reduce((a, m) => a + (+m.protein || 0), 0)) }))
    .sort((a, c) => Math.abs(a.points - target) - Math.abs(c.points - target));
  if (!sets.length) return null;
  const pool = sets.slice(0, Math.max(3, Math.min(sets.length, n * 3)));
  const days = [];
  for (let d = 0; d < DAYS; d++) {
    const meals = [];
    for (let k = 0; k < n; k++) meals.push({ ...pool[(d * n + k) % pool.length], how: '', tag: '常吃' });
    days.push({ date: addDays(todayStr, d), meals });
  }
  return { days, note: '', local: true };
}

/** 整理 AI 回覆：補日期、數字防呆，最多 7 天 */
export function cleanPlan(p, todayStr) {
  const days = (Array.isArray(p?.days) ? p.days : []).slice(0, DAYS).map((d, i) => ({
    date: addDays(todayStr, i),
    meals: (Array.isArray(d?.meals) ? d.meals : []).slice(0, 4).map(m => ({
      name: String(m?.name || '').trim() || '未命名',
      points: half(Math.max(0, +m?.points || 0)),
      protein: Math.max(0, Math.round(+m?.protein || 0)),
      how: String(m?.how || '').trim(),
      tag: String(m?.tag || '').trim(),
    })),
  }));
  return { days, note: String(p?.note || '').trim() };
}
