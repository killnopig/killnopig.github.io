/* 從同步版（dose-tracker-sync）搬資料：解析備份、規劃合併（純函數）。
 * 只讀取同步版的資料，不會寫入或修改它。 */
import { normalizeEntry } from './storage.js';
import { planImport } from './records.js';

/** 解析同步版備份（JSON 字串或物件；容許 AI 回覆常帶的 ``` 符號） */
export function parseSyncBackup(input) {
  let p = input;
  if (typeof input === 'string') {
    const t = input.replace(/```(json)?/g, '').trim();
    if (!t) throw new Error('內容是空的');
    try { p = JSON.parse(t); } catch (e) { throw new Error('看不懂這段內容，請貼上同步版「產生備份文字」的完整內容'); }
  }
  if (!p || !Array.isArray(p.entries)) throw new Error('這不是同步版的存檔');
  if (Array.isArray(p.meals)) throw new Error('這是 MetaPulse 自己的存檔，請用「匯入或還原」');
  const entries = [];
  let bad = 0;
  p.entries.forEach((e, i) => {
    const n = normalizeEntry({ ...e, id: undefined, sid: e && e.id != null ? String(e.id) : '', src: 'sync' }, i);
    if (n) { n.id = 'e' + Date.now().toString(36) + i; entries.push(n); } else bad++;
  });
  const profile = {};
  if (+p.h > 0) profile.height = +p.h;
  if (+p.tw > 0) profile.targetWeight = +p.tw;
  if (+p.hl > 0) profile.halfLife = +p.hl;
  return { entries, profile, bad, ts: +p.ts || 0 };
}

/** 預覽：要新增、更新、略過幾筆，日期範圍，會帶入的個人資料 */
export function previewImport(parsed, existingEntries, currentProfile = {}) {
  const plan = planImport(parsed.entries, existingEntries);
  const profile = {};
  for (const k in parsed.profile) if (+currentProfile[k] !== +parsed.profile[k]) profile[k] = parsed.profile[k];
  return { ...plan, total: parsed.entries.length, bad: parsed.bad, profile };
}

/** 套用到狀態（會修改 S） */
export function applyImport(S, preview) {
  for (const u of preview.update) {
    const t = S.entries.find(e => e.id === u.id);
    if (t) Object.assign(t, { ...u.rec, id: t.id });
  }
  S.entries.push(...preview.add);
  Object.assign(S.profile, preview.profile);
  return { added: preview.add.length, updated: preview.update.length };
}
