/* 設定頁「備份與匯入」：一張卡分兩區
 * - Google：Drive 自動備份（帳號、同步、切換、中斷）＋ 從 Drive 讀取同步版備份
 * - 其他：備份文字（產生、還原）與同步版的文字／檔案匯入共用一個輸入框，自動判斷格式 */
import { S, L, commit, commitLocal, replaceState } from '../state.js';
import { h, toast, section, sumLine, fold, tip } from './common.js';
import { connect, disconnect, syncNow, linked, ready, driveStatus, driveEmail, onDrive, readSyncBackup, readOwnRemote, forgetLocal } from '../drive.js';
import { addOnly } from '../sync.js';
import { latestText } from '../records.js';
import { normalizeState } from '../storage.js';
import { parseSyncBackup, previewImport, applyImport } from '../migrate.js';

const ago = t => { if (!t) return ''; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '剛剛' : m < 60 ? m + ' 分鐘前' : m < 1440 ? Math.round(m / 60) + ' 小時前' : Math.round(m / 1440) + ' 天前'; };
const fmtAt = t => new Date(t).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
/** 預覽：最近 7 天（以存檔中最新的日期往前算）每天幾筆、其中幾筆會新增 */
function dayTable(all, add) {
  const dates = [...new Set(all.map(e => e.date))].sort().slice(-7).reverse();
  if (!dates.length) return null;
  const cnt = (list, d) => list.filter(e => e.date === d).length;
  return h('div', { style: { marginTop: '6px', borderTop: '1px solid var(--ln)', paddingTop: '6px' } },
    h('div.tiny.mu', '存檔裡最新 7 天：'),
    ...dates.map(d => { const n = cnt(add, d); return h('div.small.num', { style: { display: 'flex', gap: '10px' } }, h('span', { style: { width: '52px' } }, +d.slice(5, 7) + '/' + +d.slice(8)), h('span', cnt(all, d) + ' 筆'), h('span', { style: { color: n ? 'var(--ac)' : 'var(--mu)' } }, n ? '新增 ' + n : '已存在')); }));
}
/** 按鈕進入「處理中」：轉圈＋文字、鎖住不能重按；回傳恢復用的函式 */
function busy(btn, label) {
  const old = [...btn.childNodes];
  btn.disabled = true; btn.textContent = '';
  btn.append(h('span.spin', { style: { width: '16px', height: '16px', marginRight: '6px' } }), label);
  return () => { btn.disabled = false; btn.textContent = ''; btn.append(...old); };
}
/** 讓轉圈先畫出來，並至少顯示一下子（太快會像沒反應） */
const tick = (ms = 350) => new Promise(r => requestAnimationFrame(() => setTimeout(r, ms)));
/** 收起鍵盤、捲到結果的位置 */
function reveal(el) {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  setTimeout(() => { if (el.isConnected) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 250);
}
/* 還原會整頁重畫，結果先記下來，重畫後再顯示 */
let lastResult = null;

const sub = (t, first) => h('div.small', { style: { fontWeight: 650, margin: first ? '0 0 6px' : '18px 0 6px', paddingTop: first ? 0 : '14px', borderTop: first ? 0 : '1px solid var(--ln)' } }, t);

const AI_PROMPT = '請把我貼上的健康記錄（體重、血壓、體組成、注射），轉換成下面格式的 JSON。只輸出 JSON，不要加任何說明文字。\n\n格式：\n{"entries":[{"date":"YYYY-MM-DD","time":"HH:MM","dose":劑量數字,"wt":體重數字,"sys":收縮壓,"dia":舒張壓,"pul":脈搏,"fat":體脂率,"mus":骨骼肌率,"vis":內臟脂肪等級,"bage":身體年齡,"bmr":基礎代謝,"site":"部位","note":"備註"}]}\n\n規則：\n1. date 必須是 YYYY-MM-DD。如果我的資料沒有年份，或日期有歧義（例如 03/04 可能是 3 月 4 日或 4 月 3 日），請先問我，不要自己猜。\n2. time 是量測時間（24 小時制 HH:MM），沒有就填空字串 ""。\n3. dose 是注射劑量（mg），wt 是體重（kg），sys／dia／pul 是收縮壓／舒張壓（mmHg）／脈搏（次/分），fat／mus 是體脂率／骨骼肌率（%），vis 是內臟脂肪等級，bage 是身體年齡（歲），bmr 是基礎代謝（kcal）。同一次量測的數值放同一筆；沒有的項目一律填 0。\n4. 如果體重單位是磅（lb），請換算成公斤，四捨五入到小數 1 位。\n5. site 只能是這七個之一：左腹、腹中、右腹、左大腿、右大腿、左上臂、右上臂。沒有部位或對不上就填空字串 ""，並把原本的部位文字寫進 note。\n6. 依日期由舊到新排序。\n7. 資料裡沒有的內容不要編造。\n\n以下是我的資料：\n（把你的記錄貼在這裡）';

/** 從其他 App 或 Excel 匯入：複製提示詞給 AI 轉換格式，再貼回上面的框 */
function aiFold() {
  const ta = h('textarea', { rows: 5, readOnly: true }); ta.value = AI_PROMPT;
  const cp = h('button.ghost.full', { type: 'button', style: { marginTop: '8px' } }, '複製提示詞');
  cp.onclick = async () => {
    try { await navigator.clipboard.writeText(AI_PROMPT); } catch (e) { ta.select(); try { document.execCommand('copy'); } catch (e2) { /* 手動複製 */ } }
    cp.textContent = '已複製'; setTimeout(() => { cp.textContent = '複製提示詞'; }, 1500);
  };
  return fold('ai-import', h('span.small', { style: { fontWeight: 650 } }, '從 Excel 或其他 App 匯入'), [h('div', { style: { marginTop: '8px' } },
    cp, tip(h('ol', { style: { paddingLeft: '18px', margin: '0 0 6px' } },
      h('li', '按「複製提示詞」。'),
      h('li', '貼到你常用的 AI 對話（例如 ChatGPT、Gemini），再把你的記錄（Excel 複製的表格、CSV 內容都可以）貼在最後面。'),
      h('li', '把 AI 回覆的內容複製起來，貼到上面的框，按「匯入或還原」。')),
      '這樣匯入只會「加入」新的記錄，不會取代現有資料，已經有的也不會重複加入。只能匯入身體記錄（體重、血壓、體組成、注射），餐點不行。你的記錄會傳給你用的 AI 服務，請自己評估是否適合。', ta))]);
}

export function backupCard() {
  const sumEl = sumLine();
  const outDrive = h('div');   // Google Drive 匯入的預覽與結果（放在按鈕正下方）
  const outText = h('div');    // 文字／檔案的預覽與結果（放在按鈕正下方）
  const say = (out, text, ok) => { out.textContent = ''; out.append(h(ok ? 'div.notice.ok' : 'div.notice', text)); reveal(out); };

  /* ---------- 同步版匯入：預覽與確認 ---------- */
  const showSync = (out, parsed, source, savedAt) => {
    out.textContent = '';
    let pv;
    try { pv = previewImport(parsed, S.entries, S.profile); } catch (e) { say(out, e.message); return; }
    const pf = pv.profile, pl = [];
    if (pf.height) pl.push('身高 ' + pf.height + ' cm');
    if (pf.targetWeight) pl.push('目標體重 ' + pf.targetWeight + ' kg');
    if (pf.halfLife) pl.push('半衰期 ' + pf.halfLife + ' 小時');
    out.append(h('div', { style: { background: 'var(--soft)', borderRadius: '12px', padding: '10px 12px', lineHeight: 1.8, marginTop: '10px' } },
      h('div.small', h('b', '來源：'), source),
      h('div.small', '共 ' + pv.total + ' 筆' + (pv.from ? '（' + pv.from + ' ～ ' + pv.to + '）' : '')),
      h('div.small', '新增 ', h('b', pv.add.length), ' 筆・更新 ', h('b', pv.update.length), ' 筆・已存在略過 ', pv.dup, ' 筆' + (pv.bad ? '・日期格式錯誤略過 ' + pv.bad + ' 筆' : '')),
      pl.length ? h('div.small', '個人資料：' + pl.join('、')) : null,
      savedAt ? h('div.small', '同步版存到 Drive 的時間：' + fmtAt(savedAt)) : null,
      dayTable(parsed.entries, pv.add)));
    if (savedAt && Date.now() - savedAt > 12 * 3600000) out.append(h('div.notice', '同步版的雲端存檔已經 ' + Math.round((Date.now() - savedAt) / 3600000) + ' 小時沒更新。如果同步版裡有更新的記錄，請先在同步版連線 Google Drive 按一次同步，或改用下面的「貼上存檔文字」。'));
    if (!pv.add.length && !pv.update.length && !pl.length) { out.append(h('div.notice.ok', '沒有新的資料，MetaPulse 已經是最新的（存檔裡的記錄都已經有了）。')); reveal(out); return; }
    const go = h('button.pri.full', { type: 'button', style: { marginTop: '8px' } }, '確認匯入');
    go.onclick = async () => {
      busy(go, '匯入中…'); await tick();
      const r = applyImport(S, pv);
      L.lastSyncImport = { at: Date.now(), added: r.added, updated: r.updated }; commitLocal();
      commit(); draw();
      out.textContent = '';
      out.append(h('div.notice.ok', '✓ 已新增 ' + r.added + ' 筆、更新 ' + r.updated + ' 筆。同步版的資料沒有被改動。'),
        h('div.notice', '移植完成前可以繼續用同步版記錄，之後再匯入一次即可（不會重複）。'));
      toast('匯入完成'); reveal(out);
    };
    out.append(go);
    reveal(out);
  };

  /* ---------- Google ---------- */
  const acct = h('div.small');
  const main = h('button.pri.full', { type: 'button', style: { marginTop: '8px' } });
  main.onclick = () => { if (linked() && ready()) syncNow(); else connect(true); };
  const sw = h('button.ghost', { type: 'button', onclick: () => { disconnect(); connect(true, true); } }, '切換帳號');
  const off = h('button.ghost', { type: 'button', onclick: () => { disconnect(); draw(); } }, '中斷連線');
  const acctBtns = h('div.grid2', { style: { marginTop: '8px' } }, sw, off);
  const fromDrive = h('button.ghost.full', { type: 'button', style: { marginTop: '8px' } }, '匯入同步版（Drive）');
  fromDrive.onclick = async () => {
    if (!ready()) { say(outDrive, '請先按上面的「連線 Google Drive」，登入和同步版同一個 Google 帳號，再按一次。'); return; }
    const done = busy(fromDrive, '讀取中…'); outDrive.textContent = '';
    try { await tick(); const r = await readSyncBackup(); showSync(outDrive, parseSyncBackup(r.data), 'Google Drive', r.modifiedTime); }
    catch (e) { say(outDrive, e.message === 'auth' ? 'Google Drive 需要重新連線。' : '讀取失敗：' + e.message); }
    done();
  };

  /* ---------- 檢查各處最新日期 ---------- */
  const outCheck = h('div', { style: { marginTop: '10px' } });
  const check = h('button.ghost.full', { type: 'button', style: { marginTop: '8px' } }, '檢查各處最新日期');
  check.onclick = async () => {
    check.disabled = true; outCheck.textContent = '';
    const box = h('div', { style: { background: 'var(--soft)', borderRadius: '12px', padding: '10px 12px', lineHeight: 1.8 } });
    const row = (title, ...lines) => box.append(h('div.small', { style: { marginTop: box.childNodes.length ? '6px' : 0 } }, h('b', title)), ...lines.filter(Boolean).map(t => h('div.small.num', t)));
    const lastMeal = ms => { let t = ''; for (const m of ms || []) if (m.at > t) t = m.at; return t ? '餐點 ' + fmtAt(new Date(t).getTime()) : ''; };
    row('這支手機', latestText(S.entries) || '沒有身體記錄', lastMeal(S.meals));
    outCheck.append(box); reveal(outCheck);
    if (!ready()) { box.append(h('div.small.mu', { style: { marginTop: '6px' } }, linked() ? 'Google Drive 要重新登入，才能檢查雲端。' : '還沒連線 Google Drive，只能看這支手機。')); check.disabled = false; return; }
    const wait = h('div.row.small.mu', h('span.spin'), '正在讀取 Google Drive…'); box.append(wait);
    try {
      const r = await readOwnRemote();
      row('Google Drive：MetaPulse 存檔', r ? latestText((r.data && r.data.entries) || []) || '沒有身體記錄' : '雲端還沒有 MetaPulse 的存檔', r ? lastMeal(r.data && r.data.meals) : '', r && r.modifiedTime ? '最後存檔：' + fmtAt(r.modifiedTime) : '');
    } catch (e) { row('Google Drive：MetaPulse 存檔', '讀取失敗：' + (e.message === 'auth' ? '需要重新登入' : e.message)); }
    try {
      const r = await readSyncBackup();
      let txt; try { txt = latestText(parseSyncBackup(r.data).entries) || '沒有記錄'; } catch (e) { txt = '看不懂：' + e.message; }
      row('Google Drive：同步版存檔（只讀）', txt, r.modifiedTime ? '同步版最後存檔：' + fmtAt(r.modifiedTime) : '');
    } catch (e) { row('Google Drive：同步版存檔（只讀）', e.message === 'auth' ? '需要重新登入' : e.message); }
    wait.remove();
    box.append(h('div.mu.tiny', { style: { marginTop: '6px' } }, '如果同步版的日期比較舊，請先在同步版按一次同步；如果手機比雲端新，按上面的「立即同步」。'));
    check.disabled = false;
  };

  /* ---------- 其他：文字或檔案 ---------- */
  const ta = h('textarea', { rows: 3, placeholder: '貼上 MetaPulse 或同步版的存檔文字' });
  const file = h('input', { type: 'file', accept: '.json,.txt,application/json,text/plain' });
  const handle = (text, source) => {
    outText.textContent = '';
    let p;
    try { p = JSON.parse(String(text).replace(/```(json)?/g, '').trim()); } catch (e) { say(outText, '看不懂這段內容，沒有匯入任何資料。請確認貼上的是完整的存檔文字（從 { 開頭到 } 結尾，中間沒有被截斷）。'); return; }
    if (p && Array.isArray(p.meals)) {             // MetaPulse 自己的備份 → 還原
      const cnt = (p.entries || []).length + ' 筆身體記錄、' + p.meals.length + ' 筆餐點';
      const no = h('button.ghost.full', { type: 'button', style: { marginTop: '6px' }, onclick: () => { outText.textContent = ''; } }, '取消');
      const hasLocal = S.entries.length + S.meals.length + S.foodLibrary.length + (S.fasts || []).length > 0;
      if (!hasLocal && !linked()) {                // 手機是空的、也沒連雲端：直接還原
        const ok = h('button.pri.full', { type: 'button', style: { marginTop: '8px' } }, '確認還原');
        ok.onclick = async () => {
          no.disabled = true; busy(ok, '還原中…'); await tick(500);
          lastResult = { at: Date.now(), text: '✓ 已還原 ' + cnt + '。' };
          replaceState(normalizeState(p), true);  // 手機原本是空的，不需要記刪除
          toast('已還原');
        };
        outText.append(h('div.notice', '這是 MetaPulse 的備份（' + cnt + '）。'), ok, no);
        reveal(outText);
        return;
      }
      // 手機已有記錄或已連雲端：直接取代會把現有記錄記成「刪除」，同步後雲端和其他裝置的也會被刪 → 只提供兩種安全做法
      const add = h('button.pri.full', { type: 'button', style: { marginTop: '8px' } }, '只加入，不刪除（建議）');
      add.onclick = async () => {
        no.disabled = true; busy(add, '加入中…'); await tick(500);
        const before = S.entries.length + S.meals.length;
        const m = normalizeState(addOnly(JSON.parse(JSON.stringify(S)), normalizeState(p)));
        lastResult = { at: Date.now(), text: '✓ 已加入，現在共 ' + m.entries.length + ' 筆身體記錄、' + m.meals.length + ' 筆餐點（原本 ' + before + ' 筆，沒有刪除任何記錄）。' };
        replaceState(m);                        // 會整頁重畫，結果由 lastResult 顯示
        toast('已加入');
      };
      const wipe = h('button.danger.full', { type: 'button', style: { marginTop: '6px' } }, '先清除這支手機，再還原');
      wipe.onclick = async () => {
        if (!wipe.dataset.c) { wipe.dataset.c = 1; wipe.textContent = '再按一次確認（雲端不會動）'; setTimeout(() => { wipe.dataset.c = ''; wipe.textContent = '先清除這支手機，再還原'; }, 4000); return; }
        no.disabled = true; busy(wipe, '還原中…'); await tick(500);
        forgetLocal(); L.driveLinked = false; commitLocal();   // 先離開雲端：之後不讀不寫 Google Drive
        lastResult = { at: Date.now(), text: '✓ 已清除這支手機並還原 ' + cnt + '。Google Drive 已中斷，雲端的存檔沒有被動到；之後重新連線同一個帳號，雲端的記錄會合併回來。' };
        replaceState(normalizeState(p), true);    // 不記刪除、不自動備份
        toast('已還原');
      };
      outText.append(h('div.notice', { style: { background: 'var(--warn-soft)' } },
        h('b', '這是 MetaPulse 的備份（' + cnt + '）。'),
        h('div', { style: { marginTop: '4px' } }, '這支手機已經有記錄' + (linked() ? '，也連著 Google Drive' : '') + '。直接取代會把現有記錄當成刪除' + (linked() ? '，同步後雲端和其他裝置上的也會被刪掉' : '') + '，所以請選：')),
        add, wipe, no,
        tip('只加入，不刪除：把備份裡的記錄合併進來，現有的記錄、個人資料和設定都保留。', h('br'), '先清除這支手機，再還原：這支手機只剩備份裡的資料，並中斷 Google Drive（雲端存檔不會動）。'));
      reveal(outText);
      return;
    }
    try { showSync(outText, parseSyncBackup(p), source); }   // 同步版備份 → 匯入預覽（不覆蓋）
    catch (e) { say(outText, e.message); }
  };
  const run = async (btn, text, source) => {
    const done = busy(btn, '讀取中…'); outText.textContent = '';
    await tick();
    try { handle(text, source); } catch (e) { say(outText, '發生錯誤：' + e.message); }
    done();
  };
  file.onchange = async () => {
    const f = file.files && file.files[0]; file.value = ''; if (!f) return;
    try { const t = await f.text(); ta.value = t; syncClr(); await run(use, t, '檔案「' + f.name + '」'); } catch (e) { say(outText, '讀取檔案失敗。'); }
  };
  const gen = h('button.ghost', { type: 'button', onclick: () => { ta.value = JSON.stringify(S); syncClr(); ta.select(); L.lastBackup = Date.now(); commitLocal(); draw(); say(outText, '已產生（' + S.entries.length + ' 筆身體記錄、' + S.meals.length + ' 筆餐點），請全選、複製後另外保存。', true); } }, '產生存檔文字');
  // 清除文字：只清框裡的字和下方訊息，不動任何記錄；框是空的就藏起來
  const clr = h('button.link.small', { type: 'button', style: { display: 'none' } }, '清除文字');
  const clrRow = h('div', { style: { textAlign: 'right', marginTop: '2px' } }, clr);
  const syncClr = () => { clr.style.display = ta.value ? '' : 'none'; };
  clr.onclick = () => { ta.value = ''; outText.textContent = ''; syncClr(); ta.focus(); };
  ta.addEventListener('input', syncClr);
  const use = h('button.ghost', { type: 'button' }, '匯入或還原');
  use.onclick = () => { if (ta.value.trim()) run(use, ta.value, '貼上的文字'); else { say(outText, '框裡是空的，請先貼上存檔文字。'); ta.focus(); } };

  function draw() {
    const em = driveEmail();
    sumEl.textContent = linked() ? (em || 'Google Drive 已連線') + (L.lastBackup ? '・' + ago(L.lastBackup) + '存檔' : '') : 'Google Drive 尚未連線';
    sumEl.style.color = linked() ? '' : 'var(--warn)';
    acct.textContent = linked() ? (em || '已連線（按「重新登入」後顯示帳號）') + '・' + driveStatus().replace(/（點這裡.*?）/, '') : '連線後，每次修改都自動存到雲端';
    main.textContent = linked() ? (ready() ? '立即同步' : '重新登入 Google Drive') : '連線 Google Drive';
    acctBtns.style.display = linked() ? '' : 'none';
  }
  onDrive(() => { if (sumEl.isConnected) draw(); });
  draw();

  const body = [
    sub('Google', true), acct, main, acctBtns, check, outCheck,
    fromDrive, outDrive,
    tip('Google Drive（雲端硬碟）：MetaPulse 的存檔放在一個看不到的專用資料夾，只有這個 app 能讀寫，別人（包括作者）都看不到。手機和雲端的存檔會合併在一起，同一筆記錄以最後修改的為準，不會整份互相蓋掉。', h('br'),
      '同步版：你之前用的「注射與體重記錄 同步版」app。「匯入同步版（Drive）」會把它存在 Google Drive 的記錄搬過來；只會讀取，不會改動同步版，可以重複按，不會重複加入。'),
    sub('其他：文字或檔案'),
    ta, clrRow, h('div.grid2', { style: { marginTop: '6px' } }, gen, use), outText,
    h('label', '或選擇存檔檔案'), file,
    tip('「產生存檔文字」會把全部記錄變成一段文字，可以複製貼到記事本或傳給自己保存。貼上或選擇檔案（.json 或 .txt）後，app 會自動判斷：MetaPulse 的存檔會「還原」（用它取代現在全部的資料，要再按一次確認）；同步版的存檔會「匯入」（只加入新的記錄，可以重複做）。'),
    aiFold(),
    h('a.small.one', { href: 'guide.html', style: { display: 'block', marginTop: '14px', color: 'var(--ac)', fontWeight: 600 } }, '搬家說明：把其他 app 的資料整合到 MetaPulse ›'),
  ];
  if (lastResult && Date.now() - lastResult.at < 15000) { say(outText, lastResult.text, true); lastResult = null; }
  return section('backup', '備份與匯入', sumEl, body, false);
}
