// JJptt app: a PTT connection in the background for what reading from the
// web pages can't do -- logging in, pushing (推 / 噓 / →), replying, posting. The
// terminal is never shown: this reads its screen and types the keys a
// person would, one job at a time.
//
//   ptt.login(user, pass)        -> Promise (rejects with a message)
//   ptt.push(url, kind, text)    kind '1' 推 / '2' 噓 / '3' →
//   ptt.reply(url, text, quote)
//   ptt.post(board, type, title, text)
//   ptt.logout()
function JJPtt(app) {
  this.app = app;
  this.user = '';
  this.pass = '';
  this.state = 'off';        // off / connecting / in
  this.queue = Promise.resolve();
  this.listeners = [];
  // kept on the phone: the app may be closed by Android before 設定 is opened
  try { this.lastFailure = JSON.parse(window.localStorage.getItem(JJPtt.FAIL_KEY) || 'null'); } catch (e) { this.lastFailure = null; }
}

JJPtt.FAIL_KEY = 'jjptt.m.lastFailure';

JJPtt.STEP_MS = 50;
JJPtt.KICK_KEY = 'jjptt.m.kickOthers';

JJPtt.kickOthers = function() {
  try { return window.localStorage.getItem(JJPtt.KICK_KEY) === '1'; } catch (e) { return false; }
};
JJPtt.TIMEOUT_MS = 15000;

// ---- article code (AID) from the web address ----------------------------------
// M.1699999999.A.1F3 -> 8 characters PTT jumps to with "#": the type, the
// time and the 3 hex digits, 6 bits per character (pttbbs aids.c).
JJPtt.AID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_';
JJPtt.aidFromUrl = function(url) {
  var m = /\/(M|G)\.(\d+)\.A\.([0-9A-Fa-f]{1,3})\.html/.exec(url || '');
  if (!m) return '';
  var n = (m[1] === 'G' ? 1 : 0) * Math.pow(2, 44) +
          (Number(m[2]) % Math.pow(2, 32)) * Math.pow(2, 12) +
          (parseInt(m[3], 16) & 0xfff);
  var out = '';
  for (var i = 0; i < 8; ++i) {
    out = JJPtt.AID_CHARS.charAt(n % 64) + out;
    n = Math.floor(n / 64);
  }
  return out;
};

JJPtt.boardFromUrl = function(url) {
  var m = /\/bbs\/([^\/]+)\//.exec(url || '');
  return m ? m[1] : '';
};

// Width PTT allows for one push: the line is "推 id:text ... mm/dd hh:mm".
JJPtt.pushMaxBytes = function(id) {
  return Math.max(20, 78 - 3 - String(id || '').length - 1 - 13);
};

JJPtt.big5Length = function(s) {
  try { return String(s).u2b().length; } catch (e) { return String(s).length * 2; }
};

// ---- state ------------------------------------------------------------------------

JJPtt.prototype.onChange = function(fn) {
  this.listeners.push(fn);
};

JJPtt.prototype.setState = function(state) {
  if (this.state === state) return;
  this.state = state;
  var self = this;
  this.listeners.forEach(function(fn) { fn(self.state); });
};

JJPtt.prototype.connected = function() {
  var conn = this.app.conn;
  return !!(conn && conn.isConnected);
};

// One job at a time, in order. When one fails, the hidden screen at that
// moment is kept (設定 → 帳號 → 最後一次 PTT 畫面) to see what PTT showed.
// bg: a job nobody is waiting for (reading ahead); fgWaiting counts the
// others still in the queue, so a long background read can give way.
JJPtt.prototype.run = function(job, bg) {
  var self = this;
  var go = job;
  if (!bg) {
    this.fgWaiting = (this.fgWaiting || 0) + 1;
    go = function() { self.fgWaiting--; return job(); };
  }
  var p = this.queue.then(go, go).catch(function(err) {
    self.lastFailure = { at: Date.now(), message: (err && err.message) || String(err), screen: self.screen() };
    try { window.localStorage.setItem(JJPtt.FAIL_KEY, JSON.stringify(self.lastFailure)); } catch (e) {}
    throw err;
  });
  this.queue = p.catch(function() {});
  return p;
};

// ---- the screen ---------------------------------------------------------------------

// Resolves once the screen is the same on two looks in a row (at most `ms`).
JJPtt.prototype.steady = function(ms) {
  var self = this;
  var until = Date.now() + (ms || 300);
  return new Promise(function(resolve) {
    var last = self.screen();
    var tick = function() {
      var now = self.screen();
      if (now === last || Date.now() > until) return resolve();
      last = now;
      setTimeout(tick, JJPtt.STEP_MS);
    };
    setTimeout(tick, JJPtt.STEP_MS);
  });
};

// Resolves once nothing has come from PTT for `ms` (at most `max`): a page
// arrives in several pieces, more slowly on a phone's network, and one read
// half drawn mixes rows of two pages. Without lastDataAt: steady().
// Keys that may leave the screen as it is (End at the newest, a number
// already under the cursor): PTT sends nothing back then, and settle()
// waited its whole time (2 s). A Ctrl-L after them makes PTT redraw: once
// that comes in and stops, the keys are done. Without lastDataAt (tests):
// settle().
JJPtt.prototype.sendSync = function(keys, ms) {
  var app = this.app, self = this;
  if (typeof app.lastDataAt !== 'number') {
    var prev = this.screen();
    this.send(keys);
    return this.settle(prev, ms);
  }
  var d0 = app.lastDataAt, until = Date.now() + (ms || 2000);
  this.send(keys + '\x0c');
  return new Promise(function(resolve) {
    var tick = function() {
      if (Date.now() > until || !self.connected()) return resolve();
      if (app.lastDataAt > d0 && Date.now() - app.lastDataAt >= 60) return resolve();
      setTimeout(tick, 20);
    };
    setTimeout(tick, 20);
  });
};

JJPtt.prototype.quiet = function(ms, max) {
  var app = this.app, self = this;
  if (typeof app.lastDataAt !== 'number') return this.steady(ms);
  var until = Date.now() + (max || 2000);
  return new Promise(function(resolve) {
    var tick = function() {
      if (Date.now() - app.lastDataAt >= ms || Date.now() > until || !self.connected()) return resolve();
      setTimeout(tick, JJPtt.STEP_MS);
    };
    tick();
  });
};

JJPtt.prototype.screen = function() {
  var buf = this.app.buf;
  if (!buf || !buf.getRowText) return '';
  var rows = [];
  for (var r = 0; r < (buf.rows || 24); ++r) rows.push(buf.getRowText(r, 0, buf.cols));
  return rows.join('\n');
};

JJPtt.prototype.send = function(keys) {
  if (this.app.conn) this.app.conn.send(keys);
};

JJPtt.prototype.type = function(text) {
  var conn = this.app.conn;
  if (!conn) return;
  if (conn.convSend) conn.convSend(text);
  else conn.send(text);
};

JJPtt.sleep = function(ms) {
  return new Promise(function(r) { setTimeout(r, ms); });
};

// Waits until one of `cases` matches the screen; resolves with its key.
// cases: { key: RegExp }. Rejects after `ms` (or when the connection drops).
// With `since` (a screen() taken before typing), only lines that changed
// since then count: what was already there (an old error...) is not PTT's
// answer.
JJPtt.prototype.wait = function(cases, ms, since, label) {
  var self = this;
  var until = Date.now() + (ms || JJPtt.TIMEOUT_MS);
  var before = since === undefined ? null : String(since).split('\n');
  return new Promise(function(resolve, reject) {
    var tick = function() {
      if (!self.connected()) return reject(new Error('和 PTT 的連線斷了'));
      var text = self.screen();
      if (before) {
        text = text.split('\n').filter(function(line, i) { return line !== before[i]; }).join('\n');
      }
      for (var k in cases) {
        if (cases[k].test(text)) return resolve(k);
      }
      if (Date.now() > until) return reject(new Error('PTT 沒有回應' + (label ? '（' + label + '）' : '') + '，請再試一次'));
      setTimeout(tick, JJPtt.STEP_MS);
    };
    tick();
  });
};

// Instead of a fixed pause after a key: as soon as the screen has changed
// from `prev` and stopped changing (PTT draws in pieces), or after `ms`.
// Resolves true when it changed.
JJPtt.prototype.settle = function(prev, ms) {
  var self = this;
  var until = Date.now() + (ms || 1000);
  return new Promise(function(resolve) {
    var last = null;
    var tick = function() {
      var now = self.screen();
      if (now !== prev && now === last) return resolve(true);
      if (Date.now() > until) return resolve(now !== prev);
      last = now;
      setTimeout(tick, JJPtt.STEP_MS);
    };
    setTimeout(tick, JJPtt.STEP_MS);
  });
};

