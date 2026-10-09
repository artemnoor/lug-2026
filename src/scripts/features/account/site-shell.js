import { authApi } from './modules/auth-api.js';
import { createPublicSchedule } from './modules/public-schedule.js';
import { getFio, getMessengerContacts, isAllowedFile, isStrongPassword, messengerMeta, renderMessengerContacts } from './modules/site-auth-helpers.js';

/* Public navigation and the single account entry point.
 * Login and registration intentionally share one modal so the public page
 * remains visible behind the workflow and users never get a second visual shell.
 */
(function () {
  'use strict';

  function createPublicNavigation() {
    const accountLink = document.querySelector('#siteAccountLink, .site-profile-link');
    const menuAccountLink = document.querySelector('#siteMenuAccountLink');
    if (!accountLink) return;
    const template = document.getElementById('siteAuthDialogTemplate');
    const authDialog = template?.content.firstElementChild?.cloneNode(true);
    if (!authDialog) return;
    template.remove();
    document.body.append(authDialog);

    const authError = authDialog.querySelector('#siteAuthError');
    const loginStatus = authDialog.querySelector('#siteAuthLoginStatus');
    const registerError = authDialog.querySelector('#siteAuthRegisterError');
    const loginPanel = authDialog.querySelector('#siteAuthLogin');
    const registerPanel = authDialog.querySelector('#siteAuthRegister');
    const recoveryPanel = authDialog.querySelector('#siteAuthRecovery');
    const recoveryRequestStep = authDialog.querySelector('#siteRecoveryRequestStep');
    const recoveryResetStep = authDialog.querySelector('#siteRecoveryResetStep');
    const choicePanel = authDialog.querySelector('#siteAuthChoice');
    const loginChoice = authDialog.querySelector('[data-auth-mode="login"]')?.closest('.site-auth-dialog__choice-action');
    const registerChoice = authDialog.querySelector('[data-auth-mode="register"]')?.closest('.site-auth-dialog__choice-action');
    const introDuration = 720;
    let introTimer = null;
    let introRun = 0;
    let introResizeObserver = null;
    let introResizeHandler = null;
    let currentMode = 'choice';
    let registerMode = 'captain';
    const registrationSteps = { captain: 1, participant: 1 };
    const registrationDraftKey = 'lug-registration-draft-v1';
    let capFile = null;
    let joinFile = null;
    let inviteCheckedCode = '';
    let inviteValid = false;
    let nextPath = '';
    let recoveryStep = 'request';
    let recoveryEmail = '';
    const messengerSelections = { captain: new Set(), participant: new Set() };

    const setError = (node, message = '') => { node.textContent = message; node.classList.toggle('is-visible', Boolean(message)); };
    const syncAuthAvailability = (settings = window.lugPublicSettings || {}) => {
      const profileAccessOpen = settings.isProfileAccessOpen === true;
      const registrationOpen = profileAccessOpen
        && settings.isRegistrationOpen === true
        && document.body.dataset.registrationClosed !== 'true';
      if (loginChoice) loginChoice.hidden = !profileAccessOpen;
      if (registerChoice) registerChoice.hidden = !registrationOpen;
      const choiceLead = choicePanel.querySelector('.site-auth-dialog__lead');
      if (choiceLead) {
        choiceLead.textContent = registrationOpen
          ? 'Выберите: войти в кабинет или создать профиль участника.'
          : profileAccessOpen
            ? 'Регистрация новых участников закрыта. Войдите в свой кабинет.'
            : 'Доступ к личным кабинетам ещё не открыт.';
      }
      if (accountLink.dataset.authenticated !== 'true') {
        accountLink.hidden = !profileAccessOpen;
        const label = accountLink.querySelector('.site-profile-link__label');
        const text = registrationOpen ? 'Добавить профиль' : 'Профиль';
        if (label) label.textContent = text;
        accountLink.setAttribute('aria-label', registrationOpen ? 'Добавить профиль' : 'Войти в профиль');
        accountLink.title = registrationOpen ? 'Добавить профиль' : 'Войти в профиль';
        accountLink.href = registrationOpen ? '/?action=register' : '/?action=login';
      }
      if (menuAccountLink?.dataset.authenticated !== 'true') {
        if (menuAccountLink) {
          menuAccountLink.hidden = !profileAccessOpen;
          menuAccountLink.href = registrationOpen ? '/?action=register' : '/?action=login';
          menuAccountLink.setAttribute('aria-label', registrationOpen ? 'Добавить профиль' : 'Войти в профиль');
        }
      }
    };
    window.addEventListener('lug:config', (event) => syncAuthAvailability(event.detail || {}));
    const focusFirstField = panel => window.setTimeout(() => panel?.querySelector('[data-auth-field]:not(:disabled)')?.focus(), 0);
    const getFioForOwner = (owner) => getFio(authDialog, owner);
    const getMessengerContactsForOwner = (owner) => getMessengerContacts(authDialog, messengerSelections, owner);
    const renderMessengerContactsForOwner = (owner) => renderMessengerContacts({ dialog: authDialog, selections: messengerSelections, owner, syncDisabledFields });
    const toggleMessenger = (owner, key) => {
      if (!messengerMeta[key]) return;
      const selected = messengerSelections[owner];
      selected.has(key) ? selected.delete(key) : selected.add(key);
      renderMessengerContactsForOwner(owner);
      persistRegistrationDraft();
    };
    const validateMessengerContacts = owner => {
      const selected = messengerSelections[owner];
      if (!selected.size) { setError(registerError, 'Выберите хотя бы один мессенджер.'); return false; }
      let valid = true;
      selected.forEach(key => {
        const input = authDialog.querySelector(`[data-messenger-contact="${owner}-${key}"]`);
        const value = input?.value.trim() || '';
        const error = authDialog.querySelector(`[data-messenger-error="${owner}-${key}"]`);
        const ok = Boolean(value) && messengerMeta[key].test(value);
        input?.setAttribute('aria-invalid', String(!ok));
        if (error) error.textContent = ok ? '' : `Укажите корректный контакт для ${messengerMeta[key].label}.`;
        if (!ok) valid = false;
      });
      if (!valid) setError(registerError, 'Проверьте контакты выбранных мессенджеров.');
      return valid;
    };
    authDialog.addEventListener('input', event => {
      const input = event.target.closest?.('[data-messenger-contact]');
      if (!input) return;
      input.removeAttribute('aria-invalid');
      const error = authDialog.querySelector(`[data-messenger-error="${input.dataset.messengerContact}"]`);
      if (error) error.textContent = '';
    });
    authDialog.addEventListener('blur', event => {
      const input = event.target.closest?.('[data-messenger-contact]');
      if (!input) return;
      const [, key] = input.dataset.messengerContact.split('-');
      const value = input.value.trim();
      const ok = Boolean(value) && messengerMeta[key]?.test(value);
      input.setAttribute('aria-invalid', String(!ok));
      const error = authDialog.querySelector(`[data-messenger-error="${input.dataset.messengerContact}"]`);
      if (error) error.textContent = ok ? '' : `Укажите корректный контакт для ${messengerMeta[key]?.label || 'мессенджера'}.`;
    }, true);
    const syncDisabledFields = () => {
      authDialog.querySelectorAll('[data-auth-field]').forEach(field => {
        const owner = field.dataset.authField;
        const active = currentMode === 'login' ? owner === 'login' : currentMode === 'register' ? owner === registerMode : currentMode === 'recovery' && owner === 'recovery';
        field.disabled = !active;
      });
      authDialog.querySelectorAll('[data-dropzone]').forEach(zone => {
      const active = currentMode === 'register' && zone.dataset.dropzone === registerMode;
        zone.classList.toggle('is-disabled', !active);
        zone.setAttribute('aria-disabled', String(!active));
      });
      authDialog.querySelectorAll('.site-auth-dialog__messenger-option').forEach(button => {
        button.disabled = !(currentMode === 'register' && button.dataset.messengerOwner === registerMode);
      });
    };
    authDialog.querySelectorAll('.site-auth-dialog__messenger-option').forEach(button => {
      button.addEventListener('click', () => toggleMessenger(button.dataset.messengerOwner, button.dataset.messenger));
    });
    renderMessengerContactsForOwner('captain');
    renderMessengerContactsForOwner('participant');

    const setRegistrationMode = (mode, focus = true) => {
      registerMode = mode === 'participant' ? 'participant' : 'captain';
      authDialog.querySelectorAll('[data-register-mode]').forEach(button => {
        const active = button.dataset.registerMode === registerMode;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', String(active));
      });
      authDialog.querySelectorAll('[data-register-panel]').forEach(panel => { panel.hidden = panel.dataset.registerPanel !== registerMode; });
      const submit = authDialog.querySelector('#siteAuthRegisterSubmit');
      submit.innerHTML = registerMode === 'captain' ? 'Создать команду и войти <span aria-hidden="true">→</span>' : 'Присоединиться и войти <span aria-hidden="true">→</span>';
      submit.setAttribute('form', registerMode === 'captain' ? 'siteAuthCaptainPanel' : 'siteAuthParticipantPanel');
      setError(registerError);
      syncDisabledFields();
      renderRegistrationStep();
      const card = authDialog.querySelector('.site-auth-dialog__card');
      if (currentMode === 'register' && card) card.scrollTop = 0;
      if (focus) focusRegistrationStep();
      persistRegistrationDraft();
    };

    const persistRegistrationDraft = () => {
      try {
        const fields = {};
        authDialog.querySelectorAll('.site-auth-dialog__register-panel input[id]').forEach(input => {
          if (input.type === 'password' || input.type === 'file') return;
          fields[input.id] = input.type === 'checkbox' ? input.checked : input.value;
        });
        const contacts = {};
        authDialog.querySelectorAll('[data-messenger-contact]').forEach(input => { contacts[input.dataset.messengerContact] = input.value; });
        sessionStorage.setItem(registrationDraftKey, JSON.stringify({
          version: 1,
          mode: registerMode,
          steps: registrationSteps,
          fields,
          contacts,
          messengers: Object.fromEntries(Object.entries(messengerSelections).map(([owner, selected]) => [owner, [...selected]]))
        }));
      } catch {
        // Registration remains usable when browser storage is unavailable.
      }
    };

    const restoreRegistrationDraft = () => {
      let draft;
      try {
        draft = JSON.parse(sessionStorage.getItem(registrationDraftKey) || 'null');
      } catch {
        return;
      }
      if (!draft || draft.version !== 1) return;
      if (draft.mode === 'captain' || draft.mode === 'participant') registerMode = draft.mode;
      for (const owner of ['captain', 'participant']) {
        const step = Number(draft.steps?.[owner]);
        if (Number.isInteger(step) && step >= 1 && step <= 3) registrationSteps[owner] = step;
        for (const key of draft.messengers?.[owner] || []) if (messengerMeta[key]) messengerSelections[owner].add(key);
      }
      authDialog.querySelectorAll('.site-auth-dialog__register-panel input[id]').forEach(input => {
        if (input.type === 'password' || input.type === 'file' || !Object.hasOwn(draft.fields || {}, input.id)) return;
        if (input.type === 'checkbox') input.checked = Boolean(draft.fields[input.id]);
        else input.value = String(draft.fields[input.id] ?? '');
      });
      renderMessengerContactsForOwner('captain');
      renderMessengerContactsForOwner('participant');
      authDialog.querySelectorAll('[data-messenger-contact]').forEach(input => {
        if (Object.hasOwn(draft.contacts || {}, input.dataset.messengerContact)) input.value = String(draft.contacts[input.dataset.messengerContact] ?? '');
      });
      setRegistrationMode(registerMode, false);
    };

    const renderRegistrationStep = () => {
      const step = registrationSteps[registerMode];
      const panel = authDialog.querySelector(`[data-register-panel="${registerMode}"]`);
      const messages = {
        captain: [
          'Укажите учебную группу, её размер и название команды.',
          'Оставьте контакты, чтобы оргкомитет мог связаться с вами.',
          'Добавьте подтверждение студента, задайте пароль и подтвердите согласие.'
        ],
        participant: [
          'Введите код приглашения капитана — проверим его и найдём команду.',
          'Оставьте свои контакты для связи с организаторами.',
          'Добавьте подтверждение студента, задайте пароль и подтвердите согласие.'
        ]
      };
      panel?.querySelectorAll('[data-register-field-step]').forEach(element => {
        element.hidden = Number(element.dataset.registerFieldStep) !== step;
      });
      const note = panel?.querySelector('[data-register-step-note]');
      if (note) note.textContent = messages[registerMode][step - 1];
      authDialog.querySelectorAll('[data-register-step-indicator]').forEach(indicator => {
        const index = Number(indicator.dataset.registerStepIndicator);
        const active = index === step;
        indicator.classList.toggle('is-active', active);
        indicator.classList.toggle('is-complete', index < step);
        if (active) indicator.setAttribute('aria-current', 'step');
        else indicator.removeAttribute('aria-current');
      });
      const activeStepLabel = authDialog.querySelector(`[data-register-step-indicator="${step}"] strong`);
      if (activeStepLabel?.dataset[`step${registerMode[0].toUpperCase()}${registerMode.slice(1)}`]) {
        activeStepLabel.textContent = activeStepLabel.dataset[`step${registerMode[0].toUpperCase()}${registerMode.slice(1)}`];
      }
      const draftNote = authDialog.querySelector('#siteAuthDraftNote');
      if (draftNote) draftNote.textContent = `Шаг ${step} из 3 · Черновик сохраняется автоматически. Пароль и фото хранятся, пока страница открыта.`;
      authDialog.querySelector('#siteAuthRegisterPrevious').hidden = step === 1;
      authDialog.querySelector('#siteAuthRegisterNext').hidden = step === 3;
      authDialog.querySelector('#siteAuthRegisterSubmit').hidden = step !== 3;
    };

    const focusRegistrationStep = () => {
      window.setTimeout(() => {
        const step = registrationSteps[registerMode];
        const panel = authDialog.querySelector(`[data-register-panel="${registerMode}"]`);
        const first = panel?.querySelector(`[data-register-field-step="${step}"] input:not([type="file"]):not(:disabled), [data-register-field-step="${step}"] select:not(:disabled), [data-register-field-step="${step}"] textarea:not(:disabled), [data-register-field-step="${step}"] [data-upload-trigger]:not(:disabled)`);
        first?.focus({ preventScroll: true });
      }, 0);
    };

    const validateRegistrationStep = async () => {
      setError(registerError);
      const step = registrationSteps[registerMode];
      const panel = authDialog.querySelector(`[data-register-panel="${registerMode}"]`);
      const fields = [...panel.querySelectorAll(`[data-register-field-step="${step}"] input[data-auth-field]:not(:disabled), [data-register-field-step="${step}"] select[data-auth-field]:not(:disabled), [data-register-field-step="${step}"] textarea[data-auth-field]:not(:disabled)`)];
      const invalid = fields.find(field => !field.checkValidity());
      if (invalid) { invalid.reportValidity(); return false; }
      if (registerMode === 'participant' && step === 1) {
        const invite = authDialog.querySelector('#siteJoinInviteCode');
        if (!(inviteCheckedCode === invite.value.trim().toUpperCase() && inviteValid) && !(await checkInviteCode())) {
          setError(registerError, 'Проверьте код приглашения и попробуйте продолжить.');
          return false;
        }
      }
      if (step === 2 && !validateMessengerContacts(registerMode)) return false;
      return true;
    };

    const advanceRegistrationStep = async () => {
      const next = authDialog.querySelector('#siteAuthRegisterNext');
      next.disabled = true;
      try {
        if (!(await validateRegistrationStep())) return false;
        registrationSteps[registerMode] = Math.min(3, registrationSteps[registerMode] + 1);
        renderRegistrationStep(); persistRegistrationDraft();
        const card = authDialog.querySelector('.site-auth-dialog__card');
        if (card) card.scrollTop = 0;
        focusRegistrationStep();
        return true;
      } finally {
        next.disabled = false;
      }
    };

    authDialog.addEventListener('input', event => {
      if (event.target.closest?.('.site-auth-dialog__register-panel') || event.target.matches?.('[data-messenger-contact]')) persistRegistrationDraft();
    });
    authDialog.addEventListener('change', event => {
      if (event.target.closest?.('.site-auth-dialog__register-panel') || event.target.matches?.('[data-messenger-contact]')) persistRegistrationDraft();
    });
    authDialog.querySelector('#siteAuthRegisterPrevious').addEventListener('click', () => {
      registrationSteps[registerMode] = Math.max(1, registrationSteps[registerMode] - 1);
      renderRegistrationStep(); persistRegistrationDraft();
      const card = authDialog.querySelector('.site-auth-dialog__card');
      if (card) card.scrollTop = 0;
      focusRegistrationStep();
    });
    authDialog.querySelector('#siteAuthRegisterNext').addEventListener('click', advanceRegistrationStep);
    restoreRegistrationDraft();

    const setAuthMode = mode => {
      currentMode = ['choice', 'login', 'register', 'recovery'].includes(mode) ? mode : 'choice';
      choicePanel.hidden = currentMode !== 'choice';
      loginPanel.hidden = currentMode !== 'login';
      registerPanel.hidden = currentMode !== 'register';
      recoveryPanel.hidden = currentMode !== 'recovery';
      authDialog.setAttribute('aria-labelledby', currentMode === 'login' ? 'site-auth-login-title' : currentMode === 'register' ? 'site-auth-register-title' : currentMode === 'recovery' ? 'site-auth-recovery-title' : 'site-auth-title');
      setError(authError); setError(registerError); setError(authDialog.querySelector('#siteAuthRecoveryError')); setError(authDialog.querySelector('#siteAuthRecoveryResetError'));
      syncDisabledFields();
      const authCard = authDialog.querySelector('.site-auth-dialog__card');
      if (authCard) authCard.scrollTop = 0;
      if (currentMode === 'login') focusFirstField(loginPanel);
      if (currentMode === 'register') setRegistrationMode(registerMode);
      if (currentMode === 'recovery') {
        recoveryRequestStep.hidden = recoveryStep !== 'request';
        recoveryResetStep.hidden = recoveryStep !== 'reset';
        focusFirstField(recoveryStep === 'request' ? recoveryRequestStep : recoveryResetStep);
      }
    };

    const syncIntroTravel = () => {
      const intro = authDialog.querySelector('.site-auth-dialog__intro');
      const card = authDialog.querySelector('.site-auth-dialog__card');
      if (!intro || !card) return;
      const finalAnchor = Number.parseFloat(getComputedStyle(intro).getPropertyValue('--auth-intro-final-anchor')) || 116;
      const travel = Math.max(0, card.getBoundingClientRect().height / 2 - finalAnchor);
      intro.style.setProperty('--auth-intro-travel', `${travel}px`);
    };

    const stopIntroGeometryTracking = () => {
      introResizeObserver?.disconnect();
      introResizeObserver = null;
      if (introResizeHandler) window.removeEventListener('resize', introResizeHandler);
      introResizeHandler = null;
    };

    const startIntroGeometryTracking = () => {
      stopIntroGeometryTracking();
      const card = authDialog.querySelector('.site-auth-dialog__card');
      if (!card) return;
      introResizeHandler = () => window.requestAnimationFrame(syncIntroTravel);
      window.addEventListener('resize', introResizeHandler, { passive: true });
      if ('ResizeObserver' in window) {
        introResizeObserver = new ResizeObserver(syncIntroTravel);
        introResizeObserver.observe(card);
      }
    };

    const startAuthIntro = (mode = 'choice') => {
      const run = ++introRun;
      window.clearTimeout(introTimer);
      startIntroGeometryTracking();
      authDialog.classList.add('is-intro-preparing');
      authDialog.classList.toggle('is-intro-login', mode === 'login');
      authDialog.classList.remove('is-intro-complete');
      const completeIntro = () => {
        if (run !== introRun || !authDialog.open) return;
        authDialog.classList.add('is-intro-complete');
        if (mode === 'login') focusFirstField(loginPanel);
        else {
          const choiceButton = [
            authDialog.querySelector('[data-auth-mode="login"]'),
            authDialog.querySelector('[data-auth-mode="register"]'),
          ].find((button) => button && !button.closest('[hidden]'));
          choiceButton?.focus();
        }
      };
      const beginIntro = () => {
        if (run !== introRun || !authDialog.open) return;
        syncIntroTravel();
        void authDialog.offsetWidth;
        authDialog.classList.remove('is-intro-preparing');
        void authDialog.offsetWidth;
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) completeIntro();
        else introTimer = window.setTimeout(completeIntro, introDuration);
      };
      window.requestAnimationFrame(() => window.requestAnimationFrame(beginIntro));
    };

    let pageScrollY = 0;
    let lastFocusedElement = null;
    const lockPage = () => {
      pageScrollY = window.scrollY;
      document.body.style.top = '';
      document.documentElement.classList.add('is-auth-dialog-open');
      document.body.classList.add('is-auth-dialog-open');
    };
    const unlockPage = () => {
      document.documentElement.classList.remove('is-auth-dialog-open');
      document.body.classList.remove('is-auth-dialog-open');
      document.body.style.top = '';
      window.scrollTo(0, pageScrollY);
    };

    const setFile = (input, file, previewId, type, previewState) => {
      if (!file) return false;
      if (!isAllowedFile(file)) { input.value = ''; setError(registerError, 'Загрузите изображение или PDF.'); return false; }
      if (file.size > 5 * 1024 * 1024) { input.value = ''; setError(registerError, 'Размер файла не должен превышать 5 МБ.'); return false; }
      try { const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files; } catch { /* iOS may keep the file only in the closure. */ }
      if (type === 'captain') capFile = file; else joinFile = file;
      const zone = input.closest('[data-dropzone]');
      const preview = authDialog.querySelector(`#${previewId}`);
      const previewWrap = zone?.querySelector('[data-upload-preview-wrap]');
      const previewImage = zone?.querySelector('[data-upload-preview]');
      const action = zone?.querySelector('[data-upload-action]');
      const clear = zone?.querySelector('[data-upload-clear]');
      if (previewState?.url) URL.revokeObjectURL(previewState.url);
      if (previewState) previewState.url = null;
      if (/^image\//i.test(file.type) && previewImage && previewWrap) {
        previewState.url = URL.createObjectURL(file);
        previewImage.src = previewState.url;
        previewWrap.hidden = false;
      } else if (previewWrap) {
        previewImage?.removeAttribute('src');
        previewWrap.hidden = true;
      }
      if (preview) preview.textContent = `✓ ${file.name} · ${Math.ceil(file.size / 1024)} КБ`;
      if (action) action.textContent = /^image\//i.test(file.type) ? 'Заменить фото' : 'Заменить файл';
      if (clear) clear.hidden = false;
      zone?.classList.add('is-selected');
      setError(registerError);
      return true;
    };
    const clearFile = (zone, input, previewId, type, previewState) => {
      if (previewState?.url) URL.revokeObjectURL(previewState.url);
      if (previewState) previewState.url = null;
      input.value = '';
      if (type === 'captain') capFile = null; else joinFile = null;
      zone.classList.remove('is-selected', 'is-dragover');
      const preview = authDialog.querySelector(`#${previewId}`);
      const previewWrap = zone.querySelector('[data-upload-preview-wrap]');
      const previewImage = zone.querySelector('[data-upload-preview]');
      const action = zone.querySelector('[data-upload-action]');
      const clear = zone.querySelector('[data-upload-clear]');
      if (preview) preview.textContent = 'Файл не выбран';
      if (previewImage) previewImage.removeAttribute('src');
      if (previewWrap) previewWrap.hidden = true;
      if (action) action.textContent = 'Выбрать фото';
      if (clear) clear.hidden = true;
    };
    const bindFileDropzone = (zone, input, previewId, type) => {
      const previewState = { url: null };
      zone.querySelector('[data-upload-trigger]')?.addEventListener('click', () => { if (!input.disabled) input.click(); });
      zone.addEventListener('dragover', event => { if (input.disabled) return; event.preventDefault(); zone.classList.add('is-dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
      zone.addEventListener('drop', event => { if (input.disabled) return; event.preventDefault(); zone.classList.remove('is-dragover'); setFile(input, event.dataTransfer?.files?.[0], previewId, type, previewState); });
      input.addEventListener('change', event => setFile(input, event.target.files?.[0], previewId, type, previewState));
      zone.querySelector('[data-upload-clear]')?.addEventListener('click', () => clearFile(zone, input, previewId, type, previewState));
    };
    bindFileDropzone(authDialog.querySelector('[data-dropzone="captain"]'), authDialog.querySelector('#siteCapStudentCardFile'), 'siteCapFilePreview', 'captain');
    bindFileDropzone(authDialog.querySelector('[data-dropzone="participant"]'), authDialog.querySelector('#siteJoinStudentCardFile'), 'siteJoinFilePreview', 'participant');

    const updatePasswordUI = mode => {
      const password = authDialog.querySelector(mode === 'captain' ? '#siteCapPassword' : '#siteJoinPassword');
      const confirm = authDialog.querySelector(mode === 'captain' ? '#siteCapPasswordConfirm' : '#siteJoinPasswordConfirm');
      const rules = { length: Array.from(password.value).length >= 8 };
      authDialog.querySelectorAll(`[data-password-rules="${mode}"] [data-password-rule]`).forEach(rule => rule.classList.toggle('is-valid', Boolean(rules[rule.dataset.passwordRule])));
      const match = authDialog.querySelector(mode === 'captain' ? '#siteCapPasswordMatch' : '#siteJoinPasswordMatch');
      const hasConfirm = Boolean(confirm.value);
      match.textContent = hasConfirm ? (password.value === confirm.value ? '✓ Пароли совпадают' : 'Пароли не совпадают') : '';
      match.className = `site-auth-dialog__password-match${hasConfirm ? (password.value === confirm.value ? ' is-valid' : ' is-error') : ''}`;
      confirm.setAttribute('aria-invalid', String(hasConfirm && password.value !== confirm.value));
      password.setAttribute('aria-invalid', String(Boolean(password.value) && !isStrongPassword(password.value)));
      return { ...rules, match: hasConfirm && password.value === confirm.value };
    };
    authDialog.querySelectorAll('[data-password],[data-password-confirm]').forEach(input => input.addEventListener('input', () => updatePasswordUI(input.dataset.password || input.dataset.passwordConfirm)));
    authDialog.querySelectorAll('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
      const input = authDialog.querySelector(`#${button.dataset.passwordToggle}`);
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'Скрыть' : 'Показать';
      button.setAttribute('aria-pressed', String(visible));
    }));

    const updateRecoveryPasswordUI = () => {
      const password = authDialog.querySelector('#siteRecoveryPassword');
      const confirm = authDialog.querySelector('#siteRecoveryPasswordConfirm');
      const rules = { length: Array.from(password.value).length >= 8 };
      authDialog.querySelectorAll('[data-recovery-password-rule]').forEach(rule => {
        rule.classList.toggle('is-valid', Boolean(rules[rule.dataset.recoveryPasswordRule]));
      });
      const hasConfirm = Boolean(confirm.value);
      const match = authDialog.querySelector('#siteRecoveryPasswordMatch');
      match.textContent = hasConfirm ? (password.value === confirm.value ? '✓ Пароли совпадают' : 'Пароли не совпадают') : '';
      match.className = `site-auth-dialog__password-match${hasConfirm ? (password.value === confirm.value ? ' is-valid' : ' is-error') : ''}`;
      confirm.setAttribute('aria-invalid', String(hasConfirm && password.value !== confirm.value));
      password.setAttribute('aria-invalid', String(Boolean(password.value) && !isStrongPassword(password.value)));
      return { ...rules, match: hasConfirm && password.value === confirm.value };
    };
    authDialog.querySelectorAll('[data-recovery-password]').forEach(input => input.addEventListener('input', updateRecoveryPasswordUI));
    authDialog.querySelectorAll('#siteRecoveryPassword,#siteRecoveryPasswordConfirm').forEach(input => input.addEventListener('input', updateRecoveryPasswordUI));

    const checkInviteCode = async () => {
      const code = authDialog.querySelector('#siteJoinInviteCode').value.trim();
      const status = authDialog.querySelector('#siteInviteStatus');
      inviteValid = false;
      if (!code) { inviteCheckedCode = ''; status.textContent = ''; return false; }
      status.textContent = 'Проверяем приглашение…';
      try {
        const { team } = await authApi.invite(code);
        authDialog.querySelector('#siteJoinTeamName').value = team.name;
        authDialog.querySelector('#siteJoinGroup').value = team.group;
        inviteCheckedCode = code.toUpperCase(); inviteValid = true;
        status.textContent = `✓ Приглашение активно до ${new Date(team.inviteExpiresAt).toLocaleDateString('ru-RU')}`;
        status.className = 'site-auth-dialog__invite-status is-success';
        return true;
      } catch (error) {
        authDialog.querySelector('#siteJoinTeamName').value = '';
        authDialog.querySelector('#siteJoinGroup').value = '';
        status.textContent = error.message || 'Приглашение не найдено.';
        status.className = 'site-auth-dialog__invite-status is-error';
        return false;
      }
    };
    authDialog.querySelector('#siteJoinInviteCode').addEventListener('change', checkInviteCode);
    authDialog.querySelector('#siteJoinInviteCode').addEventListener('blur', checkInviteCode);

    const validateActiveRegistration = () => {
      const panel = authDialog.querySelector(`[data-register-panel="${registerMode}"]`);
      const fields = [...panel.querySelectorAll('input[data-auth-field]:not(:disabled), select[data-auth-field]:not(:disabled), textarea[data-auth-field]:not(:disabled)')];
      const invalid = fields.find(field => !field.checkValidity());
      if (invalid) { invalid.reportValidity(); return false; }
      if (!validateMessengerContacts(registerMode)) return false;
      const file = registerMode === 'captain' ? capFile : joinFile;
      if (!file) { setError(registerError, 'Загрузите скриншот личного кабинета студента.'); return false; }
      if (file.size > 5 * 1024 * 1024) { setError(registerError, 'Размер файла не должен превышать 5 МБ.'); return false; }
      const password = authDialog.querySelector(registerMode === 'captain' ? '#siteCapPassword' : '#siteJoinPassword').value;
      const confirm = authDialog.querySelector(registerMode === 'captain' ? '#siteCapPasswordConfirm' : '#siteJoinPasswordConfirm').value;
      const passwordState = updatePasswordUI(registerMode);
      if (!isStrongPassword(password)) { setError(registerError, 'Пароль должен содержать не менее 8 символов.'); return false; }
      if (password !== confirm) { setError(registerError, 'Введённые пароли не совпадают.'); return false; }
      if (!passwordState.match) { setError(registerError, 'Подтвердите пароль повторно.'); return false; }
      return true;
    };

    const requestRecoveryCode = async ({ resend = false } = {}) => {
      const emailField = authDialog.querySelector('#siteRecoveryEmail');
      const error = authDialog.querySelector('#siteAuthRecoveryError');
      const status = authDialog.querySelector('#siteAuthRecoveryStatus');
      const button = authDialog.querySelector(resend ? '#siteAuthRecoveryResend' : '#siteAuthRecoveryRequestSubmit');
      const email = (recoveryEmail || emailField.value).trim();
      emailField.value = email;
      if (!emailField.checkValidity()) { emailField.reportValidity(); return; }
      try {
        button.disabled = true;
        setError(error);
        const result = await authApi.requestPasswordReset(email);
        recoveryEmail = email;
        authDialog.querySelector('#siteRecoveryVerificationEmail').textContent = email;
        status.textContent = result.message || 'Проверьте почту и папку «Спам».';
        if (!resend) {
          recoveryStep = 'reset';
          setAuthMode('recovery');
        }
      } catch (requestError) {
        setError(error, requestError.message || 'Не удалось отправить код. Повторите попытку позже.');
      } finally {
        button.disabled = false;
      }
    };

    const submitRecoveryPassword = async () => {
      const code = authDialog.querySelector('#siteRecoveryCode');
      const password = authDialog.querySelector('#siteRecoveryPassword');
      const confirm = authDialog.querySelector('#siteRecoveryPasswordConfirm');
      const error = authDialog.querySelector('#siteAuthRecoveryResetError');
      setError(error);
      if (!code.checkValidity()) { code.reportValidity(); return; }
      const passwordState = updateRecoveryPasswordUI();
      if (!isStrongPassword(password.value)) {
        setError(error, 'Пароль должен содержать не менее 8 символов.');
        return;
      }
      if (!passwordState.match) {
        setError(error, 'Введённые пароли не совпадают.');
        return;
      }
      const submit = authDialog.querySelector('#siteAuthRecoveryResetSubmit');
      try {
        submit.disabled = true;
        submit.textContent = 'Сохраняем пароль…';
        await authApi.resetPassword(recoveryEmail || authDialog.querySelector('#siteRecoveryEmail').value.trim(), code.value.trim(), password.value);
        authDialog.querySelector('#siteAuthEmail').value = recoveryEmail;
        authDialog.querySelector('#siteAuthPassword').value = '';
        loginStatus.textContent = 'Пароль изменён. Войдите с новым паролем.';
        recoveryStep = 'request';
        setAuthMode('login');
      } catch (resetError) {
        setError(error, resetError.message || 'Не удалось изменить пароль. Запросите новый код.');
      } finally {
        submit.disabled = false;
        submit.innerHTML = 'Сохранить новый пароль <span aria-hidden="true">→</span>';
      }
    };

    const submitRegistration = async () => {
      setError(registerError);
      if (!validateActiveRegistration()) return;
      if (registerMode === 'participant' && (inviteCheckedCode !== authDialog.querySelector('#siteJoinInviteCode').value.trim().toUpperCase() || !inviteValid) && !(await checkInviteCode())) {
        setError(registerError, 'Проверьте код приглашения.'); return;
      }
      const submit = authDialog.querySelector('#siteAuthRegisterSubmit');
      try {
        submit.disabled = true; submit.textContent = 'Создаём аккаунт…';
        const file = registerMode === 'captain' ? capFile : joinFile;
        const card = await authApi.uploadRegistrationCard(file);
        const messengerContacts = getMessengerContactsForOwner(registerMode);
        const firstMessenger = Object.entries(messengerContacts)[0] || ['', ''];
        const result = registerMode === 'captain'
          ? await authApi.registerCaptain({
            fio: getFioForOwner('captain'), group: authDialog.querySelector('#siteCapGroup').value,
            teamName: authDialog.querySelector('#siteCapTeamName').value, totalStudentsInGroup: authDialog.querySelector('#siteCapGroupSize').value,
            email: authDialog.querySelector('#siteCapEmail').value, messenger: firstMessenger[0], messengerContact: firstMessenger[1],
            messengerContacts,
            password: authDialog.querySelector('#siteCapPassword').value, studentCardFile: card.url,
            studentCardFileName: file.name, studentCardUploadToken: card.registrationToken,
            studentCardSize: card.size, studentCardType: card.type || card.contentType || file.type,
            consent: authDialog.querySelector('#siteCapConsent').checked
          })
          : await authApi.registerParticipant({
            inviteCode: authDialog.querySelector('#siteJoinInviteCode').value, fio: getFioForOwner('participant'),
            email: authDialog.querySelector('#siteJoinEmail').value, messenger: firstMessenger[0], messengerContact: firstMessenger[1],
            messengerContacts,
            password: authDialog.querySelector('#siteJoinPassword').value, studentCardFile: card.url,
            studentCardFileName: file.name, studentCardUploadToken: card.registrationToken,
            studentCardSize: card.size, studentCardType: card.type || card.contentType || file.type,
            consent: authDialog.querySelector('#siteJoinConsent').checked
          });
        try {
          sessionStorage.setItem('lug-welcome-guide', result?.user?.role || 'participant');
        } catch {
          // The welcome hint is optional; storage restrictions must not make a
          // successfully created account look like a failed registration.
        }
        try { sessionStorage.removeItem(registrationDraftKey); } catch { /* Draft cleanup is best-effort. */ }
        window.location.href = nextPath || '/account/cabinet.html?welcome=1';
      } catch (error) {
        setError(registerError, error.userMessage || error.message || 'Не удалось создать аккаунт. Проверьте данные и повторите попытку.');
      } finally {
        submit.disabled = false;
        submit.innerHTML = registerMode === 'captain' ? 'Создать команду и войти <span aria-hidden="true">→</span>' : 'Присоединиться и войти <span aria-hidden="true">→</span>';
      }
    };

    const openAuth = (mode = 'choice', options = {}) => {
      nextPath = ['/account/admin.html', '/account/cabinet.html'].includes(options.next) ? options.next : '';
      const adminLogin = nextPath === '/account/admin.html';
      authDialog.querySelector('#site-auth-login-title').innerHTML = adminLogin ? 'Вход<br />для оргкомитета' : 'Войти<br />в кабинет';
      loginPanel.querySelector('.site-auth-dialog__lead').textContent = adminLogin
        ? 'Войдите под учётной записью администратора, чтобы открыть панель оргкомитета.'
        : 'Введите почту и пароль. После входа откроется ваш конкурсный маршрут.';
      authDialog.querySelector('#siteAuthLoginForm').setAttribute('aria-label', adminLogin ? 'Вход для организаторов' : 'Вход в личный кабинет');
      if (mode === 'register' && document.body.dataset.registrationClosed === 'true') {
        mode = window.lugPublicSettings?.isProfileAccessOpen === true ? 'login' : 'choice';
      }
      if (!authDialog.open) {
        lastFocusedElement = document.activeElement;
        lockPage();
        authDialog.showModal();
        document.documentElement.classList.remove('auth-entry-pending');
      }
      setAuthMode(mode);
      if (mode === 'choice' || mode === 'login') startAuthIntro(mode);
      else {
        authDialog.classList.remove('is-intro-login');
        authDialog.classList.add('is-intro-complete');
      }
      if (options.invite && document.body.dataset.registrationClosed !== 'true') {
        setAuthMode('register'); setRegistrationMode('participant', false);
        registrationSteps.participant = 1;
        renderRegistrationStep();
        const inviteField = authDialog.querySelector('#siteJoinInviteCode');
        inviteField.value = options.invite;
        inviteField.focus();
        persistRegistrationDraft();
        checkInviteCode();
      }
    };

    const closeAuth = () => { if (authDialog.open) authDialog.close(); };
    authDialog.querySelector('.site-auth-dialog__close').addEventListener('click', closeAuth);
    authDialog.addEventListener('cancel', event => { event.preventDefault(); closeAuth(); });
    authDialog.addEventListener('click', event => {
      if (event.target === authDialog && currentMode !== 'register') closeAuth();
    });
    authDialog.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => openAuth(button.dataset.authMode)));
    authDialog.querySelectorAll('[data-register-mode]').forEach(button => button.addEventListener('click', () => setRegistrationMode(button.dataset.registerMode)));
    authDialog.addEventListener('close', () => {
      persistRegistrationDraft();
      ++introRun; window.clearTimeout(introTimer); stopIntroGeometryTracking(); authDialog.querySelectorAll('form:not(.site-auth-dialog__register-panel)').forEach(form => form.reset()); setError(authError); setError(registerError); loginStatus.textContent = '';
      nextPath = '';
      recoveryStep = 'request'; recoveryEmail = '';
      setError(authDialog.querySelector('#siteAuthRecoveryError')); setError(authDialog.querySelector('#siteAuthRecoveryResetError'));
      authDialog.querySelector('#siteAuthRecoveryStatus').textContent = '';
      authDialog.querySelectorAll('[data-password-toggle]').forEach(button => { const input = authDialog.querySelector(`#${button.dataset.passwordToggle}`); input.type = 'password'; button.textContent = 'Показать'; button.setAttribute('aria-pressed', 'false'); });
      setAuthMode('choice'); authDialog.classList.remove('is-intro-login', 'is-intro-complete'); authDialog.querySelector('.site-auth-dialog__intro')?.style.removeProperty('--auth-intro-travel'); unlockPage();
      const focusTarget = lastFocusedElement;
      lastFocusedElement = null;
      if (focusTarget && document.contains(focusTarget)) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (!authDialog.open && focusTarget.isConnected) focusTarget.focus({ preventScroll: true });
          });
        });
      }
    });

    window.addEventListener('pagehide', () => { if (authDialog.open) authDialog.close(); });
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      if (authDialog.open) authDialog.close();
      else { stopIntroGeometryTracking(); unlockPage(); }
      document.documentElement.classList.remove('auth-entry-pending');
    });

    accountLink.addEventListener('click', event => {
      if (accountLink.dataset.authenticated === 'true') return;
      event.preventDefault();
      openAuth(document.body.dataset.registrationClosed === 'true' ? 'login' : 'register');
    });
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link || event.defaultPrevented || link.target === '_blank') return;
      const url = new URL(link.href, window.location.href);
      const isRegisterLink = url.pathname.endsWith('/register.html');
      const isAuthIndexLink = (url.pathname.endsWith('/index.html') || url.pathname === '/') && (url.searchParams.has('action') || url.searchParams.has('invite') || url.searchParams.has('next'));
      if (!isRegisterLink && !isAuthIndexLink) return;
      event.preventDefault();
      const params = url.searchParams;
      const opensRegistration = ['register', 'join'].includes(params.get('action')) || params.has('invite');
      if (document.body.dataset.registrationClosed === 'true' && opensRegistration) {
        return;
      }
      openAuth(params.get('action') === 'register' || params.get('action') === 'join' || params.get('invite') ? 'register' : params.get('action') === 'login' ? 'login' : 'choice', { invite: params.get('invite') || '', next: params.get('next') || '' });
    });

    authDialog.addEventListener('submit', async event => {
      event.preventDefault();
      if (currentMode === 'register') return registrationSteps[registerMode] < 3 ? advanceRegistrationStep() : submitRegistration();
      if (currentMode === 'recovery') return recoveryStep === 'request' ? requestRecoveryCode() : submitRecoveryPassword();
      if (currentMode !== 'login') return;
      setError(authError);
      const loginFields = [...loginPanel.querySelectorAll('[data-auth-field]:not(:disabled)')];
      const invalid = loginFields.find(field => !field.checkValidity());
      if (invalid) { invalid.reportValidity(); return; }
      const submit = authDialog.querySelector('#siteAuthLoginSubmit');
      try {
        submit.disabled = true; submit.textContent = 'Проверяем…';
        const result = await authApi.login(authDialog.querySelector('#siteAuthEmail').value.trim(), authDialog.querySelector('#siteAuthPassword').value);
        if (nextPath === '/account/admin.html' && result.user.role !== 'admin') {
          await authApi.logout();
          setError(authError, 'У этой учётной записи нет доступа к панели оргкомитета. Войдите под аккаунтом администратора.');
          return;
        }
        window.location.href = nextPath || (result.user.role === 'admin' ? '/account/admin.html' : '/account/cabinet.html');
      } catch (error) {
        setError(authError, error.message || 'Не удалось войти. Проверьте данные.');
      } finally {
        submit.disabled = false; submit.innerHTML = 'Войти <span aria-hidden="true">→</span>';
      }
    });
    authDialog.querySelector('#siteAuthRecoveryResend').addEventListener('click', () => requestRecoveryCode({ resend: true }));

    authApi.session().then(({ user }) => {
      if (!user) return;
      accountLink.dataset.authenticated = 'true';
      accountLink.hidden = false;
      accountLink.href = user.role === 'admin' ? '/account/admin.html' : '/account/cabinet.html';
      const accountLabel = accountLink.querySelector('.site-profile-link__label');
      if (accountLabel) accountLabel.textContent = 'Личный кабинет';
      menuAccountLink?.setAttribute('data-authenticated', 'true');
      if (menuAccountLink) {
        menuAccountLink.hidden = false;
        menuAccountLink.href = user.role === 'admin' ? '/account/admin.html' : '/account/cabinet.html';
        menuAccountLink.textContent = 'Личный кабинет';
      }
    }).catch(() => {});

    const params = new URLSearchParams(window.location.search);
    if (params.get('action') || params.get('invite') || params.get('next')) {
      const mode = params.get('invite') || params.get('action') === 'join' || params.get('action') === 'register' ? 'register' : params.get('action') === 'login' || params.get('next') ? 'login' : 'choice';
      const openFromPublicSettings = () => {
        const settings = window.lugPublicSettings;
        if (!settings) return;
        if (mode === 'register' && document.body.dataset.registrationClosed === 'true') return;
        if (mode === 'choice' && settings.isProfileAccessOpen !== true) return;
        openAuth(mode, { invite: params.get('invite') || '', next: params.get('next') || '' });
      };
      if (mode === 'login') {
        window.setTimeout(() => openAuth(mode, { next: params.get('next') || '' }), 80);
      } else if (window.lugPublicSettings) {
        window.setTimeout(openFromPublicSettings, 80);
      } else {
        window.addEventListener('lug:config', openFromPublicSettings, { once: true });
      }
    }
  }

  if (document.body && !document.body.classList.contains('cabinet-page') && !document.body.classList.contains('admin-page')) {
    createPublicNavigation();
    createPublicSchedule({ document, window, authApi }).syncPublicSchedule();
  }
}());
