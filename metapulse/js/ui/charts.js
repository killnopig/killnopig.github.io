/* 圖表分頁：移植同步版的圖表（體重、劑量與殘留、血壓、BMI、體組成、身體年齡／基礎代謝）
 * Chart.js 4.4.1 在第一次開啟圖表頁時才從 cdnjs 載入。圖表卡片可收合，收起來的不畫。 */
import { S, L, commitLocal, plan } from '../state.js';
import { h, fold, pills, toast, tip, setFolds } from './common.js';
import { aiName, copyText, shareToAi, openAi } from './aishare.js';
import { doctorReport } from '../report.js';
import { buildSummary, dailyFood, dailyFastDetail, eatingWindows, macroSplit } from '../summary.js';
import { capPlugin } from '../health.js';
import { localDate } from '../points.js';
import { targetHours } from '../fasting.js';
import { sortEntries, onBoard, dn, fromDn, md, wdOf, medAdherence } from '../records.js';
import { ledgerSeries, activityByDay, allActivity } from '../ledger.js';
import { longTermStatusCard, leanParts, longTermStatus, leanStatus, openJournal } from './fasting.js';
import { leanSummary, longTermRows } from '../longterm.js';
import { weightTrendLine, trendAt } from '../adaptive.js';
import { theoryCard } from './theory.js';
import { labHistory, labName, labUnit, labSort, refText } from '../labs.js';

const CHART_URL = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
let loading = null;
export function loadChart() {
  if (window.Chart) return Promise.resolve();
  if (!loading) loading = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = CHART_URL; s.onload = res;
    s.onerror = () => { loading = null; rej(new Error('load')); };
    document.head.appendChild(s);
  });
  return loading;
}

const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
export const palette = () => ({ tx: css('--tx'), mu: css('--mu'), ln: css('--ln'), wc: css('--ac'), dc: css('--c1'), rc: css('--warn'), c3: css('--c3'), c4: css('--c4') });

const fullDate = d => (d ? d + '（週' + wdOf(d) + '）' : '');
const crosshair = color => ({
  id: 'crosshair', afterDatasetsDraw(c) {
    const t = c.tooltip; if (!t || !t.getActiveElements) return;
    const a = t.getActiveElements(); if (!a.length) return;
    const x = a[0].element.x, ar = c.chartArea, g = c.ctx;
    g.save(); g.beginPath(); g.moveTo(x, ar.top); g.lineTo(x, ar.bottom); g.lineWidth = 1; g.strokeStyle = color; g.setLineDash([4, 3]); g.stroke(); g.restore();
  },
});

