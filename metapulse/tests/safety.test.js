import test from 'node:test';
import assert from 'node:assert/strict';
import { proteinGoal } from '../js/points.js';
import { hypoAlert, doseIncrease, omadWarn, strengthCount, lowProteinMeal, waterHint, symptomStats, normalizeSymptom, fastLossAlert } from '../js/safety.js';
import { hybridWeek, hybridSuggestion } from '../js/fasting.js';
import { normalizeState } from '../js/storage.js';
import { mergeStates, COLS } from '../js/sync.js';
import { doctorReport } from '../js/report.js';

const H = 3600000;

test('蛋白質目標：體重超過理想體重用調整體重；沒身高用實際體重', () => {
  const a = proteinGoal(120, 175);
  assert.equal(a.adjusted, true);
  assert.equal(a.target, 106);            // 理想 67.4、調整 88.4 × 1.2
  assert.equal(proteinGoal(60, 175).target, 72);    // 比理想體重輕：用實際
  assert.equal(proteinGoal(120, 0).target, 144);    // 沒身高
  assert.ok(proteinGoal(120, 175, 1.5).target > 106);
  // 連續：體重剛好跨過理想體重不會跳
  const ibw = 22 * 1.75 * 1.75;
  assert.ok(Math.abs(proteinGoal(ibw + 0.01, 175).target - proteinGoal(ibw - 0.01, 175).target) <= 1);
});

test('低血糖提醒：降血糖藥＋斷食中，到吃藥時間或超過 16 小時', () => {
  const meds = [{ id: 'a', name: '降糖藥', time: '19:00', glucose: true }, { id: 'b', name: '維他命', time: '08:00' }];
  const now = new Date(2026, 10, 19, 19, 30).getTime();
  const fi = start => ({ fasting: true, start, hours: (now - start) / H });
  const r = hypoAlert(meds, fi(new Date(2026, 10, 19, 14, 0).getTime()), now);
  assert.deepEqual(r.meds, ['降糖藥']); assert.deepEqual(r.ask, ['降糖藥']); assert.equal(r.long, false);
  // 斷食在吃藥時間之後才開始、也還沒 16 小時：不提醒
  assert.equal(hypoAlert(meds, fi(new Date(2026, 10, 19, 19, 10).getTime()), now), null);
  // 超過 16 小時
  assert.equal(hypoAlert(meds, fi(now - 17 * H), new Date(2026, 10, 19, 12, 0).getTime() + 0 * H) && true, true);
  // 問過醫師：不再提醒去問
  assert.deepEqual(hypoAlert([{ ...meds[0], fastOk: true }], fi(now - 17 * H), now).ask, []);
  // 沒勾降血糖藥、沒在斷食：不提醒
  assert.equal(hypoAlert([meds[1]], fi(now - 20 * H), now), null);
  assert.equal(hypoAlert(meds, { fasting: false }, now), null);
});

test('剛加劑量：最近一次比前一次高、14 天內', () => {
  const es = [{ date: '2026-11-01', dose: 2.5 }, { date: '2026-11-08', dose: 2.5 }, { date: '2026-11-15', dose: 5 }];
  const u = doseIncrease(es, '2026-11-19');
  assert.equal(u.day, 5); assert.equal(u.from, 2.5); assert.equal(u.to, 5); assert.equal(u.until, '2026-11-28');
  assert.equal(doseIncrease(es, '2026-11-29'), null);
  assert.equal(doseIncrease(es.slice(0, 2), '2026-11-10'), null);
  // 加量後又打了一次同劑量：還是從加量那天算
  assert.equal(doseIncrease([...es, { date: '2026-11-22', dose: 5 }], '2026-11-23').day, 9);
});

test('依施打週期：剛加劑量改成 16:8 並標記；自己排過的只標記', () => {
  const es = [{ date: '2026-11-08', dose: 2.5 }, { date: '2026-11-15', dose: 5 }];
  const up = doseIncrease(es, '2026-11-16');
  const w = hybridWeek(es, '2026-11-16', { doseUp: up });
  assert.equal(w.find(x => x.today).plan, '16:8');
  assert.ok(w.every(x => x.up));
  assert.equal(w[0].plan, '18:6');   // 今天以前的不改
  const c = hybridWeek(es, '2026-11-16', { doseUp: up, custom: true });
  assert.equal(c.find(x => x.today).plan, '18:6');
  assert.ok(c.find(x => x.today).up);
  assert.equal(hybridSuggestion(es, '2026-11-16', { doseUp: up }).plan, '16:8');
  assert.equal(hybridSuggestion(es, '2026-11-16', { doseUp: up, custom: true }).plan, '18:6');
});

