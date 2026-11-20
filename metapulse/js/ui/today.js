/* 飲食分頁：固定三張卡，從上到下是 ① 現在（斷食中／進食中）② 今天（存摺、記一餐、今天的時間軸）③ 以前（近 7 天、每天的餐點與斷食）。
 * 該吃藥、該注射只有當下要做時才排在最上面。 */
import { S, L, plan, commitLocal } from '../state.js';
import { backupReminder } from '../sync.js';
import { connect, linked } from '../drive.js';
import { h, icon, hm, fmtPts, fold, startClosed, tip } from './common.js';
import { localDate } from '../points.js';
import { ledger, allActivity } from '../ledger.js';
import { exerciseCard, openExercise } from './exercise.js';
import { nextDose } from '../records.js';
import { medCard } from './meds.js';
import { weeklyCard } from './weekly.js';
import { openAddMeal } from './addMeal.js';
import { latestAdviceCard } from './advice.js';
import { fastingCard, longTermCard, fastInfo, openGuessSheet, openJournal } from './fasting.js';
import { guessFasts } from '../fasting.js';
import { lowProteinMeal } from '../safety.js';

const r1 = x => Math.round(x * 10) / 10;

function ring(frac, over) {
  const R = 50, C = 2 * Math.PI * R, f = Math.max(0, Math.min(1, frac));
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 118 118');
  const mk = (stroke, dash) => {
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', 59); c.setAttribute('cy', 59); c.setAttribute('r', R); c.setAttribute('fill', 'none');
    c.setAttribute('stroke', stroke); c.setAttribute('stroke-width', 10); c.setAttribute('stroke-linecap', 'round');
    if (dash != null) c.setAttribute('stroke-dasharray', dash + ' ' + C);
    return c;
  };
  s.append(mk('var(--soft)'));
  if (f > 0) s.append(mk(over ? 'var(--warn)' : 'var(--ac)', f * C));
  return s;
}

function metric(label, cur, target, unit, note, warn) {
  const pct = target > 0 ? Math.min(100, cur / target * 100) : 0;
  return h('div.metric',
    h('div.row.between', h('span', label), h('span.num', h('b', unit === '點' ? fmtPts(cur) : Math.round(cur)), h('span.mu', ' / ' + (unit === '點' ? fmtPts(target) : Math.round(target)) + ' ' + unit))),
    h('div.bar' + (warn ? '.warn' : ''), h('i', { style: { width: pct + '%' } })),
    note ? h('div.mu.tiny', note) : null);
}

/** 依 group 合併成「一餐」 */
function groupMeals(meals) {
  const g = new Map();
  for (const m of meals) {
    const k = m.group || m.id;
    if (!g.has(k)) g.set(k, { group: k, at: m.at, items: [], points: 0, kcal: 0, protein: 0, thumb: null });
    const x = g.get(k); x.items.push(m); x.points += m.points; x.kcal += m.kcal; x.protein += m.protein; if (m.thumb) x.thumb = m.thumb; if (m.pending) x.pending = true;
  }
  return [...g.values()].sort((a, b) => a.at < b.at ? 1 : -1);
}

function mealRow(m) {
  return h('div.it', { onclick: () => openAddMeal({ group: m.group }) },
    m.thumb ? h('img.thumb', { src: m.thumb, alt: '' }) : null,
    h('div.grow',
      h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.items.map(i => i.name).join('、')),
      h('div.mu.tiny.num.one', (m.pending ? '預計 ' + hm(m.at) + ' 吃' : hm(m.at)) + '・' + Math.round(m.kcal) + ' 大卡・',
        // 一餐蛋白質少於 20 g 標橘色（用藥期間食量小，每餐吃夠比較能保住肌肉）
        h('span', !m.pending && lowProteinMeal(m.protein) ? { style: { color: 'var(--warn)', fontWeight: 650 } } : null, '蛋白 ' + Math.round(m.protein) + 'g'))),
    h('span.pts.num', fmtPts(m.points), h('span.mu.tiny', ' 點')));
}

