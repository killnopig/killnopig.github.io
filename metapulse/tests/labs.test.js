import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labKey, labDate, labValue, parseLabTable, planLabs, applyLabs, labRows, labHistory, normalizeLab } from '../js/labs.js';
import { normalizeState } from '../js/storage.js';

// 全部是假資料
test('常見項目名稱統一，認不得的照原名', () => {
  assert.equal(labKey('Glu-AC'), 'glu');
  assert.equal(labKey('飯前血糖'), 'glu');
  assert.equal(labKey('Glucose (PC)'), 'glupc');
  assert.equal(labKey('HbA1c'), 'hba1c');
  assert.equal(labKey('糖化血色素'), 'hba1c');
  assert.equal(labKey('Hb'), 'hb');
  assert.equal(labKey('LDL-Cholesterol'), 'ldl');
  assert.equal(labKey('T-CHO'), 'chol');
  assert.equal(labKey('總膽固醇'), 'chol');
  assert.equal(labKey('TG'), 'tg');
  assert.equal(labKey('GOT'), 'ast');
  assert.equal(labKey('SGPT'), 'alt');
  assert.equal(labKey('Creatinine'), 'cre');
  assert.equal(labKey('eGFR'), 'egfr');
  assert.equal(labKey('尿微量白蛋白/肌酸酐'), 'uacr');
  assert.equal(labKey('UA'), 'ua');
  assert.equal(labKey('鐵蛋白'), 'x:鐵蛋白');
  assert.equal(labKey(''), '');
});

test('日期寫法', () => {
  assert.equal(labDate('2024/3/5'), '2024-03-05');
  assert.equal(labDate('113/03/05'), '2024-03-05');
  assert.equal(labDate('1130305'), '2024-03-05');
  assert.equal(labDate('20240305'), '2024-03-05');
  assert.equal(labDate('2024年3月5日'), '2024-03-05');
  assert.equal(labDate('45356'), '2024-03-05');   // Excel 日期序號
  assert.equal(labDate('HbA1c'), '');
  assert.equal(labDate('5.6'), '');
});

test('數值', () => {
  assert.equal(labValue('5.6'), 5.6);
  assert.equal(labValue('5.6 H'), 5.6);
  assert.equal(labValue('<0.5'), 0.5);
  assert.equal(labValue('1,234'), 1234);
  assert.equal(labValue('陰性'), '陰性');
  assert.equal(labValue(''), null);
  assert.equal(labValue('-'), null);
});

test('每一列是一次抽血', () => {
  const t = '日期\tGlu-AC\tHbA1c\t鐵蛋白\n2024/3/5\t110\t6.1\t\n2024/6/4\t102 H\t5.9\t80\n備註\t\t\t';
  const r = parseLabTable(t);
  assert.equal(r.err, '');
  assert.deepEqual(r.recs, [{ date: '2024-03-05', v: { glu: 110, hba1c: 6.1 } }, { date: '2024-06-04', v: { glu: 102, hba1c: 5.9, 'x:鐵蛋白': 80 } }]);
  assert.deepEqual(r.keys, ['hba1c', 'glu', 'x:鐵蛋白']);
  assert.equal(r.raw.glu, 'Glu-AC');
});

test('每一列是一個項目（中間有單位欄）', () => {
  const t = '項目\t單位\t113/03/05\t113/06/04\nGlu-AC\tmg/dL\t110\t102\nLDL\tmg/dL\t130\t\nTG\tmg/dL\t180\t150';
  const r = parseLabTable(t);
  assert.deepEqual(r.recs, [{ date: '2024-03-05', v: { glu: 110, ldl: 130, tg: 180 } }, { date: '2024-06-04', v: { glu: 102, tg: 150 } }]);
});

test('找不到日期', () => {
  assert.match(parseLabTable('a\tb\n1\t2').err, /找不到日期/);
  assert.match(parseLabTable('').err, /空/);
});