test('一天一餐提醒、每餐蛋白質、喝水、肌力次數', () => {
  const es = [{ date: '2026-11-10', dose: 5 }];
  assert.equal(omadWarn({ fastMode: 'STRICT_MANUAL', strictPlan: '24H' }, es, '2026-11-19'), true);
  assert.equal(omadWarn({ fastMode: 'STRICT_MANUAL', strictPlan: '24H' }, es, '2026-11-30'), false);
  assert.equal(omadWarn({ fastMode: 'STRICT_MANUAL', strictPlan: '16:8' }, es, '2026-11-19'), false);
  assert.equal(lowProteinMeal(19), true); assert.equal(lowProteinMeal(25), false);
  assert.equal(waterHint(11.9), false); assert.equal(waterHint(12), true);
  const ex = [{ date: '2026-11-19', type: 'weights' }, { date: '2026-11-14', type: 'band' }, { date: '2026-11-12', type: 'bodyweight' }, { date: '2026-11-18', type: 'walk' }];
  assert.equal(strengthCount(ex, '2026-11-19'), 2);
});

test('體重掉太快：每週超過 1.5% 才顯示警訊', () => {
  const es = [];
  for (let i = 0; i < 21; i++) { const d = new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10); es.push({ date: d, wt: 100 - i * 0.3 }); }
  assert.ok(fastLossAlert(es, '2026-11-21').pct > 1.5);
  const slow = es.map((e, i) => ({ ...e, wt: 100 - i * 0.1 }));
  assert.equal(fastLossAlert(slow, '2026-11-21'), null);
});

test('副作用：每天一筆、0～3，會同步合併', () => {
  assert.deepEqual(normalizeSymptom({ date: '2026-11-19', nausea: 5, tired: -1 }), { id: 'sx2026-11-19', date: '2026-11-19', nausea: 3, constip: 0, diarrhea: 0, appetite: 0, tired: 0 });
  assert.ok(COLS.includes('symptoms'));
  const s = normalizeState({ symptoms: [{ date: '2026-11-19', nausea: 2 }, { date: 'x' }] });
  assert.equal(s.symptoms.length, 1);
  const a = { ts: 1, symptoms: [{ id: 'sx2026-11-18', date: '2026-11-18', nausea: 1 }] }, b = { ts: 2, symptoms: [{ id: 'sx2026-11-18', date: '2026-11-18', nausea: 3 }, { id: 'sx2026-11-19', date: '2026-11-19', nausea: 0 }] };
  const m = mergeStates(a, b);
  assert.equal(m.symptoms.length, 2); assert.equal(m.symptoms.find(x => x.date === '2026-11-18').nausea, 3);
  const st = symptomStats(m.symptoms, '2026-11-01', '2026-11-19');
  assert.equal(st.days, 2); assert.equal(st.items[0].max, 3); assert.equal(st.items[0].hit, 1);
});

test('回診報告：期間內的重點', () => {
  const at = (d, hh) => new Date(d + 'T' + String(hh).padStart(2, '0') + ':00:00').toISOString();
  const S = {
    profile: { height: 175, targetWeight: 80 },
    entries: [{ date: '2026-10-01', wt: 110, fat: 35 }, { date: '2026-11-18', wt: 104, fat: 33, sys: 128, dia: 82, pul: 70 }, { date: '2026-10-25', dose: 2.5 }, { date: '2026-11-15', dose: 5, site: '左腹' }],
    meals: [{ id: 'm1', group: 'g1', at: at('2026-11-17', 12), kcal: 600, protein: 15, points: 15 }, { id: 'm2', group: 'g2', at: at('2026-11-17', 18), kcal: 700, protein: 40, points: 18 }],
    fasts: [{ id: 'f1', start: at('2026-11-16', 19), end: at('2026-11-17', 12) }],
    symptoms: [{ id: 'sx2026-11-16', date: '2026-11-16', nausea: 2, constip: 0, diarrhea: 0, appetite: 1, tired: 0 }],
    exercise: [{ id: 'x1', date: '2026-11-18', type: 'weights', minutes: 30, kcal: 100 }],
    medLog: [{ id: 'k1', med: 'rx1', date: '2026-11-18', at: at('2026-11-18', 19) }],
    prefs: { meds: [{ id: 'rx1', name: '降糖藥', time: '19:00', glucose: true, since: '2026-11-17' }] },
  };
  const t = doctorReport(S, { ok: true, proteinTarget: 100 }, '2026-11-19', 8);
  assert.match(t, /最近 8 週/);
  assert.match(t, /變化 −6\.0 kg/);
  assert.match(t, /2\.5 mg × 1.*5 mg × 1/);
  assert.match(t, /噁心：1 天有，最嚴重「中」/);
  assert.match(t, /少於 20 g 的有 1／2 餐/);
  assert.match(t, /降糖藥（19:00，降血糖藥）：記到吃藥 1／3 天/);
  assert.match(t, /肌力訓練 1 次/);
  assert.match(t, /1 次，平均 17\.0 小時/);
  assert.match(doctorReport(S, null, '2026-11-19', 4), /最近 4 週/);
});
