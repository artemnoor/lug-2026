import { expect, test } from '@playwright/test';

const settings = {
  registrationStart: '2026-01-01T00:00:00Z',
  registrationDeadline: '2030-12-31T23:59:59Z',
  isRegistrationOpen: true,
  portfolioStart: '2026-01-01T00:00:00Z',
  portfolioDeadline: '2030-12-31T23:59:59Z',
  videoStart: '2026-01-01T00:00:00Z',
  videoDeadline: '2030-12-31T23:59:59Z',
  resultsStart: '2030-01-01T00:00:00Z',
  resultsDeadline: '2030-12-31T23:59:59Z',
  minTeamPercentage: 60,
  minMembersPercentage: 60
};

const member = {
  id: 'user-1',
  fio: 'Иванов Иван Иванович',
  email: 'ivanov@example.test',
  phone: '+7 900 000-00-00',
  role: 'captain',
  teamId: 'team-1',
  group: 'ИУ7-41Б',
  messenger: 'telegram',
  messengerContact: '@ivanov_test',
  messengerContacts: { telegram: '@ivanov_test' },
  identityStatus: 'pending',
  studentCardFile: '/uploads/student-card.pdf'
};

const achievement = {
  id: 'achievement-1',
  userId: member.id,
  title: 'Победа в олимпиаде',
  direction: 'science',
  category: 'Олимпиады',
  details: 'Первое место на вузовской олимпиаде',
  fileUrl: '/uploads/achievement.pdf',
  fileName: 'achievement.pdf',
  status: 'pending',
  points: null,
  createdAt: '2026-09-20T12:00:00Z',
  user: member
};

const team = {
  id: 'team-1',
  group: member.group,
  name: 'Команда ИУ7',
  description: 'Команда для тестирования личного кабинета.',
  captainId: member.id,
  inviteCode: 'TEST42',
  inviteStatus: 'active',
  inviteExpiresAt: '2030-12-31T23:59:59Z',
  memberLimit: 25,
  quota: { members: 1, required: 15, total: 25, percentage: 60, eligible: false },
  members: [member],
  achievements: [achievement],
  videoCard: { url: 'https://youtu.be/dQw4w9WgXcQ', status: 'pending', criteriaScores: {} }
};

const dashboard = {
  user: member,
  team,
  members: [member],
  achievements: [achievement],
  notifications: [{
    id: 'notification-1',
    title: 'Проверка началась',
    message: 'Оргкомитет проверяет документы команды.',
    createdAt: '2026-09-20T12:00:00Z',
    read: false
  }],
  settings
};

const adminOverview = {
  settings,
  summary: {
    teams: 1,
    users: 1,
    achievements: 1,
    notifications: 1,
    pendingAchievements: 1,
    pendingIdentity: 1,
    pendingVideos: 1,
    unreadNotifications: 1
  },
  teams: [team],
  users: [member],
  achievements: [achievement],
  videos: [{ teamId: team.id, teamName: team.name, group: team.group, videoCard: team.videoCard }],
  notifications: [],
  adminNotifications: [],
  auditLog: []
};

async function mockAccountApi(page, role = 'captain', overrides = {}) {
  const user = role === 'admin'
    ? { id: 'admin-1', fio: 'Оргкомитет ЛУГ', email: 'admin@example.test', role: 'admin' }
    : member;

  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (overrides[pathname]) return overrides[pathname](route);
    if (pathname === '/api/session') return route.fulfill({ json: { user } });
    if (pathname === '/api/dashboard') return route.fulfill({ json: dashboard });
    if (pathname === '/api/admin/overview') return route.fulfill({ json: adminOverview });
    if (pathname.startsWith('/api/admin/collections/')) return route.fulfill({ json: { items: [], total: 0 } });
    if (pathname === '/api/admin/audit') return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: {} });
  });
}

