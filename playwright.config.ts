import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const systemChromium = ['/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const basePath = process.env.RAIDE_BASE_PATH || '/';
const appUrl = `http://127.0.0.1:4173${basePath}`;

export default defineConfig({
  testDir: './e2e',
  workers: process.env.CI ? 2 : undefined,
  maxFailures: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: appUrl,
    ...devices['Desktop Chrome'],
    // Use a system browser on CI/managed hosts where Playwright's downloaded shell is absent.
    ...(systemChromium
      ? { launchOptions: { executablePath: systemChromium, args: ['--no-sandbox'] } }
      : {}),
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    url: appUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  reporter: [['list']],
});