/* 參考區間：BMI 台灣成人標準；血壓用台灣高血壓指引的居家血壓目標 130/80 */
const BMI_BANDS = [{ from: 18.5, to: 24, color: 'rgba(34,160,90,.10)' }, { from: 24, to: 27, color: 'rgba(224,168,0,.13)' }, { from: 27, to: 99, color: 'rgba(210,70,50,.08)' }];
const BP_REFS = [{ y: 130, label: '130' }, { y: 80, label: '80' }];
const BP_NOTE = '虛線是 130／80：台灣高血壓治療指引建議的居家血壓目標（收縮壓／舒張壓）。只是參考，請和醫師討論自己的目標。';
/** 在圖表底層畫背景區間（bands）與水平參考虛線（refs） */
function refPlugin(sp) {
  return {
    id: 'refs', beforeDatasetsDraw(c) {
      const y = c.scales.y, ar = c.chartArea, g = c.ctx; if (!y) return;
      g.save(); g.beginPath(); g.rect(ar.left, ar.top, ar.right - ar.left, ar.bottom - ar.top); g.clip();
      for (const b of sp.bands || []) { const y1 = y.getPixelForValue(b.to), y2 = y.getPixelForValue(b.from); g.fillStyle = b.color; g.fillRect(ar.left, Math.min(y1, y2), ar.right - ar.left, Math.abs(y2 - y1)); }
      for (const r of sp.refs || []) { const py = y.getPixelForValue(r.y); if (py < ar.top || py > ar.bottom) continue; g.strokeStyle = 'rgba(120,120,120,.8)'; g.setLineDash([6, 4]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(ar.left, py); g.lineTo(ar.right, py); g.stroke(); g.setLineDash([]); g.fillStyle = 'rgba(110,110,110,.9)'; g.font = '11px system-ui'; g.fillText(r.label, ar.right - 24, py - 3); }
      g.restore();
    },
  };
}

/**
 * 產生各圖表設定；畫面與（之後的）截圖共用
 * @param range 'all' | '30' | '90'；bpv 'all' | 'day' | 'ampm'
 */
export function chartSpecs(pal, range = 'all', bpv = 'all') {
  const { tx, mu, ln, wc, dc, rc, c3, c4 } = pal;
  const today = localDate(new Date());
  const cut = range === 'all' ? '' : fromDn(dn(today) - +range + 1);
  const all = sortEntries(S.entries), es = all.filter(e => !cut || e.date >= cut);
  const ws = es.filter(e => e.wt > 0), dsAll = all.filter(e => e.dose > 0);
  const bs = es.filter(e => e.sys > 0 && e.dia > 0), bc = es.filter(e => e.fat > 0 || e.mus > 0 || e.vis > 0);
  const bm = es.filter(e => e.bage > 0 || e.bmr > 0);
  const H = +S.profile.height || 0, TW = +S.profile.targetWeight || 0, HL = +S.profile.halfLife || 120;
  const grid = () => ({ color: ln }), tk = () => ({ maxTicksLimit: 7 });
  // 圖例：虛線的那幾條畫成一小段虛線（粗框虛線的小方塊會變成鋸齒狀），實線的畫成小方塊
  const leg = () => ({ labels: { color: tx, boxWidth: 12, usePointStyle: true, pointStyleWidth: 18,
    generateLabels: chart => Chart.defaults.plugins.legend.labels.generateLabels(chart).map(it => {
      const ds = chart.data.datasets[it.datasetIndex] || {}, dashed = ds.borderDash && ds.borderDash.length;
      return Object.assign(it, dashed ? { pointStyle: 'line', lineDash: [4, 3], lineWidth: 3 } : { pointStyle: 'rect', lineDash: [] }, ds.legendColor ? { fillStyle: ds.legendColor, strokeStyle: ds.legendColor } : {});
    }) } });
  const ln3 = (label, data, color, extra) => Object.assign({ label, data, borderColor: color, backgroundColor: color, tension: 0.25, pointRadius: data.length > 80 ? 1.5 : 3, spanGaps: true }, extra || {});
  // 橫軸照實際天數排：從第一天到最後一天每天一格，沒量的日子留空（線直接連過去）
  const span = ds0 => { if (!ds0.length) return []; const o = []; for (let i = dn(ds0[0]); i <= dn(ds0[ds0.length - 1]); i++) o.push(fromDn(i)); return o; };
  const dayAvg = (list, f) => { const m = {}; list.forEach(e => { const v = f(e); if (v > 0) (m[e.date] = m[e.date] || []).push(v); }); const o = {}; for (const k in m) o[k] = m[k].reduce((a, b) => a + b, 0) / m[k].length; return o; };
  const on = (map, axis, d = 1) => axis.map(x => (map[x] != null ? +map[x].toFixed(d) : null));
  const NONE = ['這天沒有量'];
  // 醫學上常見的畫法：每天的數值用淡色小點（每天會跳動），趨勢看 7 天平均的粗線
  const fade = (c, a) => { const m = /^#([0-9a-f]{6})$/i.exec(String(c).trim()); if (!m) return c; const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };
  const dots = (label, data, color, extra) => Object.assign({ label, data, borderColor: fade(color, 0.5), backgroundColor: fade(color, 0.5), showLine: false, pointRadius: data.length > 120 ? 1.5 : 2.5, pointHoverRadius: 5 }, extra || {});
  const trend = (label, data, color, extra) => Object.assign({ label, data, borderColor: color, backgroundColor: color, borderWidth: 3, pointRadius: 0, pointHoverRadius: 4, tension: 0.35, spanGaps: true }, extra || {});
  const wLine = weightTrendLine(S.entries || []), wTrend = axis => axis.map(x => { const t = trendAt(wLine, x); return t == null ? null : +t.toFixed(2); });   // 趨勢體重（adaptive.js）
  const ma7 = (mapAll, axis, d = 1) => { const ks = Object.keys(mapAll).sort(); return axis.map(x => { const from = fromDn(dn(x) - 6); const v = ks.filter(k => k >= from && k <= x).map(k => mapAll[k]); return v.length >= 3 ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(d) : null; }); };
  const allAvg = f => dayAvg(all, f);
  const sp = [];
  const wd = dayAvg(ws, e => e.wt), wAxis = span(Object.keys(wd).sort()), m2 = H ? (H / 100) ** 2 : 0;
  const wv = Object.values(wd), wMin = wv.length ? Math.min(...wv) : 0, wMax = wv.length ? Math.max(...wv) : 0;
  const lastW = wAxis.length ? wd[wAxis[wAxis.length - 1]] : 0;
  const showTW = TW > 0 && TW >= wMin - 3;                      // 目標在畫面附近才畫線，否則體重線會被壓扁
  if (wAxis.length) {
    sp.push({
      id: 'w', title: '體重', dates: wAxis, note: '點是每天量的體重（水分、鹽分會讓它一天差 1～2 kg）；實線是趨勢體重：每天只往新的體重移 10%，一天多 1 kg 水分只讓趨勢動 0.1 kg。看有沒有變瘦請看實線。',
      sub: (() => { const mxW = Math.max(...Object.values(allAvg(e => e.wt))); const lost = mxW - lastW; return [lost >= 0.5 ? '最高 ' + mxW.toFixed(1) + ' → ' + lastW.toFixed(1) + '・已瘦 ' + lost.toFixed(1) + ' kg' : '', TW > 0 && lastW ? (lastW > TW ? '還差 ' + (lastW - TW).toFixed(1) : '已達目標') : ''].filter(Boolean).join('・'); })(),
      extra: i => { const d = wAxis[i]; if (wd[d] == null) return NONE; const x = []; if (H) x.push('BMI ' + (wd[d] / m2).toFixed(1)); const ts = ws.filter(e => e.date === d && e.time).map(e => e.time); if (ts.length) x.push('時間 ' + ts.join('、')); return x; },
      cfg: {
        type: 'line', data: { labels: wAxis.map(md), datasets: [dots('每天', on(wd, wAxis), wc), trend('趨勢', wTrend(wAxis), wc)].concat(showTW ? [{ label: '目標 ' + TW + ' kg', data: wAxis.map(() => TW), borderColor: mu, backgroundColor: mu, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0 }] : []) },
        options: { maintainAspectRatio: false, plugins: { legend: leg() }, scales: { x: { grid: grid(), ticks: tk() }, y: { grid: grid() } } },
      },
    });
  }
  // 淨體重：每天平均（體重 ×（1 − 體脂率））＋ 28 天移動平均（往前 28 天至少 6 天有量才畫）
  const lday = {};
  all.filter(e => e.wt > 0 && e.fat > 0).forEach(e => { (lday[e.date] = lday[e.date] || []).push(e.wt * (1 - e.fat / 100)); });
  const lds = Object.keys(lday).sort(), lv = d => lday[d].reduce((x, y) => x + y, 0) / lday[d].length;
  const lAxis = span(lds.filter(d => !cut || d >= cut));
  if (lAxis.length) {
    const ma = lAxis.map(d => { const from = fromDn(dn(d) - 27), w = lds.filter(x => x >= from && x <= d); return w.length >= 6 ? +(w.reduce((a, x) => a + lv(x), 0) / w.length).toFixed(2) : null; });
    sp.push({
      id: 'lean', title: '淨體重', dates: lAxis, note: '淨體重＝體重 ×（1 − 體脂率）。點是每天的數值（會跳動），實線是 28 天平均，看趨勢請看實線。',
      cfg: {
        type: 'line', data: { labels: lAxis.map(md), datasets: [
          dots('每天 (kg)', lAxis.map(d => (lday[d] ? +lv(d).toFixed(1) : null)), c4),
          trend('28 天平均', ma, wc)] },
        options: { maintainAspectRatio: false, plugins: { legend: { labels: leg().labels } }, scales: { x: { grid: grid(), ticks: tk() }, y: { grid: grid() } } },
      },
    });
  }
  // 斷食時間：每天結束的最長一段斷食（只用斷食記錄）
  const fdet = dailyFastDetail(S.meals, S.fasts);
  const fAxis = span(Object.keys(fdet).filter(d => (!cut || d >= cut) && d <= today).sort());
  if (fAxis.length) {
    const P = S.prefs || {};
    const tgt = targetHours(P);
    const hrs = fAxis.map(d => (fdet[d] ? +fdet[d].hours.toFixed(1) : null));
    const last7 = fAxis.filter(d => d >= fromDn(dn(today) - 6) && fdet[d]).map(d => fdet[d].hours);
    const hmOf = t => { const x = new Date(t); return md(localDate(x)) + ' ' + String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
    sp.push({
      id: 'fast', title: '斷食時間', dates: fAxis,
      sub: last7.length ? '近 7 天平均 ' + (last7.reduce((a, b) => a + b, 0) / last7.length).toFixed(1) + ' 小時・達標 ' + last7.filter(x => x >= tgt).length + '/' + last7.length + ' 天' : '近 7 天沒有資料',
      note: '每天一根：那天結束的最長一段斷食，只用你的斷食記錄（按「開始斷食」「結束斷食」，或在「飲食運動」頁的記錄裡改過、補記的）。跨日的斷食畫在結束的那一天；還在進行的不畫。虛線是目標 ' + tgt + ' 小時，達標的長條用主色。',
      extra: i => { const x = fdet[fAxis[i]]; return x ? [hmOf(x.start) + ' → ' + hmOf(x.end)] : ['這天沒有資料']; },
      cfg: {
        data: { labels: fAxis.map(md), datasets: [
          { type: 'bar', label: '斷食（小時）', data: hrs, backgroundColor: hrs.map(v => (v >= tgt ? wc : mu)), order: 2 },
          { type: 'line', label: '目標 ' + tgt + ' 小時', data: fAxis.map(() => tgt), borderColor: rc, backgroundColor: rc, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, order: 1 }] },
        options: { maintainAspectRatio: false, plugins: { legend: leg() }, scales: { x: { grid: grid(), ticks: tk() }, y: { grid: grid(), beginAtZero: true } } },
      },
    });
  }
  // 每日飲食（只放在截圖）：點數＋保底虛線，蛋白質用右邊的軸；今天還沒結束不畫
  const food = dailyFood(S.meals), Pn = plan();
  const foodAxis = span(Object.keys(food).filter(d => (!cut || d >= cut) && d < today).sort());
  if (foodAxis.length) {
    const fds = [{ type: 'bar', label: '點數', data: foodAxis.map(d => (food[d] ? +food[d].points.toFixed(1) : null)), backgroundColor: wc, order: 3, yAxisID: 'y' },
      { type: 'line', label: '蛋白質 (g)', data: foodAxis.map(d => (food[d] ? Math.round(food[d].protein) : null)), borderColor: c3, backgroundColor: c3, pointRadius: 2, spanGaps: true, tension: 0.25, order: 1, yAxisID: 'y1' }];
    if (Pn.ok) fds.push({ type: 'line', label: '保底 ' + Pn.floorPoints + ' 點', data: foodAxis.map(() => Pn.floorPoints), borderColor: mu, backgroundColor: mu, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, order: 2, yAxisID: 'y' });
    sp.push({
      id: 'food', title: '每日飲食', dates: foodAxis, exportOnly: true,
      cfg: { data: { labels: foodAxis.map(md), datasets: fds }, options: { maintainAspectRatio: false, plugins: { legend: leg() }, scales: { x: { grid: grid(), ticks: tk() }, y: { grid: grid(), beginAtZero: true, position: 'left' }, y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } } } } },
    });
  }
  if (dsAll.length) {
    const labels = [], doses = [], ob = [], dts = [];
    const a = Math.max(dn(dsAll[0].date), cut ? dn(cut) : -1e9), b = Math.max(dn(today), dn(dsAll[dsAll.length - 1].date)) + 7;
    const dm = {}; dsAll.forEach(e => { dm[e.date] = (dm[e.date] || 0) + e.dose; });
    for (let i = a; i <= b; i++) { const s2 = fromDn(i); labels.push(md(s2)); dts.push(s2); doses.push(dm[s2] || null); ob.push(+onBoard(all, i, HL).toFixed(2)); }
    sp.push({
      id: 'd', title: '注射劑量與預估體內藥量', dates: dts,
      note: '體內藥量是用藥物半衰期粗略算的（假設打完馬上吸收），只用來看變化，不能用來決定劑量。',
      extra: i => dsAll.filter(e => e.date === dts[i]).map(e => '注射 ' + e.dose + ' mg' + (e.site ? '（' + e.site + '）' : '')),
      cfg: {
        data: { labels, datasets: [
          { type: 'bar', label: '注射劑量 (mg)', data: doses, backgroundColor: dc, order: 2 },
          { type: 'line', label: '預估體內藥量 (mg)', data: ob, borderColor: rc, backgroundColor: rc, pointRadius: 0, tension: 0.3, order: 1 }] },
        options: { maintainAspectRatio: false, plugins: { legend: leg() }, scales: { x: { grid: grid(), ticks: tk() }, y: { grid: grid(), beginAtZero: true } } },
      },
    });
  }
  if (bs.length) {
    const days = {}; bs.forEach(e => { (days[e.date] = days[e.date] || []).push(e); });
    const dl = span(Object.keys(days).sort());
    const av = (a, f) => { const v = (a || []).map(f).filter(x => x > 0); return v.length ? Math.round(v.reduce((p, q) => p + q, 0) / v.length) : null; };
    const rg = (a, f) => { const v = a.map(f).filter(x => x > 0); return v.length ? Math.min(...v) + '–' + Math.max(...v) : ''; };
    const timed = bs.filter(e => e.time).length;
    const mode = bpv === 'ampm' && timed === 0 ? 'day' : bpv;
    const opt = { maintainAspectRatio: false, plugins: { legend: leg() }, scales: { x: { grid: grid(), ticks: tk() }, y: { grid: grid(), suggestedMin: 60, suggestedMax: 140 } } };
    if (mode === 'day') {
      const sysAll = dayAvg(all.filter(e => e.sys > 0 && e.dia > 0), e => e.sys), diaAll = dayAvg(all.filter(e => e.sys > 0 && e.dia > 0), e => e.dia);
      const d3 = [dots('收縮壓', dl.map(d => av(days[d], e => e.sys)), c3), trend('收縮壓 7 天平均', ma7(sysAll, dl, 0), c3),
        dots('舒張壓', dl.map(d => av(days[d], e => e.dia)), c4), trend('舒張壓 7 天平均', ma7(diaAll, dl, 0), c4)];
      sp.push({
        id: 'bp', title: '血壓與脈搏', dates: dl,
        note: (bpv === 'ampm' ? '這段範圍內的血壓記錄都沒有量測時間，無法分早晚，已改為每日平均。' : '淡色點是每天的平均，粗線是 7 天平均（看趨勢看粗線）。同一天量好幾次會取平均；手指按在圖上可以看當天量了幾次、最高最低。') + BP_NOTE,
        refs: BP_REFS,
        extra: i => { const a = days[dl[i]]; if (!a) return NONE; const x = [a.length + ' 次量測']; if (a.length > 1) x.push('收縮壓 ' + rg(a, e => e.sys) + '，舒張壓 ' + rg(a, e => e.dia)); return x; },
        cfg: { type: 'line', data: { labels: dl.map(md), datasets: d3 }, options: opt },
      });
    } else if (mode === 'ampm') {
      const part = (d, am) => (days[d] || []).filter(e => e.time && ((parseInt(e.time, 10) < 12) === am));
      const mk2 = (lab, am, f, color, dash) => ln3(lab, dl.map(d => av(part(d, am), f)), color, { borderDash: dash || [], pointRadius: 3 });
      const d3 = [mk2('早上 收縮壓', true, e => e.sys, c3), mk2('早上 舒張壓', true, e => e.dia, c4), mk2('晚上 收縮壓', false, e => e.sys, c3, [5, 3]), mk2('晚上 舒張壓', false, e => e.dia, c4, [5, 3])];
      const nt = bs.length - timed;
      sp.push({
        id: 'bp', title: '血壓與脈搏', dates: dl,
        note: '早上＝12:00 前量測，晚上＝12:00 後；實線為早上、虛線為晚上，同時段多次量測取平均。' + (nt ? '有 ' + nt + ' 筆沒有量測時間，未納入此圖。' : '') + BP_NOTE, refs: BP_REFS,
        extra: i => { if (!days[dl[i]]) return NONE; const x = []; [['早上', true], ['晚上', false]].forEach(([n, am]) => { const a = part(dl[i], am); if (a.length) x.push(n + ' ' + a.length + ' 次'); }); return x; },
        cfg: { type: 'line', data: { labels: dl.map(md), datasets: d3 }, options: opt },
      });
    } else {
      // 每次量測：淡點；趨勢＝最近 14 次量測的平均
      const roll = f => bs.map((e, i) => { const w = bs.slice(Math.max(0, i - 13), i + 1).map(f); return Math.round(w.reduce((a, b) => a + b, 0) / w.length); });
      const ds3 = [dots('收縮壓', bs.map(e => e.sys), c3), trend('收縮壓趨勢', roll(e => e.sys), c3), dots('舒張壓', bs.map(e => e.dia), c4), trend('舒張壓趨勢', roll(e => e.dia), c4)];
      if (bs.some(e => e.pul > 0)) ds3.push(dots('脈搏', bs.map(e => e.pul > 0 ? e.pul : null), mu));
      sp.push({
        id: 'bp', title: '血壓與脈搏', dates: bs.map(e => e.date), note: '淡色點是每次量測，粗線是最近 14 次的平均（看趨勢看粗線）。' + BP_NOTE, refs: BP_REFS,
        extra: i => [bs[i].time ? '時間 ' + bs[i].time : '', (bs[i].note || '').replace(/^\d{1,2}:\d{2}[，,]?/, '')].filter(Boolean),
        cfg: { type: 'line', data: { labels: bs.map(e => md(e.date)), datasets: ds3 }, options: opt },
      });
    }
  }
  if (H && wAxis.length) {
    const bNow = lastW / m2;
    sp.push({
      id: 'bmi', title: 'BMI', dates: wAxis, bands: BMI_BANDS,
      sub: lastW ? '目前 ' + bNow.toFixed(1) + '（' + (bNow < 18.5 ? '過輕' : bNow < 24 ? '正常' : bNow < 27 ? '過重' : '肥胖') + '）' : '', note: '依身高 ' + H + ' cm 計算。BMI＝體重 ÷ 身高²（公尺）。背景顏色是台灣成人標準：綠色 18.5～24 正常、黃色 24～27 過重、紅色 27 以上肥胖。',
      extra: i => (wd[wAxis[i]] != null ? ['體重 ' + wd[wAxis[i]].toFixed(1) + ' kg'] : NONE),
      cfg: {
        type: 'line', data: { labels: wAxis.map(md), datasets: [
          dots('BMI', wAxis.map(d => (wd[d] != null ? +(wd[d] / m2).toFixed(1) : null)), wc), trend('趨勢', wTrend(wAxis).map(v => (v == null ? null : +(v / m2).toFixed(1))), wc)] },
        options: { maintainAspectRatio: false, plugins: { legend: leg() }, scales: { x: { grid: grid(), ticks: tk() }, y: { grid: grid() } } },
      },
    });
  }
  const mini = (title, list, f, color, d, extra) => {
    const m = dayAvg(list, f), ax = span(Object.keys(m).sort());
    if (!ax.length) return null;
    return { title, dates: ax, cfg: { type: 'line', data: { labels: ax.map(md), datasets: [dots(title, on(m, ax, d), color), trend('7 天平均', ma7(allAvg(f), ax, d), color, extra || {})] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: grid(), ticks: { maxTicksLimit: 5 } }, y: { grid: grid(), ticks: { maxTicksLimit: 4, precision: d ? undefined : 0 } } } } } };
  };
  if (bc.length) {
    const parts = [mini('體脂率 (%)', bc, e => e.fat, c3, 1), mini('骨骼肌率 (%)', bc, e => e.mus, c4, 1), mini('內臟脂肪等級', bc, e => e.vis, rc, 0, { stepped: true, tension: 0 })].filter(Boolean);
    if (parts.length) sp.push({ id: 'bc', title: '體脂、骨骼肌與內臟脂肪', dates: parts[0].dates, parts, cfg: parts[0].cfg, note: '每張小圖：淡色點是每天的數值，粗線是 7 天平均。體脂機的數字每天會跳動，看粗線的方向就好。' });
  }
  if (bm.length) {
    const parts = [mini('身體年齡（歲）', bm, e => e.bage, c3, 0), mini('基礎代謝（大卡）', bm, e => e.bmr, c4, 0)].filter(Boolean);
    if (parts.length) sp.push({ id: 'bm', title: '身體年齡與基礎代謝', dates: parts[0].dates, parts, cfg: parts[0].cfg });
  }
  /* ---------- 飲食・運動・用藥（只在畫面上，放在同一個大區塊裡）；今天還沒過完不畫 ---------- */
  const yday = fromDn(dn(today) - 1), P2 = S.prefs || {};
  const from = (keys) => { const k = keys.filter(d => (!cut || d >= cut) && d <= yday).sort(); return k.length ? k : null; };
  const sopt = (y, extra) => ({ maintainAspectRatio: false, plugins: { legend: leg() }, scales: Object.assign({ x: { grid: grid(), ticks: tk(), stacked: !!(y && y.stacked) }, y: Object.assign({ grid: grid() }, y || {}) }, extra || {}) });
  const p1 = x => (Math.round(x * 10) / 10).toString();
  const hhmm = t => { const x = new Date(t); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); };
  // 1. 點數存摺
  const lk = from([...new Set(S.meals.map(m => localDate(m.at)))]);
  if (Pn.ok && lk) {
    const rows = ledgerSeries(S.meals, allActivity(S), Pn.dailyPoints, lk[0], yday, P2.weekStart || 'roll', S.fasts), ax = rows.map(r => r.date);
    const left = rows.map(r => (r.logged ? +r.left.toFixed(1) : null));
    sp.push({
      id: 'ledger', group: 'more', screenOnly: true, title: '點數存摺', dates: ax,
      note: '長條是每天剩下的點數（每日點數＋運動加回−吃掉的），綠色是有剩、橘色是超支。粗線是存摺餘額，算法跟「飲食運動」頁一樣，照設定的「' + ({ roll: '最近 7 天', sun: '每週日開始', mon: '每週一開始' }[P2.weekStart || 'roll']) + '」分期。過去每一天都用現在的每日點數 ' + Pn.dailyPoints + ' 點估算；沒記錄的日子不畫長條，也不算進存摺（整天都在斷食的日子算有記錄）。',
      extra: i => { const r = rows[i]; return r.logged ? ['額度 ' + p1(r.budget) + '・吃了 ' + p1(r.eaten) + (r.refund ? '・運動加回 ' + p1(r.refund) : '')] : ['這天沒記錄']; },
      cfg: { data: { labels: ax.map(md), datasets: [
        { type: 'bar', label: '當天剩下', data: left, backgroundColor: c => (c.raw != null && c.raw < 0 ? rc : wc), legendColor: wc, order: 2 },
        { type: 'line', label: '存摺餘額', data: rows.map(r => r.balance), borderColor: c3, backgroundColor: c3, borderWidth: 2.5, pointRadius: 0, tension: 0.2, order: 1 }] },
      options: sopt() },
    });
  }
  // 2. 進食時間窗
  const ew = eatingWindows(S.meals), ek = from(Object.keys(ew));
  if (ek) {
    const ax = span(ek), hr = t => { const x = new Date(t); return +(x.getHours() + x.getMinutes() / 60).toFixed(2); };
    const win = ax.map(d => (ew[d] ? [hr(ew[d].start), Math.max(hr(ew[d].end), hr(ew[d].start) + 0.25)] : null));
    const hrs = ax.filter(d => ew[d] && ew[d].meals > 1).map(d => ew[d].hours);
    sp.push({
      id: 'window', group: 'more', screenOnly: true, title: '進食時間窗', dates: ax,
      sub: hrs.length ? '平均 ' + p1(hrs.reduce((a, b) => a + b, 0) / hrs.length) + ' 小時' : '',
      note: '每天一根：從第一道吃的到最後一道吃的時間，越上面越早。過了半夜吃的算到隔天；漏記一餐時會不準。',
      label: () => '吃東西的時段',
      extra: i => { const x = ew[ax[i]]; return x ? [hhmm(x.start) + ' → ' + hhmm(x.end) + '，共 ' + p1(x.hours) + ' 小時、' + x.meals + ' 餐'] : ['這天沒記錄']; },
      cfg: { type: 'bar', data: { labels: ax.map(md), datasets: [{ label: '吃東西的時段', data: win, backgroundColor: wc, borderRadius: 3 }] },
        options: sopt({ reverse: true, min: 0, max: 24, ticks: { stepSize: 6, callback: v => v + ':00' } }) },
    });
  }
  // 3. 三大營養素比例
  const ms = macroSplit(food), mk = from(Object.keys(ms));
  if (mk) {
    const ax = span(mk), g = k => ax.map(d => (ms[d] ? ms[d][k] : null));
    sp.push({
      id: 'macro', group: 'more', screenOnly: true, title: '三大營養素比例', dates: ax,
      note: '每天的熱量裡，蛋白質、碳水、脂肪各佔多少（估算：蛋白質和碳水每克 4 大卡、脂肪每克 9 大卡）。數字來自 AI 辨識或食物庫，只是大概。',
      label: it => it.dataset.label + ' ' + it.raw + '%',
      extra: i => { const x = ms[ax[i]]; return x ? ['蛋白質 ' + Math.round(x.protein) + ' g・碳水 ' + Math.round(x.carb) + ' g・脂肪 ' + Math.round(x.fat) + ' g'] : ['這天沒記錄']; },
      cfg: { type: 'bar', data: { labels: ax.map(md), datasets: [
        { label: '蛋白質', data: g('p'), backgroundColor: wc }, { label: '碳水', data: g('c'), backgroundColor: c4 }, { label: '脂肪', data: g('f'), backgroundColor: rc }] },
      options: sopt({ stacked: true, min: 0, max: 100, ticks: { stepSize: 25, callback: v => v + '%' } }) },
    });
  }
  // 4. 運動消耗
  const ab = activityByDay(S.activity, S.exercise), ak = from(Object.keys(ab).filter(d => ab[d].hc + ab[d].manual > 0));
  if (ak) {
    const ax = span(ak), g = k => ax.map(d => (ab[d] && ab[d][k] ? Math.round(ab[d][k]) : null));
    sp.push({
      id: 'move', group: 'more', screenOnly: true, title: '運動消耗', dates: ax,
      note: '每天運動消耗的熱量（估算）。「手機／手錶」是 Health Connect 讀到的，「自己記的」是在「飲食運動」頁手動加的。手錶通常會高估，所以加回的點數只算 75%。',
      extra: i => (ab[ax[i]] ? ['加回 ' + p1(ab[ax[i]].refund) + ' 點'] : ['這天沒有運動記錄']),
      cfg: { type: 'bar', data: { labels: ax.map(md), datasets: [{ label: '手機／手錶', data: g('hc'), backgroundColor: wc }, { label: '自己記的', data: g('manual'), backgroundColor: c3 }] },
        options: sopt({ stacked: true, beginAtZero: true }) },
    });
  }
  // 5. 用藥準時率（每週）
  const medFirst = [...(S.medLog || []).map(x => x.date), ...dsAll.map(e => e.date), ...(P2.meds || []).map(m => m && m.since).filter(Boolean)].sort()[0];
  const wks = medFirst ? medAdherence(P2.meds, S.medLog, S.entries, cut && cut > medFirst ? cut : medFirst, yday, P2.weekStart === 'sun' ? 'sun' : 'mon') : [];
  if (wks.length) {
    // 圖太難看懂：改成每週一行文字，新的在上面，最多 8 週
    const lines = wks.slice(-8).reverse().map(w => {
      const parts = [md(w.start) + ' 週'];
      if (w.need) parts.push('藥 ' + w.taken + '/' + w.need + ' 次（準時 ' + w.onTime + '）');
      for (const d of w.doses) parts.push('打針 ' + md(d.date) + (d.ok === true ? ' ✓' : d.gap ? '・隔 ' + d.gap + ' 天' : ''));
      if (parts.length === 1) parts.push('沒有要吃的藥');
      return parts.join('・');
    });
    sp.push({
      id: 'meds', group: 'more', screenOnly: true, title: '用藥記錄', dates: wks.map(w => w.start), textRows: lines,
      note: '每週一行（從週' + (P2.weekStart === 'sun' ? '日' : '一') + '開始）。「藥 12/14 次」＝該吃 14 次、按了「已服用」12 次；準時＝在設定時間前後 1 小時內按的。打針 ✓＝跟上一針隔 6～8 天。漏按也會算成沒吃。',
    });
  }
  // 長期攝取指數（只在畫面上，截圖已有文字）：淡點是每天比例，粗線是長期指數
  const ltr = longTermRows(longTermStatus().lt.series, cut);
  if (ltr.dates.length) {
    const r2 = a => a.map(v => (v == null ? null : +v.toFixed(2)));
    sp.push({
      id: 'lt', title: '長期攝取指數', dates: ltr.dates, screenOnly: true,
      refs: [{ y: 1, label: '1.0' }, { y: 0.8, label: '0.8' }],
      note: '粗線是長期指數，淡點是每天吃進的熱量 ÷ 基礎代謝。虛線 1.0＝平均每天剛好吃到基礎代謝；0.8 以下代表熱量持續偏低。剛開始記錄的前幾週線會跳比較大，記滿 21 天後比較準。沒記錄或沒記完整的日子不畫點。',
      extra: i => (ltr.kcal[i] == null ? ['這天沒記錄或沒記完整'] : ['吃了約 ' + Math.round(ltr.kcal[i]) + ' 大卡']),
      cfg: {
        type: 'line', data: { labels: ltr.dates.map(md), datasets: [dots('每天', r2(ltr.ratio), c3), trend('長期指數', r2(ltr.index), wc)] },
        options: { maintainAspectRatio: false, plugins: { legend: leg() }, scales: { x: { grid: grid(), ticks: tk() }, y: { grid: grid(), suggestedMin: 0.6, suggestedMax: 1.4 } } },
      },
    });
  }
  for (const x of sp) { if (x.cfg) x.cfg.plugins = [refPlugin(x)]; for (const pt of x.parts || []) pt.cfg.plugins = []; }
  return sp;
}