// Screens PTT puts in the way, and the key that gets past each.
JJPtt.HURDLES = [
  [/按任意鍵繼續|請按任意鍵|按任一鍵/, ' '],
  [/您要刪除以上錯誤嘗試的記錄嗎/, 'y\r'],
  [/有一篇文章尚未完成|尚未完成的文章/, 'q\r'],
  [/請選擇簽名檔/, '0\r']
];

// ---- login / logout -----------------------------------------------------------------------

JJPtt.prototype.connect = function() {
  var self = this;
  if (this.connected()) return Promise.resolve();
  this.setState('connecting');
  var conn = this.app.conn;
  // JJptt's own auto-login and duplicate-login answer stay out: this
  // types everything itself
  if (conn) conn.loginStr = ['', '', '', ''];
  var buf = this.app.buf;
  if (buf) {
    buf.enableDeleteDupLogin = false;
    // a new connection starts on a blank screen: nothing left over from
    // the last one may be read as PTT's answer
    try { if (buf.clear) buf.clear(2); } catch (e) {}
  }
  this.app.connect('ptt.cc');
  var until = Date.now() + 20000;
  return new Promise(function(resolve, reject) {
    var tick = function() {
      if (self.connected()) return resolve();
      if (Date.now() > until) {
        self.setState('off');
        return reject(new Error('連不上 PTT，請確認網路'));
      }
      setTimeout(tick, 200);
    };
    tick();
  });
};

JJPtt.prototype.login = function(user, pass) {
  var self = this;
  var p = this.run(function() {
    return self.doLogin(user, pass);
  });
  this.waitLogin(p);
  return p;
};

// A login on its way (this.loggingIn, settles when it is over either
// way): pages read on the BBS wait for it instead of failing on 「登入後」
// in the seconds after the app opens.
JJPtt.prototype.waitLogin = function(p) {
  var self = this;
  var w = Promise.resolve(p).then(function() {}, function() {}).then(function() {
    if (self.loggingIn === w) self.loggingIn = null;
  });
  this.loggingIn = w;
  return w;
};

JJPtt.prototype.doLogin = function(user, pass) {
  var self = this;
  if (this.state === 'in' && this.connected() && user === this.user) return Promise.resolve();
  // which step was waited on, for the message when PTT does not answer
  var at = function(step) {
    return function(err) {
      if (err && /沒有回應/.test(err.message)) err.message = 'PTT 沒有回應（' + step + '），請再試一次';
      throw err;
    };
  };
  // how long each step took (設定 → 帳號 shows it)
  var t0 = Date.now(), last = t0, steps = [];
  var mark = function(name) {
    var now = Date.now();
    steps.push([name, now - last]);
    last = now;
    self.lastLogin = { at: t0, total: now - t0, steps: steps };
  };
  return this.connect().then(function() {
    mark('連線');
    return self.wait({ user: /請輸入代號/ }, 20000).catch(at('等帳號欄'));
  }).then(function() {
    mark('帳號欄出現');
    var before = self.screen();
    self.type(user + '\r');
    // only once PTT really asks for the password: what is typed before that
    // is thrown away (that made right passwords fail)
    return self.wait({ pass: /請輸入您的密碼/ }, 15000, before).catch(at('等密碼欄'));
  }).then(function() {
    mark('密碼欄出現');
    return JJPtt.sleep(100);
  }).then(function() {
    var before = self.screen();
    self.type(pass + '\r');
    // logged in as soon as PTT takes the password: the app says so right
    // away; the screens after it are cleared while nobody waits on them
    var accepted = function() {
      mark('密碼通過');
      self.user = user;
      self.pass = pass;
      self.setState('in');
    };
    return self.pastLogin(before, mark, accepted).catch(at('密碼送出後'));
  }).then(function() {
    // wherever PTT put us (分類看板, an article…): ← until the main menu,
    // so every login ends on the same screen
    return self.toMenu().catch(function() {});
  }).then(function() {
    mark('回到主選單');
  }).catch(function(err) {
    if (self.state === 'in') return;  // already in: a screen left over is no failure
    // dropped: the top bar must not stay on 「登入中…」
    self.disconnect();
    self.setState('off');
    throw err;
  });
};

// After the password: answer what PTT asks until the main menu.
// Where a login can end besides the main menu (an account's own setting).
JJPtt.LANDED = /【\s*(分類看板|看板列表|我\s*的\s*最愛|熱門看板)\s*】|(?:看板|系列)《[^》]+》|文章選讀|文章列表|系列文章/;

JJPtt.prototype.pastLogin = function(before, mark, accepted) {
  var self = this;
  // the app's own choice, off unless turned on: logging in on the phone
  // must not throw the computer's PTT off
  var dupAnswer = JJPtt.kickOthers() ? 'y\r' : 'n\r';
  var until = Date.now() + 25000;
  var isIn = false, dupDone = false;
  // only lines that changed since the last key count: an answered question
  // stays on the screen (that answered 「重複登入」 thirty times)
  var step = function() {
    if (Date.now() > until) return isIn ? Promise.resolve() : Promise.reject(new Error('登入逾時，請再試一次'));
    var cases = {
      wrong: /密碼不對|無此帳號|帳號不存在/,
      busy: /系統過載|請稍後再來|登入太頻繁/,
      dup: /刪除其他重複登入的連線/,
      hurdle: /按任意鍵|請按任意鍵|按任一鍵|您要刪除以上錯誤嘗試|尚未完成的文章|有一篇文章尚未完成/,
      menu: /【\s*主功能表\s*】|主功能表/,
      // some accounts start somewhere else: 【分類看板】, 我的最愛, a board,
      // or an article (an announcement shown after login)
      list: JJPtt.LANDED,
      article: /瀏覽\s*第\s*\d+\/\d+\s*頁|\(y\)回應/
    };
    if (dupDone) delete cases.dup;
    return self.wait(cases, isIn ? 3000 : 15000, before).catch(function(err) {
      // in, and nothing more that this knows: wherever it stopped is fine
      if (isIn) return 'quiet';
      throw err;
    }).then(function(k) {
      if (k === 'wrong' && !isIn) {
        // PTT's own words, so a misread screen can be told from a typo
        var said = (self.screen().split('\n').filter(function(l) { return /密碼不對|無此帳號|帳號不存在/.test(l); }).pop() || '').trim();
        throw new Error('帳號或密碼錯誤' + (said ? '（PTT：' + said.slice(0, 40) + '）' : ''));
      }
      if (k === 'busy' && !isIn) throw new Error('PTT 現在很忙，請稍後再試');
      if (!isIn && k !== 'wrong' && k !== 'busy') {
        isIn = true;
        if (accepted) accepted();
      }
      if (k === 'menu' || k === 'list' || k === 'article' || k === 'quiet') return null;
      if (mark) mark(k === 'dup' ? '重複登入的問題' : '按任意鍵等畫面');
      before = self.screen();
      if (k === 'dup') { dupDone = true; self.send(dupAnswer); }
      else if (!self.passHurdle()) self.send(' ');
      return self.settle(before, 1500).then(step);
    });
  };
  return step();
};

JJPtt.prototype.passHurdle = function() {
  var text = this.screen();
  for (var i = 0; i < JJPtt.HURDLES.length; ++i) {
    if (JJPtt.HURDLES[i][0].test(text)) {
      this.send(JJPtt.HURDLES[i][1]);
      return true;
    }
  }
  return false;
};

JJPtt.prototype.disconnect = function() {
  var conn = this.app.conn;
  try { if (conn && conn.isConnected) conn.disconnect(); } catch (e) {}
};

JJPtt.prototype.logout = function() {
  this.user = '';
  this.pass = '';
  this.disconnect();
  this.setState('off');
};

// ---- back from the background ----------------------------------------------------
// After the phone slept, the connection may be gone without anyone being
// told (the router forgot it): the first 推文 then waited ~15 seconds for
// nothing. So when the app comes back, the connection is checked and, if
// it is gone, logged in again right away, before anything is asked of it.

JJPtt.PROBE_AFTER_MS = 30000;  // away shorter than this: nothing to check
JJPtt.PROBE_MS = 4000;

// Ctrl-L (PTT redraws the screen, wherever it is): alive if anything comes back.
JJPtt.prototype.alive = function(ms) {
  var self = this, app = this.app;
  if (!this.connected()) return Promise.resolve(false);
  var since = Date.now();
  this.send('\x0c');
  var until = since + (ms || JJPtt.PROBE_MS);
  return new Promise(function(resolve) {
    var tick = function() {
      if (!self.connected()) return resolve(false);
      if ((app.lastDataAt || 0) >= since) return resolve(true);
      if (Date.now() > until) return resolve(false);
      setTimeout(tick, JJPtt.STEP_MS);
    };
    tick();
  });
};

