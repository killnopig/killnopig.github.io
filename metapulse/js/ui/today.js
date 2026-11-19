/* 飲食分頁：固定三張卡，從上到下是 ① 現在（斷食中／進食中）② 今天（存摺、記一餐、今天的時間軸）③ 以前（近 7 天、每天的餐點與斷食）。
 * 該吃藥、該注射只有當下要做時才排在最上面。 */
import { S, L, plan, commitLocal } from '../state.js';
import { backupReminder } from '../sync.js';
import { connect, linked } from '../drive.js';
import { h, icon, fold, hm, WD, fmtPts } from './common.js';
import { localDate, addDays } from '../points.js';
import { ledger, allActivity } from '../ledger.js';
import { exerciseCard, openExercise } from './exercise.js';
import { nextDose } from '../records.js';
import { medCard } from './meds.js';
import { weeklyCard } from './weekly.js';
import { openAddMeal } from './addMeal.js';
import { latestAdviceCard } from './advice.js';
import { fastingCard, longTermCard, fastInfo, openFastEditor, openGuessSheet } from './fasting.js';
import { fastSegments, guessFasts, targetHours } from '../fasting.js';

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
const mdT = t => { const x = new Date(t); return (x.getMonth() + 1) + '/' + x.getDate(); };
const hrs1 = x => (Math.round(x * 10) / 10).toFixed(1);

/** 時間軸上的一段斷食（點一下可以改時間或刪除） */
function fastRow(x, goal) {
  const ok = x.hours >= goal;
  return h('div.it', { onclick: () => openFastEditor(x.rec) },
    h('div.grow',
      h('div.one', { style: { fontWeight: 600, color: ok ? 'var(--ac-tx)' : '' } }, '斷食 ' + hrs1(x.hours) + ' 小時' + (ok ? ' ✓' : '')),
      h('div.mu.tiny.num.one', mdT(x.start) + ' ' + hm(x.start) + ' → ' + mdT(x.end) + ' ' + hm(x.end) + '・點一下可以改')));
}

/** 時間軸：每天的餐點和斷食，照時間排（斷食排在結束的那一刻） */
function buildDays(groups, segs) {
  const by = new Map();
  const add = (d, t, el) => { if (!by.has(d)) by.set(d, []); by.get(d).push({ t, el }); };
  for (const g of groups) if (!g.pending) add(localDate(g.at), new Date(g.at).getTime(), { meal: g });
  for (const x of segs) add(localDate(new Date(x.end)), x.end, { fast: x });
  for (const a of by.values()) a.sort((p, q) => p.t - q.t);
  return by;
}
function dayList(items, goal) {
  const l = h('div.list');
  for (const it of items) l.append(it.el.meal ? mealRow(it.el.meal) : fastRow(it.el.fast, goal));
  return l;
}
function daySummary(d, items, goal, withWd = true) {
  const meals = items.filter(i => i.el.meal).map(i => i.el.meal), fs = items.filter(i => i.el.fast).map(i => i.el.fast);
  const pts = meals.reduce((a, g) => a + g.points, 0), best = fs.reduce((a, x) => Math.max(a, x.hours), 0);
  const parts = [md(d) + (withWd ? '（' + wd(d) + '）' : '')];
  if (meals.length) parts.push(meals.length + ' 餐', fmtPts(pts) + ' 點');
  if (best) parts.push('斷食 ' + hrs1(best) + ' 小時' + (best >= goal ? ' ✓' : ''));
  return parts.join('・');
}

