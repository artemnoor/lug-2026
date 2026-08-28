(function () {
  "use strict";

  const ORGANIZER_EMAIL = "lug@bmstu.ru";
  const PREF_KEY = "lug-assistant-hidden";
  const WELCOME_KEY = "lug-welcome-guide";
  let dialog, welcomeDialog, spotlight, tooltip, tour, frame;
  let stepIndex = 0;
  let role = "participant";

  const click = (selector) => document.querySelector(selector)?.click();
  const selectView = (view) => click(`.cabinet-nav[data-view='${view}']`);
  const target = (selector) => document.querySelector(selector);
  const roleCopy = {
    captain: {
      title: "КОМАНДА СОЗДАНА",
      lead: "Вы — капитан. Соберите команду, добавьте материалы и следите за сообщениями организаторов.",
      assistantTitle: "Нужна помощь?",
      assistantLead: "Выберите вопрос — покажу нужный раздел и объясню следующий шаг.",
      roadmap: [
        ["01", "Проверьте данные", "В обзоре видно, что важно сделать сейчас."],
        ["02", "Пригласите группу", "Скопируйте личную ссылку и следите, чтобы в команде было не менее 60% студентов."],
        ["03", "Соберите материалы", "Каждый участник добавляет личные достижения с подтверждающими файлами."],
        ["04", "Отправьте видео", "Видео-визитку загружает капитан после подготовки команды."],
        ["05", "Читайте уведомления", "Замечания и решения оргкомитета появляются в кабинете."]
      ], welcomeTour: "welcome-captain"
    },
    participant: {
      title: "ВЫ В КОМАНДЕ",
      lead: "Вы зарегистрировались как участник. Ваш вклад — личные достижения, актуальные контакты и внимательная работа с уведомлениями.",
      assistantTitle: "Нужна помощь?",
      assistantLead: "Выберите вопрос — покажу нужный раздел и объясню следующий шаг.",
      roadmap: [
        ["01", "Проверьте данные", "В обзоре видно, что важно сделать сейчас."],
        ["02", "Заполните портфолио", "Добавляйте свои достижения по одному и прикладывайте подтверждающий файл."],
        ["03", "Следите за командой", "В разделе «Команда» видно, как формируется состав группы."],
        ["04", "Свяжитесь с капитаном", "Видео-визитку загружает капитан; передайте ему идеи и материалы вовремя."],
        ["05", "Читайте уведомления", "Замечания и решения оргкомитета появляются в кабинете."]
      ], welcomeTour: "welcome-participant"
    }
  };

  const tours = [
    { id: "welcome-captain", roles: ["captain"], label: "Полный маршрут капитана", steps: [
      { target: ".cabinet-next", title: "Начните с обзора", text: "Здесь отображается ближайшее действие и готовность заявки. Возвращайтесь сюда, если не понимаете, что делать дальше." },
      { target: ".cabinet-nav[data-view='team']", title: "Откройте команду", text: "В этом разделе вы управляете составом и видите, сколько студентов уже присоединилось к команде." },
      { target: "#copyInvite", before: () => selectView("team"), title: "Пригласите одногруппников", text: "Скопируйте персональную ссылку и отправьте её одногруппникам. По ней они попадут сразу в регистрацию по приглашению." },
      { target: "#quotaBadge", title: "Следите за порогом", text: "Для участия в конкурсе команда должна включать не менее 60% студентов учебной группы. Здесь видно, сколько человек ещё нужно." },
      { target: ".cabinet-nav[data-view='portfolio']", title: "Соберите личные достижения", text: "Капитан тоже добавляет свои достижения. Остальные участники заполняют собственные портфолио в своих кабинетах." },
      { target: ".cabinet-nav[data-view='video']", title: "Отправьте видео-визитку", text: "Эта задача доступна капитану. Перед отправкой проверьте критерии и откройте ссылку в другом окне без входа." },
      { target: ".cabinet-nav[data-view='notifications']", title: "Проверяйте решения", text: "Оргкомитет пишет здесь о проверке заявки, достижений и видео. Открывайте непрочитанные сообщения сразу." }
    ] },
    { id: "welcome-participant", roles: ["participant"], label: "Полный маршрут участника", steps: [
      { target: ".cabinet-next", title: "Начните с обзора", text: "Здесь отображается ближайшее действие и готовность вашей заявки. Возвращайтесь сюда, если не понимаете, что делать дальше." },
      { target: ".cabinet-nav[data-view='portfolio']", title: "Откройте портфолио", text: "Это ваш основной рабочий раздел. Здесь хранятся личные достижения по направлениям конкурса." },
      { target: "#openAchievement", before: () => selectView("portfolio"), title: "Добавьте достижение", text: "Одна запись — одно достижение. Выберите направление, опишите результат и приложите понятный файл-подтверждение." },
      { target: ".cabinet-nav[data-view='team']", title: "Посмотрите состав", text: "Здесь видно, кто уже присоединился к команде и выполнен ли порог в 60% студентов группы." },
      { target: ".cabinet-nav[data-view='video']", title: "Передайте материалы капитану", text: "Видео-визитку отправляет капитан. Поделитесь с ним идеями, кадрами или достижениями, которые стоит показать." },
      { target: ".cabinet-nav[data-view='notifications']", title: "Читайте уведомления", text: "Оргкомитет оставляет здесь решения и замечания. Если нужна ясность, задайте вопрос организаторам." },
      { target: ".cabinet-nav[data-view='profile']", title: "Держите контакты актуальными", text: "Проверьте телефон и хотя бы один контакт в мессенджере, чтобы организаторы могли быстро связаться с вами." }
    ] },
    { id: "start", roles: ["captain", "participant"], label: "С чего начать?", steps: [
      { target: ".cabinet-next", title: "Начните с ближайшего шага", text: "В обзоре всегда показано действие, которое сейчас важнее всего для вашей заявки." },
      { target: "#nextAction", title: "Откройте нужный раздел", text: "Эта кнопка всегда ведёт к действию, которое сейчас важнее всего." },
      { target: "#openAchievement", before: () => selectView("portfolio"), title: "Добавьте первое достижение", text: "Выберите направление, заполните название и пояснение, приложите файл-подтверждение и отправьте запись на проверку." }
    ] },
    { id: "achievement", roles: ["captain", "participant"], label: "Как добавить достижение?", steps: [
      { target: ".cabinet-nav[data-view='portfolio']", title: "Откройте портфолио", text: "Здесь хранятся достижения по четырём направлениям конкурса." },
      { target: "#openAchievement", before: () => selectView("portfolio"), title: "Создайте запись", text: "Укажите одно достижение, понятное название и контекст. Приложите читаемый файл-подтверждение." }
    ] },
    { id: "team-captain", roles: ["captain", "participant"], label: "Как пригласить участников?", steps: [
      { target: ".cabinet-nav[data-view='team']", title: "Откройте команду", text: "В этом разделе отображаются участники группы и статус их подтверждения." },
      { target: "#copyInvite", before: () => selectView("team"), title: "Скопируйте приглашение", text: "Отправьте ссылку одногруппнику — он введёт код на странице регистрации во вкладке «По приглашению»." },
      { target: "#memberList", title: "Проверьте состав", text: "После регистрации участник появится в списке. Следите за долей студентов — для участия нужно не менее 60%." }
    ] },
    { id: "video-captain", roles: ["captain", "participant"], label: "Как отправить видео-визитку?", steps: [
      { target: ".cabinet-nav[data-view='video']", title: "Откройте видео-визитку", text: "Сначала посмотрите критерии: тема, креативность, качество съёмки и визуальные эффекты." },
      { target: "#videoUrl", before: () => selectView("video"), title: "Вставьте публичную ссылку", text: "Подойдёт Rutube, VK Видео или Яндекс Диск. Проверьте в другом окне, что видео открывается без запроса доступа." },
      { target: "#videoForm button[type='submit']", title: "Отправьте видео", text: "После отправки ссылка доступна оргкомитету. Изменить её можно до завершения периода подачи материалов." }
    ] },
    { id: "status", roles: ["captain", "participant"], label: "Где посмотреть статус и замечания?", steps: [
      { target: "#identityBadge", title: "Статус заявки", text: "В шапке кабинета отображается общий статус: заявка на проверке, подтверждена или требует уточнений." },
      { target: ".cabinet-nav[data-view='notifications']", title: "Откройте уведомления", text: "Здесь организаторы оставляют решения и комментарии по заявке, достижениям и видео." },
      { target: "#notificationList", before: () => selectView("notifications"), title: "Прочитайте комментарий", text: "Если формулировка непонятна, напишите организаторам — не создавайте новую запись наугад." }
    ] },
    { id: "profile", roles: ["captain", "participant"], label: "Как изменить контакты?", steps: [
      { target: ".cabinet-nav[data-view='profile']", title: "Откройте профиль", text: "Здесь редактируются личные контакты. Учебная группа фиксируется после регистрации." },
      { target: "#profileForm", before: () => selectView("profile"), title: "Обновите данные", text: "Проверьте телефон и контакт в выбранном мессенджере — по ним организаторы смогут связаться с вами." }
    ] }
  ];

  const findTour = (id) => tours.find((item) => item.id === id);
  const availableTours = () => tours.filter((item) => item.roles.includes(role) && !item.id.startsWith("welcome-"));
  const questionMarkup = (item) => `<button type="button" class="guide-question" data-guide-tour="${item.id}"><span>${item.label}</span><b aria-hidden="true">→</b></button>`;

  function buildDialog() {
    dialog = document.createElement("dialog"); dialog.className = "guide-dialog"; dialog.id = "guide-dialog"; dialog.setAttribute("aria-labelledby", "guide-title");
    dialog.innerHTML = `<div class="guide-dialog__card"><div class="guide-dialog__top"><span class="guide-dialog__eyebrow"><span aria-hidden="true">✦</span> Помощник ЛУГ</span><button class="guide-close" type="button" aria-label="Закрыть помощника">×</button></div><h2 id="guide-title">Чем помочь?</h2><p class="guide-dialog__lead">Выберите ситуацию — я покажу нужное место и объясню, что делать дальше.</p><div class="guide-questions" role="list"></div><a class="guide-contact" href="mailto:${ORGANIZER_EMAIL}?subject=${encodeURIComponent("Вопрос по конкурсу ЛУГ 2026")}"><span class="guide-contact__icon" aria-hidden="true">✦</span><span><strong>Не нашли свой случай?</strong><small>Напишите организаторам конкурса</small></span><span aria-hidden="true">↗</span></a></div>`;
    document.body.append(dialog); dialog.querySelector(".guide-close").addEventListener("click", () => dialog.close()); dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
  }

  function buildWelcomeDialog() { welcomeDialog = document.createElement("dialog"); welcomeDialog.className = "guide-welcome"; welcomeDialog.setAttribute("aria-labelledby", "guide-welcome-title"); document.body.append(welcomeDialog); welcomeDialog.addEventListener("click", (event) => { if (event.target === welcomeDialog) welcomeDialog.close(); }); }

  function renderWelcome() {
    const copy = roleCopy[role];
    welcomeDialog.innerHTML = `<div class="guide-welcome__card"><svg class="guide-welcome__star" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,0 58,37 88,12 67,43 100,50 64,57 88,88 57,65 50,100 42,63 12,88 35,57 0,50 36,43 12,12 43,37"/></svg><button class="guide-welcome__close" type="button" aria-label="Закрыть путеводитель">×</button><p class="guide-welcome__eyebrow">Добро пожаловать в ЛУГ 2026</p><h2 id="guide-welcome-title">${copy.title}</h2><p class="guide-welcome__lead">${copy.lead}</p><ol class="guide-welcome__roadmap">${copy.roadmap.map(([number, title, text]) => `<li><span>${number}</span><div><h3>${title}</h3><p>${text}</p></div></li>`).join("")}</ol><div class="guide-welcome__actions"><button type="button" class="guide-welcome__primary" data-welcome-tour="${copy.welcomeTour}">Провести по кабинету <span aria-hidden="true">→</span></button><button type="button" class="guide-welcome__secondary" data-welcome-questions="true">Задать вопрос</button></div><p class="guide-welcome__note">Путеводитель можно открыть снова в разделе «Обзор».</p></div>`;
    welcomeDialog.querySelector(".guide-welcome__close").addEventListener("click", () => welcomeDialog.close());
    welcomeDialog.querySelector("[data-welcome-tour]").addEventListener("click", (event) => { welcomeDialog.close(); startTour(findTour(event.currentTarget.dataset.welcomeTour)); });
    welcomeDialog.querySelector("[data-welcome-questions]").addEventListener("click", () => { welcomeDialog.close(); openAssistant(); });
  }

  function bindQuestionButtons(container) { container.querySelectorAll("[data-guide-tour]").forEach((button) => button.addEventListener("click", () => startTour(findTour(button.dataset.guideTour)))); }

  function renderRoleGuidance() {
    const copy = roleCopy[role]; const assistantTitle = target("#assistant-title"); if (assistantTitle) assistantTitle.textContent = copy.assistantTitle;
    const intro = target("#overviewAssistant .cabinet-assistant__intro > p:last-child"); if (intro) intro.textContent = copy.assistantLead;
    const markup = availableTours().map(questionMarkup).join("");
    [target("#overviewAssistant .cabinet-assistant__questions"), target(".guide-questions")].forEach((container) => { if (container) { container.innerHTML = markup; bindQuestionButtons(container); } });
    renderWelcome();
  }

  const openAssistant = () => { if (!dialog.open) dialog.showModal(); };

  function bindOverviewAssistant() {
    target("#overviewAssistantOpen")?.addEventListener("click", openAssistant);
    const block = target("#overviewAssistant"), restore = target("#overviewAssistantRestore"); if (!block || !restore) return;
    const setHidden = (hidden) => { block.hidden = hidden; restore.hidden = !hidden; localStorage.setItem(PREF_KEY, hidden ? "1" : "0"); };
    setHidden(localStorage.getItem(PREF_KEY) === "1"); target("#overviewAssistantHide")?.addEventListener("click", () => setHidden(true)); restore.addEventListener("click", () => setHidden(false)); target("#overviewWelcomeOpen")?.addEventListener("click", () => { renderWelcome(); if (!welcomeDialog.open) welcomeDialog.showModal(); });
  }

  function createTourLayer() { spotlight = document.createElement("div"); spotlight.className = "guide-spotlight"; spotlight.setAttribute("aria-hidden", "true"); tooltip = document.createElement("section"); tooltip.className = "guide-tooltip"; tooltip.setAttribute("role", "dialog"); tooltip.setAttribute("aria-live", "polite"); tooltip.setAttribute("aria-label", "Шаг инструкции"); document.body.append(spotlight, tooltip); }
  function endTour(reopen) { tour = null; stepIndex = 0; spotlight?.remove(); tooltip?.remove(); spotlight = null; tooltip = null; if (frame) cancelAnimationFrame(frame); if (reopen) openAssistant(); }
  function startTour(nextTour) { if (!nextTour) return; if (dialog.open) dialog.close(); if (welcomeDialog.open) welcomeDialog.close(); endTour(false); tour = nextTour; createTourLayer(); renderStep(); }

  function renderStep() {
    if (!tour || !tooltip) return;
    const step = tour.steps[stepIndex]; step.before?.();
    window.setTimeout(() => {
      const element = target(step.target); if (!element || element.getClientRects().length === 0) { endTour(true); return; }
      element.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center", inline: "nearest" });
      tooltip.innerHTML = `<p class="guide-tooltip__progress">Шаг ${stepIndex + 1} из ${tour.steps.length}</p><h2>${step.title}</h2><p>${step.text}</p><div class="guide-tooltip__actions"><button type="button" class="guide-tooltip__text" data-guide-exit>Закрыть</button><button type="button" class="guide-tooltip__next" data-guide-next>${stepIndex + 1 === tour.steps.length ? "Завершить" : "Далее"} <span aria-hidden="true">→</span></button></div>`;
      tooltip.querySelector("[data-guide-exit]").addEventListener("click", () => endTour(true)); tooltip.querySelector("[data-guide-next]").addEventListener("click", () => { if (stepIndex + 1 === tour.steps.length) endTour(true); else { stepIndex += 1; renderStep(); } }); place(element); tooltip.querySelector("[data-guide-next]").focus();
    }, step.before ? 240 : 40);
  }

  function place(element) {
    if (!tour || !spotlight || !tooltip) return; if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rect = element.getBoundingClientRect(), inset = 8, width = Math.min(392, innerWidth - 32);
      spotlight.style.left = `${Math.max(4, rect.left - inset)}px`; spotlight.style.top = `${Math.max(4, rect.top - inset)}px`; spotlight.style.width = `${Math.min(innerWidth - 8, rect.width + inset * 2)}px`; spotlight.style.height = `${Math.min(innerHeight - 8, rect.height + inset * 2)}px`;
      tooltip.style.width = `${width}px`; tooltip.style.left = "16px"; tooltip.style.top = "16px"; const height = tooltip.offsetHeight, above = rect.bottom + height + 42 > innerHeight && rect.top > height + 42;
      tooltip.style.left = `${Math.min(Math.max(16, rect.left), innerWidth - width - 16)}px`; tooltip.style.top = `${above ? Math.max(16, rect.top - height - 28) : Math.min(innerHeight - height - 16, rect.bottom + 28)}px`; tooltip.classList.toggle("guide-tooltip--above", above);
    });
  }

  function reposition() { const element = tour && target(tour.steps[stepIndex].target); if (element) place(element); }
  async function resolveRoleAndWelcome() {
    try { const { user } = await window.lugStore.session(); role = user?.role === "captain" ? "captain" : "participant"; } catch { role = "participant"; }
    renderRoleGuidance(); const queuedRole = sessionStorage.getItem(WELCOME_KEY);
    if (queuedRole === role && new URLSearchParams(location.search).get("welcome") === "1") { sessionStorage.removeItem(WELCOME_KEY); window.setTimeout(() => { if (!welcomeDialog.open) welcomeDialog.showModal(); }, 650); }
  }

  function init() {
    if (!document.body.classList.contains("cabinet-page")) return;
    buildDialog(); buildWelcomeDialog(); bindOverviewAssistant(); resolveRoleAndWelcome(); addEventListener("resize", reposition); addEventListener("scroll", reposition, true);
    document.addEventListener("keydown", (event) => { if (event.key === "Escape" && tour) { event.preventDefault(); endTour(true); } });
    window.lugAssistant = { open: openAssistant, start: (id) => startTour(findTour(id)), welcome: () => { renderWelcome(); if (!welcomeDialog.open) welcomeDialog.showModal(); } };
  }

  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", init) : init();
})();
