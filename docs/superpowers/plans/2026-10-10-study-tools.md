# Study Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build sub-project 4 of the AI tutor platform. It covers:
- asynchronous generation of practice tests, mock exams, study notes, and last-night notes from 1–6 chosen chapters
- validation of generated output (schema, exam pattern, passage citations) with one repair attempt
- timed and untimed attempts with autosave, MCQ auto-scoring, and per-question LLM grading
- per-chapter progress for the progress views of sub-project 5

**Architecture:**
- **Module:** `src/modules/studytools` (module ⑤). Plain async service functions that take an `Actor`. Other modules import only from its `index.ts`.
- **Generation:** `requestArtifact` inserts an artifact row with `status = generating` and enqueues a pg-boss job. The worker loads passages with `chunksForChapters`, calls `runSkillStructured` with no tools, validates, and does at most one repair call.
- **Secrecy:** answer keys live in `artifacts.content`. Client-facing views are built by **whitelist mapping**, never by deleting keys.
- **Snapshots:** the generated content stores its own citation metadata (`sources`) and chapter titles. A later chapter or chunk deletion or hiding can never break an existing artifact, attempt, or progress row.
- **Grading:** MCQ is scored at submit. Each answered subjective question is one `studytools.grade` job. Results merge into the attempt row under a row lock, and whichever job completes the set finalizes the attempt exactly once.
- **Seams:** a `StudyQueue` interface (pg-boss in production, a recording fake in tests), an injectable clock, and one `llm.ts` adapter over sub-project 3's `runSkillStructured`. Models in tests are wired only through `useMockModels` (plan 3's `configureTutor` + `ModelRegistry.override`).

**Tech Stack:** as plans 1–3, plus `pg-boss` (from plan 2), zod 4, AI SDK `ai/test` mocks, `react-markdown` for the notes view. No new services.

**Spec:** `docs/superpowers/specs/2026-10-10-study-tools-design.md`. This plan implements §4.4 (artifacts, attempts), §6.4, module ⑤, and the study-tool tests in §8 of the parent spec `2026-10-10-ai-tutor-architecture-design.md`.

**Baseline:** plans 1–3 are implemented. Plan 1's names are the **as-built** ones in `docs/superpowers/plans/AS-BUILT-subproject-1.md`. Plan 3 (`2026-10-10-tutor-agent.md`) supplies `runSkillStructured(actor, skillKey, { tier, prompt, schema, context: ChunkHit[] | string }) → { value, usage: { tokensIn, tokensOut, cost, model } }` (it records `usage_daily` for every model call), `seedSkills`/`SEED_SKILLS` in `src/modules/tutor/skills.ts`, `ModelRegistry.override(spec | '*', model)`, and `configureTutor`/`resetTutorConfig`. Plan 2 is consumed through its spec signatures; the worker entrypoint path is plan 2's.

## Global Constraints

- **Context budget:** `chunksForChapters(scope, chapterIds, 24000)`. Passages are numbered `[P1]…[Pn]` in the prompt, in the order returned. No tool calling during generation.
- **Selection limits:** 1–6 chapters, all from **one subject**, all visible to the student. Practice test `questionCount` is 5–30, default 10. Only practice tests accept `questionCount`; only mock exams accept `patternKey`.
- **Generation limit:** at most **10 generations per student per UTC day**, counted from `artifacts.created_at` (all statuses). The 11th throws `GENERATION_LIMIT`. Generation does not check the chat token budget.
- **Model tier:** `advanced` for `mock_exam`, `standard` for everything else including `answer_grader`.
- **Repair:** exactly one repair call with the validation errors in the prompt. Plan 3's `runSkillStructured` already does one repair on a schema failure and throws `VALIDATION` after the second. This plan therefore folds the semantic checks (pattern match, passage refs, counts) into the zod schema it passes in (`superRefine`), so there is one repair loop in total, not two. `VALIDATION` from it sets `status = 'failed'`, `error = 'GENERATION_FAILED'`.
- **Polling and autosave:** the UI polls `GET /api/study/artifacts/:id` every **2 s** while `generating`, and autosaves answers every **10 s** and on navigation.
- **Timing:** a mock exam submission or save after `started_at + duration_minutes + 2 min grace` throws `ATTEMPT_EXPIRED`. Practice tests are untimed (`deadline = null`). Unanswered questions score 0.
- **Grading:** `studytools.grade` runs with **max 4 concurrent** jobs. Score is clamped to 0..marks and rounded to the nearest 0.5. Feedback is at most 60 words.
- **Exam patterns (seeded, global, no RLS):**
  - `standard_80`, grades 9–12, 180 min, total 80: A mcq 20×1, B short 5×2, C short 6×3, D long 4×5, E case 3×4.
  - `junior_50`, grades 5–8, 120 min, total 50: A mcq 10×1, B short 10×2, C long 4×5.
- **Practice tests:** about 60% MCQ, the rest short. MCQ is 1 mark, short is 2 marks.
- **Last-night notes:** at most **2 sections per chapter**, each `bodyMarkdown` at most **120 words**.
- **Error codes:** `GENERATION_LIMIT` → 429 and `ATTEMPT_EXPIRED` → 409. Both are added to `ErrorCode` and to the `STATUS` map in `src/lib/http.ts`.
- **Access:** only `active` students request artifacts and attempt them (`FORBIDDEN` otherwise, via `studentScope`). Another student's artifact or attempt is `NOT_FOUND`.
- **Queues:** `studytools.generate` and `studytools.grade`. Job data is `{ artifactId, schoolId }` and `{ attemptId, schoolId, questionId }`. Both use `retryLimit: 2`, `retryBackoff: true`.
- **Tests:** fakes only (`FakeEmbedder`, `MockLanguageModelV2`, a recording queue). No network. Every shell command starts with `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && `.

## Review Focus

1. **Answers for unknown or malformed input:** `saveAnswers` with a question id that is not in the artifact, an MCQ index of `4`, `-1`, `1.5`, or a string, or a number for a short question, is rejected with `VALIDATION` and **nothing is saved** (all-or-nothing). Pinned in Task 6.
2. **Double submit:** two concurrent `submitAttempt` calls produce one scoring pass and exactly one set of grade jobs. The loser returns the current status instead of failing. Pinned in Task 6.
3. **Grader failure and finalization races:**
   - A grader that fails on its final retry gives that question score 0 with `needsReview: true`, and the attempt still reaches `graded`. It never stays `grading` forever.
   - A failed enqueue at submit goes through the same path.
   - Two grade jobs finishing at the same moment finalize once.
   - A redelivered job for an already-graded question is a no-op.
   - Pinned in Task 7.
4. **Chapters or chunks deleted or hidden after generation:** `getArtifact`, `startAttempt`, grading, and `chapterProgress` still work, because citations and chapter titles are snapshots inside the artifact. Requesting a **new** artifact on a now-hidden chapter is `VALIDATION`. Pinned in Tasks 5 and 8.
5. **Generation limit boundary:** two concurrent requests when 9 exist produce exactly one success. A request at 23:59:59 UTC and one at 00:00:00 UTC the next day count against different days. An enqueue failure marks the artifact `failed` instead of leaving it `generating` forever. Pinned in Task 5.

---

## File Structure

```
src/db/schema/studytools.ts            exam_patterns, artifacts, attempts   (re-exported from schema/index.ts; artifacts, attempts added to tenantTables)
src/db/migrations/0004_*.sql           drizzle-generated tables
src/db/migrations/0005_study_rls.sql   custom: RLS on artifacts+attempts, exam_patterns seed, check constraints
src/lib/errors.ts                      (modify) + GENERATION_LIMIT, ATTEMPT_EXPIRED
src/lib/http.ts                        (modify) STATUS map
src/modules/studytools/clock.ts        now(), setNow()
src/modules/studytools/patterns.ts     listExamPatterns, getPattern, defaultPatternKey
src/modules/studytools/schemas.ts      zod schemas + types (Question, PracticeTest, MockExam, Notes, view types)
src/modules/studytools/validate.ts     validateGenerated, generatedSchemaFor, resolvePassageRefs
src/modules/studytools/prompts.ts      buildGeneratorPrompt, buildGraderPrompt, formatPassages
src/modules/studytools/llm.ts          callGenerator, callGrader (adapter over runSkillStructured)
src/modules/studytools/queue.ts        StudyQueue, setStudyQueue, getStudyQueue, PgBossQueue, registerStudyToolsWorkers
src/modules/studytools/generate.ts     handleGenerateJob
src/modules/studytools/artifacts.ts    requestArtifact, getArtifact, listArtifacts, toArtifactView
src/modules/studytools/attempts.ts     startAttempt, saveAnswers, submitAttempt, getAttempt
src/modules/studytools/scoring.ts      scoreMcq, clampScore, buildByChapter
src/modules/studytools/finalize.ts     finalizeAttempt
src/modules/studytools/grading.ts      handleGradeJob, failPendingQuestions
src/modules/studytools/progress.ts     chapterProgress
src/modules/studytools/index.ts        public exports
src/modules/tutor/skills-study.ts      (create) STUDY_SKILLS: 5 study skill seeds
src/modules/tutor/skills.ts            (modify) SEED_SKILLS spreads STUDY_SKILLS (seedSkills itself unchanged)
src/modules/tutor/structured.ts        (modify) optional skipBudget flag on runSkillStructured
src/app/api/study/**/route.ts          9 endpoints (Task 9)
src/app/learn/study/**                 hub, notes, take, results pages (Task 10)
src/app/learn/layout.tsx               (modify) "Study" nav link
tests/helpers/study.ts                 activateStudent, seedStudyContent, insertArtifact, fixtures, RecordingQueue, useMockModels
tests/studytools/*.test.ts             unit + integration
tests/isolation/studytools.test.ts     (Task 11)
e2e/study.spec.ts                      Playwright (Task 10)
```

