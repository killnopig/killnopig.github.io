/* 記錄分頁：體重計／血壓計／注射三張儀器卡（輸入與顯示一致）＋記錄列表 */
import { S, L, commit, commitLocal, uid } from '../state.js';
import { h, icon, toast, fold, pills, openSheet, closeSheet, val, tip } from './common.js';
import { localDate, addDays } from '../points.js';
import { leanSummary } from '../longterm.js';
import { leanStatus, leanCard } from './fasting.js';
import { SITES, sortEntries, onBoard, nextDose, bmi, leanMass, dn, md, wdOf, TYPES, hasValue } from '../records.js';

const r1 = x => Math.round(x * 10) / 10;
const nowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const lastOf = (es, f) => { for (let i = es.length - 1; i >= 0; i--) if (f(es[i])) return es[i]; return null; };
const when = e => md(e.date) + '（' + wdOf(e.date) + '）' + (e.time ? ' ' + e.time : '');

function stat(label, value, unit) {
  return h('div', h('div.mu.tiny', label), h('div.num', h('b', value), unit ? h('span.mu.small', ' ' + unit) : null));
}

/* ---------- 輸入面板 ---------- */
const GROUPS = {
  wt: { title: '體重計／體脂計', fields: [['wt', '體重', 'kg', 0.1], ['fat', '體脂率', '%', 0.1], ['mus', '骨骼肌率', '%', 0.1], ['vis', '內臟脂肪等級', '', 0.5], ['bage', '身體年齡', '歲', 1], ['bmr', '基礎代謝', '大卡', 1]] },
  bp: { title: '血壓計', fields: [['sys', '收縮壓', 'mmHg', 1], ['dia', '舒張壓', 'mmHg', 1], ['pul', '脈搏', '次/分', 1]] },
  dose: { title: '注射', fields: [['dose', '劑量', 'mg', 0.1]] },
};

/**
 * @param {{type?:'wt'|'bp'|'dose', entry?:object}} o  entry 有值時為編輯
 */
export function openEntry(o = {}) {
  const ed = o.entry || null;
  const e = ed ? { ...ed } : { date: localDate(new Date()), time: o.type === 'dose' ? '' : nowHM(), note: '', site: '' };
  const types = ed ? ['wt', 'bp', 'dose'] : [o.type || 'wt'];
  openSheet(sh => {
    sh.append(h('div.sheet-h', h('b', ed ? '編輯記錄' : '記錄' + GROUPS[types[0]].title), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')));
    const dateIn = h('input', { type: 'date', value: e.date });
    const timeIn = h('input', { type: 'time', value: e.time || '' });
    sh.append(h('div.grid2', h('div', h('label', '日期'), dateIn), h('div', h('label', '量測時間（選填）'), timeIn)));
    const ins = {};
    let siteSel = null;
    for (const t of types) {
      const g = GROUPS[t];
      const grid = h('div.grid2');
      for (const [k, label, unit, step] of g.fields) {
        ins[k] = h('input.num', { type: 'number', inputmode: step < 1 ? 'decimal' : 'numeric', step: String(step), min: '0', value: e[k] > 0 ? e[k] : '' });
        grid.append(h('div', h('label', label + (unit ? '（' + unit + '）' : '')), ins[k]));
      }
      const parts = [grid];
      if (t === 'dose') {
        const nd = nextDose(S.entries.filter(x => !ed || x.id !== ed.id), localDate(new Date()));
        siteSel = h('select', h('option', { value: '' }, '（不填）'), ...SITES.map(s => h('option', { value: s }, s)));
        siteSel.value = ed ? (e.site || '') : (nd ? nd.site : SITES[0]);
        parts.push(h('label', '注射部位'), siteSel);
      }
      if (ed) {
        const has = g.fields.some(([k]) => e[k] > 0);
        sh.append(h('div.card', { style: { marginTop: '12px' } }, fold('edit-' + t, h('b.small', g.title), [h('div', ...parts)], { open: has, force: has })));
      } else sh.append(h('div', { style: { marginTop: '4px' } }, ...parts));
    }
    if (!ed && types[0] === 'dose') timeIn.parentNode.querySelector('label').textContent = '時間（選填）';
    const noteIn = h('input', { type: 'text', value: e.note || '', placeholder: '例如：輕微噁心、飯後' });
    const msg = h('div.small', { style: { color: 'var(--bad)', marginTop: '8px' } });
    sh.append(h('label', '備註'), noteIn, msg);

    const save = h('button.pri.full', { type: 'button' }, ed ? '更新記錄' : '儲存');
    save.onclick = () => {
      const rec = { date: dateIn.value, time: timeIn.value || '', note: noteIn.value.trim() };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.date)) { msg.textContent = '請選擇日期。'; return; }
      for (const k of ['dose', 'wt', 'sys', 'dia', 'pul', 'fat', 'mus', 'vis', 'bage', 'bmr']) rec[k] = ins[k] ? Math.max(0, val(ins[k])) : (ed ? +ed[k] || 0 : 0);
      if ((rec.sys > 0) !== (rec.dia > 0)) { msg.textContent = '血壓請同時輸入收縮壓和舒張壓。'; return; }
      if (!hasValue(rec)) { msg.textContent = '請至少輸入一項數值。'; return; }
      rec.site = rec.dose > 0 ? (siteSel ? siteSel.value : e.site || '') : '';
      if (ed) { const t = S.entries.find(x => x.id === ed.id); Object.assign(t, rec); }
      else S.entries.push({ id: uid('e'), src: 'manual', sid: '', ...rec });
      commit(); closeSheet(); toast(ed ? '已更新' : '已儲存');
    };
    sh.append(save);
    if (ed) {
      const del = h('button.danger.full', { type: 'button' }, icon('trash'), ' 刪除這筆記錄');
      del.onclick = () => {
        if (!del.dataset.c) { del.dataset.c = 1; del.textContent = '再按一次確認刪除'; setTimeout(() => { del.dataset.c = ''; del.textContent = '刪除這筆記錄'; }, 3000); return; }
        S.entries = S.entries.filter(x => x.id !== ed.id); commit(); closeSheet(); toast('已刪除');
      };
      sh.append(del);
    }
  });
}

