import test from 'node:test';
import assert from 'node:assert/strict';
import { liveTimeline } from '../js/live.js';

const H = 3600000;
const at = (h, m = 0) => new Date(2026, 10, 22, h, m).getTime();

test('常駐卡：斷食中倒數，到點換成「可以吃了」', () => {
  const now = at(10);
  const out = liveTimeline({ fast: { start: at(2), end: at(18), fasting: true }, stages: [{ at: at(2), text: 'A' }, { at: at(14), text: 'B' }] }, now);
  assert.equal(out[0].title, '斷食中・還剩'); assert.equal(out[0].text, 'A'); assert.equal(out[0].at, at(18)); assert.equal(out[0].down, true);
  assert.equal(out[1].from, at(14)); assert.equal(out[1].text, 'B');
  assert.equal(out[2].from, at(18)); assert.equal(out[2].title, '可以吃了・超過目標'); assert.equal(out[2].down, false);
});

test('常駐卡：吃藥前 30 分鐘蓋過斷食，過 2 小時恢復；已服用就跳過今天', () => {
  const now = at(17);
  const inp = { fast: { start: at(2), end: at(22), fasting: true }, meds: [{ name: '甲藥', time: '19:00' }] };
  const out = liveTimeline(inp, now);
  const f = t => out.filter(s => s.from <= t).pop();
  assert.equal(f(at(18, 40)).chip, '吃藥'); assert.equal(f(at(18, 40)).down, true);
  assert.equal(f(at(19, 10)).title, '該吃藥了・已過');
  assert.equal(f(at(21, 10)).chip, '斷食');
  const taken = liveTimeline({ ...inp, meds: [{ name: '甲藥', time: '19:00', taken: true }] }, now);
  assert.ok(taken.every(s => s.chip !== '吃藥' || s.from > at(23)));
});

test('常駐卡：注射日從提醒時間到午夜；進食時間結束後提醒該斷食', () => {
  const now = at(8);
  const out = liveTimeline({ fast: { start: at(7), end: 0, fasting: false }, eatUntil: at(15), dose: { today: true, site: '左腹', remindAt: '09:00' } }, now);
  const f = t => out.filter(s => s.from <= t).pop();
  assert.equal(f(at(8)).title, '進食中・進食時間還剩');
  assert.equal(f(at(10)).chip, '注射'); assert.match(f(at(10)).text, /左腹/);
  assert.equal(f(at(23, 59)).chip, '注射');
  assert.equal(f(at(23, 59) + 2 * 60000).title, '該開始斷食了・已過');
});

test('常駐卡：沒有任何記錄時只有一段', () => {
  const out = liveTimeline({}, at(9));
  assert.equal(out.length, 1); assert.equal(out[0].at, 0);
});
