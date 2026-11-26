/* 推薦這週吃什麼：底部面板。只看不記錄；上一次的結果存在這支手機（L.recipe），按「重新推薦」才再問 AI */
import { S, L, plan, commitLocal } from '../state.js';
import { h, fold, startClosed, tip, fmtPts, openSheet, closeSheet, sheetBack, toast, WD } from './common.js';
import { localDate } from '../points.js';
import { RECIPE_OPTS, recipeContext, fallbackPlan, cleanPlan, cleanDetail, priceSearchUrl } from '../recipe.js';
import { recipePlan, dishDetail } from '../gemini.js';

const hasAI = () => !!(L.geminiKey && L.geminiModel);
const getOpts = () => Array.isArray(L.recipeOpts) ? L.recipeOpts : ['often', 'protein'];

function dayLabel(dateStr, i) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  return (i === 0 ? '今天' : i === 1 ? '明天' : m + '/' + d) + '（' + wd + '）';
}

function mealRow(m, onOpen) {
  const ai = hasAI();
  return h('div', { style: { padding: '6px 0', borderTop: '1px solid var(--ln)', cursor: ai ? 'pointer' : '' }, onclick: ai ? () => onOpen(m) : null },
    h('div.row.between', { style: { gap: '8px' } },
      h('span.one', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 } }, m.name),
      h('span.num', { style: { flex: '0 0 auto' } }, h('b', fmtPts(m.points)), h('span.mu.tiny', ' 點'), ai ? h('span.mu', ' ›') : null)),
    h('div.mu.tiny.num.one', (m.tag ? m.tag + '・' : '') + '蛋白約 ' + m.protein + ' g'),
    !ai && m.how ? tip(m.how) : null);
}

const opt = () => ({ key: L.geminiKey, model: L.geminiModel, api: L.geminiApi, prefer: L.geminiApiOk });

