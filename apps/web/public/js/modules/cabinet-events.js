export function bindCabinetEvents({
  $, $$, getState, getDirection, setDirection, clearSelection,
  setMobileNavOpen, getCompactNavToggle, updateMobileNavLabel, switchView,
  renderPortfolioSummary, saveAchievement, refresh, setVideoFeedback,
  setVideoUrlState, cabinetApi,
}) {
  const state = () => getState();

  const mobileNavToggles = $$('.cabinet-mobile-nav-toggle');
  const mobileNavPanel = $('#cabinetMobileNavPanel');
  if (mobileNavToggles.length && mobileNavPanel) {
    mobileNavToggles.forEach((mobileNavToggle) => {
      mobileNavToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        setMobileNavOpen(mobileNavPanel.hidden);
      });
    });
    document.addEventListener('click', (event) => {
      const clickedToggle = mobileNavToggles.some((toggle) => toggle.contains(event.target));
      if (!mobileNavPanel.hidden && !clickedToggle && !document.querySelector('.cabinet-sidebar')?.contains(event.target)) setMobileNavOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !mobileNavPanel.hidden) {
        setMobileNavOpen(false);
        getCompactNavToggle()?.focus();
      }
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
    userMenuBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = userDropdown.hidden;
      userDropdown.hidden = !open;
      userMenuBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (event) => {
      if (!userDropdown.hidden && !$('#userMenuContainer')?.contains(event.target)) {
        userDropdown.hidden = true;
        userMenuBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !userDropdown.hidden) {
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
      setDirection(button.dataset.direction);
      clearSelection();
      renderPortfolioSummary();
    });
    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const current = directionTabs.indexOf(button);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? directionTabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + directionTabs.length) % directionTabs.length;
      setDirection(directionTabs[next].dataset.direction);
      clearSelection();
      renderPortfolioSummary();
      directionTabs[next].focus();
    });
  });

  $('#logoutButton').addEventListener('click', async () => {
    await cabinetApi.logout();
    window.location.href = 'register.html';
  });
  $('#portfolio-panel').addEventListener('click', (event) => {
    if (!event.target.closest('#openAchievement')) return;
    $('#achievementDirection').value = getDirection();
    $('#achievementDialog').showModal();
  });
  $('#achievementForm').addEventListener('submit', saveAchievement);
  $('#achievementFile').addEventListener('change', () => {
    const file = $('#achievementFile').files?.[0];
    $('#achievementFileName').textContent = file ? `${file.name} · ${Math.ceil(file.size / 1024)} КБ` : 'Изображение или документ, до 5 МБ';
  });
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

  $('#copyInvite').addEventListener('click', async () => {
    const link = `${location.origin}/register.html?invite=${encodeURIComponent(state().team.inviteCode)}`;
    try {
      await navigator.clipboard.writeText(link);
      $('#copyInvite').textContent = 'Ссылка скопирована';
      setTimeout(() => { $('#copyInvite').textContent = 'Скопировать ссылку'; }, 1600);
    } catch { prompt('Скопируйте ссылку:', link); }
  });
  $('#rotateInvite').addEventListener('click', async () => {
    if (!confirm('Старый код станет недействительным. Выпустить новый?')) return;
    try { await cabinetApi.rotateInvite(); await refresh(); } catch (error) { alert(error.message); }
  });
  $('#saveTeam').addEventListener('click', async () => {
    try { await cabinetApi.updateTeam({ description: $('#teamDescription').value }); await refresh(); } catch (error) { alert(error.message); }
  });
  $('#teamFlagInput').addEventListener('change', async () => {
    const file = $('#teamFlagInput').files?.[0];
    if (!file) return;
    try {
      const uploaded = await cabinetApi.upload(file);
      await cabinetApi.updateTeam({ flagUrl: uploaded.url });
      await refresh();
    } catch (error) { alert(error.message); }
  });
  $('#videoUrl').addEventListener('input', () => setVideoUrlState($('#videoUrl').value));
  $('#videoUrl').addEventListener('blur', () => setVideoUrlState($('#videoUrl').value, { showInvalid: true }));
  $('#videoFile').addEventListener('change', () => {
    const file = $('#videoFile').files?.[0];
    if (file && file.size > 50 * 1024 * 1024) {
      $('#videoFile').value = '';
      setVideoFeedback('Видео не должно превышать 50 МБ.', 'error');
    } else if (file) setVideoFeedback(`Выбран файл: ${file.name}`, 'success');
  });
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
      await cabinetApi.updateVideo({ url: file ? '' : parsed.url, file });
      await refresh();
    } catch (error) {
      setVideoFeedback(error.message, 'error');
    } finally {
      button.disabled = state().user.role !== 'captain';
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
      const messengerContacts = { ...(state().user.messengerContacts || {}) };
      messengerContacts[messenger] = $('#profileContact').value.trim();
      const telegram = $('#profileTelegram').value.trim();
      if (telegram) messengerContacts.telegram = telegram;
      else if (messenger === 'telegram') delete messengerContacts.telegram;
      const payload = { fio, phone: $('#profilePhone').value, messenger, messengerContacts };
      if (studentCard) {
        const uploaded = await cabinetApi.upload(studentCard, 'student-card');
        payload.studentCardFile = uploaded.url;
        payload.studentCardFileName = studentCard.name;
      }
      await cabinetApi.updateProfile(payload);
      $('#profileResult').textContent = studentCard ? 'Профиль и фото отправлены на проверку' : 'Профиль сохранён';
      await refresh();
    } catch (error) {
      $('#profileResult').textContent = error.message;
    } finally {
      if (button) button.disabled = false;
    }
  });
}
