import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  outputDir: 'test-results/app',
  testDir: 'tests/app',
  workers: 2,
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: `MEMO_DATA_DIR=tmp/app-browser-${process.pid} pnpm dev --port 0`,
    wait: { stdout: /Local:.*localhost:(?<memo_app_port>\d+)/ },
    timeout: 30000,
  },
});
