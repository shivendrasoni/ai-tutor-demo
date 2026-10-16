import { defineConfig } from '@playwright/test';

// The demo needs no DB: this config only starts the built app (`pnpm build` first).
export default defineConfig({
  testDir: 'e2e-demo',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3200' },
  webServer: { command: 'pnpm exec next start -p 3200', url: 'http://localhost:3200/login', reuseExistingServer: true, timeout: 60_000 },
});
