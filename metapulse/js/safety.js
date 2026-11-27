/* 安全提醒與保住肌肉（純函數）：低血糖、剛加劑量、體重掉太快、喝水、一天一餐、每餐蛋白質、肌力次數、副作用。
 * 只產生提醒，不擋任何操作；不是醫療建議。 */
import { SAFETY, STRENGTH } from './config.js';
import { weightTrend } from './longterm.js';
import { addDays } from './points.js';
import { dn } from './records.js';

const minOf = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);

/**
 * 低血糖提醒：有勾「降血糖藥」、正在斷食，而且（斷食超過 16 小時，或今天這顆藥的時間已經到了、斷食在那之前就開始）
 * @param fi {fasting, start, hours}
 * @returns null | {meds:[藥名], ask:[還沒問過能不能空腹吃的藥名], long:boolean}
 */
export function hypoAlert(meds, fi, now = Date.now(), cfg = SAFETY) {
  const gl = (meds || []).filter(m => m && m.name && m.glucose);
  if (!gl.length || !fi || !fi.fasting || !fi.start) return null;
  const d = new Date(now), nowMin = d.getHours() * 60 + d.getMinutes();
  const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const due = gl.filter(m => /^\d{2}:\d{2}$/.test(m.time || '') && minOf(m.time) <= nowMin && fi.start <= dayStart + minOf(m.time) * 60000);
  const long = fi.hours >= cfg.hypoHours;
  if (!long && !due.length) return null;
  const list = long ? gl : due;
  return { meds: list.map(m => m.name), ask: list.filter(m => !m.fastOk).map(m => m.name), long };
}

/**
 * 剛加劑量：最近一次注射比前一次高，且在 14 天內
 * @returns null | {date, from, to, day（加量那天＝第 1 天）, until（最後一天）}
 */
export function doseIncrease(entries, todayStr, cfg = SAFETY) {
  const ds = (entries || []).filter(e => e.dose > 0 && e.date <= todayStr).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // 找最後一次「比前一次高」的注射
  for (let i = ds.length - 1; i > 0; i--) {
    if (ds[i].dose > ds[i - 1].dose) {
      const day = dn(todayStr) - dn(ds[i].date) + 1;
      if (day > cfg.doseUpDays) return null;
      return { date: ds[i].date, from: ds[i - 1].dose, to: ds[i].dose, day, until: addDays(ds[i].date, cfg.doseUpDays - 1) };
    }
  }
  return null;
}

/** 體重掉得比較快（每週超過體重 1.5%）→ 顯示警訊說明 */
export function fastLossAlert(entries, todayStr, cfg = SAFETY) {
  const wt = weightTrend(entries || [], todayStr);
  return wt.weeklyPct !== null && wt.weeklyPct > cfg.fastLossPct ? { pct: Math.round(wt.weeklyPct * 10) / 10 } : null;
}
export const WARNING_SIGNS = ['持續或很嚴重的肚子痛（尤其痛到背後）', '一直吐、喝水也吐，或尿很少', '右上腹痛、發燒、皮膚或眼白變黃', '解黑便或吐出咖啡色的東西', '頭暈到站不穩、心跳很快、昏昏沉沉'];

/** 斷食超過 12 小時：提醒喝水 */
export const waterHint = (hours, cfg = SAFETY) => hours >= cfg.waterHours;

/** 選了一天一餐、而且近 14 天有打針 */
export function omadWarn(prefs, entries, todayStr, cfg = SAFETY) {
  if ((prefs || {}).fastMode !== 'STRICT_MANUAL' || (prefs.strictPlan || '16:8') !== '24H') return false;
  const from = addDays(todayStr, -(cfg.omadDoseDays - 1));
  return (entries || []).some(e => e.dose > 0 && e.date >= from && e.date <= todayStr);
}

/** 一餐蛋白質偏少（還沒吃的不算） */
export const lowProteinMeal = (protein, cfg = SAFETY) => (+protein || 0) < cfg.mealProteinLow;

/** 近 7 天（含今天）肌力訓練次數 */
export function strengthCount(exercise, todayStr) {
  const from = addDays(todayStr, -6);
  return (exercise || []).filter(x => STRENGTH.includes(x.type) && x.date >= from && x.date <= todayStr).length;
}

/* ---------- 副作用 ---------- */
export const SYMPTOMS = [['nausea', '噁心'], ['constip', '便秘'], ['diarrhea', '腹瀉'], ['appetite', '沒食慾'], ['tired', '疲倦']];
export const LEVELS = ['無', '輕', '中', '重'];
/** 每天一筆，id 固定（同一天在兩支手機記也會合成一筆） */
export const symptomId = date => 'sx' + date;
export function normalizeSymptom(x) {
  if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return null;
  const o = { id: symptomId(x.date), date: x.date };
  for (const [k] of SYMPTOMS) o[k] = Math.max(0, Math.min(3, Math.round(+x[k] || 0)));
  return o;
}
/** 期間內每項：記了幾天、平均、最高（和那天） */
export function symptomStats(list, from, to) {
  const rows = (list || []).filter(x => x.date >= from && x.date <= to);
  return {
    days: rows.length,
    items: SYMPTOMS.map(([k, name]) => {
      const v = rows.map(x => +x[k] || 0), max = Math.max(0, ...v), at = rows.find(x => (+x[k] || 0) === max && max > 0);
      return { key: k, name, avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0, max, maxDate: at ? at.date : '', hit: v.filter(x => x > 0).length };
    }),
  };
}

