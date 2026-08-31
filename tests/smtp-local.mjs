import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const webPort = 4373;
const apiPort = 4374;
const base = `http://127.0.0.1:${webPort}`;
const tempRoot = mkdtempSync(join(tmpdir(), 'lug-smtp-'));
const tempDataDir = join(tempRoot, 'data');
const tempUploadDir = join(tempRoot, 'uploads');
const pngData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const recipient = `recipient-${Date.now()}@smtp.test`;

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      LUG_EMAIL_MODE: 'smtp',
      LUG_SMTP_HOST: '127.0.0.1',
      LUG_SMTP_PORT: '1025',
      LUG_SMTP_SSL: 'false',
      LUG_SMTP_STARTTLS: 'false',
      LUG_SMTP_FROM: 'no-reply@lug.test',
      LUG_SMTP_USER: '',
      LUG_SMTP_PASSWORD: '',
      LUG_EMAIL_VERIFICATION_SECRET: 'smtp-local-test-secret',
      LUG_UPLOAD_SCAN_REQUIRED: 'false',
      LUG_DATA_DIR: tempDataDir,
      LUG_UPLOAD_DIR: tempUploadDir,
      LUG_ADMIN_EMAIL: 'admin@smtp.test',
      LUG_ADMIN_PASSWORD: 'Strong!Admin1',
      PORT: String(webPort),
      LUG_API_PORT: String(apiPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('SMTP integration server did not become ready.');
}

function createClient() {
  const jar = new Map();
  function applySetCookies(response) {
    const values = response.headers.getSetCookie?.()
      || (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    for (const value of values) {
      const first = value.split(';', 1)[0];
      const separator = first.indexOf('=');
      if (separator > 0) jar.set(first.slice(0, separator), first.slice(separator + 1));
    }
  }
  return {
    cookieHeader() { return [...jar].map(([key, value]) => `${key}=${value}`).join('; '); },
    csrf() { return jar.get('lug_csrf') || ''; },
    async request(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      const cookies = this.cookieHeader();
      if (cookies) headers.Cookie = cookies;
      const response = await fetch(`${base}${path}`, { ...options, headers });
      applySetCookies(response);
      return response;
    },
  };
}

async function json(response) { return response.json(); }
async function expectStatus(response, expected, label) {
  if (response.status !== expected) {
    assert.fail(`${label}: expected ${expected}, got ${response.status}; ${await response.text()}`);
  }
}

const server = startServer();
try {
  await waitForServer();
  const client = createClient();
  await client.request('/index.html');
  const upload = await client.request('/api/auth/student-card/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      'X-Upload-Name': 'student-card.png',
      'X-CSRF-Token': client.csrf(),
    },
    body: Buffer.from(pngData.split(',')[1], 'base64'),
  });
  await expectStatus(upload, 201, 'SMTP registration upload');
  const uploadPayload = await json(upload);
  const body = JSON.stringify({
    fio: 'SMTP Test',
    group: `SMTP-${Date.now()}`,
    teamName: 'SMTP integration',
    totalStudentsInGroup: 1,
    email: recipient,
    password: 'Strong!Test1',
    messenger: 'telegram',
    messengerContact: '@smtp_test',
    telegramAccount: '@smtp_test',
    studentCardFile: uploadPayload.url,
    studentCardUploadToken: uploadPayload.registrationToken,
    studentCardSize: uploadPayload.size,
    studentCardType: uploadPayload.type,
    studentCardFileName: 'student-card.png',
    consent: true,
  });
  const registration = await client.request('/api/auth/register-team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': client.csrf() },
    body,
  });
  await expectStatus(registration, 202, 'SMTP registration pending');
  const registrationPayload = await json(registration);
  assert.equal(registrationPayload.verificationRequired, true);

  let message;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const inbox = await fetch('http://127.0.0.1:8025/api/v1/messages').then((response) => response.json());
    message = inbox.messages?.find((entry) => JSON.stringify(entry).includes(recipient));
    if (message) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(message, 'Mailpit did not receive the SMTP message.');
  assert.match(message.Subject, /Код подтверждения/);
  const detail = await fetch(`http://127.0.0.1:8025/api/v1/message/${message.ID}`).then((response) => response.json());
  assert.match(JSON.stringify(detail), /Подтвердите(?:<br>)?почту/);
  assert.match(detail.HTML, /viewBox="0 0 1448 1086"/);
  assert.match(detail.HTML, /border:2px dashed #006cdc/);
  assert.equal((detail.HTML.match(/<svg/g) || []).length, 2);

  const verificationCode = (detail.Text || detail.HTML || '').match(/\b\d{6}\b/)?.[0];
  assert.ok(verificationCode, 'SMTP message did not contain a verification code.');
  const verification = await client.request('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': client.csrf() },
    body: JSON.stringify({ verificationId: registrationPayload.verificationId, code: verificationCode }),
  });
  await expectStatus(verification, 201, 'SMTP registration verification');
  const verifiedUser = await json(verification);

  const admin = createClient();
  await admin.request('/index.html');
  const adminLogin = await admin.request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf() },
    body: JSON.stringify({ email: 'admin@smtp.test', password: 'Strong!Admin1' }),
  });
  await expectStatus(adminLogin, 200, 'SMTP admin login');

  const broadcastTitle = `Капитану ${Date.now()}`;
  const broadcast = await admin.request('/api/admin/notifications/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf() },
    body: JSON.stringify({
      targetType: 'captain',
      targetId: verifiedUser.user.teamId,
      title: broadcastTitle,
      message: 'Проверьте материалы команды в личном кабинете.',
    }),
  });
  await expectStatus(broadcast, 201, 'SMTP captain broadcast');
  const broadcastPayload = await json(broadcast);
  assert.equal(broadcastPayload.emailRecipients, 1);
  assert.equal(broadcastPayload.emailMode, 'smtp');

  const notifications = await client.request('/api/notifications').then(json);
  assert.ok(notifications.notifications.some((item) => item.title === broadcastTitle), 'Captain notification missing in cabinet.');
  let broadcastMessage;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const inbox = await fetch('http://127.0.0.1:8025/api/v1/messages').then((response) => response.json());
    broadcastMessage = inbox.messages?.find((entry) => entry.Subject === `ЛУГ 2026 · ${broadcastTitle}` && JSON.stringify(entry).includes(recipient));
    if (broadcastMessage) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(broadcastMessage, 'Mailpit did not receive the captain broadcast.');
  const broadcastDetail = await fetch(`http://127.0.0.1:8025/api/v1/message/${broadcastMessage.ID}`).then((response) => response.json());
  assert.match(broadcastDetail.Text, /Проверьте материалы команды/);
  assert.match(broadcastDetail.HTML, new RegExp(broadcastTitle));
  assert.match(broadcastDetail.HTML, /viewBox="0 0 1448 1086"/);
  assert.match(broadcastDetail.HTML, /border:2px dashed #006cdc/);
  console.log('smtp-local: ok');
} finally {
  server.kill('SIGTERM');
  if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
}
