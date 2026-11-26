/* Omron 截圖判讀：把 AI 從 OMRON connect 截圖讀到的數字整理成身體記錄，並規劃新增／補到原本那一筆（純函數） */
import { planMeasurements } from './records.js';

const pad = n => String(n).padStart(2, '0');
/** 合理範圍：超出就當作讀錯，填 0 */
export const RANGE = { sys: [60, 260], dia: [30, 160], pul: [30, 220], wt: [20, 300], fat: [3, 70], mus: [10, 70], vis: [0.5, 40], bage: [10, 100], bmr: [500, 4000] };
export const SHOT_KEYS = Object.keys(RANGE);
export const SHOT_LABEL = { sys: '收縮壓', dia: '舒張壓', pul: '脈搏', wt: '體重', fat: '體脂率', mus: '骨骼肌率', vis: '內臟脂肪', bage: '身體年齡', bmr: '基礎代謝' };

function okNum(k, v) {
  const x = +v, [lo, hi] = RANGE[k];
  if (!(x >= lo && x <= hi)) return 0;
  return k === 'wt' || k === 'fat' || k === 'mus' || k === 'vis' ? Math.round(x * 10) / 10 : Math.round(x);
}

/** AI 回覆 → 記錄。沒有日期用今天，看不出時間留空；血壓只有一個數字就不要 */
export function shotRecords(parsed, todayStr) {
  const out = [];
  for (const r of Array.isArray(parsed?.readings) ? parsed.readings : []) {
    const dm = String(r?.date || '').match(/(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/);
    const tm = String(r?.time || '').match(/(\d{1,2}):(\d{2})/);
    const rec = { date: dm ? dm[1] + '-' + pad(+dm[2]) + '-' + pad(+dm[3]) : todayStr, time: tm && +tm[1] < 24 ? pad(+tm[1]) + ':' + tm[2] : '',
      dose: 0, site: '', note: '', src: 'omron', sid: '' };
    for (const k of SHOT_KEYS) rec[k] = okNum(k, r?.[k]);
    if ((rec.sys > 0) !== (rec.dia > 0)) { rec.sys = 0; rec.dia = 0; }
    if (rec.date > todayStr) rec.date = todayStr;
    if (SHOT_KEYS.some(k => rec[k] > 0)) out.push(rec);
  }
  return out;
}

/** 規劃：只有體組成（沒有體重、血壓）的那一筆，補到同一天最後一筆體重；其他照一般匯入規則（重複的略過） */
export function planShot(recs, entries) {
  const merge = [], rest = [];
  for (const r of recs) {
    if (!(r.wt > 0) && !(r.sys > 0) && !(r.pul > 0)) {
      const same = entries.filter(e => e.date === r.date && e.wt > 0 && e.id != null).sort((a, b) => ((a.time || '') < (b.time || '') ? 1 : -1))[0];
      if (same) {
        const fill = {};
        for (const k of ['fat', 'mus', 'vis', 'bage', 'bmr']) if (r[k] > 0 && r[k] !== same[k]) fill[k] = r[k];
        if (Object.keys(fill).length) merge.push({ id: same.id, fill });
        continue;
      }
    }
    rest.push(r);
  }
  const m = planMeasurements(rest, entries);
  return { add: m.add, merge: [...merge, ...m.merge], dup: m.dup + (recs.length - rest.length - merge.length) };
}

/** 一筆記錄的文字：「11/26 07:30・血壓 128/82・脈搏 71」 */
export function shotLine(r) {
  const parts = [];
  if (r.sys > 0) parts.push('血壓 ' + r.sys + '/' + r.dia);
  for (const k of ['pul', 'wt', 'fat', 'mus', 'vis', 'bage', 'bmr']) if (r[k] > 0) parts.push(SHOT_LABEL[k] + ' ' + r[k]);
  return +r.date.slice(5, 7) + '/' + +r.date.slice(8) + (r.time ? ' ' + r.time : '') + '・' + parts.join('・');
}
