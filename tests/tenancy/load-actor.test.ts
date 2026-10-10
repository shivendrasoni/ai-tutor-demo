import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, withPlatform } from '@/db/client';
import { memberships, studentProfiles } from '@/db/schema';
import { loadActor } from '@/modules/tenancy';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';

let seed: Seed;
beforeEach(async () => {
  await resetDb();
  seed = await seedTwoSchools();
});
afterAll(closeDb);

describe('loadActor with more than one membership', () => {
  it('deterministically picks the oldest membership (created_at, id), regardless of insert order', async () => {
    const userId = seed.a.teacherId;
    // Newer membership in school B is inserted first; the older original (school A) must still win.
    await withPlatform(async (tx) => {
      await tx.update(memberships).set({ createdAt: new Date('2026-01-01T00:00:00Z') }).where(eq(memberships.userId, userId));
      await tx.insert(memberships).values({
        userId, schoolId: seed.b.schoolId, branchId: seed.b.branchId, role: 'teacher', createdAt: new Date('2026-06-01T00:00:00Z'),
      });
    });
    for (let i = 0; i < 5; i++) {
      const actor = await withPlatform((tx) => loadActor(tx, userId));
      expect(actor).toMatchObject({ schoolId: seed.a.schoolId, branchId: seed.a.branchId, roles: ['teacher'] });
    }
  });

  it('ties on created_at break by membership id', async () => {
    const userId = seed.b.teacherId;
    const same = new Date('2026-03-01T00:00:00Z');
    const rows = await withPlatform(async (tx) => {
      await tx.update(memberships).set({ createdAt: same }).where(eq(memberships.userId, userId));
      await tx.insert(memberships).values({ userId, schoolId: seed.a.schoolId, branchId: seed.a.branchId, role: 'teacher', createdAt: same });
      return tx.select().from(memberships).where(eq(memberships.userId, userId));
    });
    const first = [...rows].sort((x, y) => (x.id < y.id ? -1 : 1))[0];
    const actor = await withPlatform((tx) => loadActor(tx, userId));
    expect(actor!.schoolId).toBe(first.schoolId);
  });
});

describe('loadActor for removed students', () => {
  it('returns null for a removed student and an actor otherwise', async () => {
    const userId = seed.a.studentId;
    expect(await withPlatform((tx) => loadActor(tx, userId))).not.toBeNull();
    await withPlatform((tx) => tx.update(studentProfiles).set({ status: 'removed' }).where(eq(studentProfiles.userId, userId)));
    expect(await withPlatform((tx) => loadActor(tx, userId))).toBeNull();
  });
});
