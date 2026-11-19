/* 數據摘要（純文字，給 AI 搭配圖表圖片分析）：移植同步版的摘要，另外加上飲食、斷食、運動消耗的統計（純函數） */
import { sortEntries, onBoard, dn, fromDn } from './records.js';
import { localDate } from './points.js';
import { leanTrend, leanSummary } from './longterm.js';
import { fastSegments } from './fasting.js';

const f = (n, d = 1) => (+n).toFixed(d);
const sg = n => { const r = Math.round(n * 10) / 10; return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r).toFixed(1); };
const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
const H = 3600000;
export const MAX_FAST_H = 48;

/** 每天的飲食合計：{ 'YYYY-MM-DD': {points,kcal,protein,carb,fat,fiber,meals} } */
export function dailyFood(meals) {
  const o = {}, groups = {};
  for (const m of meals || []) {
    const d = localDate(m.at), x = o[d] || (o[d] = { points: 0, kcal: 0, protein: 0, carb: 0, fat: 0, fiber: 0, meals: 0 });
    for (const k of ['points', 'kcal', 'protein', 'carb', 'fat', 'fiber']) x[k] += +m[k] || 0;
    const g = d + '|' + (m.group || m.id);
    if (!groups[g]) { groups[g] = 1; x.meals++; }
  }
  return o;
}

/**
 * 每天的斷食時數：只用斷食記錄（使用者按的「開始斷食」「結束斷食」，或自己改過、補記的），不從餐點去猜。
 * 依結束那天歸類，取每天最長的一段；進行中的不算。
 * @returns { 'YYYY-MM-DD': 小時 }
 */
export function dailyFast(meals, fasts) {
  const d = dailyFastDetail(meals, fasts), o = {};
  for (const k in d) o[k] = d[k].hours;
  return o;
}

/** 同 dailyFast，另外附上那段斷食的開始、結束時間與記錄：{ 'YYYY-MM-DD': {hours, start, end, rec, count} } */
export function dailyFastDetail(meals, fasts) {
  const out = {};
  for (const x of fastSegments(fasts)) {
    const d = localDate(new Date(x.end));
    const c = (out[d] ? out[d].count : 0) + 1;
    if (!out[d] || out[d].hours < x.hours) out[d] = { hours: x.hours, start: x.start, end: x.end, rec: x.rec, count: c };
    else out[d].count = c;
  }
  return out;
}

/** 最近幾天的斷食，新的在前：[{date, hours, start, end}]。每天一筆（那天結束的最長一段），跟圖表一樣 */
export function recentFasts(meals, fasts, today, days = 14) {
  const d = dailyFastDetail(meals, fasts), from = fromDn(dn(today) - (days - 1));
  return Object.keys(d).filter(k => k >= from && k <= today).sort().reverse().map(k => ({ date: k, ...d[k] }));
}

/**
 * @param S 狀態；P 點數預算（plan()）；today 'YYYY-MM-DD'
 */
