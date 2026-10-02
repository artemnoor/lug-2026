import { createServer, request as proxyRequest } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const host = '127.0.0.1';
const port = 4173;
const apiHost = '127.0.0.1';
const apiPort = 4174;
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2']
]);

function resolveRequestPath(requestUrl) {
  let pathname;

  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://' + host + ':' + port).pathname);
  } catch {
    return null;
  }

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  const resolvedPath = path.resolve(projectRoot, relativePath);
  const relativeToRoot = path.relative(projectRoot, resolvedPath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) return null;
  return resolvedPath;
}

const server = createServer(async (request, response) => {
  let requestPath;
  try {
    requestPath = new URL(request.url ?? '/', 'http://' + host + ':' + port).pathname;
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }

  if (requestPath === '/api' || requestPath.startsWith('/api/') || requestPath === '/uploads' || requestPath.startsWith('/uploads/')) {
    const upstream = proxyRequest({
      hostname: apiHost,
      port: apiPort,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `${apiHost}:${apiPort}` }
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });

    upstream.on('error', (error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      const body = JSON.stringify({ error: 'Локальный backend не запущен.', code: 'BACKEND_UNAVAILABLE' });
      response.writeHead(502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
      }).end(body);
    });
    request.pipe(upstream);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const filePath = resolveRequestPath(request.url ?? '/');
  if (!filePath) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const file = await fs.stat(filePath);
    const targetPath = file.isDirectory() ? path.join(filePath, 'index.html') : filePath;
    const targetFile = file.isDirectory() ? await fs.stat(targetPath) : file;

    if (!targetFile.isFile()) {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Length': targetFile.size,
      'Content-Type': mimeTypes.get(path.extname(targetPath).toLowerCase()) ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    createReadStream(targetPath).pipe(response);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      response.writeHead(404).end('Not found');
      return;
    }

    response.writeHead(500).end('Internal server error');
    process.stderr.write('[serve-site] ' + (error instanceof Error ? error.message : String(error)) + '\n');
  }
});

server.listen(port, host, () => {
  process.stdout.write('[serve-site] Listening at http://' + host + ':' + port + '/\n');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
