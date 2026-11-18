/* MetaPulse 廣宣頁：進場動畫、正循環環形圖、示意畫面輪播、數字跳動
 * 不呼叫任何 API；開啟「減少動態」時直接顯示最後狀態 */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* 頂端列：捲動後加底線 */
  const top = $('#top');
  const onScroll = () => top.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* 「了解怎麼運作」：平滑捲動並把焦點移過去 */
  $$('[data-scroll]').forEach(a => a.addEventListener('click', e => {
    const t = $(a.getAttribute('href')); if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    t.setAttribute('tabindex', '-1'); t.focus({ preventScroll: true });
  }));

  /* 數字跳動 */
  function count(el) {
    const end = parseFloat(el.dataset.count), dec = +el.dataset.dec || 0;
    if (reduce) { el.textContent = end.toFixed(dec); return; }
    const t0 = performance.now(), dur = 1100;
    const step = now => {
      const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = (end * e).toFixed(dec);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* 進場：看到才出現 */
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      const el = en.target;
      el.classList.add('in');
      $$('[data-count]', el).forEach(count);
      if (el.id === 'tl') $$('li', el).forEach((li, i) => setTimeout(() => li.classList.add('in'), reduce ? 0 : i * 260));
      io.unobserve(el);
    }
  }, { threshold: .18, rootMargin: '0px 0px -40px 0px' }) : null;
  const watch = [...$$('.reveal'), $('#tl')].filter(Boolean);
  if (io && !reduce) {
    // 先把數字歸零，進場時再跳
    $$('[data-count]').forEach(el => { el.textContent = (0).toFixed(+el.dataset.dec || 0); });
    watch.forEach(el => io.observe(el));
  } else {
    watch.forEach(el => el.classList.add('in'));
    $$('#tl li').forEach(li => li.classList.add('in'));
  }

  /* 正循環：節點依序亮起，點節點看說明 */
  const STEPS = [
    ['記錄', '拍照或打字記下每一餐，記錄體重與血壓。'],
    ['點數', '每餐換算成估算點數，用一週的額度來看，不用每天斤斤計較。'],
    ['節奏', '斷食計時與進食窗口，找到自己適合的時間安排。'],
    ['趨勢', '用 7 天平均看長期變化，不被單日數字左右。'],
    ['調整', '看週報，自己決定下週要怎麼調整。'],
  ];
  const ring = $('#ring');
  if (ring) {
    const nodes = $$('.node', ring), lit = $('#lit'), center = $('#ringCenter'), C = 942.5;
    let cur = 0, timer = null;
    const show = i => {
      cur = i;
      nodes.forEach((n, j) => { n.classList.toggle('on', j <= i); n.classList.toggle('cur', j === i); n.setAttribute('aria-pressed', j === i ? 'true' : 'false'); });
      lit.style.strokeDashoffset = String(C * (1 - (i + 1) / STEPS.length));
      center.innerHTML = '';
      const k = document.createElement('span'); k.className = 'k'; k.textContent = 'STEP ' + (i + 1);
      const h = document.createElement('h3'); h.textContent = STEPS[i][0];
      const p = document.createElement('p'); p.textContent = STEPS[i][1];
      center.append(k, h, p);
      if (!reduce) { center.classList.remove('swap'); void center.offsetWidth; center.classList.add('swap'); }
    };
    const stop = () => { clearInterval(timer); timer = null; };
    nodes.forEach(n => n.addEventListener('click', () => { stop(); show(+n.dataset.i); }));
    if (reduce) show(STEPS.length - 1);
    else {
      show(0);
      // 看到環形圖才開始輪流亮
      const ro = new IntersectionObserver(es => {
        if (es[0].isIntersecting && !timer) timer = setInterval(() => show((cur + 1) % STEPS.length), 2600);
        else if (!es[0].isIntersecting) stop();
      }, { threshold: .35 });
      ro.observe(ring);
      ring.addEventListener('pointerenter', stop);
    }
  }

  /* 示意畫面輪播 */
  const slides = $$('.slide'), dots = $$('.dots button'), label = $('#dotsLabel');
  if (slides.length) {
    let si = 0, st = null;
    const go = i => {
      si = (i + slides.length) % slides.length;
      slides.forEach((s, j) => s.classList.toggle('on', j === si));
      dots.forEach((d, j) => d.setAttribute('aria-current', j === si ? 'true' : 'false'));
      if (label) label.textContent = dots[si].getAttribute('aria-label');
    };
    const play = () => { if (!reduce && !st) st = setInterval(() => go(si + 1), 4500); };
    const pause = () => { clearInterval(st); st = null; };
    dots.forEach((d, j) => d.addEventListener('click', () => { pause(); go(j); }));
    const phone = $('#phone');
    phone.addEventListener('pointerenter', pause); phone.addEventListener('pointerleave', play);
    phone.addEventListener('focusin', pause);
    play();
  }

  /* 停用的 Android 按鈕：按了不做任何事 */
  $$('[aria-disabled=true]').forEach(b => b.addEventListener('click', e => e.preventDefault()));
})();
