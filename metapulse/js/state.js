/* 執行期狀態：S（會備份）、L（只存在這台裝置），以及變更通知 */
import { loadState, loadLocal, saveState, saveLocal, KEY } from './storage.js';
import { budget, localDate } from './points.js';
import { adaptiveTdee } from './adaptive.js';
import { idsOf, recordDeletes } from './sync.js';

export const S = loadState();
export const L = loadLocal();

const subs = new Set();
let known = idsOf(S); // 上次存檔時有哪些 id，用來記錄刪除（合併時才不會被加回來）
export const onChange = fn => subs.add(fn);

/** 修改 S 後呼叫：存檔並通知各畫面重畫 */
export function commit() {
  recordDeletes(S, known); known = idsOf(S);
  const ok = saveState(S);
  notify({});
  return ok;
}
function notify(ev) { subs.forEach(fn => { try { fn(ev); } catch (e) { console.error(e); } }); }

/** 整份換掉（還原、從雲端載入）。fromRemote=true 時保留原本的 ts，且不觸發自動備份 */
export function replaceState(n, fromRemote = false) {
  const before = known;
  Object.keys(S).forEach(k => delete S[k]);
  Object.assign(S, n);
  if (!fromRemote) recordDeletes(S, before); // 還原：原本有、還原後沒有的，記為刪除
  known = idsOf(S);
  let ok = true;
  if (fromRemote) { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { ok = false; } }
  else ok = saveState(S);
  notify({ remote: fromRemote, replaced: true });
  return ok;
}
export function commitLocal() { saveLocal(L); }

/** 目前體重：有體重記錄就用最新一筆，沒有就用個人資料 */
export function currentWeight() {
  let best = null;
  for (const e of S.entries) if (e.wt > 0 && (!best || e.date > best.date || (e.date === best.date && (e.time || '') >= (best.time || '')))) best = e;
  return best ? best.wt : +S.profile.weight || 0;
}

let tdeeCache = { key: '', v: null };
/** 依記錄反推的消耗（同一份資料、同一天只算一次） */
export function tdeeFromLog(b0) {
  const today = localDate(new Date()), key = S.ts + '|' + today + '|' + b0.bmr + '|' + b0.tdeeFormula;
  if (tdeeCache.key !== key) tdeeCache = { key, v: adaptiveTdee(S, b0.bmr, b0.tdeeFormula, today) };
  return tdeeCache.v;
}

/** 每日預算；設定選「依我的記錄」而且資料夠時，用反推的消耗取代公式 */
export function plan() {
  const p = { ...S.profile, weight: currentWeight() };
  const b0 = budget(p);
  if (!b0.ok || (S.prefs.tdeeMode || 'formula') !== 'adaptive') return b0;
  const a = tdeeFromLog(b0);
  return a.ready ? budget({ ...p, tdeeOverride: a.tdee }) : b0;
}

export const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
