import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const webPort = 4273;
const apiPort = 4274;
const tempRoot = mkdtempSync(join(tmpdir(), 'lug-smoke-'));
const tempDataDir = join(tempRoot, 'data');
const tempUploadDir = join(tempRoot, 'uploads');
const base = `http://127.0.0.1:${webPort}`;
const adminEmail = 'admin@smoke.test';
const adminPassword = 'Strong!Admin1';
const pngData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function startServer() {
  const logs = [];
  const child = spawn(process.execPath, ['server.js'], { cwd: root, env: { ...process.env, NODE_ENV: 'test', LUG_DATABASE_PROVIDER: 'json', LUG_EMAIL_MODE: 'log', LUG_EMAIL_LOG_CODE: 'true', LUG_EMAIL_VERIFICATION_SECRET: 'smoke-email-verification-secret', LUG_UPLOAD_SCAN_REQUIRED: 'false', LUG_OPERATIONS_TOKEN: 'smoke-ops-token', PORT: String(webPort), LUG_API_PORT: String(apiPort), LUG_DATA_DIR: tempDataDir, LUG_UPLOAD_DIR: tempUploadDir, LUG_ADMIN_EMAIL: adminEmail, LUG_ADMIN_PASSWORD: adminPassword }, stdio: ['ignore', 'pipe', 'pipe'] });
  const capture = (chunk) => logs.push(chunk.toString());
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  return { child, logs: () => logs.join('') };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { const response = await fetch(`${base}/healthz`); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Smoke server did not become ready.');
}

function createClient() {
  const jar = new Map();
  function applySetCookies(response) {
    const values = response.headers.getSetCookie?.() || (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
    for (const value of values) { const first = value.split(';', 1)[0]; const separator = first.indexOf('='); if (separator > 0) jar.set(first.slice(0, separator), first.slice(separator + 1)); }
  }
  return {
    cookieHeader() { return [...jar].map(([key, value]) => `${key}=${value}`).join('; '); },
    csrf() { return jar.get('lug_csrf') || ''; },
    async request(path, options = {}) {
      const headers = { ...(options.headers || {}) }; const cookies = this.cookieHeader(); if (cookies) headers.Cookie = cookies;
      const response = await fetch(`${base}${path}`, { ...options, headers }); applySetCookies(response); return response;
    }
  };
}

async function json(response) { return response.json(); }
async function expectStatus(response, expected, label) { if (response.status !== expected) { const details = await response.text(); assert.fail(`${label}: expected ${expected}, got ${response.status}; ${details}`); } }
function requestWithHost(host) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: webPort, path: '/healthz', headers: { Host: host } }, (response) => {
      response.resume();
      response.once('end', () => resolve(response));
    });
    request.once('error', reject);
    request.end();
  });
}
async function waitForVerificationCode(server, offset) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const match = server.logs().slice(offset).match(/"event"\s*:\s*"email\.verification_code"[\s\S]*?"code"\s*:\s*"(\d{6})"/);
    if (match) return match[1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Verification code was not written to the test log. Captured output: ${server.logs().slice(offset)}`);
}

const server = startServer();
try {
  await waitForServer();
  assert.equal((await requestWithHost('not-allowed.example')).statusCode, 400, 'gateway host allowlist');
  await expectStatus(await fetch(`http://127.0.0.1:${apiPort}/metrics`), 404, 'direct metrics denied');
  await expectStatus(await fetch(`http://127.0.0.1:${apiPort}/metrics`, { headers: { Authorization: 'Bearer smoke-ops-token' } }), 200, 'direct metrics token access');
  const publicClient = createClient();
  await expectStatus(await publicClient.request('/api/config'), 200, 'config');
  const tracedConfig = await publicClient.request('/api/config');
  assert.match(tracedConfig.headers.get('traceparent') || '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  await expectStatus(await publicClient.request('/api/results'), 200, 'results');
  await expectStatus(await publicClient.request('/livez'), 200, 'liveness through gateway');
  await expectStatus(await publicClient.request('/readyz'), 200, 'readiness through gateway');
  const metricsResponse = await publicClient.request('/metrics');
  await expectStatus(metricsResponse, 200, 'metrics through gateway');
  assert.match(await metricsResponse.text(), /lug_http_request_duration_bucket/);
  const openapiResponse = await publicClient.request('/api/openapi.json');
  await expectStatus(openapiResponse, 200, 'openapi');
  const openapi = await json(openapiResponse);
  assert.equal(Object.hasOwn(openapi.paths, '/api/chat'), false, 'openapi has no chat path');
  assert.equal(Object.hasOwn(openapi.paths, '/api/chat/read'), false, 'openapi has no chat read path');
  await expectStatus(await publicClient.request('/api/admin/overview'), 401, 'unauthenticated admin');
  await expectStatus(await publicClient.request('/api/admin/settings', { method: 'PATCH', body: '{}' }), 403, 'csrf gate');
  const home = await publicClient.request('/index.html'); const homeMarkup = await home.text(); assert.match(homeMarkup, /class="hero-title"/); assert.match(homeMarkup, /ЛУЧШАЯ/); assert.match(homeMarkup, /css\/style\.css/); assert.doesNotMatch(home.headers.get('content-security-policy') || '', /script-src[^;]*unsafe-inline/);

  const admin = createClient(); await admin.request('/index.html');
  const adminLogin = await admin.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf() }, body: JSON.stringify({ email: adminEmail, password: adminPassword }) });
  await expectStatus(adminLogin, 200, 'admin login');
  await expectStatus(await admin.request('/api/admin/overview'), 200, 'admin overview');
  const settings = await admin.request('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf() }, body: JSON.stringify({ isRegistrationOpen: true }) }); await expectStatus(settings, 200, 'admin settings'); assert.ok(settings.headers.get('x-request-id'));

  const participant = createClient(); await participant.request('/index.html');
  const group = `SMOKE-${Date.now()}`;
  const captainEmail = `captain-${Date.now()}@smoke.test`;
  const registrationLogOffset = server.logs().length;
  const registration = await participant.request('/api/auth/register-team', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': participant.csrf() }, body: JSON.stringify({ fio: 'Тестовый капитан', group, teamName: 'Smoke команда', totalStudentsInGroup: 1, email: captainEmail, password: 'Strong!Test1', messenger: 'telegram', messengerContact: '@smoketest', telegramAccount: '@smoketest', studentCardFile: pngData, studentCardFileName: 'student-card.png', consent: true }) });
  await expectStatus(registration, 202, 'team registration pending');
  const registrationPayload = await json(registration);
  assert.equal(registrationPayload.verificationRequired, true);
  const persistedPending = JSON.parse(readFileSync(join(tempDataDir, 'lug.json'), 'utf8')).emailVerifications.find((item) => item.id === registrationPayload.verificationId);
  assert.ok(persistedPending, 'pending verification was persisted');
  assert.equal(Object.hasOwn(persistedPending, 'code'), false, 'raw verification code is not persisted');
  assert.equal(Object.hasOwn(persistedPending.payload, 'password'), false, 'raw password is not persisted');
  assert.match(persistedPending.codeHash, /^[0-9a-f]{64}$/, 'verification code is stored as an HMAC');
  await expectStatus(await participant.request('/api/dashboard'), 401, 'dashboard before email verification');
  const replacementLogOffset = server.logs().length;
  const repeatedRegistration = await participant.request('/api/auth/register-team', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': participant.csrf() }, body: JSON.stringify({ fio: 'Тестовый капитан', group, teamName: 'Smoke команда', totalStudentsInGroup: 1, email: captainEmail, password: 'Strong!Test1', messenger: 'telegram', messengerContact: '@smoketest', telegramAccount: '@smoketest', studentCardFile: pngData, studentCardFileName: 'student-card.png', consent: true }) });
  await expectStatus(repeatedRegistration, 202, 'repeated pending registration refreshes code');
  const repeatedRegistrationPayload = await json(repeatedRegistration);
  assert.equal(repeatedRegistrationPayload.verificationId, registrationPayload.verificationId, 'pending registration keeps verification id');
  const captainCode = await waitForVerificationCode(server, replacementLogOffset);
  const wrongCode = await participant.request('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': participant.csrf() }, body: JSON.stringify({ verificationId: registrationPayload.verificationId, code: '000000' }) });
  await expectStatus(wrongCode, 422, 'wrong email verification code');
  const verifiedRegistration = await participant.request('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': participant.csrf() }, body: JSON.stringify({ verificationId: registrationPayload.verificationId, code: captainCode }) });
  await expectStatus(verifiedRegistration, 201, 'team registration verification');
  const dashboard = await participant.request('/api/dashboard'); await expectStatus(dashboard, 200, 'dashboard'); const dashboardPayload = await json(dashboard); assert.equal(dashboardPayload.team.group, group); assert.equal(dashboardPayload.members.length, 1); assert.match(dashboardPayload.team.inviteCode, /^INV-[A-F0-9]{32}$/); assert.equal(dashboard.headers.get('cache-control'), 'no-store'); assert.match(dashboard.headers.get('vary') || '', /Cookie/);
  const previousStudentCard = dashboardPayload.user.studentCardFile;
  const replacementStudentCard = await participant.request('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': participant.csrf() }, body: JSON.stringify({ studentCardFile: pngData, studentCardFileName: 'student-card-replacement.png' }) });
  await expectStatus(replacementStudentCard, 200, 'student card replacement');
  const replacementPayload = await json(replacementStudentCard);
  assert.notEqual(replacementPayload.user.studentCardFile, previousStudentCard, 'student card URL is replaced');
  assert.equal(replacementPayload.user.identityStatus, 'pending', 'replacement returns identity to review');
  const replacementAdminOverview = await json(await admin.request('/api/admin/overview'));
  assert.ok(replacementAdminOverview.adminNotifications.some((item) => item.targetId === replacementPayload.user.id && item.message.includes('новое фото личного кабинета')), 'admin is notified about student card replacement');
  await expectStatus(await participant.request(`/api/invites/${encodeURIComponent(dashboardPayload.team.inviteCode)}`), 200, 'invite lookup');
  let inviteRateLimitResponse;
  for (let attempt = 0; attempt < 20; attempt += 1) inviteRateLimitResponse = await publicClient.request(`/api/invites/invalid-${attempt}`);
  await expectStatus(inviteRateLimitResponse, 429, 'invite lookup rate limit');
  const upload = await participant.request('/api/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': participant.csrf() }, body: JSON.stringify({ name: 'flag.png', data: pngData }) }); await expectStatus(upload, 201, 'upload'); const uploadPayload = await json(upload);
  await expectStatus(await participant.request(uploadPayload.url), 200, 'private upload owner access');
  await expectStatus(await participant.request('/api/admin/overview'), 403, 'participant admin denial');
  const outsider = createClient(); await outsider.request('/index.html');
  const massAssignmentAttempt = await outsider.request('/api/auth/register-team', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': outsider.csrf() }, body: JSON.stringify({ fio: 'Тестовый наблюдатель', group: `SMOKE-OUT-REJECT-${Date.now()}`, teamName: 'Smoke rejected', totalStudentsInGroup: 1, email: `rejected-${Date.now()}@smoke.test`, password: 'Strong!Test2', messenger: 'telegram', messengerContact: '@smokeoutsider', studentCardFile: pngData, studentCardFileName: 'student-card.png', consent: true, role: 'admin' }) });
  await expectStatus(massAssignmentAttempt, 422, 'mass assignment rejected');
  const outsiderEmail = `outsider-${Date.now()}@smoke.test`;
  const outsiderLogOffset = server.logs().length;
  const outsiderRegistration = await outsider.request('/api/auth/register-team', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': outsider.csrf() }, body: JSON.stringify({ fio: 'Тестовый наблюдатель', group: `SMOKE-OUT-${Date.now()}`, teamName: 'Smoke outsider', totalStudentsInGroup: 1, email: outsiderEmail, password: 'Strong!Test2', messenger: 'telegram', messengerContact: '@smokeoutsider', studentCardFile: pngData, studentCardFileName: 'student-card.png', consent: true }) });
  await expectStatus(outsiderRegistration, 202, 'outsider registration pending');
  const outsiderRegistrationPayload = await json(outsiderRegistration);
  await expectStatus(await outsider.request('/api/dashboard'), 401, 'outsider dashboard before email verification');
  const outsiderCode = await waitForVerificationCode(server, outsiderLogOffset);
  const verifiedOutsider = await outsider.request('/api/auth/verify-email', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': outsider.csrf() }, body: JSON.stringify({ verificationId: outsiderRegistrationPayload.verificationId, code: outsiderCode }) });
  await expectStatus(verifiedOutsider, 201, 'outsider registration verification');
  await expectStatus(await outsider.request('/api/admin/overview'), 403, 'mass assignment admin denial');
  await expectStatus(await outsider.request(uploadPayload.url), 403, 'private upload BOLA denial');
  await expectStatus(await participant.request('/api/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': participant.csrf() }, body: JSON.stringify({ description: 'Smoke description', flagUrl: uploadPayload.url }) }), 200, 'team update');
  await expectStatus(await participant.request('/api/achievements', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': participant.csrf() }, body: JSON.stringify({ title: 'Smoke achievement', direction: 'science', category: 'test', fileUrl: uploadPayload.url }) }), 403, 'portfolio window');
  await expectStatus(await participant.request('/api/notifications'), 200, 'notifications');
  assert.equal(Object.hasOwn(dashboardPayload, 'chat'), false, 'dashboard has no chat');
  assert.equal(Object.hasOwn(dashboardPayload, 'chatUnread'), false, 'dashboard has no chat unread state');

  const csrfHeaders = { 'Content-Type': 'application/json', 'X-CSRF-Token': participant.csrf() };
  await expectStatus(await participant.request('/api/chat'), 404, 'chat endpoint removed');
  await expectStatus(await participant.request('/api/chat', { method: 'POST', headers: csrfHeaders, body: JSON.stringify({ message: 'сообщение' }) }), 404, 'chat write endpoint removed');
  const rejectedChatBroadcast = await admin.request('/api/admin/notifications/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf() }, body: JSON.stringify({ targetType: 'user', targetId: dashboardPayload.user.id, title: 'Старый чат', message: 'Не должно пройти.', kind: 'chat' }) });
  await expectStatus(rejectedChatBroadcast, 422, 'chat broadcast rejected');
  const adminBroadcast = await admin.request('/api/admin/notifications/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': admin.csrf() }, body: JSON.stringify({ targetType: 'user', targetId: dashboardPayload.user.id, title: 'Уведомление оргкомитета', message: 'Проверьте данные заявки.' }) });
  await expectStatus(adminBroadcast, 201, 'admin broadcast');
  const adminBroadcastPayload = await json(adminBroadcast);
  assert.equal(adminBroadcastPayload.emailRecipients, 1, 'participant broadcast email recipient');
  assert.equal(adminBroadcastPayload.emailFailed, 0, 'participant broadcast email delivery');
  const notificationsAfterBroadcast = await json(await participant.request('/api/notifications'));
  assert.ok(notificationsAfterBroadcast.notifications.some((item) => item.message === 'Проверьте данные заявки.'), 'broadcast appears in notifications');
  const adminOverview = await json(await admin.request('/api/admin/overview'));
  assert.ok(adminOverview.notifications.every((item) => item.kind !== 'chat'), 'admin overview has no chats');
  await expectStatus(await admin.request('/api/admin/overview'), 200, 'admin overview after registration');

  const recovery = createClient(); await recovery.request('/index.html');
  const recoveryLogOffset = server.logs().length;
  const recoveryRequest = await recovery.request('/api/auth/request-password-reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': recovery.csrf() }, body: JSON.stringify({ email: outsiderEmail }) });
  await expectStatus(recoveryRequest, 202, 'password reset request');
  const recoveryCode = await waitForVerificationCode(server, recoveryLogOffset);
  const resetPassword = await recovery.request('/api/auth/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': recovery.csrf() }, body: JSON.stringify({ email: outsiderEmail, code: recoveryCode, password: 'Strong!Reset2' }) });
  await expectStatus(resetPassword, 200, 'password reset');
  const resetLogin = createClient(); await resetLogin.request('/index.html');
  const resetLoginResponse = await resetLogin.request('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': resetLogin.csrf() }, body: JSON.stringify({ email: outsiderEmail, password: 'Strong!Reset2' }) });
  await expectStatus(resetLoginResponse, 200, 'login with reset password');

  console.log('smoke: ok');
} finally {
  server.child.kill('SIGTERM');
  if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
}
