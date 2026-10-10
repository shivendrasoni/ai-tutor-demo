import { describe, expect, it } from 'vitest';
import { DomainError } from '@/lib/errors';
import { handle } from '@/lib/http';

describe('handle: tutor error codes', () => {
  it('maps new codes', async () => {
    const r1 = await handle(async () => { throw new DomainError('BUDGET_EXCEEDED', 'x'); })(new Request('http://x'));
    expect(r1.status).toBe(429);
    expect((await r1.json()).error.code).toBe('BUDGET_EXCEEDED');
    const r2 = await handle(async () => { throw new DomainError('TUTOR_BUSY', 'x'); })(new Request('http://x'));
    expect(r2.status).toBe(503);
  });
});
