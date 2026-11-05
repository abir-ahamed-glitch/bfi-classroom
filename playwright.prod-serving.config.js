import { defineConfig, devices } from '@playwright/test';

process.env.TEST_PORT = process.env.TEST_PORT || '3098';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3098/bfi-classroom/',
    trace: 'off',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    permissions: ['camera', 'microphone'],
    launchOptions: {
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'node server/staging-server.js',
      url: 'http://127.0.0.1:3098/api/health',
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        PORT: '3098',
        NODE_ENV: 'production',
        IS_STAGING_SERVER: 'true',
        DISABLE_OUTBOUND_NOTIFICATIONS: 'true',
        TEST_PORT: '3098',
      },
    },
  ],
});
