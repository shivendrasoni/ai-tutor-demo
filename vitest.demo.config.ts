import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// The demo has no DB: its tests run without the global DB setup in vitest.config.ts.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { include: ['src/demo/**/*.test.{ts,tsx}'], environment: 'node' },
});