export function buildSummary(S, P, today, withPrompt = true) {
  const es = sortEntries(S.entries || []), T = dn(today), L = [];
  const pf = S.profile || {}, HT = +pf.height || 0, TW = +pf.targetWeight || 0, HL = +pf.halfLife || 120;
  const daily = k => { const m = {}; es.forEach(e => { if (e[k] > 0) (m[e.date] = m[e.date] || []).push(e[k]); }); return Object.keys(m).sort().map(d => ({ d, n: dn(d), v: avg(m[d]) })); };
  const win = (a, from, to) => a.filter(x => x.n >= T - from && x.n <= T - to);
  const ds = es.filter(e => e.dose > 0), bs = es.filter(e => e.sys > 0 && e.dia > 0);
  const food = dailyFood(S.meals), fast = dailyFast(S.meals, S.fasts);
  const act = {}; [...(S.activity || []), ...(S.exercise || [])].forEach(a => { if (a.kcal > 0) act[a.date] = (act[a.date] || 0) + a.kcal; });   // 自動匯入＋手動記的運動

  if (withPrompt) {
    L.push('請根據以下數據（以及我另外附上的圖表圖片，如果有），協助分析：');
    L.push('1. 體重、血壓、體組成、飲食、斷食和注射劑量之間的趨勢與可能的關聯。');
    L.push('2. 值得留意的變化或異常，並說明這份資料的限制。');
    L.push('3. 我可以向醫師、藥師或營養師詢問的問題清單。');
    L.push('請不要做診斷，也不要建議調整劑量。');
    L.push('');
  }
  L.push('【MetaPulse 記錄：數據摘要】');
  const dates = es.map(e => e.date);
  L.push('產生日期 ' + today + '。身體記錄期間 ' + (dates.length ? dates[0] + ' 到 ' + dates[dates.length - 1] : '無') + '，共 ' + es.length + ' 筆；餐點 ' + (S.meals || []).length + ' 道。');
  const prof = [];
  if (HT > 0) prof.push('身高 ' + HT + ' cm');
  if (TW > 0) prof.push('目標體重 ' + TW + ' kg');
  if (ds.length) prof.push('藥物半衰期設定 ' + HL + ' 小時（用於估算殘留量）');
  if (P && P.ok) prof.push('每日點數約 ' + P.dailyPoints + '（7 天共 ' + P.poolPoints + '，1 點約 40 大卡）、每日保底 ' + P.floorPoints + ' 點、蛋白質目標 ' + P.proteinTarget + ' g、估計每日消耗 ' + Math.round(P.tdee) + ' 大卡');
  if (prof.length) L.push('個人設定：' + prof.join('；') + '。');

  if (ds.length) {
    L.push(''); L.push('■ 注射');
    const first = ds[0], last = ds[ds.length - 1];
    L.push('- 共 ' + ds.length + ' 次，第一次 ' + first.date + '（' + first.dose + ' mg），最近一次 ' + last.date + '（' + last.dose + ' mg），距今 ' + (T - dn(last.date)) + ' 天。');
    const runs = []; ds.forEach(e => { const r = runs[runs.length - 1]; if (r && r.dose === e.dose) { r.to = e.date; r.n++; } else runs.push({ dose: e.dose, from: e.date, to: e.date, n: 1 }); });
    L.push('- 劑量歷程：' + runs.map(r => r.dose + ' mg（' + r.from + (r.to !== r.from ? ' 到 ' + r.to : '') + '，' + r.n + ' 次）').join('；') + '。');
    const gaps = []; for (let i = 1; i < ds.length; i++) gaps.push({ g: dn(ds[i].date) - dn(ds[i - 1].date), a: ds[i - 1].date, b: ds[i].date });
    if (gaps.length) {
      const odd = gaps.filter(x => x.g !== 7);
      L.push('- 注射間隔（天）：平均 ' + f(avg(gaps.map(x => x.g))) + '，最短 ' + Math.min(...gaps.map(x => x.g)) + '，最長 ' + Math.max(...gaps.map(x => x.g)) + '；不是 7 天的共 ' + odd.length + ' 次' + (odd.length ? '（' + odd.slice(-6).map(x => x.a.slice(5) + '→' + x.b.slice(5) + ' ' + x.g + ' 天').join('、') + (odd.length > 6 ? '，僅列最近 6 次' : '') + '）' : '') + '。');
    }
    L.push('- 最近 6 次部位：' + ds.slice(-6).map(e => e.date.slice(5) + ' ' + e.dose + ' mg ' + (e.site || '未記錄')).join('；') + '。');
    L.push('- 依設定估算目前體內殘留約 ' + f(onBoard(es, T, HL)) + ' mg（簡化模型，不是血中濃度）。');
  }

  const W = daily('wt');
  if (W.length) {
    L.push(''); L.push('■ 體重 (kg)');
    const first = W[0], last = W[W.length - 1];
    L.push('- 第一筆 ' + f(first.v) + '（' + first.d + '），最新 ' + f(last.v) + '（' + last.d + '），變化 ' + sg(last.v - first.v) + ' kg（' + sg((last.v - first.v) / first.v * 100) + '%）。');
    const w7 = win(W, 6, 0), w30 = win(W, 29, 0), p30 = win(W, 59, 30), parts = [];
    if (w7.length) parts.push('近 7 天平均 ' + f(avg(w7.map(x => x.v))) + '（' + w7.length + ' 天有記錄）');
    if (w30.length) parts.push('近 30 天平均 ' + f(avg(w30.map(x => x.v))) + '（' + w30.length + ' 天）');
    if (p30.length) parts.push('再前 30 天平均 ' + f(avg(p30.map(x => x.v))) + '（' + p30.length + ' 天）');
    if (parts.length) L.push('- ' + parts.join('；') + '。');
    const mx = W.reduce((a, b) => (b.v > a.v ? b : a)), mn = W.reduce((a, b) => (b.v < a.v ? b : a));
    L.push('- 最高 ' + f(mx.v) + '（' + mx.d + '），最低 ' + f(mn.v) + '（' + mn.d + '）。同一天多筆已取平均。');
    if (TW > 0) L.push('- 目標 ' + TW + ' kg，' + (last.v > TW ? '距離目標還差 ' + f(last.v - TW) + ' kg' : '已達成') + '。');
    if (HT > 0) {
      const m2 = (HT / 100) ** 2, b1 = first.v / m2, b2 = last.v / m2;
      L.push('- BMI：第一筆 ' + f(b1) + '，最新 ' + f(b2) + '（台灣成人標準：' + (b2 < 18.5 ? '過輕' : b2 < 24 ? '正常' : b2 < 27 ? '過重' : '肥胖') + '）。');
    }
  }

  if (bs.length) {
    L.push(''); L.push('■ 血壓與脈搏');
    const bd = new Set(bs.map(e => e.date)), lb = bs[bs.length - 1];
    L.push('- 共 ' + bs.length + ' 次量測，分布在 ' + bd.size + ' 天。最新 ' + lb.sys + '/' + lb.dia + ' mmHg' + (lb.pul > 0 ? '，脈搏 ' + lb.pul : '') + '（' + lb.date + (lb.time ? ' ' + lb.time : '') + '）。');
    const ps = bs.filter(e => e.pul > 0);
    L.push('- 全期平均 ' + f(avg(bs.map(e => e.sys)), 0) + '/' + f(avg(bs.map(e => e.dia)), 0) + (ps.length ? '，脈搏平均 ' + f(avg(ps.map(e => e.pul)), 0) : '') + '；收縮壓範圍 ' + Math.min(...bs.map(e => e.sys)) + '–' + Math.max(...bs.map(e => e.sys)) + '，舒張壓範圍 ' + Math.min(...bs.map(e => e.dia)) + '–' + Math.max(...bs.map(e => e.dia)) + '。');
    const inWin = (a, b2) => bs.filter(e => { const n = dn(e.date); return n >= T - a && n <= T - b2; });
    const r30 = inWin(29, 0), q30 = inWin(59, 30), wl = [];
    if (r30.length) wl.push('近 30 天平均 ' + f(avg(r30.map(e => e.sys)), 0) + '/' + f(avg(r30.map(e => e.dia)), 0) + '（' + r30.length + ' 次）');
    if (q30.length) wl.push('再前 30 天平均 ' + f(avg(q30.map(e => e.sys)), 0) + '/' + f(avg(q30.map(e => e.dia)), 0) + '（' + q30.length + ' 次）');
    if (wl.length) L.push('- ' + wl.join('；') + '。');
    const slots = [['上午（12 點前）', x => x < 12], ['下午（12–18 點）', x => x >= 12 && x < 18], ['晚上（18 點後）', x => x >= 18]];
    const sl = slots.map(([n, fn]) => { const a = bs.filter(e => e.time && fn(parseInt(e.time, 10))); return a.length ? n + ' ' + f(avg(a.map(e => e.sys)), 0) + '/' + f(avg(a.map(e => e.dia)), 0) + '（' + a.length + ' 次）' : ''; }).filter(Boolean);
    if (sl.length) L.push('- 依時段平均：' + sl.join('；') + '。');
    const hi = bs.filter(e => e.sys >= 140 || e.dia >= 90).length, lo = bs.filter(e => e.sys < 90 || e.dia < 60).length;
    L.push('- 數值門檻計數（只是統計，不是診斷）：收縮壓 ≥140 或舒張壓 ≥90 共 ' + hi + ' 次；收縮壓 <90 或舒張壓 <60 共 ' + lo + ' 次。');
    const irr = bs.filter(e => (e.note || '').includes('不規則脈波'));
    if (irr.length) L.push('- 血壓計標記「偵測到不規則脈波」共 ' + irr.length + ' 次，最近 ' + irr.slice(-3).map(e => e.date).join('、') + '。');
  }

  const bodyDefs = [['fat', '體脂率', '%', 1], ['mus', '骨骼肌率', '%', 1], ['vis', '內臟脂肪等級', '', 1], ['bage', '身體年齡', '歲', 0], ['bmr', '基礎代謝', ' kcal', 0]], bl = [];
  bodyDefs.forEach(([k, name, u, d]) => {
    const a = daily(k); if (!a.length) return;
    const first = a[0], last = a[a.length - 1];
    const mx = a.reduce((x, y) => (y.v > x.v ? y : x)), mn = a.reduce((x, y) => (y.v < x.v ? y : x));
    const ago = a.filter(x => x.n <= T - 30).pop(), diff = last.v - first.v;
    bl.push('- ' + name + '：第一筆 ' + f(first.v, d) + u + '（' + first.d + '），最新 ' + f(last.v, d) + u + '（' + last.d + '），變化 ' + (d ? sg(diff) : (diff > 0 ? '+' : diff < 0 ? '−' : '') + Math.abs(Math.round(diff))) + u + '；範圍 ' + f(mn.v, d) + '–' + f(mx.v, d) + (ago ? '；約 30 天前 ' + f(ago.v, d) + '（' + ago.d + '）' : '') + '。');
  });
  if (bl.length) { L.push(''); L.push('■ 體組成（同一天多筆取平均）'); bl.forEach(x => L.push(x)); }
  const lt = leanTrend(es, S.meals, P && P.ok ? P.proteinTarget : 0, today);
  if (lt.ready) {
    L.push('- 淨體重（體重 ×（1 − 體脂率））：最近 28 天平均 ' + f(lt.cur) + ' kg（' + lt.curDays + ' 天），再前 28 天 ' + f(lt.prev) + ' kg（' + lt.prevDays + ' 天），變化 ' + sg(lt.change) + ' kg（' + sg(lt.pct) + '%）' + (lt.protein !== null ? '；同期平均每天蛋白質 ' + f(lt.protein, 0) + ' g' : '') + '。');
    const ls = leanSummary(lt);
    L.push('  判讀（±0.5% 以內算持平、超過 1.5% 算明顯）：' + ls.levelText + (ls.lost ? ' ' + ls.lost : ''));
  }

  // 飲食：只算有記錄的日子（今天還沒結束，不算進平均）
  const fd = Object.keys(food).filter(d => d < today).sort();
  if (fd.length) {
    L.push(''); L.push('■ 飲食（只算有記錄的日子，不含今天）');
    const per = (a, label) => {
      if (!a.length) return;
      const x = k => avg(a.map(d => food[d][k]));
      L.push('- ' + label + '：' + a.length + ' 天有記錄，平均每天 ' + f(x('points')) + ' 點、' + f(x('kcal'), 0) + ' 大卡、蛋白質 ' + f(x('protein'), 0) + ' g、碳水 ' + f(x('carb'), 0) + ' g、脂肪 ' + f(x('fat'), 0) + ' g、纖維 ' + f(x('fiber'), 0) + ' g，' + f(x('meals')) + ' 餐。');
    };
    per(fd.filter(d => dn(d) >= T - 7), '近 7 天');
    per(fd.filter(d => dn(d) >= T - 30), '近 30 天');
    if (P && P.ok) {
      const r30 = fd.filter(d => dn(d) >= T - 30);
      if (r30.length) {
        const low = r30.filter(d => food[d].points < P.floorPoints).length, hiP = r30.filter(d => food[d].protein >= P.proteinTarget).length;
        L.push('- 近 30 天：低於每日保底 ' + P.floorPoints + ' 點的有 ' + low + ' 天；蛋白質達到 ' + P.proteinTarget + ' g 的有 ' + hiP + ' 天。');
      }
    }
    L.push('- 熱量與營養素是照片或文字的 AI 估算，誤差可能不小。');
  }

  const fk = Object.keys(fast).filter(d => dn(d) >= T - 30 && d <= today).sort();
  if (fk.length) {
    L.push(''); L.push('■ 斷食（每天最長的一段，兩餐之間的時間）');
    const x7 = fk.filter(d => dn(d) >= T - 6).map(d => fast[d]), x30 = fk.map(d => fast[d]);
    if (x7.length) L.push('- 近 7 天：' + x7.length + ' 天有資料，平均 ' + f(avg(x7)) + ' 小時。');
    L.push('- 近 30 天：' + x30.length + ' 天有資料，平均 ' + f(avg(x30)) + ' 小時，最長 ' + f(Math.max(...x30)) + ' 小時；16 小時以上 ' + x30.filter(v => v >= 16).length + ' 天、20 小時以上 ' + x30.filter(v => v >= 20).length + ' 天。');
    L.push('- 依餐點記錄的時間推算；漏記一餐時，斷食時間會被高估（兩餐相隔超過 48 小時視為漏記，不計入）。');
  }

  const ak = Object.keys(act).filter(d => dn(d) >= T - 30 && d < today);
  if (ak.length) { L.push(''); L.push('■ 運動消耗（自動匯入＋手動記錄）'); L.push('- 近 30 天：' + ak.length + ' 天有資料，平均每天 ' + f(avg(ak.map(d => act[d])), 0) + ' 大卡（手機 App 和估算通常會高估）。'); }

  // 每週摘要（最近 12 週，週一起算）
  const dow = n => (new Date(n * 864e5).getUTCDay() + 6) % 7, mon = n => n - dow(n), startWk = mon(T) - 11 * 7, wk = {};
  const wkOf = n => { const m = mon(n); return m < startWk ? null : (wk[m] = wk[m] || { dose: [], wt: [], sys: [], dia: [], fat: [], pts: [], fast: [] }); };
  es.forEach(e => {
    const o = wkOf(dn(e.date)); if (!o) return;
    if (e.dose > 0) o.dose.push(e.dose + ' mg' + (e.site ? '（' + e.site + '）' : ''));
    if (e.wt > 0) o.wt.push(e.wt);
    if (e.sys > 0 && e.dia > 0) { o.sys.push(e.sys); o.dia.push(e.dia); }
    if (e.fat > 0) o.fat.push(e.fat);
  });
  fd.forEach(d => { const o = wkOf(dn(d)); if (o) o.pts.push(food[d].points); });
  Object.keys(fast).forEach(d => { const o = wkOf(dn(d)); if (o) o.fast.push(fast[d]); });
  const keys = Object.keys(wk).map(Number).sort((a, b) => a - b);
  if (keys.length) {
    L.push(''); L.push('■ 每週摘要（最近 12 週，週一起算）');
    keys.forEach(m => {
      const o = wk[m], p = [];
      if (ds.length) p.push('注射 ' + (o.dose.length ? o.dose.join('、') : '無'));
      if (o.wt.length) p.push('體重 ' + f(avg(o.wt)) + '（' + o.wt.length + ' 筆）');
      if (o.sys.length) p.push('血壓 ' + f(avg(o.sys), 0) + '/' + f(avg(o.dia), 0) + '（' + o.sys.length + ' 次）');
      if (o.fat.length) p.push('體脂 ' + f(avg(o.fat)) + '%');
      if (o.pts.length) p.push('每天 ' + f(avg(o.pts)) + ' 點（' + o.pts.length + ' 天）');
      if (o.fast.length) p.push('斷食平均 ' + f(avg(o.fast)) + ' 小時');
      if (p.length) L.push(fromDn(m) + ' 起：' + p.join(' | '));
    });
  }

  const rows = [];
  for (let n = T - 13; n <= T; n++) {
    const d = fromDn(n), day = es.filter(e => e.date === d), p = [];
    const w = day.filter(e => e.wt > 0), b = day.filter(e => e.sys > 0 && e.dia > 0), z = day.filter(e => e.dose > 0);
    if (w.length) p.push('體重 ' + f(avg(w.map(e => e.wt))));
    if (b.length) p.push('血壓 ' + f(avg(b.map(e => e.sys)), 0) + '/' + f(avg(b.map(e => e.dia)), 0) + (b.length > 1 ? ' ×' + b.length : ''));
    if (z.length) p.push('注射 ' + z.map(e => e.dose + ' mg').join('、'));
    if (food[d]) p.push(f(food[d].points) + ' 點 ' + f(food[d].kcal, 0) + ' 大卡 蛋白質 ' + f(food[d].protein, 0) + ' g' + (d === today ? '（今天還沒結束）' : ''));
    if (fast[d]) p.push('斷食 ' + f(fast[d]) + ' 小時');
    if (act[d]) p.push('運動 ' + act[d] + ' 大卡');
    if (p.length) rows.push(d.slice(5) + '：' + p.join(' | '));
  }
  if (rows.length) { L.push(''); L.push('■ 最近 14 天逐日'); rows.forEach(x => L.push(x)); }
  L.push('');
  L.push('※ 以上資料由使用者自行記錄或匯入；殘留量、BMI、熱量與營養素都是估計，不是診斷依據。');
  return L.join('\n');
}

