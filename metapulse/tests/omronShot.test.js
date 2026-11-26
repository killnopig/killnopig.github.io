import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shotRecords, planShot, shotLine } from '../js/omronShot.js';

const today = '2026-11-26';

test('整理 AI 讀到的數字：範圍外當讀錯、血壓缺一個就不要、沒日期用今天', () => {
  const r = shotRecords({ readings: [
    { date: '2026/11/25', time: '7:05', sys: 128, dia: 82, pul: 71, wt: 0, fat: 0, mus: 0, vis: 0, bage: 0, bmr: 0 },
    { date: '', time: '', sys: 0, dia: 0, pul: 0, wt: 104.36, fat: 31.24, mus: 27.1, vis: 15, bage: 55, bmr: 1890 },
    { date: '2026-11-20', time: '', sys: 140, dia: 0, pul: 999, wt: 0, fat: 0, mus: 0, vis: 0, bage: 0, bmr: 0 },
    { date: '2027-01-01', time: '25:00', wt: 80 },
  ] }, today);
  assert.equal(r.length, 3);
  assert.deepEqual([r[0].date, r[0].time, r[0].sys, r[0].dia, r[0].pul], ['2026-11-25', '07:05', 128, 82, 71]);
  assert.deepEqual([r[1].date, r[1].wt, r[1].fat, r[1].vis], [today, 104.4, 31.2, 15]);
  assert.equal(r[2].date, today);   // 未來日期改成今天
  assert.equal(r[2].time, '');
  assert.equal(r[0].src, 'omron');
  assert.deepEqual(shotRecords(null, today), []);
});

test('只有體組成：補到同一天最後一筆體重；一樣的不補', () => {
  const entries = [
    { id: 'a', date: today, time: '06:50', wt: 104.4, fat: 31.2, mus: 0, vis: 0, bage: 0, bmr: 1890, sys: 0 },
    { id: 'b', date: today, time: '07:00', sys: 128, dia: 82, wt: 0 },
  ];
  const recs = shotRecords({ readings: [{ mus: 27.1, vis: 15, bage: 55, fat: 31.2 }] }, today);
  const p = planShot(recs, entries);
  assert.deepEqual(p.merge, [{ id: 'a', fill: { mus: 27.1, vis: 15, bage: 55 } }]);
  assert.equal(p.add.length, 0);
  // 已經補過：沒有要改的
  const p2 = planShot(recs, [{ ...entries[0], mus: 27.1, vis: 15, bage: 55 }]);
  assert.equal(p2.merge.length + p2.add.length, 0);
  assert.equal(p2.dup, 1);
});

test('體重＋體組成和既有體重一樣：補欄位；血壓重複的略過；新的新增', () => {
  const entries = [{ id: 'a', date: today, time: '06:50', wt: 104.4, fat: 31.2, sys: 0, dia: 0 }, { id: 'b', date: today, time: '07:00', sys: 128, dia: 82, pul: 71, wt: 0 }];
  const recs = shotRecords({ readings: [
    { date: today, time: '06:50', wt: 104.4, fat: 31.2, mus: 27.1 },
    { date: today, time: '07:00', sys: 128, dia: 82, pul: 71 },
    { date: today, time: '20:10', sys: 121, dia: 79, pul: 66 },
  ] }, today);
  const p = planShot(recs, entries);
  assert.deepEqual(p.merge, [{ id: 'a', fill: { mus: 27.1 } }]);
  assert.equal(p.add.length, 1);
  assert.equal(p.add[0].sys, 121);
  assert.equal(p.dup, 1);
});

test('顯示文字', () => {
  assert.equal(shotLine({ date: '2026-11-25', time: '07:05', sys: 128, dia: 82, pul: 71, wt: 0, fat: 0, mus: 0, vis: 0, bage: 0, bmr: 0 }), '11/25 07:05・血壓 128/82・脈搏 71');
});
