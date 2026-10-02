
  (function() {
    // Photo-only history book
    function initHistoryBook() {
      const book = document.querySelector('[data-history-book]');
      if (!book) return;

      const photoTemplate = book.querySelector('[data-history-photos]');
      const photos = photoTemplate
        ? Array.from(photoTemplate.content.querySelectorAll('img'), image => image.src)
        : [];
      const stage = book.querySelector('[data-history-stage]');
      const leftPage = book.querySelector('[data-history-left]');
      const rightPage = book.querySelector('[data-history-right]');
      const turn = book.querySelector('[data-history-turn]');
      const previousButton = book.querySelector('[data-history-prev]');
      const nextButton = book.querySelector('[data-history-next]');
      const turnFront = book.querySelector('[data-history-turn-front]');
      const turnBack = book.querySelector('[data-history-turn-back]');
      if (photos.length < 2 || !stage || !leftPage || !rightPage || !turn || !turnFront || !turnBack) return;

      const imageCache = new Map();
      const imageLoads = new Map();
      let currentIndex = Number(rightPage.dataset.photoIndex) || 1;
      let isTurning = false;

      [Number(leftPage.dataset.photoIndex), Number(rightPage.dataset.photoIndex)].forEach(index => {
        const image = new Image();
        image.decoding = 'async';
        image.src = photos[index];
        imageCache.set(index, image);
      });

      function wrapIndex(index) {
        return (index % photos.length + photos.length) % photos.length;
      }

      function updateControls() {
        stage.setAttribute('aria-busy', String(isTurning));
        if (previousButton) previousButton.disabled = isTurning;
        if (nextButton) nextButton.disabled = isTurning;
      }

      function ensurePhoto(index) {
        const cachedImage = imageCache.get(index);
        if (cachedImage?.complete && cachedImage.naturalWidth > 0) return Promise.resolve(cachedImage);
        if (imageLoads.has(index)) return imageLoads.get(index);

        const image = cachedImage || new Image();
        image.decoding = 'async';
        imageCache.set(index, image);

        const load = new Promise((resolve, reject) => {
          const handleLoad = () => resolve(image);
          const handleError = () => reject(new Error(`Не удалось загрузить фотографию ${index + 1}`));
          image.addEventListener('load', handleLoad, { once: true });
          image.addEventListener('error', handleError, { once: true });

          if (!image.src) image.src = photos[index];
          else if (image.complete) {
            if (image.naturalWidth > 0) handleLoad();
            else handleError();
          }
        }).finally(() => imageLoads.delete(index));

        imageLoads.set(index, load);
        return load;
      }

      function showPhoto(image, index, description) {
        image.src = photos[index];
        image.alt = description ? `Фотография из альбома, кадр ${index + 1}` : '';
        image.dataset.photoIndex = String(index);
      }

      function renderSpread() {
        showPhoto(leftPage, wrapIndex(currentIndex - 1), true);
        showPhoto(rightPage, currentIndex, true);
      }

      async function turnPage(direction) {
        if (isTurning) return;

        const targetIndex = wrapIndex(currentIndex + direction);
        const currentLeftIndex = wrapIndex(currentIndex - 1);
        const targetLeftIndex = wrapIndex(targetIndex - 1);
        isTurning = true;
        updateControls();

        try {
          await ensurePhoto(direction > 0 ? targetIndex : targetLeftIndex);
        } catch {
          isTurning = false;
          updateControls();
          return;
        }

        if (direction > 0) {
          showPhoto(rightPage, targetIndex, true);
          showPhoto(turnFront, currentIndex, false);
          showPhoto(turnBack, currentIndex, false);
        } else {
          showPhoto(leftPage, targetLeftIndex, true);
          showPhoto(turnFront, currentLeftIndex, false);
          showPhoto(turnBack, currentLeftIndex, false);
        }

        turn.classList.remove('is-forward', 'is-backward');
        void turn.offsetWidth;
        turn.classList.add(direction > 0 ? 'is-forward' : 'is-backward');

        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          window.clearTimeout(fallbackTimer);
          currentIndex = targetIndex;
          isTurning = false;
          turn.classList.remove('is-forward', 'is-backward');
          renderSpread();
          updateControls();
        };

        turn.addEventListener('animationend', finish, { once: true });
        const fallbackTimer = window.setTimeout(finish, 1050);
      }

      previousButton?.addEventListener('click', () => turnPage(-1));
      nextButton?.addEventListener('click', () => turnPage(1));
      leftPage.addEventListener('click', () => turnPage(-1));
      rightPage.addEventListener('click', () => turnPage(1));
      stage.addEventListener('keydown', event => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          turnPage(-1);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          turnPage(1);
        }
      });

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
