export function bindAdminEvents({
  $, adminApi, applyHash, closeSidebar, filters, goToView, initAdmin, loadMoreCollection, openSidebar, refreshAdmin, renderAchievements, renderTeams, renderTargetSuboptions, renderUsers, reviewAchievement, reviewVideo, run, saveSettings, selectAchievement, selectTeam, selectUser, selected, sendBroadcast, showToast, submitMemberReview, submitTeamProfileReview, submitUserDecision, switchAdminTab, syncReviewCommentVisibility, updateCounters,
}) {
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
      const loadMore = event.target.closest('[data-admin-load-more]');
      if (loadMore) {
        loadMore.disabled = true;
        run(() => loadMoreCollection(loadMore.dataset.adminLoadMore))
          .finally(() => { if (loadMore.isConnected) loadMore.disabled = false; });
        return;
      }
      const back = event.target.closest('[data-team-back]');
      if (back) { selected.team = null; renderTeams(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const userBack = event.target.closest('[data-user-back]');
      if (userBack) { selected.user = null; renderUsers(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const achievementBack = event.target.closest('[data-achievement-back]');
      if (achievementBack) { selected.achievement = null; renderAchievements(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
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
        selected.achievement = null;
        switchAdminTab('achievements');
        renderAchievements();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const openUserAchievements = event.target.closest('[data-open-achievements-user]');
      if (openUserAchievements) {
        filters.achievementUserId = openUserAchievements.dataset.openAchievementsUser;
        filters.achievementTeamId = '';
        selected.achievement = null;
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
        if (teamId) { selected.team = teamId; }
        goToView(target.dataset.adminViewTarget);
        if (teamId) renderTeams();
        return;
      }
      const remove = event.target.closest('[data-remove-member]');
      if (remove) {
        run(async () => {
          if (!window.confirm('Удалить участника из команды? Его материалы также будут удалены.')) return;
          await adminApi.adminRemoveMember(remove.dataset.removeMember, remove.dataset.memberId);
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
      if (quota) run(async () => { await adminApi.adminUpdateQuota(quota.dataset.teamQuota, quota.checked); await refreshAdmin(); });
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
    $('adminLogoutButton')?.addEventListener('click', () => run(async () => { await adminApi.logout(); window.location.replace('index.html'); }));
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
}
