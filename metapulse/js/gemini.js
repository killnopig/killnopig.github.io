/* Gemini API：照片或文字 → 食物清單（共用同一個 JSON schema）
 * 預設使用 Interactions API（/v1beta/interactions + response_format），
 * 失敗時退回 generateContent（generationConfig.responseJsonSchema）。 */

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const num = d => ({ type: 'number', description: d });

export const FOOD_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      description: '辨識到的每一道食物或飲料',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '食物名稱（繁體中文、台灣常用說法）' },
          servings: num('畫面中或描述中大約吃了幾份'),
          servingGrams: num('一份大約幾克（飲料用毫升約等於克）'),
          fistsPerServing: { type: ['number', 'null'], description: '一份大約幾個拳頭大小；一顆蛋、一杯飲料、一片吐司等不適合用拳頭估的填 null' },
          kcal: num('一份的熱量 kcal'),
          protein: num('一份的蛋白質 g'),
          carb: num('一份的碳水化合物 g'),
          fat: num('一份的脂肪 g'),
          fiber: num('一份的膳食纖維 g'),
        },
        required: ['name', 'servings', 'servingGrams', 'fistsPerServing', 'kcal', 'protein', 'carb', 'fat', 'fiber'],
      },
    },
    note: { type: 'string', description: '簡短說明估算的不確定處，可為空字串' },
  },
  required: ['items'],
};

const INSTRUCTIONS = `你是營養估算助手。請辨識使用者的餐點，列出每一道食物或飲料。
規則：
1. 名稱用繁體中文、台灣常用說法。同一盤裡明顯不同的食物分開列（例如「牛肉麵」與「滷蛋」）。
2. 營養素一律填「一份」的數值；servings 填實際吃了幾份。
3. 份量依台灣常見份量估計；不確定時取中間值，不要誇大。
4. fistsPerServing：一般成人拳頭大小約 1 杯（約 240 ml）。顆、片、杯、瓶這類以個數計的食物填 null。
5. 看不出是食物時，items 回傳空陣列，並在 note 說明。`;

