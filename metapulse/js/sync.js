/* 兩份資料（這支手機、Google Drive）合併成一份（純函數）
 * - 各種記錄依 id 合併：兩邊都有同一筆時，用整份比較新（ts 較大）的那邊
 * - 刪除過的記錄記在 deleted { id: 刪除時間 }，合併後不會再冒出來
 * - 個人資料、設定：用比較新的那份
 * - 運動消耗依日期合併 */

export const COLS = ['entries', 'meals', 'foodLibrary', 'fasts', 'medLog', 'exercise', 'symptoms', 'labs'];
const PRUNE_DAYS = 180;

export function idsOf(S) {
  const o = {};
  for (const c of COLS) o[c] = new Set((S[c] || []).map(x => x && x.id).filter(x => x != null).map(String));
  return o;
}

/** 比較前後兩次的 id，把不見的記為刪除 */
export function recordDeletes(S, before, now = Date.now()) {
  S.deleted = S.deleted || {};
  const after = idsOf(S);
  for (const c of COLS) for (const id of before[c] || []) if (!after[c].has(id)) S.deleted[id] = now;
  return S;
}

function pruneDeleted(del, now) {
  const o = {}, cut = now - PRUNE_DAYS * 864e5;
  for (const k in del || {}) if (del[k] >= cut) o[k] = del[k];
  return o;
}

export function mergeStates(a, b, now = Date.now()) {
  if (!b) return a;
  if (!a) return b;
  const newer = (+a.ts || 0) >= (+b.ts || 0) ? a : b, older = newer === a ? b : a;
  const deleted = { ...(older.deleted || {}) };
  for (const k in newer.deleted || {}) deleted[k] = Math.max(deleted[k] || 0, newer.deleted[k]);
  const out = { ...older, ...newer, deleted: pruneDeleted(deleted, now), ts: Math.max(+a.ts || 0, +b.ts || 0) };
  for (const c of COLS) {
    const m = new Map();
    for (const x of older[c] || []) if (x && x.id != null) m.set(String(x.id), x);
    for (const x of newer[c] || []) if (x && x.id != null) m.set(String(x.id), x);
    for (const id of Object.keys(deleted)) m.delete(id);
    out[c] = [...m.values()];
  }
  out.meals.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  const act = new Map();
  for (const x of older.activity || []) act.set(x.date, x);
  for (const x of newer.activity || []) act.set(x.date, x);
  out.activity = [...act.values()].sort((x, y) => (x.date < y.date ? -1 : 1));
  out.profile = { ...(older.profile || {}), ...(newer.profile || {}) };
  out.prefs = { ...(older.prefs || {}), ...(newer.prefs || {}) };
  return out;
}

/** 兩份的記錄內容是否相同（不比 ts） */
export function sameData(a, b) {
  const pick = s => JSON.stringify([COLS.map(c => (s[c] || []).map(x => JSON.stringify(x)).sort()), (s.activity || []).map(x => JSON.stringify(x)).sort(), s.profile, s.prefs, Object.keys(s.deleted || {}).sort()]);
  return pick(a) === pick(b);
}

/**
 * 還原時「只加入，不刪除」：把存檔裡的記錄合併進來，現有的記錄、個人資料和設定都保留，
 * 存檔裡的刪除標記也不採用（避免把這支手機或雲端的真記錄刪掉）
 */
export function addOnly(local, incoming, now = Date.now()) {
  const inc = { ...incoming, deleted: {}, ts: 0 };             // ts=0：同一筆兩邊都有時保留這支手機的
  const m = mergeStates({ ...local, ts: 1 }, inc, now);
  m.profile = { ...(local.profile || {}) };
  m.prefs = { ...(local.prefs || {}) };
  m.deleted = { ...(local.deleted || {}) };
  m.ts = now;
  return m;
}

/**
 * 太久沒備份的提醒：設定的天數內有新記錄、卻一直沒存到 Google Drive 或產生存檔文字
 * @param L 本機設定（backupDays：0＝不提醒；lastBackup；bkHide＝今天按過「今天不再提醒」的日期）
 * @returns {{show:boolean, never:boolean, days:number}}
 */
export function backupReminder(S, L, now = Date.now(), today = '') {
  const lim = L.backupDays == null ? 7 : +L.backupDays, last = +L.lastBackup || 0;
  const has = (S.entries || []).length + (S.meals || []).length > 0;
  const dirty = has && (!last || (+S.ts || 0) > last);
  const age = last ? (now - last) / 864e5 : Infinity;
  const show = lim > 0 && dirty && age >= lim && L.bkHide !== today;
  return { show, never: !last, days: last ? Math.floor(age) : 0 };
}