/** 觸控提示框與垂直參考線 */
export function addHover(sp, pal) {
  if (sp.parts) { for (const pt of sp.parts) addHover(pt, pal); return; }
  const o = sp.cfg.options;
  o.interaction = { mode: 'index', intersect: false, axis: 'x' };
  o.plugins = o.plugins || {};
  o.plugins.tooltip = {
    mode: 'index', intersect: false, padding: 10, titleFont: { size: 13 }, bodyFont: { size: 13 }, footerFont: { size: 12, weight: 'normal' },
    filter: it => !/^(過重|肥胖) /.test(it.dataset.label || ''),
    callbacks: { ...(sp.label ? { label: sp.label } : {}), title: it => (it.length && sp.dates ? fullDate(sp.dates[it[0].dataIndex]) : ''), footer: it => (it.length && sp.extra ? sp.extra(it[0].dataIndex) : []) },
  };
  sp.cfg.plugins = (sp.cfg.plugins || []).concat(crosshair(pal.mu));
}

/* ---------- 給 AI 分析：圖表截圖、數據摘要 ---------- */
let expBlob = null, expUrl = '';
const LIGHT = { tx: '#14212b', mu: '#5d6b78', ln: '#d5dde4', wc: '#0f766e', dc: '#0e7490', rc: '#c2410c', c3: '#7c3aed', c4: '#15803d' };