test('規劃：新日期新增、同一天補上或更新、一樣的略過', () => {
  const labs = [{ id: 'lab2024-03-05', date: '2024-03-05', v: { glu: 110, hba1c: 6.1 } }];
  const recs = [
    { date: '2024-03-05', v: { glu: 110, hba1c: 6.1 } },
    { date: '2024-06-04', v: { glu: 102 } },
  ];
  let p = planLabs(recs, labs);
  assert.equal(p.add.length, 1);
  assert.equal(p.upd.length, 0);
  assert.equal(p.same, 1);
  p = planLabs([{ date: '2024-03-05', v: { glu: 111, ldl: 130 } }], labs);
  assert.deepEqual(p.upd, [{ id: 'lab2024-03-05', date: '2024-03-05', v: { glu: 111, hba1c: 6.1, ldl: 130 } }]);
  assert.equal(p.changed, 1);
  const S = { labs: labs.slice() };
  applyLabs(S, planLabs(recs, labs));
  assert.deepEqual(S.labs.map(x => x.date), ['2024-03-05', '2024-06-04']);
});

test('每個項目和上次比、歷次數字', () => {
  const labs = [
    { id: 'b', date: '2024-06-04', v: { glu: 102, tg: 150 } },
    { id: 'a', date: '2024-03-05', v: { glu: 110, hba1c: 6.1 } },
  ];
  const rows = labRows(labs, '2024-06-04');
  assert.deepEqual(rows, [{ k: 'glu', val: 102, prev: { date: '2024-03-05', val: 110 }, ref: null, flag: null }, { k: 'tg', val: 150, prev: null, ref: null, flag: null }]);
  assert.deepEqual(labHistory(labs, 'glu'), [{ date: '2024-03-05', val: 110 }, { date: '2024-06-04', val: 102 }]);
});

test('存檔整理：壞的不要、會跟著 normalizeState', () => {
  assert.equal(normalizeLab({ date: 'x', v: {} }), null);
  assert.deepEqual(normalizeLab({ date: '2024-03-05', v: { glu: 110, bad: NaN, t: '陰性' } }), { id: 'lab2024-03-05', date: '2024-03-05', v: { glu: 110, t: '陰性' } });
  assert.equal(normalizeState({ labs: [{ date: '2024-03-05', v: { glu: 1 } }] }).labs.length, 1);
  assert.deepEqual(normalizeState({}).labs, []);
});

import { labReportLines, labSummaryLines, labRef, labFlag, shotLabRecs, refText } from '../js/labs.js';
test('回診報告和 AI 摘要的抽血文字', () => {
  const labs = [
    { id: 'a', date: '2024-03-05', v: { glu: 110, hba1c: 6.4 } },
    { id: 'b', date: '2024-06-04', v: { glu: 102, hba1c: 6.0 } },
    { id: 'c', date: '2024-09-03', v: { glu: 99, hba1c: 5.7, 'x:鐵蛋白': 110 } },
  ];
  const r = labReportLines(labs, '2024-07-01', '2024-09-30');
  assert.match(r[0], /抽血 1 次（9\/3），前面附上 2024-06-04/);
  assert.equal(r[1], '  糖化血色素 HbA1c（%）：6（6/4） → 5.7（9/3）');
  assert.equal(r[3], '  鐵蛋白：110（9/3）');
  assert.deepEqual(labReportLines(labs, '2024-10-01', '2024-11-30'), ['- 這段期間沒有抽血；最近一次是 2024-09-03。']);
  assert.deepEqual(labReportLines([], '2024-10-01', '2024-11-30'), []);
  const s = labSummaryLines(labs);
  assert.match(s[0], /共 3 次/);
  assert.equal(s[2], '- 空腹血糖（mg/dL）：2024-03-05 110；2024-06-04 102；2024-09-03 99');
});

