import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:4173/healthz',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NODE_ENV: 'test',
      LUG_EMAIL_VERIFICATION_SECRET: 'playwright-test-secret',
      LUG_UPLOAD_SCAN_REQUIRED: 'false',
      LUG_DATA_DIR: '.playwright-data',
      LUG_UPLOAD_DIR: '.playwright-uploads',
      LUG_ADMIN_EMAIL: 'admin@playwright.test',
      LUG_ADMIN_PASSWORD: 'Strong!Admin1',
      PORT: '4173',
      LUG_API_PORT: '4174',
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