---

### Task 1: Schema, RLS migration, exam pattern seed, error codes

**Files:**
- Create: `src/db/schema/studytools.ts`, `src/db/migrations/0004_*.sql` (generated), `src/db/migrations/0005_study_rls.sql` (custom), `src/modules/studytools/patterns.ts`, `src/modules/studytools/clock.ts`, `tests/helpers/study.ts` (first helpers)
- Modify: `src/db/schema/index.ts`, `src/lib/errors.ts`, `src/lib/http.ts`
- Test: `tests/studytools/schema.test.ts`; `tests/db/rls-catalog.test.ts` (existing gate) must stay green

**Interfaces:**
- Consumes: `withTenant`, `withPlatform`, `seedTwoSchools`, `appDbRaw`
- Produces:
  - Tables exactly as spec §3:
    - `exam_patterns(id, key unique, name, grade_min, grade_max, duration_minutes, sections jsonb)`, no RLS.
    - `artifacts(id, school_id, student_id fk users, skill_id fk skills, type, subject_id fk subjects, chapter_ids uuid[], params jsonb default '{}', status, error, content jsonb, source_chunk_ids uuid[] default '{}', created_at)`.
    - `attempts(id, school_id, artifact_id fk artifacts cascade, student_id, status, started_at default now(), submitted_at, answers jsonb default '{}', results jsonb, score numeric, max_score numeric, by_chapter jsonb, graded_at)`.
    - Check constraints on `type`, `status`. Indexes on `artifacts(student_id, created_at)` and `attempts(student_id, artifact_id)`.
  - `artifacts.params` holds `{ questionCount?, patternKey?, chapterTitles: Record<chapterId,string> }`.
  - `tenantTables` gains `artifacts` and `attempts`.
  - `type ExamPatternRow = { id: string; key: string; name: string; gradeMin: number; gradeMax: number; durationMinutes: number; sections: PatternSection[] }`, `type PatternSection = { key: string; title: string; questionType: 'mcq'|'short'|'long'|'case'; count: number; marksEach: number }`.
  - `listExamPatterns(grade: number): Promise<ExamPatternRow[]>`, `getPattern(key: string): Promise<ExamPatternRow | null>`, `defaultPatternKey(grade: number): 'standard_80' | 'junior_50'` (≥9 → `standard_80`).
  - `clock.ts`: `now(): Date`, `setNow(fn: (() => Date) | null): void`.
  - `ErrorCode` gains `'GENERATION_LIMIT' | 'ATTEMPT_EXPIRED'`; `STATUS` gains 429 and 409.

- [ ] **Step 1: Write the failing tests** in `tests/studytools/schema.test.ts`:

```ts
it('seeds the two exam patterns with exact sections and totals', async () => {
  const s80 = await getPattern('standard_80'); const j50 = await getPattern('junior_50');
  const total = (p: ExamPatternRow) => p.sections.reduce((n, s) => n + s.count * s.marksEach, 0);
  expect([s80!.durationMinutes, total(s80!), s80!.gradeMin, s80!.gradeMax]).toEqual([180, 80, 9, 12]);
  expect(s80!.sections.map(s => [s.key, s.questionType, s.count, s.marksEach])).toEqual([
    ['A','mcq',20,1],['B','short',5,2],['C','short',6,3],['D','long',4,5],['E','case',3,4]]);
  expect([j50!.durationMinutes, total(j50!)]).toEqual([120, 50]);
  expect(j50!.sections.map(s => [s.key, s.questionType, s.count, s.marksEach])).toEqual([
    ['A','mcq',10,1],['B','short',10,2],['C','long',4,5]]);
});
it('listExamPatterns filters by grade', async () => {
  expect((await listExamPatterns(10)).map(p => p.key)).toEqual(['standard_80']);
  expect((await listExamPatterns(6)).map(p => p.key)).toEqual(['junior_50']);
  expect(defaultPatternKey(8)).toBe('junior_50');
});
it('artifacts and attempts are tenant isolated and fail closed', async () => {
  // insert one artifact + attempt for school A via insertArtifact helper
  expect(await withTenant(seed.b.schoolId, tx => tx.select().from(artifacts))).toHaveLength(0);
  expect((await appDbRaw(sql`select count(*)::int n from artifacts`)).rows[0].n).toBe(0);
  await expect(withTenant(seed.a.schoolId, tx => tx.insert(artifacts).values({ ...row, schoolId: seed.b.schoolId })))
    .rejects.toThrow(/row-level security/);
});
it('rejects an invalid artifact type or status', async () => {
  await expect(withPlatform(tx => tx.execute(sql`insert into artifacts (school_id, student_id, skill_id, type, subject_id, status) values (...)`))).rejects.toThrow(/check/);
});
it('ErrorCodes map to HTTP statuses', () => {
  expect(new DomainError('GENERATION_LIMIT')).toBeDefined(); // type-level: compiles only once added
});
```

  Also add to `tests/helpers/study.ts`: `insertArtifact(schoolId, studentId, over?)` (direct `withPlatform` insert, defaulting to a ready practice test with `content`), `activateStudent(seedSchool)` (sets `student_profiles.status='active'` via `withPlatform`).
- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/studytools/schema.test.ts`. Expected: FAIL (no tables, no module).
- [ ] **Step 3: Implement.** Write the schema file and re-export it from `schema/index.ts`; run `pnpm db:generate`, then `pnpm drizzle-kit generate --custom --name study_rls` and fill it with: forced RLS + `tenant_isolation` policy (same text as `0001_rls.sql`) for `artifacts` and `attempts`, check constraints, and `insert into exam_patterns` for both patterns. Default privileges from `0003` cover grants. Add the two error codes and STATUS entries. Implement `patterns.ts` (reads through `withPlatform`, since the table is global) and `clock.ts`. Run `pnpm db:migrate`.
- [ ] **Step 4: Run** the new test plus `pnpm vitest run tests/db`. Expected: PASS, including `rls-catalog.test.ts`.
- [ ] **Step 5: Commit:** `git add -A && git commit -m "feat(studytools): artifacts and attempts schema with RLS, exam pattern seed, error codes"`

---

### Task 2: Zod schemas, pattern-match validator, passage-ref resolver

**Files:**
- Create: `src/modules/studytools/schemas.ts`, `src/modules/studytools/validate.ts`
- Test: `tests/studytools/validate.test.ts`

**Interfaces:**
- Consumes: `ExamPatternRow`, `ChunkHit` (from `src/modules/content`)
- Produces (`schemas.ts`, zod 4):
  - `QuestionSchema`, `PracticeTestSchema`, `MockExamSchema`, `NotesSchema` matching spec §4 exactly. These are **structural** schemas (also what `runSkillStructured` receives). `options` is a 4-tuple of non-empty strings, `rubric` has 2–5 non-empty items, `marks > 0`.
  - `type Question`, `PracticeTest`, `MockExam`, `Notes`.
  - Stored-content types, after resolution: `StoredQuestion = Question & { chunkIds: string[] }`, `StoredNotesSection = Notes['sections'][number] & { chunkIds: string[] }`, `Sources = Record<chunkId, { itemTitle: string; chapterTitle: string; pageStart: number; pageEnd: number }>`, and `StoredContent<T> = T-with-chunkIds & { sources: Sources }`.
  - `type ArtifactType = 'practice_test'|'mock_exam'|'study_notes'|'last_night_notes'`.
- Produces (`validate.ts`):
  - `type ValidationCtx = { type: ArtifactType; chapterIds: string[]; passageCount: number; questionCount?: number; pattern?: ExamPatternRow }`
  - `validateGenerated(raw: unknown, ctx: ValidationCtx): { ok: true; value: PracticeTest | MockExam | Notes } | { ok: false; errors: string[] }`. `errors` are short human-readable lines (they are pasted into the repair prompt).
  - Semantic checks, beyond the schema:
    - Every `passageRefs` entry matches `^P\d+$`, is within `1..passageCount`, and each question or section has ≥ 1.
    - Every `chapterId` is in `ctx.chapterIds`.
    - Question ids are unique across the whole artifact.
    - MCQ has `correctIndex` in 0..3; non-MCQ has `modelAnswer` and a rubric.
    - Practice test: `questions.length === questionCount`, types only `mcq|short`, marks 1 for MCQ and 2 for short.
    - Mock exam: `patternKey`, `durationMinutes`, and sections must equal the pattern (same order, `key`, count, every question's type equal to `questionType`, every `marks === marksEach`).
    - Last-night notes: ≤ 2 sections per chapter, each body ≤ 120 words.
    - Study notes: ≥ 1 section.
  - `generatedSchemaFor(type: ArtifactType, ctx: ValidationCtx): ZodType<PracticeTest | MockExam | Notes>`: the structural schema plus a `superRefine` that reports every `validateGenerated` error as an issue. This is what Task 3 passes to `runSkillStructured`, so its single repair covers semantic errors too.
  - `resolvePassageRefs(value, hits: ChunkHit[]): { content: StoredContent; sourceChunkIds: string[] }`. `P{n}` maps to `hits[n-1].chunkId`. It adds `chunkIds` to each question or section, builds `sources` from the hits, and returns the deduplicated chunk ids.

- [ ] **Step 1: Write the failing tests.** Add one test that `generatedSchemaFor('mock_exam', ctx).safeParse(mockFor(std80, { drop: 'B' }))` fails with an issue mentioning section B. Table-driven fixtures built by small factories in `tests/helpers/study.ts` (`mcq(over?)`, `short(over?)`, `practice(n, over?)`, `mockFor(pattern, over?)`, `notes(...)`):

```ts
it.each([
  ['valid practice test', practice(10), true],
  ['wrong question count', practice(9), false],
  ['mcq correctIndex 4', practice(10, { q: 0, correctIndex: 4 }), false],
  ['mcq with 3 options', practice(10, { q: 0, options: ['a','b','c'] }), false],
  ['short with 1 rubric point', practice(10, { q: 9, rubric: ['x'] }), false],
  ['unknown passage P99', practice(10, { q: 0, passageRefs: ['P99'] }), false],
  ['empty passageRefs', practice(10, { q: 0, passageRefs: [] }), false],
  ['chapterId not selected', practice(10, { q: 0, chapterId: OTHER }), false],
  ['duplicate ids', practice(10, { q: 1, id: 'q0' }), false],
])('%s', (_n, raw, ok) => expect(validateGenerated(raw, ctx('practice_test')).ok).toBe(ok));

it('accepts a mock exam that matches standard_80 exactly', () =>
  expect(validateGenerated(mockFor(std80), mockCtx(std80)).ok).toBe(true));