test('參考範圍：解析、超出標記、Excel 參考值欄、照片讀取', () => {
  assert.deepEqual(labRef('70-100'), [70, 100]);
  assert.deepEqual(labRef('70 ~ 100 mg/dL'), [70, 100]);
  assert.deepEqual(labRef('<5.7'), [null, 5.7]);
  assert.deepEqual(labRef('≧40'), [40, null]);
  assert.equal(labRef('陰性'), null);
  assert.equal(labFlag(110, [70, 100]), 'hi');
  assert.equal(labFlag(35, [40, null]), 'lo');
  assert.equal(labFlag(90, [70, 100]), null);
  assert.equal(labFlag('陰性', [70, 100]), null);
  assert.equal(refText([70, 100]), '70–100');
  assert.equal(refText([null, 5.7]), '< 5.7');
  const t = '項目\t參考值\t113/03/05\nGlu-AC\t70-100\t110\nHDL\t>40\t45';
  const r = parseLabTable(t);
  assert.deepEqual(r.recs[0].r, { glu: [70, 100], hdl: [40, null] });
  const t2 = '日期\tGlu-AC\tHbA1c\n參考值\t70-100\t<5.7\n2024/3/5\t110\t6.1';
  assert.deepEqual(parseLabTable(t2).recs, [{ date: '2024-03-05', v: { glu: 110, hba1c: 6.1 }, r: { glu: [70, 100], hba1c: [null, 5.7] } }]);
  const s = shotLabRecs({ date: '2024/9/3', items: [{ name: '飯前血糖', value: '99', unit: 'mg/dL', ref: '70-100' }, { name: 'HbA1c', value: '5.7 H', ref: '4.0-5.6' }, { name: '尿蛋白', value: '陰性', ref: '' }] }, '2026-11-27');
  assert.deepEqual(s.recs, [{ date: '2024-09-03', v: { glu: 99, hba1c: 5.7, 'x:尿蛋白': '陰性' }, r: { glu: [70, 100], hba1c: [4, 5.6] } }]);
  assert.equal(s.noDate, false);
  assert.equal(shotLabRecs({ items: [{ name: 'TG', value: '150' }] }, '2026-11-27').recs[0].date, '2026-11-27');
  const rows = labRows([{ id: 'x', date: '2024-09-03', v: { glu: 110 }, r: { glu: [70, 100] } }], '2024-09-03');
  assert.equal(rows[0].flag, 'hi');
  assert.deepEqual(normalizeLab({ date: '2024-09-03', v: { glu: 110 }, r: { glu: [70, 100], bad: [1, 2], tg: 'x' } }).r, { glu: [70, 100] });
  const p = planLabs([{ date: '2024-09-03', v: { glu: 110 }, r: { glu: [70, 100] } }], [{ id: 'lab2024-09-03', date: '2024-09-03', v: { glu: 110 } }]);
  assert.deepEqual(p.upd[0].r, { glu: [70, 100] });
});

test('表格擺法更有彈性：上面有標題列、左邊有編號欄、月/日/年', () => {
  const t = '抽血紀錄\n\n編號\t日期\tGlu-AC\tHbA1c\n1\t2024/3/5\t110\t6.1\n2\t2024/6/4\t102\t5.9';
  assert.deepEqual(parseLabTable(t).recs, [{ date: '2024-03-05', v: { glu: 110, hba1c: 6.1 } }, { date: '2024-06-04', v: { glu: 102, hba1c: 5.9 } }]);
  const t2 = '我的抽血\n類別\t項目\t單位\t3/5/2024\t6/4/2024\n糖尿病\tGlu-AC\tmg/dL\t110\t102\n血脂\tTG\tmg/dL\t180\t150';
  assert.deepEqual(parseLabTable(t2).recs, [{ date: '2024-03-05', v: { glu: 110, tg: 180 } }, { date: '2024-06-04', v: { glu: 102, tg: 150 } }]);
  assert.equal(labDate('03/05/2024'), '2024-03-05');
  assert.equal(labDate('25/12/2024'), '2024-12-25');
});

