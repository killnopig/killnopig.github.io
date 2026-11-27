/* 身體頁「抽血檢查」卡：看某一次的每個項目（和上次比升降、超出報告參考範圍標色）、點項目看歷次數字；
 * 匯入：從 Excel 複製貼上，或拍健檢報告讓 Gemini 讀（都先列出來，確認才存） */
import { S, L, commit, commitLocal } from '../state.js';
import { h, toast, fold, tip, openSheet, closeSheet } from './common.js';
import { localDate } from '../points.js';
import { readLabShot, shrinkImage } from '../gemini.js';
import { parseLabTable, shotLabRecs, planLabs, applyLabs, labRows, labHistory, labName, labUnit, labFlag, refText, labSort } from '../labs.js';

let pick = '';   // 正在看哪一次（日期）；空的 = 最近一次
const md = d => d.slice(0, 4) + '/' + +d.slice(5, 7) + '/' + +d.slice(8);
const fmt = v => (typeof v === 'number' ? String(v) : v);
const hasAI = () => !!(L.geminiKey && L.geminiModel);
const FLAG = { hi: '偏高', lo: '偏低' };

export function labsCard() {
  const labs = [...(S.labs || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = labs[labs.length - 1];
  if (pick && !labs.some(x => x.date === pick)) pick = '';
  const date = pick || (last && last.date);
  const nOut = last ? labRows(labs, last.date).filter(r => r.flag).length : 0;
  const sum = last ? '最近 ' + md(last.date) + (nOut ? '・' + nOut + ' 項超出範圍' : '') + '・共 ' + labs.length + ' 次' : '還沒有記錄・可貼 Excel 或拍報告';
  const body = [];
  if (last) {
    const sel = h('select', { 'aria-label': '哪一次', style: { flex: '1 1 0', minWidth: 0 } }, ...labs.slice().reverse().map(x => h('option', { value: x.date }, md(x.date) + '（' + Object.keys(x.v).length + ' 項）')));
    sel.value = date;
    sel.onchange = () => { pick = sel.value; commit(); };
    const del = h('button.link.small', { type: 'button', style: { color: 'var(--warn)' } }, '刪除這次');
    del.onclick = () => {
      if (!del.dataset.c) { del.dataset.c = 1; del.textContent = '再按一次確認'; setTimeout(() => { del.dataset.c = ''; del.textContent = '刪除這次'; }, 3000); return; }
      S.labs = (S.labs || []).filter(x => x.date !== date); pick = ''; commit(); toast('已刪除 ' + md(date) + ' 的抽血記錄');
    };
    body.push(h('div.row', { style: { gap: '10px', alignItems: 'center' } }, sel, del));
    for (const r of labRows(labs, date)) {
      const n = typeof r.val === 'number' && r.prev && typeof r.prev.val === 'number' ? Math.round((r.val - r.prev.val) * 100) / 100 : null;
      const arrow = n == null ? '' : n > 0 ? '↑' + n : n < 0 ? '↓' + -n : '持平';
      const hist = h('div', { style: { display: 'none', padding: '2px 0 6px 10px' } });
      const row = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto 64px', gap: '8px', alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid var(--ln)', cursor: 'pointer' } },
        h('span.small.one', labName(r.k)),
        h('span.num', { style: { fontWeight: 650, color: r.flag ? 'var(--warn)' : '' } }, fmt(r.val), h('span.mu.tiny', labUnit(r.k) ? ' ' + labUnit(r.k) : ''), r.flag ? h('span.tiny', ' ' + FLAG[r.flag]) : null),
        h('span.mu.tiny.num.one', { style: { textAlign: 'right' } }, arrow));
      row.onclick = () => {
        if (hist.style.display === 'none') {
          hist.textContent = '';
          hist.append(...labHistory(labs, r.k).map(x => {
            const rf = ((labs.find(y => y.date === x.date) || {}).r || {})[r.k], fl = labFlag(x.val, rf);
            return h('div.tiny.num', { style: { fontWeight: x.date === date ? 700 : 400, color: fl ? 'var(--warn)' : '' } }, md(x.date) + '　' + fmt(x.val) + (fl ? ' ' + FLAG[fl] : '') + (rf ? '（參考 ' + refText(rf) + '）' : ''));
          }));
          hist.style.display = '';
        } else hist.style.display = 'none';
      };
      body.push(row, hist);
    }
  }
  body.push(h('div.grid2', { style: { marginTop: '8px' } },
    h('button.ghost', { type: 'button', onclick: () => openPaste() }, '📋 貼 Excel'),
    hasAI() ? h('button.ghost', { type: 'button', onclick: () => openLabShot() }, '📷 拍報告') : h('button.ghost', { type: 'button', onclick: () => toast('要先到「設定 → AI 辨識食物」貼上 Gemini 金鑰') }, '📷 拍報告')),
    tip('點一個項目可以看歷次的數字。「↑」「↓」是和前一次有這個項目的抽血比。紅字「偏高／偏低」只照報告上寫的參考範圍標（有讀到範圍才標），不是診斷，請以醫師的說明為準。常見項目（血糖、HbA1c、膽固醇、肝腎功能、尿酸等）會統一名稱，不同醫院寫法不同也算同一項；其他項目照報告上的名稱存。'));
  const head = h('div.grow', h('h2', { style: { margin: 0 } }, '抽血檢查'), h('div.mu.small.one', { style: { marginTop: '2px', color: nOut ? 'var(--warn)' : '' } }, sum));
  return h('div.card', fold('labs', head, [h('div', { style: { marginTop: '8px' } }, ...body)]));
}

