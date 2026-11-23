/* 提醒與通知：設定裡新增藥物與時間、斷食與注射通知；飲食頁顯示今天的服藥狀態與服藥月曆 */
import { S, L, commit, commitLocal, uid } from '../state.js';
import { h, toast, section, sumLine, tip, timePick, fold, openSheet, closeSheet, startClosed } from './common.js';
import { localDate, addDays } from '../points.js';
import { canNotify, schedule, notifyStatus, openExactSetting, testNotify, askNotify } from '../notify.js';
import { apkVersion, liveApk, timerApk, updateWidgetSoon } from '../widget.js';

const minOf = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hm = iso => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

/** 今天每種藥的狀態：taken（已服用記錄）、due（該吃了：到了設定時間還沒吃）、late（過了 1 小時還沒吃） */
export function medStatus() {
  const today = localDate(new Date()), n = nowMin();
  return (S.prefs.meds || []).filter(m => m && m.name && m.time).map(m => {
    const log = (S.medLog || []).find(x => x.med === m.id && x.date === today);
    const diff = n - minOf(m.time);
    return { med: m, log, due: !log && diff >= 0, late: !log && diff > 60 };
  }).sort((a, b) => (a.med.time < b.med.time ? -1 : 1));
}

/** 飲食頁的服藥卡：沒有設定藥物時不顯示；有該吃的藥時 urgent＝true（排到最上面） */
export function medCard() {
  const list = medStatus();
  if (!list.length) return null;
  const urgent = list.some(x => x.due);
  const card = !urgent ? h('div.medrow') : h('div.card.med', { style: { borderColor: 'var(--warn)', borderWidth: '2px', position: 'sticky', top: document.documentElement.classList.contains('native') ? '36px' : '6px', zIndex: 6, boxShadow: '0 4px 14px rgba(0,0,0,.12)' } });
  if (urgent) card.append(h('h2', { style: { margin: '0 0 4px' } }, '該吃藥了'));
  for (const x of list) {
    const m = x.med;
    if (x.log) {
      const row = h('div.row.between.small', { style: { padding: '4px 0', color: 'var(--ac-tx)', fontWeight: 600 } }, h('span.one', '✓ ' + m.time + ' ' + m.name + '・' + hm(x.log.at) + ' 已服用'));
      const undo = h('button.link.small', { type: 'button' }, '取消');
      undo.onclick = () => {
        if (!undo.dataset.c) { undo.dataset.c = 1; undo.textContent = '再按一次'; setTimeout(() => { undo.dataset.c = ''; undo.textContent = '取消'; }, 3000); return; }
        S.medLog = S.medLog.filter(y => y.id !== x.log.id); commit(); toast('已取消這次服藥記錄');
      };
      row.append(undo); card.append(row);
    } else {
      const take = h('button' + (x.due ? '.pri' : '.ghost'), { type: 'button', style: { padding: '5px 12px', flex: '0 0 auto', ...(x.late ? { background: 'var(--warn)', color: 'var(--on-warn)' } : {}) } }, '已服用');
      take.onclick = () => {
        S.medLog = S.medLog || [];
        S.medLog.push({ id: uid('k'), med: m.id, date: localDate(new Date()), at: new Date().toISOString() });
        commit(); toast('✓ 已記錄：' + m.name);
      };
      card.append(h('div.row.between', { style: { padding: '3px 0', gap: '10px' } },
        h('span.one' + (urgent ? '' : '.small'), { style: { fontWeight: x.due ? 650 : 400, color: x.late ? 'var(--warn)' : '' } }, (urgent ? '' : '吃藥 ') + m.time + ' ' + m.name + (x.late ? '・還沒吃' : '')), take));
    }
  }
  startClosed('med-cal');   // 服藥日曆每次打開 app 都先收起來，要看再點開
  card.append(fold('med-cal', h('span.small', { style: { color: 'var(--ac-tx)', fontWeight: 650 } }, '服藥記錄'), [calendar()], { cls: 'daygrp' }));
  return { card, urgent };
}

