(function initMobileMenu() {
  var menu = document.querySelector('[data-modal-menu="mob"]');
  var trigger = document.querySelector('[data-modal-menu-btn="mob"]');

  if (!menu || !trigger) return;

  var isOpen = false;
  var previousBodyOverflow = '';
  var inertSiblings = [];
  var menuBackground = menu.querySelector('.modal_bg');

  function setBackgroundInert(nextState) {
    if (nextState) {
      inertSiblings = Array.from(document.body.children)
        .filter(function (element) { return element !== menu; })
        .map(function (element) {
          return { element: element, wasInert: element.inert };
        });
      inertSiblings.forEach(function (item) { item.element.inert = true; });
      return;
    }

    inertSiblings.forEach(function (item) { item.element.inert = item.wasInert; });
    inertSiblings = [];
  }

  function getMenuFocusables() {
    return Array.from(menu.querySelectorAll(
      'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )).filter(function (element) {
      return element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]');
    });
  }

  function setOpen(nextState) {
    if (isOpen === nextState) return;

    isOpen = nextState;
    document.body.classList.toggle('is-mobile-menu-open', isOpen);
    menu.style.display = isOpen ? 'block' : 'none';
    menu.style.visibility = 'visible';
    menu.style.opacity = '1';
    if (isOpen) {
      menu.style.setProperty('background-color', 'var(--lug-dark, #17251c)', 'important');
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      setBackgroundInert(true);
    } else {
      menu.style.removeProperty('background-color');
      document.body.style.overflow = previousBodyOverflow;
      setBackgroundInert(false);
    }
    menu.style.color = isOpen ? 'var(--lug-cream, #f3fff0)' : '';
    if (menuBackground) {
      if (isOpen) menuBackground.style.setProperty('background-color', 'var(--lug-dark, #17251c)', 'important');
      else menuBackground.style.removeProperty('background-color');
    }

    menu.setAttribute('aria-hidden', String(!isOpen));
    trigger.setAttribute('aria-expanded', String(isOpen));
    trigger.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');

    if (isOpen) {
      var initialFocus = menu.querySelector('[data-menu-close-button]') || menu.querySelector('a[href]');
      if (initialFocus) initialFocus.focus();
    } else if (menu.contains(document.activeElement)) {
      trigger.focus();
    }
  }

  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', menu.id);
  trigger.setAttribute('aria-expanded', 'false');
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-modal', 'true');
  menu.setAttribute('aria-label', 'Меню сайта');
  menu.setAttribute('aria-hidden', 'true');

  trigger.addEventListener('click', function () {
    setOpen(!isOpen);
  });

  menu.addEventListener('click', function (event) {
    if (event.target === menu || event.target.closest('[data-modal-close]')) setOpen(false);
  });

  menu.addEventListener('keydown', function (event) {
    if (!isOpen || event.key !== 'Tab') return;

    var focusables = getMenuFocusables();
    if (!focusables.length) {
      event.preventDefault();
      return;
    }

    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || !menu.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !menu.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (!isOpen || event.key !== 'Escape') return;
    setOpen(false);
  });
})();
