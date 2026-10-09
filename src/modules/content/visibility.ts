import { and, eq, sql, type SQL } from 'drizzle-orm';
import { withTenant, type Tx } from '@/db/client';
import { studentProfiles } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import type { Actor } from '@/modules/tenancy';
import { getDeps } from './deps';

export type StudentScope = { schoolId: string; branchId: string; sectionId: string | null; grade: number };
export type VisibleItem = {
  id: string;
  title: string;
  kind: 'book' | 'material';
  scope: 'school' | 'branch' | 'section';
  subjectId: string;
  subjectName: string;
  grade: number;
};
export type ChunkHit = {
  chunkId: string;
  contentItemId: string;
  itemTitle: string;
  subjectId: string;
  subjectName: string;
  chapterId: string;
  chapterTitle: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  similarity: number;
};
export type SearchOpts = { subjectIds?: string[]; chapterIds?: string[]; limit?: number; minSimilarity?: number };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
/** Malformed ids are invisible: dropped before they reach SQL. */
const validIds = (ids: unknown[]): string[] => [...new Set(ids.filter(isUuid).map((i) => i.toLowerCase()))];
const uuidList = (ids: string[]): SQL => sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);

const DEFAULT_LIMIT = 8;
const DEFAULT_MIN_SIMILARITY = 0.25;

export async function studentScope(actor: Actor): Promise<StudentScope> {
  if (!actor.schoolId || !actor.roles.includes('student')) throw new DomainError('FORBIDDEN');
  const schoolId = actor.schoolId;
  const [p] = await withTenant(schoolId, (tx) =>
    tx
      .select()
      .from(studentProfiles)
      .where(and(eq(studentProfiles.userId, actor.userId), eq(studentProfiles.schoolId, schoolId))),
  );
  if (!p || p.status !== 'active') throw new DomainError('FORBIDDEN');
  return { schoolId, branchId: p.branchId, sectionId: p.sectionId, grade: p.grade };
}

/** Parent spec §4.2 visibility rule; yields the content_items alias `ci` rows a student may see. */
function visibleItemsSql(scope: StudentScope): SQL {
  return sql`select ci.id from content_items ci
    where ci.school_id = ${scope.schoolId}::uuid
      and ci.ingest_status = 'ready'
      and ci.grade = ${scope.grade}
      and (
        (ci.scope = 'school' and not exists (
          select 1 from content_exclusions ce
          where ce.content_item_id = ci.id and ce.branch_id = ${scope.branchId}::uuid))
        or (ci.scope = 'branch' and ci.branch_id = ${scope.branchId}::uuid)
        or (ci.scope = 'section' and ci.section_id = ${scope.sectionId}::uuid)
      )`;
}

const rows = async <T>(tx: Tx, q: SQL): Promise<T[]> => (await tx.execute(q)).rows as T[];

export function visibleContent(scope: StudentScope): Promise<VisibleItem[]> {
  return withTenant(scope.schoolId, (tx) =>
    rows<VisibleItem>(
      tx,
      sql`select ci.id, ci.title, ci.kind, ci.scope, ci.subject_id as "subjectId", s.name as "subjectName", ci.grade
        from content_items ci join subjects s on s.id = ci.subject_id
        where ci.id in (${visibleItemsSql(scope)})
        order by ci.created_at, ci.id`,
    ),
  );
}

export async function listVisibleSubjects(scope: StudentScope): Promise<{ id: string; name: string }[]> {
  return withTenant(scope.schoolId, (tx) =>
    rows<{ id: string; name: string }>(
      tx,
      sql`select distinct s.id, s.name from content_items ci join subjects s on s.id = ci.subject_id
        where ci.id in (${visibleItemsSql(scope)}) order by s.name, s.id`,
    ),
  );
}

export type VisibleChapter = {
  id: string;
  title: string;
  ordinal: number;
  pageStart: number;
  pageEnd: number;
  contentItemId: string;
  itemTitle: string;
};

export async function listVisibleChapters(scope: StudentScope, subjectId: string): Promise<VisibleChapter[]> {
  if (!isUuid(subjectId)) return [];
  return withTenant(scope.schoolId, (tx) =>
    rows<VisibleChapter>(
      tx,
      sql`select ch.id, ch.title, ch.ordinal, ch.page_start as "pageStart", ch.page_end as "pageEnd",
          ci.id as "contentItemId", ci.title as "itemTitle"
        from content_chapters ch join content_items ci on ci.id = ch.content_item_id
        where ci.id in (${visibleItemsSql(scope)})
          and ci.subject_id = ${subjectId}::uuid
          and exists (select 1 from chunks k where k.chapter_id = ch.id)
        order by ci.created_at, ci.id, ch.ordinal`,
    ),
  );
}

const HIT_COLUMNS = sql`k.id as "chunkId", ci.id as "contentItemId", ci.title as "itemTitle",
  s.id as "subjectId", s.name as "subjectName", ch.id as "chapterId", ch.title as "chapterTitle",
  k.page_start as "pageStart", k.page_end as "pageEnd", k.text`;

