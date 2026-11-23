import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const systemChromium = ['/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    ...devices['Desktop Chrome'],
    // Use a system browser on CI/managed hosts where Playwright's downloaded shell is absent.
    ...(systemChromium
      ? { launchOptions: { executablePath: systemChromium, args: ['--no-sandbox'] } }
      : {}),
  },
  webServer: {
    command: 'node scripts/serve.mjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  reporter: [['list']],
});
