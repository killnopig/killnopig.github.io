/* 長期攝取指數（代謝提示）與體重下降速度（純函數）
 * 當日比例 = 當日攝取熱量 ÷ 基礎代謝
 * 長期指數 = 前一天長期指數 × (1 − α) + 當日比例 × α
 * - 沒有記錄的日子跳過，不當作 0 大卡
 * - 當天記錄熱量低於基礎代謝的 30% → 記錄不完整，跳過
 * - 今天還沒過完，不列入 */
import { LONGTERM } from './config.js';
import { localDate, addDays } from './points.js';

export function dailyKcal(meals) {
  const m = {};
  for (const x of meals) { const d = localDate(x.at); m[d] = (m[d] || 0) + (+x.kcal || 0); }
  return m;
}

/**
 * @returns {{index:number|null, validDays, recentValid, ready:boolean, level:'ok'|'low'|'veryLow'|null, series:[{date, ratio, index}]}}
 */
export function longTermIndex(meals, bmr, todayStr, cfg = LONGTERM) {
  const out = { index: null, validDays: 0, recentValid: 0, ready: false, level: null, series: [] };
  if (!(bmr > 0)) return out;
  const byDay = dailyKcal(meals);
  const days = Object.keys(byDay).filter(d => d < todayStr).sort();
  const recentFrom = addDays(todayStr, -cfg.recentDays);
  let idx = null;
  for (const d of days) {
    const ratio = byDay[d] / bmr;
    if (ratio < cfg.minDayRatio) continue;              // 記錄不完整
    idx = idx === null ? ratio : idx * (1 - cfg.alpha) + ratio * cfg.alpha;
    out.validDays++;
    if (d >= recentFrom) out.recentValid++;
    out.series.push({ date: d, kcal: byDay[d], ratio, index: idx });
  }
  out.index = idx;
  out.ready = out.validDays >= cfg.minValidDays && out.recentValid / cfg.recentDays >= cfg.recentValidRatio;
  if (out.ready) out.level = idx < cfg.veryLow ? 'veryLow' : idx < cfg.low ? 'low' : 'ok';
  return out;
}

/**
 * 圖表用：把指數序列攤成每天一格的日期軸（from 之前的日子不畫，但指數仍用全部記錄算）
 * 跳過的日子（沒記錄或不完整）ratio、index、kcal 都是 null
 * @returns {{dates:string[], ratio:(number|null)[], index:(number|null)[], kcal:(number|null)[]}}
 */
export function longTermRows(series, from = '') {
  const out = { dates: [], ratio: [], index: [], kcal: [] };
  const s = (series || []).filter(x => !from || x.date >= from);
  if (!s.length) return out;
  const m = {}; for (const x of s) m[x.date] = x;
  for (let d = s[0].date; d <= s[s.length - 1].date; d = addDays(d, 1)) {
    const x = m[d];
    out.dates.push(d); out.ratio.push(x ? x.ratio : null); out.index.push(x ? x.index : null); out.kcal.push(x ? x.kcal : null);
  }
  return out;
}

/**
 * 體重下降速度：比較「最近 14 天平均」和「7 天前的 14 天平均」，換算每週下降佔體重幾 %
 * @returns {{weeklyPct:number|null, fast:boolean}}
 */