/* ---------- 儀器卡：收起時一行重點，右邊「＋」直接記錄 ---------- */
function addBtn(type, label) {
  return h('button.link.small', { type: 'button', style: { whiteSpace: 'nowrap', flexShrink: 0 }, onclick: ev => { ev.preventDefault(); ev.stopPropagation(); openEntry({ type }); } }, icon('plus'), ' ' + label);
}
/** 卡片標題列：標題＋一行摘要＋按鈕；body 為展開內容（沒有就不收合） */
function deviceCard(key, title, summary, btn, body, { force = false, accent = false } = {}) {
  const head = h('div.row.grow', h('div.grow', h('h2', { style: { margin: 0 } }, title), h('div.small.num.one', { style: { marginTop: '2px', color: accent ? 'var(--ac)' : '', fontWeight: accent ? 650 : 400 } }, summary)), btn);
  const card = h('div.card', accent ? { style: { borderColor: 'var(--ac)' } } : null);
  card.append(body ? fold(key, head, [body], { open: false, force }) : head);
  return card;
}

function scaleCard(es) {
  const w = lastOf(es, x => x.wt > 0);
  if (!w && !lastOf(es, TYPES.bc)) return deviceCard('dev-scale', '體重計', '還沒有記錄', addBtn('wt', '記錄'));
  const b = w ? bmi(w.wt, S.profile.height) : null;
  const tw = +S.profile.targetWeight;

  const more = [];
  if (w) more.push(stat('體重 · ' + md(w.date), w.wt, 'kg'));
  const mx = es.reduce((a, e) => (e.wt > (a ? a.wt : 0) ? e : a), null);
  const lost = w && mx ? mx.wt - w.wt : 0;
  for (const [k, label, unit] of [['fat', '體脂率', '%'], ['mus', '骨骼肌率', '%'], ['vis', '內臟脂肪', ''], ['bage', '身體年齡', '歲'], ['bmr', '基礎代謝', '大卡']]) {
    const x = lastOf(es, y => y[k] > 0);
    if (x) more.push(stat(label + ' · ' + md(x.date), x[k], unit));
  }
  const lm = lastOf(es, y => y.wt > 0 && y.fat > 0);
  if (lm) more.push(stat('淨體重 · ' + md(lm.date), r1(leanMass(lm)), 'kg'));
  const summary = (w ? w.wt + ' kg' : '–') + (lost >= 0.5 ? '・已瘦 ' + r1(lost) + ' kg' : '') + (w && tw ? (w.wt > tw ? '・差 ' + r1(w.wt - tw) : '・已達目標') : '') + (b ? '・BMI ' + r1(b.value) : '');
  const lsum = leanSummary(leanStatus());
  const body = h('div', { style: { marginTop: '10px' } }, h('div.grid3', { style: { rowGap: '12px' } }, ...more),
    mx && lost >= 0.5 ? h('div.small.num.one', { style: { marginTop: '8px' } }, '最高 ' + mx.wt + '（' + md(mx.date) + '）→ 現在 ' + w.wt + '・已瘦 ' + r1(lost) + ' kg') : null,
    lsum ? h('div.small.num', { style: { marginTop: '8px', fontWeight: 600, color: lsum.tone === 'good' ? 'var(--ac)' : lsum.tone === 'mid' ? '#ca8a04' : 'var(--warn)' } }, lsum.line) : null,
    !S.profile.height ? h('div.mu.tiny.one', { style: { marginTop: '6px' } }, '設定身高後顯示 BMI') : null);
  return deviceCard('dev-scale', '體重計', summary, addBtn('wt', '記錄'), body);
}

