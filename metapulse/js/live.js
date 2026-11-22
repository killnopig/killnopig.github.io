/* 常駐提醒卡（APK 1.5.0 起，鎖定畫面／通知最上面那張）：網頁排好「接下來 24 小時，每一段時間卡片要寫什麼」，
 * APK 只照表顯示，到下一段的時間自己換。要加新的提醒只改這裡，不用重裝 APK。
 * 優先順序：吃藥（前 30 分鐘到後 2 小時、還沒按已服用）> 注射日（提醒時間起、還沒記錄）> 斷食／進食 */
const H = 3600000, MIN = 60000;
export const MED_BEFORE = 30 * MIN, MED_AFTER = 2 * H, AHEAD = 24 * H;
const hm = t => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const atTime = (day0, s) => { const [h, m] = s.split(':').map(Number); const d = new Date(day0); d.setHours(h, m, 0, 0); return d.getTime(); };

/**
 * in：{ fast: { start, end, fasting }, eatUntil, stages: [{ at, text }],
 *       meds: [{ name, time:'HH:MM', taken }]（taken＝今天已服用）, dose: { site, today, remindAt:'HH:MM' } | null }
 * 回傳 [{ from, title, text, chip, at, down }]：from 起顯示；at＞0 時顯示計時（down＝倒數到 at，否則從 at 往上數）
 */
export function liveTimeline(inp, now = Date.now()) {
  const { fast = {}, eatUntil = 0, stages = [], meds = [], dose = null } = inp;
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0);
  const until = now + AHEAD;
  // 吃藥的時段：今天、明天各一次（今天已服用就跳過今天）
  const medWins = [];
  meds.forEach(m => {
    if (!m || !/^\d{2}:\d{2}$/.test(m.time)) return;
    for (let d = 0; d < 2; d++) {
      if (d === 0 && m.taken) continue;
      const T = atTime(today0.getTime() + d * 24 * H + 2 * H, m.time);   // +2h 避開日光節約的邊界
      if (T + MED_AFTER > now && T - MED_BEFORE < until) medWins.push({ T, name: m.name || '藥' });
    }
  });
  const doseFrom = dose && dose.today ? atTime(now, dose.remindAt || '09:00') : 0;
  const doseTo = today0.getTime() + 24 * H;

  const state = t => {
    const mw = medWins.filter(w => t >= w.T - MED_BEFORE && t < w.T + MED_AFTER).sort((a, b) => a.T - b.T)[0];
    if (mw) {
      const names = medWins.filter(w => w.T === mw.T).map(w => w.name).join('、');
      return t < mw.T ? { title: hm(mw.T) + ' 要吃藥・還剩', text: names + '，吃完到 MetaPulse 按「已服用」', chip: '吃藥', at: mw.T, down: true }
        : { title: '該吃藥了・已過', text: names + '（' + hm(mw.T) + '），吃完到 MetaPulse 按「已服用」', chip: '吃藥', at: mw.T, down: false };
    }
    if (doseFrom && t >= doseFrom && t < doseTo) return { title: '今天要注射', text: '建議部位：' + (dose.site || '照平常輪替') + '，打完到 MetaPulse 記錄', chip: '注射', at: 0, down: false };
    if (!fast.start) return { title: 'MetaPulse', text: '吃完今天最後一餐，按「開始斷食」', chip: '', at: 0, down: false };
    if (fast.fasting && fast.end > fast.start) {
      if (t < fast.end) {
        let st = ''; stages.forEach(s => { if (s.at <= t) st = s.text; });
        return { title: '斷食中・還剩', text: st || '斷食中', chip: '斷食', at: fast.end, down: true, p0: fast.start };   // p0：進度條的起點（APK 1.6.0 起）
      }
      return { title: '可以吃了・超過目標', text: '準備吃東西時，到 MetaPulse 記一餐並結束斷食', chip: '可吃', at: fast.end, down: false };
    }
    if (fast.fasting) return { title: '斷食中・已經', text: '斷食中', chip: '斷食', at: fast.start, down: false };
    if (eatUntil > fast.start && t < eatUntil) return { title: '進食中・進食時間還剩', text: '上一段斷食 ' + hm(fast.start) + ' 結束', chip: '進食', at: eatUntil, down: true };
    if (eatUntil > fast.start) return { title: '該開始斷食了・已過', text: '吃完最後一餐，到 MetaPulse 按「開始斷食」', chip: '該斷食', at: eatUntil, down: false };
    return { title: '進食中・已經', text: '要斷食時到 MetaPulse 按「開始斷食」', chip: '進食', at: fast.start, down: false };
  };

  const pts = [now, fast.end, eatUntil, doseFrom, doseTo, ...stages.map(s => s.at)];
  medWins.forEach(w => pts.push(w.T - MED_BEFORE, w.T, w.T + MED_AFTER));
  const times = [...new Set(pts.filter(t => t && t >= now && t < until))].sort((a, b) => a - b);
  const out = [];
  times.forEach(t => {
    const s = { from: t, ...state(t) }, p = out[out.length - 1];
    if (p && p.title === s.title && p.text === s.text && p.at === s.at && p.down === s.down) return;
    out.push(s);
  });
  return out;
}
