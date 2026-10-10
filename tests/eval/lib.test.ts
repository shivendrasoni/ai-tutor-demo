import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { closeDb, withPlatform } from '@/db/client';
import { studentProfiles, users } from '@/db/schema';
import {
  accuracyByBand, actorForUsername, band, citationAccuracy, parseJsonl, renderReport, retrievalHitRate, writeReport,
} from '../../scripts/eval/lib';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';

describe('parseJsonl', () => {
  const schema = z.object({ q: z.string() });
  it('parses lines and skips blanks', () => {
    expect(parseJsonl('{"q":"a"}\n\n{"q":"b"}\n', schema)).toEqual([{ q: 'a' }, { q: 'b' }]);
  });
  it('reports the line number of a bad row', () => {
    expect(() => parseJsonl('{"q":"a"}\n\n{"q":1}\n', schema)).toThrow(/line 3/);
    expect(() => parseJsonl('{"q":"a"}\nnot json', schema)).toThrow(/line 2/);
  });
});

describe('band', () => {
  it('band edges: 0.399 low, 0.4 mid, 0.699 mid, 0.7 high', () => {
    expect([0.399, 0.4, 0.699, 0.7].map(band)).toEqual(['low', 'mid', 'mid', 'high']);
  });
});

describe('retrievalHitRate', () => {
  const hits = (titles: string[]) => titles.map((chapterTitle) => ({ chapterTitle }));
  it('counts the expected chapter within the top 8 only (the 9th does not count)', () => {
    const filler = Array.from({ length: 7 }, (_, i) => `x${i}`);
    expect(retrievalHitRate([{ expectedChapterTitle: 'T', hits: hits([...filler, 'T']) }])).toBe(1);
    expect(retrievalHitRate([{ expectedChapterTitle: 'T', hits: hits([...filler, 'y', 'T']) }])).toBe(0);
    expect(
      retrievalHitRate([
        { expectedChapterTitle: 'T', hits: hits(['T']) },
        { expectedChapterTitle: 'T', hits: hits([]) },
      ]),
    ).toBe(0.5);
  });
  it('is 0 for no rows', () => expect(retrievalHitRate([])).toBe(0));
});

describe('citationAccuracy', () => {
  const c = (pageStart: number, pageEnd: number) => ({ pageStart, pageEnd });
  it('an overlapping range counts; an adjacent non-overlapping page does not', () => {
    expect(citationAccuracy([{ expectedPages: [10, 12], citations: [c(12, 13)] }])).toBe(1);
    expect(citationAccuracy([{ expectedPages: [10, 12], citations: [c(8, 10)] }])).toBe(1);
    expect(citationAccuracy([{ expectedPages: [10, 12], citations: [c(13, 14)] }])).toBe(0);
    expect(citationAccuracy([{ expectedPages: [10, 12], citations: [c(8, 9)] }])).toBe(0);
    expect(citationAccuracy([{ expectedPages: [10, 12], citations: [] }])).toBe(0);
  });
});

describe('accuracyByBand', () => {
  it('returns null accuracy for empty bands', () => {
    const r = accuracyByBand([
      { confidence: 0.9, correct: true },
      { confidence: 0.8, correct: false },
      { confidence: 0.1, correct: false },
    ]);
    expect(r.high).toEqual({ n: 2, accuracy: 0.5 });
    expect(r.low).toEqual({ n: 1, accuracy: 0 });
    expect(r.mid).toEqual({ n: 0, accuracy: null });
  });
});

describe('renderReport / writeReport', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  it('emits markdown tables', () => {
    const md = renderReport('routing', [{ title: 'Jev', rows: [{ band: 'low', n: 2, accuracy: null }, { band: 'high', n: 3, accuracy: 0.5 }] }], now);
    expect(md).toContain('# routing eval');
    expect(md).toContain('2026-10-10');
    expect(md).toContain('## Jev');
    expect(md).toContain('| band | n | accuracy |');
    expect(md).toContain('| --- | --- | --- |');
    expect(md).toContain('| low | 2 | n/a |');
    expect(md).toContain('| high | 3 | 0.5 |');
  });
  it('names the file <date>-<name>.md', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-'));
    const path = await writeReport('tutor', '# x', now, dir);
    expect(path).toBe(join(dir, '2026-10-10-tutor.md'));
    expect(readFileSync(path, 'utf8')).toBe('# x');
  });
});

describe('actorForUsername', () => {
  let seed: Seed;
  beforeAll(async () => {
    await resetDb();
    seed = await seedTwoSchools();
  });
  afterAll(closeDb);
  const nameOf = async (id: string) => (await withPlatform((tx) => tx.select().from(users).where(eq(users.id, id))))[0]!.username!;

  it('throws for an unknown user and for a non-active student', async () => {
    await expect(actorForUsername('nobody')).rejects.toThrow(/not found/i);
    await expect(actorForUsername(await nameOf(seed.a.studentId))).rejects.toThrow(/active student/i);
  });
  it('returns the actor of an active student, and does not write', async () => {
    await withPlatform((tx) => tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, seed.a.studentId)));
    const actor = await actorForUsername(await nameOf(seed.a.studentId));
    expect(actor).toMatchObject({ userId: seed.a.studentId, schoolId: seed.a.schoolId, roles: ['student'] });
  });
  it('throws for a user that is not a student', async () => {
    await expect(actorForUsername(await nameOf(seed.a.teacherId))).rejects.toThrow(/active student/i);
  });
});
