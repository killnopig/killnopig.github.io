/* 所有可調整的係數與門檻集中在這裡。改數字即可，不需要改其他程式。 */

/** 點數：大約 40 kcal ≈ 1 點；蛋白質較便宜、脂肪較貴、纖維折抵。
 *  點數 = 蛋白質g×4÷50 + 碳水g×4÷40 + 脂肪g×9÷35 − 纖維g÷5 */
export const POINTS = {
  proteinKcalPerG: 4, proteinKcalPerPoint: 50,
  carbKcalPerG: 4, carbKcalPerPoint: 40,
  fatKcalPerG: 9, fatKcalPerPoint: 35,
  fiberGPerPoint: 5,
  roundTo: 0.5,
};

/** 預算：TDEE 與 kcal 換算成點數 */
export const BUDGET = {
  kcalPerPoint: 40,          // 週點數池與保底用
  kcalPerKgFat: 7700,        // 每公斤體重約等於多少 kcal 赤字
  maxWeeklyLossPct: 1,       // 每週目標減重上限（佔體重 %）
  defaultWeeklyLossPct: 0.5, // 沒填「預計達成週數」時的預設每週減重（%），使用者可在設定改
  rollingDays: 7,            // 週點數池採 7 天滾動
  proteinPerKgDefault: 1.2,  // 乘的是「調整體重」（體重超過理想體重時），見 points.js proteinGoal
  activityDefault: 1.2,
  exerciseRefund: 0.75,     // 運動回補：消耗 kcal × 0.75 ÷ 40（手錶通常高估消耗）
};

/** 活動係數選項（算 TDEE 用） */
export const ACTIVITY_LEVELS = [
  [1.2, '久坐（幾乎不運動）'],
  [1.375, '輕度（每週運動 1～3 天）'],
  [1.55, '中度（每週運動 3～5 天）'],
  [1.725, '高度（每週運動 6～7 天）'],
];

/** 份量 */
export const PORTION = {
  quick: [0.5, 1, 1.5, 2],
  sliderMin: 0.1, sliderMax: 1.5, sliderStep: 0.05,
};

/** 斷食階段（距上一餐的小時數，寬區間）。文字可以自己改 */
export const FASTING = {
  stages: [
    { from: 0, short: '消化中', text: '消化中，主要使用剛吃進的血糖', fuel: '⚡ 正在用剛吃進來的糖' },
    { from: 4, short: '用肝醣', text: '開始使用儲存的醣類（肝醣）', fuel: '🔋 動用肝臟裡的存糧' },
    { from: 12, short: '燃脂中', text: '逐漸偏向使用脂肪', fuel: '🔥 脂肪開始燃燒' },
    { from: 16, short: '深度斷食', text: '長時間斷食中', fuel: '🔥 脂肪熊熊燃燒中' },
    { from: 20, short: '時間偏長', text: '斷食時間偏長，身體分解蛋白質的比例可能逐漸增加', fuel: '⚠️ 脂肪燃燒，肌肉也可能被動用' },
  ],
  // 上一餐比較大時，所有階段往後挪；特別大的一餐最多挪 2 小時
  bigMeal: { kcal: 800, carb: 100, shift: 1 },
  hugeMeal: { kcal: 1200, carb: 150, shift: 2 },
  barHours: 24,              // 進度條畫到幾小時
  fastingFromHours: 2,       // 自由模式：記完餐沒按「結束進餐」時，距上一餐幾小時後自動算「斷食中」（從上一餐開始算）
  plans: { '16:8': 16, '18:6': 18, '20:4': 20, '24H': 23 },
  freeTargets: [12, 14, 16, 18, 20],   // 自由斷食可選的目標時數
  freeTargetDefault: 16,  // 斷食時數；24H＝一天一餐（約 23 小時斷食＋1 小時進食）
  // 依施打週期建議（只建議、不自動切換；最多到 18:6）
  hybrid: {
    rules: [
      { fromDay: 1, toDay: 3, plan: '18:6' },   // 施打當天＝第 1 天
      { fromDay: 4, toDay: 7, plan: '16:8' },
    ],
    fallback: '16:8',        // 沒有施打記錄、或超過第 7 天
    safer: '16:8',           // 減重太快或長期指數有提示時，一律建議這個
  },
};

