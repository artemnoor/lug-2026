export function createAdminActions({ $, adminApi, busy, run, showError, showToast, refreshAdmin, renderTargetSuboptions, updateCounters, syncReviewCommentVisibility, getSelectedTeamId }) {
  const reviewAchievement = async (achievementId) => run(async () => {
    const item = document.querySelector(`[data-achievement-review-item="${CSS.escape(achievementId)}"]`);
    const status = item?.dataset.achievementReviewChoice || '';
    const points = document.querySelector(`[data-achievement-points="${CSS.escape(achievementId)}"]`)?.value;
    const comment = document.querySelector(`[data-achievement-comment="${CSS.escape(achievementId)}"]`)?.value.trim() || '';
    if (!status) { showError('Выберите: принять достижение или отклонить его.'); return; }
    if (status === 'rejected' && !comment) { showError('Для отклонённого достижения укажите причину.'); document.querySelector(`[data-achievement-comment="${CSS.escape(achievementId)}"]`)?.focus(); return; }
    await adminApi.adminReviewAchievement(achievementId, { status, points, comment });
    showToast('Готово', 'Решение по достижению сохранено.', 'success');
    await refreshAdmin();
  });

  const reviewVideo = async (teamId, status) => run(async () => {
    const scores = {};
    document.querySelectorAll(`[data-video-score][data-team-id="${CSS.escape(teamId)}"]`).forEach((input) => { scores[input.dataset.videoScore] = input.value; });
    const comment = document.querySelector(`[data-video-comment="${CSS.escape(teamId)}"]`)?.value || '';
    await adminApi.adminReviewVideo(teamId, { status, criteriaScores: scores, comment });
    showToast('Готово', status === 'approved' ? 'Видео принято, оценка сохранена.' : 'Видео возвращено на уточнение.', 'success');
    await refreshAdmin();
  });

  const submitTeamProfileReview = async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = event.submitter || form.querySelector('[type="submit"]');
    await busy(button, () => run(async () => {
      const decisions = Array.from(form.querySelectorAll('[data-team-review-item]')).map((item) => ({ field: item.dataset.teamReviewItem, status: item.dataset.teamReviewChoice || '', comment: item.querySelector('[data-team-review-comment]')?.value.trim() || '' }));
      const missing = decisions.find((item) => !item.status);
      if (missing) { showError('Выберите решение по каждому полю заявки.'); form.querySelector(`[data-team-review-action="${CSS.escape(missing.field)}"]`)?.focus(); return; }
      const rejected = decisions.find((item) => item.status === 'rejected' && !item.comment);
      if (rejected) { showError('Для каждого пункта «Доработка» укажите комментарий.'); form.querySelector(`[data-team-review-comment="${CSS.escape(rejected.field)}"]`)?.focus(); return; }
      await Promise.all(decisions.map((item) => adminApi.adminReviewTeamField(getSelectedTeamId(), item.field, item.status, item.comment)));
      showToast('Готово', 'Решение по заявке отправлено команде.', 'success');
      await refreshAdmin();
    }));
  };

  const submitMemberReview = async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = event.submitter || form.querySelector('[type="submit"]');
    await busy(button, () => run(async () => {
      const decisions = Array.from(form.querySelectorAll('[data-member-review-item]')).map((item) => ({ userId: item.dataset.memberReviewItem, status: item.dataset.memberReviewChoice || '', comment: item.querySelector('[data-identity-comment]')?.value.trim() || '' }));
      const missing = decisions.find((item) => !item.status);
      if (missing) { showError('Выберите решение по каждому участнику.'); form.querySelector(`[data-member-review-action="${CSS.escape(missing.userId)}"]`)?.focus(); return; }
      const rejected = decisions.find((item) => item.status === 'rejected' && !item.comment);
      if (rejected) { showError('Для каждого участника со статусом «Доработка» укажите комментарий.'); form.querySelector(`[data-identity-comment="${CSS.escape(rejected.userId)}"]`)?.focus(); return; }
      await Promise.all(decisions.map((item) => adminApi.adminReviewIdentity(item.userId, item.status, item.comment)));
      showToast('Готово', 'Решения по составу отправлены.', 'success');
      await refreshAdmin();
    }));
  };

  const submitUserDecision = async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = event.submitter || form.querySelector('[type="submit"]');
    await busy(button, () => run(async () => {
      const status = event.submitter?.dataset.userDecisionAction || form.querySelector('[data-user-decision-status]')?.value || 'pending';
      const comment = form.querySelector('[data-user-decision-comment]')?.value.trim() || '';
      if (!['approved', 'rejected'].includes(status)) { showError('Выберите: подтвердить участника или отклонить его.'); return; }
      const statusInput = form.querySelector('[data-user-decision-status]');
      if (statusInput) statusInput.value = status;
      syncReviewCommentVisibility(form);
      if (status === 'rejected' && !comment) { showError('Для отклонения участника укажите причину.'); form.querySelector('[data-user-decision-comment]')?.focus(); return; }
      await adminApi.adminReviewIdentity(form.dataset.userDecision, status, status === 'rejected' ? comment : '');
      showToast('Готово', status === 'approved' ? 'Участник подтверждён.' : 'Участник отправлен на доработку.', 'success');
      await refreshAdmin();
    }));
  };

  const saveSettings = async () => busy($('#saveAdminSettingsButton'), () => run(async () => {
    const dateKeys = ['registrationStart', 'registrationDeadline', 'portfolioStart', 'portfolioDeadline', 'videoStart', 'videoDeadline', 'resultsStart', 'resultsDeadline'];
    const payload = Object.fromEntries(dateKeys.map((key) => [key, isoDateValue($(`${key}Input`)?.value)]).filter(([, value]) => value));
    payload.isRegistrationOpen = $('#regIsOpenCheckbox')?.checked;
    await adminApi.adminUpdateSettings(payload);
    await refreshAdmin();
    if ($('#adminSettingsNote')) $('#adminSettingsNote').textContent = 'Параметры сохранены';
    showToast('Сохранено', 'Сроки конкурса обновлены.', 'success');
  }));

  const sendBroadcast = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    await busy(form.querySelector('[type="submit"]'), () => run(async () => {
      const type = document.querySelector('input[name="notifTargetType"]:checked')?.value || 'all';
      const result = await adminApi.adminBroadcast({ targetType: type, targetId: type === 'all' ? null : $('#notifTargetId')?.value, title: $('#notifTitleInput')?.value, message: $('#notifMessageInput')?.value });
      form.reset();
      renderTargetSuboptions();
      updateCounters(form);
      if ($('#broadcastSuccess')) $('#broadcastSuccess').hidden = false;
      await refreshAdmin();
      const emailNotice = Number(result.emailRecipients || 0) > 0 ? result.emailMode === 'smtp' ? ` Письма отправлены участникам: ${Number(result.emailSent || 0)} из ${Number(result.emailRecipients || 0)}.` : ' В development письма записаны в лог.' : '';
      showToast('Отправлено', `Рассылка доставлена получателям.${emailNotice}`, 'success');
    }));
  };

  return { reviewAchievement, reviewVideo, saveSettings, sendBroadcast, submitMemberReview, submitTeamProfileReview, submitUserDecision };
}

function isoDateValue(value) {
  return value ? new Date(value).toISOString() : '';
}
