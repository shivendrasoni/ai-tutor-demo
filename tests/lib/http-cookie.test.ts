import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSessionCookie, sessionCookie } from '@/lib/http';

afterEach(() => vi.unstubAllEnvs());

describe('session cookie flags', () => {
  it('sets sid with HttpOnly, SameSite=Lax, Path=/ and a 30-day Max-Age', () => {
    vi.stubEnv('NODE_ENV', 'test');
    const c = sessionCookie('tok');
    expect(c).toMatch(/^sid=tok;/);
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=2592000');
    expect(c).not.toContain('Secure');
  });

  it('adds Secure in production (set and clear)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(sessionCookie('tok')).toContain('; Secure');
    expect(clearSessionCookie()).toContain('; Secure');
  });
});
