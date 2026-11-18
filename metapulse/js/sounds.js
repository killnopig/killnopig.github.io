/* 自訂音效（斷食開始／結束）：使用者自己選的音效檔，只存在這台裝置的 IndexedDB
 * - 不上傳 GitHub、不放進 Google Drive 備份（L 也只存在這台裝置）
 * - 開 app 時先載入成 Audio，按鈕按下的當下就能直接播放（手機規定要使用者按了才能出聲） */
import { L, commitLocal } from './state.js';

const DB = 'metapulse-sounds', STORE = 'files';
export const SLOTS = { start: '斷食開始', end: '斷食結束' };
export const MAX_BYTES = 2 * 1024 * 1024;

function db() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode), st = t.objectStore(STORE), q = fn(st);
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error);
  });
}

const audios = {}, urls = {};
/** 開 app 時呼叫：把存著的音效載入成 Audio */
export async function preloadSounds() {
  for (const slot of Object.keys(SLOTS)) {
    try {
      const blob = await tx('readonly', st => st.get(slot));
      if (urls[slot]) { URL.revokeObjectURL(urls[slot]); delete urls[slot]; delete audios[slot]; }
      if (blob) { urls[slot] = URL.createObjectURL(blob); const a = new Audio(urls[slot]); a.preload = 'auto'; audios[slot] = a; }
    } catch (e) { /* 這台裝置不支援 IndexedDB：就用內建聲音 */ }
  }
}

export async function saveSound(slot, file) {
  if (!file) throw new Error('沒有選到檔案');
  if (file.size > MAX_BYTES) throw new Error('檔案太大（' + (file.size / 1048576).toFixed(1) + ' MB），上限 2 MB');
  if (file.type && !/^audio\//.test(file.type) && !/\.(mp3|m4a|aac|wav|ogg)$/i.test(file.name)) throw new Error('這不是音效檔');
  await tx('readwrite', st => st.put(file, slot));
  L.sounds = L.sounds || {}; L.sounds[slot] = { name: file.name, size: file.size }; commitLocal();
  await preloadSounds();
}
export async function removeSound(slot) {
  await tx('readwrite', st => st.delete(slot));
  if (L.sounds) { delete L.sounds[slot]; commitLocal(); }
  await preloadSounds();
}
export const hasSound = slot => !!audios[slot];
/** 秒數（還不知道時回傳 0） */
export const soundDuration = slot => { const a = audios[slot]; return a && Number.isFinite(a.duration) ? a.duration : 0; };

/** 立刻播放（要在按鈕按下的當下呼叫）；回傳播完的 Promise（最多等 15 秒） */
export function playSound(slot) {
  const a = audios[slot];
  if (!a) return null;
  return new Promise(res => {
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    setTimeout(fin, 15000);
    try {
      a.currentTime = 0; a.onended = fin; a.onerror = fin;
      const p = a.play(); if (p && p.catch) p.catch(fin);
    } catch (e) { fin(); }
  });
}
