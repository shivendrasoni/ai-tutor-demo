import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closeDb, withPlatform, withTenant } from '@/db/client';
import { conversations, messages, skills, tenantTables, usageDaily } from '@/db/schema';
import { appDbRaw, resetDb, seedTwoSchools, type Seed, type SchoolSeed } from '../helpers/db';

let seed: Seed;
let skillId: string;
const convIds: Record<'a' | 'b', string> = { a: '', b: '' };

async function insertConversationFor(s: SchoolSeed, key: 'a' | 'b') {
  await withPlatform(async (tx) => {
    const [c] = await tx.insert(conversations).values({ schoolId: s.schoolId, studentId: s.studentId, skillId }).returning();
    convIds[key] = c.id;
    await tx.insert(messages).values({ schoolId: s.schoolId, conversationId: c.id, role: 'user', content: 'hi' });
    await tx.insert(usageDaily).values({ schoolId: s.schoolId, studentId: s.studentId, date: '2026-10-10', tokens: 5 });
  });
}

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  [{ id: skillId }] = await withPlatform((tx) =>
    tx.insert(skills).values({ key: 't', name: 't', kind: 'chat', instructions: 'i' }).returning({ id: skills.id }),
  );
  await insertConversationFor(seed.a, 'a');
  await insertConversationFor(seed.b, 'b');
});
afterAll(closeDb);

describe('tutor tables: RLS', () => {
  it('conversations/messages/usage_daily are forced-RLS and tenant-scoped', async () => {
    for (const t of [conversations, messages, usageDaily]) {
      const rows = await withTenant(seed.a.schoolId, (tx) => tx.select().from(t));
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.schoolId === seed.a.schoolId)).toBe(true);
    }
    for (const t of ['conversations', 'messages', 'usage_daily']) {
      expect((await appDbRaw(sql.raw(`select count(*)::int n from ${t}`))).rows[0].n).toBe(0); // fail closed
    }
  });
  it('cannot insert a message for another school', async () =>
    await expect(
      withTenant(seed.a.schoolId, (tx) =>
        tx.insert(messages).values({ schoolId: seed.b.schoolId, conversationId: convIds.a, role: 'user', content: 'x' }),
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } }));
  it('rejects an invalid message role and skill kind', async () => {
    await expect(
      withPlatform((tx) => tx.insert(messages).values({ schoolId: seed.a.schoolId, conversationId: convIds.a, role: 'system', content: 'x' })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/messages_role_check/) } });
    await expect(
      withPlatform((tx) => tx.insert(skills).values({ key: 'bad', name: 'b', kind: 'other', instructions: 'i' })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/skills_kind_check/) } });
  });
  it('skills are readable by app_user but not writable', async () => {
    expect(await withTenant(seed.a.schoolId, (tx) => tx.select().from(skills))).toHaveLength(1);
    await expect(
      withTenant(seed.a.schoolId, (tx) => tx.insert(skills).values({ key: 'u', name: 'u', kind: 'chat', instructions: 'i' })),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/permission denied/) } });
  });
  it('tenantTables includes the three tutor tables (16 total) but not skills', () => {
    expect(tenantTables).toHaveLength(16);
    for (const t of [conversations, messages, usageDaily]) expect(tenantTables).toContain(t);
    expect(tenantTables).not.toContain(skills);
  });
});