let showAllMeals = false;
export function renderToday(root) {
  root.textContent = '';
  const todayStr = localDate(new Date());
  const b = plan();
  const goal = targetHours(S.prefs);

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
  const segs = fastSegments(S.fasts);
  const days = buildDays(groups, segs);
  const top = h('div.card');
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
        h('div.mu.tiny.num.one', '今日 ' + Math.round(td.kcal) + ' 大卡・蛋白質 ' + Math.round(td.protein) + '／' + b.proteinTarget + ' g'));
    } else {
      top.append(h('div.hero',
        h('div.ring', ring(total ? Math.max(0, bal) / total : 0, bal < 0),
          h('div.c', h('span.mu.tiny', bal < 0 ? '存摺透支' : label), h('b.num', fmtPts(Math.abs(bal))), h('span.mu.tiny.num', '/ ' + fmtPts(total) + ' 點'))),
        h('div',
          h('div.metric',
            h('div.row.between', h('span', '今日剩餘'), h('span.num', h('b', { style: { color: over ? 'var(--warn)' : '' } }, fmtPts(td.left)), h('span.mu', ' / ' + fmtPts(td.budget) + ' 點'))),
            h('div.bar' + (over ? '.warn' : ''), h('i', { style: { width: Math.min(100, td.budget > 0 ? td.eaten / td.budget * 100 : 0) + '%' } }))),
          metric('蛋白質', td.protein, b.proteinTarget, 'g', null, false))));
      const low = new Date().getHours() >= 20 && td.eaten > 0 && td.eaten < b.floorPoints;
      top.append(h('div.mu.tiny.num.one', { style: { marginTop: '10px', color: low ? 'var(--warn)' : '' } },
        low ? '今天只吃 ' + fmtPts(td.eaten) + ' 點，少於基本需要的 ' + b.floorPoints + ' 點，記得吃夠'
          : '今日 ' + Math.round(td.kcal) + ' 大卡' + (td.refund ? '・運動 +' + fmtPts(td.refund) : '') + '・存摺只算有記錄的日子'));
    }
    top.append(h('div.cta-row' + (fi.fasting ? '.sm' : ''),
      h('button.pri.cta', { type: 'button', onclick: () => openAddMeal() }, icon('camera'), '記一餐'),
      h('button.ghost.cta', { type: 'button', onclick: () => openExercise() }, icon('run'), '記運動')));
  }
  const todays = days.get(todayStr) || [];
  const tl = h('div', { style: { marginTop: '10px', borderTop: '1px solid var(--ln)', paddingTop: '6px' } });
  tl.append(h('div.row.between', h('b.small', '今天'), todays.length ? h('span.mu.small.num.one', daySummary(todayStr, todays, goal).split('・').slice(1).join('・')) : null));
  if (todays.length) {
    const LIMIT = 5, shown = showAllMeals ? todays : todays.slice(-LIMIT);
    if (!showAllMeals && todays.length > LIMIT) tl.append(h('button.link.small', { type: 'button', onclick: () => { showAllMeals = true; renderToday(root); } }, '顯示今天全部（還有 ' + (todays.length - LIMIT) + ' 筆）'));
    tl.append(dayList(shown, goal));
  } else tl.append(h('div.empty', '今天還沒有記錄。拍了不一定要吃，可以先存。'));
  top.append(tl);
  if (b.ok) top.append(exerciseCard(true));
  const adv = latestAdviceCard(true);
  if (adv) top.append(adv);
  root.append(top);
  if (mc && !mc.urgent) root.append(mc.card);

  /* ---- ③ 以前：近 7 天一行、每天一行（點開是那天的餐點與斷食，都可以改） ---- */
  const past = h('div.card');
  past.append(h('div.row.between', h('h2', { style: { margin: 0 } }, '以前'), h('button.link.small', { type: 'button', onclick: () => openFastEditor(null) }, '＋ 補記斷食')));
  const wk = weeklyCard(true);
  if (wk) past.append(h('div', { style: { marginTop: '6px' } }, wk));
  if (!S.prefs.fastGuessDone) {
    const cands = guessFasts(S.meals, S.fasts);
    if (cands.length) past.append(h('div.notice', { style: { marginTop: '8px', cursor: 'pointer' }, onclick: () => openGuessSheet(cands) },
      h('div.small.one', { style: { fontWeight: 600 } }, '以前有 ' + cands.length + ' 段斷食是猜的，點這裡勾選 ›')));
  }
  const from14 = addDays(todayStr, -13);
  const keys = [...days.keys()].filter(d => d < todayStr).sort().reverse();
  const recent = keys.filter(d => d >= from14), older = keys.filter(d => d < from14);
  for (const d of recent) past.append(fold('day-' + d, h('span.small.num.one', daySummary(d, days.get(d), goal)), dayList(days.get(d), goal), { cls: 'daygrp' }));
  const byMon = new Map();
  for (const d of older) { const k = d.slice(0, 7); if (!byMon.has(k)) byMon.set(k, []); byMon.get(k).push(d); }
  for (const [k, ds] of byMon) {
    const n = ds.reduce((a, d) => a + days.get(d).filter(i => i.el.meal).length, 0);
    const body = h('div');
    for (const d of ds) body.append(h('div.mu.tiny.num', { style: { marginTop: '8px' } }, daySummary(d, days.get(d), goal)), dayList(days.get(d), goal));
    past.append(fold('mon-' + k, h('span.small.num.one', +k.slice(5) + ' 月・' + ds.length + ' 天・' + n + ' 餐'), [body], { cls: 'daygrp' }));
  }
  if (!recent.length && !older.length && !wk) past.append(h('div.empty', '還沒有以前的記錄'));
  root.append(past);
  showAllMeals = false; // 下次重畫回到只顯示最近幾筆
}
