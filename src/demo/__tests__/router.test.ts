import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError, clearRoutes, dispatch, registerRoutes } from '../core/router';

describe('demo router', () => {
  beforeEach(() => {
    clearRoutes();
    registerRoutes({
      'GET /api/x/:id': ({ params }) => ({ id: params.id }),
      'POST /api/x': ({ body }) => ({ got: body }),
      'POST /api/bad': () => {
        throw new ApiError(409, 'USERNAME_TAKEN', 'taken');
      },
      'POST /api/none': () => null,
    });
  });
  const u = (p: string) => new URL(p, 'http://localhost');
  it('matches params and parses JSON', async () => {
    expect(await (await dispatch('GET', u('/api/x/a%20b'))).json()).toEqual({ id: 'a b' });
    expect(await (await dispatch('POST', u('/api/x'), { body: '{"a":1}' })).json()).toEqual({ got: { a: 1 } });
  });
  it('maps ApiError, 204 and unknown routes', async () => {
    const bad = await dispatch('POST', u('/api/bad'));
    expect(bad.status).toBe(409);
    expect((await bad.json()).error.code).toBe('USERNAME_TAKEN');
    expect((await dispatch('POST', u('/api/none'))).status).toBe(204);
    expect((await dispatch('GET', u('/api/nope'))).status).toBe(404);
  });
});
