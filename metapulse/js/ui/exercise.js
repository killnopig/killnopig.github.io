/* 飲食運動頁的「運動」卡：今天的運動（手錶＋手動）；「記運動」按鈕在上方記一餐旁邊，選種類與分鐘數，
 * 依體重估算消耗（MET × 體重 × 小時），加回點數＝消耗 × 0.75 ÷ 40 */
import { S, L, commit, commitLocal, uid, currentWeight } from '../state.js';
import { h, toast, fold, tip, openSheet, closeSheet, fmtPts, timePick } from './common.js';
import { EXERCISES, BUDGET } from '../config.js';
import { localDate } from '../points.js';

const MET = Object.fromEntries(EXERCISES.map(([id, , m]) => [id, m]));
const NAME = Object.fromEntries(EXERCISES.map(([id, n]) => [id, n]));
const pts = kcal => kcal * BUDGET.exerciseRefund / BUDGET.kcalPerPoint;
export const estKcal = (type, minutes, kg) => Math.round((MET[type] || 4) * (kg || 70) * (minutes || 0) / 60);
const hm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

export function exerciseCard() {
  const today = localDate(new Date());
  const mine = (S.exercise || []).filter(x => x.date === today).sort((a, b) => (a.at < b.at ? -1 : 1));
  const watch = (S.activity || []).filter(a => a.date === today).reduce((a, x) => a + (+x.kcal || 0), 0);
  const kcal = watch + mine.reduce((a, x) => a + x.kcal, 0);
  const parts = [];
  if (watch) parts.push('手錶 ' + Math.round(watch) + ' 大卡');
  if (mine.length) parts.push(mine.length === 1 ? (NAME[mine[0].type] || '運動').replace(/（.*）/, '') + ' ' + mine[0].minutes + ' 分' : '手動 ' + mine.length + ' 筆');
  const sum = kcal ? '今日運動 +' + fmtPts(pts(kcal)) + ' 點（' + parts.join('＋') + '）' : '今天還沒有運動記錄';
  const list = h('div.list', { style: { marginTop: '6px' } });
  for (const x of mine) list.append(h('div.it', { onclick: () => openExercise(x) },
    h('div.grow', h('div.one', NAME[x.type] || '運動'), h('div.mu.tiny.num', hm(x.at) + ' · ' + x.minutes + ' 分鐘 · ' + x.kcal + ' 大卡')),
    h('span.pts.num', { style: { color: 'var(--ac)' } }, '+' + fmtPts(pts(x.kcal)), h('span.mu.tiny', ' 點'))));
  if (watch) list.append(h('div.mu.tiny.one', { style: { marginTop: '6px' } }, 'Health Connect（手錶）今天 ' + Math.round(watch) + ' 大卡，+' + fmtPts(pts(watch)) + ' 點'));
  if (!mine.length && !watch) list.append(h('div.empty', '打球、走路都可以記，消耗會換成可以多吃的點數'));
  const head = h('div.row.between.grow', { style: { gap: '10px' } }, h('div.small.one', { style: { fontWeight: 600 } }, sum));
  return h('div.card', fold('ex-card', head, [list, tip('加回點數＝消耗熱量 × 0.75 ÷ 40（手錶和估算常常算多，所以打 75 折）。消耗用「運動強度（MET）× 體重 × 時間」估算，估得不準可以直接改大卡數。手錶已經記到的運動（Health Connect 會自動加入），不要再手動記一次，不然會算兩次。')]));
}

/** 記運動／修改運動 */
export function openExercise(entry) {
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
    sh.append(h('label', { style: { marginTop: 0 } }, '種類'), sel,
      h('label', '多久（分鐘）'), min, quick,
      h('label', '消耗（大卡）・依體重 ' + Math.round(kg) + ' kg 估算，可以改'), kc,
      h('label', '開始時間'), tp, out);
    upd(false);
    const save = h('button.pri.full', { type: 'button' }, entry ? '儲存' : '加入');
    save.onclick = () => {
      const k = Math.round(+kc.value || 0), m = Math.round(+min.value || 0);
      if (!(m > 0) || !(k >= 0)) { toast('請填分鐘數', true); return; }
      const [hh, mm] = at.split(':').map(Number), d = entry ? entry.date : localDate(new Date()), [y, mo, dd] = d.split('-').map(Number);
      const rec = { id: entry ? entry.id : uid('x'), date: d, at: new Date(y, mo - 1, dd, hh, mm).toISOString(), type, minutes: m, kcal: k };
      S.exercise = S.exercise || [];
      const i = S.exercise.findIndex(x => x.id === rec.id);
      if (i >= 0) S.exercise[i] = rec; else S.exercise.push(rec);
      L.lastExercise = { type, minutes: m }; commitLocal();
      commit(); closeSheet(); toast('✓ ' + (NAME[type] || '運動') + ' +' + fmtPts(pts(k)) + ' 點');
    };
    sh.append(save);
    if (entry) sh.append(h('button.danger.full', { type: 'button', onclick: () => { S.exercise = S.exercise.filter(x => x.id !== entry.id); commit(); closeSheet(); toast('已刪除'); } }, '刪除這筆'));
  });
}
