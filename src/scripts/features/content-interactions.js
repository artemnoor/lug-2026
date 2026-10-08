
  (function() {
    // Single-photo gallery avoids duplicate images in a two-page spread.
    function initHistoryBook() {
      const book = document.querySelector('[data-history-book]');
      if (!book) return;

      const photoTemplate = book.querySelector('[data-history-photos]');
      const photos = photoTemplate
        ? Array.from(photoTemplate.content.querySelectorAll('img'), image => image.src)
        : [];
      const stage = book.querySelector('[data-history-stage]');
      const image = book.querySelector('[data-history-image]');
      const counter = book.querySelector('[data-history-counter]');
      const previousButton = book.querySelector('[data-history-prev]');
      const nextButton = book.querySelector('[data-history-next]');
      if (photos.length === 0 || !stage || !image) return;

      let currentIndex = 0;
      let isLoading = false;

      function updateControls() {
        stage.setAttribute('aria-busy', String(isLoading));
        if (previousButton) previousButton.disabled = isLoading;
        if (nextButton) nextButton.disabled = isLoading;
      }

      function showPhoto(index) {
        currentIndex = index;
        image.src = photos[index];
        image.alt = `Фотография из альбома конкурса, кадр ${index + 1} из ${photos.length}`;
        if (counter) counter.textContent = `${index + 1} / ${photos.length}`;
      }

      async function movePhoto(direction) {
        if (isLoading || photos.length < 2) return;

        const targetIndex = (currentIndex + direction + photos.length) % photos.length;
        isLoading = true;
        updateControls();

        const preload = new Image();
        preload.decoding = 'async';
        preload.src = photos[targetIndex];

        try {
          await preload.decode();
          showPhoto(targetIndex);
        } catch {
          // Keep the current image visible if this album photo is unavailable.
        } finally {
          isLoading = false;
          updateControls();
        }
      }

      previousButton?.addEventListener('click', () => movePhoto(-1));
      nextButton?.addEventListener('click', () => movePhoto(1));
      stage.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          movePhoto(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          movePhoto(1);
        }
      });

      showPhoto(0);
      updateControls();
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        initHistoryBook();
      });
    } else {
      initHistoryBook();
    }
  })();
