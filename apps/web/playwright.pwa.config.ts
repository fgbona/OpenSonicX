import { defineConfig, devices } from '@playwright/test';

// The installable, offline app needs the production static export (`next dev` has no service
// worker): built here under the GitHub Pages base path, then served like Pages does.
// E2E_PWA_PORT: another port when 3200 is taken.
const PORT = Number(process.env.E2E_PWA_PORT ?? 3200);

export default defineConfig({
  testDir: 'e2e',
  testMatch: 'pwa.spec.ts',
  // One server, one sw.js: the update test changes it for every page.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, locale: 'en-US', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && node e2e/serve-export.ts ${PORT}`,
    env: { NEXT_OUTPUT: 'export', NEXT_BASE_PATH: '/OpenSonicX' },
    url: `http://localhost:${PORT}/OpenSonicX/`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