// awayMs: how long the app was in the background.
JJPtt.prototype.resume = function(awayMs) {
  var self = this;
  if (!this.user) return Promise.resolve();
  return this.run(function() {
    if (!(self.state === 'in' && self.connected())) return self.ensureIn();
    if (typeof awayMs !== 'number' || awayMs < JJPtt.PROBE_AFTER_MS) return;
    return self.alive().then(function(ok) {
      if (ok) return;
      self.disconnect();
      self.setState('off');
      return self.ensureIn();
    });
  });
};

// Logged in again if the connection dropped (the phone slept...).
JJPtt.prototype.ensureIn = function() {
  if (this.state === 'in' && this.connected()) return Promise.resolve();
  if (!this.user) return Promise.reject(new Error('請先登入'));
  this.state = 'off';
  return this.doLogin(this.user, this.pass);
};

// ---- getting to an article --------------------------------------------------------------

// The cursor is then checked (Q: the 文章網址 of the article under it): a
// list still in a search (a filtered list read on the BBS before) has the
// AID land on another article nearby, which was opened -- and pushed to --
// instead. Then out of the search (←) and once more; never the wrong one.
JJPtt.prototype.toArticle = function(url, again) {
  var self = this;
  var board = JJPtt.boardFromUrl(url);
  var aid = JJPtt.aidFromUrl(url);
  if (!board || !aid) return Promise.reject(new Error('看不懂這篇文章的網址'));
  var before;
  return this.toBoard(board).then(function() {
    // the prompt itself, newly shown (not any 「#」 already on the list)
    before = self.screen();
    self.send('#');
    return self.wait({ ask: /文章代碼|AID/ }, 5000, before, '找文章代碼');
  }).then(function() {
    var prev = self.screen();
    self.send(aid + '\r');
    return self.settle(prev, 1500);
  }).then(function() {
    if (/找不到這個文章代碼|找不到|沒有這篇/.test(self.screen())) throw new Error('在 PTT 上找不到這篇文章');
    return self.urlHere();
  }).then(function(here) {
    if (JJPtt.sameArticle(here, url)) return;
    console.log('JJptt BBS 文章代碼跳到別篇', url, here);
    if (again) throw new Error('PTT 跳到別篇文章了，請再試一次');
    var prev = self.screen();
    self.send('\x1b[D');  // out of a search (or out of the board: toBoard goes back in)
    self.listQuery = '';
    return self.settle(prev, 2000).then(function() { return self.toArticle(url, true); });
  });
};

// The 文章網址 of the article under the list's cursor (Q, then any key
// closes the box).
JJPtt.prototype.urlHere = function() {
  var self = this, here = '';
  var prev = this.screen();
  this.send('Q');
  return this.wait({ url: JJPtt.URL_IN_BOX }, 5000, prev, '找文章網址').then(function() {
    here = JJPtt.URL_IN_BOX.exec(self.screen())[0].replace(/^http:/, 'https:');
    var p2 = self.screen();
    self.send(' ');
    return self.settle(p2, 1500);
  }).then(function() { return here; });
};

// Two www.ptt.cc addresses of the same article (http / https, ?query aside).
JJPtt.sameArticle = function(a, b) {
  var key = function(u) {
    var m = /\/bbs\/([\w\-]+)\/([MG]\.\d+\.A\.[0-9A-Fa-f]+)\.html/.exec(u || '');
    return m ? (m[1] + '/' + m[2]).toLowerCase() : '';
  };
  return !!key(a) && key(a) === key(b);
};

// A question PTT left open on the bottom line (a push's text or its
// 確定 [y/N], the AID or board-name prompt): keys typed now would go into it.
JJPtt.PROMPT = /\[y\/n\]|(推|噓|→)\s*\w+\s*[:：]|請輸入|文章代碼|\(AID\)|[:：]\s*$/i;

// Empties and closes such a question (backspaces, then Enter: an empty push
// or name is cancelled, Enter at [y/N] is No).
JJPtt.prototype.clearPrompt = function() {
  var lines = this.screen().split('\n').filter(function(l) { return l.trim(); });
  if (!JJPtt.PROMPT.test(lines[lines.length - 1] || '')) return Promise.resolve();
  var before = this.screen();
  this.send(new Array(81).join('\b') + '\r');
  return this.settle(before, 1500);
};

// Into a board's article list.
JJPtt.prototype.toBoard = function(board) {
  var self = this;
  if (!/^[A-Za-z0-9_\-]{1,20}$/.test(board || '')) return Promise.reject(new Error('看板名稱不對'));
  // already in its article list (e.g. back from the last article read)
  // -- inside a search there, ← goes back to the whole list (pttbbs
  // read_cmd_quit: all conditions at once)
  // The list's footer tells which: 「文章列表」 the whole list, 「系列文章」
  // a search (what this.listQuery says can be out of date: a job stopped
  // half way, an error) -- and s into the same board keeps the search, so
  // the next search was added to it (找不到符合條件的文章) and an AID
  // landed on an article nearby. depth: ← at most a few times.
  var depth = arguments[1] || 0;
  if (this.inList(board)) {
    var foot = this.listFoot();
    if (foot !== 'search' && (foot === 'list' || !this.listQuery)) { this.listQuery = ''; return Promise.resolve(); }
    var prev0 = this.screen();
    this.send('\x1b[D');
    this.listQuery = '';
    return this.settle(prev0, 2000).then(function() {
      if (depth < 3) return self.toBoard(board, depth + 1);
    });
  }
  this.listQuery = '';
  // out of an article, then "s" (select board) -- which only works in a
  // list, not in the main menu: from there, 我的最愛 first
  return this.clearPrompt().then(function() {
    // an article (a board list's footer says (y)回應 too: stay there)
    var now = self.screen();
    if (/瀏覽 第/.test(now) || (/\(y\)回應/.test(now) && !/文章選讀|文章列表|系列文章/.test(now))) {
      self.send('q');
      return self.settle(now, 1000);
    }
  }).then(function() {
    if (/【\s*主功能表\s*】|主功能表/.test(self.screen())) return self.enterFavorites();
  }).then(function() {
    // only PTT's own prompt, newly on the screen: a board list's header
    // says 「[s]選擇看板」 all the time, and the name typed before the prompt
    // opens is thrown away (pushes failed with 「進 Gossiping 板」)
    var before = self.screen();
    self.send('s');
    return self.wait({ ask: /請輸入看板名稱/ }, 8000, before, '開啟看板選單');
  }).then(function() {
    self.type(board + '\r');
    var name = board.replace(/[^\w-]/g, '');
    var boardRe = new RegExp('(?:看板|系列)《' + name + '》', 'i');
    // in 我的最愛 / 看板列表, s only moves the cursor onto the board: → goes in
    var cursorRe = new RegExp('^\\s*>\\s*\\d+\\s+[ˇ∨\\s]?\\s*' + name + '\\s', 'mi');
    var until = Date.now() + 15000, moved = 0;
    var step = function() {
      if (Date.now() > until) return Promise.reject(new Error('PTT 沒有回應（進 ' + board + ' 板），請再試一次'));
      return self.wait({
        none: /無此看板|沒有這個看板/,
        hurdle: /按任意鍵|請按任意鍵|按任一鍵/,
        // the board's own article list (its header names the 板主); a
        // board list's header can name the board under the cursor too
        inboard: /【\s*板主|文章選讀|文章列表|系列文章/,
        cursor: cursorRe
      }, 10000, undefined, '進 ' + board + ' 板').then(function(k) {
        if (k === 'none') throw new Error('沒有 ' + board + ' 這個看板');
        if (k === 'inboard') {
          if (boardRe.test(self.screen())) return null;
          // still the board we came from: wait for the new one
          if (cursorRe.test(self.screen()) && moved < 2) { moved++; self.send('\x1b[C'); }
          return JJPtt.sleep(200).then(step);
        }
        var before = self.screen();
        if (k === 'cursor') {
          if (moved >= 2) return JJPtt.sleep(200).then(step);
          moved++;
          self.send(moved === 1 ? '\x1b[C' : '\r');
        } else {
          self.send(' ');
        }
        return self.settle(before, 1500).then(step);
      });
    };
    return step();
  }).then(function() {
    // in, but still in the search it was in before (s keeps it)
    if (self.listFoot() === 'search' && depth < 3) return self.toBoard(board, depth + 1);
  });
};

