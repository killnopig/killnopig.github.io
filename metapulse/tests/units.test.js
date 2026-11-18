import { test } from 'node:test';
import assert from 'node:assert/strict';
import { servingsOf, convertQty, unitsFor, describe, itemTotals } from '../js/units.js';
import { searchFoods, findByName } from '../js/foods.js';

const noodle = { servingGrams: 180, fistsPerServing: 1, per: { kcal: 300, protein: 20, carb: 40, fat: 8, fiber: 2 } };
const egg = { servingGrams: 50, fistsPerServing: null, per: { kcal: 70, protein: 6, carb: 0.5, fat: 5, fiber: 0 } };

test('單位換算', () => {
  assert.equal(servingsOf('g', 360, noodle), 2);
  assert.equal(servingsOf('fist', 1.5, noodle), 1.5);
  assert.equal(convertQty(1.2, 'serving', 'g', noodle), 216);
  assert.equal(convertQty(216, 'g', 'serving', noodle), 1.2);
  assert.equal(servingsOf('fist', 1, egg), 0);
});

test('不適用拳頭時隱藏', () => {
  assert.deepEqual(unitsFor(egg), ['serving', 'g']);
  assert.deepEqual(unitsFor(noodle), ['serving', 'g', 'fist']);
  assert.equal(describe(noodle), '1 份 ≈ 180 g ≈ 1 個拳頭');
  assert.equal(describe(egg), '1 份 ≈ 50 g');
});

test('滑桿倍率疊在基準份量上', () => {
  const t = itemTotals({ ...noodle, unit: 'g', qty: 180, slider: 1.2 });
  assert.ok(Math.abs(t.servings - 1.2) < 1e-9);
  assert.ok(Math.abs(t.finalQty - 216) < 1e-9);
  assert.ok(Math.abs(t.kcal - 360) < 1e-9);
  // 24g 蛋白 1.92 + 48g 碳水 4.8 + 9.6g 脂肪 2.469 − 2.4g 纖維 0.48 = 8.709 → 8.5
  assert.equal(t.points, 8.5);
});

test('食物庫搜尋排序', () => {
  const now = Date.UTC(2026, 10, 17);
  const lib = [
    { name: '牛肉麵', uses: 2, lastUsed: now - 30 * 864e5 },
    { name: '滷蛋', uses: 1, lastUsed: now - 864e5 },
    { name: '紅燒牛肉', uses: 10, lastUsed: now - 60 * 864e5 },
  ];
  assert.deepEqual(searchFoods(lib, '', now).map(f => f.name), ['滷蛋', '紅燒牛肉', '牛肉麵']);
  assert.deepEqual(searchFoods(lib, '牛肉', now).map(f => f.name), ['牛肉麵', '紅燒牛肉']);
  assert.equal(findByName(lib, ' 滷 蛋 ').name, '滷蛋');
});
