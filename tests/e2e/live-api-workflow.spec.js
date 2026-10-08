import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
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
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    url.port = String(apiPort);
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  await page.route('**/uploads/**', async (route) => {
    const url = new URL(route.request().url());
    url.port = String(apiPort);
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
}

test.describe('browser to isolated FastAPI and SQLite', () => {
  test.beforeAll(async () => {
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

  test('registers with consent and document, then shows a real admin rejection in the cabinet', async ({ browser }) => {
    const participantContext = await browser.newContext();
    const participantPage = await participantContext.newPage();
    await routeToTemporaryBackend(participantPage);

    const unique = Date.now();
    const email = `browser-${unique}@example.test`;
    const group = `E2E-${unique}`;
    await participantPage.goto('/?action=register');
    await participantPage.locator('#siteCapGroup').fill(group);
    await participantPage.locator('#siteCapGroupSize').fill('1');
    await participantPage.locator('#siteCapTeamName').fill(`Команда ${group}`);
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

    await participantPage.locator('#cabinetMobileNavToggle').click();
    await participantPage.locator('#portfolio-tab').click();
    await participantPage.locator('#openAchievement').click();
    await expect(participantPage.locator('#achievementDialog')).toHaveAttribute('open', '');
    await participantPage.locator('#achievementCategory').fill('Научная работа');
    await participantPage.locator('#achievementTitle').fill('Браузерный end-to-end материал');
    await participantPage.locator('#achievementDetails').fill('Сценарий с реальной загрузкой и проверкой оргкомитетом.');
    await participantPage.locator('#achievementFile').setInputFiles({
      name: 'proof.png', mimeType: 'image/png', buffer: studentCardPng
    });
    const createdResponse = participantPage.waitForResponse((response) => (
      response.url().includes('/api/achievements') && response.request().method() === 'POST'
    ));
    await participantPage.locator('#saveAchievement').click();
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

    await participantPage.reload();
    await participantPage.locator('#cabinetMobileNavToggle').click();
    await participantPage.locator('#portfolio-tab').click();
    const material = participantPage.locator(`[data-material-id="${achievementId}"]`);
    await expect(material).toBeVisible();
    await material.click();
    await expect(participantPage.locator('#portfolioSummary')).toContainText(comment);

    await adminContext.close();
    await participantContext.close();
  });
});