/** 所有圖表合成一張高解析度圖片（淺色底，不受深色模式影響） */
async function exportCharts(range, bpv) {
  await loadChart();
  const specs = byOrder(chartSpecs(LIGHT, range, bpv).filter(x => !x.screenOnly));
  if (!specs.length) throw new Error('目前沒有可以畫的圖表。');
  const font = '"Noto Sans TC",system-ui,sans-serif';
  // 最後一格放文字摘要（長期攝取指數、淨體重、斷食），兩欄剛好排滿
  const lts = longTermStatus(), lsm = leanSummary(leanStatus()), fsp = specs.find(x => x.id === 'fast');
  const notes = [];
  if (lts.lt.ready) notes.push('長期攝取指數 ' + lts.lt.index.toFixed(2) + '（1.0＝平均每天吃到基礎代謝的量）：' + (lts.msg || '正常範圍') + '。');
  else notes.push('長期攝取指數：資料累積中（有效記錄 ' + lts.lt.validDays + '／21 天）。');
  if (lsm) { notes.push(lsm.line + '。' + lsm.levelText); if (lsm.lost) notes.push(lsm.lost); }
  else if (S.entries.some(e => e.wt > 0 && e.fat > 0)) { const lt0 = leanStatus(); notes.push('淨體重：資料累積中（要比較兩段 28 天的平均）' + (lt0.readyIn ? '，約 ' + lt0.readyIn + ' 天後有判讀' : '') + '。'); }
  if (fsp && fsp.sub) notes.push('斷食：' + fsp.sub + '。');
  const slots = specs.length + 1;
  const cols = 2, rows = Math.ceil(slots / cols);
  const CW = 1100, CH = 520, PAD = 40, HEAD = 170, TIT = 64;
  const W = cols * CW + (cols + 1) * PAD, H = HEAD + rows * (TIT + CH + PAD);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  const es = sortEntries(S.entries), dates = es.map(e => e.date), pf = S.profile;
  g.fillStyle = LIGHT.tx; g.font = 'bold 46px ' + font; g.fillText('MetaPulse 記錄：圖表總覽', PAD, 72);
  g.fillStyle = LIGHT.mu; g.font = '28px ' + font;
  g.fillText('資料期間 ' + (dates.length ? dates[0] + ' 到 ' + dates[dates.length - 1] : '無') + '（共 ' + es.length + ' 筆記錄）', PAD, 116);
  const prof = [];
  if (+pf.height > 0) prof.push('身高 ' + pf.height + ' cm');
  if (+pf.targetWeight > 0) prof.push('目標體重 ' + pf.targetWeight + ' kg');
  if (es.some(e => e.dose > 0)) prof.push('藥物半衰期 ' + (+pf.halfLife || 120) + ' 小時');
  if (range !== 'all') prof.push('範圍 近 ' + range + ' 天');
  prof.push('產生於 ' + localDate(new Date()));
  g.fillText(prof.join('　|　'), PAD, 152);
  const prev = { color: Chart.defaults.color, size: Chart.defaults.font.size };
  Chart.defaults.color = LIGHT.mu; Chart.defaults.font.size = 22;
  try {
    specs.forEach((sp, i) => {
      const x = PAD + (i % cols) * (CW + PAD), y = HEAD + Math.floor(i / cols) * (TIT + CH + PAD);
      g.fillStyle = LIGHT.tx; g.font = 'bold 32px ' + font; g.fillText(sp.title, x, y + 36);
      if (sp.sub) { const tw = g.measureText(sp.title).width; g.fillStyle = LIGHT.mu; g.font = '26px ' + font; g.fillText('　' + sp.sub, x + tw, y + 36); }
      try {
        const parts = sp.parts || [{ cfg: sp.cfg }], ph = Math.floor(CH / parts.length);
        parts.forEach((pt, k) => {
          const oc = document.createElement('canvas'); oc.width = CW; oc.height = ph - (sp.parts ? 30 : 0);
          Object.assign(pt.cfg.options, { responsive: false, animation: false, devicePixelRatio: 1, maintainAspectRatio: false });
          const c = new Chart(oc, pt.cfg);
          if (sp.parts) { g.fillStyle = LIGHT.mu; g.font = 'bold 22px ' + font; g.fillText(pt.title, x, y + TIT + k * ph + 22); }
          g.drawImage(oc, x, y + TIT + k * ph + (sp.parts ? 30 : 0)); c.destroy();
        });
      } catch (e) { g.fillStyle = '#b91c1c'; g.font = '28px ' + font; g.fillText('這張圖產生失敗', x, y + TIT + 44); }
    });
  } finally { Chart.defaults.color = prev.color; Chart.defaults.font.size = prev.size; }
  drawNotes(g, notes, specs.length, { cols, CW, CH, PAD, HEAD, TIT, font });
  const blob = await new Promise(res => { try { cv.toBlob(res, 'image/png'); } catch (e) { res(null); } });
  if (!blob) throw new Error('圖片太大，這個瀏覽器做不出來。可以把範圍改成「近 30 天」再試。');
  return { blob, W, H };
}

