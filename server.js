import { spawn } from "node:child_process";
import { createWebConfig } from "./apps/web/src/config.js";
import { createLogger, createMetrics } from "./apps/web/src/observability.js";
import { startWebServer } from "./apps/web/src/server.js";

const config = createWebConfig();
const webLogger = createLogger("lug-web");
const webMetrics = createMetrics("lug-web");

const apiProcess = spawn(
  process.env.LUG_PYTHON || "python",
  [
    "-B",
    "-m",
    "uvicorn",
    "app.main:app",
    "--app-dir",
    "apps/api",
    "--host",
    config.apiHost,
    "--port",
    String(config.apiPort),
    "--no-access-log",
  ],
  {
    cwd: config.root,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdio: "inherit",
    windowsHide: true,
  },
);
await waitForApi(config);
const webServer = await startWebServer({
  config,
  logger: webLogger,
  metrics: webMetrics,
});

console.log(`ЛУГ API доступен на http://${config.apiHost}:${config.apiPort}`);
console.log(`ЛУГ web доступен на http://${config.webHost}:${config.webPort}`);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  webLogger.info("process.shutdown", { signal });
  await closeServer(webServer, 10_000);
  if (apiProcess.exitCode === null) {
    apiProcess.kill("SIGTERM");
    await waitForExit(apiProcess, 10_000);
    if (apiProcess.exitCode === null) apiProcess.kill("SIGKILL");
  }
  process.exitCode = signal === "api_exit" ? 1 : 0;
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
apiProcess.once("exit", (code) => {
  if (!shuttingDown) {
    webLogger.error("api.process_exit", { code });
    void shutdown("api_exit");
  }
});

async function waitForApi(runtimeConfig) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (
        (
          await fetch(
            `http://${runtimeConfig.apiHost}:${runtimeConfig.apiPort}/healthz`,
          )
        ).ok
      )
        return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  apiProcess.kill("SIGTERM");
  throw new Error("FastAPI process did not become ready.");
}

function closeServer(server, timeoutMs) {
  return new Promise((resolve) => {
    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, timeoutMs);
    server.close(finish);
  });
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