export async function searchChunks(scope: StudentScope, query: string, opts: SearchOpts = {}): Promise<ChunkHit[]> {
  const requested = Math.floor(Number(opts.limit ?? DEFAULT_LIMIT));
  const limit = Math.min(50, Math.max(1, Number.isNaN(requested) ? DEFAULT_LIMIT : requested));
  const minSimilarity = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  const filters: SQL[] = [];
  for (const [list, column] of [
    [opts.subjectIds, sql`ci.subject_id`],
    [opts.chapterIds, sql`ch.id`],
  ] as const) {
    if (list === undefined || list.length === 0) continue;
    const ids = validIds(list);
    if (ids.length === 0) return []; // all supplied ids invalid: never fall back to unfiltered
    filters.push(sql`${column} in (${uuidList(ids)})`);
  }

  const { embedder } = getDeps();
  const [vec] = await embedder.embed([query]);
  const q = JSON.stringify(vec);
  const where = sql.join(
    [
      sql`ci.id in (${visibleItemsSql(scope)})`,
      sql`k.embedding_model = ${embedder.modelId}`,
      sql`k.embedding is not null`,
      ...filters,
    ],
    sql` and `,
  );
  const hits = await withTenant(scope.schoolId, (tx) =>
    rows<ChunkHit>(
      tx,
      sql`select ${HIT_COLUMNS}, (1 - (k.embedding <=> ${q}::vector))::float8 as similarity
        from chunks k
        join content_chapters ch on ch.id = k.chapter_id
        join content_items ci on ci.id = k.content_item_id
        join subjects s on s.id = ci.subject_id
        where ${where}
        order by k.embedding <=> ${q}::vector
        limit ${limit}`,
    ),
  );
  return hits.filter((h) => h.similarity >= minSimilarity);
}

type ChapterChunk = ChunkHit & { tokenEstimate: number };

/** Index in [0,n) not yet taken that is farthest from every taken index (middle first). */
function nextIndex(n: number, taken: Set<number>): number {
  if (taken.size === 0) return Math.floor((n - 1) / 2);
  let best = -1;
  let bestDist = -1;
  for (let i = 0; i < n; i++) {
    if (taken.has(i)) continue;
    let d = Infinity;
    for (const t of taken) d = Math.min(d, Math.abs(i - t));
    if (d > bestDist) {
      best = i;
      bestDist = d;
    }
  }
  return best;
}

export async function chunksForChapters(scope: StudentScope, chapterIds: string[], maxTokens: number): Promise<ChunkHit[]> {
  const ids = validIds(chapterIds ?? []);
  if (ids.length === 0) return [];
  const all = await withTenant(scope.schoolId, (tx) =>
    rows<ChapterChunk>(
      tx,
      sql`select ${HIT_COLUMNS}, 1::float8 as similarity, k.token_estimate as "tokenEstimate"
        from chunks k
        join content_chapters ch on ch.id = k.chapter_id
        join content_items ci on ci.id = k.content_item_id
        join subjects s on s.id = ci.subject_id
        where ci.id in (${visibleItemsSql(scope)}) and ch.id in (${uuidList(ids)})
        order by k.ordinal`,
    ),
  );
  const byChapter = new Map<string, ChapterChunk[]>();
  for (const c of all) {
    const list = byChapter.get(c.chapterId) ?? [];
    list.push(c);
    byChapter.set(c.chapterId, list);
  }
  const ordered = ids.filter((i) => byChapter.has(i)).map((i) => ({ id: i, chunks: byChapter.get(i)! }));
  const strip = ({ tokenEstimate: _t, ...hit }: ChapterChunk): ChunkHit => hit;

  const total = all.reduce((s, c) => s + c.tokenEstimate, 0);
  if (total <= maxTokens) return ordered.flatMap((c) => c.chunks.map(strip));

  const taken = ordered.map(() => new Set<number>());
  let used = 0;
  ordered.forEach((c, i) => {
    const idx = nextIndex(c.chunks.length, taken[i]);
    if (used + c.chunks[idx].tokenEstimate <= maxTokens) {
      taken[i].add(idx);
      used += c.chunks[idx].tokenEstimate;
    }
  });
  for (;;) {
    let pick = -1;
    let pickRatio = Infinity;
    ordered.forEach((c, i) => {
      if (taken[i].size >= c.chunks.length) return;
      const r = taken[i].size / c.chunks.length;
      if (r < pickRatio) {
        pick = i;
        pickRatio = r;
      }
    });
    if (pick < 0) break;
    const idx = nextIndex(ordered[pick].chunks.length, taken[pick]);
    const t = ordered[pick].chunks[idx].tokenEstimate;
    if (used + t > maxTokens) break;
    taken[pick].add(idx);
    used += t;
  }
  return ordered.flatMap((c, i) => [...taken[i]].sort((a, b) => a - b).map((idx) => strip(c.chunks[idx])));
}
