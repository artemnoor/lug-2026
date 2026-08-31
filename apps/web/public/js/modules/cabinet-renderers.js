/** Small cabinet view renderers with explicit dependencies. */

export function renderNotifications({ items, state, $, $$, esc, date, readNotification, refresh }) {
  const unread = items.filter((item) => !(item.readBy || []).includes(state.user.id));
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
  const list = $('#notificationList');
  if (!list) return;
  list.innerHTML = items.length
    ? items.map((item) => {
      const read = (item.readBy || []).includes(state.user.id);
      return `<article class="cabinet-notification ${read ? '' : 'is-unread'}"><h3>${esc(item.title)}</h3><p>${esc(item.message)}</p><footer><time>${date(item.createdAt)}</time>${read ? '<span>Прочитано</span>' : `<button type="button" data-read-notification="${esc(item.id)}">Прочитано</button>`}</footer></article>`;
    }).join('')
    : '<div class="cabinet-empty">Пока нет сообщений от оргкомитета.</div>';
  $$('[data-read-notification]').forEach((button) => button.addEventListener('click', async () => {
    await readNotification(button.dataset.readNotification);
    await refresh();
  }));
}

export function renderProfile({ state, $, nameInitial, messengerLabels, identityMeta }) {
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

export function renderTeam({ state, $, $$, esc, date, phaseOpen }) {
  const { user, team, members } = state;
  const captain = user.role === 'captain';
  $('#teamCaptainOnly').hidden = !captain;
  $('#teamCaptainEdit').hidden = !captain;
  if (!team) {
    $('#teamCaptainEdit').hidden = true;
    $('#teamLead').textContent = 'Вы пока не состоите в команде.';
    $('#memberList').innerHTML = '<div class="cabinet-empty">Капитан отправит приглашение. После регистрации по ссылке вы увидите состав команды здесь.</div>';
    return;
  }
  const quota = team.quota;
  $('#teamLead').textContent = `${team.name} · ${team.group}. Сейчас в команде ${quota.members} из ${quota.total} студентов.`;
  $('#quotaBadge').textContent = quota.eligible ? 'Минимальный состав набран' : `Нужно ещё: ${quota.required - quota.members}`;
  $('#inviteCode').textContent = team.inviteCode;
  $('#inviteExpires').textContent = date(team.inviteExpiresAt);
  $('#teamDescription').value = team.description || '';
  $('#teamFlagPreview').hidden = !team.flagUrl;
  $('#teamFlagEmpty').hidden = Boolean(team.flagUrl);
  if (team.flagUrl) $('#teamFlagPreview').src = team.flagUrl;
  $('#memberList').innerHTML = members.length
    ? members.map((member) => `<article class="cabinet-member"><div><strong>${esc(member.fio)}</strong><small>${esc(member.role === 'captain' ? 'Капитан команды' : 'Участник')} · ${esc(member.group)}</small></div><span>${member.role === 'captain' ? 'Капитан' : 'Участник'}</span><span class="cabinet-member__status ${member.identityStatus === 'approved' ? 'is-approved' : ''}">${member.identityStatus === 'approved' ? '✓ Данные проверены' : '⌛ Проверяем данные'}</span></article>`).join('')
    : '<div class="cabinet-empty">Участники появятся здесь после регистрации по приглашению.</div>';
  const registrationActive = phaseOpen(state.settings?.registrationStart, state.settings?.registrationDeadline) && state.settings?.isRegistrationOpen !== false;
  ['#copyInvite', '#rotateInvite', '#saveTeam', '#teamFlagInput'].forEach((selector) => {
    const control = $(selector);
    if (control) control.disabled = !registrationActive;
  });
}

export function renderVideo({ state, $, parseVideoUrl, phaseOpen, setVideoUrlState }) {
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

export function renderDashboard({ state, $, $$, esc, identity, switchView }) {
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
  status.querySelector('[data-open-view]')?.addEventListener('click', () => switchView('profile', { focus: true }));
  $('#overviewInsights').innerHTML = `<section class="cabinet-overview__path" aria-labelledby="overview-path-title"><header><div><h3 id="overview-path-title"><span class="cabinet-overview__path-count">${journeyDone}</span><span class="cabinet-overview__path-caption"><small>из</small><b>${journey.length}</b><em>шагов</em></span><span class="cabinet-overview__path-complete">завершены</span></h3></div></header><ol>${journey.map(([key, label, done, view], index) => `<li class="${done ? 'is-done' : index === nextJourney ? 'is-current' : ''}"><button type="button" data-overview-view="${view}" aria-label="Открыть раздел «${label}»"><span>${done ? '✓' : String(index + 1).padStart(2, '0')}</span><strong>${label}</strong><small>${done ? 'Готово' : index === nextJourney ? 'Следующий шаг' : 'Впереди'}</small></button></li>`).join('')}</ol></section>`;
  $$('[data-overview-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.overviewView, { focus: true })));
}

export function renderOverview({ state, $, esc, profileReady, hasVideo }) {
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

export function renderPortfolioSummary({ state, $, $$, esc, date, direction, selectedMaterialId, setSelectedMaterialId, rerender }) {
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
    return { key, label, records, count: records.length, approved: records.filter((item) => item.status === 'approved').length, pending: records.filter((item) => item.status !== 'approved' && item.status !== 'rejected').length, rejected: records.filter((item) => item.status === 'rejected').length };
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
  const renderProgress = (title, description, position, completed = false, stateClass = 'is-pending') => {
    const statusTitle = completed ? 'Принято' : stateClass === 'is-rejected' ? 'Отклонено' : 'На проверке';
    const progressTitle = completed ? 'Проверка завершена' : title;
    const steps = stageLabels.map((label, index) => {
      const current = !completed && index + 1 === position;
      const done = completed || index + 1 < position;
      return `<li class="${done ? 'is-done' : current ? 'is-current' : ''}"${current ? ' aria-current="step"' : ''}><span class="cabinet-materials__progress-node" aria-hidden="true">${done ? '✓' : current ? '•' : ''}</span><strong>${esc(label)}</strong><small>${done ? 'Завершён' : current ? 'Сейчас' : 'Впереди'}</small></li>`;
    }).join('');
    return `<section class="cabinet-materials__progress ${stateClass}" data-stage-position="${position}" aria-label="Этапы проверки"><header class="cabinet-materials__progress-header"><div><span>Этап проверки</span><strong>${esc(progressTitle)}</strong></div><span class="cabinet-materials__progress-status">${statusTitle}</span></header><ol class="cabinet-materials__progress-steps" aria-label="Последовательность этапов">${steps}</ol><p><strong>${completed ? 'Проверка завершена.' : `${esc(title)}.`}</strong> ${completed ? 'Материал прошёл все этапы и согласован оргкомитетом.' : esc(description)}</p></section>`;
  };
  const renderDetails = (item) => {
    const rejected = item.status === 'rejected';
    const approved = item.status === 'approved';
    const [stageTitle, stageDescription, stagePosition] = reviewStage(item);
    const comment = item.reviewComment || item.rejectionReason || item.comment || item.review?.comment || '';
    if (approved) return `<p class="cabinet-materials__message cabinet-materials__message--approved"><strong>Материал согласован.</strong>${item.points !== null && item.points !== undefined ? ` Начислено: ${esc(item.points)} б.` : ''}</p>${renderProgress('', '', 4, true, 'is-approved')}`;
    if (rejected) return `<p class="cabinet-materials__message cabinet-materials__message--attention"><span>Комментарий оргкомитета</span>${esc(comment || 'Причина пока не добавлена. Напишите организаторам, чтобы уточнить решение.')}${comment ? '' : ' <a href="https://t.me/studsovet_bmstu" target="_blank" rel="noopener">Написать организаторам</a>'}</p><p class="cabinet-materials__rejection-stage"><strong>Отклонено на этапе:</strong> ${stageTitle}</p>${renderProgress(stageTitle, stageDescription, stagePosition, false, 'is-rejected')}`;
    return renderProgress(stageTitle, stageDescription, stagePosition);
  };
  const renderCard = (item) => {
    const [statusTitle, statusClass] = item.status === 'approved' ? ['Принято', 'is-approved'] : item.status === 'rejected' ? ['Отклонено', 'is-rejected'] : ['На проверке', 'is-pending'];
    const expanded = selectedMaterialId === item.id;
    const detailId = `material-detail-${item.id}`;
    const [stageTitle] = reviewStage(item);
    const stageLabel = item.status === 'approved' ? 'Все этапы пройдены' : stageTitle;
    const updatedAt = item.stageUpdatedAt || item.reviewedAt || item.createdAt;
    return `<article class="cabinet-material-card ${statusClass} ${expanded ? 'is-open' : ''}"><button class="cabinet-material-card__toggle" type="button" data-material-id="${esc(item.id)}" aria-expanded="${String(expanded)}" aria-controls="${detailId}"><span class="cabinet-material-card__title"><strong>${esc(item.title)}</strong><small>${esc(item.details || item.category)}</small></span><span class="cabinet-material-card__status"><span class="cabinet-material-card__status-badge">${statusTitle}</span></span><span class="cabinet-material-card__stage">${stageLabel}</span><time class="cabinet-material-card__date" datetime="${esc(updatedAt || '')}">${date(updatedAt)}</time><span class="cabinet-material-card__arrow" aria-hidden="true">↗</span></button>${expanded ? `<div class="cabinet-material-card__detail" id="${detailId}"><div class="cabinet-material-card__file"><span>Подтверждающий документ</span><a href="${esc(item.fileUrl)}" target="_blank" rel="noopener">Открыть документ ↗</a></div>${renderDetails(item)}</div>` : ''}</article>`;
  };
  const groups = [['pending', 'Ожидают проверки', activeDirection.records.filter((item) => item.status !== 'approved' && item.status !== 'rejected')], ['approved', 'Приняты', activeDirection.records.filter((item) => item.status === 'approved')], ['rejected', 'Отклонены', activeDirection.records.filter((item) => item.status === 'rejected')]];
  const visibleGroups = groups.filter(([, , records]) => records.length);
  const cardsMarkup = visibleGroups.length ? `<div class="cabinet-material-table" role="table" aria-label="Материалы направления"><div class="cabinet-material-table__head" role="row"><span role="columnheader">Заявка</span><span role="columnheader">Статус</span><span role="columnheader">Этап проверки</span><span role="columnheader">Дата</span><span aria-hidden="true"></span></div>${visibleGroups.map(([, label, records]) => `<section class="cabinet-material-group" aria-labelledby="materials-group-${label}"><header><h4 id="materials-group-${label}">${label}</h4><span>${records.length}</span></header><div class="cabinet-material-list">${records.map(renderCard).join('')}</div></section>`).join('')}</div>` : '';
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
    setSelectedMaterialId(selectedMaterialId === button.dataset.materialId ? null : button.dataset.materialId);
    rerender();
  }));
}
