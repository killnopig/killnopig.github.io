import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentFast, mealShift, stageAt, hourlyMessage, hybridSuggestion, eatingWindow, closeFastsForMeal, reopenFastsForMeal, overrideValid, lastMealGroup, mealEndsFast, targetHours } from '../js/fasting.js';
import { longTermIndex, weightTrend, longTermMessage } from '../js/longterm.js';
import { HOURLY_MESSAGES } from '../js/messages.js';
import { addDays, localDate } from '../js/points.js';
import { recentFasts } from '../js/summary.js';

const H = 3600000;
const t0 = new Date(2026, 10, 17, 20, 0).getTime();
const meal = (h, kcal = 500, carb = 50, g = 'g' + h) => ({ id: 'm' + h, group: g, at: new Date(t0 - h * H).toISOString(), kcal, carb });

test('距上一餐的時間；手動開始與結束', () => {
  const ms = [meal(10), meal(5)];
  let f = currentFast(ms, [], t0);
  assert.equal(f.hours, 5);
  assert.equal(f.manual, false);
  f = currentFast(ms, [{ start: new Date(t0 - 2 * H).toISOString(), end: null }], t0);
  assert.equal(f.hours, 2);
  assert.equal(f.manual, true);
  f = currentFast(ms, [{ start: new Date(t0 - 4 * H).toISOString(), end: new Date(t0 - 1 * H).toISOString() }], t0);
  assert.equal(f.hours, 1, '結束斷食後重新計算');
  assert.equal(currentFast([], [], t0).start, null);
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

test('手動修改的時間最優先，記下一餐就失效', async () => {
  const { fastEnd, lastMealGroup } = await import('../js/fasting.js');
  const ms = [meal(5, 500, 50, 'gA')];
  assert.deepEqual(currentFast(ms, [], t0).source, { type: 'meal', group: 'gA' });
  // 改早到上一餐之前也照改
  let ov = { group: lastMealGroup(ms, t0), start: t0 - 9 * H };
  let f = currentFast(ms, [], t0, ov);
  assert.equal(f.hours, 9);
  assert.equal(f.source.type, 'override');
  // 結束斷食留下的時間點也被手動時間蓋過
  f = currentFast(ms, [{ id: 'x', start: new Date(t0 - 4 * H).toISOString(), end: new Date(t0 - 1 * H).toISOString() }], t0, ov);
  assert.equal(f.hours, 9);
  // 記了新的一餐 → 失效
  f = currentFast([...ms, meal(1, 500, 50, 'gB')], [], t0, ov);
  assert.equal(f.hours, 1);
  // 預計結束：只改開始 → 依目標往後推；改了結束 → 用結束
  let e = fastEnd(t0 - 9 * H, 16, ov, t0);
  assert.equal(e.left, 7);
  assert.ok(Math.abs(e.pct - 56.25) < 1e-9);
  e = fastEnd(t0 - 9 * H, 16, { end: t0 - 1 * H }, t0);
  assert.equal(e.left, -1);
  assert.equal(e.custom, true);
  assert.ok(Math.abs(e.pct - 112.5) < 1e-9);
  assert.equal(fastEnd(t0 - 2 * H, 16, { end: t0 - 3 * H }, t0).custom, false, '結束早於開始時不採用');
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

test('斷食中記一餐再刪掉：斷食接回來，手動改的時間也恢復', () => {
  const iso = h => new Date(t0 - h * H).toISOString();
  const meals = [meal(10)];
  const fasts = [{ id: 'f1', start: iso(6), end: null }];
  assert.equal(currentFast(meals, fasts, t0).hours, 6);
  const ov = { group: lastMealGroup(meals, t0), start: t0 - 8 * H };
  assert.equal(currentFast(meals, fasts, t0, ov).hours, 8);

  // 記一餐（測試拍照）：斷食結束
  const at = iso(0.5);
  meals.push({ id: 'mx', group: 'gx', at, kcal: 300, carb: 30 });
  closeFastsForMeal(fasts, at, 'gx');
  assert.equal(fasts[0].end, at);
  assert.equal(fasts[0].endedBy, 'gx');
  assert.equal(currentFast(meals, fasts, t0, ov).hours, 0.5);
  assert.equal(overrideValid(ov, lastMealGroup(meals, t0)), false);

  // 刪掉這一餐：斷食接回來
  meals.pop();
  assert.equal(reopenFastsForMeal(fasts, 'gx'), 1);
  assert.equal(fasts[0].end, null);
  assert.equal(fasts[0].endedBy, undefined);
  assert.equal(currentFast(meals, fasts, t0).hours, 6);
  assert.equal(currentFast(meals, fasts, t0, ov).hours, 8);
});

test('刪掉一餐時，之後又開始了別的斷食就不接回舊的', () => {
  const iso = h => new Date(t0 - h * H).toISOString();
  const fasts = [{ id: 'f1', start: iso(6), end: iso(3), endedBy: 'gx' }, { id: 'f2', start: iso(1), end: null }];
  assert.equal(reopenFastsForMeal(fasts, 'gx'), 0);
  assert.equal(fasts[0].end, iso(3));
  assert.equal(fasts[0].endedBy, undefined);
  assert.equal(reopenFastsForMeal(fasts, 'gy'), 0);
});

test('存這一餐會不會結束斷食（要不要按兩次確認）', () => {
  const fi = { fasting: true, start: t0 - 6 * H };
  assert.equal(mealEndsFast(fi, t0), true);                         // 現在吃
  assert.equal(mealEndsFast(fi, t0 - 6 * H), true);                 // 剛好在斷食開始時
  assert.equal(mealEndsFast(fi, t0 - 7 * H), false);                // 補記斷食前的一餐
  assert.equal(mealEndsFast({ fasting: false, start: t0 - 6 * H }, t0), false);   // 第 0 階段進食中
  assert.equal(mealEndsFast({ fasting: false, reached: false }, t0), false);      // 沒有任何記錄
});

test('以前的斷食：最近 14 天每天一行，新的在前；手動結束進餐的時間優先', () => {
  const D = 864e5, day0 = new Date(2026, 10, 18, 0, 0).getTime();
  const at = (d, hh) => new Date(day0 - d * D + hh * H).toISOString();
  const meals = [], fasts = [];
  // 前 20 天：每天 12 點、19 點各一餐 → 每天結束一段 17 小時的斷食（19:00 → 隔天 12:00）
  for (let d = 20; d >= 0; d--) { meals.push({ id: 'a' + d, group: 'a' + d, at: at(d, 12) }); meals.push({ id: 'b' + d, group: 'b' + d, at: at(d, 19) }); }
  fasts.push({ id: 'f', start: at(1, 21), end: null });           // 昨天 21 點按了「結束進餐」
  const today = localDate(new Date(day0));
  const r = recentFasts(meals, fasts, today);
  assert.equal(r.length, 14);
  assert.equal(r[0].date, today);
  assert.ok(r[0].date > r[1].date);
  assert.equal(r[0].hours, 15);                                   // 21:00 → 12:00
  assert.equal(r[1].hours, 17);
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
  const before = currentFast(meals, [], t0 + 15 * H);
  assert.equal(before.start, t0);
  const after = currentFast(meals, [], t0 + 18 * H);   // 預計時間已過 2 小時
  assert.equal(after.start, t0);
  assert.equal(Math.round(after.hours), 18);
  assert.equal(lastMealGroup(meals, t0 + 18 * H), 'g1');
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
  assert.equal(cf.start, Date.parse(press));
});

test('圖表的斷食時數不算先存的餐點', () => {
  const t0 = Date.parse('2026-11-18T20:00:00');
  const meals = [
    { id: 'a', group: 'g1', at: new Date(t0).toISOString() },
    { id: 'b', group: 'g2', at: new Date(t0 + 16 * H).toISOString(), pending: true },
  ];
  assert.deepEqual(dailyFastDetail(meals, []), {});
  delete meals[1].pending;
  assert.equal(Object.values(dailyFastDetail(meals, []))[0].hours, 16);
});

test('先存的標記（pending）存檔、讀檔後還在', async () => {
  const { normalizeMeal } = await import('../js/storage.js');
  assert.equal(normalizeMeal({ id: 'x', at: '2026-11-19T04:00:00.000Z', name: 'a', pending: true }).pending, true);
  assert.equal(normalizeMeal({ id: 'y', at: '2026-11-19T04:00:00.000Z', name: 'b' }).pending, undefined);
});
