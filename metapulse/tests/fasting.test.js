import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentFast, mealShift, stageAt, hourlyMessage, hybridSuggestion, eatingWindow, closeFastsForMeal, reopenFastsForMeal, targetHours, checkFast, guessFasts, fastSegments } from '../js/fasting.js';
import { longTermIndex, weightTrend, longTermMessage } from '../js/longterm.js';
import { HOURLY_MESSAGES } from '../js/messages.js';
import { addDays, localDate } from '../js/points.js';
import { recentFasts } from '../js/summary.js';

const H = 3600000;
const t0 = new Date(2026, 10, 17, 20, 0).getTime();
const meal = (h, kcal = 500, carb = 50, g = 'g' + h) => ({ id: 'm' + h, group: g, at: new Date(t0 - h * H).toISOString(), kcal, carb });

test('斷食只看按鈕記錄：沒按「開始斷食」就一直是進食中', () => {
  const ms = [meal(10), meal(5)];
  let f = currentFast(ms, [], t0);
  assert.equal(f.fasting, false, '只有餐點：不會自己開始斷食');
  assert.equal(f.start, t0 - 10 * H, '沒有斷食記錄：進食窗口從最近 24 小時的第一餐算');
  assert.equal(f.lastMealAt, t0 - 5 * H);
  f = currentFast(ms, [{ start: new Date(t0 - 2 * H).toISOString(), end: null }], t0);
  assert.equal(f.fasting, true);
  assert.equal(f.hours, 2);
  assert.equal(f.lastMeal[0].id, 'm5', '斷食前的最後一餐（大餐會挪階段）');
  f = currentFast(ms, [{ start: new Date(t0 - 30 * H).toISOString(), end: new Date(t0 - 4 * H).toISOString() }], t0);
  assert.equal(f.fasting, false, '按過結束斷食：進食中');
  assert.equal(f.hours, 4, '進食窗口從結束斷食那一刻算');
  assert.equal(f.lastEnd, t0 - 4 * H);
  // 窗口裡吃了好幾餐：還是同一個窗口，不會切成很多段
  f = currentFast([...ms, meal(3), meal(1)], [{ start: new Date(t0 - 30 * H).toISOString(), end: new Date(t0 - 4 * H).toISOString() }], t0);
  assert.equal(f.fasting, false);
  assert.equal(f.start, t0 - 4 * H);
  assert.equal(currentFast([], [], t0).start, null);
});

test('檢查斷食記錄：結束晚於開始、不能晚於現在、不能重疊', () => {
  const iso = h => new Date(t0 - h * H).toISOString();
  const fasts = [{ id: 'a', start: iso(30), end: iso(14) }];
  assert.equal(checkFast(fasts, t0 - 12 * H, t0 - 2 * H, t0), '');
  assert.match(checkFast(fasts, t0 - 2 * H, t0 - 3 * H, t0), /晚於開始/);
  assert.match(checkFast(fasts, t0 - 2 * H, t0 + 3 * H, t0), /不能晚於現在/);
  assert.match(checkFast(fasts, t0 - 20 * H, t0 - 2 * H, t0), /重疊/);
  assert.equal(checkFast(fasts, t0 - 20 * H, t0 - 15 * H, t0, 'a'), '', '改自己那一筆不算重疊');
  assert.match(checkFast([{ id: 'o', start: iso(3), end: null }], t0 - 1 * H, null, t0), /進行中/);
  assert.deepEqual(fastSegments(fasts).map(x => x.hours), [16]);
});

test('以前的日子：用兩餐之間猜斷食，只列 8～48 小時、跟記錄不重疊的', () => {
  const ms = [meal(60), meal(40), meal(37), meal(20), meal(2)];
  const g = guessFasts(ms, []);
  assert.deepEqual(g.map(x => x.hours), [18, 17, 20], '3 小時那段不列；新的在前');
  const g2 = guessFasts(ms, [{ start: new Date(t0 - 19 * H).toISOString(), end: new Date(t0 - 3 * H).toISOString() }]);
  assert.deepEqual(g2.map(x => x.hours), [17, 20], '已經有記錄的那段不再列');
  assert.deepEqual(guessFasts([meal(100), meal(1)], []), [], '超過 48 小時多半是漏記');
});

test('大餐把階段往後挪', () => {
  assert.equal(mealShift([meal(1, 500, 50)]), 0);
  assert.equal(mealShift([meal(1, 900, 50)]), 1);
  assert.equal(mealShift([meal(1, 600, 80, 'x'), meal(1, 700, 90, 'x')]), 2);
  assert.equal(stageAt(12.5, 0).index, 2);
  assert.equal(stageAt(12.5, 1).index, 1);
  assert.equal(stageAt(3, 2).index, 0);
  assert.equal(stageAt(25, 0).index, 4);
});

