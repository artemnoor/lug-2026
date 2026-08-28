// ==========================================================================
// ГОРИЗОНТАЛЬНЫЙ ТАЙМЛАЙН: 4 КАРТОЧКИ ЭТАПОВ (СЕКЦИЯ 3)
// ==========================================================================
(function initProcessTimeline() {
  const container = document.querySelector('.timeline-cards-grid');
  if (!container) return;

  const cards = container.querySelectorAll('.timeline-card');
  if (!cards.length) return;
  const timeOrbit = container.closest('.stage-process')?.querySelector('.process-time-orbit');

  // Плавное появление карточек при попадании в зону видимости
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          timeOrbit?.classList.add('is-visible');
          cards.forEach((card, index) => {
            setTimeout(() => {
              card.classList.add('is-visible');
            }, index * 100);
          });
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.15,
      rootMargin: '0px 0px -5% 0px'
    });

    observer.observe(container);
  } else {
    timeOrbit?.classList.add('is-visible');
    cards.forEach(card => card.classList.add('is-visible'));
  }

  // Поддержка плавного скролла перетаскиванием (drag-to-scroll) на десктопе при переполнении
  let isDown = false;
  let startX;
  let scrollLeft;

  container.addEventListener('mousedown', (e) => {
    // Не инициировать drag при клике на ссылки
    if (e.target.closest('a')) return;
    isDown = true;
    container.classList.add('is-dragging');
    startX = e.pageX - container.offsetLeft;
    scrollLeft = container.scrollLeft;
  });

  window.addEventListener('mouseup', () => {
    isDown = false;
    container.classList.remove('is-dragging');
  });

  container.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX - container.offsetLeft;
    const walk = (x - startX) * 1.5;
    container.scrollLeft = scrollLeft - walk;
  });
})();
