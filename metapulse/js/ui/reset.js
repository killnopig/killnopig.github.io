/* 設定頁「危險區」：清除這支手機上的 MetaPulse 資料，回到預設值
 * - 只刪 metapulse-v1、metapulse-local、metapulse-v1-undo 三個本機儲存鍵
 * - 雲端（Google Drive）絕對不動：清除前只忘記這支手機的登入（不撤銷授權、不讀寫雲端檔案），之後也不會自動備份
 * - 同步版、Health Connect 的資料都不會動 */
import { S, L, commit, commitLocal } from '../state.js';
import { h, toast } from './common.js';
import { linked } from '../drive.js';
import { forgetLocal } from '../drive.js';

const KEYS = ['metapulse-v1', 'metapulse-local', 'metapulse-v1-undo'];
const WORD = '清除';

function overlay(food = false) {
  const el = h('div', { role: 'alertdialog', 'aria-modal': 'true', style: { position: 'fixed', inset: 0, zIndex: 90, background: '#b91c1c', color: '#fff', overflowY: 'auto', padding: '28px 18px calc(28px + env(safe-area-inset-bottom,0px))' } });
  const close = () => { clearInterval(tm); el.remove(); };
  const n = { e: S.entries.length, m: S.meals.length, f: S.foodLibrary.length, x: (S.fasts || []).length };
  const groups = new Set(S.meals.map(m => m.group || m.id)).size;
  const li = t => h('li', { style: { margin: '4px 0' } }, t);
  const bk = h('textarea', { rows: 3, readOnly: true, style: { display: 'none', width: '100%', marginTop: '8px', color: '#111', background: '#fff', borderRadius: '10px' } });
  const bkBtn = h('button', { type: 'button', style: { width: '100%', marginTop: '10px', padding: '12px', borderRadius: '12px', border: '2px solid #fff', background: 'transparent', color: '#fff', fontSize: '16px', fontWeight: 700 } }, '先產生存檔文字（建議）');
  bkBtn.onclick = async () => {
    bk.value = JSON.stringify(S); bk.style.display = ''; bk.select();
    let ok = false; try { await navigator.clipboard.writeText(bk.value); ok = true; } catch (e) { try { ok = document.execCommand('copy'); } catch (e2) { /* 手動複製 */ } }
    bkBtn.textContent = ok ? '✓ 已複製，請貼到記事本或傳給自己保存' : '請在下面的框裡全選、複製後保存';
  };
  const input = h('input', { type: 'text', placeholder: '在這裡輸入「' + WORD + '」', autocomplete: 'off', style: { width: '100%', marginTop: '8px', padding: '12px', fontSize: '18px', borderRadius: '12px', border: '0', color: '#111', background: '#fff' } });
  const go = h('button', { type: 'button', disabled: true, style: { width: '100%', marginTop: '12px', padding: '16px', borderRadius: '14px', border: '0', background: '#fff', color: '#b91c1c', fontSize: '18px', fontWeight: 800, opacity: 0.45 } });
  let left = 5;
  const upd = () => {
    const ready = left <= 0 && input.value.trim() === WORD;
    go.disabled = !ready; go.style.opacity = ready ? 1 : 0.45;
    go.textContent = left > 0 ? '請先看完警告（' + left + ' 秒）' : input.value.trim() === WORD ? (food ? '確定清除飲食和斷食記錄' : '確定清除這支手機的全部資料') : '輸入「' + WORD + '」後才能按';
  };
  const tm = setInterval(() => { left--; upd(); if (left <= 0) clearInterval(tm); }, 1000);
  input.oninput = upd;
  go.onclick = () => {
    if (go.disabled) return;
    if (food) {                            // 只清飲食與斷食：記成刪除，同步後雲端與其他裝置也會刪掉
      S.meals = []; S.fasts = []; S.prefs.fastOverride = null; L.weekAI = null; commitLocal();
      commit(); close(); toast('已清除飲食和斷食記錄' + (linked() ? '，雲端會一起更新' : ''));
      return;
    }
    forgetLocal();                         // 先忘記這支手機的登入，之後不會再讀寫 Google Drive（不撤銷授權，其他裝置不受影響）
    try { for (const k of KEYS) localStorage.removeItem(k); } catch (e) { /* 略過 */ }
    location.replace(location.pathname + '?reset=' + Date.now());   // 重新開啟，回到預設值
  };
  const cancel = h('button', { type: 'button', style: { width: '100%', marginTop: '12px', padding: '16px', borderRadius: '14px', border: '2px solid #fff', background: 'rgba(0,0,0,.18)', color: '#fff', fontSize: '18px', fontWeight: 700 }, onclick: close }, '取消，不要清除');
  const box = { fontSize: '16px', lineHeight: 1.7, background: 'rgba(0,0,0,.2)', borderRadius: '14px', padding: '12px 14px' };
  if (food) {
    el.append(h('div', { style: { maxWidth: '520px', margin: '0 auto' } },
      h('div', { style: { fontSize: '64px', lineHeight: 1, textAlign: 'center' } }, '⚠️'),
      h('div', { style: { fontSize: '28px', fontWeight: 900, textAlign: 'center', margin: '10px 0 14px' } }, '警告：飲食和斷食記錄會全部被刪除！'),
      h('div', { style: box },
        h('b', '會刪除：'),
        h('ul', { style: { paddingLeft: '20px', margin: '6px 0' } }, li('餐點 ' + n.m + ' 道（' + groups + ' 餐）'), li('斷食記錄 ' + n.x + ' 筆')),
        h('b', linked() ? '⚠️ 已連線 Google Drive：雲端存檔，以及之後同步的 MetaPulse app，也會一起刪掉。' : '還沒連線 Google Drive：只刪這支手機。'),
        h('div', { style: { marginTop: '8px' } }, h('b', '不會動：'), '體重、血壓、注射、體組成、常用食物、個人資料和設定。')),
      bkBtn, bk,
      h('div', { style: { fontSize: '16px', fontWeight: 700, marginTop: '18px' } }, '確定要清除，請輸入「' + WORD + '」：'),
      input, go, cancel));
    upd(); document.body.append(el); cancel.focus();
    return;
  }
  el.append(h('div', { style: { maxWidth: '520px', margin: '0 auto' } },
    h('div', { style: { fontSize: '64px', lineHeight: 1, textAlign: 'center' } }, '⚠️'),
    h('div', { style: { fontSize: '30px', fontWeight: 900, textAlign: 'center', margin: '10px 0 4px', letterSpacing: '1px' } }, '警告：這支手機的資料'),
    h('div', { style: { fontSize: '30px', fontWeight: 900, textAlign: 'center', marginBottom: '14px', letterSpacing: '1px' } }, '會全部被刪除！'),
    h('div', { style: { fontSize: '16px', lineHeight: 1.7, background: 'rgba(0,0,0,.2)', borderRadius: '14px', padding: '12px 14px' } },
      h('b', '會刪除（只在這支手機）：'),
      h('ul', { style: { paddingLeft: '20px', margin: '6px 0' } },
        li('身體記錄 ' + n.e + ' 筆（體重、血壓、注射、體組成）'), li('餐點 ' + n.m + ' 筆、常用食物 ' + n.f + ' 項、斷食記錄 ' + n.x + ' 筆'),
        li('個人資料、AI 的 API 金鑰、所有設定')),
      h('b', '不會動：'),
      h('ul', { style: { paddingLeft: '20px', margin: '6px 0 0' } },
        li('Google Drive 雲端的 MetaPulse 存檔：會先中斷連線，雲端那份完全不會被改動或刪除。之後重新連線同一個帳號，記錄會再合併回來。'),
        li('同步版、Health Connect 裡的資料。'))),
    bkBtn, bk,
    h('div', { style: { fontSize: '16px', fontWeight: 700, marginTop: '18px' } }, '確定要清除，請輸入「' + WORD + '」：'),
    input, go, cancel));
  upd();
  document.body.append(el);
  cancel.focus();
}

/** 「其他」卡裡的危險區：一顆紅色按鈕，按了才跳出紅色警戒 */
export function dangerCard() {
  return h('div', { style: { marginTop: '14px', paddingTop: '12px', borderTop: '2px solid #dc2626' } },
    h('div.small', { style: { color: '#dc2626', fontWeight: 700 } }, '危險區'),
    h('button.full', { type: 'button', onclick: () => overlay(true), style: { marginTop: '8px', background: 'transparent', color: '#dc2626', border: '2px solid #dc2626', fontWeight: 700 } }, '只清除飲食和斷食記錄'),
    h('div.mu.tiny.one', { style: { marginTop: '4px' } }, '連雲端一起清；體重、血壓、注射不動'),
    h('button.full', { type: 'button', onclick: () => overlay(false), style: { marginTop: '10px', background: '#dc2626', color: '#fff', border: '0', fontWeight: 700 } }, '清除全部資料，回到預設值'),
    h('div.mu.tiny.one', { style: { marginTop: '4px' } }, '只清這支手機，雲端存檔不會動'));
}
