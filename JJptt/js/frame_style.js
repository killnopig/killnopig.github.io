// JJptt: classic window looks for the extension and the web version
// (設定 → 版面 → 介面 → 視窗風格). 0 = plain (all black, the default),
// 1 = NetTerm-like, 2 = KKMan-like. Only the look for now: every button and menu says
// 「施工中」. The terminal (#BBSWindow) and the reader (#jjReader) are moved
// into the frame's black hole by CSS variables set from the hole's size;
// pttchrome.App asks JJFrame.insets() so mouse positions still map to cells.

var JJFrame = {
  STYLES: ['', 'netterm', 'kkman'],
  style: '',
  app: null,
  el: null,
  splashEl: null,
  zero: { top: 0, left: 0, right: 0, bottom: 0 },
  cur: null,
  clockTimer: null,
  splashShownAt: 0,
  splashWaiting: false,
  connectedAt: 0
};

// Which style a frameStyle setting means ('' for plain or anything unknown).
JJFrame.styleFor = function(n) {
  return JJFrame.STYLES[parseInt(n, 10) || 0] || '';
};

// The frame's edges around the terminal, in CSS pixels.
JJFrame.insets = function() {
  return JJFrame.cur || JJFrame.zero;
};

JJFrame.apply = function(app, n) {
  JJFrame.app = app;
  if (typeof lib !== 'undefined' && lib.isApp && lib.isApp()) n = 0;  // the phone UI has its own look
  var style = JJFrame.styleFor(n);
  if (style === JJFrame.style) return;
  JJFrame.remove();
  JJFrame.style = style;
  if (style) JJFrame.build(style);
  JJFrame.measure();
  JJFrame.wrap();
};

JJFrame.remove = function() {
  if (JJFrame.el) JJFrame.el.parentNode.removeChild(JJFrame.el);
  if (JJFrame.splashEl) JJFrame.splashEl.parentNode.removeChild(JJFrame.splashEl);
  JJFrame.el = JJFrame.splashEl = null;
  if (JJFrame.clockTimer) clearInterval(JJFrame.clockTimer);
  JJFrame.clockTimer = null;
  JJFrame.splashWaiting = false;
  document.body.classList.remove('jj-frame', 'jj-frame-netterm', 'jj-frame-kkman');
  JJFrame.style = '';
  JJFrame.cur = null;
};

// Reads how thick the frame is on each side (title, menus, buttons above;
// scrollbar right; status bar below). The terminal gets the window minus
// that (--jj-ft / -fl / -fr / -fb), sizes its font for it, and then wrap()
// shrinks the frame around the text it actually drew.
JJFrame.measure = function() {
  if (!JJFrame.el) { JJFrame.cur = null; return; }
  var f = JJFrame.el.getBoundingClientRect();
  var r = JJFrame.el.querySelector('.jjf-hole').getBoundingClientRect();
  var ins = {
    top: Math.round(r.top - f.top), left: Math.round(r.left - f.left),
    right: Math.max(0, Math.round(f.right - r.right)), bottom: Math.max(0, Math.round(f.bottom - r.bottom))
  };
  JJFrame.cur = ins;
  var s = document.body.style;
  s.setProperty('--jj-ft', ins.top + 'px');
  s.setProperty('--jj-fl', ins.left + 'px');
  s.setProperty('--jj-fr', ins.right + 'px');
  s.setProperty('--jj-fb', ins.bottom + 'px');
};

