import { expect, test } from '@playwright/test';

async function blockExternalRequests(page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
}

test('page content is immediately visible without external scripts or reveal markers', async ({ page }) => {
  await blockExternalRequests(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  for (const id of ['hero', 'introduction', 'prizes', 'tracks', 'stages', 'portfolio', 'history', 'cta']) {
    await expect(page.locator('#' + id)).toBeVisible();
  }

  await expect(page.locator('#hero h1')).toContainText('Лучшая');
  await expect(page.locator('#hero h2')).toContainText('2026');
  await expect(page.locator('#portfolio .lug-card')).toHaveCount(4);
  await expect(page.locator('.section.arch .arch-heading')).toBeVisible();
  await expect(page.locator('.section.arch .arch-logo-row li')).toHaveCount(4);
  await expect(page.locator('#hero .hero-organizers-wrap')).toHaveCount(0);
  await expect(page.locator('#hero .hero-organizer_img')).toHaveCount(0);

  const state = await page.evaluate(() => ({
    blockers: [...document.querySelectorAll('.w-dyn-list, [data-preloader], [data-master-preloader], .landscape-cover, .cookies, [data-cookies], .cookies_card')]
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => element.className || element.tagName),
    revealMarkers: document.querySelectorAll('[data-scroll-reveal], [data-prevent-flicker]').length,
    externalScripts: [...document.scripts].map((script) => script.src).filter((src) => src && new URL(src).origin !== location.origin),
    bodyOverflow: getComputedStyle(document.body).overflowY,
    ctaBackground: getComputedStyle(document.querySelector('#cta')).backgroundColor,
    ctaHeadingColor: getComputedStyle(document.querySelector('#cta .lug-title')).color,
    footerBackground: getComputedStyle(document.querySelector('footer.lug-sec')).backgroundColor,
    seniorTrackBackground: getComputedStyle(document.querySelector('#tracks .arch-rect-black_r')).backgroundColor
  }));

  expect(state.blockers).toEqual([]);
  expect(state.revealMarkers).toBe(0);
  expect(state.externalScripts).toEqual([]);
  expect(state.bodyOverflow).not.toBe('hidden');
  expect(state.ctaBackground).toBe(state.seniorTrackBackground);
  expect(state.ctaHeadingColor).toBe('rgb(255, 255, 255)');
  expect(state.footerBackground).toBe(state.seniorTrackBackground);
});