/* ---------- 服藥記錄月曆：每一天都可以改 ---------- */
const WD = '日一二三四五六';
let calMonth = '';                                       // 'YYYY-MM'，記住目前看的月份
/** 這種藥從哪天開始算（新增時記下 since；舊資料用最早的服藥記錄） */
function sinceOf(m) {
  if (m.since) return m.since;
  const ds = (S.medLog || []).filter(x => x.med === m.id).map(x => x.date).sort();
  return ds[0] || localDate(new Date());
}
/** 某一天：該吃幾種、吃了幾種 */
function dayState(d) {
  const meds = (S.prefs.meds || []).filter(m => m && m.name && sinceOf(m) <= d);
  const taken = meds.filter(m => (S.medLog || []).some(x => x.med === m.id && x.date === d)).length;
  return { need: meds.length, taken };
}
function calendar() {
  const box = h('div', { style: { marginTop: '8px' } });
  const draw = () => {
    box.textContent = '';
    const today = localDate(new Date());
    if (!calMonth) calMonth = today.slice(0, 7);
    const [y, mo] = calMonth.split('-').map(Number);
    const first = calMonth + '-01', lastDay = new Date(y, mo, 0).getDate(), startDow = new Date(y, mo - 1, 1).getDay();
    const shift = n => { const d = new Date(y, mo - 1 + n, 1); calMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); draw(); };
    // 這個月的統計：從開始吃藥那天（或月初）到今天（或月底）
    let full = 0, days = 0;
    for (let i = 1; i <= lastDay; i++) { const d = calMonth + '-' + String(i).padStart(2, '0'); if (d > today) break; const st = dayState(d); if (!st.need) continue; days++; if (st.taken >= st.need) full++; }
    box.append(h('div.row.between', { style: { marginBottom: '6px' } },
      h('button.ghost', { type: 'button', style: { padding: '6px 12px' }, onclick: () => shift(-1) }, '‹'),
      h('b.small.num', y + ' 年 ' + mo + ' 月' + (days ? '・吃了 ' + full + '/' + days + ' 天' : '')),
      h('button.ghost', { type: 'button', style: { padding: '6px 12px' }, onclick: () => shift(1) }, '›')));
    const grid = h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '4px', textAlign: 'center' } });
    for (const c of WD) grid.append(h('div.mu.tiny', c));
    for (let i = 0; i < startDow; i++) grid.append(h('div'));
    for (let i = 1; i <= lastDay; i++) {
      const d = calMonth + '-' + String(i).padStart(2, '0'), st = dayState(d), future = d > today;
      const bg = future || !st.need ? 'var(--soft)' : st.taken >= st.need ? 'var(--ac)' : st.taken ? '#e0a800' : 'rgba(210,70,50,.18)';
      const fg = !future && st.need && st.taken >= st.need ? 'var(--act)' : 'var(--tx)';
      const cell = h('button', { type: 'button', disabled: future || !st.need, style: { padding: '6px 0', borderRadius: '8px', background: bg, color: fg, fontSize: '13px', fontWeight: d === today ? 800 : 500, border: d === today ? '2px solid var(--tx)' : '0', opacity: future ? 0.5 : 1 } },
        String(i), h('div', { style: { fontSize: '10px', lineHeight: 1 } }, future || !st.need ? ' ' : st.taken >= st.need ? '✓' : st.need > 1 ? st.taken + '/' + st.need : ' '));
      cell.onclick = () => editDay(d, draw);
      grid.append(cell);
    }
    box.append(grid, h('div.mu.tiny.one', { style: { marginTop: '6px' } }, '綠＝都吃了・黃＝吃了一部分・紅＝沒記錄・點日期可以修改'));
    void first;
  };
  draw();
  return box;
}
/** 某一天的服藥：每種藥可以勾選或取消、改時間 */
function editDay(d, redraw) {
  const meds = (S.prefs.meds || []).filter(m => m && m.name && sinceOf(m) <= d);
  openSheet(sh => {
    sh.append(h('div.sheet-h', h('b', (+d.slice(5, 7)) + '/' + (+d.slice(8)) + '（週' + WD[new Date(d + 'T12:00').getDay()] + '）的藥'), h('button.link', { type: 'button', onclick: () => closeSheet() }, '關閉')));
    const rows = meds.map(m => {
      const log = (S.medLog || []).find(x => x.med === m.id && x.date === d);
      const cb = h('input', { type: 'checkbox', checked: !!log, style: { width: '22px', height: '22px' } });
      let t = log ? hm(log.at) : m.time;
      const tp = timePick(t, v => { t = v; cb.checked = true; });
      sh.append(h('div.card', { style: { margin: '0 0 10px' } }, h('label.row', { style: { color: 'var(--tx)', fontSize: '16px', margin: 0, gap: '10px' } }, cb, h('b', m.name), h('span.mu.small', '設定 ' + m.time)),
        h('div.row', { style: { marginTop: '8px', gap: '8px' } }, h('span.small.mu', '吃藥時間'), tp)));
      return { m, cb, get t() { return t; } };
    });
    const save = h('button.pri.full', { type: 'button' }, '儲存');
    save.onclick = () => {
      S.medLog = S.medLog || [];
      for (const r of rows) {
        const i = S.medLog.findIndex(x => x.med === r.m.id && x.date === d);
        const [hh, mm] = r.t.split(':').map(Number), [yy, mo, dd] = d.split('-').map(Number);
        const at = new Date(yy, mo - 1, dd, hh, mm).toISOString();
        if (r.cb.checked) { if (i >= 0) S.medLog[i] = { ...S.medLog[i], at }; else S.medLog.push({ id: uid('k'), med: r.m.id, date: d, at }); }
        else if (i >= 0) S.medLog.splice(i, 1);
      }
      commit(); closeSheet(); toast('已更新 ' + (+d.slice(5, 7)) + '/' + (+d.slice(8)) + ' 的服藥記錄'); redraw && redraw();
    };
    sh.append(save);
  });
}

