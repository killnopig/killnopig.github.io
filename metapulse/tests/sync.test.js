import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates, recordDeletes, idsOf, sameData } from '../js/sync.js';

const e = (id, date, wt) => ({ id, date, wt });
const base = (ts, entries, extra = {}) => ({ schema: 1, ts, profile: { height: 175 }, prefs: {}, entries, meals: [], foodLibrary: [], fasts: [], activity: [], deleted: {}, ...extra });

test('APK 的舊資料比較「新」，也不會蓋掉 Chrome 匯入的 11/17', () => {
  const chrome = base(100, [e('a', '2026-11-16', 105.1), e('b', '2026-11-17', 105.3)]);
  const apk = base(200, [e('a', '2026-11-16', 105.1)], { prefs: { fastMode: 'HYBRID_GUIDED' } });
  const m = mergeStates(apk, chrome);
  assert.deepEqual(m.entries.map(x => x.id).sort(), ['a', 'b']);
  assert.equal(m.prefs.fastMode, 'HYBRID_GUIDED', '設定用比較新的那份');
  assert.equal(m.ts, 200);
});

test('同一筆兩邊都改過：用比較新的那份', () => {
  const m = mergeStates(base(100, [e('a', '2026-11-16', 105)]), base(300, [e('a', '2026-11-16', 104)]));
  assert.equal(m.entries[0].wt, 104);
});

test('刪除過的記錄不會被另一邊加回來', () => {
  const S = base(100, [e('a', '2026-11-16', 105), e('b', '2026-11-17', 104)]);
  const before = idsOf(S);
  S.entries = S.entries.filter(x => x.id !== 'b');
  recordDeletes(S, before, 1000);
  assert.ok(S.deleted.b);
  const other = base(50, [e('a', '2026-11-16', 105), e('b', '2026-11-17', 104)]);
  const m = mergeStates(S, other, 2000);
  assert.deepEqual(m.entries.map(x => x.id), ['a']);
});

test('還原「只加入，不刪除」：保留現有記錄、個人資料，不採用存檔的刪除標記', async () => {
  const { addOnly } = await import('../js/sync.js');
  const local = base(500, [e('a', '2026-11-16', 105)], { profile: { height: 175 }, deleted: { z: 1 } });
  const backup = base(900, [e('a', '2026-11-16', 99), e('d1', '2026-10-01', 100)], { profile: { height: 160 }, deleted: { a: 800 } });
  const m = addOnly(local, backup, 1000);
  assert.deepEqual(m.entries.map(x => x.id).sort(), ['a', 'd1']);
  assert.equal(m.entries.find(x => x.id === 'a').wt, 105, '同一筆保留這支手機的');
  assert.equal(m.profile.height, 175);
  assert.deepEqual(m.deleted, { z: 1 });
});

test('餐點、運動消耗也會合併；內容相同判斷', () => {
  const a = base(100, [], { meals: [{ id: 'm1', at: '2026-11-17T04:00:00Z' }], activity: [{ date: '2026-11-16', kcal: 100 }] });
  const b = base(200, [], { meals: [{ id: 'm2', at: '2026-11-17T01:00:00Z' }], activity: [{ date: '2026-11-16', kcal: 150 }, { date: '2026-11-17', kcal: 80 }] });
  const m = mergeStates(a, b);
  assert.deepEqual(m.meals.map(x => x.id), ['m2', 'm1']);
  assert.deepEqual(m.activity.map(x => x.kcal), [150, 80]);
  assert.equal(sameData(m, mergeStates(b, a)), true);
  assert.equal(sameData(m, a), false);
});