function bpCard(es) {
  const x = lastOf(es, y => y.sys > 0 && y.dia > 0) || lastOf(es, y => y.pul > 0);
  if (!x) return deviceCard('dev-bp', '血壓計', '還沒有記錄', addBtn('bp', '記錄'));
  const summary = (x.sys > 0 ? x.sys + '/' + x.dia + ' mmHg' : '') + (x.pul > 0 ? '・脈搏 ' + x.pul : '') + '・' + when(x);
  return deviceCard('dev-bp', '血壓計', summary, addBtn('bp', '記錄'));
}

/** 注射卡：平常收成一行，注射日前一天、當天或逾期時自動展開一次並以強調色提醒 */
export function doseCard(compact) {
  const es = sortEntries(S.entries);
  const ds = es.filter(TYPES.dose);
  const today = localDate(new Date());
  const nd = nextDose(es, today);
  if (!nd) return compact ? null : deviceCard('dose-card', '注射', '還沒有注射記錄', addBtn('dose', '記錄'));
  const due = nd.left <= 1;
  const leftTxt = nd.left > 0 ? '還有 ' + nd.left + ' 天' : nd.left === 0 ? '就是今天' : '已逾期 ' + (-nd.left) + ' 天';
  const line = '下次注射：' + md(nd.due) + '（週' + wdOf(nd.due) + '，' + leftTxt + '）・' + nd.site;
  const ob = ds.length ? onBoard(es, dn(today), +S.profile.halfLife || 120) : 0;
  const body = h('div', { style: { marginTop: '10px' } },
    h('div.grid3',
      stat('建議部位', nd.site),
      stat('最近一次 · ' + md(nd.last.date), nd.last.dose, 'mg'),
      stat('預估體內藥量', r1(ob), 'mg')),
    h('button' + (due ? '.pri' : '.ghost') + '.full', { type: 'button', onclick: () => openEntry({ type: 'dose' }) }, '記錄這次注射'),
    tip('體內藥量是用藥物半衰期粗略算的，只用來看變化，不是驗血結果，不能用來決定劑量。'));
  let force = false;
  if (due && L.doseForced !== nd.due + (compact ? 't' : 'l')) { force = true; L.doseForced = nd.due + (compact ? 't' : 'l'); commitLocal(); }
  return deviceCard('dose-card', '注射', line, null, body, { force, accent: due });
}

/* ---------- 記錄列表 ---------- */
function chips(e) {
  const c = [];
  if (e.dose > 0) c.push(['注射 ' + e.dose + ' mg' + (e.site ? '（' + e.site + '）' : ''), 'var(--c1)']);
  if (e.wt > 0) c.push(['體重 ' + e.wt + ' kg', 'var(--ac)']);
  if (e.sys > 0 && e.dia > 0) c.push(['血壓 ' + e.sys + '/' + e.dia + (e.pul > 0 ? '，脈搏 ' + e.pul : ''), 'var(--c3)']);
  else if (e.pul > 0) c.push(['脈搏 ' + e.pul, 'var(--c3)']);
  const bc = [];
  if (e.fat > 0) bc.push('體脂 ' + e.fat + '%');
  if (e.mus > 0) bc.push('骨骼肌 ' + e.mus + '%');
  if (e.vis > 0) bc.push('內臟脂肪 ' + e.vis);
  if (e.bage > 0) bc.push('身體年齡 ' + e.bage);
  if (e.bmr > 0) bc.push('基礎代謝 ' + e.bmr);
  if (bc.length) c.push([bc.join('　'), 'var(--c4)']);
  return c;
}
/** 同步版把量測時間寫在備註開頭；已拆到 time，顯示時去掉重複的部分 */
const noteText = e => (e.time ? (e.note || '').replace(/^\d{1,2}:\d{2}[，,、 ]?/, '') : e.note || '').trim();
function row(e) {
  return h('div.it', { onclick: () => openEntry({ entry: e }) },
    h('div.grow',
      h('div.mu.tiny', when(e)),
      ...chips(e).map(([t, col]) => h('div.small', { style: { color: col, fontWeight: 600 } }, t)),
      noteText(e) ? h('div.mu.tiny', noteText(e)) : null));
}

