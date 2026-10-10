import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('mastra isolation', () => {
  it('only runner/mastra.ts imports @mastra/core', () => {
    const root = join(process.cwd(), 'src');
    const hits = walk(root)
      .filter((f) => /\.(ts|tsx)$/.test(f) && readFileSync(f, 'utf8').includes('@mastra/core'))
      .map((f) => relative(root, f));
    expect(hits).toEqual(['modules/tutor/runner/mastra.ts']);
  });
});
