// JJptt reader: shows the article being read in the terminal as a modern,
// phone-app style page (flowing text, inline images, link cards, pushes with
// floors / country / hints). The content comes from the PTT web site
// (www.ptt.cc), which has the full article in a structured form; the
// terminal stays underneath for pushing, replying and navigation.
//
// Only the extension can do this: the website version cannot fetch
// www.ptt.cc (no CORS), and boards hidden from the web are not available.
function PttReader(app) {
  this.app = app;
  this.enabled = true;
  this.overlay = null;
  this.currentKey = '';
  this.dismissedKey = '';
  this.loadingKey = '';
  this.article = null;
  this.cookieReady = null;
  this.navDir = 0;  // last move between articles: -1 up the list, +1 down
  PttReader.warmUp();
}

// Open the connections the article view needs before the first article,
// so the first one does not wait for DNS / TLS.
PttReader.warmUp = function() {
  if (typeof document === 'undefined' || !document.head || PttReader.warmed) return;
  PttReader.warmed = true;
  ['https://www.ptt.cc', 'https://i.imgur.com', 'https://i.ytimg.com', 'https://pbs.twimg.com'].forEach(function(origin) {
    var l = document.createElement('link');
    l.rel = 'preconnect';
    l.href = origin;
    l.crossOrigin = 'anonymous';
    document.head.appendChild(l);
  });
};

PttReader.WEB = 'https://www.ptt.cc';
// back to the list, move up / down, open (what you would type in PTT)
PttReader.KEYS_PREV = '\x1b[D\x1b[A\x1b[C';
PttReader.KEYS_NEXT = '\x1b[D\x1b[B\x1b[C';

PttReader.prototype.available = function() {
  return lib.canReadPttWeb() && typeof DOMParser !== 'undefined';
};

PttReader.prototype.setEnabled = function(enabled) {
  this.enabled = !!enabled;
  if (!this.enabled) this.close();
};

// ---- terminal side -------------------------------------------------------

// Article header on the terminal's first page:
//   " 作者  BIA (必亞)                     看板  Gossiping"
//   " 標題  [問卦] ..."
//   " 時間  Sat Oct 24 21:51:19 2026"
PttReader.prototype.headerFromTerminal = function() {
  var buf = this.app.buf;
  if (buf.pageState != 3) return null;
  var r0 = buf.getRowText(0, 0, buf.cols);
  var r1 = buf.getRowText(1, 0, buf.cols);
  var r2 = buf.getRowText(2, 0, buf.cols);
  var m0 = /^\s*作者\s+(\w+)(?:.*?看板\s+(\w+))?/.exec(r0);
  var m1 = /^\s*標題\s+(.*?)\s*$/.exec(r1);
  var m2 = /^\s*時間\s+(.*?)\s*$/.exec(r2);
  if (!m0 || !m1) return null;
  // The board name can be pushed off the header row (long nicknames); fall
  // back to the board of the list we came from.
  var board = m0[2] || this.lastBoard;
  if (!board) return null;
  return { author: m0[1], board: board, title: m1[1], time: m2 ? m2[1] : '' };
};

// Called after every terminal redraw.
// Remembers the current board (list header "看板《Gossiping》") and the
// article's web URL when "※ 文章網址: ..." is on screen.
PttReader.prototype.trackTerminal = function() {
  var buf = this.app.buf;
  if (buf.pageState == 2) {
    var m = /看板《(\w+)》/.exec(buf.getRowText(0, 0, buf.cols));
    if (m) this.lastBoard = m[1];
    this.lastHeader = null;
    this.lastUrl = '';
    if (this.enabled && this.available()) this.schedulePrefetch();
  } else if (buf.pageState == 3) {
    var h = this.headerFromTerminal();
    if (h) {
      var key = h.board + '|' + h.author + '|' + h.title;
      if (!this.lastHeader || this.lastHeader.key !== key) this.lastUrl = '';
      h.key = key;
      this.lastHeader = h;
    }
    for (var r = 0; r < 23; ++r) {
      var u = /※ 文章網址: (https?:\/\/www\.ptt\.cc\/bbs\/\S+\.html)/.exec(buf.getRowText(r, 0, buf.cols));
      if (u) this.lastUrl = u[1].replace(/^http:/, 'https:');
    }
  }
};

// Right-click → 用閱讀模式開啟: open even if it failed or was closed before.
PttReader.prototype.openManually = function() {
  if (!this.available()) return;
  this.trackTerminal();
  var h = this.headerFromTerminal() || this.lastHeader;
  if (!h) {
    this.app.showToast(i18n('reader_needFirstPage'), 4000);
    return;
  }
  var key = h.board + '|' + h.author + '|' + h.title;
  this.dismissedKey = '';
  this.currentKey = '';
  this.openFor(h, key, true);
};

PttReader.prototype.onTerminalUpdate = function() {
  if (!this.available()) return;
  this.trackTerminal();
  if (!this.enabled) return;
  // paging through an article for terminalArticle: PTT redrawing each page
  // is not the user leaving it
  if (this.termReading) return;
  if (this.app.buf.pageState != 3) {
    // left the article: allow it to open again next time
    this.dismissedKey = '';
    if (this.loadingKey) {
      this.loadingKey = '';
      this.setLoading(false);
    }
    if (this.overlay && this.overlay.style.display !== 'none') this.close();
    return;
  }
  var h = this.headerFromTerminal();
  if (!h) return;
  var key = h.board + '|' + h.author + '|' + h.title;
  // Moved to the previous / next article but PTT opened the same one again:
  // it was the last (or first) in the list. Back to the list instead of
  // showing it a second time in the terminal.
  var nav = this.navFrom;
  if (nav) {
    this.navFrom = null;
    if (nav.key === key && Date.now() - nav.at < 5000) {
      if (this.listSnap && this.navDir) this.listSnap.index -= this.navDir;
      this.navDir = 0;
      if (this.app.conn && this.app.conn.send) this.app.conn.send('\x1b[D');
      return;
    }
  }
  // back on the article just pushed to: the terminal shows the new push,
  // www.ptt.cc a moment later -- stay in the terminal until the web page
  // has it, instead of covering it with the page from before
  var pf = this.pushFrom;
  if (pf && pf.key === key && Date.now() - pf.at < PttReader.PUSH_WAIT_MS) {
    this.waitForPush(h, key);
    return;
  }
  this.pushFrom = null;
  if (key === this.currentKey || key === this.dismissedKey || key === this.loadingKey) return;
  this.openFor(h, key);
};

PttReader.PUSH_WAIT_MS = 30000;
PttReader.PUSH_POLL_MS = 2000;

// Fetches the article (past caches) until it has more pushes than before,
// then shows it if the terminal is still on it.
PttReader.prototype.waitForPush = function(h, key) {
  var self = this, pf = this.pushFrom;
  if (pf.waiting) return;
  pf.waiting = true;
  var stillHere = function() {
    if (self.pushFrom !== pf) return false;
    self.trackTerminal();
    var cur = self.lastHeader;
    return self.app.buf.pageState == 3 && cur && cur.key === key;
  };
  var url = pf.url || ((this.lastHeader && this.lastHeader.key === key) ? this.lastUrl : '');
  var last = null;
  var done = function(article) {
    if (!stillHere()) return;
    self.pushFrom = null;
    if (!article) {
      self.dismissedKey = key;  // stays in the terminal
      return;
    }
    self.currentKey = key;
    self.article = article;
    self.render(article, h);
    self.show();
    self.restorePosition();
  };
  if (!url) return done(null);
  var round = function() {
    if (!stillHere()) {
      if (self.pushFrom === pf) pf.waiting = false;
      return;
    }
    if (Date.now() - pf.at > PttReader.PUSH_WAIT_MS) return done(last);
    self.fetchArticle(url + (url.indexOf('?') < 0 ? '?' : '&') + '_=' + Date.now()).then(function(article) {
      last = article;
      if (article.pushes.length > pf.count) return done(article);
      setTimeout(round, PttReader.PUSH_POLL_MS);
    }, function(err) {
      // www.ptt.cc down: the terminal already has the push
      if (self.canReadTerminal(err)) {
        return self.terminalArticle(url, key, h).then(function() { self.pushFrom = null; }, function() { done(null); });
      }
      setTimeout(round, PttReader.PUSH_POLL_MS);
    });
  };
  round();
};

// ---- fetching ------------------------------------------------------------

// Boards such as Gossiping ask "are you over 18?". Answer it by sending the
// over18 cookie: a session rule adds it to our requests to www.ptt.cc (this
// works even when third-party cookies are blocked), and the cookie itself is
// set as a fallback.
// Picture hosts that need a referrer (also in extension/manifest.json's
// host_permissions, which the referrer rule needs).
PttReader.REFERER_HOSTS = ['i.verb.tw'];

PttReader.prototype.ensureOver18 = function() {
  if (this.cookieReady) return this.cookieReady;
  if (!lib.isExtension()) {  // the app sends the cookie with each request
    this.cookieReady = Promise.resolve();
    return this.cookieReady;
  }
  var addRule = new Promise(function(resolve) {
    var dnr = chrome.declarativeNetRequest;
    if (!(dnr && dnr.updateSessionRules)) {
      resolve();
      return;
    }
    dnr.updateSessionRules({
      removeRuleIds: [1801, 1802],
      addRules: [{
        id: 1801,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'cookie', operation: 'set', value: 'over18=1' }]
        },
        condition: { urlFilter: '||www.ptt.cc/', resourceTypes: ['xmlhttprequest'] }
      }, {
        // image hosts that refuse a picture asked for without a referrer
        // (403), which is all the extension's page can send: as if from
        // www.ptt.cc, where the link was posted
        id: 1802,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'referer', operation: 'set', value: PttReader.WEB + '/' }]
        },
        condition: { requestDomains: PttReader.REFERER_HOSTS, resourceTypes: ['image', 'media', 'xmlhttprequest'] }
      }]
    }, function() {
      if (chrome.runtime.lastError) console.log('over18 rule:', chrome.runtime.lastError.message);
      resolve();
    });
  });
  var setCookie = new Promise(function(resolve) {
    if (!(chrome.cookies && chrome.cookies.set)) {
      resolve();
      return;
    }
    chrome.cookies.set({
      url: PttReader.WEB + '/',
      name: 'over18',
      value: '1',
      secure: true,
      sameSite: 'no_restriction',
      expirationDate: Math.floor(Date.now() / 1000) + 365 * 86400
    }, function() { resolve(); });
  });
  this.cookieReady = Promise.all([addRule, setCookie]);
  return this.cookieReady;
};

PttReader.prototype.fetchDoc = function(url, opts) {
  var self = this;
  if (typeof JJPtt !== 'undefined' && JJPtt.isTermUrl(url)) return this.termDoc(url, null, opts);
  var web = function() {
    return self.webDocTimed(url).catch(function(err) {
      // www.ptt.cc down (HTTP 5xx, no answer): the app reads it on the BBS
      if (PttReader.webDown(err)) PttReader.webDownAt = Date.now();
      if (!PttReader.webDown(err) || !self.termSource()) throw err;
      return self.termDoc(url, err, opts);
    });
  };
  // down a moment ago: straight to the BBS (no waiting for the web site to
  // fail again on every page), with a look at the web site now and then
  // so it is used again once it is back; what the BBS can't do still
  // goes to the web site
  var ptt = this.termSource();
  if (PttReader.webRecentlyDown() && ptt && ptt.user) {
    this.probeWeb(url);
    return this.termDoc(url, { webStatus: PttReader.webDownStatus }, opts).catch(function(err) {
      if (!err || !err.termCant) throw err;
      return web();
    });
  }
  return web();
};

// www.ptt.cc not answering at all counts as down after this long.
PttReader.WEB_TIMEOUT_MS = 10000;
PttReader.prototype.webDocTimed = function(url) {
  var self = this;
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      var e = new Error('PTT 網頁版沒有回應');
      e.webTimeout = true;
      reject(e);
    }, PttReader.WEB_TIMEOUT_MS);
    self.webDoc(url).then(function(d) { clearTimeout(timer); resolve(d); },
                          function(e) { clearTimeout(timer); reject(e); });
  });
};

// While the BBS stands in, one look at the web site a minute: answering
// again ends PttReader.webRecentlyDown.
PttReader.PROBE_MS = 60 * 1000;
PttReader.probeAt = 0;
PttReader.prototype.probeWeb = function(url) {
  if (Date.now() - PttReader.probeAt < PttReader.PROBE_MS) return;
  PttReader.probeAt = Date.now();
  this.webDocTimed(url).then(function() {
    PttReader.webDownAt = 0;
  }, function(err) {
    if (PttReader.webDown(err)) PttReader.webDownAt = Date.now();
  });
};

// The web site is failing, not the page missing or the over18 question.
PttReader.webDown = function(err) {
  var down = !!err && (err.webStatus >= 500 || err instanceof TypeError || !!err.webTimeout);
  if (down && err.webStatus) PttReader.webDownStatus = err.webStatus;
  return down;
};
PttReader.webDownStatus = 0;

// www.ptt.cc failed in the last few minutes.
PttReader.webDownAt = 0;
PttReader.webRecentlyDown = function() {
  return Date.now() - PttReader.webDownAt < 5 * 60 * 1000;
};

