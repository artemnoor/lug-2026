(() => {
  'use strict';

  const STORAGE_KEY = 'lug-design-version';
  const DEFAULT_THEME = 'green';
  const themes = {
    classic: { number: '01', label: 'Классика' },
    green: { number: '02', label: 'Зелёная' },
    accent: { number: '03', label: 'Акценты' },
  };
  let switcherIndex = 0;

  const isTheme = (value) => Object.prototype.hasOwnProperty.call(themes, value);
  const readTheme = () => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return isTheme(stored) ? stored : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  };

  const updateThemeColor = (theme) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    meta.setAttribute('content', theme === 'classic' ? '#006CDC' : theme === 'accent' ? '#238689' : '#238689');
  };

  const updateControls = (theme) => {
    const current = themes[theme];
    document.querySelectorAll('[data-theme-switcher]').forEach((root) => {
      const trigger = root.querySelector('[data-theme-trigger]');
      const currentLabel = root.querySelector('[data-theme-current]');
      if (currentLabel) currentLabel.textContent = `Дизайн ${current.number}`;
      if (trigger) trigger.setAttribute('aria-label', `Сменить версию дизайна. Выбрана версия ${current.number}: ${current.label}`);
      root.querySelectorAll('[data-theme-choice]').forEach((choice) => {
        const active = choice.dataset.themeChoice === theme;
        choice.setAttribute('aria-pressed', String(active));
        choice.classList.toggle('is-active', active);
      });
    });
  };

  const applyTheme = (theme, { persist = false } = {}) => {
    const nextTheme = isTheme(theme) ? theme : DEFAULT_THEME;
    document.documentElement.dataset.lugTheme = nextTheme;
    updateThemeColor(nextTheme);
    if (persist) {
      try { window.localStorage.setItem(STORAGE_KEY, nextTheme); } catch { /* Storage can be disabled. */ }
    }
    updateControls(nextTheme);
    document.dispatchEvent(new CustomEvent('lug-theme-change', { detail: { theme: nextTheme } }));
    return nextTheme;
  };

  const closeSwitcher = (root, { restoreFocus = false } = {}) => {
    const trigger = root.querySelector('[data-theme-trigger]');
    const panel = root.querySelector('[data-theme-panel]');
    if (!trigger || !panel) return;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };

  const openSwitcher = (root) => {
    const trigger = root.querySelector('[data-theme-trigger]');
    const panel = root.querySelector('[data-theme-panel]');
    if (!trigger || !panel) return;
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    root.querySelector('[data-theme-choice][aria-pressed="true"]')?.focus();
  };

  const mountSwitcher = (root) => {
    if (root.dataset.themeMounted === 'true') return;
    switcherIndex += 1;
    const panelId = `lug-theme-panel-${switcherIndex}`;
    root.dataset.themeMounted = 'true';
    root.classList.add('theme-switcher');
    root.innerHTML = `
      <button class="theme-switcher__trigger" type="button" data-theme-trigger aria-expanded="false" aria-controls="${panelId}">
        <svg class="theme-switcher__icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.64 5.64l2.12 2.12M16.24 16.24l2.12 2.12M5.64 18.36l2.12-2.12M16.24 7.76l2.12-2.12"/><circle cx="12" cy="12" r="3.5"/></svg>
        <span class="theme-switcher__trigger-copy"><span data-theme-current>Дизайн 02</span><small>Сменить</small></span>
      </button>
      <div class="theme-switcher__panel" id="${panelId}" data-theme-panel role="dialog" aria-label="Версия дизайна" hidden>
        <div class="theme-switcher__panel-head"><strong>Версия дизайна</strong><span>Меняются только цвета</span></div>
        <div class="theme-switcher__options" role="group" aria-label="Выберите версию дизайна">
          <button type="button" class="theme-switcher__option" data-theme-choice="classic" aria-pressed="false">
            <span class="theme-switcher__swatch theme-switcher__swatch--classic" aria-hidden="true"></span><span class="theme-switcher__option-copy"><strong>01 · Классика</strong><small>Белый и синий</small></span><span class="theme-switcher__check" aria-hidden="true">✓</span>
          </button>
          <button type="button" class="theme-switcher__option" data-theme-choice="green" aria-pressed="false">
            <span class="theme-switcher__swatch theme-switcher__swatch--green" aria-hidden="true"></span><span class="theme-switcher__option-copy"><strong>02 · Зелёная</strong><small>Текущая версия</small></span><span class="theme-switcher__check" aria-hidden="true">✓</span>
          </button>
          <button type="button" class="theme-switcher__option" data-theme-choice="accent" aria-pressed="false">
            <span class="theme-switcher__swatch theme-switcher__swatch--accent" aria-hidden="true"></span><span class="theme-switcher__option-copy"><strong>03 · Акценты</strong><small>Синий с новыми цветами</small></span><span class="theme-switcher__check" aria-hidden="true">✓</span>
          </button>
        </div>
      </div>
    `;

    root.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-theme-choice]');
      if (choice) {
        applyTheme(choice.dataset.themeChoice, { persist: true });
        closeSwitcher(root, { restoreFocus: true });
        return;
      }
      const trigger = event.target.closest('[data-theme-trigger]');
      if (trigger) {
        const isOpen = trigger.getAttribute('aria-expanded') === 'true';
        isOpen ? closeSwitcher(root) : openSwitcher(root);
      }
    });
  };

  const mountAll = () => {
    document.querySelectorAll('[data-theme-switcher]').forEach(mountSwitcher);
    updateControls(document.documentElement.dataset.lugTheme || DEFAULT_THEME);
  };

  applyTheme(readTheme());
  document.addEventListener('DOMContentLoaded', mountAll, { once: true });
  document.addEventListener('click', (event) => {
    document.querySelectorAll('[data-theme-switcher]').forEach((root) => {
      if (!root.contains(event.target)) closeSwitcher(root);
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const openRoot = [...document.querySelectorAll('[data-theme-switcher]')].find((root) => root.querySelector('[data-theme-trigger][aria-expanded="true"]'));
    if (openRoot) closeSwitcher(openRoot, { restoreFocus: true });
  });
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) applyTheme(event.newValue);
  });
})();
