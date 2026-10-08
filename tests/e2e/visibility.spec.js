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
  await expect(page.locator('#portfolio [data-portfolio-item]')).toHaveCount(4);
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

test('desktop hero title, year, and dates stay clear of the menu and inside the first screen', async ({ page }) => {
  await blockExternalRequests(page);
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1440, height: 768 },
    { width: 1440, height: 1000 },
    { width: 1920, height: 1080 }
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const { top, bottom, left, right } = document.querySelector(selector).getBoundingClientRect();
        return { top, bottom, left, right };
      };
      return {
        viewportWidth: document.documentElement.clientWidth,
        title: rect('#hero h1'),
        year: rect('#hero h2'),
        dates: rect('#hero .hero-dates_text')
      };
    });

    expect(layout.viewportWidth, `no horizontal overflow at ${viewport.width}×${viewport.height}`).toBe(viewport.width);
    expect(layout.title.top, `title clears the menu at ${viewport.width}×${viewport.height}`).toBeGreaterThanOrEqual(90);
    for (const [name, box] of Object.entries({ title: layout.title, year: layout.year, dates: layout.dates })) {
      expect(box.top, `${name} starts within ${viewport.width}×${viewport.height}`).toBeGreaterThanOrEqual(0);
      expect(box.bottom, `${name} ends within ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(viewport.height);
      expect(box.left, `${name} stays on screen at ${viewport.width}×${viewport.height}`).toBeGreaterThanOrEqual(0);
      expect(box.right, `${name} stays on screen at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(viewport.width);
    }
  }
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