// The app's background PTT connection (JJPtt), when there is one.
PttReader.prototype.termSource = function() {
  var m = this.app.mobile;
  return lib.isApp() && m && m.ptt && typeof JJPtt !== 'undefined' ? m.ptt : null;
};

// A board index or an article read on the BBS instead of www.ptt.cc
// (see JJPtt.boardPage / termArticle); doc.jjFromTerm marks it, doc.jjUrl is
// the article's own www.ptt.cc address. opts.onPartial(article so far,
// page, pages) while an article is read page by page; opts.bg: reading
// ahead (gives way to what the user opens, see JJPtt.termArticle).
PttReader.prototype.termDoc = function(url, webErr, opts) {
  var self = this;
  opts = opts || {};
  var ptt = this.termSource();
  var down = 'PTT 網頁版現在故障' + (webErr && webErr.webStatus ? '（HTTP ' + webErr.webStatus + '）' : '');
  // what the BBS can't open (err.termCant): the web site may still
  var cant = function(msg) { var e = new Error(msg); e.termCant = true; return Promise.reject(e); };
  if (!ptt) return cant(down);
  var plain = PttReader.articleUrl(url);
  var m, job, sq = PttReader.termSearch(url);
  if (sq) {
    if (sq.page > 1) return cant(down + '，搜尋結果請重新搜尋一次');
    job = function() { return ptt.boardPage(sq.board, sq.before, sq.query); };
  } else if ((m = /^jjterm:list\/([^\/]+)\/(\d+)$/.exec(plain)) ||
      (m = /^https?:\/\/www\.ptt\.cc\/bbs\/([\w\-]+)\/index\.html$/.exec(plain))) {
    job = function() { return ptt.boardPage(decodeURIComponent(m[1]), m[2] ? +m[2] : 0); };
  } else if (/^jjterm:art\/[^\/]+\/\d+(?:\/[^\/]+)?$/.test(plain) || /^https?:\/\/www\.ptt\.cc\/bbs\/[\w\-]+\/M\.\d+\.A\.\w+\.html$/.test(plain)) {
    var onPage = opts.onPartial && function(i, n, lines, real) {
      try {
        var d = PttReader.htmlDoc(JJPtt.articleHtml(lines), real);
        opts.onPartial(self.articleFromDoc(d, real || url, true), i, n);
      } catch (e) { console.log('JJptt BBS 部分內容', e); }
    };
    job = function() { return ptt.termArticle(plain, null, { bg: opts.bg, onPage: onPage }); };
  } else {
    return cant(down + '，這裡暫時不能用（看板文章可以改用 BBS 連線看）');
  }
  if (!ptt.user) return cant(down + '。登入 PTT 帳號後，就能改用 BBS 連線看看板和文章');
  return job().then(function(r) {
    return PttReader.htmlDoc(typeof r === 'string' ? r : r.html, r && r.url);
  });
};