/** 截圖最後一格：文字摘要（自動換行） */
function drawNotes(g, notes, i, o) {
  const x = o.PAD + (i % o.cols) * (o.CW + o.PAD), y = o.HEAD + Math.floor(i / o.cols) * (o.TIT + o.CH + o.PAD);
  g.fillStyle = LIGHT.tx; g.font = 'bold 32px ' + o.font; g.fillText('文字摘要', x, y + 36);
  g.fillStyle = '#f3f6f4'; g.fillRect(x, y + o.TIT, o.CW, o.CH);
  g.fillStyle = LIGHT.tx; g.font = '28px ' + o.font;
  let ty = y + o.TIT + 52;
  for (const t of notes) {
    let line = '';
    for (const ch of t) {
      if (g.measureText(line + ch).width > o.CW - 60) { g.fillText(line, x + 30, ty); ty += 42; line = ch; } else line += ch;
    }
    if (line) { g.fillText(line, x + 30, ty); ty += 42; }
    ty += 18;
  }
  g.fillStyle = LIGHT.mu; g.font = '24px ' + o.font; g.fillText('以上是估計與趨勢，不是診斷。', x + 30, y + o.TIT + o.CH - 30);
}

const fileName = () => 'metapulse-charts-' + localDate(new Date()) + '.png';
const b64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

