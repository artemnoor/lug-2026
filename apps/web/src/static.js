import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createGzip, gzipSync } from "node:zlib";
import { setSecurityHeaders } from "./http.js";

const PUBLIC_PAGE_FILES = new Set([
  "index.html",
  "cabinet.html",
  "admin.html",
  "privacy.html",
  "rules.html",
  "register.html",
  "results.html",
  "api.html",
]);
const PUBLIC_FILES = new Set(["favicon.svg"]);
const PUBLIC_DIRECTORIES = new Set(["assets", "css", "fonts", "js"]);
const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

export function safeStaticPath(urlPath, webRoot) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath).split("?")[0]);
  } catch {
    return null;
  }
  const requested =
    decoded === "/" ? "index.html" : decoded.replace(/^[/\\]+/, "");
  const normalized = normalize(requested);
  const relative = normalized.replace(/\\/g, "/");
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith("../") ||
    relative.includes("/../")
  )
    return null;
  const first = relative.split("/")[0];
  const isPublicFile = PUBLIC_FILES.has(relative);
  const isPublicPage = PUBLIC_PAGE_FILES.has(relative);
  const isPublicAsset = PUBLIC_DIRECTORIES.has(first) && relative.includes("/");
  if (isPublicPage) return join(webRoot, "pages", normalized);
  return isPublicFile || isPublicAsset ? join(webRoot, normalized) : null;
}

export function serveStatic(
  req,
  res,
  { webRoot, secureCookies = false, publicBaseUrl = "" },
) {
  const path = safeStaticPath(req.url || "/", webRoot);
  if (!path || !existsSync(path)) {
    setSecurityHeaders(res, { secure: secureCookies, csp: false });
    res.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Request-Id": res.__requestId,
    });
    res.end("Not found");
    return;
  }
  setSecurityHeaders(res, { secure: secureCookies, csp: true });
  const extension = extname(path).toLowerCase();
  const compressible = new Set([".html", ".js", ".css", ".svg", ".json"]).has(
    extension,
  );
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(
    String(req.headers["accept-encoding"] || ""),
  );
  const cacheControl = new Set([".css", ".js"]).has(extension)
    ? /\.[a-f0-9]{12}\.(?:css|js)$/.test(path)
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300, stale-while-revalidate=86400"
    : new Set([
          ".svg",
          ".png",
          ".jpg",
          ".jpeg",
          ".webp",
          ".avif",
          ".gif",
          ".ttf",
          ".otf",
        ]).has(extension)
      ? "public, max-age=86400, stale-while-revalidate=604800"
      : "no-store, max-age=0";
  res.setHeader("Cache-Control", cacheControl);
  if (cacheControl.startsWith("no-store")) {
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  res.setHeader("X-Request-Id", res.__requestId || "");
  res.setHeader(
    "Content-Type",
    CONTENT_TYPES[extension] || "application/octet-stream",
  );
  if (extension === ".html") {
    let html = resolveHtmlIncludes(
      readFileSync(path, "utf8"),
      join(webRoot, "pages"),
    );
    if (publicBaseUrl && path.endsWith(join("pages", "index.html"))) {
      html = html.replaceAll("__PUBLIC_BASE_URL__", publicBaseUrl);
    }
    if (compressible && acceptsGzip) {
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      res.end(gzipSync(html, { level: 6 }));
      return;
    }
    res.end(html);
    return;
  }
  if (compressible && acceptsGzip) {
    const brotliPath = `${path}.br`;
    const gzipPath = `${path}.gz`;
    const acceptsBrotli = /(?:^|,)\s*br\s*(?:,|$)/i.test(
      String(req.headers["accept-encoding"] || ""),
    );
    if (acceptsBrotli && existsSync(brotliPath)) {
      res.setHeader("Content-Encoding", "br");
      res.setHeader("Vary", "Accept-Encoding");
      createReadStream(brotliPath).pipe(res);
      return;
    }
    if (acceptsGzip && existsSync(gzipPath)) {
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      createReadStream(gzipPath).pipe(res);
      return;
    }
    if (acceptsGzip) {
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Accept-Encoding");
      createReadStream(path)
        .pipe(createGzip({ level: 6 }))
        .pipe(res);
      return;
    }
  }
  createReadStream(path).pipe(res);
}

function resolveHtmlIncludes(html, pagesDirectory, stack = []) {
  return html.replace(
    /<!--\s*@include:\s*([^\s]+)\s*-->/g,
    (_, relativePath) => {
      if (!relativePath.startsWith("partials/") || stack.includes(relativePath))
        return "";
      const partial = join(pagesDirectory, relativePath);
      if (!existsSync(partial)) return "";
      return resolveHtmlIncludes(
        readFileSync(partial, "utf8"),
        pagesDirectory,
        [...stack, relativePath],
      );
    },
  );
}
