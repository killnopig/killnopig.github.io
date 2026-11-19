// JJptt on phones: a board's article list, and loading articles.
// Part of JJMobile (js/mobile.js).

// ---- board: article list ------------------------------------------------------------

// A link on a board page: www.ptt.cc's are site paths, the ones made from
// the BBS screen (PTT's web site down, JJPtt.indexHtml) are jjterm: addresses.
JJMobile.webUrl = function(href) {
  return /^(?:https?|jjterm):/.test(href) ? href : JJMobile.WEB + href;
};

// "https://www.ptt.cc/bbs/Gossiping/index.html" etc. -> entries, newest first.
JJMobile.parseIndex = function(doc, newestFirst) {
  var out = [];
  var pinned = false;
  var nodes = doc.querySelectorAll('.r-list-container > div');
  for (var i = 0; i < nodes.length; ++i) {
    var n = nodes[i];
    if (n.classList.contains('r-list-sep')) { pinned = true; continue; }
    if (!n.classList.contains('r-ent')) continue;
    var a = n.querySelector('.title a');
    out.push({
      title: ((a || n.querySelector('.title')) || {}).textContent.trim(),
      url: a ? JJMobile.webUrl(a.getAttribute('href')) : '',
      author: ((n.querySelector('.meta .author') || {}).textContent || '').trim(),
      date: ((n.querySelector('.meta .date') || {}).textContent || '').trim(),
      nrec: ((n.querySelector('.nrec') || {}).textContent || '').trim(),
      pinned: pinned
    });
  }
  var older = '';
  var links = doc.querySelectorAll('.btn-group-paging a');
  for (var k = 0; k < links.length; ++k) {
    if (/上頁/.test(links[k].textContent) && links[k].getAttribute('href')) older = JJMobile.webUrl(links[k].getAttribute('href'));
  }
  var board = ((doc.querySelector('#topbar .board') || {}).textContent || '').replace(/^\s*看板\s*/, '').trim();
  var normal = out.filter(function(e) { return !e.pinned; });
  var pins = out.filter(function(e) { return e.pinned; });
  if (newestFirst) normal.reverse();
  return { entries: normal, pinned: pins, older: older, board: board };
};

JJMobile.prototype.renderBoard = function(screen) {
  var self = this;
  var el = JJMobile.el;
  var v = screen.view;
  var q = screen.query || '';
  var qLabel = /^author:/.test(q) ? '作者 ' + q.slice(7) : /^recommend:/.test(q) ? JJMobile.pushQueryLabel(q.slice(10)) : q;
  screen.title = screen.board + (q ? ' · ' + qLabel : '');
  this.titleEl.textContent = screen.title;
  this.fitBar();
  screen.entries = [];
  screen.listNode = el('div', 'jjm-list jjm-articles');
  v.appendChild(screen.listNode);
  var more = el('div', 'jjm-more');
  v.appendChild(more);
  var url = JJMobile.WEB + '/bbs/' + encodeURIComponent(screen.board) +
    (screen.query ? '/search?q=' + encodeURIComponent(screen.query) : '/index.html');
  screen.older = url;
  screen.loadingMore = false;

  var loadMore = function() {
    if (screen.loadingMore || !screen.older) return;
    screen.loadingMore = true;
    more.textContent = '載入中…';
    var first = !screen.entries.length;
    self.app.reader.fetchDoc(screen.older).then(function(doc) {
      // board index pages run oldest -> newest; search results come newest first
      var page = JJMobile.parseIndex(doc, !screen.query);
      if (page.board && first && !screen.query) {
        screen.board = page.board;
        screen.title = page.board;
        if (self.stack[self.stack.length - 1] === screen) self.setBar(screen);
      }
      screen.older = page.older;
      if (first && doc.jjFromTerm) {
        v.insertBefore(el('div', 'jjm-hint jjm-term-note', 'PTT 網頁版現在故障，改用 BBS 連線讀取'), screen.listNode);
      }
      // 置底公告, unless hidden (設定 → 一般; the extension's hidePinned)
      var pv2 = (self.app.pref && self.app.pref.values) || {};
      if (first && page.pinned.length && !pv2.hidePinned) {
        page.pinned.forEach(function(e) { self.appendEntry(screen, e); });
      }
      page.entries.forEach(function(e) { self.appendEntry(screen, e); });
      more.textContent = screen.older ? '' : (screen.entries.length ? '沒有更早的文章了' : '沒有文章');
      screen.loadingMore = false;
      if (first) self.prefetchList(screen, 0);
      // a short first page: keep going until the screen is full
      if (screen.older && v.scrollHeight <= v.clientHeight + 200) loadMore();
    }).catch(function(err) {
      screen.loadingMore = false;
      more.textContent = '';
      self.failed(more, err, function() { more.innerHTML = ''; loadMore(); });
    });
  };
  screen.loadMore = loadMore;
  v.addEventListener('scroll', function() {
    if (v.scrollTop + v.clientHeight > v.scrollHeight - 600) loadMore();
  });
  loadMore();
};

