import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMeal, FOOD_SCHEMA } from '../js/gemini.js';

const answer = JSON.stringify({ items: [{ name: '牛肉麵', servings: 1, servingGrams: 600, fistsPerServing: 2, kcal: 550, protein: 30, carb: 70, fat: 15, fiber: 4 }], note: '' });
const res = (status, body) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

test('Interactions API：請求格式與回應解析', async () => {
  let req;
  globalThis.fetch = async (url, o) => { req = { url, body: JSON.parse(o.body), headers: o.headers }; return res(200, { status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: answer }] }] }); };
  const r = await analyzeMeal({ key: 'k', model: 'm', text: '牛肉麵', image: { data: 'AAA', mime: 'image/jpeg' } });
  assert.match(req.url, /\/v1beta\/interactions$/);
  assert.equal(req.headers['x-goog-api-key'], 'k');
  assert.equal(req.body.response_format.mime_type, 'application/json');
  assert.deepEqual(req.body.response_format.schema, FOOD_SCHEMA);
  assert.equal(req.body.input[1].type, 'image');
  assert.equal(r.api, 'interactions');
  assert.equal(r.items[0].name, '牛肉麵');
  assert.equal(r.items[0].per.kcal, 550);
  assert.equal(r.items[0].fistsPerServing, 2);
});

test('自動模式：Interactions 失敗時改用 generateContent', async () => {
  const urls = [];
  globalThis.fetch = async (url, o) => {
    urls.push(url);
    if (url.endsWith('/interactions')) return res(404, { error: { message: 'not found' } });
    const b = JSON.parse(o.body);
    assert.equal(b.generationConfig.responseMimeType, 'application/json');
    assert.ok(b.generationConfig.responseJsonSchema);
    return res(200, { candidates: [{ content: { parts: [{ text: '```json\n' + answer.replace('"fistsPerServing":2', '"fistsPerServing":null') + '\n```' }] } }] });
  };
  const r = await analyzeMeal({ key: 'k', model: 'gemini-x', text: '牛肉麵' });
  assert.equal(urls.length, 2);
  assert.match(urls[1], /models\/gemini-x:generateContent$/);
  assert.equal(r.api, 'generateContent');
  assert.equal(r.items[0].fistsPerServing, null);
});

test('金鑰錯誤（403）不重試，直接回報', async () => {
  let n = 0;
  globalThis.fetch = async () => { n++; return res(403, { error: { message: 'API key not valid' } }); };
  await assert.rejects(analyzeMeal({ key: 'bad', model: 'm', text: 'x' }), /API key not valid/);
  assert.equal(n, 1);
});

test('沒有 key 時提示', async () => {
  await assert.rejects(analyzeMeal({ key: '', model: 'm', text: 'x' }), /API 金鑰/);
});

test('速度優先：送出 thinking_level minimal；不支援時自動拿掉再試', async () => {
  const bodies = [];
  globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body); bodies.push(b);
    if (b.generation_config) return res(400, { error: { message: 'thinking_level is not supported for this model' } });
    return res(200, { steps: [{ type: 'model_output', content: [{ type: 'text', text: answer }] }] });
  };
  const r = await analyzeMeal({ key: 'k', model: 'm', text: 'x' });
  assert.equal(bodies[0].generation_config.thinking_level, 'minimal');
  assert.equal(bodies[1].generation_config, undefined);
  assert.equal(r.api, 'interactions');
  assert.ok(r.ms >= 0);
});

test('自動模式記得上次成功的 API，直接先用它', async () => {
  const urls = [];
  globalThis.fetch = async (url, o) => {
    urls.push(url);
    const b = JSON.parse(o.body);
    assert.equal(b.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
    return res(200, { candidates: [{ content: { parts: [{ text: answer }] } }] });
  };
  const r = await analyzeMeal({ key: 'k', model: 'm', text: 'x', prefer: 'generateContent' });
  assert.equal(urls.length, 1);
  assert.equal(r.api, 'generateContent');
});

test('取得可用模型：只留文字用的 Gemini，lite 排前面', async () => {
  const { listModels } = await import('../js/gemini.js');
  globalThis.fetch = async (url, o) => {
    assert.equal(o.headers['x-goog-api-key'], 'k');
    return { ok: true, status: 200, json: async () => ({ models: [
      { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-4-argon-preview', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-3.5-flash-tts', supportedGenerationMethods: ['generateContent'] },
    ] }) };
  };
  assert.deepEqual(await listModels('k'), ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-4-argon-preview']);
});

test('修正重新辨識：prompt 帶入原本結果與使用者修正，並附照片', async () => {
  let body;
  globalThis.fetch = async (url, o) => { body = JSON.parse(o.body); return res(200, { steps: [{ type: 'model_output', content: [{ type: 'text', text: answer }] }] }); };
  await analyzeMeal({ key: 'k', model: 'm', fix: { was: '炸豬排', text: '是雞胸肉，約 150 g' }, image: { data: 'AAA', mime: 'image/jpeg' } });
  assert.match(body.input[0].text, /先前辨識成「炸豬排」/);
  assert.match(body.input[0].text, /是雞胸肉，約 150 g/);
  assert.equal(body.input[1].type, 'image');
});
