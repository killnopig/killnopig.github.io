/* 常用食物庫：記住、搜尋清單、管理 */
import { S, commit, uid } from '../state.js';
import { h, icon, toast, openSheet, closeSheet } from './common.js';
import { searchFoods, findByName } from '../foods.js';
import { pointsOf, scale } from '../points.js';
import { describe } from '../units.js';

const copyPer = p => ({ kcal: +p.kcal || 0, protein: +p.protein || 0, carb: +p.carb || 0, fat: +p.fat || 0, fiber: +p.fiber || 0 });

/** 把目前的品項存進食物庫（同名或同 id 就更新） */
export function rememberFood(item) {
  const name = (item.name || '').trim() || '未命名';
  let f = (item.foodId && S.foodLibrary.find(x => x.id === item.foodId)) || findByName(S.foodLibrary, name);
  if (!f) { f = { id: uid('f'), uses: 0, lastUsed: 0 }; S.foodLibrary.push(f); }
  Object.assign(f, {
    name, per: copyPer(item.per), servingGrams: +item.servingGrams || 0,
    fistsPerServing: +item.fistsPerServing > 0 ? +item.fistsPerServing : null,
    lastUnit: item.unit, lastQty: item.qty,
  });
  commit();
  return f;
}

/** 從食物庫產生草稿品項，沿用上次的單位與數量 */
export function itemFromFood(f) {
  return {
    name: f.name, per: copyPer(f.per), servingGrams: f.servingGrams, fistsPerServing: f.fistsPerServing,
    unit: f.lastUnit || 'serving', qty: f.lastQty || 1, slider: 1, source: 'library', foodId: f.id,
  };
}

/** 加入餐點後更新使用次數與單位 */
export function markUsed(item) {
  const f = item.foodId && S.foodLibrary.find(x => x.id === item.foodId);
  if (!f) return;
  f.uses = (f.uses || 0) + 1; f.lastUsed = Date.now();
  f.lastUnit = item.unit; f.lastQty = item.qty;
}

const perLine = f => describe(f) + ' · ' + Math.round(f.per.kcal) + ' 大卡 · ' + pointsOf(scale(f.per, 1)) + ' 點／份';

/** 搜尋框 + 即時篩選清單；選了就呼叫 onPick(food) */
export function foodPicker(onPick, { limit = 30, manage = false } = {}) {
  const box = h('div');
  const q = h('input', { type: 'search', placeholder: '搜尋常用食物…', autocomplete: 'off', 'aria-label': '搜尋常用食物' });
  const list = h('div.list', { style: { marginTop: '6px' } });
  const draw = () => {
    list.textContent = '';
    const hits = searchFoods(S.foodLibrary, q.value);
    if (!S.foodLibrary.length) { list.append(h('div.empty', '還沒有常用食物。記一餐時點開「檢視與微調營養素」，按「記住這個食物」，下次就能直接從這裡加入。')); return; }
    if (!hits.length) { list.append(h('div.empty', '找不到「' + q.value + '」')); return; }
    for (const f of hits.slice(0, limit)) {
      const it = h('div.it', { onclick: () => onPick(f) },
        h('div.grow', h('div', f.name), h('div.mu.tiny', perLine(f))),
        manage ? icon('edit') : h('span.pts', { style: { color: 'var(--ac-tx)' } }, icon('plus')));
      list.append(it);
    }
    if (hits.length > limit) list.append(h('div.mu.tiny', { style: { textAlign: 'center', padding: '8px 0' } }, '還有 ' + (hits.length - limit) + ' 項，請輸入關鍵字縮小範圍'));
  };
  q.oninput = draw;
  box.append(q, list);
  draw();
  box.focusSearch = () => q.focus();
  box.redraw = draw;
  return box;
}

/** 設定頁：管理食物庫（編輯、刪除） */
export function libraryManager(itemCard) {
  const wrap = h('div');
  const picker = foodPicker(f => editFood(f), { limit: 50, manage: true });
  wrap.append(h('div.mu.small', '共 ' + S.foodLibrary.length + ' 項。點一下可編輯或刪除。'), picker);

  function editFood(f) {
    const draft = itemFromFood(f);
    openSheet(sh => {
      sh.append(h('div.sheet-h', h('b', '編輯常用食物'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')));
      sh.append(itemCard(draft, { libraryMode: true }));
      const del = h('button.danger.full', { type: 'button' }, icon('trash'), ' 從食物庫刪除');
      del.onclick = () => {
        if (!del.dataset.c) { del.dataset.c = 1; del.textContent = '再按一次確認刪除'; setTimeout(() => { del.dataset.c = ''; del.textContent = '從食物庫刪除'; }, 3000); return; }
        S.foodLibrary = S.foodLibrary.filter(x => x.id !== f.id); commit(); closeSheet(); toast('已刪除「' + f.name + '」');
      };
      sh.append(
        h('button.pri.full', { type: 'button', onclick: () => { draft.foodId = f.id; rememberFood(draft); closeSheet(); toast('已更新「' + draft.name + '」'); } }, '儲存'),
        del,
        h('div.mu.tiny', { style: { marginTop: '8px' } }, '修改食物庫不會改動已記錄的餐點。'),
      );
    }, () => picker.redraw());
  }
  return wrap;
}