JJMobile.prototype.hiddenEntry = function(e) {
  var pref = this.app.pref;
  if (!pref) return '';
  var black = pref.enableBlacklist && e.author && pref.isBlacklisted(e.author);
  var kw = (pref.titleKeywords || []).some(function(k) { return k && e.title.indexOf(k) >= 0; });
  if (!black && !kw) return '';
  // only the automatic blacklist: faded, never hidden
  if (!kw && !pref.hidesBlacklisted(e.author)) return 'fade';
  return pref.hideBlacklisted ? 'hide' : 'fade';
};

JJMobile.prototype.appendEntry = function(screen, e) {
  var self = this;
  var el = JJMobile.el;
  var hidden = this.hiddenEntry(e);
  if (hidden === 'hide') return;
  var index = screen.entries.length;
  screen.entries.push(e);
  var row = el('button', 'jjm-row jjm-article');
  row.type = 'button';
  if (hidden) row.classList.add('jjm-faded');
  if (e.pinned) row.classList.add('jjm-pinned');
  if (!e.url) row.classList.add('jjm-deleted');
  var top = el('div', 'jjm-article-title', e.title);
  row.appendChild(top);
  var meta = el('div', 'jjm-article-meta');
  var nrec = this.nrecBadge(e.nrec);
  if (nrec) meta.appendChild(nrec);
  if (e.pinned) meta.appendChild(el('span', 'jjm-tag', '置底'));
  var who = el('span', 'jjm-author', e.author);
  e.who = who;
  this.styleAuthor(e);
  // the author's lists (黑名單, 觀察名單, 自訂名單) without copying the ID:
  // hold the row (a tap on the ID opened it too easily while opening articles)
  if (e.author) {
    row.addEventListener('contextmenu', function(ev) {
      ev.preventDefault();
      self.userSheet(e.author, screen);
    });
  }
  meta.appendChild(who);
  meta.appendChild(el('span', 'jjm-date', e.date));
  row.appendChild(meta);
  if (e.url && this.readUrls && this.readUrls[e.url]) row.classList.add('jjm-read');
  e.row = row;
  JJMobile.tap(row, function() {
    if (!e.url) return;
    self.open({ type: 'article', url: e.url, list: screen, index: index, title: screen.board });
  });
  screen.listNode.appendChild(row);
};

JJMobile.prototype.styleAuthor = function(e) {
  var pref = this.app.pref;
  var id = String(e.author || '').toLowerCase();
  e.who.classList.toggle('jjm-watch', !!(pref && id && pref.watchlistedUserIds && id in pref.watchlistedUserIds));
  e.who.classList.toggle('jjm-noted', !!(pref && id && pref.notedUserIds && id in pref.notedUserIds));
};

