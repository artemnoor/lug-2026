// Configuration for the static web gateway.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function createWebConfig(env = process.env) {
  const root = resolve(env.LUG_ROOT || PROJECT_ROOT);
  const nodeEnv = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const configuredHosts = env.LUG_ALLOWED_HOSTS ?? (nodeEnv === 'production' ? '' : '127.0.0.1,localhost');
  const allowedHosts = new Set(String(configuredHosts).split(',').map((value) => value.trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));
  const operationsToken = String(env.LUG_OPERATIONS_TOKEN || '').trim();
  const hardenedEnv = nodeEnv === 'staging' || nodeEnv === 'production';
  const trustProxy = env.LUG_TRUST_PROXY === 'true';
  const trustedProxyIps = new Set(String(env.LUG_TRUSTED_PROXY_IPS || '').split(',').map((value) => value.trim()).filter(Boolean));
  const requireHttps = env.LUG_REQUIRE_HTTPS === undefined
    ? hardenedEnv
    : env.LUG_REQUIRE_HTTPS === 'true';
  if (hardenedEnv && !requireHttps) throw new Error('В staging/production нужен LUG_REQUIRE_HTTPS=true.');
  if (hardenedEnv && (!trustProxy || !trustedProxyIps.size)) throw new Error('В staging/production нужны LUG_TRUST_PROXY=true и LUG_TRUSTED_PROXY_IPS.');
  if (hardenedEnv && (!allowedHosts.size || [...allowedHosts].some((host) => host.includes('*')))) throw new Error('В staging/production нужен явный LUG_ALLOWED_HOSTS без wildcard.');
  if (hardenedEnv && operationsToken.trim().length < 32) throw new Error('В staging/production нужен LUG_OPERATIONS_TOKEN длиной минимум 32 символа.');
  return {
    root,
    webRoot: resolve(env.LUG_WEB_ROOT || `${root}/apps/web/public`),
    apiHost: env.LUG_API_HOST || '127.0.0.1',
    apiPort: Number(env.LUG_API_PORT || 4174),
    webHost: env.LUG_WEB_HOST || '127.0.0.1',
    webPort: Number(env.PORT || env.LUG_WEB_PORT || 4173),
    trustProxy,
    trustedProxyIps,
    operationsToken,
    maxProxyBodyBytes: Math.max(1, Number(env.LUG_MAX_PROXY_BODY_BYTES || 76 * 1024 * 1024)),
    requestTimeoutMs: Number(env.LUG_REQUEST_TIMEOUT_MS || 30_000),
    secureCookies: env.LUG_SECURE_COOKIES === 'true' || hardenedEnv,
    requireHttps,
    allowedHosts
  };
}