test('每小時提示：同一小時固定、超過 24 用 24、20 小時後不鼓勵再撐', () => {
  const a = hourlyMessage(0.2, 123, HOURLY_MESSAGES), b = hourlyMessage(0.9, 123, HOURLY_MESSAGES);
  assert.equal(a, b);
  assert.equal(hourlyMessage(30, 1, HOURLY_MESSAGES), HOURLY_MESSAGES[24][0]);
  for (let h = 20; h <= 24; h++) for (const s of HOURLY_MESSAGES[h]) assert.doesNotMatch(s, /再撐|堅持下去|多撐/);
});

test('依施打週期建議', () => {
  const es = [{ date: '2026-11-15', dose: 5 }];
  assert.equal(hybridSuggestion(es, '2026-11-15').plan, '18:6');
  assert.equal(hybridSuggestion(es, '2026-11-17').day, 3);
  assert.equal(hybridSuggestion(es, '2026-11-17').plan, '18:6');
  assert.equal(hybridSuggestion(es, '2026-11-18').plan, '16:8');
  assert.equal(hybridSuggestion(es, '2026-11-25').plan, '16:8');
  assert.equal(hybridSuggestion(es, '2026-11-16', { fastLoss: true }).plan, '16:8');
  assert.equal(hybridSuggestion(es, '2026-11-16', { lowIntake: true }).plan, '16:8');
  const none = hybridSuggestion([], '2026-11-17');
  assert.equal(none.plan, '16:8');
  assert.equal(none.hasDose, false);
});

test('進食窗口，含跨午夜', () => {
  const at = (h, m = 0) => new Date(2026, 10, 17, h, m).getTime();
  let w = eatingWindow('16:8', '12:00', at(13));
  assert.equal(w.inWindow, true);
  assert.equal(new Date(w.closesAt).getHours(), 20);
  w = eatingWindow('16:8', '12:00', at(21));
  assert.equal(w.inWindow, false);
  assert.equal(new Date(w.opensAt).getDate(), 18);
  w = eatingWindow('18:6', '20:00', at(1)); // 20:00～02:00
  assert.equal(w.inWindow, true);
  w = eatingWindow('24H', '18:00', at(18, 30));
  assert.equal(w.eatHours, 1);
  assert.equal(w.inWindow, true);
});

test('長期指數：跳過沒記錄與記錄不完整的日子，資料足夠才提示', () => {
  const today = '2026-11-30';
  const ms = [];
  for (let i = 1; i <= 25; i++) ms.push({ at: new Date(addDays(today, -i) + 'T12:00:00').toISOString(), kcal: 1400 });
  ms.push({ at: new Date(addDays(today, -26) + 'T12:00:00').toISOString(), kcal: 200 }); // 不完整
  ms.push({ at: new Date(today + 'T08:00:00').toISOString(), kcal: 100 });               // 今天不算
  const lt = longTermIndex(ms, 2000, today);
  assert.equal(lt.validDays, 25);
  assert.equal(lt.ready, true);
  assert.ok(Math.abs(lt.index - 0.7) < 1e-9);
  assert.equal(lt.level, 'veryLow');
  assert.match(longTermMessage(lt, { fast: true }), /明顯偏低.*體重下降速度偏快/);
  const few = longTermIndex(ms.slice(0, 10), 2000, today);
  assert.equal(few.ready, false);
  assert.equal(longTermMessage(few, null), null);
});

test('體重下降速度（14 天平均）', () => {
  const today = '2026-11-30', es = [];
  for (let i = 0; i < 28; i++) es.push({ date: addDays(today, -i), wt: 100 - (27 - i) * 0.2 }); // 每天 -0.2 kg ≈ 每週 1.4%
  const w = weightTrend(es, today);
  assert.ok(w.weeklyPct > 1.3 && w.weeklyPct < 1.6);
  assert.equal(w.fast, true);
  assert.equal(weightTrend(es.slice(0, 3), today).weeklyPct, null);
});