/** 讀到的結果 → 預覽（每一次、每一項、參考範圍），確認才存；dateEdit：照片看不出日期時讓使用者改 */
function preview(out, r, dateEdit = false) {
  out.textContent = '';
  if (!r.recs.length) { out.append(h('div.notice', '沒有讀到檢驗數字。')); return; }
  const draw = () => {
    out.textContent = '';
    const p = planLabs(r.recs, S.labs);
    const known = r.keys.filter(k => !k.startsWith('x:')), other = r.keys.filter(k => k.startsWith('x:'));
    const box = h('div', { style: { background: 'var(--soft)', borderRadius: '10px', padding: '7px 10px', lineHeight: 1.5 } },
      h('div.small', '讀到 ' + r.recs.length + ' 次（' + md(r.recs[0].date) + (r.recs.length > 1 ? ' ～ ' + md(r.recs[r.recs.length - 1].date) : '') + '）、' + r.keys.length + ' 個項目'),
      h('div.small', '新增 ', h('b', p.add.length), ' 次・補上 ', h('b', p.upd.length), ' 次' + (p.changed ? '（其中 ' + p.changed + ' 個數字不同，會用新的）' : '') + '・已經有 ' + p.same + ' 次'));
    if (dateEdit && r.recs.length === 1) {
      const di = h('input', { type: 'date', value: r.recs[0].date, max: localDate(new Date()) });
      di.onchange = () => { if (/^\d{4}-\d{2}-\d{2}$/.test(di.value)) { r.recs[0].date = di.value; draw(); } };
      box.append(h('div.row.small', { style: { gap: '8px', marginTop: '4px', alignItems: 'center' } }, h('span', { style: { color: 'var(--warn)' } }, '看不出日期，請改成抽血那天：'), di));
    }
    if (r.recs.length === 1) {   // 一次的話把每一項列出來核對
      const x = r.recs[0];
      box.append(...Object.keys(x.v).sort(labSort).map(k => {
        const rf = (x.r || {})[k], fl = labFlag(x.v[k], rf);
        return h('div.tiny.num', { style: { color: fl ? 'var(--warn)' : '' } }, labName(k) + '　' + fmt(x.v[k]) + (labUnit(k) ? ' ' + labUnit(k) : '') + (rf ? '（參考 ' + refText(rf) + '）' : '') + (fl ? ' ' + FLAG[fl] : ''));
      }));
    } else {
      if (known.length) box.append(h('div.tiny.mu', { style: { marginTop: '4px' } }, '認得的：' + known.map(k => labName(k) + (r.raw[k] && !labName(k).toLowerCase().includes(r.raw[k].toLowerCase()) ? '（' + r.raw[k] + '）' : '')).join('、')));
      if (other.length) box.append(h('div.tiny.mu', { style: { marginTop: '2px' } }, '照原名存：' + other.map(labName).join('、')));
    }
    out.append(box);
    if (r.note) out.append(h('div.mu.tiny', { style: { marginTop: '4px' } }, 'AI：' + r.note));
    if (!p.add.length && !p.upd.length) { out.append(h('div.notice.ok', { style: { marginTop: '8px' } }, '這些都已經有了，不用再存。')); return; }
    out.append(h('div.mu.tiny', { style: { marginTop: '6px' } }, '請對一下日期、項目和數字跟報告一樣再存；存了也能刪掉這次重來。'),
      h('button.pri.full', { type: 'button', style: { marginTop: '6px' }, onclick: () => {
        applyLabs(S, p); pick = ''; commit(); closeSheet();
        toast('已存入 ' + (p.add.length + p.upd.length) + ' 次抽血記錄');
      } }, '確認存入'));
  };
  draw();
}

