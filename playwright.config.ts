import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  outputDir: 'test-results/editor',
  testDir: './tests/browser',
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit-mobile', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'pnpm dev:spike --port 0',
    wait: { stdout: /Local:.*127\.0\.0\.1:(?<memo_test_port>\d+)/ },
    timeout: 20000,
  },
});
