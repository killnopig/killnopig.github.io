import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weightTrendLine, trendAt, weeklyTrend, adaptiveTdee } from '../js/adaptive.js';
import { addDays, budget } from '../js/points.js';

// 假資料：每天中午吃 kcal 大卡
const meal = (d, kcal) => ({ id: 'm' + d, at: new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), 12).toISOString(), kcal, points: kcal / 40 });
const today = '2026-12-31';

test('趨勢體重：體重平穩時沒量的日子不動；一天多 1 kg 只動 0.1 kg', () => {
  const es = [{ date: '2026-12-01', wt: 80 }, { date: '2026-12-02', wt: 80 }, { date: '2026-12-05', wt: 81 }];
  const line = weightTrendLine(es, '2026-12-06');
  assert.equal(line.length, 6);
  assert.equal(trendAt(line, '2026-12-04'), 80);
  assert.ok(Math.abs(trendAt(line, '2026-12-05') - 80.1) < 1e-9);
  assert.equal(trendAt(line, '2026-11-30'), null);
});

test('趨勢體重：穩定變瘦時不會落後在點的上方', () => {
  const es = [];
  for (let i = 0; i < 60; i += 2) es.push({ date: addDays(today, -59 + i), wt: 90 - i * 0.1 });
  const line = weightTrendLine(es), last = line[line.length - 1];
  assert.ok(Math.abs(last.trend - last.wt) < 0.3, String(last.trend - last.wt));   // 只用平均的話會落後約 0.9 kg
});

test('趨勢體重每週變化：穩定每天 -0.1 kg ≈ 每週 0.7 kg', () => {
  const es = [];
  for (let i = 0; i < 60; i++) es.push({ date: addDays(today, -59 + i), wt: 90 - i * 0.1 });
  const w = weeklyTrend(es, today);
  assert.ok(w.kg > 0.65 && w.kg < 0.75, String(w.kg));
  assert.equal(weeklyTrend([], today), null);
});

test('反推消耗：吃 2000、每週掉 0.5 kg → 約 2550 大卡', () => {
  const meals = [], entries = [];
  for (let i = 1; i <= 28; i++) {
    const d = addDays(today, -i);
    meals.push(meal(d, 2000));
    if (i % 2) entries.push({ date: d, wt: 80 - (28 - i) * 0.5 / 7 });
  }
  const r = adaptiveTdee({ meals, entries, fasts: [], activity: [], exercise: [] }, 1700, 2400, today);
  assert.equal(r.ready, true);
  assert.ok(Math.abs(r.raw - 2550) < 10, String(r.raw));
  assert.equal(r.tdee, r.raw);
  assert.equal(r.clamped, false);
});

test('反推消耗：資料不夠時說還差什麼；結果限制在公式 ±25%', () => {
  const few = adaptiveTdee({ meals: [meal(addDays(today, -1), 2000)], entries: [], fasts: [] }, 1700, 2400, today);
  assert.equal(few.ready, false);
  assert.equal(few.need.length, 2);
  // 只記一點點（漏記）：反推會很低 → 被限制在 2400 × 0.75
  const meals = [], entries = [];
  for (let i = 1; i <= 28; i++) { const d = addDays(today, -i); meals.push(meal(d, 600)); if (i % 2) entries.push({ date: d, wt: 80 }); }
  const r = adaptiveTdee({ meals, entries, fasts: [] }, 1700, 2400, today);
  assert.equal(r.ready, true);
  assert.equal(r.tdee, 1800);
  assert.equal(r.clamped, true);
});

test('預算可以改用反推的消耗', () => {
  const p = { height: 175, sex: 'M', birthYear: 1985, weight: 80, targetWeight: 70, activity: 1.2 };
  const a = budget(p, new Date(2026, 11, 31)), b = budget({ ...p, tdeeOverride: 2600 }, new Date(2026, 11, 31));
  assert.equal(a.tdeeSource, 'formula');
  assert.equal(b.tdee, 2600);
  assert.equal(b.tdeeFormula, a.tdee);
  assert.equal(b.tdeeSource, 'adaptive');
  assert.ok(b.poolPoints > a.poolPoints);
});