let showAllMeals = false;
export function renderToday(root) {
  root.textContent = '';
  const todayStr = localDate(new Date());
  const b = plan();

  /* ---- 太久沒備份的提醒 ---- */
  const br = backupReminder(S, L, Date.now(), todayStr);
  if (br.show) {
    const goSet = () => document.querySelector('nav.tabs button[data-t="set"]').click();
    root.append(h('div.card', { style: { borderColor: 'var(--warn)' } },
      h('div', { style: { fontWeight: 600 } }, br.never ? '還沒有備份過，記錄目前只存在這支手機裡。' : '已經 ' + br.days + ' 天沒有備份，這段時間有新的記錄。'),
      h('div.mu.tiny', { style: { marginTop: '4px' } }, '換手機或清除瀏覽資料時，沒有備份的記錄會不見。'),
      h('div.grid2', { style: { marginTop: '10px' } },
        h('button.pri', { type: 'button', onclick: () => connect(true) }, linked() ? '重新登入 Google Drive' : '連線 Google Drive'),
        h('button.ghost', { type: 'button', onclick: () => { L.bkHide = todayStr; commitLocal(); renderToday(root); } }, '今天不再提醒')),
      h('button.link.small', { type: 'button', onclick: goSet, style: { marginTop: '6px' } }, '或到「設定」→「備份與匯入」產生存檔文字')));
  }

  /* ---- 要馬上做的事：該吃藥、該注射（平常不佔位置） ---- */
  const mc = medCard();
  const nd = nextDose(S.entries, todayStr);
  if (mc && mc.urgent) root.append(mc.card);
  if (nd && nd.left <= 0) root.append(h('div.card', { style: { borderColor: 'var(--c1)', borderWidth: '2px', cursor: 'pointer' }, onclick: () => document.querySelector('nav.tabs button[data-t="log"]').click() },
    h('div.row.between', h('b.one', nd.left === 0 ? '今天要注射・' + nd.site : '注射已逾期 ' + (-nd.left) + ' 天・' + nd.site), h('span', { style: { color: 'var(--c1)', fontWeight: 650, flex: '0 0 auto' } }, '去記錄 ›'))));

  /* ---- ① 現在：斷食中／進食中 ---- */
  const fi = fastInfo();
  root.append(fastingCard());
  const lt = longTermCard();
  if (lt) root.append(lt);

  /* ---- ② 今天：存摺、今日剩餘、記一餐／記運動、今天的時間軸 ---- */
  const groups = groupMeals(S.meals);
  const top = h('div.card.tight');
  if (!b.ok) {
    top.append(h('h2', '先填寫個人資料'),
      h('div.mu.small.one', '需要身高、體重、出生年，才能算出每天可以吃多少'),
      h('button.ghost.full', { type: 'button', onclick: () => document.querySelector('nav.tabs button[data-t="set"]').click() }, '前往設定'));
  } else {
    const mode = S.prefs.weekStart || 'roll';
    const lg = ledger(S.meals, allActivity(S), b.dailyPoints, todayStr, mode, null, S.fasts);
    const td = lg.today, bal = lg.balance, total = lg.total;
    const label = mode === 'roll' ? '7 天存摺' : '本週存摺';
    const over = td.left < 0;
    if (fi.fasting) {
      // 斷食中：存摺縮成兩行，畫面留給斷食
      top.append(h('div.small.num.one', { style: { fontWeight: 650 } }, '今日剩餘 ' + fmtPts(td.left) + ' 點・' + label + ' ' + fmtPts(bal)),
        h('div.mu.tiny.num.one', '今日 ' + Math.round(td.kcal) + ' 大卡・' + (b.proteinTarget - td.protein > 0 ? '蛋白質還差 ' + Math.round(b.proteinTarget - td.protein) + ' g' : '蛋白質已達標')));
    } else {
      // 今日剩餘放最大；蛋白質也寫「還差多少」，跟點數一樣看剩下的
      const pGap = Math.round(b.proteinTarget - td.protein);
      top.append(h('div.hero',
        h('div',
          h('div.mu.tiny.one', over ? '今日超吃' : '今日剩餘'),
          h('div.one', { style: { whiteSpace: 'nowrap' } }, h('b.num.big', { style: { color: over ? 'var(--warn)' : '' } }, fmtPts(Math.abs(td.left))), h('span.mu.small.num', ' / ' + fmtPts(td.budget) + ' 點')),
          h('div.bar' + (over ? '.warn' : ''), h('i', { style: { width: Math.min(100, td.budget > 0 ? td.eaten / td.budget * 100 : 0) + '%' } })),
          h('div.small.num.one', { style: { marginTop: '6px' } }, pGap > 0 ? '蛋白質還差 ' + pGap + ' g' : '蛋白質已達標 ✓', h('span.mu.tiny', '（目標 ' + Math.round(b.proteinTarget) + ' g）')),
          h('div.bar', h('i', { style: { width: (b.proteinTarget > 0 ? Math.min(100, td.protein / b.proteinTarget * 100) : 0) + '%' } }))),
        h('div.ring', ring(total ? Math.max(0, bal) / total : 0, bal < 0),
          h('div.c', h('span.mu.tiny.one', bal < 0 ? '存摺透支' : label), h('b.num', fmtPts(Math.abs(bal))), h('span.mu.tiny.num', '/ ' + fmtPts(total))))));
      const low = new Date().getHours() >= 20 && td.eaten > 0 && td.eaten < b.floorPoints;
      top.append(h('div.mu.tiny.num.one', { style: { marginTop: '6px', color: low ? 'var(--warn)' : '' } },
        low ? '今天只吃 ' + fmtPts(td.eaten) + ' 點，少於基本需要的 ' + b.floorPoints + ' 點，記得吃夠'
          : '今日 ' + Math.round(td.kcal) + ' 大卡' + (td.refund ? '・運動 +' + fmtPts(td.refund) : '') + '・存摺只算有記錄的日子'));
    }
    top.append(h('div.cta-row' + (fi.fasting ? '.sm' : ''),
      h('button.pri.cta', { type: 'button', onclick: () => openAddMeal() }, icon('camera'), '記一餐'),
      h('button.ghost.cta', { type: 'button', onclick: () => openExercise() }, icon('run'), '記運動')));
  }
  // 今天吃了：只列食物（斷食在「斷食與飲食記錄」裡）
  const todays = groups.filter(g => !g.pending && localDate(g.at) === todayStr).reverse();
  // 收成一行「今天吃了・2 餐・12.5 點」，點了才展開（每次打開 app 都先收起來）
  const tl = h('div', { style: { marginTop: '8px', borderTop: '1px solid var(--ln)', paddingTop: '2px' } });
  if (todays.length) {
    const LIMIT = 5, shown = showAllMeals ? todays : todays.slice(-LIMIT);
    const body = [];
    if (!showAllMeals && todays.length > LIMIT) body.push(h('button.link.small', { type: 'button', onclick: () => { showAllMeals = true; renderToday(root); } }, '顯示今天全部（還有 ' + (todays.length - LIMIT) + ' 餐）'));
    const l = h('div.list.meals'); shown.forEach(g => l.append(mealRow(g))); body.push(l);
    if (todays.some(g => lowProteinMeal(g.protein))) body.push(tip('蛋白質少於 20 g 的那一餐標橘色。用藥期間食量小，每一餐吃到 20～30 g 蛋白質，比較能保住肌肉。'));
    startClosed('today-meals');
    tl.append(fold('today-meals', h('div.row.between.grow', h('b.small', '今天吃了'), h('span.mu.small.num.one', todays.length + ' 餐・' + fmtPts(todays.reduce((a, g) => a + g.points, 0)) + ' 點')), body));
  } else tl.append(h('div.row.between', h('b.small', '今天吃了'), h('span.mu.small.one', '還沒有記錄，拍了可以先存')));
  top.append(tl);
  if (b.ok) top.append(exerciseCard(true));
  const adv = latestAdviceCard(true);
  if (adv) top.append(adv);
  root.append(top);
  if (mc && !mc.urgent) root.append(mc.card);

  /* ---- ③ 記錄：近 7 天一行＋「斷食與飲食記錄」入口（以前的列表不放在這頁） ---- */
  const past = h('div.card.tight');
  const wk = weeklyCard(true);
  if (wk) past.append(wk);
  if (!S.prefs.fastGuessDone) {
    const cands = guessFasts(S.meals, S.fasts);
    if (cands.length) past.append(h('div.notice', { style: { marginTop: '6px', cursor: 'pointer' }, onclick: () => openGuessSheet(cands) },
      h('div.small.one', { style: { fontWeight: 600 } }, '以前有 ' + cands.length + ' 段斷食是猜的，點這裡勾選 ›')));
  }
  past.append(h('button.ghost.full', { type: 'button', style: { marginTop: wk ? '8px' : 0 }, onclick: () => openJournal() }, '斷食與飲食記錄 ›'));
  root.append(past);
  showAllMeals = false; // 下次重畫回到只顯示最近幾筆
}