/** 一道菜的說明（第一次請 AI 寫，之後從 L.recipe.details 拿） */
function detailView(m, back) {
  const box = h('div');
  const body = h('div', { style: { marginTop: '8px' } });
  const draw = d => {
    body.textContent = '';
    if (d.ingredients) body.append(h('b.small', '材料'), h('div.small', { style: { margin: '2px 0 10px' } }, d.ingredients));
    if (d.steps.length) body.append(h('b.small', m.tag === '自己煮' || d.ingredients ? '做法' : '怎麼點、怎麼搭'),
      h('ol.small', { style: { margin: '2px 0 10px', paddingLeft: '20px' } }, ...d.steps.map(t => h('li', t))));
    if (d.where.length) body.append(h('b.small', '哪裡買得到'), h('div.small', { style: { margin: '2px 0 10px' } }, d.where.join('、')));
  };
  box.append(
    h('div.sheet-h', h('button.link', { type: 'button', onclick: back }, '‹ 返回'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')),
    h('h2', { style: { margin: '4px 0 2px' } }, m.name),
    h('div.mu.small.num.one', (m.tag ? m.tag + '・' : '') + '約 ' + fmtPts(m.points) + ' 點・蛋白約 ' + m.protein + ' g'),
    body,
    h('button.ghost.full', { type: 'button', onclick: () => window.open(priceSearchUrl(m.name), '_blank', 'noopener') }, '🔍 上網查價格'),
    h('div.mu.tiny', { style: { marginTop: '6px' } }, 'AI 寫的說明和點數都是估算，只是參考'),
    h('button.ghost.full', { type: 'button', onclick: back }, '‹ 返回清單'));
  const r = L.recipe, cache = r && (r.details || (r.details = {}));
  if (cache && cache[m.name]) draw(cache[m.name]);
  else {
    body.append(h('div.mu.small', 'AI 寫說明中…（約 5～15 秒）'));
    dishDetail(opt(), m).then(x => {
      if (L.geminiApiOk !== x.api) L.geminiApiOk = x.api;
      const d = cleanDetail(x.parsed);
      if (cache) { cache[m.name] = d; commitLocal(); }
      draw(d);
    }).catch(e => { body.textContent = ''; body.append(h('div.small', { style: { color: 'var(--warn)' } }, e.message || String(e))); });
  }
  return box;
}

function planView(r, onOpen) {
  const box = h('div');
  r.days.forEach((d, i) => {
    const key = 'recipe-d' + i;
    if (i) startClosed(key);
    const pts = d.meals.reduce((a, m) => a + m.points, 0), pro = d.meals.reduce((a, m) => a + m.protein, 0);
    box.append(fold(key, h('div.row.between.grow', h('b.small', dayLabel(d.date, i)), h('span.mu.small.num.one', '約 ' + fmtPts(pts) + ' 點・蛋白 ' + pro + ' g')),
      h('div', ...d.meals.map(m => mealRow(m, onOpen))), { force: i === 0 }));
  });
  return box;
}

export function openRecipe() {
  openSheet(sh => {
    const b = plan();
    let opts = getOpts().filter(k => hasAI() || k !== 'new');
    let busy = false;
    const chips = h('div.pills', { style: { flexWrap: 'wrap' } });
    const out = h('div', { style: { marginTop: '10px' } });
    const go = h('button.pri.full', { type: 'button', style: { marginTop: '10px' } });

    const drawChips = () => {
      chips.textContent = '';
      for (const [k, label] of RECIPE_OPTS) {
        const off = k === 'new' && !hasAI();
        chips.append(h('button' + (opts.includes(k) ? '.on' : ''), {
          type: 'button', disabled: off, style: off ? { opacity: 0.4 } : null,
          onclick: () => { opts = opts.includes(k) ? opts.filter(x => x !== k) : [...opts, k]; L.recipeOpts = opts; commitLocal(); drawChips(); },
        }, label));
      }
    };
    const drawOut = () => {
      out.textContent = '';
      const r = L.recipe;
      go.textContent = r ? '重新推薦' : '產生 7 天推薦';
      if (!r || !r.days?.length) return;
      if (r.days[0].date !== localDate(new Date())) out.append(h('div.mu.tiny.one', { style: { marginBottom: '4px' } }, '這是 ' + r.days[0].date.slice(5).replace('-', '/') + ' 排的，可以按「重新推薦」'));
      out.append(planView(r, showDetail));
      if (r.note) out.append(h('div.mu.small', { style: { marginTop: '8px' } }, r.note));
      out.append(h('div.mu.tiny', { style: { marginTop: '8px' } }, (r.local ? '沒有 AI，從你常吃的組合排的・' : '') + '點數、蛋白質都是估算，只是參考'));
    };

    go.onclick = async () => {
      if (busy) return;
      const today = localDate(new Date());
      if (!hasAI()) {
        const p = fallbackPlan(S, b, today);
        if (!p) { toast('還沒有常吃的組合，記幾餐後再試；或到設定輸入 AI 金鑰'); return; }
        L.recipe = p; commitLocal(); drawOut(); return;
      }
      if (!opts.length) { toast('至少勾一個選項'); return; }
      busy = true; go.disabled = true; go.textContent = 'AI 排菜中…（約 10～30 秒）';
      try {
        const x = await recipePlan(opt(), recipeContext(S, b, opts, today));
        if (L.geminiApiOk !== x.api) L.geminiApiOk = x.api;
        const p = cleanPlan(x.parsed, today);
        if (!p.days.length) throw new Error('AI 沒有排出內容，請再試一次');
        L.recipe = p; commitLocal();
      } catch (e) { toast(e.message || String(e), true); }
      busy = false; go.disabled = false; drawOut();
    };

    const main = h('div'), sub = h('div');
    const backToList = () => { sheetBack.fn = null; sub.textContent = ''; main.style.display = ''; sh.scrollTop = keepY; };
    let keepY = 0;
    function showDetail(m) {
      keepY = sh.scrollTop; main.style.display = 'none';
      sub.textContent = ''; sub.append(detailView(m, backToList)); sh.scrollTop = 0;
      sheetBack.fn = backToList;
    }
    drawChips(); drawOut();
    sh.append(main, sub);
    main.append(h('div.sheet-h', h('b', '推薦這週吃什麼'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')),
      b.ok ? h('div.mu.small.num.one', '每天約 ' + fmtPts(b.dailyPoints) + ' 點・蛋白質目標 ' + Math.round(b.proteinTarget) + ' g') : null,
      tip('依你最近吃過的東西、每天的點數和蛋白質目標排 7 天的建議，只是參考，照自己的胃口調整就好。勾「沒吃過的」時，只會把食物名稱給 AI，請它避開。點一道菜可以看材料、做法和哪裡買得到。'),
      h('div', { style: { marginTop: '8px' } }, chips), go, out,
      h('button.ghost.full', { type: 'button', onclick: () => closeSheet() }, '關閉'));
  });
}

/** 今天頁「今天剩餘」卡裡的入口 */
export const recipeButton = () => h('button.ghost.full', { type: 'button', style: { marginTop: '8px' }, onclick: () => openRecipe() }, '🍽 推薦這週吃什麼 ›');
