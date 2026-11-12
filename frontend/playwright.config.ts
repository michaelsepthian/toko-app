import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3007',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --hostname 127.0.0.1 --port 3007',
    url: 'http://127.0.0.1:3007',
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: '.next-test',
      NEXT_PUBLIC_API_BASE_URL: 'http://api.test/api/v1',
    },
  },
})
