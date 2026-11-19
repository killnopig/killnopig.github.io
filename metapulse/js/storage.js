/* 本機儲存。
 * - metapulse-v1：記錄資料，會列入 Drive 備份
 * - metapulse-local：只存在這台裝置（API key、主題、收合狀態…），不列入備份
 * 注意：同網域（github.io 帳號網域）的 localStorage 是共用的，這裡只讀寫上面兩個鍵（與 -undo 等衍生鍵）。 */

export const KEY = 'metapulse-v1';
export const LOCAL_KEY = 'metapulse-local';
export const SCHEMA = 1;

/** 副作用（每天一筆，0～3）；和 safety.js 的 SYMPTOMS 同一組欄位 */
const SX = ['nausea', 'constip', 'diarrhea', 'appetite', 'tired'];
function normalizeSymptom(x) {
  if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(x.date)) return null;
  const o = { id: 'sx' + x.date, date: x.date };
  for (const k of SX) o[k] = Math.max(0, Math.min(3, Math.round(+x[k] || 0)));
  return o;
}

export const SITES = ['左腹', '腹中', '右腹', '左大腿', '右大腿', '左上臂', '右上臂'];

export function defaultProfile() {
  return {
    height: 0, sex: 'M', birthYear: 0, weight: 0, targetWeight: 0, targetWeeks: 0,
    weeklyLossPct: 0,      // 0 = 使用預設（config.BUDGET.defaultWeeklyLossPct）
    bmrManual: 0, activity: 1.2, proteinPerKg: 1.2, floorPoints: 0, halfLife: 120,
  };
}

export function defaultState() {
  return {
    schema: SCHEMA, ts: 0,
    profile: defaultProfile(),
    entries: [], meals: [], foodLibrary: [], fasts: [], activity: [], medLog: [], exercise: [], symptoms: [], deleted: {},
    prefs: { fastMode: 'PURE_DYNAMIC', strictPlan: '16:8', windowStart: '12:00', mealThresholds: { kcal: 800, carb: 100 }, longTermAlpha: 0.05, weekStart: 'roll', meds: [] },
  };
}

export function defaultLocal() {
  return {
    geminiKey: '', geminiModel: 'gemini-3.5-flash-lite', geminiModels: [], geminiApi: 'auto',
    theme: 'light', keepThumbs: false, collapsed: {}, disclaimerOk: false,
    driveLinked: false, lastBackup: 0, askBackup: true, backupDays: 7,
    notify: { freq: 'phase', quietStart: '23:00', quietEnd: '07:00', doseRemindAt: '09:00' },
  };
}

const num = v => (Number.isFinite(+v) ? +v : 0);
const str = v => (v == null ? '' : String(v));

/** 同步版的量測時間寫在 note 開頭（"07:32，…"），拆出來放 time */
export function timeFromNote(note) {
  const m = str(note).match(/^(\d{1,2}):(\d{2})/);
  return m ? String(+m[1]).padStart(2, '0') + ':' + m[2] : '';
}

