import { publicDate } from './dom.js';

export function createPublicSchedule({ document, window, authApi }) {
  const publicDateRange = (start, end) => {
    const left = publicDate(start);
    const right = publicDate(end);
    return left && right ? `${left} — ${right}` : left || right;
  };

  const applyPublicSchedule = (settings = {}) => {
    window.lugPublicSettings = settings;
    const profileAccessOpen = settings.isProfileAccessOpen === true;
    const registrationActive = profileAccessOpen
      && settings.isRegistrationOpen === true
      && Date.now() >= new Date(settings.registrationStart).getTime()
      && Date.now() <= new Date(settings.registrationDeadline).getTime();
    document.body.dataset.registrationClosed = String(!registrationActive);
    document.body.dataset.profileAccessClosed = String(!profileAccessOpen);
    const accountLink = document.querySelector('#siteAccountLink, .site-profile-link');
    const menuAccountLink = document.querySelector('#siteMenuAccountLink');
    if (accountLink && accountLink.dataset.authenticated !== 'true') {
      accountLink.hidden = !profileAccessOpen;
      const label = accountLink.querySelector('.site-profile-link__label');
      const text = registrationActive ? 'Добавить профиль' : 'Профиль';
      if (label) label.textContent = text;
      accountLink.setAttribute('aria-label', registrationActive ? text : 'Войти в профиль');
      accountLink.title = registrationActive ? text : 'Войти в профиль';
      accountLink.href = registrationActive ? '/?action=register' : '/?action=login';
    }
    if (menuAccountLink && menuAccountLink.dataset.authenticated !== 'true') {
      menuAccountLink.hidden = !profileAccessOpen;
      menuAccountLink.href = registrationActive ? '/?action=register' : '/?action=login';
      menuAccountLink.setAttribute('aria-label', registrationActive ? 'Добавить профиль' : 'Войти в профиль');
    }
    document.querySelectorAll('a[href*="action=login"], a[href*="action=choice"]').forEach((link) => {
      if (link === accountLink || link === menuAccountLink) return;
      link.hidden = !profileAccessOpen;
    });
    document.querySelectorAll('a[href*="action=register"], a[href*="action=join"]').forEach((link) => {
      link.setAttribute('aria-disabled', String(!registrationActive));
      link.tabIndex = registrationActive ? 0 : -1;
      link.classList.toggle('is-disabled', !registrationActive);
    });
    document.querySelectorAll('[data-schedule]').forEach((node) => {
      const key = node.dataset.schedule;
      const values = key === 'registration' ? [settings.registrationStart, settings.registrationDeadline]
        : key === 'portfolio' ? [settings.portfolioStart, settings.portfolioDeadline]
          : key === 'results' ? [settings.resultsStart, settings.resultsDeadline] : [];
      const range = publicDateRange(...values);
      if (range) node.textContent = range;
    });
    document.querySelectorAll('[data-registration-deadline]').forEach((node) => {
      node.textContent = registrationActive ? `Зарегистрируйся до ${publicDate(settings.registrationDeadline)}` : 'Приём заявок закрыт';
    });
    document.querySelectorAll('[data-content]:not([data-registration-status])').forEach((node) => {
      const value = settings.content?.[node.dataset.content];
      if (value) node.textContent = value;
    });
    document.querySelectorAll('[data-registration-status]').forEach((node) => {
      node.textContent = registrationActive
        ? (settings.content?.registrationHeadline || `Приём заявок открыт до ${publicDate(settings.registrationDeadline)}`)
        : 'Приём заявок закрыт';
    });
    window.dispatchEvent(new CustomEvent('lug:config', { detail: settings }));
  };

  const syncPublicSchedule = async () => {
    try {
      const result = await authApi.request('/api/config');
      applyPublicSchedule(result.settings || {});
    } catch {
      // Static fallback copy remains visible when the page is opened without the server.
    }
  };

  return { applyPublicSchedule, syncPublicSchedule };
}