test('participant cabinet renders its populated views without browser errors across viewport sizes', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mockAccountApi(page);
  await page.goto('/account/cabinet.html');
  await expect(page.locator('#dashboard-title')).toHaveText('Привет, Иван');
  await expect(page.locator('#profileCardName')).toContainText('Иванов Иван Иванович');
  const identityFontSize = await page.locator('#profileCardName').evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(identityFontSize).toBeLessThanOrEqual(30);

  for (const width of [280, 320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      activePanel: document.querySelector('[data-view-panel]:not([hidden])')?.dataset.viewPanel,
      heading: (() => {
        const element = document.querySelector('#dashboard-title');
        const style = getComputedStyle(element);
        return {
          fontSize: Number.parseFloat(style.fontSize),
          lineHeight: Number.parseFloat(style.lineHeight)
        };
      })()
    }));
    expect(layout.page, `horizontal overflow at ${width}px`).toBe(layout.viewport);
    expect(layout.activePanel).toBe('overview');
    if (width <= 620) {
      expect(layout.heading.lineHeight, `overlapping greeting lines at ${width}px`)
        .toBeGreaterThanOrEqual(layout.heading.fontSize * 0.99);
    }
  }

  for (const view of ['portfolio', 'team', 'video', 'profile', 'notifications']) {
    const toggle = page.locator('#cabinetMobileNavToggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#cabinetMobileNavPanel')).toBeVisible();
    await page.locator(`[data-view="${view}"]`).click();
    await expect(page.locator(`[data-view-panel="${view}"]`)).toBeVisible();
    await expect(page.locator('#cabinetMobileNavPanel')).toBeHidden();
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth, `horizontal overflow in ${view} at ${width}px`).toBe(width);
  }

  expect(pageErrors).toEqual([]);
});

test('cabinet navigation opens on every device, changes view, and closes accessibly', async ({ page }) => {
  await mockAccountApi(page);
  await page.goto('/account/cabinet.html');

  const toggle = page.locator('#cabinetMobileNavToggle');
  const panel = page.locator('#cabinetMobileNavPanel');
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await expect(panel).toBeHidden();
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await page.locator('#cabinetMobileNavClose').click();
    await expect(panel).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const touchTargets = await page.evaluate(() => ['#cabinetMobileNavToggle', '#notificationsBellBtn'].map((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(touchTargets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
  await toggle.click();
  await expect(panel).toBeVisible();
  await page.locator('#profile-tab').click();
  await expect(page.locator('#profile-panel')).toBeVisible();
  await expect(panel).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('portfolio directions, material details, and achievement dialog stay in sync', async ({ page }) => {
  await mockAccountApi(page);
  await page.goto('/account/cabinet.html');
  await page.locator('#cabinetMobileNavToggle').click();
  await page.locator('#portfolio-tab').click();

  await expect(page.locator('#portfolioSummary')).toHaveAttribute('data-direction', 'science');
  const material = page.locator('[data-material-id="achievement-1"]');
  await expect(material).toHaveAttribute('aria-expanded', 'false');
  await material.click();
  await expect(material).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#portfolioSummary a[href="/uploads/achievement.pdf"]')).toBeVisible();
  await material.click();
  await expect(material).toHaveAttribute('aria-expanded', 'false');

  await page.locator('.cabinet-direction-tabs [data-direction="sport"]').click();
  await expect(page.locator('#portfolioSummary')).toHaveAttribute('data-direction', 'sport');
  await expect(page.locator('#portfolioSummary')).toContainText('пока нет материалов');
  await page.locator('#openAchievement').click();
  await expect(page.locator('#achievementDialog')).toHaveAttribute('open', '');
  await expect(page.locator('#achievementDirection')).toHaveValue('sport');
  await page.keyboard.press('Escape');
  await expect(page.locator('#achievementDialog')).not.toHaveAttribute('open', '');
});

test('participant sees organizer feedback after identity, team, and video rejections', async ({ page }) => {
  const identityComment = 'Добавьте данные для связи.';
  const teamComment = 'Исправьте описание и повторно отправьте его на проверку.';
  const videoComment = 'Уточните монтаж и загрузите обновлённую ссылку.';
  await mockAccountApi(page, 'captain', {
    '/api/dashboard': async (route) => route.fulfill({ json: {
      ...dashboard,
      user: { ...member, identityStatus: 'rejected', identityComment },
      team: {
        ...team,
        reviewDescriptionStatus: 'rejected',
        reviewComment: teamComment,
        videoCard: { ...team.videoCard, status: 'rejected', comment: videoComment }
      }
    } })
  });
  await page.goto('/account/cabinet.html');
  await expect(page.locator('#next-description')).toContainText(identityComment);
  await page.locator('#cabinetMobileNavToggle').click();
  await page.locator('#teamNavigation').click();
  await expect(page.locator('#teamReviewNotice')).toBeVisible();
  await expect(page.locator('#teamReviewNotice')).toContainText('описание команды');
  await expect(page.locator('#teamReviewNotice')).toContainText(teamComment);
  await page.locator('#cabinetMobileNavToggle').click();
  await page.locator('#video-tab').click();
  await expect(page.locator('#videoHint')).toContainText(videoComment);
});

test('authentication dialog keeps focus, scroll position, and page lock consistent', async ({ page }) => {
  await page.goto('/');
  await page.locator('#introduction').evaluate((intro) => {
    window.scrollTo(0, intro.getBoundingClientRect().bottom + window.scrollY + 1);
  });
  await expect(page.locator('body')).toHaveClass(/is-site-header-visible/);
  const profile = page.locator('#siteAccountLink');
  await profile.click();
  const dialog = page.locator('dialog.site-auth-dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => page.locator('.site-auth-dialog__emblem img').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  const starOverlapsClose = () => page.evaluate(() => {
    const star = document.querySelector('.site-auth-dialog__star').getBoundingClientRect();
    const close = document.querySelector('.site-auth-dialog__close').getBoundingClientRect();
    return star.left < close.right && star.right > close.left && star.top < close.bottom && star.bottom > close.top;
  });
  expect(await starOverlapsClose()).toBe(false);
  await expect.poll(() => page.evaluate(() => document.querySelector('dialog.site-auth-dialog').contains(document.activeElement))).toBe(true);
  await expect.poll(
    () => page.locator('#siteAuthChoice h2').evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)),
    { timeout: 1600 }
  ).toBeGreaterThan(0.95);
  await expect(page.locator('#siteAuthChoice h2')).toHaveCSS('filter', 'none');
  const scrollPosition = await page.evaluate(() => window.scrollY);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(profile).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollPosition);
  await expect(page.locator('body')).not.toHaveClass(/is-auth-dialog-open/);
});

test('authentication dialog star stays clear of its close control on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#siteAccountLink').click();
  await expect(page.locator('dialog.site-auth-dialog')).toBeVisible();
  const overlaps = await page.evaluate(() => {
    const star = document.querySelector('.site-auth-dialog__star').getBoundingClientRect();
    const close = document.querySelector('.site-auth-dialog__close').getBoundingClientRect();
    return star.left < close.right && star.right > close.left && star.top < close.bottom && star.bottom > close.top;
  });
  expect(overlaps).toBe(false);
});

