/** Pure helpers for the eval harness (plus the read-only actor lookup). Never imported by app code. */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ZodType } from 'zod';
import type { Actor } from '@/modules/tenancy/actor';
import { THRESHOLDS } from '@/modules/tutor/routing';

export type Band = 'low' | 'mid' | 'high';
const TOP_K = 8;

/** One JSON object per non-blank line; a bad line throws an error naming its 1-based line number. */
export function parseJsonl<T>(text: string, schema: ZodType<T>): T[] {
  const out: T[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch (e) {
      throw new Error(`line ${i + 1}: invalid JSON (${(e as Error).message})`);
    }
    const r = schema.safeParse(json);
    if (!r.success) throw new Error(`line ${i + 1}: ${r.error.issues.map((x) => `${x.path.join('.') || '(row)'} ${x.message}`).join('; ')}`);
    out.push(r.data);
  });
  return out;
}

export function band(confidence: number): Band {
  return confidence < THRESHOLDS.filterMid ? 'low' : confidence < THRESHOLDS.filterHigh ? 'mid' : 'high';
}

const rate = (hits: number, n: number) => (n === 0 ? 0 : hits / n);

/** Share of rows whose expected chapter appears among the first 8 hits. */
export function retrievalHitRate(rows: { expectedChapterTitle: string; hits: { chapterTitle: string }[] }[]): number {
  return rate(
    rows.filter((r) => r.hits.slice(0, TOP_K).some((h) => h.chapterTitle === r.expectedChapterTitle)).length,
    rows.length,
  );
}

/** Share of rows where at least one citation's page range overlaps the expected range (inclusive). */
export function citationAccuracy(
  rows: { expectedPages: [number, number]; citations: { pageStart: number; pageEnd: number }[] }[],
): number {
  return rate(
    rows.filter((r) => r.citations.some((c) => c.pageStart <= r.expectedPages[1] && c.pageEnd >= r.expectedPages[0])).length,
    rows.length,
  );
}

export function accuracyByBand(
  rows: { confidence: number; correct: boolean }[],
): Record<Band, { n: number; accuracy: number | null }> {
  const out = { low: { n: 0, accuracy: null as number | null }, mid: { n: 0, accuracy: null as number | null }, high: { n: 0, accuracy: null as number | null } };
  const right = { low: 0, mid: 0, high: 0 };
  for (const r of rows) {
    const b = band(r.confidence);
    out[b].n++;
    if (r.correct) right[b]++;
  }
  for (const b of ['low', 'mid', 'high'] as const) out[b].accuracy = out[b].n ? right[b] / out[b].n : null;
  return out;
}

const cell = (v: string | number | null) => (v === null ? 'n/a' : String(v).replaceAll('|', '\\|').replaceAll('\n', ' '));

export function renderReport(
  name: string,
  sections: { title: string; rows: Record<string, string | number | null>[] }[],
  now: Date,
): string {
  const lines = [`# ${name} eval`, '', `Generated ${now.toISOString()}`, ''];
  for (const s of sections) {
    lines.push(`## ${s.title}`, '');
    if (s.rows.length === 0) {
      lines.push('_No rows._', '');
      continue;
    }
    const cols = Object.keys(s.rows[0]!);
    lines.push(`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`);
    for (const r of s.rows) lines.push(`| ${cols.map((c) => cell(r[c] ?? null)).join(' | ')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Writes `<dir>/<YYYY-MM-DD>-<name>.md` (dir defaults to evals/reports) and returns the path. */
export async function writeReport(name: string, md: string, now: Date = new Date(), dir = 'evals/reports'): Promise<string> {
  const path = join(dir, `${now.toISOString().slice(0, 10)}-${name}.md`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, md);
  return path;
}

/** Read-only lookup of an active student's Actor by username. */
export async function actorForUsername(username: string): Promise<Actor> {
  // Dynamic imports: '@/db/client' builds its pools on import, which must not happen before a script's env check.
  const [{ eq }, { withPlatform }, { studentProfiles, users }, { loadActor }] = await Promise.all([
    import('drizzle-orm'),
    import('@/db/client'),
    import('@/db/schema'),
    import('@/modules/tenancy/actor'),
  ]);
  return withPlatform(async (tx) => {
    const [u] = await tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1);
    if (!u) throw new Error(`user "${username}" not found`);
    const [p] = await tx.select({ status: studentProfiles.status }).from(studentProfiles).where(eq(studentProfiles.userId, u.id));
    if (p?.status !== 'active') throw new Error(`user "${username}" is not an active student`);
    const actor = await loadActor(tx, u.id);
    if (!actor) throw new Error(`user "${username}" is not an active student`);
    return actor;
  });
}

// ---- CLI wiring (used by each script's main(); never by tests) ----

/** Exits with a clear message when any of `names` is unset. */
export function requireEnv(script: string, names: string[]): void {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`${script}: missing required environment variable(s): ${missing.join(', ')}. Set them in .env (see .env.example).`);
    process.exit(1);
  }
}

/** Value of `--set <file>`; exits with usage when absent. */
export function setArg(script: string, argv: string[] = process.argv.slice(2)): string {
  const i = argv.indexOf('--set');
  const v = i >= 0 ? argv[i + 1] : undefined;
  if (!v) {
    console.error(`Usage: pnpm eval:${script} --set <file.jsonl>`);
    process.exit(1);
  }
  return v;
}

/** True when `metaUrl` is the entry module (so importing a script in a test never runs main()). */
export function isEntry(metaUrl: string): boolean {
  return !!process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;
}

/** Loads the distinct student actors named by the cases. */
export async function loadActors(usernames: string[]): Promise<Record<string, Actor>> {
  const out: Record<string, Actor> = {};
  for (const u of new Set(usernames)) out[u] = await actorForUsername(u);
  return out;
}
