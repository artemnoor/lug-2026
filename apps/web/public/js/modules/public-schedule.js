import { publicDate } from './dom.js';

export function createPublicSchedule({ document, window, authApi }) {
  const publicDateRange = (start, end) => {
    const left = publicDate(start);
    const right = publicDate(end);
    return left && right ? `${left} — ${right}` : left || right;
  };

  const applyPublicSchedule = (settings = {}) => {
    window.lugPublicSettings = settings;
    const registrationActive = settings.isRegistrationOpen === true
      && Date.now() >= new Date(settings.registrationStart).getTime()
      && Date.now() <= new Date(settings.registrationDeadline).getTime();
    document.body.dataset.registrationClosed = String(!registrationActive);
    document.querySelectorAll('a[href*="register.html?action=register"]').forEach((link) => {
      link.setAttribute('aria-disabled', String(!registrationActive));
      link.tabIndex = registrationActive ? 0 : -1;
      link.classList.toggle('is-disabled', !registrationActive);
    });
    document.querySelectorAll('[data-schedule]').forEach((node) => {
      const key = node.dataset.schedule;
      const values = key === 'registration' ? [settings.registrationStart, settings.registrationDeadline]
        : key === 'portfolio' ? [settings.portfolioStart, settings.portfolioDeadline]
          : key === 'video' ? [settings.videoStart, settings.videoDeadline]
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
