/* 單一食物的卡片：預設只醒目顯示名稱與點數；展開「檢視與微調營養素」可改份量與營養素 */
import { h, icon, toast, fold, val } from './common.js';
import { unitsFor, convertQty, describe, itemTotals, fmtQty, tidy, UNIT_LABEL, fistOk } from '../units.js';
import { PORTION } from '../config.js';
import { rememberFood } from './library.js';

const NUT = [['kcal', '熱量', '大卡'], ['protein', '蛋白質', 'g'], ['carb', '碳水', 'g'], ['fat', '脂肪', 'g'], ['fiber', '纖維', 'g']];
const r1 = x => Math.round(x * 10) / 10;

/**
 * @param item  可變的草稿物件
 * @param opts  {onChange, onRemove, foldKey, openEditor, libraryMode}
 */
export function itemCard(item, opts = {}) {
  const card = h('div.card.item-card');
  const nameIn = h('input.name.grow', { value: item.name, placeholder: '食物名稱', 'aria-label': '食物名稱' });
  nameIn.oninput = () => { item.name = nameIn.value; opts.onChange?.(); };
  const big = h('div.big.num');
  const sub = h('div.mu.small.num.one');
  const head = h('div.row', h('div.grow', { style: { minWidth: 0 } }, nameIn, sub), big);
  if (opts.onRemove) {
    // 刪除這一項：垃圾桶圖示，按兩次才刪（第一次變紅字提醒，3 秒內再按一次）
    const del = h('button.link', { type: 'button', 'aria-label': '刪除這一項', style: { color: 'var(--mu)', whiteSpace: 'nowrap' } }, icon('trash'));
    del.onclick = () => {
      if (del.dataset.c) { opts.onRemove(); return; }
      del.dataset.c = 1; del.textContent = '再按一次刪除'; del.style.color = 'var(--warn)';
      setTimeout(() => { if (!del.isConnected) return; del.dataset.c = ''; del.textContent = ''; del.append(icon('trash')); del.style.color = 'var(--mu)'; }, 3000);
    };
    head.append(del);
  }
  card.append(head);

  // 改了名稱：問要不要用新名稱重新估算（只改名字時，營養素不會跟著變）
  if (opts.onReanalyze) {
    const was = item.name || '';
    const ask = h('div.row.small', { style: { display: 'none', marginTop: '6px', gap: '8px', color: 'var(--ac)', fontWeight: 700 } });
    const btn = h('button.pri', { type: 'button', style: { whiteSpace: 'nowrap', minHeight: '36px', padding: '0 12px' } }, '用新名稱重新估算');
    ask.append(h('span.one', '✎ 名稱改了 →'), btn);
    btn.onclick = () => {
      const n = nameIn.value.trim(); if (!n) return;
      opts.onReanalyze('正確的食物是「' + n + '」' + (was && was !== n ? '（原本辨識成「' + was + '」）' : '') + '，請照這個名稱和份量重新估算營養', btn);
    };
    nameIn.addEventListener('input', () => { const n = nameIn.value.trim(); ask.style.display = n && n !== was ? '' : 'none'; });
    card.append(ask);
  }

  /* ---- 微調抽屜 ---- */
  const body = h('div');
  const unitBox = h('div');
  const conv = h('div.mu.small', { style: { marginTop: '6px' } });
  const qtyIn = h('input.num', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', 'aria-label': '數量' });
  const unitTag = h('span.mu', { style: { minWidth: '44px' } });
  const quick = h('div.quick');
  const slider = h('input', { type: 'range', min: PORTION.sliderMin, max: PORTION.sliderMax, step: PORTION.sliderStep, 'aria-label': '份量微調' });
  const sliderTxt = h('div.row.between.small', { style: { marginTop: '-2px' } });
  const sgIn = h('input.num', { type: 'number', inputmode: 'decimal', min: '0', step: 'any' });
  const fpIn = h('input.num', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', placeholder: '不適用' });
  const nutIn = {};
  const nutGrid = h('div.grid5');
  for (const [k, label, u] of NUT) {
    nutIn[k] = h('input.num', { type: 'number', inputmode: 'decimal', min: '0', step: 'any', 'aria-label': label });
    nutIn[k].oninput = () => { item.per[k] = Math.max(0, val(nutIn[k])); refresh(); };
    nutGrid.append(h('div', h('label', label, h('small', u)), nutIn[k]));
  }
  const totalsTxt = h('div.mu.small.num', { style: { marginTop: '8px' } });

  const drawUnits = () => {
    unitBox.textContent = '';
    const us = unitsFor(item);
    if (!us.includes(item.unit)) { item.qty = convertQty(item.qty, item.unit, 'serving', item); item.unit = 'serving'; }
    if (us.length > 1) {
      const seg = h('div.seg');
      for (const u of us) seg.append(h('button' + (u === item.unit ? '.on' : ''), {
        type: 'button', onclick: () => {
          if (u === item.unit) return;
          item.qty = convertQty(item.qty, item.unit, u, item); item.unit = u;
          drawUnits(); syncInputs(); refresh();
        },
      }, UNIT_LABEL[u] === 'g' ? '克' : UNIT_LABEL[u]));
      unitBox.append(seg);
    }
    quick.textContent = '';
    for (const n of PORTION.quick) {
      const q = item.unit === 'g' ? Math.round(n * item.servingGrams) : n;
      quick.append(h('button.ghost', { type: 'button', onclick: () => { setBase(q); } }, item.unit === 'g' ? q + 'g' : String(n)));
    }
  };
  const setBase = q => { item.qty = q; item.slider = 1; syncInputs(); refresh(); };
  const syncInputs = () => {
    qtyIn.value = tidy(item.qty, item.unit);
    unitTag.textContent = item.unit === 'g' ? 'g' : UNIT_LABEL[item.unit];
    slider.value = item.slider;
    sgIn.value = item.servingGrams || '';
    fpIn.value = fistOk(item) ? item.fistsPerServing : '';
    for (const [k] of NUT) nutIn[k].value = item.per[k] ? r1(item.per[k]) : '';
  };
  qtyIn.oninput = () => { item.qty = Math.max(0, val(qtyIn)); item.slider = 1; slider.value = 1; refresh(); };
  slider.oninput = () => { item.slider = +slider.value; refresh(); };
  sgIn.oninput = () => { item.servingGrams = Math.max(0, val(sgIn)); drawUnits(); refresh(); };
  fpIn.onchange = () => {
    const v = val(fpIn);
    if (!(v > 0) && item.unit === 'fist') { item.qty = convertQty(item.qty, 'fist', 'serving', item); item.unit = 'serving'; }
    item.fistsPerServing = v > 0 ? v : null;
    drawUnits(); syncInputs(); refresh();
  };

  if (opts.onReanalyze) {
    const fixIn = h('input', { type: 'text', placeholder: '辨識不對？寫下正確內容，例如「是雞胸肉，約 150 g」' });
    const fixBtn = h('button.ghost', { type: 'button', style: { whiteSpace: 'nowrap' } }, '重新辨識');
    fixBtn.onclick = () => { const t = fixIn.value.trim(); if (!t) { fixIn.focus(); return; } opts.onReanalyze(t, fixBtn); };
    fixIn.onkeydown = e => { if (e.key === 'Enter') fixBtn.click(); };
    body.append(h('div.row', { style: { marginTop: '10px' } }, h('div.grow', fixIn), fixBtn));
  }
  body.append(
    h('label', '份量'), unitBox, conv,
    h('div.row', { style: { marginTop: '10px' } }, qtyIn, unitTag), quick,
    h('label', '微調（' + PORTION.sliderMin + 'x～' + PORTION.sliderMax + 'x）'), slider, sliderTxt,
    h('div.grid2', h('div', h('label', '一份約幾克'), sgIn), h('div', h('label', '一份約幾個拳頭'), fpIn)),
    h('div.mu.tiny', { style: { marginTop: '4px' } }, '一顆蛋、一杯飲料、一片吐司這類不適合用拳頭估的，拳頭留空即可。'),
    h('label', { style: { marginTop: '14px' } }, '一份的營養素'), nutGrid, totalsTxt,
  );
  if (!opts.libraryMode) {
    body.append(h('button.ghost.full', {
      type: 'button', onclick: () => {
        const f = rememberFood(item);
        item.foodId = f.id;
        toast('已記住「' + f.name + '」，之後可從常用食物加入');
      },
    }, icon('star'), ' 記住這個食物'));
  }
  card.append(opts.foldKey ? fold(opts.foldKey, h('span.small.mu', '檢視與微調營養素'), body, { open: !!opts.openEditor }) : body);
  if (opts.foldKey) card.lastChild.style.marginTop = '10px';

  function refresh() {
    const t = itemTotals(item);
    big.textContent = t.points + ' 點';
    sub.textContent = fmtQty(t.finalQty, item.unit) + '・' + Math.round(t.kcal) + ' 大卡・蛋白質 ' + r1(t.protein) + ' g';   // 一行；幾份移到「份量」那裡
    conv.textContent = describe(item) + (item.unit !== 'serving' ? '・共 ' + r1(t.servings) + ' 份' : '');
    sliderTxt.textContent = '';
    sliderTxt.append(h('span.mu', '× ' + (+item.slider).toFixed(2)), h('b.num', '最終 ' + fmtQty(t.finalQty, item.unit) + ' · ' + t.points + ' 點'));
    totalsTxt.textContent = '本項合計：' + Math.round(t.kcal) + ' 大卡 · 蛋白質 ' + r1(t.protein) + ' g · 碳水 ' + r1(t.carb) + ' g · 脂肪 ' + r1(t.fat) + ' g · 纖維 ' + r1(t.fiber) + ' g';
    opts.onChange?.();
  }
  drawUnits(); syncInputs(); refresh();
  return card;
}

/** 新的空白品項 */
export function blankItem(extra = {}) {
  return Object.assign({
    name: '', per: { kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0 },
    servingGrams: 100, fistsPerServing: null, unit: 'serving', qty: 1, slider: 1, source: 'manual', foodId: '',
  }, extra);
}
