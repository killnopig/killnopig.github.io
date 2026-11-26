/* Health Connect（只在 Android APK 中可用）：移植同步版的同步流程，另外讀取運動消耗熱量。
 * 血壓、脈搏、體重、體脂、基礎代謝 → entries；運動消耗（ActiveCaloriesBurned）→ activity（每天一筆）。 */
import { planMeasurements } from './records.js';

const pad = n => String(n).padStart(2, '0');

export function capPlugin(name) {
  try {
    const C = window.Capacitor;
    if (!C || !isNative()) return null;
    if (C.Plugins && C.Plugins[name]) return C.Plugins[name];
    if (C.isPluginAvailable && C.isPluginAvailable(name) && C.registerPlugin) return C.registerPlugin(name);
  } catch (e) { /* 沒有外掛 */ }
  return null;
}
export function isNative() {
  try { const C = window.Capacitor; if (!C) return false; return C.isNativePlatform ? !!C.isNativePlatform() : (C.getPlatform ? C.getPlatform() !== 'web' : false); } catch (e) { return false; }
}
export const healthPlugin = () => capPlugin('Health');

export function diagnose() {
  try {
    const C = window.Capacitor;
    if (!C) return '目前是一般網頁，不是 APK。';
    return '平台 ' + (C.getPlatform ? C.getPlatform() : '?') + '；原生 ' + (C.isNativePlatform ? C.isNativePlatform() : '?') + '；Health 外掛 ' + (C.isPluginAvailable ? C.isPluginAvailable('Health') : '?');
  } catch (e) { return '診斷失敗：' + e.message; }
}

const loc = iso => { const d = new Date(iso); return { date: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()), time: pad(d.getHours()) + ':' + pad(d.getMinutes()), t: d.getTime() }; };
const blank = l => ({ date: l.date, time: l.time, sys: 0, dia: 0, pul: 0, wt: 0, fat: 0, mus: 0, vis: 0, bage: 0, bmr: 0, dose: 0, site: '', note: '', src: 'hc', sid: '' });
const minOf = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const srcName = s => s.sourceName || s.sourceId || '未知來源';

/**
 * 把 Health Connect 的樣本轉成記錄（純函數，方便測試）
 * @param raw {weight, bodyFat, bloodPressure, basalCalories, heartRate, calories}
 * @param o {allSources:boolean, calSource?:string}
 */
export function buildRecords(raw, o = {}) {
  const isOm = s => o.allSources || /omron/i.test((s.sourceId || '') + ' ' + (s.sourceName || ''));
  const recs = [], hrs = (raw.heartRate || []).filter(isOm);
  for (const s of (raw.bloodPressure || []).filter(isOm)) {
    const l = loc(s.startDate), sy = Math.round(+s.systolic || 0), di = Math.round(+s.diastolic || 0);
    if (!(sy > 0 && di > 0)) continue;
    let pul = 0, best = 1e9;
    for (const hr of hrs) { const dt = Math.abs(new Date(hr.startDate).getTime() - l.t); if (dt <= 120000 && dt < best) { best = dt; pul = Math.round(+hr.value || 0); } }
    const r = blank(l); r.sys = sy; r.dia = di; r.pul = pul; recs.push(r);
  }
  const body = {};
  const slot = s => { const l = loc(s.startDate); return body[l.date + ' ' + l.time] || (body[l.date + ' ' + l.time] = blank(l)); };
  (raw.weight || []).filter(isOm).forEach(s => { if (s.value > 0) slot(s).wt = +(+s.value).toFixed(1); });
  (raw.bodyFat || []).filter(isOm).forEach(s => { if (s.value > 0) slot(s).fat = +(+s.value).toFixed(1); });
  (raw.basalCalories || []).filter(isOm).forEach(s => { if (s.value > 0) slot(s).bmr = Math.round(+s.value); });
  const bl = Object.values(body).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
  // 同一次量測的體脂、基礎代謝時間可能差一兩分鐘，併到同一筆體重
  for (const r of bl.filter(x => !(x.wt > 0))) {
    const t = bl.find(x => x.wt > 0 && x.date === r.date && Math.abs(minOf(x.time) - minOf(r.time)) <= 2);
    if (t) { for (const k of ['fat', 'bmr']) if (!(t[k] > 0)) t[k] = r[k]; r._m = 1; }
  }
  bl.filter(r => !r._m).forEach(r => recs.push(r));
  recs.sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));

  // 運動消耗：依來源加總，預設取總量最多的來源（避免手機與手錶重複計算）
  const cal = raw.calories || [], bySrc = {};
  for (const s of cal) { const k = srcName(s); bySrc[k] = (bySrc[k] || 0) + (+s.value || 0); }
  const srcs = Object.keys(bySrc).sort((a, b) => bySrc[b] - bySrc[a]);
  const calSource = o.calSource && bySrc[o.calSource] != null ? o.calSource : srcs[0] || '';
  const days = {};
  for (const s of cal) if (srcName(s) === calSource && +s.value > 0) { const d = loc(s.startDate).date; days[d] = (days[d] || 0) + +s.value; }
  const activity = Object.keys(days).sort().map(d => ({ date: d, kcal: Math.round(days[d]), src: calSource }));

  const sources = {};
  for (const k of ['weight', 'bodyFat', 'bloodPressure', 'basalCalories', 'heartRate', 'calories']) for (const s of raw[k] || []) { const n = srcName(s); sources[n] = (sources[n] || 0) + 1; }
  return { recs, activity, calSources: srcs, calSource, sources };
}

