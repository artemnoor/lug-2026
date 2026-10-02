(function () {
  "use strict";

  const WELCOME_QUEUE_KEY = "lug-welcome-guide";
  const WELCOME_SEEN_KEY = "lug-welcome-guide-seen";
  let welcomeDialog;
  let currentUser = null;
  let role = "participant";

  const roleCopy = {
    captain: {
      title: "КОМАНДА СОЗДАНА",
      lead: "Вы — капитан. Соберите команду, добавьте материалы и следите за сообщениями организаторов.",
      roadmap: [
        ["01", "Проверьте данные", "В обзоре видно, что важно сделать сейчас."],
        ["02", "Пригласите группу", "Скопируйте личную ссылку и соберите команду."],
        ["03", "Соберите материалы", "Каждый участник добавляет личные достижения с подтверждающими файлами."],
        ["04", "Отправьте видео", "Видео-визитку загружает капитан после подготовки команды."],
        ["05", "Читайте уведомления", "Замечания и решения оргкомитета появляются в кабинете."]
      ]
    },
    participant: {
      title: "ВЫ В КОМАНДЕ",
      lead: "Вы зарегистрировались как участник. Добавляйте достижения, проверяйте контакты и следите за уведомлениями.",
      roadmap: [
        ["01", "Проверьте данные", "В обзоре видно, что важно сделать сейчас."],
        ["02", "Заполните портфолио", "Добавляйте свои достижения и прикладывайте подтверждающие файлы."],
        ["03", "Следите за командой", "В разделе «Команда» видно, как формируется состав группы."],
        ["04", "Передайте материалы капитану", "Поделитесь идеями и материалами для командной видео-визитки."],
        ["05", "Читайте уведомления", "Замечания и решения оргкомитета появляются в кабинете."]
      ]
    }
  };

  function seenKey() { return `${WELCOME_SEEN_KEY}:${currentUser?.id || role}`; }
  function welcomeSeen() {
    try { return localStorage.getItem(seenKey()) === "1"; } catch { return false; }
  }
  function markWelcomeSeen() {
    try { localStorage.setItem(seenKey(), "1"); } catch { /* storage may be unavailable */ }
  }
  function closeWelcome() {
    markWelcomeSeen();
    if (welcomeDialog?.open) welcomeDialog.close();
  }

  function renderWelcome() {
    const copy = roleCopy[role];
    welcomeDialog.innerHTML = `<div class="guide-welcome__card"><svg class="guide-welcome__star" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,0 58,37 88,12 67,43 100,50 64,57 88,88 57,65 50,100 42,63 12,88 35,57 0,50 36,43 12,12 43,37"/></svg><button class="guide-welcome__close" type="button" aria-label="Закрыть инструкцию">×</button><p class="guide-welcome__eyebrow">Добро пожаловать в ЛУГ 2026</p><h2 id="guide-welcome-title">${copy.title}</h2><p class="guide-welcome__lead">${copy.lead}</p><ol class="guide-welcome__roadmap">${copy.roadmap.map(([number, title, text]) => `<li><span>${number}</span><div><h3>${title}</h3><p>${text}</p></div></li>`).join("")}</ol><div class="guide-welcome__actions"><button type="button" class="guide-welcome__primary" data-welcome-done="true">Понятно, начать работу <span aria-hidden="true">→</span></button></div></div>`;
    welcomeDialog.querySelector(".guide-welcome__close").addEventListener("click", closeWelcome);
    welcomeDialog.querySelector("[data-welcome-done]").addEventListener("click", closeWelcome);
  }

  function buildWelcomeDialog() {
    welcomeDialog = document.createElement("dialog");
    welcomeDialog.className = "guide-welcome";
    welcomeDialog.setAttribute("aria-labelledby", "guide-welcome-title");
    document.body.append(welcomeDialog);
    welcomeDialog.addEventListener("click", (event) => { if (event.target === welcomeDialog) closeWelcome(); });
    welcomeDialog.addEventListener("cancel", markWelcomeSeen);
    welcomeDialog.addEventListener("close", markWelcomeSeen);
  }

  function openWelcome() {
    const navToggle = document.querySelector("#cabinetMobileNavToggle");
    if (navToggle?.getAttribute("aria-expanded") === "true") navToggle.click();
    renderWelcome();
    if (!welcomeDialog.open) welcomeDialog.showModal();
  }

  async function showWelcomeAfterRegistration() {
    try {
      const session = await window.lugStore.session();
      currentUser = session.user || null;
      role = currentUser?.role === "captain" ? "captain" : "participant";
    } catch {
      currentUser = null;
      role = "participant";
    }
    const queuedRole = sessionStorage.getItem(WELCOME_QUEUE_KEY);
    const isWelcomeRoute = new URLSearchParams(location.search).get("welcome") === "1";
    if (queuedRole === role && isWelcomeRoute) {
      sessionStorage.removeItem(WELCOME_QUEUE_KEY);
      if (!welcomeSeen()) window.setTimeout(openWelcome, 650);
    }
  }

  function init() {
    if (!document.body.classList.contains("cabinet-page")) return;
    buildWelcomeDialog();
    document.querySelector("#overviewWelcomeOpen")?.addEventListener("click", openWelcome);
    showWelcomeAfterRegistration();
  }

  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
