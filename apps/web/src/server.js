import { createServer, request as httpRequest } from 'node:http';
import { randomBytes } from 'node:crypto';
import { parseCookies, serializeCsrfCookie, CSRF_COOKIE } from '../../../packages/shared/http.js';
import { copyResponseHeaders, requestId, setSecurityHeaders } from './http.js';
import { createLogger, createMetrics } from './observability.js';
import { serveStatic } from './static.js';

function clientAddress(req) { return req.socket.remoteAddress || 'unknown'; }

export function createWebServer({ config, logger = createLogger('lug-web'), metrics = createMetrics('lug-web') }) {
  const server = createServer((req, res) => {
    const startedAt = Date.now();
    const id = requestId(req);
    const traceParent = normalizeTraceparent(req.headers.traceparent);
    res.__requestId = id;
    res.__traceParent = traceParent;
    res.setHeader('traceparent', traceParent);
    res.on('finish', () => { metrics.increment(`http_requests.${res.statusCode}`); metrics.observe('http_request_duration', Date.now() - startedAt); logger.info('http.request', { requestId: id, traceId: traceParent.split('-')[1], method: req.method, path: req.url, status: res.statusCode, durationMs: Date.now() - startedAt }); });
    try {
      if (!allowedHost(req.headers.host, config.allowedHosts)) return rejectRequest(req, res, 'Недопустимый Host.');
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const proxyIsTrusted = config.trustProxy && config.trustedProxyIps.has(normalizeAddress(clientAddress(req)));
      if (config.requireHttps && !isSecureRequest(req, proxyIsTrusted) && url.pathname !== '/healthz') return redirectToHttps(req, res);
      if (url.pathname === '/healthz') { setSecurityHeaders(res, { secure: config.secureCookies, csp: false }); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Request-Id': id }); res.end(JSON.stringify({ status: 'ok', service: 'lug-web' })); return; }
      if (url.pathname === '/readyz' || url.pathname === '/metrics') return proxy(req, res, { config, id, logger, metrics, operations: true });
      if (url.pathname === '/livez') return proxy(req, res, { config, id, logger, metrics, operations: false });
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) return proxy(req, res, { config, id, logger, metrics, operations: false });
      ensureCsrfCookie(req, res, config);
      return serveStatic(req, res, { webRoot: config.webRoot, secureCookies: config.secureCookies });
    } catch (error) {
      logger.error('http.request_failed', { requestId: id, error });
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': id });
      res.end(JSON.stringify({ error: 'Некорректный запрос.' }));
    }
  });

  server.requestTimeout = config.requestTimeoutMs;
  server.headersTimeout = Math.min(config.requestTimeoutMs, 10_000);
  server.keepAliveTimeout = 5_000;
  server.maxConnections = Number(process.env.LUG_WEB_MAX_CONNECTIONS || 2048);
  server.on('clientError', (error, socket) => { logger.warn('http.client_error', { error }); socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); });
  return server;
}

function ensureCsrfCookie(req, res, config) {
  if (!parseCookies(req.headers.cookie || '')[CSRF_COOKIE]) res.__csrfCookie = serializeCsrfCookie(randomBytes(24).toString('hex'), config.secureCookies);
  if (res.__csrfCookie) res.setHeader('Set-Cookie', res.__csrfCookie);
}