/** 設定頁：藥物清單（名稱＋時間） */
export function medsSettings() {
  const sumEl = sumLine();
  const meds = () => (S.prefs.meds = S.prefs.meds || []);
  const drawSum = () => { const m = meds(); sumEl.textContent = m.length ? m.map(x => x.time + ' ' + x.name).join('・') : '還沒有設定'; };
  const list = h('div');
  const msg = h('div.small.one', { style: { marginTop: '8px', fontWeight: 600 } });
  const actions = h('div.grid2', { style: { marginTop: '6px', gap: '6px' } });
  /** 通知狀態一行＋測試按鈕；缺「準時鬧鐘」時給一顆打開設定的按鈕 */
  const drawStatus = async () => {
    const st = await notifyStatus().catch(() => ({ web: true }));
    actions.textContent = '';
    if (st.web) { msg.style.color = 'var(--mu)'; msg.textContent = '這是網頁版，不會發通知（只會在飲食頁顯示服藥卡）'; return; }
    const bad = st.display === 'denied' ? '手機沒有允許 MetaPulse 發通知' : st.exact === 'denied' ? '沒有開啟「準時鬧鐘」，通知可能延後或不會跳' : '';
    msg.style.color = bad ? 'var(--warn)' : 'var(--ac)';
    msg.textContent = bad || ('✓ 通知正常・已排好 ' + st.pending + ' 個');
    const test = h('button.ghost', { type: 'button', style: { padding: '8px' } }, '測試通知（10 秒後）');
    test.onclick = async () => { try { await testNotify(); toast('10 秒後會跳一則測試通知'); } catch (e) { toast(e.message, true); } drawStatus(); };
    actions.append(test);
    if (st.exact === 'denied') actions.append(h('button.ghost', { type: 'button', style: { padding: '8px' }, onclick: async () => { await openExactSetting(); setTimeout(drawStatus, 1500); } }, '開啟準時鬧鐘'));
  };
  const resched = async () => { drawSum(); if (canNotify()) await schedule().catch(() => {}); drawStatus(); };
  const draw = () => {
    list.textContent = '';
    meds().forEach((m, i) => {
      const name = h('input', { value: m.name, placeholder: '藥名，例如：降血糖藥' });
      const time = timePick(m.time, v => { m.time = v; commit(); resched(); });
      name.onchange = () => { m.name = name.value.trim() || '藥'; commit(); resched(); };
      const del = h('button.ghost', { type: 'button', style: { padding: '8px 12px', flex: '0 0 auto' } }, '刪除');
      del.onclick = () => { meds().splice(i, 1); commit(); draw(); resched(); };
      const box = (label, key, after) => { const cb = h('input', { type: 'checkbox', checked: !!m[key], style: { width: '20px', height: '20px' } }); cb.onchange = () => { m[key] = cb.checked || undefined; commit(); after && after(); }; return h('label.row.one', { style: { color: 'var(--tx)', fontSize: '14px', margin: 0, gap: '6px' } }, cb, label); };
      list.append(h('div', { style: { marginTop: i ? '10px' : '2px', paddingTop: i ? '8px' : 0, borderTop: i ? '1px solid var(--ln)' : 0 } },
        h('div.row', { style: { gap: '6px' } }, h('div.grow', { style: { minWidth: 0 } }, name), time, del),
        h('div.row', { style: { marginTop: '4px', gap: '14px', flexWrap: 'wrap' } }, box('這是降血糖藥', 'glucose', draw), m.glucose ? box('空腹吃問過醫師了', 'fastOk') : null)));
    });
  };
  const add = h('button.ghost.full', { type: 'button' }, '＋ 新增藥物');
  add.onclick = () => { meds().push({ id: uid('rx'), name: '降血糖藥', time: '19:00', since: localDate(new Date()) }); commit(); draw(); resched(); };
  // 斷食與注射通知（只有 MetaPulse app 會發）
  const N = (L.notify = L.notify || {});
  const saveN = () => { commitLocal(); resched(); updateWidgetSoon(); };
  const freq = h('select', h('option', { value: 'phase' }, '換階段和達標時'), h('option', { value: 'hourly' }, '每小時'), h('option', { value: 'off' }, '不通知'));
  freq.value = N.freq || 'phase'; freq.onchange = () => { N.freq = freq.value; saveN(); };
  // 一列一個設定：左邊名稱、右邊選項（不用滑很久）
  const nrow = (label, ...ctl) => h('div.row', { style: { gap: '8px', marginTop: '6px' } }, h('span.small.one', { style: { flex: '0 0 5.5em' } }, label), ...ctl);
  freq.style.flex = '1 1 0'; freq.style.minWidth = '0';
  // 常駐提醒卡（APK 1.5.0 起才有）：通知最上面固定一張，顯示現在該做什麼
  const liveRow = h('div');
  apkVersion().then(v => {
    if (!liveApk(v)) return;
    const sel = h('select', { style: { flex: '1 1 0', minWidth: '0' } }, h('option', { value: '' }, '關閉'), h('option', { value: '1' }, '開啟'));
    sel.value = N.live ? '1' : '';
    sel.onchange = async () => { N.live = !!sel.value || undefined; commitLocal(); if (N.live && !(await askNotify())) toast('手機沒有允許 MetaPulse 發通知', true); updateWidgetSoon(); toast(N.live ? '已開啟，通知最上面會出現常駐卡' : '已關閉常駐卡'); };
    liveRow.append(nrow('常駐提醒卡', sel));
    if (!timerApk(v)) return;
    const tsel = h('select', { style: { flex: '1 1 0', minWidth: '0' } }, h('option', { value: '' }, '關閉'), h('option', { value: '1' }, '開啟'));
    tsel.value = N.sysTimer ? '1' : '';
    tsel.onchange = () => { N.sysTimer = !!tsel.value || undefined; commitLocal(); toast(N.sysTimer ? '之後按「開始斷食」會開手機時鐘的計時器' : '已關閉'); };
    liveRow.append(nrow('斷食開計時器', tsel));
  });
  const notifyBox = h('div', { style: { marginTop: '10px', paddingTop: '6px', borderTop: '1px solid var(--ln)' } },
    nrow('斷食通知', freq),
    h('div.row', { style: { gap: '4px', marginTop: '6px' } }, h('span.small', { style: { flex: '0 0 auto', marginRight: '4px' } }, '不打擾'), timePick(N.quietStart || '23:00', v => { N.quietStart = v; saveN(); }), h('span.small.mu', '到'),
      timePick(N.quietEnd || '07:00', v => { N.quietEnd = v; saveN(); })),
    nrow('注射日提醒', timePick(N.doseRemindAt || '09:00', v => { N.doseRemindAt = v; saveN(); })), liveRow);
  draw(); drawSum(); drawStatus();
  return section('meds', '提醒與通知', sumEl, [list, add, msg, actions, notifyBox,
    tip('勾「這是降血糖藥」：斷食中到了吃藥時間、或斷食超過 16 小時，斷食卡會提醒留意低血糖。還沒勾「空腹吃問過醫師了」時，會多提醒一句去問醫師或藥師。', h('br'), '到了吃藥時間，「飲食運動」頁最上面會出現服藥卡（往下捲也會貼在頂端），吃完按「已服用」。服藥卡下面的「服藥記錄」是月曆，每一天都可以點開修改。在 MetaPulse app 裡，時間到會跳手機通知（第一次會問你要不要允許通知）；網頁版不會通知，只會顯示卡片。斷食通知：在每個斷食階段開始和達標時通知（或每小時一次），「晚上不打擾」時段內不發。注射日當天在設定的時間提醒一次。「常駐提醒卡」：通知最上面固定一張卡，顯示現在該做什麼（斷食還剩多久、該斷食或可以吃了、快到吃藥時間、今天要注射），不會響；被滑掉後，到下一個時段會再出現。「斷食開計時器」：按「開始斷食」時，順便在手機的時鐘開一個倒數計時器（vivo 會顯示在通知最上面和狀態列，到點會響）；計時器最多 24 小時，改結束時間或提早結束時，舊的計時器要自己到時鐘按 ✕。這只是提醒，吃藥的方式請照醫師或藥師的指示。')]);
}