test('斷食通知：階段轉換＋達標，跳過勿擾時段', async () => {
  const { fastNotes, inQuiet } = await import('../js/fasting.js');
  const start = new Date(2026, 10, 17, 19, 0).getTime();       // 19:00 開始
  const fi = { start, end: start + 16 * H, shift: 0 };
  const n = fastNotes(fi, start, 'phase', '23:00', '07:00');
  // 4h=23:00（勿擾）、12h=07:00、16h=11:00 階段＋達標、20h=15:00
  assert.deepEqual(n.map(x => new Date(x.at).getHours()), [7, 11, 11, 15]);
  assert.equal(n.filter(x => x.kind === 'done').length, 1);
  assert.equal(inQuiet(new Date(2026, 10, 17, 2, 0).getTime()), true);
  assert.equal(inQuiet(new Date(2026, 10, 17, 7, 0).getTime()), false);
  assert.equal(fastNotes(fi, start, 'off').length, 0);
  const hourly = fastNotes(fi, start + 0.5 * H, 'hourly', '23:00', '07:00');
  assert.equal(new Date(hourly[0].at).getHours(), 20);
});

test('選「現在吃，結束斷食」再刪掉那一餐：斷食接回來', () => {
  const iso = h => new Date(t0 - h * H).toISOString();
  const meals = [meal(10)];
  const fasts = [{ id: 'f1', start: iso(6), end: null }];
  assert.equal(currentFast(meals, fasts, t0).hours, 6);
  const at = iso(0.5);
  meals.push({ id: 'mx', group: 'gx', at, kcal: 300, carb: 30 });
  closeFastsForMeal(fasts, at, 'gx');
  assert.equal(fasts[0].end, at);
  assert.equal(fasts[0].endedBy, 'gx');
  assert.equal(currentFast(meals, fasts, t0).fasting, false);
  meals.pop();
  assert.equal(reopenFastsForMeal(fasts, 'gx'), 1);
  assert.equal(fasts[0].end, null);
  assert.equal(currentFast(meals, fasts, t0).hours, 6);
});

test('刪掉一餐時，之後又開始了別的斷食就不接回舊的', () => {
  const iso = h => new Date(t0 - h * H).toISOString();
  const fasts = [{ id: 'f1', start: iso(6), end: iso(3), endedBy: 'gx' }, { id: 'f2', start: iso(1), end: null }];
  assert.equal(reopenFastsForMeal(fasts, 'gx'), 0);
  assert.equal(fasts[0].end, iso(3));
  assert.equal(fasts[0].endedBy, undefined);
  assert.equal(reopenFastsForMeal(fasts, 'gy'), 0);
});

test('以前的斷食：最近 14 天每天一行，新的在前，只看斷食記錄', () => {
  const D = 864e5, day0 = new Date(2026, 10, 18, 0, 0).getTime();
  const at = (d, hh) => new Date(day0 - d * D + hh * H).toISOString();
  const meals = [], fasts = [];
  for (let d = 20; d >= 1; d--) fasts.push({ id: 'f' + d, start: at(d, 19), end: at(d - 1, 12) });   // 19:00 → 隔天 12:00
  for (let d = 5; d >= 0; d--) meals.push({ id: 'a' + d, group: 'a' + d, at: at(d, 15) });          // 窗口裡多吃一餐，不會多一段
  fasts.push({ id: 'o', start: at(0, 21), end: null });                                              // 進行中的不算
  const today = localDate(new Date(day0));
  const r = recentFasts(meals, fasts, today);
  assert.equal(r.length, 14);
  assert.equal(r[0].date, today);
  assert.ok(r[0].date > r[1].date);
  assert.equal(r[0].hours, 17);
  assert.equal(recentFasts(meals, fasts, today, 3).length, 3);
  assert.deepEqual(recentFasts([], [], today), []);
});

test('斷食目標時數依模式', () => {
  assert.equal(targetHours({ fastMode: 'STRICT_MANUAL', strictPlan: '18:6' }), 18);
  assert.equal(targetHours({ fastMode: 'HYBRID_GUIDED' }), 16);
  assert.equal(targetHours({ fastMode: 'PURE_DYNAMIC', fastTarget: 20 }), 20);
  assert.ok(targetHours({}) > 0);
});

/* ---- 先存、等一下吃（pending）：不影響斷食，按「結束斷食」才算吃了 ---- */
import { pendingMeals, eatPending } from '../js/fasting.js';
import { dailyFastDetail } from '../js/summary.js';

