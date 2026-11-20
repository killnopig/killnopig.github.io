// The notice (使用聲明) shown once, the first time JJptt is opened (extension, web version and
// the Android app), and kept under 設定 → 關於. Raise `version` when a point is added that
// everyone should see again.
var JJPTT_NOTICE = {
  version: 1,
  key: 'jjptt.noticeSeen',
  title: '使用 JJptt 前，請先看一下',
  points: [
    ['非官方工具', 'JJptt 是個人開發的免費、開源工具，和 PTT 批踢踢實業坊沒有關係。使用時請遵守 PTT 的站規。'],
    ['帳號密碼只留在你這裡', '帳號密碼只存在這台電腦或手機（Android App 存在系統的 Keystore），不會上傳；Google Drive 同步設定時也不包含密碼。'],
    ['必要時會多開連線加快速度', '有必要的時候（例如 PTT 網頁版連不上，要先把下一篇文章讀好），JJptt 會用你存的帳號在背景另外登入一條連線，所以 PTT 上可能會看到同一個帳號重複登入。'],
    ['會連到哪些網站', '閱讀模式從 PTT 網頁版（www.ptt.cc）讀文章，圖片、影片和網址預覽從各自的網站載入。JJptt 不收集任何資料。'],
    ['事實查核只是參考', '真.事實查核（FACT）的標示是依推文時間、IP 等推算出來的跡象，不代表一定是帶風向，請自己判斷。']
  ],
  web: ['網頁版經過轉接', '瀏覽器沒辦法直接連 PTT，網頁版會經過 JJptt 的轉接伺服器（Cloudflare）連到 PTT。想直接連線，請用擴充功能版或 Android App。'],
  ok: '我知道了'
};

// The points for this copy of JJptt (the web version has one more).
JJPTT_NOTICE.list = function() {
  var web = typeof lib !== 'undefined' && lib.isApp && lib.isExtension && !lib.isApp() && !lib.isExtension();
  return web ? JJPTT_NOTICE.points.concat([JJPTT_NOTICE.web]) : JJPTT_NOTICE.points.slice();
};

JJPTT_NOTICE.seen = function() {
  try { return +window.localStorage.getItem(JJPTT_NOTICE.key) >= JJPTT_NOTICE.version; } catch (e) { return false; }
};

JJPTT_NOTICE.markSeen = function() {
  try { window.localStorage.setItem(JJPTT_NOTICE.key, String(JJPTT_NOTICE.version)); } catch (e) {}
};

// <ul> of the points, for the window here and the extension's 關於.
JJPTT_NOTICE.listEl = function(cls) {
  var ul = document.createElement('ul');
  ul.className = cls || 'jj-pitch-list';
  JJPTT_NOTICE.list().forEach(function(pt) {
    var li = document.createElement('li');
    var b = document.createElement('b');
    b.textContent = pt[0];
    li.appendChild(b);
    li.appendChild(document.createTextNode('：' + pt[1]));
    ul.appendChild(li);
  });
  return ul;
};

// Extension and web version: a window over the terminal the first time; `done` after 我知道了.
JJPTT_NOTICE.showPage = function(done) {
  if (JJPTT_NOTICE.seen()) return false;
  var shade = document.createElement('div');
  shade.className = 'jj-notice-shade';
  var box = document.createElement('div');
  box.className = 'jj-notice';
  var h = document.createElement('h3');
  h.textContent = JJPTT_NOTICE.title;
  box.appendChild(h);
  box.appendChild(JJPTT_NOTICE.listEl());
  var foot = document.createElement('p');
  foot.className = 'jj-notice-foot';
  foot.textContent = '這些說明之後也可以在 設定 → 關於 看到。';
  box.appendChild(foot);
  var ok = document.createElement('button');
  ok.className = 'btn btn-primary';
  ok.textContent = JJPTT_NOTICE.ok;
  ok.addEventListener('click', function() {
    JJPTT_NOTICE.markSeen();
    shade.remove();
    if (done) done();
  });
  box.appendChild(ok);
  shade.appendChild(box);
  // keys typed while it is up are not sent to PTT
  ['keydown', 'keypress', 'keyup'].forEach(function(t) {
    shade.addEventListener(t, function(e) { e.stopPropagation(); });
  });
  document.body.appendChild(shade);
  setTimeout(function() { ok.focus(); }, 0);
  return true;
};
