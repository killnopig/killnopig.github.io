/* 啟動：分頁切換、各畫面串接、版本檢查 */
import { onChange } from './state.js';
import { $, closeSheet, sheetOpen, backLayer } from './ui/common.js';
import { renderToday } from './ui/today.js';
import { tickLines } from './ui/fasting.js';
import { onAdviceState } from './ui/advice.js';
import { renderSettings, showDisclaimerOnce, applyTheme } from './ui/settings.js';
import { renderLog } from './ui/log.js';
import { renderCharts } from './ui/charts.js';
import { L, S } from './state.js';
import { h, toast } from './ui/common.js';
import { initDrive, onDrive, driveStatus, connect, linked, ready } from './drive.js';
import { scheduleSoon } from './notify.js';
import { preloadSounds } from './sounds.js';
import { updateWidgetSoon } from './widget.js';
import { isNative, capPlugin } from './health.js';
import { autoHealth } from './ui/health.js';
if (isNative()) document.documentElement.classList.add('native');   // 保險：頁面開頭沒偵測到 app 時補上（狀態列留白）

const APP_VERSION = window.APP_VERSION;
$('ver').textContent = 'v' + APP_VERSION;
/* APK 裡顯示 App 和網頁兩個版本，疊成兩行小字（放一行太長會被擠成 …）；舊版 APK 沒有這個功能就維持網頁版本 */
try {
  const W = capPlugin('MapleWidget');
  if (W && W.version) W.version().then(r => { if (r && r.version) { const v = $('ver'); v.textContent = ''; v.classList.add('two'); v.append(document.createTextNode('App ' + r.version), document.createElement('br'), document.createTextNode('網頁 ' + APP_VERSION)); } }).catch(() => {});
} catch (e) { /* 不是 APK */ }
applyTheme();

let tab = 'today';
const panes = {
  today: () => renderToday($('p-today')),
  log: () => renderLog($('p-log')),
  chart: () => renderCharts($('p-chart')),
  set: () => renderSettings($('p-set')),
};

function show(t) {
  tab = t;
  document.querySelectorAll('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.id === 'p-' + t));
  panes[t]?.();
  window.scrollTo(0, 0);
}
document.querySelectorAll('nav.tabs button').forEach(b => { b.onclick = () => { if (sheetOpen()) closeSheet(); show(b.dataset.t); }; });

/* Android 返回手勢：一層一層退（收區塊、關面板 → 回「飲食運動」→ 2 秒內再滑一次才離開）
 * 回傳 true 表示網頁處理掉了；false 時 App 才關掉 */
let lastBack = 0;
window.__mpBack = () => {
  if (backLayer()) return true;
  if (tab !== 'today') { show('today'); return true; }
  if (Date.now() - lastBack < 2000) return false;
  lastBack = Date.now(); toast('再滑一次就離開');
  return true;
};

/* 資料變動時只重畫「今日」，設定頁不重畫（避免打字時失去焦點） */
onChange(ev => {
  renderToday($('p-today'));
  if (tab === 'log') renderLog($('p-log'));
  if (tab === 'chart') renderCharts($('p-chart'), true);   // 同步進來的新資料：重畫但不跳回最上面
  if (tab === 'set' && ev && ev.replaced) renderSettings($('p-set'));
  if (!ev || !ev.remote) askBackupSoon();
  scheduleSoon();                       // 服藥、注射通知（只有 MetaPulse app）
  updateWidgetSoon();                   // 桌面小工具（只有 MetaPulse app）
});

/* ---------- Google Drive 狀態列、提示 ---------- */
const syncEl = $('sync');
/** 標題下只寫一行短的狀態；帳號和完整說明在「設定」→「備份與匯入」 */
const hhmm = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
/** 標題列空間小：疊成兩行小字（第一行狀態、第二行時間或補充） */
const shortSync = t => /連線中/.test(t) ? ['☁ 連線中…', ''] : /同步中/.test(t) ? ['☁ 同步中…', '']
  : /^已存到|^已和/.test(t) ? ['☁ 已同步', hhmm()] : /重新登入|登入失敗/.test(t) ? ['☁ 要登入', '點這裡']
  : /同步失敗/.test(t) ? ['☁ 同步失敗', '資料在手機'] : /準備好|載入失敗/.test(t) ? ['☁ 未登入', ''] : [t, ''];
const drawSync = t => {
  const [a, b] = shortSync(t);
  syncEl.textContent = '';
  syncEl.append(h('span.one', { style: { display: 'block' } }, a), b ? h('span.one', { style: { display: 'block' } }, b) : '');
  syncEl.classList.add('two');
};
drawSync(driveStatus());
syncEl.onclick = () => { if (linked() && !ready()) connect(true); };
onDrive((t, ev) => {
  drawSync(t);
  if (ev === 'pushed') toast('✓ 已存到 Google Drive');
  if (ev === 'push-failed') toast('✗ 存到雲端失敗，資料還在手機裡', true);
  if (ev === 'pulled') toast('已從 Google Drive 載入');
  if ((ev === 'pushed' || ev === 'synced') && tab === 'today' && !sheetOpen()) renderToday($('p-today')); // 備份提醒消失
});

/* 修改後：尚未連線或登入過期時，詢問是否備份（可在設定關閉） */
let askTmr = null;
function askBackupSoon() { clearTimeout(askTmr); askTmr = setTimeout(askBackup, 700); }
function askBackup() {
  if (L.askBackup === false || (linked() && ready())) return;
  if (!S.entries.length && !S.meals.length) return;
  const el = $('bk-ask');
  el.textContent = '';
  el.append(h('div', { style: { fontWeight: 600 } }, linked() ? '記錄改好了，但 Google Drive 要重新登入才能存檔。要現在登入嗎？' : '記錄改好了。要存一份到 Google Drive（雲端硬碟）嗎？'),
    h('div.grid2', { style: { marginTop: '10px' } },
      h('button.pri', { type: 'button', onclick: () => { el.style.display = 'none'; connect(true); } }, linked() ? '重新登入並存檔' : '連線並存檔'),
      h('button.ghost', { type: 'button', onclick: () => { el.style.display = 'none'; } }, '先不要')));
  el.style.display = 'block';
}
onAdviceState(() => { renderToday($('p-today')); });

setTimeout(autoHealth, 1500);   // 打開 App：自動匯入 Omron 的新量測（APK 才有）

/* 跨日或從背景切回來時重畫 */
let lastDay = new Date().toDateString();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  checkUpdate();
  autoHealth();
  if (new Date().toDateString() !== lastDay) { lastDay = new Date().toDateString(); if (tab === 'today') renderToday($('p-today')); }
});

