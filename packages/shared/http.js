export const CSRF_COOKIE = 'lug_csrf';

export function parseCookies(header = '') {
  const result = {};
  for (const part of String(header).split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
  }
  return result;
}
export function serializeCsrfCookie(token, secure = false) {
  return `${CSRF_COOKIE}=${encodeURIComponent(token)}; SameSite=Lax; Path=/; Max-Age=604800${secure ? '; Secure' : ''}`;
}
