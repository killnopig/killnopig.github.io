import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, mapColumns, planOmron } from '../js/omron.js';
import { buildSummary, dailyFast, dailyFood } from '../js/summary.js';
import { backupReminder } from '../js/sync.js';

const BP = '﻿測量日期,時間,收縮壓(mmHg),舒張壓(mmHg),脈搏(bpm),檢測到不規則脈波,身體晃動\n'
  + '2026/11/16,07:30,128,82,70,已偵測,\n2026/11/16,21:05,"121",78,66,,\n2026/11/17,07:31,125,80,68,,\n';
const BODY = '測量日期\t體重(kg)\t體脂肪(%)\t骨骼肌(%)\t內臟脂肪等級\t身體年齡\t基礎代謝(kcal)\n'
  + '2026/11/16 07:40\t105.2\t32.1\t28.0\t14\t55\t1980\n2026/11/17 07:42\t104.9\t31.9\t28.1\t14\t55\t1975\n';

test('CSV 解析：BOM、引號、Tab', () => {
  const r = parseCSV(BP);
  assert.equal(r.length, 4);
  assert.equal(r[2][2], '121');
  const m = mapColumns(parseCSV(BODY)[0]);
  assert.equal(m.fat, 2); assert.equal(m.mus, 3); assert.equal(m.bmr, 6);
});

test('Omron：多檔、重複略過、體重補上體組成', () => {
  const existing = [
    { id: 'a', date: '2026-11-16', time: '07:31', sys: 128, dia: 82, pul: 70 },   // 時間差 1 分鐘 → 同一筆
    { id: 'b', date: '2026-11-17', time: '07:42', wt: 104.9, sys: 0 },             // 只有體重 → 補體組成
  ];
  const { info, plan } = planOmron([{ name: 'bp.csv', text: BP }, { name: 'body.tsv', text: BODY }, { name: 'x.csv', text: 'a,b\n1,2\n' }], existing);
  assert.equal(info[0].type, '血壓'); assert.equal(info[0].rows, 3);
  assert.equal(info[1].type, '體重／體組成');
  assert.match(info[2].err, /看不懂/);
  assert.equal(plan.dup, 1);
  assert.equal(plan.add.length, 3);           // 兩筆血壓＋11/16 體重
  assert.equal(plan.merge.length, 1);
  assert.equal(plan.merge[0].fill.fat, 31.9);
  assert.equal(plan.add.find(r => r.time === '21:05').src, 'omron');
  const again = planOmron([{ name: 'bp.csv', text: BP }], [...existing, ...plan.add]);
  assert.equal(again.plan.add.length, 0, '再匯入一次全部略過');
});

test('Omron：不規則脈波寫進備註、磅換公斤', () => {
  const { plan } = planOmron([{ name: 'a.csv', text: BP }, { name: 'lb.csv', text: 'Date,Weight(lb)\n2026-11-10,220\n' }], []);
  assert.match(plan.add.find(r => r.sys === 128).note, /不規則脈波/);
  assert.equal(plan.add.find(r => r.wt > 0).wt, 99.8);
});

const at = (d, hh, mm = 0) => new Date(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8), hh, mm).toISOString();

test('斷食時數：兩餐之間，按過結束進餐／結束斷食就用那個時間', () => {
  const meals = [
    { id: '1', group: 'A', at: at('2026-11-15', 19, 0) }, { id: '2', group: 'A', at: at('2026-11-15', 19, 30) },
    { id: '3', group: 'B', at: at('2026-11-16', 12, 0) },
    { id: '4', group: 'C', at: at('2026-11-16', 18, 0) },
    { id: '5', group: 'D', at: at('2026-11-17', 14, 0) },
  ];
  const fasts = [{ start: at('2026-11-16', 20, 0), end: at('2026-11-17', 13, 0) }];
  const r = dailyFast(meals, fasts);
  assert.equal(r['2026-11-16'], 16.5);       // 19:30 → 12:00（下午那段 6 小時比較短）
  assert.equal(r['2026-11-17'], 17);         // 結束進餐 20:00 → 結束斷食 13:00
});

test('數據摘要包含飲食與斷食', () => {
  const meals = [], es = [];
  for (let i = 1; i <= 10; i++) {
    const d = '2026-11-' + String(17 - i).padStart(2, '0');
    meals.push({ id: 'l' + i, group: 'L' + i, at: at(d, 12), points: 20, kcal: 800, protein: 50, carb: 60, fat: 30, fiber: 5 });
    meals.push({ id: 'd' + i, group: 'D' + i, at: at(d, 19), points: 15, kcal: 600, protein: 40, carb: 50, fat: 20, fiber: 4 });
    es.push({ id: 'e' + i, date: d, wt: 105 - i * 0.1 });
  }
  const S = { entries: es, meals, fasts: [], activity: [{ date: '2026-11-16', kcal: 320 }], profile: { height: 175, targetWeight: 85 } };
  const P = { ok: true, dailyPoints: 50, poolPoints: 350, floorPoints: 45, proteinTarget: 100, tdee: 2600 };
  const t = buildSummary(S, P, '2026-11-17');
  assert.match(t, /請不要做診斷/);
  assert.match(t, /近 7 天：7 天有記錄，平均每天 35\.0 點、1400 大卡、蛋白質 90 g/);
  assert.match(t, /低於每日保底 45 點的有 10 天/);
  assert.match(t, /■ 斷食/);
  assert.match(t, /平均 17\.0 小時/);
  assert.match(t, /運動 320 大卡/);
  assert.match(t, /每週摘要/);
  assert.doesNotMatch(buildSummary(S, P, '2026-11-17', false), /請不要做診斷/);
  assert.equal(dailyFood(meals)['2026-11-16'].meals, 2);
});

