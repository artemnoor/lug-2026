/**
 * Главный модуль инициализации сайта «Лучшая учебная группа»
 * МГТУ им. Н.Э. Баумана
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('App initialized successfully');
});

// Декоративные звёзды появляются только в зоне видимости, не мешая чтению.
(function initSectionStars(){
  const stars = [...document.querySelectorAll('.section-star')];
  if (!stars.length) return;

  const reveal = (star, index) => {
    window.setTimeout(() => star.classList.add('is-visible'), index * 120);
  };

  if ((window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || !('IntersectionObserver' in window)) {
    stars.forEach((star) => star.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const sectionStars = [...entry.target.querySelectorAll('.section-star')];
      sectionStars.forEach(reveal);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });

  [...new Set(stars.map((star) => star.closest('.stage')))].filter(Boolean).forEach((section) => observer.observe(section));
})();

// Главная страница: каждая крупная секция мягко входит в кадр при прокрутке.
// Класс добавляется только здесь, поэтому личный кабинет и служебные страницы
// остаются без этой анимации.
(function initHomepageSectionReveal(){
  if (!document.body.classList.contains('public-page')) return;

  const blocks = [
    ...document.querySelectorAll('body.public-page > .stage, body.public-page > .marquee-wave-section, body.public-page > .rules-preview')
  ];
  if (!blocks.length) return;

  const reveal = (block, delay = 0) => {
    block.style.setProperty('--home-reveal-delay', `${delay}ms`);
    block.classList.add('is-revealed');
  };
  const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  blocks.forEach((block) => block.classList.add('home-reveal'));

  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    blocks.forEach((block) => reveal(block));
    return;
  }

  const hero = blocks[0];
  // Two frames ensure the browser records the initial state before the reveal.
  requestAnimationFrame(() => requestAnimationFrame(() => reveal(hero, 40)));

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      reveal(entry.target, 40);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.08, rootMargin: '0px 0px -7% 0px' });

  blocks.slice(1).forEach((block) => observer.observe(block));

  // The reveal is decorative only. If a browser restores a deep scroll,
  // resizes during startup, or misses an observer callback, never leave a
  // real section hidden indefinitely.
  window.setTimeout(() => {
    blocks.forEach((block) => {
      if (!block.classList.contains('is-revealed')) reveal(block);
    });
  }, 1600);
})();
