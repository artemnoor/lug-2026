import { createWebConfig } from './src/config.js';
import { createLogger, createMetrics } from './src/observability.js';
import { startWebServer } from './src/server.js';

const config = createWebConfig();
const server = await startWebServer({ config, logger: createLogger('lug-web'), metrics: createMetrics('lug-web') });
console.log(`ЛУГ web доступен на http://${config.webHost}:${config.webPort}`);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  const timer = setTimeout(() => server.closeAllConnections?.(), 10_000);
  await new Promise((resolve) => server.close(resolve));
  clearTimeout(timer);
  console.log(`ЛУГ web завершает работу (${signal})`);
}

process.once('SIGINT', () => { void shutdown('SIGINT'); });
process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