// Answers PTT's questions until `done` shows. cases: { key: RegExp };
// answer(key) returns the keys to send. Each question is answered once:
// on the real PTT an answered question stays on the screen while the next
// one is asked under it, and must not be answered again. 'hurdle' (any key)
// and 'sign' may come back.
JJPtt.prototype.answerUntil = function(cases, answer, ms, failMessage) {
  var self = this;
  var answered = {};
  var until = Date.now() + (ms || 15000);
  var step = function() {
    if (Date.now() > until) return Promise.reject(new Error(failMessage || 'PTT 沒有回應，請再試一次'));
    var open = {};
    for (var k in cases) if (!answered[k]) open[k] = cases[k];
    return self.wait(open, 10000).then(function(k) {
      var keys = answer(k);
      if (keys === null) return k;
      if (k !== 'hurdle' && k !== 'sign') answered[k] = true;
      // an answer with Chinese in it (a title) is typed: converted to Big5, not sent as it is
      if (keys) {
        if (/[^\x00-\x7f]/.test(keys)) self.type(keys);
        else self.send(keys);
      }
      return JJPtt.sleep(500).then(step);
    });
  };
  return step();
};

// The editor: type the lines, Ctrl-X, save, then past the signature and the
// 「順利貼出佈告」 screen.
JJPtt.prototype.typeAndSave = function(lines, endWithNewline) {
  var self = this;
  lines.forEach(function(line, i) {
    if (line) self.type(line);
    if (i < lines.length - 1 || endWithNewline) self.send('\r');
  });
  return JJPtt.sleep(300).then(function() {
    self.send('\x18');
    return self.wait({ save: /檔案處理|\(S\)存檔/ }, 8000, undefined, '存檔');
  }).then(function() {
    self.send('s\r');
    return self.answerUntil({
      no: /無法發表|不能發文|禁止發文|權限不足|無法在此發表/,
      done: /順利貼出|貼出佈告|文章已發表/,
      sign: /請選擇簽名檔/,
      hurdle: /按任意鍵|請按任意鍵/,
      list: /文章選讀|文章列表|系列文章|看板《/
    }, function(k) {
      if (k === 'no') throw new Error('這個板不能發文');
      if (k === 'done' || k === 'list') {
        if (/按任意鍵|請按任意鍵/.test(self.screen())) self.send(' ');
        return null;
      }
      return k === 'sign' ? '0\r' : ' ';
    }, 15000, '不確定有沒有貼出去，請到板上看看');
  });
};

// ---- push (推 / 噓 / →) -----------------------------------------------------------------------

JJPtt.prototype.push = function(url, kind, text) {
  var self = this;
  text = String(text || '').replace(/\s+/g, ' ').trim();
  if (!text) return Promise.reject(new Error('沒有內容'));
  return this.run(function() {
    return self.ensureIn().then(function() {
      return self.toArticle(url);
    }).then(function() {
      // only what PTT newly shows counts: an old push line or the list's
      // header (看板《…》) is not its answer
      var before = self.screen();
      self.send('X');
      return self.wait({
        choose: /值得推薦|給它噓聲|只加.*註解|1\.\s*值得/,
        input: /(推|噓|→)\s*\w+\s*[:：]/,
        no: /禁止推薦|不能推薦|無法推文|禁止推文|您不能|已被鎖定|權限不足/,
        wait: /推文間隔|請稍候|太快/
      }, 8000, before, '按 X 推文');
    }).then(function(k) {
      if (k === 'no') throw new Error('這個板或這篇文章不能推文');
      if (k === 'wait') throw new Error('推文太快了，等一下再試');
      if (k === 'choose') {
        var before = self.screen();
        self.send(kind === '2' ? '2' : kind === '3' ? '3' : '1');
        return self.wait({ input: /(推|噓|→)\s*\w+\s*[:：]/, no: /禁止|不能|無法/ }, 6000, before, '選推噓後等輸入框');
      }
      return k;
    }).then(function(k) {
      if (k === 'no') throw new Error('這篇文章不能用這種方式推文');
      var before = self.screen();
      self.type(text + '\r');
      // the list header says 看板《…》 all along: only its footer coming
      // back (文章選讀) or the 確定 question is PTT's answer
      return self.wait({ confirm: /確定.*\[y\/n\]|確定要/i, done: /文章選讀|文章列表|系列文章/ }, 8000, before, '送出推文');
    }).then(function(k) {
      if (k !== 'confirm') return;
      return self.confirmPush();
    }).then(function() {
      return JJPtt.sleep(300);
    });
  });
};

// The bottom line with something on it.
JJPtt.prototype.lastLine = function() {
  var lines = this.screen().split('\n').filter(function(l) { return l.trim(); });
  return (lines[lines.length - 1] || '').trim();
};

JJPtt.CONFIRM = /確定.*\[y\/n\]|確定要/i;

// Answers the push's 確定 question. PTT's answer can be the list again
// (文章選讀), the article (瀏覽 第: when the question took y alone, the
// Enter opened it), a message to get past, or just the question gone from
// the bottom line; a refusal (推文太快…) is passed on in PTT's words.
JJPtt.prototype.confirmPush = function() {
  var self = this;
  var before = this.screen();
  var lastBefore = this.lastLine();
  this.send('y\r');
  // only the bottom line, newly changed: an article's own text is not PTT's answer
  var bottom = function(re) {
    return { test: function() { var l = self.lastLine(); return l !== lastBefore && re.test(l); } };
  };
  return this.wait({
    no: bottom(/太快|間隔|禁止|無法|不能|失敗|權限/),
    hurdle: bottom(/按任意鍵|請按任意鍵|按任一鍵/),
    done: /文章選讀|文章列表|系列文章|瀏覽 第/,
    gone: { test: function() { return self.screen() !== before && !JJPtt.CONFIRM.test(self.lastLine()); } }
  }, 8000, before, '確定推文').then(function(k) {
    if (k === 'no') throw new Error('PTT 沒讓這則推文出去：' + self.lastLine().replace(/\s+/g, ' ').slice(0, 40));
    if (k === 'hurdle') self.send(' ');
  }, function() {
    throw new Error('不確定有沒有推出去，請重新整理看看（PTT 最後一行：' + self.lastLine().replace(/\s+/g, ' ').slice(0, 30) + '）');
  });
};

// ---- reply (回文到看板) -------------------------------------------------------------------------

JJPtt.prototype.reply = function(url, text, quote) {
  var self = this;
  var lines = String(text || '').replace(/\r/g, '').split('\n');
  if (!String(text || '').trim()) return Promise.reject(new Error('沒有內容'));
  return this.run(function() {
    return self.ensureIn().then(function() {
      return self.toArticle(url);
    }).then(function() {
      self.send('y');
      // answer the questions until the editor is open
      return self.answerUntil({
        no: /無法回應|不能回文|禁止回文|唯讀|權限不足|您不能/,
        editor: JJPtt.EDITOR,
        where: /回應至|\(F\)看板/,
        title: /採用原標題/,
        quote: /引用原文/
      }, function(k) {
        if (k === 'no') throw new Error('這個板不能回文');
        if (k === 'editor') return null;
        if (k === 'where') return 'f\r';
        if (k === 'title') return 'y\r';
        return quote ? 'y\r' : 'n\r';
      }, 15000, 'PTT 沒有開啟編輯畫面');
    }).then(function() {
      return self.typeAndSave(lines, quote);
    });
  });
};

// ---- post (發文) ------------------------------------------------------------------------------