test('hero text is above its photo and sections stay in normal page flow', async ({ page }) => {
  await blockExternalRequests(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const layout = await page.evaluate(() => {
    const hero = document.querySelector('#hero');
    const photo = hero.querySelector('.hero-w_bg');
    const content = hero.querySelector('.hero-s');
    const title = hero.querySelector('h1');
    const scene = document.querySelector('[data-hero-intro-scene]');
    const prize = document.querySelector('#prizes');
    const intro = document.querySelector('#introduction');
    const tracks = document.querySelector('#tracks');
    const titleRect = title.getBoundingClientRect();
    const hit = document.elementFromPoint(titleRect.left + titleRect.width / 2, titleRect.top + titleRect.height / 2);

    return {
      photoZ: Number(getComputedStyle(photo).zIndex),
      contentZ: Number(getComputedStyle(content).zIndex),
      titleVisible: getComputedStyle(title).visibility === 'visible' && Number(getComputedStyle(title).opacity) > 0,
      titleHitInsideContent: Boolean(hit && content.contains(hit)),
      heroOverflow: getComputedStyle(hero).overflow,
      heroBottom: hero.getBoundingClientRect().bottom,
      prizeTop: prize.getBoundingClientRect().top,
      prizeLayoutTop: prize.offsetTop,
      prizePosition: getComputedStyle(prize).position,
      introPosition: getComputedStyle(intro).position,
      introTop: intro.getBoundingClientRect().top,
      sceneReady: scene.classList.contains('is-transition-ready'),
      sceneBottom: scene.getBoundingClientRect().bottom,
      tracksTop: tracks.getBoundingClientRect().top
    };
  });

  expect(layout.photoZ).toBeLessThan(layout.contentZ);
  expect(layout.titleVisible).toBe(true);
  expect(layout.titleHitInsideContent).toBe(true);
  expect(layout.heroOverflow).toBe('visible');
  expect(layout.sceneReady).toBe(true);
  expect(layout.introPosition).toBe('absolute');
  expect(layout.introTop).toBeGreaterThan(layout.heroBottom);
  expect(layout.prizePosition).not.toBe('absolute');
  expect(Math.abs(layout.sceneBottom - layout.prizeLayoutTop)).toBeLessThan(1);
  expect(layout.tracksTop).toBeGreaterThanOrEqual(layout.prizeTop);
});

test('introduction rises over the hero without blur as the transition scene scrolls', async ({ page }) => {
  await blockExternalRequests(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const initial = await page.evaluate(() => ({
    heroOpacity: Number(document.querySelector('#hero .hero-s').style.opacity),
    heroBackgroundOpacity: getComputedStyle(document.querySelector('#hero .hero-w_bg')).opacity,
    introTop: document.querySelector('#introduction').getBoundingClientRect().top,
    heroBottom: document.querySelector('#hero').getBoundingClientRect().bottom,
    introPosition: getComputedStyle(document.querySelector('#introduction')).position
  }));

  expect(initial.heroOpacity).toBe(1);
  expect(initial.heroBackgroundOpacity).toBe('1');
  expect(initial.introPosition).toBe('absolute');
  expect(initial.introTop).toBeGreaterThan(initial.heroBottom);

  await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 0.25, behavior: 'instant' }));
  await page.waitForFunction(() => Number(document.querySelector('#hero .hero-s').style.opacity) < 0.99);

  const middle = await page.evaluate(() => ({
    heroOpacity: Number(document.querySelector('#hero .hero-s').style.opacity),
    heroBackgroundOpacity: getComputedStyle(document.querySelector('#hero .hero-w_bg')).opacity,
    heroTop: document.querySelector('#hero').getBoundingClientRect().top,
    introTop: document.querySelector('#introduction').getBoundingClientRect().top,
    heroFilter: getComputedStyle(document.querySelector('#hero .hero-s')).filter,
    introBackgroundImage: getComputedStyle(document.querySelector('#introduction')).backgroundImage,
    introBackgroundColor: getComputedStyle(document.querySelector('#introduction')).backgroundColor
  }));

  expect(middle.heroOpacity).toBeLessThan(initial.heroOpacity);
  expect(middle.heroOpacity).toBeGreaterThan(0.5);
  expect(middle.heroOpacity).toBeLessThan(0.8);
  expect(Math.abs(middle.heroTop)).toBeLessThan(1);
  expect(middle.introTop).toBeLessThan(initial.introTop);
  expect(Number(middle.heroBackgroundOpacity)).toBeGreaterThan(0.8);
  expect(middle.heroFilter).toBe('none');
  expect(middle.introBackgroundImage).toBe('none');
  expect(middle.introBackgroundColor).toBe('rgba(0, 0, 0, 0)');

  await page.evaluate(() => window.scrollTo({ top: window.innerHeight * 0.45, behavior: 'instant' }));
  await page.waitForFunction(() => Number(document.querySelector('#hero .hero-s').style.opacity) <= 0.01);

  const earlyExit = await page.evaluate(() => ({
    heroOpacity: Number(document.querySelector('#hero .hero-s').style.opacity)
  }));
  expect(earlyExit.heroOpacity).toBe(0);

  await page.evaluate(() => window.scrollTo({ top: window.innerHeight, behavior: 'instant' }));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#hero .hero-w_bg')).opacity === '0');

  const final = await page.evaluate(() => ({
    heroOpacity: Number(document.querySelector('#hero .hero-s').style.opacity),
    heroBackgroundOpacity: getComputedStyle(document.querySelector('#hero .hero-w_bg')).opacity,
    introTop: document.querySelector('#introduction').getBoundingClientRect().top
  }));

  expect(final.heroOpacity).toBe(0);
  expect(Number(final.heroBackgroundOpacity)).toBeCloseTo(0, 2);
  expect(Math.abs(final.introTop)).toBeLessThan(4);
});