test('mobile header keeps the profile but does not show a navigation menu', async ({ page }) => {
  await blockExternalRequests(page);
  for (const viewport of [
    { width: 280, height: 568 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const profile = page.locator('#siteAccountLink');
    const trigger = page.locator('[data-modal-menu-btn="mob"]');
    const menu = page.locator('[data-modal-menu="mob"]');

    await expect(profile).toBeVisible();
    await expect(trigger).toBeHidden();
    await expect(menu).toBeHidden();
    const bounds = await profile.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);

    await page.locator('#introduction').evaluate((intro) => {
      window.scrollTo(0, intro.getBoundingClientRect().bottom + window.scrollY + 1);
    });
    await expect(page.locator('body')).toHaveClass(/is-site-header-visible/);
    await expect(trigger).toBeHidden();
    await expect(menu).toBeHidden();
    await expect(profile).toBeVisible();
  }
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

  await page.locator('#siteCapGroup').fill('ИУ7-41Б');
  await page.locator('#siteCapGroupSize').fill('25');
  await page.locator('#siteCapTeamName').fill('Команда ИУ7');
  await page.locator('#siteAuthRegisterNext').click();
  await page.locator('#siteCapSurname').fill('Иванов');
  await page.locator('#siteCapName').fill('Иван');
  await page.locator('#siteCapPatronymic').fill('Иванович');
  await page.locator('#siteCapEmail').fill('ivanov@example.test');
  await page.locator('[data-messenger="telegram"][data-messenger-owner="captain"]').click();
  await page.locator('[data-messenger-contact="captain-telegram"]').fill('@ivanov_test');
  await page.locator('#siteAuthRegisterNext').click();

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
    const headerSelector = mobile ? '.btn-menu[data-modal-menu-btn="mob"]' : '.site-tabs-nav';
    if (mobile) {
      await expect(page.locator(headerSelector)).toBeHidden();
      await expect(page.locator('[data-modal-menu="mob"]')).toBeHidden();
    }
    for (const id of ['tracks', 'stages', 'portfolio', 'history', 'prizes', 'cta']) {
      if (mobile) {
        await page.locator(`#${id}`).evaluate((section) => {
          window.location.hash = section.id;
          section.scrollIntoView({ block: 'start', behavior: 'instant' });
        });
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

test('history album shows one photo at a time, responds to arrow keys, and wraps at the beginning', async ({ page }) => {
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
  const image = page.locator('[data-history-image]');
  const counter = page.locator('[data-history-counter]');
  const photoCount = await page.locator('[data-history-photos]').evaluate((template) => template.content.querySelectorAll('img').length);
  const lastPhoto = await page.locator('[data-history-photos]').evaluate((template) => template.content.querySelector('img:last-child').src);

  await expect(stage.locator('img')).toHaveCount(1);
  await expect(counter).toHaveText(`1 / ${photoCount}`);
  await expect(image).toHaveAttribute('alt', `Фотография из альбома конкурса, кадр 1 из ${photoCount}`);

  await page.locator('[data-history-next]').click();
  await expect(image).toHaveAttribute('src', /lug-2025-002\.jpg$/);
  await expect(counter).toHaveText(`2 / ${photoCount}`);
  await expect(image).toHaveAttribute('alt', `Фотография из альбома конкурса, кадр 2 из ${photoCount}`);
  await expect(stage).toHaveAttribute('aria-busy', 'false');

  await page.locator('[data-history-prev]').click();
  await expect(image).toHaveAttribute('src', /lug-2025-001\.jpg$/);
  await expect(counter).toHaveText(`1 / ${photoCount}`);
  await expect(stage).toHaveAttribute('aria-busy', 'false');

  await stage.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(image).toHaveAttribute('src', lastPhoto);
  await expect(counter).toHaveText(`${photoCount} / ${photoCount}`);
  await expect(stage).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => image.evaluate((photo) => photo.naturalWidth)).toBeGreaterThan(0);
});

test('reviewed copy, date range, partner order, and mobile hero year are current', async ({ page }) => {
  await blockExternalRequests(page);
  await page.goto('/');

  await expect(page.locator('#hero .hero-dates_text')).toHaveText('12 октября — 16 декабря');
  await expect(page.locator('#cta .site-registration__deadline')).toHaveText('Приём заявок продлится до 16 декабря 2026 года');
  await expect(page.locator('#prizes .prize-single-award-copy')).toContainText('Поездка для всей группы');
  await expect(page.locator('#stages .stage-card:nth-child(3) .stage-card__tag')).toHaveText('Очно в университете');
  await expect(page.locator('#stages .stage-card:nth-child(4) .stage-card__title')).toContainText(/Награждение\s*по итогам конкурса/);
  await expect(page.locator('#stages .stage-card:nth-child(4)')).not.toContainText('битва');
  await expect(page.locator('#tracks .arch-rect-black_l .arch-track-list')).toContainText('не менее 60%');
  await expect(page.locator('#tracks .arch-rect-black_l .arch-track-list')).toContainText('истории Университета');
  await expect(page.locator('#tracks .arch-rect-black_r .arch-track-list')).not.toContainText('кейс');
  await expect(page.locator('#portfolio #portfolio-panel-community')).toContainText('Профкома студентов МГТУ');
  await page.locator('#introduction .arch-logo-row img').first().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator('#introduction .arch-logo-row img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0))).toBe(true);
  const partnerLogosLoaded = await page.locator('#introduction .arch-logo-row img').evaluateAll((images) => images.every((image) => image.complete && image.naturalWidth > 0));
  expect(partnerLogosLoaded).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('.site-footer__social-link[aria-label*="Telegram"]')).toHaveAttribute('href', 'https://t.me/studsovet_bmstu');

  const partnerOrder = await page.locator('#introduction .arch-logo-row img').evaluateAll((images) => images.map((image) => new URL(image.src).pathname.split('/').pop()));
  expect(partnerOrder).toEqual(['bmstu_emblem_white.png', 'logo-youth-policy.png', 'studsovet_white.png', 'lug_white.svg']);
  await expect(page.locator('.site-footer__social-caption')).toHaveText('Молодёжная политика МГТУ им. Н. Э. Баумана');
  await expect(page.locator('.site-footer__social-link')).toHaveCount(2);

  for (const viewport of [
    { width: 280, height: 568 },
    { width: 320, height: 640 },
    { width: 390, height: 844 }
  ]) {
    await page.setViewportSize(viewport);
    const hero = await page.evaluate(() => {
      const year = document.querySelector('#hero .hero-title-year').getBoundingClientRect();
      const date = document.querySelector('#hero .hero-dates_text').getBoundingClientRect();
      const heroRect = document.querySelector('#hero .hero-scroll-area').getBoundingClientRect();
      return {
        width: document.documentElement.clientWidth,
        lines: document.querySelectorAll('#hero .hero-motion-line').length,
        year: { left: year.left, right: year.right, top: year.top, bottom: year.bottom },
        date: { top: date.top, bottom: date.bottom },
        heroHeight: heroRect.height
      };
    });
    expect(hero.width).toBe(viewport.width);
    expect(hero.lines).toBe(0);
    expect(hero.year.left).toBeGreaterThanOrEqual(0);
    expect(hero.year.right).toBeLessThanOrEqual(viewport.width);
    expect(hero.year.top).toBeGreaterThanOrEqual(0);
    expect(hero.date.bottom).toBeLessThanOrEqual(viewport.height);
    expect(hero.year.bottom).toBeLessThanOrEqual(hero.heroHeight);
  }
});

test('stages and the portfolio accordion fit mobile, tablet, and desktop widths', async ({ page }) => {
  await blockExternalRequests(page);
  await page.goto('/');
  await page.addStyleTag({ content: '.portfolio-tab, .portfolio-tab > * { transition: none !important; }' });

  for (const viewport of [
    { width: 280, height: 720 },
    { width: 300, height: 720 },
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const grid = document.querySelector('.stage-cards');
      const cards = [...grid.querySelectorAll('.stage-card')];
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        stageColumns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        stages: cards.map((card) => {
          const rect = card.getBoundingClientRect();
          const style = getComputedStyle(card);
          return { visible: style.display !== 'none' && style.visibility === 'visible', inside: rect.left >= grid.getBoundingClientRect().left - 1 && rect.right <= grid.getBoundingClientRect().right + 1, sized: rect.width > 0 && rect.height > 0 };
        }),
        portfolioItems: [...document.querySelectorAll('#portfolio [data-portfolio-item]')].map((item) => {
          const rect = item.getBoundingClientRect();
          const trigger = item.querySelector('[data-portfolio-card]');
          const title = trigger.getBoundingClientRect();
          const style = getComputedStyle(item);
          return { active: item.classList.contains('is-active'), visible: style.display !== 'none' && style.visibility === 'visible', inside: rect.left >= -1 && rect.right <= document.documentElement.clientWidth + 1, sized: rect.width > 0 && rect.height > 0, triggerInside: title.left >= rect.left && title.right <= rect.right + 1, triggerSize: { width: title.width, height: title.height } };
        })
      };
    });

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

    expect(layout.pageWidth, `horizontal overflow at ${viewport.width}px`).toBe(layout.viewportWidth);
    expect(layout.stageColumns).toBe(viewport.width >= 1200 ? 4 : viewport.width >= 700 ? 2 : 1);
    expect(layout.stages).toHaveLength(4);
    expect(layout.stages.every((card) => card.visible && card.inside && card.sized)).toBe(true);
    expect(layout.portfolioItems).toHaveLength(4);
    expect(layout.portfolioItems.filter((item) => item.active)).toHaveLength(1);
    expect(layout.portfolioItems.every((item) => item.visible && item.inside && item.sized && item.triggerInside)).toBe(true);
    expect(layout.portfolioItems.every(({ triggerSize }) => triggerSize.width >= 44 && triggerSize.height >= 44)).toBe(true);

    for (const direction of ['community', 'sport', 'creativity', 'science']) {
      const button = page.locator(`#portfolio-tab-${direction}`);
      await button.click();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator(`#portfolio-panel-${direction}`)).toBeVisible();
      await expect(page.locator(`#portfolio-panel-${direction}`)).toHaveAttribute('aria-hidden', 'false');
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
