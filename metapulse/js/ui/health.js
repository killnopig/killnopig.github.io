/* 設定頁：Health Connect 同步（只在 APK 中可用；網頁版顯示說明） */
import { S, L, commit, commitLocal, uid } from '../state.js';
import { h, toast, section, sumLine, tip } from './common.js';
import { latestText } from '../records.js';
import { isNative, healthPlugin, diagnose, readHealth, buildRecords, planHealth, applyHealth } from '../health.js';

const UNDO_KEY = 'metapulse-v1-undo';
const hasUndo = () => { try { return !!localStorage.getItem(UNDO_KEY); } catch (e) { return false; } };

export function healthCard() {
  const sumEl = sumLine();
  const native = isNative() && !!healthPlugin();
  const drawSum = () => {
    const x = L.lastHC;
    sumEl.textContent = !native ? '只能在 MetaPulse app 使用'
      : x ? '上次同步：' + new Date(x.at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) + '・新增 ' + x.added + ' 筆' : '還沒同步過';
  };
  drawSum();
  if (!native) {
    return section('hc', 'Health Connect 同步', sumEl, [
      tip('Health Connect 是 Android 手機內建的「健康資料中心」，Omron、手錶等 app 會把量到的資料放在這裡。只有安裝在手機上的 app 才能讀取，網頁版讀不到。安裝 MetaPulse 的 APK（Android 安裝檔）後，從主畫面的 MetaPulse 圖示打開，這裡會出現同步按鈕，可以讀取血壓、脈搏、體重、體脂、基礎代謝和運動消耗的熱量。'),
      /Android/i.test(navigator.userAgent || '') ? h('div.mu.tiny', { style: { marginTop: '6px' } }, '診斷：' + diagnose()) : null,
    ]);
  }

  const days = h('select', h('option', { value: '30' }, '最近 30 天'), h('option', { value: '90' }, '最近 90 天'), h('option', { value: '365' }, '最近 1 年'));
  days.value = L.hcDays || '30';
  days.onchange = () => { L.hcDays = days.value; commitLocal(); };
  const all = h('input', { type: 'checkbox', checked: !!L.hcAll });
  all.onchange = () => { L.hcAll = all.checked; commitLocal(); };
  const out = h('div', { style: { marginTop: '10px' } });
  const undo = h('button.ghost.full', { type: 'button', style: { display: hasUndo() ? '' : 'none' } }, '復原上次同步');
  let last = null; // {raw, ...}

  const show = () => {
    out.textContent = '';
    const b = buildRecords(last.raw, { allSources: all.checked, calSource: L.hcCalSource });
    const p = planHealth(b, S);
    const line = t => h('div.small.one', t);
    const box = h('div', { style: { background: 'var(--soft)', borderRadius: '10px', padding: '7px 10px', lineHeight: 1.45 } },
      line('量測：新增 ' + p.add.length + '・補體組成 ' + p.merge.length + '・已有 ' + p.dup),
      line('運動消耗：新增 ' + p.act.add.length + ' 天・更新 ' + p.act.update.length + ' 天'));
    out.append(box);
    const nothing = !p.add.length && !p.merge.length && !p.act.add.length && !p.act.update.length;
    const go = nothing ? h('div.notice.ok', '沒有新的資料。') : h('button.pri.full', { type: 'button' }, '確認匯入');
    out.append(go);                                       // 匯入按鈕緊接在結果下面，不用往下滑
    if (b.calSources.length > 1) {
      const sel = h('select', ...b.calSources.map(s => h('option', { value: s }, s)));
      sel.value = b.calSource;
      sel.onchange = () => { L.hcCalSource = sel.value; commitLocal(); show(); };
      out.append(h('label.one', '運動消耗用哪個 app（只選一個才不會重複）'), sel);
    }
    const names = Object.keys(b.sources).map(k => k + ' ' + b.sources[k] + ' 筆').join('、');
    out.append(tip(
      (p.from ? '量測期間 ' + p.from + ' ～ ' + p.to + '。' : '') + 'Health Connect 最新：' + (latestText(b.recs) || '沒有' + (all.checked ? '' : ' Omron 的') + '量測資料') + '；這支手機最新：' + (latestText(S.entries) || '沒有身體記錄') + '。運動消耗來源：' + (b.calSource || '沒有資料') + '。',
      h('br'), 'Health Connect 裡有資料的 app：' + (names || '無') + '。' + (all.checked ? '' : '血壓、體重等量測只讀 Omron 的資料。'),
      last.denied.length ? h('div', '沒有允許讀取的項目：' + last.denied.join('、')) : null,
      last.historyDenied ? h('div', '沒有允許讀取 30 天以前的資料，所以只拿到最近大約 30 天。') : null,
      ...last.errs.map(e => h('div', '讀取失敗：' + e)),
      h('div', '骨骼肌、內臟脂肪、身體年齡不會存進 Health Connect，之後可以用 Omron 匯出的 CSV 檔案匯入。')));
    if (nothing) return;
    go.onclick = () => {
      try { localStorage.setItem(UNDO_KEY, JSON.stringify({ entries: S.entries, activity: S.activity || [] })); } catch (e) { /* 空間不足時不保留復原 */ }
      applyHealth(S, p, uid);
      L.lastHC = { at: Date.now(), added: p.add.length + p.merge.length }; commitLocal();
      commit(); drawSum();
      out.textContent = ''; out.append(h('div.notice.ok', '✓ 已匯入 ' + p.add.length + ' 筆、補上 ' + p.merge.length + ' 筆身體組成、運動消耗 ' + (p.act.add.length + p.act.update.length) + ' 天。'));
      undo.style.display = hasUndo() ? '' : 'none';
      toast('Health Connect 匯入完成');
    };
  };

  const btn = h('button.pri.full', { type: 'button' }, '允許並讀取 Health Connect');
  btn.onclick = async () => {
    btn.disabled = true; out.textContent = ''; out.append(h('div.row.small.mu', h('span.spin'), '正在讀取 Health Connect…'));
    try { last = await readHealth(+days.value || 30); show(); out.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    catch (e) { out.textContent = ''; out.append(h('div.notice', 'Health Connect 同步失敗：' + (e && e.message ? e.message : e))); }
    btn.disabled = false;
  };
  undo.onclick = () => {
    if (!undo.dataset.c) { undo.dataset.c = 1; undo.textContent = '再按一次確認取消'; setTimeout(() => { undo.dataset.c = ''; undo.textContent = '復原上次同步'; }, 3000); return; }
    try {
      const p = JSON.parse(localStorage.getItem(UNDO_KEY));
      S.entries = p.entries; S.activity = p.activity; localStorage.removeItem(UNDO_KEY);
      commit(); undo.style.display = 'none'; out.textContent = ''; out.append(h('div.notice.ok', '已復原到上次同步之前。')); toast('已復原');
    } catch (e) { toast('復原失敗', true); }
  };
  return section('hc', 'Health Connect 同步', sumEl, [
    h('div.grid2', { style: { alignItems: 'center' } }, days, h('label.row.one', { style: { color: 'var(--tx)', margin: 0, fontSize: '14px' } }, all, '也讀其他 app')),
    btn, out, undo,
    tip('預設只讀 Omron 的血壓和體重，避免別的 app 的資料混進來。選「最近 1 年」時，要在權限畫面允許讀取 30 天以前的資料。'),
  ], !L.lastHC);
}