// Puts the frame tightly around the terminal's text, so a half-width window
// does not leave black bands inside the frame. The hole's place goes into
// --jj-ht / -hl / -hw / -hh for the reader and the welcome screen.
JJFrame.wrap = function() {
  var el = JJFrame.el, ins = JJFrame.cur, app = JJFrame.app;
  if (!el || !ins) return;
  var W = document.documentElement.clientWidth, H = document.documentElement.clientHeight;
  var md = app && app.view && app.view.mainDisplay;
  var c = md && md.getBoundingClientRect();
  var hole;
  if (c && c.width > 0 && c.height > 0) {
    hole = { left: c.left, top: c.top, width: c.width, height: c.height };
  } else {  // terminal not shown yet: the whole space
    hole = { left: ins.left, top: ins.top, width: W - ins.left - ins.right, height: H - ins.top - ins.bottom };
  }
  hole.left = Math.round(hole.left); hole.top = Math.round(hole.top);
  hole.width = Math.round(hole.width); hole.height = Math.round(hole.height);
  var st = el.style;
  st.left = Math.max(0, hole.left - ins.left) + 'px';
  st.top = Math.max(0, hole.top - ins.top) + 'px';
  st.width = Math.min(W, hole.width + ins.left + ins.right) + 'px';
  st.height = Math.min(H, hole.height + ins.top + ins.bottom) + 'px';
  var s = document.body.style;
  s.setProperty('--jj-hl', hole.left + 'px');
  s.setProperty('--jj-ht', hole.top + 'px');
  s.setProperty('--jj-hw', hole.width + 'px');
  s.setProperty('--jj-hh', hole.height + 'px');
  JJFrame.fitSplash();
};

JJFrame.wip = function() {
  var app = JJFrame.app;
  var text = (typeof i18n === 'function' && i18n('frame_wip')) || '施工中';
  if (app && app.showToast) app.showToast(text, 1500);
};

// --- NetTerm-like ---------------------------------------------------------

JJFrame.ICONS = {
  copy: '<svg viewBox="0 0 18 16"><rect x="2" y="1" width="9" height="10" fill="#fff" stroke="#000"/><rect x="7" y="5" width="9" height="10" fill="#fff" stroke="#000"/><path d="M9 8h5M9 10h5M9 12h4" stroke="#000080"/></svg>',
  paste: '<svg viewBox="0 0 18 16"><rect x="2" y="2" width="11" height="13" fill="#c08040" stroke="#000"/><rect x="5" y="1" width="5" height="3" fill="#c0c0c0" stroke="#000"/><rect x="7" y="6" width="9" height="9" fill="#fff" stroke="#000"/></svg>',
  cam: '<svg viewBox="0 0 20 18"><rect x="2" y="5" width="16" height="11" fill="#404040" stroke="#000"/><rect x="6" y="3" width="5" height="3" fill="#808080" stroke="#000"/><circle cx="10" cy="10.5" r="3.5" fill="#8080ff" stroke="#000"/></svg>',
  print: '<svg viewBox="0 0 20 18"><rect x="5" y="1" width="10" height="6" fill="#fff" stroke="#000"/><rect x="2" y="7" width="16" height="7" fill="#c0c0c0" stroke="#000"/><rect x="5" y="12" width="10" height="5" fill="#fff" stroke="#000"/></svg>',
  phone: '<svg viewBox="0 0 20 18"><path d="M3 8c0-4 14-4 14 0l-3 1-1-2H7L6 9z" fill="#e8c000" stroke="#000"/><rect x="5" y="9" width="10" height="7" rx="1" fill="#e8c000" stroke="#000"/><circle cx="10" cy="12.5" r="2" fill="#fff" stroke="#000"/></svg>',
  cut: '<svg viewBox="0 0 18 16"><rect x="1" y="2" width="10" height="8" fill="#808080" stroke="#000"/><rect x="2" y="3" width="8" height="6" fill="#000"/><path d="M12 4l5 6M17 4l-5 6" stroke="#c00" stroke-width="2"/></svg>',
  conn: '<svg viewBox="0 0 18 16"><rect x="1" y="2" width="10" height="8" fill="#008080" stroke="#000"/><rect x="2" y="3" width="8" height="6" fill="#55ffff"/><rect x="4" y="11" width="4" height="2" fill="#808080"/><path d="M12 8h5M14 5l3 3-3 3" stroke="#000" fill="none"/></svg>',
  read: '<svg viewBox="0 0 18 16"><path d="M1 3c3-1 6-1 8 1v11c-2-2-5-2-8-1z" fill="#fff" stroke="#000"/><path d="M17 3c-3-1-6-1-8 1v11c2-2 5-2 8-1z" fill="#ffffc0" stroke="#000"/></svg>',
  fact: '<svg viewBox="0 0 18 16"><circle cx="7" cy="7" r="5" fill="#c0e0ff" stroke="#000" stroke-width="1.5"/><path d="M11 11l5 4" stroke="#804000" stroke-width="3"/></svg>',
  black: '<svg viewBox="0 0 18 16"><circle cx="9" cy="5" r="3.5" fill="#404040" stroke="#000"/><path d="M2 15c1-5 13-5 14 0z" fill="#404040" stroke="#000"/><circle cx="14" cy="11" r="3.5" fill="#c00" stroke="#000"/><path d="M12 11h4" stroke="#fff" stroke-width="1.5"/></svg>',
  set: '<svg viewBox="0 0 18 16"><circle cx="9" cy="8" r="5" fill="#c0c0c0" stroke="#000" stroke-width="3" stroke-dasharray="2 2"/><circle cx="9" cy="8" r="2" fill="#fff" stroke="#000"/></svg>'
};

