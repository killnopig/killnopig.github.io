/* 飲食分頁：存摺（環形）與今日剩餘、斷食、服藥、注射提醒、週報、餐點列表；卡片依現在最重要的事排順序 */
import { S, L, plan, commitLocal } from '../state.js';
import { backupReminder } from '../sync.js';
import { connect, linked } from '../drive.js';
import { h, icon, fold, hm, WD, fmtPts } from './common.js';
import { usage, localDate, addDays } from '../points.js';
import { ledger, allActivity } from '../ledger.js';
import { exerciseCard, openExercise } from './exercise.js';
import { nextDose } from '../records.js';
import { medCard } from './meds.js';
import { weeklyCard } from './weekly.js';
import { openAddMeal } from './addMeal.js';
import { latestAdviceCard } from './advice.js';
import { fastingCard, longTermCard, fastInfo, pendingCard } from './fasting.js';

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
      h('div.mu.tiny.num', (m.pending ? '預計 ' + hm(m.at) + ' 吃' : hm(m.at)) + ' · ' + Math.round(m.kcal) + ' 大卡 · 蛋白質 ' + r1(m.protein) + ' g')),
    h('span.pts.num', fmtPts(m.points), h('span.mu.tiny', ' 點')));
}

const md = d => +d.slice(5, 7) + '/' + +d.slice(8, 10);
const wd = d => { const [y, m, dd] = d.split('-').map(Number); return WD[new Date(y, m - 1, dd).getDay()]; };