import { labHints } from '../js/labs.js';
test('抽血提醒：腎功能、降血糖藥', () => {
  const labs = [
    { id: 'a', date: '2024-03-05', v: { hba1c: 6.4, egfr: 80 }, r: { egfr: [60, null] } },
    { id: 'b', date: '2024-09-03', v: { hba1c: 5.9, egfr: 55, cre: 1.0 }, r: { egfr: [60, null], cre: [0.7, 1.3] } },
  ];
  const h1 = labHints(labs, []);
  assert.match(h1.kidney, /eGFR 55（9\/3）/);
  assert.match(h1.kidney, /請先問醫師/);
  assert.equal(h1.glucose, null);           // 沒有降血糖藥
  const h2 = labHints(labs, [{ name: '降血糖藥', glucose: true }]);
  assert.match(h2.glucose, /HbA1c 6.4 → 5.9/);
  assert.deepEqual(labHints([{ id: 'a', date: '2024-03-05', v: { hba1c: 5.9, egfr: 90 }, r: { egfr: [60, null] } }], [{ glucose: true }]), { kidney: null, glucose: null });
  assert.deepEqual(labHints([], []), { kidney: null, glucose: null });
});

test('手機貼上變空白、名稱有數字、擺法猜錯會換另一種', () => {
  const t = '項目  113/03/05  113/06/04\nHbA1c  6.4  6.0\nGlu-AC  118  106\nVit B12  400  420';
  assert.deepEqual(parseLabTable(t).recs, [{ date: '2024-03-05', v: { hba1c: 6.4, glu: 118, 'x:Vit B12': 400 } }, { date: '2024-06-04', v: { hba1c: 6, glu: 106, 'x:Vit B12': 420 } }]);
  const t2 = '日期 HbA1c Glu-AC\n2024/3/5 6.4 118';
  assert.deepEqual(parseLabTable(t2).recs, [{ date: '2024-03-05', v: { hba1c: 6.4, glu: 118 } }]);
  assert.match(parseLabTable('a\tb\n1\t2').err, /找不到日期/);
});

// 照使用者那種擺法編的假表格：日期列少了前面幾格、第一欄空白、名稱＋說明＋參考值、有打錯的日期、比值、《》寫法
test('日期列前面少了幾格也對得齊；比值不當成單一項目；《》參考值', () => {
  const t = [
    '20200101\t20200401\t20200799\t20201001\t',
    '\tGlucose AC空腹血糖\t空腹血糖\t70-100mg/dL\t101\t102\t103\t104\t',
    '\tsGOT某某轉胺酶\t\t《40\t\t\t31\t32\t',
    '\tsGPT某某轉胺酶\t肝指數\t《41\t\t\t\t45\t',
    '\tAlbumin白蛋白\t\t3.5-5.5\t4.1\t4.2\t\t\t',
    '\tA/G白蛋白/球蛋白\t\t1.1-2.5\t1.5\t\t\t\t',
    '\tLDL/HDL\t中風機率\t0-3.3\t2.1\t\t\t\t',
    '\tHDL-choloestrol\t高密度膽固醇\t》=40mg/dL\t35\t\t\t\t',
    '\tBUN尿素氮\t\t‘6-23\t\t\t\t12\t',
  ].join('\n');
  const r = parseLabTable(t);
  assert.equal(r.err, '');
  assert.match(r.warn, /20200799/);
  const by = Object.fromEntries(r.recs.map(x => [x.date, x]));
  assert.deepEqual(by['2020-01-01'].v, { glu: 101, alb: 4.1, hdl: 35, 'x:A/G白蛋白/球蛋白': 1.5, 'x:LDL/HDL': 2.1 });
  assert.deepEqual(by['2020-10-01'].v, { glu: 104, ast: 32, alt: 45, bun: 12 });
  assert.equal(by['2020-04-01'].v.glu, 102);
  assert.equal(r.recs.length, 3);   // 打錯的那一欄沒有匯入
  assert.deepEqual(by['2020-10-01'].r, { glu: [70, 100], ast: [null, 40], alt: [null, 41], bun: [6, 23] });
  assert.deepEqual(by['2020-01-01'].r.hdl, [40, null]);
});
