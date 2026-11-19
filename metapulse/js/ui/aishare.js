/* 交給使用者自己的 AI：設定裡挑預設的 AI（ChatGPT／Gemini／Claude／其他），
 * 文字先複製到剪貼簿；有圖片時用系統分享（文字＋圖片一起帶過去），沒有分享就打開那個 AI 的網站。
 * 健康資料只走剪貼簿或分享，不放進網址。 */
import { L, commitLocal } from '../state.js';
import { h, toast } from './common.js';
import { capPlugin } from '../health.js';

export const AIS = {
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/app' },
  claude: { name: 'Claude', url: 'https://claude.ai/new' },
  other: { name: '其他 AI', url: '' },
};
export const aiPick = () => AIS[L.aiApp] ? L.aiApp : 'chatgpt';
export const aiName = () => AIS[aiPick()].name;

/** 預設 AI 的下拉選單（設定頁用） */
export function aiSelect(onChange) {
  const sel = h('select', { 'aria-label': '預設 AI' }, ...Object.entries(AIS).map(([v, a]) => h('option', { value: v }, a.name)));
  sel.value = aiPick();
  sel.onchange = () => { L.aiApp = sel.value; commitLocal(); onChange && onChange(sel.value); };
  return sel;
}

/** 複製文字；不行就把 ta（textarea）顯示出來讓人自己選 */
export async function copyText(t, ta) {
  try { await navigator.clipboard.writeText(t); return true; }
  catch (e) {
    if (!ta) return false;
    ta.value = t; ta.style.display = ''; ta.select();
    try { return document.execCommand('copy'); } catch (e2) { return false; }
  }
}

/** 打開預設 AI 的網站或 App（其他 AI 就不開） */
export function openAi() {
  const a = AIS[aiPick()];
  if (!a.url) return false;
  window.open(a.url, '_blank', 'noopener');
  return true;
}

const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
const cancelled = e => e && (e.name === 'AbortError' || /cancel/i.test(e.message || ''));

/** 文字＋圖片一起分享出去。回傳 'shared'（跳出分享）、'cancel'、或 false（這裡不能分享） */
export async function shareToAi(text, blob, fileName) {
  const title = 'MetaPulse → ' + aiName();
  const Sh = capPlugin('Share'), Fs = capPlugin('Filesystem');
  try {
    if (Sh) {
      const files = [];
      if (blob && Fs) files.push((await Fs.writeFile({ path: fileName, data: await b64(blob), directory: 'CACHE' })).uri);
      await Sh.share({ title, text, ...(files.length ? { files } : {}), dialogTitle: '選 ' + aiName() });
      return 'shared';
    }
    const data = { title, text };
    if (blob) data.files = [new File([blob], fileName, { type: 'image/png' })];
    if (navigator.canShare && navigator.canShare(data)) { await navigator.share(data); return 'shared'; }
  } catch (e) { if (cancelled(e)) return 'cancel'; }
  return false;
}

/** 讓使用者自己的 AI 一步一步教他申請 Gemini API 金鑰 */
export const KEY_PROMPT = [
  '我想免費申請 Google 的 Gemini API 金鑰（API key），貼到一個叫 MetaPulse 的飲食記錄 App 裡，讓它用 AI 辨識食物照片。',
  '我是新手，請你一步一步教我：',
  '1. 到 Google AI Studio（https://aistudio.google.com/apikey）用 Google 帳號登入。',
  '2. 建立 API 金鑰並複製下來。',
  '3. 回到 MetaPulse：「設定」→「AI 辨識食物」→ 把金鑰貼到「API 金鑰」，再按「測試連線」。',
  '請每次只講一步，用簡單的話說明畫面上要按哪裡，等我回覆「好了」再講下一步。如果我卡住，請問我看到什麼畫面。',
  '也請提醒我：金鑰像密碼一樣，不要傳給別人；免費額度用完時會怎樣。',
].join('\n');

export async function askAiForKey() {
  const ok = await copyText(KEY_PROMPT);
  if (ok && openAi()) toast('提示詞已複製，到 ' + aiName() + ' 貼上送出');
  else if (ok) toast('提示詞已複製，貼到你的 AI 就好');
  else if (await shareToAi(KEY_PROMPT) !== 'shared') toast('沒辦法複製，請打開「怎麼申請 API 金鑰」照著做', true);
}