/** 規劃：量測記錄的新增／補欄位／略過，運動消耗每天新增或更新 */
export function planHealth(built, S) {
  const m = planMeasurements(built.recs, S.entries);
  const act = { add: [], update: [], same: 0 };
  for (const a of built.activity) {
    const ex = (S.activity || []).find(x => x.date === a.date);
    if (!ex) act.add.push(a);
    else if (ex.edited) act.same++;            // 使用者改過或刪掉的那天：同步不蓋回去
    else if (ex.kcal !== a.kcal || ex.src !== a.src) act.update.push(a); else act.same++;
  }
  return { ...m, act };
}

/** Health Connect 自動匯入某一天的運動消耗：改大卡數、kcal＝0 當作不算；hc 留著原本的數字 */
export function editActivity(S, date, kcal) {
  S.activity = S.activity || [];
  const a = S.activity.find(x => x.date === date);
  if (!a) return null;
  if (a.hc == null) a.hc = a.kcal;
  a.kcal = Math.max(0, Math.round(+kcal || 0));
  a.edited = true;
  return a;
}
/** 恢復原本的數字，之後同步也會照 Health Connect 更新 */
export function restoreActivity(S, date) {
  const a = (S.activity || []).find(x => x.date === date);
  if (!a || !a.edited) return a || null;
  if (a.hc != null) a.kcal = a.hc;
  delete a.hc; delete a.edited;
  return a;
}

export function applyHealth(S, plan, uid) {
  for (const r of plan.add) S.entries.push({ ...r, id: uid('e') });
  for (const mg of plan.merge) { const t = S.entries.find(e => e.id === mg.id); if (t) Object.assign(t, mg.fill); }
  S.activity = S.activity || [];
  for (const a of [...plan.act.add, ...plan.act.update]) {
    const i = S.activity.findIndex(x => x.date === a.date);
    if (i >= 0) S.activity[i] = a; else S.activity.push(a);
  }
  S.activity.sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** 實際向 Health Connect 讀取 */
export async function readHealth(days) {
  const H = healthPlugin();
  if (!H) throw new Error('這個功能只能在 MetaPulse 手機 app（APK）裡使用。');
  const av = await H.isAvailable();
  if (!av || !av.available) throw new Error('這支手機不能使用 Health Connect：' + ((av && av.reason) || '沒有安裝或不支援'));
  const types = ['weight', 'bodyFat', 'bloodPressure', 'basalCalories', 'heartRate', 'calories'];
  const au = await H.requestAuthorization({ read: types, write: [], requestHistoryAccess: days > 30 });
  const denied = (au && au.readDenied) || [];
  const start = new Date(Date.now() - days * 864e5).toISOString(), end = new Date().toISOString();
  const errs = [], raw = {};
  for (const t of types) {
    if (denied.includes(t)) { raw[t] = []; continue; }
    try { const r = await H.readSamples({ dataType: t, startDate: start, endDate: end, limit: 5000, ascending: true }); raw[t] = r.samples || []; }
    catch (e) { raw[t] = []; errs.push(t + '：' + (e && e.message ? e.message : e)); }
  }
  return { raw, denied, errs, historyDenied: days > 30 && au && au.historyAccessAuthorized === false };
}

/* 自動匯入 Omron（打開 App、切回 App 時）：只讀已經允許的項目，不跳權限視窗；只匯入量測，不動運動消耗 */
export const AUTO_TYPES = ['weight', 'bodyFat', 'bloodPressure', 'basalCalories', 'heartRate'];
export const AUTO_GAP = 10 * 60 * 1000;   // 最多每 10 分鐘讀一次

/** 現在要不要自動讀（純函數） */
export function autoDue(L, now = Date.now()) {
  return L.hcAuto !== false && !(now - (+L.hcAutoAt || 0) < AUTO_GAP);
}

/** 自動匯入的規劃：只看 Omron 的量測（新增＋補體組成），運動消耗留給手動同步 */
export function autoPlan(raw, S) {
  const b = buildRecords(raw, { allSources: false });
  const m = planMeasurements(b.recs, S.entries);
  return { ...m, act: { add: [], update: [], same: 0 } };
}

/** 安靜地讀最近 days 天（沒有允許的項目就跳過；完全沒允許回傳 null） */
export async function readHealthQuiet(days = 7) {
  const H = healthPlugin();
  if (!H) return null;
  const av = await H.isAvailable();
  if (!av || !av.available || !H.checkAuthorization) return null;
  const au = await H.checkAuthorization({ read: AUTO_TYPES, write: [] });
  const ok = (au && au.readAuthorized) || [];
  if (!ok.length) return null;
  const start = new Date(Date.now() - days * 864e5).toISOString(), end = new Date().toISOString(), raw = {};
  for (const t of AUTO_TYPES) {
    if (!ok.includes(t)) { raw[t] = []; continue; }
    try { const r = await H.readSamples({ dataType: t, startDate: start, endDate: end, limit: 2000, ascending: true }); raw[t] = r.samples || []; }
    catch (e) { raw[t] = []; }
  }
  return raw;
}
