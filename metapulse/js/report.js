/* 回診報告（純文字、純函數）：最近 4／8／12 週的重點，給醫師看；勾「給 AI 用」時接在 AI 說明和完整數據前面 */
import { sortEntries, dn, leanMass } from './records.js';
import { addDays, localDate } from './points.js';
import { fastSegments } from './fasting.js';
import { dailyFood } from './summary.js';
import { symptomStats, strengthCount, LEVELS } from './safety.js';
import { SAFETY, STRENGTH } from './config.js';
import { labReportLines } from './labs.js';

const f = (n, d = 1) => (+n).toFixed(d);
const sg = (n, d = 1) => { const r = +(+n).toFixed(d); return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r).toFixed(d); };
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const md = s => +s.slice(5, 7) + '/' + +s.slice(8, 10);

/**
 * @param S 狀態；P plan()；today 'YYYY-MM-DD'；weeks 4／8／12
 */
export function doctorReport(S, P, today, weeks = 8) {
  const from = addDays(today, -(weeks * 7 - 1)), inR = d => d >= from && d <= today;
  const es = sortEntries(S.entries || []).filter(e => inR(e.date)), out = [];
  const pf = S.profile || {}, HT = +pf.height || 0;
  out.push('【MetaPulse 回診摘要】最近 ' + weeks + ' 週（' + from + ' 到 ' + today + '）');
  const basic = [];
  if (HT) basic.push('身高 ' + HT + ' cm');
  if (+pf.targetWeight) basic.push('目標體重 ' + pf.targetWeight + ' kg');
  if (basic.length) out.push(basic.join('・'));

  // 體重
  const byDay = {}; es.filter(e => e.wt > 0).forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e.wt));
  const wd = Object.keys(byDay).sort();
  out.push(''); out.push('■ 體重');
  if (wd.length >= 2) {
    const a = avg(byDay[wd[0]]), b = avg(byDay[wd[wd.length - 1]]), wk = (dn(wd[wd.length - 1]) - dn(wd[0])) / 7;
    out.push('- ' + md(wd[0]) + ' ' + f(a) + ' kg → ' + md(wd[wd.length - 1]) + ' ' + f(b) + ' kg，變化 ' + sg(b - a) + ' kg（' + sg((b - a) / a * 100) + '%）' + (wk >= 1 ? '，平均每週 ' + sg((b - a) / wk, 2) + ' kg' : '') + '。');
    if (HT) out.push('- BMI ' + f(a / (HT / 100) ** 2) + ' → ' + f(b / (HT / 100) ** 2) + '。');
  } else out.push('- 這段期間體重記錄不到 2 天。');
  const bc = es.filter(e => e.wt > 0 && e.fat > 0);
  if (bc.length >= 2) {
    const a = bc[0], b = bc[bc.length - 1];
    out.push('- 體脂率 ' + f(a.fat) + '% → ' + f(b.fat) + '%；淨體重（體重 ×（1 − 體脂率），體脂計估算）' + f(leanMass(a)) + ' → ' + f(leanMass(b)) + ' kg（' + sg(leanMass(b) - leanMass(a)) + ' kg）。');
  }

  // 注射
  const allDose = sortEntries(S.entries || []).filter(e => e.dose > 0), ds = allDose.filter(e => inR(e.date));
  if (allDose.length) {
    out.push(''); out.push('■ 注射');
    if (ds.length) {
      const runs = []; ds.forEach(e => { const r = runs[runs.length - 1]; if (r && r.dose === e.dose) { r.to = e.date; r.n++; } else runs.push({ dose: e.dose, from: e.date, to: e.date, n: 1 }); });
      out.push('- 共 ' + ds.length + ' 次：' + runs.map(r => r.dose + ' mg × ' + r.n + '（' + md(r.from) + (r.to !== r.from ? '～' + md(r.to) : '') + '）').join('，') + '。');
    } else out.push('- 這段期間沒有注射記錄。');
    const last = allDose[allDose.length - 1];
    out.push('- 最近一次 ' + md(last.date) + ' ' + last.dose + ' mg' + (last.site ? '（' + last.site + '）' : '') + '，距今 ' + (dn(today) - dn(last.date)) + ' 天。');
  }

  // 副作用
  const sx = symptomStats(S.symptoms, from, today);
  out.push(''); out.push('■ 副作用（自己記，0 無～3 重）');
  if (sx.days) {
    out.push('- 記了 ' + sx.days + ' 天。');
    const hit = sx.items.filter(x => x.hit);
    if (hit.length) hit.forEach(x => out.push('- ' + x.name + '：' + x.hit + ' 天有，最嚴重「' + LEVELS[x.max] + '」（' + md(x.maxDate) + '），平均 ' + f(x.avg) + '。'));
    else out.push('- 有記錄的日子都沒有不舒服。');
  } else out.push('- 沒有記錄。');

  // 血壓
  const bs = es.filter(e => e.sys > 0 && e.dia > 0);
  if (bs.length) {
    const ps = bs.filter(e => e.pul > 0), hi = bs.reduce((a, b) => (b.sys > a.sys ? b : a));
    out.push(''); out.push('■ 血壓');
    out.push('- ' + bs.length + ' 次，平均 ' + f(avg(bs.map(e => e.sys)), 0) + '/' + f(avg(bs.map(e => e.dia)), 0) + ' mmHg' + (ps.length ? '，脈搏 ' + f(avg(ps.map(e => e.pul)), 0) : '') + '；最高 ' + hi.sys + '/' + hi.dia + '（' + md(hi.date) + '）。');
  }

  // 抽血
  const lab = labReportLines(S.labs, from, today);
  if (lab.length) { out.push(''); out.push('■ 抽血檢查（照報告的數字）'); lab.forEach(x => out.push(x)); }

  // 飲食
  const food = dailyFood((S.meals || []).filter(m => !m.pending)), fd = Object.keys(food).filter(d => inR(d) && d < today).sort();
  out.push(''); out.push('■ 飲食（熱量、營養素為照片或文字估算）');
  if (fd.length) {
    const x = k => avg(fd.map(d => food[d][k]));
    out.push('- 有記錄 ' + fd.length + ' 天，平均每天 ' + f(x('kcal'), 0) + ' 大卡、蛋白質 ' + f(x('protein'), 0) + ' g' + (P && P.ok ? '（目標 ' + P.proteinTarget + ' g，達到的 ' + fd.filter(d => food[d].protein >= P.proteinTarget).length + ' 天）' : '') + '、' + f(x('meals')) + ' 餐。');
    const groups = {}; (S.meals || []).filter(m => !m.pending && inR(localDate(m.at))).forEach(m => { const g = m.group || m.id; groups[g] = (groups[g] || 0) + (+m.protein || 0); });
    const gv = Object.values(groups);
    if (gv.length) out.push('- 每餐蛋白質少於 ' + SAFETY.mealProteinLow + ' g 的有 ' + gv.filter(v => v < SAFETY.mealProteinLow).length + '／' + gv.length + ' 餐。');
  } else out.push('- 沒有記錄。');

  // 斷食
  const segs = fastSegments(S.fasts).filter(x => inR(localDate(new Date(x.end))));
  if (segs.length) {
    out.push(''); out.push('■ 斷食（自己按開始、結束）');
    const hs = segs.map(x => x.hours);
    out.push('- ' + segs.length + ' 次，平均 ' + f(avg(hs)) + ' 小時，最長 ' + f(Math.max(...hs)) + ' 小時；超過 20 小時 ' + hs.filter(v => v > 20).length + ' 次。');
  }

  // 用藥
  const meds = (S.prefs && S.prefs.meds || []).filter(m => m && m.name);
  if (meds.length) {
    out.push(''); out.push('■ 每天的藥');
    for (const m of meds) {
      const since = m.since && m.since > from ? m.since : from, days = Math.max(0, dn(today) - dn(since) + 1);
      const took = new Set((S.medLog || []).filter(x => x.med === m.id && x.date >= since && x.date <= today).map(x => x.date)).size;
      out.push('- ' + m.name + '（' + m.time + (m.glucose ? '，降血糖藥' : '') + '）：記到吃藥 ' + took + '／' + days + ' 天。');
    }
  }

  // 運動
  const ex = (S.exercise || []).filter(x => inR(x.date)), st = ex.filter(x => STRENGTH.includes(x.type));
  out.push(''); out.push('■ 運動');
  out.push('- 手動記錄 ' + ex.length + ' 次，其中肌力訓練 ' + st.length + ' 次（平均每週 ' + f(st.length / weeks) + ' 次）；近 7 天肌力 ' + strengthCount(S.exercise, today) + ' 次。');

  out.push('');
  out.push('※ 使用者自行記錄；淨體重、熱量、營養素都是估算，不是診斷依據。');
  return out.join('\n');
}
