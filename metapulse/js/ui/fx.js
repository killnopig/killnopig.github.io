/* 按鈕特效與音效（全部原創：CSS 動畫、SVG 齒輪、Web Audio 合成音、手機內建語音）
 * - timeStop()：結束進餐 → 擬聲字「ドドドド」、畫面反色、合成「時間凍結」音，接著播放「砸瓦魯多」（Mac 內建語音錄成的音檔）
 * - gears(after)：結束斷食 → 齒輪由靜止加速轉動、合成喀啦聲，結束後執行 after
 * 設定：L.fxVisual（特效）、L.fxSound（音效）、L.fxVoice（語音），預設都開 */
import { L } from '../state.js';
import { playSound, hasSound, soundDuration } from '../sounds.js';

const on = k => L[k] !== false;
let styled = false;
function style() {
  if (styled) return; styled = true;
  const s = document.createElement('style');
  s.textContent = `
.fx-layer{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;pointer-events:auto;overflow:hidden}
.fx-ts{background:radial-gradient(circle at 50% 60%,rgba(255,255,255,.92),rgba(235,232,245,.88));animation:fxfade var(--d,2.4s) ease forwards}
.fx-do{position:absolute;font:900 48px/1 "Hiragino Sans","Noto Sans JP","Yu Gothic",system-ui,sans-serif;color:#111;letter-spacing:-.08em;white-space:nowrap;
  -webkit-text-stroke:1.5px #111;text-shadow:3px 3px 0 rgba(0,0,0,.18);transform-origin:center;animation:fxpop .55s cubic-bezier(.2,1.6,.4,1) both}
.fx-do i{display:inline-block;font-style:normal;animation:fxshake .16s linear infinite}
.fx-gear{background:radial-gradient(circle,rgba(40,28,8,.55),rgba(0,0,0,.72));animation:fxfade var(--d,2.55s) ease forwards}
.fx-gear svg{width:min(88vw,380px);height:auto;filter:drop-shadow(0 6px 10px rgba(0,0,0,.5))}
.fx-gear .spark{transform-box:fill-box;transform-origin:center;animation:fxtw 1.1s ease-in-out infinite}
.fx-gear .spark:nth-of-type(2n){animation-delay:.35s}.fx-gear .spark:nth-of-type(3n){animation-delay:.7s}
@keyframes fxtw{0%,100%{opacity:0;transform:scale(.3) rotate(0)}50%{opacity:1;transform:scale(1) rotate(45deg)}}
.fx-gear .g1{transform-origin:118px 122px;animation:fxspin var(--d,2.55s) cubic-bezier(.6,0,.4,1) forwards}
.fx-gear .g2{transform-origin:276px 170px;animation:fxspinr var(--d,2.55s) cubic-bezier(.6,0,.4,1) forwards}
.fx-gear .g3{transform-origin:178px 270px;animation:fxspinr var(--d,2.55s) cubic-bezier(.6,0,.4,1) forwards}
.fx-invert{filter:invert(1) hue-rotate(180deg)}
@keyframes fxshake{0%{transform:translate(0,0)}25%{transform:translate(2px,-2px)}50%{transform:translate(-2px,1px)}75%{transform:translate(1px,2px)}100%{transform:translate(0,0)}}
@keyframes fxpop{from{opacity:0;scale:2.4}to{opacity:1;scale:1}}
@keyframes fxfade{0%,75%{opacity:1}100%{opacity:0}}
.fx-gear.stop{animation:fxfade 3.6s ease forwards}
.fx-gear.stop .g1,.fx-gear.stop .g2,.fx-gear.stop .g3{animation-duration:2.85s;animation-timing-function:cubic-bezier(.05,.75,.25,1)}
@keyframes fxspin{to{transform:rotate(540deg)}}
@keyframes fxspinr{to{transform:rotate(-810deg)}}`;
  document.head.appendChild(s);
}

function layer(cls, html, ms, after) {
  style();
  const el = document.createElement('div');
  el.className = 'fx-layer ' + cls;
  if (!/stop/.test(cls)) el.style.setProperty('--d', (ms / 1000) + 's');   // 動畫長度跟著顯示時間（自訂音效較長時）
  el.innerHTML = html;
  let done = false;
  const end = () => { if (done) return; done = true; el.remove(); after && after(); };
  el.onclick = end;
  document.body.appendChild(el);
  setTimeout(end, ms);
}