test('grand prize rises into view after the competition introduction without blur', async ({ page }) => {
  await blockExternalRequests(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const initial = await page.evaluate(() => {
    const prize = document.querySelector('#prizes');
    const transform = new DOMMatrixReadOnly(getComputedStyle(prize).transform);
    return {
      documentTop: prize.offsetTop,
      translateY: transform.m42,
      scale: transform.m22,
      filter: getComputedStyle(prize).filter
    };
  });

  expect(initial.translateY).toBeCloseTo(306, 0);
  expect(initial.scale).toBeCloseTo(0.94, 2);
  expect(initial.filter).toBe('none');

  await page.evaluate((top) => window.scrollTo({ top: top - window.innerHeight / 2, behavior: 'instant' }), initial.documentTop);
  await page.waitForFunction(() => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#prizes')).transform);
    return transform.m42 > 100 && transform.m42 < 200;
  });

  const middle = await page.evaluate(() => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#prizes')).transform);
    return { translateY: transform.m42, scale: transform.m22 };
  });
  expect(middle.translateY).toBeCloseTo(153, 0);
  expect(middle.scale).toBeCloseTo(0.97, 2);

  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), initial.documentTop);
  await page.waitForFunction(() => {
    const transform = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('#prizes')).transform);
    return Math.abs(transform.m42) < 1 && transform.m22 > 0.99;
  });
});

test('sections stay visible in document flow if the transition script fails to load', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') {
      await route.abort('blockedbyclient');
      return;
    }
    if (url.pathname.endsWith('/scripts/features/section-transitions.js')) {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await expect(page.locator('#hero h1')).toBeVisible();
  await expect(page.locator('#introduction .arch-heading')).toContainText('Самое масштабное соревнование');
  await expect(page.locator('#prizes .lug-title')).toContainText('Главный приз');

  const state = await page.evaluate(() => ({
    ready: document.querySelector('[data-hero-intro-scene]').classList.contains('is-transition-ready'),
    sceneHeight: document.querySelector('[data-hero-intro-scene]').style.height,
    introPosition: getComputedStyle(document.querySelector('#introduction')).position,
    prizePosition: getComputedStyle(document.querySelector('#prizes')).position,
    heroOpacity: getComputedStyle(document.querySelector('#hero .hero-s')).opacity,
    introTop: document.querySelector('#introduction').getBoundingClientRect().top,
    introBottom: document.querySelector('#introduction').getBoundingClientRect().bottom,
    heroBottom: document.querySelector('#hero').getBoundingClientRect().bottom,
    prizeTop: document.querySelector('#prizes').getBoundingClientRect().top
  }));

  expect(state.ready).toBe(false);
  expect(state.sceneHeight).toBe('');
  expect(state.introPosition).not.toBe('absolute');
  expect(state.prizePosition).not.toBe('absolute');
  expect(state.heroOpacity).toBe('1');
  expect(state.introTop).toBeGreaterThanOrEqual(state.heroBottom);
  expect(state.prizeTop).toBeGreaterThanOrEqual(state.introBottom);
});

