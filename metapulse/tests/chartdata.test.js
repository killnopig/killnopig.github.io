import test from 'node:test';
import assert from 'node:assert/strict';
import { ledgerSeries, activityByDay, ledger } from '../js/ledger.js';
import { eatingWindows, macroSplit, dailyFood } from '../js/summary.js';
import { medAdherence } from '../js/records.js';
import { BUDGET } from '../js/config.js';

const at = (d, h, m = 0) => { const [y, mo, dd] = d.split('-').map(Number); return new Date(y, mo - 1, dd, h, m).toISOString(); };

test('點數存摺圖：每天剩多少、餘額照分期歸零', () => {
  const meals = [{ at: at('2026-11-02', 12), points: 20, group: 'a' }, { at: at('2026-11-03', 12), points: 40, group: 'b' }];
  const s = ledgerSeries(meals, [], 30, '2026-11-02', '2026-11-03', 'mon');   // 11/2 是週一
  assert.deepEqual(s.map(x => x.left), [10, -10]);
  assert.deepEqual(s.map(x => x.balance), [10, 0]);
  assert.equal(s[0].logged, true);
  const r = ledgerSeries(meals, [], 30, '2026-11-03', '2026-11-03', 'roll');
  assert.equal(r[0].balance, ledger(meals, [], 30, '2026-11-03', 'roll').balance);   // 跟今日頁同一個數
  const sun = ledgerSeries([{ at: at('2026-11-06', 12), points: 4, group: 'c' }, { at: at('2026-11-08', 12), points: 4, group: 'd' }], [], 10, '2026-11-07', '2026-11-08', 'sun');   // 11/8 是週日：歸零重算
  assert.deepEqual(sun.map(x => x.balance), [6, 6], '11/7 沒記錄不算');
  assert.deepEqual(ledgerSeries([], [], 10, '2026-11-09', '2026-11-08'), []);
});

test('運動消耗：Health Connect 和手動分開', () => {
  const o = activityByDay([{ date: '2026-11-01', kcal: 300 }], [{ date: '2026-11-01', kcal: 100 }, { date: '2026-11-02', kcal: 200 }]);
  assert.equal(o['2026-11-01'].hc, 300);
  assert.equal(o['2026-11-01'].manual, 100);
  assert.equal(o['2026-11-02'].hc, 0);
  assert.ok(Math.abs(o['2026-11-01'].refund - 400 * BUDGET.exerciseRefund / BUDGET.kcalPerPoint) < 0.5);
});

test('進食時間窗：第一道到最後一道，同一餐只算一次', () => {
  const ms = [{ at: at('2026-11-01', 9), group: 'a' }, { at: at('2026-11-01', 9, 20), group: 'a' }, { at: at('2026-11-01', 18, 30), group: 'b' }, { at: at('2026-11-02', 1), group: 'c' }];
  const w = eatingWindows(ms);
  assert.equal(w['2026-11-01'].hours, 9.5);
  assert.equal(w['2026-11-01'].meals, 2);
  assert.equal(new Date(w['2026-11-01'].start).getHours(), 9);
  assert.equal(w['2026-11-02'].hours, 0);
});

test('三大營養素比例：加起來 100%，沒有資料的日子跳過', () => {
  const food = dailyFood([{ at: at('2026-11-01', 12), protein: 25, carb: 50, fat: 20 }, { at: at('2026-11-02', 12), kcal: 100 }]);
  const m = macroSplit(food)['2026-11-01'];
  assert.equal(m.p + m.c + m.f, 100);
  assert.equal(m.p, Math.round(100 / 480 * 100));
  assert.equal(m.f, Math.round(180 / 480 * 100));
  assert.equal(macroSplit(food)['2026-11-02'], undefined);
});

test('用藥準時率：每週該吃、吃了、準時；打針看間隔', () => {
  const meds = [{ id: 'a', name: '藥', time: '08:00', since: '2026-11-03' }];
  const log = [
    { med: 'a', date: '2026-11-03', at: at('2026-11-03', 8, 30) },  // 準時
    { med: 'a', date: '2026-11-04', at: at('2026-11-04', 10) },     // 晚 2 小時
    { med: 'a', date: '2026-11-10', at: at('2026-11-10', 7, 10) },  // 下一週、準時
  ];
  const ent = [{ date: '2026-10-27', dose: 1 }, { date: '2026-11-03', dose: 1 }, { date: '2026-11-12', dose: 1 }];
  const w = medAdherence(meds, log, ent, '2026-11-02', '2026-11-11');
  assert.equal(w.length, 2);
  assert.equal(w[0].start, '2026-11-02');
  assert.deepEqual([w[0].need, w[0].taken, w[0].onTime], [6, 2, 1]);   // 11/3～11/8
  assert.deepEqual(w[0].doses, [{ date: '2026-11-03', gap: 7, ok: true }]);
  assert.deepEqual([w[1].need, w[1].taken, w[1].onTime], [3, 1, 1]);
  const w2 = medAdherence([], [], ent, '2026-11-02', '2026-11-15');
  assert.deepEqual(w2[1].doses, [{ date: '2026-11-12', gap: 9, ok: false }]);
  assert.equal(medAdherence(meds, log, ent, '2026-11-02', '2026-11-08', 'sun')[0].start, '2026-11-01');
});
