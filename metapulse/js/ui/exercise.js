/* 飲食運動頁的「運動」卡：今天的運動（Health Connect 自動匯入＋手動）；「記運動」按鈕在上方記一餐旁邊，選種類與分鐘數，
 * 依體重估算消耗（MET × 體重 × 小時），加回點數＝消耗 × 0.75 ÷ 40 */
import { S, L, commit, commitLocal, uid, currentWeight } from '../state.js';
import { h, toast, fold, tip, openSheet, closeSheet, fmtPts, timePick } from './common.js';
import { EXERCISES, BUDGET, SAFETY } from '../config.js';
import { strengthCount } from '../safety.js';
import { localDate } from '../points.js';
import { md, wdOf } from '../records.js';
import { editActivity, restoreActivity } from '../health.js';

const MET = Object.fromEntries(EXERCISES.map(([id, , m]) => [id, m]));
const NAME = Object.fromEntries(EXERCISES.map(([id, n]) => [id, n]));
const pts = kcal => kcal * BUDGET.exerciseRefund / BUDGET.kcalPerPoint;
export const estKcal = (type, minutes, kg) => Math.round((MET[type] || 4) * (kg || 70) * (minutes || 0) / 60);
const hm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

export function exerciseCard(bare = false) {
  const today = localDate(new Date());
  const mine = (S.exercise || []).filter(x => x.date === today).sort((a, b) => (a.at < b.at ? -1 : 1));
  const watch = (S.activity || []).filter(a => a.date === today).reduce((a, x) => a + (+x.kcal || 0), 0);
  const kcal = watch + mine.reduce((a, x) => a + x.kcal, 0);
  const parts = [];
  if (watch) parts.push('自動匯入 ' + Math.round(watch) + ' 大卡');
  if (mine.length) parts.push(mine.length === 1 ? (NAME[mine[0].type] || '運動').replace(/（.*）/, '') + ' ' + mine[0].minutes + ' 分' : '手動 ' + mine.length + ' 筆');
  const sum = kcal ? '今日運動 +' + fmtPts(pts(kcal)) + ' 點（' + parts.join('＋') + '）' : '今天還沒有運動記錄';
  const list = h('div.list', { style: { marginTop: '6px' } });
  for (const x of mine) list.append(h('div.it', { onclick: () => openExercise(x) },
    h('div.grow', h('div.one', NAME[x.type] || '運動'), h('div.mu.tiny.num', hm(x.at) + ' · ' + x.minutes + ' 分鐘 · ' + x.kcal + ' 大卡')),
    h('span.pts.num', { style: { color: 'var(--ac-tx)' } }, '+' + fmtPts(pts(x.kcal)), h('span.mu.tiny', ' 點'))));
  if (watch) list.append(h('div.mu.tiny.one', { style: { marginTop: '6px' } }, 'Health Connect 自動匯入：今天 ' + Math.round(watch) + ' 大卡，+' + fmtPts(pts(watch)) + ' 點'));
  if (!mine.length && !watch) list.append(h('div.empty', '打球、走路都可以記，消耗會換成可以多吃的點數'));
  if ((S.exercise || []).length || (S.activity || []).length) list.append(h('button.link.small', { type: 'button', style: { marginTop: '6px' }, onclick: () => openExerciseLog() }, '運動記錄 ›'));
  const sc = strengthCount(S.exercise, today), goal = SAFETY.strengthGoal;
  const head = h('div.row.between.grow', { style: { gap: '10px' } }, h('div.small.one', { style: { fontWeight: 600 } }, sum),
    h('span.tiny.num', { style: { flex: '0 0 auto', color: sc >= goal ? 'var(--ac-tx)' : 'var(--mu)', fontWeight: 600 } }, '肌力 ' + sc + '/' + goal));
  return h(bare ? 'div' : 'div.card', bare ? { style: { marginTop: '6px' } } : null, fold('ex-card', head, [list, tip('「肌力 1/2」＝近 7 天做了幾次肌力訓練（重量訓練、彈力帶、徒手深蹲或伏地挺身），建議每週至少 2 次，減重時比較能保住肌肉。記運動時選這幾種就會算進去。', h('br'), '加回點數＝消耗熱量 × 0.75 ÷ 40（手機 App 和估算常常算多，所以打 75 折）。消耗用「運動強度（MET）× 體重 × 時間」估算，估得不準可以直接改大卡數。Health Connect 已經自動匯入的運動，不要再手動記一次，不然會算兩次。')]));
}