test('mobile menu works without animation libraries', async ({ page }) => {
  await blockExternalRequests(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const menu = page.locator('[data-modal-menu="mob"]');
  const trigger = page.locator('[data-modal-menu-btn="mob"]');
  await expect(menu).toBeHidden();
  await page.locator('#introduction').evaluate((intro) => {
    window.scrollTo(0, intro.getBoundingClientRect().bottom + window.scrollY + 1);
  });
  await expect(page.locator('body')).toHaveClass(/is-site-header-visible/);
  await trigger.click();
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

});

test('mobile menu traps keyboard focus and restores the page when closed', async ({ page }) => {
  await blockExternalRequests(page);
  await page.setViewportSize({ width: 280, height: 568 });
  await page.goto('/');
  await page.locator('#introduction').evaluate((intro) => {
    window.scrollTo(0, intro.getBoundingClientRect().bottom + window.scrollY + 1);
  });

  const trigger = page.locator('[data-modal-menu-btn="mob"]');
  const menu = page.locator('[data-modal-menu="mob"]');
  const links = menu.locator('a[href]');
  const close = menu.locator('#siteMobileMenuClose');
  const headerTargets = await page.locator('.header-logo, .site-profile-link, button.btn-menu[data-modal-menu-btn="mob"]').evaluateAll((targets) => targets.map((target) => {
    const rect = target.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
  }));
  expect(headerTargets.every((target) => (
    target.width >= 44 && target.height >= 44
      && target.left >= 0 && target.right <= 280
      && target.top >= 0 && target.bottom <= 568
  ))).toBe(true);

  await expect(trigger).toHaveRole('button');
  await expect(trigger).toHaveAccessibleName('Открыть меню');
  await expect(trigger.locator('a[href]')).toHaveCount(0);
  await expect(trigger.locator('.btn-menu_label.is-active .l2').first()).toHaveCSS('color', 'rgb(23, 37, 28)');

  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-modal', 'true');
  await expect(trigger).toHaveAccessibleName('Закрыть меню');
  await expect(close).toHaveAccessibleName('Закрыть меню');
  await expect(close).toBeFocused();
  await expect(page.locator('.header-logo')).toHaveCSS('filter', 'brightness(0) invert(1)');
  await expect.poll(() => page.locator('.hero-intro-scene').evaluate((element) => element.inert)).toBe(true);

  await page.keyboard.press('Shift+Tab');
  await expect(links.last()).toBeFocused();
  await expect(links.last()).toBeInViewport();
  await expect.poll(() => menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await close.click();
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toHaveAccessibleName('Открыть меню');
  await expect.poll(() => page.locator('.hero-intro-scene').evaluate((element) => element.inert)).toBe(false);
  expect(await page.locator('body').evaluate((element) => element.style.overflow)).toBe('');
});

test('profile entry opens the themed registration flow without an email verification step', async ({ page }) => {
  const consoleMessages = [];
  page.on('console', (message) => consoleMessages.push(message.text()));
  await blockExternalRequests(page);
  await page.goto('/');
  await page.locator('#introduction').evaluate((intro) => {
    window.scrollTo(0, intro.getBoundingClientRect().bottom + window.scrollY + 1);
  });
  await expect(page.locator('body')).toHaveClass(/is-site-header-visible/);
  await page.locator('#siteAccountLink').click();

  const dialog = page.locator('dialog.site-auth-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('form')).toHaveCount(5);
  await expect(dialog.locator('form form')).toHaveCount(0);
  await expect(dialog.locator('form[aria-label]')).toHaveCount(5);
  await page.locator('#siteAuthChoice [data-auth-mode="register"]').click();
  await expect(page.locator('#siteAuthRegister')).toBeVisible();
  await expect(page.locator('#siteAuthVerify')).toHaveCount(0);
  await expect(page.locator('#siteCapPasswordRules')).toContainText('Минимум 8 символов');
  await page.locator('#siteCapPassword').fill('пароль123');
  await expect(page.locator('#siteCapPasswordRules [data-password-rule="length"]')).toHaveClass(/is-valid/);

  const primary = await dialog.evaluate((element) => getComputedStyle(element).getPropertyValue('--primary').trim());
  expect(primary.toLowerCase()).toBe('#347a4a');
  await expect(dialog.locator('.site-auth-dialog__switch button.is-active')).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(dialog.locator('.site-auth-dialog__switch button.is-active')).toHaveCSS('background-color', 'rgb(52, 122, 74)');
  expect(consoleMessages.filter((message) => message.includes('Multiple forms should be contained'))).toEqual([]);
  const actionContrasts = await dialog.evaluate((element) => {
    const luminance = (color) => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map((channel) => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    return [
      '.site-auth-dialog__switch button.is-active',
      '.site-auth-dialog__upload-choose',
      '.site-auth-dialog__submit',
    ].map((selector) => {
      const style = getComputedStyle(element.querySelector(selector));
      const colors = [luminance(style.color), luminance(style.backgroundColor)].sort((a, b) => b - a);
      return {
        selector,
        foreground: style.color,
        background: style.backgroundColor,
        ratio: (colors[0] + 0.05) / (colors[1] + 0.05)
      };
    });
  });
  expect(
    actionContrasts.every(({ ratio }) => ratio >= 4.5),
    `registration action contrast ratios: ${JSON.stringify(actionContrasts)}`
  ).toBe(true);
});

test('fixed header controls do not cover section labels reached from navigation', async ({ page }) => {
  await blockExternalRequests(page);

  for (const viewport of [
    { width: 280, height: 720 },
    { width: 390, height: 844 },
    { width: 768, height: 900 },
    { width: 1280, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.locator('#introduction').evaluate((intro) => {
      window.scrollTo({ top: intro.getBoundingClientRect().bottom + window.scrollY + 2, behavior: 'instant' });
    });
    await expect(page.locator('body')).toHaveClass(/is-site-header-visible/);

    const mobile = viewport.width <= 991;
    const headerSelector = mobile ? '.btn-menu' : '.site-tabs-nav';
    for (const id of ['tracks', 'stages', 'portfolio', 'history', 'prizes', 'cta']) {
      if (mobile) {
        await page.locator('[data-modal-menu-btn="mob"]').click();
        await page.locator(`#siteMobileMenu nav a[href="#${id}"]`).click();
      } else {
        await page.locator(`.site-tabs-nav a[href="#${id}"]`).click();
      }

      await expect(page).toHaveURL(new RegExp(`#${id}$`));

      const layout = await page.locator(`#${id}`).evaluate((section, navSelector) => {
        const label = section.querySelector('.lug-subtitle') || section.querySelector('.lug-title');
        const range = document.createRange();
        range.selectNodeContents(label);
        const text = range.getBoundingClientRect();
        const fixed = [navSelector, '#siteAccountLink']
          .map((selector) => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            if (style.visibility === 'hidden' || style.display === 'none') return null;
            return { selector, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
          })
          .filter(Boolean);
        return {
          label: label.textContent.trim(),
          headerVisible: document.body.classList.contains('is-site-header-visible'),
          labelRect: { left: text.left, top: text.top, right: text.right, bottom: text.bottom },
          overlaps: fixed
            .filter((rect) => rect.left < text.right && rect.right > text.left && rect.top < text.bottom && rect.bottom > text.top)
            .map((rect) => rect.selector)
        };
      }, headerSelector);

      expect(layout.overlaps, `${layout.label} overlaps ${layout.overlaps.join(', ')} at ${viewport.width}px`).toEqual([]);
      expect(layout.headerVisible, `header disappeared at ${viewport.width}px after navigating to #${id}`).toBe(true);
    }
  }
});

test('history album turns in both directions, responds to arrow keys, and wraps at the beginning', async ({ page }) => {
  const remotePhoto = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2sAAAAASUVORK5CYII=', 'base64');
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') {
      await route.continue();
      return;
    }
    if (url.hostname.endsWith('vkuserphoto.ru')) {
      await route.fulfill({ status: 200, contentType: 'image/png', body: remotePhoto });
      return;
    }
    await route.abort('blockedbyclient');
  });
  await page.goto('/');

  const stage = page.locator('[data-history-stage]');
  const left = page.locator('[data-history-left]');
  const right = page.locator('[data-history-right]');
  const photoCount = await page.locator('[data-history-photos]').evaluate((template) => template.content.querySelectorAll('img').length);
  await page.locator('[data-history-next]').click();
  await expect(right).toHaveAttribute('data-photo-index', '2');
  await expect(stage).toHaveAttribute('aria-busy', 'false');

  await page.locator('[data-history-prev]').click();
  await expect(left).toHaveAttribute('data-photo-index', '0');
  await expect(right).toHaveAttribute('data-photo-index', '1');
  await expect(stage).toHaveAttribute('aria-busy', 'false');

  await stage.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(left).toHaveAttribute('data-photo-index', String(photoCount - 1));
  await expect(right).toHaveAttribute('data-photo-index', '0');
  await expect(stage).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => left.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
});

test('stages and the portfolio carousel fit mobile, tablet, and desktop widths', async ({ page }) => {
  await blockExternalRequests(page);
  await page.goto('/');
  await page.addStyleTag({ content: '.portfolio-carousel__card, .portfolio-carousel__card > * { transition: none !important; }' });

  for (const viewport of [
    { width: 280, height: 720, columns: 1 },
    { width: 300, height: 720, columns: 1 },
    { width: 320, height: 740, columns: 1 },
    { width: 390, height: 844, columns: 1 },
    { width: 768, height: 1024, columns: 2 },
    { width: 1024, height: 768, columns: 2 },
    { width: 1440, height: 900, columns: 4 }
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => {
      const carousel = document.querySelector('.portfolio-carousel');
      return carousel?.classList.contains('is-enhanced')
        && [...carousel.querySelectorAll('[data-portfolio-card]')].every((card) => card.dataset.position);
    });

    const sections = await page.evaluate(() => ['#stages', '#portfolio'].map((selector) => {
      const grid = document.querySelector(selector === '#stages' ? '.stage-cards' : '.portfolio-carousel__track');
      const gridRect = grid.getBoundingClientRect();
      const cards = [...grid.querySelectorAll(selector === '#stages' ? '.stage-card' : '.portfolio-carousel__card')];
      const visibleCards = cards.filter((card) => {
        const style = getComputedStyle(card);
        return style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0;
      });

      return {
        selector,
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        visibleCards: visibleCards.length,
        activeCards: cards.filter((card) => card.dataset.position === 'active').length,
        controlsVisible: selector !== '#portfolio' || getComputedStyle(document.querySelector('.portfolio-carousel__controls')).display !== 'none',
        cards: cards.map((card) => {
          const rect = card.getBoundingClientRect();
          const style = getComputedStyle(card);
          return {
            position: card.dataset.position || '',
            visible: style.display !== 'none' && style.visibility === 'visible' && Number(style.opacity) > 0,
            insideViewport: rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1,
            insideGrid: selector !== '#stages' || (rect.left >= gridRect.left - 1 && rect.right <= gridRect.right + 1),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            hasSize: rect.width > 0 && rect.height > 0
          };
        })
      };
    }));
    const carouselTargets = await page.locator('.portfolio-carousel__arrow, .portfolio-carousel__dot').evaluateAll((controls) => controls.map((control) => {
      const rect = control.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
    }));
    expect(carouselTargets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
    expect(
      carouselTargets.every((target) => target.left >= 0 && target.right <= viewport.width),
      `portfolio controls stay inside the viewport at ${viewport.width}px`
    ).toBe(true);

    if (viewport.width <= 360) {
      const headingBounds = await page.evaluate(() => {
        const selectors = [
          '#introduction .arch-heading-label',
          '#tracks .lug-title',
          '#stages .lug-title',
          '#prizes .lug-title',
          '#prizes .prize-single-award-amount--message',
          '#portfolio .lug-title',
          '#history .lug-title',
          '#cta .site-registration__title'
        ];
        return selectors.map((selector) => {
          const element = document.querySelector(selector);
          const range = document.createRange();
          range.selectNodeContents(element);
          const rect = range.getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right };
        });
      });
      expect(
        headingBounds.filter(({ left, right }) => left < 0 || right > viewport.width),
        `section headings stay inside the viewport at ${viewport.width}px`
      ).toEqual([]);
    }

    for (const section of sections) {
      expect(section.pageWidth, `horizontal overflow at ${viewport.width}px`).toBe(section.viewportWidth);
      if (section.selector === '#stages') {
        expect(section.columns, `${section.selector} at ${viewport.width}px`).toBe(viewport.columns);
        expect(section.cards).toHaveLength(4);
        expect(section.cards.every((card) => card.visible && card.insideGrid && card.hasSize)).toBe(true);
      } else {
        expect(section.columns, `${section.selector} carousel layout`).toBe(1);
        expect(section.cards).toHaveLength(4);
        expect(section.activeCards).toBe(1);
        expect(section.visibleCards).toBe(viewport.width <= 700 ? 1 : 3);
        expect(section.controlsVisible).toBe(true);
        expect(
          section.cards.filter((card) => card.visible && (!card.insideViewport || !card.hasSize)),
          `${section.selector} has a clipped card at ${viewport.width}px`
        ).toEqual([]);
      }
    }
  }
});

test('reduced motion leaves the hero and decorative outline visible', async ({ page }) => {
  await blockExternalRequests(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await expect(page.locator('#hero h1')).toBeVisible();
  await expect(page.locator('#hero h2')).toContainText('2026');
  await expect(page.locator('.arch-heading-outline path')).toBeVisible();

  const transitionState = await page.evaluate(() => ({
    ready: document.querySelector('[data-hero-intro-scene]').classList.contains('is-transition-ready'),
    introPosition: getComputedStyle(document.querySelector('#introduction')).position,
    heroOpacity: getComputedStyle(document.querySelector('#hero .hero-s')).opacity
  }));

  expect(transitionState.ready).toBe(false);
  expect(transitionState.introPosition).not.toBe('absolute');
  expect(transitionState.heroOpacity).toBe('1');

  const runningAnimations = await page.evaluate(() => document.getAnimations()
    .filter((animation) => animation.playState === 'running').length);
  expect(runningAnimations).toBe(0);
});
