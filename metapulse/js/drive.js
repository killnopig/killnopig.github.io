/* Google Drive 備份（drive.appdata）。沿用同步版的 OAuth 寫法與 Client ID。
 * - 自己的備份檔：metapulse.json（讀寫）
 * - 同步版的備份檔：dose-tracker-sync.json（只讀，絕不寫入、修改或刪除） */
import { S, L, commitLocal, replaceState, onChange } from './state.js';
import { normalizeState } from './storage.js';
import { mergeStates, sameData } from './sync.js';

export const GOOGLE_CLIENT_ID = '157434461885-nmum0qv1h34r1u9f0scn7g75u7s09iiu.apps.googleusercontent.com';
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const FN = 'metapulse.json';
export const SYNC_FN = 'dose-tracker-sync.json';
const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

let tok = null, tokExp = 0, tc = null, fid = null, tmr = null;
const listeners = new Set();
let status = L.driveLinked ? 'Google Drive 已連結，連線中…' : '只存在這支手機';
export const driveEmail = () => L.driveEmail || '';

/** 取得目前登入的帳號（Drive about；只需 drive.appdata 權限） */
async function fetchAccount() {
  try {
    const j = await (await gfetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)')).json();
    const em = j && j.user && j.user.emailAddress;
    if (em && em !== L.driveEmail) { L.driveEmail = em; commitLocal(); }
  } catch (e) { /* 取不到帳號不影響備份 */ }
}
export const onDrive = fn => listeners.add(fn);
const emit = (text, event) => { if (text) status = text; listeners.forEach(f => { try { f(status, event); } catch (e) { console.error(e); } }); };
export const driveStatus = () => status;
export const linked = () => !!L.driveLinked;
export const ready = () => !!tok && Date.now() < tokExp - 60000;

async function gfetch(url, opt = {}) {
  const r = await fetch(url, { ...opt, headers: { Authorization: 'Bearer ' + tok, ...(opt.headers || {}) } });
  if (r.status === 401) { tok = null; throw new Error('auth'); }
  if (!r.ok) throw new Error('http ' + r.status);
  return r;
}
async function findFile(name) {
  const r = await gfetch(API + '?spaces=appDataFolder&fields=files(id,modifiedTime)&q=' + encodeURIComponent("name='" + name + "'"));
  const j = await r.json();
  return j.files && j.files[0] ? j.files[0] : null;
}
async function findId(name) { const f = await findFile(name); return f ? f.id : null; }

/** 備份到 Drive */
export async function pushRemote() {
  if (!ready()) { emit('Google Drive 需要重新登入（點這裡）', 'need-auth'); return false; }
  try {
    if (!fid) fid = await findId(FN);
    if (fid) { // 寫入前先合併雲端的版本，避免蓋掉另一台裝置的新記錄
      try {
        const d = await (await gfetch(API + '/' + fid + '?alt=media')).json();
        if (d && typeof d === 'object') {
          const remote = normalizeState(d); remote.ts = +d.ts || 0;
          const merged = normalizeState(mergeStates(JSON.parse(JSON.stringify(S)), remote)); merged.ts = Math.max(+S.ts || 0, remote.ts);
          if (!sameData(merged, S)) replaceState(merged, true);
        }
      } catch (e) { if (e.message === 'auth') throw e; }
    }
    const data = JSON.stringify(S);
    if (fid) {
      await gfetch(UPLOAD + '/' + fid + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: data });
    } else {
      const bd = 'mpb' + Date.now();
      const body = '--' + bd + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: FN, parents: ['appDataFolder'] })
        + '\r\n--' + bd + '\r\nContent-Type: application/json\r\n\r\n' + data + '\r\n--' + bd + '--';
      const r = await gfetch(UPLOAD + '?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + bd }, body });
      fid = (await r.json()).id;
    }
    L.lastBackup = Date.now(); commitLocal();
    emit('已存到 Google Drive', 'pushed');
    return true;
  } catch (e) {
    emit(e.message === 'auth' ? 'Google Drive 需要重新登入（點這裡）' : '存到 Google Drive 失敗，資料還在手機裡（點這裡重新登入）', 'push-failed');
    return false;
  }
}

export function schedPush() {
  if (!L.driveLinked) return;
  emit('同步中…');
  clearTimeout(tmr); tmr = setTimeout(pushRemote, 1000);
}