test('organizer dashboard renders all navigation views across viewport sizes', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mockAccountApi(page, 'admin');
  await page.goto('/account/admin.html');
  await expect(page.locator('#adminGreeting')).toContainText('Оргкомитет');

  for (const width of [280, 320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth
    }));
    expect(layout.page, `horizontal overflow at ${width}px`).toBe(layout.viewport);
  }

  for (const view of ['teams', 'users', 'achievements', 'broadcast', 'rating', 'deadlines']) {
    await page.locator(`[data-admin-view="${view}"]`).click();
    await expect(page.locator(`[data-admin-panel="${view}"]`)).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    const pageWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(pageWidth, `horizontal overflow in ${view} at ${width}px`).toBe(width);
  }

  expect(pageErrors).toEqual([]);
});

test('organizer cannot reject an achievement without a comment and submits the reason', async ({ page }) => {
  let reviewPayload = null;
  await mockAccountApi(page, 'admin', {
    '/api/admin/achievements/achievement-1/review': async (route) => {
      reviewPayload = route.request().postDataJSON();
      await route.fulfill({ json: { achievement: { ...achievement, status: 'rejected', reviewComment: reviewPayload.comment } } });
    }
  });
  await page.goto('/account/admin.html');
  await page.locator('[data-admin-view="achievements"]').click();
  await page.locator('[data-select-achievement="achievement-1"]').click();

  const reason = page.locator('[data-achievement-comment="achievement-1"]');
  await page.locator('[data-achievement-review-action="achievement-1"][data-achievement-review-value="rejected"]').click();
  await expect(reason).toBeVisible();
  await page.locator('[data-review-achievement="achievement-1"]').click();
  await expect(page.locator('.admin-toast--error')).toContainText('укажите причину');
  expect(reviewPayload).toBeNull();

  const comment = 'Добавьте подтверждение участия в олимпиаде.';
  await reason.fill(comment);
  await page.locator('[data-review-achievement="achievement-1"]').click();
  await expect.poll(() => reviewPayload).not.toBeNull();
  expect(reviewPayload).toMatchObject({ status: 'rejected', comment });
});

