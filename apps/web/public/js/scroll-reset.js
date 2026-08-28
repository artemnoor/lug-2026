(() => {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  const resetPublicStart = () => {
    if (location.hash) return;
    const previousBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, 0);
    document.documentElement.style.scrollBehavior = previousBehavior;
  };
  resetPublicStart();
  window.addEventListener('pageshow', resetPublicStart);
  window.addEventListener('load', resetPublicStart, { once: true });
})();