export function weightTrend(entries, todayStr, cfg = LONGTERM) {
  const byDay = {};
  for (const e of entries) if (e.wt > 0) (byDay[e.date] = byDay[e.date] || []).push(e.wt);
  const avg = (from, to) => {
    const v = []; for (const d in byDay) if (d >= from && d <= to) v.push(byDay[d].reduce((a, b) => a + b, 0) / byDay[d].length);
    return v.length >= 4 ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const n = cfg.weightMaDays;
  const now = avg(addDays(todayStr, -(n - 1)), todayStr);
  const prev = avg(addDays(todayStr, -(n - 1) - 7), addDays(todayStr, -7));
  if (now === null || prev === null) return { weeklyPct: null, fast: false };
  const weeklyPct = (prev - now) / prev * 100;
  return { weeklyPct, fast: weeklyPct > cfg.fastLossPct };
}

/** 提示文字（沒觸發時回傳 null） */
export function longTermMessage(lt, wt) {
  if (!lt.ready || lt.level === 'ok' || !lt.level) return null;
  let t = lt.level === 'veryLow'
    ? '熱量持續明顯偏低，代謝可能逐漸降低，建議留意蛋白質與身體狀況'
    : '最近一段時間熱量偏低，代謝可能逐漸降低';
  if (wt && wt.fast) t += '；體重下降速度偏快';
  return t;
}

/**
 * 淨體重趨勢（淨體重＝體重 ×（1 − 體脂率））：最近 28 天平均和再前 28 天平均比較，不看單日
 * 同一批量測日也算出體重、脂肪重量的平均變化，看「減掉的重量裡脂肪佔多少」
 * 同時看最近 28 天的平均蛋白質（只算有餐點記錄的日子，不含今天）
 */
export function leanTrend(entries, meals, proteinTarget, todayStr, cfg = LONGTERM) {
  const W = cfg.leanWindow, from1 = addDays(todayStr, -(W - 1)), from0 = addDays(todayStr, -(2 * W - 1));
  const day = {};
  for (const e of entries || []) {
    if (!(e.wt > 0 && e.fat > 0) || e.date > todayStr || e.date < from0) continue;
    (day[e.date] = day[e.date] || []).push({ wt: e.wt, lean: e.wt * (1 - e.fat / 100) });
  }
  const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const cur = [], prev = [];
  for (const d in day) { const x = day[d]; (d >= from1 ? cur : prev).push({ wt: avg(x.map(y => y.wt)), lean: avg(x.map(y => y.lean)) }); }
  const ready = cur.length >= cfg.leanMinDays && prev.length >= cfg.leanMinDays;
  const c = avg(cur.map(x => x.lean)), p = avg(prev.map(x => x.lean));
  const change = ready ? c - p : null, pct = ready ? (c - p) / p * 100 : null;
  const wtChange = ready ? avg(cur.map(x => x.wt)) - avg(prev.map(x => x.wt)) : null;
  const fatChange = ready ? wtChange - change : null;
  // 減重時：淨體重佔減掉重量的比例（體重至少少了 0.3 kg 才算）
  const lostLean = ready && wtChange <= -0.3 ? Math.max(0, Math.min(1, change / wtChange)) : null;
  const level = !ready ? null : pct >= cfg.leanFlatPct ? 'up' : pct > -cfg.leanFlatPct ? 'flat' : pct > -cfg.leanDropPct ? 'down' : 'drop';
  const share = lostLean === null ? null : lostLean < 0.25 ? 'good' : lostLean <= 0.5 ? 'ok' : 'high';
  const pro = {};
  for (const m of meals || []) { const d = localDate(m.at); if (d >= from1 && d < todayStr) pro[d] = (pro[d] || 0) + (+m.protein || 0); }
  const pd = Object.values(pro), protein = pd.length >= cfg.leanMinMealDays ? avg(pd) : null;
  const falling = level === 'drop';
  const lowProtein = protein !== null && proteinTarget > 0 && protein < proteinTarget;
  // 還要幾天才能判讀：照現在的量測頻率，第 6 個有體脂的日子滿 28 天後，前一段才夠
  let readyIn = null;
  if (!ready) {
    const fd = [...new Set((entries || []).filter(e => e.wt > 0 && e.fat > 0 && e.date <= todayStr).map(e => e.date))].sort();
    const p6 = fd.filter(d => d >= from0)[cfg.leanMinDays - 1] || fd[fd.length - 1];
    if (p6) readyIn = Math.max(1, Math.round((Date.parse(addDays(p6, W)) - Date.parse(todayStr)) / 864e5) + (fd.length < cfg.leanMinDays ? cfg.leanMinDays - fd.length : 0));
  }
  return { ready, readyIn, cur: c, prev: p, change, pct, wtChange, fatChange, lostLean, level, share, curDays: cur.length, prevDays: prev.length, protein, mealDays: pd.length, falling, lowProtein, alert: falling && lowProtein };
}

const sgn = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '') + Math.abs(x).toFixed(d);
export const LEAN_LEVELS = {
  up: { tag: '增加', tone: 'good', text: '淨體重增加：肌肉可能有長，也可能是身體水分變多。' },
  flat: { tag: '幾乎持平', tone: 'good', text: '幾乎持平：變化比體脂機每天的誤差還小。減重時能維持住，代表肌肉大致保住了，這是好結果。' },
  down: { tag: '小幅下降', tone: 'mid', text: '小幅下降：減重時少一點是常見的（水分、肝醣也算在淨體重裡），繼續吃夠蛋白質就好。' },
  drop: { tag: '明顯下降', tone: 'warn', text: '明顯下降：比體脂機的誤差大，可能有掉一些肌肉。' },
};
export const LEAN_SHARE = {
  good: '減掉的大多是脂肪，很好。',
  ok: '還可以，多吃點蛋白質、做些肌力運動，可以保住更多肌肉。',
  high: '淨體重佔的比例偏多，建議留意蛋白質和肌力運動。',
};

/** 給畫面與摘要用的白話：{ line（一行）, level, share, alert } */
export function leanSummary(t) {
  if (!t || !t.ready) return null;
  const L = LEAN_LEVELS[t.level];
  const line = '淨體重 28 天：' + sgn(t.change) + ' kg・' + L.tag + (L.tone === 'good' ? ' ✓' : '');
  const lost = t.lostLean === null ? null
    : '這 28 天體重平均少了 ' + Math.abs(t.wtChange).toFixed(1) + ' kg：脂肪' + (t.fatChange <= 0 ? '少 ' : '多 ') + Math.abs(t.fatChange).toFixed(1) + ' kg、淨體重' + (t.change <= 0 ? '少 ' : '多 ') + Math.abs(t.change).toFixed(1) + ' kg → 減掉的重量約 ' + Math.round((1 - t.lostLean) * 100) + '% 是脂肪。' + LEAN_SHARE[t.share];
  return { line, levelText: L.text, tone: t.alert ? 'warn' : L.tone, lost };
}
