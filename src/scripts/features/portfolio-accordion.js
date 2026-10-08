(function () {
  const accordions = document.querySelectorAll('[data-portfolio-accordion]');

  accordions.forEach((accordion) => {
    const items = Array.from(accordion.querySelectorAll('[data-portfolio-item]'));
    const buttons = items.map((item) => item.querySelector('[data-portfolio-card]'));
    const liveRegion = accordion.querySelector('[data-portfolio-live]');

    if (items.length < 2 || buttons.some((button) => !button)) {
      return;
    }

    let activeIndex = Math.max(0, items.findIndex((item) => item.classList.contains('is-active')));
    let scrollToken = 0;
    accordion.classList.add('is-enhanced');

    function keepActiveCardInView(token) {
      if (!window.matchMedia('(max-width: 759px)').matches) {
        return;
      }

      window.setTimeout(() => {
        if (token !== scrollToken) {
          return;
        }

        const bounds = items[activeIndex].getBoundingClientRect();
        if (bounds.top < 24 || bounds.bottom > window.innerHeight - 16) {
          const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          window.scrollTo({
            top: Math.max(0, window.scrollY + bounds.top - 24),
            behavior: reduceMotion ? 'auto' : 'smooth'
          });
        }
      }, 520);
    }

    function activate(index, announce = true) {
      activeIndex = (index + items.length) % items.length;
      const token = ++scrollToken;

      items.forEach((item, itemIndex) => {
        const active = itemIndex === activeIndex;
        const panel = item.querySelector('.portfolio-tab__panel');
        item.classList.toggle('is-active', active);
        buttons[itemIndex].setAttribute('aria-expanded', String(active));

        if (panel) {
          panel.setAttribute('aria-hidden', String(!active));
        }
      });

      if (announce && liveRegion) {
        const title = items[activeIndex].querySelector('.portfolio-tab__title');
        liveRegion.textContent = title
          ? 'Выбрано направление: ' + title.textContent.trim()
          : 'Направление ' + (activeIndex + 1) + ' из ' + items.length;
        keepActiveCardInView(token);
      }
    }

    buttons.forEach((button, index) => {
      button.addEventListener('click', () => activate(index));
      button.addEventListener('keydown', (event) => {
        let nextIndex = null;

        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          nextIndex = (index + 1) % items.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          nextIndex = (index - 1 + items.length) % items.length;
        } else if (event.key === 'Home') {
          nextIndex = 0;
        } else if (event.key === 'End') {
          nextIndex = items.length - 1;
        }

        if (nextIndex === null) {
          return;
        }

        event.preventDefault();
        activate(nextIndex);
        buttons[nextIndex].focus({ preventScroll: true });
      });
    });

    activate(activeIndex, false);
  });
})();