/** 記運動／修改運動 */
export function openExercise(entry, onDone) {
  const kg = currentWeight() || +S.profile.weight || 70;
  const last = L.lastExercise || { type: 'bball', minutes: 60 };
  let type = entry ? entry.type : last.type, minutes = entry ? entry.minutes : last.minutes, kcalEdited = entry ? entry.kcal !== estKcal(entry.type, entry.minutes, kg) : false;
  let at = entry ? hm(entry.at) : hm(new Date().toISOString());
  openSheet(sh => {
    sh.append(h('div.sheet-h', h('b', entry ? '修改運動' : '記運動'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')));
    const sel = h('select', ...EXERCISES.map(([id, n, m]) => h('option', { value: id }, n + '（強度 ' + m + '）')));
    sel.value = type;
    const min = h('input.num', { type: 'number', inputmode: 'numeric', min: '1', value: minutes });
    const kc = h('input.num', { type: 'number', inputmode: 'numeric', min: '0', value: entry ? entry.kcal : estKcal(type, minutes, kg) });
    const out = h('div.notice.ok', { style: { marginTop: '10px' } });
    const quick = h('div.quick', ...[30, 60, 90, 120, 180].map(m => h('button.ghost', { type: 'button', onclick: () => { min.value = m; upd(true); } }, m + ' 分')));
    const upd = (fromMin) => {
      type = sel.value; minutes = +min.value || 0;
      if (fromMin || !kcalEdited) { kc.value = estKcal(type, minutes, kg); kcalEdited = false; }
      out.textContent = '消耗約 ' + (+kc.value || 0) + ' 大卡 → 可以加回 ' + fmtPts(pts(+kc.value || 0)) + ' 點';
    };
    sel.onchange = () => upd(true); min.oninput = () => upd(true);
    kc.oninput = () => { kcalEdited = true; upd(false); };
    const tp = timePick(at, v => { at = v; });
    const today = localDate(new Date());
    const dateIn = h('input', { type: 'date', value: entry ? entry.date : today, max: today });
    sh.append(h('label', { style: { marginTop: 0 } }, '種類'), sel,
      h('label', '多久（分鐘）'), min, quick,
      h('label', '消耗（大卡）・依體重 ' + Math.round(kg) + ' kg 估算，可以改'), kc,
      h('label', '日期'), dateIn, h('label', '開始時間'), tp, out);
    upd(false);
    const save = h('button.pri.full', { type: 'button' }, entry ? '儲存' : '加入');
    save.onclick = () => {
      const k = Math.round(+kc.value || 0), m = Math.round(+min.value || 0);
      if (!(m > 0) || !(k >= 0)) { toast('請填分鐘數', true); return; }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIn.value) || dateIn.value > today) { toast('日期不對（不能是未來）', true); return; }
      const [hh, mm] = at.split(':').map(Number), d = /^\d{4}-\d{2}-\d{2}$/.test(dateIn.value) && dateIn.value <= today ? dateIn.value : null, [y, mo, dd] = d.split('-').map(Number);
      const rec = { id: entry ? entry.id : uid('x'), date: d, at: new Date(y, mo - 1, dd, hh, mm).toISOString(), type, minutes: m, kcal: k };
      S.exercise = S.exercise || [];
      const i = S.exercise.findIndex(x => x.id === rec.id);
      if (i >= 0) S.exercise[i] = rec; else S.exercise.push(rec);
      L.lastExercise = { type, minutes: m }; commitLocal();
      commit(); toast('✓ ' + (NAME[type] || '運動') + ' +' + fmtPts(pts(k)) + ' 點');
      if (onDone) onDone(); else closeSheet();
    };
    sh.append(save);
    if (entry) {
      const del = h('button.danger.full', { type: 'button' }, '刪除這筆');
      del.onclick = () => {
        if (!del.dataset.c) { del.dataset.c = 1; del.textContent = '再按一次確認刪除'; setTimeout(() => { del.dataset.c = ''; del.textContent = '刪除這筆'; }, 3000); return; }
        S.exercise = S.exercise.filter(x => x.id !== entry.id); commit(); toast('已刪除');
        if (onDone) onDone(); else closeSheet();
      };
      sh.append(del);
    }
    if (onDone) sh.append(h('button.ghost.full', { type: 'button', style: { marginTop: '8px' }, onclick: onDone }, '回運動記錄'));
  });
}

/** 運動記錄：手動記的運動＋Health Connect 每天的消耗，舊的在上、新的在下；點一筆就能修改或刪除 */
export function openExerciseLog() {
  openSheet(sh => {
    sh.append(h('div.sheet-h', h('b', '運動記錄'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')));
    const rows = [
      ...(S.exercise || []).map(x => ({ date: x.date, key: x.at || x.date, x })),
      ...(S.activity || []).map(a => ({ date: a.date, key: a.date + 'T99', a })),
    ].sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
    const list = h('div.list');
    let last = '';
    for (const r of rows) {
      if (r.date !== last) { last = r.date; list.append(h('div.mu.tiny.one', { style: { margin: '10px 0 2px', fontWeight: 600 } }, md(r.date) + '（週' + wdOf(r.date) + '）')); }
      if (r.x) {
        const x = r.x;
        list.append(h('div.it', { onclick: () => openExercise(x, openExerciseLog) },
          h('div.grow', h('div.one', NAME[x.type] || '運動'), h('div.mu.tiny.num.one', (x.at ? hm(x.at) + ' · ' : '') + x.minutes + ' 分鐘 · ' + x.kcal + ' 大卡')),
          h('span.pts.num', { style: { color: 'var(--ac-tx)' } }, '+' + fmtPts(pts(x.kcal)), h('span.mu.tiny', ' 點'))));
      } else {
        const a = r.a, off = a.edited && !(a.kcal > 0);
        list.append(h('div.it', { onclick: () => openActivity(a) },
          h('div.grow', h('div.one', '自動匯入（Health Connect）'), h('div.mu.tiny.num.one', off ? '已設成不算（原本 ' + Math.round(a.hc || 0) + ' 大卡）' : Math.round(a.kcal) + ' 大卡' + (a.edited ? '・改過（原本 ' + Math.round(a.hc || 0) + '）' : ''))),
          h('span.pts.num', { style: { color: off ? 'var(--mu)' : 'var(--ac-tx)' } }, '+' + fmtPts(pts(a.kcal || 0)), h('span.mu.tiny', ' 點'))));
      }
    }
    if (!rows.length) list.append(h('div.empty', '還沒有運動記錄'));
    sh.append(list,
      h('button.ghost.full', { type: 'button', style: { marginTop: '12px' }, onclick: () => openExercise(null, openExerciseLog) }, '補記運動'),
      tip('點一筆就能修改日期、時間、分鐘、大卡或刪除。自動匯入的數字可以改大卡數，或設成「不算」（例如算太多、或跟手動記的重複）；改過的那天，之後 Health Connect 同步不會蓋回去，按「恢復原本的數字」才會再照 Health Connect。'));
    requestAnimationFrame(() => { sh.scrollTop = sh.scrollHeight; });
  });
}

/** 修改自動匯入某一天的運動消耗 */
function openActivity(a) {
  openSheet(sh => {
    sh.append(h('div.sheet-h', h('b', '自動匯入 ' + md(a.date)), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')));
    const kc = h('input.num', { type: 'number', inputmode: 'numeric', min: '0', value: Math.round(a.kcal || 0) });
    const out = h('div.notice.ok', { style: { marginTop: '10px' } });
    const upd = () => { out.textContent = '消耗 ' + (+kc.value || 0) + ' 大卡 → 可以加回 ' + fmtPts(pts(+kc.value || 0)) + ' 點'; };
    kc.oninput = upd; upd();
    const back = () => { commit(); openExerciseLog(); };
    sh.append(h('div.mu.small', 'Health Connect 記到 ' + Math.round(a.edited ? a.hc || 0 : a.kcal || 0) + ' 大卡' + (a.src ? '（' + a.src + '）' : '')),
      h('label', '消耗（大卡），可以改'), kc, out,
      h('button.pri.full', { type: 'button', onclick: () => { const k = +kc.value; if (!(k >= 0)) { toast('請填大卡數', true); return; } editActivity(S, a.date, k); toast('已修改'); back(); } }, '儲存'),
      h('button.danger.full', { type: 'button', onclick: () => { editActivity(S, a.date, 0); toast('這天的自動匯入不算了'); back(); } }, '這天不算（設成 0）'));
    if (a.edited) sh.append(h('button.ghost.full', { type: 'button', style: { marginTop: '8px' }, onclick: () => { restoreActivity(S, a.date); toast('已恢復原本的數字'); back(); } }, '恢復原本的數字'));
    sh.append(h('button.ghost.full', { type: 'button', style: { marginTop: '8px' }, onclick: openExerciseLog }, '回運動記錄'));
  });
}
