import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

config({ path: '.env.test', override: true, quiet: true });

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } }, // tsconfig has jsx: preserve (Next compiles JSX)
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    fileParallelism: false,
    globalSetup: ['tests/setup/global.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
