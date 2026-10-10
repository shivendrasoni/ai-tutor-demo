import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

describe('pnpm worker boot', () => {
  it('starts with DATABASE_URL_* provided only by a .env file (loader runs before db imports)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'worker-boot-'));
    writeFileSync(join(dir, '.env'), readFileSync(join(root, '.env.test'), 'utf8').replace('./.blob-test', join(dir, 'blobs')));
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const k of ['DATABASE_URL_OWNER', 'DATABASE_URL_APP', 'DATABASE_URL_ADMIN', 'BLOB_DIR', 'EMBEDDER', 'OCR_MODEL', 'S3_BUCKET']) delete env[k];
    const child = spawn(
      resolve(root, 'node_modules/.bin/tsx'),
      ['--tsconfig', resolve(root, 'tsconfig.json'), resolve(root, 'src/worker.ts')],
      { cwd: dir, env },
    );
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const exited = new Promise<number | null>((r) => child.on('exit', (c) => r(c)));
    try {
      const result = await Promise.race([
        exited.then((code) => `exit ${code}`),
        new Promise<string>((r) => {
          const t = setInterval(() => {
            if (out.includes('[worker] ingest worker started')) {
              clearInterval(t);
              r('started');
            }
          }, 100);
        }),
        new Promise<string>((r) => setTimeout(() => r('timeout'), 20_000)),
      ]);
      expect({ result, out: result === 'started' ? '' : out }).toEqual({ result: 'started', out: '' });
    } finally {
      child.kill('SIGTERM');
      await exited;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 40_000);
});
