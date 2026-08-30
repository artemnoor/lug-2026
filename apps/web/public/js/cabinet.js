import { escapeHtml as esc, formatDate as date, hostMatches, phaseOpen } from './modules/dom.js';

(() => {
  'use strict';

  let state = null;
  let direction = 'science';
  let selectedMaterialId = null;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const messengerLabels = { telegram: 'Telegram', vk: 'VK', max: 'MAX' };
  const nameInitial = (name = '') => name.trim().charAt(0).toUpperCase() || 'У';

  const videoProviderMeta = {
    rutube: { label: 'Rutube', title: 'Предпросмотр Rutube' },
    vk: { label: 'VK Видео', title: 'Предпросмотр VK Видео' },
    'yandex-disk': { label: 'Яндекс Диск', title: 'Ссылка на видео в Яндекс Диске' },
    file: { label: 'Загруженный файл', title: 'Предпросмотр видеофайла' }
  };

  function parseVideoUrl(value = '') {
    const raw = String(value).trim();
    if (!raw) return { valid: false, message: 'Вставьте ссылку на видео-визитку.' };
    if (/^\/uploads\/[a-f0-9]{64}\.(?:mp4|webm|mov)$/i.test(raw)) return { valid: true, provider: 'file', label: videoProviderMeta.file.label, title: videoProviderMeta.file.title, url: raw, embedUrl: '' };
    let url;
    try { url = new URL(raw); } catch { return { valid: false, message: 'Проверьте формат ссылки: она должна начинаться с https:// или http://.' }; }
    if (!['http:', 'https:'].includes(url.protocol)) return { valid: false, message: 'Ссылка должна начинаться с https:// или http://.' };
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let provider = null;
    let embedUrl = '';
    if (hostMatches(host, 'rutube.ru')) {
      provider = 'rutube';
      const id = url.pathname.match(/\/(?:video|shorts|play\/embed)\/([a-z0-9_-]+)/i)?.[1];
      if (!id) return { valid: false, message: 'Вставьте ссылку на конкретное видео Rutube.' };
      embedUrl = `https://rutube.ru/play/embed/${encodeURIComponent(id)}`;
    } else if (hostMatches(host, 'vk.com') || hostMatches(host, 'vkvideo.ru') || hostMatches(host, 'vk.ru')) {
      provider = 'vk';
      const pathMatch = url.pathname.match(/\/(?:video|clip)(-?\d+)_(\d+)/i);
      const oid = pathMatch?.[1] || url.searchParams.get('oid');
      const id = pathMatch?.[2] || url.searchParams.get('id');
      if (!oid || !id) return { valid: false, message: 'Вставьте ссылку на конкретное видео VK Видео.' };
      const params = new URLSearchParams({ oid, id });
      const hash = url.searchParams.get('hash');
      if (hash) params.set('hash', hash);
      embedUrl = `https://vk.com/video_ext.php?${params.toString()}`;
    } else if (hostMatches(host, 'disk.yandex.ru') || hostMatches(host, 'yadi.sk')) {
      provider = 'yandex-disk';
      if (!url.pathname.match(/\/(?:d|i)\/[^/]+/i)) return { valid: false, message: 'Вставьте публичную ссылку на файл в Яндекс Диске.' };
    }
    if (!provider) return { valid: false, message: 'Поддерживаются только публичные ссылки Rutube, VK Видео или Яндекс Диск.' };
    return { valid: true, provider, label: videoProviderMeta[provider].label, title: videoProviderMeta[provider].title, url: url.href, embedUrl };
  }

  function setVideoFeedback(message = '', type = 'error') {
    const feedback = $('#videoFeedback');
    if (!feedback) return;
    feedback.hidden = !message;
    feedback.className = `video-feedback${message ? ` is-${type}` : ''}`;
    feedback.textContent = message;
  }

  function renderVideoPreview(parsed) {
    const preview = $('#videoPreview');
    const frame = $('#videoPreviewFrame');
    const title = $('#videoPreviewTitle');
    const meta = $('#videoPreviewMeta');
    const open = $('#videoPreviewOpen');
    if (!preview || !frame || !title || !meta || !open) return;
    frame.replaceChildren();
    if (!parsed?.valid) { preview.hidden = true; return; }
    preview.hidden = false;
    title.textContent = parsed.title;
    meta.textContent = parsed.embedUrl ? 'Проверьте, что видео открывается без авторизации и звук включается по нажатию.' : 'Для этого сервиса показываем карточку ссылки. Откройте её, чтобы проверить доступ к видео.';
    open.href = parsed.url;
    if (parsed.provider === 'file') {
      const video = document.createElement('video');
      video.controls = true;
      video.preload = 'metadata';
      video.src = parsed.url;
      video.setAttribute('aria-label', parsed.title);
      frame.append(video);
    } else if (parsed.embedUrl) {
      const iframe = document.createElement('iframe');
      iframe.title = parsed.title;
      iframe.src = parsed.embedUrl;
      iframe.loading = 'lazy';
      iframe.allow = 'autoplay; fullscreen; picture-in-picture';
      iframe.referrerPolicy = 'no-referrer';
      frame.append(iframe);
    } else {
      frame.innerHTML = `<div class="video-preview__placeholder"><span aria-hidden="true">▶</span><strong>${esc(parsed.label)}</strong><small>Предпросмотр откроется на странице сервиса.</small></div>`;
    }
  }

  function setVideoUrlState(value, { showInvalid = false } = {}) {
    const input = $('#videoUrl');
    const hint = $('#videoUrlHint');
    const parsed = parseVideoUrl(value);
    const hasValue = String(value).trim().length > 0;
    if (input) input.setAttribute('aria-invalid', String(Boolean(hasValue && !parsed.valid && showInvalid)));
    if (parsed.valid) {
      if (hint) hint.textContent = `${parsed.label}. Ссылка распознана, можно проверить предпросмотр.`;
      setVideoFeedback('');
      renderVideoPreview(parsed);
    } else {
      if (hint) hint.textContent = 'Ссылка должна открываться без входа в аккаунт.';
      renderVideoPreview(null);
      if (showInvalid && hasValue) setVideoFeedback(parsed.message, 'error');
      else if (!hasValue) setVideoFeedback('');
    }
    return parsed;
  }

  async function refresh() {
    state = await window.lugStore.dashboard();
    render();
  }

  function identityMeta() {
    const status = state.user.identityStatus;
    if (status === 'approved') return { className: 'is-approved', title: 'Данные проверены' };
    if (status === 'rejected') return { className: 'is-rejected', title: 'Нужно уточнить данные' };
    return { className: 'is-pending', title: 'Проверяем заявку' };
  }

  function render() {
    const { user, team, achievements, notifications } = state;
    const identity = identityMeta();
    const profileReady = Boolean(user.fio && user.email && user.emailVerified && Object.keys(user.messengerContacts || {}).length);
    const hasVideo = Boolean(team?.videoCard?.url);
    const score = [profileReady, achievements.length > 0, Boolean(team?.description), hasVideo].filter(Boolean).length * 25;
    const initial = nameInitial(user.fio);
    if ($('#dropdownAvatar')) $('#dropdownAvatar').textContent = initial;
    if ($('#topbarUserName')) $('#topbarUserName').textContent = (user.fio.split(' ')[0] || user.fio).toUpperCase();
    $('#cabinet-title').textContent = user.fio;
    $('#cabinet-subtitle').textContent = `${user.role === 'captain' ? 'Капитан' : 'Участник'} · ${user.group}`;
    $('#identityBadge').className = `cabinet-status ${identity.className}`;
    $('#identityBadge').textContent = identity.title;
    $('#completionText').textContent = `${score}%`;
    $('#completionBar').style.width = `${score}%`;
    $('#teamNavigation').hidden = !team;
    renderDashboard(identity);
    renderPortfolioSummary();
    renderOverview(profileReady, hasVideo);
    renderTeam();
    renderVideo();
    renderNotifications(notifications);
    renderProfile();
    const portfolioActive = phaseOpen(state.settings?.portfolioStart, state.settings?.portfolioDeadline);
    const addAchievement = $('#openAchievement');
    if (addAchievement) {
      addAchievement.disabled = !portfolioActive;
      addAchievement.title = portfolioActive ? '' : 'Приём достижений откроется в установленный срок.';
    }
    if ($('#portfolioPhaseHint')) $('#portfolioPhaseHint').textContent = portfolioActive ? '' : 'Приём достижений пока закрыт по календарю конкурса.';
  }

  function renderPortfolioSummary() {
    const { achievements, notifications = [] } = state;
    const notificationDirection = (item) => item.direction || item.meta?.direction || item.payload?.direction || item.context?.direction || null;
    const unread = notifications.filter((item) => !(item.readBy || []).includes(state.user.id));
    $$('[data-direction-badge]').forEach((badge) => {
      const count = unread.filter((item) => notificationDirection(item) === badge.dataset.directionBadge).length;
      badge.textContent = count;
      badge.setAttribute('aria-label', count ? `${count} новых уведомления` : 'Новых уведомлений нет');
      badge.classList.toggle('is-active', count > 0);
    });
    const directions = [['science', 'Наука'], ['public', 'Общество'], ['sport', 'Спорт'], ['culture', 'Творчество']].map(([key, label]) => {
      const records = achievements.filter((item) => item.direction === key);
      return {
        key,
        label,
        records,
        count: records.length,
        approved: records.filter((item) => item.status === 'approved').length,
        pending: records.filter((item) => item.status !== 'approved' && item.status !== 'rejected').length,
        rejected: records.filter((item) => item.status === 'rejected').length
      };
    });
    const activeDirection = directions.find((item) => item.key === direction) || directions[0];
    const reviewStage = (item) => {
      const stage = item.reviewStage || item.review?.stage || (item.status === 'rejected' ? 'decision' : 'received');
      if (stage === 'document_review') return ['Проверка документа', 'Оргкомитет сверяет подтверждающий документ с описанием достижения.', 2];
      if (stage === 'expert_review') return ['Экспертная оценка', 'Материал передан на оценку по критериям выбранного направления.', 3];
      if (stage === 'decision' || stage === 'rejected') return ['Решение', 'Материал не прошёл проверку на этапе вынесения решения.', 4];
      return ['Материал получен', 'Файл сохранён в заявке. Следующий шаг — проверка подтверждающего документа.', 1];
    };
    const stageLabels = ['Материал получен', 'Проверка документа', 'Экспертная оценка', 'Решение'];
    const renderProgress = (stageTitle, stageDescription, stagePosition, completed = false, stateClass = 'is-pending') => {
      const statusTitle = completed ? 'Принято' : stateClass === 'is-rejected' ? 'Отклонено' : 'На проверке';
      const progressTitle = completed ? 'Проверка завершена' : stageTitle;
      const steps = stageLabels.map((label, index) => {
        const current = !completed && index + 1 === stagePosition;
        const done = completed || index + 1 < stagePosition;
        const stepClass = done ? 'is-done' : current ? 'is-current' : '';
        const marker = done ? '✓' : current ? '•' : '';
        const stepNote = done ? 'Завершён' : current ? 'Сейчас' : 'Впереди';
        return `<li class="${stepClass}"${current ? ' aria-current="step"' : ''}><span class="cabinet-materials__progress-node" aria-hidden="true">${marker}</span><strong>${esc(label)}</strong><small>${stepNote}</small></li>`;
      }).join('');
      return `<section class="cabinet-materials__progress ${stateClass}" data-stage-position="${stagePosition}" aria-label="Этапы проверки"><header class="cabinet-materials__progress-header"><div><span>Этап проверки</span><strong>${esc(progressTitle)}</strong></div><span class="cabinet-materials__progress-status">${statusTitle}</span></header><ol class="cabinet-materials__progress-steps" aria-label="Последовательность этапов">${steps}</ol><p><strong>${completed ? 'Проверка завершена.' : `${esc(stageTitle)}.`}</strong> ${completed ? 'Материал прошёл все этапы и согласован оргкомитетом.' : esc(stageDescription)}</p></section>`;
    };
    const renderDetails = (item) => {
      const rejected = item.status === 'rejected';
      const approved = item.status === 'approved';
      const [stageTitle, stageDescription, stagePosition] = reviewStage(item);
      const comment = item.reviewComment || item.rejectionReason || item.comment || item.review?.comment || '';
      if (approved) return `<p class="cabinet-materials__message cabinet-materials__message--approved"><strong>Материал согласован.</strong>${item.points !== null && item.points !== undefined ? ` Начислено: ${esc(item.points)} б.` : ''}</p>${renderProgress('', '', 4, true, 'is-approved')}`;
      if (rejected) return `<p class="cabinet-materials__message cabinet-materials__message--attention"><span>Комментарий оргкомитета</span>${esc(comment || 'Причина пока не добавлена. Напишите организаторам, чтобы уточнить решение.')}${comment ? '' : ' <a href="https://t.me/studsovet_bmstu" target="_blank" rel="noopener">Написать организаторам</a>'}</p><p class="cabinet-materials__rejection-stage"><strong>Отклонено на этапе:</strong> ${stageTitle}</p>${renderProgress(stageTitle, stageDescription, stagePosition, false, 'is-rejected')}`;
      return renderProgress(stageTitle, stageDescription, stagePosition, false, 'is-pending');
    };
    const statusMeta = (item) => item.status === 'approved' ? ['Принято', 'is-approved'] : item.status === 'rejected' ? ['Отклонено', 'is-rejected'] : ['На проверке', 'is-pending'];
    const renderCard = (item) => {
      const [statusTitle, statusClass] = statusMeta(item);
      const expanded = selectedMaterialId === item.id;
      const detailId = `material-detail-${item.id}`;
      const [stageTitle] = reviewStage(item);
      const stageLabel = item.status === 'approved' ? 'Все этапы пройдены' : stageTitle;
      const updatedAt = item.stageUpdatedAt || item.reviewedAt || item.createdAt;
      return `<article class="cabinet-material-card ${statusClass} ${expanded ? 'is-open' : ''}"><button class="cabinet-material-card__toggle" type="button" data-material-id="${esc(item.id)}" aria-expanded="${String(expanded)}" aria-controls="${detailId}"><span class="cabinet-material-card__title"><strong>${esc(item.title)}</strong><small>${esc(item.details || item.category)}</small></span><span class="cabinet-material-card__status"><span class="cabinet-material-card__status-badge">${statusTitle}</span></span><span class="cabinet-material-card__stage">${stageLabel}</span><time class="cabinet-material-card__date" datetime="${esc(updatedAt || '')}">${date(updatedAt)}</time><span class="cabinet-material-card__arrow" aria-hidden="true">↗</span></button>${expanded ? `<div class="cabinet-material-card__detail" id="${detailId}"><div class="cabinet-material-card__file"><span>Подтверждающий документ</span><a href="${esc(item.fileUrl)}" target="_blank" rel="noopener">Открыть документ ↗</a></div>${renderDetails(item)}</div>` : ''}</article>`;
    };
    const groups = [
      ['pending', 'Ожидают проверки', activeDirection.records.filter((item) => item.status !== 'approved' && item.status !== 'rejected')],
      ['approved', 'Приняты', activeDirection.records.filter((item) => item.status === 'approved')],
      ['rejected', 'Отклонены', activeDirection.records.filter((item) => item.status === 'rejected')]
    ];
    const cardsMarkup = groups.filter(([, , records]) => records.length).length ? `<div class="cabinet-material-table" role="table" aria-label="Материалы направления"><div class="cabinet-material-table__head" role="row"><span role="columnheader">Заявка</span><span role="columnheader">Статус</span><span role="columnheader">Этап проверки</span><span role="columnheader">Дата</span><span aria-hidden="true"></span></div>${groups.filter(([, , records]) => records.length).map(([, label, records]) => `<section class="cabinet-material-group" aria-labelledby="materials-group-${label}"><header><h4 id="materials-group-${label}">${label}</h4><span>${records.length}</span></header><div class="cabinet-material-list">${records.map(renderCard).join('')}</div></section>`).join('')}</div>` : '';
    const detailCountLabel = activeDirection.count === 1 ? 'материал' : activeDirection.count >= 2 && activeDirection.count <= 4 ? 'материала' : 'материалов';
    const emptyMarkup = `<div class="cabinet-empty">В направлении «${activeDirection.label}» пока нет материалов. Добавьте достижение через кнопку выше, чтобы отправить его на проверку.</div>`;
    const detailDescription = activeDirection.count ? `Найдено ${activeDirection.count} ${detailCountLabel}. Нажмите на материал, чтобы открыть его статус и подробности.` : 'Здесь появятся материалы, статусы и комментарии оргкомитета.';
    const portfolioSummary = $('#portfolioSummary');
    portfolioSummary.dataset.direction = activeDirection.key;
    portfolioSummary.innerHTML = `<section class="cabinet-materials" aria-labelledby="materials-title"><header class="cabinet-materials__header"><div><p class="cabinet-eyebrow">${activeDirection.label}</p><h3 id="materials-title">${activeDirection.count ? `${activeDirection.count} ${detailCountLabel}` : 'Пока нет материалов'}</h3><p>${detailDescription}</p></div><div class="cabinet-materials__direction-stats" aria-label="Статусы материалов"><span><b>${activeDirection.approved}</b> принято</span><span><b>${activeDirection.pending}</b> на проверке</span><span><b>${activeDirection.rejected}</b> нужно уточнить</span></div></header><div class="cabinet-material-groups">${cardsMarkup || emptyMarkup}</div></section>`;
    $$('.cabinet-direction-tabs button').forEach((button) => {
      const active = button.dataset.direction === direction;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    $$('[data-material-id]').forEach((button) => button.addEventListener('click', () => {
      selectedMaterialId = selectedMaterialId === button.dataset.materialId ? null : button.dataset.materialId;
      renderPortfolioSummary();
    }));
  }

  function renderDashboard(identity) {
    const { user, team, achievements } = state;
    const firstName = user.fio.split(' ')[0] || user.fio;
    const profileReady = Boolean(user.fio && user.email && user.emailVerified && Object.keys(user.messengerContacts || {}).length);
    const journey = [['profile', 'Профиль', profileReady, 'profile'], ['team', 'Команда', Boolean(team), 'team'], ['portfolio', 'Портфолио', achievements.length > 0, 'portfolio'], ['video', 'Видео', Boolean(team?.videoCard?.url), 'video']];
    const nextJourney = journey.findIndex((item) => !item[2]);
    const journeyDone = journey.filter((item) => item[2]).length;
    $('#dashboard-title').textContent = `Здравствуйте, ${firstName}`;
    const roleMeta = user.role === 'captain'
      ? { label: 'Капитан', icon: '<svg viewBox="0 0 24 24"><path d="m4 8 3 3 5-6 5 6 3-3-1 10H5z"/><path d="M5 15h14"/></svg>' }
      : { label: 'Участник', icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3"/><path d="M5 19c.5-3.3 2.8-5 7-5s6.5 1.7 7 5"/></svg>' };
    $('#dashboard-lead').innerHTML = `<span class="cabinet-role-mark" aria-hidden="true">${roleMeta.icon}</span><span>${roleMeta.label} · ${esc(user.group)}</span>`;
    const statusPresentation = {
      'is-approved': { label: 'Заявка одобрена', detail: 'Данные подтверждены', icon: '✓' },
      'is-rejected': { label: 'Заявка отклонена', detail: 'Нужно посмотреть причину', icon: '!' },
      'is-pending': { label: 'Проверяем заявку', detail: 'Оргкомитет проверяет данные', icon: '' }
    }[identity.className] || { label: 'Проверяем заявку', detail: 'Оргкомитет проверяет данные', icon: '' };
    const status = $('#dashboardStatus');
    status.className = `cabinet-dashboard__status ${identity.className}`;
    status.innerHTML = `<span class="cabinet-dashboard__status-icon" aria-hidden="true">${statusPresentation.icon}</span><span class="cabinet-dashboard__status-copy"><strong>${statusPresentation.label}</strong>${identity.className === 'is-rejected' ? '<button type="button" class="cabinet-dashboard__status-reason" data-open-view="profile">Посмотреть причину отклонения ↗</button>' : `<small>${statusPresentation.detail}</small>`}</span>`;
    const statusReason = status.querySelector('[data-open-view]');
    statusReason?.addEventListener('click', () => switchView('profile', { focus: true }));
    $('#overviewInsights').innerHTML = `<section class="cabinet-overview__path" aria-labelledby="overview-path-title"><header><div><h3 id="overview-path-title"><span class="cabinet-overview__path-count">${journeyDone}</span><span class="cabinet-overview__path-caption"><small>из</small><b>${journey.length}</b><em>шагов</em></span><span class="cabinet-overview__path-complete">завершены</span></h3></div></header><ol>${journey.map(([key, label, done, view], index) => `<li class="${done ? 'is-done' : index === nextJourney ? 'is-current' : ''}"><button type="button" data-overview-view="${view}" aria-label="Открыть раздел «${label}»"><span>${done ? '✓' : String(index + 1).padStart(2, '0')}</span><strong>${label}</strong><small>${done ? 'Готово' : index === nextJourney ? 'Следующий шаг' : 'Впереди'}</small></button></li>`).join('')}</ol></section>`;
    $$('[data-overview-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.overviewView, { focus: true })));
  }

  function renderOverview(profileReady, hasVideo) {
    const { user, team, achievements } = state;
    let step;
    if (user.identityStatus === 'rejected') {
      step = ['Уточните данные в профиле', user.identityComment || 'Оргкомитет оставил комментарий. Исправьте данные и сохраните изменения.', 'Открыть профиль', 'profile'];
    } else if (!profileReady) {
      step = ['Заполните контакты', 'Укажите телефон и удобный способ связи, чтобы организаторы могли быстро написать вам.', 'Заполнить контакты', 'profile'];
    } else if (!team) {
      step = ['Дождитесь приглашения в команду', 'Капитан создаёт команду и отправляет приглашение участникам. Проверяйте уведомления.', 'Открыть уведомления', 'notifications'];
    } else if (achievements.length === 0) {
      step = ['Добавьте первое достижение', 'Выберите направление, опишите результат и прикрепите подтверждающий документ.', 'Открыть достижения', 'portfolio'];
    } else if (user.role === 'captain' && !team.description) {
      step = ['Расскажите о команде', 'Добавьте короткое описание группы, чтобы представить её в конкурсных материалах.', 'Открыть команду', 'team'];
    } else if (user.role === 'captain' && !hasVideo) {
      step = ['Отправьте видео-визитку', 'Добавьте публичную ссылку на готовое видео, когда команда закончит подготовку.', 'Открыть видео-визитку', 'video'];
    } else {
      step = ['Проверьте уведомления', 'Здесь появляются решения и комментарии оргкомитета по вашим материалам.', 'Открыть уведомления', 'notifications'];
    }
    $('#next-title').textContent = step[0];
    $('#next-description').textContent = step[1];
    $('#nextAction').innerHTML = `${esc(step[2])} <span aria-hidden="true">→</span>`;
    $('#nextAction').dataset.openView = step[3];

  }

  function renderTeam() {
    const { user, team, members } = state;
    const captain = user.role === 'captain';
    $('#teamCaptainOnly').hidden = !captain;
    $('#teamCaptainEdit').hidden = !captain;
    if (!team) { $('#teamCaptainEdit').hidden = true; $('#teamLead').textContent = 'Вы пока не состоите в команде.'; $('#memberList').innerHTML = '<div class="cabinet-empty">Капитан отправит приглашение. После регистрации по ссылке вы увидите состав команды здесь.</div>'; return; }
    const quota = team.quota;
    $('#teamLead').textContent = `${team.name} · ${team.group}. Сейчас в команде ${quota.members} из ${quota.total} студентов.`;
    $('#quotaBadge').textContent = quota.eligible ? 'Минимальный состав набран' : `Нужно ещё: ${quota.required - quota.members}`;
    $('#inviteCode').textContent = team.inviteCode;
    $('#inviteExpires').textContent = date(team.inviteExpiresAt);
    $('#teamDescription').value = team.description || '';
    $('#teamFlagPreview').hidden = !team.flagUrl;
    $('#teamFlagEmpty').hidden = Boolean(team.flagUrl);
    if (team.flagUrl) $('#teamFlagPreview').src = team.flagUrl;
    $('#memberList').innerHTML = members.length ? members.map((member) => `<article class="cabinet-member"><div><strong>${esc(member.fio)}</strong><small>${esc(member.role === 'captain' ? 'Капитан команды' : 'Участник')} · ${esc(member.group)}</small></div><span>${member.role === 'captain' ? 'Капитан' : 'Участник'}</span><span class="cabinet-member__status ${member.identityStatus === 'approved' ? 'is-approved' : ''}">${member.identityStatus === 'approved' ? '✓ Данные проверены' : '⌛ Проверяем данные'}</span></article>`).join('') : '<div class="cabinet-empty">Участники появятся здесь после регистрации по приглашению.</div>';
    const registrationActive = phaseOpen(state.settings?.registrationStart, state.settings?.registrationDeadline) && state.settings?.isRegistrationOpen !== false;
    ['#copyInvite', '#rotateInvite', '#saveTeam', '#teamFlagInput'].forEach((selector) => {
      const control = $(selector);
      if (control) control.disabled = !registrationActive;
    });
  }

  function renderVideo() {
    const { user, team } = state;
    const video = team?.videoCard;
    const rawUrl = video?.url || '';
    const parsed = parseVideoUrl(rawUrl);
    $('#videoUrl').value = rawUrl.startsWith('/uploads/') ? '' : rawUrl;
    const status = video?.status === 'approved' ? `Принято · ${video.score || 0} б.` : video?.status === 'rejected' ? 'Нужно исправить' : rawUrl && !parsed.valid ? 'Нужно заменить ссылку' : rawUrl ? 'Проверяем' : 'Не добавлено';
    const statusClass = video?.status === 'approved' ? 'is-approved' : video?.status === 'rejected' || (rawUrl && !parsed.valid) ? 'is-rejected' : rawUrl ? 'is-pending' : '';
    $('#videoStatus').className = `cabinet-video-status ${statusClass}`;
    $('#videoStatus').textContent = status;
    $('#videoHint').textContent = rawUrl && !parsed.valid ? 'Сохранённая ссылка не относится к поддерживаемым видеосервисам. Замените её ниже.' : user.role === 'captain' ? 'После отправки оргкомитет проверит ссылку или файл и видео.' : 'Добавить или изменить видео может капитан команды.';
    const videoActive = phaseOpen(state.settings?.videoStart, state.settings?.videoDeadline);
    $('#videoUrl').disabled = user.role !== 'captain' || !videoActive;
    $('#videoFile').disabled = user.role !== 'captain' || !videoActive;
    $('#videoForm button').disabled = user.role !== 'captain' || !videoActive;
    if (!videoActive && user.role === 'captain') $('#videoHint').textContent = 'Приём видео откроется в установленный срок.';
    setVideoUrlState(rawUrl, { showInvalid: Boolean(rawUrl) });
  }

  function renderNotifications(items) {
    const unread = items.filter((item) => !item.readBy.includes(state.user.id));
    const bellBadge = $('#bellBadge');
    if (bellBadge) {
      bellBadge.hidden = unread.length === 0;
      bellBadge.textContent = unread.length;
    }
    const sidebarBadge = $('#sidebarNotificationBadge');
    if (sidebarBadge) {
      sidebarBadge.hidden = unread.length === 0;
      sidebarBadge.textContent = unread.length;
    }
    const countEl = $('#notificationCount');
    if (countEl) {
      countEl.hidden = unread.length === 0;
      countEl.textContent = unread.length;
    }
    $('#notificationList').innerHTML = items.length ? items.map((item) => `<article class="cabinet-notification ${item.readBy.includes(state.user.id) ? '' : 'is-unread'}"><h3>${esc(item.title)}</h3><p>${esc(item.message)}</p><footer><time>${date(item.createdAt)}</time>${item.readBy.includes(state.user.id) ? '<span>Прочитано</span>' : `<button type="button" data-read-notification="${item.id}">Прочитано</button>`}</footer></article>`).join('') : '<div class="cabinet-empty">Пока нет сообщений от оргкомитета.</div>';
    $$('[data-read-notification]').forEach((button) => button.addEventListener('click', async () => { await window.lugStore.readNotification(button.dataset.readNotification); await refresh(); }));
  }

  function renderProfile() {
    const user = state.user;
    const nameParts = String(user.fio || '').trim().split(/\s+/).filter(Boolean);
    const lastName = nameParts.shift() || '';
    const firstName = nameParts.shift() || '';
    const patronymic = nameParts.join(' ');
    $('#profileInitial').textContent = nameInitial(user.fio);
    $('#profileCardName').textContent = user.fio || 'Имя не указано';
    $('#profileIdentityGroup').textContent = user.group || '—';
    $('#profileIdentityRole').textContent = user.role === 'captain' ? 'Капитан' : 'Участник';
    $('#profileFio').value = user.fio || '';
    $('#profileLastName').value = lastName;
    $('#profileFirstName').value = firstName;
    $('#profilePatronymic').value = patronymic;
    $('#profileGroup').value = user.group || '';
    $('#profileEmail').value = user.email || '';
    $('#profilePhone').value = user.phone || '';
    $('#profileTelegram').value = user.telegramAccount || '';
    const selectedMessenger = user.messenger && messengerLabels[user.messenger] ? user.messenger : Object.keys(user.messengerContacts || {})[0] || 'telegram';
    $('#profileMessenger').value = selectedMessenger;
    $('#profileContact').value = user.messengerContacts?.[selectedMessenger] || user.messengerContact || '';
    const studentCardInput = $('#profileStudentCardFile');
    const studentCardName = $('#profileStudentCardFileName');
    const studentCardStatus = $('#profileDocumentStatus');
    if (studentCardInput) studentCardInput.value = '';
    if (studentCardName) studentCardName.textContent = user.studentCardFile
      ? 'Выберите новое фото, чтобы заменить текущее'
      : 'Выберите фотографию из личного кабинета';
    if (studentCardStatus) studentCardStatus.textContent = user.studentCardFile
      ? 'Фото уже прикреплено. Новая загрузка отправит его на повторную проверку.'
      : 'Фото ещё не прикреплено.';
    const profileStatus = $('#profileIdentityStatus');
    if (profileStatus) {
      const meta = identityMeta();
      profileStatus.className = `profile-identity__status ${meta.className}`;
      profileStatus.textContent = meta.title;
    }
  }

  function plural(value, one, few, many) { const mod10 = value % 10; const mod100 = value % 100; return mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20) ? few : many; }
  function setMobileNavOpen(open) {
    const toggles = $$('.cabinet-mobile-nav-toggle');
    const panel = $('#cabinetMobileNavPanel');
    const sidebar = document.querySelector('.cabinet-sidebar');
    if (!toggles.length || !panel) return;
    const isCompact = matchMedia('(max-width: 1100px)').matches;
    const shouldOpen = isCompact && open;
    panel.hidden = isCompact ? !shouldOpen : false;
    toggles.forEach((toggle) => toggle.setAttribute('aria-expanded', String(shouldOpen)));
    sidebar?.classList.toggle('is-nav-open', shouldOpen);
  }
  function getCompactNavToggle() {
    return matchMedia('(max-width: 620px)').matches
      ? $('#cabinetMobileNavToggle')
      : $('#cabinetTabletNavToggle');
  }
  function updateMobileNavLabel(view) {
    const current = $(`#${view}-tab`);
    const label = current?.querySelector('.cabinet-nav__lead > span:last-child')?.textContent;
    if (label && $('#cabinetMobileNavCurrent')) $('#cabinetMobileNavCurrent').textContent = label;
  }
  function switchView(view, { focus = false } = {}) {
    $$('.cabinet-nav').forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
      if (active && focus) {
        if (matchMedia('(max-width: 1100px)').matches) getCompactNavToggle()?.focus();
        else button.focus();
      }
    });
    $$('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
    updateMobileNavLabel(view);
    setMobileNavOpen(false);
  }
  async function removeAchievement(id) { if (!confirm('Удалить это достижение из портфолио?')) return; try { await window.lugStore.deleteAchievement(id); await refresh(); } catch (error) { alert(error.message); } }

  async function saveAchievement(event) {
    if (event.submitter?.value === 'cancel') {
      event.preventDefault();
      event.currentTarget.reset();
      $('#achievementFileName').textContent = 'Изображение или документ, до 5 МБ';
      $('#achievementError').textContent = '';
      $('#achievementDialog').close('cancel');
      return;
    }
    event.preventDefault();
    const error = $('#achievementError'); const file = $('#achievementFile').files?.[0]; error.textContent = '';
    if (!file) { error.textContent = 'Прикрепите подтверждающий документ.'; return; }
    try {
      $('#saveAchievement').disabled = true;
      const uploaded = await window.lugStore.upload(file);
      await window.lugStore.addAchievement({ direction: $('#achievementDirection').value, category: $('#achievementCategory').value, title: $('#achievementTitle').value, details: $('#achievementDetails').value, fileUrl: uploaded.url, fileName: uploaded.name });
      $('#achievementDialog').close(); event.target.reset(); direction = $('#achievementDirection').value; await refresh(); switchView('portfolio');
    } catch (reason) { error.textContent = reason.message; } finally { $('#saveAchievement').disabled = false; }
  }

  function bind() {
    const mobileNavToggles = $$('.cabinet-mobile-nav-toggle');
    const mobileNavPanel = $('#cabinetMobileNavPanel');
    if (mobileNavToggles.length && mobileNavPanel) {
      mobileNavToggles.forEach((mobileNavToggle) => {
        mobileNavToggle.addEventListener('click', (event) => { event.stopPropagation(); setMobileNavOpen(mobileNavPanel.hidden); });
      });
      document.addEventListener('click', (event) => {
        const clickedToggle = mobileNavToggles.some((toggle) => toggle.contains(event.target));
        if (!mobileNavPanel.hidden && !clickedToggle && !document.querySelector('.cabinet-sidebar')?.contains(event.target)) setMobileNavOpen(false);
      });
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !mobileNavPanel.hidden) { setMobileNavOpen(false); getCompactNavToggle()?.focus(); }
      });
      addEventListener('resize', () => setMobileNavOpen(false));
      setMobileNavOpen(false);
      updateMobileNavLabel('overview');
    }
    $$('.cabinet-nav').forEach((button) => {
      button.tabIndex = button.classList.contains('is-active') ? 0 : -1;
      button.addEventListener('click', () => switchView(button.dataset.view));
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = $$('.cabinet-nav').filter((item) => !item.hidden);
        const current = tabs.indexOf(button);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        switchView(tabs[next].dataset.view, { focus: true });
      });
    });
    const userMenuBtn = $('#userMenuBtn');
    const userDropdown = $('#userDropdown');
    if (userMenuBtn && userDropdown) {
      userMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = userDropdown.hidden;
        userDropdown.hidden = !open;
        userMenuBtn.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', (e) => {
        if (!userDropdown.hidden && !$('#userMenuContainer')?.contains(e.target)) {
          userDropdown.hidden = true;
          userMenuBtn.setAttribute('aria-expanded', 'false');
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !userDropdown.hidden) {
          userDropdown.hidden = true;
          userMenuBtn.setAttribute('aria-expanded', 'false');
          userMenuBtn.focus();
        }
      });
    }
    $$('[data-open-view]').forEach((button) => button.addEventListener('click', () => {
      switchView(button.dataset.openView, { focus: true });
      if (userDropdown && !userDropdown.hidden) {
        userDropdown.hidden = true;
        userMenuBtn?.setAttribute('aria-expanded', 'false');
      }
    }));
    const directionTabs = $$('.cabinet-direction-tabs button');
    directionTabs.forEach((button) => {
      button.addEventListener('click', () => {
        direction = button.dataset.direction;
        selectedMaterialId = null;
        renderPortfolioSummary();
      });
      button.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = directionTabs.indexOf(button);
        const next = event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? directionTabs.length - 1
            : (current + (event.key === 'ArrowRight' ? 1 : -1) + directionTabs.length) % directionTabs.length;
        direction = directionTabs[next].dataset.direction;
        selectedMaterialId = null;
        renderPortfolioSummary();
        directionTabs[next].focus();
      });
    });
    $('#logoutButton').addEventListener('click', async () => { await window.lugStore.logout(); window.location.href = 'register.html'; });
    $('#portfolio-panel').addEventListener('click', (event) => {
      if (!event.target.closest('#openAchievement')) return;
      $('#achievementDirection').value = direction;
      $('#achievementDialog').showModal();
    });
    $('#achievementForm').addEventListener('submit', saveAchievement);
    $('#achievementFile').addEventListener('change', () => { const file = $('#achievementFile').files?.[0]; $('#achievementFileName').textContent = file ? `${file.name} · ${Math.ceil(file.size / 1024)} КБ` : 'Изображение или документ, до 5 МБ'; });
    $('#profileStudentCardFile')?.addEventListener('change', () => {
      const input = $('#profileStudentCardFile');
      const file = input?.files?.[0];
      if (file && (!file.type.startsWith('image/') || file.size > 5 * 1024 * 1024)) {
        if (input) input.value = '';
        $('#profileStudentCardFileName').textContent = 'Выберите фотографию из личного кабинета';
        $('#profileResult').textContent = file.type.startsWith('image/') ? 'Фото не должно превышать 5 МБ.' : 'Прикрепите файл в формате изображения.';
        return;
      }
      $('#profileStudentCardFileName').textContent = file ? `${file.name} · ${Math.ceil(file.size / 1024)} КБ` : 'Выберите фотографию из личного кабинета';
      $('#profileResult').textContent = '';
    });
    $('#copyInvite').addEventListener('click', async () => { const link = `${location.origin}/register.html?invite=${encodeURIComponent(state.team.inviteCode)}`; try { await navigator.clipboard.writeText(link); $('#copyInvite').textContent = 'Ссылка скопирована'; setTimeout(() => { $('#copyInvite').textContent = 'Скопировать ссылку'; }, 1600); } catch { prompt('Скопируйте ссылку:', link); } });
    $('#rotateInvite').addEventListener('click', async () => { if (!confirm('Старый код станет недействительным. Выпустить новый?')) return; try { await window.lugStore.rotateInvite(); await refresh(); } catch (error) { alert(error.message); } });
    $('#saveTeam').addEventListener('click', async () => { try { await window.lugStore.updateTeam({ description: $('#teamDescription').value }); await refresh(); } catch (error) { alert(error.message); } });
    $('#teamFlagInput').addEventListener('change', async () => { const file = $('#teamFlagInput').files?.[0]; if (!file) return; try { const uploaded = await window.lugStore.upload(file); await window.lugStore.updateTeam({ flagUrl: uploaded.url }); await refresh(); } catch (error) { alert(error.message); } });
    $('#videoUrl').addEventListener('input', () => setVideoUrlState($('#videoUrl').value));
    $('#videoUrl').addEventListener('blur', () => setVideoUrlState($('#videoUrl').value, { showInvalid: true }));
    $('#videoFile').addEventListener('change', () => { const file = $('#videoFile').files?.[0]; if (file && file.size > 50 * 1024 * 1024) { $('#videoFile').value = ''; setVideoFeedback('Видео не должно превышать 50 МБ.', 'error'); } else if (file) { setVideoFeedback(`Выбран файл: ${file.name}`, 'success'); } });
    $('#videoForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = $('#videoUrl');
      const file = $('#videoFile').files?.[0];
      const parsed = setVideoUrlState(input.value, { showInvalid: true });
      if (!parsed.valid && !file) return;
      if (file && file.size > 50 * 1024 * 1024) { setVideoFeedback('Видео не должно превышать 50 МБ.', 'error'); return; }
      const button = $('#videoForm button[type="submit"]');
      button.disabled = true;
      button.classList.add('is-loading');
      try {
        await window.lugStore.updateVideo({ url: file ? '' : parsed.url, file });
        await refresh();
      } catch (error) {
        setVideoFeedback(error.message, 'error');
      } finally {
        button.disabled = state.user.role !== 'captain';
        button.classList.remove('is-loading');
      }
    });
    $('#profileForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = $('#profileForm button[type="submit"]');
      const studentCard = $('#profileStudentCardFile')?.files?.[0];
      if (studentCard && (!studentCard.type.startsWith('image/') || studentCard.size > 5 * 1024 * 1024)) {
        $('#profileResult').textContent = studentCard.type.startsWith('image/') ? 'Фото не должно превышать 5 МБ.' : 'Прикрепите файл в формате изображения.';
        return;
      }
      if (button) button.disabled = true;
      try {
        const fio = [$('#profileLastName').value, $('#profileFirstName').value, $('#profilePatronymic').value].map((value) => value.trim()).filter(Boolean).join(' ');
        $('#profileFio').value = fio;
        const messenger = $('#profileMessenger').value.toLowerCase();
        const messengerContacts = { ...(state.user.messengerContacts || {}) };
        messengerContacts[messenger] = $('#profileContact').value.trim();
        const telegram = $('#profileTelegram').value.trim();
        if (telegram) messengerContacts.telegram = telegram;
        else if (messenger === 'telegram') delete messengerContacts.telegram;
        const payload = { fio, phone: $('#profilePhone').value, messenger, messengerContacts };
        if (studentCard) {
          payload.studentCardFile = await window.lugStore.fileToDataUrl(studentCard);
          payload.studentCardFileName = studentCard.name;
        }
        await window.lugStore.updateProfile(payload);
        $('#profileResult').textContent = studentCard ? 'Профиль и фото отправлены на проверку' : 'Профиль сохранён';
        await refresh();
      } catch (error) {
        $('#profileResult').textContent = error.message;
      } finally {
        if (button) button.disabled = false;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const { user } = await window.lugStore.session();
      if (!user) { window.location.href = 'register.html'; return; }
      if (user.role === 'admin') { window.location.href = 'admin.html'; return; }
      bind(); await refresh();
      setInterval(() => {
        if (document.hidden) return;
        refresh().catch(() => {});
      }, 15000);
    } catch (error) {
      window.location.href = 'register.html';
    }
  });
})();
