import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const backendRoot = path.resolve('backend');
const python = process.env.PYTHON || 'python';
const adminEmail = 'admin@lug.local';
const adminPassword = 'Strong!Admin1';
const studentCardPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2sAAAAASUVORK5CYII=',
  'base64'
);

let apiPort;
let backendProcess;
let dataRoot;
let backendOutput = '';

async function findFreePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function localBackendEnvironment() {
  const normalizedRoot = dataRoot.replaceAll('\\', '/');
  return {
    ...process.env,
    LUG_ENV: 'development',
    LUG_ROOT: dataRoot,
    LUG_DATABASE_URL: `sqlite+aiosqlite:///${normalizedRoot}/lug.db`,
    LUG_DATA_DIR: path.join(dataRoot, 'data'),
    LUG_UPLOAD_DIR: path.join(dataRoot, 'uploads'),
    LUG_FILE_STORAGE_PROVIDER: 'local',
    LUG_UPLOAD_SCANNER: 'none',
    LUG_UPLOAD_SCAN_REQUIRED: 'false',
    LUG_EMAIL_MODE: 'log',
    LUG_EMAIL_LOG_CODE: 'true',
    LUG_ADMIN_EMAIL: adminEmail,
    LUG_ADMIN_PASSWORD: adminPassword,
    LUG_SECURE_COOKIES: 'false',
    LUG_ALLOWED_HOSTS: '127.0.0.1,localhost'
  };
}

async function waitForBackend() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (backendProcess.exitCode !== null) {
      throw new Error(`Temporary backend stopped before readiness.\n${backendOutput}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/health`);
      if (response.ok) return;
    } catch {
      // The server process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Temporary backend did not become ready.\n${backendOutput}`);
}

