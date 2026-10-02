(function () {
  const scene = document.querySelector('[data-hero-intro-scene]');
  const introPanel = scene?.querySelector('#introduction');
  const prizePanel = document.querySelector('#prizes');
  const heroContent = scene?.querySelector('#hero .hero-s');
  const heroBackground = scene?.querySelector('#hero .hero-w_bg');
  const prizeSpotlight = prizePanel?.querySelector('.prize-spotlight');
  const introRevealTarget = introPanel?.querySelector('.arch-heading-group');
  const introOutlinePath = introPanel?.querySelector('.arch-heading-outline path');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  if (!scene || !introPanel || !heroContent) return;

  let transitionDistance = Math.max(1, window.innerHeight);
  let frameRequested = false;
  let introRevealObserver = null;
  let introRevealStarted = false;
  let prizeSpotlightObserver = null;
  let prizeSpotlightStarted = false;
  const introRevealAnimations = [];

  function revealPrizeSpotlight() {
    if (!prizeSpotlight || prizeSpotlightStarted || reducedMotion.matches) return;
    prizeSpotlightStarted = true;
    prizeSpotlight.classList.add('is-spotlight-entered');
  }

  function observePrizeSpotlight() {
    if (!prizeSpotlight || prizeSpotlightStarted || reducedMotion.matches) return;
    if (typeof IntersectionObserver === 'undefined') {
      revealPrizeSpotlight();
      return;
    }

    prizeSpotlightObserver?.disconnect();
    prizeSpotlightObserver = new IntersectionObserver((entries) => {
      if (reducedMotion.matches || !entries.some((entry) => entry.isIntersecting)) return;
      prizeSpotlightObserver.disconnect();
      revealPrizeSpotlight();
    }, { threshold: 0.08, rootMargin: '0px 0px -10% 0px' });
    prizeSpotlightObserver.observe(prizeSpotlight);
  }

  function playIntroReveal() {
    if (introRevealStarted || reducedMotion.matches || typeof Element.prototype.animate !== 'function') return;
    introRevealStarted = true;

    const stars = [...introPanel.querySelectorAll('.arch-heading-star')];
    stars.forEach((star, index) => {
      const isLeft = star.classList.contains('arch-heading-star-left');
      const finalRotation = isLeft ? -65 : 65;
      const startRotation = isLeft ? -145 : 145;
      const enteringOffset = isLeft ? '-36vw' : '36vw';
      introRevealAnimations.push(star.animate([
        {
          opacity: 0,
          transform: `translate3d(${enteringOffset}, 0, 0) rotate(${startRotation}deg) scale(0.94)`
        },
        {
          opacity: 1,
          transform: `translate3d(0, 0, 0) rotate(${finalRotation}deg) scale(1)`
        }
      ], {
        duration: 880 + index * 80,
        delay: index * 110,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'both'
      }));
    });

    if (introOutlinePath) {
      introRevealAnimations.push(introOutlinePath.animate([
        { strokeDashoffset: 1 },
        { strokeDashoffset: 0 }
      ], {
        duration: 980,
        delay: 80,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'both'
      }));
    }

    const logos = [...introPanel.querySelectorAll('.arch-logo-row img')];
    logos.forEach((logo, index) => {
      introRevealAnimations.push(logo.animate([
        { opacity: 0, transform: 'translate3d(0, 18px, 0) scale(0.96)' },
        { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
      ], {
        duration: 440,
        delay: 260 + index * 70,
        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
        fill: 'both'
      }));
    });
  }

  function observeIntroReveal() {
    if (!introRevealTarget || introRevealStarted || typeof IntersectionObserver === 'undefined') return;
    if (!reducedMotion.matches && introOutlinePath && typeof Element.prototype.animate === 'function') {
      introOutlinePath.style.strokeDasharray = '1';
      introOutlinePath.style.strokeDashoffset = '1';
    }
    introRevealObserver?.disconnect();
    introRevealObserver = new IntersectionObserver((entries) => {
      if (reducedMotion.matches || !entries.some((entry) => entry.isIntersecting)) return;
      introRevealObserver.disconnect();
      playIntroReveal();
    }, { threshold: 0.18 });
    introRevealObserver.observe(introRevealTarget);
  }

  function clearTransition() {
    scene.classList.remove('is-transition-ready');
    scene.style.removeProperty('height');
    introPanel.style.removeProperty('transform');
    prizePanel?.style.removeProperty('transform');
    heroContent.style.removeProperty('transform');
    heroContent.style.removeProperty('opacity');
    heroBackground?.style.removeProperty('--hero-photo-opacity');
  }

  function updateHeaderLogoState() {
    const sceneTop = scene.getBoundingClientRect().top;
    const rawProgress = Math.min(1, Math.max(0, -sceneTop / transitionDistance));
    document.body.classList.toggle('is-intro-logo-compact', rawProgress >= 0.5);
    document.body.classList.toggle('is-site-header-visible', introPanel.getBoundingClientRect().bottom <= 48);
  }

  function updateTransition() {
    frameRequested = false;
    updateHeaderLogoState();
    if (reducedMotion.matches || !scene.classList.contains('is-transition-ready')) return;

    const sceneTop = scene.getBoundingClientRect().top;
    const rawProgress = Math.min(1, Math.max(0, -sceneTop / transitionDistance));
    const progress = rawProgress * rawProgress * (3 - 2 * rawProgress);

    const heroOffset = -55 * progress;
    const heroScale = 1 - 0.08 * progress;
    heroContent.style.transform = `translate3d(0, ${heroOffset.toFixed(2)}px, 0) scale(${heroScale.toFixed(4)})`;
    const heroFadeProgress = Math.min(1, progress / 0.42);
    const easedHeroFade = heroFadeProgress * heroFadeProgress * (3 - 2 * heroFadeProgress);
    heroContent.style.opacity = (1 - easedHeroFade).toFixed(4);
    heroBackground?.style.setProperty('--hero-photo-opacity', (1 - progress).toFixed(4));

    const panelOffset = transitionDistance * 0.34 * (1 - progress);
    const panelScale = 0.94 + 0.06 * progress;
    introPanel.style.transform = `translate3d(0, ${panelOffset.toFixed(2)}px, 0) scale(${panelScale.toFixed(4)})`;

    if (prizePanel) {
      const prizeProgressRaw = Math.min(1, Math.max(0, (window.scrollY + window.innerHeight - prizePanel.offsetTop) / transitionDistance));
      const prizeProgress = prizeProgressRaw * prizeProgressRaw * (3 - 2 * prizeProgressRaw);
      const prizeOffset = transitionDistance * 0.34 * (1 - prizeProgress);
      const prizeScale = 0.94 + 0.06 * prizeProgress;
      prizePanel.style.transform = `translate3d(0, ${prizeOffset.toFixed(2)}px, 0) scale(${prizeScale.toFixed(4)})`;
    }
  }

  function requestTransitionUpdate() {
    if (frameRequested) return;
    frameRequested = true;
    window.requestAnimationFrame(updateTransition);
  }

  function syncTransitionLayout() {
    if (reducedMotion.matches) {
      clearTransition();
      updateHeaderLogoState();
      return;
    }

    transitionDistance = Math.max(1, window.innerHeight);
    const panelHeight = introPanel.offsetHeight;

    // Reserve room for hero + introduction while the introduction enters as an overlay.
    scene.style.height = `${transitionDistance + panelHeight}px`;
    scene.classList.add('is-transition-ready');
    updateTransition();
  }

  window.addEventListener('scroll', requestTransitionUpdate, { passive: true });
  window.addEventListener('resize', syncTransitionLayout);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(syncTransitionLayout).observe(introPanel);
  }

  if (typeof reducedMotion.addEventListener === 'function') {
    reducedMotion.addEventListener('change', () => {
      syncTransitionLayout();
      if (reducedMotion.matches) {
        prizeSpotlightObserver?.disconnect();
        introRevealAnimations.forEach((animation) => animation.finish());
        introOutlinePath?.style.removeProperty('stroke-dasharray');
        introOutlinePath?.style.removeProperty('stroke-dashoffset');
      } else {
        observeIntroReveal();
        observePrizeSpotlight();
      }
    });
  } else {
    reducedMotion.addListener(() => {
      syncTransitionLayout();
      if (reducedMotion.matches) {
        prizeSpotlightObserver?.disconnect();
        introRevealAnimations.forEach((animation) => animation.finish());
        introOutlinePath?.style.removeProperty('stroke-dasharray');
        introOutlinePath?.style.removeProperty('stroke-dashoffset');
      } else {
        observeIntroReveal();
        observePrizeSpotlight();
      }
    });
  }

  if (document.fonts?.ready) document.fonts.ready.then(syncTransitionLayout);

  observeIntroReveal();
  observePrizeSpotlight();
  syncTransitionLayout();
})();