function download(blob) {
  const a = h('a', { href: expUrl || URL.createObjectURL(blob), download: fileName() });
  document.body.append(a); a.click(); a.remove();
}
/** 分享圖片：APK 用原生分享，手機瀏覽器用系統分享，都不行就下載 */
async function shareImage(blob) {
  const Sh = capPlugin('Share'), Fs = capPlugin('Filesystem');
  if (Sh && Fs) {
    const w = await Fs.writeFile({ path: fileName(), data: await b64(blob), directory: 'CACHE' });
    await Sh.share({ title: 'MetaPulse 圖表', files: [w.uri] });
    return;
  }
  const f = new File([blob], fileName(), { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: 'MetaPulse 圖表' }); return; }
  download(blob);
}

function aiCard(range, bpv) {
  const msg = h('div.mu.tiny', { style: { marginTop: '8px', lineHeight: 1.6 } });
  const aiTip = tip('「給醫生參考的報告」會把最近幾週的重點整理成一段文字並複製：體重和淨體重、注射劑量、副作用、血壓、蛋白質、斷食、吃藥和肌力訓練，回診時可以給醫師看，或傳到 LINE 存著。勾「給 AI」後按鈕變成「傳給 AI」：前面加上請 AI 分析的說明、後面接完整數據，再附上圖表圖片，一起送到你在「設定」→「AI 辨識食物」選的預設 AI，幫你整理要問醫師的問題（網頁沒辦法替你按送出，最後一步要自己按）。「圖表下載」把所有圖表合成一張圖。裡面有你的健康資料，傳出去前請自己評估隱私。');
  const withPrompt = h('input', { type: 'checkbox', checked: !!L.reportAi });
  const weeksPick = pills([[4, '4 週'], [8, '8 週'], [12, '12 週']], +L.reportWeeks || 8, v => { L.reportWeeks = v; commitLocal(); });
  const ta = h('textarea', { rows: 6, readOnly: true, style: { display: 'none', marginTop: '8px' } });
  const img = h('img', { alt: '圖表截圖', style: { width: '100%', borderRadius: '8px', marginTop: '10px', background: '#fff', display: 'none' } });
  const imgBtns = h('div.grid2', { style: { marginTop: '8px', display: 'none' } });
  const makeImg = async () => {
    const r = await exportCharts(range, bpv);
    expBlob = r.blob;
    try { if (expUrl) URL.revokeObjectURL(expUrl); } catch (e) { /* 略過 */ }
    expUrl = URL.createObjectURL(r.blob);
    img.src = expUrl; img.style.display = ''; imgBtns.style.display = '';
    return r;
  };
  const shot = h('button.ghost.full', { type: 'button', style: { marginTop: '8px' } }, '圖表下載');
  shot.onclick = async () => {
    shot.disabled = true; msg.textContent = '正在產生圖片…';
    try {
      const r = await makeImg();
      msg.textContent = '已產生 ' + r.W + ' × ' + r.H + ' 的圖片。';
      try { await shareImage(expBlob); } catch (e) { if (!(e && (e.name === 'AbortError' || /cancel/i.test(e.message || '')))) download(expBlob); }
    } catch (e) { msg.textContent = '產生圖片失敗：' + (e.message || e); }
    shot.disabled = false;
  };
  const share = h('button.ghost', { type: 'button' }, '分享或儲存');
  share.onclick = async () => {
    try { await shareImage(expBlob); }
    catch (e) { if (!(e && (e.name === 'AbortError' || /cancel/i.test(e.message || '')))) download(expBlob); }
  };
  const copyImg = h('button.ghost', { type: 'button' }, '複製圖片');
  copyImg.onclick = async () => {
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': expBlob })]); toast('已複製圖片'); }
    catch (e) { toast('這裡不能複製圖片，請改用「分享或儲存」', true); }
  };
  imgBtns.append(share, copyImg);
  const sum = h('button.pri.full', { type: 'button', style: { marginTop: '8px' } });
  const label = () => { sum.textContent = withPrompt.checked ? '傳給 ' + aiName() : '給醫生參考的報告'; };
  withPrompt.onchange = () => { L.reportAi = withPrompt.checked; commitLocal(); label(); };
  label();
  const reportText = () => {
    const today = localDate(new Date()), rep = doctorReport(S, plan(), today, +L.reportWeeks || 8);
    if (!withPrompt.checked) return rep;
    const full = buildSummary(S, plan(), today, true), i = full.indexOf('【MetaPulse 記錄');
    return full.slice(0, i) + rep + '\n\n' + full.slice(i);
  };
  sum.onclick = async () => {
    const t = reportText();
    ta.value = t; ta.style.display = '';
    const ok = await copyText(t, ta);           // 先複製（要在按下去的當下做，瀏覽器才允許）
    if (!withPrompt.checked) {
      msg.textContent = ok ? '已複製（' + t.length + ' 字），可以貼到 LINE 或給醫師看。下面是內容。' : '沒辦法自動複製，請在下面的框裡全選後複製。';
      return;
    }
    const ai = aiName();
    sum.disabled = true; msg.textContent = '正在產生圖表圖片…';
    let blob = null;
    try { blob = (await makeImg()).blob; } catch (e) { msg.textContent = '圖片沒做出來，只送文字。'; }
    sum.disabled = false;
    const r = await shareToAi(t, blob, fileName());
    if (r === 'shared') { msg.textContent = '請在分享清單選 ' + ai + '。' + (ok ? '文字也已複製，萬一沒帶過去就貼上。' : ''); return; }
    if (r === 'cancel') { msg.textContent = '已取消分享。' + (ok ? '文字已複製，可以自己貼到 ' + ai + '。' : ''); return; }
    if (blob) download(blob);
    const opened = openAi();
    msg.textContent = (ok ? '文字已複製' : '請在下面的框裡全選後複製') + (blob ? '，圖片已下載' : '') + '。' + (opened ? '已打開 ' + ai + '，' : '到你的 AI ') + '貼上文字' + (blob ? '、附上圖片' : '') + '再送出。';
  };
  return h('div.card', fold('chart-ai', h('h2', { style: { margin: 0 } }, '回診報告'), [h('div', { style: { marginTop: '10px' } },
    weeksPick,
    h('label.row.one', { style: { color: 'var(--tx)', marginTop: '10px', fontSize: '15px' } }, withPrompt, '給 AI：加說明、完整數據和圖表'),
    sum, shot, aiTip, msg, ta, img, imgBtns)], { open: false }));
}

