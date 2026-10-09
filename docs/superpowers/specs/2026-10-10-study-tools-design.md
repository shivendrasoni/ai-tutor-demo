# Sub-spec 4: Study Tools

- **Date:** 2026-10-10
- **Parent spec:** `2026-10-10-ai-tutor-architecture-design.md`. This spec covers §4.4 (artifacts, attempts), §6.4, module ⑤, and the study-tool tests in §8.
- **Depends on:** sub-project 2 (`studentScope`, `listVisibleSubjects`, `listVisibleChapters`, `chunksForChapters`) and sub-project 3 (`runSkillStructured`, `seedSkills`, `ModelRegistry`, the pricing and usage logging).

## 1. Goal
Students generate practice tests, mock exams, study notes, and last-night notes from chosen chapters. They take the tests and get scored. Per-chapter results feed teacher progress views. Flashcards are out of scope.

## 2. Decisions
| Topic | Decision |
|---|---|
| Generation | Asynchronous. A pg-boss queue `studytools.generate` creates an artifact with `status = generating`, and the UI polls `GET /api/study/artifacts/:id` every 2 s |
| Context | `chunksForChapters(scope, chapterIds, maxTokens = 24000)`. The passages are numbered `[P1]…[Pn]` in the prompt, and every generated item must reference ≥ 1 passage id. There is no tool calling during generation |
| Model tier | `advanced` for mock exams. `standard` for everything else, including grading |
| Validation | Zod schemas (below). If the output fails the schema or cites an unknown passage, there is **one repair attempt**: re-prompt with the validation errors. If that fails, the artifact is set to `failed` with `error = 'GENERATION_FAILED'` |
| Answer secrecy | Answer keys, model answers, and rubrics are never sent to the client before the attempt is submitted |
| Grading | MCQ is auto-scored. Short and long answers go to the `answer_grader` skill, one question per call. Questions are graded in parallel (max 4 concurrent) in a pg-boss queue `studytools.grade`. While grading runs the attempt status is `grading`; then it becomes `graded` |
| Timing | Mock exams are timed by `duration_minutes`. The server rejects a submission after `started_at + duration + 2 min grace` with `ATTEMPT_EXPIRED`. Unanswered questions score 0. Practice tests are untimed |
| Limits | Per artifact, 1–6 chapters from **one subject**. Practice test question count is 5–30 (default 10). At most **10 generations per student per UTC day** (`GENERATION_LIMIT`) |

## 3. Data model
```
exam_patterns  id, key text unique, name, grade_min int, grade_max int, duration_minutes int,
               sections jsonb  -- [{ key, title, questionType: 'mcq'|'short'|'long'|'case', count, marksEach }]
               -- global, no RLS
artifacts      id, school_id, student_id, skill_id, type (practice_test|mock_exam|study_notes|last_night_notes),
               subject_id, chapter_ids uuid[], params jsonb, status (generating|ready|failed),
               error text null, content jsonb null, source_chunk_ids uuid[] default '{}', created_at
attempts       id, school_id, artifact_id, student_id, status (in_progress|grading|graded),
               started_at, submitted_at null, answers jsonb default '{}',
               results jsonb null,   -- per question: { score, maxScore, feedback?, correct? }
               score numeric null, max_score numeric null, by_chapter jsonb null, graded_at null
```

All tables except `exam_patterns` get forced RLS.

**Seeded exam patterns:**
- `standard_80` (grades 9–12, 180 min):
  - A: MCQ 20 × 1
  - B: short 5 × 2
  - C: short 6 × 3
  - D: long 4 × 5
  - E: case 3 × 4
  - Total: 80
- `junior_50` (grades 5–8, 120 min):
  - A: MCQ 10 × 1
  - B: short 10 × 2
  - C: long 4 × 5
  - Total: 50

## 4. Content schemas
```ts
Question = { id: string; type: 'mcq'|'short'|'long'|'case'; prompt: string; options?: string[4];
             correctIndex?: number;          // mcq only
             modelAnswer?: string; rubric?: string[];   // short/long/case: 2–5 rubric points
             marks: number; chapterId: string; passageRefs: string[] }   // e.g. ['P3']
PracticeTest = { title: string; questions: Question[] }
MockExam     = { title: string; patternKey: string; durationMinutes: number;
                 sections: { key: string; title: string; questions: Question[] }[] }
Notes        = { title: string; sections: { heading: string; bodyMarkdown: string; chapterId: string; passageRefs: string[] }[] }
```

- **Practice tests:** about 60% MCQ, the rest short answers; 1 mark per MCQ and 2 per short answer.
- **Mock exams** must match the pattern exactly: the same sections, counts, `questionType`, and `marksEach`. If they don't, the output counts as a validation failure.
- **Last-night notes** use the `Notes` schema, with these limits: at most 2 sections per chapter, each `bodyMarkdown` at most 120 words, made up of key formulas, definitions, and likely questions.
- After validation, `passageRefs` are mapped to chunk ids and stored in `source_chunk_ids`. Each question and section keeps its resolved `chunkIds` so the UI can show citations (book · chapter · pages).

