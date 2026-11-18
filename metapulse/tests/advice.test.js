import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adviceContext, fallbackAdvice, CHEERS } from '../js/advice.js';

const meals = [{ name: '雞腿便當', kcal: 750, protein: 35, carb: 90, fat: 25, fiber: 5, points: 23 }];
const b = { ok: true, dailyPoints: 41, floorPoints: 44.5, proteinTarget: 106, poolPoints: 288 };
const u = { rolling: 60, today: { count: 1, points: 23, kcal: 750, protein: 35 } };

test('整理給 AI 的資料', () => {
  const c = adviceContext(meals, b, u, new Date(2026, 10, 17, 12, 5));
  assert.equal(c.時間, '12:05');
  assert.equal(c.這一餐合計.點數, 23);
  assert.equal(c.目標.今天蛋白質還差g, 71);
  assert.equal(c.目標.近7天剩餘, 228);
});

test('本機備用回饋：蛋白質缺口、晚上吃太少提醒、隨機鼓勵', () => {
  const c = adviceContext(meals, b, u, new Date(2026, 10, 17, 19, 0));
  const a = fallbackAdvice(c, () => 0);
  assert.match(a.review, /23 點/);
  assert.match(a.next, /還差約 71 g/);
  assert.match(a.next, /別讓自己太餓/);
  assert.equal(a.cheer, CHEERS[0]);
  assert.doesNotMatch(a.review + a.next, /必須|應該|現在該/);
});

test('沒有個人資料時也能產生', () => {
  const a = fallbackAdvice(adviceContext(meals, { ok: false }, u));
  assert.ok(a.review && a.cheer);
  assert.equal(a.next, '');
});
