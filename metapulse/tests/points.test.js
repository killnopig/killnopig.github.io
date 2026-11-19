import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsOf, roundTo, bmrMifflin, budget, usage, addDays, localDate } from '../js/points.js';

test('點數公式與四捨五入到 0.5', () => {
  // 蛋白質 25g → 2；碳水 40g → 4；脂肪 10g → 2.571；纖維 5g → −1  ⇒ 7.571 → 7.5
  assert.equal(pointsOf({ protein: 25, carb: 40, fat: 10, fiber: 5 }), 7.5);
  assert.equal(pointsOf({ protein: 0, carb: 0, fat: 0, fiber: 20 }), 0, '不小於 0');
  assert.equal(pointsOf({}), 0);
  assert.equal(roundTo(1.24), 1);
  assert.equal(roundTo(1.25), 1.5);
});

test('Mifflin-St Jeor', () => {
  assert.equal(bmrMifflin({ weight: 80, height: 175, age: 40, sex: 'M' }), 1699);
  assert.equal(bmrMifflin({ weight: 60, height: 160, age: 30, sex: 'F' }), 1289);
  assert.equal(bmrMifflin({ weight: 0, height: 160, age: 30 }), 0);
});

const now = new Date(2026, 10, 17);

test('週點數池：依週數推算', () => {
  const b = budget({ weight: 80, height: 175, birthYear: 1986, sex: 'M', targetWeight: 76, targetWeeks: 10, activity: 1.2 }, now);
  assert.equal(b.bmr, 1699);
  assert.equal(b.tdee, 2039);
  assert.ok(Math.abs(b.weeklyLossKg - 0.4) < 1e-9);
  assert.equal(b.capped, false);
  assert.equal(b.deficitKcal, 3080);
  assert.equal(b.poolPoints, roundTo((2039 * 7 - 3080) / 40));
  assert.equal(b.floorPoints, roundTo(1699 / 40));
  assert.equal(b.proteinTarget, 87);   // 80 kg、175 cm：調整體重 72.4 kg × 1.2
});

test('每週減重上限 1%', () => {
  const b = budget({ weight: 100, height: 175, birthYear: 1986, targetWeight: 80, targetWeeks: 5 }, now);
  assert.equal(b.capped, true);
  assert.equal(b.weeklyLossKg, 1);
});

test('沒填週數時用自訂或預設百分比', () => {
  const d = budget({ weight: 100, height: 175, birthYear: 1986, targetWeight: 80 }, now);
  assert.equal(d.weeklyLossKg, 0.5);
  const c = budget({ weight: 100, height: 175, birthYear: 1986, targetWeight: 80, weeklyLossPct: 0.8 }, now);
  assert.ok(Math.abs(c.weeklyLossKg - 0.8) < 1e-9);
  const over = budget({ weight: 100, height: 175, birthYear: 1986, targetWeight: 80, weeklyLossPct: 3 }, now);
  assert.equal(over.capped, true);
});

test('已達目標時沒有赤字；手動 BMR 與保底優先', () => {
  const b = budget({ weight: 70, targetWeight: 72, bmrManual: 1500, floorPoints: 30, activity: 1.375 }, now);
  assert.equal(b.deficitKcal, 0);
  assert.equal(b.bmrSource, 'manual');
  assert.equal(b.floorPoints, 30);
});

test('7 天滾動只算今天往前 6 天加今天', () => {
  const t = '2026-11-17';
  const at = (d, h = 12) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, h).toISOString(); };
  const meals = [
    { at: at('2026-11-10'), points: 100 }, // 第 8 天前，不算
    { at: at('2026-11-11'), points: 10 },
    { at: at('2026-11-17', 8), points: 5, protein: 20, kcal: 200 },
    { at: at('2026-11-17', 23), points: 3, protein: 10, kcal: 120 },
  ];
  const u = usage(meals, t);
  assert.equal(u.from, '2026-11-11');
  assert.equal(u.rolling, 18);
  assert.equal(u.today.points, 8);
  assert.equal(u.today.protein, 30);
  assert.equal(u.today.count, 2);
});

test('日期工具', () => {
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('只超過上限一點點時不提示，但仍以 1% 計算', () => {
  const b = budget({ weight: 105.3, height: 175, birthYear: 1980, targetWeight: 80, targetWeeks: 24 }, now);
  assert.equal(b.capped, false);
  assert.ok(Math.abs(b.weeklyLossKg - 1.053) < 1e-9);
});