test('organizer requires comments when returning team data and participant documents', async ({ page }) => {
  const teamReviewPayloads = [];
  let identityPayload = null;
  await mockAccountApi(page, 'admin', {
    '/api/admin/teams/team-1/review': async (route) => {
      teamReviewPayloads.push(route.request().postDataJSON());
      await route.fulfill({ json: { team } });
    },
    '/api/admin/users/user-1/identity': async (route) => {
      identityPayload = route.request().postDataJSON();
      await route.fulfill({ json: { user: member } });
    }
  });
  await page.goto('/account/admin.html');
  await page.locator('[data-admin-view="teams"]').click();
  await page.locator('#adminTeamsList [data-select-team="team-1"]').click();

  await page.locator('#adminTeamDetail [data-team-review-action="name"][data-team-review-value="rejected"]').click();
  for (const field of ['group', 'flag', 'description']) {
    await page.locator(`#adminTeamDetail [data-team-review-action="${field}"][data-team-review-value="approved"]`).click();
  }
  const teamReason = page.locator('#adminTeamDetail [data-team-review-comment="name"]');
  await page.locator('#adminTeamDetail [data-team-profile-review] button[type="submit"]').click();
  await expect(page.locator('.admin-toast--error').filter({ hasText: 'Для каждого пункта' })).toContainText('укажите комментарий');
  expect(teamReviewPayloads).toHaveLength(0);

  const teamComment = 'Уточните название команды в заявке.';
  await teamReason.fill(teamComment);
  await page.locator('#adminTeamDetail [data-team-profile-review] button[type="submit"]').click();
  await expect.poll(() => teamReviewPayloads).toHaveLength(4);
  expect(teamReviewPayloads).toContainEqual({ field: 'name', status: 'rejected', comment: teamComment });

  await page.locator('#adminTeamDetail [data-member-review-action="user-1"][data-member-review-value="rejected"]').click();
  const identityReason = page.locator('#adminTeamDetail [data-identity-comment="user-1"]');
  await page.locator('#adminTeamDetail [data-team-members-review] button[type="submit"]').click();
  await expect(page.locator('.admin-toast--error').filter({ hasText: 'Для каждого участника' })).toContainText('укажите комментарий');
  expect(identityPayload).toBeNull();

  const identityComment = 'Прикрепите документ с читаемыми данными.';
  await identityReason.fill(identityComment);
  await page.locator('#adminTeamDetail [data-team-members-review] button[type="submit"]').click();
  await expect.poll(() => identityPayload).not.toBeNull();
  expect(identityPayload).toMatchObject({ status: 'rejected', comment: identityComment });
});

test('organizer cannot return a video without a comment and sends the reason', async ({ page }) => {
  let reviewPayload = null;
  await mockAccountApi(page, 'admin', {
    '/api/admin/videos/team-1/review': async (route) => {
      reviewPayload = route.request().postDataJSON();
      await route.fulfill({ json: { videoCard: { url: team.videoCard.url, status: 'rejected', comment: reviewPayload.comment } } });
    }
  });
  await page.goto('/account/admin.html');
  await page.locator('[data-admin-view="teams"]').click();
  await page.locator('#adminTeamsList [data-select-team="team-1"]').click();

  const reason = page.locator('[data-video-comment="team-1"]');
  await page.locator('[data-reject-video="team-1"]').click();
  await expect(page.locator('.admin-toast--error')).toContainText('укажите комментарий');
  expect(reviewPayload).toBeNull();

  const comment = 'Добавьте ссылку, доступную без авторизации.';
  await reason.fill(comment);
  await page.locator('[data-reject-video="team-1"]').click();
  await expect.poll(() => reviewPayload).not.toBeNull();
  expect(reviewPayload).toMatchObject({ status: 'rejected', comment });
});

