import { describe, expect, it } from 'vitest';
import { redactError } from '@/lib/redact';

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$FAKEHASH';

describe('redactError', () => {
  it('keeps stack frames but not the message header, SQL, params or hashes', () => {
    const err = new Error(`Failed query: insert into "users" values ($1)\nparams: bob,${HASH}`, {
      cause: Object.assign(new Error(`dup ${HASH}`), { code: '23505' }),
    });
    const r = redactError(err) as { name: string; message: string; code?: string; stack?: string; cause?: { code?: string; message?: string } };
    expect(r.name).toBe('Error');
    expect(r.message).toBe('Failed query');
    expect(r.cause?.code).toBe('23505');
    expect(r.cause?.message).not.toContain('FAKEHASH');
    expect(r.stack).toMatch(/^\s+at /);
    expect(r.stack).not.toContain('Failed query');
    const all = JSON.stringify(r);
    expect(all).not.toContain('insert into');
    expect(all).not.toContain('bob');
    expect(all).not.toContain('FAKEHASH');
  });

  it('keeps a top-level driver code', () => {
    const r = redactError(Object.assign(new Error('boom'), { code: 'ECONNRESET' }));
    expect(r.code).toBe('ECONNRESET');
    expect(r.message).toBe('boom');
  });
});
