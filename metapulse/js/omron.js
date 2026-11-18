/* Omron CSV 匯入（純函數）：移植同步版的欄位辨識規則
 * - 支援 OMRON connect 匯出的血壓、體重、體組成 CSV（逗號或 Tab 分隔、可多檔）
 * - 重複判斷與體組成補欄位共用 records.js 的 planMeasurements */
import { planMeasurements } from './records.js';

const pad = n => String(n).padStart(2, '0');

const COLS = {
  date: [/測量日期|日期|日時|date/i], time: [/^時間$|^time$/i],
  sys: [/收縮壓|systolic/i], dia: [/舒張壓|diastolic/i], pul: [/脈搏|pulse|bpm/i],
  irr: [/檢測到不規則脈波|不規則脈波|irregular/i], mov: [/身體晃動|body movement/i],
  wt: [/體重|weight/i], fat: [/體脂|body fat/i], mus: [/骨骼肌|skeletal/i], vis: [/內臟脂肪|visceral/i],
  bage: [/身體年齡|體年齡|body age/i], bmr: [/基礎代謝|靜止代謝|resting metabolism|basal metabolic|bmr/i],
};

/** 解析 CSV（自動判斷逗號或 Tab；支援雙引號） */
export function parseCSV(t) {
  t = String(t).replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const d = first.split('\t').length > first.split(',').length ? '\t' : ',';
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === d) { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

/** 標題列 → 每個欄位在第幾欄（找不到是 -1） */
export function mapColumns(hdr) {
  const m = {}, used = new Set();
  for (const k of Object.keys(COLS)) {
    const c = [];
    hdr.forEach((t, i) => { if (!used.has(i) && COLS[k].some(re => re.test(t))) c.push(i); });
    let pick = c[0];
    if (c.length > 1 && (k === 'fat' || k === 'mus')) { const pr = c.find(i => /率|%/.test(hdr[i])); if (pr !== undefined) pick = pr; }
    m[k] = pick === undefined ? -1 : pick;
    if (pick !== undefined) used.add(pick);
  }
  return m;
}

/** 一列 → 一筆記錄（看不懂或沒有數值時回傳 null） */
export function rowToRecord(m, hdr, r) {
  const g = k => (m[k] >= 0 ? String(r[m[k]] || '').trim() : '');
  const num = k => { const v = parseFloat(g(k).replace(/[^0-9.]/g, '')); return v > 0 ? v : 0; };
  const dm = g('date').match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T]+(\d{1,2}):(\d{2}))?/);
  if (!dm) return null;
  let hh = dm[4], mm = dm[5];
  if (hh === undefined && m.time >= 0) { const tm = g('time').match(/(\d{1,2}):(\d{2})/); if (tm) { hh = tm[1]; mm = tm[2]; } }
  const rec = { date: dm[1] + '-' + pad(+dm[2]) + '-' + pad(+dm[3]), time: hh !== undefined ? pad(+hh) + ':' + mm : '',
    sys: num('sys'), dia: num('dia'), pul: num('pul'), wt: num('wt'), fat: num('fat'), mus: num('mus'), vis: num('vis'), bage: num('bage'), bmr: num('bmr'),
    dose: 0, site: '', note: '', src: 'omron', sid: '' };
  if (rec.wt > 0 && m.wt >= 0 && /lb|磅/i.test(hdr[m.wt])) rec.wt = +(rec.wt * 0.45359237).toFixed(1);
  if ((rec.sys > 0) !== (rec.dia > 0)) { rec.sys = 0; rec.dia = 0; }
  if (!['sys', 'pul', 'wt', 'fat', 'mus', 'vis', 'bage', 'bmr'].some(k => rec[k] > 0)) return null;
  const fl = [];
  if (/已偵測|^(detected|yes|true)$/i.test(g('irr'))) fl.push('偵測到不規則脈波');
  if (/已偵測|^(detected|yes|true)$/i.test(g('mov'))) fl.push('偵測到身體晃動');
  rec.note = fl.join('，');
  return rec;
}

/**
 * 多個檔案 → 每個檔案的說明＋整體匯入計畫
 * @param files [{name, text}]
 * @returns {{info:[{name,type,rows,skipped,from,to,err}], plan:{add,merge,dup,from,to}}}
 */
export function planOmron(files, existing) {
  const info = [], recs = [];
  for (const f of files) {
    const st = { name: f.name, type: '', rows: 0, skipped: 0, from: '', to: '', err: '' };
    const rows = parseCSV(f.text);
    if (rows.length < 2) { st.err = '檔案是空的，或只有標題列。'; info.push(st); continue; }
    const hdr = rows[0].map(x => x.trim()), m = mapColumns(hdr);
    const bp = m.sys >= 0 && m.dia >= 0, body = ['wt', 'fat', 'mus', 'vis', 'bage', 'bmr'].some(k => m[k] >= 0);
    if (m.date < 0 || !(bp || body)) { st.err = '看不懂這個檔案的欄位。第一行是：' + hdr.join(' | '); info.push(st); continue; }
    st.type = bp && body ? '血壓和體組成' : bp ? '血壓' : '體重／體組成';
    for (const r of rows.slice(1)) {
      const rec = rowToRecord(m, hdr, r);
      if (!rec) { st.skipped++; continue; }
      st.rows++;
      if (!st.from || rec.date < st.from) st.from = rec.date;
      if (!st.to || rec.date > st.to) st.to = rec.date;
      recs.push(rec);
    }
    info.push(st);
  }
  recs.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  return { info, plan: planMeasurements(recs, existing) };
}
