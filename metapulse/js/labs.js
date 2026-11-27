/* 抽血檢查（純函數）：解析從 Excel 複製貼上的表格、常見項目統一名稱、規劃新增／補上，以及每個項目的歷次數字
 * 一次抽血 = 一筆 { id: 'lab' + 日期, date, v: { 項目代號: 數字或文字 } }；同一天只有一筆，兩支手機合併時才不會重複 */

/** 常見項目：代號、顯示名稱、單位、認名稱的規則（依序比對，前面的優先，例如 HbA1c 要在血色素前面） */
export const LAB_ITEMS = [
  { k: 'hba1c', name: '糖化血色素 HbA1c', unit: '%', re: /hba1c|a1c|糖化/ },
  { k: 'glupc', name: '飯後血糖', unit: 'mg/dL', re: /飯後|glu.*pc|pc.*(glu|sugar)|^pcs$/ },
  { k: 'glu', name: '空腹血糖', unit: 'mg/dL', re: /血糖|glu|sugar|^fbg$|^fpg$|^ac$/ },
  { k: 'insulin', name: '胰島素', unit: 'μU/mL', re: /胰島素|insulin/ },
  { k: 'ldl', name: '低密度膽固醇 LDL', unit: 'mg/dL', re: /ldl|低密度/ },
  { k: 'hdl', name: '高密度膽固醇 HDL', unit: 'mg/dL', re: /hdl|高密度/ },
  { k: 'tg', name: '三酸甘油酯', unit: 'mg/dL', re: /^tg$|triglycer|三酸甘油/ },
  { k: 'chol', name: '總膽固醇', unit: 'mg/dL', re: /膽固醇|chol|^t-?cho|^tc$/ },
  { k: 'ast', name: 'AST（GOT）', unit: 'U/L', re: /^s?got$|^ast|got\)|\(ast/ },
  { k: 'alt', name: 'ALT（GPT）', unit: 'U/L', re: /^s?gpt$|^alt|gpt\)|\(alt/ },
  { k: 'ggt', name: 'γ-GT', unit: 'U/L', re: /ggt|γ-?gt|r-?gt|^gamma/ },
  { k: 'uacr', name: '尿蛋白／肌酸酐比 UACR', unit: 'mg/g', re: /uacr|^acr$|微量白蛋白|albumin.*creat/ },
  { k: 'egfr', name: '腎絲球過濾率 eGFR', unit: 'mL/min', re: /egfr|腎絲球|過濾率/ },
  { k: 'cre', name: '肌酸酐', unit: 'mg/dL', re: /肌酸酐|creat|^cre|^cr$/ },
  { k: 'bun', name: '尿素氮', unit: 'mg/dL', re: /bun|尿素氮/ },
  { k: 'ua', name: '尿酸', unit: 'mg/dL', re: /尿酸|uric|^ua$/ },
  { k: 'alb', name: '白蛋白', unit: 'g/dL', re: /白蛋白|^alb/ },
  { k: 'hb', name: '血色素 Hb', unit: 'g/dL', re: /血色素|血紅素|^hgb$|^hb$/ },
  { k: 'tsh', name: '甲狀腺刺激素 TSH', unit: 'μIU/mL', re: /tsh|甲狀腺刺激/ },
  { k: 'crp', name: 'C 反應蛋白 CRP', unit: 'mg/dL', re: /crp|c反應/ },
];
const BY_KEY = Object.fromEntries(LAB_ITEMS.map(x => [x.k, x]));
const ORDER = Object.fromEntries(LAB_ITEMS.map((x, i) => [x.k, i]));

