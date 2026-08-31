/** Detail renderers for organizer review cards. */

export function renderAchievementDetail({ achievement, team, filterNote, esc, directionLabels, achievementStatusChip, shortDateLabel, dateLabel }) {
  if (!achievement) {
    return `<div class="admin-detail__placeholder"><span class="admin-empty-state__mark" aria-hidden="true">✦</span><h2>Выберите достижение</h2><p>${esc(filterNote || 'Откройте материал, чтобы проверить документ, выставить баллы и принять решение.')}</p></div>`;
  }
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

export function renderUserDetail({ user, state, esc, directionIcons, directionLabels, achievementStatusChip }) {
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
  const achievementsBlock = `<section class="admin-surface admin-user-achievements" aria-labelledby="admin-user-achievements-title"><div class="admin-section-heading"><div><p class="admin-eyebrow">Портфолио участника</p><h3 id="admin-user-achievements-title">Достижения</h3></div><span class="admin-section-heading__actions"><span class="admin-section-heading__count">${userAchievements.length}</span><button class="admin-text-button" type="button" data-open-achievements-user="${esc(user.id)}">Учёт достижений →</button></span></div>${userAchievements.length ? `<div class="admin-user-achievements__list">${userAchievements.map((item) => `<button class="admin-user-achievement" type="button" data-select-achievement="${esc(item.id)}"><span class="admin-user-achievement__icon admin-achievement-row__icon--${esc(item.direction || 'science')}" aria-hidden="true">${directionIcons[item.direction] || directionIcons.science}</span><span class="admin-user-achievement__copy"><small>${esc(directionLabels[item.direction] || 'Направление')} · ${esc(item.category || 'без категории')}</small><strong>${esc(item.title || 'Достижение без названия')}</strong></span><span class="admin-user-achievement__side">${item.points != null ? `<span class="admin-achievement-row__points">${Number(item.points)} б.</span>` : ''}${achievementStatusChip(item.status)}</span></button>`).join('')}</div>` : '<p class="admin-empty">Участник ещё не добавил достижений в портфолио.</p>'}</section>`;
  return `<div class="admin-detail__topbar"><button class="admin-user-back" type="button" data-user-back>← Все участники</button><span>Карточка участника</span></div><section class="admin-surface admin-user-card"><header class="admin-user-card__header"><div><p class="admin-card-kicker">${user.id === team?.captainId ? 'Капитан команды' : 'Участник'} · ${esc(team?.name || 'Без команды')}</p><h2>${esc(user.fio)}</h2><p>${esc(user.phone || 'Телефон не указан')} · ${esc(user.group || team?.group || 'Группа не указана')}</p></div><div class="admin-user-card__header__side">${statusChip}<span class="admin-user-card__header__links"><button class="admin-text-button" type="button" data-select-team="${esc(team?.id || '')}">Открыть команду →</button></span></div></header>${documentBlock}<form class="admin-user-decision-form" data-user-decision="${esc(user.id)}"><input type="hidden" data-user-decision-status value="${status}">${decisionButtons}<label class="admin-field admin-user-decision-comment admin-comment-field"${status === 'rejected' ? '' : ' hidden'}><span>Почему отклоняете участника</span><textarea class="admin-control admin-control--roomy" id="${decisionCommentId}" rows="4" data-user-decision-comment placeholder="Например: приложите более чёткий документ с читаемыми данными."${status === 'rejected' ? ' required' : ''}>${esc(user.identityComment || '')}</textarea></label><p class="admin-user-decision-hint" data-user-decision-hint>Подтверждение отправится сразу. Для отклонения сначала укажите причину.</p></form></section>${achievementsBlock}`;
}

export function renderTeamStage({ team, esc, workflowPresentation, workflowMeta }) {
  const current = workflowPresentation(team, workflowMeta);
  const stageKey = current.key === 'needs-work' ? 'needs-work' : current.key === 'ready' ? 'ready' : current.key === 'review' ? 'review' : 'new';
  const stageIcon = stageKey === 'ready' ? '✓' : stageKey === 'needs-work' ? '!' : stageKey === 'review' ? '…' : '○';
  return `<section class="admin-team-stage admin-team-stage--${stageKey}" aria-labelledby="team-stage-title"><div class="admin-team-stage__icon" aria-hidden="true">${stageIcon}</div><div class="admin-team-stage__summary"><p class="admin-eyebrow">Текущая стадия команды</p><h3 id="team-stage-title">${esc(workflowMeta[stageKey].label)}</h3><p>${esc(current.reason || workflowMeta[stageKey].note)}</p></div></section>`;
}

export function renderTeamProfileReview({ team, esc }) {
  const labels = { name: 'Название команды', group: 'Учебная группа', flag: 'Флаг команды', description: 'Описание команды' };
  const values = { name: team.name, group: team.group, flag: team.flagUrl ? 'Файл флага загружен' : 'Флаг не загружен', description: team.description || 'Описание не добавлено' };
  return `<form class="admin-surface admin-team-profile-review" data-team-profile-review="${esc(team.id)}" aria-labelledby="team-profile-review-title"><div class="admin-section-heading"><div><p class="admin-eyebrow">Проверка заявки</p><h3 id="team-profile-review-title">Данные команды</h3></div><span class="admin-team-profile-review__hint">Выберите решение и отправьте его</span></div><div class="admin-team-profile-review__list">${Object.entries(labels).map(([field, label]) => {
    const review = team.review?.[field] || { status: 'pending', comment: '' };
    const status = review.status === 'approved' || review.status === 'rejected' ? review.status : '';
    return `<article class="admin-team-profile-item is-${status || 'pending'}" data-team-review-item="${field}" data-team-review-choice="${status}"><div class="admin-team-profile-item__value"><span>${label}</span><strong>${esc(values[field])}</strong>${field === 'flag' && team.flagUrl ? `<a class="admin-inline-link" href="${esc(team.flagUrl)}" target="_blank" rel="noopener">Открыть флаг ↗</a>` : ''}</div><div class="admin-team-profile-item__decision"><div class="admin-review-buttons" role="group" aria-label="Решение по полю ${label}"><button class="admin-review-choice admin-review-choice--approve${status === 'approved' ? ' is-active' : ''}" type="button" data-team-review-action="${field}" data-team-review-value="approved">Подтвердить</button><button class="admin-review-choice admin-review-choice--reject${status === 'rejected' ? ' is-active' : ''}" type="button" data-team-review-action="${field}" data-team-review-value="rejected">Отклонить</button></div><label class="admin-team-profile-item__comment admin-comment-field" data-team-review-comment-wrap="${field}"${status === 'rejected' ? '' : ' hidden'}><span>Почему отклонено</span><textarea class="admin-control admin-control--roomy" data-team-review-comment="${field}" rows="3" placeholder="Оставьте комментарий для команды — его увидят капитан и участники">${esc(review.comment || '')}</textarea></label></div></article>`;
  }).join('')}</div><div class="admin-team-profile-review__footer"><p class="admin-team-profile-review__footnote">Решение отправится команде только после нажатия кнопки.</p><button class="admin-button admin-button--primary" type="submit">Отправить решение</button></div></form>`;
}
