import { config } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

// The e2e suite runs against the TEST database (tutor_test), never the dev DB. Loaded here so both the
// spec workers (which seed via module functions) and the Next server below see the same URLs.
config({ path: '.env.test', override: true, quiet: true });

const PORT = 3100;
const APP_URL = `http://localhost:${PORT}`;
process.env.APP_URL = APP_URL;

const serverEnv: Record<string, string> = {
  DATABASE_URL_OWNER: process.env.DATABASE_URL_OWNER!,
  DATABASE_URL_APP: process.env.DATABASE_URL_APP!,
  DATABASE_URL_ADMIN: process.env.DATABASE_URL_ADMIN!,
  APP_URL,
  NEXT_TELEMETRY_DISABLED: '1',
};

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: APP_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `pnpm next dev -p ${PORT}`,
    url: `${APP_URL}/api/plans`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: serverEnv,
  },
});
