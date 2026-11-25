import { defineConfig, devices } from '@playwright/test';

/** Mobile-viewport smoke test against the production build (S23 in Chrome ≈ 360×780 CSS px). */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173/mealheiro/',
    trace: 'off',
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Galaxy S9+'],
        viewport: { width: 360, height: 780 },
        deviceScaleFactor: 3,
      },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/mealheiro/',
    reuseExistingServer: !process.env.CI,
  },
});
