/* 身體頁：Omron 截圖匯入。選 OMRON connect 的截圖 → Gemini 讀數字 → 列出來 → 按確認才存（設定裡可復原） */
import { S, L, commit, commitLocal, uid } from '../state.js';
import { h, toast, tip, openSheet, closeSheet } from './common.js';
import { localDate } from '../points.js';
import { readOmronShot, shrinkImage } from '../gemini.js';
import { shotRecords, planShot, shotLine } from '../omronShot.js';
import { applyHealth } from '../health.js';

const UNDO_KEY = 'metapulse-v1-undo';
const hasAI = () => !!(L.geminiKey && L.geminiModel);

export function openShot() {
  openSheet(sh => {
    const out = h('div', { style: { marginTop: '10px' } });
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
    const pick = h('button.pri.full', { type: 'button', onclick: () => file.click() }, '📷 選 Omron 截圖（可多張）');

    file.onchange = async () => {
      const fs = [...(file.files || [])];
      file.value = '';
      if (!fs.length) return;
      pick.disabled = true;
      const today = localDate(new Date()), recs = [], notes = [], errs = [];
      for (let i = 0; i < fs.length; i++) {
        out.textContent = '';
        out.append(h('div.row.small.mu', h('span.spin'), 'AI 讀取中…' + (fs.length > 1 ? '第 ' + (i + 1) + '／' + fs.length + ' 張' : '（約 5～15 秒）')));
        try {
          const img = await shrinkImage(fs[i], 900, 0.85, true);   // 截圖很長：照寬度縮，字才看得清楚
          const x = await readOmronShot({ key: L.geminiKey, model: L.geminiModel, api: L.geminiApi, prefer: L.geminiApiOk }, img, today);
          if (L.geminiApiOk !== x.api) { L.geminiApiOk = x.api; commitLocal(); }
          recs.push(...shotRecords(x.parsed, today));
          const n = String(x.parsed?.note || '').trim(); if (n) notes.push(n);
        } catch (e) { errs.push('第 ' + (i + 1) + ' 張：' + (e && e.message ? e.message : e)); }
      }
      // 幾張截圖重複出現的同一筆只留一次
      const seen = new Set(), uniq = recs.filter(r => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
      show(uniq, notes.join('；'), errs);
      pick.disabled = false;
    };

    function show(recs, note, errs = []) {
      out.textContent = '';
      if (errs.length) out.append(h('div.notice', { style: { marginBottom: '8px' } }, '讀取失敗：' + errs.join('；')));
      if (!recs.length) { if (!errs.length) out.append(h('div.notice', '沒有讀到量測數字，換有數字的畫面試試。')); return; }
      const p = planShot(recs, S.entries);
      const box = h('div', { style: { background: 'var(--soft)', borderRadius: '10px', padding: '7px 10px', lineHeight: 1.45 } },
        h('div.small.mu.one', '讀到 ' + recs.length + ' 筆：新增 ' + p.add.length + '・補上 ' + p.merge.length + '・已有 ' + p.dup),
        ...recs.map(r => h('div.small.num', shotLine(r))));
      out.append(box);
      if (note) out.append(h('div.mu.tiny', { style: { marginTop: '4px' } }, 'AI：' + note));
      if (!p.add.length && !p.merge.length) { out.append(h('div.notice.ok', { style: { marginTop: '8px' } }, '這些都已經有了，不用再存。')); return; }
      out.append(h('div.mu.tiny', { style: { marginTop: '6px' } }, '請對一下數字和截圖一樣再存；讀錯可以按「選 Omron 截圖」重來，存了也能在記錄列表修改。'),
        h('button.pri.full', { type: 'button', onclick: () => {
          try { localStorage.setItem(UNDO_KEY, JSON.stringify({ entries: S.entries, activity: S.activity || [] })); } catch (e) { /* 空間不足時不保留復原 */ }
          applyHealth(S, { ...p, act: { add: [], update: [] } }, uid);
          commit(); closeSheet();
          toast('已存入 ' + (p.add.length + p.merge.length) + ' 筆（設定可復原）');
        } }, '確認存入'));
    }

    sh.append(h('div.sheet-h', h('b', 'Omron 截圖匯入'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')),
      h('div.mu.small.one', '骨骼肌、內臟脂肪、身體年齡也讀得到'),
      tip('在 OMRON connect 打開量測結果的畫面截圖，回來這裡選圖，一次可以選好幾張。AI 會讀出血壓、脈搏、體重、體脂、骨骼肌、內臟脂肪、身體年齡、基礎代謝，先列給你看，按「確認存入」才會存。同一次量測已經從 Health Connect 匯入的，會補上缺的欄位，不會重複。截圖只會送給你自己設定的 Gemini 讀數字，不會存在手機或其他地方。'),
      file, pick, out);
  });
}

/** 身體頁的入口（有設定 AI 金鑰才顯示） */
export const shotEntry = () => hasAI()
  ? h('div.card', { style: { cursor: 'pointer', padding: '10px 14px' }, onclick: () => openShot() },
    h('div.row.between', h('b.small.one', '📷 Omron 截圖匯入'), h('span.mu.small.one', '骨骼肌、內臟脂肪 ›')))
  : null;
