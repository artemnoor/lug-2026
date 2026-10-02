(function () {
  const carousels = document.querySelectorAll('[data-portfolio-carousel]');

  carousels.forEach((carousel) => {
    const cards = Array.from(carousel.querySelectorAll('[data-portfolio-card]'));
    const dots = Array.from(carousel.querySelectorAll('[data-portfolio-to]'));
    const previousButton = carousel.querySelector('[data-portfolio-prev]');
    const nextButton = carousel.querySelector('[data-portfolio-next]');
    const liveRegion = carousel.querySelector('[data-portfolio-live]');

    if (cards.length < 2 || dots.length !== cards.length || !previousButton || !nextButton) {
      return;
    }

    let activeIndex = 0;
    let motionResetToken = 0;
    carousel.classList.add('is-enhanced');

    function showCard(index, instant = false) {
      if (instant) {
        carousel.dataset.motion = 'instant';
      } else {
        motionResetToken += 1;
        carousel.removeAttribute('data-motion');
      }

      activeIndex = (index + cards.length) % cards.length;

      const previousIndex = (activeIndex - 1 + cards.length) % cards.length;
      const nextIndex = (activeIndex + 1) % cards.length;

      cards.forEach((card, cardIndex) => {
        const position = cardIndex === activeIndex
          ? 'active'
          : cardIndex === previousIndex
            ? 'previous'
            : cardIndex === nextIndex
              ? 'next'
              : 'hidden';

        card.dataset.position = position;
        card.setAttribute('aria-hidden', String(position !== 'active'));
      });

      dots.forEach((dot, dotIndex) => {
        dot.setAttribute('aria-current', String(dotIndex === activeIndex));
      });

      if (liveRegion) {
        const title = cards[activeIndex].querySelector('.portfolio-card__title');
        liveRegion.textContent = title
          ? `Направление ${activeIndex + 1} из ${cards.length}: ${title.textContent.trim()}`
          : `Направление ${activeIndex + 1} из ${cards.length}`;
      }

      if (instant) {
        const resetToken = ++motionResetToken;
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (resetToken === motionResetToken) {
              carousel.removeAttribute('data-motion');
            }
          });
        });
      }
    }

    previousButton.addEventListener('click', (event) => showCard(activeIndex - 1, event.detail === 0));
    nextButton.addEventListener('click', (event) => showCard(activeIndex + 1, event.detail === 0));

    dots.forEach((dot) => {
      dot.addEventListener('click', (event) => {
        const targetIndex = Number(dot.dataset.portfolioTo);
        if (Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < cards.length) {
          showCard(targetIndex, event.detail === 0);
        }
      });
    });

    cards.forEach((card, cardIndex) => {
      card.addEventListener('click', (event) => {
        if (cardIndex !== activeIndex) {
          showCard(cardIndex, event.detail === 0);
        }
      });
    });

    carousel.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        showCard(activeIndex - 1, true);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        showCard(activeIndex + 1, true);
      }
    });

    // Apply the first carousel state without animating the four-card grid out
    // of its initial layout. Otherwise all cards briefly pile up on load.
    showCard(activeIndex, true);
  });
})();
