/* 一餐回饋：加入或修改一餐後在背景產生，存在該餐第一個品項的 advice 欄位 */
import { S, L, commit, commitLocal, plan } from '../state.js';
import { h, fold, hm } from './common.js';
import { usage, localDate } from '../points.js';
import { adviceContext, fallbackAdvice } from '../advice.js';
import { mealAdvice } from '../gemini.js';

export const pending = new Set();
let redraw = () => {};
export const onAdviceState = fn => { redraw = fn; };

export async function requestAdvice(group) {
  if (L.mealAdvice === false) return;
  const meals = S.meals.filter(m => m.group === group);
  if (!meals.length) return;
  const at = new Date(meals[0].at);
  const ctx = adviceContext(meals, plan(), usage(S.meals.filter(m => m.at <= meals[0].at), localDate(at)), at);
  let adv;
  if (L.geminiKey) {
    pending.add(group); redraw();
    try {
      const r = await mealAdvice({ key: L.geminiKey, model: L.geminiModel, api: L.geminiApi, prefer: L.geminiApiOk, fast: L.geminiFast !== false }, ctx);
      if (L.geminiApiOk !== r.api) { L.geminiApiOk = r.api; commitLocal(); }
      adv = { review: r.review, next: r.next, cheer: r.cheer, local: false };
    } catch (e) { adv = fallbackAdvice(ctx); }
    pending.delete(group);
  } else adv = fallbackAdvice(ctx);
  const first = S.meals.find(m => m.group === group);
  if (!first) { redraw(); return; } // 等待期間被刪掉了
  first.advice = adv;
  commit();
}

/** 今日頁：最新一餐的回饋卡（今天沒有就不顯示） */
export function latestAdviceCard(bare = false) {
  if (L.mealAdvice === false) return null;
  const today = localDate(new Date());
  const last = S.meals.filter(m => localDate(m.at) === today).sort((a, b) => a.at < b.at ? 1 : -1)[0];
  if (!last) return null;
  const g = last.group || last.id;
  const first = S.meals.find(m => (m.group || m.id) === g);
  const names = S.meals.filter(m => (m.group || m.id) === g).map(m => m.name).join('、');
  const card = bare ? h('div', { style: { marginTop: '10px', borderTop: '1px solid var(--ln)', paddingTop: '6px' } }) : h('div.card');
  if (pending.has(g)) {
    card.append(h('div.row.small.mu', h('span.spin'), '正在想想這一餐和下一餐…'));
    return card;
  }
  const a = first && first.advice;
  if (!a) {
    card.append(h('div.row.between.small', h('span.mu', hm(last.at) + ' ' + names), h('button.link.small', { type: 'button', onclick: () => requestAdvice(g) }, '給我一點建議')));
    return card;
  }
  const body = [
    a.review ? h('p', { style: { margin: '10px 0 6px' } }, a.review) : null,
    a.next ? h('p', { style: { margin: '0 0 6px' } }, h('b', '下一餐　'), a.next) : null,
    h('div.row.between', { style: { marginTop: '6px' } },
      h('span.mu.tiny', a.local ? '簡易建議（沒有使用 AI）' : 'AI 建議，僅供參考'),
      h('button.link.small', { type: 'button', onclick: () => requestAdvice(g) }, '換一個說法')),
  ];
  // 新的回饋自動展開一次，之後平常只顯示一句鼓勵
  const sig = g + '|' + (a.cheer || '');
  const seen = L.adviceSeen !== sig;
  if (seen) { L.adviceSeen = sig; commitLocal(); }
  card.append(fold('advice', h('div.grow',
    h('div.mu.tiny', hm(last.at) + ' · ' + names),
    h(bare ? 'div.one' : 'div', { style: { color: 'var(--ac-tx)', fontWeight: 600, marginTop: '2px' } }, a.cheer || '這一餐記好了。')), body, { open: false, force: seen && !bare }));
  return card;
}
