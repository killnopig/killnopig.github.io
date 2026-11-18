/* 身體記錄（entries）的計算：沿用同步版的公式與規則（純函數） */
import { SITES } from './storage.js';

export { SITES };
export const DOSE_INTERVAL_DAYS = 7;

const pad = n => String(n).padStart(2, '0');
/** 日期字串 ↔ 天數（UTC，避免時區影響） */
export const dn = s => { const [y, m, d] = s.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / 864e5); };
export const fromDn = n => { const d = new Date(n * 864e5); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); };
export const md = s => +s.slice(5, 7) + '/' + +s.slice(8, 10);
export const WD = '日一二三四五六';
export const wdOf = s => WD[new Date(dn(s) * 864e5).getUTCDay()];

export function sortEntries(entries) {
  return entries.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || '') < (b.time || '') ? -1 : (a.time || '') > (b.time || '') ? 1 : (a.id > b.id ? 1 : -1));
}

/** 預估體內殘留量：Σ 劑量 × 2^(−經過天數 ÷ (半衰期小時 ÷ 24)) */
export function onBoard(entries, day, hl = 120) {
  const k = Math.LN2 / (hl / 24);
  let t = 0;
  for (const e of entries) if (e.dose > 0) { const x = day - dn(e.date); if (x >= 0) t += e.dose * Math.exp(-k * x); }
  return t;
}

/** 部位輪替：最近一次有部位的注射的下一個 */
export function nextSite(entries) {
  const l = sortEntries(entries).filter(e => e.dose > 0 && e.site).pop();
  const i = l ? SITES.indexOf(l.site) : -1;
  return SITES[(i + 1) % SITES.length];
}

/** 下次注射：最近一次 + 7 天；left = 還有幾天（0 今天、負數逾期） */
export function nextDose(entries, todayStr) {
  const ds = sortEntries(entries).filter(e => e.dose > 0);
  const last = ds[ds.length - 1];
  if (!last) return null;
  const due = dn(last.date) + DOSE_INTERVAL_DAYS;
  return { last, due: fromDn(due), left: due - dn(todayStr), site: nextSite(entries) };
}

/** BMI 與台灣成人分類 */
export function bmi(wt, heightCm) {
  if (!(wt > 0 && heightCm > 0)) return null;
  const m = heightCm / 100, v = wt / (m * m);
  return { value: v, label: v < 18.5 ? '過輕' : v < 24 ? '正常' : v < 27 ? '過重' : '肥胖' };
}

/** 淨體重 = 體重 × (1 − 體脂率) */
export const leanMass = e => (e.wt > 0 && e.fat > 0 ? e.wt * (1 - e.fat / 100) : 0);

export const isDose = e => e.dose > 0;
export const isWeight = e => e.wt > 0;
export const isBP = e => e.sys > 0 || e.pul > 0;
export const isBody = e => e.fat > 0 || e.mus > 0 || e.vis > 0 || e.bage > 0 || e.bmr > 0;
export const TYPES = { dose: isDose, wt: isWeight, bp: isBP, bc: isBody };

export const VALUE_KEYS = ['dose', 'wt', 'sys', 'dia', 'pul', 'fat', 'mus', 'vis', 'bage', 'bmr'];
export const hasValue = e => VALUE_KEYS.some(k => e[k] > 0);

/* ---------- 重複判斷（沿用同步版 omKey 規則） ---------- */
const minOf = t => (t ? +t.slice(0, 2) * 60 + +t.slice(3, 5) : -1);

/** 內容鍵：血壓看「日期＋收縮壓＋舒張壓＋時間」，其他看所有數值 */
export function contentKey(e) {
  const n = k => +e[k] || 0;
  if (n('sys') > 0 && n('dia') > 0) return [e.date, 'bp', n('sys'), n('dia'), e.time || ''].join('|');
  return [e.date, ...VALUE_KEYS.map(n), e.time || '', e.site || ''].join('|');
}

/** 和既有記錄比較是否為同一筆（血壓量測時間相差 2 分鐘內視為同一筆） */
export function isDuplicate(rec, existing) {
  const k = contentKey(rec);
  if (existing.some(e => contentKey(e) === k)) return true;
  if (rec.sys > 0 && rec.time) {
    const t = minOf(rec.time);
    return existing.some(e => e.date === rec.date && e.sys === rec.sys && e.dia === rec.dia && e.time && Math.abs(minOf(e.time) - t) <= 2);
  }
  return false;
}

const sameValues = (a, b) => VALUE_KEYS.every(k => (+a[k] || 0) === (+b[k] || 0)) && (a.site || '') === (b.site || '') && (a.note || '') === (b.note || '') && (a.time || '') === (b.time || '');

/**
 * 規劃從同步版匯入（可重複執行）：
 * - 以同步版的 id（存在 sid）比對：找到且內容相同 → 略過；內容不同 → 更新
 * - 沒有 sid 對應時，用內容判斷重複
 * @returns {{add:[], update:[{id, rec}], dup:number, from, to}}
 */
export function planImport(incoming, existing) {
  const bySid = new Map(existing.filter(e => e.sid).map(e => [String(e.sid), e]));
  const pool = existing.slice();
  const plan = { add: [], update: [], dup: 0, from: '', to: '' };
  for (const rec of incoming) {
    if (!plan.from || rec.date < plan.from) plan.from = rec.date;
    if (!plan.to || rec.date > plan.to) plan.to = rec.date;
    // 同步版的編號可能被重複使用（例如復原後重新匯入），所以編號相同且日期相同才算同一筆
    const ex0 = rec.sid != null ? bySid.get(String(rec.sid)) : null;
    const ex = ex0 && ex0.date === rec.date ? ex0 : null;
    if (ex) {
      if (sameValues(ex, rec)) plan.dup++;
      else plan.update.push({ id: ex.id, rec });
      continue;
    }
    if (isDuplicate(rec, pool)) { plan.dup++; continue; }
    plan.add.push(rec); pool.push(rec);
  }
  return plan;
}