function parseJSON(t) {
  const s = String(t || '').replace(/```(json)?/g, '').trim();
  return JSON.parse(s);
}

function clean(out) {
  const items = (out && Array.isArray(out.items) ? out.items : []).map(x => ({
    name: String(x.name || '未命名').trim(),
    servings: +x.servings > 0 ? +x.servings : 1,
    servingGrams: +x.servingGrams > 0 ? +x.servingGrams : 0,
    fistsPerServing: +x.fistsPerServing > 0 ? +x.fistsPerServing : null,
    per: { kcal: +x.kcal || 0, protein: +x.protein || 0, carb: +x.carb || 0, fat: +x.fat || 0, fiber: +x.fiber || 0 },
  }));
  return { items, note: String(out?.note || '') };
}

async function post(url, key, body, signal) {
  const r = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch (e) { /* 非 JSON */ }
  if (!r.ok) {
    const msg = j?.error?.message || txt.slice(0, 200) || ('HTTP ' + r.status);
    const err = new Error(msg); err.status = r.status; throw err;
  }
  return j;
}

async function viaInteractions({ key, model, prompt, schema, image, signal, fast }) {
  const input = [{ type: 'text', text: prompt }];
  if (image) input.push({ type: 'image', data: image.data, mime_type: image.mime });
  const body = { model, input, response_format: { type: 'text', mime_type: 'application/json', schema } };
  if (fast) body.generation_config = { thinking_level: 'minimal' };
  const j = await post(BASE + '/interactions', key, body, signal);
  if (j?.errors?.length) throw new Error(j.errors[0].message || 'Gemini 回傳錯誤');
  let out = j?.output_text;
  if (!out) for (const s of j?.steps || []) if (s.type === 'model_output') for (const c of s.content || []) if (c.type === 'text') out = (out || '') + c.text;
  if (!out) throw new Error('AI 沒有回覆內容，請再試一次');
  return out;
}

async function viaGenerateContent({ key, model, prompt, schema, image, signal, fast }) {
  const parts = [{ text: prompt }];
  if (image) parts.push({ inline_data: { mime_type: image.mime, data: image.data } });
  const generationConfig = { responseMimeType: 'application/json', responseJsonSchema: schema };
  if (fast) generationConfig.thinkingConfig = { thinkingLevel: 'minimal' };
  const j = await post(BASE + '/models/' + encodeURIComponent(model) + ':generateContent', key, {
    contents: [{ role: 'user', parts }], generationConfig,
  }, signal);
  const out = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  if (!out) throw new Error('AI 沒有回覆內容，請再試一次' + (j?.promptFeedback?.blockReason ? '（' + j.promptFeedback.blockReason + '）' : ''));
  return out;
}

const VIA = { interactions: viaInteractions, generateContent: viaGenerateContent };
const fatal = e => e.name === 'AbortError' || e.status === 401 || e.status === 403 || e.status === 429;

/** 少思考模式：模型不支援 minimal 時（400），自動改用不指定思考程度再試一次 */
async function callApi(name, o) {
  try { return await VIA[name](o); }
  catch (e) {
    if (o.fast && e.status === 400 && /think/i.test(e.message)) return VIA[name]({ ...o, fast: false });
    throw e;
  }
}

/** 共用：送出 prompt（可附圖），依 schema 取回 JSON。自動模式下先試上次成功的 API。 */
async function callJSON(o, prompt, schema) {
  if (!o.key) throw new Error('請先到「設定」輸入 AI 的 API 金鑰');
  if (!o.model) throw new Error('請先到「設定」選擇 AI 模型');
  const t0 = Date.now();
  const api = o.api || 'auto';
  const args = { ...o, prompt, schema, fast: o.fast !== false };
  let raw, used;
  if (api !== 'auto') { raw = await callApi(api, args); used = api; }
  else {
    const first = o.prefer === 'generateContent' ? 'generateContent' : 'interactions';
    const second = first === 'interactions' ? 'generateContent' : 'interactions';
    try { raw = await callApi(first, args); used = first; }
    catch (e) {
      if (fatal(e)) throw e;
      raw = await callApi(second, args); used = second;
    }
  }
  let parsed;
  try { parsed = parseJSON(raw); } catch (e) { throw new Error('AI 回覆的格式不正確，請再試一次'); }
  return { parsed, raw, api: used, ms: Date.now() - t0 };
}

/**
 * 辨識餐點
 * @param {{key, model, api:'auto'|'interactions'|'generateContent', prefer?:string, fast?:boolean,
 *          text?:string, image?:{data:string(base64), mime:string},
 *          fix?:{was:string, text:string}, signal?}} o
 *   prefer：自動模式下先試的 API（上次成功的那一種）
 *   fix：修正重新辨識（原本辨識成什麼、使用者的修正說明），只回傳這一項
 * @returns {Promise<{items, note, raw, api, ms}>}
 */
export async function analyzeMeal(o) {
  let text;
  if (o.fix) {
    text = '先前辨識成「' + o.fix.was + '」，但使用者修正為：「' + o.fix.text + '」。'
      + '請以使用者的修正為準，' + (o.image ? '參考照片中對應的那一項，' : '') + '只估算這一項食物（若修正內容包含多樣食物才分開列）。';
  } else {
    text = o.image ? '請辨識這張照片中的餐點。' + (o.text ? '補充說明：' + o.text : '') : '使用者描述的餐點：' + o.text;
  }
  const r = await callJSON(o, INSTRUCTIONS + '\n\n' + text, FOOD_SCHEMA);
  return { ...clean(r.parsed), raw: r.raw, api: r.api, ms: r.ms };
}

export const ADVICE_SCHEMA = {
  type: 'object',
  properties: {
    review: { type: 'string', description: '對這一餐的簡短回饋，1～2 句' },
    next: { type: 'string', description: '下一餐可以考慮的方向，1～2 句，可舉 2～3 個台灣常見的食物例子' },
    cheer: { type: 'string', description: '一句溫暖、鼓勵的話（心靈雞湯）' },
  },
  required: ['review', 'next', 'cheer'],
};

const ADVICE_RULES = `你是溫和的飲食記錄夥伴，用繁體中文（台灣用語）回覆。
規則：
1. 只提醒、不下指令：不要用「必須」「應該」「現在該…」這類命令句，改用「可以考慮」「或許」「如果方便的話」。
2. 不批評、不製造罪惡感；吃多了也只是溫和地說明，並肯定記錄這件事本身。
3. 不提供醫療、藥物或診斷建議，不提斷食時數的要求。
4. 下一餐的建議以蛋白質、蔬菜與份量為主，參考今天還剩的點數與蛋白質缺口；如果今天點數已偏少（低於保底），溫和提醒別吃得太少。
5. 每段簡短，不要列點、不要用 emoji 以外的符號標題。`;

/** 這一餐的回饋、下一餐建議與一句鼓勵 */
export async function mealAdvice(o, context) {
  const prompt = ADVICE_RULES + '\n\n以下是資料（JSON）：\n' + JSON.stringify(context);
  const r = await callJSON(o, prompt, ADVICE_SCHEMA);
  const p = r.parsed || {};
  return { review: String(p.review || ''), next: String(p.next || ''), cheer: String(p.cheer || ''), ms: r.ms, api: r.api };
}

/** 週報總結：一段白話總結＋下週可以試的一個小方向（不給醫療指示） */
export const WEEKLY_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, tip: { type: 'string' } },
  required: ['summary', 'tip'],
};
const WEEKLY_RULES = `你是溫和的飲食記錄小幫手，用台灣繁體中文、國中生看得懂的口語。
根據使用者這一週的點數記錄寫：
- summary：2～3 句，先肯定做得好的地方，再點出一個可以注意的地方（例如超標的日子、蛋白質、記錄天數）。
- tip：下週可以試的一個具體小方向，一句話。
規則：
1. 點數約 40 大卡＝1 點；「存摺」是每天剩下的點數加總，正數代表有熱量赤字。
2. 不要診斷、不要建議藥物或劑量、不要叫人少吃到很極端；如果吃得太少，要溫和提醒吃夠。
3. 不要用簡體字，不要列點，不要加表情符號。`;
export async function weeklySummary(o, stats) {
  const r = await callJSON(o, WEEKLY_RULES + '\n\n以下是這週的資料（JSON）：\n' + JSON.stringify(stats), WEEKLY_SCHEMA);
  const p = r.parsed || {};
  return { summary: String(p.summary || ''), tip: String(p.tip || '') };
}

/** 推薦這週吃什麼：7 天、每天幾餐，每餐菜名＋估算點數與蛋白質 */
export const RECIPE_SCHEMA = {
  type: 'object',
  properties: {
    days: {
      type: 'array', description: '從今天起連續 7 天，依序排列',
      items: {
        type: 'object',
        properties: {
          meals: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '這一餐吃什麼，例如「鮭魚飯糰＋茶葉蛋＋無糖豆漿」，最多 20 個字' },
                points: num('這一餐估算點數（約 40 大卡＝1 點）'),
                protein: num('這一餐估算蛋白質 g'),
                tag: { type: 'string', description: '常吃、新的、外食、超商、自己煮 其中一個' },
                how: { type: 'string', description: '自己煮的菜寫 1～2 句簡單做法，其他留空字串' },
              },
              required: ['name', 'points', 'protein', 'tag', 'how'],
            },
          },
        },
        required: ['meals'],
      },
    },
    note: { type: 'string', description: '一句整體提醒，可為空字串' },
  },
  required: ['days'],
};
const RECIPE_RULES = `你是溫和的飲食安排小幫手，用台灣繁體中文、國中生看得懂的口語。
依照資料排出接下來 7 天的餐點建議，每天的餐數照「每天餐數」。
規則：
1. 每天的點數合計接近「每日點數」，不要少於它的 8 成，也不要多於它；每餐大約是「每餐大約點數」。點數約 40 大卡＝1 點。
2. 依「選項」安排。有「新食物規定」時一定要照做，這條比「每天不要都一樣」更重要；沒有「常吃組合」時不要排使用者常吃的東西。
3. 用台灣常見、買得到的食物，7 天不要每天都一樣。
4. 只是建議，不要用命令句；不要提藥物、劑量、斷食時數或減重效果；不要建議極端少吃。
5. 不要用簡體字，不要加表情符號。`;
export async function recipePlan(o, ctx) {
  const r = await callJSON({ ...o, fast: false }, RECIPE_RULES + '\n\n以下是資料（JSON）：\n' + JSON.stringify(ctx), RECIPE_SCHEMA);
  return { parsed: r.parsed, api: r.api, ms: r.ms };
}

/** 推薦菜色的說明：材料、做法（外食寫怎麼點）、哪裡買得到（店的類型） */
export const DISH_SCHEMA = {
  type: 'object',
  properties: {
    ingredients: { type: 'string', description: '材料，一行，用頓號分開；外食或超商可以留空字串' },
    steps: { type: 'array', items: { type: 'string' }, description: '自己煮：3～5 步做法；外食或超商：2～4 句怎麼點、怎麼搭比較好' },
    where: { type: 'array', items: { type: 'string' }, description: '哪裡買得到，寫店的類型（例如 超商、便當店、自助餐、麵店、傳統市場、超市），2～4 個' },
  },
  required: ['ingredients', 'steps', 'where'],
};
const DISH_RULES = `你是溫和的飲食小幫手，用台灣繁體中文、國中生看得懂的口語，說明一道推薦的餐點。
規則：
1. 每句話簡短；做法用家裡常見的廚具，不要太難。
2. 「哪裡買得到」只寫店的類型，不要寫特定品牌或店名，也不要寫價格。
3. 只是建議，不要用命令句；不要提藥物、斷食或減重效果。
4. 不要用簡體字，不要加表情符號。`;
export async function dishDetail(o, dish) {
  const r = await callJSON(o, DISH_RULES + '\n\n餐點：' + dish.name + (dish.tag ? '（類型：' + dish.tag + '）' : ''), DISH_SCHEMA);
  return { parsed: r.parsed, api: r.api };
}

/** Omron 截圖判讀：讀出畫面上每一次量測的數字 */
const n0 = d => ({ type: 'number', description: d + '；畫面上沒有就填 0' });
export const SHOT_SCHEMA = {
  type: 'object',
  properties: {
    readings: {
      type: 'array', description: '畫面上的每一次量測（同一時間量的放同一筆）',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '量測日期 YYYY-MM-DD；畫面上看不出來填空字串' },
          time: { type: 'string', description: '量測時間 HH:MM（24 小時制）；看不出來填空字串' },
          sys: n0('收縮壓（最高血壓）mmHg'), dia: n0('舒張壓（最低血壓）mmHg'), pul: n0('脈搏 次/分'),
          wt: n0('體重 kg'), fat: n0('體脂肪率 %'), mus: n0('骨骼肌率 %'), vis: n0('內臟脂肪等級'),
          bage: n0('身體年齡 歲'), bmr: n0('基礎代謝 kcal'),
        },
        required: ['date', 'time', 'sys', 'dia', 'pul', 'wt', 'fat', 'mus', 'vis', 'bage', 'bmr'],
      },
    },
    note: { type: 'string', description: '看不清楚或不確定的地方，可為空字串' },
  },
  required: ['readings'],
};
const SHOT_RULES = `這是 OMRON connect App（歐姆龍血壓計、體重體脂計）的手機截圖。
請只照畫面上清楚顯示的數字填寫，不要猜、不要換算；看不到的項目填 0。
日期如果只有月日，年份用今天的年份（今天是 {TODAY}）；寫「今天」就用今天的日期。
圖表上的刻度、目標值、平均值不是量測值，不要填。`;
export async function readOmronShot(o, image, todayStr) {
  const r = await callJSON({ ...o, image, fast: false }, SHOT_RULES.replace('{TODAY}', todayStr), SHOT_SCHEMA);
  return { parsed: r.parsed, api: r.api };
}

/** 健檢報告、抽血單照片 → 每個檢驗項目的名稱、數值、單位、參考範圍 */
export const LAB_SCHEMA = {
  type: 'object',
  properties: {
    date: { type: 'string', description: '報告上的採檢（抽血）日期 YYYY-MM-DD；民國年請換成西元；看不出來填空字串' },
    items: {
      type: 'array', description: '報告上的每一個檢驗項目',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '項目名稱，照報告上寫的（例如 Glu-AC、HbA1c、總膽固醇）' },
          value: { type: 'string', description: '檢驗結果，照報告上寫的（例如 5.7、<0.5、陰性）；不要加單位' },
          unit: { type: 'string', description: '單位；沒有填空字串' },
          ref: { type: 'string', description: '參考範圍／正常值，照報告上寫的（例如 70-100、<5.7）；沒有填空字串' },
          date: { type: 'string', description: '這一項的日期（報告上有好幾次時才填，YYYY-MM-DD），否則填空字串' },
        },
        required: ['name', 'value', 'unit', 'ref', 'date'],
      },
    },
    note: { type: 'string', description: '看不清楚或可能讀錯的地方，一句話；沒有填空字串' },
  },
  required: ['date', 'items', 'note'],
};
const LAB_RULES = `這是一張健康檢查報告或醫院抽血檢驗報告的照片。
請逐項列出報告上的檢驗項目：名稱、結果、單位、參考範圍，全部照報告上寫的抄，不要換算、不要猜、不要判斷好壞。
看不清楚的項目不要填。表頭、醫院名稱、病歷號、姓名等個人資料不要填。
日期用採檢（抽血）日期；民國年換成西元（113 年 = 2024 年）；今天是 {TODAY}。`;
export async function readLabShot(o, image, todayStr) {
  const r = await callJSON({ ...o, image, fast: false }, LAB_RULES.replace('{TODAY}', todayStr), LAB_SCHEMA);
  return { parsed: r.parsed, api: r.api };
}

/** 適合辨識餐點的預設模型清單（還沒向 Google 查詢時使用） */
export const DEFAULT_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-4-hydrogen', 'gemini-4-argon'];

/** 向 Google 查詢這把 key 能用的模型（只留能產生文字的 Gemini 模型） */
export async function listModels(key, signal) {
  if (!key) throw new Error('請先輸入 API 金鑰');
  const names = [];
  let token = '';
  for (let i = 0; i < 5; i++) {
    const r = await fetch(BASE + '/models?pageSize=1000' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { headers: { 'x-goog-api-key': key }, signal });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error?.message || 'HTTP ' + r.status);
    for (const m of j?.models || []) {
      const id = String(m.name || '').replace(/^models\//, '');
      const methods = m.supportedGenerationMethods || m.supportedActions || [];
      if (!/^gemini/i.test(id)) continue;
      if (/embedding|tts|image|audio|live|transcribe|robotics|computer-use/i.test(id)) continue;
      if (methods.length && !methods.some(x => /generateContent|interaction/i.test(x))) continue;
      names.push(id);
    }
    token = j?.nextPageToken;
    if (!token) break;
  }
  return sortModels([...new Set(names)]);
}

/** 排序：新版號在前；同版號 lite → flash → 其他；預覽、實驗版放後面 */
export function sortModels(list) {
  const ver = id => { const m = id.match(/gemini-(\d+(?:\.\d+)?)/); return m ? +m[1] : 0; };
  const tier = id => /preview|exp|latest/.test(id) ? 1 : 0;
  const kind = id => /flash-lite/.test(id) ? 0 : /flash/.test(id) ? 1 : 2;
  return list.slice().sort((a, b) => tier(a) - tier(b) || ver(b) - ver(a) || kind(a) - kind(b) || a.localeCompare(b));
}

/** 把照片縮小成 JPEG（送 API 用 768；縮圖用 200） */
export function shrinkImage(file, maxW = 768, quality = 0.8, byWidth = false) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxW / (byWidth ? img.width : Math.max(img.width, img.height)));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const dataUrl = c.toDataURL('image/jpeg', quality);
      resolve({ dataUrl, data: dataUrl.split(',')[1], mime: 'image/jpeg' });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('無法讀取這張圖片')); };
    img.src = url;
  });
}