/** 貼上 Excel 的畫面 */
export function openPaste() {
  openSheet(sh => {
    const ta = h('textarea', { rows: 6, placeholder: '在 Excel 選取整張表（含日期和項目名稱）→ 複製 → 貼在這裡' });
    const out = h('div', { style: { marginTop: '8px' } });
    const go = h('button.pri.full', { type: 'button', style: { marginTop: '8px' } }, '讀取');
    go.onclick = () => {
      const r = parseLabTable(ta.value);
      if (r.err) { out.textContent = ''; out.append(h('div.notice', r.err)); return; }
      preview(out, r);
    };
    sh.append(h('div.sheet-h', h('b', '從 Excel 貼上抽血表'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')),
      tip('兩種擺法都可以：每一列是一次抽血（第一欄是日期、第一列是項目名稱），或每一列是一個項目（第一列是日期）。有「參考值」欄或列的話也會讀進來，用來標偏高偏低。日期可以是 2024/3/5、113/03/05（民國）或 20240305。「5.6 H」「<0.5」會取數字，「陰性」這類文字照存；空格不算。同一天已經有的會補上，不會重複。資料只在這支手機裡處理，不會送出去。'),
      ta, go, out);
  });
}

/** 拍健檢報告（可多張）讓 Gemini 讀 */
export function openLabShot() {
  openSheet(sh => {
    const out = h('div', { style: { marginTop: '10px' } });
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
    const pickBtn = h('button.pri.full', { type: 'button', onclick: () => file.click() }, '📷 拍照或選報告照片（可多張）');
    file.onchange = async () => {
      const fs = [...(file.files || [])]; file.value = '';
      if (!fs.length) return;
      pickBtn.disabled = true;
      const today = localDate(new Date()), all = { recs: [], keys: [], raw: {}, note: '' }, notes = [], errs = [];
      let noDate = false;
      const byDate = new Map();
      for (let i = 0; i < fs.length; i++) {
        out.textContent = '';
        out.append(h('div.row.small.mu', h('span.spin'), 'AI 讀取中…' + (fs.length > 1 ? '第 ' + (i + 1) + '／' + fs.length + ' 張' : '（約 10～30 秒）')));
        try {
          const img = await shrinkImage(fs[i], 1400, 0.85, true);   // 報告字小：照寬度縮到 1400px
          const x = await readLabShot({ key: L.geminiKey, model: L.geminiModel, api: L.geminiApi, prefer: L.geminiApiOk }, img, today);
          if (L.geminiApiOk !== x.api) { L.geminiApiOk = x.api; commitLocal(); }
          const r = shotLabRecs(x.parsed, today);
          noDate = noDate || r.noDate;
          Object.assign(all.raw, r.raw);
          for (const rec of r.recs) {   // 同一天（例如一份報告拍好幾頁）合成一次
            const o = byDate.get(rec.date) || { date: rec.date, v: {}, r: {} };
            Object.assign(o.v, rec.v); Object.assign(o.r, rec.r || {});
            byDate.set(rec.date, o);
          }
          const n = String(x.parsed?.note || '').trim(); if (n) notes.push(n);
        } catch (e) { errs.push('第 ' + (i + 1) + ' 張：' + (e && e.message ? e.message : e)); }
      }
      all.recs = [...byDate.values()].map(o => (Object.keys(o.r).length ? o : { date: o.date, v: o.v })).sort((a, b) => (a.date < b.date ? -1 : 1));
      all.keys = [...new Set(all.recs.flatMap(r => Object.keys(r.v)))].sort(labSort);
      all.note = notes.join('；');
      pickBtn.disabled = false;
      preview(out, all, noDate);
      if (errs.length) out.prepend(h('div.notice', { style: { marginBottom: '8px' } }, '讀取失敗：' + errs.join('；')));
    };
    sh.append(h('div.sheet-h', h('b', '拍健檢報告'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')),
      h('div.mu.small.one', '一份報告有好幾頁，可以一次選好幾張'),
      tip('拍健康檢查報告或醫院的抽血檢驗單，AI 會讀出日期、每個項目的數字和參考範圍，先列給你核對，按「確認存入」才會存。拍的時候整張放平、光線夠、字要清楚。報告上的姓名、病歷號不會讀。照片只會送給你自己設定的 Gemini 讀數字，不會存在手機或其他地方。'),
      file, pickBtn, out);
  });
}
