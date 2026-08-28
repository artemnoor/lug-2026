// ==========================================================================
// АНИМАЦИИ МАНИФЕСТА И ОБСЕРВЕРЫ ВИДИМОСТИ
// ==========================================================================
(function initManifestoObservers(){
  const star = document.querySelector('.manifesto-star');
  const manifesto = document.querySelector('.stage-manifesto');
  if (star && manifesto) {
    if (!('IntersectionObserver' in window)) {
      star.classList.add('is-visible');
    } else {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            star.classList.add('is-visible');
            manifesto.classList.add('is-visible');
            observer.unobserve(manifesto);
          }
        });
      }, {
        threshold: 0.12,
        rootMargin: '0px 0px -4% 0px'
      });
      observer.observe(manifesto);
    }
  }

})();
