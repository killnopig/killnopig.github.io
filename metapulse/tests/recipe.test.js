import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mealsPerDay, recipeContext, fallbackPlan, cleanPlan, cleanDetail, priceSearchUrl } from '../js/recipe.js';

const today = '2026-11-20';
const now = new Date(2026, 10, 20, 12).getTime();
const at = (d, h) => new Date(2026, 10, d, h).toISOString();
// 假資料：11/17～11/19 每天兩餐（茶葉蛋＋豆漿、雞胸便當），11/18 多一餐
const meals = [];
for (const d of [17, 18, 19]) {
  meals.push({ id: 'a' + d, group: 'g1-' + d, at: at(d, 8), name: '茶葉蛋', qty: 2, unit: '顆', points: 4, protein: 14 });
  meals.push({ id: 'b' + d, group: 'g1-' + d, at: at(d, 8), name: '無糖豆漿', qty: 1, unit: '杯', points: 3, protein: 9 });
  meals.push({ id: 'c' + d, group: 'g2-' + d, at: at(d, 18), name: '雞胸便當', qty: 1, unit: '份', points: 18, protein: 35 });
}
meals.push({ id: 'x', group: 'g3', at: at(18, 21), name: '香蕉', qty: 1, unit: '根', points: 3, protein: 1 });
meals.push({ id: 'p', group: 'gp', at: at(19, 22), name: '還沒吃的', qty: 1, unit: '份', points: 9, protein: 1, pending: true });
const st = { meals, foodLibrary: [{ name: '茶葉蛋' }, { name: '無糖豆漿' }, { name: '雞胸便當' }, { name: '茶葉蛋' }] };
const b = { ok: true, dailyPoints: 40, proteinTarget: 100.4 };

test('一天平均幾餐：不算還沒吃的、限制 1～3、沒資料是 2', () => {
  assert.equal(mealsPerDay(meals, today), 2);   // (2+3+2)/3 ≈ 2.3
  assert.equal(mealsPerDay([], today), 2);
  assert.equal(mealsPerDay(meals, '2026-12-30'), 2);  // 超過 14 天前的不算
});

test('給 AI 的資料：沒勾「沒吃過的」就不送食物清單', () => {
  const c = recipeContext(st, b, ['often', 'protein'], today, now);
  assert.equal(c.天數, 7);
  assert.equal(c.每天餐數, 2);
  assert.equal(c.每餐大約點數, 20);
  assert.equal(c.每日蛋白質目標g, 100);
  assert.equal(c.選項.length, 2);
  assert.equal(c.吃過的食物, undefined);
  assert.ok(c.常吃組合.some(x => x.組合.includes('雞胸便當')));
  const c2 = recipeContext(st, b, ['new'], today, now);
  assert.deepEqual(c2.吃過的食物, ['茶葉蛋', '無糖豆漿', '雞胸便當', '香蕉', '還沒吃的']);
  assert.equal(c2.常吃組合, undefined);   // 只勾「沒吃過的」就不給常吃組合
  assert.match(c2.新食物規定, /每一餐/);
  assert.match(recipeContext(st, b, ['new', 'often'], today, now).新食物規定, /至少一餐/);
});

test('沒有 AI：用常吃組合排滿 7 天', () => {
  const p = fallbackPlan(st, b, today, now);
  assert.equal(p.days.length, 7);
  assert.equal(p.days[0].date, today);
  assert.equal(p.days[6].date, '2026-11-26');
  assert.ok(p.days.every(d => d.meals.length === 2));
  assert.equal(p.local, true);
  assert.equal(fallbackPlan({ meals: [], foodLibrary: [] }, b, today, now), null);
});

test('整理 AI 回覆：補日期、數字防呆', () => {
  const p = cleanPlan({ days: [{ meals: [{ name: ' 鮭魚飯 ', points: 18.3, protein: '30.4', how: '煎鮭魚', tag: '自己煮' }, { points: -2 }] }], note: 'x' }, today);
  assert.equal(p.days.length, 1);
  assert.equal(p.days[0].date, today);
  assert.deepEqual(p.days[0].meals[0], { name: '鮭魚飯', points: 18.5, protein: 30, how: '煎鮭魚', tag: '自己煮' });
  assert.equal(p.days[0].meals[1].name, '未命名');
  assert.equal(p.days[0].meals[1].points, 0);
  assert.deepEqual(cleanPlan(null, today).days, []);
});

test('整理菜色說明、查價格網址', () => {
  const d = cleanDetail({ ingredients: ' 鮭魚、白飯 ', steps: ['煎魚', '', '盛飯', 1, 2, 3, 4, 5], where: ['超市', '傳統市場'] });
  assert.equal(d.ingredients, '鮭魚、白飯');
  assert.equal(d.steps.length, 6);
  assert.equal(d.steps[0], '煎魚');
  assert.deepEqual(d.where, ['超市', '傳統市場']);
  assert.deepEqual(cleanDetail(null), { ingredients: '', steps: [], where: [] });
  assert.equal(priceSearchUrl(' 鮭魚飯糰 '), 'https://www.google.com/search?q=' + encodeURIComponent('鮭魚飯糰 價格'));
});
