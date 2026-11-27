import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paceAdvice } from '../js/safety.js';
import { addDays } from '../js/points.js';

// 假資料：每天量一次，每天變化 perDay kg
const today = '2026-11-27';
const series = (start, perDay, days = 21) => Array.from({ length: days }, (_, i) => ({ date: addDays(today, -(days - 1 - i)), wt: start + perDay * i }));
const b = { ok: true, dailyPoints: 30, floorPoints: 47.5, weeklyLossPct: 0.95 };

test('點數低於保底：一定提醒，並附體重速度', () => {
  const p = paceAdvice(b, series(110, -0.2), today);
  assert.equal(p.low, true);
  assert.equal(p.level, 'fast');          // 每週約 1.4 kg / 108 kg ≈ 1.3%
  assert.match(p.line, /^⚠ 每天 30 點＜保底 47.5・體重每週 −1\.\d%$/);
  assert.match(p.advice[0], /風險要自己評估/);
  assert.match(p.advice[1], /偏快|比每週 1% 快/);
});

test('步調剛好、偏慢、變重', () => {
  const ok = { ...b, dailyPoints: 50 };
  assert.equal(paceAdvice(ok, series(100, -0.08), today).level, 'ok');
  assert.match(paceAdvice(ok, series(100, -0.08), today).line, /步調剛好/);
  const slow = paceAdvice(ok, series(100, 0), today);
  assert.equal(slow.level, 'slow');
  assert.match(slow.advice[0], /漏記/);
  assert.match(paceAdvice(ok, series(100, 0.05), today).line, /\+0\.\d%，偏慢/);
});

test('沒體重資料又沒低於保底：不顯示；沒預算：null', () => {
  assert.equal(paceAdvice({ ...b, dailyPoints: 50 }, [], today), null);
  assert.equal(paceAdvice({ ok: false }, [], today), null);
  const p = paceAdvice(b, [], today);
  assert.equal(p.level, null);
  assert.equal(p.line, '⚠ 每天 30 點＜保底 47.5');
});