JJFrame.netTermHtml = function() {
  var tb = function(i) { return '<span class="jjf-tb" data-jjf="' + i + '">' + JJFrame.ICONS[i] + '</span>'; };
  var menu = [['F', 'ile'], ['E', 'dit'], ['O', 'ptions'], ['S', 'end'], ['R', 'eceive'], ['W', 'indow'], ['H', 'elp']]
    .map(function(m) { return '<span data-jjf="menu"><u>' + m[0] + '</u>' + m[1] + '</span>'; }).join('');
  var keys = ['推文', '回應', '發文', '找標題', '找作者', '同主題', '換看板', '離開']
    .map(function(k) { return '<span data-jjf="key">' + k + '</span>'; }).join('');
  return '<div class="jjf-title"><span class="jjf-box" data-jjf="sys"><i></i></span>' +
      '<span class="jjf-t">JJptt</span><span class="jjf-ar" data-jjf="min">▼</span><span class="jjf-ar" data-jjf="max">▲</span></div>' +
    '<div class="jjf-menu">' + menu + '</div>' +
    '<div class="jjf-tools">' + tb('copy') + tb('paste') + tb('cam') + tb('print') + '<i class="jjf-gap"></i>' +
      tb('phone') + tb('cut') + tb('conn') + '<i class="jjf-gap"></i>' +
      tb('read') + tb('fact') + tb('black') + tb('set') + '</div>' +
    '<div class="jjf-keys">' + keys + '</div>' +
    '<div class="jjf-body"><div class="jjf-hole"></div>' +
      '<div class="jjf-vs"><b data-jjf="up">▲</b><b class="jjf-th" data-jjf="thumb"></b><span data-jjf="track"></span><b data-jjf="down">▼</b></div></div>' +
    '<div class="jjf-status"><span class="jjf-led"></span><span class="jjf-g"></span>' +
      '<span>ANSI</span><span class="jjf-proto">SSH</span><span class="jjf-clock">--:--</span><span>○○○○</span></div>';
};

// --- KKMan-like -------------------------------------------------------------
// Windows 7 glass: round glossy buttons, a search box, a telnet:// address
// bar, site tabs under the screen and a 連線時間 / 現在時間 status bar.