/**
 * 點數和體重步調：每日點數低於保底（目標設太快）、趨勢體重每週掉太快／太慢／剛好
 * b = plan()；回傳 null（沒預算）或 { low, daily, floor, pct, level: 'fast'|'slow'|'ok'|null, line, advice: [段落] }
 */
export function paceAdvice(b, entries, todayStr, cfg = SAFETY) {
  if (!b || !b.ok) return null;
  const low = b.dailyPoints < b.floorPoints;
  const wt = weightTrend(entries || [], todayStr);
  const pct = wt.weeklyPct === null ? null : Math.round(wt.weeklyPct * 10) / 10;
  const level = pct === null ? null : pct > cfg.paceFastPct ? 'fast' : pct < cfg.paceSlowPct ? 'slow' : 'ok';
  if (!low && !level) return null;
  const sp = pct === null ? '' : '體重每週' + (pct >= 0 ? ' −' + pct : ' +' + -pct) + '%';
  const goal = Math.round(b.weeklyLossPct * 10) / 10;
  const line = low ? '⚠ 每天 ' + b.dailyPoints + ' 點＜保底 ' + b.floorPoints + (sp ? '・' + sp : '')
    : sp + (level === 'fast' ? '，偏快' : level === 'slow' ? '，偏慢' : '，步調剛好');
  const advice = [];
  if (low) advice.push('你的每日點數（' + b.dailyPoints + '）比保底（' + b.floorPoints + '，約等於基礎代謝）還低，這是目前設定的減重目標造成的。長期吃得比基礎代謝少，比較容易流失肌肉、疲倦、掉頭髮，這個風險要自己評估。想提高點數，可以到「設定 → 個人資料與每日預算」把「預計達成週數」改長。');
  if (level === 'fast') advice.push('最近一週趨勢體重掉了約 ' + pct + '%，比每週 ' + cfg.paceFastPct + '% 快（目標是 ' + goal + '%）。剛開始的幾週常是水分；持續太快的話，建議把目標調慢或至少吃到保底，蛋白質吃夠、做肌力訓練，比較能保住肌肉。');
  if (level === 'slow') advice.push('最近一週趨勢體重' + (pct >= 0 ? '只少了約 ' + pct : '多了約 ' + -pct) + '%（目標是 ' + goal + '%）。先檢查有沒有漏記（飲料、醬料、零食、試吃），份量有沒有估太少；記錄完整的話，可以把「每天消耗用」改成「依我的記錄」，讓 App 照你的實際狀況重算點數。');
  if (level === 'ok') advice.push('最近一週趨勢體重掉了約 ' + pct + '%，在每週 ' + cfg.paceSlowPct + '～' + cfg.paceFastPct + '% 之間，照現在的步調就好。');
  advice.push('體重用最近 14 天平均和 7 天前的 14 天平均比，不看單日。這只是提醒，有不舒服請問醫師。');
  return { low, daily: b.dailyPoints, floor: b.floorPoints, pct, level, line, advice };
}

/**
 * 肌力訓練提醒（飲食運動頁）：近 7 天肌力訓練不到目標就提醒；整週都沒記運動另外說
 * 只看自己記的運動（Health Connect 的手機活動量不算）
 */
export function moveAdvice(exercise, todayStr, cfg = SAFETY) {
  const sc = strengthCount(exercise, todayStr), goal = cfg.strengthGoal;
  if (sc >= goal) return null;
  const from = addDays(todayStr, -6);
  const days = new Set((exercise || []).filter(x => x.date >= from && x.date <= todayStr).map(x => x.date)).size;
  const line = days ? '💪 肌力 ' + sc + '/' + goal + '：走路、打球不會長肌肉' : '💪 這 7 天沒有運動・肌力 ' + sc + '/' + goal;
  const advice = [];
  if (!days) advice.push('這 7 天都沒有記到運動。減重時身體會同時掉脂肪和肌肉，完全不動的話掉的肌肉會比較多，代謝也比較容易變慢。');
  advice.push('走路、打籃球、高爾夫對心肺、消耗熱量都很好，但不太會增加肌肉。想在減重時保住肌肉，每週至少 ' + goal + ' 次肌力訓練（重量訓練、彈力帶、徒手深蹲或伏地挺身），再加上吃夠蛋白質。');
  advice.push('記運動時選「重量訓練」「彈力帶」「徒手（深蹲、伏地挺身）」就會算進「肌力」。這只是提醒；有心血管疾病、關節問題，開始重訓前先問醫師。');
  return { strength: sc, goal, days, line, advice };
}
