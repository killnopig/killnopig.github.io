import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveAdvice } from '../js/safety.js';

const today = '2026-11-27';
test('肌力訓練提醒', () => {
  assert.match(moveAdvice([], today).line, /這 7 天沒有運動・肌力 0\/2/);
  const a = moveAdvice([{ date: '2026-11-25', type: 'golf' }, { date: '2026-11-26', type: 'weights' }], today);
  assert.equal(a.line, '💪 肌力 1/2：走路、打球不會長肌肉');
  assert.equal(a.days, 2);
  assert.equal(moveAdvice([{ date: '2026-11-25', type: 'weights' }, { date: '2026-11-27', type: 'band' }], today), null);
  assert.match(moveAdvice([{ date: '2026-11-10', type: 'weights' }], today).line, /沒有運動/);   // 超過 7 天不算
});
