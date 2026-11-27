/* 點數低於保底的警告＋依體重速度的建議：一行，點了展開說明（飲食運動、設定、身體、週報共用） */
import { S, plan } from '../state.js';
import { h } from './common.js';
import { localDate } from '../points.js';
import { paceAdvice } from '../safety.js';

export function paceTip(style = {}) {
  const p = paceAdvice(plan(), S.entries, localDate(new Date()));
  if (!p) return null;
  const warn = p.low || p.level === 'fast' || p.level === 'slow';
  return h('details.tip', { style: { marginTop: '6px', ...style } },
    h('summary', { style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', color: warn ? 'var(--warn)' : 'var(--ac-tx)', fontWeight: 600 } }, 'ⓘ ' + p.line),
    h('div', ...p.advice.map(t => h('p', { style: { margin: '0 0 4px' } }, t))));
}
