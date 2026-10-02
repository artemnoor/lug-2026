import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pageSections = ['hero', 'introduction', 'prizes', 'tracks', 'stages', 'portfolio', 'history', 'cta'];
const sourceParts = [
  'src/components/page-shell.html',
  'src/components/site-header.html',
  'src/sections/hero.html',
  'src/sections/introduction.html',
  'src/sections/prizes.html',
  ...[...pageSections.slice(2, -1), 'registration'].map((section) => 'src/sections/' + section + '.html'),
  'src/sections/footer.html'
];

test('build expands separate source parts and preserves section order and content', async ({ page }) => {
  const builtHtml = await readFile(path.join(projectRoot, 'dist/index.html'), 'utf8');
  expect(builtHtml).not.toMatch(/<!--\s*@include\s+/);

  for (const sourcePart of sourceParts) {
    await access(path.join(projectRoot, sourcePart));
  }

  await page.route('**/*', async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin !== 'http://127.0.0.1:4173') {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const renderedSections = await page.evaluate((sectionIds) => {
    const selector = sectionIds.map((id) => '#' + id).join(',');
    return [...document.querySelectorAll(selector)].map((element) => {
      const id = element.id;
      return {
        id,
        text: (element?.textContent || '').trim(),
        inMain: Boolean(element?.closest('.site-main'))
      };
    });
  }, pageSections);

  expect(renderedSections.map((section) => section.id)).toEqual(pageSections);
  for (const section of renderedSections) {
    expect(section.text, 'section #' + section.id + ' should contain source content').not.toBe('');
  }
  expect(renderedSections[0].text).toContain('Лучшая');
  expect(renderedSections[0].text).toContain('2026');
  expect(renderedSections[1].text).toContain('Самое масштабное соревнование');
  expect(renderedSections[2].text).toContain('Главный приз');
  expect(renderedSections[0].inMain).toBe(true);
  expect(renderedSections.slice(1).every((section) => !section.inMain)).toBe(true);
});
