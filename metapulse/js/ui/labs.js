/* 身體頁「抽血檢查」卡：看某一次的每個項目（和上次比升降）、點項目看歷次數字；從 Excel 複製貼上匯入 */
import { S, commit } from '../state.js';
import { h, toast, fold, tip, openSheet, closeSheet } from './common.js';
import { parseLabTable, planLabs, applyLabs, labRows, labHistory, labName, labUnit } from '../labs.js';

let pick = '';   // 正在看哪一次（日期）；空的 = 最近一次
const md = d => d.slice(0, 4) + '/' + +d.slice(5, 7) + '/' + +d.slice(8);
const fmt = v => (typeof v === 'number' ? String(v) : v);

export function labsCard() {
  const labs = [...(S.labs || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const last = labs[labs.length - 1];
  if (pick && !labs.some(x => x.date === pick)) pick = '';
  const date = pick || (last && last.date);
  const sum = last ? '最近 ' + md(last.date) + '・共 ' + labs.length + ' 次' : '還沒有記錄・可以從 Excel 貼上';
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
        h('span.num', { style: { fontWeight: 650 } }, fmt(r.val), h('span.mu.tiny', labUnit(r.k) ? ' ' + labUnit(r.k) : '')),
        h('span.mu.tiny.num.one', { style: { textAlign: 'right' } }, arrow));
      row.onclick = () => {
        if (hist.style.display === 'none') {
          hist.textContent = '';
          hist.append(...labHistory(labs, r.k).map(x => h('div.tiny.num', { style: { fontWeight: x.date === date ? 700 : 400 } }, md(x.date) + '　' + fmt(x.val))));
          hist.style.display = '';
        } else hist.style.display = 'none';
      };
      body.push(row, hist);
    }
  }
  body.push(h('button.ghost.full', { type: 'button', style: { marginTop: '8px' }, onclick: () => openPaste() }, '📋 從 Excel 貼上抽血表'),
    tip('點一個項目可以看歷次的數字。「↑」「↓」是和前一次有這個項目的抽血比。常見項目（血糖、HbA1c、膽固醇、肝腎功能、尿酸等）會統一名稱，不同醫院寫法不同也會算同一項；其他項目照表上的名稱存。這裡只記數字，好壞請以報告和醫師的說明為準。'));
  const head = h('div.grow', h('h2', { style: { margin: 0 } }, '抽血檢查'), h('div.mu.small.one', { style: { marginTop: '2px' } }, sum));
  return h('div.card', fold('labs', head, [h('div', { style: { marginTop: '8px' } }, ...body)]));
}

/** 貼上 Excel 的畫面：預覽 → 確認才存 */
export function openPaste() {
  openSheet(sh => {
    const ta = h('textarea', { rows: 6, placeholder: '在 Excel 選取整張表（含日期和項目名稱）→ 複製 → 貼在這裡' });
    const out = h('div', { style: { marginTop: '8px' } });
    const go = h('button.pri.full', { type: 'button', style: { marginTop: '8px' } }, '讀取');
    go.onclick = () => {
      out.textContent = '';
      const r = parseLabTable(ta.value);
      if (r.err) { out.append(h('div.notice', r.err)); return; }
      const p = planLabs(r.recs, S.labs);
      const known = r.keys.filter(k => !k.startsWith('x:')), other = r.keys.filter(k => k.startsWith('x:'));
      out.append(h('div', { style: { background: 'var(--soft)', borderRadius: '10px', padding: '7px 10px', lineHeight: 1.5 } },
        h('div.small', '讀到 ' + r.recs.length + ' 次（' + md(r.recs[0].date) + ' ～ ' + md(r.recs[r.recs.length - 1].date) + '）、' + r.keys.length + ' 個項目'),
        h('div.small', '新增 ', h('b', p.add.length), ' 次・補上 ', h('b', p.upd.length), ' 次' + (p.changed ? '（其中 ' + p.changed + ' 個數字不同，會用新的）' : '') + '・已經有 ' + p.same + ' 次'),
        known.length ? h('div.tiny.mu', { style: { marginTop: '4px' } }, '認得的：' + known.map(k => labName(k) + (r.raw[k] && !labName(k).toLowerCase().includes(r.raw[k].toLowerCase()) ? '（' + r.raw[k] + '）' : '')).join('、')) : null,
        other.length ? h('div.tiny.mu', { style: { marginTop: '2px' } }, '照原名存：' + other.map(labName).join('、')) : null));
      if (!p.add.length && !p.upd.length) { out.append(h('div.notice.ok', { style: { marginTop: '8px' } }, '這些都已經有了，不用再存。')); return; }
      out.append(h('div.mu.tiny', { style: { marginTop: '6px' } }, '請對一下日期和項目名稱；數字可以存了再到卡片裡看。'),
        h('button.pri.full', { type: 'button', style: { marginTop: '6px' }, onclick: () => {
          applyLabs(S, p); pick = ''; commit(); closeSheet();
          toast('已存入 ' + (p.add.length + p.upd.length) + ' 次抽血記錄');
        } }, '確認存入'));
    };
    sh.append(h('div.sheet-h', h('b', '從 Excel 貼上抽血表'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')),
      tip('兩種擺法都可以：每一列是一次抽血（第一欄是日期、第一列是項目名稱），或每一列是一個項目（第一列是日期）。日期可以是 2024/3/5、113/03/05（民國）或 20240305。「5.6 H」「<0.5」會取數字，「陰性」這類文字照存；空格不算。同一天已經有的會補上，不會重複。資料只在這支手機裡處理，不會送出去。'),
      ta, go, out);
  });
}