/* 版本檢查：比對線上 index.html 的 APP_VERSION。標題右邊的小標籤常駐：
 * 最新＝灰色「✓ 最新」；有新版＝橘色閃爍「更新 vX」。點一下就檢查，有新版直接更新。
 * 打開時、從背景切回來時、開著每 10 分鐘各檢查一次（APK 切回來不會重新載入，只檢查一次會看不到） */
let newVer = null;
const reload = () => location.replace(location.pathname + '?v=' + Date.now());
async function checkUpdate() {
  if (!/^https?:/.test(location.protocol)) return null;
  try {
    const u = new URL('index.html', location.href); u.search = ''; u.hash = '';
    const r = await fetch(u.href + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const m = (await r.text()).match(/APP_VERSION\s*=\s*'(\d+\.\d+\.\d+)'/);
    if (m && m[1] !== APP_VERSION) { newVer = m[1]; $('upd').textContent = '更新 v' + m[1]; $('upd').classList.remove('ok'); }
    return m ? m[1] : null;
  } catch (e) { return null; }   // 離線時略過
}
$('upd').onclick = async () => {
  if (newVer) return reload();
  $('upd').textContent = '檢查中…';
  const v = await checkUpdate();
  if (newVer) return reload();
  $('upd').textContent = '✓ 最新';
  toast(v ? '已經是最新版 v' + APP_VERSION : '連不上網路，等一下再試', !v);
};
window.addEventListener('load', () => setTimeout(checkUpdate, 1500));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
setInterval(checkUpdate, 10 * 60000);

show('today');
initDrive();
scheduleSoon();
preloadSounds();
updateWidgetSoon();
document.addEventListener('visibilitychange', () => { if (document.hidden) updateWidgetSoon(); });

/* 斷食計時：今日頁每分鐘更新一次 */
setInterval(() => { if (tab === 'today' && !sheetOpen() && !document.hidden) renderToday($('p-today')); }, 60000);
setInterval(() => { if (tab === 'today' && !document.hidden) tickLines(); }, 30000);   // 句子每 30 秒換一句
showDisclaimerOnce();
