/* 桌面小工具（只有 MetaPulse app）：把斷食開始、預計結束、各階段時間與熱血雞湯交給原生小工具
 * 原生端（MapleWidget 外掛）存進 SharedPreferences，小工具自己倒數，不必開 app */
import { S } from './state.js';
import { capPlugin } from './health.js';
import { fastInfo } from './ui/fasting.js';
import { FASTING } from './config.js';
import { stageStarts } from './fasting.js';
import { WIDGET_MESSAGES, WIDGET_EATING } from './messages.js';
import { fuelText, soupText, eatingText, runSets, pixelSets, RUN_EVERY, RUN_PERIOD, STEP as STEP30 } from './lines.js';

/* 小工具翻頁的速度寫在 APK 裡：1.1.0 起每 30 秒翻一格，更早的 APK（1.0.x，包括測試版 1.0.10、1.0.11）每 2 分鐘。
 * 先問 APK 的版本再決定時間表一格多久（舊 APK 取樣 30 秒句庫裡的句子，一樣不重複） */
export const OLD_STEP = 2 * 60000;
let step = OLD_STEP, asked = false;
export const fastApk = v => { const [a, b] = String(v || '0').split('.').map(Number); return a > 1 || (a === 1 && b >= 1); };   // 1.1.0 以後

const H = 3600000;
export function widgetData(now = Date.now()) {
  const fi = fastInfo(now);
  // termBar：終端機小工具進度條的符號（滿／空／前後括號），改這裡就好，不用重裝 APK
  const base = { msgs: WIDGET_MESSAGES, eating: WIDGET_EATING, updated: now, termBar: { full: '■', empty: '□', open: '[', close: ']' } };
  if (!fi.start) return { ...base, fasting: false, start: 0 };
  const starts = stageStarts(fi.shift || 0).map(h => fi.start + h * H);
  // 進食中：中間進度條的位置換成跑步小人（APK 1.2.0 起才會顯示；舊 APK 不看這個欄位）
  // sets：五個版本，APK 1.3.0 起每 period 換一個；wide／narrow 給 1.2.0（只顯示現在這個版本）
  let run = null;
  if (!fi.fasting) {
    const wide = runSets(36), narrow = runSets(25), k = Math.floor(now / RUN_PERIOD) % wide.length;
    // term／termNarrow：終端機版和 3×2 小版用的點陣小人（兩行高，APK 1.4.0 起）
    const term = pixelSets(36), termNarrow = pixelSets(25);
    run = { every: RUN_EVERY, period: RUN_PERIOD, wide: wide[k], narrow: narrow[k], sets: wide.map((w, i) => ({ wide: w, narrow: narrow[i], term: term[i], termNarrow: termNarrow[i] })) };
  }
  return { ...base, fasting: !!fi.fasting, start: fi.start, end: fi.end || 0, ...(run ? { run } : {}),
    stages: starts.map((at, i) => ({ at, text: FASTING.stages[i].short + '｜' + FASTING.stages[i].fuel })),
    timeline: timeline(fi, starts, now, step) };
}

/** 一格 STEP 的文字（燃料那一行＋熱血雞湯）：2 分鐘一格排到斷食第 30 小時；30 秒一格排接下來 6 小時（資料才不會太大，
 *  超過時小工具在最後 480 句裡繞）。進食中排 8 小時。小工具每次更新時取「現在這一格」之後的句子輪播 */
export function timeline(fi, starts, now, STEP = OLD_STEP) {
  const t0 = fi.start + Math.floor(Math.max(0, now - fi.start) / STEP) * STEP;
  const until = !fi.fasting ? t0 + 8 * H : STEP < OLD_STEP ? t0 + 6 * H : Math.max(fi.start + 30 * H, t0 + 120 * STEP);
  const fuel = [], msg = [];
  for (let t = t0; t < until; t += STEP) {
    if (fi.fasting) {
      let i = 0; starts.forEach((s, j) => { if (s <= t) i = j; });
      fuel.push(FASTING.stages[i].short + '｜' + fuelText(i, starts[i], t, fi.start));
      msg.push(soupText(t, fi.start));
    } else msg.push(eatingText(t, fi.start));
  }
  return { t0, step: STEP, fuel, msg };
}

let timer = null;
export function updateWidgetSoon() { clearTimeout(timer); timer = setTimeout(() => { updateWidget().catch(() => {}); }, 1200); }
export async function updateWidget() {
  const P = capPlugin('MapleWidget');
  if (!P || !S) return;
  if (!asked && P.version) { asked = true; try { const r = await P.version(); if (r && fastApk(r.version)) step = STEP30; } catch (e) { /* 舊 APK */ } }
  await P.update({ data: JSON.stringify(widgetData()) });
}
