import { spawn } from 'node:child_process';
import { createWebConfig } from './apps/web/src/config.js';
import { createLogger, createMetrics } from './apps/web/src/observability.js';
import { startWebServer } from './apps/web/src/server.js';

const config = createWebConfig();
const webLogger = createLogger('lug-web');
const webMetrics = createMetrics('lug-web');

const apiProcess = spawn(process.env.LUG_PYTHON || 'python', ['-B', '-m', 'uvicorn', 'app.main:app', '--app-dir', 'apps/api', '--host', config.apiHost, '--port', String(config.apiPort), '--no-access-log'], { cwd: config.root, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'inherit', windowsHide: true });
await waitForApi(config);
const webServer = await startWebServer({ config, logger: webLogger, metrics: webMetrics });

console.log(`ЛУГ API доступен на http://${config.apiHost}:${config.apiPort}`);
console.log(`ЛУГ web доступен на http://${config.webHost}:${config.webPort}`);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  webLogger.info('process.shutdown', { signal });
  await new Promise((resolve) => webServer.close(resolve));
  apiProcess.kill('SIGTERM');
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
apiProcess.once('exit', (code) => { if (!shuttingDown) { webLogger.error('api.process_exit', { code }); void shutdown('api_exit'); } });

async function waitForApi(runtimeConfig) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch(`http://${runtimeConfig.apiHost}:${runtimeConfig.apiPort}/healthz`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  apiProcess.kill('SIGTERM');
  throw new Error('FastAPI process did not become ready.');
}