JJFrame.KK_ICONS = {
  back: '<svg viewBox="0 0 20 20"><path d="M12 4L6 10l6 6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fwd: '<svg viewBox="0 0 20 20"><path d="M8 4l6 6-6 6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  conn: '<svg viewBox="0 0 20 20"><path d="M15.5 7A6 6 0 1 0 16 12" fill="none" stroke="#1d7a1d" stroke-width="2.4"/><path d="M12 6.5h5v-5" fill="none" stroke="#1d7a1d" stroke-width="2.4"/></svg>',
  stop: '<svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" stroke="#c0281e" stroke-width="3" stroke-linecap="round"/></svg>',
  home: '<svg viewBox="0 0 20 20"><path d="M2 10L10 3l8 7" fill="none" stroke="#2a5d9e" stroke-width="2.2" stroke-linejoin="round"/><path d="M5 9v8h4v-5h2v5h4V9" fill="#fff" stroke="#2a5d9e" stroke-width="1.6"/></svg>',
  fav: '<svg viewBox="0 0 20 20"><path d="M10 2l2.4 5 5.4.6-4 3.7 1.1 5.4L10 14l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" fill="#ffcc33" stroke="#b07800" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  read: '<svg viewBox="0 0 20 20"><path d="M2 4c3-1 6-1 8 1v12c-2-2-5-2-8-1z" fill="#fff" stroke="#2a5d9e" stroke-width="1.2"/><path d="M18 4c-3-1-6-1-8 1v12c2-2 5-2 8-1z" fill="#e4f0ff" stroke="#2a5d9e" stroke-width="1.2"/></svg>',
  fact: '<svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5" fill="#d8ecff" stroke="#2a5d9e" stroke-width="1.8"/><path d="M12.5 12.5l5 5" stroke="#2a5d9e" stroke-width="3" stroke-linecap="round"/></svg>',
  set: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6" fill="#d0d8e4" stroke="#56677e" stroke-width="3.2" stroke-dasharray="2.4 2.3"/><circle cx="10" cy="10" r="2.4" fill="#fff" stroke="#56677e" stroke-width="1.2"/></svg>',
  go: '<svg viewBox="0 0 16 16"><path d="M3 8h9M8 4l4 4-4 4" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  find: '<svg viewBox="0 0 16 16"><circle cx="6.5" cy="6.5" r="4.2" fill="none" stroke="#3a6ea5" stroke-width="1.8"/><path d="M9.6 9.6l4 4" stroke="#3a6ea5" stroke-width="2.2" stroke-linecap="round"/></svg>',
  page: '<svg viewBox="0 0 14 14"><rect x="1.5" y="2" width="11" height="10" rx="1.5" fill="#000" stroke="#4a6a8e"/><path d="M3.5 5h4M3.5 7.5h6" stroke="#7fe07f"/></svg>'
};

JJFrame.kkmanHtml = function() {
  var I = JJFrame.KK_ICONS;
  var rb = function(i, label) {
    return '<span class="jjf-rb" data-jjf="' + i + '"><b>' + I[i] + '</b><em>' + label + '</em></span>';
  };
  var menu = ['檔案', '編輯', '檢視', '我的最愛', '工具', '說明']
    .map(function(m) { return '<span data-jjf="menu">' + m + '</span>'; }).join('');
  var tab = function(site, name) {
    return '<span class="jjf-tab" data-jjf="tab" data-site="' + site + '">' + I.page + '<span>' + name + '</span><i data-jjf="close">×</i></span>';
  };
  return '<div class="jjf-title"><span class="jjf-logo">J</span>' +
      '<span class="jjf-t">JJptt</span>' +
      '<span class="jjf-cap" data-jjf="min"><i class="m"></i></span><span class="jjf-cap" data-jjf="max"><i class="x"></i></span>' +
      '<span class="jjf-cap jjf-close" data-jjf="close">✕</span></div>' +
    '<div class="jjf-menu">' + menu + '</div>' +
    '<div class="jjf-tools">' +
      '<span class="jjf-nav"><span class="jjf-big" data-jjf="back">' + I.back + '</span><span class="jjf-small" data-jjf="fwd">' + I.fwd + '</span></span>' +
      rb('conn', '重新連線') + rb('stop', '斷線') + rb('home', '首頁') + rb('fav', '我的最愛') +
      '<i class="jjf-sep"></i>' + rb('read', '閱讀模式') + rb('fact', '事實查核') + rb('set', '設定') +
      '<span class="jjf-search" data-jjf="search"><span>Google</span>' + I.find + '</span></div>' +
    '<div class="jjf-url"><span class="jjf-lbl">網址</span><span class="jjf-field" data-jjf="url"><span class="jjf-addr">telnet://ptt.cc</span><i>▾</i></span>' +
      '<span class="jjf-go" data-jjf="go">' + I.go + '<span>連線</span></span></div>' +
    '<div class="jjf-body"><div class="jjf-hole"></div>' +
      '<div class="jjf-vs"><b data-jjf="up">▴</b><b class="jjf-th" data-jjf="thumb"></b><span data-jjf="track"></span><b data-jjf="down">▾</b></div></div>' +
    '<div class="jjf-tabs">' + tab('ptt.cc', '批踢踢實業坊') + tab('ptt2.cc', '批踢踢兔') +
      '<span class="jjf-newtab" data-jjf="newtab">+</span></div>' +
    '<div class="jjf-status"><span class="jjf-led"></span><span class="jjf-g"></span>' +
      '<span class="jjf-cell">連線時間 <b class="jjf-up">0:00:00</b></span>' +
      '<span class="jjf-cell">現在時間 <b class="jjf-clock">--:--:--</b></span></div>';
};

