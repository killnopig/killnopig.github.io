/* 身體頁「身體感覺」：每天點一下記副作用（噁心、便秘、腹瀉、沒食慾、疲倦，0～3），回診報告會統計 */
import { S, commit } from '../state.js';
import { h, fold, pills, tip } from './common.js';
import { localDate, addDays } from '../points.js';
import { SYMPTOMS, LEVELS, symptomId, normalizeSymptom } from '../safety.js';
import { md } from '../records.js';

let day = '';   // 正在記哪一天（預設今天）

const rowOf = d => (S.symptoms || []).find(x => x.date === d);
const sumText = r => { const t = r ? SYMPTOMS.filter(([k]) => r[k] > 0).map(([k, n]) => n + ' ' + LEVELS[r[k]]) : []; return r ? (t.length ? t.join('・') : '都沒有不舒服') : '還沒記'; };

export function symptomCard() {
  const today = localDate(new Date());
  if (!day || day > today || day < addDays(today, -1)) day = today;
  const r = rowOf(day);
  const set = (k, v) => {
    S.symptoms = S.symptoms || [];
    const cur = rowOf(day) || { date: day };
    const n = normalizeSymptom({ ...cur, [k]: v });
    S.symptoms = S.symptoms.filter(x => x.id !== symptomId(day)).concat(n);
    commit();
  };
  const body = h('div', { style: { marginTop: '8px' } },
    h('div', { style: { marginBottom: '6px' } }, pills([[today, '今天'], [addDays(today, -1), '昨天']], day, v => { day = v; commit(); })),
    ...SYMPTOMS.map(([k, name]) => {
      const cur = r ? r[k] || 0 : -1;
      return h('div', { style: { display: 'grid', gridTemplateColumns: '64px repeat(4, 1fr)', gap: '4px', alignItems: 'center', marginTop: '4px' } },
        h('span.small', name),
        ...LEVELS.map((t, i) => h('button', { type: 'button', onclick: () => set(k, i), style: { padding: '5px 0', borderRadius: '8px', fontSize: '14px', minWidth: 0, border: '1px solid ' + (cur === i ? 'var(--ac)' : 'var(--ln)'), background: cur === i ? (i ? 'var(--ac-soft)' : 'var(--soft)') : 'transparent', color: cur === i ? 'var(--ac-tx)' : 'var(--tx)', fontWeight: cur === i ? 700 : 400 } }, t)));
    }),
    tip('每天點一下就好：無、輕、中、重。沒有不舒服也可以點「無」，回診時才知道那天有記。「圖表」→「回診報告」會統計每一項幾天、最嚴重是哪天，方便跟醫師講。'));
  const head = h('div.grow', h('h2', { style: { margin: 0 } }, '身體感覺'),
    h('div.small.one', { style: { marginTop: '2px' } }, (day === today ? '今天：' : md(day) + '：') + sumText(r)));
  return h('div.card', fold('symptoms', head, [body], { open: false }));
}
