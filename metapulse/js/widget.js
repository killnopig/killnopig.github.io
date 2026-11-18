/* 桌面小工具（只有 MetaPulse app）：把斷食開始、預計結束、各階段時間與熱血雞湯交給原生小工具
 * 原生端（MapleWidget 外掛）存進 SharedPreferences，小工具自己倒數，不必開 app */
import { S } from './state.js';
import { capPlugin } from './health.js';
import { fastInfo } from './ui/fasting.js';
import { FASTING } from './config.js';
import { stageStarts } from './fasting.js';
import { WIDGET_MESSAGES, WIDGET_EATING } from './messages.js';
import { STEP, fuelText, soupText, eatingText } from './lines.js';

const H = 3600000;
export function widgetData(now = Date.now()) {
  const fi = fastInfo(now);
  // termBar：終端機小工具進度條的符號（滿／空／前後括號），改這裡就好，不用重裝 APK
  const base = { msgs: WIDGET_MESSAGES, eating: WIDGET_EATING, updated: now, termBar: { full: '■', empty: '□', open: '[', close: ']' } };
  if (!fi.start) return { ...base, fasting: false, start: 0 };
  const starts = stageStarts(fi.shift || 0).map(h => fi.start + h * H);
  return { ...base, fasting: !!fi.fasting, start: fi.start, end: fi.end || 0,
    stages: starts.map((at, i) => ({ at, text: FASTING.stages[i].short + '｜' + FASTING.stages[i].fuel })),
    timeline: timeline(fi, starts, now) };
}

/** 每 2 分鐘一格的文字（燃料那一行＋熱血雞湯），從現在這一格排到斷食第 30 小時（進食中排 8 小時）；
 *  小工具每次更新時取「現在這一格」之後的 16 句輪播 */
export function timeline(fi, starts, now) {
  const t0 = fi.start + Math.floor(Math.max(0, now - fi.start) / STEP) * STEP;
  const until = fi.fasting ? Math.max(fi.start + 30 * H, t0 + 120 * STEP) : t0 + 8 * H;
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
  await P.update({ data: JSON.stringify(widgetData()) });
}
