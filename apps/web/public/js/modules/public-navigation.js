export function buildPublicNavigation(document, window) {
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
      <a href="#about">О конкурсе</a><a href="#process">Этапы</a><a href="#gallery">История</a>
      <a href="#rules">Правила</a><a href="#registration">Участие</a>
      <a class="site-nav__menu-account" id="siteMenuAccountLink" href="index.html?action=choice">Войти в кабинет <span aria-hidden="true">→</span></a>
    </nav>
    <div data-theme-switcher></div>
    <a class="site-nav__account" id="siteAccountLink" href="index.html?action=choice">Войти</a>
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
  navigation.querySelectorAll('.site-nav__links a').forEach((link) => link.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
  return navigation;
}
