import { expect, test } from '@playwright/test';

test('hard refresh on touch landscape never shows a blocking template overlay', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://127.0.0.1:4173') {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });

  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });

  await expect(page.locator('#hero h1')).toBeVisible();
  await expect(page.locator('#hero h2')).toContainText('2026');
  await expect(page.locator('#portfolio .lug-lead')).toContainText('4 ключевых направления');
  await expect(page.locator('#portfolio [data-portfolio-item]')).toHaveCount(4);

  const state = await page.evaluate(() => ({
    landscape: matchMedia('(orientation: landscape) and (max-width: 991px) and (pointer: coarse) and (hover: none)').matches,
    overlays: [...document.querySelectorAll('.w-dyn-list, .landscape-cover, [data-preloader], [data-master-preloader], [data-cookies], .cookies_card')]
      .filter((element) => getComputedStyle(element).display !== 'none')
      .map((element) => element.className || element.tagName),
    bodyOverflowY: getComputedStyle(document.body).overflowY,
    appScripts: [...document.scripts].map((script) => script.src).filter((src) => src.includes('/scripts/app.js'))
  }));

  expect(state.landscape).toBe(true);
  expect(state.overlays).toEqual([]);
  expect(state.bodyOverflowY).not.toBe('hidden');
  expect(state.appScripts).toEqual([]);

  for (const viewport of [
    { width: 280, height: 320 },
    { width: 568, height: 320 },
    { width: 667, height: 375 },
    { width: 812, height: 375 },
    { width: 1024, height: 480 },
    { width: 1280, height: 480 }
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(800);
    const heroLayout = await page.evaluate(() => {
      const selectors = ['#hero h1', '#hero h2', '#hero .hero-dates_text'];
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
        elements: selectors.map((selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        })
      };
    });

    expect(heroLayout.pageWidth, `page width at ${viewport.width}×${viewport.height}`).toBe(heroLayout.viewportWidth);
    expect(
      heroLayout.elements.filter(({ left, right, top, bottom }) => (
        left < -1 || right > viewport.width + 1 || top < -1 || bottom > viewport.height + 1
      )),
      `hero text stays inside ${viewport.width}×${viewport.height}`
    ).toEqual([]);
  }

  await context.close();
});
