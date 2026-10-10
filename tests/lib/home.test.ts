import { describe, expect, it } from 'vitest';
import { homeFor } from '@/lib/home';
import type { Actor, StudentStatus } from '@/modules/tenancy';

const base: Actor = { userId: 'u1', isPlatformAdmin: false, schoolId: 's1', branchId: 'b1', roles: [] };

const cases: [Partial<Actor>, StudentStatus | undefined, string][] = [
  [{ isPlatformAdmin: true, roles: [] }, undefined, '/platform'],
  [{ roles: ['school_admin'] }, undefined, '/school'],
  [{ roles: ['branch_admin'] }, undefined, '/school'],
  [{ roles: ['teacher'] }, undefined, '/teacher'],
  [{ roles: ['student'] }, 'active', '/learn'],
  [{ roles: ['student'] }, 'pending_payment', '/status'],
  [{ roles: ['student'] }, 'lapsed', '/status'],
  [{ roles: ['student'] }, undefined, '/status'],
];

describe('homeFor', () => {
  it.each(cases)('homeFor %j %s -> %s', (a, s, want) => {
    expect(homeFor({ ...base, ...a } as Actor, s)).toBe(want);
  });
});
