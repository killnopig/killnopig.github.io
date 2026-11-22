/* 手機通知（只在 MetaPulse app 裡有；網頁版只顯示卡片）
 * - 服藥：每天固定時間（S.prefs.meds）
 * - 注射：下次注射日早上（L.notify.doseRemindAt，預設 09:00）
 * - 斷食：階段轉換與達標（或每小時），勿擾時段不發（L.notify.freq／quietStart／quietEnd）
 * 每次資料變動後重新排程（先取消自己的，再排）。 */
import { S, L } from './state.js';
import { capPlugin } from './health.js';
import { nextDose } from './records.js';
import { localDate } from './points.js';
import { fastNotes, hourlyMessage } from './fasting.js';
import { FASTING } from './config.js';
import { HOURLY_MESSAGES } from './messages.js';
import { fastInfo } from './ui/fasting.js';

const MED_BASE = 7000, DOSE_ID = 7100, FAST_BASE = 7200, FAST_MAX = 40;
const plugin = () => capPlugin('LocalNotifications');
export const canNotify = () => !!plugin();

let asked = false;
async function allowed(P) {
  try {
    let p = await P.checkPermissions();
    if (p.display !== 'granted' && !asked) { asked = true; p = await P.requestPermissions(); }
    return p.display === 'granted';
  } catch (e) { return false; }
}

/** 要求通知權限（常駐提醒卡開啟時用） */
export async function askNotify() { const P = plugin(); return P ? allowed(P) : false; }

/** 通知狀態（設定頁顯示用）：web＝網頁版；display＝是否允許通知；exact＝是否允許準時鬧鐘（Android 12 以上） */
export async function notifyStatus() {
  const P = plugin(); if (!P) return { web: true };
  let display = 'prompt', exact = 'granted', pending = 0;
  try { display = (await P.checkPermissions()).display; } catch (e) { /* 舊版外掛 */ }
  try { if (P.checkExactNotificationSetting) exact = (await P.checkExactNotificationSetting()).exact_alarm; } catch (e) { /* Android 11 以下沒有這項 */ }
  try { pending = ((await P.getPending()).notifications || []).length; } catch (e) { /* 略過 */ }
  return { web: false, display, exact, pending };
}
/** 打開手機的「準時鬧鐘」權限設定 */
export async function openExactSetting() { const P = plugin(); if (P && P.changeExactNotificationSetting) await P.changeExactNotificationSetting(); }
/** 10 秒後跳一則測試通知 */
export async function testNotify() {
  const P = plugin(); if (!P) throw new Error('網頁版不會發通知，請在 MetaPulse app 裡試');
  if (!(await allowed(P))) throw new Error('手機沒有允許 MetaPulse 發通知');
  await P.schedule({ notifications: [{ id: 7199, title: 'MetaPulse 測試通知', body: '看到這則就代表通知正常。', schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true } }] });
}

let timer = null, scheduled = true;   // scheduled：上次有排通知（沒有東西要排時也要先取消舊的）
/** 資料變動後呼叫（會延後一點再排，避免連續修改時重複排程） */
export function scheduleSoon() { clearTimeout(timer); timer = setTimeout(() => { schedule().catch(() => {}); }, 1500); }

export async function schedule() {
  const P = plugin(); if (!P) return { ok: false, reason: 'web' };
  const meds = (S.prefs.meds || []).filter(m => m && m.name && /^\d{2}:\d{2}$/.test(m.time));
  const nd = nextDose(S.entries, localDate(new Date()));
  const N = L.notify || {};
  const fi = fastInfo(), fn = fastNotes(fi, Date.now(), N.freq || 'phase', N.quietStart || '23:00', N.quietEnd || '07:00').slice(0, FAST_MAX);
  if (!meds.length && !nd && !fn.length && !scheduled) return { ok: true, count: 0 };
  if (!(await allowed(P))) return { ok: false, reason: 'denied' };
  const ids = [];
  for (let i = 0; i < 50; i++) ids.push({ id: MED_BASE + i });
  for (let i = 0; i < FAST_MAX; i++) ids.push({ id: FAST_BASE + i });
  ids.push({ id: DOSE_ID });
  try { await P.cancel({ notifications: ids }); } catch (e) { /* 第一次沒有可取消的 */ }
  const list = meds.slice(0, 50).map((m, i) => {
    const [hh, mm] = m.time.split(':').map(Number);
    return { id: MED_BASE + i, title: '該吃藥了：' + m.name, body: m.time + ' 的藥，吃完到 MetaPulse 按「已服用」。', schedule: { on: { hour: hh, minute: mm }, allowWhileIdle: true } };
  });
  if (nd && nd.left >= 0) {
    const [hh, mm] = (L.notify && L.notify.doseRemindAt || '09:00').split(':').map(Number);
    const [y, mo, d] = nd.due.split('-').map(Number);
    const at = new Date(y, mo - 1, d, hh, mm);
    if (at > new Date()) list.push({ id: DOSE_ID, title: '今天要注射', body: '建議部位：' + nd.site + '。打完到 MetaPulse 記錄。', schedule: { at, allowWhileIdle: true } });
  }
  fn.forEach((x, i) => {
    const h0 = Math.round(x.hours);
    const n = x.kind === 'done' ? { title: '斷食達標：' + h0 + ' 小時', body: '可以準備吃東西了。累了就休息，斷食不需要逞強。' }
      : x.kind === 'stage' ? { title: '斷食 ' + h0 + ' 小時・' + FASTING.stages[x.index].short, body: '身體現在：' + FASTING.stages[x.index].text }
      : { title: '斷食 ' + h0 + ' 小時', body: hourlyMessage(x.hours + 0.01, fi.start, HOURLY_MESSAGES) };
    list.push({ id: FAST_BASE + i, ...n, schedule: { at: new Date(x.at), allowWhileIdle: true } });
  });
  if (list.length) await P.schedule({ notifications: list });
  scheduled = list.length > 0;
  return { ok: true, count: list.length };
}
