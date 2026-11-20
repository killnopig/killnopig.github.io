import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledger, windowStart, weekReport, firstDay } from '../js/ledger.js';

const meal = (d, pts, h = 12) => ({ at: new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), h).toISOString(), points: pts, kcal: pts * 40, protein: 20 });

test('存摺的第一天：滾動、週日、週一', () => {
  // 2026-11-18 是週三
  assert.equal(windowStart('2026-11-18', 'roll'), '2026-11-12');
  assert.equal(windowStart('2026-11-18', 'sun'), '2026-11-15');
  assert.equal(windowStart('2026-11-18', 'mon'), '2026-11-16');
  assert.equal(windowStart('2026-11-16', 'mon'), '2026-11-16');
  assert.equal(windowStart('2026-11-15', 'mon'), '2026-11-09');
});

test('今日剩餘與存摺：每日點數＋運動加回−吃掉的', () => {
  const meals = [meal('2026-11-16', 30), meal('2026-11-17', 50), meal('2026-11-18', 10)];
  const act = [{ date: '2026-11-17', kcal: 160 }];   // 160 × 0.75 ÷ 40 = 3 點
  const l = ledger(meals, act, 44, '2026-11-18', 'mon');
  assert.equal(l.days.length, 3);
  assert.equal(l.today.left, 34);
  assert.equal(l.days[1].left, -3);                // 44 + 3 − 50
  assert.equal(l.balance, 14 + -3 + 34);
  assert.equal(l.total, 44 * 3 + 3);
});

test('週報：達標天數、和上一段比較（今天不算）', () => {
  const meals = [];
  for (let i = 1; i <= 13; i++) { const d = new Date(2026, 10, 18 - i); const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); meals.push(meal(ds, i % 3 === 0 ? 60 : 40)); }
  const S = { meals, activity: [], entries: [{ date: '2026-11-17', wt: 104 }, { date: '2026-11-10', wt: 105 }] };
  const r = weekReport(S, 44, '2026-11-18', 'roll');
  assert.equal(r.cur.days, 6);
  assert.equal(r.cur.logged, 6);
  assert.equal(r.cur.healthy, 4);                  // 6 天裡 i=3、6 超標
  assert.equal(r.prev.logged, 7);
  assert.equal(r.weightChange, -1);
});

test('手動記的運動也加回點數', async () => {
  const { allActivity } = await import('../js/ledger.js');
  const S = { activity: [{ date: '2026-11-18', kcal: 80 }], exercise: [{ id: 'x', date: '2026-11-18', kcal: 400, type: 'bball', minutes: 30 }] };
  const l = ledger([], allActivity(S), 44, '2026-11-18', 'mon', null, null, new Date(2026, 10, 18, 20).getTime());
  assert.equal(l.today.refund, (80 + 400) * 0.75 / 40);   // 9 點
  assert.equal(l.today.left, 44 + 9);
});

test('存摺只算有記錄的日子：才記一天不會多出一百多點', () => {
  const at = (d, hh) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd, hh).toISOString(); };
  const now = new Date(2026, 10, 19, 15).getTime();
  const meals = [{ at: at('2026-11-19', 12), points: 20, group: 'a' }];
  let l = ledger(meals, [], 33, '2026-11-19', 'roll', null, null, now);
  assert.equal(l.balance, 13, '以前 6 天沒記錄：不算');
  assert.equal(l.total, 33);
  // 11/17 整天都在斷食：算有記錄、吃 0 點
  const fasts = [{ start: at('2026-11-16', 20), end: at('2026-11-18', 9) }];
  l = ledger(meals, [], 33, '2026-11-19', 'roll', null, fasts, now);
  assert.equal(l.days.find(d => d.date === '2026-11-17').logged, true);
  assert.equal(l.days.find(d => d.date === '2026-11-16').logged, false);
  assert.equal(l.balance, 13 + 33);
  // 今天還沒吃也算今日剩餘
  assert.equal(ledger([], [], 33, '2026-11-19', 'roll', null, null, now).today.left, 33);
});

test('週報從開始記錄那天起算：之前的日子不算漏記', () => {
  const at = (d, t) => new Date(d + 'T' + t + ':00').toISOString();
  const S = { meals: [{ id: 'a', at: at('2026-11-18', '12:00'), points: 20 }, { id: 'b', at: at('2026-11-17', '12:00'), points: 5, pending: true }], fasts: [{ id: 'f', start: at('2026-11-17', '19:00'), end: at('2026-11-18', '11:00') }], activity: [], entries: [] };
  assert.equal(firstDay(S), '2026-11-17');
  const r = weekReport(S, 30, '2026-11-20', 'roll');
  assert.equal(r.dayNo, 4);
  assert.equal(r.newbie, true);
  assert.equal(r.hasPrev, false);
  assert.equal(firstDay({ meals: [], fasts: [] }), null);
});
