import { afterEach, describe, expect, it, vi } from 'vitest';
import { toSse } from '@/lib/sse';
import type { TurnEvent } from '@/modules/tutor';

afterEach(() => vi.restoreAllMocks());

describe('toSse', () => {
  it('logs a swallowed mid-stream error (redacted) before emitting TUTOR_BUSY', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    async function* events(): AsyncGenerator<TurnEvent> {
      yield { type: 'meta', data: { messageId: 'm', skill: 's', modelTier: 'standard' } };
      throw new Error('boom');
    }
    const res = await toSse(events());
    const text = await res.text();
    expect(text).toContain('event: error');
    expect(text).toContain('TUTOR_BUSY');
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ name: 'Error', message: 'boom' }));
  });
});
