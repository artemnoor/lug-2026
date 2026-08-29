/* Панель оргкомитета: команды — источник правды для проверки, связи и статусов.
   Рендер полностью перестроен под сплит-вью и дизайн-систему сайта. */
(function (window, document) {
  'use strict';

  let state = null;
  let selectedTeamId = null;
  let selectedUserId = null;
  let selectedAchievementId = null;
  let adminNotificationsInitialized = false;
  let knownAdminNotificationIds = new Set();
  const filters = { teams: '', teamStatus: 'all', users: '', userStatus: 'all', achievements: '', achievementStatus: 'all', achievementDirection: 'all', achievementTeamId: '', achievementUserId: '' };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const dateLabel = (value) => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const shortDateLabel = (value) => value ? new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '—';
  const rangeLabel = (start, end) => {
    const s = start ? new Date(start).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
    const e = end ? new Date(end).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) : '';
    return s || e ? `${s || '?'} — ${e || '?'}` : 'Сроки не заданы';
  };
  const statusLabel = { pending: 'На проверке', approved: 'Принято', rejected: 'Доработка', none: 'Не отправлено' };
  const directionLabels = { science: 'Наука', public: 'Общество', sport: 'Спорт', culture: 'Творчество' };
  const directionIcons = {
    science: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v5.5L4.2 18a2 2 0 0 0 1.7 3h12.2a2 2 0 0 0 1.7-3L14 8.5V3"/><path d="M7 14h10"/></svg>',
    public: '<svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.5 8 8 9 4.5-1 8-4 8-9V7l-8-4Z"/></svg>',
    sport: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18"/><path d="M3.5 9h17M3.5 15h17"/></svg>',
    culture: '<svg viewBox="0 0 24 24"><path d="m12 3 2.4 5.4 5.6.6-4.2 3.9 1.2 5.6L12 15.6l-5 2.9 1.2-5.6L4 9l5.6-.6L12 3Z"/></svg>'
  };
  const workflowMeta = {
    new: { label: 'Новая заявка', className: 'admin-status--new', note: 'Заявка ещё не рассматривалась' },
    review: { label: 'На проверке', className: 'admin-status--pending', note: 'Есть решения в очереди' },
    'needs-work': { label: 'Доработка', className: 'admin-status--danger', note: 'Есть материалы с замечаниями' },
    ready: { label: 'Готово', className: 'admin-status--ready', note: 'Все данные и участники подтверждены' }
  };
  const viewTitles = { overview: 'Обзор', teams: 'Команды', users: 'Участники', achievements: 'Достижения', rating: 'Рейтинг групп', deadlines: 'Сроки', broadcast: 'Рассылка' };
  const localDateValue = (value) => {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  };
  const isoDateValue = (value) => value ? new Date(value).toISOString() : undefined;
  const initials = (fio) => String(fio || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';

  function plural(value, one, few, many = `${one}ов`) {
    const number = Math.abs(Number(value)) % 100;
    if (number >= 11 && number <= 19) return many;
    const last = number % 10;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  /* ---------- Тосты вместо статичного баннера ошибок ---------- */
  function showToast(title, text, type = 'info', timeout = 5000) {
    const stack = $('adminToastStack');
    if (!stack) return;
    while (stack.children.length >= 4) stack.firstElementChild.remove();
    const toast = document.createElement('div');
    toast.className = `admin-toast admin-toast--${type}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.innerHTML = `<div class="admin-toast__body"><span class="admin-toast__title">${esc(title)}</span>${text ? `<p class="admin-toast__text">${esc(text)}</p>` : ''}</div><button class="admin-toast__close" type="button" aria-label="Закрыть уведомление"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button>`;
    const remove = () => {
      if (!toast.isConnected) return;
      toast.classList.add('is-hiding');
      setTimeout(() => toast.remove(), 200);
    };
    toast.querySelector('.admin-toast__close').addEventListener('click', remove);
    stack.append(toast);
    if (timeout) setTimeout(remove, timeout);
  }

  function showError(message) {
    showToast('Ошибка', message || 'Не удалось выполнить действие.', 'error');
  }

  async function run(action) {
    try {
      return await action();
    } catch (error) {
      showError(error.message);
      throw error;
    }
  }

  async function busy(button, action) {
    if (button) {
      if (button.disabled) return;
      button.disabled = true;
    }
    try {
      return await action();
    } finally {
      if (button) button.disabled = false;
    }
  }

  /* ---------- Доменные помощники ---------- */
  function workflow(team) {
    return team?.workflow || { key: 'new', label: 'Новая заявка', reason: 'Состав ещё не подтверждён' };
  }

  function workflowPresentation(team) {
    const current = workflow(team);
    return { ...current, ...(workflowMeta[current.key] || workflowMeta.new) };
  }

  function teamSearchText(team) {
    const notifications = (team.notifications || []).map((item) => `${item.title} ${item.message}`).join(' ');
    const members = (team.members || []).map((member) => `${member.fio} ${member.phone}`).join(' ');
    return `${team.name || ''} ${team.group || ''} ${members} ${notifications}`.toLowerCase();
  }

  function teamMatches(team, query, status = 'all') {
    const textMatches = !query || teamSearchText(team).includes(query.trim().toLowerCase());
    const statusMatches = status === 'all' || workflow(team).key === status;
    return textMatches && statusMatches;
  }

  function pendingForTeam(team) {
    const identity = (team.members || []).filter((member) => member.identityStatus === 'pending').length;
    const achievements = (team.achievements || []).filter((item) => item.status === 'pending').length;
    const video = team.videoCard?.status === 'pending' ? 1 : 0;
    return { identity, achievements, video, total: identity + achievements + video };
  }

  function phaseState(settings, startKey, endKey) {
    const start = new Date(settings?.[startKey] || '').getTime();
    const end = new Date(settings?.[endKey] || '').getTime();
    const now = Date.now();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'none';
    if (now > end) return 'done';
    if (now < start) return 'upcoming';
    return 'active';
  }

  const phaseKeys = [
    { key: 'registration', start: 'registrationStart', end: 'registrationDeadline', label: 'Регистрация' },
    { key: 'portfolio', start: 'portfolioStart', end: 'portfolioDeadline', label: 'Портфолио' },
    { key: 'video', start: 'videoStart', end: 'videoDeadline', label: 'Видео' },
    { key: 'results', start: 'resultsStart', end: 'resultsDeadline', label: 'Результаты' }
  ];

  /* ---------- Навигация ---------- */
  function switchAdminTab(view) {
    const next = Object.keys(viewTitles).includes(view) ? view : 'overview';
    document.querySelectorAll('[data-admin-view]').forEach((button) => {
      const active = button.dataset.adminView === next;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
      const active = panel.dataset.adminPanel === next;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    if ($('adminTopbarCrumb')) $('adminTopbarCrumb').textContent = viewTitles[next] || 'Обзор';
    if (location.hash !== `#/${next}`) history.replaceState(null, '', `#/${next}`);
    closeSidebar();
  }

  function goToView(view) {
    switchAdminTab(view);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function selectTeam(teamId) {
    if (!state?.teams?.some((team) => team.id === teamId)) return;
    selectedTeamId = teamId;
    switchAdminTab('teams');
    renderTeams();
    const detail = $('adminTeamDetail');
    if (detail && window.innerWidth < 1024) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function selectUser(userId) {
    if (!state?.users?.some((user) => user.id === userId)) return;
    selectedUserId = userId;
    switchAdminTab('users');
    renderUsers();
    const detail = $('adminUserDetail');
    if (detail && window.innerWidth < 1024) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Мобильный сайдбар ---------- */
  function openSidebar() {
    $('adminSidebar')?.classList.add('is-open');
    if ($('adminSidebarOverlay')) $('adminSidebarOverlay').hidden = false;
    $('adminSidebarToggle')?.setAttribute('aria-expanded', 'true');
  }

  function closeSidebar() {
    $('adminSidebar')?.classList.remove('is-open');
    if ($('adminSidebarOverlay')) $('adminSidebarOverlay').hidden = true;
    $('adminSidebarToggle')?.setAttribute('aria-expanded', 'false');
  }

  /* ---------- Обзор ---------- */
  function renderOverview() {
    const summary = state?.summary || {};
    const settings = state?.settings || {};
    const pendingTotal = Number(summary.pendingIdentity || 0) + Number(summary.pendingAchievements || 0) + Number(summary.pendingVideos || 0);
    const registrationOpen = settings.isRegistrationOpen !== false && phaseState(settings, 'registrationStart', 'registrationDeadline') === 'active';

    if ($('adminOverviewStatus')) {
      $('adminOverviewStatus').textContent = registrationOpen ? 'Открыт' : 'Закрыт';
      $('adminOverviewStatus').className = registrationOpen ? 'is-open' : 'is-closed';
    }
    if ($('adminOverviewDeadline')) {
      $('adminOverviewDeadline').textContent = registrationOpen
        ? `Регистрация до ${shortDateLabel(settings.registrationDeadline)}`
        : phaseState(settings, 'registrationStart', 'registrationDeadline') === 'upcoming'
          ? `Старт ${shortDateLabel(settings.registrationStart)}`
          : 'Регистрация закрыта';
    }

    const metrics = [
      { label: 'Команды', value: summary.teams || 0, note: 'заявок в системе', view: 'teams', icon: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1.5a5.5 5.5 0 0 1 11 0V20"/><path d="M16 5.5a3 3 0 0 1 0 5"/><path d="M18 13a4.5 4.5 0 0 1 3 4.25V20"/></svg>' },
      { label: 'Участники', value: summary.users || 0, note: 'зарегистрированы', view: 'users', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M4 20v-1.5a8 8 0 0 1 16 0V20"/></svg>' },
      { label: 'Достижения', value: summary.achievements || 0, note: `${summary.pendingAchievements || 0} ждут решения`, view: 'achievements', icon: '<svg viewBox="0 0 24 24"><path d="m12 3 2.4 5.4 5.6.6-4.2 3.9 1.2 5.6L12 15.6l-5 2.9 1.2-5.6L4 9l5.6-.6L12 3Z"/></svg>' },
      { label: 'Очередь решений', value: pendingTotal, note: 'материалов ждут решения', view: 'achievements', accent: true, icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>' }
    ];
    const metricsNode = $('adminOverviewMetrics');
    if (metricsNode) metricsNode.innerHTML = metrics.map((metric) => `<button class="admin-kpi${metric.accent ? ' admin-kpi--accent' : ''}" type="button" data-admin-view-target="${metric.view}"><span class="admin-kpi__label">${metric.label}</span><strong class="admin-kpi__value">${metric.value}</strong><span class="admin-kpi__icon" aria-hidden="true">${metric.icon}</span><small class="admin-kpi__note">${esc(metric.note)}</small></button>`).join('');

    const pendingVideoTeam = state.teams.find((team) => pendingForTeam(team).video > 0);
    const attentionTeams = state.teams.filter((team) => workflow(team).key !== 'ready');
    const attentionTeam = attentionTeams[0];
    const queue = [
      { value: summary.pendingIdentity, title: `${summary.pendingIdentity || 0} ${plural(summary.pendingIdentity || 0, 'участник ждёт', 'участника ждут', 'участников ждут')} проверки личности`, note: 'Откройте карточку участника и подтвердите документ.', view: 'users', team: null, tone: 'danger', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M4 20v-1.5a8 8 0 0 1 16 0V20"/></svg>' },
      { value: summary.pendingAchievements, title: `${summary.pendingAchievements || 0} ${plural(summary.pendingAchievements || 0, 'документ', 'документа', 'документов')} в учёте достижений ждут решения`, note: 'Принять или отклонить можно в разделе «Достижения».', view: 'achievements', team: null, tone: 'warning', icon: '<svg viewBox="0 0 24 24"><path d="m12 3 2.4 5.4 5.6.6-4.2 3.9 1.2 5.6L12 15.6l-5 2.9 1.2-5.6L4 9l5.6-.6L12 3Z"/></svg>' },
      { value: summary.pendingVideos, title: `${summary.pendingVideos || 0} ${plural(summary.pendingVideos || 0, 'видео ждёт', 'видео ждут', 'видео ждут')} оценки`, note: 'Выставьте баллы и отправьте комментарий.', view: 'teams', team: pendingVideoTeam, tone: 'info', icon: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/></svg>' },
      { value: attentionTeams.length, title: `${attentionTeams.length} ${plural(attentionTeams.length, 'команда требует', 'команды требуют', 'команд требуют')} внимания`, note: 'Откройте карточку для полной проверки.', view: 'teams', team: attentionTeam, tone: 'warning', icon: '<svg viewBox="0 0 24 24"><path d="M5 21V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v16"/><path d="M12 4v4M9 21h6"/></svg>' }
    ].filter((item) => item.value > 0);
    if ($('adminQueueCount')) $('adminQueueCount').textContent = queue.length;
    const queueNode = $('adminReviewQueue');
    if (queueNode) queueNode.innerHTML = queue.length ? queue.map((item) => `<div class="admin-review-item admin-review-item--${item.tone}"><span class="admin-review-item__icon" aria-hidden="true">${item.icon}</span><div class="admin-review-item__body"><strong>${esc(item.title)}</strong><small>${esc(item.note)}</small></div><div class="admin-review-item__actions"><button type="button" data-admin-view-target="${item.view}"${item.team ? ` data-select-team="${esc(item.team.id)}"` : ''}>Открыть</button></div></div>`).join('') : '<p class="admin-empty">Сейчас нет задач, требующих решения. Отличная работа!</p>';

    const adminNotifications = state?.adminNotifications || [];
    if ($('adminNotificationsCount')) $('adminNotificationsCount').textContent = adminNotifications.length;
    const notificationsNode = $('adminNotificationsList');
    if (notificationsNode) {
      notificationsNode.innerHTML = adminNotifications.length
        ? adminNotifications.slice(0, 20).map((item) => {
          const participant = state.users.find((user) => user.id === item.targetId);
          return `<article class="admin-notification-item"><div class="admin-notification-item__main"><span class="admin-notification-item__icon" aria-hidden="true">↗</span><div><strong>${esc(item.title || 'Новое уведомление')}</strong><p>${esc(item.message || '')}</p><small>${participant ? `Участник: ${esc(participant.fio)}` : 'Участник не найден'} · ${esc(dateLabel(item.createdAt))}</small></div></div>${participant ? `<button class="admin-text-button" type="button" data-select-user="${esc(participant.id)}">Открыть участника →</button>` : ''}</article>`;
        }).join('')
        : '<p class="admin-empty">Уведомлений о новых фотографиях пока нет.</p>';
    }
  }

  /* ---------- Список команд ---------- */
  function renderTeamRow(team, index) {
    const current = workflowPresentation(team);
    const selected = selectedTeamId === team.id;
    const pending = pendingForTeam(team);
    const unread = team.unreadNotifications || 0;
    return `<button class="admin-team-row${selected ? ' is-selected' : ''}" type="button" data-select-team="${esc(team.id)}" aria-pressed="${selected}">
      <span class="admin-team-row__number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span>
      <span class="admin-team-row__copy">
        <small>${esc(team.group || 'Группа не указана')}</small>
        <strong>${esc(team.name)}</strong>
        <span class="admin-team-row__meta">${team.members?.length || 0} ${plural(team.members?.length || 0, 'участник', 'участника', 'участников')} · капитан ${esc(team.captain?.fio || 'не назначен')}</span>
      </span>
      <span class="admin-team-row__side">
        <span class="admin-status ${current.className}">${esc(current.label)}</span>
        <span class="admin-team-row__badges">
          <span class="admin-team-row__pending${pending.total ? '' : ' is-zero'}">${pending.total ? `${pending.total} ${plural(pending.total, 'решение', 'решения', 'решений')}` : 'Чисто'}</span>
          ${unread ? `<span class="admin-status admin-status--new">${unread} новых</span>` : ''}
        </span>
      </span>
    </button>`;
  }

  /* ---------- Список участников ---------- */
  function userMatches(user) {
    const team = state?.teams?.find((item) => item.id === user.teamId);
    const text = `${user.fio || ''} ${user.phone || ''} ${user.group || ''} ${team?.name || ''}`.toLowerCase();
    return (!filters.users || text.includes(filters.users.trim().toLowerCase())) && (filters.userStatus === 'all' || (user.identityStatus || 'pending') === filters.userStatus);
  }

  function userIsCaptain(user) {
    return state?.teams?.some((team) => team.id === user.teamId && team.captainId === user.id) || user.role === 'captain';
  }

  function renderUserRow(user) {
    const team = state?.teams?.find((item) => item.id === user.teamId);
    const status = user.identityStatus || 'pending';
    const label = status === 'approved' ? 'Подтверждён' : status === 'rejected' ? 'Доработка' : 'На проверке';
    const chip = status === 'approved' ? 'admin-status--ready' : status === 'rejected' ? 'admin-status--danger' : 'admin-status--pending';
    return `<button class="admin-user-row${selectedUserId === user.id ? ' is-selected' : ''}" type="button" data-select-user="${esc(user.id)}" aria-pressed="${selectedUserId === user.id}">
      <span class="admin-user-row__avatar" aria-hidden="true">${esc(initials(user.fio))}</span>
      <span class="admin-user-row__copy">
        <small>${esc(team?.name || 'Без команды')}${user.id === team?.captainId ? ' · капитан' : ''}</small>
        <strong>${esc(user.fio)}</strong>
        <span>${esc(user.phone || 'Телефон не указан')}</span>
      </span>
      <span class="admin-status ${chip}">${label}</span>
    </button>`;
  }

  /* ---------- Карточка участника ---------- */
  function renderUserDetail(user) {
    if (!user) return '<div class="admin-detail__placeholder"><span class="admin-empty-state__mark" aria-hidden="true">✦</span><h2>Выберите участника</h2><p>Откройте карточку, чтобы проверить документ и принять решение по личности.</p></div>';
    const team = state.teams.find((item) => item.id === user.teamId);
    const status = user.identityStatus || 'pending';
    const documentUrl = String(user.studentCardFile || '');
    const documentExtension = documentUrl.split('?')[0].split('.').pop()?.toLowerCase() || '';
    const documentName = esc(user.studentCardFileName || (documentExtension ? `Документ участника.${documentExtension}` : 'Документ участника'));
    const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(documentExtension);
    const isPdf = documentExtension === 'pdf';
    const documentPreview = documentUrl ? (isImage
      ? `<figure class="admin-user-document__preview admin-user-document__preview--image"><img src="${esc(documentUrl)}" alt="Предпросмотр документа участника ${esc(user.fio)}" loading="lazy"></figure>`
      : isPdf
        ? `<div class="admin-user-document__preview admin-user-document__preview--pdf"><iframe src="${esc(documentUrl)}" title="Предпросмотр документа участника ${esc(user.fio)}" loading="lazy"></iframe></div>`
        : '<div class="admin-user-document__preview admin-user-document__preview--unavailable"><span aria-hidden="true">↗</span><p>Для этого типа файла встроенный просмотр недоступен.</p><small>Откройте документ отдельной вкладкой.</small></div>')
      : '<div class="admin-user-document__preview admin-user-document__preview--unavailable"><span aria-hidden="true">—</span><p>Документ участника не прикреплён.</p><small>Без документа решение по участнику принять нельзя.</small></div>';
    const documentBlock = `<section class="admin-user-document" aria-labelledby="admin-user-document-title"><div class="admin-user-document__head"><div><p class="admin-card-kicker" id="admin-user-document-title">Документ участника</p><strong>${documentName}</strong></div>${documentUrl ? `<a class="admin-button admin-button--secondary" href="${esc(documentUrl)}" target="_blank" rel="noopener">Открыть документ ↗</a>` : ''}</div>${documentPreview}</section>`;
    const decisionCommentId = `user-decision-comment-${esc(user.id)}`;
    const decisionButtons = `<div class="admin-user-decision__choices" role="group" aria-label="Решение по участнику"><button class="admin-button admin-button--primary${status === 'approved' ? ' is-active' : ''}" type="submit" data-user-decision-action="approved" aria-pressed="${status === 'approved'}">Подтвердить участника</button><button class="admin-button admin-button--danger${status === 'rejected' ? ' is-active' : ''}" type="submit" data-user-decision-action="rejected" aria-pressed="${status === 'rejected'}" aria-controls="${decisionCommentId}">Отклонить участника</button></div>`;
    const statusChip = `<span class="admin-status ${status === 'approved' ? 'admin-status--ready' : status === 'rejected' ? 'admin-status--danger' : 'admin-status--pending'}">${status === 'approved' ? 'Подтверждён' : status === 'rejected' ? 'Доработка' : 'На проверке'}</span>`;
    const userAchievements = (state.achievements || []).filter((item) => item.userId === user.id);
    const achievementsBlock = `<section class="admin-surface admin-user-achievements" aria-labelledby="admin-user-achievements-title">
      <div class="admin-section-heading">
        <div><p class="admin-eyebrow">Портфолио участника</p><h3 id="admin-user-achievements-title">Достижения</h3></div>
        <span class="admin-section-heading__actions"><span class="admin-section-heading__count">${userAchievements.length}</span><button class="admin-text-button" type="button" data-open-achievements-user="${esc(user.id)}">Учёт достижений →</button></span>
      </div>
      ${userAchievements.length ? `<div class="admin-user-achievements__list">${userAchievements.map((item) => `
        <button class="admin-user-achievement" type="button" data-select-achievement="${esc(item.id)}">
          <span class="admin-user-achievement__icon admin-achievement-row__icon--${esc(item.direction || 'science')}" aria-hidden="true">${directionIcons[item.direction] || directionIcons.science}</span>
          <span class="admin-user-achievement__copy"><small>${esc(directionLabels[item.direction] || 'Направление')} · ${esc(item.category || 'без категории')}</small><strong>${esc(item.title || 'Достижение без названия')}</strong></span>
          <span class="admin-user-achievement__side">${item.points != null ? `<span class="admin-achievement-row__points">${Number(item.points)} б.</span>` : ''}${achievementStatusChip(item.status)}</span>
        </button>`).join('')}</div>` : '<p class="admin-empty">Участник ещё не добавил достижений в портфолио.</p>'}
    </section>`;
    return `<div class="admin-detail__topbar"><button class="admin-user-back" type="button" data-user-back>← Все участники</button><span>Карточка участника</span></div>
    <section class="admin-surface admin-user-card">
      <header class="admin-user-card__header">
        <div><p class="admin-card-kicker">${user.id === team?.captainId ? 'Капитан команды' : 'Участник'} · ${esc(team?.name || 'Без команды')}</p><h2>${esc(user.fio)}</h2><p>${esc(user.phone || 'Телефон не указан')} · ${esc(user.group || team?.group || 'Группа не указана')}</p></div>
        <div class="admin-user-card__header__side">${statusChip}<span class="admin-user-card__header__links"><button class="admin-text-button" type="button" data-select-team="${esc(team?.id || '')}">Открыть команду →</button></span></div>
      </header>
      ${documentBlock}
      <form class="admin-user-decision-form" data-user-decision="${esc(user.id)}">
        <input type="hidden" data-user-decision-status value="${status}">
        ${decisionButtons}
        <label class="admin-field admin-user-decision-comment admin-comment-field" style="margin-top:12px"${status === 'rejected' ? '' : ' hidden'}><span>Почему отклоняете участника</span><textarea class="admin-control admin-control--roomy" id="${decisionCommentId}" rows="4" data-user-decision-comment placeholder="Например: приложите более чёткий документ с читаемыми данными."${status === 'rejected' ? ' required' : ''}>${esc(user.identityComment || '')}</textarea></label>
        <p class="admin-user-decision-hint" data-user-decision-hint>Подтверждение отправится сразу. Для отклонения сначала укажите причину.</p>
      </form>
    </section>
    ${achievementsBlock}`;
  }

  /* ---------- Синхронизация видимости комментариев ---------- */
  function syncReviewCommentVisibility(root) {
    root?.querySelectorAll('[data-member-review-item]').forEach((item) => {
      const wrap = item.querySelector('.admin-member-review__comment');
      if (wrap) wrap.hidden = item.dataset.memberReviewChoice !== 'rejected';
    });
    root?.querySelectorAll('[data-team-review-item]').forEach((item) => {
      const wrap = item.querySelector('[data-team-review-comment-wrap]');
      if (wrap) wrap.hidden = item.dataset.teamReviewChoice !== 'rejected';
    });
    root?.querySelectorAll('[data-user-decision-status]').forEach((input) => {
      const form = input.closest('form');
      const choice = input.value;
      const wrap = form?.querySelector('.admin-user-decision-comment');
      if (wrap) wrap.hidden = choice !== 'rejected';
      const textarea = wrap?.querySelector('[data-user-decision-comment]');
      if (textarea) textarea.required = choice === 'rejected';
      form?.querySelectorAll('[data-user-decision-action]').forEach((button) => {
        const active = button.dataset.userDecisionAction === choice;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    });
    root?.querySelectorAll('[data-achievement-review-item]').forEach((item) => {
      const wrap = item.querySelector('.admin-achievement-review__comment');
      if (wrap) wrap.hidden = item.dataset.achievementReviewChoice !== 'rejected';
    });
  }

  function renderUsers() {
    if (!state) return;
    const list = $('adminUsersList');
    const detail = $('adminUserDetail');
    const workspace = $('adminUsersWorkspace');
    const users = (state.users || []).filter(userMatches);
    const captains = users.filter(userIsCaptain);
    const participants = users.filter((user) => !userIsCaptain(user));
    if ($('adminUsersCount')) $('adminUsersCount').textContent = state.users?.length || 0;
    if (selectedUserId && !state.users.some((user) => user.id === selectedUserId)) selectedUserId = null;

    if (list) {
      if (!users.length) {
        list.innerHTML = '<div class="admin-empty-state"><span class="admin-empty-state__mark" aria-hidden="true">⌕</span><h3>Участники не найдены</h3><p>Измените запрос или фильтр статуса.</p></div>';
      } else {
        const heading = `<div class="admin-master__heading"><span>Список участников</span><span>${users.length} из ${state.users.length}</span></div>`;
        const group = (title, id, rows, count) => `<p class="admin-master__heading" id="${id}" style="padding-top:6px"><span>${title}</span><span>${count}</span></p><div class="admin-master__list">${rows}</div>`;
        const captainRows = captains.map(renderUserRow).join('');
        const participantRows = participants.map(renderUserRow).join('');
        const body = captains.length
          ? `<section aria-labelledby="admin-captains-title">${group('Капитаны', 'admin-captains-title', captainRows, captains.length)}</section>${participants.length ? `<section aria-labelledby="admin-participants-title">${group('Участники', 'admin-participants-title', participantRows, participants.length)}</section>` : ''}`
          : `<div class="admin-master__list">${participantRows}</div>`;
        list.innerHTML = heading + body;
      }
    }

    const selected = state.users.find((user) => user.id === selectedUserId);
    if (selected) {
      workspace?.classList.add('is-filled');
      if (detail) { detail.hidden = false; detail.innerHTML = renderUserDetail(selected); syncReviewCommentVisibility(detail); }
    } else {
      workspace?.classList.remove('is-filled');
      if (detail) { detail.hidden = false; detail.innerHTML = renderUserDetail(null); }
    }
  }

  /* ---------- Карточка команды ---------- */
  function renderTeamStage(team) {
    const current = workflowPresentation(team);
    const stageKey = current.key === 'needs-work' ? 'needs-work' : current.key === 'ready' ? 'ready' : current.key === 'review' ? 'review' : 'new';
    const stageIcon = stageKey === 'ready' ? '✓' : stageKey === 'needs-work' ? '!' : stageKey === 'review' ? '…' : '○';
    return `<section class="admin-team-stage admin-team-stage--${stageKey}" aria-labelledby="team-stage-title"><div class="admin-team-stage__icon" aria-hidden="true">${stageIcon}</div><div class="admin-team-stage__summary"><p class="admin-eyebrow">Текущая стадия команды</p><h3 id="team-stage-title">${esc(workflowMeta[stageKey].label)}</h3><p>${esc(current.reason || workflowMeta[stageKey].note)}</p></div></section>`;
  }

  function renderTeamProfileReview(team) {
    const labels = { name: 'Название команды', group: 'Учебная группа', flag: 'Флаг команды', description: 'Описание команды' };
    const values = { name: team.name, group: team.group, flag: team.flagUrl ? 'Файл флага загружен' : 'Флаг не загружен', description: team.description || 'Описание не добавлено' };
    return `<form class="admin-surface admin-team-profile-review" data-team-profile-review="${esc(team.id)}" aria-labelledby="team-profile-review-title">
      <div class="admin-section-heading"><div><p class="admin-eyebrow">Проверка заявки</p><h3 id="team-profile-review-title">Данные команды</h3></div><span class="admin-team-profile-review__hint">Выберите решение и отправьте его</span></div>
      <div class="admin-team-profile-review__list">${Object.entries(labels).map(([field, label]) => {
        const review = team.review?.[field] || { status: 'pending', comment: '' };
        const status = review.status === 'approved' || review.status === 'rejected' ? review.status : '';
        return `<article class="admin-team-profile-item is-${status || 'pending'}" data-team-review-item="${field}" data-team-review-choice="${status}">
          <div class="admin-team-profile-item__value"><span>${label}</span><strong>${esc(values[field])}</strong>${field === 'flag' && team.flagUrl ? `<a class="admin-inline-link" href="${esc(team.flagUrl)}" target="_blank" rel="noopener">Открыть флаг ↗</a>` : ''}</div>
          <div class="admin-team-profile-item__decision">
            <div class="admin-review-buttons" role="group" aria-label="Решение по полю ${label}"><button class="admin-review-choice admin-review-choice--approve${status === 'approved' ? ' is-active' : ''}" type="button" data-team-review-action="${field}" data-team-review-value="approved">Подтвердить</button><button class="admin-review-choice admin-review-choice--reject${status === 'rejected' ? ' is-active' : ''}" type="button" data-team-review-action="${field}" data-team-review-value="rejected">Отклонить</button></div>
            <label class="admin-team-profile-item__comment admin-comment-field" data-team-review-comment-wrap="${field}"${status === 'rejected' ? '' : ' hidden'}><span>Почему отклонено</span><textarea class="admin-control admin-control--roomy" data-team-review-comment="${field}" rows="3" placeholder="Оставьте комментарий для команды — его увидят капитан и участники">${esc(review.comment || '')}</textarea></label>
          </div>
        </article>`;
      }).join('')}</div>
      <div class="admin-team-profile-review__footer"><p class="admin-team-profile-review__footnote">Решение отправится команде только после нажатия кнопки.</p><button class="admin-button admin-button--primary" type="submit">Отправить решение</button></div>
    </form>`;
  }

  /* ---------- Карточка команды ---------- */
  function renderTeamDetail(team) {
    if (!team) return '<div class="admin-detail__placeholder"><span class="admin-empty-state__mark" aria-hidden="true">✦</span><h2>Выберите команду</h2><p>Здесь появятся заявка, состав, портфолио и видео команды.</p></div>';
    const current = workflowPresentation(team);
    const pending = pendingForTeam(team);
    const approvedAchievements = (team.achievements || []).filter((item) => item.status === 'approved').length;
    const video = team.videoCard || { url: '', status: 'none', criteriaScores: {} };
    const scores = video.criteriaScores || {};
    const videoScore = Object.values(scores).reduce((total, value) => total + Number(value || 0), 0);

    const memberReviewsContent = team.members?.length ? [...team.members].sort((a, b) => Number(b.id === team.captainId) - Number(a.id === team.captainId)).map((member) => {
      const identityStatus = member.identityStatus || 'pending';
      const identityLabel = identityStatus === 'approved' ? 'Подтверждён' : identityStatus === 'rejected' ? 'Доработка' : 'На проверке';
      const identityChip = identityStatus === 'approved' ? 'admin-status--ready' : identityStatus === 'rejected' ? 'admin-status--danger' : 'admin-status--pending';
      const documentLink = `<button class="admin-text-button" type="button" data-select-user="${esc(member.id)}">Открыть участника →</button>${member.studentCardFile ? `<a class="admin-inline-link" href="${esc(member.studentCardFile)}" target="_blank" rel="noopener">Документ ↗</a>` : '<span class="admin-muted-text">Документ не прикреплён</span>'}`;
      return `<article class="admin-member-review" data-member-review-item="${esc(member.id)}" data-member-review-choice="${identityStatus === 'approved' || identityStatus === 'rejected' ? identityStatus : ''}">
        <header><div><p class="admin-card-kicker">${member.id === team.captainId ? 'Капитан команды' : 'Участник'}</p><h3>${esc(member.fio)}</h3><small>${esc(member.phone || 'Телефон не указан')} · ${esc(member.group || team.group || 'Группа не указана')}</small></div><span class="admin-status ${identityChip}">${identityLabel}</span></header>
        <div class="admin-review-controls">
          <div class="admin-review-controls__document">${documentLink}</div>
          <div class="admin-review-buttons" role="group" aria-label="Решение по участнику ${esc(member.fio)}"><button class="admin-review-choice admin-review-choice--approve${identityStatus === 'approved' ? ' is-active' : ''}" type="button" data-member-review-action="${esc(member.id)}" data-member-review-value="approved">Принять</button><button class="admin-review-choice admin-review-choice--reject${identityStatus === 'rejected' ? ' is-active' : ''}" type="button" data-member-review-action="${esc(member.id)}" data-member-review-value="rejected">Отклонить</button></div>
          <label class="admin-member-review__comment admin-comment-field"${identityStatus === 'rejected' ? '' : ' hidden'}><span>Почему отклонено</span><textarea class="admin-control admin-control--roomy" data-identity-comment="${esc(member.id)}" rows="3" placeholder="Что нужно исправить участнику?">${esc(member.identityComment || '')}</textarea></label>
          ${member.id !== team.captainId ? `<button class="admin-link-button admin-link-button--danger" type="button" data-remove-member="${esc(team.id)}" data-member-id="${esc(member.id)}">Удалить из команды</button>` : ''}
          <button class="admin-text-button" type="button" data-open-achievements-user="${esc(member.id)}">Достижения участника →</button>
        </div>
      </article>`;
    }).join('') : '<p class="admin-empty">В команде пока нет участников.</p>';

    const memberReviewForm = `<form class="admin-member-review-form" data-team-members-review="${esc(team.id)}"><div class="admin-team-members-review">${memberReviewsContent}</div><div class="admin-team-profile-review__footer"><p class="admin-team-profile-review__footnote">Для статуса «Доработка» укажите комментарий участнику.</p><button class="admin-button admin-button--primary" type="submit">Отправить решения по составу</button></div></form>`;

    const achievementReviews = team.achievements?.length ? team.achievements.map((item) => {
      const status = item.status || 'pending';
      const file = item.fileUrl ? `<a class="admin-inline-link" href="${esc(item.fileUrl)}" target="_blank" rel="noopener">Открыть подтверждение ↗</a>` : '<span class="admin-muted-text">Подтверждение не прикреплено</span>';
      return `<article class="admin-achievement-review" data-achievement-review-item="${esc(item.id)}" data-achievement-review-choice="${status === 'approved' || status === 'rejected' ? status : ''}" data-direction="${esc(item.direction || '')}">
        <div class="admin-achievement-review__copy"><p class="admin-card-kicker">${esc(directionLabels[item.direction] || item.direction || 'Направление')} · ${esc(item.user?.fio || 'Участник')}</p><h3>${esc(item.title || 'Достижение без названия')}</h3><p>${esc(item.details || 'Описание не добавлено.')}</p>${file}</div>
        <div class="admin-achievement-review__controls">
          <div class="admin-review-buttons" role="group" aria-label="Решение по достижению ${esc(item.title || '')}"><button class="admin-review-choice admin-review-choice--approve${status === 'approved' ? ' is-active' : ''}" type="button" data-achievement-review-action="${esc(item.id)}" data-achievement-review-value="approved">Принять</button><button class="admin-review-choice admin-review-choice--reject${status === 'rejected' ? ' is-active' : ''}" type="button" data-achievement-review-action="${esc(item.id)}" data-achievement-review-value="rejected">Отклонить</button></div>
          <input class="admin-control" data-achievement-points="${esc(item.id)}" type="number" min="0" max="100" value="${item.points ?? ''}" placeholder="Баллы" aria-label="Баллы за достижение">
          <label class="admin-achievement-review__comment admin-comment-field"${status === 'rejected' ? '' : ' hidden'}><span>Почему отклонено</span><textarea class="admin-control admin-control--roomy" data-achievement-comment="${esc(item.id)}" rows="3" placeholder="Что нужно исправить?">${esc(item.reviewComment || '')}</textarea></label>
          <button class="admin-button admin-button--secondary" type="button" data-review-achievement="${esc(item.id)}">Сохранить решение</button>
        </div>
      </article>`;
    }).join('') : '<p class="admin-empty">Команда ещё не добавила достижений.</p>';

    const videoBlock = video.url ? `<div class="admin-team-video__head"><div><p class="admin-card-kicker">Видео-визитка</p><h3>Материал команды</h3><a class="admin-inline-link" href="${esc(video.url)}" target="_blank" rel="noopener">Открыть ссылку на видео ↗</a></div><span class="admin-status ${video.status === 'approved' ? 'admin-status--ready' : video.status === 'rejected' ? 'admin-status--danger' : 'admin-status--pending'}">${esc(statusLabel[video.status] || 'На проверке')}</span></div>
      <div class="admin-score-grid">
        <label class="admin-score-field"><span>Содержание · 8</span><input class="admin-control" data-video-score="topic" data-team-id="${esc(team.id)}" type="number" min="0" max="8" value="${scores.topic ?? 0}"></label>
        <label class="admin-score-field"><span>Креативность · 8</span><input class="admin-control" data-video-score="creativity" data-team-id="${esc(team.id)}" type="number" min="0" max="8" value="${scores.creativity ?? 0}"></label>
        <label class="admin-score-field"><span>Качество · 5</span><input class="admin-control" data-video-score="quality" data-team-id="${esc(team.id)}" type="number" min="0" max="5" value="${scores.quality ?? 0}"></label>
        <label class="admin-score-field"><span>Эффекты · 2</span><input class="admin-control" data-video-score="vfx" data-team-id="${esc(team.id)}" type="number" min="0" max="2" value="${scores.vfx ?? 0}"></label>
      </div>
      <label class="admin-field admin-video-card__comment"><span>Комментарий команде</span><textarea class="admin-control admin-control--roomy" data-video-comment="${esc(team.id)}" rows="3" placeholder="Что нужно учесть при доработке">${esc(video.reviewComment || '')}</textarea></label>
      <div class="admin-video-card__actions"><button class="admin-button admin-button--primary" type="button" data-save-video="${esc(team.id)}">Принять и сохранить · ${videoScore} / 23</button><button class="admin-button admin-button--secondary" type="button" data-reject-video="${esc(team.id)}">Вернуть на уточнение</button></div>
      ${video.score != null ? `<div class="admin-video-card__score"><strong>${video.score} / 23</strong><span>Итоговая оценка сохранена</span></div>` : ''}` : '<p class="admin-empty">Видео-визитка ещё не отправлена капитаном.</p>';

    return `<div class="admin-detail__topbar"><button class="admin-team-back" type="button" data-team-back>← Все команды</button><span>Управление командой</span></div>
    <section class="admin-surface admin-team-head-card">
      <header class="admin-team-head">
        <div><p class="admin-card-kicker">Команда · ${esc(team.group || 'Группа не указана')}</p><h2>${esc(team.name)}</h2><p>${esc(team.description || 'Описание команды ещё не добавлено.')}</p></div>
        <div class="admin-team-head__side"><span class="admin-status ${current.className}">${esc(current.label)}</span><span class="admin-team-head__links"><button class="admin-text-button" type="button" data-admin-view-target="rating">Открыть в рейтинге →</button></span></div>
      </header>
      <div class="admin-team-stats">
        <div class="admin-team-stat"><span>Состав</span><strong class="is-accent">${team.quota?.members || 0} / ${team.quota?.total || 0}</strong><small>${team.quota?.eligible ? 'Минимум набран' : `Нужно ещё ${Math.max(0, (team.quota?.required || 0) - (team.quota?.members || 0))}`}</small></div>
        <div class="admin-team-stat"><span>Достижения</span><strong class="is-accent">${approvedAchievements} / ${team.achievements?.length || 0}</strong><small>${pending.achievements} на проверке</small></div>
        <div class="admin-team-stat"><span>Видео</span><strong class="is-accent">${video.status === 'approved' ? `${video.score || 0} / 23` : (statusLabel[video.status] || 'Не отправлено')}</strong><small>${pending.video ? 'Ожидает решения' : 'Статус материала'}</small></div>
        <div class="admin-team-stat"><span>Капитан</span><strong class="is-accent">${esc(team.captain?.fio || 'не назначен')}</strong><small>${esc(team.captain?.phone || 'телефон не указан')}</small></div>
      </div>
    </section>
    ${renderTeamStage(team)}
    ${renderTeamProfileReview(team)}
    <section class="admin-surface admin-team-section" aria-labelledby="team-members-title"><div class="admin-section-heading"><div><p class="admin-eyebrow">Состав и документы</p><h3 id="team-members-title">Участники команды</h3></div><span class="admin-section-heading__count">${team.members?.length || 0}</span></div>${memberReviewForm}</section>
    <section class="admin-surface admin-team-section" aria-labelledby="team-achievements-title"><div class="admin-section-heading"><div><p class="admin-eyebrow">Портфолио команды</p><h3 id="team-achievements-title">Достижения</h3></div><span class="admin-section-heading__actions"><span class="admin-section-heading__count">${team.achievements?.length || 0}</span><button class="admin-text-button" type="button" data-open-achievements-team="${esc(team.id)}">Учёт достижений →</button></span></div><div class="admin-team-achievements-review">${achievementReviews}</div></section>
    <section class="admin-surface admin-team-section" aria-labelledby="team-video-title"><div class="admin-section-heading"><div><p class="admin-eyebrow">Материал команды</p><h3 id="team-video-title">Видео-визитка</h3></div><span class="admin-section-heading__count">${video.status === 'pending' ? '1' : '0'}</span></div><div class="admin-team-video">${videoBlock}</div></section>
    <label class="admin-toggle admin-team-quota"><input type="checkbox" data-team-quota="${esc(team.id)}"${team.isQuotaConfirmed ? ' checked' : ''}><span><strong>Квота состава проверена вручную</strong><small>Отметка оргкомитета для этой заявки.</small></span></label>`;
  }

  function renderTeams() {
    if (!state) return;
    const list = $('adminTeamsList');
    const detail = $('adminTeamDetail');
    const workspace = $('adminTeamsWorkspace');
    const teams = state.teams.filter((team) => teamMatches(team, filters.teams, filters.teamStatus));
    if ($('adminTeamsCount')) $('adminTeamsCount').textContent = state.teams.length;
    if ($('adminTeamNotificationsCount')) $('adminTeamNotificationsCount').textContent = state.summary?.notifications || 0;
    if (selectedTeamId && !state.teams.some((team) => team.id === selectedTeamId)) selectedTeamId = null;
    if (list) list.innerHTML = teams.length ? `<div class="admin-master__heading"><span>Список команд</span><span>${teams.length} из ${state.teams.length}</span></div><div class="admin-master__list">${teams.map((team, index) => renderTeamRow(team, index)).join('')}</div>` : '<div class="admin-empty-state"><span class="admin-empty-state__mark" aria-hidden="true">⌕</span><h3>Команды не найдены</h3><p>Измените запрос или фильтр статуса.</p></div>';
    const selected = state.teams.find((team) => team.id === selectedTeamId);
    if (selected) {
      workspace?.classList.add('is-filled');
      if (detail) { detail.hidden = false; detail.innerHTML = renderTeamDetail(selected); syncReviewCommentVisibility(detail); }
    } else {
      workspace?.classList.remove('is-filled');
      if (detail) { detail.hidden = false; detail.innerHTML = renderTeamDetail(null); }
    }
  }

  /* ---------- Учёт достижений ---------- */
  function achievementTeam(achievement) {
    const teamId = achievement?.user?.teamId || '';
    return state?.teams?.find((team) => team.id === teamId) || null;
  }

  function achievementMatches(achievement) {
    const team = achievementTeam(achievement);
    const owner = achievement.user || {};
    const text = `${achievement.title || ''} ${achievement.details || ''} ${achievement.category || ''} ${owner.fio || ''} ${team?.name || ''} ${team?.group || ''} ${directionLabels[achievement.direction] || ''}`.toLowerCase();
    const textMatches = !filters.achievements || text.includes(filters.achievements.trim().toLowerCase());
    const statusMatches = filters.achievementStatus === 'all' || (achievement.status || 'pending') === filters.achievementStatus;
    const directionMatches = filters.achievementDirection === 'all' || achievement.direction === filters.achievementDirection;
    const teamMatches = !filters.achievementTeamId || (team?.id || '') === filters.achievementTeamId;
    const userMatches = !filters.achievementUserId || (achievement.userId || '') === filters.achievementUserId;
    return textMatches && statusMatches && directionMatches && teamMatches && userMatches;
  }

  function achievementStatusChip(status) {
    const meta = { approved: ['Принято', 'admin-status--ready'], rejected: ['Доработка', 'admin-status--danger'] }[status] || ['На проверке', 'admin-status--pending'];
    return `<span class="admin-status ${meta[1]}">${meta[0]}</span>`;
  }

  function renderAchievementRow(achievement) {
    const team = achievementTeam(achievement);
    const status = achievement.status || 'pending';
    const selected = selectedAchievementId === achievement.id;
    return `<button class="admin-achievement-row${selected ? ' is-selected' : ''}" type="button" data-select-achievement="${esc(achievement.id)}" aria-pressed="${selected}">
      <span class="admin-achievement-row__icon admin-achievement-row__icon--${esc(achievement.direction || 'science')}" aria-hidden="true">${directionIcons[achievement.direction] || directionIcons.science}</span>
      <span class="admin-achievement-row__copy">
        <small>${esc(directionLabels[achievement.direction] || 'Направление')} · ${esc(achievement.category || 'без категории')}</small>
        <strong>${esc(achievement.title || 'Достижение без названия')}</strong>
        <span class="admin-achievement-row__meta">${esc(achievement.user?.fio || 'Удалённый пользователь')}${team ? ` · ${esc(team.name)}` : ' · без команды'}</span>
      </span>
      <span class="admin-achievement-row__side">
        ${achievement.points != null ? `<span class="admin-achievement-row__points">${Number(achievement.points)} б.</span>` : ''}
        ${achievementStatusChip(status)}
      </span>
    </button>`;
  }

  function renderAchievementDetail(achievement) {
    if (!achievement) {
      const filterNote = filters.achievementTeamId || filters.achievementUserId
        ? 'Фильтр по команде или участнику активен — сбросьте его, чтобы увидеть все материалы.'
        : 'Откройте материал, чтобы проверить документ, выставить баллы и принять решение.';
      return `<div class="admin-detail__placeholder"><span class="admin-empty-state__mark" aria-hidden="true">✦</span><h2>Выберите достижение</h2><p>${esc(filterNote)}</p></div>`;
    }
    const team = achievementTeam(achievement);
    const owner = achievement.user || {};
    const status = achievement.status || 'pending';
    const documentUrl = String(achievement.fileUrl || '');
    const extension = documentUrl.split('?')[0].split('.').pop()?.toLowerCase() || '';
    const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(extension);
    const isPdf = extension === 'pdf';
    const documentBlock = documentUrl ? (isImage
      ? `<figure class="admin-user-document__preview admin-user-document__preview--image"><img src="${esc(documentUrl)}" alt="Подтверждение достижения ${esc(achievement.title || '')}" loading="lazy"></figure>`
      : isPdf
        ? `<div class="admin-user-document__preview admin-user-document__preview--pdf"><iframe src="${esc(documentUrl)}" title="Подтверждение достижения" loading="lazy"></iframe></div>`
        : '<div class="admin-user-document__preview admin-user-document__preview--unavailable"><span aria-hidden="true">↗</span><p>Для этого типа файла встроенный просмотр недоступен.</p><small>Откройте документ отдельной вкладкой.</small></div>')
      : '<p class="admin-empty">Подтверждающий документ не прикреплён.</p>';

    return `<div class="admin-detail__topbar"><button class="admin-team-back" type="button" data-achievement-back>← Все достижения</button><span>Карточка решения</span></div>
    <section class="admin-surface admin-achievement-detail-card">
      <header class="admin-team-head">
        <div>
          <p class="admin-card-kicker">${esc(directionLabels[achievement.direction] || 'Направление')} · ${esc(achievement.category || 'без категории')}</p>
          <h2>${esc(achievement.title || 'Достижение без названия')}</h2>
          <p>${esc(achievement.details || 'Описание не добавлено.')}</p>
        </div>
        <div class="admin-team-head__side">${achievementStatusChip(status)}</div>
      </header>
      <div class="admin-achievement-detail__links">
        <button class="admin-text-button" type="button" data-select-user="${esc(owner.id || '')}">Открыть участника: ${esc(owner.fio || '—')} →</button>
        ${team ? `<button class="admin-text-button" type="button" data-select-team="${esc(team.id)}">Открыть команду: ${esc(team.name)} →</button>` : '<span class="admin-muted-text">Участник без команды</span>'}
        ${documentUrl ? `<a class="admin-inline-link" href="${esc(documentUrl)}" target="_blank" rel="noopener">Документ: ${esc(achievement.fileName || 'подтверждение')} ↗</a>` : ''}
      </div>
      <div class="admin-achievement-detail__meta">
        <div><span>Добавлено</span><strong>${shortDateLabel(achievement.createdAt)}</strong></div>
        <div><span>Рассмотрено</span><strong>${achievement.reviewedAt ? dateLabel(achievement.reviewedAt) : '—'}</strong></div>
        <div><span>Баллы</span><strong>${achievement.points != null ? `${Number(achievement.points)} б.` : 'не выставлены'}</strong></div>
      </div>
      ${achievement.reviewComment ? `<blockquote class="admin-achievement-detail__comment"><span>Комментарий проверки</span><p>${esc(achievement.reviewComment)}</p></blockquote>` : ''}
      <div class="admin-achievement-detail__document">
        <p class="admin-eyebrow">Подтверждающий документ</p>
        ${documentBlock}
      </div>
    </section>
    <section class="admin-surface admin-team-section" aria-labelledby="achievement-review-title">
      <div class="admin-section-heading">
        <div><p class="admin-eyebrow">Решение оргкомитета</p><h3 id="achievement-review-title">Принять достижение</h3></div>
        <span class="admin-soft-mark">★</span>
      </div>
      <div class="admin-achievement-review-form" data-achievement-review-item="${esc(achievement.id)}" data-achievement-review-choice="${status === 'approved' || status === 'rejected' ? status : ''}">
        <div class="admin-review-buttons" role="group" aria-label="Решение по достижению">
          <button class="admin-review-choice admin-review-choice--approve${status === 'approved' ? ' is-active' : ''}" type="button" data-achievement-review-action="${esc(achievement.id)}" data-achievement-review-value="approved">Принять</button>
          <button class="admin-review-choice admin-review-choice--reject${status === 'rejected' ? ' is-active' : ''}" type="button" data-achievement-review-action="${esc(achievement.id)}" data-achievement-review-value="rejected">Отклонить</button>
        </div>
        <label class="admin-score-field admin-achievement-review__points"><span>Баллы за достижение · 0–100</span><input class="admin-control" data-achievement-points="${esc(achievement.id)}" type="number" min="0" max="100" value="${achievement.points ?? ''}" placeholder="Например, 10"></label>
        <label class="admin-achievement-review__comment admin-comment-field"${status === 'rejected' ? '' : ' hidden'}><span>Почему отклонено</span><textarea class="admin-control admin-control--roomy" data-achievement-comment="${esc(achievement.id)}" rows="4" placeholder="Что нужно исправить участнику?">${esc(achievement.reviewComment || '')}</textarea></label>
        <div class="admin-video-card__actions">
          <button class="admin-button admin-button--primary" type="button" data-review-achievement="${esc(achievement.id)}">Сохранить решение</button>
          <button class="admin-button admin-button--secondary" type="button" data-achievement-reset>Сбросить выбор</button>
        </div>
        <p class="admin-team-profile-review__footnote">Баллы учитываются в рейтинге группы только после принятия. Отклонение требует комментария.</p>
      </div>
    </section>`;
  }

  function renderAchievements() {
    if (!state) return;
    const list = $('adminAchievementsList');
    const detail = $('adminAchievementDetail');
    const workspace = $('adminAchievementsWorkspace');
    const achievements = (state.achievements || []).filter(achievementMatches);
    const all = state.achievements || [];
    const pendingCount = all.filter((item) => item.status === 'pending').length;
    if ($('adminAchievementsCount')) $('adminAchievementsCount').textContent = all.length;
    if ($('adminAchievementsPendingCount')) $('adminAchievementsPendingCount').textContent = pendingCount;
    if (selectedAchievementId && !all.some((item) => item.id === selectedAchievementId)) selectedAchievementId = null;

    if (list) {
      const team = filters.achievementTeamId ? state.teams.find((item) => item.id === filters.achievementTeamId) : null;
      const owner = filters.achievementUserId ? state.users.find((item) => item.id === filters.achievementUserId) : null;
      const scopeNote = team ? `Команда «${team.name}»` : owner ? `Участник ${owner.fio}` : '';
      const scopeChip = scopeNote ? `<div class="admin-filter-scope">${scopeNote}<button type="button" data-achievement-scope-reset aria-label="Сбросить фильтр">Сбросить ✕</button></div>` : '';
      list.innerHTML = achievements.length
        ? `<div class="admin-master__heading"><span>${scopeNote ? 'Материалы в фильтре' : 'Все достижения'}</span><span>${achievements.length} из ${all.length}</span></div>${scopeChip}<div class="admin-master__list">${achievements.map(renderAchievementRow).join('')}</div>`
        : `<div class="admin-empty-state"><span class="admin-empty-state__mark" aria-hidden="true">⌕</span><h3>Достижения не найдены</h3><p>Измените запрос, статус или направление.</p></div>`;
    }

    const selected = all.find((item) => item.id === selectedAchievementId);
    if (selected) {
      workspace?.classList.add('is-filled');
      if (detail) { detail.hidden = false; detail.innerHTML = renderAchievementDetail(selected); syncReviewCommentVisibility(detail); }
    } else {
      workspace?.classList.remove('is-filled');
      if (detail) { detail.hidden = false; detail.innerHTML = renderAchievementDetail(null); }
    }
  }

  function selectAchievement(achievementId) {
    if (!state?.achievements?.some((item) => item.id === achievementId)) return;
    selectedAchievementId = achievementId;
    switchAdminTab('achievements');
    renderAchievements();
    const detail = $('adminAchievementDetail');
    if (detail && window.innerWidth < 1024) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- Рейтинг групп ---------- */
  function ratingRows() {
    return (state?.teams || []).map((team) => {
      const achievements = team.achievements || [];
      const approved = achievements.filter((item) => item.status === 'approved');
      const achievementPoints = approved.reduce((sum, item) => sum + Number(item.points || 0), 0);
      const video = team.videoCard || { status: 'none', score: null };
      const videoPoints = video.status === 'approved' ? Number(video.score || 0) : 0;
      const byDirection = {};
      approved.forEach((item) => { byDirection[item.direction] = (byDirection[item.direction] || 0) + Number(item.points || 0); });
      return {
        team,
        admitted: team.isAdmitted === true,
        approvedCount: approved.length,
        totalCount: achievements.length,
        pendingCount: achievements.filter((item) => item.status === 'pending').length,
        achievementPoints,
        videoPoints,
        videoStatus: video.status,
        total: achievementPoints + videoPoints,
        byDirection
      };
    }).sort((left, right) => right.total - left.total || right.achievementPoints - left.achievementPoints || (left.team.name || '').localeCompare(right.team.name || '', 'ru'));
  }

  function renderRating() {
    const board = $('adminRatingBoard');
    if (!board || !state) return;
    const rows = ratingRows();
    const inRace = rows.filter((row) => row.admitted);
    if ($('adminRatingTeamsCount')) $('adminRatingTeamsCount').textContent = inRace.length;
    const maxTotal = Math.max(1, ...rows.map((row) => row.total));

    if (!rows.length) {
      board.innerHTML = '<div class="admin-empty-state"><span class="admin-empty-state__mark" aria-hidden="true">★</span><h3>Рейтинг пока пуст</h3><p>Зарегистрируйте команды — баллы появятся после первых принятых достижений.</p></div>';
      return;
    }

    const medals = ['gold', 'silver', 'bronze'];
    const podiumOrder = [1, 0, 2];
    const podium = rows.slice(0, 3);
    const podiumHtml = podium.length ? `<div class="admin-podium" aria-label="Пьедестал лидеров">${podiumOrder.filter((index) => podium[index]).map((index) => {
      const row = podium[index];
      const place = index + 1;
      return `<button class="admin-podium__place admin-podium__place--${medals[index]}${row.admitted ? '' : ' is-shadow'}" type="button" data-select-team="${esc(row.team.id)}">
        <span class="admin-podium__medal" aria-hidden="true">${place}</span>
        <strong class="admin-podium__name">${esc(row.team.name)}</strong>
        <small class="admin-podium__group">${esc(row.team.group || 'Группа не указана')}</small>
        <span class="admin-podium__score">${row.total}<small>баллов</small></span>
        <span class="admin-podium__breakdown">${row.achievementPoints} б. достижения · ${row.videoPoints} б. видео</span>
        ${row.admitted ? '' : '<span class="admin-podium__note">вне зачёта</span>'}
      </button>`;
    }).join('')}</div>` : '';

    const tableRows = rows.map((row, index) => {
      const place = index + 1;
      const width = Math.round((row.total / maxTotal) * 100);
      const workflowNow = workflowPresentation(row.team);
      return `<button class="admin-rating-row${row.admitted ? '' : ' is-shadow'}" type="button" data-select-team="${esc(row.team.id)}" aria-label="Открыть команду ${esc(row.team.name)}">
        <span class="admin-rating-row__place${place <= 3 ? ` admin-rating-row__place--${medals[place - 1]}` : ''}">${place}</span>
        <span class="admin-rating-row__copy">
          <small>${esc(row.team.group || 'Группа не указана')} · ${row.team.members?.length || 0} ${plural(row.team.members?.length || 0, 'участник', 'участника', 'участников')}</small>
          <strong>${esc(row.team.name)}</strong>
          <span class="admin-rating-row__bar" aria-hidden="true"><i style="width:${Math.max(4, width)}%"></i></span>
          <span class="admin-rating-row__directions">${Object.entries(directionLabels).map(([key, label]) => row.byDirection[key] ? `<b>${label} ${row.byDirection[key]}</b>` : '').join('') || 'принятых достижений пока нет'}</span>
        </span>
        <span class="admin-rating-row__score">
          <strong>${row.total}</strong>
          <small>${row.achievementPoints} дост. + ${row.videoPoints} видео</small>
          <small>${row.approvedCount} / ${row.totalCount} ${plural(row.totalCount, 'достижение', 'достижения', 'достижений')}${row.pendingCount ? ` · ${row.pendingCount} на проверке` : ''}</small>
          <span class="admin-status ${row.admitted ? 'admin-status--ready' : 'admin-status--pending'}">${row.admitted ? 'В зачёте' : esc(workflowNow.label)}</span>
        </span>
      </button>`;
    }).join('');

    const notAdmittedNote = rows.length - inRace.length;
    board.innerHTML = `${podiumHtml}
    <section class="admin-surface admin-rating-table" aria-labelledby="admin-rating-table-title">
      <div class="admin-section-heading">
        <div><p class="admin-eyebrow">Полная таблица</p><h2 id="admin-rating-table-title">Баллы всех групп</h2></div>
        <span class="admin-section-heading__count">${rows.length}</span>
      </div>
      <div class="admin-rating-table__rows">${tableRows}</div>
      ${notAdmittedNote ? `<p class="admin-rating-note">Отмеченные как «вне зачёта» команды не прошли допуск: нажмите карточку, чтобы открыть проверку состава и заявки.</p>` : ''}
    </section>`;
  }

  /* ---------- Настройки и контент ---------- */
  function renderSettings() {
    const settings = state?.settings || {};
    ['registrationStart', 'registrationDeadline', 'portfolioStart', 'portfolioDeadline', 'videoStart', 'videoDeadline', 'resultsStart', 'resultsDeadline'].forEach((key) => {
      const input = $(`${key}Input`);
      if (input) input.value = localDateValue(settings[key]);
    });
    if ($('regIsOpenCheckbox')) $('regIsOpenCheckbox').checked = settings.isRegistrationOpen !== false;
    updateCounters();

    document.querySelectorAll('[data-phase-card]').forEach((card) => {
      const phase = phaseKeys.find((item) => item.key === card.dataset.phaseCard);
      const chip = card.querySelector('[data-phase-status]');
      if (!phase || !chip) return;
      let phaseKey = phaseState(settings, phase.start, phase.end);
      if (phase.key === 'registration' && phaseKey === 'active' && settings.isRegistrationOpen === false) phaseKey = 'closed';
      const meta = { active: ['active', 'Идёт'], done: ['done', 'Завершён'], upcoming: ['upcoming', 'Скоро'], none: ['none', 'Не задан'], closed: ['upcoming', 'Закрыт вручную'] }[phaseKey];
      chip.className = `admin-phase-chip admin-phase-chip--${meta[0]}`;
      chip.textContent = meta[1];
    });
  }

  function renderTargetSuboptions() {
    const type = document.querySelector('input[name="notifTargetType"]:checked')?.value || 'all';
    const group = $('notifTargetIdGroup');
    const select = $('notifTargetId');
    if (!group || !select) return;
    const needsTarget = type === 'team' || type === 'captain' || type === 'user';
    group.hidden = !needsTarget;
    select.required = needsTarget;
    if (!needsTarget) { select.innerHTML = ''; return; }
    const teamOf = (userId) => state?.teams?.find((team) => team.id === userId?.teamId);
    const options = type === 'team' || type === 'captain'
      ? (state?.teams || []).map((team) => {
          const captain = team.captainId ? state?.users?.find((user) => user.id === team.captainId) : null;
          const captainNote = captain ? ` · капитан: ${captain.fio}` : ' · капитан не назначен';
          return `<option value="${esc(team.id)}">${esc(team.name)} (${esc(team.group || 'без группы')})${esc(captainNote)}</option>`;
        })
      : (state?.users || []).map((user) => {
          const team = teamOf(user);
          const isCaptain = team?.captainId === user.id || user.role === 'captain';
          return `<option value="${esc(user.id)}">${esc(user.fio)}${isCaptain ? ' ★ капитан' : ''} · ${esc(team?.name || 'без команды')}</option>`;
        });
    select.innerHTML = options.join('') || '<option value="">Нет доступных адресатов</option>';
    if ($('notifTargetIdLabel')) {
      $('notifTargetIdLabel').textContent = type === 'user' ? 'Выберите участника (★ — капитаны)' : type === 'captain' ? 'Команда, чей капитан получит письмо' : 'Выберите команду';
    }
  }

  /* ---------- Счётчики символов ---------- */
  function updateCounters(root = document) {
    root.querySelectorAll('[data-counter]').forEach((field) => {
      const out = field.parentElement?.querySelector('[data-counter-out]');
      if (!out) return;
      const max = Number(field.getAttribute('maxlength')) || 0;
      const length = field.value?.length || 0;
      out.textContent = max ? `${length} / ${max}` : String(length);
      out.classList.toggle('is-warn', max > 0 && length > max * 0.9);
    });
  }

  /* ---------- Обновление данных ---------- */
  async function refreshAdmin() {
    const button = $('adminRefreshBtn');
    button?.classList.add('is-loading');
    try {
      const nextState = await window.lugStore.adminOverview();
      const incomingAdminNotifications = (nextState.adminNotifications || []).filter((item) => !knownAdminNotificationIds.has(item.id));
      if (adminNotificationsInitialized) {
        incomingAdminNotifications.slice(0, 3).forEach((item) => showToast('Новое уведомление', item.message || item.title, 'info', 7000));
      }
      knownAdminNotificationIds = new Set((nextState.adminNotifications || []).map((item) => item.id));
      adminNotificationsInitialized = true;
      state = nextState;
      renderOverview();
      renderTeams();
      renderAchievements();
      renderRating();
      renderUsers();
      renderSettings();
      renderTargetSuboptions();
      const summary = state.summary || {};
      if ($('navTeamsCount')) $('navTeamsCount').textContent = summary.teams || 0;
      if ($('navUsersCount')) $('navUsersCount').textContent = summary.users || 0;
      const queueTotal = Number(summary.pendingIdentity || 0) + Number(summary.pendingAchievements || 0) + Number(summary.pendingVideos || 0);
      if ($('navQueueCount')) {
        $('navQueueCount').textContent = queueTotal;
        $('navQueueCount').hidden = queueTotal === 0;
      }
      if ($('navAchievementsCount')) {
        $('navAchievementsCount').textContent = summary.pendingAchievements || 0;
        $('navAchievementsCount').hidden = !Number(summary.pendingAchievements || 0);
      }
    } finally {
      button?.classList.remove('is-loading');
    }
  }

  /* ---------- Действия ---------- */
  async function reviewAchievement(achievementId) {
    await run(async () => {
      const item = document.querySelector(`[data-achievement-review-item="${CSS.escape(achievementId)}"]`);
      const status = item?.dataset.achievementReviewChoice || '';
      const points = document.querySelector(`[data-achievement-points="${CSS.escape(achievementId)}"]`)?.value;
      const comment = document.querySelector(`[data-achievement-comment="${CSS.escape(achievementId)}"]`)?.value.trim() || '';
      if (!status) { showError('Выберите: принять достижение или отклонить его.'); return; }
      if (status === 'rejected' && !comment) { showError('Для отклонённого достижения укажите причину.'); document.querySelector(`[data-achievement-comment="${CSS.escape(achievementId)}"]`)?.focus(); return; }
      await window.lugStore.adminReviewAchievement(achievementId, { status, points, comment });
      showToast('Готово', 'Решение по достижению сохранено.', 'success');
      await refreshAdmin();
    });
  }

  async function reviewVideo(teamId, status) {
    await run(async () => {
      const scores = {};
      document.querySelectorAll(`[data-video-score][data-team-id="${CSS.escape(teamId)}"]`).forEach((input) => { scores[input.dataset.videoScore] = input.value; });
      const comment = document.querySelector(`[data-video-comment="${CSS.escape(teamId)}"]`)?.value || '';
      await window.lugStore.adminReviewVideo(teamId, { status, criteriaScores: scores, comment });
      showToast('Готово', status === 'approved' ? 'Видео принято, оценка сохранена.' : 'Видео возвращено на уточнение.', 'success');
      await refreshAdmin();
    });
  }

  async function submitTeamProfileReview(event) {
    event.preventDefault();
    const form = event.target;
    const button = event.submitter || form.querySelector('[type="submit"]');
    await busy(button, () => run(async () => {
      const decisions = Array.from(form.querySelectorAll('[data-team-review-item]')).map((item) => ({
        field: item.dataset.teamReviewItem,
        status: item.dataset.teamReviewChoice || '',
        comment: item.querySelector('[data-team-review-comment]')?.value.trim() || ''
      }));
      const missing = decisions.find((item) => !item.status);
      if (missing) {
        showError('Выберите решение по каждому полю заявки.');
        form.querySelector(`[data-team-review-action="${CSS.escape(missing.field)}"]`)?.focus();
        return;
      }
      const rejected = decisions.find((item) => item.status === 'rejected' && !item.comment);
      if (rejected) {
        showError('Для каждого пункта «Доработка» укажите комментарий.');
        form.querySelector(`[data-team-review-comment="${CSS.escape(rejected.field)}"]`)?.focus();
        return;
      }
      await Promise.all(decisions.map((item) => window.lugStore.adminReviewTeamField(selectedTeamId, item.field, item.status, item.comment)));
      showToast('Готово', 'Решение по заявке отправлено команде.', 'success');
      await refreshAdmin();
    }));
  }

  async function submitMemberReview(event) {
    event.preventDefault();
    const form = event.target;
    const button = event.submitter || form.querySelector('[type="submit"]');
    await busy(button, () => run(async () => {
      const decisions = Array.from(form.querySelectorAll('[data-member-review-item]')).map((item) => ({
        userId: item.dataset.memberReviewItem,
        status: item.dataset.memberReviewChoice || '',
        comment: item.querySelector('[data-identity-comment]')?.value.trim() || ''
      }));
      const missing = decisions.find((item) => !item.status);
      if (missing) {
        showError('Выберите решение по каждому участнику.');
        form.querySelector(`[data-member-review-action="${CSS.escape(missing.userId)}"]`)?.focus();
        return;
      }
      const rejected = decisions.find((item) => item.status === 'rejected' && !item.comment);
      if (rejected) {
        showError('Для каждого участника со статусом «Доработка» укажите комментарий.');
        form.querySelector(`[data-identity-comment="${CSS.escape(rejected.userId)}"]`)?.focus();
        return;
      }
      await Promise.all(decisions.map((item) => window.lugStore.adminReviewIdentity(item.userId, item.status, item.comment)));
      showToast('Готово', 'Решения по составу отправлены.', 'success');
      await refreshAdmin();
    }));
  }

  async function submitUserDecision(event) {
    event.preventDefault();
    const form = event.target;
    const button = event.submitter || form.querySelector('[type="submit"]');
    await busy(button, () => run(async () => {
      const status = event.submitter?.dataset.userDecisionAction || form.querySelector('[data-user-decision-status]')?.value || 'pending';
      const comment = form.querySelector('[data-user-decision-comment]')?.value.trim() || '';
      if (!['approved', 'rejected'].includes(status)) {
        showError('Выберите: подтвердить участника или отклонить его.');
        return;
      }
      const statusInput = form.querySelector('[data-user-decision-status]');
      if (statusInput) statusInput.value = status;
      syncReviewCommentVisibility(form);
      if (status === 'rejected' && !comment) {
        showError('Для отклонения участника укажите причину.');
        form.querySelector('[data-user-decision-comment]')?.focus();
        return;
      }
      await window.lugStore.adminReviewIdentity(form.dataset.userDecision, status, status === 'rejected' ? comment : '');
      showToast('Готово', status === 'approved' ? 'Участник подтверждён.' : 'Участник отправлен на доработку.', 'success');
      await refreshAdmin();
    }));
  }

  async function saveSettings() {
    await busy($('saveAdminSettingsButton'), () => run(async () => {
      const dateKeys = ['registrationStart', 'registrationDeadline', 'portfolioStart', 'portfolioDeadline', 'videoStart', 'videoDeadline', 'resultsStart', 'resultsDeadline'];
      const payload = Object.fromEntries(dateKeys.map((key) => [key, isoDateValue($(`${key}Input`)?.value)]).filter(([, value]) => value));
      payload.isRegistrationOpen = $('regIsOpenCheckbox')?.checked;
      await window.lugStore.adminUpdateSettings(payload);
      await refreshAdmin();
      if ($('adminSettingsNote')) $('adminSettingsNote').textContent = 'Параметры сохранены';
      showToast('Сохранено', 'Сроки конкурса обновлены.', 'success');
    }));
  }

  async function sendBroadcast(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await busy(form.querySelector('[type="submit"]'), () => run(async () => {
      const type = document.querySelector('input[name="notifTargetType"]:checked')?.value || 'all';
      const result = await window.lugStore.adminBroadcast({ targetType: type, targetId: type === 'all' ? null : $('notifTargetId')?.value, title: $('notifTitleInput')?.value, message: $('notifMessageInput')?.value });
      form.reset();
      renderTargetSuboptions();
      updateCounters(form);
      if ($('broadcastSuccess')) $('broadcastSuccess').hidden = false;
      await refreshAdmin();
      const emailNotice = Number(result.emailRecipients || 0) > 0
        ? result.emailMode === 'smtp'
          ? ` Письма отправлены участникам: ${Number(result.emailSent || 0)} из ${Number(result.emailRecipients || 0)}.`
          : ' В development письма записаны в лог.'
        : '';
      showToast('Отправлено', `Рассылка доставлена получателям.${emailNotice}`, 'success');
    }));
  }

  /* ---------- Инициализация ---------- */
  function greetingText() {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return 'Доброе утро';
    if (hour >= 12 && hour < 18) return 'Добрый день';
    if (hour >= 18 && hour < 23) return 'Добрый вечер';
    return 'Доброй ночи';
  }

  async function initAdmin() {
    try {
      const session = await window.lugStore.session();
      if (!session.user || session.user.role !== 'admin') { window.location.replace('register.html?next=admin.html'); return; }
      const firstName = (session.user.fio || 'Оргкомитет').split(' ')[0];
      if ($('adminUserName')) $('adminUserName').textContent = firstName;
      if ($('adminUserMenuName')) $('adminUserMenuName').textContent = session.user.fio || 'Оргкомитет ЛУГ';
      if ($('adminUserAvatar')) $('adminUserAvatar').textContent = (firstName[0] || 'О').toUpperCase();
      if ($('adminGreeting')) $('adminGreeting').textContent = `${greetingText()}, ${firstName}!`;
      await refreshAdmin();
      setInterval(() => {
        if (document.hidden) return;
        refreshAdmin().catch(() => {});
      }, 30000);
    } catch (error) {
      showError(error.message);
    }
  }

  function applyHash() {
    const view = (location.hash.match(/^#\/?([a-z-]+)/) || [])[1];
    if (view) switchAdminTab(view);
  }

  document.addEventListener('DOMContentLoaded', () => {
    updateCounters();
    applyHash();

    document.querySelectorAll('[data-admin-view]').forEach((button) => button.addEventListener('click', () => goToView(button.dataset.adminView)));

    $('adminSidebarToggle')?.addEventListener('click', () => {
      const isOpen = $('adminSidebar')?.classList.contains('is-open');
      if (isOpen) closeSidebar(); else openSidebar();
    });
    $('adminSidebarClose')?.addEventListener('click', closeSidebar);
    $('adminSidebarOverlay')?.addEventListener('click', closeSidebar);
    $('adminRefreshBtn')?.addEventListener('click', () => run(refreshAdmin));

    document.addEventListener('click', (event) => {
      const back = event.target.closest('[data-team-back]');
      if (back) { selectedTeamId = null; renderTeams(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const userBack = event.target.closest('[data-user-back]');
      if (userBack) { selectedUserId = null; renderUsers(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const achievementBack = event.target.closest('[data-achievement-back]');
      if (achievementBack) { selectedAchievementId = null; renderAchievements(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const scopeReset = event.target.closest('[data-achievement-scope-reset]');
      if (scopeReset) { filters.achievementTeamId = ''; filters.achievementUserId = ''; renderAchievements(); return; }
      const achievementReset = event.target.closest('[data-achievement-reset]');
      if (achievementReset) {
        const wrap = achievementReset.closest('[data-achievement-review-item]');
        if (wrap) {
          wrap.dataset.achievementReviewChoice = '';
          wrap.querySelectorAll('[data-achievement-review-action]').forEach((button) => button.classList.remove('is-active'));
          const comment = wrap.querySelector('.admin-achievement-review__comment');
          if (comment) comment.hidden = true;
        }
        return;
      }
      const selectAchievementTarget = event.target.closest('[data-select-achievement]');
      if (selectAchievementTarget) { event.preventDefault(); selectAchievement(selectAchievementTarget.dataset.selectAchievement); return; }
      const openTeamAchievements = event.target.closest('[data-open-achievements-team]');
      if (openTeamAchievements) {
        filters.achievementTeamId = openTeamAchievements.dataset.openAchievementsTeam;
        filters.achievementUserId = '';
        selectedAchievementId = null;
        switchAdminTab('achievements');
        renderAchievements();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const openUserAchievements = event.target.closest('[data-open-achievements-user]');
      if (openUserAchievements) {
        filters.achievementUserId = openUserAchievements.dataset.openAchievementsUser;
        filters.achievementTeamId = '';
        selectedAchievementId = null;
        switchAdminTab('achievements');
        renderAchievements();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const selectUserTarget = event.target.closest('[data-select-user]');
      if (selectUserTarget) { event.preventDefault(); selectUser(selectUserTarget.dataset.selectUser); return; }
      const memberDecision = event.target.closest('[data-member-review-action]');
      if (memberDecision) {
        const item = memberDecision.closest('[data-member-review-item]');
        const choice = memberDecision.dataset.memberReviewValue;
        if (item) {
          item.dataset.memberReviewChoice = choice;
          item.querySelectorAll('[data-member-review-action]').forEach((button) => button.classList.toggle('is-active', button === memberDecision));
          const comment = item.querySelector('.admin-member-review__comment');
          if (comment) comment.hidden = choice !== 'rejected';
        }
        return;
      }
      const teamDecision = event.target.closest('[data-team-review-action]');
      if (teamDecision) {
        const item = teamDecision.closest('[data-team-review-item]');
        const choice = teamDecision.dataset.teamReviewValue;
        if (item) {
          item.dataset.teamReviewChoice = choice;
          item.querySelectorAll('[data-team-review-action]').forEach((button) => button.classList.toggle('is-active', button === teamDecision));
          const comment = item.querySelector('[data-team-review-comment-wrap]');
          if (comment) comment.hidden = choice !== 'rejected';
        }
        return;
      }
      const achievementDecision = event.target.closest('[data-achievement-review-action]');
      if (achievementDecision) {
        const item = achievementDecision.closest('[data-achievement-review-item]');
        if (item) {
          item.dataset.achievementReviewChoice = achievementDecision.dataset.achievementReviewValue;
          item.querySelectorAll('[data-achievement-review-action]').forEach((button) => button.classList.toggle('is-active', button === achievementDecision));
          const comment = item.querySelector('.admin-achievement-review__comment');
          if (comment) comment.hidden = achievementDecision.dataset.achievementReviewValue !== 'rejected';
        }
        return;
      }
      const userDecision = event.target.closest('[data-user-decision-action]');
      if (userDecision) {
        const form = userDecision.closest('[data-user-decision]');
        const input = form?.querySelector('[data-user-decision-status]');
        if (input) input.value = userDecision.dataset.userDecisionAction;
        if (form) syncReviewCommentVisibility(form);
        return;
      }
      const select = event.target.closest('[data-select-team]');
      if (select) { event.preventDefault(); selectTeam(select.dataset.selectTeam); return; }
      const target = event.target.closest('[data-admin-view-target]');
      if (target) {
        const teamId = target.dataset.selectTeam;
        if (teamId) { selectedTeamId = teamId; }
        goToView(target.dataset.adminViewTarget);
        if (teamId) renderTeams();
        return;
      }
      const remove = event.target.closest('[data-remove-member]');
      if (remove) {
        run(async () => {
          if (!window.confirm('Удалить участника из команды? Его материалы также будут удалены.')) return;
          await window.lugStore.adminRemoveMember(remove.dataset.removeMember, remove.dataset.memberId);
          showToast('Удалено', 'Участник исключён из команды.', 'success');
          await refreshAdmin();
        });
        return;
      }
      const achievement = event.target.closest('[data-review-achievement]');
      if (achievement) { reviewAchievement(achievement.dataset.reviewAchievement); return; }
      const saveVideo = event.target.closest('[data-save-video]');
      if (saveVideo) { reviewVideo(saveVideo.dataset.saveVideo, 'approved'); return; }
      const rejectVideo = event.target.closest('[data-reject-video]');
      if (rejectVideo) { reviewVideo(rejectVideo.dataset.rejectVideo, 'rejected'); return; }
    });

    document.addEventListener('change', (event) => {
      const quota = event.target.closest('[data-team-quota]');
      if (quota) run(async () => { await window.lugStore.adminUpdateQuota(quota.dataset.teamQuota, quota.checked); await refreshAdmin(); });
      if (event.target.name === 'notifTargetType') renderTargetSuboptions();
      if (event.target.closest('[data-counter]')) updateCounters();
    });

    document.addEventListener('input', (event) => {
      if (event.target.closest('[data-counter]')) updateCounters();
    });

    $('adminTeamSearch')?.addEventListener('input', (event) => { filters.teams = event.target.value; renderTeams(); });
    $('adminAchievementSearch')?.addEventListener('input', (event) => { filters.achievements = event.target.value; renderAchievements(); });
    $('adminUserSearch')?.addEventListener('input', (event) => { filters.users = event.target.value; renderUsers(); });

    document.querySelectorAll('[data-achievement-filter]').forEach((chip) => chip.addEventListener('click', () => {
      filters.achievementStatus = chip.dataset.achievementFilter;
      document.querySelectorAll('[data-achievement-filter]').forEach((item) => item.classList.toggle('is-active', item === chip));
      renderAchievements();
    }));
    document.querySelectorAll('[data-achievement-direction]').forEach((chip) => chip.addEventListener('click', () => {
      filters.achievementDirection = chip.dataset.achievementDirection;
      document.querySelectorAll('[data-achievement-direction]').forEach((item) => item.classList.toggle('is-active', item === chip));
      renderAchievements();
    }));

    document.querySelectorAll('[data-team-filter]').forEach((chip) => chip.addEventListener('click', () => {
      filters.teamStatus = chip.dataset.teamFilter;
      document.querySelectorAll('[data-team-filter]').forEach((item) => item.classList.toggle('is-active', item === chip));
      renderTeams();
    }));
    document.querySelectorAll('[data-user-filter]').forEach((chip) => chip.addEventListener('click', () => {
      filters.userStatus = chip.dataset.userFilter;
      document.querySelectorAll('[data-user-filter]').forEach((item) => item.classList.toggle('is-active', item === chip));
      renderUsers();
    }));

    document.addEventListener('submit', (event) => {
      const teamProfileReview = event.target.closest('[data-team-profile-review]');
      if (teamProfileReview) { submitTeamProfileReview(event); return; }
      const teamMembersReview = event.target.closest('[data-team-members-review]');
      if (teamMembersReview) { submitMemberReview(event); return; }
      const userDecision = event.target.closest('[data-user-decision]');
      if (userDecision) { submitUserDecision(event); return; }
    });

    $('broadcastForm')?.addEventListener('submit', sendBroadcast);
    $('saveAdminSettingsButton')?.addEventListener('click', saveSettings);
    $('adminLogoutButton')?.addEventListener('click', () => run(async () => { await window.lugStore.logout(); window.location.replace('index.html'); }));
    $('adminUserMenuBtn')?.addEventListener('click', () => {
      const button = $('adminUserMenuBtn');
      const menu = $('adminUserMenu');
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      menu.hidden = !open;
    });
    document.addEventListener('click', (event) => {
      const menu = $('adminUserMenu');
      if (!menu || menu.hidden) return;
      if (!event.target.closest('#adminUserMenu') && !event.target.closest('#adminUserMenuBtn')) {
        menu.hidden = true;
        $('adminUserMenuBtn')?.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if ($('adminUserMenu') && !$('adminUserMenu').hidden) {
        $('adminUserMenu').hidden = true;
        $('adminUserMenuBtn')?.setAttribute('aria-expanded', 'false');
      }
      closeSidebar();
    });
    window.addEventListener('hashchange', applyHash);

    initAdmin();
  });

  window.switchAdminTab = switchAdminTab;
})(window, document);
