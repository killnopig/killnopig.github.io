/* 趨勢體重與「依記錄反推每日消耗」（純函數）
 * 趨勢體重：每天只往當天體重移 α（10%），一天多 1 kg 水分只讓趨勢動 0.1 kg；
 *   同時追蹤每天的斜率（Holt 雙重平滑），穩定變瘦時趨勢線不會一直落後、浮在點的上方。沒量的日子照斜率走。
 * 反推消耗：最近 28 天（不含今天）
 *   實際總消耗 ≈ 平均每天吃進 −（體重每天變化 × 7700）
 *   體重變化用這段期間每天體重的直線趨勢（最小平方法），不受起點、終點那天的水分影響
 *   App 另外會把運動 × 0.75 加回點數，所以要扣掉這段期間平均每天加回的運動，免得算兩次
 *   結果限制在公式消耗的 ±25% 內：漏記餐點會讓吃進量偏低、反推結果偏低 */
import { ADAPT, BUDGET } from './config.js';
import { addDays } from './points.js';
import { perDay, allActivity } from './ledger.js';

const dn = d => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 864e5);

/** 每天的平均體重 { 'YYYY-MM-DD': kg } */
export function dailyWeights(entries) {
  const m = {};
  for (const e of entries || []) if (e && e.wt > 0 && e.date) (m[e.date] = m[e.date] || []).push(+e.wt);
  const out = {};
  for (const d in m) out[d] = m[d].reduce((a, b) => a + b, 0) / m[d].length;
  return out;
}

/** 趨勢體重：從第一次量到 until（預設最後一次量），每天一筆 [{date, wt|null, trend}] */
export function weightTrendLine(entries, until = null, alpha = ADAPT.weightAlpha, beta = ADAPT.slopeBeta) {
  const w = dailyWeights(entries), ds = Object.keys(w).sort();
  if (!ds.length) return [];
  const end = until && until > ds[ds.length - 1] ? until : ds[ds.length - 1];
  const out = [];
  let t = null, s = 0;
  for (let d = ds[0]; d <= end; d = addDays(d, 1)) {
    const v = w[d] != null ? w[d] : null;
    if (t === null) t = v;
    else {
      const pred = t + s;
      if (v != null) { const nt = pred * (1 - alpha) + v * alpha; s = s * (1 - beta) + (nt - t) * beta; t = nt; }
      else t = d > ds[ds.length - 1] ? t : pred;          // 最後一次量之後不再往外推
    }
    out.push({ date: d, wt: v, trend: t });
  }
  return out;
}

/** 某一天的趨勢體重（那天以前最後一筆）；沒有就是 null */
export function trendAt(line, date) {
  let t = null;
  for (const x of line) { if (x.date > date) break; t = x.trend; }
  return t;
}

/** 趨勢體重每週變化：today 跟 7 天前比。{ trend, kg, pct }（kg、pct 正的＝變輕） */
export function weeklyTrend(entries, today) {
  const line = weightTrendLine(entries, today);
  const now = trendAt(line, today), prev = trendAt(line, addDays(today, -7));
  if (now == null) return null;
  if (prev == null) return { trend: now, kg: null, pct: null };
  return { trend: now, kg: prev - now, pct: (prev - now) / prev * 100 };
}

/** 直線斜率（kg／天），點 [x, y] */
function slope(pts) {
  const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
  let num = 0, den = 0;
  for (const [x, y] of pts) { num += (x - mx) * (y - my); den += (x - mx) ** 2; }
  return den ? num / den : 0;
}

/**
 * 依記錄反推每日消耗（要跟公式的 tdee 比較，回傳給 budget 用的基礎消耗）
 * @param S 狀態；bmr、formulaTdee 來自公式；today 'YYYY-MM-DD'
 * @returns {{ready, foodDays, weighDays, span, need:[], intake, kgPerWeek, exercise, raw, tdee, clamped, formula}}
 */
export function adaptiveTdee(S, bmr, formulaTdee, today, now = Date.now(), cfg = ADAPT) {
  const from = addDays(today, -cfg.window), to = addDays(today, -1);
  const x = perDay(S.meals || [], allActivity(S), S.fasts || [], now);
  // 完整的飲食記錄日：當天熱量 ≥ 基礎代謝 30%，或整天都在斷食（算 0 大卡）
  const minK = bmr * 0.3, food = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const k = x.kcal[d] || 0;
    if (k >= minK || (x.cnt[d] && !k)) food.push(k);
  }
  const w = dailyWeights(S.entries), wd = Object.keys(w).filter(d => d >= from && d <= to).sort();
  const span = wd.length ? dn(wd[wd.length - 1]) - dn(wd[0]) : 0;
  const out = { ready: false, foodDays: food.length, weighDays: wd.length, span, need: [], formula: formulaTdee };
  if (food.length < cfg.minFoodDays) out.need.push('飲食 ' + (cfg.minFoodDays - food.length) + ' 天');
  if (wd.length < cfg.minWeighDays) out.need.push('體重 ' + (cfg.minWeighDays - wd.length) + ' 天');
  else if (span < cfg.minWeighSpan) out.need.push('體重再跨 ' + (cfg.minWeighSpan - span) + ' 天');
  if (out.need.length || !(formulaTdee > 0)) return out;
  const intake = food.reduce((a, b) => a + b, 0) / food.length;
  const kgPerDay = slope(wd.map(d => [dn(d), w[d]]));            // 負的＝變輕
  let ex = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) ex += (x.ref[d] || 0) * BUDGET.kcalPerPoint;   // 已經 × 0.75 的運動加回
  ex /= cfg.window;
  const raw = Math.round(intake - kgPerDay * BUDGET.kcalPerKgFat - ex);
  const lo = Math.round(formulaTdee * (1 - cfg.clamp)), hi = Math.round(formulaTdee * (1 + cfg.clamp));
  const tdee = Math.min(hi, Math.max(lo, raw));
  return { ...out, ready: true, intake: Math.round(intake), kgPerWeek: -kgPerDay * 7, exercise: Math.round(ex), raw, tdee, clamped: tdee !== raw };
}