async function routeToTemporaryBackend(page) {
  await page.route('http://127.0.0.1:4173/api/**', async (route) => {
    const url = new URL(route.request().url());
    url.port = String(apiPort);
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  await page.route('http://127.0.0.1:4173/uploads/**', async (route) => {
    const url = new URL(route.request().url());
    url.port = String(apiPort);
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
}

async function openCabinetView(page, selector) {
  await page.locator('#cabinetMobileNavToggle').click();
  await page.locator(selector).click();
}

test.describe('browser to isolated FastAPI and SQLite', () => {
  test.beforeAll(async () => {
    if (process.env.LUG_E2E_API_PORT) {
      apiPort = Number(process.env.LUG_E2E_API_PORT);
      if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
        throw new Error('LUG_E2E_API_PORT must be a valid TCP port.');
      }
      return;
    }
    dataRoot = await mkdtemp(path.join(os.tmpdir(), 'lug-browser-e2e-'));
    apiPort = await findFreePort();
    const env = localBackendEnvironment();
    const migration = spawnSync(python, ['-m', 'alembic', 'upgrade', 'head'], {
      cwd: backendRoot,
      env,
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true
    });
    if (migration.error || migration.status !== 0) {
      throw new Error(`Temporary backend migration failed.\n${migration.stderr || migration.error || migration.stdout}`);
    }

    backendProcess = spawn(python, [
      '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(apiPort), '--log-level', 'warning'
    ], { cwd: backendRoot, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    backendProcess.stdout.on('data', (chunk) => { backendOutput = (backendOutput + chunk.toString()).slice(-5000); });
    backendProcess.stderr.on('data', (chunk) => { backendOutput = (backendOutput + chunk.toString()).slice(-5000); });
    await waitForBackend();
  });

  test.afterAll(async () => {
    if (backendProcess && backendProcess.exitCode === null) {
      const stopped = new Promise((resolve) => backendProcess.once('exit', resolve));
      backendProcess.kill();
      await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    if (dataRoot) {
      const resolvedTarget = path.resolve(dataRoot);
      const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
      if (!resolvedTarget.startsWith(temporaryRoot) || !path.basename(resolvedTarget).startsWith('lug-browser-e2e-')) {
        throw new Error(`Refusing to remove unexpected test data path: ${resolvedTarget}`);
      }
      await rm(resolvedTarget, { recursive: true, force: true });
    }
  });

  test('registers, joins, submits profile and materials, previews them in admin, and delivers organizer decisions', async ({ browser }) => {
    test.setTimeout(90_000);
    const participantContext = await browser.newContext();
    const participantPage = await participantContext.newPage();
    await routeToTemporaryBackend(participantPage);

    const unique = Date.now();
    const email = `browser-${unique}@example.test`;
    const group = `E2E-${unique}`;
    const teamName = `Команда ${group}`;
    const previewImage = await readFile(path.resolve('src/assets/images/lug-logo-black.png'));
    await participantPage.goto('/?action=register');
    await participantPage.locator('#siteCapGroup').fill(group);
    await participantPage.locator('#siteCapGroupSize').fill('2');
    await participantPage.locator('#siteCapTeamName').fill(teamName);
    await participantPage.locator('#siteAuthRegisterNext').click();
    await participantPage.locator('#siteCapSurname').fill('Иванова');
    await participantPage.locator('#siteCapName').fill('Александра');
    await participantPage.locator('#siteCapPatronymic').fill('Тестовна');
    await participantPage.locator('#siteCapEmail').fill(email);
    await participantPage.locator('[data-messenger="telegram"][data-messenger-owner="captain"]').click();
    await participantPage.locator('[data-messenger-contact="captain-telegram"]').fill('@browser_e2e');
    await participantPage.locator('#siteAuthRegisterNext').click();
    await participantPage.locator('#siteCapStudentCardFile').setInputFiles({
      name: 'student-card.png', mimeType: 'image/png', buffer: studentCardPng
    });
    await participantPage.locator('#siteCapPassword').fill('abcdefgh');
    await participantPage.locator('#siteCapPasswordConfirm').fill('abcdefgh');
    await participantPage.locator('#siteCapConsent').check();
    await participantPage.locator('#siteAuthRegisterSubmit').click();
    await expect(participantPage).toHaveURL(/\/account\/cabinet\.html\?welcome=1$/);
    await expect(participantPage.locator('#dashboard-title')).toContainText('Александра');
    await expect(participantPage.locator('#dashboard-lead')).toContainText('Капитан');
    const welcomeDialog = participantPage.locator('.guide-welcome');
    await expect(welcomeDialog).toBeVisible();
    await expect(welcomeDialog).toContainText('КОМАНДА СОЗДАНА');
    await participantPage.locator('.guide-welcome__close').click();

    await openCabinetView(participantPage, '#teamNavigation');
    const inviteCode = (await participantPage.locator('#inviteCode').textContent()).trim();
    expect(inviteCode).not.toBe('—');

    const joinerContext = await browser.newContext();
    const joinerPage = await joinerContext.newPage();
    await routeToTemporaryBackend(joinerPage);
    const joinerEmail = `joiner-${unique}@example.test`;
    await joinerPage.goto(`/?invite=${encodeURIComponent(inviteCode)}`);
    await expect(joinerPage.locator('#siteAuthRegister')).toBeVisible();
    await expect(joinerPage.locator('#siteJoinInviteCode')).toHaveValue(inviteCode);
    await joinerPage.locator('#siteAuthRegisterNext').click();
    await joinerPage.locator('#siteJoinSurname').fill('Петрова');
    await joinerPage.locator('#siteJoinName').fill('Анна');
    await joinerPage.locator('#siteJoinPatronymic').fill('Сергеевна');
    await joinerPage.locator('#siteJoinEmail').fill(joinerEmail);
    await joinerPage.locator('[data-messenger="telegram"][data-messenger-owner="participant"]').click();
    await joinerPage.locator('[data-messenger-contact="participant-telegram"]').fill('@browser_joiner');
    await joinerPage.locator('#siteAuthRegisterNext').click();
    await joinerPage.locator('#siteJoinStudentCardFile').setInputFiles({
      name: 'student-card.png', mimeType: 'image/png', buffer: studentCardPng
    });
    await joinerPage.locator('#siteJoinPassword').fill('abcdefgh');
    await joinerPage.locator('#siteJoinPasswordConfirm').fill('abcdefgh');
    await joinerPage.locator('#siteJoinConsent').check();
    const joinResponsePromise = joinerPage.waitForResponse((response) => (
      response.url().includes('/api/auth/join-team') && response.request().method() === 'POST'
    ));
    await joinerPage.locator('#siteAuthRegisterSubmit').click();
    const joinResponse = await joinResponsePromise;
    expect(joinResponse.status()).toBe(201);
    await expect(joinerPage).toHaveURL(/\/account\/cabinet\.html\?welcome=1$/);
    await joinerPage.locator('.guide-welcome__close').click();

    await openCabinetView(participantPage, '#profile-tab');
    await participantPage.locator('#profilePhone').fill('+7 900 000-00-01');
    await participantPage.locator('#profileContact').fill('@browser_captain_updated');
    const profileResponsePromise = participantPage.waitForResponse((response) => (
      response.url().endsWith('/api/me') && response.request().method() === 'PATCH'
    ));
    await participantPage.locator('#profileForm button[type="submit"]').click();
    const profileResponse = await profileResponsePromise;
    expect(profileResponse.status()).toBe(200);
    await expect(participantPage.locator('#profileResult')).toContainText('Профиль сохранён');

    await openCabinetView(participantPage, '#teamNavigation');
    await participantPage.locator('#teamDescription').fill('Сквозной браузерный тест команды.');
    const teamUpdatePromise = participantPage.waitForResponse((response) => (
      response.url().endsWith('/api/team') && response.request().method() === 'PATCH'
    ));
    await participantPage.locator('#saveTeam').click();
    expect((await teamUpdatePromise).status()).toBe(200);
    const flagUploadPromise = participantPage.waitForResponse((response) => (
      response.url().endsWith('/api/uploads/stream') && response.request().method() === 'POST'
    ));
    await participantPage.locator('#teamFlagInput').setInputFiles({
      name: 'team-flag.png', mimeType: 'image/png', buffer: previewImage
    });
    const flagUpload = await flagUploadPromise;
    expect(flagUpload.status()).toBe(201);
    await expect(participantPage.locator('#teamFlagPreview')).toBeVisible();
    await expect.poll(() => participantPage.locator('#teamFlagPreview').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);

    participantPage.once('dialog', (dialog) => dialog.accept());
    const inviteRotationPromise = participantPage.waitForResponse((response) => (
      response.url().endsWith('/api/team/invite') && response.request().method() === 'POST'
    ));
    await participantPage.locator('#rotateInvite').click();
    expect((await inviteRotationPromise).status()).toBe(200);
    await expect(participantPage.locator('#inviteCode')).not.toHaveText(inviteCode);

    await participantPage.locator('#cabinetMobileNavToggle').click();
    await participantPage.locator('#portfolio-tab').click();
    await participantPage.locator('#openAchievement').click();
    await expect(participantPage.locator('#achievementDialog')).toHaveAttribute('open', '');
    await participantPage.locator('#achievementCategory').fill('Научная работа');
    await participantPage.locator('#achievementTitle').fill('Браузерный end-to-end материал');
    await participantPage.locator('#achievementDetails').fill('Сценарий с реальной загрузкой и проверкой оргкомитетом.');
    await participantPage.locator('#achievementFile').setInputFiles({
      name: 'proof.png', mimeType: 'image/png', buffer: previewImage
    });
    await expect(participantPage.locator('#achievementFileName')).toContainText('proof.png');
    const proofUploadPromise = participantPage.waitForResponse((response) => (
      response.url().endsWith('/api/uploads/stream') && response.request().method() === 'POST'
    ));
    const createdResponse = participantPage.waitForResponse((response) => (
      response.url().includes('/api/achievements') && response.request().method() === 'POST'
    ));
    await participantPage.locator('#saveAchievement').click();
    expect((await proofUploadPromise).status()).toBe(201);
    const achievementResponse = await createdResponse;
    expect(achievementResponse.status()).toBe(201);
    const achievementId = (await achievementResponse.json()).achievement.id;

    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await routeToTemporaryBackend(adminPage);
    await adminPage.goto('/');
    const loginStatus = await adminPage.evaluate(async ({ email: loginEmail, password }) => {
      await fetch('/api/session');
      const token = document.cookie.split('; ').find((cookie) => cookie.trim().startsWith('lug_csrf='))?.split('=').slice(1).join('=');
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': decodeURIComponent(token || '') },
        body: JSON.stringify({ email: loginEmail, password })
      });
      return response.status;
    }, { email: adminEmail, password: adminPassword });
    expect(loginStatus).toBe(200);

    await adminPage.goto('/account/admin.html');
    await adminPage.locator('[data-admin-view="achievements"]').click();
    await adminPage.locator(`[data-select-achievement="${achievementId}"]`).click();
    const evidencePreview = adminPage.locator('#adminAchievementDetail .admin-user-document__preview img');
    await expect(evidencePreview).toBeVisible();
    await expect.poll(() => evidencePreview.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
    await adminPage.locator(`[data-achievement-review-action="${achievementId}"][data-achievement-review-value="rejected"]`).click();
    const comment = 'Прикрепите документ с читаемым подтверждением.';
    await adminPage.locator(`[data-achievement-comment="${achievementId}"]`).fill(comment);
    const reviewResponse = adminPage.waitForResponse((response) => (
      response.url().includes(`/api/admin/achievements/${achievementId}/review`)
    ));
    await adminPage.locator(`[data-review-achievement="${achievementId}"]`).click();
    const reviewResult = await reviewResponse;
    const reviewBody = await reviewResult.text();
    expect(reviewResult.status(), reviewBody).toBe(200);

    const teamData = await participantPage.evaluate(async () => {
      const response = await fetch('/api/dashboard');
      const dashboard = await response.json();
      return { id: dashboard.team.id };
    });
    await adminPage.locator('[data-admin-view="teams"]').click();
    await adminPage.locator(`#adminTeamsList [data-select-team="${teamData.id}"]`).click();
    const teamReviewForm = adminPage.locator(`[data-team-profile-review="${teamData.id}"]`);
    await expect(teamReviewForm).toBeVisible();
    await expect(teamReviewForm.locator('a[href*="/uploads/"]')).toHaveCount(1);
    const teamFields = ['name', 'group', 'flag', 'description'];
    const teamReviewPromises = teamFields.map((field) => adminPage.waitForResponse((response) => {
      if (!response.url().endsWith(`/api/admin/teams/${teamData.id}/review`) || response.request().method() !== 'PATCH') return false;
      return response.request().postDataJSON().field === field;
    }));
    for (const field of teamFields) {
      await teamReviewForm.locator(`[data-team-review-action="${field}"][data-team-review-value="approved"]`).click();
    }
    await teamReviewForm.locator('button[type="submit"]').click();
    const teamReviewResponses = await Promise.all(teamReviewPromises);
    expect(teamReviewResponses.map((response) => response.status())).toEqual([200, 200, 200, 200]);

    const membersForm = adminPage.locator(`[data-team-members-review="${teamData.id}"]`);
    await expect(membersForm.locator('[data-member-review-item]')).toHaveCount(2);
    for (const member of await membersForm.locator('[data-member-review-item]').all()) {
      await member.locator('[data-member-review-value="approved"]').click();
    }
    const identityReviewPromises = [email, joinerEmail].map((memberEmail) => adminPage.waitForResponse((response) => (
      response.url().includes('/api/admin/users/') && response.url().endsWith('/identity')
      && response.request().method() === 'PATCH'
      && response.request().postDataJSON().status === 'approved'
    )));
    await membersForm.locator('button[type="submit"]').click();
    const identityReviewResponses = await Promise.all(identityReviewPromises);
    expect(identityReviewResponses.map((response) => response.status())).toEqual([200, 200]);

    await adminPage.locator('[data-admin-view="broadcast"]').click();
    await adminPage.locator('label.admin-audience__card:has(input[name="notifTargetType"][value="team"])').click();
    await adminPage.locator('#notifTargetId').selectOption({ value: teamData.id });
    await adminPage.locator('#notifTitleInput').fill('Проверка уведомлений');
    await adminPage.locator('#notifMessageInput').fill('Сообщение доставлено из реальной панели организатора.');
    const broadcastPromise = adminPage.waitForResponse((response) => (
      response.url().endsWith('/api/admin/notifications/broadcast') && response.request().method() === 'POST'
    ));
    await adminPage.locator('#broadcastForm button[type="submit"]').click();
    const broadcastResponse = await broadcastPromise;
    const broadcastBody = await broadcastResponse.text();
    expect(broadcastResponse.status(), broadcastBody).toBe(201);
    await expect(adminPage.locator('#broadcastSuccess')).toBeVisible();

    await participantPage.reload();
    await participantPage.locator('#cabinetMobileNavToggle').click();
    await participantPage.locator('#portfolio-tab').click();
    const material = participantPage.locator(`[data-material-id="${achievementId}"]`);
    await expect(material).toBeVisible();
    await material.click();
    await expect(participantPage.locator('#portfolioSummary')).toContainText(comment);

    await openCabinetView(participantPage, '#notifications-tab');
    const notification = participantPage.locator('#notificationList article').filter({ hasText: 'Проверка уведомлений' });
    await expect(notification).toContainText('Сообщение доставлено из реальной панели организатора.');
    const readResponsePromise = participantPage.waitForResponse((response) => (
      response.url().includes('/api/notifications/') && response.url().endsWith('/read')
      && response.request().method() === 'PATCH'
    ));
    await notification.locator('[data-read-notification]').click();
    expect((await readResponsePromise).status()).toBe(200);
    await expect(notification).toContainText('Прочитано');

    await joinerPage.reload();
    await expect(joinerPage.locator('#dashboard-lead')).toContainText('Участник');

    await adminContext.close();
    await joinerContext.close();
    await participantContext.close();
  });
});
