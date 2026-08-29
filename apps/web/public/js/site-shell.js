/* Public navigation and the single account entry point.
 * Login and registration intentionally share one modal so the public page
 * remains visible behind the workflow and users never get a second visual shell.
 */
(function () {
  'use strict';

  function createPublicNavigation() {
    const demoBar = document.querySelector('.demo-bar');
    if (demoBar) demoBar.remove();

    const navigation = document.createElement('header');
    navigation.className = 'site-nav site-nav--public';
    navigation.innerHTML = `
      <a class="skip-link" href="#main-content">Перейти к содержанию</a>
      <a class="site-nav__brand" href="index.html" aria-label="Лучшая учебная группа — главная">
        <span class="site-nav__mark"><img src="assets/group-icon.svg" alt=""></span>
      </a>
      <button class="site-nav__toggle" type="button" aria-expanded="false" aria-controls="public-navigation" aria-label="Открыть меню">
        <span></span><span></span><span></span>
      </button>
      <nav class="site-nav__links" id="public-navigation" aria-label="Основная навигация">
        <a href="#about">О конкурсе</a>
        <a href="#process">Этапы</a>
        <a href="#gallery">История</a>
        <a href="#rules">Правила</a>
        <a href="#registration">Участие</a>
        <a class="site-nav__menu-account" id="siteMenuAccountLink" href="register.html">Войти в кабинет <span aria-hidden="true">→</span></a>
      </nav>
      <a class="site-nav__account" id="siteAccountLink" href="register.html">Войти</a>
    `;
    document.body.prepend(navigation);

    const updateHeaderState = () => navigation.classList.toggle('is-scrolled', window.scrollY > 40);
    updateHeaderState();
    window.addEventListener('scroll', updateHeaderState, { passive: true });

    const toggle = navigation.querySelector('.site-nav__toggle');
    const closeMenu = () => {
      navigation.classList.remove('is-open');
      document.body.classList.remove('menu-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Открыть меню');
    };
    toggle.addEventListener('click', () => {
      const isOpen = navigation.classList.toggle('is-open');
      document.body.classList.toggle('menu-open', isOpen);
      toggle.setAttribute('aria-expanded', String(isOpen));
      toggle.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');
    });
    navigation.querySelectorAll('.site-nav__links a').forEach(link => link.addEventListener('click', closeMenu));
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

    const accountLink = navigation.querySelector('#siteAccountLink');
    const menuAccountLink = navigation.querySelector('#siteMenuAccountLink');
    const authDialog = document.createElement('dialog');
    authDialog.className = 'site-auth-dialog';
    authDialog.setAttribute('aria-labelledby', 'site-auth-title');
    authDialog.innerHTML = `
      <form class="site-auth-dialog__card" id="siteAuthForm" novalidate>
        <svg class="site-auth-dialog__star" viewBox="0 0 100 100" aria-hidden="true"><polygon points="50,0 58,37 88,12 67,43 100,50 64,57 88,88 57,65 50,100 42,63 12,88 35,57 0,50 36,43 12,12 43,37"/></svg>
        <div class="site-auth-dialog__intro" aria-hidden="true">
          <svg class="site-auth-dialog__intro-logo" viewBox="0 0 1254 1254" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision">
            <g fill="none" stroke="currentColor" stroke-width="26" stroke-linecap="round" stroke-linejoin="round">
              <circle class="auth-logo-line auth-logo-line--1" pathLength="1" cx="629.5" cy="249.5" r="77.5"/><circle class="auth-logo-line auth-logo-line--2" pathLength="1" cx="434.5" cy="333.5" r="77.5"/><circle class="auth-logo-line auth-logo-line--2" pathLength="1" cx="824.5" cy="333.5" r="77.5"/>
              <path class="auth-logo-line auth-logo-line--3" pathLength="1" d="M512 455c4-38 38-68 84-68h66c46 0 80 30 84 68"/><path class="auth-logo-line auth-logo-line--4" pathLength="1" d="M286 753V566c0-55 45-99 100-99h126"/><path class="auth-logo-line auth-logo-line--4" pathLength="1" d="M746 467h126c55 0 100 44 100 99v199"/>
              <path class="auth-logo-line auth-logo-line--5" pathLength="1" d="M512 467v199a43.5 43.5 0 0 0 87 0V566c0-48-38-88-87-99"/><path class="auth-logo-line auth-logo-line--6" pathLength="1" d="M746 467v199a43.5 43.5 0 0 1-87 0V566c0-48-38-88-87-99"/>
            </g>
            <path class="auth-logo-fill auth-logo-line--8" pathLength="1" d="M382 754h82q15 0 15 15v219h-46V790h-60q-35 0-44 34l-48 164h-41l49-178q15-56 93-56Z"/><path class="auth-logo-fill auth-logo-line--8" pathLength="1" d="M821 754h164v25q0 12-12 12H837v197h-46V779q0-25 30-25Z"/>
            <path class="auth-logo-line auth-logo-line--7" pathLength="1" d="M536 765l42 96q14 32 67 32h20" fill="none" stroke="currentColor" stroke-width="46" stroke-linecap="butt" stroke-linejoin="round"/><path class="auth-logo-line auth-logo-line--9" pathLength="1" d="M732 765l-67 168q-14 35-58 35h-27" fill="none" stroke="currentColor" stroke-width="46" stroke-linecap="butt" stroke-linejoin="round"/>
          </svg>
        </div>
        <button class="site-auth-dialog__close" type="button" aria-label="Закрыть окно">×</button>

        <section class="site-auth-dialog__choice" id="siteAuthChoice">
          <div class="site-auth-dialog__emblem" aria-hidden="true"><img src="assets/group-icon.svg" alt=""></div>
          <p class="site-auth-dialog__eyebrow">ЛУГ 2026 · МГТУ им. Н. Э. Баумана</p>
          <h2 id="site-auth-title">Личный кабинет<br>конкурса</h2>
          <p class="site-auth-dialog__lead">Выберите действие: войти в кабинет или создать заявку команды.</p>
          <div class="site-auth-dialog__choice-actions">
            <div class="site-auth-dialog__choice-action">
              <p>Уже зарегистрированы?</p>
              <button type="button" data-auth-mode="login">Войти</button>
              <small>По почте и паролю</small>
            </div>
            <div class="site-auth-dialog__choice-action">
              <p>Впервые на конкурсе?</p>
              <button type="button" data-auth-mode="register">Зарегистрироваться</button>
              <small>Создать команду или войти по приглашению</small>
            </div>
          </div>
          <p class="site-auth-dialog__footer">Не уверены, что выбрать? <a href="mailto:lug@bmstu.ru?subject=Вопрос%20по%20участию">Написать организаторам</a></p>
        </section>

        <section class="site-auth-dialog__login" id="siteAuthLogin" hidden>
          <button class="site-auth-dialog__back" type="button" data-auth-mode="choice"><span aria-hidden="true">←</span> Назад</button>
          <h2 id="site-auth-login-title">Войти<br>в кабинет</h2>
          <p class="site-auth-dialog__lead">Введите почту и пароль. После входа откроется ваш конкурсный маршрут.</p>
          <p class="site-auth-dialog__verify-status" id="siteAuthLoginStatus" role="status" aria-live="polite"></p>
          <label>Электронная почта<input data-auth-field="login" id="siteAuthEmail" type="email" autocomplete="username" placeholder="you@example.com" required></label>
          <label>Пароль<input data-auth-field="login" id="siteAuthPassword" type="password" autocomplete="current-password" placeholder="••••••••" required></label>
          <p class="site-auth-dialog__error" id="siteAuthError" role="alert"></p>
          <button class="site-auth-dialog__submit" id="siteAuthLoginSubmit" type="submit">Войти <span aria-hidden="true">→</span></button>
          <p class="site-auth-dialog__footer">Не помните пароль? <button class="site-auth-dialog__inline-link" type="button" data-auth-mode="recovery">Восстановить доступ</button></p>
        </section>

        <section class="site-auth-dialog__login" id="siteAuthRecovery" hidden>
          <button class="site-auth-dialog__back" type="button" data-auth-mode="login"><span aria-hidden="true">←</span> Вернуться ко входу</button>
          <p class="site-auth-dialog__eyebrow">Восстановление доступа</p>
          <h2 id="site-auth-recovery-title">Вернуть<br>доступ</h2>
          <div id="siteRecoveryRequestStep">
            <p class="site-auth-dialog__lead">Укажите почту, которую использовали при регистрации. Мы отправим на неё код восстановления.</p>
            <label>Электронная почта<input data-auth-field="recovery" id="siteRecoveryEmail" type="email" autocomplete="email" placeholder="you@example.com" required></label>
            <p class="site-auth-dialog__error" id="siteAuthRecoveryError" role="alert"></p>
            <button class="site-auth-dialog__submit" id="siteAuthRecoveryRequestSubmit" type="submit">Отправить код <span aria-hidden="true">→</span></button>
          </div>
          <div id="siteRecoveryResetStep" hidden>
            <p class="site-auth-dialog__lead">Код отправлен на <strong id="siteRecoveryVerificationEmail"></strong>. Введите его и задайте новый пароль.</p>
            <label>Код восстановления<input data-auth-field="recovery" id="siteRecoveryCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required></label>
            <div class="site-auth-dialog__password-field">
              <label for="siteRecoveryPassword">Новый пароль</label>
              <div class="site-auth-dialog__password-control"><input data-auth-field="recovery" id="siteRecoveryPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Придумайте пароль" aria-describedby="siteRecoveryPasswordRules" required><button type="button" class="site-auth-dialog__password-toggle" data-password-toggle="siteRecoveryPassword" aria-pressed="false">Показать</button></div>
              <ul class="site-auth-dialog__password-rules" id="siteRecoveryPasswordRules" aria-live="polite"><li data-recovery-password-rule="length">8 символов</li><li data-recovery-password-rule="case">строчная и прописная буква</li><li data-recovery-password-rule="number">цифра</li><li data-recovery-password-rule="special">спецсимвол</li></ul>
            </div>
            <div class="site-auth-dialog__password-field">
              <label for="siteRecoveryPasswordConfirm">Повторите пароль</label>
              <div class="site-auth-dialog__password-control"><input data-auth-field="recovery" id="siteRecoveryPasswordConfirm" type="password" minlength="8" autocomplete="new-password" placeholder="Повторите пароль" aria-describedby="siteRecoveryPasswordMatch" required><button type="button" class="site-auth-dialog__password-toggle" data-password-toggle="siteRecoveryPasswordConfirm" aria-pressed="false">Показать</button></div>
              <p class="site-auth-dialog__password-match" id="siteRecoveryPasswordMatch" role="status" aria-live="polite"></p>
            </div>
            <p class="site-auth-dialog__verify-status" id="siteAuthRecoveryStatus" role="status" aria-live="polite"></p>
            <p class="site-auth-dialog__error" id="siteAuthRecoveryResetError" role="alert"></p>
            <button class="site-auth-dialog__submit" id="siteAuthRecoveryResetSubmit" type="submit">Сохранить новый пароль <span aria-hidden="true">→</span></button>
            <button class="site-auth-dialog__inline-link site-auth-dialog__resend" id="siteAuthRecoveryResend" type="button">Отправить код ещё раз</button>
          </div>
        </section>

        <section class="site-auth-dialog__register" id="siteAuthRegister" hidden>
          <button class="site-auth-dialog__back" type="button" data-auth-mode="choice"><span aria-hidden="true">←</span> Назад</button>
          <p class="site-auth-dialog__eyebrow">Регистрация участника</p>
          <h2 id="site-auth-register-title">Как<br>участвовать?</h2>
          <p class="site-auth-dialog__lead">Выберите сценарий. Форму можно заполнить прямо здесь — отдельная страница не нужна.</p>
          <div class="site-auth-dialog__switch" role="tablist" aria-label="Сценарий регистрации">
            <button type="button" role="tab" data-register-mode="captain" aria-selected="true">Создать команду</button>
            <button type="button" role="tab" data-register-mode="participant" aria-selected="false">По приглашению</button>
          </div>

          <div class="site-auth-dialog__register-panel" id="siteAuthCaptainPanel" data-register-panel="captain">
            <p class="site-auth-dialog__section-note">Капитан создаёт команду своей учебной группы и затем приглашает одногруппников.</p>
            <div class="site-auth-dialog__field-grid">
              <div class="site-auth-dialog__field-group site-auth-dialog__field--wide">
                <span class="site-auth-dialog__field-group-title">Фамилия, имя и отчество</span>
                <div class="site-auth-dialog__fio-grid">
                  <label>Фамилия<input data-auth-field="captain" id="siteCapSurname" type="text" autocomplete="family-name" placeholder="Иванов" required></label>
                  <label>Имя<input data-auth-field="captain" id="siteCapName" type="text" autocomplete="given-name" placeholder="Иван" required></label>
                  <label>Отчество<input data-auth-field="captain" id="siteCapPatronymic" type="text" autocomplete="additional-name" placeholder="Иванович" required></label>
                </div>
              </div>
              <label>Учебная группа<input data-auth-field="captain" id="siteCapGroup" type="text" placeholder="Например, ИУ7-41Б" required></label>
              <label>Студентов в группе<input data-auth-field="captain" id="siteCapGroupSize" type="number" min="1" step="1" inputmode="numeric" placeholder="Например, 25" required></label>
              <label class="site-auth-dialog__field--wide">Название команды<input data-auth-field="captain" id="siteCapTeamName" type="text" placeholder="Например, Ракета ИУ7" required></label>
              <label class="site-auth-dialog__field--wide">Электронная почта<input data-auth-field="captain" id="siteCapEmail" type="email" autocomplete="email" placeholder="you@example.com" required></label>
              <fieldset class="site-auth-dialog__messenger-picker site-auth-dialog__field--wide" data-messenger-owner="captain">
                <legend>Мессенджеры</legend>
                <p class="site-auth-dialog__field-help">Выберите, как с вами можно связаться.</p>
                <div class="site-auth-dialog__messenger-options" role="group" aria-label="Способы связи капитана">
                  <button type="button" class="site-auth-dialog__messenger-option" data-messenger-owner="captain" data-messenger="telegram" aria-pressed="false"><img src="assets/messenger-telegram.svg" alt=""><span>Telegram</span><span class="site-auth-dialog__messenger-check" aria-hidden="true">✓</span></button>
                  <button type="button" class="site-auth-dialog__messenger-option" data-messenger-owner="captain" data-messenger="vk" aria-pressed="false"><img src="assets/messenger-vk.svg" alt=""><span>VK</span><span class="site-auth-dialog__messenger-check" aria-hidden="true">✓</span></button>
                  <button type="button" class="site-auth-dialog__messenger-option" data-messenger-owner="captain" data-messenger="max" aria-pressed="false"><img src="assets/messenger-max.svg" alt=""><span>MAX</span><span class="site-auth-dialog__messenger-check" aria-hidden="true">✓</span></button>
                </div>
                <div class="site-auth-dialog__messenger-contacts" data-messenger-contacts="captain" aria-live="polite"></div>
                <p class="site-auth-dialog__messenger-status" data-messenger-status="captain" role="status">Способ связи ещё не выбран</p>
              </fieldset>
            </div>
            <div class="site-auth-dialog__upload" data-dropzone="captain">
              <div class="site-auth-dialog__upload-head">
                <span class="site-auth-dialog__upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2l1.1-1.5h4.8L15.5 5h2A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12" r="3.5"/></svg></span>
                <span class="site-auth-dialog__upload-copy"><span class="site-auth-dialog__upload-title">Подтверждение студента</span><strong>Фото личного кабинета</strong><small>Сфотографируйте экран или выберите фото/PDF · до 5 МБ.</small></span>
              </div>
              <input class="site-auth-dialog__file-input" data-auth-field="captain" id="siteCapStudentCardFile" type="file" accept="image/*,.pdf" aria-label="Выбрать фото личного кабинета" tabindex="-1">
              <div class="site-auth-dialog__upload-controls">
                <button class="site-auth-dialog__upload-choose" data-auth-field="captain" data-upload-trigger data-upload-owner="captain" type="button" aria-controls="siteCapStudentCardFile" aria-describedby="siteCapFilePreview"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span data-upload-action>Выбрать фото</span></button>
                <button class="site-auth-dialog__upload-clear" data-auth-field="captain" data-upload-clear data-upload-owner="captain" type="button" hidden>Удалить</button>
              </div>
              <p class="site-auth-dialog__file-status" id="siteCapFilePreview" role="status" aria-live="polite">Файл не выбран</p>
              <div class="site-auth-dialog__file-preview" data-upload-preview-wrap hidden><img data-upload-preview alt="Предпросмотр выбранного фото"></div>
              <small class="site-auth-dialog__upload-desktop-hint">На компьютере можно также перетащить файл сюда · JPG, PNG, WEBP или PDF до 5 МБ.</small>
            </div>
            <div class="site-auth-dialog__field-grid site-auth-dialog__password-grid">
              <div class="site-auth-dialog__password-field">
                <label for="siteCapPassword">Пароль</label>
                <div class="site-auth-dialog__password-control"><input data-auth-field="captain" data-password="captain" id="siteCapPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Придумайте пароль" aria-describedby="siteCapPasswordRules" required><button type="button" class="site-auth-dialog__password-toggle" data-password-toggle="siteCapPassword" aria-pressed="false">Показать</button></div>
                <ul class="site-auth-dialog__password-rules" id="siteCapPasswordRules" data-password-rules="captain" aria-live="polite"><li data-password-rule="length">8 символов</li><li data-password-rule="case">строчная и прописная буква</li><li data-password-rule="number">цифра</li><li data-password-rule="special">спецсимвол</li></ul>
              </div>
              <div class="site-auth-dialog__password-field">
                <label for="siteCapPasswordConfirm">Повторите пароль</label>
                <div class="site-auth-dialog__password-control"><input data-auth-field="captain" data-password-confirm="captain" id="siteCapPasswordConfirm" type="password" minlength="8" autocomplete="new-password" placeholder="Повторите пароль" aria-describedby="siteCapPasswordMatch" required><button type="button" class="site-auth-dialog__password-toggle" data-password-toggle="siteCapPasswordConfirm" aria-pressed="false">Показать</button></div>
                <p class="site-auth-dialog__password-match" id="siteCapPasswordMatch" role="status" aria-live="polite"></p>
              </div>
            </div>
            <label class="site-auth-dialog__consent"><input data-auth-field="captain" id="siteCapConsent" type="checkbox" required><span>Согласен(на) на обработку <a href="privacy.html" target="_blank" rel="noopener">персональных данных</a> для конкурса.</span></label>
          </div>

          <div class="site-auth-dialog__register-panel" id="siteAuthParticipantPanel" data-register-panel="participant" hidden>
            <p class="site-auth-dialog__section-note">Укажите код от капитана — команда и учебная группа подставятся автоматически.</p>
            <div class="site-auth-dialog__field-grid">
              <label class="site-auth-dialog__field--wide">Код приглашения<input data-auth-field="participant" id="siteJoinInviteCode" type="text" placeholder="Например, IU7-41B-2026" required></label>
              <p class="site-auth-dialog__invite-status" id="siteInviteStatus" role="status"></p>
              <label>Команда<input id="siteJoinTeamName" type="text" placeholder="Определится по коду" readonly></label>
              <label>Учебная группа<input id="siteJoinGroup" type="text" placeholder="Определится по коду" readonly></label>
              <div class="site-auth-dialog__field-group site-auth-dialog__field--wide">
                <span class="site-auth-dialog__field-group-title">Фамилия, имя и отчество</span>
                <div class="site-auth-dialog__fio-grid">
                  <label>Фамилия<input data-auth-field="participant" id="siteJoinSurname" type="text" autocomplete="family-name" placeholder="Иванова" required></label>
                  <label>Имя<input data-auth-field="participant" id="siteJoinName" type="text" autocomplete="given-name" placeholder="Мария" required></label>
                  <label>Отчество<input data-auth-field="participant" id="siteJoinPatronymic" type="text" autocomplete="additional-name" placeholder="Сергеевна" required></label>
                </div>
              </div>
              <label class="site-auth-dialog__field--wide">Электронная почта<input data-auth-field="participant" id="siteJoinEmail" type="email" autocomplete="email" placeholder="you@example.com" required></label>
              <fieldset class="site-auth-dialog__messenger-picker site-auth-dialog__field--wide" data-messenger-owner="participant">
                <legend>Мессенджеры</legend>
                <p class="site-auth-dialog__field-help">Выберите, как с вами можно связаться.</p>
                <div class="site-auth-dialog__messenger-options" role="group" aria-label="Способы связи участника">
                  <button type="button" class="site-auth-dialog__messenger-option" data-messenger-owner="participant" data-messenger="telegram" aria-pressed="false"><img src="assets/messenger-telegram.svg" alt=""><span>Telegram</span><span class="site-auth-dialog__messenger-check" aria-hidden="true">✓</span></button>
                  <button type="button" class="site-auth-dialog__messenger-option" data-messenger-owner="participant" data-messenger="vk" aria-pressed="false"><img src="assets/messenger-vk.svg" alt=""><span>VK</span><span class="site-auth-dialog__messenger-check" aria-hidden="true">✓</span></button>
                  <button type="button" class="site-auth-dialog__messenger-option" data-messenger-owner="participant" data-messenger="max" aria-pressed="false"><img src="assets/messenger-max.svg" alt=""><span>MAX</span><span class="site-auth-dialog__messenger-check" aria-hidden="true">✓</span></button>
                </div>
                <div class="site-auth-dialog__messenger-contacts" data-messenger-contacts="participant" aria-live="polite"></div>
                <p class="site-auth-dialog__messenger-status" data-messenger-status="participant" role="status">Способ связи ещё не выбран</p>
              </fieldset>
            </div>
            <div class="site-auth-dialog__upload" data-dropzone="participant">
              <div class="site-auth-dialog__upload-head">
                <span class="site-auth-dialog__upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2l1.1-1.5h4.8L15.5 5h2A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12" r="3.5"/></svg></span>
                <span class="site-auth-dialog__upload-copy"><span class="site-auth-dialog__upload-title">Подтверждение студента</span><strong>Фото личного кабинета</strong><small>Сфотографируйте экран или выберите фото/PDF · до 5 МБ.</small></span>
              </div>
              <input class="site-auth-dialog__file-input" data-auth-field="participant" id="siteJoinStudentCardFile" type="file" accept="image/*,.pdf" aria-label="Выбрать фото личного кабинета" tabindex="-1">
              <div class="site-auth-dialog__upload-controls">
                <button class="site-auth-dialog__upload-choose" data-auth-field="participant" data-upload-trigger data-upload-owner="participant" type="button" aria-controls="siteJoinStudentCardFile" aria-describedby="siteJoinFilePreview"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span data-upload-action>Выбрать фото</span></button>
                <button class="site-auth-dialog__upload-clear" data-auth-field="participant" data-upload-clear data-upload-owner="participant" type="button" hidden>Удалить</button>
              </div>
              <p class="site-auth-dialog__file-status" id="siteJoinFilePreview" role="status" aria-live="polite">Файл не выбран</p>
              <div class="site-auth-dialog__file-preview" data-upload-preview-wrap hidden><img data-upload-preview alt="Предпросмотр выбранного фото"></div>
              <small class="site-auth-dialog__upload-desktop-hint">На компьютере можно также перетащить файл сюда · JPG, PNG, WEBP или PDF до 5 МБ.</small>
            </div>
            <div class="site-auth-dialog__field-grid site-auth-dialog__password-grid">
              <div class="site-auth-dialog__password-field">
                <label for="siteJoinPassword">Пароль</label>
                <div class="site-auth-dialog__password-control"><input data-auth-field="participant" data-password="participant" id="siteJoinPassword" type="password" minlength="8" autocomplete="new-password" placeholder="Придумайте пароль" aria-describedby="siteJoinPasswordRules" required><button type="button" class="site-auth-dialog__password-toggle" data-password-toggle="siteJoinPassword" aria-pressed="false">Показать</button></div>
                <ul class="site-auth-dialog__password-rules" id="siteJoinPasswordRules" data-password-rules="participant" aria-live="polite"><li data-password-rule="length">8 символов</li><li data-password-rule="case">строчная и прописная буква</li><li data-password-rule="number">цифра</li><li data-password-rule="special">спецсимвол</li></ul>
              </div>
              <div class="site-auth-dialog__password-field">
                <label for="siteJoinPasswordConfirm">Повторите пароль</label>
                <div class="site-auth-dialog__password-control"><input data-auth-field="participant" data-password-confirm="participant" id="siteJoinPasswordConfirm" type="password" minlength="8" autocomplete="new-password" placeholder="Повторите пароль" aria-describedby="siteJoinPasswordMatch" required><button type="button" class="site-auth-dialog__password-toggle" data-password-toggle="siteJoinPasswordConfirm" aria-pressed="false">Показать</button></div>
                <p class="site-auth-dialog__password-match" id="siteJoinPasswordMatch" role="status" aria-live="polite"></p>
              </div>
            </div>
            <label class="site-auth-dialog__consent"><input data-auth-field="participant" id="siteJoinConsent" type="checkbox" required><span>Согласен(на) на обработку <a href="privacy.html" target="_blank" rel="noopener">персональных данных</a> для конкурса.</span></label>
          </div>

          <p class="site-auth-dialog__error" id="siteAuthRegisterError" role="alert"></p>
          <button class="site-auth-dialog__submit" id="siteAuthRegisterSubmit" type="submit">Создать команду и войти <span aria-hidden="true">→</span></button>
          <p class="site-auth-dialog__footer">Уже есть аккаунт? <button class="site-auth-dialog__inline-link" type="button" data-auth-mode="login">Войти</button></p>
        </section>

        <section class="site-auth-dialog__verify" id="siteAuthVerify" hidden>
          <button class="site-auth-dialog__back" type="button" data-auth-mode="register"><span aria-hidden="true">←</span> Вернуться к форме</button>
          <p class="site-auth-dialog__eyebrow">Почта подтверждена не полностью</p>
          <h2 id="site-auth-verify-title">Ещё<br>один шаг</h2>
          <p class="site-auth-dialog__lead">Мы отправили шестизначный код на <strong id="siteVerificationEmail"></strong>. Введите его ниже, чтобы завершить регистрацию.</p>
          <label>Код подтверждения<input data-auth-field="verify" id="siteVerificationCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" placeholder="000000" required></label>
          <p class="site-auth-dialog__verify-status" id="siteVerificationStatus" role="status" aria-live="polite"></p>
          <p class="site-auth-dialog__error" id="siteAuthVerifyError" role="alert"></p>
          <button class="site-auth-dialog__submit" id="siteAuthVerifySubmit" type="submit">Подтвердить почту <span aria-hidden="true">→</span></button>
          <button class="site-auth-dialog__inline-link site-auth-dialog__resend" id="siteAuthResend" type="button">Отправить код ещё раз</button>
        </section>
      </form>
    `;
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
    const messengerMeta = {
      telegram: { label: 'Telegram', contactLabel: 'Никнейм или ID Telegram', placeholder: '@username или 123456789', test: value => /^@?[a-zA-Z0-9_]{4,32}$/.test(value) || /^(?:https?:\/\/)?t\.me\/[a-zA-Z0-9_]{4,32}$/i.test(value) },
      vk: { label: 'VK', contactLabel: 'Ссылка или ID VK', placeholder: 'vk.com/username или ID', test: value => /^(?:(?:https?:\/\/)?(?:www\.)?vk\.com\/)?[a-zA-Z0-9_.-]{2,64}$/.test(value) },
      max: { label: 'MAX', contactLabel: 'Номер телефона или никнейм MAX', placeholder: '+7 999 000-00-00 или @username', test: value => /^(?:\+?\d[\d\s()\-]{8,}|@?[a-zA-Z0-9_.-]{3,64})$/.test(value) }
    };

    const setError = (node, message = '') => { node.textContent = message; node.classList.toggle('is-visible', Boolean(message)); };
    const focusFirstField = panel => window.setTimeout(() => panel?.querySelector('[data-auth-field]:not(:disabled)')?.focus(), 0);
    const isStrongPassword = value => /[a-zа-яё]/.test(value) && /[A-ZА-ЯЁ]/.test(value) && /\d/.test(value) && /[^A-Za-zА-Яа-яЁё\d\s]/.test(value) && value.length >= 8;
    const getFio = owner => {
      const prefix = owner === 'captain' ? 'siteCap' : 'siteJoin';
      return ['Surname', 'Name', 'Patronymic'].map(part => authDialog.querySelector(`#${prefix}${part}`)?.value.trim()).filter(Boolean).join(' ');
    };
    const getMessengerContacts = owner => {
      const contacts = {};
      messengerSelections[owner].forEach(key => {
        const input = authDialog.querySelector(`[data-messenger-contact="${owner}-${key}"]`);
        const value = input?.value.trim();
        if (value) contacts[key] = value;
      });
      return contacts;
    };
    const renderMessengerContacts = owner => {
      const container = authDialog.querySelector(`[data-messenger-contacts="${owner}"]`);
      const status = authDialog.querySelector(`[data-messenger-status="${owner}"]`);
      if (!container || !status) return;
      const previousValues = Object.fromEntries([...container.querySelectorAll('[data-messenger-contact]')].map(input => [input.dataset.messengerContact, input.value]));
      container.innerHTML = [...messengerSelections[owner]].map(key => {
        const meta = messengerMeta[key];
        return `<label class="site-auth-dialog__messenger-contact"><span>${meta.contactLabel}</span><input data-auth-field="${owner}" data-messenger-contact="${owner}-${key}" type="text" autocomplete="off" placeholder="${meta.placeholder}" required><small data-messenger-error="${owner}-${key}" role="alert"></small></label>`;
      }).join('');
      container.querySelectorAll('[data-messenger-contact]').forEach(input => { if (previousValues[input.dataset.messengerContact] !== undefined) input.value = previousValues[input.dataset.messengerContact]; });
      status.textContent = messengerSelections[owner].size ? `Выбрано способов связи: ${messengerSelections[owner].size}` : 'Способ связи ещё не выбран';
      authDialog.querySelectorAll(`.site-auth-dialog__messenger-option[data-messenger-owner="${owner}"]`).forEach(button => {
        const active = messengerSelections[owner].has(button.dataset.messenger);
        button.classList.toggle('is-selected', active);
        button.setAttribute('aria-pressed', String(active));
      });
      syncDisabledFields();
    };
    const toggleMessenger = (owner, key) => {
      if (!messengerMeta[key]) return;
      const selected = messengerSelections[owner];
      selected.has(key) ? selected.delete(key) : selected.add(key);
      renderMessengerContacts(owner);
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
    renderMessengerContacts('captain');
    renderMessengerContacts('participant');

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

    const startAuthIntro = (mode = 'choice') => {
      const run = ++introRun;
      window.clearTimeout(introTimer);
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
      document.body.style.top = `-${pageScrollY}px`;
      document.documentElement.classList.add('is-auth-dialog-open');
      document.body.classList.add('is-auth-dialog-open');
    };
    const unlockPage = () => {
      document.documentElement.classList.remove('is-auth-dialog-open');
      document.body.classList.remove('is-auth-dialog-open');
      document.body.style.top = '';
      window.scrollTo(0, pageScrollY);
    };

    const isAllowedFile = file => file && (/^image\//i.test(file.type) || /^application\/pdf$/i.test(file.type) || /\.(png|jpe?g|webp|gif|avif|heic|heif|tiff?|bmp|pdf)$/i.test(file.name));
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
        const { team } = await window.lugStore.invite(code);
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
        const result = await window.lugStore.verifyEmail(verificationId, codeField.value.trim());
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
        const result = await window.lugStore.resendEmailCode(verificationId);
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
        const result = await window.lugStore.requestPasswordReset(email);
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
        await window.lugStore.resetPassword(recoveryEmail || authDialog.querySelector('#siteRecoveryEmail').value.trim(), code.value.trim(), password.value);
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
        const dataUrl = await window.lugStore.fileToDataUrl(file);
        const messengerContacts = getMessengerContacts(registerMode);
        const firstMessenger = Object.entries(messengerContacts)[0] || ['', ''];
        const result = registerMode === 'captain'
          ? await window.lugStore.registerCaptain({
            fio: getFio('captain'), group: authDialog.querySelector('#siteCapGroup').value,
            teamName: authDialog.querySelector('#siteCapTeamName').value, totalStudentsInGroup: authDialog.querySelector('#siteCapGroupSize').value,
            email: authDialog.querySelector('#siteCapEmail').value, messenger: firstMessenger[0], messengerContact: firstMessenger[1],
            messengerContacts,
            password: authDialog.querySelector('#siteCapPassword').value, studentCardFile: dataUrl, studentCardFileName: file.name,
            consent: authDialog.querySelector('#siteCapConsent').checked
          })
          : await window.lugStore.registerParticipant({
            inviteCode: authDialog.querySelector('#siteJoinInviteCode').value, fio: getFio('participant'),
            email: authDialog.querySelector('#siteJoinEmail').value, messenger: firstMessenger[0], messengerContact: firstMessenger[1],
            messengerContacts,
            password: authDialog.querySelector('#siteJoinPassword').value, studentCardFile: dataUrl, studentCardFileName: file.name,
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
      if (!authDialog.open) { lastFocusedElement = document.activeElement; lockPage(); authDialog.showModal(); }
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
    authDialog.addEventListener('click', event => { if (event.target === authDialog) closeAuth(); });
    authDialog.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => openAuth(button.dataset.authMode)));
    authDialog.querySelectorAll('[data-register-mode]').forEach(button => button.addEventListener('click', () => setRegistrationMode(button.dataset.registerMode)));
    authDialog.addEventListener('close', () => {
      ++introRun; window.clearTimeout(introTimer); authForm.reset(); setError(authError); setError(registerError); loginStatus.textContent = '';
      capFile = null; joinFile = null; inviteValid = false; inviteCheckedCode = ''; nextPath = '';
      verificationId = ''; verificationEmail = ''; verificationExpiresAt = '';
      recoveryStep = 'request'; recoveryEmail = '';
      setError(authDialog.querySelector('#siteAuthRecoveryError')); setError(authDialog.querySelector('#siteAuthRecoveryResetError'));
      authDialog.querySelector('#siteAuthRecoveryStatus').textContent = '';
      messengerSelections.captain.clear(); messengerSelections.participant.clear();
      renderMessengerContacts('captain'); renderMessengerContacts('participant');
      authDialog.querySelectorAll('[data-password-toggle]').forEach(button => { const input = authDialog.querySelector(`#${button.dataset.passwordToggle}`); input.type = 'password'; button.textContent = 'Показать'; button.setAttribute('aria-pressed', 'false'); });
      uploadResetters.forEach(reset => reset());
      setAuthMode('choice'); authDialog.classList.remove('is-intro-login', 'is-intro-complete'); authDialog.querySelector('.site-auth-dialog__intro')?.style.removeProperty('--auth-intro-travel'); unlockPage();
      if (lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus();
      lastFocusedElement = null;
    });

    accountLink.addEventListener('click', event => {
      if (accountLink.dataset.authenticated === 'true') return;
      event.preventDefault(); openAuth('choice');
    });
    document.addEventListener('click', event => {
      const link = event.target.closest?.('a[href]');
      if (!link || event.defaultPrevented || link.target === '_blank') return;
      const url = new URL(link.href, window.location.href);
      if (!url.pathname.endsWith('/register.html')) return;
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
        const result = await window.lugStore.login(authDialog.querySelector('#siteAuthEmail').value.trim(), authDialog.querySelector('#siteAuthPassword').value);
        window.location.href = nextPath || (result.user.role === 'admin' ? 'admin.html' : 'cabinet.html');
      } catch (error) {
        setError(authError, error.message || 'Не удалось войти. Проверьте данные.');
      } finally {
        submit.disabled = false; submit.innerHTML = 'Войти <span aria-hidden="true">→</span>';
      }
    });
    authDialog.querySelector('#siteAuthResend').addEventListener('click', resendEmailVerification);
    authDialog.querySelector('#siteAuthRecoveryResend').addEventListener('click', () => requestRecoveryCode({ resend: true }));

    window.lugStore?.session?.().then(({ user }) => {
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

  function publicDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) : '';
  }

  function publicDateRange(start, end) {
    const left = publicDate(start);
    const right = publicDate(end);
    return left && right ? `${left} — ${right}` : left || right;
  }

  function applyPublicSchedule(settings = {}) {
    window.lugPublicSettings = settings;
    const registrationActive = settings.isRegistrationOpen === true
      && Date.now() >= new Date(settings.registrationStart).getTime()
      && Date.now() <= new Date(settings.registrationDeadline).getTime();
    document.body.dataset.registrationClosed = String(!registrationActive);
    document.querySelectorAll('a[href*="register.html?action=register"]').forEach((link) => {
      link.setAttribute('aria-disabled', String(!registrationActive));
      link.tabIndex = registrationActive ? 0 : -1;
      link.classList.toggle('is-disabled', !registrationActive);
    });
    document.querySelectorAll('[data-schedule]').forEach((node) => {
      const key = node.dataset.schedule;
      const values = key === 'registration' ? [settings.registrationStart, settings.registrationDeadline]
        : key === 'portfolio' ? [settings.portfolioStart, settings.portfolioDeadline]
          : key === 'video' ? [settings.videoStart, settings.videoDeadline]
            : key === 'results' ? [settings.resultsStart, settings.resultsDeadline] : [];
      const range = publicDateRange(...values);
      if (range) node.textContent = range;
    });
    document.querySelectorAll('[data-registration-deadline]').forEach((node) => {
      node.textContent = registrationActive ? `Зарегистрируйся до ${publicDate(settings.registrationDeadline)}` : 'Приём заявок закрыт';
    });
    document.querySelectorAll('[data-content]:not([data-registration-status])').forEach((node) => {
      const value = settings.content?.[node.dataset.content];
      if (value) node.textContent = value;
    });
    document.querySelectorAll('[data-registration-status]').forEach((node) => {
      node.textContent = registrationActive ? (settings.content?.registrationHeadline || `Приём заявок открыт до ${publicDate(settings.registrationDeadline)}`) : 'Приём заявок закрыт';
    });
    window.dispatchEvent(new CustomEvent('lug:config', { detail: settings }));
  }

  async function syncPublicSchedule() {
    try {
      const result = await window.lugStore.request('/api/config');
      applyPublicSchedule(result.settings || {});
    } catch {
      // Static fallback copy remains visible when the page is opened without the server.
    }
  }

  if (document.body && document.body.classList.contains('public-page')) {
    createPublicNavigation();
    syncPublicSchedule();
  }
}());
