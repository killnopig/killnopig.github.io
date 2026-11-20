import test from 'node:test';
import assert from 'node:assert/strict';
import { FUEL, SOUP, EATING, comboAt, fuelText, soupText, eatingText, STEP } from '../js/lines.js';

const H = 3600000;
const need = [480, 960, 480, 480, 480]; // 每段分鐘數 × 2（每 30 秒一句）

test('每一段的句數夠用（前半句 × 後半句 ≥ 那段的分鐘數 × 2）', () => {
  FUEL.forEach((p, i) => assert.ok(p.heads.length * p.tails.length >= need[i], 'FUEL ' + i));
  SOUP.forEach((g, i) => assert.ok(g.heads.length * g.tails.length >= need[i], 'SOUP ' + i));
  assert.ok(EATING.heads.length * EATING.tails.length >= 960, '進食中 8 小時');
});

test('組合在一輪內不重複，相鄰兩句前後半句都不同', () => {
  for (const p of [...FUEL, ...SOUP, EATING]) {
    const total = p.heads.length * p.tails.length, seen = new Set();
    for (let k = 0; k < total; k++) seen.add(comboAt(p.heads, p.tails, k, 20261118));
    assert.equal(seen.size, total);
    for (let k = 1; k < 50; k++) {
      const [a1, b1] = comboAt(p.heads, p.tails, k - 1, 7).split('，');
      const [a2, b2] = comboAt(p.heads, p.tails, k, 7).split('，');
      assert.notEqual(a1, a2); assert.notEqual(b1, b2);
    }
  }
});

test('一次 24 小時的斷食：燃料與雞湯每 30 秒一句，全程不重複', () => {
  const start = new Date(2026, 10, 18, 18, 0).getTime();
  const starts = [0, 4, 12, 16, 20].map(h => start + h * H);
  const fuel = new Set(), soup = new Set();
  for (let t = start; t < start + 24 * H; t += STEP) {
    let i = 0; starts.forEach((s, j) => { if (s <= t) i = j; });
    fuel.add(fuelText(i, starts[i], t, start)); soup.add(soupText(t, start));
  }
  assert.equal(fuel.size, 2880); assert.equal(soup.size, 2880);
});

test('換一天順序不一樣；同一格內文字固定', () => {
  const a = new Date(2026, 10, 18, 18, 0).getTime(), b = a + 24 * H;
  assert.notEqual(soupText(a + 5 * STEP, a), soupText(b + 5 * STEP, b));
  assert.equal(soupText(a + 5 * STEP, a), soupText(a + 5 * STEP + STEP - 1000, a));
  assert.ok(eatingText(a + STEP, a).length > 0);
});

test('跑步小人：每格不超過一行的寬度，最後舉手加油', async () => {
  const { runFrames, RUN_CHEERS } = await import('../js/lines.js');
  const f = runFrames(18);
  assert.ok(f.length > 20);
  for (const t of f.filter(x => x.includes('(>_<)'))) assert.ok(t.length <= 18, t);
  assert.ok(f.includes(RUN_CHEERS[0]));
  assert.ok(f[1].startsWith('ε'));
  assert.notEqual(f[2].trim().slice(-7), f[3].trim().slice(-7));   // 姿勢一格一換
  const n = runFrames(12, ['加油！'], 1);
  for (const t of n.filter(x => x.includes('(>_<)'))) assert.ok(t.length <= 12, t);
});

test('五個版本的小人：每一格都不超過寬度，紅綠燈最後倒數到 0', async () => {
  const { runSets, walkerFrames } = await import('../js/lines.js');
  for (const W of [25, 36]) {
    const sets = runSets(W);
    assert.equal(sets.length, 5);
    sets.forEach((f, k) => { assert.ok(f.length >= 10, 'set ' + k); for (const t of f) assert.ok(t.length <= W, k + ':' + t); });
  }
  const w = walkerFrames(25);
  assert.ok(w[0].includes('🚶') && w[0].length > w[5].length);   // 從右往左走
  assert.ok(w.some(t => t.includes('🏃')));                        // 最後小跑步
  assert.ok(w[w.length - 1].startsWith(' 0 '));
});

test('點陣版小人：每格兩行、不超過寬度、只用方塊字和文字', async () => {
  const { pixelSets, pixelLine } = await import('../js/lines.js');
  assert.equal(pixelLine(4, [[['#...', '#..#', '....', '.##.'], 0]]), '█  ▄\n ▄▄');
  for (const W of [25, 36]) {
    const sets = pixelSets(W);
    assert.equal(sets.length, 5);
    sets.forEach((f, k) => {
      assert.ok(f.length >= 10, 'set ' + k);
      for (const t of f) {
        const ls = t.split('\n'); assert.equal(ls.length, 2, k + ':' + t);
        for (const l of ls) assert.ok(l.length <= W, k + ':' + l);
        assert.ok(!/[\u{1F300}-\u{1FAFF}\u2800-\u28FF]/u.test(t), 'no emoji / braille');
      }
    });
  }
});