/** 圖表順序：身體變化 → 用藥 → 斷食與飲食 → 血壓（飲食・運動・用藥、長期攝取指數另外排在斷食後面） */
const ORDER = ['w', 'bmi', 'lean', 'bc', 'bm', 'd', 'fast', 'food', 'bp'];
const byOrder = list => list.map((x, i) => [x, i]).sort((a, b) => {
  const ia = ORDER.indexOf(a[0].id), ib = ORDER.indexOf(b[0].id);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[1] - b[1];
}).map(x => x[0]);

let live = [];

/* 點圖表以外的地方（空白處、別的卡片）就把細節框收起來；手機上 Chart.js 點過的細節框會一直留著 */
document.addEventListener('pointerdown', ev => {
  for (const c of live) {
    if (!c || !c.canvas || c.canvas === ev.target) continue;
    if (c.tooltip && c.tooltip.getActiveElements().length) { c.tooltip.setActiveElements([], { x: 0, y: 0 }); c.setActiveElements([]); c.update('none'); }
  }
}, true);
const OPEN_DEFAULT = { w: true };

/** keep = 按選項重畫：畫面停在原來的位置（重畫時頁面會暫時變短，瀏覽器會捲回最上面） */
export async function renderCharts(root, keep = false) {
  if (!keep) {   // 每次進圖表頁回到預設：只開體重，其他收起（不記上次）
    for (const k of Object.keys(L.collapsed || {})) if (k.startsWith('chart-')) delete L.collapsed[k];
    return drawCharts(root);
  }
  const y = window.scrollY;
  root.style.minHeight = root.offsetHeight + 'px';
  try { await drawCharts(root); }
  finally { window.scrollTo(0, y); requestAnimationFrame(() => { root.style.minHeight = ''; window.scrollTo(0, y); }); }
}

async function drawCharts(root) {
  live.forEach(c => c && c.destroy()); live = [];
  root.textContent = '';
  const any = S.entries.some(e => e.wt > 0 || e.dose > 0 || e.sys > 0 || e.fat > 0 || e.mus > 0 || e.vis > 0 || e.bage > 0 || e.bmr > 0)
    || S.meals.length || (S.exercise || []).length || (S.activity || []).length || (S.medLog || []).length;
  if (!any) {
    root.append(theoryCard());
    root.append(h('div.card', h('div.empty', '還沒有可以畫圖的資料。到「身體」新增，或到「設定」→「備份與匯入」把同步版的記錄搬過來。')));
    if (!longTermStatus().lt.series.length) { root.append(longTermStatusCard()); return; }
    try { await loadChart(); } catch (e) { root.append(longTermStatusCard()); return; }
    chartDefaults();
    return root.append(ltCard(chartSpecs(palette(), 'all').find(x => x.id === 'lt')));
  }
  const range = L.chartRange || 'all', bpv = L.chartBp || 'all';
  const charts = () => [...root.querySelectorAll('details')].filter(d => d.dataset.chart);
  const bulk = open => () => { if (!setFolds(charts(), open)) toast(open ? '已經全部打開' : '已經全部收起'); };
  root.append(h('div.card', h('div.row.between', h('b.small', '範圍'), pills([['30', '近 30 天'], ['90', '近 90 天'], ['all', '全部']], range, v => { L.chartRange = v; commitLocal(); renderCharts(root, true); }))));
  // 所有圖表放在同一張卡，每張圖一行（名稱＋摘要），點了才展開（使用者要全收時一頁看完）
  const list = h('div.card.chartlist', h('div.row.between', h('b.small', '圖表'), h('div.row', { style: { gap: '14px' } },
    h('button.link.small', { type: 'button', onclick: bulk(true) }, '全開'), h('button.link.small', { type: 'button', onclick: bulk(false) }, '全收'))));
  const wait = h('div.card', h('div.row.small.mu', h('span.spin'), '正在準備圖表…'));
  root.append(wait);
  try { await loadChart(); } catch (e) {
    wait.textContent = ''; wait.append(h('div.notice', '畫圖的程式下載失敗。請確認有連上網路，再重新整理頁面。')); return;
  }
  wait.remove();
  root.append(aiCard(range, bpv), list);
  const pal = chartDefaults();
  let ltSp = null;
  const more = [], moreDraw = [], moreD = fold('chart-more', h('div.grow', h('h2', { style: { margin: 0 } }, '飲食・運動・用藥'), h('div.mu.small.one', { style: { marginTop: '2px' } }, '點數存摺、進食時間、營養素、運動、用藥記錄')), more);
  moreD.dataset.chart = 1;
  const late = [];   // 血壓放最後
  for (const sp of byOrder(chartSpecs(pal, range, bpv))) {
    if (sp.exportOnly) continue;
    if (sp.id === 'lt') { ltSp = sp; continue; }
    if (sp.textRows) {   // 只有文字、沒有圖
      const d = fold('chart-' + sp.id, h('b', sp.title), [h('div', { style: { marginTop: '6px' } }, ...sp.textRows.map(t => h('div.small.num.one', { style: { padding: '3px 0' } }, t)), tip(sp.note))]);
      d.dataset.chart = 1;
      more.push(h('div', { style: { borderTop: '1px solid var(--ln)', marginTop: '10px', paddingTop: '10px' } }, d));
      continue;
    }
    addHover(sp, pal);
    const cv = h('canvas', { style: { touchAction: 'pan-y' } });
    const body = [];
    if (sp.id === 'bp') body.push(h('div', { style: { margin: '10px 0 4px' } }, pills([['all', '全部'], ['day', '每日'], ['ampm', '早晚']], bpv, v => { L.chartBp = v; commitLocal(); renderCharts(root, true); })));
    const cvs = (sp.parts || [{ cfg: sp.cfg }]).map((pt, i) => {
      const c0 = i === 0 && !sp.parts ? cv : h('canvas', { style: { touchAction: 'pan-y' } });
      if (sp.parts) body.push(h('div.small', { style: { marginTop: '10px', fontWeight: 650 } }, pt.title));
      body.push(h('div', { style: { position: 'relative', height: sp.parts ? '130px' : '250px', marginTop: sp.parts ? '2px' : '10px' } }, c0));
      return [c0, pt.cfg];
    });
    if (sp.id === 'fast') body.push(h('button.link.small', { type: 'button', onclick: () => openJournal() }, '改斷食記錄 ›'));
    if (sp.note) body.push(tip(sp.note));
    const inner = sp.group === 'more';
    let head = inner ? h('b', sp.title) : h('h2', { style: { margin: 0 } }, sp.title);
    if (sp.id === 'lean') { const lp = leanParts(); head = h('div.grow', head, lp.sum); body.push(h('div', { style: { marginTop: '10px' } }, lp.body)); }
    else if (sp.sub) head = h('div.grow', head, h('div.mu.small.one', { style: { marginTop: '2px' } }, sp.sub));
    const d = fold('chart-' + sp.id, head, body, { open: !!OPEN_DEFAULT[sp.id] });
    d.dataset.chart = 1;
    let chart = null;
    const draw = () => {
      if (chart || !d.open || (inner && !moreD.open)) return;
      try { for (const [c0, cfg] of cvs) { chart = new Chart(c0, cfg); live.push(chart); } }
      catch (e) { body[body.length - 1].after?.(h('div.notice', '圖表產生失敗：' + (e.message || e))); }
    };
    d.addEventListener('toggle', draw);
    if (inner) { moreD.addEventListener('toggle', draw); moreDraw.push(draw); more.push(h('div', { style: { borderTop: '1px solid var(--ln)', marginTop: '10px', paddingTop: '10px' } }, d)); continue; }
    if (sp.id === 'bp') { late.push([d, draw]); continue; }
    list.append(d);
    draw();
  }
  if (more.length) { moreD.append(...more); list.append(moreD); moreDraw.forEach(f => f()); }
  list.append(ltCard(ltSp).firstChild);
  for (const [d, draw] of late) { list.append(d); draw(); }
  const lf = labFold(pal); if (lf) list.append(lf);
  list.append(theoryCard().firstChild);   // 瘦身循環：理論說明放最後一行
}