function proxy(req, res, { config, id, logger, operations = false }) {
  const rawLength = req.headers['content-length'];
  if (rawLength !== undefined && !/^\d+$/.test(String(rawLength))) {
    rejectRequest(req, res, 'Некорректная длина запроса.');
    return;
  }
  const declaredLength = rawLength === undefined ? 0 : Number(rawLength);
  if (!Number.isSafeInteger(declaredLength)) {
    rejectRequest(req, res, 'Некорректная длина запроса.');
    return;
  }
  if (Number.isFinite(declaredLength) && declaredLength > config.maxProxyBodyBytes) {
    rejectPayload(req, res, config.maxProxyBodyBytes);
    return;
  }
  const cookies = parseCookies(req.headers.cookie || '');
  res.setHeader('X-Request-Id', id);
  const proxyIsTrusted = config.trustProxy && config.trustedProxyIps.has(normalizeAddress(clientAddress(req)));
  const forwardedFor = proxyIsTrusted ? String(req.headers['x-forwarded-for'] || '').trim() : '';
  const headers = { ...req.headers, host: `${config.apiHost}:${config.apiPort}`, 'x-request-id': id, traceparent: res.__traceParent, 'x-forwarded-for': [forwardedFor, clientAddress(req)].filter(Boolean).join(', '), 'x-forwarded-proto': proxyIsTrusted ? String(req.headers['x-forwarded-proto'] || (config.secureCookies ? 'https' : 'http')) : (config.secureCookies ? 'https' : 'http') };
  if (operations) headers.authorization = config.operationsToken ? `Bearer ${config.operationsToken}` : '';
  const upstream = httpRequest({ hostname: config.apiHost, port: config.apiPort, method: req.method, path: req.url, headers, timeout: config.requestTimeoutMs }, (upstreamResponse) => {
    copyResponseHeaders(upstreamResponse, res);
    setSecurityHeaders(res, { secure: config.secureCookies, csp: false });
    res.statusCode = upstreamResponse.statusCode || 502;
    if (!cookies[CSRF_COOKIE] && !res.getHeader('Set-Cookie')) res.setHeader('Set-Cookie', serializeCsrfCookie(randomBytes(24).toString('hex'), config.secureCookies));
    upstreamResponse.pipe(res);
  });
  upstream.on('timeout', () => upstream.destroy(new Error('API proxy timeout')));
  upstream.on('error', (error) => { if (rejected) return; logger.error('proxy.failed', { requestId: id, traceId: res.__traceParent.split('-')[1], error }); if (!res.headersSent) { res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'X-Request-Id': id }); res.end(JSON.stringify({ error: 'Сервис API временно недоступен.' })); } else res.destroy(error); });
  let received = 0;
  let rejected = false;
  req.on('data', (chunk) => {
    if (rejected) return;
    received += chunk.length;
    if (received > config.maxProxyBodyBytes) {
      rejected = true;
      req.unpipe(upstream);
      upstream.destroy();
      rejectPayload(req, res, config.maxProxyBodyBytes);
    }
  });
  req.on('aborted', () => upstream.destroy());
  req.pipe(upstream);
}

function normalizeAddress(value) { return String(value || '').replace(/^::ffff:/i, ''); }

function isSecureRequest(req, proxyIsTrusted) {
  if (req.socket.encrypted) return true;
  if (!proxyIsTrusted) return false;
  return String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase() === 'https';
}

function redirectToHttps(req, res) {
  const host = String(req.headers.host || '').trim();
  res.writeHead(308, {
    Location: `https://${host}${req.url || '/'}`,
    'Cache-Control': 'no-store',
    'X-Request-Id': res.__requestId || '',
  });
  res.end();
}

function allowedHost(value, allowlist) {
  const raw = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (!raw || !allowlist?.size) return false;
  try {
    const host = new URL(`http://${raw}`).hostname.toLowerCase().replace(/\.$/, '');
    return allowlist.has(host) || allowlist.has(raw);
  } catch {
    return false;
  }
}

function normalizeTraceparent(value) {
  const candidate = String(value || '').toLowerCase();
  if (/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(candidate) && !/^00-0{32}-0{16}-/.test(candidate)) return candidate;
  return `00-${randomBytes(16).toString('hex')}-${randomBytes(8).toString('hex')}-01`;
}

function rejectPayload(req, res, maxBytes) {
  req.resume();
  if (res.headersSent) return;
  res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Request-Id': res.__requestId || '' });
  res.end(JSON.stringify({ error: `Файл или запрос превышает лимит ${Math.round(maxBytes / 1024 / 1024)} МБ.` }));
}

function rejectRequest(req, res, message) {
  req.resume();
  if (res.headersSent) return;
  res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Request-Id': res.__requestId || '' });
  res.end(JSON.stringify({ error: message }));
}

export function startWebServer(options) {
  const server = createWebServer(options);
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.config.webPort, options.config.webHost, () => resolve(server)); });
}
