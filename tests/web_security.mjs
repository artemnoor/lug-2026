import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createWebConfig } from "../apps/web/src/config.js";
import { createWebServer } from "../apps/web/src/server.js";

const production = createWebConfig({
  NODE_ENV: "production",
  LUG_ALLOWED_HOSTS: "lug.example.test",
  LUG_OPERATIONS_TOKEN: "x".repeat(32),
  LUG_TRUST_PROXY: "true",
  LUG_TRUSTED_PROXY_IPS: "127.0.0.1",
});
assert.equal(production.requireHttps, true);
assert.equal(production.secureCookies, true);
assert.throws(() =>
  createWebConfig({
    NODE_ENV: "production",
    LUG_ALLOWED_HOSTS: "lug.example.test",
    LUG_OPERATIONS_TOKEN: "x".repeat(32),
    LUG_REQUIRE_HTTPS: "false",
  }),
);
assert.equal(createWebConfig({ NODE_ENV: "development" }).requireHttps, false);

const logger = { info() {}, warn() {}, error() {} };
const metrics = { increment() {}, observe() {} };
const server = createWebServer({
  config: { ...production, webHost: "127.0.0.1", webPort: 0 },
  logger,
  metrics,
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const response = await new Promise((resolve, reject) => {
  const client = request(
    {
      hostname: "127.0.0.1",
      port,
      path: "/api/auth/register-team",
      headers: { Host: "lug.example.test" },
    },
    resolve,
  );
  client.on("error", reject);
  client.end();
});
assert.equal(response.statusCode, 308);
assert.equal(
  response.headers.location,
  "https://lug.example.test/api/auth/register-team",
);
response.resume();
await new Promise((resolve) => server.close(resolve));

const upstream = createServer((req, res) => {
  assert.equal(req.headers.host, "lug.example.test");
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
});
await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
const upstreamPort = upstream.address().port;
const proxy = createWebServer({
  config: {
    ...production,
    requireHttps: false,
    apiHost: "127.0.0.1",
    apiPort: upstreamPort,
    webHost: "127.0.0.1",
    webPort: 0,
  },
  logger,
  metrics,
});
await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const proxyPort = proxy.address().port;
const proxied = await new Promise((resolve, reject) => {
  const client = request(
    {
      hostname: "127.0.0.1",
      port: proxyPort,
      path: "/api/config",
      headers: { Host: "lug.example.test" },
    },
    resolve,
  );
  client.on("error", reject);
  client.end();
});
assert.equal(proxied.statusCode, 200);
proxied.resume();
await new Promise((resolve) => proxy.close(resolve));
await new Promise((resolve) => upstream.close(resolve));
console.log("web-security: ok");