JJFrame.build = function(style) {
  var el = document.createElement('div');
  el.id = 'jjFrame';
  el.className = 'jjf-' + style;
  el.innerHTML = style === 'kkman' ? JJFrame.kkmanHtml() : JJFrame.netTermHtml();
  // The frame is not the terminal: its clicks must not move the cursor or
  // send keys, and pressing it must not take the focus from the input.
  ['click', 'dblclick', 'contextmenu', 'mousewheel', 'wheel', 'mousemove', 'mouseover'].forEach(function(t) {
    el.addEventListener(t, function(e) { e.stopPropagation(); });
  });
  var pressed = false;
  el.addEventListener('mousedown', function(e) {
    pressed = true;
    e.stopPropagation();
    e.preventDefault();
  });
  // A press that started in the terminal and ends over the frame must still
  // reach the terminal, or it thinks the button is held down.
  el.addEventListener('mouseup', function(e) {
    if (pressed) e.stopPropagation();
    pressed = false;
  });
  el.addEventListener('click', function(e) {
    var b = e.target.closest && e.target.closest('[data-jjf]');
    if (b) JJFrame.wip();
  });
  document.body.insertBefore(el, document.body.firstChild);
  JJFrame.el = el;
  document.body.classList.add('jj-frame', 'jj-frame-' + style);
  JJFrame.tick();
  // KKMan's clock and 連線時間 show seconds
  JJFrame.clockTimer = setInterval(JJFrame.tick, style === 'kkman' ? 1000 : 15000);
  JJFrame.showSplash();
};

JJFrame.pad = function(n) { return (n < 10 ? '0' : '') + n; };

// How long since connecting, as h:mm:ss ('0:00:00' when not connected).
JJFrame.upTime = function(since, now) {
  var t = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
  return Math.floor(t / 3600) + ':' + JJFrame.pad(Math.floor(t / 60) % 60) + ':' + JJFrame.pad(t % 60);
};

// Clock, title, address and connection light.
JJFrame.tick = function() {
  var el = JJFrame.el;
  if (!el) return;
  var app = JJFrame.app, pad = JJFrame.pad;
  var set = function(sel, text) { var n = el.querySelector(sel); if (n) n.textContent = text; };
  var d = new Date();
  var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
  var site = app && app.connectedUrl && app.connectedUrl.site;
  var on = !!(app && app.conn && app.conn.isConnected);
  var ssh = !!(app && typeof SecureShellConnection !== 'undefined' && app.conn instanceof SecureShellConnection);
  set('.jjf-t', site ? 'JJptt - ' + site : 'JJptt');
  var led = el.querySelector('.jjf-led');
  if (led) led.classList.toggle('on', on);
  if (JJFrame.style === 'kkman') {
    set('.jjf-clock', hm + ':' + pad(d.getSeconds()));
    set('.jjf-up', JJFrame.upTime(on && JJFrame.connectedAt, d.getTime()));
    set('.jjf-addr', (ssh ? 'ssh://' : 'telnet://') + (site || 'ptt.cc'));
    set('.jjf-g', (typeof i18n === 'function' && i18n(on ? 'frame_online' : 'frame_offline')) || (on ? '已連線' : '未連線'));
    [].forEach.call(el.querySelectorAll('.jjf-tab'), function(t) {
      t.classList.toggle('on', t.getAttribute('data-site') === (site || 'ptt.cc'));
    });
  } else {
    set('.jjf-clock', hm);
    set('.jjf-g', on ? (site || '') : '');
    set('.jjf-proto', ssh ? 'SSH' : 'Telnet');
  }
};

// --- welcome screen ---------------------------------------------------------
// A grainy globe and gold letters, drawn small, reduced to a few colours with
// ordered dithering and shown with big pixels, like a 256-colour screen.

