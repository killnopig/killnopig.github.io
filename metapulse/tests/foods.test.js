import test from 'node:test';
import assert from 'node:assert/strict';
import { frequentMeals } from '../js/foods.js';

const D = 864e5, now = Date.parse('2026-11-18T12:00:00Z');
const meal = (g, daysAgo, name, qty = 1, points = 3) => ({ group: g, at: new Date(now - daysAgo * D).toISOString(), name, qty, unit: 'serving', points });

test('常吃：同樣內容的餐合在一起，次數多的排前面，附最近一次的品項', () => {
  const ms = [
    meal('a', 1, '蛋餅'), meal('a', 1, '豆漿', 1, 2),
    meal('b', 3, '豆漿', 1, 2), meal('b', 3, '蛋餅'),
    meal('c', 5, '蛋餅'), meal('c', 5, '豆漿', 1, 2),
    meal('d', 2, '牛肉麵', 1, 9),
    meal('e', 90, '舊的', 1, 1),                 // 超過 60 天不算
    meal('f', 4, '蛋餅', 2), meal('f', 4, '豆漿', 1, 2), // 份量不同 → 另一組
  ];
  const r = frequentMeals(ms, now);
  assert.equal(r[0].count, 3);
  assert.equal(r[0].points, 5);
  assert.equal(r[0].items[0].group, 'a');
  assert.ok(r[0].label.includes('蛋餅') && r[0].label.includes('豆漿'));
  assert.equal(r.length, 3);
  assert.ok(!r.some(x => x.label === '舊的'));
});