test('先存的餐點不會結束斷食：時間沒到、時間過了都一樣', () => {
  const t0 = Date.parse('2026-11-18T20:00:00');
  const meals = [
    { id: 'a', group: 'g1', at: new Date(t0).toISOString() },
    { id: 'b', group: 'g2', at: new Date(t0 + 16 * H).toISOString(), pending: true },
  ];
  const fasts = [{ id: 'f', start: new Date(t0 + H).toISOString(), end: null }];
  const before = currentFast(meals, fasts, t0 + 15 * H);
  assert.equal(before.fasting, true);
  const after = currentFast(meals, fasts, t0 + 18 * H);   // 預計時間已過 2 小時
  assert.equal(after.fasting, true);
  assert.equal(Math.round(after.hours), 17);
  assert.equal(after.lastMealAt, t0, '先存的不算最後一餐');
});

test('按結束斷食：先存的餐點改成按下的那一刻，拿掉 pending，並結束手動斷食', () => {
  const t0 = Date.parse('2026-11-18T20:00:00'), press = new Date(t0 + 17 * H).toISOString();
  const meals = [
    { id: 'a', group: 'g1', at: new Date(t0).toISOString() },
    { id: 'b', group: 'g2', at: new Date(t0 + 16 * H).toISOString(), pending: true },
    { id: 'c', group: 'g2', at: new Date(t0 + 16 * H).toISOString(), pending: true },
  ];
  const fasts = [{ id: 'f', start: new Date(t0 + H).toISOString(), end: null }];
  assert.equal(pendingMeals(meals).length, 1);
  assert.equal(eatPending(meals, fasts, press), 1);
  assert.deepEqual(meals.filter(m => m.group === 'g2').map(m => [m.at, !!m.pending]), [[press, false], [press, false]]);
  assert.equal(fasts[0].end, press);
  assert.equal(fasts[0].endedBy, 'g2');
  assert.equal(pendingMeals(meals).length, 0);
  const cf = currentFast(meals, fasts, t0 + 17 * H + 60000);
  assert.equal(cf.fasting, false);
  assert.equal(cf.start, Date.parse(press), '進食窗口從按下的那一刻開始');
});

test('圖表的斷食時數只看斷食記錄，不看餐點', () => {
  const t0 = Date.parse('2026-11-18T20:00:00');
  const meals = [
    { id: 'a', group: 'g1', at: new Date(t0).toISOString() },
    { id: 'b', group: 'g2', at: new Date(t0 + 16 * H).toISOString() },
  ];
  assert.deepEqual(dailyFastDetail(meals, []), {}, '沒按按鈕就沒有斷食');
  const d = dailyFastDetail(meals, [{ id: 'f', start: new Date(t0 + H).toISOString(), end: new Date(t0 + 18 * H).toISOString() }, { id: 'g', start: new Date(t0 + 19 * H).toISOString(), end: new Date(t0 + 21 * H).toISOString() }]);
  const x = Object.values(d)[0];
  assert.equal(x.hours, 17, '同一天結束兩段：取最長的');
  assert.equal(x.count, 2);
});

test('先存的標記（pending）存檔、讀檔後還在', async () => {
  const { normalizeMeal } = await import('../js/storage.js');
  assert.equal(normalizeMeal({ id: 'x', at: '2026-11-19T04:00:00.000Z', name: 'a', pending: true }).pending, true);
  assert.equal(normalizeMeal({ id: 'y', at: '2026-11-19T04:00:00.000Z', name: 'b' }).pending, undefined);
});

test('記錄頁：斷食段和進食段交替，窗口裡的餐點都在同一段', async () => {
  const { periods } = await import('../js/fasting.js');
  const iso = h => new Date(t0 - h * H).toISOString();
  const g = (id, h) => ({ group: id, at: iso(h) });
  const fasts = [{ id: 'a', start: iso(40), end: iso(24) }, { id: 'b', start: iso(18), end: iso(4) }];
  const meals = [g('x1', 72), g('x2', 70), g('y1', 23), g('y2', 20), g('z1', 3.9), g('z2', 1), g('w', 10)];
  const p = periods(meals, fasts, t0);
  assert.deepEqual(p.map(x => x.type + x.meals.length), ['eat2', 'fast1', 'eat2', 'fast0', 'eat2']);
  assert.equal(p[0].end, null, '最新的進食段還在進行');
  assert.equal(p[1].meals[0].group, 'w', '斷食中補記的一餐放在斷食段裡');
  assert.equal(p[2].start, t0 - 24 * H);
  assert.equal(p[4].loose, true, '第一段斷食之前：照每天分');
  const open = periods([g('m', 5)], [{ id: 'o', start: iso(2), end: null }], t0);
  assert.deepEqual(open.map(x => x.type), ['fast', 'eat']);
  assert.equal(open[0].end, null);
  assert.equal(open[0].hours, 2);
});