// A board search to do on the BBS: www.ptt.cc's /bbs/<board>/search?q=
// (&page=), or jjterm:search/<board>/<before>/<query> (its older pages).
// -> { board, query, before, page } or null.
PttReader.termSearch = function(url) {
  url = String(url || '');
  var m = /^jjterm:search\/([^\/]+)\/(\d+)\/([^\/?#]+)$/.exec(url);
  if (m) return { board: decodeURIComponent(m[1]), before: +m[2], query: decodeURIComponent(m[3]), page: 1 };
  m = /^https?:\/\/www\.ptt\.cc\/bbs\/([\w\-]+)\/search\?([^#]*)$/.exec(url);
  if (!m) return null;
  var args = {};
  m[2].split('&').forEach(function(kv) {
    var i = kv.indexOf('=');
    if (i > 0) {
      try { args[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) {}
    }
  });
  if (!args.q) return null;
  return { board: m[1], query: args.q, before: 0, page: +args.page || 1 };
};

// A page made from the BBS screen, as a document (jjFromTerm; jjUrl: the
// article's www.ptt.cc address, when known).
PttReader.htmlDoc = function(html, url) {
  var doc = new DOMParser().parseFromString(html, 'text/html');
  doc.jjFromTerm = true;
  if (url && !JJPtt.isTermUrl(url)) doc.jjUrl = url;
  return doc;
};

PttReader.prototype.webDoc = function(url) {
  return this.ensureOver18().then(function() {
    // the app's fetch goes through Android (CapacitorHttp): no browser
    // limits on reading www.ptt.cc, but cookies have to be sent by hand
    if (lib.isApp()) return fetch(url, { headers: { 'Cookie': 'over18=1' } });
    return fetch(url, { credentials: 'include' });
  }).then(function(res) {
    if (/\/ask\/over18/.test(res.url)) throw new Error(i18n('reader_err_over18'));
    if (res.status === 404) throw new Error(i18n('reader_err_notOnWeb'));
    if (!res.ok) {
      var err = new Error('HTTP ' + res.status);
      err.webStatus = res.status;
      throw err;
    }
    return res.text();
  }).then(function(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    if (doc.querySelector('form[action*="/ask/over18"]')) throw new Error(i18n('reader_err_over18'));
    return doc;
  });
};

PttReader.normalizeTitle = function(t) {
  return String(t || '').replace(/\s+/g, ' ').trim();
};

// Finds the article by searching the board for the author's posts. The
// terminal cuts long titles at the screen edge, so titles are compared by
// prefix and the post time (from the article page) decides between matches.
PttReader.prototype.findArticle = function(h) {
  var self = this;
  var want = PttReader.normalizeTitle(h.title);
  var candidates = [];
  var search = function(page) {
    var url = PttReader.WEB + '/bbs/' + encodeURIComponent(h.board) +
      '/search?q=' + encodeURIComponent('author:' + h.author) + (page > 1 ? '&page=' + page : '');
    return self.fetchDoc(url).then(function(doc) {
      var ents = doc.querySelectorAll('.r-ent');
      for (var i = 0; i < ents.length; ++i) {
        var a = ents[i].querySelector('.title a');
        if (!a) continue;
        var t = PttReader.normalizeTitle(a.textContent);
        if (t === want || (want.length >= 6 && (t.indexOf(want) === 0 || want.indexOf(t) === 0))) {
          candidates.push(PttReader.WEB + a.getAttribute('href'));
        }
      }
      if (!candidates.length && page < 3 && ents.length) return search(page + 1);
      return candidates;
    });
  };
  var tryNext = function(list) {
    if (!list.length) throw new Error(i18n('reader_err_notFound'));
    return self.fetchArticle(list[0]).then(function(article) {
      var t = PttReader.normalizeTitle(article.meta['時間']);
      if (h.time && t && t !== PttReader.normalizeTitle(h.time) && list.length > 1) {
        return tryNext(list.slice(1));
      }
      return article;
    });
  };
  var ts = Date.now();
  return search(1).then(function(list) {
    console.log('JJptt 搜尋文章網址 ' + (Date.now() - ts) + 'ms');
    return tryNext(list);
  });
};

// ---- prefetch from the article list ------------------------------------------
// While the cursor rests on an article in the list, fetch it in the
// background so that it is ready when Enter is pressed.

PttReader.prefetchKey = function(board, author, title) {
  var t = PttReader.normalizeTitle(title).replace(/^(?:Re|R|Fw|轉)\s*:\s*/i, '');
  return (board + '|' + author + '|' + t).toLowerCase();
};

// Remembers the articles visible in the list (also in filtered views such
// as "推文數 ≥ 10") and where the cursor is, to know the neighbours of the
// article being read.
PttReader.prototype.snapshotList = function() {
  var buf = this.app.buf;
  var rows = [], cursor = -1;
  for (var r = 3; r < 23; ++r) {
    var text = buf.getRowText(r, 0, buf.cols);
    var author = text.parseThreadForUserId();
    var title = text.parseThreadTitle();
    if (!author || !title) continue;
    if (/^[>●]/.test(text)) cursor = rows.length;
    var row = typeof JJPtt !== 'undefined' && JJPtt.parseArticleRow(text);
    rows.push({ author: author, title: title, num: (row && row.num) || 0 });
  }
  if (cursor >= 0 && this.lastBoard) this.listSnap = { board: this.lastBoard, rows: rows, index: cursor };
};

// Starts fetching an article in the background (no-op if already cached).
PttReader.prototype.startPrefetch = function(board, author, title) {
  var self = this;
  var key = PttReader.prefetchKey(board, author, title);
  this.prefetch = this.prefetch || {};
  var have = this.prefetch[key];
  if (have && Date.now() - have.at < PttReader.PREFETCH_TTL) return;
  var h = { board: board, author: author, title: title.replace(/^(?:R|Re|Fw|轉)\s*:\s*/i, 'Re: '), time: '' };
  var p = this.findArticle(h);
  p.catch(function() { delete self.prefetch[key]; });
  p.then(function(article) { self.preloadMedia(article); }, function() {});
  this.prefetch[key] = { promise: p, at: Date.now(), board: board.toLowerCase(), author: author.toLowerCase(),
                         title: PttReader.prefetchKey('', '', title).slice(2) };
  var keys = Object.keys(this.prefetch);
  if (keys.length > 40) delete this.prefetch[keys[0]];
};

PttReader.PREFETCH_TTL = 600000;  // 10 minutes

// ---- reading ahead on a hidden connection (extension, www.ptt.cc down) ----------------

// The hidden connection (JJPtt.headlessApp), logged in with the account
// saved in the settings; null without a saved password, or in the app (it
// has its own) or the web version.
PttReader.prototype.bgPtt = function() {
  if (lib.isApp() || !lib.isExtension || !lib.isExtension() || typeof JJPtt === 'undefined' || !this.app.conn) return null;
  var l = this.app.pref && this.app.pref.logins;
  var user = l && (Array.isArray(l) ? l[0] : l.u), pass = l && (Array.isArray(l) ? l[1] : l.p);
  if (!user || !pass) {
    if (!this.bgNoLogin) console.log('JJptt 背景預讀：設定裡沒有存 PTT 帳號密碼，不預讀');
    this.bgNoLogin = true;
    return null;
  }
  if (!this.bg) this.bg = new JJPtt(JJPtt.headlessApp(this.app));
  this.bg.user = user;
  this.bg.pass = pass;
  return this.bg;
};

// The order to read ahead from row `index` of the list: the article itself,
// then its neighbours (the way being read first when dir is set), as many
// on each side as 預先讀取上下幾篇.
PttReader.prototype.bgOrder = function(snap, index, dir) {
  var n = this.prefetchCount(), out = [index];
  for (var d = 1; d <= n; ++d) {
    if (dir) out.push(index + dir * d, index - dir * d);
    else out.push(index + d, index - d);
  }
  return out.filter(function(i) { return snap.rows[i] && snap.rows[i].num; });
};

// www.ptt.cc down: plans reading ahead around row `index` on the hidden
// connection, replacing what was planned before (the one being read goes
// on). False when it can't (web up, no saved password...): then as usual.
PttReader.prototype.bgPlan = function(snap, index, dir) {
  if (!snap || !PttReader.webRecentlyDown() || !this.prefetchCount()) return false;
  var bg = this.bgPtt();
  if (!bg) return false;
  var self = this;
  this.prefetch = this.prefetch || {};
  // what was waiting for an earlier plan is dropped
  (this.bgQueue || []).forEach(function(job) {
    if (self.prefetch[job.key] === job.entry) delete self.prefetch[job.key];
  });
  this.bgQueue = [];
  this.bgOrder(snap, index, dir).forEach(function(i) {
    var row = snap.rows[i];
    var key = PttReader.prefetchKey(snap.board, row.author, row.title);
    var have = self.prefetch[key];
    if (have && Date.now() - have.at < PttReader.PREFETCH_TTL) return;
    var job = { key: key, board: snap.board, num: row.num, want: { author: row.author, title: row.title } };
    var entry = job.entry = { at: Date.now(), board: snap.board.toLowerCase(), author: row.author.toLowerCase(),
                              title: PttReader.prefetchKey('', '', row.title).slice(2), bg: true, done: false, num: row.num };
    entry.promise = new Promise(function(resolve, reject) { job.resolve = resolve; job.reject = reject; });
    entry.promise.catch(function() {});
    self.prefetch[key] = entry;
    self.bgQueue.push(job);
  });
  if (this.bgQueue.length) console.log('JJptt 背景預讀：' + snap.board + ' 排了 ' + this.bgQueue.length + ' 篇');
  this.bgNext();
  return true;
};

// An article read ahead that the terminal is showing while reading mode
// gave up on it (it was asked for before it was ready): show it now.
PttReader.prototype.bgArrived = function(job) {
  var cur = this.lastHeader;
  if (!cur || !this.enabled || this.isOpen() || this.loadingKey || !this.app.buf || this.app.buf.pageState != 3) return;
  if (String(cur.board).toLowerCase() !== job.entry.board || String(cur.author).toLowerCase() !== job.entry.author ||
      !JJPtt.sameTitle(cur.title, job.want.title)) return;
  this.dismissedKey = '';
  this.openFor(cur, cur.key);
};

// Reads the next planned article on the hidden connection, one at a time.
PttReader.prototype.bgNext = function() {
  if (this.bgBusy || !this.bgQueue || !this.bgQueue.length) return;
  var self = this;
  var job = this.bgQueue.shift();
  var bg = this.bgPtt();
  if (!bg) return;
  this.bgBusy = true;
  var t0 = Date.now();
  bg.termArticle(JJPtt.TERM + 'art/' + encodeURIComponent(job.board) + '/' + job.num, job.want).then(function(r) {
    var doc = new DOMParser().parseFromString(r.html, 'text/html');
    doc.jjFromTerm = true;
    var article = self.articleFromDoc(doc, r.url);
    job.entry.done = true;
    job.resolve(article);
    self.bgArrived(job);
    console.log('JJptt 背景預讀好了：' + job.board + ' 第 ' + job.num + ' 篇「' + (article.meta['標題'] || '') + '」' + (Date.now() - t0) + 'ms');
    self.preloadMedia(article);
  }, function(err) {
    console.log('JJptt 背景預讀失敗', job.board, job.num, err && err.message);
    if (self.prefetch[job.key] === job.entry) delete self.prefetch[job.key];
    job.reject(err);
  }).then(function() {
    self.bgBusy = false;
    self.bgNext();
  });
};

// Setting: how long the list cursor must rest on an article before it is
// loaded (ms).
PttReader.prototype.listPrefetchDelay = function() {
  var pv = this.app.pref && this.app.pref.values;
  var n = parseInt(pv ? pv.readerListPrefetchDelay : 150, 10);
  return isNaN(n) ? 150 : Math.max(0, Math.min(3000, n));
};

// Setting: how many articles above / below to load ahead (0 = off).
PttReader.prototype.prefetchCount = function() {
  var pref = this.app.pref;
  var n = parseInt(pref && pref.values ? pref.values.readerPrefetchCount : 1, 10);
  if (isNaN(n)) n = 1;
  return Math.max(0, Math.min(20, n));
};

// In the list: fetch the article under the cursor once it rests there.
PttReader.prototype.schedulePrefetch = function() {
  var self = this;
  if (!this.prefetchCount()) return;
  if (this.app.buf.pageState != 2 || !this.lastBoard) return;
  this.snapshotList();
  var snap = this.listSnap;
  if (!snap || snap.board !== this.lastBoard) return;
  var cur = snap.rows[snap.index];
  var key = PttReader.prefetchKey(snap.board, cur.author, cur.title);
  if (key === this.prefetchPending) return;
  this.prefetchPending = key;
  clearTimeout(this.prefetchTimer);
  this.prefetchTimer = setTimeout(function() {
    // www.ptt.cc down: the article and its neighbours on the hidden connection
    if (self.bgPlan(snap, snap.index, 0)) return;
    self.startPrefetch(snap.board, cur.author, cur.title);
  }, this.listPrefetchDelay());
};

// While reading: fetch the previous and next article of the list.
PttReader.prototype.prefetchNeighbours = function(h) {
  var snap = this.listSnap;
  if (!snap || String(snap.board).toLowerCase() !== String(h.board).toLowerCase()) return;
  var cur = snap.rows[snap.index];
  if (!cur || cur.author.toLowerCase() !== String(h.author).toLowerCase()) return;
  var self = this;
  var n = this.prefetchCount();
  var idx = [];
  var dir = this.navDir;
  if (this.bgPlan(snap, snap.index, dir)) return;
  var pv = this.app.pref && this.app.pref.values;
  if (n && dir && !(pv && pv.readerPrefetchAhead === false)) {
    // reading in one direction: twice as many ahead, fewer behind
    var ahead = Math.min(n * 2, 10), behind = Math.max(1, Math.ceil(n / 2));
    for (var a = 1; a <= ahead; ++a) {
      idx.push(snap.index + dir * a);
      if (a <= behind) idx.push(snap.index - dir * a);
    }
  } else {
    for (var d = 1; d <= n; ++d) idx.push(snap.index - d, snap.index + d);
  }
  idx.forEach(function(i) {
    var row = snap.rows[i];
    if (row) self.startPrefetch(snap.board, row.author, row.title);
  });
};

// Prefetched article for this header, if fresh (pushes keep coming in).
PttReader.prototype.takePrefetch = function(h) {
  if (!this.prefetch) return null;
  // list and header both cut long titles, so compare by prefix
  var want = PttReader.prefetchKey('', '', h.title).slice(2);
  var key = null, hit = null;
  for (var k in this.prefetch) {
    var c = this.prefetch[k];
    if (c.board !== String(h.board).toLowerCase() || c.author !== String(h.author).toLowerCase()) continue;
    if (c.title === want || (Math.min(c.title.length, want.length) >= 6 &&
        (c.title.indexOf(want) === 0 || want.indexOf(c.title) === 0))) {
      key = k;
      hit = c;
      break;
    }
  }
  if (!hit || Date.now() - hit.at > PttReader.PREFETCH_TTL) return null;
  // still waiting on the hidden connection: reading it on the screen is sooner
  if (hit.bg && !hit.done) return null;
  delete this.prefetch[key];
  var p = hit.promise.then(function(article) {
    var t = PttReader.normalizeTitle(article.meta['時間']);
    if (h.time && t && t !== PttReader.normalizeTitle(h.time)) {
      console.log('JJptt 預讀的不是這篇：要 ' + h.board + ' ' + h.author + '「' + h.title + '」' + h.time +
        '，拿到 ' + (article.meta['作者'] || '') + '「' + (article.meta['標題'] || '') + '」' + t + ' ' + (article.url || '') +
        (hit.bg ? '（背景連線第 ' + hit.num + ' 篇）' : ''));
      throw new Error('prefetch mismatch');
    }
    return article;
  });
  p.catch(function() {});  // not waited for when the article's address is known
  return p;
};

PttReader.articleUrl = function(url) {
  return String(url || '').replace(/[?#].*$/, '');
};

// opts: see termDoc (only used when the article is read on the BBS).
PttReader.prototype.fetchArticle = function(url, opts) {
  var self = this;
  return this.fetchDoc(url, opts).then(function(doc) {
    return self.articleFromDoc(doc, url);
  });
};

// An article page (www.ptt.cc's, or one made from the BBS screen) -> the
// article: meta, body, pushes; spam guard and fact check run on it.
PttReader.prototype.articleFromDoc = function(doc, url, partial) {
  var self = this;
  var main = doc.getElementById('main-content');
  if (!main) throw new Error('no article content');
  var meta = {};
  var metas = main.querySelectorAll('.article-metaline, .article-metaline-right');
  for (var i = 0; i < metas.length; ++i) {
    var tag = metas[i].querySelector('.article-meta-tag');
    var val = metas[i].querySelector('.article-meta-value');
    if (tag && val) meta[tag.textContent.trim()] = val.textContent.trim();
  }
  var pushes = [];
  var pushNodes = main.querySelectorAll('.push');
  for (var j = 0; j < pushNodes.length; ++j) {
    var n = pushNodes[j];
    var tagEl = n.querySelector('.push-tag');
    var idEl = n.querySelector('.push-userid');
    if (!tagEl || !idEl) continue;  // e.g. "檔案過大！部分文章無法顯示"
    n.setAttribute('data-push-index', pushes.length);
    var contentEl = n.querySelector('.push-content');
    var ipdt = (n.querySelector('.push-ipdatetime') || {}).textContent || '';
    var content = (contentEl ? contentEl.textContent : '').replace(/^:\s?/, '');
    // Some pushes (e.g. with characters outside Big5) come with the IP and
    // time inside the content instead of their own element: move them back.
    if (!ipdt.trim()) {
      var tail = /\s+((?:\d{1,3}\.){3}\d{1,3}\s+)?(\d{1,2}\/\d{1,2}(?:\s+\d{1,2}:\d{2})?)\s*$/.exec(content);
      if (tail) {
        ipdt = (tail[1] || '') + tail[2];
        content = content.slice(0, tail.index);
      }
    }
    var ipm = /((?:\d{1,3}\.){3}\d{1,3})/.exec(ipdt);
    pushes.push({
      tag: tagEl.textContent.trim(),
      id: idEl.textContent.trim(),
      content: content,
      ip: ipm ? ipm[1] : '',
      time: ipdt.replace(ipm ? ipm[1] : '', '').trim()
    });
  }
  var body = main.cloneNode(true);
  // pushes stay in place (marked with data-push-index) so that "※ 編輯"
  // lines between them keep their position and line numbers stay right
  var drop = body.querySelectorAll('.article-metaline, .article-metaline-right, .richcontent, .push:not([data-push-index])');
  for (var k = 0; k < drop.length; ++k) drop[k].parentNode.removeChild(drop[k]);
  PttReader.assignBlocks(body, pushes);
  // the article's own address: a query added to get past caches (the
  // app reloads with ?_=time after a push) is not another article -- it
  // was counted as one by 共伴 and 同網址洗版 and blacklisted people
  var article = { url: PttReader.articleUrl(doc.jjUrl || url), fromTerm: !!doc.jjFromTerm, partial: !!partial, meta: meta, text: body.textContent, body: body, pushes: pushes };
  if (self.app.spamGuard && !partial) {  // a part still being read is not counted
    try { self.app.spamGuard.record(article); } catch (e) { console.log('spam guard', e); }
  }
  if (self.app.factCheck && !partial) {
    try { self.app.factCheck.analyze(article); } catch (e) { console.log('fact check', e); }
  }
  return article;
};

// Extension, www.ptt.cc down: the article open in the terminal is read
// page by page there (Page Down) behind the reading-mode page, which shows
// the first page at once and grows as the rest comes in; then Home takes the
// terminal back to the top. Not the app: it reads on its own connection
// (termDoc).
PttReader.prototype.canReadTerminal = function(err) {
  return PttReader.webDown(err) && !lib.isApp() && typeof JJPtt !== 'undefined' &&
    !!(this.app.conn && this.app.buf && this.app.buf.pageState == 3);
};
PttReader.TERM_RENDER_MS = 1500;  // re-draw the growing article at most this often
PttReader.prototype.terminalArticle = function(url, key, h) {
  var self = this;
  var t = new JJPtt(this.app);
  PttReader.webDownAt = Date.now();
  var shown = false, lastDraw = 0;
  // moved to another article or back to the terminal: stop paging
  var gone = function() { return self.loadingKey !== key && self.currentKey !== key; };
  var build = function(lines, done) {
    var doc = new DOMParser().parseFromString(JJPtt.articleHtml(lines), 'text/html');
    doc.jjFromTerm = true;
    // 文章網址 goes by while paging (trackTerminal)
    return self.articleFromDoc(doc, url || self.lastUrl || '', !done);
  };
  var draw = function(article) {
    if (!shown) {
      shown = true;
      self.setLoading(false);
      self.loadingKey = '';
      self.currentKey = key;
      self.article = article;
      self.render(article, h);
      self.show();
      self.overlay.querySelector('.jjt-scroll').scrollTop = 0;
    } else {
      self.article = article;
      self.rerender();
    }
    lastDraw = Date.now();
  };
  var onPage = function(n, total, lines) {
    if (gone()) return false;
    self.setLoading(true, i18n('reader_termPage').replace('%1', n).replace('%2', total));
    if (!shown || Date.now() - lastDraw > PttReader.TERM_RENDER_MS) draw(build(lines.slice(), false));
  };
  self.termReading = true;
  var done = function() { self.termReading = false; };
  return t.readPages(onPage).then(function(lines) {
    if (lines.stopped || gone()) {
      done();
      if (self.loadingKey === key) self.loadingKey = '';
      if (!shown || self.currentKey !== key) self.setLoading(false);
      return;
    }
    self.setLoading(false);
    draw(build(lines, true));
    var prev = t.screen();
    t.send('\x1b[1~');  // back to the first page, where the header is
    return t.settle(prev, 1500).then(done);
  }, function(err) {
    done();
    self.setLoading(false);
    throw err;
  });
};

// ---- rendering -----------------------------------------------------------

PttReader.prototype.ensureOverlay = function() {
  if (this.overlay) return this.overlay;
  var self = this;
  var o = document.createElement('div');
  o.id = 'jjReader';
  o.className = 'jjr-root jjt-root';
  o.tabIndex = -1;
  o.innerHTML = '<div class="jjt-scroll"><div class="jjt-page"></div></div><div class="jjt-status"></div>';
  document.body.appendChild(o);
  // Keys are taken at the document level while the view is open, so they
  // keep working wherever focus went (clicked image, link, ...).
  document.addEventListener('keydown', function(e) {
    if (!self.isOpen()) {
      // ↓ is pressed again and again (or held) to read to the end: the
      // presses after the one that moved to the next article must not reach
      // PTT before it answers, or it moves once more -- on the last article
      // that opened the same one a second time
      if (self.swallowsNavKey(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if ($('#prefModal').is(':visible')) return;
    // Ctrl/Cmd+C with text selected: copy it here so the terminal's own
    // key handling never gets the key.
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.keyCode === 67 || e.key === 'c')) {
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        e.preventDefault();
        e.stopPropagation();
        self.copyText(sel.toString().replace(/\u00a0/g, ' '));
        return;
      }
    }
    self.onKeyDown(e);
  }, true);
  o.addEventListener('click', function(e) {
    self.hideMenu();
    // clicking an image opens the original, like links in the terminal
    var img = e.target.closest && e.target.closest('.jjr-img');
    if (img && img.tagName === 'IMG') window.open(img.getAttribute('data-full') || img.src, '_blank', 'noreferrer');
    if (!(e.target.closest && e.target.closest('a'))) o.focus();
  });
  o.addEventListener('contextmenu', function(e) { self.onContextMenu(e); });
  // hovering an image / YouTube link shows a large preview next to the mouse
  o.addEventListener('mouseover', function(e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var pv = self.app.pref && self.app.pref.values;
    if (pv && pv.readerHoverPreview === false) return;  // option off
    var src = PttReader.previewFor(a.getAttribute('href'));
    if (src) self.showHoverPreview(src, e);
  });
  o.addEventListener('mousemove', function(e) {
    if (self.hoverPreview && self.hoverPreview.style.display === 'block') self.placeHoverPreview(e);
  });
  o.addEventListener('mouseout', function(e) {
    var a = e.target.closest && e.target.closest('a[href]');
    if (a && !(e.relatedTarget && a.contains(e.relatedTarget))) self.hideHoverPreview();
  });
  o.querySelector('.jjt-scroll').addEventListener('scroll', function() { self.hideHoverPreview(); });
  window.addEventListener('resize', function() {
    if (!self.isOpen()) return;
    // wait for the terminal to re-layout first
    setTimeout(function() { self.layout(); }, 0);
  });
  o.querySelector('.jjt-scroll').addEventListener('scroll', function() { self.updateStatus(); });
  // images change the page height as they load
  o.addEventListener('load', function() { self.updateStatus(); }, true);
  this.overlay = o;
  return o;
};

// Large picture for a link: the original image, or a YouTube thumbnail.
PttReader.previewFor = function(url) {
  if (!url || !/^https?:/.test(url)) return '';
  var img = PttReader.imageSrc(url);
  if (img) return img;
  var yt = url.parseYoutubeUrl ? url.parseYoutubeUrl() : null;
  if (yt) return 'https://i.ytimg.com/vi/' + yt.split(/[?&]/)[0] + '/hqdefault.jpg';
  return '';
};

PttReader.prototype.showHoverPreview = function(src, e) {
  var p = this.hoverPreview;
  if (!p) {
    p = this.hoverPreview = PttReader.el('img');
    p.id = 'jjHoverPreview';
    p.referrerPolicy = 'no-referrer';
    var self = this;
    p.addEventListener('load', function() {
      if (self.lastMouse) self.placeHoverPreview(self.lastMouse);
    });
    var retry = PttReader.imageRetry(p);
    p.addEventListener('error', function() { if (p.referrerPolicy === 'no-referrer') retry(); });
    this.overlay.appendChild(p);
  }
  if (p.getAttribute('src') !== src) {
    p.referrerPolicy = 'no-referrer';
    p.setAttribute('src', src);
  }
  p.style.display = 'block';
  this.placeHoverPreview(e);
};

PttReader.prototype.placeHoverPreview = function(e) {
  var p = this.hoverPreview;
  this.lastMouse = { clientX: e.clientX, clientY: e.clientY };
  var w = p.offsetWidth || 0, h = p.offsetHeight || 0, gap = 18;
  var x = e.clientX + gap;
  if (x + w > window.innerWidth - 4) x = Math.max(4, e.clientX - gap - w);
  var y = Math.min(Math.max(4, e.clientY - h / 2), window.innerHeight - h - 4);
  p.style.left = x + 'px';
  p.style.top = Math.max(4, y) + 'px';
};

PttReader.prototype.hideHoverPreview = function() {
  if (this.hoverPreview) this.hoverPreview.style.display = 'none';
};

PttReader.prototype.isOpen = function() {
  return !!(this.overlay && this.overlay.style.display !== 'none' && this.overlay.style.display !== '');
};

PttReader.prototype.hideMenu = function() {
  if (this.menu) this.menu.style.display = 'none';
};

// Right-click: blacklist / watchlist the pusher, or go back / settings.
PttReader.prototype.copyText = function(text) {
  var app = this.app;
  var done = function() { app.showToast(i18n('reader_copied'), 1500); };
  var fallback = function() {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    document.body.removeChild(ta);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else {
    fallback();
  }
};

PttReader.prototype.onContextMenu = function(e) {
  var self = this;
  var app = this.app;
  e.preventDefault();
  e.stopPropagation();
  var selText = window.getSelection().isCollapsed ? '' : window.getSelection().toString();
  if (!this.menu) {
    this.menu = PttReader.el('ul', 'dropdown-menu jjt-menu');
    document.body.appendChild(this.menu);
  }
  var menu = this.menu;
  menu.innerHTML = '';
  var add = function(label, fn) {
    var li = PttReader.el('li');
    var a = PttReader.el('a', '', label);
    a.href = '#';
    a.addEventListener('click', function(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      self.hideMenu();
      fn();
    });
    li.appendChild(a);
    menu.appendChild(li);
  };
  if (selText) {
    add(i18n('cmenu_copy'), function() { self.copyText(selText.replace(/\u00a0/g, ' ')); });
    add(i18n('cmenu_askAi'), function() { app.askAi(selText); });
    var q = selText.replace(/\s+/g, ' ').trim();
    add(i18n('cmenu_searchGoogle') + '「' + (q.length > 12 ? q.slice(0, 12) + '…' : q) + '」', function() {
      window.open('https://www.google.com/search?q=' + encodeURIComponent(q), '_blank', 'noreferrer');
    });
    menu.appendChild(PttReader.el('li', 'divider'));
  } else if (this.article) {
    var art = this.article;
    add(i18n('cmenu_askAiArticle'), function() {
      app.askAi((art.meta['標題'] || '') + '\n' + (art.url || '') + '\n\n' + String(art.text || '').split('\n※ 發信站')[0]);
    });
  }
  var link = e.target.closest && e.target.closest('a[href^="http"]');
  if (link) {
    var href = link.getAttribute('href');
    add(i18n('reader_copyUrl'), function() { self.copyText(href); });
    add(i18n('reader_openUrl'), function() { window.open(href, '_blank', 'noreferrer'); });
    menu.appendChild(PttReader.el('li', 'divider'));
  }
  var push = e.target.closest && e.target.closest('[data-user]');
  if (push) {
    var id = push.getAttribute('data-user');
    var pref = app.pref;
    if (pref.isBlacklisted(id)) {
      add(i18n('cmenu_removeBlacklistUserId') + " '" + id + "'", function() { app.doRemoveBlacklistUserId(id); self.rerender(); });
    } else {
      add(i18n('cmenu_addBlacklistUserId') + " '" + id + "'", function() { app.doAddBlacklistUserId(id); self.rerender(); });
    }
    var listName = pref.customListName();
    if (id in (pref.notedUserIds || {})) {
      add(i18n('cmenu_removeUserNote').replace('%l', listName) + " '" + id + "'", function() { app.doRemoveUserNote(id); self.rerender(); });
    } else {
      add(i18n('cmenu_setUserNote').replace('%l', listName) + " '" + id + "'", function() { app.doSetUserNote(id); self.rerender(); });
    }
    if (id in pref.watchlistedUserIds) {
      add(i18n('cmenu_removeWatchUserId') + " '" + id + "'", function() { app.doRemoveWatchUserId(id); self.rerender(); });
    } else {
      add(i18n('cmenu_addWatchUserId') + " '" + id + "'", function() { app.doAddWatchUserId(id); self.rerender(); });
    }
    menu.appendChild(PttReader.el('li', 'divider'));
  }
  add(i18n('reader_terminal'), function() { self.dismiss(); });
  add(i18n('cmenu_settings'), function() { self.dismiss(); app.doSettings(); });
  menu.style.display = 'block';
  menu.style.position = 'fixed';
  menu.style.zIndex = 3000;
  var x = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 4);
  var y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4);
  menu.style.left = Math.max(0, x) + 'px';
  menu.style.top = Math.max(0, y) + 'px';
};

// Redraw after blacklist / watchlist changes, keeping the scroll position.
PttReader.prototype.rerender = function() {
  if (!this.article || !this.isOpen()) return;
  var scroller = this.overlay.querySelector('.jjt-scroll');
  var top = scroller.scrollTop;
  this.render(this.article, this.renderedHeader || {});
  scroller.scrollTop = top;
  this.updateStatus();
  this.overlay.focus();
};

PttReader.prototype.show = function() {
  var o = this.ensureOverlay();
  o.style.display = 'flex';
  this.app.modalShown = true;  // keeps terminal key handling out of the way
  o.focus();
};

PttReader.prototype.close = function() {
  if (!this.overlay) return;
  this.hideMenu();
  this.hideHoverPreview();
  this.overlay.style.display = 'none';
  this.app.modalShown = false;
  this.currentKey = '';
  this.app.setInputAreaFocus();
};

// Close and don't reopen for this article.
PttReader.prototype.dismiss = function() {
  this.dismissedKey = this.currentKey || this.loadingKey;
  this.close();
};

// Keys to the article above (-1) / below (+1) on screen; with the list
// shown newest first, "above" is the next article in PTT's order.
PttReader.prototype.navKeys = function(dir) {
  var pref = this.app.pref;
  if (pref && pref.values && pref.values.listNewestFirst) dir = -dir;
  return dir < 0 ? PttReader.KEYS_PREV : PttReader.KEYS_NEXT;
};

PttReader.NAV_SWALLOW_MS = 1500;

// Moving keys pressed while the move to the previous / next article is on
// its way (navFrom is cleared when PTT shows an article).
PttReader.prototype.swallowsNavKey = function(e) {
  var nav = this.navFrom;
  if (!nav || Date.now() - nav.at > PttReader.NAV_SWALLOW_MS) return false;
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  return /^(ArrowDown|ArrowUp|ArrowRight|PageDown|PageUp|Enter| )$/.test(e.key);
};

PttReader.prototype.closeAndSend = function(keys) {
  var from = this.currentKey || this.loadingKey;
  this.dismiss();
  this.navFrom = (keys === PttReader.KEYS_PREV || keys === PttReader.KEYS_NEXT) && from ?
    { key: from, at: Date.now() } : null;
  // keep the list position in step when moving to the previous / next one
  if (this.listSnap && keys === PttReader.KEYS_PREV) this.listSnap.index--;
  if (this.listSnap && keys === PttReader.KEYS_NEXT) this.listSnap.index++;
  if (keys === PttReader.KEYS_PREV) this.navDir = -1;
  if (keys === PttReader.KEYS_NEXT) this.navDir = 1;
  // X / % push: when PTT shows the article again, wait for the push on the web
  this.pushFrom = (keys === 'X' || keys === '%') && from && this.article ?
    { key: from, at: Date.now(), count: this.article.pushes.length, url: this.article.url } : null;
  if (this.app.conn && this.app.conn.send) this.app.conn.send(keys);
};

// Keys behave like reading in the terminal; anything else goes to PTT.
PttReader.prototype.onKeyDown = function(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;  // browser shortcuts (copy...)
  var scroller = this.overlay.querySelector('.jjt-scroll');
  var line = this.lineHeight || 20;
  var page = Math.max(line, scroller.clientHeight - line * 2);
  // like PTT: past the top / bottom of the article goes to the previous /
  // next one
  var atTop = scroller.scrollTop <= 0;
  var atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
  if (this.menu && this.menu.style.display === 'block') {
    if (e.key === 'Escape') {
      this.hideMenu();
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }
  switch (e.key) {
    case 'Escape':
      this.dismiss();
      break;
    case 'ArrowLeft':
    case 'q':
      this.closeAndSend('\x1b[D');
      break;
    case 'ArrowDown':
    case 'Enter':
      if (atBottom) this.closeAndSend(this.navKeys(1));
      else scroller.scrollTop += line;
      break;
    case 'ArrowUp':
      if (atTop) this.closeAndSend(this.navKeys(-1));
      else scroller.scrollTop -= line;
      break;
    case ' ':
    case 'PageDown':
    case 'ArrowRight':
      if (atBottom) this.closeAndSend(this.navKeys(1));
      else scroller.scrollTop += page;
      break;
    case 'PageUp':
    case 'b':
      scroller.scrollTop -= page;
      break;
    case 'Home':
      scroller.scrollTop = 0;
      break;
    case 'End':
    case '$':
      scroller.scrollTop = scroller.scrollHeight;
      break;
    default:
      if (e.key.length === 1) {
        // X push, y reply, ] next article ... handled by PTT itself
        this.closeAndSend(e.key);
        break;
      }
      return;
  }
  e.preventDefault();
  e.stopPropagation();
};

PttReader.prototype.openFor = function(h, key, manual) {
  var self = this;
  this.loadingKey = key;
  var url = (this.lastHeader && this.lastHeader.key === key) ? this.lastUrl : '';
  var t0 = Date.now();
  var pre = this.takePrefetch(h);
  var how = url ? 'url' : pre ? 'prefetch' : 'search';
  var load = url ? this.fetchArticle(url) :
    pre ? pre.catch(function() { how = 'search'; return self.findArticle(h); }) : this.findArticle(h);
  this.setLoading(true);
  load = load.catch(function(e) {
    // still on this article (PTT redrawing may have cleared loadingKey)
    var here = self.lastHeader && self.lastHeader.key === key;
    if (!self.canReadTerminal(e) || (self.loadingKey !== key && !(here && !self.loadingKey && !self.currentKey))) throw e;
    self.loadingKey = key;
    // shows the article itself as its pages come in
    console.log('JJptt 閱讀模式載入：PTT 網頁故障，從 BBS 畫面讀');
    return self.terminalArticle(url, key, h).then(function() { return null; });
  });
  load.then(function(article) {
    if (!article) return;
    var tFetched = Date.now();
    PttReader.lastTiming = { how: how, fetchMs: tFetched - t0 };
    if (self.loadingKey === key) self.setLoading(false);
    if (self.loadingKey !== key) return;  // moved on meanwhile
    // Still reading the same article in the terminal? The header may have
    // scrolled away if the user paged down while it was loading, so use the
    // article tracked from the terminal rather than what is on screen.
    if (!manual) {
      self.trackTerminal();
      var cur = self.lastHeader;
      if (self.app.buf.pageState != 3 || !cur || cur.key !== key) return;
    }
    self.loadingKey = '';
    self.currentKey = key;
    self.article = article;
    self.render(article, h);
    self.show();
    self.restorePosition();
    self.prefetchNeighbours(h);
    PttReader.lastTiming.renderMs = Date.now() - tFetched;
    console.log('JJptt 閱讀模式載入：' + (how === 'url' ? '直接用文章網址' : how === 'prefetch' ? '列表預先載入' : '搜尋網址＋下載') +
      ' ' + PttReader.lastTiming.fetchMs + 'ms，排版 ' + PttReader.lastTiming.renderMs + 'ms');
  }).catch(function(e) {
    console.log('reader unavailable for this article:', e);
    if (self.loadingKey === key) {
      self.loadingKey = '';
      self.setLoading(false);
    }
    self.dismissedKey = key;  // stay in the terminal for this one
    // no toast: the terminal shows the article anyway (the reason is in the
    // console line above)
  });
};

// "閱讀模式載入中…" at the top while the article is being fetched.
// With `text`: that instead (the pages read so far, terminalArticle).
PttReader.prototype.setLoading = function(on, text) {
  var n = document.getElementById('jjLoading');
  if (!n) {
    n = PttReader.el('div', '');
    n.id = 'jjLoading';
    document.body.appendChild(n);
  }
  n.textContent = text || i18n('app_loading');
  n.classList.toggle('show', !!on);
};

PttReader.el = function(tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
};

// http:// pictures are asked for over https:// (the Android app's page is
// https and does not load http content; Chrome upgrades them the same way)
PttReader.https = function(url) {
  return String(url || '').replace(/^http:\/\//i, 'https://');
};

PttReader.imageSrc = function(url) {
  if (url.isImageUrl()) return PttReader.https(url);
  var m = /^https?:\/\/(?:m\.)?imgur\.com\/(\w{5,8})$/i.exec(url);
  if (m) return 'https://i.imgur.com/' + m[1] + '.jpg';
  return '';
};

// Smaller version of an image when the host offers one: imgur "l" thumbnails
// (about 640px wide), Twitter "small". Animated GIFs are left alone.
PttReader.lowResSrc = function(src) {
  var m = /^https?:\/\/i\.imgur\.com\/(\w{7})\.(jpe?g|png|webp)(?:[?#].*)?$/i.exec(src);
  if (m) return 'https://i.imgur.com/' + m[1] + 'l.jpg';
  if (/^https?:\/\/pbs\.twimg\.com\/media\//i.test(src)) {
    return src.replace(/([?&]name=)\w+/, '$1small') + (/[?&]name=/.test(src) ? '' : (src.indexOf('?') < 0 ? '?' : '&') + 'name=small');
  }
  return src;
};

PttReader.prototype.preloadImages = function() {
  var pref = this.app.pref;
  return !!(pref && pref.values && pref.values.readerPrefetchImages !== false);
};

// Option "預先讀取時連圖片一起下載": fetch the pictures of an article loaded
// ahead (images, YouTube thumbnails, link-preview pictures) so they are in
// the browser cache when the article is opened.
PttReader.prototype.preloadMedia = function(article) {
  if (!article || !this.preloadImages()) return;
  var self = this;
  this.preloaded = this.preloaded || [];
  var seen = {};
  var urls = String(article.text || '').match(/https?:\/\/[^\s<>"'，。）)]+/g) || [];
  // a URL that PTT cut in two: fetch the whole one, not its first part
  PttReader.urlJoins(article).forEach(function(j, i) {
    if (!j || !j.first) return;
    var at = urls.indexOf(SplitUrl.lastUrl(article.pushes[i].content));
    if (at >= 0) urls[at] = j.url;
  });
  var get = function(src) {
    if (!src || seen[src]) return;
    seen[src] = true;
    var im = new Image();
    im.referrerPolicy = 'no-referrer';
    im.src = src;
    self.preloaded.push(im);  // keep a reference until it has loaded
    if (self.preloaded.length > 300) self.preloaded.splice(0, 100);
  };
  var cards = [];
  urls.slice(0, 60).forEach(function(u) {
    var img = PttReader.imageSrc(u);
    var yt = u.parseYoutubeUrl ? u.parseYoutubeUrl() : null;
    if (/^https?:\/\/i\.imgur\.com\/\w+\.(?:gifv|mp4)$/i.test(u)) return;  // videos stay on demand
    if (img) get(self.displaySrc(img));
    else if (yt) get('https://i.ytimg.com/vi/' + yt.split(/[?&]/)[0] + '/hqdefault.jpg');
    else cards.push(u);
  });
  if (!cards.length) return;
  this.previewPermission().then(function(ok) {
    if (!ok) return;
    cards.slice(0, 15).forEach(function(u) {
      self.fetchPreview(u).then(function(info) {
        if (info && info.youtube) get('https://i.ytimg.com/vi/' + info.youtube + '/hqdefault.jpg');
        if (!info || !info.image) return;
        get(PttReader.isImgurAlbum(u) ? self.displaySrc(PttReader.albumPicture(info.image)) : info.image);
      });
    });
  });
};

PttReader.prototype.displaySrc = function(src) {
  var pref = this.app.pref;
  var low = !pref || !pref.values || pref.values.readerLowResImages !== false;
  return low ? PttReader.lowResSrc(src) : src;
};

// Link line plus its media (image, video, YouTube or link card). With
// mediaOnly the link text itself is left out (it is already in the text).
PttReader.prototype.linkBlock = function(url, mediaOnly, inPush) {
  var el = PttReader.el;
  var wrap = el('div', 'jjr-media');
  var a = el('a', 'jjr-link', url);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noreferrer';
  if (!mediaOnly) wrap.appendChild(a);

  var img = PttReader.imageSrc(url);
  var yt = url.parseYoutubeUrl ? url.parseYoutubeUrl() : null;
  var imgurVideo = /^https?:\/\/i\.imgur\.com\/(\w+)\.(?:gifv|mp4)$/i.exec(url);
  if (imgurVideo) {
    var v = el('video', 'jjr-img');
    v.src = 'https://i.imgur.com/' + imgurVideo[1] + '.mp4';
    v.autoplay = v.loop = v.muted = v.playsInline = true;
    wrap.appendChild(v);
  } else if (img) {
    var im = el('img', 'jjr-img');
    im.loading = this.preloadImages() ? 'eager' : 'lazy';
    im.referrerPolicy = 'no-referrer';
    im.src = this.displaySrc(img);
    im.setAttribute('data-full', img);
    im.addEventListener('error', PttReader.imageRetry(im));
    wrap.appendChild(im);
  } else if (yt) {
    var card = el('a', 'jjr-card jjr-yt');
    card.href = url;
    card.target = '_blank';
    card.rel = 'noreferrer';
    card.appendChild(PttReader.ytThumb(yt.split(/[?&]/)[0]));
    var ytText = el('div', 'jjr-card-text');
    ytText.appendChild(el('div', 'jjr-card-host', 'YouTube'));
    card.appendChild(ytText);
    card.setAttribute('data-preview-url', url);
    wrap.appendChild(card);
  } else {
    // Link card like phone apps: filled with the page's title, summary and
    // image once previews are allowed (see loadPreviews).
    var host = '';
    try { host = new URL(url).hostname; } catch (e) {}
    var c = el('a', 'jjr-card' + (PttReader.isImgurAlbum(url) ? ' jjr-imgur-album' : '') +
      (inPush && PttReader.isShortLink(url) ? ' jjr-short' : ''));
    c.href = url;
    c.target = '_blank';
    c.rel = 'noreferrer';
    var text = el('div', 'jjr-card-text');
    text.appendChild(el('div', 'jjr-card-host', host));
    c.appendChild(text);
    c.setAttribute('data-preview-url', url);
    wrap.appendChild(c);
  }
  return wrap;
};

// Error handler for a picture loaded without a referrer: some hosts
// (i.verb.tw) refuse those (403) but show it with one, so try once more with
// the browser's normal referrer before hiding it.
PttReader.imageRetry = function(im) {
  return function() {
    if (im.referrerPolicy === 'no-referrer') {
      im.referrerPolicy = 'strict-origin-when-cross-origin';
      var src = im.getAttribute('src');
      im.removeAttribute('src');
      im.setAttribute('src', src);
      return;
    }
    im.style.display = 'none';
  };
};

// ---- link previews ----------------------------------------------------------
// Fetching arbitrary sites needs an optional permission that the user grants
// once from a card ("顯示網址預覽").

PttReader.PREVIEW_ORIGINS = ['http://*/*', 'https://*/*'];

PttReader.prototype.previewPermission = function() {
  return new Promise(function(resolve) {
    if (lib.isApp()) {  // the app may read any site (link previews just work)
      resolve(true);
      return;
    }
    if (!(window.chrome && chrome.permissions && chrome.permissions.contains)) {
      resolve(false);
      return;
    }
    chrome.permissions.contains({ origins: PttReader.PREVIEW_ORIGINS }, function(ok) { resolve(!!ok); });
  });
};

PttReader.prototype.loadPreviews = function(root) {
  var self = this;
  var cards = root.querySelectorAll('[data-preview-url]');
  if (!cards.length) return;
  this.previewPermission().then(function(ok) {
    for (var i = 0; i < cards.length; ++i) {
      if (ok) self.fillCard(cards[i]);
      else if (cards[i].classList.contains('jjr-short')) PttReader.dropCard(cards[i]);  // can't tell where it goes
      else self.offerPreview(cards[i], root);
    }
  });
};

PttReader.prototype.offerPreview = function(card, root) {
  var self = this;
  if (card.querySelector('.jjr-card-allow')) return;
  var btn = PttReader.el('button', 'jjr-card-allow', i18n('reader_allowPreview'));
  btn.type = 'button';
  btn.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    chrome.permissions.request({ origins: PttReader.PREVIEW_ORIGINS }, function(granted) {
      if (!granted) return;
      var btns = root.querySelectorAll('.jjr-card-allow');
      for (var i = 0; i < btns.length; ++i) btns[i].parentNode.removeChild(btns[i]);
      self.loadPreviews(root);
    });
  });
  card.querySelector('.jjr-card-text').appendChild(btn);
};

PttReader.fetchMsn = function(locale, id) {
  var api = 'https://assets.msn.com/content/view/v2/Detail/' + locale.toLowerCase() + '/' + id;
  return fetch(api, { credentials: 'omit' }).then(function(r) {
    return r.ok ? r.json() : null;
  }).then(function(j) {
    if (!j || !j.title) return null;
    var imgs = j.imageResources || [];
    var img = imgs.length ? (imgs[0].url || '') : '';
    if (img && img.indexOf('?') < 0) img += '?w=800';
    return {
      title: j.title,
      desc: j.abstract || '',
      image: img,
      site: (j.provider && j.provider.name) || 'MSN'
    };
  }).catch(function() { return null; });
};

PttReader.prototype.fetchPreview = function(url) {
  this.previewCache = this.previewCache || {};
  if (this.previewCache[url]) return this.previewCache[url];
  var p = fetch(url, { credentials: 'omit', redirect: 'follow' }).then(function(res) {
    var type = res.headers.get('content-type') || '';
    if (!res.ok || type.indexOf('html') < 0) return null;
    return res.text().then(function(html) {
      var doc = new DOMParser().parseFromString(html.slice(0, 400000), 'text/html');
      var meta = function(names) {
        for (var i = 0; i < names.length; ++i) {
          var n = doc.querySelector('meta[property="' + names[i] + '"], meta[name="' + names[i] + '"]');
          if (n && n.getAttribute('content')) return n.getAttribute('content').trim();
        }
        return '';
      };
      var title = meta(['og:title', 'twitter:title']) || (doc.title || '').trim();
      var image = meta(['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src']);
      if (image) {
        try { image = PttReader.https(new URL(image, res.url).href); } catch (e) { image = ''; }
      }
      var info = {
        title: title,
        desc: meta(['og:description', 'description', 'twitter:description']),
        image: image,
        site: meta(['og:site_name'])
      };
      // a short link's page that leads to a YouTube video
      var yt = String(res.url).parseYoutubeUrl() || String(PttReader.pageTarget(doc, html)).parseYoutubeUrl();
      if (yt) info.youtube = yt;
      // MSN article pages are built by script and carry no og: tags; their
      // content API has the title, summary and pictures
      var msn = /^https?:\/\/(?:www\.)?msn\.com\/([a-z]{2}-[a-z]{2})\/.*\/ar-([A-Za-z0-9]+)/i.exec(res.url);
      if (msn && !image) {
        return PttReader.fetchMsn(msn[1], msn[2]).then(function(m) { return m || info; });
      }
      return info;
    });
  }).catch(function() { return null; });
  this.previewCache[url] = p;
  return p;
};

// YouTube thumbnail with YouTube's red play button on it, so it reads as a
// video even though a tap opens YouTube rather than playing here.
PttReader.ytThumb = function(id) {
  var box = PttReader.el('span', 'jjr-yt-thumb');
  var thumb = PttReader.el('img', 'jjr-card-thumb');
  thumb.loading = 'lazy';
  thumb.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
  box.appendChild(thumb);
  var play = PttReader.el('span', 'jjr-yt-play');
  play.setAttribute('aria-hidden', 'true');
  box.appendChild(play);
  return box;
};

// A short link card turned into a YouTube card (thumbnail; tap opens it).
PttReader.youtubeCard = function(card, id) {
  card.classList.add('jjr-yt');
  card.classList.remove('jjr-short');
  var allow = card.querySelector('.jjr-card-allow');
  if (allow) allow.parentNode.removeChild(allow);
  card.insertBefore(PttReader.ytThumb(id), card.firstChild);
  var host = card.querySelector('.jjr-card-host');
  if (host) host.textContent = 'YouTube';
};

// A card that should not stay (a short link that is not a video): removed
// with its wrapper when nothing else is in it.
PttReader.dropCard = function(card) {
  var wrap = card.parentNode;
  if (!wrap) return;
  wrap.removeChild(card);
  if (wrap.classList && wrap.classList.contains('jjr-media') && !wrap.childNodes.length && wrap.parentNode) {
    wrap.parentNode.removeChild(wrap);
  }
};

PttReader.prototype.fillCard = function(card) {
  var el = PttReader.el;
  var url = card.getAttribute('data-preview-url');
  var isYt = card.classList.contains('jjr-yt');
  var self = this;
  var isShort = card.classList.contains('jjr-short');
  this.fetchPreview(url).then(function(info) {
    if (isShort) {
      if (info && info.youtube) PttReader.youtubeCard(card, info.youtube);
      else PttReader.dropCard(card);
      return;
    }
    if (info && info.youtube && !card.classList.contains('jjr-yt')) {
      PttReader.youtubeCard(card, info.youtube);
      return;
    }
    if (!info || !(info.title || info.image)) return;
    if (info.image && card.classList.contains('jjr-imgur-album') && card.parentNode) {
      var full = PttReader.albumPicture(info.image);
      var pic = el('img', 'jjr-img');
      pic.referrerPolicy = 'no-referrer';
      pic.src = self.displaySrc(full);
      pic.setAttribute('data-full', full);
      pic.addEventListener('error', PttReader.imageRetry(pic));
      card.parentNode.replaceChild(pic, card);
      return;
    }
    var text = card.querySelector('.jjr-card-text');
    var allow = text.querySelector('.jjr-card-allow');
    if (allow) allow.parentNode.removeChild(allow);
    if (info.image && !isYt) {
      var img = el('img', 'jjr-card-thumb');
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.src = info.image;
      var retry = PttReader.imageRetry(img);
      img.addEventListener('error', function() {
        if (img.referrerPolicy === 'no-referrer') retry();
        else if (img.parentNode) img.parentNode.removeChild(img);
      });
      card.insertBefore(img, card.firstChild);
      card.classList.add('jjr-card-rich');
    }
    if (info.site) text.querySelector('.jjr-card-host').textContent = info.site;
    if (info.title) text.appendChild(el('div', 'jjr-card-title', info.title));
    if (info.desc && !isYt) text.appendChild(el('div', 'jjr-card-desc', info.desc));
  });
};

// ---- terminal-look rendering ----------------------------------------------
// The article is drawn like the terminal (same font, size, 80-column width,
// PTT colours) with images and link cards inserted below lines with URLs.

// PTT web colour classes (f0-f7, b0-b7, hl) -> terminal classes (q0-q15, b0-b7).
// push.block: pushes split by other lines ("※ 編輯" ...) are in different
// blocks -- the same split 連續推文排在一起 uses, so 連推 counts runs alike.
PttReader.assignBlocks = function(body, pushes) {
  var block = 0, inBlock = false;
  PttReader.toLines(body).forEach(function(l) {
    if (l.push_index === undefined) { inBlock = false; return; }
    if (!inBlock) { block++; inBlock = true; }
    if (pushes[l.push_index]) pushes[l.push_index].block = block;
  });
};

PttReader.colorState = function(node, parent) {
  var st = { fg: parent.fg, bg: parent.bg, hl: parent.hl, href: parent.href };
  var cls = (node.getAttribute && node.getAttribute('class')) || '';
  cls.split(/\s+/).forEach(function(c) {
    var m = /^f(\d)$/.exec(c);
    if (m) st.fg = +m[1];
    m = /^b(\d)$/.exec(c);
    if (m) st.bg = +m[1];
    if (c === 'hl') st.hl = true;
  });
  if (node.tagName === 'A' && node.getAttribute('href')) st.href = node.getAttribute('href');
  return st;
};

// Splits a DOM subtree into lines of coloured segments.
PttReader.toLines = function(root) {
  var lines = [[]];
  var walk = function(node, st) {
    if (node.nodeType === 3) {
      var parts = node.nodeValue.split('\n');
      for (var i = 0; i < parts.length; ++i) {
        if (i > 0) lines.push([]);
        if (parts[i]) lines[lines.length - 1].push({ text: parts[i], st: st });
      }
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.hasAttribute('data-push-index')) {
      // a push is one line of its own
      var marker = [];
      marker.push_index = +node.getAttribute('data-push-index');
      if (!lines[lines.length - 1].length) lines[lines.length - 1] = marker;
      else lines.push(marker);
      lines.push([]);
      return;
    }
    var next = PttReader.colorState(node, st);
    for (var c = node.firstChild; c; c = c.nextSibling) walk(c, next);
  };
  walk(root, { fg: 7, bg: 0, hl: false, href: '' });
  return lines;
};

PttReader.segClass = function(st) {
  return 'q' + (st.fg + (st.hl ? 8 : 0)) + ' b' + st.bg;
};

PttReader.prototype.lineNode = function(segs) {
  var el = PttReader.el;
  var div = el('div', 'jjt-line');
  var urls = [];
  var urlRe = /https?:\/\/[^\s<>"'，。）)]+/g;
  segs.forEach(function(seg) {
    var cls = PttReader.segClass(seg.st);
    if (seg.st.href) {
      var a = el('a', 'jjt-link ' + cls, seg.text);
      a.href = seg.st.href;
      a.target = '_blank';
      a.rel = 'noreferrer';
      div.appendChild(a);
      if (/^https?:/.test(seg.st.href) && !seg.tail) urls.push(seg.st.href);
      return;
    }
    var last = 0, m;
    urlRe.lastIndex = 0;
    while ((m = urlRe.exec(seg.text))) {
      if (m.index > last) div.appendChild(el('span', cls, seg.text.slice(last, m.index)));
      var link = el('a', 'jjt-link ' + cls, m[0]);
      link.href = m[0];
      link.target = '_blank';
      link.rel = 'noreferrer';
      div.appendChild(link);
      urls.push(m[0]);
      last = m.index + m[0].length;
    }
    if (last < seg.text.length) div.appendChild(el('span', cls, seg.text.slice(last)));
  });
  if (!segs.length) div.appendChild(document.createTextNode(' '));
  return { node: div, urls: urls };
};

// Pushes whose URL was cut by PTT and goes on in the next push (SplitUrl).
PttReader.urlJoins = function(article) {
  if (!article.urlJoins) article.urlJoins = SplitUrl.joins(article.pushes || []);
  return article.urlJoins;
};

// lineNode() segments for a push's content: both parts of a URL that PTT cut
// in two link to the whole URL. The rest of a URL is not counted in urls
// (its picture is shown under the push it starts in).
PttReader.pushSegs = function(content, join, st, prefix) {
  content = String(content || '');
  var segs = prefix ? [{ text: prefix, st: st }] : [];
  var link = { fg: st.fg, bg: st.bg, hl: st.hl, href: join ? join.url : '' };
  var at = -1, part = '';
  if (join && join.tail) {
    part = join.tail;
    at = content.indexOf(part);
  } else if (join && join.first) {
    part = SplitUrl.lastUrl(content);
    at = part ? content.lastIndexOf(part) : -1;
  }
  if (at < 0) {
    segs.push({ text: content, st: st });
    return segs;
  }
  if (at > 0) segs.push({ text: content.slice(0, at), st: st });
  segs.push({ text: part, st: link, tail: !!join.tail });
  if (at + part.length < content.length) segs.push({ text: content.slice(at + part.length), st: st });
  return segs;
};

// Pushes show the pictures they post. A URL that PTT cut in two also gets
// its YouTube thumbnail or link card: the URL can't be read on the screen,
// so the card says where it goes.
PttReader.pushMedia = function(url, join) {
  return !!PttReader.imageSrc(url) || PttReader.isImgurAlbum(url) || !!String(url).parseYoutubeUrl() ||
    PttReader.isShortLink(url) || !!(join && join.first && url === join.url);
};

// Short links: in a push they get a card only when they lead to a YouTube
// video (the card is dropped otherwise, see fillCard).
PttReader.SHORT_HOSTS = /^(?:reurl\.cc|bit\.ly|tinyurl\.com|t\.co|goo\.gl|lihi\d?\.(?:cc|com|me)|pse\.is|is\.gd|shorturl\.at|reurl\.tw)$/i;
PttReader.isShortLink = function(url) {
  var m = /^https?:\/\/([^\/?#]+)\/[\w-]+\/?$/i.exec(String(url || ''));
  return !!(m && PttReader.SHORT_HOSTS.test(m[1].replace(/^www\./i, '')));
};

// Where a short link's page sends the reader, when it says so in the page:
// a hidden "target" field (reurl.cc), a meta refresh, or a YouTube link.
PttReader.pageTarget = function(doc, html) {
  var t = doc.querySelector('input#target, input[name="target"]');
  if (t && /^https?:\/\//i.test(t.getAttribute('value') || '')) return t.getAttribute('value');
  var r = doc.querySelector('meta[http-equiv="refresh" i]');
  var m = r && /url=['"]?(https?:\/\/[^'"\s]+)/i.exec(r.getAttribute('content') || '');
  if (m) return m[1];
  m = /https?:\/\/(?:(?:www\.|m\.)?youtube\.com\/(?:watch\?[^"'<\s]*v=|shorts\/|live\/)|youtu\.be\/)[\w-]+[^"'<\s]*/i.exec(html);
  return m ? m[0].replace(/&amp;/g, '&') : '';
};

// imgur albums / galleries (imgur.com/a/ID, imgur.com/gallery/title-ID):
// shown as their first picture, read from the album page (og:image).
PttReader.isImgurAlbum = function(url) {
  return /^https?:\/\/(?:m\.)?imgur\.com\/(?:a|gallery)\/[\w-]+\/?(?:[?#].*)?$/i.test(String(url || ''));
};
// og:image of an album is a crop for Facebook ("?fb"): the picture itself
PttReader.albumPicture = function(image) {
  return String(image || '').replace(/\?fb$/, '');
};

PttReader.prototype.headerNode = function(article, h) {
  var el = PttReader.el;
  var frag = document.createDocumentFragment();
  // Two layers: all row backgrounds first, then all text on top, so a row's
  // background can't cover the edges of tall glyphs in the row above.
  var head = el('div', 'jjt-head');
  var bg = el('div', 'jjt-head-bg');
  var fg = el('div', 'jjt-head-fg');
  var row = function(tag, value, tag2, value2) {
    var d = el('div', 'jjt-line jjt-hrow');
    d.appendChild(el('span', 'q4 b7 jjt-htag', ' ' + tag + ' '));
    d.appendChild(el('span', 'q7 b4 jjt-hval', ' ' + value));
    if (tag2) {
      d.appendChild(el('span', 'q4 b7 jjt-htag', ' ' + tag2 + ' '));
      d.appendChild(el('span', 'q7 b4 jjt-hval2', ' ' + value2 + ' '));
    }
    bg.appendChild(d);
    fg.appendChild(d.cloneNode(true));
  };
  row('作者', article.meta['作者'] || h.author, '看板', article.meta['看板'] || h.board);
  row('標題', article.meta['標題'] || h.title);
  row('時間', article.meta['時間'] || '');
  head.appendChild(bg);
  head.appendChild(fg);
  frag.appendChild(head);
  var sep = el('div', 'jjt-line');
  sep.appendChild(el('span', 'q6 b0', new Array(41).join('─')));
  frag.appendChild(sep);
  return frag;
};

PttReader.prototype.render = function(article, h) {
  this.renderedHeader = h;
  var el = PttReader.el;
  var view = this.app.view;
  var o = this.ensureOverlay();
  var page = o.querySelector('.jjt-page');
  page.innerHTML = '';

  this.layout();

  page.appendChild(this.headerNode(article, h));

  var lines = PttReader.toLines(article.body);
  if (lines.length && !lines[lines.length - 1].length && lines[lines.length - 1].push_index === undefined) lines.pop();
  var pushNodes = this.renderPushes(article);
  var pv = this.app.pref && this.app.pref.values;
  if (!(pv && pv.readerGroupRuns === false)) PttReader.groupRuns(lines, article.pushes);
  var runAt = {};
  PttReader.collapsedRuns(lines, article.pushes, pv, String(article.meta['作者'] || '').split(' ')[0])
    .forEach(function(r) { runAt[r.start] = r; });
  var reportShown = false;
  for (var i = 0; i < lines.length; ++i) {
    if (lines[i].push_index !== undefined) {
      if (!reportShown) {  // fact-check report right above the first push
        reportShown = true;
        var rep = this.factReportNode(article);
        if (rep) page.appendChild(rep);
      }
      var run = runAt[i];
      if (run) {  // 連推 as one line (hidden blacklisted pushes stay hidden)
        var frags = [], faded = true;
        for (var ri = run.start; ri < run.end; ++ri) {
          var rn = pushNodes[lines[ri].push_index];
          if (!rn) continue;
          rn.line.setAttribute('data-line', 5 + ri);
          if (!rn.line.classList.contains('jjt-faded')) faded = false;
          frags.push(rn.frag);
        }
        if (frags.length) {
          var rnode = this.runNode(article, run, frags, faded);
          rnode.firstChild.setAttribute('data-line', 5 + i);
          page.appendChild(rnode);
        }
        i = run.end - 1;
        continue;
      }
      var pn = pushNodes[lines[i].push_index];
      if (pn) {
        pn.line.setAttribute('data-line', 5 + i);
        page.appendChild(pn.frag);
      }
      continue;
    }
    var r = this.lineNode(lines[i]);
    // PTT line number: 3 header lines + separator, then the body
    r.node.setAttribute('data-line', 5 + i);
    page.appendChild(r.node);
    var text = r.node.textContent.trim();
    var quoted = /^[:：]/.test(text) || /^※/.test(text);
    if (!quoted) {
      for (var u = 0; u < r.urls.length; ++u) page.appendChild(this.linkBlock(r.urls[u], true));
    }
  }
  this.updateStatus();
  this.loadPreviews(page);
};

// The collapsed report's one line: data-centre findings first (the most
// telling) as "機房：Zenlayer×1", then the other kinds by name ("秒推：…" ->
// 秒推). No account names here; they are in the expanded lines.
PttReader.factSummary = function(lines) {
  var hostLine = '';
  var kinds = [];
  lines.forEach(function(t) {
    t = String(t);
    if (!hostLine && /^(同機房|機房)/.test(t)) {
      // "同機房：DigitalOcean 2 個帳號（a、b）；AWS 1 個帳號（c）" -> "同機房：DigitalOcean×2、AWS×1"
      var provs = [], m, re = /(?:^|；)\s*(?:[^：；]*：)?\s*([^；：（]+?)\s+(\d+)\s*個帳號/g;
      while ((m = re.exec(t))) provs.push(m[1].trim() + '×' + m[2]);
      hostLine = t.split('：')[0].replace(/^機房／VPN IP/, '機房') + '：' +
                 (provs.join('、') || t.split('：').slice(1).join('：').replace(/（[^）]*）/g, ''));
      return;
    }
    var k = t.split(/[：:]/)[0].replace(/^疑似/, '').trim();
    var n = /（(\d+) 組）/.exec(k);
    k = k.replace(/（\d+ 組）/, '') + (n ? '×' + n[1] : '');
    if (k && kinds.indexOf(k) < 0) kinds.push(k);
  });
  return { hostLine: hostLine, kinds: kinds };
};

// Box above the pushes listing what the fact-check rules found, with a
// button that asks the AI about the whole thread.
PttReader.prototype.factReportNode = function(article) {
  var self = this;
  var el = PttReader.el;
  var pref = this.app.pref;
  if (pref && pref.values && pref.values.factReport === false) return null;
  var minPushes = parseInt(pref && pref.values ? pref.values.factReportMinPushes : 10, 10);
  if (isNaN(minPushes)) minPushes = 10;
  if ((article.pushes || []).length < minPushes) return null;
  var lines = PttReader.mergeFactLines(this.factReport || []);
  var box = el('div', 'jjt-fact');
  var expanded = !!(pref && pref.values && pref.values.factReportCollapsed === false);
  if (!expanded) box.classList.add('jjt-fact-closed');
  var head = el('div', 'jjt-fact-head');
  head.appendChild(el('span', 'jjt-fact-title', '真.事實查核'));
  var sum = PttReader.factSummary(lines), hostLine = sum.hostLine, kinds = sum.kinds;
  var sumEl = el('span', 'jjt-fact-sum');
  sumEl.title = '僅供參考，不代表一定是網軍';
  if (!lines.length) {
    sumEl.textContent = '沒有發現明顯的協同推文跡象';
  } else {
    if (hostLine) sumEl.appendChild(el('span', 'jjt-fact-host', '⚠ ' + hostLine));
    if (kinds.length) {
      var rest = (hostLine ? '｜另有：' : '抓到 ' + lines.length + ' 項疑點：') + kinds.slice(0, 5).join('、') + (kinds.length > 5 ? '…' : '');
      sumEl.appendChild(document.createTextNode(rest));
    }
  }
  head.appendChild(sumEl);
  if (lines.length) {
    var toggle = el('span', 'jjt-fact-toggle', expanded ? '▾ 收起' : '▸ 展開');
    head.appendChild(toggle);
    head.classList.add('jjt-fact-clickable');
    head.addEventListener('click', function(e) {
      if (e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      e.stopPropagation();
      var closed = box.classList.toggle('jjt-fact-closed');
      toggle.textContent = closed ? '▸ 展開' : '▾ 收起';
    });
  }
  var ask = el('button', 'jjt-fact-ai', '請 AI 分析推文風向');
  ask.type = 'button';
  ask.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    self.askAiAboutPushes(article);
  });
  head.appendChild(ask);
  box.appendChild(head);
  lines.forEach(function(t) { box.appendChild(el('div', 'jjt-fact-line', '・' + t)); });
  return box;
};

// Option "連續推文排在一起": in each block of push lines, a person's pushes
// that continue within 3 floors and 2 minutes after others cut in are moved
// up next to their earlier ones (the floor numbers stay as they were).
PttReader.groupRuns = function(lines, pushes) {
  var reorder = function(block) {
    return [].concat.apply([], FactCheck.chains(block, pushes));
  };
  var i = 0;
  while (i < lines.length) {
    if (lines[i].push_index === undefined) { i++; continue; }
    var start = i, block = [];
    while (i < lines.length && lines[i].push_index !== undefined) block.push(lines[i++].push_index);
    var order = reorder(block);
    for (var n = 0; n < order.length; ++n) lines[start + n].push_index = order[n];
  }
};

// 連推 runs as one line: after groupRuns a person's run sits on adjacent
// lines; a run of `readerCollapseRunMin` (5) or more pushes is drawn as one
// summary line with the run's text joined, ▸ opens the original floors.
// The author's own runs only with readerCollapseAuthorRuns (off by default).
// Returns [{start, end (line indices, end exclusive), idx: [push indices], author}].
PttReader.collapsedRuns = function(lines, pushes, values, authorId) {
  var v = values || {};
  if (v.readerCollapseRuns === false) return [];
  var min = parseInt(v.readerCollapseRunMin, 10);
  if (isNaN(min)) min = 5;
  min = Math.max(2, min);
  var withAuthor = v.readerCollapseAuthorRuns === true;
  var author = String(authorId || '').toLowerCase();
  var out = [];
  var i = 0;
  var idOf = function(k) { return lines[k] && lines[k].push_index !== undefined && pushes[lines[k].push_index] ?
                                  String(pushes[lines[k].push_index].id).toLowerCase() : null; };
  while (i < lines.length) {
    var id = idOf(i);
    if (id === null) { i++; continue; }
    var j = i + 1;
    while (j < lines.length && idOf(j) === id) j++;
    var isAuthor = !!author && id === author;
    if (j - i >= min && (!isAuthor || withAuthor)) {
      var idx = [];
      for (var k = i; k < j; ++k) idx.push(lines[k].push_index);
      out.push({ start: i, end: j, idx: idx, author: isAuthor });
    }
    i = j;
  }
  return out;
};

// What the summary line says: floors, times, and the pushes' text joined
// (PTT cuts long comments into pushes). The same sentence over and over is
// 「同一句 ×N：…」.
PttReader.runSummary = function(pushes, idx) {
  var ps = idx.map(function(k) { return pushes[k]; });
  var floors = idx.map(function(k) { return k + 1; });
  var texts = ps.map(function(p) { return String(p.content || '').trim(); });
  var times = ps.map(function(p) { var m = /(\d{1,2}:\d{2})/.exec(p.time || ''); return m ? m[1] : ''; }).filter(Boolean);
  var norm = texts.map(function(t) { return t.replace(/\s+/g, ''); });
  var same = norm.every(function(t) { return t === norm[0]; }) && !!norm[0];
  var joined = '';
  texts.forEach(function(t) {
    if (!t) return;
    // no space between Chinese; a space between words in other scripts
    var gap = joined && !/[⺀-鿿＀-￯]$/.test(joined) && !/^[⺀-鿿＀-￯]/.test(t) ? ' ' : '';
    joined += gap + t;
  });
  var lo = Math.min.apply(null, floors), hi = Math.max.apply(null, floors);
  return {
    id: ps[0].id, tag: ps[0].tag, n: ps.length,
    floors: '#' + lo + (hi > lo ? '–#' + hi : ''),
    time: times.length ? times[0] + (times[times.length - 1] !== times[0] ? '–' + times[times.length - 1] : '') : '',
    same: same,
    text: same ? '同一句 ×' + ps.length + '：' + texts[0] : joined
  };
};

// The desktop summary line; `frags` are the run's own push nodes.
PttReader.prototype.runNode = function(article, run, frags, faded) {
  var el = PttReader.el;
  var sum = PttReader.runSummary(article.pushes, run.idx);
  var box = el('div', 'jjt-run' + (faded ? ' jjt-faded' : ''));
  var head = el('div', 'jjt-line jjt-push jjt-run-head');
  var left = el('span', 'jjt-push-left');
  left.appendChild(el('span', sum.tag === '推' ? 'q15 b0' : 'q9 b0', sum.tag + ' '));
  left.appendChild(el('span', 'q11 b0', sum.id));
  left.appendChild(el('span', 'q3 b0', ': '));
  left.appendChild(el('span', 'jjt-run-badge', (run.author ? '連續回覆' : '連推') + sum.n));
  left.appendChild(el('span', 'q7 b0', ' ' + sum.floors + (sum.time ? ' ' + sum.time : '') + ' '));
  var toggle = el('span', 'jjt-run-toggle', '▸ 展開');
  left.appendChild(toggle);
  head.appendChild(left);
  // the custom list's name on the right, like a single push
  var pref = this.app && this.app.pref;
  var listLabel = pref && pref.customListLabel ? pref.customListLabel(sum.id) : '';
  if (listLabel) {
    var right = el('span', 'q7 b0 jjt-push-right', ' ');
    right.appendChild(el('span', 'jjt-itag jjt-itag-note', listLabel));
    head.appendChild(right);
  }
  box.appendChild(head);
  box.appendChild(el('div', 'jjt-line jjt-run-text q3 b0', sum.text));
  var floors = el('div', 'jjt-run-floors');
  frags.forEach(function(f) { floors.appendChild(f); });
  box.appendChild(floors);
  head.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    var open = box.classList.toggle('jjt-run-open');
    toggle.textContent = open ? '▾ 收起' : '▸ 展開';
  });
  return box;
};

// "罐頭A：…", "罐頭B：…" -> "罐頭（2 組）：…；…"; "脈衝 1：…", "脈衝 2：…" likewise.
PttReader.mergeFactLines = function(lines) {
  var order = [], groups = {};
  lines.forEach(function(t) {
    t = String(t);
    var i = t.indexOf('：');
    var head = i >= 0 ? t.slice(0, i) : t, body = i >= 0 ? t.slice(i + 1) : '';
    // group label: "脈衝 1" -> 脈衝, "罐頭A" -> 罐頭 (a letter right after Chinese only, so "VPN IP" stays)
    var kind = head.replace(/\s*\d+$/, '').replace(/([\u4e00-\u9fff])[A-Z]$/, '$1').trim();
    if (!(kind in groups)) { groups[kind] = []; order.push(kind); }
    groups[kind].push({ head: head, body: body });
  });
  return order.map(function(kind) {
    var g = groups[kind];
    if (g.length === 1) return kind + (g[0].body ? '：' + g[0].body : '');  // one group: no label needed
    return kind + '（' + g.length + ' 組）：' + g.map(function(x) {
      var tag = x.head.slice(kind.length).trim();
      return (tag ? '[' + tag + '] ' : '') + x.body;
    }).join('；');
  });
};

PttReader.prototype.askAiAboutPushes = function(article) {
  var pushes = article.pushes || [];
  var title = article.meta['標題'] || '';
  var body = String(article.text || '').split('\n※ 發信站')[0].replace(/\s+/g, ' ').slice(0, 600);
  var list = pushes.slice(0, 200).map(function(p, i) {
    return (i + 1) + '樓 ' + p.tag + ' ' + p.id + ': ' + String(p.content).trim() + ' (' + [p.ip, p.time].filter(Boolean).join(' ') + ')';
  }).join('\n');
  var found = (this.factReport || []).join('\n');
  var text = '標題：' + title + '\n發文時間：' + (article.meta['時間'] || '') + '\n內文摘要：' + body +
             (found ? '\n\nJJptt 自動偵測到：\n' + found : '') + '\n\n推文（共 ' + pushes.length + ' 則，以下前 ' +
             Math.min(200, pushes.length) + ' 則）：\n' + list;
  this.app.askAi(text, '以下是 PTT 一篇文章和它的推文。請分析推文是否有協同帶風向（網軍）的跡象：例如發文後極短時間內集體進場、同一時間湧入大量立場一致的推文、連續空泛的純推補血、不同帳號用幾乎相同的句型、同網段或境外 IP。請指出可疑的帳號與樓層、理由，以及這些推文想引導的立場；也請說明哪些看起來是正常鄉民討論。最後提醒這只是推測。\n\n%s', 7000);
};

// After showing: start at the top, or at the line the terminal is showing
// if the user already paged down while the article was loading. (Scrolling
// must happen after the overlay is visible; hidden elements ignore it.)
PttReader.prototype.restorePosition = function() {
  var self = this;
  var scroller = this.overlay.querySelector('.jjt-scroll');
  var target = 0;
  var buf = this.app.buf;
  if (buf.pageState == 3) {
    var status = buf.getRowText(23, 0, buf.cols).parseStatusRow();
    if (status && status.rowIndexStart > 1) {
      var lines = this.overlay.querySelectorAll('.jjt-page [data-line]');
      for (var i = 0; i < lines.length; ++i) {
        if (+lines[i].getAttribute('data-line') >= status.rowIndexStart) {
          target = lines[i];
          break;
        }
      }
    }
  }
  scroller.scrollTop = 0;
  if (target) {
    // put the line where the terminal's first row is
    var page = this.overlay.querySelector('.jjt-page');
    var top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop = Math.max(0, top - (parseFloat(page.style.paddingTop) || 0));
  }
  this.updateStatus();
  // keep it there while images above finish loading
  requestAnimationFrame(function() { self.updateStatus(); });
};

// Puts the view exactly in the terminal's box: rows 1-23 scroll, the status
// bar sits on row 24, same font, size and columns.
PttReader.prototype.layout = function() {
  if (!this.overlay) return;
  var view = this.app.view;
  var o = this.overlay;
  var page = o.querySelector('.jjt-page');
  var scroller = o.querySelector('.jjt-scroll');
  var chw = view.chw || 10, chh = view.chh || 20;
  var rows = (this.app.buf && this.app.buf.rows) || 24;
  this.lineHeight = chh;
  var r0 = view.mainDisplay.getBoundingClientRect();
  // Relative to the overlay, which a classic window frame (js/frame_style.js)
  // puts over the terminal. Read from its style, not its box: render() lays
  // it out before show(), while it is still display:none and has no box.
  var ocs = getComputedStyle(o);
  var oLeft = parseFloat(ocs.left) || 0, oTop = parseFloat(ocs.top) || 0;
  var rect = { left: r0.left - oLeft, top: r0.top - oTop };
  var ow = parseFloat(ocs.width) || (window.innerWidth - oLeft);
  var gutter = chw * (view.leftGutterCols ? view.leftGutterCols() : 0);
  page.style.fontFamily = getComputedStyle(view.mainDisplay).fontFamily;
  page.style.fontSize = chh + 'px';
  page.style.lineHeight = chh + 'px';
  page.style.width = (chw * 80) + 'px';
  page.style.marginLeft = Math.max(0, rect.left + gutter) + 'px';
  page.style.paddingTop = '0px';
  this.rightSpaceCols = Math.max(0, (ow - (rect.left + gutter) - chw * 80) / chw);
  var boxH = chh * (rows - 1);
  var top = Math.max(0, rect.top);
  if (document.body.classList.contains('jj-mobile')) {
    // phone: the article fills the screen, above the status line and the
    // ◀ / 返回 / ▶ buttons (js/mobile.js)
    top = 0;
    boxH = Math.max(chh * 5, window.innerHeight - chh - JJMobile.READER_BAR_PX);
  }
  scroller.style.marginTop = top + 'px';
  scroller.style.height = boxH + 'px';
  o.style.setProperty('--jj-box-h', boxH + 'px');
  // image height limit (setting, % of the box)
  var pref = this.app.pref;
  var pct = parseInt(pref && pref.values ? pref.values.readerImageMaxPercent : 40, 10);
  if (!(pct >= 10 && pct <= 100)) pct = 40;
  o.style.setProperty('--jj-img-frac', pct / 100);
  this.updateStatus();
};

PttReader.prototype.updateStatus = function() {
  if (!this.overlay) return;
  var s = this.overlay.querySelector('.jjt-scroll');
  var max = s.scrollHeight - s.clientHeight;
  var pct = max > 0 ? Math.round(s.scrollTop / max * 100) : 100;
  var bar = this.overlay.querySelector('.jjt-status');
  bar.innerHTML = '';
  var el = PttReader.el;
  var page = this.overlay.querySelector('.jjt-page');
  bar.style.fontFamily = page.style.fontFamily;
  bar.style.fontSize = page.style.fontSize;
  bar.style.lineHeight = page.style.lineHeight;
  bar.style.width = page.style.width;
  bar.style.marginLeft = page.style.marginLeft;
  bar.appendChild(el('span', 'q15 b4', '  瀏覽 (' + pct + '%) '));
  bar.appendChild(el('span', 'q0 b7 jjt-status-fill', ''));
  var keys = [['(y)', '回應'], ['(X)', '推文'], ['(←)', '離開'], ['(Esc)', '終端機']];
  keys.forEach(function(k) {
    bar.appendChild(el('span', 'q1 b7', k[0]));
    bar.appendChild(el('span', 'q0 b7', k[1]));
  });
  bar.appendChild(el('span', 'q0 b7', ' '));
};

PttReader.prototype.renderPushes = function(article) {
  var el = PttReader.el;
  var self = this;
  var pref = this.app.pref;
  var insights = this.app.pushInsights;
  var geo = insights.geo;
  var T = insights.hintTexts();
  var isBlack = function(id) { return !!(pref && pref.enableBlacklist && pref.isBlacklisted(id)); };
  var hide = pref && pref.hideBlacklisted;
  var watch = (pref && pref.watchlistedUserIds) || {};
  var authorId = String(article.meta['作者'] || '').split(' ')[0].toLowerCase();
  var authorIpMatch = /來自: ((?:\d{1,3}\.){3}\d{1,3})/.exec(article.text);
  var authorIp = authorIpMatch ? authorIpMatch[1] : '';

  var fact = { tags: [], report: [] };
  if (typeof HostingIp !== 'undefined' && !HostingIp.ready && HostingIp.loading && !this.waitHosting) {
    this.waitHosting = true;
    HostingIp.loading.then(function() { if (HostingIp.ready && self.isOpen()) self.rerender(); });
  }
  if (this.app.factCheck) {
    try { fact = this.app.factCheck.analyze(article); } catch (e) { console.log('fact check', e); }
  }
  this.factReport = fact.report;

  var idsByIp = {}, countById = {};
  article.pushes.forEach(function(p) {
    var id = p.id.toLowerCase();
    countById[id] = (countById[id] || 0) + 1;
    if (p.ip) (idsByIp[p.ip] = idsByIp[p.ip] || {})[id] = true;
  });

  var urlJoins = PttReader.urlJoins(article);
  var result = [];
  var nth = {};
  var repeatColors = {};
  article.pushes.forEach(function(p, i) {
    var id = p.id.toLowerCase();
    nth[id] = (nth[id] || 0) + 1;
    var blackListed = isBlack(id);
    if (blackListed && hide && pref.hidesBlacklisted(id)) return;
    var wrap = document.createDocumentFragment();

    var hints = [];
    var tags = [];
    var level = '';
    var parts = [];
    var asFlag = self.app.view.ipAsFlag && self.app.view.ipAsFlag();
    var flag = '';
    if (p.ip && geo.ready) {
      var cc = geo.lookup(p.ip);
      if (cc) {
        if (asFlag) flag = PushInsights.flagEmoji(cc);
        else parts.push(insights.countryLabel(cc));
        if (cc !== 'TW') level = 'foreign';
      }
    }
    if (p.ip) {
      var others = Object.keys(idsByIp[p.ip] || {}).filter(function(x) { return x !== id; });
      if (others.length && pref.values.factSameIp !== false) {
        hints.push(T.sameIp + ':' + others.slice(0, 2).join(',') + (others.length > 2 ? '等' + others.length + '人' : ''));
        tags.push(T.sameIp);
        level = 'warn';
      }
      if (authorIp && p.ip === authorIp && id !== authorId && pref.values.factAuthorIp !== false) {
        hints.push(T.authorIp);
        tags.push(T.authorIp);
        level = 'warn';
      }
    }
    if (id in watch && pref.values.watchlistEnabled !== false) {
      hints.push(T.watch + (watch[id] ? ':' + watch[id] : ''));
      tags.push(T.watch);
      if (level !== 'warn') level = 'watch';
    }
    (fact.tags[i] || []).forEach(function(t) {  // 真.事實查核 rules
      if (t.lvl === 'grey') {  // weak hint: plain text, no ⚠
        parts.push(t.t);
        return;
      }
      hints.push(t.t);
      tags.push(t.t);
      if (t.lvl === 'warn') level = 'warn';
      else if (!level || level === 'foreign') level = 'watch';
    });
    var notes = (pref && pref.values.customListEnabled !== false && pref.notedUserIds) || {};
    if (id in notes) {  // the user's own named list (網軍 by default)
      parts.push(pref.customListName() + (notes[id] ? ':' + notes[id] : ''));
      if (!level || level === 'foreign') level = 'note';
    }
    var full = parts.concat(hints.length ? [(T.prefix ? T.prefix + ' ' : '') + hints.join(' ')] : []).join(' ');
    var label = insights.fitLabel(full, parts, hints, T, self.rightSpaceCols);

    // "推 userid: content          ip mm/dd hh:mm" in PTT colours
    var faded = blackListed || !!(pref && pref.fadesNoted && pref.fadesNoted(id));
    var line = el('div', 'jjt-line jjt-push' + (faded ? ' jjt-faded' : ''));
    line.setAttribute('data-user', id);
    PushInsights.setRepeatColor(line, insights.repeatColor(repeatColors, id, countById[id]));
    var left = el('span', 'jjt-push-left');
    left.appendChild(el('span', p.tag === '推' ? 'q15 b0' : 'q9 b0', p.tag + ' '));
    var who = insights.whoLevel ? insights.whoLevel(id) : '';
    var idEl = el('span', 'q11 b0', p.id);
    if (who) {
      var w = el('span', 'jj-who jj-who-' + who, p.id);
      idEl.textContent = '';
      idEl.appendChild(w);
    }
    left.appendChild(idEl);
    var join = urlJoins[i];
    var content = self.lineNode(PttReader.pushSegs(p.content, join, { fg: 3, bg: 0, hl: false, href: '' }, ':'));
    var c = content.node;
    while (c.firstChild) left.appendChild(c.firstChild);
    line.appendChild(left);
    var right = el('span', 'q7 b0 jjt-push-right', ' ');
    if (asFlag && full) {  // notes in front of the flag
      right.appendChild(el('span', 'jjt-itag jjt-itag-' + (level || 'none'), full + ' '));
    }
    right.appendChild(document.createTextNode([asFlag ? flag : p.ip, p.time].filter(Boolean).join(' ')));
    line.appendChild(right);
    line.setAttribute('data-jj-floor', (i + 1) + '樓');
    if (label && !asFlag) line.setAttribute('data-jj', label);
    line.setAttribute('title', ((i + 1) + '樓 ' + full).trim());
    if (level) line.setAttribute('data-jj-level', level);
    wrap.appendChild(line);
    result[i] = { line: line, frag: wrap };
    // images posted in pushes, and whatever a URL cut in two by PTT shows
    content.urls.forEach(function(u) {
      if (blackListed || id in notes) return;  // no thumbnails for blacklisted or custom-list users
      if (!PttReader.pushMedia(u, join)) return;
      var media = self.linkBlock(u, true, true);
      media.className += ' jjt-push-media';
      wrap.appendChild(media);
    });
  });
  return result;
};