/** 連線或同步時：把雲端那份和這支手機的合併（不會整份蓋掉），有差異再各自更新 */
async function pullAndMerge() {
  fid = await findId(FN);
  if (!fid) { await pushRemote(); return; }
  const d = await (await gfetch(API + '/' + fid + '?alt=media')).json();
  if (!d || typeof d !== 'object') { await pushRemote(); return; }
  const remote = normalizeState(d); remote.ts = +d.ts || 0;
  const local = JSON.parse(JSON.stringify(S));
  const merged = normalizeState(mergeStates(local, remote)); merged.ts = Math.max(+local.ts || 0, +remote.ts || 0);
  const localChanged = !sameData(merged, local), remoteChanged = !sameData(merged, remote);
  if (localChanged) { replaceState(merged, true); emit('已和 Google Drive 合併', 'pulled'); }
  if (remoteChanged) await pushRemote();
  else if (!localChanged) { L.lastBackup = Date.now(); commitLocal(); emit('已存到 Google Drive', 'synced'); }
  else { L.lastBackup = Date.now(); commitLocal(); }
}

/** interactive：使用者按按鈕；chooseAccount：強制顯示帳號選擇畫面 */
export function connect(interactive, chooseAccount) {
  if (!window.google || !google.accounts || !google.accounts.oauth2) { emit('Google 登入還沒準備好，請等幾秒再試', 'error'); return; }
  if (!tc) tc = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID, scope: SCOPE,
    callback: async r => {
      if (r.error || !r.access_token) { emit('Google 登入失敗（點這裡重試）', 'need-auth'); return; }
      tok = r.access_token; tokExp = Date.now() + (r.expires_in || 3600) * 1000;
      L.driveLinked = true; commitLocal();
      await fetchAccount();
      try { await pullAndMerge(); } catch (e) { emit('和 Google Drive 同步失敗，資料還在手機裡（點這裡重新登入）', 'push-failed'); }
      emit(null, 'linked');
    },
    error_callback: () => emit('Google Drive 需要重新登入（點這裡）', 'need-auth'),
  });
  const opt = { prompt: !interactive ? 'none' : (chooseAccount || !L.driveEmail ? 'select_account' : '') };
  if (L.driveEmail && !chooseAccount) opt.hint = L.driveEmail;
  tc.requestAccessToken(opt);
}

export function disconnect() {
  try { if (tok && window.google) google.accounts.oauth2.revoke(tok); } catch (e) { /* 忽略 */ }
  tok = null; fid = null; L.driveLinked = false; L.driveEmail = ''; commitLocal();
  emit('只存在這支手機（已中斷 Google Drive）', 'unlinked');
}

/** 只忘記這支手機的登入（不撤銷 Google 授權，不讀寫雲端；其他裝置不受影響）。清除資料前用 */
export function forgetLocal() {
  clearTimeout(tmr); tok = null; fid = null;
}

/** 立即同步（已連線時） */
export async function syncNow() {
  if (!ready()) { connect(true); return; }
  emit('同步中…');
  try { await pullAndMerge(); } catch (e) { emit('和 Google Drive 同步失敗，資料還在手機裡', 'push-failed'); }
}

/** 只讀取同步版的備份檔（不寫入、不修改、不刪除） */
export async function readSyncBackup() {
  if (!ready()) throw new Error('請先連線 Google Drive');
  const f = await findFile(SYNC_FN);
  const id = f && f.id;
  if (!id) throw new Error('在你的 Google Drive 找不到同步版的存檔（' + SYNC_FN + '）。請確認同步版有登入同一個 Google 帳號，並且存過檔。');
  const data = await (await gfetch(API + '/' + id + '?alt=media')).json();
  return { data, modifiedTime: f.modifiedTime ? new Date(f.modifiedTime).getTime() : 0 };
}

/** 只讀取 MetaPulse 自己在雲端的存檔（檢查最新日期用；找不到回傳 null） */
export async function readOwnRemote() {
  if (!ready()) throw new Error('請先連線 Google Drive');
  const f = await findFile(FN);
  if (!f) return null;
  const data = await (await gfetch(API + '/' + f.id + '?alt=media')).json();
  return { data, modifiedTime: f.modifiedTime ? new Date(f.modifiedTime).getTime() : 0 };
}

/* 資料變動時自動備份 */
onChange(ev => { if (!ev || !ev.remote) schedPush(); });

/* 開啟時若曾連線，靜默重新取得授權 */
export function initDrive() {
  if (!L.driveLinked) return;
  const tryConnect = (n = 0) => {
    if (window.google && google.accounts && google.accounts.oauth2) connect(false);
    else if (n < 20) setTimeout(() => tryConnect(n + 1), 500);
    else emit('Google 登入載入失敗，資料還在手機裡', 'error');
  };
  tryConnect();
}
