import { createWebConfig } from './src/config.js';
import { createLogger, createMetrics } from './src/observability.js';
import { startWebServer } from './src/server.js';

const config = createWebConfig();
await startWebServer({ config, logger: createLogger('lug-web'), metrics: createMetrics('lug-web') });
console.log(`ЛУГ web доступен на http://${config.webHost}:${config.webPort}`);
