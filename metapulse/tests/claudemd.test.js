// 檢查 CLAUDE.md 有沒有過時：提到的檔案、函式還在不在，模組清單有沒有漏。
// 只做機械比對，不花 AI 用量。失敗時再請 Claude 修 CLAUDE.md 那幾行。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(join(ROOT, p), 'utf8');
const doc = read('CLAUDE.md');

// 不在這個 repo 裡的名稱（APK 專案 ~/metapulse-app、Android 系統、gitignore 的檔案、外部套件）
const EXTERNAL = new Set([
  'PROMPT.md', 'LANDING_PROMPT.md', 'keystore.properties',
  'android/app/build.gradle', 'android/app/src/main/AndroidManifest.xml',
  'MainActivity', 'OnBackPressedCallback', 'MapleWidget', 'MapleWidgetPlugin',
  'FastingWidget', 'FastingTermWidget', 'FastingSmallWidget', 'FastingWidget.compute',
  'Chronometer', 'versionCode', 'versionName', 'server.url',
  'dose-tracker-sync.json', 'dosetrack-v1-sync', 'maple_widget',
  'speechSynthesis', 'afconvert', 'generateContent', 'drive.appdata', 'metapulse.json',
  'FB_PAGE_ID', 'FB_PAGE_TOKEN', 'MetaPulse.apk', 'fb.png',
]);

function walk(dir, out = []) {
  for (const n of readdirSync(join(ROOT, dir))) {
    const p = dir ? `${dir}/${n}` : n;
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const jsFiles = walk('js').filter(p => p.endsWith('.js'));
const source = [...jsFiles, 'index.html'].map(read).join('\n');

// CLAUDE.md 裡所有 `反引號` 包起來的字（跳過 ``` 程式碼區塊）
const ticks = [...doc.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`\n]+)`/g)].map(m => m[1].trim());

test('CLAUDE.md：index.html 模組清單跟 js/ 裡的檔案一致', () => {
  const m = read('index.html').match(/var f=\[([^\]]+)\]/);
  assert.ok(m, 'index.html 找不到模組清單 var f=[...]');
  const listed = new Set(m[1].split(',').map(s => s.trim().replace(/'/g, '')));
  const actual = new Set(jsFiles.map(p => p.slice(3, -3)));
  const missing = [...actual].filter(n => !listed.has(n));
  const stale = [...listed].filter(n => !actual.has(n));
  assert.deepEqual(missing, [], `這些模組沒加進 index.html 模組清單：${missing.join(', ')}`);
  assert.deepEqual(stale, [], `模組清單裡有不存在的檔案：${stale.join(', ')}`);
});

test('CLAUDE.md：提到的檔案都還在', () => {
  const isPath = t => /^[\w.~/-]+(\.(js|html|json|md|m4a|css|png|xml|gradle|properties)|\/)$/.test(t) && !/^[~/]/.test(t);
  const tries = t => [t, `js/${t}`, `js/ui/${t.replace(/^ui\//, '')}`, `tests/${t}`, `landing/${t}`];
  const gone = ticks.filter(isPath).filter(t => !EXTERNAL.has(t))
    .filter(t => !tries(t).some(p => existsSync(join(ROOT, p))));
  assert.deepEqual([...new Set(gone)], [], `CLAUDE.md 提到但找不到的檔案：${gone.join(', ')}`);
});

test('CLAUDE.md：提到的函式、變數名稱在程式碼裡找得到', () => {
  const names = ticks
    .map(t => t.replace(/\(.*\)$/, ''))                       // fold() → fold
    .filter(t => /^[A-Za-z_$][\w$]*(\.[\w$]+)*$/.test(t))     // 像程式名稱的才檢查
    .filter(t => !EXTERNAL.has(t) && !/\.(js|html|json|md)$/.test(t));
  const gone = [...new Set(names)].filter(t => {
    const last = t.split('.').pop();                            // S.prefs.weekStart → weekStart
    return !new RegExp(`\\b${last.replace(/\$/g, '\\$')}\\b`).test(source);
  });
  assert.deepEqual(gone, [], `CLAUDE.md 提到但程式碼裡找不到的名稱：${gone.join(', ')}`);
});
