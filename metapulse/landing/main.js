/* MetaPulse 廣宣頁：進場動畫、MetaPulse 循環、示意畫面輪播、數字跳動
 * 不呼叫任何 API；開啟「減少動態」時直接顯示最後狀態 */
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  /* 頂端列：捲動後加底線 */
  const top = $('#top');
  const onScroll = () => top.classList.toggle('scrolled', scrollY > 8);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  /* 首屏的大按鈕看得到時，頂列不重複放按鈕；捲過去才淡入 */
  const heroCta = $('.hero .cta');
  if (heroCta && 'IntersectionObserver' in window) new IntersectionObserver(([e]) => top.classList.toggle('btns-on', !e.isIntersecting)).observe(heroCta);
  else top.classList.add('btns-on');

  /* 心得超過兩段：先顯示兩段，按「看全文」展開 */
  $$('.voice').forEach(v => {
    const ps = $$('blockquote p', v); if (ps.length <= 2) return;
    v.classList.add('clip');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'voice-more'; b.textContent = '看全文';
    b.addEventListener('click', () => { v.classList.toggle('clip', false); b.hidden = true; });
    $('blockquote', v).after(b);
  });

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

  /* MetaPulse 循環：一次只展開一站 */
  const stations = $$('.loop-list details');
  stations.forEach(d => d.addEventListener('toggle', () => { if (d.open) stations.forEach(o => { if (o !== d) o.open = false; }); }));

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
