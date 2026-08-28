// ==========================================================================
// ТАЙМЕР ОБРАТНОГО ОТСЧЕТА ДО ДЕДЛАЙНА
// ==========================================================================
(function initHeroTimer(){
  let deadline = new Date('2026-09-03T23:59:59+03:00').getTime();
  const fields = {
    days: document.querySelector('[data-timer="days"]'),
    hours: document.querySelector('[data-timer="hours"]'),
    minutes: document.querySelector('[data-timer="minutes"]'),
    seconds: document.querySelector('[data-timer="seconds"]')
  };
  const applySettings = (settings = {}) => {
    const next = new Date(settings.registrationDeadline || '').getTime();
    if (Number.isFinite(next)) deadline = next;
    render();
  };
  const render = () => {
    const remaining = Math.max(0, deadline - Date.now());
    const seconds = Math.floor(remaining / 1000);
    const values = {
      days: Math.floor(seconds / 86400),
      hours: Math.floor(seconds % 86400 / 3600),
      minutes: Math.floor(seconds % 3600 / 60),
      seconds: seconds % 60
    };
    Object.entries(values).forEach(([key, value]) => {
      if (fields[key]) fields[key].textContent = String(value).padStart(2, '0');
    });
  };
  window.addEventListener('lug:config', (event) => applySettings(event.detail));
  if (window.lugPublicSettings) applySettings(window.lugPublicSettings);
  render();
  window.setInterval(render, 1000);
})();
