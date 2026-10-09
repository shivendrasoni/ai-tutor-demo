import { defineConfig } from 'vitest/config';
import { config } from 'dotenv';

config({ path: '.env.test', override: true, quiet: true });

export default defineConfig({
  test: {
    fileParallelism: false,
    globalSetup: ['tests/setup/global.ts'],
    include: ['tests/**/*.test.ts'],
  },
});
