import test from 'node:test';
import assert from 'node:assert/strict';
import { longTermIndex, longTermRows } from '../js/longterm.js';

const at = (d, h = 12) => new Date(d + 'T' + String(h).padStart(2, '0') + ':00:00').toISOString();

test('長期指數圖表：每天一格，跳過的日子留空', () => {
  const ms = [
    { at: at('2026-11-01'), kcal: 2000 },
    { at: at('2026-11-02'), kcal: 300 },      // 不到 30%：不完整
    { at: at('2026-11-04'), kcal: 1000 },
    { at: at('2026-11-04', 18), kcal: 600 },  // 同一天加總
    { at: at('2026-11-06'), kcal: 999 },      // 今天不算
  ];
  const lt = longTermIndex(ms, 2000, '2026-11-06');
  assert.equal(lt.series[0].kcal, 2000);
  const r = longTermRows(lt.series);
  assert.deepEqual(r.dates, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']);
  assert.deepEqual(r.ratio, [1, null, null, 0.8]);
  assert.deepEqual(r.kcal, [2000, null, null, 1600]);
  assert.equal(r.index[0], 1);
  assert.ok(Math.abs(r.index[3] - (1 * 0.95 + 0.8 * 0.05)) < 1e-9);
});

test('長期指數圖表：範圍只切畫面，指數照全部記錄算', () => {
  const ms = [{ at: at('2026-10-01'), kcal: 3000 }, { at: at('2026-11-03'), kcal: 1000 }, { at: at('2026-11-05'), kcal: 1000 }];
  const lt = longTermIndex(ms, 2000, '2026-11-10');
  const r = longTermRows(lt.series, '2026-11-01');
  assert.equal(r.dates[0], '2026-11-03');
  assert.equal(r.dates.length, 3);
  assert.ok(Math.abs(r.index[0] - (1.5 * 0.95 + 0.5 * 0.05)) < 1e-9);
  assert.deepEqual(longTermRows(lt.series, '2026-11-09').dates, []);
  assert.deepEqual(longTermRows([]).dates, []);
});
