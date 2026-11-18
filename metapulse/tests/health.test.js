import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecords, planHealth, applyHealth } from '../js/health.js';
import { exerciseRefund } from '../js/points.js';
import { defaultState } from '../js/storage.js';

const at = (d, hm) => new Date(d + 'T' + hm + ':00').toISOString();
const om = { sourceName: 'OMRON connect', sourceId: 'jp.co.omron' };
const raw = {
  bloodPressure: [{ ...om, startDate: at('2026-11-16', '07:30'), systolic: 128, diastolic: 82 }],
  heartRate: [{ ...om, startDate: at('2026-11-16', '07:30'), value: 71 }, { sourceName: 'Watch', startDate: at('2026-11-16', '07:30'), value: 90 }],
  weight: [{ ...om, startDate: at('2026-11-16', '07:40'), value: 105.34 }, { sourceName: 'Fit', startDate: at('2026-11-16', '08:00'), value: 99 }],
  bodyFat: [{ ...om, startDate: at('2026-11-16', '07:41'), value: 31.2 }],
  basalCalories: [{ ...om, startDate: at('2026-11-16', '07:41'), value: 1920.4 }],
  calories: [
    { sourceName: 'Watch', startDate: at('2026-11-16', '10:00'), value: 200 },
    { sourceName: 'Watch', startDate: at('2026-11-16', '18:00'), value: 120 },
    { sourceName: 'Phone', startDate: at('2026-11-16', '10:00'), value: 50 },
    { sourceName: 'Watch', startDate: at('2026-11-17', '09:00'), value: 80 },
  ],
};

test('Health Connect 轉成記錄：預設只取 Omron，體脂與基礎代謝併到體重', () => {
  const b = buildRecords(raw);
  assert.equal(b.recs.length, 2);
  const bp = b.recs.find(r => r.sys > 0);
  assert.deepEqual([bp.sys, bp.dia, bp.pul, bp.time], [128, 82, 71, '07:30']);
  const w = b.recs.find(r => r.wt > 0);
  assert.deepEqual([w.wt, w.fat, w.bmr], [105.3, 31.2, 1920]);
  assert.equal(b.calSource, 'Watch');
  assert.deepEqual(b.activity, [{ date: '2026-11-16', kcal: 320, src: 'Watch' }, { date: '2026-11-17', kcal: 80, src: 'Watch' }]);
  assert.equal(buildRecords(raw, { allSources: true }).recs.filter(r => r.wt > 0).length, 2);
});

test('重複同步：不重複新增，運動消耗依日期更新', () => {
  const S = defaultState();
  let n = 0; const uid = p => p + (++n);
  const b = buildRecords(raw);
  const p1 = planHealth(b, S);
  assert.equal(p1.add.length, 2);
  assert.equal(p1.act.add.length, 2);
  applyHealth(S, p1, uid);
  const p2 = planHealth(buildRecords(raw), S);
  assert.equal(p2.add.length, 0);
  assert.equal(p2.dup, 2);
  assert.equal(p2.act.same, 2);
  const raw2 = { ...raw, calories: [...raw.calories, { sourceName: 'Watch', startDate: at('2026-11-17', '19:00'), value: 100 }] };
  const p3 = planHealth(buildRecords(raw2), S);
  assert.equal(p3.act.update.length, 1);
  applyHealth(S, p3, uid);
  assert.equal(S.activity.find(a => a.date === '2026-11-17').kcal, 180);
});

test('同一天手動記的體重，Health Connect 只補體組成', () => {
  const S = defaultState();
  S.entries.push({ id: 'x', date: '2026-11-16', time: '07:45', wt: 105.3, sys: 0, dia: 0, pul: 0, fat: 0, mus: 0, vis: 0, bage: 0, bmr: 0, dose: 0 });
  const p = planHealth(buildRecords(raw), S);
  assert.equal(p.merge.length, 1);
  assert.deepEqual(p.merge[0].fill, { fat: 31.2, bmr: 1920 });
  assert.equal(S.entries[0].fat, 0, '預覽不改動資料');
});

test('運動回補：80 kcal ≈ 1.5 點', () => {
  const r = exerciseRefund([{ date: '2026-11-17', kcal: 80 }, { date: '2026-11-10', kcal: 800 }], '2026-11-17');
  assert.equal(r.today, 1.5);
  assert.equal(r.rolling, 1.5);
});
