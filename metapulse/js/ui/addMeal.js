/* 新增／編輯一餐：拍照、文字、常用食物、完全手動，共用同一個草稿清單 */
import { S, L, commit, commitLocal, uid } from '../state.js';
import { h, icon, toast, tip, openSheet, closeSheet, toLocalInput, fmtPts } from './common.js';
import { itemCard, blankItem } from './mealEditor.js';
import { foodPicker, itemFromFood, markUsed } from './library.js';
import { itemTotals } from '../units.js';
import { analyzeMeal, shrinkImage } from '../gemini.js';
import { requestAdvice } from './advice.js';
import { frequentMeals } from '../foods.js';
import { closeFastsForMeal, reopenFastsForMeal, mealEndsFast } from '../fasting.js';
import { fastInfo } from './fasting.js';

const r1 = x => Math.round(x * 10) / 10;

/**
 * @param {{mode?:'photo'|'text'|'library', group?:string}} o  group 有值時為編輯既有一餐
 */
export function openAddMeal(o = {}) {
  const editing = o.group ? S.meals.filter(m => m.group === o.group) : null;
  const items = editing ? editing.map(m => ({
    name: m.name, per: { ...m.per }, servingGrams: m.servingGrams, fistsPerServing: m.fistsPerServing,
    unit: m.unit, qty: m.qty, slider: m.slider, source: m.source, foodId: m.foodId, aiRaw: m.aiRaw, _id: m.id, thumb: m.thumb,
  })) : [];
  let when = editing ? new Date(editing[0].at) : new Date();
  let whenSet = !!editing; // 沒改過時間：按「加入」的那一刻就是用餐時間
  let mode = o.mode || L.lastAddMode || 'photo';
  let thumb = editing ? (editing.find(m => m.thumb) || {}).thumb : undefined;
  let busy = null; // AbortController
  let lastImage = null; // 本次拍的照片（只在面板開著時留在記憶體，供重新辨識）
  let thumbFromPhoto = false; // thumb 是這次拍的照片做的（按 ✕ 時一起拿掉）
  let hintText = ''; // 照片的補充說明（重畫拍照區時保留）

  openSheet(sh => {
    sh.append(h('div.sheet-h', h('b', editing ? '編輯這一餐' : '記一餐'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')));
    // 斷食中：提醒存了這一餐就會結束斷食（拍照、辨識不會，按儲存才會）
    if (!editing && fastInfo().fasting) sh.append(h('div.notice', { style: { margin: '0 0 12px' } },
      h('div.small.one', { style: { fontWeight: 600 } }, '斷食中：存了這一餐，斷食就會結束'),
      tip('拍照和辨識都不會影響斷食，按下儲存才會。只是想試試看的話，存了之後再刪掉這一餐，斷食會接回來。')));

    const inputArea = h('div');
    const tabs = h('div.seg');
    const TABS = [['photo', 'camera', '拍照'], ['text', 'text', '文字'], ['library', 'star', '常用']];
    const drawTabs = () => {
      tabs.textContent = '';
      for (const [k, ic, t] of TABS) tabs.append(h('button' + (k === mode ? '.on' : ''), { type: 'button', onclick: () => { mode = k; L.lastAddMode = k; commitLocal(); drawTabs(); drawInput(); } }, icon(ic), t));
    };
    const status = h('div.small', { style: { marginTop: '8px' } });
    const itemsBox = h('div', { style: { marginTop: '12px' } });
    const whenIn = h('input', { type: 'datetime-local', value: toLocalInput(when), 'aria-label': '用餐時間' });
    whenIn.onchange = () => { const d = new Date(whenIn.value); if (!isNaN(d)) { when = d; whenSet = true; drawWhen(); } };
    // 用餐時間：一行下拉選單；預設「現在」＝按加入的那一刻
    const whenSel = h('select', { 'aria-label': '用餐時間', style: { flex: 1, minWidth: 0, padding: '8px 10px' } });
    const whenBox = h('div', { style: { display: 'none', marginTop: '8px' } }, whenIn);
    const OPTS = [['0', '現在（按加入的時間）'], ['30', '30 分鐘前'], ['60', '1 小時前'], ['120', '2 小時前'], ['custom', '自訂…']];
    function drawWhen() {
      whenSel.textContent = '';
      for (const [v, t] of OPTS) whenSel.append(h('option', { value: v }, t));
      if (whenSet) { whenSel.insertBefore(h('option', { value: 'set' }, toLocalInput(when).replace('T', ' ').slice(5)), whenSel.firstChild); whenSel.value = 'set'; }
      else whenSel.value = '0';
    }
    whenSel.onchange = () => {
      const v = whenSel.value;
      if (v === 'custom') { whenBox.style.display = ''; whenIn.value = toLocalInput(whenSet ? when : new Date()); return; }
      if (v === 'set') return;
      whenBox.style.display = 'none';
      when = new Date(Date.now() - +v * 60000); whenSet = +v > 0; whenIn.value = toLocalInput(when); drawWhen();
    };
    const whenRow = h('div', { style: { margin: '-4px 0 12px' } },
      h('div.row', h('span.small.mu', { style: { whiteSpace: 'nowrap' } }, '用餐時間'), whenSel), whenBox);
    drawWhen();
    const saveBtn = h('button.pri.full', { type: 'button' });
    const totalTxt = h('div.mu.small.num', { style: { textAlign: 'center', marginTop: '6px' } });

    // 拍照區的元件（drawInput 建立）：辨識中把進度蓋在照片上，並鎖住拍照鈕
    let photoUI = null;
    const setBusy = (text) => {
      status.textContent = '';
      const ov = mode === 'photo' && photoUI && photoUI.overlay;
      if (photoUI) for (const b of photoUI.lock) b.disabled = !!text;
      if (ov) {
        ov.textContent = '';
        ov.hidden = !text;
        if (text) ov.append(h('span.spin'), h('span', text), h('button.link', { type: 'button', onclick: () => busy?.abort() }, '取消'));
        return;
      }
      if (text) status.append(h('span.spin'), ' ', text, ' ', h('button.link', { type: 'button', onclick: () => busy?.abort() }, '取消'));
    };
    const showErr = (e) => {
      setBusy('');
      const msg = e.name === 'AbortError' ? '已取消。' : '辨識失敗：' + (e.message || e);
      status.append(h('div.notice', msg, e.name === 'AbortError' ? '' : h('div.tiny.mu', { style: { marginTop: '4px' } }, '可以改用文字描述、常用食物，或下方「自己輸入一項」。')));
      status.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    async function runAI({ replace, ...args }) {   // replace：成功後取代這次照片（_photo）辨識出的品項；手動、常用加的都留著
      if (!L.geminiKey) { status.textContent = ''; status.append(h('div.notice', '還沒設定 AI 的 API 金鑰。請到「設定」→「AI 辨識食物」輸入。', h('a', { href: 'apikey.html', style: { marginLeft: '6px', color: 'var(--ac)', fontWeight: 600 } }, '怎麼申請 ›'))); return; }
      busy?.abort(); busy = new AbortController();
      const t0 = Date.now(), label = args.image ? '辨識照片中…' : '估算中…';
      setBusy(label);
      const me = busy, tick = setInterval(() => { if (busy !== me) return clearInterval(tick); setBusy(label + ' ' + Math.floor((Date.now() - t0) / 1000) + ' 秒'); }, 1000);
      try {
        const res = await analyzeMeal({ key: L.geminiKey, model: L.geminiModel, api: L.geminiApi, prefer: L.geminiApiOk, fast: L.geminiFast !== false, signal: busy.signal, ...args });
        busy = null; setBusy('');
        if (L.geminiApiOk !== res.api) { L.geminiApiOk = res.api; commitLocal(); }
        status.append(h('div.mu.tiny', '辨識花了 ' + (res.ms / 1000).toFixed(1) + ' 秒'));
        if (!res.items.length) { status.append(h('div.notice', '沒有辨識到食物。' + (res.note || ''))); status.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        if (replace) for (let j = items.length - 1; j >= 0; j--) if (items[j]._photo) items.splice(j, 1);   // 先拿掉上一張照片辨識的
        const first = items.length;
        for (const x of res.items) items.push({
          name: x.name, per: x.per, servingGrams: x.servingGrams || 100, fistsPerServing: x.fistsPerServing,
          unit: 'serving', qty: x.servings, slider: 1, source: args.image ? 'ai-photo' : 'ai-text', foodId: '', aiRaw: res.raw,
          ...(args.image ? { _photo: true } : {}),
        });
        if (res.note) status.append(h('div.mu.tiny', 'AI 備註：' + res.note));
        drawItems();
        // 辨識好了：捲到結果，不用自己往下找
        (itemsBox.children[first + (thumb ? 1 : 0)] || itemsBox).scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        if (busy !== me) return;   // 已被新的辨識取代、或按了 ✕：不要蓋掉新的狀態
        busy = null; showErr(e);
      }
    }

    function drawInput() {
      inputArea.textContent = '';
      photoUI = null;
      if (mode === 'photo') {
        const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
        const pick = h('input', { type: 'file', accept: 'image/*', hidden: true });
        const hint = h('input', { type: 'text', placeholder: '補充說明，例如只吃一半', value: hintText, style: { flex: 1, minWidth: 0 } });
        hint.oninput = () => { hintText = hint.value; };
        const onFile = async ev => {
          const f = ev.target.files && ev.target.files[0]; ev.target.value = '';
          if (!f) return;
          try {
            const img = await shrinkImage(f, L.geminiFast !== false ? 512 : 768);   // 速度優先：照片小一點，上傳比較快
            lastImage = img;
            // 從相簿選的照片：用餐時間改成照片的時間（48 小時內、且不是剛拍的）
            const lm = +f.lastModified || 0, age = Date.now() - lm;
            if (!editing && lm && age > 120000 && age < 48 * 3600000) {
              when = new Date(lm); whenIn.value = toLocalInput(when); whenSet = true; drawWhen();
              toast('用餐時間已改成照片的時間 ' + toLocalInput(when).slice(11));
            }
            if (L.keepThumbs) { try { thumb = (await shrinkImage(f, 200, 0.7, true)).dataUrl; thumbFromPhoto = true; } catch (e) { /* 縮圖失敗不影響 */ } }
            drawInput();
            photoUI.box.scrollIntoView({ behavior: 'smooth', block: 'center' });
            runAI({ image: img, text: hintText.trim(), replace: true });   // 重拍：取代上一張照片辨識出的品項
          } catch (e) { showErr(e); }
        };
        cam.onchange = onFile; pick.onchange = onFile;
        const camBtn = h('button.pri', { type: 'button', onclick: () => cam.click() }, icon('camera'), lastImage ? ' 重拍' : ' 拍照');
        const pickBtn = h('button.ghost', { type: 'button', onclick: () => pick.click() }, icon('image'), lastImage ? ' 換照片' : ' 選照片');
        const lock = [camBtn, pickBtn];
        let box = null, overlay = null;
        if (lastImage) {
          overlay = h('div.photo-ov', { hidden: true, 'aria-live': 'polite' });
          // ✕：不要這張照片，連同它辨識出的品項一起拿掉
          const drop = h('button.photo-x', { type: 'button', 'aria-label': '不要這張照片', onclick: () => {
            busy?.abort(); busy = null;
            lastImage = null;
            for (let j = items.length - 1; j >= 0; j--) if (items[j]._photo) items.splice(j, 1);
            if (thumbFromPhoto) { thumb = undefined; thumbFromPhoto = false; }
            status.textContent = '';
            drawInput(); drawItems();
          } }, icon('x'));
          box = h('div.photobox', h('img.preview', { src: lastImage.dataUrl, alt: '餐點照片' }), overlay, drop);
          // 照片一直留著：辨識不對、補了說明、或食物被刪掉了，都可以從這張照片重來
          const again = h('button.ghost', { type: 'button', style: { flex: '0 0 auto' }, onclick: () => { if (lastImage) runAI({ image: lastImage, text: hintText.trim(), replace: true }); } }, '重新辨識');
          lock.push(again);
          hint.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); again.click(); } };
          inputArea.append(box, h('div.row', { style: { marginTop: '8px', gap: '8px' } }, hint, again));
        } else inputArea.append(h('div', { style: { marginTop: '12px' } }, hint));
        photoUI = { box, overlay, lock };
        inputArea.append(
          h('div.grid2', { style: { marginTop: '8px' } }, camBtn, pickBtn), cam, pick,
          h('div.mu.tiny.one', { style: { marginTop: '6px' } }, '照片只送到 Google Gemini 辨識，不存在 app 裡' + (L.keepThumbs ? '（只留小照片）' : '')));
        if (busy) setBusy('辨識照片中…');
      } else if (mode === 'text') {
        const ta = h('textarea', { rows: 2, placeholder: '例如：一碗牛肉麵加滷蛋、一杯無糖豆漿' });
        const go = h('button.pri.full', { type: 'button', onclick: () => { const t = ta.value.trim(); if (t) runAI({ text: t }); else ta.focus(); } }, '估算');
        inputArea.append(h('div', { style: { marginTop: '12px' } }, ta), go, h('div.mu.tiny', { style: { marginTop: '6px' } }, '只送出文字給 Google Gemini 估算。'));
        setTimeout(() => ta.focus(), 50);
      } else {
        const p = foodPicker(f => { items.push(itemFromFood(f)); drawItems(); toast('已加入「' + f.name + '」'); }, { limit: 12 });
        p.style.marginTop = '12px';
        inputArea.append(p);
      }
    }

    function drawItems() {
      itemsBox.textContent = '';
      if (thumb) itemsBox.append(h('div.row', { style: { marginBottom: '8px' } }, h('img.thumb', { src: thumb, alt: '' }),
        h('button.link.small', { type: 'button', onclick: () => { thumb = undefined; drawItems(); } }, '不保留照片')));
      items.forEach((it, i) => {
        itemsBox.append(itemCard(it, {
          foldKey: 'meal-editor', onChange: updateTotal,
          onRemove: () => { items.splice(i, 1); drawItems(); },
          onReanalyze: (text, btn) => reanalyze(i, text, btn),
          openEditor: it.source === 'manual' && !it.name,
        }));
      });
      updateTotal();
    }

    async function reanalyze(i, text, btn) {
      if (!L.geminiKey) { toast('還沒設定 AI 的 API 金鑰', true); return; }
      const it = items[i];
      const useImg = it.source === 'ai-photo' && lastImage;
      btn.disabled = true; btn.textContent = '辨識中…';
      try {
        const res = await analyzeMeal({ key: L.geminiKey, model: L.geminiModel, api: L.geminiApi, prefer: L.geminiApiOk, fast: L.geminiFast !== false,
          fix: { was: it.name || '未命名', text }, image: useImg ? lastImage : undefined });
        if (!res.items.length) { toast('沒有辨識到食物，請換個說法', true); btn.disabled = false; btn.textContent = '重新辨識'; return; }
        items.splice(i, 1, ...res.items.map(x => ({
          name: x.name, per: x.per, servingGrams: x.servingGrams || 100, fistsPerServing: x.fistsPerServing,
          unit: 'serving', qty: x.servings, slider: 1, source: useImg ? 'ai-photo' : 'ai-text', foodId: '', aiRaw: res.raw,
          ...(useImg ? { _photo: true } : {}),
        })));
        drawItems();
        toast('已重新辨識（' + (res.ms / 1000).toFixed(1) + ' 秒）');
      } catch (e) { btn.disabled = false; btn.textContent = '重新辨識'; toast('重新辨識失敗：' + (e.message || e), true); }
    }

    function updateTotal() {
      const ts = items.map(itemTotals);
      const pts = ts.reduce((a, t) => a + t.points, 0), 大卡 = ts.reduce((a, t) => a + t.kcal, 0), pro = ts.reduce((a, t) => a + t.protein, 0);
      saveBtn.dataset.c = ''; saveBtn.style.background = ''; saveBtn.style.color = '';   // 內容變了：取消「再按一次」
      saveBtn.disabled = !items.length;
      saveBtn.textContent = items.length ? (editing ? '儲存變更' : '加入這一餐') + '（' + fmtPts(pts) + ' 點）' : '先拍照、描述或選擇食物';
      totalTxt.textContent = items.length ? '本餐點數 ' + fmtPts(pts) + ' 點 · ' + Math.round(大卡) + ' 大卡 · 蛋白質 ' + r1(pro) + ' g' : '';
    }

    saveBtn.onclick = () => {
      if (!items.length) return;
      const at = (whenSet ? when : new Date()).toISOString();
      // 斷食中：存了會結束斷食，要按兩次才存（跟刪除一樣）
      if (!editing && !saveBtn.dataset.c && mealEndsFast(fastInfo(), new Date(at).getTime())) {
        const old = saveBtn.textContent;
        saveBtn.dataset.c = 1; saveBtn.textContent = '斷食會結束，再按一次儲存';
        saveBtn.style.background = 'var(--warn)'; saveBtn.style.color = 'var(--act)';
        setTimeout(() => { if (!saveBtn.dataset.c) return; saveBtn.dataset.c = ''; saveBtn.textContent = old; saveBtn.style.background = ''; saveBtn.style.color = ''; }, 3000);
        return;
      }
      const group = editing ? o.group : uid('g');
      if (editing) S.meals = S.meals.filter(m => m.group !== o.group);
      items.forEach((it, i) => {
        const t = itemTotals(it);
        if (!editing) markUsed(it);
        S.meals.push({
          id: it._id || uid('m'), group, at, name: (it.name || '').trim() || '未命名',
          unit: it.unit, qty: it.qty, slider: it.slider, servingGrams: it.servingGrams, fistsPerServing: it.fistsPerServing,
          per: { ...it.per }, kcal: t.kcal, protein: t.protein, carb: t.carb, fat: t.fat, fiber: t.fiber, points: t.points,
          source: it.source, foodId: it.foodId || '', ...(it.aiRaw ? { aiRaw: it.aiRaw } : {}), ...(i === 0 && thumb ? { thumb } : {}),
        });
      });
      S.meals.sort((a, b) => a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
      // 記了餐點，就結束進行中的手動斷食（記下是這一餐結束的，刪掉這一餐時會接回來）
      // 編輯：先接回被這一餐結束的斷食，再照新的時間重新判斷
      if (editing) reopenFastsForMeal(S.fasts, group);
      closeFastsForMeal(S.fasts, at, group);
      // 手動修改的斷食時間不清掉：它只對改的時候的那一餐有效，記了新的一餐自動失效，刪掉這一餐又會恢復
      const ok = commit();
      closeSheet();
      if (ok) requestAdvice(group);
      toast(ok ? (editing ? '已更新這一餐' : '已加入，' + fmtPts(items.reduce((a, it) => a + itemTotals(it).points, 0)) + ' 點') : '儲存失敗：手機空間不夠', !ok);
    };

    // 常吃：最常吃、最近吃的組合，點一下放進這一餐（不用 AI、不用網路）
    const freq = editing ? [] : frequentMeals(S.meals);
    const freqRow = freq.length ? h('div.pills', { style: { display: 'flex', gap: '6px', margin: '0 0 12px' } },
      h('span.small.mu', { style: { alignSelf: 'center', flex: '0 0 auto' } }, '常吃'),
      ...freq.map(f => h('button.ghost.small', { type: 'button', style: { maxWidth: '62vw' }, title: f.label, onclick: () => {
        for (const m of f.items) items.push({ name: m.name, per: { ...m.per }, servingGrams: m.servingGrams, fistsPerServing: m.fistsPerServing,
          unit: m.unit, qty: m.qty, slider: m.slider, source: m.source, foodId: m.foodId });
        drawItems(); toast('已放進這一餐，按「加入這一餐」就記好了');
        saveBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } }, f.label + '・' + fmtPts(f.points) + ' 點'))) : '';

    drawTabs();
    sh.append(whenRow, freqRow, tabs, inputArea, status, itemsBox,
      h('button.link.small', { type: 'button', onclick: () => { items.push(blankItem()); drawItems(); itemsBox.lastChild?.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, icon('plus'), ' 自己輸入一項'),
      h('div.foot', saveBtn, totalTxt));
    if (editing) {
      const del = h('button.danger.full', { type: 'button' }, icon('trash'), ' 刪除這一餐');
      del.onclick = () => {
        if (!del.dataset.c) { del.dataset.c = 1; del.textContent = '再按一次確認刪除'; setTimeout(() => { del.dataset.c = ''; del.textContent = '刪除這一餐'; }, 3000); return; }
        S.meals = S.meals.filter(m => m.group !== o.group);
        const back = reopenFastsForMeal(S.fasts, o.group);
        commit(); closeSheet(); toast(back ? '已刪除這一餐，斷食接回來了' : '已刪除這一餐');
      };
      sh.append(del);
      mode = 'library';
      drawTabs();
    }
    drawInput();
    drawItems();
  }, () => busy?.abort());
}
