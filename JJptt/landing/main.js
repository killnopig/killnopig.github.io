/* JJptt 廣宣頁：進場動畫、終端機推文逐條出現、FACT 環形圖、示意畫面輪播
 * 不呼叫任何 API；開啟「減少動態」時直接顯示最後狀態 */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* 頂端列：捲動後加底線 */
  const top = $('#top');
  const onScroll = () => top.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* 進場：看到才出現；開頭的終端機看到後推文逐條出現 */
  const term = $('#heroTerm');
  const io = 'IntersectionObserver' in window && !reduce ? new IntersectionObserver(entries => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add('in');
      if (en.target === term) term.classList.add('go');
      io.unobserve(en.target);
    }
  }, { threshold: .18, rootMargin: '0px 0px -40px 0px' }) : null;
  const watch = $$('.reveal');
  if (io) watch.forEach(el => io.observe(el));
  else { watch.forEach(el => el.classList.add('in')); if (term) term.classList.add('go'); }

  /* FACT 環形圖：節點依序亮起，點節點看說明 */
  const STEPS = [
    ['推文進來', '打開文章，推文照樣一則一則看，不用另外做什麼。'],
    ['標出疑點', '秒推、同網段、機房 IP、罐頭推文，直接標在推文旁邊。'],
    ['問 AI', '整篇一鍵丟給 AI，或選一段文字問「這是不是事實？」'],
    ['你來判斷', '被標記不等於網軍。標錯了一鍵移除，規則都能自己調。'],
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
    if (reduce || !('IntersectionObserver' in window)) show(STEPS.length - 1);
    else {
      show(0);
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
})();