## 5. Seeded skills (added to `seedSkills`)
- `practice_test_generator`, `mock_exam_generator`, `study_notes_generator`, `last_night_notes_generator` (kind `generator`): each has instructions for its schema, as above. They are told to use only the passages, to match the student's grade, and to reference passages.
- `answer_grader` (kind `grader`): input is the question, model answer, rubric, marks, and the student's answer. Output is `{ score: number (0..marks, in 0.5 steps), feedback: string (≤ 60 words, encouraging, says what was missing) }`.

## 6. Service interface (`src/modules/studytools/index.ts`)
```ts
listExamPatterns(grade) → Promise<ExamPatternRow[]>
requestArtifact(actor, { type, subjectId, chapterIds: string[], questionCount?: number, patternKey?: string })
  → Promise<{ id: string }>          // validates visibility of subject/chapters; enqueues
getArtifact(actor, id) → Promise<ArtifactView>   // strips answer keys/rubrics/modelAnswers
listArtifacts(actor, { type? }) → Promise<ArtifactSummary[]>
startAttempt(actor, artifactId) → Promise<{ attemptId: string; startedAt: Date; deadline: Date | null }>
saveAnswers(actor, attemptId, answers: Record<questionId, number | string>) → Promise<void>   // autosave
submitAttempt(actor, attemptId) → Promise<{ status: 'grading' | 'graded' }>
getAttempt(actor, attemptId) → Promise<AttemptView>   // after submit: includes keys, model answers, feedback
chapterProgress(actor, { studentIds?: string[]; subjectId?: string }) → Promise<ChapterProgressRow[]>
  // students: own; teacher: students in assigned sections+subjects; school/branch admins: their scope
  // row: { studentId, subjectId, chapterId, chapterTitle, scored, max, attempts }
handleGenerateJob(job) / handleGradeJob(job)   // worker handlers, registered in the pnpm worker process
```

- **Who can use it:** only `active` students can request artifacts and take attempts (otherwise `FORBIDDEN`). They can access only their own artifacts and attempts (otherwise `NOT_FOUND`).
- **Attempt rules:**
  - Notes artifacts have no attempts; calling `startAttempt` on one throws `VALIDATION`.
  - A student can have several attempts on the same test.
  - `saveAnswers` after a submission throws `VALIDATION`.
- **New `ErrorCode` values:** `GENERATION_LIMIT` (429), `ATTEMPT_EXPIRED` (409).
- **`by_chapter`** is `{ [chapterId]: { scored, max } }`. `chapterProgress` sums it over graded attempts.
- **Usage:** generation and grading token usage is added to the student's `usage_daily` and cost, through the tutor module's usage logger. Generation does **not** check the chat token budget; the generation limit applies instead.

## 7. HTTP and UI
- **API:**
  - `GET /api/study/patterns`
  - `POST /api/study/artifacts`
  - `GET /api/study/artifacts`
  - `GET /api/study/artifacts/:id`
  - `POST /api/study/artifacts/:id/attempts`
  - `PUT /api/study/attempts/:id/answers`
  - `POST /api/study/attempts/:id/submit`
  - `GET /api/study/attempts/:id`
  - `GET /api/study/progress`
- **Pages:**
  - `/learn/study`: hub with tabs for practice tests, mock exams, notes, and last-night notes. Each tab has a "Create" form (subject, then chapters as a multi-select, then count or pattern) and a list with status.
  - `/learn/study/a/[id]`: notes view, rendered markdown with citation chips.
  - `/learn/study/a/[id]/take`: one question per screen on mobile, with autosave every 10 s and on navigation. Mock exams show a countdown timer.
  - `/learn/study/attempt/[id]`: results with the per-question score and feedback, the correct answers, and a per-chapter summary.
  - The `/learn` nav gets a "Study" link.

## 8. Testing (fakes only)
- **Schemas:**
  - valid and invalid fixtures
  - an exact mock exam pattern match, and mismatches (count, marks, type)
  - an unknown passage ref is rejected
- **Generation job** with `MockLanguageModelV2`:
  - **Success:** stores content and `source_chunk_ids`.
  - **First output invalid, then valid:** succeeds after the repair.
  - **Invalid twice:** `failed` with `GENERATION_FAILED`.
- **`getArtifact`:** never includes `correctIndex`, `modelAnswer`, or `rubric`. This is checked by deep-scanning the JSON.
- **Scoring:**
  - MCQ auto-scoring
  - a grader score clamped to 0..marks and rounded to 0.5
  - `by_chapter` sums
  - a mock exam submitted after the deadline plus grace → `ATTEMPT_EXPIRED`, tested with a fake clock (`now` injectable)
- **Limits:**
  - the 11th generation in a UTC day → `GENERATION_LIMIT`
  - chapters from two subjects → `VALIDATION`
  - a chapter that isn't visible → `VALIDATION`
- **`chapterProgress` scoping:**
  - a teacher sees only assigned sections and subjects
  - a student sees only themselves
- **Isolation:** add the study-tools functions to `tests/isolation`.

## 9. Out of scope
Flashcards, teacher-assigned tests, PDF export, question banks shared across students.
