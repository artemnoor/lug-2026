// Web gateway HTTP utilities.

import { randomUUID } from "node:crypto";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function requestId(req) {
  const incoming = String(req.headers["x-request-id"] || "").trim();
  return /^[a-zA-Z0-9._:-]{1,120}$/.test(incoming) ? incoming : randomUUID();
}

export function copyResponseHeaders(source, target) {
  for (const [key, value] of Object.entries(source.headers || {})) {
    if (!HOP_BY_HOP.has(key.toLowerCase()) && value !== undefined)
      target.setHeader(key, value);
  }
}

export function setSecurityHeaders(res, { secure = false, csp = false } = {}) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (csp)
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: blob: https:; media-src 'self' https:; frame-src 'self' https://rutube.ru https://vk.com https://vkvideo.ru; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'",
    );
  if (secure)
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
}
