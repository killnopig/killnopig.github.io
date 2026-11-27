/* 設定頁：Omron CSV 匯入（多檔、預覽、重複判斷、補上體組成、復原上次匯入） */
import { S, L, commit, commitLocal, uid } from '../state.js';
import { h, toast, tip } from './common.js';
import { planOmron } from '../omron.js';

const UNDO_KEY = 'metapulse-v1-undo';
const hasUndo = () => { try { return !!localStorage.getItem(UNDO_KEY); } catch (e) { return false; } };
const fmtAt = t => new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/** 設定頁「同步與匯入」卡裡的 Omron CSV 小格：回傳 {sum: 一行狀態, body} */
export function omronPart() {
  const sumEl = h('span');
  const drawSum = () => { const x = L.lastOmron; sumEl.textContent = x ? fmtAt(x.at) + '・新增 ' + x.added + ' 筆' : 'CSV 檔'; };
  drawSum();
  const file = h('input', { type: 'file', accept: '.csv,.tsv,.txt,text/csv', multiple: true, style: { display: 'none' } });
  const pick = h('button.ghost.full', { type: 'button', onclick: () => file.click() }, '選 CSV 檔（可多個）');
  const out = h('div', { style: { marginTop: '10px' } });
  const undo = h('button.ghost.full', { type: 'button', style: { display: hasUndo() ? '' : 'none', marginTop: '8px' } }, '復原上次匯入');

  file.onchange = async () => {
    const fs = [...(file.files || [])]; file.value = '';
    if (!fs.length) return;
    out.textContent = '';
    let r;
    try { r = planOmron(await Promise.all(fs.map(async f => ({ name: f.name, text: await f.text() }))), S.entries); }
    catch (e) { out.append(h('div.notice', '讀取檔案失敗：' + (e.message || e))); return; }
    const p = r.plan;
    out.append(h('div', { style: { background: 'var(--soft)', borderRadius: '12px', padding: '10px 12px', lineHeight: 1.8 } },
      ...r.info.map(st => h('div.small', '「' + st.name + '」：' + (st.err || st.type + ' ' + st.rows + ' 筆' + (st.from ? '（' + st.from + ' ～ ' + st.to + '）' : '') + (st.skipped ? '・看不懂略過 ' + st.skipped + ' 列' : '')))),
      h('div.small', { style: { marginTop: '4px' } }, '合計：新增 ', h('b', p.add.length), ' 筆・補上身體組成 ', h('b', p.merge.length), ' 筆・已存在略過 ', p.dup, ' 筆')));
    if (!p.add.length && !p.merge.length) { out.append(h('div.notice.ok', '沒有新的資料。')); return; }
    const go = h('button.pri.full', { type: 'button' }, '確認匯入');
    go.onclick = () => {
      try { localStorage.setItem(UNDO_KEY, JSON.stringify({ entries: S.entries, activity: S.activity || [] })); } catch (e) { /* 空間不足時不保留復原 */ }
      for (const rec of p.add) S.entries.push({ ...rec, id: uid('e') });
      for (const mg of p.merge) { const t = S.entries.find(e => e.id === mg.id); if (t) Object.assign(t, mg.fill); }
      L.lastOmron = { at: Date.now(), added: p.add.length + p.merge.length }; commitLocal();
      commit(); drawSum();
      out.textContent = ''; out.append(h('div.notice.ok', '✓ 已新增 ' + p.add.length + ' 筆、補上 ' + p.merge.length + ' 筆身體組成。'));
      undo.style.display = hasUndo() ? '' : 'none';
      toast('Omron 匯入完成');
    };
    out.append(go);
  };
  undo.onclick = () => {
    if (!undo.dataset.c) { undo.dataset.c = 1; undo.textContent = '再按一次確認復原'; setTimeout(() => { undo.dataset.c = ''; undo.textContent = '復原上次匯入'; }, 3000); return; }
    try {
      const p = JSON.parse(localStorage.getItem(UNDO_KEY));
      S.entries = p.entries; S.activity = p.activity; localStorage.removeItem(UNDO_KEY);
      commit(); undo.style.display = 'none'; out.textContent = ''; out.append(h('div.notice.ok', '已回到上次匯入之前。')); toast('已復原');
    } catch (e) { toast('復原失敗', true); }
  };
  return { sum: sumEl, body: [
    file, pick, out, undo,
    tip('在 OMRON connect app 把血壓、體重、體組成匯出成 CSV 檔（一種表格檔），在這裡選擇。可以一次選好幾個檔案。會先讓你看要加入幾筆，已經有的不會重複加入。Health Connect 沒有的骨骼肌、內臟脂肪、身體年齡，用這個方法補上。「復原上次匯入」和 Health Connect 同步共用，只能回到最近一次匯入之前。'),
  ] };
}
