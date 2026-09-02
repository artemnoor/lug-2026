export function buildPublicNavigation(document, window) {
  const demoBar = document.querySelector('.demo-bar');
  if (demoBar) demoBar.remove();

  const navigation = document.createElement('header');
  navigation.className = 'site-nav site-nav--public';
  navigation.innerHTML = `
    <a class="skip-link" href="#main-content">Перейти к содержанию</a>
    <a class="site-nav__brand" href="index.html" aria-label="Лучшая учебная группа — главная">
      <span class="site-nav__mark">
        <img src="assets/group-icon.svg" alt="">
        <svg class="site-nav__mark-orbit" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
          <defs>
            <path id="lug-logo-orbit" d="M 100,100 m -88,0 a 88,88 0 1,1 176,0 a 88,88 0 1,1 -176,0"></path>
          </defs>
          <text><textPath href="#lug-logo-orbit" startOffset="0%">ЛУЧШАЯ УЧЕБНАЯ ГРУППА • МГТУ ИМЕНИ БАУМАНА • </textPath></text>
        </svg>
      </span>
    </a>
    <a class="site-nav__account" id="siteAccountLink" href="index.html?action=choice">
      <span class="site-nav__account-title">Войти<br>в личный кабинет</span>
      <small class="site-nav__account-caption">доступ к кабинету</small>
    </a>
  `;
  document.body.prepend(navigation);

  const updateHeaderState = () => navigation.classList.toggle('is-scrolled', window.scrollY > 40);
  updateHeaderState();
  window.addEventListener('scroll', updateHeaderState, { passive: true });
  const closeMenu = () => {
    navigation.classList.remove('is-open');
    document.body.classList.remove('menu-open');
  };
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenu(); });
  return navigation;
}