/** 長期攝取指數 */
/* 手動記運動：強度（MET，身體活動強度表）；消耗 ≈ MET × 體重(kg) × 小時 */
export const EXERCISES = [
  ['bball', '籃球（比賽、全場）', 8.0], ['bball2', '籃球（投籃、練習）', 4.5], ['softball', '壘球', 5.0],
  ['golf', '高爾夫（走路、揹或拉球具）', 4.8], ['golfcart', '高爾夫（坐球車）', 3.5], ['golfrange', '高爾夫（練習場）', 3.0],
  ['walk', '走路', 3.5], ['brisk', '快走', 4.5], ['run', '跑步', 8.0], ['bike', '騎腳踏車', 6.0],
  ['swim', '游泳', 7.0], ['weights', '重量訓練', 5.0], ['band', '彈力帶訓練', 3.5], ['bodyweight', '徒手肌力（深蹲、伏地挺身）', 3.8],
  ['yoga', '瑜伽、伸展', 2.5], ['other', '其他', 4.0],
];
/** 算「肌力訓練」的運動種類 */
export const STRENGTH = ['weights', 'band', 'bodyweight'];

/** 安全提醒與保住肌肉（只提醒、不擋操作） */
export const SAFETY = {
  hypoHours: 16,            // 有降血糖藥、斷食超過幾小時就提醒留意低血糖
  doseUpDays: 14,           // 加劑量後幾天內，依施打週期一律建議比較溫和的方案
  fastLossPct: 1.5,         // 體重每週下降超過體重的幾 % → 顯示警訊說明
  waterHours: 12,           // 斷食超過幾小時，提醒喝水、補一點鹽
  omadDoseDays: 14,         // 近幾天有打針又選一天一餐 → 提醒
  mealProteinLow: 20,       // 一餐蛋白質少於幾 g 標橘色
  strengthGoal: 2,          // 每 7 天肌力訓練目標次數
  ibwBmi: 22,               // 理想體重＝22 × 身高²
  abwFactor: 0.4,           // 調整體重＝理想體重 + 0.4 ×（實際 − 理想）
};

// 依記錄反推每日消耗（adaptive.js）與趨勢體重
export const ADAPT = {
  weightAlpha: 0.1,          // 趨勢體重：每天往當天體重移 10%
  slopeBeta: 0.1,            // 趨勢體重的斜率也慢慢跟（消掉穩定變瘦時的落後）
  window: 28,                // 看最近 28 天（不含今天）
  minFoodDays: 21,           // 至少 21 天有完整飲食記錄
  minWeighDays: 10,          // 至少 10 天有量體重
  minWeighSpan: 21,          // 第一次和最後一次量體重至少隔 21 天
  clamp: 0.25,               // 反推結果最多和公式差 ±25%（漏記會讓結果偏低）
  fastWeekPct: 1,            // 週報：趨勢體重每週掉超過 1% 變橘色
};

export const LONGTERM = {
  alpha: 0.05,               // 長期指數 = 前一天 × (1 − α) + 當日比例 × α
  minDayRatio: 0.3,          // 當天記錄熱量低於基礎代謝的 30% → 記錄不完整，跳過
  minValidDays: 21,          // 至少累積幾個有效記錄日才顯示提示
  recentDays: 28, recentValidRatio: 0.7,   // 最近 28 天中有效日要佔 70% 以上
  low: 1.0, veryLow: 0.8,
  weightMaDays: 14, fastLossPct: 1,        // 體重 14 天移動平均，每週下降超過體重 1% → 補一句
  // 淨體重趨勢：最近 28 天平均 vs 再前 28 天平均（不看單日；阻抗式體脂每天波動大）
  leanWindow: 28, leanMinDays: 6,          // 每段至少 6 天有體重＋體脂
  leanFlatPct: 0.5,                        // ±0.5% 以內算「幾乎持平」（比體脂機誤差還小）
  leanDropPct: 1.5,                        // 平均下降超過 1.5% 才算「明顯下滑」
  leanMinMealDays: 10,                     // 最近 28 天至少 10 天有餐點記錄，才判斷蛋白質
};
