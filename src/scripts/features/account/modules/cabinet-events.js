export function bindCabinetEvents({
  $, $$, getState, getDirection, setDirection, clearSelection,
  setMobileNavOpen, getCompactNavToggle, updateMobileNavLabel, switchView,
  renderPortfolioSummary, saveAchievement, refresh, cabinetApi,
}) {
  const state = () => getState();
  let teamFlagPreviewUrl = null;
  const revokeTeamFlagPreview = () => {
    if (teamFlagPreviewUrl) URL.revokeObjectURL(teamFlagPreviewUrl);
    teamFlagPreviewUrl = null;
  };
  const setTeamFlagStatus = (message, status = 'info') => {
    const element = $('#teamFlagStatus');
    if (!element) return;
    element.textContent = message;
    element.hidden = !message;
    element.dataset.state = status;
  };
  const restoreTeamFlagPreview = () => {
    const team = state()?.team;
    const preview = $('#teamFlagPreview');
    const empty = $('#teamFlagEmpty');
    if (team?.flagUrl) {
      preview.src = team.flagUrl;
      preview.hidden = false;
      empty.hidden = true;
    } else {
      preview.removeAttribute('src');
      preview.hidden = true;
      empty.hidden = false;
    }
    const chooseLabel = $('#teamFlagChooseLabel');
    if (chooseLabel) chooseLabel.textContent = team?.flagUrl ? 'Выбрать другое изображение' : 'Выбрать изображение';
  };

  const mobileNavToggles = $$('.cabinet-mobile-nav-toggle');
  const mobileNavPanel = $('#cabinetMobileNavPanel');
  if (mobileNavToggles.length && mobileNavPanel) {
    $('#cabinetMobileNavClose')?.addEventListener('click', (event) => {
      event.stopPropagation();
      setMobileNavOpen(false);
    });
    mobileNavToggles.forEach((mobileNavToggle) => {
      mobileNavToggle.addEventListener('click', (event) => {
        event.stopPropagation();
        setMobileNavOpen(mobileNavToggle.getAttribute('aria-expanded') !== 'true');
      });
    });
    document.addEventListener('click', (event) => {
      const clickedToggle = mobileNavToggles.some((toggle) => toggle.contains(event.target));
      const isOpen = mobileNavPanel.classList.contains('is-open');
      if (isOpen && event.target === mobileNavPanel) {
        setMobileNavOpen(false);
        return;
      }
      if (isOpen && !clickedToggle && !mobileNavPanel.contains(event.target)) setMobileNavOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      const isOpen = mobileNavPanel.classList.contains('is-open');
      if (event.key === 'Escape' && isOpen) {
        event.preventDefault();
        setMobileNavOpen(false);
        getCompactNavToggle()?.focus();
        return;
      }
      if (event.key !== 'Tab' || !isOpen) return;
      const headerToggle = $('#cabinetMobileNavToggle');
      const panelButtons = [...mobileNavPanel.querySelectorAll('button:not([hidden]):not([disabled]), a[href]:not([hidden])')];
      const focusable = [headerToggle, ...panelButtons].filter((element) => element && element.getClientRects().length);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
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
    window.location.href = '/?action=choice';
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
    const link = `${location.origin}/?invite=${encodeURIComponent(state().team.inviteCode)}`;
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
  $('#teamFlagInput').addEventListener('change', () => {
    const input = $('#teamFlagInput');
    const file = input.files?.[0];
    const saveButton = $('#saveTeamFlag');
    revokeTeamFlagPreview();
    if (!file) {
      if (saveButton) saveButton.disabled = true;
      restoreTeamFlagPreview();
      setTeamFlagStatus('');
      return;
    }
    if (!file.type.startsWith('image/')) {
      input.value = '';
      if (saveButton) saveButton.disabled = true;
      restoreTeamFlagPreview();
      setTeamFlagStatus('Выберите файл изображения.', 'error');
      return;
    }
    teamFlagPreviewUrl = URL.createObjectURL(file);
    const preview = $('#teamFlagPreview');
    preview.src = teamFlagPreviewUrl;
    preview.hidden = false;
    $('#teamFlagEmpty').hidden = true;
    $('#teamFlagChooseLabel').textContent = 'Выбрать другое изображение';
    if (saveButton) saveButton.disabled = input.disabled;
    setTeamFlagStatus('Предпросмотр готов. Нажмите «Сохранить флаг», чтобы применить его к команде.');
  });
  $('#saveTeamFlag').addEventListener('click', async () => {
    const input = $('#teamFlagInput');
    const file = input.files?.[0];
    const button = $('#saveTeamFlag');
    if (!file || input.disabled) return;
    let persisted = false;
    button.disabled = true;
    button.textContent = 'Сохраняем…';
    setTeamFlagStatus('Загружаем изображение и сохраняем изменения…');
    try {
      const uploaded = await cabinetApi.upload(file);
      await cabinetApi.updateTeam({ flagUrl: uploaded.url });
      persisted = true;
      input.value = '';
      revokeTeamFlagPreview();
      await refresh();
      setTeamFlagStatus('Флаг сохранён и отправлен на проверку оргкомитету.', 'saved');
    } catch (error) {
      setTeamFlagStatus(
        persisted
          ? 'Флаг сохранён. Не удалось обновить кабинет; перезагрузите страницу, чтобы увидеть результат.'
          : error.message,
        persisted ? 'saved' : 'error'
      );
    } finally {
      button.textContent = 'Сохранить флаг';
      button.disabled = !input.files?.[0] || input.disabled;
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