function chartDefaults() {
  const pal = palette();
  Chart.defaults.color = pal.mu;
  Chart.defaults.font.family = 'system-ui,-apple-system,"Noto Sans TC",sans-serif';
  return pal;
}

/** 長期攝取指數卡：圖在上、現況說明在下；摺疊打開時才畫 */
function ltCard(sp) {
  if (!sp) return longTermStatusCard();
  addHover(sp, palette());
  const cv = h('canvas', { style: { touchAction: 'pan-y' } });
  const card = longTermStatusCard([h('div', { style: { position: 'relative', height: '250px', marginTop: '10px' } }, cv)], '圖：' + sp.note);
  const d = card.querySelector('details');
  d.dataset.chart = 1;
  let chart = null;
  const draw = () => { if (chart || !d.open) return; try { chart = new Chart(cv, sp.cfg); live.push(chart); } catch (e) { cv.after(h('div.notice', '圖表產生失敗：' + (e.message || e))); } };
  d.addEventListener('toggle', draw);
  requestAnimationFrame(draw);                    // 等卡片放進畫面再畫，才量得到大小
  return card;
}

/** 抽血：挑一個項目畫歷次數字；有報告參考範圍就畫上下限虛線（不跟著上面的範圍選項，抽血間隔很長） */
function labFold(pal) {
  const labs = [...(S.labs || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
  const keys = [...new Set(labs.flatMap(x => Object.keys(x.v)))].filter(k => labHistory(labs, k).some(p => typeof p.val === 'number')).sort(labSort);
  if (!keys.length) return null;
  if (!keys.includes(L.chartLab)) L.chartLab = keys.includes('hba1c') ? 'hba1c' : keys[0];
  const sel = h('select', { 'aria-label': '項目', style: { marginTop: '8px' } }, ...keys.map(k => h('option', { value: k }, labName(k) + '（' + labHistory(labs, k).length + ' 次）')));
  sel.value = L.chartLab;
  const box = h('div', { style: { position: 'relative', height: '220px', marginTop: '8px' } });
  const note = h('div.mu.tiny.one', { style: { marginTop: '4px' } });
  const last = labs[labs.length - 1];
  const d = fold('chart-labs', h('div.grow', h('h2', { style: { margin: 0 } }, '抽血'), h('div.mu.small.one', { style: { marginTop: '2px' } }, '最近 ' + last.date.replace(/-/g, '/') + '・' + keys.length + ' 個項目')),
    [sel, box, note, tip('挑一個項目看歷次的數字。虛線是報告上寫的參考範圍（最近一次有讀到範圍才畫）。不跟著上面的「範圍」，抽血通常幾個月一次，所以全部畫出來。')]);
  d.dataset.chart = 1;
  let chart = null;
  const draw = () => {
    if (!d.open) return;
    if (chart) { chart.destroy(); live = live.filter(c => c !== chart); chart = null; }
    const k = sel.value, hs = labHistory(labs, k).filter(p => typeof p.val === 'number');
    const rf = [...labs].reverse().map(x => (x.r || {})[k]).find(Boolean);
    note.textContent = (labUnit(k) ? '單位 ' + labUnit(k) : '') + (rf ? (labUnit(k) ? '・' : '') + '參考範圍 ' + refText(rf) : '');
    const labels = hs.map(p => p.date.slice(2).replace(/-/g, '/'));
    const ds = [{ label: labName(k), data: hs.map(p => p.val), borderColor: pal.wc, backgroundColor: pal.wc, pointRadius: 4, tension: 0, spanGaps: true }];
    if (rf && rf[1] != null) ds.push({ label: '上限', data: hs.map(() => rf[1]), borderColor: pal.rc, borderDash: [5, 4], borderWidth: 1, pointRadius: 0 });
    if (rf && rf[0] != null) ds.push({ label: '下限', data: hs.map(() => rf[0]), borderColor: pal.mu, borderDash: [5, 4], borderWidth: 1, pointRadius: 0 });
    box.textContent = '';
    const cv = h('canvas', { style: { touchAction: 'pan-y' } }); box.append(cv);
    try {
      chart = new Chart(cv, { type: 'line', data: { labels, datasets: ds }, options: { maintainAspectRatio: false, animation: false, plugins: { legend: { display: ds.length > 1, labels: { boxWidth: 12 } } }, scales: { x: { grid: { display: false } } } } });
      live.push(chart);
    } catch (e) { box.append(h('div.notice', '圖表產生失敗：' + (e.message || e))); }
  };
  sel.onchange = () => { L.chartLab = sel.value; commitLocal(); draw(); };
  d.addEventListener('toggle', draw);
  requestAnimationFrame(draw);
  return d;
}
