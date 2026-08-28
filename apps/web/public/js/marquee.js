// ==========================================================================
// БЕГУЩАЯ СТРОКА ПО ВОЛНЕ (SVG ТРАЕКТОРИЯ)
// ==========================================================================
(function initWaveMarquee(){
  const textPath = document.getElementById('marqueeText');
  const measure = document.getElementById('measureMarquee');
  if (!textPath || !measure) return;

  let offset = 0;
  let last = performance.now();

  const speed = 26;
  let loopLength = measure.getBoundingClientRect().width || 320;

  const updateLoopLength = () => {
    const measured = measure.getBoundingClientRect().width;
    if (measured > 0) loopLength = measured;
  };
  window.addEventListener('resize', updateLoopLength, { passive: true });
  // Recalculate once font is ready
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(updateLoopLength);
  }

  function animate(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    offset += speed * dt;

    if (offset >= loopLength) {
      offset -= loopLength;
    }

    textPath.setAttribute('startOffset', offset.toFixed(3));
    requestAnimationFrame(animate);
  }

  requestAnimationFrame(animate);
})();
