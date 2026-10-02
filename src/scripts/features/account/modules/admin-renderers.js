/** Pure list renderers for the organizer workspace. */

export function renderTeamRow({ team, index, selectedTeamId, esc, plural, pendingForTeam, workflowPresentation, workflowMeta }) {
  const current = workflowPresentation(team, workflowMeta);
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

export function renderUserRow({ user, state, selectedUserId, esc, initials }) {
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

export function renderRating({ state, $, esc, createRatingRows, workflowPresentation, workflowMeta, directionLabels, plural }) {
  const board = $('adminRatingBoard');
  if (!board || !state) return;
  const rows = createRatingRows(state.teams || []);
  const inRace = rows.filter((row) => row.admitted);
  if ($('adminRatingTeamsCount')) $('adminRatingTeamsCount').textContent = inRace.length;
  const maxTotal = Math.max(1, ...rows.map((row) => row.total));
  if (!rows.length) {
    board.innerHTML = '<div class="admin-empty-state"><span class="admin-empty-state__mark" aria-hidden="true">★</span><h3>Рейтинг пока пуст</h3><p>Зарегистрируйте команды — баллы появятся после первых принятых достижений.</p></div>';
    return;
  }
  const medals = ['gold', 'silver', 'bronze'];
  const podium = rows.slice(0, 3);
  const podiumHtml = podium.length ? `<div class="admin-podium" aria-label="Пьедестал лидеров">${[1, 0, 2].filter((index) => podium[index]).map((index) => {
    const row = podium[index];
    const place = index + 1;
    return `<button class="admin-podium__place admin-podium__place--${medals[index]}${row.admitted ? '' : ' is-shadow'}" type="button" data-select-team="${esc(row.team.id)}"><span class="admin-podium__medal" aria-hidden="true">${place}</span><strong class="admin-podium__name">${esc(row.team.name)}</strong><small class="admin-podium__group">${esc(row.team.group || 'Группа не указана')}</small><span class="admin-podium__score">${row.total}<small>баллов</small></span><span class="admin-podium__breakdown">${row.achievementPoints} б. достижения · ${row.videoPoints} б. видео</span>${row.admitted ? '' : '<span class="admin-podium__note">вне зачёта</span>'}</button>`;
  }).join('')}</div>` : '';
  const tableRows = rows.map((row, index) => {
    const place = index + 1;
    const width = Math.round((row.total / maxTotal) * 100);
    const workflowNow = workflowPresentation(row.team, workflowMeta);
    return `<button class="admin-rating-row${row.admitted ? '' : ' is-shadow'}" type="button" data-select-team="${esc(row.team.id)}" aria-label="Открыть команду ${esc(row.team.name)}"><span class="admin-rating-row__place${place <= 3 ? ` admin-rating-row__place--${medals[place - 1]}` : ''}">${place}</span><span class="admin-rating-row__copy"><small>${esc(row.team.group || 'Группа не указана')} · ${row.team.members?.length || 0} ${plural(row.team.members?.length || 0, 'участник', 'участника', 'участников')}</small><strong>${esc(row.team.name)}</strong><span class="admin-rating-row__bar" aria-hidden="true"><i style="width:${Math.max(4, width)}%"></i></span><span class="admin-rating-row__directions">${Object.entries(directionLabels).map(([key, label]) => row.byDirection[key] ? `<b>${label} ${row.byDirection[key]}</b>` : '').join('') || 'принятых достижений пока нет'}</span></span><span class="admin-rating-row__score"><strong>${row.total}</strong><small>${row.achievementPoints} дост. + ${row.videoPoints} видео</small><small>${row.approvedCount} / ${row.totalCount} ${plural(row.totalCount, 'достижение', 'достижения', 'достижений')}${row.pendingCount ? ` · ${row.pendingCount} на проверке` : ''}</small><span class="admin-status ${row.admitted ? 'admin-status--ready' : 'admin-status--pending'}">${row.admitted ? 'В зачёте' : esc(workflowNow.label)}</span></span></button>`;
  }).join('');
  const notAdmittedNote = rows.length - inRace.length;
  board.innerHTML = `${podiumHtml}<section class="admin-surface admin-rating-table" aria-labelledby="admin-rating-table-title"><div class="admin-section-heading"><div><p class="admin-eyebrow">Полная таблица</p><h2 id="admin-rating-table-title">Баллы всех групп</h2></div><span class="admin-section-heading__count">${rows.length}</span></div><div class="admin-rating-table__rows">${tableRows}</div>${notAdmittedNote ? '<p class="admin-rating-note">Отмеченные как «вне зачёта» команды не прошли допуск: нажмите карточку, чтобы открыть проверку состава и заявки.</p>' : ''}</section>`;
}

export function achievementStatusChip(status) {
  const meta = { approved: ['Принято', 'admin-status--ready'], rejected: ['Доработка', 'admin-status--danger'] }[status] || ['На проверке', 'admin-status--pending'];
  return `<span class="admin-status ${meta[1]}">${meta[0]}</span>`;
}

export function renderAchievementRow({ achievement, team, selectedAchievementId, esc, directionIcons, directionLabels }) {
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