/** 整理一筆 entry（沿用同步版欄位名稱，多 time、src） */
export function normalizeEntry(e, i = 0) {
  if (!e || typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
  const o = { id: e.id || Date.now() + i, date: e.date };
  for (const k of ['dose', 'wt', 'sys', 'dia', 'pul', 'fat', 'mus', 'vis', 'bage', 'bmr']) o[k] = num(e[k]);
  o.site = SITES.includes(e.site) ? e.site : '';
  o.note = str(e.note);
  o.time = /^\d{2}:\d{2}$/.test(e.time || '') ? e.time : timeFromNote(o.note);
  o.src = str(e.src);
  o.sid = e.sid ? str(e.sid) : '';  // 從同步版匯入時，原本的 id（重複匯入用）
  return o;
}

function normalizeNutr(n) {
  return { kcal: num(n?.kcal), protein: num(n?.protein), carb: num(n?.carb), fat: num(n?.fat), fiber: num(n?.fiber) };
}

export function normalizeMeal(m) {
  if (!m || !m.at || isNaN(new Date(m.at))) return null;
  return {
    id: m.id || 'm' + Date.now() + Math.random().toString(36).slice(2, 6),
    group: str(m.group), at: new Date(m.at).toISOString(), name: str(m.name) || '未命名',
    unit: ['serving', 'g', 'fist'].includes(m.unit) ? m.unit : 'serving',
    qty: num(m.qty) || 1, slider: num(m.slider) || 1,
    servingGrams: num(m.servingGrams), fistsPerServing: num(m.fistsPerServing) || null,
    per: normalizeNutr(m.per),
    kcal: num(m.kcal), protein: num(m.protein), carb: num(m.carb), fat: num(m.fat), fiber: num(m.fiber), points: num(m.points),
    source: str(m.source) || 'manual', foodId: str(m.foodId), aiRaw: m.aiRaw ? str(m.aiRaw) : undefined,
    thumb: m.thumb ? str(m.thumb) : undefined,
    pending: m.pending ? true : undefined,   // 先存、還沒吃（按「結束斷食」才算吃了）
    notDup: m.notDup ? true : undefined,     // 使用者說「不是重複」：同一分鐘同樣的兩餐都有吃
    advice: m.advice && typeof m.advice === 'object' ? { review: str(m.advice.review), next: str(m.advice.next), cheer: str(m.advice.cheer), local: !!m.advice.local } : undefined,
  };
}

export function normalizeFood(f) {
  if (!f || !f.name) return null;
  return {
    id: f.id || 'f' + Date.now() + Math.random().toString(36).slice(2, 6), name: str(f.name),
    per: normalizeNutr(f.per), servingGrams: num(f.servingGrams), fistsPerServing: num(f.fistsPerServing) || null,
    lastUnit: ['serving', 'g', 'fist'].includes(f.lastUnit) ? f.lastUnit : 'serving', lastQty: num(f.lastQty) || 1,
    uses: num(f.uses), lastUsed: num(f.lastUsed),
  };
}

export function normalizeState(p) {
  const d = defaultState();
  if (!p || typeof p !== 'object') return d;
  return {
    schema: SCHEMA, ts: num(p.ts),
    profile: Object.assign(d.profile, p.profile || {}),
    entries: (Array.isArray(p.entries) ? p.entries : []).map(normalizeEntry).filter(Boolean),
    meals: (Array.isArray(p.meals) ? p.meals : []).map(normalizeMeal).filter(Boolean),
    foodLibrary: (Array.isArray(p.foodLibrary) ? p.foodLibrary : []).map(normalizeFood).filter(Boolean),
    fasts: Array.isArray(p.fasts) ? p.fasts.filter(f => f && f.start) : [],
    activity: (Array.isArray(p.activity) ? p.activity : []).filter(a => a && /^\d{4}-\d{2}-\d{2}$/.test(a.date)).map(a => ({ date: a.date, kcal: num(a.kcal), src: str(a.src) })),
    medLog: (Array.isArray(p.medLog) ? p.medLog : []).filter(x => x && x.id && x.med && /^\d{4}-\d{2}-\d{2}$/.test(x.date)).map(x => ({ id: str(x.id), med: str(x.med), date: x.date, at: str(x.at) })),
    exercise: (Array.isArray(p.exercise) ? p.exercise : []).filter(x => x && x.id && /^\d{4}-\d{2}-\d{2}$/.test(x.date)).map(x => ({ id: str(x.id), date: x.date, at: str(x.at), type: str(x.type), minutes: num(x.minutes), kcal: num(x.kcal) })),
    symptoms: (Array.isArray(p.symptoms) ? p.symptoms : []).map(normalizeSymptom).filter(Boolean),
    prefs: Object.assign(d.prefs, p.prefs || {}),
    deleted: p.deleted && typeof p.deleted === 'object' ? { ...p.deleted } : {},
  };
}

function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function write(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

export function loadState() {
  try { const r = read(KEY); return r ? normalizeState(JSON.parse(r)) : defaultState(); }
  catch (e) { return defaultState(); }
}

export function loadLocal() {
  try {
    const r = read(LOCAL_KEY), d = defaultLocal();
    if (!r) return d;
    const p = JSON.parse(r);
    return Object.assign(d, p, { notify: Object.assign(d.notify, p.notify || {}), collapsed: p.collapsed || {} });
  } catch (e) { return defaultLocal(); }
}

/** 存檔；失敗（容量滿）時回傳 false */
export function saveState(S) { S.ts = Date.now(); return write(KEY, JSON.stringify(S)); }
export function saveLocal(L) { return write(LOCAL_KEY, JSON.stringify(L)); }