test('備份提醒：有新記錄且超過天數才提醒，今天按掉就不再出現', () => {
  const now = Date.UTC(2026, 10, 17), S = { entries: [{}], meals: [], ts: now - 1000 };
  assert.equal(backupReminder(S, { backupDays: 7, lastBackup: now - 8 * 864e5 }, now, '2026-11-17').show, true);
  assert.equal(backupReminder(S, { backupDays: 7, lastBackup: now - 3 * 864e5 }, now).show, false);
  assert.equal(backupReminder(S, { backupDays: 0, lastBackup: 0 }, now).show, false);
  assert.equal(backupReminder({ ...S, ts: now - 9 * 864e5 }, { backupDays: 7, lastBackup: now - 8 * 864e5 }, now).show, false, '備份後沒有新記錄');
  assert.equal(backupReminder(S, { backupDays: 7, lastBackup: 0, bkHide: '2026-11-17' }, now, '2026-11-17').show, false);
  assert.equal(backupReminder(S, { lastBackup: 0 }, now).never, true);
});

test('各類記錄最新日期', async () => {
  const { latestByType, latestText } = await import('../js/records.js');
  const es = [
    { date: '2026-11-16', time: '07:10', wt: 105.1 }, { date: '2026-11-17', time: '06:57', wt: 105.3, fat: 28 },
    { date: '2026-11-17', time: '06:59', sys: 116, dia: 77 }, { date: '2026-11-16', dose: 10 },
  ];
  assert.deepEqual(latestByType(es).wt, { date: '2026-11-17', time: '06:57' });
  assert.equal(latestText(es), '體重 11/17 06:57・血壓 11/17 06:59・注射 11/16・體組成 11/17 06:57');
  assert.equal(latestText([]), '');
});

test('淨體重趨勢：28 天平均明顯下滑且蛋白質不足才提醒', async () => {
  const { leanTrend } = await import('../js/longterm.js');
  const { addDays } = await import('../js/points.js');
  const today = '2026-11-30', es = [], ms = [];
  for (let i = 0; i < 56; i++) {
    const d = addDays(today, -i), lean = i < 28 ? 68 : 70;      // 最近 28 天淨體重少約 2.9%
    es.push({ date: d, wt: 100, fat: 100 - lean });
    if (i >= 1 && i <= 20) ms.push({ at: new Date(d + 'T12:00:00').toISOString(), protein: 70 });
  }
  let t = leanTrend(es, ms, 100, today);
  assert.equal(t.ready, true);
  assert.ok(Math.abs(t.change + 2) < 1e-9);
  assert.equal(t.falling, true);
  assert.equal(t.protein, 70);
  assert.equal(t.alert, true);
  assert.equal(leanTrend(es, ms, 60, today).alert, false, '蛋白質有達標就不提醒');
  assert.equal(leanTrend(es, ms.slice(0, 5), 100, today).alert, false, '餐點記錄太少不判斷蛋白質');
  assert.equal(leanTrend(es.slice(0, 20), ms, 100, today).ready, false, '前一段資料不夠');
});

test('淨體重：-0.1 kg 算持平；減掉的重量裡脂肪佔多少', async () => {
  const { leanTrend, leanSummary } = await import('../js/longterm.js');
  const { addDays } = await import('../js/points.js');
  const today = '2026-11-30', es = [];
  for (let i = 0; i < 56; i++) {
    const wt = i < 28 ? 103 : 105, lean = i < 28 ? 74.9 : 75.0;   // 體重 −2、淨體重 −0.1
    es.push({ date: addDays(today, -i), wt, fat: (1 - lean / wt) * 100 });
  }
  const t = leanTrend(es, [], 100, today);
  assert.equal(t.level, 'flat');
  assert.ok(Math.abs(t.wtChange + 2) < 1e-9);
  assert.ok(Math.abs(t.fatChange + 1.9) < 1e-9);
  assert.equal(t.share, 'good');
  const s = leanSummary(t);
  assert.equal(s.line, '淨體重 28 天：−0.1 kg・幾乎持平 ✓');
  assert.match(s.lost, /體重平均少了 2\.0 kg：脂肪少 1\.9 kg、淨體重少 0\.1 kg → 減掉的重量約 95% 是脂肪/);
  assert.equal(s.tone, 'good');
});

test('兩餐相隔超過 48 小時視為漏記，不算斷食', () => {
  const meals = [{ id: '1', at: at('2026-11-01', 19) }, { id: '2', at: at('2026-11-10', 12) }, { id: '3', at: at('2026-11-11', 8) }];
  const r = dailyFast(meals, []);
  assert.equal(r['2026-11-10'], undefined);
  assert.equal(r['2026-11-11'], 20);
});

test('淨體重資料不夠時，估計還要幾天', async () => {
  const { leanTrend } = await import('../js/longterm.js');
  const { addDays } = await import('../js/points.js');
  const today = '2026-11-17', es = [];
  for (let i = 0; i < 30; i++) es.push({ date: addDays(today, -i), wt: 100, fat: 30 });   // 10/19 起每天量
  const t = leanTrend(es, [], 100, today);
  assert.equal(t.ready, false);
  assert.equal(t.readyIn, 4);   // 第 6 天是 10/24，滿 28 天是 11/21
});