/** 每天的進食時間窗：第一道到最後一道的時間（依吃的那天歸類）：{ 'YYYY-MM-DD': {start, end, hours, meals} } */
export function eatingWindows(meals) {
  const o = {}, groups = {};
  for (const m of meals || []) {
    if (m.pending) continue;
    const t = new Date(m.at).getTime(); if (!Number.isFinite(t)) continue;
    const d = localDate(m.at), x = o[d] || (o[d] = { start: t, end: t, hours: 0, meals: 0 });
    if (t < x.start) x.start = t; if (t > x.end) x.end = t;
    const g = d + '|' + (m.group || m.id);
    if (!groups[g]) { groups[g] = 1; x.meals++; }
  }
  for (const d in o) o[d].hours = (o[d].end - o[d].start) / H;
  return o;
}

/** 三大營養素佔熱量的比例（估算：蛋白質、碳水每克 4 大卡，脂肪 9 大卡）：{ 'YYYY-MM-DD': {p, c, f（%）, protein, carb, fat（g）} } */
export function macroSplit(food) {
  const o = {};
  for (const d in food || {}) {
    const x = food[d], kp = x.protein * 4, kc = x.carb * 4, kf = x.fat * 9, t = kp + kc + kf;
    if (!(t > 0)) continue;
    const p = Math.round(kp / t * 100), f2 = Math.round(kf / t * 100);
    o[d] = { p, c: 100 - p - f2, f: f2, protein: x.protein, carb: x.carb, fat: x.fat };
  }
  return o;
}
