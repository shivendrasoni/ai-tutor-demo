import { afterAll, describe, expect, it, vi } from 'vitest';
import { closeDb } from '@/db/client';

const SECRET = '$argon2id$v=19$m=19456,t=2,p=1$c2VjcmV0c2FsdA$FAKEHASHFAKEHASH';

vi.mock('@/modules/enrollment', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/modules/enrollment')>();
  return {
    ...orig,
    createPlan: vi.fn(async () => {
      throw new Error(
        `Failed query: insert into "users" ("username", "password_hash") values ($1, $2)\nparams: secret_user,${SECRET}`,
        { cause: Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }) },
      );
    }),
  };
});

const { run } = await import('../../scripts/admin');

afterAll(closeDb);

describe('scripts/admin run() unexpected errors', () => {
  it('prints a redacted summary: no SQL, params, usernames or hashes', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await run(
      ['create-plan', '--name', 'X', '--interval', 'monthly', '--price-minor', '100'],
      { out: (s) => out.push(s), err: (s) => err.push(s) },
    );
    expect(code).toBe(1);
    const printed = [...out, ...err].join('\n');
    expect(printed).not.toContain('FAKEHASH');
    expect(printed).not.toContain('secret_user');
    expect(printed).not.toContain('insert into');
    expect(printed).toContain('Failed query');
    expect(printed).toContain('23505');
  });
});