// After a list change from the article list: fade / hide / colour the rows
// again without reloading.
JJMobile.prototype.restyleList = function(screen) {
  var self = this;
  (screen.entries || []).forEach(function(e) {
    if (!e.row) return;
    var hidden = self.hiddenEntry(e);
    e.row.classList.toggle('jjm-faded', hidden === 'fade');
    e.row.style.display = hidden === 'hide' ? 'none' : '';
    if (e.who) self.styleAuthor(e);
  });
};

// 推文數 the way PTT colours it: 爆 red, 10+ yellow, 1-9 green, X (噓) grey
JJMobile.prototype.nrecBadge = function(n) {
  if (!n) return null;
  var cls = 'jjm-nrec';
  if (n === '爆') cls += ' jjm-nrec-hot';
  else if (/^X/.test(n)) cls += ' jjm-nrec-boo';
  else if (+n >= 10) cls += ' jjm-nrec-10';
  else cls += ' jjm-nrec-1';
  return JJMobile.el('span', cls, n);
};

JJMobile.prototype.markRead = function(screen) {
  var read = this.readUrls || {};
  screen.entries.forEach(function(e) { if (e.row && read[e.url]) e.row.classList.add('jjm-read'); });
};

// [推文數, label, what the button shows instead of the label (PTT's own
// marks: 爆 in a red dot, a grey XX; 止爆 -- 推 ≥ 200 -- a purple 爆)]
JJMobile.QUICK_PUSH = [[20, '推 ≥ 20'], [100, '爆文', '爆', 'jjm-quick-hot'], [200, '止爆', '爆', 'jjm-quick-hot jjm-quick-stop'],
  [-100, '噓爆', 'XX', 'jjm-quick-boo']];

// 推文數 search in the title: 爆文 / 噓爆 / 推 ≥ N / 噓 ≥ N
JJMobile.pushQueryLabel = function(n) {
  n = parseInt(n, 10);
  if (n >= 100) return n === 100 ? '爆文' : n === 200 ? '止爆' : '推 ≥ ' + n;
  if (n <= -100) return n === -100 ? '噓爆' : '噓 ≥ ' + (-n);
  return n < 0 ? '噓 ≥ ' + (-n) : '推 ≥ ' + n;
};

JJMobile.prototype.searchSheet = function(screen) {
  var self = this;
  var el = JJMobile.el;
  var box = el('form', 'jjm-sheet-form');
  var kinds = [['', '標題'], ['author:', '作者'], ['recommend:', '推文數 ≥']];
  // 設定 → 搜尋: open on 推文數 with the usual number filled in
  var pv = (this.app.pref && this.app.pref.values) || {};
  var pushN = parseInt(pv.pushFilterDefault, 10);
  if (isNaN(pushN) || pushN === 0) pushN = 10;  // negative: 噓文 (recommend:-10)
  var byPush = JJMobile.store(JJMobile.SEARCH_PUSH_KEY) !== false;
  var kind = byPush ? 'recommend:' : '';
  var chips = el('div', 'jjm-chips');
  var input = el('input');
  input.type = 'search';
  input.placeholder = '搜尋標題';
  input.setAttribute('enterkeyhint', 'search');
  kinds.forEach(function(k) {
    var c = JJMobile.button('jjm-chip' + (k[0] === kind ? ' jjm-on' : ''), k[1], function() {
      kind = k[0];
      Array.prototype.forEach.call(chips.children, function(x) { x.classList.remove('jjm-on'); });
      c.classList.add('jjm-on');
      input.placeholder = kind === 'author:' ? '作者帳號' : kind === 'recommend:' ? '例如 50' : '搜尋標題';
      input.type = kind === 'recommend:' ? 'number' : 'search';
      input.value = kind === 'recommend:' ? String(pushN) : '';
      input.focus();
    });
    chips.appendChild(c);
  });
  box.appendChild(chips);
  if (kind === 'recommend:') {
    input.type = 'number';
    input.placeholder = '例如 50';
    input.value = String(pushN);
  }
  box.appendChild(input);
  // one tap: the usual 推文數 searches (爆 = 100 推, 噓爆 = 噓比推多 100)
  var quick = el('div', 'jjm-chips jjm-quick');
  JJMobile.QUICK_PUSH.forEach(function(qk) {
    var b = JJMobile.button('jjm-chip', qk[2] ? '' : qk[1], function() {
      self.closeSheet();
      self.open({ type: 'board', board: screen.board, query: 'recommend:' + qk[0] });
    });
    if (qk[2]) {
      b.appendChild(el('span', qk[3], qk[2]));
      b.setAttribute('aria-label', qk[1]);
    }
    quick.appendChild(b);
  });
  box.appendChild(quick);
  box.appendChild(el('button', 'jjm-btn jjm-btn-main', '搜尋'));
  box.addEventListener('submit', function(e) {
    e.preventDefault();
    var q = input.value.trim();
    if (!q) return;
    self.closeSheet();
    self.open({ type: 'board', board: screen.board, query: kind + q });
  });
  this.showSheet('在 ' + screen.board + ' 搜尋', box);
  setTimeout(function() { input.focus(); }, 50);
};

