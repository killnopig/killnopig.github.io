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
  if ((x = s.match(/^(\d{2,4})\s*[/.\-年]\s*(\d{1,2})\s*[/.\-月]\s*(\d{1,2})/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
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
  const by = new Map(), raw = {};
  const put = (date, name, cell) => {
    const k = labKey(name), v = labValue(cell);
    if (!k || v == null) return;
    raw[k] = raw[k] || half(name).trim();
    if (!by.has(date)) by.set(date, {});
    by.get(date)[k] = v;
  };
  const dataRows = rows.slice(1);
  const datesInCol = dataRows.filter(r => labDate(r[0])).length;
  const dateCols = rows[0].map((c, j) => (j > 0 && labDate(c) ? j : -1)).filter(j => j > 0);
  if (datesInCol && datesInCol >= dataRows.length / 2) {            // 每一列是一次抽血
    for (const r of dataRows) { const d = labDate(r[0]); if (d) for (let j = 1; j < r.length; j++) if (rows[0][j]) put(d, rows[0][j], r[j]); }
  } else if (dateCols.length) {                                   // 每一列是一個項目
    for (const r of dataRows) if (r[0] && !labDate(r[0])) for (const j of dateCols) put(labDate(rows[0][j]), r[0], r[j]);
  } else return { recs: [], keys: [], raw: {}, err: '找不到日期。第一欄或第一列要是抽血日期（例如 2024/3/5 或 113/03/05）。' };
  const recs = [...by].map(([date, v]) => ({ date, v })).filter(r => Object.keys(r.v).length).sort((a, b) => (a.date < b.date ? -1 : 1));
  const keys = [...new Set(recs.flatMap(r => Object.keys(r.v)))].sort(labSort);
  return { recs, keys, raw, err: recs.length ? '' : '有找到日期，但沒有讀到數字。' };
}

export const labId = date => 'lab' + date;

/** 規劃：新的日期新增；已有的日期補上沒有的項目、數字不同的更新；完全一樣的略過 */
export function planLabs(recs, labs) {
  const have = new Map((labs || []).map(x => [x.date, x]));
  const add = [], upd = [];
  let same = 0, changed = 0;
  for (const r of recs) {
    const old = have.get(r.date);
    if (!old) { add.push({ id: labId(r.date), date: r.date, v: { ...r.v } }); continue; }
    const v = { ...old.v };
    let diff = 0;
    for (const k in r.v) if (v[k] !== r.v[k]) { if (k in v) changed++; v[k] = r.v[k]; diff++; }
    if (diff) upd.push({ id: old.id, date: r.date, v }); else same++;
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
    return { k, val: list[i].v[k], prev };
  });
}
/** 一個項目的歷次數字（新的在下面） */
export const labHistory = (labs, k) => [...(labs || [])].filter(x => k in x.v).sort((a, b) => (a.date < b.date ? -1 : 1)).map(x => ({ date: x.date, val: x.v[k] }));

export function normalizeLab(x) {
  if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(x.date) || !x.v || typeof x.v !== 'object') return null;
  const v = {};
  for (const k in x.v) { const a = x.v[k]; if (typeof a === 'number' && isFinite(a)) v[k] = a; else if (typeof a === 'string' && a) v[k] = a.slice(0, 20); }
  return { id: String(x.id || labId(x.date)), date: x.date, v };
}
