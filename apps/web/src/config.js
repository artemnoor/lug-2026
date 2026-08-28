// Configuration for the static web gateway.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export function createWebConfig(env = process.env) {
  const root = resolve(env.LUG_ROOT || PROJECT_ROOT);
  return {
    root,
    webRoot: resolve(env.LUG_WEB_ROOT || `${root}/apps/web/public`),
    apiHost: env.LUG_API_HOST || '127.0.0.1',
    apiPort: Number(env.LUG_API_PORT || 4174),
    webHost: env.LUG_WEB_HOST || '127.0.0.1',
    webPort: Number(env.PORT || env.LUG_WEB_PORT || 4173),
    trustProxy: env.LUG_TRUST_PROXY === 'true',
    trustedProxyIps: new Set(String(env.LUG_TRUSTED_PROXY_IPS || '').split(',').map((value) => value.trim()).filter(Boolean)),
    operationsToken: String(env.LUG_OPERATIONS_TOKEN || ''),
    maxProxyBodyBytes: Math.max(1, Number(env.LUG_MAX_PROXY_BODY_BYTES || 76 * 1024 * 1024)),
    requestTimeoutMs: Number(env.LUG_REQUEST_TIMEOUT_MS || 30_000),
    secureCookies: env.LUG_SECURE_COOKIES === 'true' || env.NODE_ENV === 'production'
  };
}