/* ---------- 合成音效 ---------- */
let ctx = null;
function audio() {
  try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); return ctx; } catch (e) { return null; }
}
function noiseBuf(a, sec) {
  const b = a.createBuffer(1, Math.floor(a.sampleRate * sec), a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

/** 時間凍結：低沉的「咚」＋往下滑的音高＋被壓住的風聲 */
function freezeSound() {
  const a = audio(); if (!a) return;
  const t = a.currentTime;
  const g = a.createGain(); g.connect(a.destination);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.6, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
  const o = a.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 2.25); o.connect(g); o.start(t); o.stop(t + 2.4);
  const o2 = a.createOscillator(); o2.type = 'triangle'; o2.frequency.setValueAtTime(900, t + 0.08); o2.frequency.exponentialRampToValueAtTime(60, t + 1.8);
  const g2 = a.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.15, t + 0.15); g2.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
  o2.connect(g2); g2.connect(a.destination); o2.start(t); o2.stop(t + 1.95);
  const n = a.createBufferSource(); n.buffer = noiseBuf(a, 2.1);
  const f = a.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(4000, t); f.frequency.exponentialRampToValueAtTime(120, t + 1.95);
  const g3 = a.createGain(); g3.gain.setValueAtTime(0.12, t); g3.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
  n.connect(f); f.connect(g3); g3.connect(a.destination); n.start(t); n.stop(t + 2.1);
}

/** 齒輪：喀啦喀啦，越轉越快 */
function gearSound() {
  const a = audio(); if (!a) return;
  const t0 = a.currentTime, buf = noiseBuf(a, 0.03);
  let t = t0, gap = 0.24;
  while (t < t0 + 2.25) {
    const n = a.createBufferSource(); n.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800 + Math.random() * 600; f.Q.value = 6;
    const g = a.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    n.connect(f); f.connect(g); g.connect(a.destination); n.start(t); n.stop(t + 0.04);
    t += gap; gap = Math.max(0.0675, gap * 0.9);
  }
}

/** 齒輪減速：喀啦聲由快變慢，最後「喀」一聲停住 */
function gearStopSound() {
  const a = audio(); if (!a) return;
  const t0 = a.currentTime, buf = noiseBuf(a, 0.03);
  let t = t0, gap = 0.0675;
  const click = (at, vol, freq) => {
    const n = a.createBufferSource(); n.buffer = buf;
    const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 6;
    const g = a.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.001, at + 0.04);
    n.connect(f); f.connect(g); g.connect(a.destination); n.start(at); n.stop(at + 0.05);
  };
  while (t < t0 + 2.4) { click(t, 0.45, 1800 + Math.random() * 600); t += gap; gap *= 1.11; }
  click(t + 0.08, 0.9, 900);   // 最後停住
}

/** 用手機內建語音念出 */
function say(text) {
  return new Promise(res => {
  let done = false; const fin = () => { if (!done) { done = true; res(); } };
  setTimeout(fin, 3500);               // 有些手機不會回報念完，最多等 3.5 秒
  try {
    const sp = window.speechSynthesis; if (!sp) { fin(); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-TW'; u.rate = 0.75; u.pitch = 0.5; u.volume = 1;
    const v = sp.getVoices().find(x => /zh[-_](TW|HK|CN)/i.test(x.lang));
    if (v) u.voice = v;
    u.onend = fin; u.onerror = fin;
    sp.cancel(); sp.speak(u);
  } catch (e) { fin(); }
  });
}

/* ---------- 對外 ---------- */
/** 結束進餐：擬聲字＋時間凍結音 → 語音「砸瓦魯多」→ 齒輪逐漸停止 */
export function timeStop() {
  // 語音要在按下的當下開始播（手機規定要使用者按了才能出聲）；音檔開頭留了 0.45 秒空白
  const custom = on('fxSound') && hasSound('start') ? playSound('start') : null;
  const voice = custom || (on('fxVoice') ? playVoice() : new Promise(r => setTimeout(r, 1800)));
  if (on('fxSound') && !custom) freezeSound();
  if (on('fxVisual')) {
    const main = document.querySelector('main');
    if (main) { main.classList.add('fx-invert'); setTimeout(() => main.classList.remove('fx-invert'), 675); }
    layer('fx-ts', doDoDo(), custom && soundDuration('start') ? Math.min(12000, Math.max(2400, soundDuration('start') * 1000)) : 2400);
  }
  voice.then(() => gearsStop());
}

/** 「ドドドド」：從左下往右上，一串越來越大的擬聲字（原創排版） */
function doDoDo() {
  const W = Math.min(window.innerWidth, 560), Hh = window.innerHeight, rows = 9, out = [];
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1), size = 22 + t * t * 88;
    const x = 6 + t * (W * 0.62) + (i % 2 ? -18 : 18), y = Hh * 0.86 - t * Hh * 0.72;
    const txt = i % 3 === 2 ? 'ドドド' : 'ドドドド';
    out.push('<div class="fx-do" style="left:' + x.toFixed(0) + 'px;top:' + y.toFixed(0) + 'px;font-size:' + size.toFixed(0) + 'px;transform:rotate(' + (-24 + (i % 2) * 8) + 'deg) skewX(-10deg);animation-delay:' + (i * 0.07).toFixed(2) + 's">'
      + txt.split('').map(c => '<i>' + c + '</i>').join('') + '</div>');
  }
  return out.join('');
}

