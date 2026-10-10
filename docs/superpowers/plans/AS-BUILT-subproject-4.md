# As-built: sub-project 4 (study tools)

Later plans must use these real names. They take precedence over plan 4's text wherever the two differ.

## Public exports of `src/modules/studytools/index.ts`
- Artifacts: `requestArtifact`, `getArtifact`, `listArtifacts`, `toArtifactView`, `DAILY_GENERATION_LIMIT` (10 per student per UTC day); types `ArtifactDetail` (view plus `attempts: AttemptSummary[]`), `ArtifactSummary`, `AttemptSummary`, `ArtifactView`, `RequestArtifactInput`, `ViewNote`, `ViewQuestion`, `ViewSection`, `Citation`, `ArtifactType`
- Attempts: `startAttempt` (returns `StartedAttempt` = `{ attemptId, startedAt, deadline, answers }`; `answers` is the saved map on resume, `{}` on a new attempt), `saveAnswers`, `submitAttempt`, `getAttempt`; types `AttemptView`, `ReviewQuestion`, `StartedAttempt`
- Jobs: `handleGenerateJob`, `handleGradeJob`, `registerStudyToolsWorkers`, `PgBossQueue`, `getStudyQueue`, `setStudyQueue`, `GRADE_CONCURRENCY` (4), `GENERATE_CONCURRENCY` (2); types `GenerateJob`, `GradeJob`, `JobMeta`, `StudyQueue`
- Scoring and finalization: `buildByChapter`, `clampScore`, `flattenQuestions`, `scoreMcq`, `finalizeAttempt`, `failPendingQuestions`; types `ByChapter`, `Results`
- Patterns: `defaultPatternKey`, `getPattern`, `listExamPatterns`; types `ExamPatternRow`, `PatternSection`
- Progress: `chapterProgress`; type `ChapterProgressRow`
- Other modules import only from the index.

## HTTP endpoints (`src/app/api/study/**`, all need an authenticated actor)
- `POST /api/study/artifacts`: request an artifact (201 `{ id }`). `GET /api/study/artifacts?type=`: the student's own list.
- `GET /api/study/artifacts/:id`: the view plus `attempts` (newest first; no answer keys).
- `POST /api/study/artifacts/:id/attempts`: start or resume (201 `{ attemptId, startedAt, deadline, answers }`).
- `PUT /api/study/attempts/:id/answers` (204, replaces the whole map, all-or-nothing validation), `POST /api/study/attempts/:id/submit` (`{ status }`), `GET /api/study/attempts/:id` (review data appears after submit).
- `GET /api/study/chapters?subjectId=`: chapters of a subject visible to the active student (`id`, `title`, `itemTitle`, `ordinal`), for the create form.
- `GET /api/study/patterns`: exam patterns (students: their grade; staff: all).
- `GET /api/study/progress?subjectId=&studentIds=a,b`: `chapterProgress` for the caller's role.
- Error codes: `GENERATION_LIMIT` 429, `ATTEMPT_EXPIRED` 409.

## Queues (pg-boss 12)
- `studytools.generate`: `policy: 'stately'`, `retryLimit: 2`, `retryBackoff`, worker `localConcurrency` 2. Each job is sent with `singletonKey = artifactId`.
- `studytools.grade`: `policy: 'stately'`, `retryLimit: 2`, `retryBackoff`, worker `localConcurrency` 4. Each job is inserted with `singletonKey = "<attemptId>:<questionId>"`.
- `ingest` (sub-project 2) is now `stately` too (`singletonKey = contentItemId`).
- `stately` allows one queued (created/retry) and one active job per key, so a duplicate send while one is queued is dropped; `singletonKey` has no effect on a standard queue.
- pg-boss cannot change a queue's policy after creation. `ensureQueue` (`src/lib/boss.ts`) drops and recreates a queue whose existing policy differs (existing dev DBs); jobs queued at that moment are lost, which the recovery paths below cover.
- Workers are registered on the ingest worker's boss in `src/worker.ts` via `registerStudyToolsWorkers`.

