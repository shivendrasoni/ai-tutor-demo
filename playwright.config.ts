import { resolve } from 'node:path';
import { config } from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

// The e2e suite runs against the TEST database (tutor_test), never the dev DB. Loaded here so both the
// spec workers (which seed via module functions) and the Next server below see the same URLs.
config({ path: '.env.test', override: true, quiet: true });

const PORT = 3100;
const APP_URL = `http://localhost:${PORT}`;
process.env.APP_URL = APP_URL;
// One absolute blob dir shared by the web server (uploads) and the in-process worker (global-setup).
process.env.BLOB_DIR = resolve(process.env.BLOB_DIR ?? '.blob-test');
process.env.EMBEDDER = 'fake';
process.env.AI_MOCK = '1'; // keyless runs use the mock providers (also read by the in-process worker in global-setup)

const serverEnv: Record<string, string> = {
  DATABASE_URL_OWNER: process.env.DATABASE_URL_OWNER!,
  DATABASE_URL_APP: process.env.DATABASE_URL_APP!,
  DATABASE_URL_ADMIN: process.env.DATABASE_URL_ADMIN!,
  APP_URL,
  EMBEDDER: 'fake',
  AI_MOCK: '1',
  DECIDER: 'mock', // .env.test sets DECIDER=none; the e2e server exercises the MockDecider routing instead
  BLOB_DIR: process.env.BLOB_DIR,
  NEXT_TELEMETRY_DISABLED: '1',
  // Every spec logs in / joins from the same IP, so the production rate limits (see src/lib/rate-limit.ts)
  // are raised here. The limiter is still active; it just can't trip within one e2e run.
  RATE_LIMIT_LOGIN_USER: '10000',
  RATE_LIMIT_LOGIN_IP: '10000',
  RATE_LIMIT_JOIN_LOOKUP: '10000',
  RATE_LIMIT_JOIN_SUBMIT: '10000',
};

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  // `next dev` compiles each route on first hit (seconds under load), so the 5 s default is too tight for first-render assertions.
  expect: { timeout: 15_000 },
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
