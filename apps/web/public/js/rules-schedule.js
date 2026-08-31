const format = (value, withYear = false) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", ...(withYear ? { year: "numeric" } : {}) }) : "";
};
const range = (start, end) => [format(start), format(end)].filter(Boolean).join(" — ");
fetch("/api/config", { credentials: "same-origin" }).then((response) => response.json()).then(({ settings }) => {
  const schedule = { registration: [settings.registrationStart, settings.registrationDeadline], portfolio: [settings.portfolioStart, settings.portfolioDeadline], video: [settings.videoStart, settings.videoDeadline], results: [settings.resultsStart, settings.resultsDeadline] };
  document.querySelectorAll("[data-rules-schedule]").forEach((node) => { const values = schedule[node.dataset.rulesSchedule]; const label = values && range(...values); if (label) node.textContent = label; });
  const start = document.querySelector('[data-rules-date="competition-start"]');
  const end = document.querySelector('[data-rules-date="competition-end"]');
  if (start && format(settings.registrationStart)) { start.textContent = format(settings.registrationStart); start.dateTime = settings.registrationStart; }
  if (end && format(settings.resultsDeadline, true)) { end.textContent = format(settings.resultsDeadline, true); end.dateTime = settings.resultsDeadline; }
}).catch(() => {});
