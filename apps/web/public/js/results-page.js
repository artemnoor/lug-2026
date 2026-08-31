const lead = document.getElementById("resultsLead");
const list = document.getElementById("resultsList");
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
try {
  const response = await fetch("/api/results", { credentials: "same-origin" });
  const result = await response.json();
  if (!result.published) {
    lead.textContent = `Итоги будут опубликованы ${new Date(result.availableFrom).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}`;
    list.innerHTML = '<li class="results-empty">Таблица появится после завершения проверки заявок.</li>';
  } else {
    lead.textContent = "Команды отсортированы по сумме подтверждённых баллов портфолио и видео-визитки.";
    list.innerHTML = result.teams.length ? result.teams.map((team, index) => `<li class="results-row"><span class="results-row__place">${String(index + 1).padStart(2, "0")}</span><span><strong class="results-row__name">${esc(team.name)}</strong><span class="results-row__group">${esc(team.group)}</span></span><span class="results-row__score">${team.score}<small>баллов</small></span></li>`).join("") : '<li class="results-empty">Пока нет опубликованных результатов.</li>';
  }
} catch {
  lead.textContent = "Не удалось загрузить результаты. Попробуйте обновить страницу.";
  list.innerHTML = '<li class="results-empty">Сервис временно недоступен.</li>';
}