/** 播放錄好的「砸瓦魯多」；不能播時改用手機內建語音 */
function playVoice() {
  return new Promise(res => {
    let done = false; const fin = () => { if (!done) { done = true; res(); } };
    setTimeout(fin, 4200);
    try {
      const a = new Audio('assets/zawarudo.m4a?v=' + (window.APP_VERSION || ''));
      a.onended = fin;
      a.onerror = () => { say('砸瓦魯多').then(fin); };
      const p = a.play();
      if (p && p.catch) p.catch(() => { say('砸瓦魯多').then(fin); });
    } catch (e) { say('砸瓦魯多').then(fin); }
  });
}

function gearPath(cx, cy, teeth, rIn, rOut) {
  const pts = [], step = Math.PI * 2 / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const p = (r, ang) => (cx + r * Math.cos(ang)).toFixed(1) + ',' + (cy + r * Math.sin(ang)).toFixed(1);
    pts.push(p(rIn, a), p(rOut, a + step * 0.15), p(rOut, a + step * 0.45), p(rIn, a + step * 0.6));
  }
  return 'M' + pts.join('L') + 'Z';
}

let gid = 0;
/** 一個金屬齒輪：齒＋輪盤（金色漸層）、輪輻之間的鏤空（深色）、軸心與螺栓 */
function gearG(cls, cx, cy, n, ri, ro, id) {
  const spokes = 5, rimIn = ri * 0.72, hub = ri * 0.3, parts = [];
  parts.push('<path d="' + gearPath(cx, cy, n, ri, ro) + '" fill="url(#' + id + ')" stroke="#4a3006" stroke-width="2.5" stroke-linejoin="round"/>');
  parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (ri - 3) + '" fill="none" stroke="#fff6c8" stroke-opacity=".55" stroke-width="2"/>');
  for (let k = 0; k < spokes; k++) {                      // 輪輻之間的鏤空窗（扇形）
    const a1 = (k / spokes) * Math.PI * 2 + 0.22, a2 = ((k + 1) / spokes) * Math.PI * 2 - 0.22;
    const p = (r, a) => (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1);
    parts.push('<path d="M' + p(hub + 6, a1) + ' L' + p(rimIn, a1) + ' A' + rimIn + ' ' + rimIn + ' 0 0 1 ' + p(rimIn, a2) + ' L' + p(hub + 6, a2) + ' A' + (hub + 6) + ' ' + (hub + 6) + ' 0 0 0 ' + p(hub + 6, a1) + 'Z" fill="#2b1a04" fill-opacity=".78" stroke="#4a3006" stroke-width="1.5"/>');
  }
  parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + hub + '" fill="url(#' + id + ')" stroke="#4a3006" stroke-width="2"/>');
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; parts.push('<circle cx="' + (cx + hub * 0.62 * Math.cos(a)).toFixed(1) + '" cy="' + (cy + hub * 0.62 * Math.sin(a)).toFixed(1) + '" r="' + Math.max(2, hub * 0.12).toFixed(1) + '" fill="#6b4710" stroke="#fff3b0" stroke-width=".8"/>'); }
  parts.push('<circle cx="' + cx + '" cy="' + cy + '" r="' + (hub * 0.3).toFixed(1) + '" fill="#2b1a04"/>');
  return '<g class="' + cls + '">' + parts.join('') + '</g>';
}
function gearSvg() {
  const id = 'fxg' + (++gid);
  const star = (x, y, r) => '<path class="spark" d="M' + x + ' ' + (y - r) + ' L' + (x + r * 0.22) + ' ' + (y - r * 0.22) + ' L' + (x + r) + ' ' + y + ' L' + (x + r * 0.22) + ' ' + (y + r * 0.22) + ' L' + x + ' ' + (y + r) + ' L' + (x - r * 0.22) + ' ' + (y + r * 0.22) + ' L' + (x - r) + ' ' + y + ' L' + (x - r * 0.22) + ' ' + (y - r * 0.22) + 'Z" fill="#fffbe0"/>';
  return '<svg viewBox="0 0 380 380" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">'
    + '<stop offset="0" stop-color="#fff4b8"/><stop offset=".35" stop-color="#e7bd45"/><stop offset=".7" stop-color="#b07a1c"/><stop offset="1" stop-color="#6e4610"/></linearGradient></defs>'
    + gearG('g1', 118, 122, 14, 84, 104, id) + gearG('g2', 276, 170, 10, 54, 70, id) + gearG('g3', 178, 270, 11, 60, 78, id)
    + star(70, 60, 14) + star(300, 80, 10) + star(220, 330, 12) + star(330, 260, 9) + star(40, 250, 8) + '</svg>';
}

/** 齒輪由快逐漸停止（時間停止） */
export function gearsStop() {
  if (on('fxSound')) gearStopSound();
  if (on('fxVisual')) layer('fx-gear stop', gearSvg(), 3600);
}

/** 結束斷食：齒輪由靜止加速轉動（時間重新開始） */
export function gears(after) {
  const custom = on('fxSound') && hasSound('end');
  if (custom) playSound('end'); else if (on('fxSound')) gearSound();
  if (!on('fxVisual')) { after && after(); return; }
  const ms = custom && soundDuration('end') ? Math.min(12000, Math.max(2550, soundDuration('end') * 1000)) : 2550;
  layer('fx-gear', gearSvg(), ms, after);
}
