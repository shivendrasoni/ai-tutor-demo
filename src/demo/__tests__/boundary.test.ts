import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN = [/from ['"]@\/modules/, /from ['"]@\/db/, /from ['"]next\/headers['"]/, /from ['"]pg['"]/, /from ['"]drizzle-orm/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(p) && !p.includes('__tests__') ? [p] : [];
  });
}

describe('demo import boundary', () => {
  it('never imports server-only code', () => {
    for (const f of files('src/demo')) {
      const src = readFileSync(f, 'utf8');
      for (const re of FORBIDDEN) expect(src, f).not.toMatch(re);
    }
  });
});