it.each([
  ['count short by one in B', mockFor(std80, { drop: 'B' })],
  ['wrong marks in C', mockFor(std80, { marks: ['C', 2] })],
  ['wrong type in A', mockFor(std80, { type: ['A', 'short'] })],
  ['wrong duration', mockFor(std80, { durationMinutes: 150 })],
  ['wrong patternKey', mockFor(std80, { patternKey: 'junior_50' })],
  ['sections out of order', mockFor(std80, { swap: ['A', 'B'] })],
])('rejects mock exam: %s', (_n, raw) => {
  const r = validateGenerated(raw, mockCtx(std80));
  expect(r.ok).toBe(false); expect((r as any).errors.join(' ')).toMatch(/section|marks|type|duration|pattern/i);
});
it('last-night notes: 3 sections for one chapter fails; a 121-word body fails', ...);
it('resolvePassageRefs maps P-numbers to chunk ids and builds sources', () => {
  const { content, sourceChunkIds } = resolvePassageRefs(practice(10), hits);
  expect(content.questions[0].chunkIds).toEqual([hits[0].chunkId]);
  expect(content.sources[hits[0].chunkId]).toEqual({ itemTitle: hits[0].itemTitle, chapterTitle: hits[0].chapterTitle, pageStart: hits[0].pageStart, pageEnd: hits[0].pageEnd });
  expect(new Set(sourceChunkIds).size).toBe(sourceChunkIds.length);
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/studytools/validate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `schemas.ts` and `validate.ts`. Run schema parse first and collect `ZodIssue` paths as error lines; run semantic checks only when parsing succeeded. Word count is `body.trim().split(/\s+/).length`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(studytools): content schemas, pattern validator, and passage-ref resolver"`

---

### Task 3: Study skills seeding, prompt builders, and LLM adapter

**Files:**
- Create: `src/modules/tutor/skills-study.ts`, `src/modules/studytools/prompts.ts`, `src/modules/studytools/llm.ts`
- Modify: `src/modules/tutor/skills.ts` (spread `STUDY_SKILLS` into `SEED_SKILLS`), `src/modules/tutor/structured.ts` (add `skipBudget`), `tests/helpers/study.ts` (add `mockModel`, `useMockModels`)
- Test: `tests/studytools/skills.test.ts`, `tests/studytools/prompts.test.ts`, `tests/studytools/llm.test.ts`, `tests/tutor/structured-skipbudget.test.ts`

**Interfaces:**
- Consumes: `seedSkills`, `listSkills`, `runSkillStructured`, `configureTutor`, `ModelRegistry`, `ChunkHit`, `ExamPatternRow`, `generatedSchemaFor`
- Produces:
  - `STUDY_SKILLS: Omit<SkillRow, 'id'>[]` (the tutor module owns `skills`, so the dependency points studytools → tutor only): keys `practice_test_generator`, `mock_exam_generator`, `study_notes_generator`, `last_night_notes_generator` (kind `generator`, `tools: []`) and `answer_grader` (kind `grader`, `tools: []`). Instructions follow spec §5: use only the passages, match the grade, reference passages as `P<n>` matching the `[P<n>]` labels, and the schema rules for that type.
  - `runSkillStructured` gains an optional `skipBudget?: boolean` argument (default false). When true, the budget check is skipped; usage is still recorded. Study tools pass true because generation is governed by the 10/day limit instead.
  - `SKILL_FOR_TYPE: Record<ArtifactType, string>`, `tierFor(type): 'standard'|'advanced'` (in `llm.ts`).
  - `formatPassages(hits: ChunkHit[]): string`: blocks `[P1] {chapterTitle}, p.{pageStart}–{pageEnd}\n{text}`, blank line between. Passed to `runSkillStructured` as the **string** form of `context`, so the `P` labels reach the model.
  - `buildGeneratorPrompt(i: { type: ArtifactType; grade: number; chapters: { id: string; title: string }[]; questionCount?: number; pattern?: ExamPatternRow }): string`: states the type's exact count and marks rules, lists `chapterId` values with titles, and says to cite passages as `P<n>`. It does not include the passages (they travel as `context`).
  - `buildGraderPrompt(q: { prompt: string; type: string; marks: number; modelAnswer: string; rubric: string[] }, studentAnswer: string): string`.
  - `callGenerator(actor, { type, prompt, hits, ctx }): Promise<{ value: PracticeTest | MockExam | Notes; usage: Usage }>`: `runSkillStructured(actor, SKILL_FOR_TYPE[type], { tier: tierFor(type), prompt, schema: generatedSchemaFor(type, ctx), context: formatPassages(hits), skipBudget: true })`.
  - `callGrader(actor, prompt, marks): Promise<{ score: number; feedback: string }>`: schema `{ score: number, feedback: string }`, standard tier, `skipBudget: true`; clamps the score with `clampScore` semantics (0..marks, nearest 0.5) and truncates feedback to 60 words. `clampScore` lives in `scoring.ts` (Task 6); until then this task defines it there as a small pure function with its own test and Task 6 extends the file.
  - Test helpers: `mockModel(script: Array<object | Error>): MockLanguageModelV2` (each `doGenerate` call returns the next scripted item as JSON text, or throws), and `useMockModels({ standard?, advanced? })`, the **only** place that wires models: it sets `LLM_STANDARD_MODEL=mock/standard`, `LLM_ADVANCED_MODEL=mock/advanced`, calls `configureTutor({ registry })` with a registry whose `override('mock/standard' | 'mock/advanced', model)` is set, and is undone by `resetTutorConfig()` in a global `afterEach`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('seedSkills adds the five study skills, idempotently', async () => {
  await seedSkills(); await seedSkills();
  const rows = await listSkills();
  for (const k of ['practice_test_generator','mock_exam_generator','study_notes_generator','last_night_notes_generator'])
    expect(rows.find(r => r.key === k)).toMatchObject({ kind: 'generator', tools: [] });
  expect(rows.find(r => r.key === 'answer_grader')).toMatchObject({ kind: 'grader' });
  expect(rows.filter(r => r.key === 'answer_grader')).toHaveLength(1);
});
it('formatPassages labels P1..Pn; generator prompt states the exact pattern and chapter ids', () => {
  expect(formatPassages(hits)).toContain(`[P${hits.length}]`);
  const p = buildGeneratorPrompt({ type: 'mock_exam', grade: 8, chapters, pattern: junior50 });
  expect(p).toMatch(/Section A.*10.*mcq.*1 mark/is);
  for (const c of chapters) expect(p).toContain(c.id);
});
it('grader prompt contains answer, model answer, rubric, and marks', ...);
it('mock exams use the advanced model, others standard', async () => {
  const std = mockModel([practiceJson]); const adv = mockModel([mockJson]);
  useMockModels({ standard: std, advanced: adv });
  await callGenerator(actor, { type: 'mock_exam', prompt: 'x', hits, ctx: mockCtx(junior50) });
  expect(adv.doGenerateCalls).toHaveLength(1); expect(std.doGenerateCalls).toHaveLength(0);
});
it('a semantically invalid first output triggers the single repair with the error in the prompt', async () => {
  const m = mockModel([mockFor(junior50, { drop: 'B' }), mockFor(junior50)]);
  useMockModels({ advanced: m });
  const r = await callGenerator(actor, { type: 'mock_exam', prompt: 'x', hits, ctx: mockCtx(junior50) });
  expect(m.doGenerateCalls).toHaveLength(2);
  expect(JSON.stringify(m.doGenerateCalls[1].prompt)).toMatch(/section B/i);
});
it('two semantically invalid outputs reject with VALIDATION', ...);
it('callGrader clamps to marks, rounds to 0.5, trims feedback to 60 words', async () => {
  useMockModels({ standard: mockModel([{ score: 7.3, feedback: 'w '.repeat(90) }]) });
  const r = await callGrader(actor, 'p', 5);
  expect(r.score).toBe(5); expect(r.feedback.split(/\s+/)).toHaveLength(60);
});
// structured-skipbudget.test.ts
it('skipBudget lets a student over the daily token limit generate; default still throws BUDGET_EXCEEDED', async () => {
  await exhaustBudget(student);
  await expect(runSkillStructured(student, key, args)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  await expect(runSkillStructured(student, key, { ...args, skipBudget: true })).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/studytools/skills.test.ts tests/studytools/prompts.test.ts tests/studytools/llm.test.ts tests/tutor/structured-skipbudget.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the files above. `llm.ts` is the only place that knows `runSkillStructured`'s argument shape.
- [ ] **Step 4: Run.** Expected: PASS, and `pnpm vitest run tests/tutor` stays green.
- [ ] **Step 5: Commit:** `git commit -m "feat(studytools): study skills, prompt builders, structured-LLM adapter, skipBudget"`

---

### Task 4: Queue seam and generation job with repair loop

**Files:**
- Create: `src/modules/studytools/queue.ts` (interface and test seam only; pg-boss in Task 7), `src/modules/studytools/generate.ts`
- Modify: `tests/helpers/study.ts` (add `RecordingQueue`, `seedStudyContent`), `tests/setup/global.ts` (install the recording queue)
- Test: `tests/studytools/generate.test.ts`

**Interfaces:**
- Consumes: `studentScope`, `chunksForChapters`, `callGenerator`, `buildGeneratorPrompt`, `resolvePassageRefs`, `getPattern`, `loadActor` (tenancy), `withTenant`
- Produces:
  - `type GenerateJob = { artifactId: string; schoolId: string }`, `type GradeJob = { attemptId: string; schoolId: string; questionId: string }`
  - `interface StudyQueue { enqueueGenerate(d: GenerateJob): Promise<void>; enqueueGrade(d: GradeJob[]): Promise<void> }`
  - `setStudyQueue(q: StudyQueue | null): void`, `getStudyQueue(): StudyQueue`
  - `type JobMeta = { retryCount: number; retryLimit: number }`
  - `handleGenerateJob(job: { data: GenerateJob } & Partial<JobMeta>): Promise<void>`
  - Test helpers: `RecordingQueue` (`generate: GenerateJob[]`, `grade: GradeJob[]`, optional `failNext` to throw), and `seedStudyContent(schoolSeed, { chapters = 3, chunksPerChapter = 4 })` returning `{ subjectId; chapterIds: string[]; chunkIds: string[] }`. It inserts a `ready` school-scope grade-8 `content_items` row with chapters and chunks (FakeEmbedder vectors) directly through `withPlatform`.

- [ ] **Step 1: Write the failing tests** (fixture: `seed`, `activateStudent(seed.a)`, `seedStudyContent`, a `generating` artifact via `insertArtifact`, models via `useMockModels`):

```ts
it('success stores content, sources, and source_chunk_ids; marks ready', async () => {
  useMockModels({ standard: mockModel([validPracticeJson(ids)]) });
  await handleGenerateJob({ data: { artifactId, schoolId } });
  const a = await getRow(artifactId);
  expect(a).toMatchObject({ status: 'ready', error: null });
  expect(a.sourceChunkIds.length).toBeGreaterThan(0);
  expect(a.content.questions[0].chunkIds.length).toBeGreaterThan(0);
  expect(Object.keys(a.content.sources).length).toBeGreaterThan(0);
});
it('first output invalid, second valid → ready after exactly 2 model calls (runSkillStructured repair)', async () => {
  const m = mockModel([{ title: 't', questions: [] }, validPracticeJson(ids)]);
  useMockModels({ standard: m });
  await handleGenerateJob(...);
  expect(m.doGenerateCalls).toHaveLength(2);
  expect(JSON.stringify(m.doGenerateCalls[1].prompt)).toMatch(/invalid|error/i);
  expect((await getRow(artifactId)).status).toBe('ready');
});
it('invalid twice → failed GENERATION_FAILED, no content, exactly 2 calls', async () => {
  const m = mockModel([bad, bad]); ...
  expect(await getRow(artifactId)).toMatchObject({ status: 'failed', error: 'GENERATION_FAILED', content: null });
  expect(m.doGenerateCalls).toHaveLength(2);
});
it('an unknown passage ref (P99) counts as invalid and is repaired once', ...);
it('a student over the chat token budget can still generate (skipBudget)', ...);
it('mock exam job uses the advanced model and the pattern from params', ...);
it('records generation tokens in usage_daily', async () => {
  const before = await usageTokens(studentId);
  await handleGenerateJob(...);
  expect(await usageTokens(studentId)).toBeGreaterThan(before);
});
it('provider error on a non-final attempt rethrows and leaves generating (pg-boss retries)', async () => {
  useMockModels({ standard: mockModel([new Error('boom')]) });
  await expect(handleGenerateJob({ data, retryCount: 0, retryLimit: 2 })).rejects.toThrow();
  expect((await getRow(artifactId)).status).toBe('generating');
});
it('provider error on the final attempt marks failed (never generating forever)', async () => {
  await handleGenerateJob({ data, retryCount: 2, retryLimit: 2 });
  expect(await getRow(artifactId)).toMatchObject({ status: 'failed', error: 'GENERATION_FAILED' });
});
it('lapsed student at job time → failed, no model call', ...);
it('already-ready artifact is a no-op (redelivery)', ...);
```

- [ ] **Step 2: Run** `pnpm vitest run tests/studytools/generate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `handleGenerateJob`:
  - Load the artifact and return if its status is not `generating`.
  - Build a student `Actor` with `loadActor`; `studentScope` failing (inactive student) marks the artifact failed.
  - Fetch hits with `chunksForChapters(scope, artifact.chapterIds, 24000)`. Zero hits → failed.
  - Call `callGenerator` once; its internal single repair covers structural and semantic failures. A `VALIDATION` error means failed `GENERATION_FAILED`.
  - On success run `resolvePassageRefs` and update in one `withTenant` call.
  - Any other error (`TUTOR_BUSY`, unexpected) rethrows unless `retryCount >= retryLimit`, in which case it marks failed.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(studytools): generation job with single repair attempt and queue seam"`

---

### Task 5: requestArtifact, getArtifact, listArtifacts

**Files:**
- Create: `src/modules/studytools/artifacts.ts`, `src/modules/studytools/index.ts`
- Test: `tests/studytools/artifacts.test.ts`

**Interfaces:**
- Consumes: `studentScope`, `listVisibleSubjects`, `listVisibleChapters`, `getStudyQueue`, `getPattern`, `defaultPatternKey`, `runAs`, `now`
- Produces:
  - `requestArtifact(actor, input: { type: ArtifactType; subjectId: string; chapterIds: string[]; questionCount?: number; patternKey?: string }): Promise<{ id: string }>`
    - Order: `studentScope` (FORBIDDEN) → validate input shape (`VALIDATION`) → subject and chapters visible → then, in one `withTenant` transaction holding `pg_advisory_xact_lock(hashtext(studentId))`, count today's UTC-day artifacts (`created_at >= date_trunc('day', now() at UTC)` computed from the injected clock) → `GENERATION_LIMIT` at 10 → insert (`status generating`, `skill_id` from the key, `params.chapterTitles` snapshot, `patternKey` resolved for mock exams) → after commit `enqueueGenerate`. If enqueue throws, the artifact is set `failed`/`GENERATION_FAILED` and the error is rethrown.
  - Rules: chapters are deduplicated, 1–6, and all in `listVisibleChapters(scope, subjectId)` (a chapter of another subject is therefore `VALIDATION`). `questionCount` is only allowed for `practice_test` (5–30, default 10). `patternKey` is only allowed for `mock_exam`, must exist, and its grade range must contain the student's grade; default is `defaultPatternKey(grade)`.
  - `type ArtifactView = { id; type; status; error: string | null; subjectId; chapterIds; chapterTitles: Record<string,string>; params; createdAt: Date; title: string | null; durationMinutes?: number; sections?: ViewSection[]; questions?: ViewQuestion[]; notes?: ViewNote[] }`
    - `ViewQuestion = { id; type; prompt; options?: string[]; marks; chapterId; citations: Citation[] }`.
    - `ViewNote = { heading; bodyMarkdown; chapterId; citations: Citation[] }`.
    - `Citation = { chunkId; itemTitle; chapterTitle; pageStart; pageEnd }`.
  - `toArtifactView(row): ArtifactView` is a **whitelist mapper**. It copies named fields only, so a future key added to the stored content cannot leak.
  - `getArtifact(actor, id): Promise<ArtifactView>`: own artifact, else `NOT_FOUND`. Citations come from `content.sources` (no content-module lookups).
  - `type ArtifactSummary = { id; type; status; subjectId; chapterIds; title: string | null; createdAt: Date; attemptCount: number; bestScorePct: number | null }`
  - `listArtifacts(actor, { type? }): Promise<ArtifactSummary[]>`: own, newest first.
  - `index.ts` re-exports the public API as it grows.

- [ ] **Step 1: Write the failing tests** (`activateStudent(seed.a)`, `seedStudyContent`, `RecordingQueue` installed):

```ts
it('creates a generating artifact and enqueues exactly one job', async () => {
  const { id } = await requestArtifact(seed.a.student, { type: 'practice_test', subjectId, chapterIds: [c0, c1] });
  expect(rec.generate).toEqual([{ artifactId: id, schoolId: seed.a.schoolId }]);
  expect(await rowOf(id)).toMatchObject({ status: 'generating', type: 'practice_test', params: expect.objectContaining({ questionCount: 10 }) });
});
it.each([
  ['no chapters', { chapterIds: [] }], ['7 chapters', { chapterIds: seven }],
  ['questionCount 4', { questionCount: 4 }], ['questionCount 31', { questionCount: 31 }],
  ['chapter from another subject', { chapterIds: [otherSubjectChapter] }],
  ['unknown chapter id', { chapterIds: [randomUUID()] }],
  ['patternKey on practice test', { patternKey: 'junior_50' }],
])('VALIDATION: %s', async (_n, over) =>
  await expect(requestArtifact(seed.a.student, { ...base, ...over })).rejects.toMatchObject({ code: 'VALIDATION' }));
it('mock exam: grade 8 student defaults to junior_50, rejects standard_80', async () => {
  const { id } = await requestArtifact(seed.a.student, mockInput);
  expect((await rowOf(id)).params.patternKey).toBe('junior_50');
  await expect(requestArtifact(seed.a.student, { ...mockInput, patternKey: 'standard_80' })).rejects.toMatchObject({ code: 'VALIDATION' });
});
it('hidden chapter (content excluded for the branch) is VALIDATION for a NEW request', ...);
it('pending student is FORBIDDEN; teacher is FORBIDDEN', ...);
it('11th generation in a UTC day → GENERATION_LIMIT; day boundary resets', async () => {
  setNow(() => new Date('2027-03-01T23:59:59Z'));
  for (let i = 0; i < 10; i++) await requestArtifact(seed.a.student, base);
  await expect(requestArtifact(seed.a.student, base)).rejects.toMatchObject({ code: 'GENERATION_LIMIT' });
  setNow(() => new Date('2027-03-02T00:00:00Z'));
  await expect(requestArtifact(seed.a.student, base)).resolves.toBeDefined();
});
it('concurrent requests at 9/10: exactly one succeeds', async () => {
  for (let i = 0; i < 9; i++) await requestArtifact(seed.a.student, base);
  const r = await Promise.allSettled([requestArtifact(seed.a.student, base), requestArtifact(seed.a.student, base)]);
  expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
});
it('enqueue failure marks the artifact failed instead of leaving it generating', async () => {
  rec.failNext = true;
  await expect(requestArtifact(seed.a.student, base)).rejects.toThrow();
  expect((await listArtifacts(seed.a.student, {}))[0]).toMatchObject({ status: 'failed' });
});
it('getArtifact never leaks keys: deep scan of the JSON', async () => {
  const id = await insertReadyArtifact('practice_test'); // content has correctIndex, modelAnswer, rubric on every question
  for (const kind of ['practice_test','mock_exam','study_notes','last_night_notes']) {
    const json = JSON.stringify(await getArtifact(seed.a.student, await insertReadyArtifact(kind)));
    expect(json).not.toMatch(/correctIndex|modelAnswer|rubric/);
    expect(json).not.toContain(SECRET_MODEL_ANSWER_TEXT); expect(json).not.toContain(SECRET_RUBRIC_TEXT);
  }
});
it('another student or another school gets NOT_FOUND', ...);
it('survives chapters/chunks being deleted after generation', async () => {
  const id = await insertReadyArtifact('practice_test');
  await withPlatform(tx => tx.execute(sql`delete from content_items`)); // cascades chapters and chunks
  const v = await getArtifact(seed.a.student, id);
  expect(v.status).toBe('ready'); expect(v.questions![0].citations.length).toBeGreaterThan(0);
  expect(Object.values(v.chapterTitles).length).toBeGreaterThan(0);
});
it('listArtifacts filters by type and lists only own', ...);
```

- [ ] **Step 2: Run** `pnpm vitest run tests/studytools/artifacts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as described. UTC day start is computed in TS from `now()` and passed as a parameter, so the fake clock governs the boundary.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(studytools): request, view, and list artifacts with limits and answer-key stripping"`

---

### Task 6: Attempts (start, autosave, submit) and MCQ scoring

**Files:**
- Create: `src/modules/studytools/attempts.ts`, `src/modules/studytools/scoring.ts`, `src/modules/studytools/finalize.ts`
- Modify: `src/modules/studytools/index.ts`
- Test: `tests/studytools/attempts.test.ts`, `tests/studytools/scoring.test.ts`

**Interfaces:**
- Consumes: `now`, `getStudyQueue`, `runAs`, `studentScope`, `toArtifactView`
- Produces:
  - `type Results = Record<questionId, { score: number; maxScore: number; feedback?: string; correct?: boolean; needsReview?: true }>`
  - `type ByChapter = Record<chapterId, { scored: number; max: number }>`
  - `flattenQuestions(content): StoredQuestion[]` (practice: `questions`; mock: all sections in order).
  - `scoreMcq(q: StoredQuestion, answer: unknown): { score: number; maxScore: number; correct: boolean }`: a missing or invalid answer scores 0.
  - `clampScore(score: number, marks: number): number`: clamp to 0..marks, round to the nearest 0.5.
  - `buildByChapter(questions, results): ByChapter`: `max` sums every question's marks (answered or not).
  - `finalizeAttempt(tx: Tx, attemptId: string): Promise<boolean>`: locks the row `for update`; if every question has a result and status is not `graded`, writes `score`, `max_score`, `by_chapter`, `graded_at`, `status = 'graded'` and returns true; otherwise returns false (idempotent).
  - `startAttempt(actor, artifactId): Promise<{ attemptId: string; startedAt: Date; deadline: Date | null }>`: artifact must be own and `ready`, else `NOT_FOUND` or `VALIDATION`. Notes types throw `VALIDATION`. `deadline = startedAt + durationMinutes` for mock exams only (the 2-minute grace is enforced server-side and **not** shown to the client).
  - `saveAnswers(actor, attemptId, answers: Record<string, number | string>): Promise<void>`: replaces the whole `answers` object. All-or-nothing validation:
    - an unknown question id → `VALIDATION`
    - MCQ answer must be an integer 0..3
    - non-MCQ answer must be a string of ≤ 10000 chars
    - `status != in_progress` → `VALIDATION`
    - past deadline + 2 min → `ATTEMPT_EXPIRED`
  - `submitAttempt(actor, attemptId): Promise<{ status: 'grading' | 'graded' }>`: in one transaction, `select … for update` the attempt.
    - Already submitted → return the current status (idempotent).
    - Past deadline + 2 min → `ATTEMPT_EXPIRED`.
    - Otherwise score MCQs; unanswered or blank subjective questions score 0 with no job; set `submitted_at`, `results`, status `grading`; call `finalizeAttempt`.
    - After commit, enqueue one grade job per answered subjective question.
  - `type AttemptView = { id; artifactId; status; startedAt; deadline: Date | null; submittedAt: Date | null; answers; artifact: ArtifactView; results?: ...; score?; maxScore?; byChapter?; questions?: ReviewQuestion[] }`. Keys (`correctIndex`, `modelAnswer`, `rubric`) appear only in `ReviewQuestion[]` and only when `submitted_at` is set.
  - `getAttempt(actor, attemptId): Promise<AttemptView>`: own, else `NOT_FOUND`.

- [ ] **Step 1: Write the failing tests:**

```ts
// scoring.test.ts
it.each([[7.3,5,5],[-1,5,0],[2.26,5,2.5],[2.24,5,2],[3.75,5,4],[0,2,0]])('clampScore(%s,%s)=%s', (s,m,e) => expect(clampScore(s,m)).toBe(e));
it('scoreMcq: correct, wrong, missing, wrong type', ...);
it('buildByChapter sums per chapter and counts unanswered marks in max', () => {
  // q1 ch1 mcq 1 correct; q2 ch1 short 2 scored 1.5; q3 ch2 short 2 unanswered(0)
  expect(buildByChapter(qs, results)).toEqual({ ch1: { scored: 2.5, max: 3 }, ch2: { scored: 0, max: 2 } });
});

// attempts.test.ts  (fixtures: ready practice_test with 6 mcq + 2 short; ready mock_exam junior_50; notes artifact)
it('startAttempt: notes → VALIDATION; non-ready → VALIDATION; others artifact → NOT_FOUND', ...);
it('practice test has no deadline; mock exam deadline = start + duration', async () => {
  setNow(() => T0);
  expect((await startAttempt(student, practiceId)).deadline).toBeNull();
  expect((await startAttempt(student, mockId)).deadline).toEqual(new Date(T0.getTime() + 120 * 60_000));
});
it('several attempts on the same test are allowed', ...);
it.each([
  ['unknown question id', { 'nope': 1 }], ['mcq index 4', { [mcqId]: 4 }], ['mcq index -1', { [mcqId]: -1 }],
  ['mcq 1.5', { [mcqId]: 1.5 }], ['mcq string', { [mcqId]: '2' }], ['short as number', { [shortId]: 3 }],
  ['one bad among good', { [mcqId]: 1, [shortId]: 3 }],
])('saveAnswers rejects %s with VALIDATION and saves nothing', async (_n, answers) => {
  await expect(saveAnswers(student, attemptId, answers)).rejects.toMatchObject({ code: 'VALIDATION' });
  expect((await getAttempt(student, attemptId)).answers).toEqual({});
});
it('saveAnswers replaces the map (autosave semantics)', ...);
it('saveAnswers after submit → VALIDATION', ...);
it('expiry with fake clock: within grace ok, after grace ATTEMPT_EXPIRED for submit and save', async () => {
  setNow(() => T0); const { attemptId } = await startAttempt(student, mockId);
  setNow(() => new Date(T0.getTime() + (120 + 2) * 60_000));            // exactly at deadline+grace: allowed
  await expect(submitAttempt(student, attemptId)).resolves.toBeDefined();
  // second attempt: one ms past → ATTEMPT_EXPIRED
});
it('MCQ-only practice test finalizes immediately as graded with exact score and by_chapter', async () => {
  await saveAnswers(student, attemptId, { q0: 1, q1: 0 /* one right, one wrong, rest blank */ });
  expect(await submitAttempt(student, attemptId)).toEqual({ status: 'graded' });
  const v = await getAttempt(student, attemptId);
  expect(v).toMatchObject({ score: 1, maxScore: 6, status: 'graded' });
  expect(rec.grade).toHaveLength(0);
});
it('mixed test: status grading, MCQ scored, one grade job per ANSWERED subjective only', async () => {
  // short s0 answered, s1 blank → 1 job; s1 result already {score 0}
  expect(await submitAttempt(...)).toEqual({ status: 'grading' });
  expect(rec.grade.map(j => j.questionId)).toEqual([s0]);
});
it('double submit concurrently: one scoring pass, one set of jobs, both calls resolve', async () => {
  const [a, b] = await Promise.all([submitAttempt(student, attemptId), submitAttempt(student, attemptId)]);
  expect([a.status, b.status]).toEqual(['grading', 'grading']);
  expect(rec.grade).toHaveLength(1);
});
it('keys hidden before submit, present after', async () => {
  expect(JSON.stringify(await getAttempt(student, attemptId))).not.toMatch(/correctIndex|modelAnswer|rubric/);
  await submitAttempt(student, attemptId);
  expect((await getAttempt(student, attemptId)).questions![0]).toHaveProperty('correctIndex');
});
it("another student's attempt → NOT_FOUND on every function", ...);
```

- [ ] **Step 2: Run** `pnpm vitest run tests/studytools/scoring.test.ts tests/studytools/attempts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Lock order is always attempt row first. `submitAttempt` enqueues after commit; enqueue failure handling is added in Task 7.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(studytools): attempts with autosave, expiry, MCQ scoring, and idempotent submit"`

---

### Task 7: Grading job, finalization races, and worker registration

**Files:**
- Create: `src/modules/studytools/grading.ts`
- Modify: `src/modules/studytools/queue.ts` (add `PgBossQueue`, default `getStudyQueue`, `registerStudyToolsWorkers`, `GRADE_CONCURRENCY`), `src/modules/studytools/attempts.ts` (enqueue failure path), the worker entrypoint created by plan 2 (the file `pnpm worker` runs; call `registerStudyToolsWorkers(boss)` there)
- Test: `tests/studytools/grading.test.ts`, `tests/studytools/worker.test.ts`

**Interfaces:**
- Consumes: `callGrader`, `buildGraderPrompt`, `finalizeAttempt`, `clampScore`, `loadActor`, `flattenQuestions`
- Produces:
  - `handleGradeJob(job: { data: GradeJob } & Partial<JobMeta>): Promise<void>`
    - Skips if the attempt is not `grading` or the question already has a result.
    - Otherwise it loads the question and answer **outside** any lock, calls `callGrader` (a `VALIDATION` failure from it is treated like any other grader error), then in a transaction locks the attempt row, merges `results[questionId]`, and calls `finalizeAttempt`.
    - On grader error: rethrow unless `retryCount >= retryLimit`, in which case record `{ score: 0, maxScore: marks, feedback: 'This answer could not be graded automatically. Your teacher can review it.', needsReview: true }` and finalize.
  - `failPendingQuestions(attemptId: string, schoolId: string): Promise<void>`: records the same needs-review result for every question still lacking a result, then finalizes.
  - `GRADE_CONCURRENCY = 4`, `GENERATE_CONCURRENCY = 2`
  - `class PgBossQueue implements StudyQueue` (creates queues `studytools.generate`, `studytools.grade` with `retryLimit: 2, retryBackoff: true`; `enqueueGrade` uses `sendBatch`).
  - `registerStudyToolsWorkers(boss: Pick<PgBoss, 'createQueue' | 'work'>): Promise<void>`: `work('studytools.grade', { localConcurrency: GRADE_CONCURRENCY }, …)` and the generate worker, passing `retryCount` and `retryLimit` from the job into the handlers.
  - `submitAttempt` change: if `enqueueGrade` throws, call `failPendingQuestions` and return `{ status: 'graded' }`.

- [ ] **Step 1: Write the failing tests** (fixture: submitted attempt with 1 MCQ right, short `s0` answered, long `l0` answered; `rec.grade` holds the 2 jobs):

```ts
it('grades a question and merges feedback; attempt finalizes only when the last result arrives', async () => {
  useMockModels({ standard: mockModel([{ score: 1.5, feedback: 'Good, mention X.' }, { score: 4, feedback: 'Add Y.' }]) });
  await handleGradeJob({ data: rec.grade[0] });
  expect((await getAttempt(student, attemptId)).status).toBe('grading');
  await handleGradeJob({ data: rec.grade[1] });
  const v = await getAttempt(student, attemptId);
  expect(v).toMatchObject({ status: 'graded', score: 1 + 1.5 + 4, maxScore: 1 + 2 + 5 });
  expect(v.results![s0]).toMatchObject({ score: 1.5, maxScore: 2, feedback: 'Good, mention X.' });
  expect(v.byChapter).toEqual({ [ch1]: { scored: 2.5, max: 3 }, [ch2]: { scored: 4, max: 5 } });
});
it('grader score is clamped to marks and rounded to 0.5 in the stored result', ...);
it('one grader call per question: model called once per job', ...);
it('a grader failing on the FINAL retry scores 0 with needsReview and the attempt still reaches graded', async () => {
  useMockModels({ standard: mockModel([new Error('provider down'), new Error('provider down')]) });
  await handleGradeJob({ data: rec.grade[0], retryCount: 2, retryLimit: 2 });
  await handleGradeJob({ data: rec.grade[1], retryCount: 2, retryLimit: 2 });
  expect(await getAttempt(student, attemptId)).toMatchObject({ status: 'graded' });
  expect(results[s0]).toMatchObject({ score: 0, needsReview: true });
});
it('a grader failing on a NON-final retry rethrows and records nothing', async () => {
  await expect(handleGradeJob({ data: rec.grade[0], retryCount: 0, retryLimit: 2 })).rejects.toThrow();
  expect((await getAttempt(student, attemptId)).status).toBe('grading');
});
it('two grade jobs finishing concurrently finalize exactly once with the right total', async () => {
  await Promise.all(rec.grade.map(d => handleGradeJob({ data: d })));
  const v = await getAttempt(...);
  expect(v).toMatchObject({ status: 'graded', score: expectedTotal });
  expect(await gradedAtWrites(attemptId)).toBe(1);               // graded_at set once: second finalize returned false
});
it('redelivered job for an already-graded question is a no-op (no model call)', ...);
it('enqueue failure at submit does not strand the attempt', async () => {
  rec.failNext = true;
  expect(await submitAttempt(student, attemptId)).toEqual({ status: 'graded' });
  expect(results[s0]).toMatchObject({ needsReview: true });
});
it('blank subjective answer never reaches the grader', ...);

// worker.test.ts
it('registers grade worker with concurrency 4 and rethrows retry metadata', async () => {
  const calls: any[] = []; const boss = { createQueue: async () => {}, work: async (...a: any[]) => { calls.push(a); } };
  await registerStudyToolsWorkers(boss as any);
  const grade = calls.find(c => c[0] === 'studytools.grade');
  expect(grade[1]).toMatchObject({ localConcurrency: 4 });
  expect(calls.map(c => c[0]).sort()).toEqual(['studytools.generate', 'studytools.grade']);
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/studytools/grading.test.ts tests/studytools/worker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Merge with `results = coalesce(results,'{}'::jsonb) || $new` inside the locked transaction. Never hold the row lock during the LLM call.
- [ ] **Step 4: Run** the tests plus `pnpm vitest run tests/studytools`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(studytools): per-question grading job, race-safe finalization, and worker registration"`

---

### Task 8: chapterProgress and its scoping

**Files:**
- Create: `src/modules/studytools/progress.ts`
- Modify: `src/modules/studytools/index.ts`
- Test: `tests/studytools/progress.test.ts`

**Interfaces:**
- Consumes: `runAs`, `canManageBranch`, `canManageSchool`
- Produces:
  - `type ChapterProgressRow = { studentId: string; subjectId: string; chapterId: string; chapterTitle: string; scored: number; max: number; attempts: number }`
  - `chapterProgress(actor, opts: { studentIds?: string[]; subjectId?: string }): Promise<ChapterProgressRow[]>`
  - Sums `by_chapter` over **graded** attempts, grouped by student, artifact subject, and chapter. `attempts` counts graded attempts that touched that chapter. `chapterTitle` comes from the newest artifact's `params.chapterTitles` snapshot, so deleted chapters still have a title.
  - Scope, enforced in SQL under RLS:
    - **student:** own rows only; `studentIds` naming others is silently narrowed to self.
    - **teacher:** only students whose `student_profiles.section_id` and the artifact's `subject_id` match a `teacher_assignments` row of that teacher.
    - **branch_admin:** students of their branch.
    - **school_admin:** the whole school.
    - **platform admin:** `FORBIDDEN` (it has no school context; sub-project 5 reads through school actors).
    - Any other role: `FORBIDDEN`.

- [ ] **Step 1: Write the failing tests.** Fixture: in school A, two sections (8-A with the teacher assigned to subject S1 only, 8-B unassigned), students `s1` (8-A), `s2` (8-B), graded attempts by_chapter rows for subjects S1 and S2; plus a student in school B.

```ts
it('sums by_chapter over graded attempts only, ignoring in_progress and grading', async () => {
  // two graded attempts ch1: {2,3} + {3,3}; one grading attempt ignored
  expect(rowFor(rows, s1, ch1)).toMatchObject({ scored: 5, max: 6, attempts: 2 });
});
it('student sees only themselves, even when asking for another id', async () => {
  const rows = await chapterProgress(s1Actor, { studentIds: [s1, s2] });
  expect(new Set(rows.map(r => r.studentId))).toEqual(new Set([s1]));
});
it('teacher sees only assigned section + subject', async () => {
  const rows = await chapterProgress(seed.a.teacher, {});
  expect(rows.every(r => r.studentId === s1 && r.subjectId === S1)).toBe(true);   // not s2, not S2
});
it('subjectId filter narrows; branch_admin sees own branch; school_admin sees school; never school B', ...);
it('platform admin and roleless actors are FORBIDDEN', ...);
it('deleted chapters keep their snapshot title', async () => {
  await withPlatform(tx => tx.execute(sql`delete from content_items`));
  expect(rowFor(await chapterProgress(s1Actor, {}), s1, ch1).chapterTitle).toBe('Chapter 1: Real Numbers');
});
it('ratio inputs are numeric, not strings', () => expect(typeof rows[0].scored).toBe('number'));
```

- [ ] **Step 2: Run** `pnpm vitest run tests/studytools/progress.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with one SQL query using `jsonb_each` over `by_chapter`, parameterized, run through `runAs`. Cast `numeric` to `float8`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(studytools): role-scoped chapter progress"`

---

### Task 9: HTTP API

**Files:**
- Create: `src/app/api/study/patterns/route.ts`, `src/app/api/study/artifacts/route.ts`, `src/app/api/study/artifacts/[id]/route.ts`, `src/app/api/study/artifacts/[id]/attempts/route.ts`, `src/app/api/study/attempts/[id]/answers/route.ts`, `src/app/api/study/attempts/[id]/submit/route.ts`, `src/app/api/study/attempts/[id]/route.ts`, `src/app/api/study/progress/route.ts`
- Modify: `src/app/learn/layout.tsx` is deferred to Task 10
- Test: `tests/http/study-routes.test.ts`

**Interfaces:**
- Consumes: `handle`, `readJson`, `parseWith`, `requireActor`, `json`, the studytools public API
- Produces (each handler is `handle(...)`-wrapped; ids validated as UUIDs, bad ids → 400 `VALIDATION`):
  - `GET /api/study/patterns` → `ExamPatternRow[]` for the actor's grade (404-free; staff get all)
  - `POST /api/study/artifacts` `{ type, subjectId, chapterIds, questionCount?, patternKey? }` → 201 `{ id }`
  - `GET /api/study/artifacts?type=` → `ArtifactSummary[]`
  - `GET /api/study/artifacts/:id` → `ArtifactView`
  - `POST /api/study/artifacts/:id/attempts` → 201 `{ attemptId, startedAt, deadline }`
  - `PUT /api/study/attempts/:id/answers` `{ answers: Record<string, number|string> }` → 204
  - `POST /api/study/attempts/:id/submit` → `{ status }`
  - `GET /api/study/attempts/:id` → `AttemptView`
  - `GET /api/study/progress?subjectId=&studentIds=a,b` → `ChapterProgressRow[]`
  - Answers bodies use a raised `readJson` cap only if needed (100 KB default is enough: 30 answers × 10000 chars would exceed it, so cap answer text at 10000 and let `readJson` use a 400 KB limit for this route).

- [ ] **Step 1: Write the failing tests** (handlers called with `new Request`, session cookie via `login('<seed username>', SEED_PASSWORD)` for an activated student; `RecordingQueue` installed):

```ts
it('POST artifacts → 201 and GET polls generating → ready after the job runs', async () => {
  const res = await POST(req('/api/study/artifacts', body, cookie));
  expect(res.status).toBe(201);
  const { id } = await res.json();
  expect((await (await GET(req(`/api/study/artifacts/${id}`, null, cookie), ctx(id))).json()).status).toBe('generating');
  useMockModels({ standard: mockModel([validPracticeJson(ids)]) });
  await handleGenerateJob({ data: rec.generate[0] });
  const view = await (await GET(...)).json();
  expect(view.status).toBe('ready'); expect(JSON.stringify(view)).not.toMatch(/correctIndex|modelAnswer|rubric/);
});
it('maps GENERATION_LIMIT → 429 and ATTEMPT_EXPIRED → 409 with error bodies', async () => {
  // 10 creations then 11th: res.status 429, body.error.code 'GENERATION_LIMIT'
  // expired save: 409 'ATTEMPT_EXPIRED'
});
it('PUT answers with MCQ index 9 → 400 VALIDATION', ...);
it('unauthenticated → 401; pending student → 403; other student attempt → 404', ...);
it('submit twice returns 200 both times', ...);
it('GET attempt before submit has no keys; after submit has them', ...);
it('progress as teacher is scoped; as student is own', ...);
it('malformed UUID in path → 400', ...);
```

- [ ] **Step 2: Run** `pnpm vitest run tests/http/study-routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** thin handlers with a zod schema per body or query (zod 4, `parseWith`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(api): study tools endpoints"`

---

### Task 10: Study UI pages and Playwright e2e

**Files:**
- Create: `src/app/learn/study/page.tsx`, `src/app/learn/study/a/[id]/page.tsx`, `src/app/learn/study/a/[id]/take/page.tsx`, `src/app/learn/study/attempt/[id]/page.tsx`, `src/app/learn/study/_lib/{api,useAutosave,useCountdown,Citations}.ts(x)`, `src/app/learn/study/study.module.css`, `e2e/study.spec.ts`
- Modify: `src/app/learn/layout.tsx` (add the "Study" nav link; if plan 3 has not created the layout, create it with the nav)
- Test: `tests/ui/study-hooks.test.ts` (Vitest, no DOM framework needed: pure functions), `e2e/study.spec.ts`

**Interfaces:**
- Consumes: Task 9 endpoints; `react-markdown` for notes
- Produces (mobile-first, one column, max-width 480px, plain CSS modules):
  - **Pure helpers in `_lib/`:**
    - `secondsLeft(deadline: string, nowMs: number): number` (min 0)
    - `shouldAutosave(lastSavedAt: number, dirty: boolean, nowMs: number): boolean` (true when dirty and ≥ 10 000 ms since the last save)
    - `nextPollDelay(status: string): number | null` (2000 while `generating`, otherwise null)
    - `formatCitation(c: Citation): string` → `Book · Chapter · p. 12–13`
  - **`/learn/study`:** four tabs (practice tests, mock exams, notes, last-night notes). Each has a "Create" form (subject select → chapter multi-select limited to 6 → count 5–30 or pattern select) and a list with status badges (`Generating…`, `Ready`, `Failed — try again`). It polls only while a row is `generating`.
  - **`/learn/study/a/[id]`:** notes view, rendered markdown with citation chips. For tests it shows "Start test" and the attempt history instead.
  - **`/learn/study/a/[id]/take`:**
    - Creates the attempt on mount, then shows one question per screen with Previous/Next and a question-number strip.
    - MCQ renders radio options. Short, long, and case render a textarea.
    - Autosave every 10 s when dirty and on Next/Previous.
    - Mock exams show a countdown, auto-submit at 0, and show an expiry message on `ATTEMPT_EXPIRED`.
    - Submit asks for confirmation, then navigates to the results page.
  - **`/learn/study/attempt/[id]`:** polls every 2 s while `grading`, then shows the total, per-chapter summary, and per question: score, feedback, correct answer or model answer, and a "Needs review" note where `needsReview` is set.

- [ ] **Step 1: Write the failing tests:**

```ts
// tests/ui/study-hooks.test.ts
it('secondsLeft never goes negative', () => expect(secondsLeft('2027-01-01T00:00:00Z', Date.parse('2027-01-01T00:00:05Z'))).toBe(0));
it('autosave fires only when dirty and 10s elapsed', () => {
  expect(shouldAutosave(0, true, 9_999)).toBe(false); expect(shouldAutosave(0, true, 10_000)).toBe(true); expect(shouldAutosave(0, false, 60_000)).toBe(false);
});
it('polls every 2s only while generating', () => { expect(nextPollDelay('generating')).toBe(2000); expect(nextPollDelay('ready')).toBeNull(); });
it('formats citations', () => expect(formatCitation({ itemTitle: 'Maths 8', chapterTitle: 'Real Numbers', pageStart: 12, pageEnd: 13, chunkId: 'x' })).toBe('Maths 8 · Real Numbers · p. 12–13'));
```

  `e2e/study.spec.ts` (mobile viewport 390×844). The e2e server runs with `STUDY_FAKES=1`, which installs a `RecordingQueue` variant that runs jobs **inline** and `setModels` to scripted mock models. This is a dev/test-only seam in `src/modules/studytools/test-mode.ts`, active only when `NODE_ENV !== 'production'`. Flow:
  1. In `beforeAll`, seed a school with an active student (`SEED_PASSWORD`), content via `seedStudyContent`, and the fake models.
  2. Log in and open `/learn/study`. Expect the "Study" nav link.
  3. Create a practice test: choose the subject, pick two chapters, count 5. Expect `Generating…`, then `Ready` within 5 s.
  4. Open it, start, answer MCQs by tapping options, type a short answer, press Next/Previous, then submit and confirm.
  5. On the results page expect "Graded", a score of the form `n / m`, feedback text from the fake grader, the correct answers, and a per-chapter line.
  6. Create last-night notes and expect the markdown heading and a citation chip.
  7. Create a mock exam and open the take page. Expect a countdown that starts at `2:00:00` (junior_50 for a grade-8 student).
- [ ] **Step 2: Run** `pnpm vitest run tests/ui/study-hooks.test.ts && pnpm e2e e2e/study.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, pages, nav link, and the test-mode seam.
- [ ] **Step 4: Run** the same commands, then `pnpm vitest run && pnpm e2e`. Expected: all PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(web): study hub, notes, take, and results pages with e2e"`

---

### Task 11: Isolation suite extension

**Files:**
- Modify: `tests/isolation/services.test.ts` is left alone. Create `tests/isolation/studytools.test.ts`; `package.json` `test:isolation` already globs the directory.
- Test: `tests/isolation/studytools.test.ts`

**Interfaces:**
- Consumes: every public function of `src/modules/studytools/index.ts`; `seedTwoSchools`, `activateStudent`, `seedStudyContent`, `insertArtifact`
- Produces: no new code. Any failure is a real leak to be fixed in the owning task's module.

- [ ] **Step 1: Write the isolation tests.** Seed both schools with an active student, content, a ready artifact, and a graded attempt each. Acting as A's actors against B's ids:
  - `getArtifact(a.student, bArtifactId)`, `startAttempt(a.student, bArtifactId)`, `getAttempt`, `saveAnswers`, and `submitAttempt` on B's ids all reject `NOT_FOUND`, and B's rows are unchanged (verified through `withPlatform`).
  - `requestArtifact(a.student, { subjectId: b.subjectId, chapterIds: bChapterIds, ... })` rejects `VALIDATION`, and no artifact row is created for either school.
  - `listArtifacts(a.student, {})` contains only A's ids.
  - `chapterProgress` as `a.schoolAdmin`, `a.branchAdmin`, and `a.teacher` returns no `studentId` of school B; passing `studentIds: [b.studentId]` returns nothing.
  - `handleGradeJob` with `{ attemptId: bAttempt, schoolId: a.schoolId, questionId }` (a mismatched payload) is a no-op: B's attempt is unchanged. Same for `handleGenerateJob` with B's artifact id under A's `schoolId`.
  - Raw: `withTenant(a.schoolId, tx => tx.select().from(artifacts|attempts))` returns only A rows, and a school A tenant cannot update B's attempt (`rowCount 0`).
  - Deep-scan: JSON of every `ArtifactView`, `ArtifactSummary`, and `AttemptView` returned to A contains no B ids.
- [ ] **Step 2: Run** `pnpm vitest run tests/isolation`. Expected: PASS if Tasks 1–8 are correct; a failure is a leak, fix it before continuing.
- [ ] **Step 3: Run the full gate:** `pnpm typecheck && pnpm vitest run && pnpm e2e`. Expected: all PASS.
- [ ] **Step 4: Commit:** `git commit -m "test: study tools cross-school isolation suite"`