let showAllMeals = false;
export function renderToday(root) {
  root.textContent = '';
  const todayStr = localDate(new Date());
  const b = plan();
  const u = usage(S.meals, todayStr);

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

  /* ---- 頂部：存摺（環形）＋今日剩餘 ---- */
  const fi = fastInfo();
  const fastFirst = fi.fasting && !fi.reached;          // 斷食中還沒達標：斷食卡排最上面，點數卡縮成一行
  let top;
  if (!b.ok) {
    top = h('div.card', h('h2', '先填寫個人資料'),
      h('div.mu.small.one', '需要身高、體重、出生年，才能算出每天可以吃多少'),
      h('button.ghost.full', { type: 'button', onclick: () => document.querySelector('nav.tabs button[data-t="set"]').click() }, '前往設定'));
  } else {
    const mode = S.prefs.weekStart || 'roll';
    const lg = ledger(S.meals, allActivity(S), b.dailyPoints, todayStr, mode);
    const td = lg.today, bal = lg.balance, total = lg.total;
    const label = mode === 'roll' ? '7 天存摺' : '本週存摺';
    if (fastFirst) {
      top = h('div.card',
        h('div.small.num.one', { style: { fontWeight: 650 } }, '今日剩餘 ' + fmtPts(td.left) + ' 點・' + label + ' ' + fmtPts(bal)),
        h('div.mu.tiny.num.one', '今日 ' + Math.round(td.kcal) + ' 大卡・蛋白質 ' + Math.round(td.protein) + '／' + b.proteinTarget + ' g'),
        h('div.cta-row.sm',
          h('button.pri.cta', { type: 'button', onclick: () => openAddMeal() }, icon('camera'), '記一餐'),
          h('button.ghost.cta', { type: 'button', onclick: () => openExercise() }, icon('run'), '記運動')));
    } else {
      const over = td.left < 0;
      top = h('div.card');
      top.append(h('div.hero',
        h('div.ring', ring(total ? Math.max(0, bal) / total : 0, bal < 0),
          h('div.c', h('span.mu.tiny', bal < 0 ? '存摺透支' : label), h('b.num', fmtPts(Math.abs(bal))), h('span.mu.tiny.num', '/ ' + fmtPts(total) + ' 點'))),
        h('div',
          h('div.metric',
            h('div.row.between', h('span', '今日剩餘'), h('span.num', h('b', { style: { color: over ? 'var(--warn)' : '' } }, fmtPts(td.left)), h('span.mu', ' / ' + fmtPts(td.budget) + ' 點'))),
            h('div.bar' + (over ? '.warn' : ''), h('i', { style: { width: Math.min(100, td.budget > 0 ? td.eaten / td.budget * 100 : 0) + '%' } }))),
          metric('蛋白質', td.protein, b.proteinTarget, 'g', null, false))));
      // 保底：晚上 8 點後還吃太少才提醒
      const low = new Date().getHours() >= 20 && td.eaten > 0 && td.eaten < b.floorPoints;
      top.append(h('div.mu.tiny.num.one', { style: { marginTop: '10px', color: low ? 'var(--warn)' : '' } },
        low ? '今天只吃 ' + fmtPts(td.eaten) + ' 點，少於基本需要的 ' + b.floorPoints + ' 點，記得吃夠'
          : '今日 ' + Math.round(td.kcal) + ' 大卡' + (td.refund ? '・運動 +' + fmtPts(td.refund) : '') + '・' + (over ? '超出的用存摺補' : '存摺越多，熱量赤字越大')));
      // 記一餐（寬）＋記運動（窄）同一列
      top.append(h('div.cta-row',
        h('button.pri.cta', { type: 'button', onclick: () => openAddMeal() }, icon('camera'), '記一餐'),
        h('button.ghost.cta', { type: 'button', onclick: () => openExercise() }, icon('run'), '記運動')));
    }
  }

  /* ---- 依「現在最重要的事」排順序 ---- */
  const mc = medCard();
  const nd = nextDose(S.entries, todayStr);
  const doseLine = nd && nd.left <= 0 ? h('div.card', { style: { borderColor: 'var(--c1)', borderWidth: '2px', cursor: 'pointer' }, onclick: () => document.querySelector('nav.tabs button[data-t="log"]').click() },
    h('div.row.between', h('b.one', nd.left === 0 ? '今天要注射・' + nd.site : '注射已逾期 ' + (-nd.left) + ' 天・' + nd.site), h('span', { style: { color: 'var(--c1)', fontWeight: 650, flex: '0 0 auto' } }, '去記錄 ›'))) : null;
  if (mc && mc.urgent) root.append(mc.card);
  if (doseLine) root.append(doseLine);
  const ex = b.ok ? exerciseCard() : null;
  const pend = pendingCard();   // 先存、還沒吃的餐點：放在斷食卡上面，旁邊就是「結束斷食」
  if (fastFirst) { if (pend) root.append(pend); root.append(fastingCard(), top); if (ex) root.append(ex); }
  else { root.append(top); if (ex) root.append(ex); if (pend) root.append(pend); root.append(fastingCard()); }
  if (mc && !mc.urgent) root.append(mc.card);
  const adv = latestAdviceCard();
  if (adv) root.append(adv);
  const wk = weeklyCard();
  if (wk) root.append(wk);
  const lt = longTermCard();
  if (lt) root.append(lt);

  /* ---- 餐點列表：今天展開；前 6 天每天一行；更早依月份收合 ---- */
  const groups = groupMeals(S.meals);
  const listCard = h('div.card');
  const todays = groups.filter(g => localDate(g.at) === todayStr);
  const head = h('div.row.between.grow', h('h2', { style: { margin: 0 } }, '今日餐點'),
    todays.length ? h('span.mu.small.num', todays.length + ' 餐 · ' + fmtPts(u.today.points) + ' 點') : null);
  const tl = h('div.list', { style: { marginTop: '6px' } });
  // 斷食中：餐點收成一行，點開才看
  const tlWrap = fastFirst ? fold('meals-fasting', head, [tl], { open: false }) : null;
  if (!tlWrap) listCard.append(head);
  const MEAL_LIMIT = 4;
  if (todays.length) {
    todays.slice(0, showAllMeals ? todays.length : MEAL_LIMIT).forEach(g => tl.append(mealRow(g)));
    if (!showAllMeals && todays.length > MEAL_LIMIT) tl.append(h('button.link.small', { type: 'button', onclick: () => { showAllMeals = true; renderToday(root); } }, '顯示今天全部（還有 ' + (todays.length - MEAL_LIMIT) + ' 餐）'));
  }
  else tl.append(h('div.empty', '今天還沒有記錄。按上方「記一餐」開始。'));
  listCard.append(tlWrap || tl);

  const from7 = addDays(todayStr, -6);
  const recent = groups.filter(g => { const d = localDate(g.at); return d < todayStr && d >= from7; });
  const older = groups.filter(g => localDate(g.at) < from7);
  if (recent.length || older.length) {
    const past = h('div');
    const listCardPast = { append: (...k) => past.append(...k) };
    const byDay = new Map();
    for (const g of recent) { const d = localDate(g.at); if (!byDay.has(d)) byDay.set(d, []); byDay.get(d).push(g); }
    for (const [d, gs] of byDay) {
      const pts = gs.reduce((a, g) => a + g.points, 0), pro = gs.reduce((a, g) => a + g.protein, 0);
      const l = h('div.list'); gs.forEach(g => l.append(mealRow(g)));
      listCardPast.append(fold('day-' + d, h('span.small.num', md(d) + '（' + wd(d) + '）・' + gs.length + ' 餐・' + fmtPts(pts) + ' 點・蛋白質 ' + Math.round(pro) + ' g'), l, { cls: 'daygrp' }));
    }
    const byMon = new Map();
    for (const g of older) { const k = localDate(g.at).slice(0, 7); if (!byMon.has(k)) byMon.set(k, []); byMon.get(k).push(g); }
    for (const [k, gs] of byMon) {
      const days = new Set(gs.map(g => localDate(g.at))).size;
      const pts = gs.reduce((a, g) => a + g.points, 0);
      const l = h('div.list'); gs.forEach(g => l.append(h('div.mu.tiny', { style: { marginTop: '6px' } }, md(localDate(g.at)) + '（' + wd(localDate(g.at)) + '）'), mealRow(g)));
      listCardPast.append(fold('mon-' + k, h('span.small.num', +k.slice(5) + ' 月・' + gs.length + ' 餐・平均每天 ' + fmtPts(pts / days) + ' 點'), l, { cls: 'daygrp' }));
    }
    listCard.append(fold('past-meals', h('span.small', '以前的餐點'), [past], { cls: 'daygrp' }));
  }
  root.append(listCard);
  showAllMeals = false; // 下次重畫回到只顯示前幾餐
}
