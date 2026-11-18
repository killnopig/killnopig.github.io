/* 一餐回饋：整理給 AI 的資料（純函數），以及沒有 AI 時的本機備用文字。
 * CHEERS 是沒有 AI 時隨機挑一句的鼓勵話，可以自己增刪。 */

export const CHEERS = [
  '願意把吃了什麼記下來，就是很溫柔的自我照顧。',
  '不需要完美，只要比昨天多了解自己一點就很好。',
  '每一餐都是新的開始，慢慢來，穩穩走。',
  '你正在一點一點建立屬於自己的節奏。',
  '照顧身體不是比賽，今天的你已經很努力了。',
  '吃得安心、記得誠實，這兩件事你都做到了。',
  '改變是一次次小選擇累積起來的，這一餐也算一次。',
];

const r1 = x => Math.round(x * 10) / 10;
const half = x => Math.round(x * 2) / 2;

/**
 * @param meals  這一餐的品項（已有合計 kcal/protein/... 與 points）
 * @param b      budget() 結果
 * @param u      usage() 結果（已包含這一餐）
 */
export function adviceContext(meals, b, u, now = new Date()) {
  const sum = k => meals.reduce((a, m) => a + (+m[k] || 0), 0);
  const ctx = {
    時間: now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0'),
    這一餐: meals.map(m => ({ 名稱: m.name, 熱量kcal: Math.round(m.kcal), 蛋白質g: r1(m.protein), 碳水g: r1(m.carb), 脂肪g: r1(m.fat), 纖維g: r1(m.fiber), 點數: m.points })),
    這一餐合計: { 點數: half(sum('points')), 熱量kcal: Math.round(sum('kcal')), 蛋白質g: r1(sum('protein')) },
    今天累計: { 餐數: u.today.count, 點數: half(u.today.points), 熱量kcal: Math.round(u.today.kcal), 蛋白質g: r1(u.today.protein) },
  };
  if (b && b.ok) {
    ctx.目標 = {
      每日平均點數: b.dailyPoints, 每日保底點數: b.floorPoints, 每日蛋白質目標g: b.proteinTarget,
      近7天點數池: b.poolPoints, 近7天已用: half(u.rolling), 近7天剩餘: half(b.poolPoints - u.rolling),
      今天蛋白質還差g: Math.max(0, Math.round(b.proteinTarget - u.today.protein)),
    };
  }
  return ctx;
}

/** 沒有 AI（未設定 key 或呼叫失敗）時的簡單回饋 */
export function fallbackAdvice(ctx, rand = Math.random) {
  const m = ctx.這一餐合計, g = ctx.目標;
  const review = '這一餐約 ' + m.點數 + ' 點、' + m.熱量kcal + ' 大卡，蛋白質 ' + m.蛋白質g + ' g。'
    + (m.蛋白質g >= 25 ? '蛋白質很充足。' : m.蛋白質g >= 15 ? '蛋白質還不錯。' : '');
  let next = '';
  if (g) {
    if (g.今天蛋白質還差g > 20) next = '今天蛋白質還差約 ' + g.今天蛋白質還差g + ' g，下一餐可以考慮豆腐、蛋、魚或雞肉。';
    else next = '今天的蛋白質已接近目標，下一餐可以多一點蔬菜，份量照自己的飽足感就好。';
    if (ctx.今天累計.點數 < g.每日保底點數 && Number(ctx.時間.split(':')[0]) >= 17) next += '今天吃得比保底少，記得別讓自己太餓。';
    else if (g.近7天剩餘 < 0) next += '近 7 天的點數已經用完，接下來可以選清淡一點、蛋白質為主的組合。';
  }
  return { review, next, cheer: CHEERS[Math.floor(rand() * CHEERS.length)], local: true };
}
