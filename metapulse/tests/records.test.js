import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onBoard, nextSite, nextDose, bmi, leanMass, dn, isDuplicate, planImport } from '../js/records.js';
import { parseSyncBackup, previewImport, applyImport } from '../js/migrate.js';
import { defaultState, timeFromNote } from '../js/storage.js';

test('殘留量與同步版公式相同', () => {
  const es = [{ date: '2026-11-01', dose: 5 }];
  assert.ok(Math.abs(onBoard(es, dn('2026-11-06'), 120) - 2.5) < 1e-9); // 5 天 = 一個半衰期
  assert.equal(onBoard(es, dn('2026-10-31'), 120), 0);
});

test('部位輪替與下次注射', () => {
  const es = [{ date: '2026-11-01', dose: 5, site: '右上臂' }, { date: '2026-11-08', dose: 5, site: '' }];
  assert.equal(nextSite(es), '左腹');
  assert.equal(nextSite([]), '左腹');
  const n = nextDose(es, '2026-11-14');
  assert.equal(n.due, '2026-11-15');
  assert.equal(n.left, 1);
  assert.equal(nextDose(es, '2026-11-17').left, -2);
  assert.equal(nextDose([], '2026-11-17'), null);
});

test('BMI 台灣標準與淨體重', () => {
  assert.equal(bmi(73.5, 175).label, '過重');
  assert.equal(bmi(70, 175).label, '正常');
  assert.equal(bmi(83, 175).label, '肥胖');
  assert.equal(bmi(70, 0), null);
  assert.equal(leanMass({ wt: 80, fat: 25 }), 60);
});

test('量測時間從備註拆出', () => {
  assert.equal(timeFromNote('7:05，偵測到不規則脈波'), '07:05');
  assert.equal(timeFromNote('左腹'), '');
});

test('血壓 2 分鐘內視為同一筆', () => {
  const ex = [{ date: '2026-11-01', sys: 120, dia: 80, pul: 70, time: '07:30' }];
  assert.equal(isDuplicate({ date: '2026-11-01', sys: 120, dia: 80, pul: 0, time: '07:31' }, ex), true);
  assert.equal(isDuplicate({ date: '2026-11-01', sys: 120, dia: 80, time: '07:35' }, ex), false);
});

const syncBackup = JSON.stringify({ entries: [
  { id: 101, date: '2026-10-01', dose: 2.5, wt: 88, site: '左腹', note: '' },
  { id: 102, date: '2026-10-02', sys: 128, dia: 82, pul: 70, note: '07:12，偵測到身體晃動' },
  { id: 103, date: 'bad' },
], hl: 120, h: 175, tw: 78, ts: 1 });

test('從同步版匯入：預覽、帶入個人資料、可重複執行', () => {
  const S = defaultState();
  const p = parseSyncBackup('```json\n' + syncBackup + '\n```');
  assert.equal(p.entries.length, 2);
  assert.equal(p.bad, 1);
  assert.equal(p.entries[1].time, '07:12');
  assert.equal(p.entries[0].sid, '101');
  const pv = previewImport(p, S.entries);
  assert.equal(pv.add.length, 2);
  assert.equal(pv.from, '2026-10-01');
  assert.equal(pv.to, '2026-10-02');
  applyImport(S, pv);
  assert.equal(S.entries.length, 2);
  assert.equal(S.profile.height, 175);
  assert.equal(S.profile.targetWeight, 78);

  // 再匯入一次：全部略過
  const again = previewImport(parseSyncBackup(syncBackup), S.entries);
  assert.equal(again.add.length, 0);
  assert.equal(again.update.length, 0);
  assert.equal(again.dup, 2);

  // 同步版改了一筆、新增一筆
  const b2 = JSON.parse(syncBackup);
  b2.entries[0].wt = 87.6;
  b2.entries.push({ id: 104, date: '2026-10-08', dose: 5, site: '腹中' });
  const pv3 = previewImport(parseSyncBackup(b2), S.entries);
  assert.equal(pv3.update.length, 1);
  assert.equal(pv3.add.length, 1);
  applyImport(S, pv3);
  assert.equal(S.entries.length, 3);
  assert.equal(S.entries.find(e => e.sid === '101').wt, 87.6);
});

test('沒有 sid 的舊資料用內容判斷重複', () => {
  const ex = [{ id: 'x', date: '2026-10-01', dose: 2.5, wt: 88, site: '左腹', time: '' }];
  const pl = planImport([{ date: '2026-10-01', dose: 2.5, wt: 88, site: '左腹', time: '', sid: '9' }], ex);
  assert.equal(pl.dup, 1);
});

test('拒絕 MetaPulse 自己的備份與錯誤內容', () => {
  assert.throws(() => parseSyncBackup('{"entries":[],"meals":[]}'), /MetaPulse/);
  assert.throws(() => parseSyncBackup('hello'), /看不懂/);
});

test('個人資料沒變時不算新資料', () => {
  const p = parseSyncBackup(syncBackup);
  const pv = previewImport(p, [], { height: 175, targetWeight: 78, halfLife: 120 });
  assert.deepEqual(pv.profile, {});
  const pv2 = previewImport(p, [], { height: 170, targetWeight: 78, halfLife: 120 });
  assert.deepEqual(pv2.profile, { height: 175 });
});

test('同步版編號被重複使用：日期不同就當新記錄加入，不會蓋掉舊的', () => {
  const ex = [{ id: 'x', sid: '1567', date: '2026-02-08', wt: 118.7, time: '09:02', sys: 0, dia: 0 }];
  const pl = planImport([{ sid: '1567', date: '2026-11-17', wt: 105.3, time: '06:57', sys: 0, dia: 0 }], ex);
  assert.equal(pl.add.length, 1);
  assert.equal(pl.update.length, 0);
});
