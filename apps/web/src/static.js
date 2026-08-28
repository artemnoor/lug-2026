import { createReadStream, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { setSecurityHeaders } from './http.js';

const PUBLIC_PAGE_FILES = new Set(['index.html', 'cabinet.html', 'admin.html', 'privacy.html', 'rules.html', 'register.html', 'results.html', 'api.html']);
const PUBLIC_FILES = new Set(['favicon.svg']);
const PUBLIC_DIRECTORIES = new Set(['assets', 'css', 'fonts', 'js']);
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.ttf': 'font/ttf', '.otf': 'font/otf' };

export function safeStaticPath(urlPath, webRoot) {
  let decoded;
  try { decoded = decodeURIComponent(String(urlPath).split('?')[0]); } catch { return null; }
  const requested = decoded === '/' ? 'index.html' : decoded.replace(/^[/\\]+/, '');
  const normalized = normalize(requested);
  const relative = normalized.replace(/\\/g, '/');
  if (!relative || relative === '..' || relative.startsWith('../') || relative.includes('/../')) return null;
  const first = relative.split('/')[0];
  const isPublicFile = PUBLIC_FILES.has(relative);
  const isPublicPage = PUBLIC_PAGE_FILES.has(relative);
  const isPublicAsset = PUBLIC_DIRECTORIES.has(first) && relative.includes('/');
  if (isPublicPage) return join(webRoot, 'pages', normalized);
  return isPublicFile || isPublicAsset ? join(webRoot, normalized) : null;
}

export function serveStatic(req, res, { webRoot, secureCookies = false }) {
  const path = safeStaticPath(req.url || '/', webRoot);
  if (!path || !existsSync(path)) { setSecurityHeaders(res, { secure: secureCookies, csp: false }); res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Request-Id': res.__requestId }); res.end('Not found'); return; }
  setSecurityHeaders(res, { secure: secureCookies, csp: true });
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('X-Request-Id', res.__requestId || '');
  res.setHeader('Content-Type', CONTENT_TYPES[extname(path).toLowerCase()] || 'application/octet-stream');
  createReadStream(path).pipe(res);
}