/**
 * 規劃匯入量測資料（Health Connect、之後的 Omron CSV 共用）：
 * - 血壓：重複判斷同 isDuplicate（2 分鐘內同值視為同一筆）
 * - 只有體脂／基礎代謝、沒有體重：同一天已有相同數值就略過
 * - 有體重：同一天已有相同體重（且不是血壓那筆）→ 只補上缺少的體組成欄位
 * @returns {{add:[], merge:[{id, fill}], dup:number, from, to}}
 */
export function planMeasurements(recs, existing) {
  const pool = existing.map(e => ({ ...e })); // 複本：預覽時不改動實際資料
  const out = { add: [], merge: [], dup: 0, from: '', to: '' };
  for (const rec of recs) {
    if (!out.from || rec.date < out.from) out.from = rec.date;
    if (!out.to || rec.date > out.to) out.to = rec.date;
    if (isDuplicate(rec, pool)) { out.dup++; continue; }
    if (!(rec.sys > 0) && !(rec.wt > 0) && (rec.fat > 0 || rec.bmr > 0)) {
      if (pool.some(e => e.date === rec.date && ((rec.fat > 0 && Math.abs((e.fat || 0) - rec.fat) < 0.05) || (rec.bmr > 0 && e.bmr === rec.bmr)))) { out.dup++; continue; }
    }
    if (!(rec.sys > 0) && rec.wt > 0) {
      const ex = pool.find(e => e.date === rec.date && e.wt > 0 && Math.abs(e.wt - rec.wt) < 0.05 && !(e.sys > 0));
      if (ex) {
        const fill = {};
        for (const q of ['fat', 'mus', 'vis', 'bage', 'bmr']) if (!(ex[q] > 0) && rec[q] > 0) fill[q] = rec[q];
        if (Object.keys(fill).length && ex.id != null) { out.merge.push({ id: ex.id, fill }); Object.assign(ex, fill); } else out.dup++;
        continue;
      }
    }
    out.add.push(rec); pool.push(rec);
  }
  return out;
}

/** 各類記錄最新的一筆（日期＋時間）：{ wt, bp, dose, bc }，沒有的是 null */
export function latestByType(entries) {
  const out = { wt: null, bp: null, dose: null, bc: null };
  for (const e of entries || []) {
    for (const k of Object.keys(out)) {
      if (!TYPES[k](e)) continue;
      const cur = out[k], key = e.date + ' ' + (e.time || '');
      if (!cur || key > cur.date + ' ' + (cur.time || '')) out[k] = { date: e.date, time: e.time || '' };
    }
  }
  return out;
}

/** 「體重 11/17 06:57・血壓 11/17 06:59・注射 11/16」；都沒有時回傳空字串 */
export function latestText(entries) {
  const l = latestByType(entries), N = { wt: '體重', bp: '血壓', dose: '注射', bc: '體組成' };
  return Object.keys(N).filter(k => l[k]).map(k => N[k] + ' ' + md(l[k].date) + (l[k].time ? ' ' + l[k].time : '')).join('・');
}

/**
 * 每週用藥：該吃幾次、吃了幾次、準時幾次（設定時間前後 1 小時內）；打針看和上一針隔幾天（6～8 天算準時）
 * 一種藥從 since（沒有就用最早的記錄）那天開始算；週一或週日開始（weekStart 'sun' 才從週日）
 * @returns {[{start, need, taken, onTime, doses:[{date, gap, ok}]}]}
 */
export function medAdherence(meds, medLog, entries, from, to, weekStart = 'mon') {
  const out = [];
  if (!from || from > to) return out;
  const mins = t => { const [a, b] = String(t || '').split(':').map(Number); return a * 60 + b; };
  const log = {}; for (const x of medLog || []) log[x.med + '|' + x.date] = x;
  const list = (meds || []).filter(m => m && m.id && m.name && m.time).map(m => ({ ...m, since: m.since || (medLog || []).filter(x => x.med === m.id).map(x => x.date).sort()[0] || to }));
  const doses = [...new Set((entries || []).filter(e => e.dose > 0).map(e => e.date))].sort();
  const wk = n => n - (weekStart === 'sun' ? new Date(n * 864e5).getUTCDay() : (new Date(n * 864e5).getUTCDay() + 6) % 7);
  const weeks = {};
  const W = n => { const s = wk(n); return weeks[s] || (weeks[s] = { start: fromDn(s), need: 0, taken: 0, onTime: 0, doses: [] }); };
  for (let n = dn(from); n <= dn(to); n++) {
    const d = fromDn(n);
    for (const m of list) {
      if (m.since > d) continue;
      const w = W(n), x = log[m.id + '|' + d]; w.need++;
      if (!x) continue;
      w.taken++;
      const t = new Date(x.at); if (!Number.isNaN(t.getTime()) && Math.abs(t.getHours() * 60 + t.getMinutes() - mins(m.time)) <= 60) w.onTime++;
    }
  }
  doses.forEach((d, i) => {
    if (d < from || d > to) return;
    const gap = i ? dn(d) - dn(doses[i - 1]) : null;
    W(dn(d)).doses.push({ date: d, gap, ok: gap === null ? null : Math.abs(gap - DOSE_INTERVAL_DAYS) <= 1 });
  });
  return Object.keys(weeks).map(Number).sort((a, b) => a - b).map(k => weeks[k]).filter(w => w.need || w.doses.length);
}
