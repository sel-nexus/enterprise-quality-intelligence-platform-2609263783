import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';

// The runner passes these ephemeral credentials to its workers and the server.
process.env.E2E_ADMIN_EMAIL ||= `admin-${randomBytes(8).toString('hex')}@example.test`;
process.env.E2E_ADMIN_PASSWORD ||= randomBytes(24).toString('hex');
process.env.E2E_AUTH_SECRET ||= randomBytes(32).toString('hex');

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'e2e-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4173', browserName: 'chromium', screenshot: 'on', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node e2e/start-servers.mjs',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        E2E_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL,
        E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
        E2E_AUTH_SECRET: process.env.E2E_AUTH_SECRET,
        E2E_FRONTEND_PORT: '4173', E2E_BACKEND_PORT: '4300'
      }
    },
    {
      command: 'node e2e/start-servers.mjs',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        E2E_ADMIN_EMAIL: process.env.E2E_ADMIN_EMAIL,
        E2E_ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD,
        E2E_AUTH_SECRET: process.env.E2E_AUTH_SECRET,
        E2E_FRONTEND_PORT: '4174', E2E_BACKEND_PORT: '4301'
      }
    }
  ]
});