const half = s => String(s).replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
/** 表上的名稱 → 代號；認不得就用「x:原名」，不會丟掉 */
export function labKey(raw) {
  const name = half(raw).trim();
  const n = name.toLowerCase().replace(/\s+/g, '');
  if (!n) return '';
  for (const it of LAB_ITEMS) if (it.re.test(n)) return it.k;
  return 'x:' + name.slice(0, 30);
}
export const labName = k => (BY_KEY[k] ? BY_KEY[k].name : String(k).replace(/^x:/, ''));
export const labUnit = k => (BY_KEY[k] ? BY_KEY[k].unit : '');
/** 排序：常見項目照固定順序在前，其他照名稱 */
export const labSort = (a, b) => (a in ORDER ? ORDER[a] : 99) - (b in ORDER ? ORDER[b] : 99) || (a < b ? -1 : a > b ? 1 : 0);

const pad = n => String(n).padStart(2, '0');
/** 各種日期寫法 → YYYY-MM-DD：2024/3/5、2024-03-05、113/03/05（民國）、20240305、Excel 日期序號；看不懂回傳 '' */
export function labDate(cell) {
  const s = half(cell).trim();
  let y, m, d, x;
  if ((x = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})/))) { y = +x[3]; m = +x[1]; d = +x[2]; if (m > 12) [m, d] = [d, m]; }   // 3/5/2024（月/日/年）
  else if ((x = s.match(/^(\d{2,4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = s.match(/^(\d{4})(\d{2})(\d{2})$/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = s.match(/^(\d{7})$/))) { y = +x[1].slice(0, 3); m = +x[1].slice(3, 5); d = +x[1].slice(5); }   // 民國 1130305
  else if (/^\d{5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {            // Excel 日期序號
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5);
    return t.getUTCFullYear() + '-' + pad(t.getUTCMonth() + 1) + '-' + pad(t.getUTCDate());
  } else return '';
  if (y < 1000) y += 1911;
  if (y < 1950 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  return y + '-' + pad(m) + '-' + pad(d);
}

/** 參考範圍文字 → [下限, 上限]（沒有的一邊是 null）：「70-100」「70~100」「<5.7」「≧40」；看不懂回傳 null */
export function labRef(text) {
  const s = half(text).replace(/\s+/g, '').replace(/[≦≤]/g, '<=').replace(/[≧≥]/g, '>=');
  if (!s) return null;
  let m = s.match(/^(-?\d+(?:\.\d+)?)[-~～–—](-?\d+(?:\.\d+)?)/);
  if (m) return +m[1] <= +m[2] ? [+m[1], +m[2]] : null;
  if ((m = s.match(/^<=?(-?\d+(?:\.\d+)?)/))) return [null, +m[1]];
  if ((m = s.match(/^>=?(-?\d+(?:\.\d+)?)/))) return [+m[1], null];
  return null;
}
/** 超出參考範圍：'hi'、'lo' 或 null（文字值、沒有範圍都不判斷） */
export function labFlag(val, ref) {
  if (typeof val !== 'number' || !Array.isArray(ref)) return null;
  if (ref[1] != null && val > ref[1]) return 'hi';
  if (ref[0] != null && val < ref[0]) return 'lo';
  return null;
}

/** 一格的值：有數字取數字（「5.6 H」「<0.5」也行），沒數字的文字照存（例如「陰性」），空的不要 */
export function labValue(cell) {
  const s = half(cell).trim();
  if (!s || s === '-' || s === '—') return null;
  const m = s.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  if (m) return +m[0];
  return s.slice(0, 20);
}

/**
 * 解析貼上的表格（Excel 複製是用 Tab 分隔；也接受逗號）。
 * 兩種擺法都可以：每一列是一次抽血（第一欄是日期、第一列是項目），或每一列是一個項目（第一列是日期）。
 * 回傳 { recs: [{date, v}], keys: [代號], raw: {代號: 表上名稱}, err }
 */
export function parseLabTable(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { recs: [], keys: [], raw: {}, err: '框裡是空的。' };
  const sep = lines.some(l => l.includes('\t')) ? '\t' : ',';
  const rows = lines.map(l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1')));
  const by = new Map(), raw = {}, ref = {};
  const put = (date, name, cell) => {
    if (/^(編號|序號|項次|no\.?|#|姓名|name|病歷|備註|類別|單位|unit)$/i.test(half(name).trim())) return;   // 不是檢驗項目的欄
    const k = labKey(name), v = labValue(cell);
    if (!k || v == null) return;
    raw[k] = raw[k] || half(name).trim();
    if (!by.has(date)) by.set(date, {});
    by.get(date)[k] = v;
  };
  const isRef = c => /參考|正常值|ref|range/i.test(half(c || ''));
  const setRef = (name, cell) => { const k = labKey(name), r = labRef(cell); if (k && r) ref[k] = r; };
  // 找日期在哪：日期最多的那一欄（每一列是一次抽血），或日期最多的那一列（每一列是一個項目）；上面有標題列、左邊有編號欄都可以
  const W = Math.max(...rows.map(r => r.length));
  let bc = -1, bcN = 0, br = -1, brN = 0;
  for (let j = 0; j < W; j++) { const n = rows.filter(r => labDate(r[j])).length; if (n > bcN) { bcN = n; bc = j; } }
  rows.forEach((r, i) => { const n = r.filter(c => labDate(c)).length; if (n > brN) { brN = n; br = i; } });
  const filled = r => r.filter(c => c !== '').length;
  // 一樣多時（例如只有一次）：日期那一列其他格大多是數字＝每一列是一次抽血；大多是字＝那一列是表頭
  const numRow = r => { const o = r.filter(c => c !== '' && !labDate(c)); return o.length && o.filter(c => typeof labValue(c) === 'number').length > o.length / 2; };
  if (bcN && (bcN > brN || (bcN === brN && numRow(rows[rows.findIndex(r => labDate(r[bc]))])))) {   // 每一列是一次抽血
    const first = rows.findIndex(r => labDate(r[bc]));
    let hr = first - 1;                                                     // 項目名稱那一列：日期上面最近、有兩格以上字的那一列
    while (hr >= 0 && (filled(rows[hr]) < 2 || rows[hr].some(isRef))) hr--;
    if (hr < 0) return { recs: [], keys: [], raw: {}, err: '找到日期，但日期上面沒有項目名稱那一列。' };
    const head = rows[hr];
    for (let i = hr + 1; i < rows.length; i++) {
      const r = rows[i], d = labDate(r[bc]);
      if (d) { for (let j = 0; j < r.length; j++) if (j !== bc && head[j]) put(d, head[j], r[j]); }
      else if (r.some(isRef)) for (let j = 0; j < r.length; j++) if (j !== bc && head[j] && !isRef(r[j])) setRef(head[j], r[j]);   // 「參考值」那一列
    }
  } else if (brN) {                                                         // 每一列是一個項目
    const head = rows[br], dateCols = head.map((c, j) => (labDate(c) ? j : -1)).filter(j => j >= 0);
    const below = rows.slice(br + 1);
    // 項目名稱那一欄：日期欄以外，下面最多「有字、不是數字」的那一欄
    let nc = -1, ncN = 0;
    // 認得的檢驗項目最多的優先（左邊有「類別」欄也不會選錯）
    for (let j = 0; j < W; j++) if (!dateCols.includes(j)) { const n = below.filter(r => r[j] && typeof labValue(r[j]) === 'string').length + below.filter(r => r[j] && !labKey(r[j]).startsWith('x:')).length * 100; if (n > ncN) { ncN = n; nc = j; } }
    if (nc < 0) return { recs: [], keys: [], raw: {}, err: '找到日期，但找不到項目名稱那一欄。' };
    const rc = head.findIndex((c, j) => j !== nc && isRef(c));            // 「參考值」那一欄
    for (const r of below) if (r[nc] && !labDate(r[nc])) { for (const j of dateCols) put(labDate(head[j]), r[nc], r[j]); if (rc >= 0) setRef(r[nc], r[rc]); }
  } else return { recs: [], keys: [], raw: {}, err: '找不到日期。表格裡要有抽血日期（例如 2024/3/5、113/03/05 或 20240305）。' };
  const recs = [...by].map(([date, v]) => withRef({ date, v }, ref)).filter(r => Object.keys(r.v).length).sort((a, b) => (a.date < b.date ? -1 : 1));
  const keys = [...new Set(recs.flatMap(r => Object.keys(r.v)))].sort(labSort);
  return { recs, keys, raw, err: recs.length ? '' : '有找到日期，但沒有讀到數字。' };
}
/** 把參考範圍附在有那個項目的記錄上（沒有就不加 r） */
function withRef(rec, ref) {
  const r = {};
  for (const k in rec.v) if (ref[k]) r[k] = ref[k];
  return Object.keys(r).length ? { ...rec, r } : rec;
}

/** AI 讀健檢報告的回覆 → { recs, keys, raw }（同一張可能有好幾個日期） */
export function shotLabRecs(parsed, todayStr) {
  const by = new Map(), raw = {}, refs = new Map();
  let noDate = false;
  for (const it of Array.isArray(parsed?.items) ? parsed.items : []) {
    let d = labDate(it?.date || parsed?.date || '');
    if (!d) { d = todayStr; noDate = true; }
    if (d > todayStr) d = todayStr;
    const k = labKey(it?.name || ''), v = labValue(it?.value);
    if (!k || v == null) continue;
    raw[k] = raw[k] || half(it.name).trim();
    if (!by.has(d)) { by.set(d, {}); refs.set(d, {}); }
    by.get(d)[k] = v;
    const r = labRef(it?.ref || ''); if (r) refs.get(d)[k] = r;
  }
  const recs = [...by].map(([date, v]) => withRef({ date, v }, refs.get(date))).sort((a, b) => (a.date < b.date ? -1 : 1));
  return { recs, keys: [...new Set(recs.flatMap(r => Object.keys(r.v)))].sort(labSort), raw, noDate };
}

export const labId = date => 'lab' + date;

/** 規劃：新的日期新增；已有的日期補上沒有的項目、數字不同的更新；完全一樣的略過 */
export function planLabs(recs, labs) {
  const have = new Map((labs || []).map(x => [x.date, x]));
  const add = [], upd = [];
  let same = 0, changed = 0;
  for (const r of recs) {
    const old = have.get(r.date);
    if (!old) { add.push({ id: labId(r.date), date: r.date, v: { ...r.v }, ...(r.r ? { r: { ...r.r } } : {}) }); continue; }
    const v = { ...old.v }, rr = { ...(old.r || {}) };
    let diff = 0;
    for (const k in r.v) if (v[k] !== r.v[k]) { if (k in v) changed++; v[k] = r.v[k]; diff++; }
    for (const k in r.r || {}) if (JSON.stringify(rr[k]) !== JSON.stringify(r.r[k])) { rr[k] = r.r[k]; diff++; }
    if (diff) upd.push({ id: old.id, date: r.date, v, ...(Object.keys(rr).length ? { r: rr } : {}) }); else same++;
  }
  return { add, upd, same, changed };
}
export function applyLabs(S, p) {
  const m = new Map((S.labs || []).map(x => [x.id, x]));
  for (const x of [...p.add, ...p.upd]) m.set(x.id, x);
  S.labs = [...m.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  return S;
}

/** 某次抽血的每個項目，附上前一次的數字（算升降） */
export function labRows(labs, date) {
  const list = [...(labs || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const i = list.findIndex(x => x.date === date);
  if (i < 0) return [];
  return Object.keys(list[i].v).sort(labSort).map(k => {
    let prev = null;
    for (let j = i - 1; j >= 0; j--) if (k in list[j].v) { prev = { date: list[j].date, val: list[j].v[k] }; break; }
    const ref = (list[i].r || {})[k] || null;
    return { k, val: list[i].v[k], prev, ref, flag: labFlag(list[i].v[k], ref) };
  });
}
/** 一個項目的歷次數字（新的在下面） */
export const labHistory = (labs, k) => [...(labs || [])].filter(x => k in x.v).sort((a, b) => (a.date < b.date ? -1 : 1)).map(x => ({ date: x.date, val: x.v[k] }));

export function normalizeLab(x) {
  if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !x.v || typeof x.v !== 'object') return null;
  const v = {};
  for (const k in x.v) { const a = x.v[k]; if (typeof a === 'number' && isFinite(a)) v[k] = a; else if (typeof a === 'string' && a) v[k] = a.slice(0, 20); }
  const r = {};
  for (const k in x.r || {}) { const a = x.r[k]; if (k in v && Array.isArray(a) && a.length === 2 && a.every(n => n === null || (typeof n === 'number' && isFinite(n))) && (a[0] !== null || a[1] !== null)) r[k] = a; }
  return { id: String(x.id || labId(x.date)), date: x.date, v, ...(Object.keys(r).length ? { r } : {}) };
}
/** 參考範圍的文字：「70–100」「< 5.7」「≥ 40」 */
export const refText = r => (!r ? '' : r[0] != null && r[1] != null ? r[0] + '–' + r[1] : r[1] != null ? '< ' + r[1] : '≥ ' + r[0]);

const mdS = d => +d.slice(5, 7) + '/' + +d.slice(8);
const vs = v => (typeof v === 'number' ? String(v) : v);
/** 回診報告用：這段期間有抽血的話，每個項目列最近幾次（含期間前的最後一次，方便比較）；沒有就說最近一次是哪天 */
export function labReportLines(labs, from, today) {
  const list = [...(labs || [])].sort((a, b) => (a.date < b.date ? -1 : 1)).filter(x => x.date <= today);
  if (!list.length) return [];
  const inR = list.filter(x => x.date >= from);
  if (!inR.length) return ['- 這段期間沒有抽血；最近一次是 ' + list[list.length - 1].date + '。'];
  const before = list.filter(x => x.date < from).slice(-1);
  const use = before.concat(inR), last = inR[inR.length - 1];
  const out = ['- 這段期間抽血 ' + inR.length + ' 次（' + inR.map(x => mdS(x.date)).join('、') + '）' + (before.length ? '，前面附上 ' + before[0].date + ' 那次比較' : '') + '：'];
  for (const k of Object.keys(last.v).sort(labSort)) {
    const h = use.filter(x => k in x.v).slice(-4);
    const rf = (last.r || {})[k], fl = labFlag(last.v[k], rf);
    out.push('  ' + labName(k) + (labUnit(k) ? '（' + labUnit(k) + '）' : '') + '：' + h.map(x => vs(x.v[k]) + '（' + mdS(x.date) + '）').join(' → ') + (rf ? '；報告參考範圍 ' + refText(rf) + (fl ? '，最近一次' + (fl === 'hi' ? '高於' : '低於') + '範圍' : '') : ''));
  }
  return out;
}
/** 給 AI 的摘要用：每個項目的歷次數字（每項最多最近 12 次） */
export function labSummaryLines(labs) {
  const list = [...(labs || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!list.length) return [];
  const keys = [...new Set(list.flatMap(x => Object.keys(x.v)))].sort(labSort);
  return ['- 共 ' + list.length + ' 次（' + list[0].date + ' 到 ' + list[list.length - 1].date + '）。項目名稱已統一，數字照報告。']
    .concat(keys.map(k => '- ' + labName(k) + (labUnit(k) ? '（' + labUnit(k) + '）' : '') + '：' + labHistory(list, k).slice(-12).map(x => x.date + ' ' + vs(x.val)).join('；')));
}
