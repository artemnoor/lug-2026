import { escapeHtml as esc } from './modules/dom.js';
import { createFeedback } from './modules/feedback.js';
import { createRatingRows } from './modules/rating.js';
import { dateLabel, initials, localDateValue, plural, rangeLabel, shortDateLabel } from './modules/admin-utils.js';
import { phaseKeys, phaseState, pendingForTeam, teamMatches, workflow, workflowPresentation } from './modules/admin-workflow.js';
import { directionIcons, directionLabels, statusLabel, viewTitles, workflowMeta } from './modules/admin-constants.js';
import { adminApi } from './modules/admin-api.js';
import { bindAdminEvents } from './modules/admin-events.js';
import { createAdminActions } from './modules/admin-actions.js';
import { achievementStatusChip, renderAchievementRow, renderRating as renderRatingView, renderTeamRow, renderUserRow } from './modules/admin-renderers.js';
import { renderAchievementDetail as renderAchievementDetailCard, renderTeamProfileReview as renderTeamProfileReviewCard, renderTeamStage as renderTeamStageCard, renderUserDetail as renderUserDetailCard } from './modules/admin-detail-renderers.js';

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
  const collectionPageSize = 100;
  const filters = { teams: '', teamStatus: 'all', users: '', userStatus: 'all', achievements: '', achievementStatus: 'all', achievementDirection: 'all', achievementTeamId: '', achievementUserId: '' };
  const $ = (id) => document.getElementById(id);
  const { showToast, showError, run, busy } = createFeedback({ getNode: $, escapeHtml: esc });
  /* ---------- Доменные помощники ---------- */

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

  /* ---------- Список участников ---------- */
  function userMatches(user) {
    const team = state?.teams?.find((item) => item.id === user.teamId);
    const text = `${user.fio || ''} ${user.phone || ''} ${user.group || ''} ${team?.name || ''}`.toLowerCase();
    return (!filters.users || text.includes(filters.users.trim().toLowerCase())) && (filters.userStatus === 'all' || (user.identityStatus || 'pending') === filters.userStatus);
  }

  function userIsCaptain(user) {
    return state?.teams?.some((team) => team.id === user.teamId && team.captainId === user.id) || user.role === 'captain';
  }

  /* ---------- Карточка участника ---------- */
  function renderUserDetail(user) {
    return renderUserDetailCard({
      user,
      state,
      esc,
      directionIcons,
      directionLabels,
      achievementStatusChip,
    });
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
        const group = (title, id, rows, count) => `<p class="admin-master__heading admin-master__heading--compact" id="${id}"><span>${title}</span><span>${count}</span></p><div class="admin-master__list">${rows}</div>`;
        const renderUser = (user) => renderUserRow({ user, state, selectedUserId, esc, initials });
        const captainRows = captains.map(renderUser).join('');
        const participantRows = participants.map(renderUser).join('');
        const body = captains.length
          ? `<section aria-labelledby="admin-captains-title">${group('Капитаны', 'admin-captains-title', captainRows, captains.length)}</section>${participants.length ? `<section aria-labelledby="admin-participants-title">${group('Участники', 'admin-participants-title', participantRows, participants.length)}</section>` : ''}`
          : `<div class="admin-master__list">${participantRows}</div>`;
        list.innerHTML = heading + body;
      }
      appendLoadMore(list, 'users', state.users?.length || 0, state.summary?.users || 0);
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
  /* ---------- Карточка команды ---------- */
  function renderTeamStage(team) {
    return renderTeamStageCard({ team, esc, workflowPresentation, workflowMeta });
  }

  function renderTeamProfileReview(team) {
    return renderTeamProfileReviewCard({ team, esc });
  }

  function renderTeamDetail(team) {
    if (!team) return '<div class="admin-detail__placeholder"><span class="admin-empty-state__mark" aria-hidden="true">✦</span><h2>Выберите команду</h2><p>Здесь появятся заявка, состав, портфолио и видео команды.</p></div>';
    const current = workflowPresentation(team, workflowMeta);
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
    if (list) list.innerHTML = teams.length ? `<div class="admin-master__heading"><span>Список команд</span><span>${teams.length} из ${state.teams.length}</span></div><div class="admin-master__list">${teams.map((team, index) => renderTeamRow({ team, index, selectedTeamId, esc, plural, pendingForTeam, workflowPresentation, workflowMeta })).join('')}</div>` : '<div class="admin-empty-state"><span class="admin-empty-state__mark" aria-hidden="true">⌕</span><h3>Команды не найдены</h3><p>Измените запрос или фильтр статуса.</p></div>';
    appendLoadMore(list, 'teams', state.teams.length, state.summary?.teams || 0);
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

  function renderAchievementDetail(achievement) {
    const filterNote = filters.achievementTeamId || filters.achievementUserId
      ? 'Фильтр по команде или участнику активен — сбросьте его, чтобы увидеть все материалы.'
      : '';
    return renderAchievementDetailCard({
      achievement,
      team: achievementTeam(achievement),
      filterNote,
      esc,
      directionLabels,
      achievementStatusChip,
      shortDateLabel,
      dateLabel,
    });
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
        ? `<div class="admin-master__heading"><span>${scopeNote ? 'Материалы в фильтре' : 'Все достижения'}</span><span>${achievements.length} из ${all.length}</span></div>${scopeChip}<div class="admin-master__list">${achievements.map((achievement) => renderAchievementRow({ achievement, team: achievementTeam(achievement), selectedAchievementId, esc, directionIcons, directionLabels })).join('')}</div>`
        : `<div class="admin-empty-state"><span class="admin-empty-state__mark" aria-hidden="true">⌕</span><h3>Достижения не найдены</h3><p>Измените запрос, статус или направление.</p></div>`;
      appendLoadMore(list, 'achievements', all.length, state.summary?.achievements || 0);
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

  function appendLoadMore(list, resource, loaded, total) {
    if (!list) return;
    list.querySelector('[data-admin-load-more]')?.remove();
    if (loaded >= total) return;
    const button = document.createElement('button');
    button.className = 'admin-text-button';
    button.type = 'button';
    button.dataset.adminLoadMore = resource;
    button.textContent = `Загрузить ещё (${Math.min(collectionPageSize, total - loaded)})`;
    list.append(button);
  }

  async function loadMoreCollection(resource) {
    if (!state) return;
    const current = state[resource] || [];
    const result = await adminApi.adminCollection(resource, {
      limit: collectionPageSize,
      offset: current.length,
      status: resource === 'users' ? filters.userStatus : resource === 'teams' ? filters.teamStatus : filters.achievementStatus,
    });
    const existing = new Set(current.map((item) => item.id));
    state[resource] = current.concat((result.items || []).filter((item) => !existing.has(item.id)));
    if (resource === 'teams') renderTeams();
    else if (resource === 'users') renderUsers();
    else renderAchievements();
  }

  function selectAchievement(achievementId) {
    if (!state?.achievements?.some((item) => item.id === achievementId)) return;
    selectedAchievementId = achievementId;
    switchAdminTab('achievements');
    renderAchievements();
    const detail = $('adminAchievementDetail');
    if (detail && window.innerWidth < 1024) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderRating() {
    renderRatingView({ state, $, esc, createRatingRows, workflowPresentation, workflowMeta, directionLabels, plural });
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
      const nextState = await adminApi.adminOverview();
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
      const session = await adminApi.session();
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

  const actions = createAdminActions({
    $, adminApi, busy, run, showError, showToast, refreshAdmin,
    renderTargetSuboptions, updateCounters, syncReviewCommentVisibility,
    getSelectedTeamId: () => selectedTeamId,
  });

  bindAdminEvents({
    $, adminApi, applyHash, closeSidebar, filters, goToView, initAdmin,
    loadMoreCollection, openSidebar, refreshAdmin, renderAchievements,
    renderTeams, renderTargetSuboptions, renderUsers, reviewAchievement: actions.reviewAchievement,
    reviewVideo: actions.reviewVideo, run, saveSettings: actions.saveSettings, selectAchievement, selectTeam, selectUser,
    selected: {
      get team() { return selectedTeamId; },
      set team(value) { selectedTeamId = value; },
      get user() { return selectedUserId; },
      set user(value) { selectedUserId = value; },
      get achievement() { return selectedAchievementId; },
      set achievement(value) { selectedAchievementId = value; },
    },
    sendBroadcast: actions.sendBroadcast, showToast, submitMemberReview: actions.submitMemberReview, submitTeamProfileReview: actions.submitTeamProfileReview,
    submitUserDecision: actions.submitUserDecision, switchAdminTab, syncReviewCommentVisibility,
    updateCounters,
  });
  window.switchAdminTab = switchAdminTab;
})(window, document);
