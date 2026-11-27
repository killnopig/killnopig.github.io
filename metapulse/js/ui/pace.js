/* 點數低於保底的警告＋依體重速度的建議：一行，點了展開說明（飲食運動、設定、身體、週報共用） */
import { S, L, plan, commitLocal, currentWeight } from '../state.js';
import { h } from './common.js';
import { localDate, budget } from '../points.js';
import { paceAdvice, moveAdvice } from '../safety.js';

export function paceTip(style = {}) {
  const p = paceAdvice(plan(), S.entries, localDate(new Date()));
  if (!p) return null;
  const warn = p.low || p.level === 'fast' || p.level === 'slow';
  return h('details.tip', { style: { marginTop: '6px', ...style } },
    h('summary', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', color: warn ? 'var(--warn)' : 'var(--ac-tx)', fontWeight: 600 } }, 'ⓘ ' + p.line),
    h('div', ...p.advice.map(t => h('p', { style: { margin: '0 0 4px' } }, t))));
}

/** 肌力訓練提醒：近 7 天不到 2 次就顯示一行（走路、打球不會長肌肉），點了展開 */
export function moveTip(style = {}) {
  const m = moveAdvice(S.exercise, localDate(new Date()));
  if (!m) return null;
  return h('details.tip', { style: { marginTop: '4px', ...style } },
    h('summary', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--warn)', fontWeight: 600 } }, m.line),
    h('div', ...m.advice.map(t => h('p', { style: { margin: '0 0 4px' } }, t))));
}

/**
 * 「每天消耗」從公式換成依記錄（或換回公式）時，在飲食運動頁跳一次白話說明，按「知道了」就不再出現
 * L.tdeeSeen 記住使用者已經看過的是哪一種
 */
export function tdeeSwitchCard(rerender) {
  const b = plan();
  if (!b.ok) return null;
  const src = b.tdeeSource, seen = L.tdeeSeen || 'formula';
  if (src === seen) return null;
  const b0 = budget({ ...S.profile, weight: currentWeight() });   // 公式算的
  const ok = () => { L.tdeeSeen = src; commitLocal(); rerender && rerender(); };
  const kids = [];
  if (src === 'adaptive') {
    const more = b.tdee >= b0.tdee;
    kids.push(h('b', '📊 點數改用你自己的記錄來算了'),
      h('p.small', { style: { margin: '6px 0 0' } }, '你已經記了夠多天的吃東西和體重。App 看了你最近這幾週吃了多少、體重掉了多少，算出你一天大約用掉 ', h('b', b.tdee + ' 大卡'), '（原本用公式猜的是 ' + b0.tdee + ' 大卡）。'),
      h('p.small', { style: { margin: '6px 0 0' } }, '所以你每天可以吃的點數，從 ', h('b', b0.dailyPoints + ' 點'), ' 變成 ', h('b', b.dailyPoints + ' 點'), '。'),
      h('p.small', { style: { margin: '6px 0 0' } }, more
        ? '簡單說：你吃了這麼多，體重還是照樣掉，代表你的身體用掉的比公式猜的多，所以可以吃多一點。'
        : '簡單說：你吃了這麼多，體重掉得比預期慢，代表你的身體用掉的比公式猜的少，所以點數會少一點。如果有東西忘了記，數字會偏低，記得都記下來。'),
      h('p.small.mu', { style: { margin: '6px 0 0' } }, '之後每天都會照最近 4 週重新算，數字會小小變動。想改回原本的算法：設定 → 個人資料與每日預算 → 每天消耗用 →「公式估算」。'));
  } else {
    kids.push(h('b', '📊 點數先改回用公式算'),
      h('p.small', { style: { margin: '6px 0 0' } }, '最近 4 週的記錄天數不夠了（吃東西或量體重少記了幾天），沒辦法算準你一天用掉多少，所以先用公式猜：一天 ' + b.tdee + ' 大卡、每天 ' + b.dailyPoints + ' 點。'),
      h('p.small.mu', { style: { margin: '6px 0 0' } }, '記錄夠了會自動換回用你的記錄算。'));
  }
  kids.push(h('button.pri.full', { type: 'button', style: { marginTop: '8px' }, onclick: ok }, '知道了'));
  return h('div.card', { style: { borderColor: 'var(--ac)', borderWidth: '2px' } }, ...kids);
}