const TYPE_NAMES = { all: '全部', dose: '注射', wt: '體重', bp: '血壓', bc: '身體組成' };
const RECENT_LIMIT = 5;
let showAllRecent = false;

function listCard(all) {
  const card = h('div.card');
  const sort = L.logSort || 'desc', type = L.logType || 'all';
  const rows = all.filter(e => type === 'all' || TYPES[type](e));
  const from7 = addDays(localDate(new Date()), -6);
  const recent = rows.filter(e => e.date >= from7);
  const byMon = new Map();
  for (const e of rows.filter(e => e.date < from7)) { const k = e.date.slice(0, 7); if (!byMon.has(k)) byMon.set(k, []); byMon.get(k).push(e); }
  const months = [...byMon.keys()].sort().reverse();
  const jump = h('select', { 'aria-label': '跳到月份' }, h('option', { value: '' }, '跳到月份…'), ...months.map(k => h('option', { value: k }, k.slice(0, 4) + ' 年 ' + +k.slice(5) + ' 月')));
  card.append(h('h2', '記錄列表'));
  if (!all.length) { card.append(h('div.empty', '還沒有記錄。可以按上面卡片的「＋記錄」新增，或到「設定」→「備份與匯入」把同步版的記錄搬過來。')); return card; }
  card.append(fold('log-filter', h('span.small.mu', TYPE_NAMES[type] + '・' + (sort === 'desc' ? '新到舊' : '舊到新') + '・符合 ' + rows.length + ' 筆'), [h('div', { style: { marginTop: '8px' } },
    pills([['all', '全部'], ['dose', '注射'], ['wt', '體重'], ['bp', '血壓'], ['bc', '身體組成']], type, v => { L.logType = v; commitLocal(); rerender(); }),
    h('div.row', { style: { marginTop: '8px' } }, pills([['desc', '新到舊'], ['asc', '舊到新']], sort, v => { L.logSort = v; commitLocal(); rerender(); }), h('div.grow'),
      months.length ? h('div', { style: { width: '140px' } }, jump) : null))]));
  if (!rows.length) { card.append(h('div.empty', '沒有符合條件的記錄。')); return card; }
  const blocks = [];
  if (recent.length) {
    const ordered = sort === 'desc' ? recent.slice().reverse() : recent;
    const shown = showAllRecent ? ordered : ordered.slice(0, RECENT_LIMIT);
    const l = h('div.list'); shown.forEach(e => l.append(row(e)));
    const more = ordered.length > shown.length ? h('button.link.small', { type: 'button', onclick: () => { showAllRecent = true; rerender(); } }, '顯示最近 7 天全部（還有 ' + (ordered.length - shown.length) + ' 筆）') : null;
    blocks.push(fold('log-recent', h('span.small.num', '最近 7 天・' + recent.length + ' 筆'), [l, more], { cls: 'daygrp' }));
  }
  const monEls = {};
  for (const k of months) {
    const es = byMon.get(k), ws = es.filter(e => e.wt > 0);
    const sum = +k.slice(5) + ' 月' + (k.slice(0, 4) !== localDate(new Date()).slice(0, 4) ? '（' + k.slice(0, 4) + '）' : '') + '・' + es.length + ' 筆' + (ws.length ? '・平均 ' + r1(ws.reduce((a, e) => a + e.wt, 0) / ws.length) + ' kg' : '');
    const l = h('div.list');
    const d = fold('log-' + k, h('span.small.num', sum), [l], { cls: 'daygrp' });
    const fill = () => { if (!l.childNodes.length) (sort === 'desc' ? es.slice().reverse() : es).forEach(e => l.append(row(e))); };
    if (d.open) fill();
    d.addEventListener('toggle', () => { if (d.open) fill(); });
    monEls[k] = d;
    blocks.push(d);
  }
  if (sort === 'asc') blocks.reverse();
  card.append(...blocks);
  jump.onchange = () => { const d = monEls[jump.value]; if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'start' }); } jump.value = ''; };
  return card;
}

let root = null;
const rerender = () => root && renderLog(root);
export function renderLog(el) {
  root = el;
  el.textContent = '';
  const all = sortEntries(S.entries);
  const lc = leanCard();
  // 注射：快到期（明天、今天、逾期）排最上面，不然排在體重、血壓後面
  const nd = nextDose(all, localDate(new Date())), dueSoon = !!nd && nd.left <= 1;
  el.append(...(dueSoon ? [doseCard(false)] : []), scaleCard(all), ...(lc ? [lc] : []), bpCard(all), ...(dueSoon ? [] : [doseCard(false)]), listCard(all));
  showAllRecent = false;
}