// The board's categories as PTT lists them after Ctrl-P:
// "種類：1.問題 2.建議 3.討論 ... (1-8或不選)" -> ['問題', '建議', '討論', ...]
JJPtt.parsePostTypes = function(screen) {
  var line = String(screen || '').split('\n').filter(function(l) { return /種類：/.test(l); }).pop();
  if (!line) return [];
  line = line.slice(line.indexOf('種類：') + 3).replace(/\(1-\d.*$/, '');
  var out = [], re = /(\d)\.(\S+)/g, m;
  while ((m = re.exec(line))) out[+m[1] - 1] = m[2];
  return out.filter(function(x) { return x; });
};

// Categories seen on each board (after a post there), for the app's chips.
JJPtt.TYPES_KEY = 'jjptt.m.postTypes';
JJPtt.postTypes = function(board) {
  try {
    var all = JSON.parse(window.localStorage.getItem(JJPtt.TYPES_KEY) || '{}');
    return all[String(board).toLowerCase()] || [];
  } catch (e) { return []; }
};
JJPtt.savePostTypes = function(board, types) {
  if (!types.length) return;
  try {
    var all = JSON.parse(window.localStorage.getItem(JJPtt.TYPES_KEY) || '{}');
    all[String(board).toLowerCase()] = types;
    window.localStorage.setItem(JJPtt.TYPES_KEY, JSON.stringify(all));
  } catch (e) {}
};

// The editor's footer (not the list's「(^X)轉錄」).
JJPtt.EDITOR = /編輯文章|\^X\/\^Q|檔案處理/;

// Title width PTT keeps (TTLEN), with the "[類別] " PTT puts in front.
JJPtt.TITLE_BYTES = 64;

// post(board, type, title, text): type is a category name ('問卦'...) or ''.
// One of the board's own categories is picked by its number; any other is
// put in front of the title as "[type] ", since PTT only takes 1-8 there.
JJPtt.prototype.post = function(board, type, title, text) {
  var self = this;
  type = String(type || '').replace(/[\[\]\s]/g, '');
  title = String(title || '').replace(/\s+/g, ' ').trim();
  var lines = String(text || '').replace(/\r/g, '').split('\n');
  if (!title) return Promise.reject(new Error('請輸入標題'));
  if (!String(text || '').trim()) return Promise.reject(new Error('沒有內容'));
  var typeAsked = false;
  return this.run(function() {
    return self.ensureIn().then(function() {
      return self.toBoard(board);
    }).then(function() {
      self.send('\x10');  // Ctrl-P
      return self.answerUntil({
        no: /無法在此發表|無法發表|不能發文|禁止發文|權限不足|您不能|未達.*(限制|標準)|唯讀/,
        editor: JJPtt.EDITOR,
        type: /種類：|或不選/,
        title: /標題：/,
        hurdle: /按任意鍵|請按任意鍵|按任一鍵/
      }, function(k) {
        if (k === 'no') throw new Error('你現在不能在 ' + board + ' 板發文');
        if (k === 'editor') return null;
        if (k === 'hurdle') return ' ';
        if (k === 'type') {
          typeAsked = true;
          var types = JJPtt.parsePostTypes(self.screen());
          JJPtt.savePostTypes(board, types);
          var i = type ? types.indexOf(type) : -1;
          if (i >= 0) return String(i + 1) + '\r';
          if (type) title = '[' + type + '] ' + title;
          return '\r';
        }
        // the title (no category question asked: a category goes in front)
        if (type && !typeAsked) title = '[' + type + '] ' + title;
        return title + '\r';
      }, 20000, 'PTT 沒有開啟編輯畫面');
    }).then(function() {
      return self.typeAndSave(lines, false);
    });
  });
};

// ---- 我的最愛 (the account's favourite boards) ---------------------------------------------

// One row of a board list: "   12 ˇGossiping    綜合 ◎[八卦] 亂講話   爆! 板主"
// -> { name, title }; folders (Σ, or 我的最愛's own 「目錄 □」) and
// separator lines give null.
JJPtt.parseBoardRow = function(row) {
  var m = /^\s*[>●]?\s*(\d+)\s+[ˇ∨\s]?\s*([A-Za-z][\w\-]{1,15})\s+(\S{1,6})\s+([◎●Σ□]?)\s*(.*)$/.exec(row);
  if (!m || m[4] === 'Σ' || m[4] === '□' || m[3] === '目錄') return null;
  if (/^-+$/.test(m[2])) return null;
  var title = m[5].split(/\s{2,}/)[0].replace(/^◎/, '');
  // a title that fills its column runs straight into the next ones:
  // 「…三星獅爆!GreenChamb…」, 「…龍布…爆!hasebe/jou…」, 「…規…21 abc」
  return { n: +m[1], name: m[2], title: JJPtt.cleanTitle(title) };
};

// A title that filled its column runs straight into the next ones:
// 「…三星獅爆!GreenChamb…」, 「…龍布…爆!hasebe/jou…」, 「…規…21 abc」.
JJPtt.cleanTitle = function(title) {
  return String(title || '').replace(/(爆!|HOT)\S*$/, '').replace(/…\s*\d{1,3}(\s+\S+)?$/, '…').trim();
};

// Back to the main menu from wherever the connection is.
JJPtt.prototype.toMenu = function() {
  var self = this;
  var tries = 0;
  var step = function() {
    var text = self.screen();
    if (/【\s*主功能表\s*】|主功能表/.test(text)) return Promise.resolve();
    if (++tries > 12) return Promise.reject(new Error('回不到 PTT 主選單'));
    if (/確定要離開|您確定要離開|離開.*嗎/.test(text)) self.send('n\r');
    else if (/按任意鍵|請按任意鍵|按任一鍵/.test(text)) self.send(' ');
    else self.send('\x1b[D');
    return self.settle(text, 800).then(step);
  };
  return step();
};

// From the main menu into 我的最愛. The main menu itself says 「我 的 最愛」
// (its F item), so this waits for the board list's column header among what
// changed. A menu letter may only move the cursor there: then → goes in.
JJPtt.LIST_HEAD = /編號.*看\s*板|看\s*板.*類別|類別.*轉信/;
JJPtt.prototype.enterFavorites = function() {
  var self = this;
  var before = this.screen();
  this.send('f');
  return this.wait({ list: JJPtt.LIST_HEAD }, 2500, before).catch(function() {
    if (!/主功能表/.test(self.screen())) throw new Error('進不了我的最愛');
    self.send('\x1b[C');
    return self.wait({ list: JJPtt.LIST_HEAD }, 8000, before, '進我的最愛');
  });
};

// A folder row of 我的最愛: "     2   MyFavFolder 目錄 □MLB" -> { n, title }.
JJPtt.parseFolderRow = function(row) {
  var m = /^\s*[>●]?\s*(\d+)\s+[ˇ∨\s]?\s*([A-Za-z][\w\-]{1,15})\s+目錄\s+□\s*(.*)$/.exec(row);
  if (!m) return null;
  return { n: +m[1], title: m[3].split(/\s{2,}/)[0].trim() || m[2] };
};

// The account's 我的最愛, in PTT's order, with the boards inside its folders
// (each with `folder`: the folder's name):
//   [{ name, title }, { name, title, folder: 'MLB' }, ...]
JJPtt.prototype.favorites = function() {
  var self = this;
  return this.run(function() {
    var out = [];
    // one list (我的最愛 or a folder), every page; folders found are
    // returned with where they were, to be read afterwards
    var readList = function(folder) {
      var boards = [], folders = [], seen = {};
      var lastFirst = -1, pages = 0;
      var read = function() {
        var buf = self.app.buf;
        var first = -1;
        for (var r = 2; r < (buf.rows || 24) - 1; ++r) {
          var text = buf.getRowText(r, 0, buf.cols);
          var num = /^\s*[>●]?\s*(\d+)\s/.exec(text);
          if (!num) continue;
          if (first < 0) first = +num[1];
          if (seen[num[1]]) continue;
          var b = JJPtt.parseBoardRow(text);
          var f = !b && !folder && JJPtt.parseFolderRow(text);
          if (b || f) seen[num[1]] = true;
          if (b) boards.push(folder ? { name: b.name, title: b.title, folder: folder } : { name: b.name, title: b.title });
          if (f) folders.push({ n: f.n, title: f.title, at: boards.length });
        }
        return first;
      };
      var page = function() {
        var first = read();
        if (first === lastFirst || ++pages > 30) return Promise.resolve({ boards: boards, folders: folders });
        lastFirst = first;
        var prev = self.screen();
        self.send('\x1b[6~');  // page down
        // no change: that was the last page
        return self.settle(prev, 900).then(function(moved) {
          return moved ? page() : { boards: boards, folders: folders };
        });
      };
      return page();
    };
    // into folder number n (jump to it, →), read it, ← back out. A folder
    // that can't be opened is left out, not the whole sync.
    var readFolder = function(f) {
      var prev = self.screen();
      self.type(String(f.n) + '\r');
      return self.settle(prev, 600).then(function() {
        var at = self.screen();
        self.send('\x1b[C');
        return self.settle(at, 1500).then(function(entered) {
          if (!entered) return [];
          return readList(f.title).then(function(r) {
            var inside = self.screen();
            self.send('\x1b[D');
            return self.settle(inside, 1000).then(function() { return r.boards; });
          });
        });
      });
    };
    return self.ensureIn().then(function() {
      return self.toMenu();
    }).then(function() {
      return self.enterFavorites();
    }).then(function() {
      // the rows come a moment after the header: wait for the first one
      // (none within 4 s: an empty 我的最愛)
      return self.wait({ row: /^\s*[>●]?\s*\d+\s+[ˇ\s]?\s*[A-Za-z][\w\-]+\s+\S/m }, 4000).catch(function() {});
    }).then(function() {
      return readList('');
    }).then(function(top) {
      var inside = [];
      var next = function(i) {
        if (i >= top.folders.length) return Promise.resolve();
        return readFolder(top.folders[i]).then(function(b) {
          inside[i] = b;
          return next(i + 1);
        });
      };
      return next(0).then(function() {
        // each folder's boards where the folder was
        var at = 0;
        top.folders.forEach(function(f, i) {
          out = out.concat(top.boards.slice(at, f.at), inside[i] || []);
          at = f.at;
        });
        out = out.concat(top.boards.slice(at));
      });
    }).then(function() {
      self.send('\x1b[D');  // leave the list
      return out;
    });
  });
};

// ---- reading through the connection when www.ptt.cc is down --------------------------------
// PTT's web pages (www.ptt.cc) sometimes fail (HTTP 500) while the BBS
// itself works. Then the board list and the articles are read from the BBS
// screen and turned into the same HTML as the web pages, so the rest of the
// app is unchanged (PttReader.termDoc). Addresses used instead of web pages:
//   jjterm:list/<board>/<before>   the articles numbered below <before> (0: the newest)
//   jjterm:art/<board>/<number>    article <number> of the board
//   jjterm:search/<board>/<before>/<query>   PTT's own search (JJPtt.searchCmd);
//     numbers in it are the search list's own, so its articles are
//   jjterm:art/<board>/<number>/<query>      opened from inside that search

JJPtt.TERM = 'jjterm:';
JJPtt.isTermUrl = function(url) {
  return String(url || '').indexOf(JJPtt.TERM) === 0;
};

// One row of a board's article list:
// "  12345 + 311/19 someone      □ [問卦] title" ->
// { num, nrec, date, author, title, deleted }; 置底 (★) rows give num 0.
// PTT's columns have fixed widths (pttbbs bbs_coldefs): number 6, then
// " " + mark + 推文數 in exactly 2 columns (" 3", "10", 爆, XX, X1, --),
// then the date with no space before it -- "+ 311/19" is 3 pushes on
// 11/19, not 31 on 1/19.
JJPtt.parseArticleRow = function(row) {
  var m = /^[>●\s]?\s*(\d+|★)\s([+mMsSD*!=~ ])(爆|XX|X\d|\d\d| \d|--|  )?\s*(\d{1,2}\/\d{2}) (\S+) +(□|轉|R:?)\s?(.*)$/.exec(String(row || ''));
  if (!m) return null;
  var title = m[7].replace(/\s+$/, '');
  if (m[6] === '轉') title = 'Fw: ' + title;
  else if (m[6] !== '□') title = 'Re: ' + title;
  var nrec = (m[3] || '').trim();
  return {
    num: m[1] === '★' ? 0 : +m[1],
    nrec: nrec === '--' ? '' : nrec,
    date: m[4],
    author: m[5] === '-' ? '-' : m[5],
    title: title,
    deleted: m[5] === '-' || /^\(本文已被刪除\)/.test(m[7])
  };
};

JJPtt.esc = function(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

// www.ptt.cc's search?q= ("author:x", "recommend:n" -- n < 0: 噓 --, or
// words of the title) as PTT's own search in a board's list: the key, the
// prompt it answers to (「搜尋作者: 」, or 「增加條件 作者: 」 inside a
// search) and what to type.
JJPtt.searchCmd = function(q) {
  q = String(q || '').trim();
  var m;
  if ((m = /^author:\s*(\S+)$/.exec(q))) return { key: 'a', ask: /(搜尋|增加條件) ?作者/, text: m[1] };
  if ((m = /^recommend:\s*(-?\d+)$/.exec(q))) return +m[1] ? { key: 'Z', ask: /搜尋推文數|增加條件 ?推文數/, text: String(+m[1]) } : null;
  return q ? { key: '/', ask: /(搜尋|增加條件) ?標題/, text: q } : null;
};

// A board index page like www.ptt.cc's (what JJMobile.parseIndex reads);
// query: rows from that search (their links open the article inside it).
JJPtt.indexHtml = function(board, rows, older, query) {
  var esc = JJPtt.esc;
  var h = ['<div id="topbar"><a class="board">看板 ' + esc(board) + '</a></div><div class="btn-group-paging">'];
  if (older) h.push('<a class="btn" href="' + esc(older) + '">‹ 上頁</a>');
  h.push('</div><div class="r-list-container">');
  var tail = query ? '/' + encodeURIComponent(query) : '';
  rows.forEach(function(r) {
    var t = r.deleted ? esc(r.title) : '<a href="' + esc(JJPtt.TERM + 'art/' + encodeURIComponent(board) + '/' + r.num + tail +
      JJPtt.wantHash(r)) + '">' + esc(r.title) + '</a>';
    h.push('<div class="r-ent"><div class="nrec">' + esc(r.nrec) + '</div><div class="title">' + t +
      '</div><div class="meta"><div class="author">' + esc(r.author) + '</div><div class="date">' + esc(r.date) + '</div></div></div>');
  });
  h.push('</div>');
  return h.join('');
};

// A list row's author and title after the article's address (#author/title):
// opening it checks that the number still lands on that article -- PTT's
// list may have changed since (a search redone, other conditions on it), and
// a number alone then opens another one. JJPtt.wantFromUrl reads it back.
JJPtt.wantHash = function(r) {
  return r && r.author && r.title ? '#' + encodeURIComponent(r.author) + '/' + encodeURIComponent(r.title) : '';
};
JJPtt.wantFromUrl = function(url) {
  var m = /#([^\/#]+)\/([^#]+)$/.exec(String(url || ''));
  if (!m) return null;
  try {
    return { author: decodeURIComponent(m[1]), title: decodeURIComponent(m[2]) };
  } catch (e) { return null; }
};

// The article's lines as read from the screen -> an article page like
// www.ptt.cc's (#main-content with the header lines and .push lines).
JJPtt.PUSH_LINE = /^(推|噓|→) ?(\w+)\s*:(.*?)\s*((?:\d{1,3}\.){3}\d{1,3})?\s*(\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2})?)\s*$/;
JJPtt.articleHtml = function(lines) {
  var esc = JJPtt.esc;
  var link = function(s) {
    return esc(s).replace(/https?:\/\/[^\s<>"]+/g, function(u) { return '<a href="' + u + '">' + u + '</a>'; });
  };
  var meta = [], i = 0;
  for (; i < Math.min(lines.length, 6); ++i) {
    var l = lines[i] || '';
    var m = /^\s*作者\s+(.+?)(?:\s{2,}看板\s+(\S+))?\s*$/.exec(l);
    if (m) {
      meta.push('<div class="article-metaline"><span class="article-meta-tag">作者</span><span class="article-meta-value">' + esc(m[1].trim()) + '</span></div>');
      if (m[2]) meta.push('<div class="article-metaline-right"><span class="article-meta-tag">看板</span><span class="article-meta-value">' + esc(m[2]) + '</span></div>');
      continue;
    }
    m = /^\s*(標題|時間)\s+(.*?)\s*$/.exec(l);
    if (m) {
      meta.push('<div class="article-metaline"><span class="article-meta-tag">' + m[1] + '</span><span class="article-meta-value">' + esc(m[2]) + '</span></div>');
      continue;
    }
    if (/^\s*[─-]{10,}\s*$/.test(l)) ++i;
    break;
  }
  var body = [];
  for (; i < lines.length; ++i) {
    var line = lines[i] || '';
    var p = JJPtt.PUSH_LINE.exec(line);
    if (p) {
      body.push('<div class="push"><span class="push-tag">' + p[1] + ' </span><span class="push-userid">' + esc(p[2]) +
        '</span><span class="push-content">: ' + link(p[3].trim()) + '</span><span class="push-ipdatetime"> ' +
        (p[4] ? p[4] + ' ' : '') + p[5] + '\n</span></div>');
    } else {
      body.push((lines.html && lines.html[i] != null ? lines.html[i] : link(line)) + '\n');
    }
  }
  return '<div id="main-content">' + meta.join('') + body.join('') + '</div>';
};

// One screen row with its colours, as www.ptt.cc marks them (span class
// "f3 hl b4"; default white on black stays plain), URLs as links. A
// double-byte character takes its lead byte's colours; trailing blanks on
// black are dropped like the plain text's.
JJPtt.rowHtml = function(buf, row) {
  var line = buf.lines && buf.lines[row];
  if (!line) return undefined;  // no colours known: the plain text is used
  var cols = Math.min(buf.cols || line.length, line.length);
  var segs = [], cur = null;
  for (var c = 0; c < cols; ++c) {
    var ch = line[c];
    var w = ch.isLeadByte && c + 1 < cols ? 2 : 1;
    var text = w === 2 ? buf.getRowText(row, c, c + 2) : (ch.ch || ' ');
    var fg = ch.invert ? ch.bg : ch.fg, bg = ch.invert ? ch.fg : ch.bg;
    var key = (fg === 7 && bg === 0 && !ch.bright) ? '' : 'f' + fg + (ch.bright ? ' hl' : '') + ' b' + bg;
    if (!cur || cur.key !== key) segs.push(cur = { key: key, text: '' });
    cur.text += text;
    c += w - 1;
  }
  while (segs.length) {
    var last = segs[segs.length - 1];
    if (/ b[1-7]$/.test(last.key)) break;
    last.text = last.text.replace(/\s+$/, '');
    if (last.text) break;
    segs.pop();
  }
  var link = function(s) {
    return JJPtt.esc(s).replace(/https?:\/\/[^\s<>"&]+/g, function(u) { return '<a href="' + u + '">' + u + '</a>'; });
  };
  return segs.map(function(s) {
    return s.key ? '<span class="' + s.key + '">' + link(s.text) + '</span>' : link(s.text);
  }).join('');
};

// A board's article list, one screen: the newest, or those below `before`;
// with query, that search's (JJPtt.searchCmd), newest first like
// www.ptt.cc's search pages. Resolves with an index page's HTML
// (JJPtt.indexHtml).
JJPtt.prototype.boardPage = function(board, before, query) {
  var self = this;
  var none = {};
  return this.run(function() {
    return self.ensureIn().then(function() {
      return self.toList(board, query).catch(function(e) {
        if (e && e.searchEmpty) throw none;  // an empty list, not an error
        throw e;
      });
    }).then(function() {
      // a number then Enter jumps there; End: the newest article
      return self.sendSync(before > 1 ? String(before - 1) + '\r' : '\x1b[4~', 2000);
    }).then(function() {
      var buf = self.app.buf, rows = [], low = 0;
      for (var r = 1; r < (buf.rows || 24) - 1; ++r) {
        var a = JJPtt.parseArticleRow(buf.getRowText(r, 0, buf.cols));
        if (!a || !a.num || (before && a.num >= before)) continue;  // 置底 have no number to open
        rows.push(a);
        if (!low || a.num < low) low = a.num;
      }
      var older = low > 1 ? JJPtt.TERM + (query ? 'search/' : 'list/') + encodeURIComponent(board) + '/' + low +
        (query ? '/' + encodeURIComponent(query) : '') : '';
      if (query) rows.reverse();
      return JJPtt.indexHtml(board, rows, older, query);
    }).catch(function(e) {
      if (e === none) return JJPtt.indexHtml(board, [], '', query);
      throw e;
    });
  });
};

// Into a board's article list as toBoard does, then PTT's own search
// `query` (JJPtt.searchCmd) -- or out of any search when there is none.
// this.listQuery: the search the list is in now ('' none).
JJPtt.prototype.toList = function(board, query) {
  var self = this;
  var cmd = JJPtt.searchCmd(query);
  query = cmd ? String(query).trim() : '';
  if (query && this.listQuery === query && this.inList(board) && this.listFoot() !== 'list') return Promise.resolve();
  return this.toBoard(board).then(function() {
    if (!cmd) return;
    var prev = self.screen();
    self.send(cmd.key);
    return self.wait({ ask: cmd.ask }, 5000, prev, '搜尋').then(function() {
      var p2 = self.screen();
      self.type(cmd.text + '\r');
      return self.searched(p2);
    }).then(function() {
      // nothing found, or not searched (pttbbs select_read): a message to
      // close, and the whole list still there -- not the search's
      var said = JJPtt.SEARCH_FAIL.exec(self.screen());
      if (!said) { self.listQuery = query; return; }
      var p3 = self.screen();
      self.send(' ');
      return self.settle(p3, 1500).then(function() {
        var e = new Error(/找不到/.test(said[0]) ? '找不到符合條件的文章' :
          /未搜尋/.test(said[0]) ? 'PTT 暫時不讓搜尋（太頻繁），請過一陣子再試' : 'PTT ' + said[0].replace(/[。\s]+$/, ''));
        e.searchEmpty = /找不到/.test(said[0]);
        throw e;
      });
    });
  });
};
JJPtt.SEARCH_FAIL = /找不到符合條件的文章|搜尋服務異常[^\n]*|已達搜尋條件上限|未搜尋/;

// After a search's words and Enter: done once the list's footer is back at
// the bottom (or PTT says it found nothing) -- not when the screen first
// changes, which is only the echo of the words typed (「…的文章: 10」):
// the search itself takes PTT a moment more, and the keys sent meanwhile
// went into the question or were lost (searches piled up, 找不到, another
// article opened).
JJPtt.prototype.searched = function(prev) {
  var self = this;
  return this.wait({ done: /文章選讀|文章列表|系列文章/, fail: JJPtt.SEARCH_FAIL }, 10000, prev, '搜尋').then(function() {
    return self.quiet(60, 500);
  });
};

// The list's footer: 'list' (文章列表, the whole list), 'search' (系列文章),
// or '' (another footer, e.g. 文章選讀, or none).
JJPtt.prototype.listFoot = function() {
  var lines = this.screen().split('\n').filter(function(l) { return l.trim(); });
  var last = lines[lines.length - 1] || '';
  return /系列文章/.test(last) ? 'search' : /文章列表/.test(last) ? 'list' : '';
};

// In `board`'s article list (a search in it too), nothing asked at the bottom.
JJPtt.prototype.inList = function(board) {
  var here = this.screen(), lines = here.split('\n').filter(function(l) { return l.trim(); });
  return new RegExp('(?:看板|系列)《' + board + '》', 'i').test(here) && /文章選讀|文章列表|系列文章/.test(here) && !/瀏覽 第/.test(here) &&
    !JJPtt.PROMPT.test(lines[lines.length - 1] || '');
};

// The article under the cursor in the list, every page of it, as lines;
// back to the list afterwards.
JJPtt.prototype.readHere = function(onPage) {
  var self = this;
  var before = this.screen();
  this.send('\r');
  return this.wait({ article: /瀏覽 第/, gone: /本文已被刪除|找不到/ }, 8000, before, '打開文章').then(function(k) {
    if (k === 'gone') throw new Error('這篇文章已經被刪除了');
    return self.readPages(onPage);
  }).then(function(lines) {
    var prev = self.screen();
    self.send('q');
    return self.settle(prev, 1500).then(function() { return lines; });
  });
};

// The article open on the screen, from its first page (Home first when
// it is further down) to the last by Page Down, as lines. onPage(page,
// pages, lines so far) after each page read; false from it stops there
// (lines.stopped).
JJPtt.prototype.readPages = function(onPage) {
  var self = this;
  var lines = [], pages = 0;
  lines.html = [];  // the same lines with their colours (JJPtt.rowHtml)
  var read = function() {
    var buf = self.app.buf, n = buf.rows || 24;
    var st = buf.getRowText(n - 1, 0, buf.cols).parseStatusRow();
    if (!st) return null;
    for (var r = 0; r < n - 1 && st.rowIndexStart + r <= st.rowIndexEnd; ++r) {
      lines[st.rowIndexStart - 1 + r] = buf.getRowText(r, 0, buf.cols).replace(/\s+$/, '');
      lines.html[st.rowIndexStart - 1 + r] = JJPtt.rowHtml(buf, r);
    }
    return st;
  };
  var lastStart = 0, tries = 0;
  var page = function() {
    // PTT draws in pieces: read once nothing more comes and the screen
    // holds still -- and only a new page (its status line moved on). The
    // status line comes last (pmore draws the page, then its footer), so a
    // new one there means the page is all in: read at once (each page
    // waited 150 ms more, about a second for an article of five pages)
    var st0 = status();
    var whole = st0 && st0.rowIndexStart !== lastStart;
    return (whole ? Promise.resolve() : self.quiet(150, 2000).then(function() { return self.steady(300); })).then(function() {
      var st = status();
      if (st && lastStart && st.rowIndexStart === lastStart && st.pagePercent < 100 && ++tries < 20) {
        return JJPtt.sleep(100).then(page);
      }
      tries = 0;
      st = read();
      if (!st) throw new Error('PTT 沒有打開這篇文章');
      lastStart = st.rowIndexStart;
      if (onPage && onPage(st.pageIndex, st.pageTotal || st.pageIndex, lines) === false) {
        lines.stopped = true;
        return;
      }
      if (st.pagePercent >= 100 || ++pages > 300) return;
      var prev = self.screen();
      self.send('\x1b[6~');  // Page Down
      return self.wait({ next: /瀏覽 第/ }, 8000, prev, '讀下一頁').then(page);
    });
  };
  var status = function() {
    var buf = self.app.buf;
    return buf.getRowText((buf.rows || 24) - 1, 0, buf.cols).parseStatusRow();
  };
  var st = status();
  var start = Promise.resolve();
  if (st && st.rowIndexStart > 1) {
    var prev = this.screen();
    this.send('\x1b[1~');  // Home: the first page
    start = this.wait({ top: /目前顯示: 第 0*1~/ }, 5000, prev, '回到第一頁');
  }
  return start.then(page).then(function() {
    for (var i = 0; i < lines.length; ++i) if (lines[i] === undefined) lines[i] = '';
    return lines;
  });
};

// An article (its www.ptt.cc address, or jjterm:art/...) read on the BBS.
// Resolves with { url: its www.ptt.cc address, html: an article page }.
JJPtt.URL_IN_BOX = /https?:\/\/www\.ptt\.cc\/bbs\/[\w\-]+\/M\.\d+\.A\.\w+\.html/;
// opts.onPage(page, pages, lines) after each page (see readPages); opts.bg:
// reading ahead, which stops (err.yielded) when another job is waiting.
JJPtt.prototype.termArticle = function(url, want, opts) {
  var self = this;
  var real = url;
  opts = opts || {};
  var yielded = false, wrong = false;
  var onPage = function(i, n, lines) {
    if (opts.bg && self.fgWaiting > 0) { yielded = true; return false; }
    // another article than the list's: stopped before any of it is drawn
    if (want && /^jjterm:/.test(url) && !JJPtt.linesAre(lines, want)) { wrong = true; return false; }
    if (opts.onPage) return opts.onPage(i, n, lines, real);
  };
  return this.run(function() {
    if (opts.bg && self.fgWaiting > 0) { var e0 = new Error('讓給前面的工作'); e0.yielded = true; throw e0; }
    return self.ensureIn().then(function() {
      var m = /^jjterm:art\/([^\/]+)\/(\d+)(?:\/([^\/]+))?$/.exec(url);
      if (!m) return self.toArticle(url).then(function() { return self.readHere(onPage); });
      var open = function(byAuthor) {
        return self.toList(decodeURIComponent(m[1]), m[3] ? decodeURIComponent(m[3]) : '').then(function() {
          return self.cursorTo(+m[2], want, byAuthor);
        }).then(function() {
          // the article's 文章網址 (for pushing and replying)
          return self.urlHere();
        }).then(function(here) {
          real = here;
          return self.readHere(onPage);
        }).then(function(lines) {
          // the list said one article, PTT opened another (its list changed
          // under the number, the cursor not where the screen showed it):
          // never shown as that one -- found among the author's posts once more
          if (!want || yielded || (!wrong && JJPtt.linesAre(lines, want))) return lines;
          wrong = false;
          console.log('JJptt BBS 開錯篇', url, JJPtt.linesHead(lines));
          if (!byAuthor) return open(true);
          throw new Error('PTT 開到別篇文章了（' + want.title + '），請重新整理列表再試一次');
        });
      };
      return open(false);
    }).then(function(lines) {
      if (yielded) { var e = new Error('讓給前面的工作'); e.yielded = true; throw e; }
      return { url: real, html: JJPtt.articleHtml(lines) };
    });
  }, opts.bg);
};

// The article's own header (作者 / 標題 lines) is `want` ({ author, title }).
JJPtt.linesHead = function(lines) {
  var head = { author: '', title: '' };
  for (var i = 0; i < Math.min(lines.length, 6); ++i) {
    var a = /^\s*作者\s+([\w]+)/.exec(lines[i] || ''), t = /^\s*標題\s+(.*?)\s*$/.exec(lines[i] || '');
    if (a) head.author = a[1];
    if (t) head.title = t[1];
  }
  return head;
};
JJPtt.linesAre = function(lines, want) {
  var h = JJPtt.linesHead(lines);
  if (!h.author && !h.title) return true;  // no header to tell (rare): as it is
  return h.author.toLowerCase() === String(want.author).toLowerCase() && JJPtt.sameTitle(h.title, want.title);
};

// Same title, as far as both show it: Re: / Fw: and spacing aside, and a
// list cuts long titles at the screen edge.
JJPtt.sameTitle = function(a, b) {
  var n = function(t) { return String(t || '').replace(/^\s*(?:(?:Re|R|Fw|轉)\s*:\s*)+/i, '').replace(/\s+/g, ' ').replace(/…$/, '').trim(); };
  a = n(a);
  b = n(b);
  return a === b || (Math.min(a.length, b.length) >= 6 && (a.indexOf(b) === 0 || b.indexOf(a) === 0));
};

// The list row PTT's cursor is on (JJPtt.parseArticleRow), or null.
JJPtt.prototype.cursorRow = function() {
  var buf = this.app.buf;
  for (var r = 1; r < (buf.rows || 24) - 1; ++r) {
    var text = buf.getRowText(r, 0, buf.cols);
    if (/^[>●]/.test(text)) return JJPtt.parseArticleRow(text);
  }
  return null;
};

JJPtt.isWanted = function(row, want) {
  return !!row && (!want || (String(row.author).toLowerCase() === String(want.author).toLowerCase() &&
    JJPtt.sameTitle(row.title, want.title)));
};

// In a board's list, the cursor onto article `num`, which has to be `want`
// ({ author, title }) when given. The number seen in a filtered list
// (推文數, search results) is that list's own, not the board's: then it is
// found among the author's posts (a) instead.
// byAuthor: straight to the author's posts, the number not tried.
JJPtt.prototype.cursorTo = function(num, want, byAuthor) {
  var self = this;
  var jump = function(n) {
    // already there (the newest, just searched): nothing to wait for
    var here = self.cursorRow();
    if (here && here.num === n && JJPtt.isWanted(here, want)) return Promise.resolve();
    return self.sendSync(n + '\r', 2000);
  };
  return (byAuthor ? Promise.resolve() : jump(num)).then(function() {
    if (!byAuthor && JJPtt.isWanted(self.cursorRow(), want)) return;
    if (!want || !want.author) throw new Error('找不到第 ' + num + ' 篇');
    var prev = self.screen();
    self.send('a');
    return self.wait({ ask: /作者/ }, 5000, prev, '搜尋作者').then(function() {
      prev = self.screen();
      self.type(want.author + '\r');
      // the list is in a search now (on top of any before): toList / toBoard leave it
      self.listQuery = (self.listQuery ? self.listQuery + ' ' : '') + 'author:' + want.author;
      return self.searched(prev);
    }).then(function() {
      var pages = 0;
      var look = function() {
        var buf = self.app.buf, hit = 0;
        for (var r = 1; r < (buf.rows || 24) - 1; ++r) {
          var row = JJPtt.parseArticleRow(buf.getRowText(r, 0, buf.cols));
          if (row && row.num && JJPtt.isWanted(row, want)) hit = row.num;  // the newest one on screen
        }
        if (hit) return jump(hit);
        if (++pages > 5) throw new Error('在 ' + want.author + ' 的文章裡找不到「' + want.title + '」');
        var p2 = self.screen();
        self.send('\x1b[5~');  // Page Up: older posts
        return self.settle(p2, 1500).then(function(moved) {
          if (!moved) throw new Error('在 ' + want.author + ' 的文章裡找不到「' + want.title + '」');
          return look();
        });
      };
      return look();
    }).then(function() {
      if (!JJPtt.isWanted(self.cursorRow(), want)) throw new Error('找不到「' + want.title + '」');
    });
  });
};

// ---- a second, hidden connection (extension, www.ptt.cc down) --------------------------------
// The extension's one connection is the user's own screen. To read articles
// ahead while www.ptt.cc is down, a second one logs in with the saved
// account and reads in the background: JJPtt on an app-like object with its
// own screen buffer and connection, nothing drawn (PttReader.bgPtt).
JJPtt.headlessApp = function(main) {
  var h = { idleTime: 0, lastDataAt: 0, prefs: main.prefs };
  h.buf = new TermBuf(80, 24);
  h.conn = new main.conn.constructor(h);  // SSH or telnet, as the main one
  h.conn.keepAlive = main.conn.keepAlive;
  h.view = {
    charset: 'big5', conn: h.conn, EnterChar: '\r', blinkOn: false, useEasyReadingMode: false,
    bbscore: { navigateTo: { board: null } },
    update: function() {}, updateCursorPos: function() {}
  };
  h.buf.setView(h.view);
  h.parser = new lib.AnsiParser(h.buf);
  h.onData = function(d) {
    h.lastDataAt = Date.now();
    h.parser.feed(d);
  };
  h.onClose = function() { h.conn.isConnected = false; };
  h.appConn = new lib.AppConnection({
    onConnect: function() { h.conn.isConnected = true; },
    onDisconnect: function() { h.onClose(); },
    onReceive: function(s) { h.conn.onDataAvailable(s); }
  });
  h.connect = function(site) {
    var port = (main.connectedUrl && main.connectedUrl.port) || 23;
    h.appConn.connect(function() { h.conn.connect(site, port); });
  };
  return h;
};