## Shared send-only boss (`src/lib/boss.ts`)
- `getSendBoss()`: one `PgBoss` per web process, cached on `globalThis.__sendBoss` (survives HMR), started with `SEND_BOSS_OPTIONS = { supervise: false, schedule: false, max: 2 }` as the owner role. A failed start is not cached. `stopSendBoss()` stops and forgets it (the boss also forgets itself on `stopped`).
- Both `PgBossQueue` classes (content ingest and study tools) use it by default. The worker process keeps its own full boss (`startBoss`, with supervise and schedule on).

## Clock seam
`src/modules/studytools/clock.ts`: `now()` and `setNow(fn | null)`. Not exported from the index; tests import it directly. Every time rule (deadline and grace, daily limit, stuck recovery, the generating reaper) reads `now()`.

## Test helpers (`tests/helpers/study.ts`)
`useRecordingQueue()` (installs a `RecordingQueue` with `generate`, `grade`, `failNext` per test), `useMockModels({ standard?, advanced? })` and `resetStudyMocks()` (scripted `mockModel`), `insertArtifact(schoolId, studentId, subjectId, over)`, `seedStudyContent(school, { chapters, chunksPerChapter })`, `activateStudent`, plus question/exam fixtures (`mcq`, `short`, `practice`, `mockFor`, `notes`).

## `chapterProgress(actor, { studentIds?, subjectId? })` semantics (for sub-project 5)
- Role scoping is in SQL: school admin sees the school; branch admin their branch; teacher only students in sections and subjects they are assigned to; student only themselves (a `studentIds` filter is ignored for students). Platform admin or a roleless actor throws `FORBIDDEN`.
- Rows are per student, subject and chapter, summed over `graded` attempts only (`attempts` counts those attempts). Rows exist only for chapters that appear in a graded attempt's `by_chapter`.
- Questions with `needsReview` (grader failed) count toward neither `scored` nor `max`; a chapter left with no scored question is omitted. The same rule applies to an attempt's `score` and `max_score`. The attempt view still shows those questions as "Needs review".
- Students whose `student_profiles.status = 'removed'` are excluded. Lapsed students stay in.
- `chapterTitle` is the newest artifact's `params.chapterTitles` snapshot, so deleted chapters keep a title.
- Ordered by student, subject, chapter id; numbers are JS numbers.

## Recovery and reaper behaviors
- Stuck grading: `getAttempt` and a repeated `submitAttempt` call `recoverStuckAttempt` for an attempt still `grading` more than `STUCK_AFTER_MS` (10 min) after `submitted_at`. It re-enqueues grade jobs for subjective questions without a result, at most once per `STUCK_AFTER_MS` per attempt (`attempts.recovered_at`). If the enqueue fails, those questions are zeroed with `needsReview`. Best effort; it never throws.
- Grader failures: a grader that fails its last retry stores score 0 with `needsReview`; a failed enqueue at submit does the same through `failPendingQuestions`. The attempt still reaches `graded`.
- Generating reaper: `getArtifact` and `listArtifacts` mark the caller's own artifacts still `generating` for more than `GENERATING_STALE_MS` (15 min, `artifacts.created_at` vs `now()`) as `failed` with `error = 'GENERATION_FAILED'`. A late generate job is a no-op (it only updates a `generating` row).
- Expired attempts: when `startAttempt` or `getAttempt` meets the student's `in_progress` attempt past `deadline + 2 min grace`, it is auto-submitted with `submitted_at = deadline` through the normal scoring path (MCQ scored, blank subjective 0, answered subjective enqueued) and then finalizes as usual. `startAttempt` then creates a fresh attempt. `saveAnswers` and `submitAttempt` on an expired attempt still throw `ATTEMPT_EXPIRED`.

## Web (`src/app/(student)/learn/study/**`)
- The take page starts through `_lib/start.ts` `startTake`: one artifact GET plus the start POST, and the saved answers come from the POST. Any failure is fatal (error state, no attempt id, autosave off).
- The attempt page link reads "Resume attempt" for a resumable `in_progress` attempt (`takeLinkLabel`), otherwise "Start a new attempt".

## Migrations
`0010_study_rls.sql` (artifacts, attempts, exam patterns), `0011_study_recovered_at.sql` (`attempts.recovered_at`).