test('organizer mobile sidebar controls visibility and aria state', async ({ page }) => {
  await mockAccountApi(page, 'admin');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account/admin.html');

  const toggle = page.locator('#adminSidebarToggle');
  const sidebar = page.locator('#adminSidebar');
  await expect(toggle).toBeVisible();
  const topbarTargets = await page.evaluate(() => ['#adminSidebarToggle', '#adminRefreshBtn', '#adminUserMenuBtn'].map((selector) => {
    const rect = document.querySelector(selector).getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  expect(topbarTargets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(sidebar).toHaveClass(/is-open/);
  const closeBounds = await page.locator('#adminSidebarClose').boundingBox();
  expect(closeBounds.width).toBeGreaterThanOrEqual(44);
  expect(closeBounds.height).toBeGreaterThanOrEqual(44);
  await page.locator('[data-admin-view="teams"]').click();
  await expect(page.locator('[data-admin-panel="teams"]')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
});

test('organizer account menu keeps a safe margin on a narrow phone', async ({ page }) => {
  await mockAccountApi(page, 'admin');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/account/admin.html');

  const trigger = page.locator('#adminUserMenuBtn');
  const menu = page.locator('#adminUserMenu');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(menu).toBeVisible();

  const bounds = await menu.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(12);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(308);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(568);
});

test('registration form fits phone and tablet layouts without clipped controls', async ({ page }) => {
  await page.goto('/?action=register');
  const dialog = page.locator('dialog.site-auth-dialog');
  const card = dialog.locator('.site-auth-dialog__card');
  await expect(page.locator('#siteAuthRegister')).toBeVisible();

  await page.locator('#siteCapGroup').fill('ИУ7-41Б');
  await page.locator('#siteCapGroupSize').fill('25');
  await page.locator('#siteCapTeamName').fill('Команда ИУ7');
  await page.locator('#siteAuthRegisterNext').click();
  await expect(page.locator('[data-register-step-indicator="2"]')).toHaveAttribute('aria-current', 'step');
  await page.locator('#siteCapSurname').fill('Иванов');
  await page.locator('#siteCapName').fill('Иван');
  await page.locator('#siteCapPatronymic').fill('Иванович');
  await page.locator('#siteCapEmail').fill('ivanov@example.test');
  await page.locator('[data-messenger="telegram"][data-messenger-owner="captain"]').click();
  await page.locator('[data-messenger-contact="captain-telegram"]').fill('@ivanov_test');
  await page.locator('#siteAuthRegisterNext').click();
  await expect(page.locator('[data-register-step-indicator="3"]')).toHaveAttribute('aria-current', 'step');

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.locator('#siteAuthRegister [data-upload-trigger]').first().click();
  const fileChooser = await fileChooserPromise;
  expect(fileChooser.isMultiple()).toBe(false);

  for (const width of [280, 320, 360, 390, 520, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    const layout = await card.evaluate((element) => {
      const cardRect = element.getBoundingClientRect();
      const clippedControls = [...element.querySelectorAll('input, button, select, textarea')]
        .filter((control) => control.getClientRects().length && !control.closest('[hidden]'))
        .filter((control) => {
          const rect = control.getBoundingClientRect();
          return rect.left < cardRect.left - 1 || rect.right > cardRect.right + 1;
        })
        .map((control) => control.id || control.textContent.trim());
      return {
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
        cardWidth: element.clientWidth,
        cardScrollWidth: element.scrollWidth,
        clippedControls,
      };
    });
    const authHitAreas = await card.evaluate((element) => [...element.querySelectorAll(
      '.site-auth-dialog__close, .site-auth-dialog__back, .site-auth-dialog__password-toggle, .site-auth-dialog__inline-link'
    )].filter((control) => {
      const style = getComputedStyle(control);
      return style.display !== 'none' && style.visibility === 'visible' && !control.closest('[hidden]');
    }).map((control) => {
      const rect = control.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    expect(layout.page, `horizontal page overflow at ${width}px`).toBe(layout.viewport);
    expect(layout.cardScrollWidth, `horizontal dialog overflow at ${width}px`).toBeLessThanOrEqual(layout.cardWidth + 1);
    expect(layout.clippedControls, `controls outside the dialog at ${width}px`).toEqual([]);
    expect(authHitAreas.every((target) => target.width >= 44 && target.height >= 44)).toBe(true);
  }
});

test('the register page alias opens the same registration dialog on the homepage', async ({ page }) => {
  await page.goto('/register.html');

  await expect(page).toHaveURL(/\/\?action=register$/);
  await expect(page.locator('dialog.site-auth-dialog')).toBeVisible();
  await expect(page.locator('#site-auth-register-title')).toBeVisible();
  await expect(page.locator('#hero h1')).toContainText('Лучшая');
});

test('registration starts at its heading on a short phone screen and resets after reopening', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?action=register');

  const dialog = page.locator('dialog.site-auth-dialog');
  const card = dialog.locator('.site-auth-dialog__card');
  const title = page.locator('#site-auth-register-title');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#siteAuthRegister .site-auth-dialog__back')).toBeInViewport();
  await expect(title).toBeInViewport();
  await expect.poll(() => card.evaluate((element) => element.scrollTop)).toBe(0);

  await page.locator('#siteAuthRegister [data-register-mode="participant"]').click();
  await expect(title).toBeInViewport();
  await expect.poll(() => card.evaluate((element) => element.scrollTop)).toBe(0);

  await card.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await dialog.locator('.site-auth-dialog__close').click();
  await expect(dialog).not.toBeVisible();
  await page.locator('#introduction').evaluate((intro) => {
    window.scrollTo(0, intro.getBoundingClientRect().bottom + window.scrollY + 1);
  });
  await page.locator('#siteAccountLink').click();
  await expect(dialog).toHaveClass(/is-intro-complete/);
  await page.locator('#siteAuthChoice [data-auth-mode="register"]').click();
  await expect(title).toBeInViewport();
  await expect.poll(() => card.evaluate((element) => element.scrollTop)).toBe(0);
});

test('authentication dialog close control stays reachable while scrolling long forms', async ({ page }) => {
  for (const viewport of [
    { width: 280, height: 568 },
    { width: 320, height: 568 },
    { width: 768, height: 700 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?action=register');

    const dialog = page.locator('dialog.site-auth-dialog');
    const card = dialog.locator('.site-auth-dialog__card');
    const close = dialog.locator('.site-auth-dialog__close');
    await expect(page.locator('#siteAuthRegister')).toBeVisible();
    const cardBounds = await card.boundingBox();
    await card.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    const bounds = await close.boundingBox();
    expect(bounds).not.toBeNull();
    expect(cardBounds).not.toBeNull();
    expect(bounds.x).toBeGreaterThanOrEqual(cardBounds.x);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(cardBounds.x + cardBounds.width);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);

    await close.click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('body')).not.toHaveClass(/is-auth-dialog-open/);
  }
});

test('captain can register with an eight-character password and reach the cabinet directly', async ({ page }) => {
  let registrationPayload;
  await page.route('**/api/session', (route) => route.fulfill({ json: { user: null } }));
  await page.route('**/api/auth/student-card/stream', (route) => route.fulfill({ json: {
    url: '/uploads/student-card-test.png',
    name: 'student-card.png',
    originalName: 'student-card.png',
    type: 'image/png',
    contentType: 'image/png',
    size: 68,
    registrationToken: 'temporary-registration-token'
  } }));
  await page.route('**/api/auth/register-team', async (route) => {
    registrationPayload = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { user: { id: 'user-new', role: 'captain', email: registrationPayload.email } } });
  });
  await page.route((url) => {
    const parsed = new URL(url);
    return parsed.pathname === '/account/cabinet.html' && parsed.searchParams.get('welcome') === '1';
  }, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<main id="registration-complete">Кабинет открыт</main>' }));

  await page.goto('/?action=register');
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
  await page.locator('#siteCapStudentCardFile').setInputFiles({
    name: 'student-card.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2sAAAAASUVORK5CYII=', 'base64')
  });
  await page.locator('#siteCapPassword').fill('abcdefgh');
  await page.locator('#siteCapPasswordConfirm').fill('abcdefgh');
  await page.locator('#siteCapConsent').check();

  await page.locator('#siteAuthRegisterSubmit').click();
  await expect(page.locator('#registration-complete')).toContainText('Кабинет открыт');
  expect(registrationPayload.password).toBe('abcdefgh');
  expect(registrationPayload.email).toBe('ivanov@example.test');
  expect(registrationPayload.studentCardFile).toBe('/uploads/student-card-test.png');
  expect(registrationPayload.studentCardUploadToken).toBe('temporary-registration-token');
  await expect(page).toHaveURL(/\/account\/cabinet\.html\?welcome=1$/);
});

test('registration cannot be submitted before the participant accepts consent', async ({ page }) => {
  let registrationRequests = 0;
  await page.route('**/api/session', (route) => route.fulfill({ json: { user: null } }));
  await page.route('**/api/auth/student-card/stream', (route) => route.fulfill({ json: {
    url: '/uploads/student-card-test.png',
    name: 'student-card.png',
    contentType: 'image/png',
    size: 68,
    registrationToken: 'temporary-registration-token'
  } }));
  await page.route('**/api/auth/register-team', async (route) => {
    registrationRequests += 1;
    await route.fulfill({ status: 201, json: { user: { id: 'unexpected-user', role: 'captain' } } });
  });

  await page.goto('/?action=register');
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
  await page.locator('#siteCapStudentCardFile').setInputFiles({
    name: 'student-card.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2sAAAAASUVORK5CYII=', 'base64')
  });
  await page.locator('#siteCapPassword').fill('abcdefgh');
  await page.locator('#siteCapPasswordConfirm').fill('abcdefgh');

  const consent = page.locator('#siteCapConsent');
  await expect(consent).not.toBeChecked();
  expect(await consent.evaluate((input) => input.validity.valueMissing)).toBe(true);
  await page.locator('#siteAuthRegisterSubmit').click();
  await expect(consent).not.toBeChecked();
  expect(registrationRequests).toBe(0);
});

test('participant can join by invite with an eight-character password and reach the cabinet directly', async ({ page }) => {
  let registrationPayload;
  await page.route('**/api/session', (route) => route.fulfill({ json: { user: null } }));
  await page.route('**/api/invites/**', (route) => route.fulfill({ json: {
    team: { name: 'Команда ИУ7', group: 'ИУ7-41Б', inviteExpiresAt: '2030-12-31T23:59:59Z' }
  } }));
  await page.route('**/api/auth/student-card/stream', (route) => route.fulfill({ json: {
    url: '/uploads/student-card-test.png',
    name: 'student-card.png',
    originalName: 'student-card.png',
    type: 'image/png',
    contentType: 'image/png',
    size: 68,
    registrationToken: 'temporary-registration-token'
  } }));
  await page.route('**/api/auth/join-team', async (route) => {
    registrationPayload = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { user: { id: 'user-new', role: 'participant', email: registrationPayload.email } } });
  });
  await page.route((url) => {
    const parsed = new URL(url);
    return parsed.pathname === '/account/cabinet.html' && parsed.searchParams.get('welcome') === '1';
  }, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<main id="registration-complete">Кабинет открыт</main>' }));

  await page.goto('/?action=join');
  await page.locator('#siteAuthRegister [data-register-mode="participant"]').click();
  await expect(page.locator('#siteAuthRegisterSubmit')).toHaveAttribute('form', 'siteAuthParticipantPanel');
  await page.locator('#siteJoinInviteCode').fill('TEST42');
  await page.locator('#siteJoinInviteCode').blur();
  await expect(page.locator('#siteInviteStatus')).toContainText('Приглашение активно');
  await page.locator('#siteAuthRegisterNext').click();
  await page.locator('#siteJoinSurname').fill('Петрова');
  await page.locator('#siteJoinName').fill('Анна');
  await page.locator('#siteJoinPatronymic').fill('Сергеевна');
  await page.locator('#siteJoinEmail').fill('anna@example.test');
  await page.locator('[data-messenger="telegram"][data-messenger-owner="participant"]').click();
  await page.locator('[data-messenger-contact="participant-telegram"]').fill('@anna_test');
  await page.locator('#siteAuthRegisterNext').click();
  await page.locator('#siteJoinStudentCardFile').setInputFiles({
    name: 'student-card.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2sAAAAASUVORK5CYII=', 'base64')
  });
  await page.locator('#siteJoinPassword').fill('abcdefgh');
  await page.locator('#siteJoinPasswordConfirm').fill('abcdefgh');
  await page.locator('#siteJoinConsent').check();

  await page.locator('#siteAuthRegisterSubmit').click();
  await expect(page.locator('#registration-complete')).toContainText('Кабинет открыт');
  expect(registrationPayload.password).toBe('abcdefgh');
  expect(registrationPayload.inviteCode).toBe('TEST42');
  expect(registrationPayload.email).toBe('anna@example.test');
  await expect(page).toHaveURL(/\/account\/cabinet\.html\?welcome=1$/);
});
