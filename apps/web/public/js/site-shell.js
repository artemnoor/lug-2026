import { buildPublicNavigation } from './modules/public-navigation.js';
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
    const navigation = buildPublicNavigation(document, window);

    const accountLink = navigation.querySelector('#siteAccountLink');
    const menuAccountLink = navigation.querySelector('#siteMenuAccountLink');
    const template = document.getElementById('siteAuthDialogTemplate');
    const authDialog = template?.content.firstElementChild?.cloneNode(true);
    if (!authDialog) return;
    template.remove();
    document.body.append(authDialog);

    const authForm = authDialog.querySelector('#siteAuthForm');
    const authError = authDialog.querySelector('#siteAuthError');
    const loginStatus = authDialog.querySelector('#siteAuthLoginStatus');
    const registerError = authDialog.querySelector('#siteAuthRegisterError');
    const loginPanel = authDialog.querySelector('#siteAuthLogin');
    const registerPanel = authDialog.querySelector('#siteAuthRegister');
    const verifyPanel = authDialog.querySelector('#siteAuthVerify');
    const recoveryPanel = authDialog.querySelector('#siteAuthRecovery');
    const recoveryRequestStep = authDialog.querySelector('#siteRecoveryRequestStep');
    const recoveryResetStep = authDialog.querySelector('#siteRecoveryResetStep');
    const choicePanel = authDialog.querySelector('#siteAuthChoice');
    const introDuration = 1450;
    let introTimer = null;
    let introRun = 0;
    let introResizeObserver = null;
    let introResizeHandler = null;
    let currentMode = 'choice';
    let registerMode = 'captain';
    let capFile = null;
    let joinFile = null;
    let inviteCheckedCode = '';
    let inviteValid = false;
    let nextPath = '';
    let verificationId = '';
    let verificationEmail = '';
    let verificationExpiresAt = '';
    let recoveryStep = 'request';
    let recoveryEmail = '';
    const messengerSelections = { captain: new Set(), participant: new Set() };

    const setError = (node, message = '') => { node.textContent = message; node.classList.toggle('is-visible', Boolean(message)); };
    const focusFirstField = panel => window.setTimeout(() => panel?.querySelector('[data-auth-field]:not(:disabled)')?.focus(), 0);
    const getFioForOwner = (owner) => getFio(authDialog, owner);
    const getMessengerContactsForOwner = (owner) => getMessengerContacts(authDialog, messengerSelections, owner);
    const renderMessengerContactsForOwner = (owner) => renderMessengerContacts({ dialog: authDialog, selections: messengerSelections, owner, syncDisabledFields });
    const toggleMessenger = (owner, key) => {
      if (!messengerMeta[key]) return;
      const selected = messengerSelections[owner];
      selected.has(key) ? selected.delete(key) : selected.add(key);
      renderMessengerContactsForOwner(owner);
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
        const active = currentMode === 'login' ? owner === 'login' : currentMode === 'register' ? owner === registerMode : currentMode === 'verify' ? owner === 'verify' : currentMode === 'recovery' && owner === 'recovery';
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
      setError(registerError);
      syncDisabledFields();
      if (focus) focusFirstField(authDialog.querySelector(`[data-register-panel="${registerMode}"]`));
    };

    const setAuthMode = mode => {
      currentMode = ['choice', 'login', 'register', 'verify', 'recovery'].includes(mode) ? mode : 'choice';
      choicePanel.hidden = currentMode !== 'choice';
      loginPanel.hidden = currentMode !== 'login';
      registerPanel.hidden = currentMode !== 'register';
      verifyPanel.hidden = currentMode !== 'verify';
      recoveryPanel.hidden = currentMode !== 'recovery';
      authDialog.setAttribute('aria-labelledby', currentMode === 'login' ? 'site-auth-login-title' : currentMode === 'register' ? 'site-auth-register-title' : currentMode === 'verify' ? 'site-auth-verify-title' : currentMode === 'recovery' ? 'site-auth-recovery-title' : 'site-auth-title');
      setError(authError); setError(registerError); setError(authDialog.querySelector('#siteAuthVerifyError')); setError(authDialog.querySelector('#siteAuthRecoveryError')); setError(authDialog.querySelector('#siteAuthRecoveryResetError'));
      syncDisabledFields();
      if (currentMode === 'login') focusFirstField(loginPanel);
      if (currentMode === 'register') setRegistrationMode(registerMode);
      if (currentMode === 'verify') focusFirstField(verifyPanel);
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
        else authDialog.querySelector('[data-auth-mode="login"]')?.focus();
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
    const uploadResetters = [];
    const bindFileDropzone = (zone, input, previewId, type) => {
      const previewState = { url: null };
      zone.querySelector('[data-upload-trigger]')?.addEventListener('click', () => { if (!input.disabled) input.click(); });
      zone.addEventListener('dragover', event => { if (input.disabled) return; event.preventDefault(); zone.classList.add('is-dragover'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
      zone.addEventListener('drop', event => { if (input.disabled) return; event.preventDefault(); zone.classList.remove('is-dragover'); setFile(input, event.dataTransfer?.files?.[0], previewId, type, previewState); });
      input.addEventListener('change', event => setFile(input, event.target.files?.[0], previewId, type, previewState));
      zone.querySelector('[data-upload-clear]')?.addEventListener('click', () => clearFile(zone, input, previewId, type, previewState));
      uploadResetters.push(() => clearFile(zone, input, previewId, type, previewState));
    };
    bindFileDropzone(authDialog.querySelector('[data-dropzone="captain"]'), authDialog.querySelector('#siteCapStudentCardFile'), 'siteCapFilePreview', 'captain');
    bindFileDropzone(authDialog.querySelector('[data-dropzone="participant"]'), authDialog.querySelector('#siteJoinStudentCardFile'), 'siteJoinFilePreview', 'participant');

    const updatePasswordUI = mode => {
      const password = authDialog.querySelector(mode === 'captain' ? '#siteCapPassword' : '#siteJoinPassword');
      const confirm = authDialog.querySelector(mode === 'captain' ? '#siteCapPasswordConfirm' : '#siteJoinPasswordConfirm');
      const rules = { length: password.value.length >= 8, case: /[a-zа-яё]/.test(password.value) && /[A-ZА-ЯЁ]/.test(password.value), number: /\d/.test(password.value), special: /[^A-Za-zА-Яа-яЁё\d\s]/.test(password.value) };
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
      const rules = {
        length: password.value.length >= 8,
        case: /[a-zа-яё]/.test(password.value) && /[A-ZА-ЯЁ]/.test(password.value),
        number: /\d/.test(password.value),
        special: /[^A-Za-zА-Яа-яЁё\d\s]/.test(password.value)
      };
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
      const fields = [...panel.querySelectorAll('[data-auth-field]:not(:disabled)')];
      const invalid = fields.find(field => !field.checkValidity());
      if (invalid) { invalid.reportValidity(); return false; }
      if (!validateMessengerContacts(registerMode)) return false;
      const file = registerMode === 'captain' ? capFile : joinFile;
      if (!file) { setError(registerError, 'Загрузите скриншот личного кабинета студента.'); return false; }
      if (file.size > 5 * 1024 * 1024) { setError(registerError, 'Размер файла не должен превышать 5 МБ.'); return false; }
      const password = authDialog.querySelector(registerMode === 'captain' ? '#siteCapPassword' : '#siteJoinPassword').value;
      const confirm = authDialog.querySelector(registerMode === 'captain' ? '#siteCapPasswordConfirm' : '#siteJoinPasswordConfirm').value;
      const passwordState = updatePasswordUI(registerMode);
      if (!isStrongPassword(password)) { setError(registerError, 'Пароль должен содержать минимум 8 символов, строчную и прописную букву, цифру и спецсимвол.'); return false; }
      if (password !== confirm) { setError(registerError, 'Введённые пароли не совпадают.'); return false; }
      if (!passwordState.match) { setError(registerError, 'Подтвердите пароль повторно.'); return false; }
      return true;
    };

    const openEmailVerification = result => {
      verificationId = result.verificationId || '';
      verificationEmail = result.email || '';
      verificationExpiresAt = result.expiresAt || '';
      authDialog.querySelector('#siteVerificationEmail').textContent = verificationEmail;
      authDialog.querySelector('#siteVerificationCode').value = '';
      authDialog.querySelector('#siteVerificationStatus').textContent = result.message || 'Письмо уже в пути.';
      setError(authDialog.querySelector('#siteAuthVerifyError'));
      setAuthMode('verify');
    };

    const submitEmailVerification = async () => {
      const codeField = authDialog.querySelector('#siteVerificationCode');
      const error = authDialog.querySelector('#siteAuthVerifyError');
      if (!codeField.checkValidity() || !verificationId) { codeField.reportValidity(); return; }
      const submit = authDialog.querySelector('#siteAuthVerifySubmit');
      try {
        submit.disabled = true; submit.textContent = 'Проверяем код…';
        const result = await authApi.verifyEmail(verificationId, codeField.value.trim());
        sessionStorage.setItem('lug-welcome-guide', result.user.role);
        window.location.href = nextPath || 'cabinet.html?welcome=1';
      } catch (verificationError) {
        setError(error, verificationError.message || 'Не удалось подтвердить почту.');
      } finally {
        submit.disabled = false;
        submit.innerHTML = 'Подтвердить почту <span aria-hidden="true">→</span>';
      }
    };

    const resendEmailVerification = async () => {
      if (!verificationId) return;
      const resend = authDialog.querySelector('#siteAuthResend');
      const status = authDialog.querySelector('#siteVerificationStatus');
      const error = authDialog.querySelector('#siteAuthVerifyError');
      try {
        resend.disabled = true; setError(error);
        const result = await authApi.resendEmailCode(verificationId);
        verificationExpiresAt = result.expiresAt || verificationExpiresAt;
        status.textContent = 'Новый код отправлен. Проверьте входящие и папку «Спам».';
      } catch (resendError) {
        setError(error, resendError.message || 'Не удалось отправить новый код.');
      } finally {
        window.setTimeout(() => { resend.disabled = false; }, 1000);
      }
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
        setError(error, 'Пароль должен содержать минимум 8 символов, строчную и прописную букву, цифру и спецсимвол.');
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
        submit.disabled = true; submit.textContent = 'Создаём заявку…';
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
            studentCardSize: card.size, studentCardType: card.type,
            consent: authDialog.querySelector('#siteCapConsent').checked
          })
          : await authApi.registerParticipant({
            inviteCode: authDialog.querySelector('#siteJoinInviteCode').value, fio: getFioForOwner('participant'),
            email: authDialog.querySelector('#siteJoinEmail').value, messenger: firstMessenger[0], messengerContact: firstMessenger[1],
            messengerContacts,
            password: authDialog.querySelector('#siteJoinPassword').value, studentCardFile: card.url,
            studentCardFileName: file.name, studentCardUploadToken: card.registrationToken,
            studentCardSize: card.size, studentCardType: card.type,
            consent: authDialog.querySelector('#siteJoinConsent').checked
          });
        if (result.verificationRequired) { openEmailVerification(result); return; }
        sessionStorage.setItem('lug-welcome-guide', result.user.role);
        window.location.href = 'cabinet.html?welcome=1';
      } catch (error) {
        setError(registerError, error.message || 'Не удалось отправить заявку.');
      } finally {
        submit.disabled = false;
        submit.innerHTML = registerMode === 'captain' ? 'Создать команду и войти <span aria-hidden="true">→</span>' : 'Присоединиться и войти <span aria-hidden="true">→</span>';
      }
    };

    const openAuth = (mode = 'choice', options = {}) => {
      nextPath = options.next === 'admin.html' || options.next === 'cabinet.html' ? options.next : '';
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
      if (options.invite) {
        setAuthMode('register'); setRegistrationMode('participant', false);
        authDialog.querySelector('#siteJoinInviteCode').value = options.invite;
        checkInviteCode();
      }
    };

    const closeAuth = () => { if (authDialog.open) authDialog.close(); };
    authDialog.querySelector('.site-auth-dialog__close').addEventListener('click', closeAuth);
    authDialog.addEventListener('cancel', event => { event.preventDefault(); closeAuth(); });
    authDialog.addEventListener('click', event => { if (event.target === authDialog) closeAuth(); });
    authDialog.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => openAuth(button.dataset.authMode)));
    authDialog.querySelectorAll('[data-register-mode]').forEach(button => button.addEventListener('click', () => setRegistrationMode(button.dataset.registerMode)));
    authDialog.addEventListener('close', () => {
      ++introRun; window.clearTimeout(introTimer); stopIntroGeometryTracking(); authForm.reset(); setError(authError); setError(registerError); loginStatus.textContent = '';
      capFile = null; joinFile = null; inviteValid = false; inviteCheckedCode = ''; nextPath = '';
      verificationId = ''; verificationEmail = ''; verificationExpiresAt = '';
      recoveryStep = 'request'; recoveryEmail = '';
      setError(authDialog.querySelector('#siteAuthRecoveryError')); setError(authDialog.querySelector('#siteAuthRecoveryResetError'));
      authDialog.querySelector('#siteAuthRecoveryStatus').textContent = '';
      messengerSelections.captain.clear(); messengerSelections.participant.clear();
      renderMessengerContactsForOwner('captain'); renderMessengerContactsForOwner('participant');
      authDialog.querySelectorAll('[data-password-toggle]').forEach(button => { const input = authDialog.querySelector(`#${button.dataset.passwordToggle}`); input.type = 'password'; button.textContent = 'Показать'; button.setAttribute('aria-pressed', 'false'); });
      uploadResetters.forEach(reset => reset());
      setAuthMode('choice'); authDialog.classList.remove('is-intro-login', 'is-intro-complete'); authDialog.querySelector('.site-auth-dialog__intro')?.style.removeProperty('--auth-intro-travel'); unlockPage();
      if (lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus();
      lastFocusedElement = null;
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
      event.preventDefault(); openAuth('choice');
    });
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link || event.defaultPrevented || link.target === '_blank') return;
      const url = new URL(link.href, window.location.href);
      const isRegisterLink = url.pathname.endsWith('/register.html');
      const isAuthIndexLink = url.pathname.endsWith('/index.html') && (url.searchParams.has('action') || url.searchParams.has('invite') || url.searchParams.has('next'));
      if (!isRegisterLink && !isAuthIndexLink) return;
      event.preventDefault();
      const params = url.searchParams;
      if (document.body.dataset.registrationClosed === 'true' && params.get('action') !== 'login' && !params.get('invite')) {
        event.preventDefault();
        return;
      }
      openAuth(params.get('action') === 'register' || params.get('action') === 'join' || params.get('invite') ? 'register' : params.get('action') === 'login' ? 'login' : 'choice', { invite: params.get('invite') || '', next: params.get('next') || '' });
    });

    authForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (currentMode === 'verify') return submitEmailVerification();
      if (currentMode === 'register') return submitRegistration();
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
        window.location.href = nextPath || (result.user.role === 'admin' ? 'admin.html' : 'cabinet.html');
      } catch (error) {
        setError(authError, error.message || 'Не удалось войти. Проверьте данные.');
      } finally {
        submit.disabled = false; submit.innerHTML = 'Войти <span aria-hidden="true">→</span>';
      }
    });
    authDialog.querySelector('#siteAuthResend').addEventListener('click', resendEmailVerification);
    authDialog.querySelector('#siteAuthRecoveryResend').addEventListener('click', () => requestRecoveryCode({ resend: true }));

    authApi.session().then(({ user }) => {
      if (!user) return;
      accountLink.dataset.authenticated = 'true';
      accountLink.href = user.role === 'admin' ? 'admin.html' : 'cabinet.html';
      accountLink.textContent = 'Личный кабинет';
      menuAccountLink.dataset.authenticated = 'true';
      menuAccountLink.href = user.role === 'admin' ? 'admin.html' : 'cabinet.html';
      menuAccountLink.textContent = 'Личный кабинет';
    }).catch(() => {});

    const params = new URLSearchParams(window.location.search);
    if (params.get('action') || params.get('invite') || params.get('next')) {
      const mode = params.get('invite') || params.get('action') === 'join' || params.get('action') === 'register' ? 'register' : params.get('action') === 'login' || params.get('next') ? 'login' : 'choice';
      window.setTimeout(() => openAuth(mode, { invite: params.get('invite') || '', next: params.get('next') || '' }), 80);
    }
  }

  if (document.body && document.body.classList.contains('public-page')) {
    createPublicNavigation();
    createPublicSchedule({ document, window, authApi }).syncPublicSchedule();
  }
}());