// ---- loading articles (with the cache that makes the next one instant) -----------

// onPartial(article so far, page, pages): while www.ptt.cc is down and the
// article is read on the BBS page by page -- also when a read ahead of it
// is already under way. bg: reading ahead (gives way to the others).
JJMobile.prototype.getArticle = function(url, onPartial, bg) {
  var c = this.articles[url];
  var self = this;
  if (c && Date.now() - c.at < JJMobile.CACHE_MS) {
    if (!onPartial) return c.promise;
    c.listener = onPartial;
    if (c.last) onPartial.apply(null, c.last);
    // a read ahead that gave way to something else: read it now
    return c.promise.catch(function(err) {
      if (!(err && err.yielded)) throw err;
      return self.getArticle(url, onPartial);
    });
  }
  var entry = { at: Date.now(), listener: onPartial || null, last: null };
  var p = this.app.reader.fetchArticle(url, {
    bg: !!bg,
    onPartial: function(a, i, n) {
      entry.last = [a, i, n];
      if (entry.listener) entry.listener(a, i, n);
    }
  });
  entry.promise = p;
  p.then(function() { entry.at = Date.now(); }, function() {});  // how old its pushes are
  this.articles[url] = entry;
  p.catch(function() { if (self.articles[url] === entry) delete self.articles[url]; });
  var keys = Object.keys(this.articles);
  if (keys.length > 80) delete this.articles[keys[0]];
  return p;
};

// How many articles to load ahead (設定 → 閱讀模式預先讀取上下幾篇).
JJMobile.prototype.aheadCount = function() {
  var pref = this.app.pref;
  var n = parseInt(pref && pref.values ? pref.values.readerPrefetchCount : 3, 10);
  return isNaN(n) ? 3 : Math.max(0, Math.min(20, n));
};

// Loads the next few articles of a list, two at a time; their pictures too
// when 預先讀取時連圖片一起下載 is on.
JJMobile.prototype.prefetchList = function(screen, from) {
  var self = this;
  // www.ptt.cc down: each is read on the BBS, one at a time, and gives way
  // as soon as the user opens something else; a few only
  var down = PttReader.webRecentlyDown('article');
  var ptt = this.app.reader && this.app.reader.termSource();
  if (down && !(ptt && ptt.user)) return;
  var n = down ? Math.min(3, this.aheadCount()) : this.aheadCount() * 2;
  var todo = screen.entries.slice(from, from + n).filter(function(e) { return e.url && (down || !JJPtt.isTermUrl(e.url)); });
  var token = this.prefetchToken = {};
  var next = function() {
    if (self.prefetchToken !== token) return;  // another list or article since
    var e = todo.shift();
    if (!e) return;
    self.getArticle(e.url, null, true).then(function(a) {
      self.app.reader.preloadMedia(a);
    }, function() {}).then(next);
  };
  next();
  if (!down) next();
};