JJFrame.BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
JJFrame.PAL = [[0, 0, 0], [0, 0, 64], [0, 0, 128], [0, 32, 160], [0, 64, 192], [32, 96, 224], [64, 128, 255], [0, 96, 128],
  [0, 64, 0], [32, 96, 32], [64, 128, 32], [96, 128, 64], [128, 112, 64], [160, 140, 90], [192, 176, 128],
  [128, 128, 128], [192, 192, 192], [224, 224, 224], [255, 255, 255], [96, 96, 128], [160, 160, 192]];

JJFrame.nearest = function(r, g, b) {
  var P = JJFrame.PAL, best = 0, bd = 1e9;
  for (var i = 0; i < P.length; i++) {
    var p = P[i], d = (p[0] - r) * (p[0] - r) * 0.3 + (p[1] - g) * (p[1] - g) * 0.59 + (p[2] - b) * (p[2] - b) * 0.11;
    if (d < bd) { bd = d; best = i; }
  }
  return P[best];
};

JJFrame.fbm = function(x, y) {
  var hash = function(a, b) { var h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return h - Math.floor(h); };
  var vnoise = function(px, py) {
    var xi = Math.floor(px), yi = Math.floor(py), xf = px - xi, yf = py - yi;
    var a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    var u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  var s = 0, amp = 0.5;
  for (var i = 0; i < 5; i++) { s += amp * vnoise(x, y); x *= 2.03; y *= 2.03; amp *= 0.5; }
  return s;
};

JJFrame.drawGlobe = function(c) {
  var x = c.getContext('2d'), W = c.width, R = W / 2 - 2, img = x.createImageData(W, W), D = img.data;
  var fbm = JJFrame.fbm, B = JJFrame.BAYER;
  for (var j = 0; j < W; j++) for (var i = 0; i < W; i++) {
    var px = (i - W / 2 + 0.5) / R, py = (j - W / 2 + 0.5) / R, rr = px * px + py * py, o = (j * W + i) * 4;
    D[o + 3] = 255;
    if (rr > 1) continue;
    var nz = Math.sqrt(1 - rr), lon = Math.atan2(px, nz) + 1.1, lat = Math.asin(-py);
    var u = lon * 1.6, v = lat * 2.2;
    var land = fbm(u * 1.3 + 3, v * 1.3 + 7) + 0.12 * Math.cos(lat * 2);
    var col, t;
    if (land > 0.56) {
      t = fbm(u * 4, v * 4);
      col = (Math.abs(lat) < 0.45 && t > 0.5) ? [176 + 40 * t, 150 + 20 * t, 90] : [40 + 60 * t, 110 + 50 * t, 40 + 20 * t];
    } else {
      t = fbm(u * 3 + 9, v * 3);
      col = [10, 50 + 40 * t, 150 + 60 * t];
    }
    var sw = fbm(u * 2.4 + Math.sin(v * 3) * 1.2 + 20, v * 3.2 + 5);
    if (sw > 0.58) {
      var k = Math.min(1, (sw - 0.58) * 5);
      col = [col[0] + (240 - col[0]) * k, col[1] + (240 - col[1]) * k, col[2] + (250 - col[2]) * k];
    }
    var L = Math.max(0, -px * 0.45 - py * 0.5 + nz * 0.75), sh = 0.25 + 0.95 * L, rim = Math.pow(rr, 4) * 0.5;
    var th = (B[(j % 4) * 4 + i % 4] / 16 - 0.5) * 40;
    var q = JJFrame.nearest(col[0] * sh + 40 * rim + th, col[1] * sh + 70 * rim + th, col[2] * sh + 160 * rim + th);
    D[o] = q[0]; D[o + 1] = q[1]; D[o + 2] = q[2];
  }
  x.putImageData(img, 0, 0);
};

JJFrame.drawWord = function(c, sub) {
  var x = c.getContext('2d'), W = c.width, H = c.height, B = JJFrame.BAYER;
  var t = document.createElement('canvas');
  t.width = W; t.height = H;
  var y = t.getContext('2d');
  y.textAlign = 'center';
  y.textBaseline = 'alphabetic';
  y.fillStyle = '#fff';
  y.font = 'italic 900 60px "Times New Roman",Georgia,serif';
  y.fillText('JJptt', W / 2, 57);
  y.font = '900 20px "PingFang TC","Microsoft JhengHei","Noto Sans TC","Arial Black",sans-serif';
  y.fillText(sub, W / 2, 88);
  var m = y.getImageData(0, 0, W, H).data, out = x.createImageData(W, H), O = out.data;
  var on = function(i, j) { return i >= 0 && j >= 0 && i < W && j < H && m[(j * W + i) * 4 + 3] > 110; };
  for (var j = 0; j < H; j++) for (var i = 0; i < W; i++) {
    var o = (j * W + i) * 4;
    if (on(i, j)) {
      var big = j < 63;
      var g = big ? (j < 21 ? [255, 255, 160] : j < 33 ? [255, 208, 48] : j < 45 ? [232, 128, 0] : [255, 200, 64]) :
        (j < 78 ? [255, 224, 80] : [232, 150, 0]);
      if (!on(i, j - 1) || !on(i - 1, j)) g = [255, 255, 224];       // lit top edge
      if (!on(i, j + 1) || !on(i + 1, j)) g = [160, 72, 0];          // dark bottom edge
      if (big && j >= 33 && j < 45 && B[(j % 4) * 4 + i % 4] / 16 > 0.6) g = [255, 176, 32];
      O[o] = g[0]; O[o + 1] = g[1]; O[o + 2] = g[2]; O[o + 3] = 255;
    } else if (on(i - 2, j - 2) || on(i - 1, j - 1)) {                // offset shadow
      O[o] = 64; O[o + 1] = 24; O[o + 2] = 0; O[o + 3] = 255;
    }
  }
  x.putImageData(out, 0, 0);
};

// KKMan-like welcome screen: like a BBS station's entry screen of the time.
// The station name in big yellow pixel letters (a font drawn small and shown
// with big square pixels), a dim code above, the station's rules below and a
// blue bar at the bottom that says we are connecting.
JJFrame.KK_SPLASH = {
  code: 'JJ 01',
  title: '花魁異色館',
  tags: ['懷舊連線', '看穿風向'],
  head: '【花魁異色館】',
  rules: ['本站為懷舊連線館，文章皆來自批踢踢，站方不保證每則推文都是真心話。',
    '本站不提供帶風向、灌票、養帳號等服務。',
    '同一 IP 連推、秒推、罐頭推文，一律亮燈示眾。',
    '本站為公開站台，看完請自行判斷，站方不負責幫你吵架。']
};

// Draws text as square pixels: each character rendered at px pixels, the
// dots kept or dropped by a threshold, and each dot shown cell x cell.
JJFrame.drawPixelText = function(c, text, px, cell, color, font) {
  var gap = Math.max(1, Math.round(px / 8)), chars = text.split('');
  var t = document.createElement('canvas');
  t.width = chars.length * (px + gap); t.height = px + 2;
  var y = t.getContext('2d');
  y.fillStyle = '#fff';
  y.textBaseline = 'top';
  y.font = font || ('bold ' + px + 'px "PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif');
  var x0 = 0;
  chars.forEach(function(ch) {
    var w = y.measureText(ch).width;
    y.fillText(ch, x0 + Math.max(0, (px - w) / 2), 1);
    x0 += (w > px * 0.7 ? px : Math.ceil(w)) + gap;
  });
  var W = Math.min(t.width, x0 - gap), H = t.height;
  var m = y.getImageData(0, 0, t.width, H).data;
  c.width = W * cell; c.height = H * cell;
  var x = c.getContext('2d');
  x.fillStyle = color;
  for (var j = 0; j < H; j++) for (var i = 0; i < W; i++) {
    if (m[(j * t.width + i) * 4 + 3] > 100) x.fillRect(i * cell, j * cell, cell, cell);
  }
};

JJFrame.kkSplashHtml = function() {
  var K = JJFrame.KK_SPLASH;
  return '<div class="jjf-art"><canvas class="jjf-code"></canvas>' +
    '<div class="jjf-tags">' + K.tags.map(function(t) { return '<span>' + t + '</span>'; }).join('') + '</div>' +
    '<canvas class="jjf-name"></canvas>' +
    '<div class="jjf-rules"><div class="jjf-head">' + K.head + '</div>' +
    K.rules.map(function(t, i) { return '<p><b>' + i + '.</b><span>' + t + '</span></p>'; }).join('') + '</div></div>';
};

JJFrame.drawKkSplash = function(sp) {
  var K = JJFrame.KK_SPLASH;
  JJFrame.drawPixelText(sp.querySelector('.jjf-code'), K.code, 13, 5, '#a8a800', 'bold 13px Arial,Helvetica,sans-serif');
  JJFrame.drawPixelText(sp.querySelector('.jjf-name'), K.title, 16, 7, '#ffff40');
};

JJFrame.showSplash = function() {
  var app = JJFrame.app;
  // only before the first screen comes in; switching the style later skips it
  if (app && app.buf && app.lastDataAt) return;
  var sp = document.createElement('div');
  sp.id = 'jjFrameSplash';
  var msg = (typeof i18n === 'function' && i18n('frame_connecting')) || '正在連線 …';
  var kk = JJFrame.style === 'kkman';
  if (kk) sp.className = 'jjf-splash-kk';
  sp.innerHTML = (kk ?
    JJFrame.kkSplashHtml() :
    '<div class="jjf-art"><canvas class="jjf-globe" width="132" height="132"></canvas>' +
    '<canvas class="jjf-word" width="360" height="96"></canvas></div>') + '<div class="jjf-conn"></div>';
  sp.querySelector('.jjf-conn').textContent = msg;
  sp.addEventListener('mousedown', function(e) { e.preventDefault(); e.stopPropagation(); JJFrame.hideSplash(); });
  document.body.appendChild(sp);
  JJFrame.splashEl = sp;
  var motto = (typeof i18n === 'function' && i18n('frame_motto')) || '看 PTT，也看穿帶風向';
  try {
    if (kk) {
      JJFrame.drawKkSplash(sp);
    } else {
      JJFrame.drawGlobe(sp.querySelector('.jjf-globe'));
      JJFrame.drawWord(sp.querySelector('.jjf-word'), motto);
    }
  } catch (e) { /* no canvas: the words alone */ }
  JJFrame.splashShownAt = Date.now();
  JJFrame.splashWaiting = true;
  JJFrame.fitSplash();
};

// Shrinks the art to fit small windows.
JJFrame.fitSplash = function() {
  var sp = JJFrame.splashEl;
  if (!sp || !JJFrame.cur) return;
  var w = sp.clientWidth, h = sp.clientHeight;
  if (!w || !h) return;
  var art = sp.querySelector('.jjf-art');
  var k = Math.min(1, w / (art.offsetWidth + 40 || 760), (h - 40) / (art.offsetHeight + 24 || 420));
  art.style.transform = 'scale(' + Math.max(0.3, k) + ')';
};

// Called on every chunk from the site: the welcome screen goes once PTT's
// own screen starts, after being shown at least SPLASH_MS (the owner's 3 s).
JJFrame.SPLASH_MS = 3000;
JJFrame.onData = function() {
  if (!JJFrame.splashWaiting) return;
  JJFrame.splashWaiting = false;
  JJFrame.tick();
  var wait = Math.max(0, JJFrame.SPLASH_MS - (Date.now() - JJFrame.splashShownAt));
  setTimeout(JJFrame.hideSplash, wait);
};

JJFrame.hideSplash = function() {
  JJFrame.splashWaiting = false;
  var sp = JJFrame.splashEl;
  if (!sp) return;
  JJFrame.splashEl = null;
  sp.parentNode.removeChild(sp);
  if (JJFrame.app && JJFrame.app.setInputAreaFocus) JJFrame.app.setInputAreaFocus();
};

// Connected: the light and the title change now, not on the next tick.
JJFrame.onConnect = function() {
  JJFrame.connectedAt = Date.now();
  JJFrame.tick();
};

// Disconnected or could not connect: drop the welcome screen so the error
// (#connectionAlert) and the reconnect button can be seen.
JJFrame.onClose = function() {
  JJFrame.connectedAt = 0;
  JJFrame.hideSplash();
  JJFrame.tick();
};

JJFrame.onResize = function() {
  if (!JJFrame.el) return;
  JJFrame.measure();
};
