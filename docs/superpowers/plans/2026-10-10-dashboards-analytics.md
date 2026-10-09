# Dashboards & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build sub-project 5 of the AI tutor platform. It covers:
- the `analytics` module (enrollment, usage, progress, cost, routing health, flagged queue, schools listing)
- page guards and role-based home routing
- role dashboards `/school`, `/teacher`, and `/platform/*`, which replace the CLI as the main admin surface
- the new HTTP routes, a Playwright e2e suite, and the isolation-suite extension

**Architecture:**
- **Analytics module:** `src/modules/analytics` holds plain SQL aggregations (no materialised views). Each function takes an `Actor` first, runs through `runAs`, and throws `DomainError`. Time-dependent functions accept an optional `now?: Date` so windows are testable.
- **Pages:** Next.js server components stay thin. Each page calls a tested loader (`loaders.ts`), which calls module services directly with the actor from the `sid` cookie, and renders pure presentational components. Mutations are small client components that call API routes and then `router.refresh()`.
- **Guarding:** `src/lib/guard.ts` holds `requirePageActor` and re-exports `homeFor` from `src/lib/home.ts`.
- **Styling:** one shared CSS-module set in `src/app/ui/`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), Drizzle + `pg` raw SQL, zod, Vitest (with `react-dom/server` for component tests), Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-10-dashboards-analytics-design.md`. This plan implements §6.5 of the parent spec, module ⑥, and §9 (observability views). It assumes plans 1–4 are implemented per their interfaces: `listStudents`, `removeStudent`, `manualAddStudent`, `rotateBranchCode`, `setBranchCodeEnabled`, `listPendingSubscriptions`, `recordPayment`, `createPlan`, `createSchool`, `createBranch`, `chapterProgress`, `listVisibleChapters`, the `messages`/`usage_daily` tables, and `tests/helpers/db.ts`.

**As-built alignment (sub-project 1 is merged; `docs/superpowers/plans/AS-BUILT-subproject-1.md` overrides plan 1 text):**
- Import services only from `src/modules/{tenancy,enrollment}/index.ts`. Routes use the real `src/lib/http.ts` helpers: `handle`, `requireActor`, `readJson(req, zodSchema)`, `parseWith`, and `sessionToken(req)` for cookies.
- Existing files that are modified (not recreated): `src/app/page.tsx`, `src/app/(public)/login/page.tsx` (and its `_lib/` helper if the redirect logic lives there), `src/app/api/auth/login/route.ts`, and `tests/http/routes.test.ts`. `src/db/schema/index.ts` and `tenantTables` are not touched, because this plan adds no tables or migrations. The `tests/db/rls-catalog.test.ts` gate stays green.
- No new `ErrorCode` is introduced, so the `STATUS` map in `src/lib/http.ts` is unchanged.
- Test seeds reuse `seedTwoSchools` and `SEED_PASSWORD` (`'correct-horse'`) from `tests/helpers/db.ts`. Seeded users can log in with it, so e2e and route tests log in as seeded actors and need no custom user creation. `tests/helpers/analytics-seed.ts` adds new users with the same `SEED_PASSWORD`.
- The isolation suite is `tests/isolation/services.test.ts`; Task 10 adds a sibling file in the same directory rather than editing it.
- `login()` already throws `ACCOUNT_REMOVED`, which `handle` maps to HTTP 403. The e2e removal assertion relies on that.

## Global Constraints

- **Usage windows:** `days` is `7 | 30`. The window is the last `days` **UTC calendar days including today**. It starts at UTC midnight of `today − (days − 1)` and includes `now`. A message at exactly that midnight is inside; one millisecond earlier is outside. Local timezone never matters.
- **Weak chapter:** `scored / max < 0.5` (strict) with at least 1 graded attempt (`attempts >= 1` and `max > 0`). A chapter with no graded attempt is `ratio: null` and never weak.
- **Home routing (`homeFor(actor, studentStatus?)`):**

  | Actor | Home |
  |---|---|
  | `isPlatformAdmin` | `/platform` |
  | role `school_admin` or `branch_admin` | `/school` |
  | role `teacher` | `/teacher` |
  | role `student`, status `active` | `/learn` |
  | role `student`, any other or unknown status | `/status` |

  `/` redirects with the same table (`/login` with no actor). A wrong-role actor on a guarded page is redirected to their home. No actor goes to `/login`.
- **Decisions keys read by routing stats** (on assistant `messages.decisions`): `tier`, `fixedReply` (`'off_topic' | 'unsafe'`), `filterFallback` (boolean), `deciderError` (boolean), `deciderProvider` (`'jev' | 'llm' | 'none'`), `deciderFellBack` (boolean). Any key may be missing, and `decisions` may be null.
- **Flag semantics:** a message is *open* when `flagged = true and reviewed_at is null`, and *reviewed* when `flagged = true and reviewed_at is not null`. `markReviewed` sets `reviewed_at = now()` and `reviewed_by = actor.userId`.
- **Money:** amounts are integer minor units plus an ISO currency. The payment form shows major units, with the amount prefilled from the plan price but editable. Parsing allows at most 2 decimals.
- **Platform-only functions** (`costSummary`, `routingStats`, `listFlagged`, `getFlaggedConversation`, `markReviewed`, `listSchools`, `platformOverview`) call `requirePlatform` first and throw `FORBIDDEN` for everyone else.
- **Added to the spec's interface** (the UI needs them): `listBranches`, `listTeacherAssignments`, `platformOverview`, and the optional `now?: Date` arguments.

## Review Focus

1. **Empty school (zero students, zero branches):** analytics return `[]` or zeros, never `NaN` or a thrown error, and every page renders an empty state instead of crashing. Pinned in Tasks 3, 5, 6, 8, and 9.
2. **Assistant messages with null or partial `decisions`** (fixed replies, pre-sub-project-3 rows, a missing key): `routingStats` ignores rows that have no decisions, treats missing keys as false, and returns `advancedShare: 0` rather than `NaN` when there are no turns. Pinned in Task 5.
3. **Payment amount differing from the plan price:** the form prefills the plan price but the typed amount wins. The payment row stores what was typed, the subscription activates, and the typed amount is parsed to exact minor units (`"499.90"` becomes 49990). Pinned in Tasks 2 and 7.
4. **`branch_admin` forcing a school-admin-only filter through the query string** (`?branchId=<other branch>` or `?schoolId=<other school>`): the route and the loader reject with `FORBIDDEN`. They never silently widen the scope or ignore the value. Pinned in Tasks 7 and 8.
5. **UTC midnight boundary:** a message at `00:00:00.000Z` on the first window day is counted, one 1 ms earlier is not, and a `now` that is already the next UTC day but still "yesterday" in IST shifts the window. Pinned in Tasks 3 and 5.

---

## File Structure

```
src/lib/home.ts                         homeFor (pure)
src/lib/guard.ts                        requirePageActor, checkPageAccess, re-export homeFor
src/app/page.tsx                        MODIFY: redirect by homeFor
src/app/(public)/login/page.tsx         MODIFY: navigate to response.home
src/app/api/auth/login/route.ts         MODIFY: response includes home
src/app/ui/ui.module.css                shared table/card/badge/form/stat styles
src/app/ui/components.tsx               Card, Stat, Badge, EmptyState, DataTable, Field, PageShell
src/app/ui/format.ts                    formatMoney, toMinor, pct, formatDate
src/modules/analytics/window.ts         windowStart, windowStartDate
src/modules/analytics/enrollment.ts     enrollmentSummary, listBranches
src/modules/analytics/usage.ts          studentUsage
src/modules/analytics/progress.ts       sectionProgress, listTeacherAssignments
src/modules/analytics/cost.ts           costSummary
src/modules/analytics/routing.ts        routingStats
src/modules/analytics/flags.ts          listFlagged, getFlaggedConversation, markReviewed
src/modules/analytics/schools.ts        listSchools, platformOverview
src/modules/analytics/index.ts          public exports
src/app/api/platform/{schools,schools/[id]/branches,plans,flags,flags/[messageId]/review,costs,routing}/route.ts
src/app/api/school/enrollment/route.ts
src/app/api/teacher/{progress,usage}/route.ts
src/app/school/{page.tsx,loaders.ts,_components/*.tsx}     enrollment cards, students table, forms, codes
src/app/teacher/{page.tsx,loaders.ts,_components/*.tsx}    selector, progress grid, usage table
src/app/platform/{page.tsx,payments,schools,plans,flags,flags/[messageId],costs,routing}/page.tsx
src/app/platform/{loaders.ts,_components/*.tsx}
tests/helpers/analytics-seed.ts         seedAnalyticsWorld + insert helpers
tests/lib/{home,guard}.test.ts
tests/ui/{format,components}.test.ts
tests/analytics/*.test.ts, tests/http/dashboards.test.ts, tests/pages/*.test.ts
tests/isolation/analytics.test.ts
e2e/helpers/seed.ts, e2e/dashboards.spec.ts
```

---

### Task 1: Page guard, `homeFor`, and login/root redirects

**Files:**
- Create: `src/lib/home.ts`, `src/lib/guard.ts`
- Modify: `src/app/page.tsx`, `src/app/(public)/login/page.tsx`, `src/app/api/auth/login/route.ts`
- Test: `tests/lib/home.test.ts`, `tests/lib/guard.test.ts`

**Interfaces:**
- Consumes: `Actor`, `Role`, `StudentStatus`, `resolveActor`, `studentStatus` (enrollment)
- Produces:
  - `homeFor(actor: Actor, studentStatus?: StudentStatus): string`
  - `type PageRole = Role | 'platform'`
  - `checkPageAccess(actor: Actor | null, status: StudentStatus | undefined, roles: PageRole[], opts?: { allowInactiveStudent?: boolean }): { ok: true } | { redirect: string }`. A pure function.
  - `requirePageActor(roles: PageRole[], opts?: { allowInactiveStudent?: boolean }): Promise<Actor>`. It reads the `sid` cookie via `cookies()`, calls `resolveActor`, loads `studentStatus` only for students, and calls `redirect()` from `next/navigation`.
  - The login route's JSON becomes `{ roles, home }`.

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/lib/home.test.ts — table over the Global Constraints routing table
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
it.each(cases)('homeFor %j %s -> %s', (a, s, want) => expect(homeFor({ ...base, ...a } as Actor, s)).toBe(want));

// tests/lib/guard.test.ts — checkPageAccess + requirePageActor (mock next/navigation: redirect throws Error('REDIRECT:'+url), next/headers cookies)
it('no actor -> /login', () => expect(checkPageAccess(null, undefined, ['teacher'])).toEqual({ redirect: '/login' }));
it('wrong role -> own home', () => expect(checkPageAccess(teacherActor, undefined, ['platform'])).toEqual({ redirect: '/teacher' }));
it('matching role -> ok', () => expect(checkPageAccess(platformActor, undefined, ['platform'])).toEqual({ ok: true }));
it('platform admin is not matched by role list without "platform"', () =>
  expect(checkPageAccess(platformActor, undefined, ['school_admin'])).toEqual({ redirect: '/platform' }));
it('inactive student on a student page -> /status unless allowInactiveStudent', () => {
  expect(checkPageAccess(studentActor, 'pending_payment', ['student'])).toEqual({ redirect: '/status' });
  expect(checkPageAccess(studentActor, 'pending_payment', ['student'], { allowInactiveStudent: true })).toEqual({ ok: true });
});
it('requirePageActor redirects via next/navigation when cookie is absent', async () =>
  await expect(requirePageActor(['teacher'])).rejects.toThrow('REDIRECT:/login'));
it('requirePageActor returns the actor for a valid cookie and role', async () => { /* real login(), cookie mock → actor.userId */ });
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/lib`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement.** `homeFor` is a pure function that checks `isPlatformAdmin` first, then the first matching role. `checkPageAccess` is pure. `requirePageActor` is a thin wrapper that adds the cookie read and `redirect()`. In the login route, compute `home = homeFor(actor, student ? (await studentStatus(actor)).status : undefined)`. The login page navigates to `res.home`. `src/app/page.tsx` is a server component that resolves the actor and redirects with the same table, and this supersedes any inline routing added earlier. Add a route test line to `tests/http/routes.test.ts`: a pending student's login response has `home: '/status'` and a school admin's has `home: '/school'`. Modify the existing login route and `(public)/login` page in place; keep their current tests passing.
- [ ] **Step 4: Run** the same command plus `pnpm vitest run tests/http`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(web): page guard and role-based home routing"`

---

### Task 2: Shared UI styles, components, and formatters

**Files:**
- Create: `src/app/ui/ui.module.css`, `src/app/ui/components.tsx`, `src/app/ui/format.ts`
- Test: `tests/ui/format.test.ts`, `tests/ui/components.test.tsx`

**Interfaces:**
- Produces:
  - `format.ts`:
    - `formatMoney(minor: number, currency: string): string`
    - `toMinor(input: string): number`. It accepts `"499"`, `"499.9"`, `"499.90"`. It throws `DomainError('VALIDATION')` for empty input, negative values, more than 2 decimals, and non-numeric input, and it never uses floating-point multiplication.
    - `pct(ratio: number | null): string` (`"—"` for null, otherwise `"73%"`)
    - `formatDate(d: Date | null): string` (`"—"` for null, otherwise `YYYY-MM-DD` in UTC)
  - `components.tsx` (server-safe, no hooks):
    - `PageShell({ title, nav?, children })`
    - `Card({ title?, children })`
    - `Stat({ label, value })`
    - `Badge({ tone: 'ok' | 'warn' | 'bad' | 'muted', children })`
    - `EmptyState({ children })`
    - `DataTable<T>({ columns: { header: string; cell: (row: T) => ReactNode }[]; rows: T[]; empty: string })`. The table scrolls horizontally inside its card (`overflow-x: auto`). With no rows it renders `EmptyState` with `empty`.
    - `Field({ label, children })`

- [ ] **Step 1: Write the failing tests.**

```ts
it('toMinor parses exactly', () => {
  expect(toMinor('499')).toBe(49900); expect(toMinor('499.9')).toBe(49990); expect(toMinor('499.90')).toBe(49990);
  expect(toMinor('0.07')).toBe(7); expect(toMinor('1.15')).toBe(115);           // float pitfalls
  for (const bad of ['', '-1', '1.005', 'abc', '1e3']) expect(() => toMinor(bad)).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
});
it('formats money, pct and dates', () => {
  expect(formatMoney(49900, 'INR')).toContain('499'); expect(pct(null)).toBe('—'); expect(pct(0.734)).toBe('73%');
  expect(formatDate(new Date('2027-03-01T23:59:59Z'))).toBe('2027-03-01');
});
it('DataTable renders the empty state with no rows and the rows otherwise', () => {
  const cols = [{ header: 'Name', cell: (r: { n: string }) => r.n }];
  expect(renderToStaticMarkup(<DataTable columns={cols} rows={[]} empty="No students yet" />)).toContain('No students yet');
  expect(renderToStaticMarkup(<DataTable columns={cols} rows={[{ n: 'Riya' }]} empty="x" />)).toContain('Riya');
});
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/ui`. Expected: FAIL.
- [ ] **Step 3: Implement.** `toMinor` splits on `.` with a regex `^\d+(\.\d{1,2})?$`. The CSS is mobile-first: a single-column card grid that becomes two columns at 720px, with `table { min-width: 100% }` inside an `overflow-x: auto` wrapper, and badge tone colours.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(ui): shared dashboard styles, components, and money/date formatters"`

---

### Task 3: Analytics test seed, windows, `enrollmentSummary`, `listBranches`, `studentUsage`

**Files:**
- Create: `src/modules/analytics/{window,enrollment,usage,index}.ts`, `tests/helpers/analytics-seed.ts`
- Test: `tests/analytics/window.test.ts`, `tests/analytics/enrollment.test.ts`, `tests/analytics/usage.test.ts`

**Interfaces:**
- Consumes: `runAs`, `canManageSchool`, `canManageBranch`, `requirePlatform`, `seedTwoSchools`, `DomainError`
- Produces:
  - `windowStart(now: Date, days: 7 | 30): Date`: UTC midnight of `now − (days − 1)` days. `windowStartDate(...)` returns the `YYYY-MM-DD` string for `usage_daily.date`.
  - `enrollmentSummary(actor, args: { schoolId?: string }): Promise<{ branchId: string; branchName: string; grade: number; pending: number; active: number; lapsed: number; removed: number }[]>`:
    - `school_admin` sees all branches; a `schoolId` that differs from their own throws `FORBIDDEN`.
    - `branch_admin` sees only their branch; they may not pass `schoolId`.
    - A platform admin must pass `schoolId`, otherwise `VALIDATION`.
    - Teachers and students get `FORBIDDEN`.
    - Rows are ordered by `branchName, grade`. Only branch × grade combinations that have at least one student appear. `pending` counts `pending_payment`.
  - `listBranches(actor): Promise<{ branchId: string; name: string; signupCode: string; signupCodeEnabled: boolean; sections: { id: string; grade: number; name: string }[] }[]>`: `school_admin` gets all branches, `branch_admin` their own, anyone else `FORBIDDEN`. A school with no branches returns `[]`.
  - `studentUsage(actor, args: { sectionId?: string; subjectId?: string; now?: Date }): Promise<{ studentId: string; name: string; sectionName: string | null; messages7d: number; messages30d: number; lastActiveAt: Date | null }[]>`:
    - It counts `role = 'user'` messages only.
    - `subjectId` filters on `conversations.subject_id`.
    - Students with no messages are included with 0 and `null`; `removed` students are excluded.
    - A teacher is limited to students in sections from `teacher_assignments`. A `sectionId` they are not assigned to throws `FORBIDDEN`.
    - Admins are scoped like `enrollmentSummary`; a `sectionId` outside their scope throws `FORBIDDEN`.
  - `tests/helpers/analytics-seed.ts`:
    - `seedAnalyticsWorld(): Promise<World>`, where `World = Seed & { aBranch2Id; aSection9Id; aSection2Id; ... }`, built on `seedTwoSchools`. It seeds school A: branch A1 grade 8 (seed student pending, plus 2 active, 1 lapsed, 1 removed) and grade 9 (1 active, no section); branch A2 grade 8 (1 pending) and grade 9 (2 active); teacher assigned to section 8-A and the subject. School B: seed student pending plus 3 active grade 8. Active students in 8-A get usernames `s_active1`, `s_active2`.
    - `insertMessage(o: { schoolId; studentId; role: 'user' | 'assistant'; createdAt: Date; subjectId?: string; skillKey?: string; content?: string; decisions?: object | null; model?: string | null; tokensIn?: number; tokensOut?: number; cost?: number | null; flagged?: boolean; flagReason?: string | null; conversationId?: string }): Promise<string>`
    - `insertUsageDaily({ schoolId, studentId, date: string, tokens: number, cost: number })`
    - All helpers insert through `withPlatform`.

- [ ] **Step 1: Write the failing tests.**

```ts
// window.test.ts
it('7-day window starts at UTC midnight 6 days back, including today', () => {
  expect(windowStart(new Date('2027-03-10T15:00:00Z'), 7).toISOString()).toBe('2027-03-04T00:00:00.000Z');
  expect(windowStart(new Date('2027-03-10T00:00:00.000Z'), 30).toISOString()).toBe('2027-02-09T00:00:00.000Z');
});
it('IST evening that is already next UTC day uses the UTC date', () =>   // Review Focus 5
  expect(windowStart(new Date('2027-03-09T18:30:00Z'), 7).toISOString()).toBe('2027-03-03T00:00:00.000Z'));

// enrollment.test.ts (World seed; row(rows, branchId, grade) helper)
it('school_admin A gets exact counts per branch and grade', async () => {
  const rows = await enrollmentSummary(w.a.schoolAdmin, {});
  expect(row(rows, w.a.branchId, 8)).toMatchObject({ pending: 1, active: 2, lapsed: 1, removed: 1 });
  expect(row(rows, w.a.branchId, 9)).toMatchObject({ pending: 0, active: 1, lapsed: 0, removed: 0 });
  expect(row(rows, w.aBranch2Id, 8)).toMatchObject({ pending: 1, active: 0 });
  expect(row(rows, w.aBranch2Id, 9)).toMatchObject({ active: 2 });
  expect(rows.every(r => r.branchId !== w.b.branchId)).toBe(true);
});
it('branch_admin sees only own branch; passing schoolId is FORBIDDEN', async () => {
  expect((await enrollmentSummary(w.a.branchAdmin, {})).every(r => r.branchId === w.a.branchId)).toBe(true);
  await expect(enrollmentSummary(w.a.branchAdmin, { schoolId: w.a.schoolId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('platform needs schoolId; teacher/student FORBIDDEN; school_admin A cannot pass B', async () => {
  await expect(enrollmentSummary(w.platform, {})).rejects.toMatchObject({ code: 'VALIDATION' });
  expect((await enrollmentSummary(w.platform, { schoolId: w.b.schoolId })).reduce((n, r) => n + r.active, 0)).toBe(3);
  await expect(enrollmentSummary(w.a.teacher, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(enrollmentSummary(w.a.schoolAdmin, { schoolId: w.b.schoolId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('a school with no students or branches returns [] (Review Focus 1)', async () => {
  const empty = await createEmptySchool();            // createSchool + createStaffUser(school_admin) only
  expect(await enrollmentSummary(empty.admin, {})).toEqual([]);
  expect(await listBranches(empty.admin)).toEqual([]);
});
it('listBranches: school_admin all, branch_admin own, teacher FORBIDDEN', ...);

// usage.test.ts (now = 2027-03-10T12:00:00Z; student s_active1)
it('8-day-old message counts in 30d but not 7d', async () => {
  await insertMessage({ ...m, role: 'user', createdAt: new Date('2027-03-02T09:00:00Z') });
  const [r] = (await studentUsage(w.a.teacher, { now })).filter(u => u.studentId === s1);
  expect(r).toMatchObject({ messages7d: 0, messages30d: 1 });
});
it('boundary: exactly window-start midnight is in, 1 ms earlier is out (Review Focus 5)', async () => {
  await insertMessage({ ...m, role: 'user', createdAt: new Date('2027-03-04T00:00:00.000Z') });
  await insertMessage({ ...m, role: 'user', createdAt: new Date('2027-03-03T23:59:59.999Z') });
  expect(r7d).toBe(1);
});
it('ignores assistant messages; students without messages listed with 0/null; removed excluded; lastActiveAt = latest user message', ...);
it('teacher cannot see unassigned section; subjectId filters conversations', async () => {
  await expect(studentUsage(w.a.teacher, { sectionId: w.aSection9Id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('branch_admin A1 cannot query a section of branch A2', ...);   // FORBIDDEN
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/analytics`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `enrollmentSummary`: one `select … count(*) filter (where status = …) group by branch, grade` inside `runAs`.
  - `studentUsage`: `student_profiles left join messages` with `filter (where created_at >= windowStart(now, 7))`. Teacher scope comes from `teacher_assignments`.
  - `index.ts` exports the public functions and types.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(analytics): usage windows, enrollment summary, branch list, and student usage"`

---

### Task 4: `sectionProgress` and teacher assignments

**Files:**
- Create: `src/modules/analytics/progress.ts`; modify `src/modules/analytics/index.ts`, `tests/helpers/analytics-seed.ts`
- Test: `tests/analytics/progress.test.ts`

**Interfaces:**
- Consumes: `chapterProgress(actor, { studentIds, subjectId })` (studytools), `listVisibleChapters(scope, subjectId)` (content), `canManageBranch`, `runAs`
- Produces:
  - `sectionProgress(actor, args: { sectionId: string; subjectId: string }): Promise<{ students: { studentId: string; name: string; chapters: { chapterId: string; ratio: number | null; attempts: number }[] }[]; chapters: { chapterId: string; title: string; avgRatio: number | null; weak: boolean }[] }>`
    - Authorization: a teacher must have a `teacher_assignments` row for this section **and** subject, otherwise `FORBIDDEN`. Otherwise the actor must pass `canManageBranch` for the section's branch. A missing section throws `NOT_FOUND`.
    - The roster is every non-removed student whose `section_id = sectionId`. `chapters` come from `listVisibleChapters` for the section scope `{ schoolId, branchId, sectionId, grade }`, so chapters that have no attempts still appear.
    - Student `ratio = scored / max`, or `null` when `attempts = 0` or `max = 0`.
    - `avgRatio` is pooled: `Σscored / Σmax` over the roster. `null` when `Σmax = 0`. `weak = avgRatio !== null && avgRatio < 0.5`.
  - `listTeacherAssignments(actor): Promise<{ sectionId: string; sectionName: string; grade: number; subjectId: string; subjectName: string }[]>`: teacher only, otherwise `FORBIDDEN`. Ordered by grade, section name, subject name.
  - Seed helpers added: `insertChapter({ schoolId, branchId, sectionId?, subjectId, grade, title }): Promise<{ chapterId: string; contentItemId: string }>` (a `ready` school-scope item plus a `content_chapters` row) and `insertGradedAttempt({ schoolId, studentId, subjectId, byChapter: Record<string, { scored: number; max: number }> })`. Both insert directly through `withPlatform`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('weak flag flips at 0.49 vs 0.50 (strict < 0.5)', async () => {
  // chapter c1: s_active1 49/100 ; chapter c2: s_active1 50/100
  const r = await sectionProgress(w.a.teacher, { sectionId: w.a.sectionId, subjectId: w.a.subjectId });
  expect(r.chapters.find(c => c.chapterId === c1)).toMatchObject({ avgRatio: 0.49, weak: true });
  expect(r.chapters.find(c => c.chapterId === c2)).toMatchObject({ avgRatio: 0.5, weak: false });
});
it('pools across students and shows null ratio for students with no attempts', async () => {
  // s1 3/10, s2 9/10 on c3 -> avgRatio 0.6 ; s3 has none -> chapters[c3].ratio null, attempts 0
});
it('a chapter with no attempts has avgRatio null and is never weak', ...);
it('teacher unassigned to section or to the subject is FORBIDDEN', async () => {
  await expect(sectionProgress(w.a.teacher, { sectionId: w.aSection9Id, subjectId: w.a.subjectId })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(sectionProgress(w.a.teacher, { sectionId: w.a.sectionId, subjectId: otherSubject })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('branch_admin A1 allowed on own section, FORBIDDEN on A2 section; school_admin allowed on both', ...);
it('empty section (no students, no chapters) returns empty arrays, not an error (Review Focus 1)', async () => {
  expect(await sectionProgress(w.a.schoolAdmin, { sectionId: emptySectionId, subjectId: w.a.subjectId })).toEqual({ students: [], chapters: [] });
});
it('listTeacherAssignments returns the teacher\'s rows only; admins FORBIDDEN', ...);
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/analytics/progress.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Authorize first, then load the roster in `runAs`, then call `chapterProgress(actor, { studentIds, subjectId })`. Never query `attempts` directly; `chapterProgress` is the only reader. If the roster is empty, skip that call.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(analytics): section progress with weak-chapter flag and teacher assignments"`

---

### Task 5: `costSummary` and `routingStats`

**Files:**
- Create: `src/modules/analytics/{cost,routing}.ts`; modify `src/modules/analytics/index.ts`
- Test: `tests/analytics/cost.test.ts`, `tests/analytics/routing.test.ts`, `tests/analytics/decisions-contract.test.ts`

**Interfaces:**
- Consumes: `requirePlatform`, `withPlatform`, `windowStart`, `windowStartDate`
- Produces:
  - `costSummary(actor, args: { days: 7 | 30; now?: Date }): Promise<{ bySchool: { schoolId: string; name: string; cost: number; tokens: number; students: number }[]; bySkill: { skillKey: string; cost: number; tokens: number; turns: number }[] }>`
    - `bySchool` reads `usage_daily` where `date >= windowStartDate`. It is a left join from `schools`, so schools with no usage appear with zeros. `students` is the distinct student count. Rows are ordered by cost descending, then name. A null `cost` counts as 0. Numeric columns are converted with `Number()`.
    - `bySkill` reads assistant `messages` in the window with `model is not null`, joined `conversations → skills`. `tokens = Σ(tokens_in + tokens_out)` and `turns = count(*)`. Study-tool generation cost appears only in `bySchool`, because it is not a message.
  - `routingStats(actor, args: { days: 7 | 30; now?: Date }): Promise<{ turns; advancedShare; offTopicBlocks; unsafeBlocks; filterFallbacks; deciderErrors; deciderFallbacks }>`
    - Only assistant messages in the window with `decisions is not null` count as turns.
    - `advancedShare = (decisions->>'tier') = 'advanced'` count divided by `turns`, or `0` when `turns = 0`.
    - `offTopicBlocks` and `unsafeBlocks` count `decisions->>'fixedReply'` equal to `'off_topic'` and `'unsafe'`.
    - `filterFallbacks`, `deciderErrors`, and `deciderFallbacks` count the keys `filterFallback`, `deciderError`, and `deciderFellBack` when they are `true`. A missing key counts as false.
    - `deciderFallbacks` is computed from `deciderFellBack` alone; it needs no env lookup.
  - A runtime `days` outside `7 | 30` throws `VALIDATION`.

- [ ] **Step 1: Write the failing tests.**

```ts
// cost.test.ts (now = 2027-03-10T12:00:00Z)
it('sums per school and per skill inside the window only', async () => {
  // usage_daily A: s1 2027-03-10 tokens 1000 cost 0.5; s2 2027-03-04 tokens 500 cost 0.25; s1 2027-03-03 (outside 7d) 9999/9
  // assistant msgs: socratic x2 (cost .1/.2, in/out 100/50 each), explain x1 (cost null, in/out 10/5), one fixed reply model null (excluded)
  const r7 = await costSummary(w.platform, { days: 7, now });
  expect(r7.bySchool.find(s => s.schoolId === w.a.schoolId)).toMatchObject({ cost: 0.75, tokens: 1500, students: 2 });
  expect(r7.bySkill.find(s => s.skillKey === 'socratic')).toMatchObject({ turns: 2, tokens: 300 });
  expect(r7.bySkill.find(s => s.skillKey === 'explain')).toMatchObject({ turns: 1, cost: 0, tokens: 15 });
  const r30 = await costSummary(w.platform, { days: 30, now });
  expect(r30.bySchool.find(s => s.schoolId === w.a.schoolId)?.cost).toBeCloseTo(9.75);
});
it('school with no usage still listed with zeros; usage_daily boundary day is inclusive (Review Focus 1, 5)', ...);
it('non-platform actors FORBIDDEN; days 14 -> VALIDATION', ...);

// routing.test.ts — seed 10 assistant messages in the window:
//  3 advanced + 4 standard (all with deciderProvider 'jev'), 1 fixedReply off_topic (tier null), 1 fixedReply unsafe,
//  1 more standard; of these: filterFallback true x2, deciderError true x1, deciderFellBack true x1 (provider 'llm')
it('computes every field exactly', async () => {
  expect(await routingStats(w.platform, { days: 7, now })).toEqual({
    turns: 10, advancedShare: 0.3, offTopicBlocks: 1, unsafeBlocks: 1, filterFallbacks: 2, deciderErrors: 1, deciderFallbacks: 1 });
});
it('null decisions, empty {} and partial decisions are tolerated (Review Focus 2)', async () => {
  // add: assistant msg decisions null (pre-sub-project-3), assistant msg decisions {}, assistant msg {tier:'advanced'}, user msg with decisions {tier:'advanced'}
  // -> null row not a turn; {} is a turn with all flags false; {tier:'advanced'} counts toward advancedShare; user msg ignored
  expect(stats.turns).toBe(12);
});
it('no turns yields zeros and advancedShare 0, never NaN (Review Focus 1, 2)', async () =>
  expect(await routingStats(w.platform, { days: 7, now: farFuture })).toEqual({ turns: 0, advancedShare: 0, offTopicBlocks: 0, unsafeBlocks: 0, filterFallbacks: 0, deciderErrors: 0, deciderFallbacks: 0 }));
it('window boundary at UTC midnight (Review Focus 5)', ...);       // 2027-03-04T00:00:00.000Z in, 2027-03-03T23:59:59.999Z out
it('non-platform FORBIDDEN', ...);

// decisions-contract.test.ts — guards the sub-project 3 contract this plan reads
it('runTurn writes every decisions key routingStats reads', async () => {
  // use the sub-project 3 harness: FakeDecider scripted to (a) an ordinary turn and (b) an off_topic turn,
  // MockLanguageModelV2 through ModelRegistry.override(); then read the assistant messages' decisions
  expect(Object.keys(normalTurn.decisions)).toEqual(expect.arrayContaining(['tier', 'filterFallback', 'deciderError', 'deciderProvider', 'deciderFellBack']));
  expect(offTopicTurn.decisions.fixedReply).toBe('off_topic');
});
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/analytics/cost.test.ts tests/analytics/routing.test.ts tests/analytics/decisions-contract.test.ts`. Expected: FAIL (the contract test also fails if a key is not yet written).
- [ ] **Step 3: Implement** both functions with one `count(*) filter (where …)` query each. If the contract test shows a missing key, add the write in the tutor module's turn code (`src/modules/tutor/…`, where `decisions` is assembled), with that key's default (`false` / `null`), and keep the change limited to the missing keys.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(analytics): cost summary and routing health stats"`

---

### Task 6: Flagged queue, `listSchools`, and `platformOverview`

**Files:**
- Create: `src/modules/analytics/{flags,schools}.ts`; modify `src/modules/analytics/index.ts`
- Test: `tests/analytics/flags.test.ts`, `tests/analytics/schools.test.ts`

**Interfaces:**
- Consumes: `requirePlatform`, `withPlatform`, `MessageRow` (type from `src/modules/tutor/index.ts`), `listPendingSubscriptions`
- Produces:
  - `listFlagged(actor, args: { status: 'open' | 'reviewed' }): Promise<{ messageId: string; conversationId: string; schoolName: string; studentName: string; reason: string | null; excerpt: string; createdAt: Date }[]>`: `excerpt` is the first 160 characters of the flagged message (`…` appended when truncated). Rows are ordered by `created_at` descending and limited to 200. A runtime status other than `open | reviewed` throws `VALIDATION`.
  - `getFlaggedConversation(actor, messageId): Promise<{ messages: MessageRow[]; flaggedMessageId: string }>`: the messages are ordered by `created_at, id`. `NOT_FOUND` if the message is unknown or not flagged.
  - `markReviewed(actor, messageId): Promise<void>`: idempotent. A repeat call keeps the original `reviewed_at` and `reviewed_by`. `NOT_FOUND` if the message is unknown or not flagged.
  - `listSchools(actor): Promise<{ id: string; name: string; board: string; branches: { id: string; name: string; signupCode: string; signupCodeEnabled: boolean }[] }[]>`: a school with no branches has `branches: []`. Schools are ordered by name and branches by name.
  - `platformOverview(actor, args?: { now?: Date }): Promise<{ pendingPayments: number; openFlags: number; cost30d: number }>`: the pending count equals `listPendingSubscriptions(actor).length`, and `cost30d` is the sum of `costSummary(30).bySchool[].cost`.

- [ ] **Step 1: Write the failing tests.**

```ts
it('open vs reviewed lists and markReviewed moves a row between them', async () => {
  const id = await insertMessage({ ...a, role: 'user', content: 'x'.repeat(300), flagged: true, flagReason: 'decider_review' });
  const open = await listFlagged(w.platform, { status: 'open' });
  expect(open).toHaveLength(1);
  expect(open[0]).toMatchObject({ messageId: id, reason: 'decider_review', schoolName: expect.any(String) });
  expect(open[0].excerpt).toHaveLength(161);                                  // 160 + '…'
  await markReviewed(w.platform, id);
  expect(await listFlagged(w.platform, { status: 'open' })).toHaveLength(0);
  expect(await listFlagged(w.platform, { status: 'reviewed' })).toHaveLength(1);
});
it('markReviewed is idempotent and records reviewer', async () => {
  await markReviewed(w.platform, id); const first = await reviewedAt(id);
  await markReviewed(w.platform, id); expect(await reviewedAt(id)).toEqual(first);
  expect(await reviewedBy(id)).toBe(w.platform.userId);
});
it('unflagged or unknown message -> NOT_FOUND for getFlaggedConversation and markReviewed', ...);
it('getFlaggedConversation returns the whole conversation in order with flaggedMessageId', ...);
it.each(['school_admin','branch_admin','teacher','student'])('%s is FORBIDDEN on every platform function', async role => {
  for (const fn of [() => listFlagged(actor, { status: 'open' }), () => getFlaggedConversation(actor, id),
                    () => markReviewed(actor, id), () => listSchools(actor), () => platformOverview(actor)])
    await expect(fn()).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
it('listSchools nests branches with codes; a school with no branches has []', ...);
it('platformOverview on a platform with no schools/flags/pending returns zeros (Review Focus 1)', ...);
it('platformOverview counts pending, open flags and 30d cost', ...);
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/analytics/flags.test.ts tests/analytics/schools.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with joins `messages → conversations → users (student) → schools`, all under `withPlatform`. `markReviewed` is `update … set reviewed_at = coalesce(reviewed_at, now()), reviewed_by = coalesce(reviewed_by, $actor) where id = $id and flagged`, and it throws `NOT_FOUND` when no row matches.
- [ ] **Step 4: Run** `pnpm vitest run tests/analytics`. Expected: PASS (all analytics tests).
- [ ] **Step 5: Commit:** `git commit -m "feat(analytics): flagged conversation queue, schools listing, and platform overview"`

---

### Task 7: New API routes

**Files:**
- Create: `src/app/api/platform/{schools/route.ts,schools/[id]/branches/route.ts,plans/route.ts,flags/route.ts,flags/[messageId]/review/route.ts,costs/route.ts,routing/route.ts}`, `src/app/api/school/enrollment/route.ts`, `src/app/api/teacher/{progress,usage}/route.ts`
- Test: `tests/http/dashboards.test.ts`

**Interfaces:**
- Consumes: `handle`, `requireActor` (`src/lib/http.ts`), the analytics and tenancy/enrollment services
- Produces:
  - `GET /api/platform/schools` → `listSchools`
  - `POST /api/platform/schools {name, board}` → 201 `{ id }` (`createSchool`)
  - `POST /api/platform/schools/:id/branches {name}` → 201 `{ id, signupCode }` (`createBranch`)
  - `GET /api/platform/plans` → `listActivePlans`
  - `POST /api/platform/plans {name, interval, priceMinor, currency?}` → 201 `{ id }` (`createPlan`)
  - `GET /api/platform/flags?status=open|reviewed` (default `open`)
  - `POST /api/platform/flags/:messageId/review` → 204
  - `GET /api/platform/costs?days=7|30` and `GET /api/platform/routing?days=7|30` (default 7; any other value gives 400 `VALIDATION`)
  - `GET /api/school/enrollment` accepts optional `schoolId` (platform and school_admin) and `branchId`. A `branch_admin` or `school_admin` passing a `schoolId` or `branchId` outside their own scope gets 403. The response is `{ summary }`.
  - `GET /api/teacher/progress?sectionId&subjectId` → `sectionProgress`
  - `GET /api/teacher/usage?sectionId&subjectId` → `studentUsage`
  - All ids are zod-validated as UUIDs (400 `VALIDATION` otherwise). Each body is parsed with a zod schema.
  - `POST /api/platform/payments` already exists (plan 1) and is unchanged. Its zod schema must require `amountMinor` as a positive integer and must not compare it with the plan price.

- [ ] **Step 1: Write the failing tests** (handlers called with `new Request(...)` and a `sid` cookie from `login`):

```ts
it('platform GETs return data for platform admin and 403 for school_admin', async () => {
  for (const [h, url] of platformGets) {
    expect((await h(req(url, platformCookie))).status).toBe(200);
    expect((await h(req(url, schoolAdminCookie))).status).toBe(403);
    expect((await h(req(url))).status).toBe(401);
  }
});
it('costs/routing reject days=14 and non-numeric with 400 VALIDATION', ...);
it('create school, branch, plan round trip; branch response has an 8-char signupCode', ...);
it('review route moves a flag from open to reviewed and returns 204', ...);
it('branch_admin passing another branchId or schoolId to /api/school/enrollment gets 403, not their own data (Review Focus 4)', async () => {
  expect((await enrollment(req(`/api/school/enrollment?branchId=${w.a.branch2Id}`, branchAdminA1))).status).toBe(403);
  expect((await enrollment(req(`/api/school/enrollment?schoolId=${w.b.schoolId}`, branchAdminA1))).status).toBe(403);
  expect((await enrollment(req(`/api/school/enrollment?schoolId=${w.b.schoolId}`, schoolAdminA))).status).toBe(403);
  expect((await enrollment(req('/api/school/enrollment', branchAdminA1))).status).toBe(200);
});
it('teacher progress/usage: assigned section 200, unassigned 403, missing ids 400', ...);
it('payment with an amount different from the plan price is accepted and stored as typed (Review Focus 3)', async () => {
  const res = await postPayment(req('/api/platform/payments', platformCookie, { subscriptionId, amountMinor: 40000, currency: 'INR', paidAt }));
  expect(res.status).toBe(200);
  expect(await paymentAmount(subscriptionId)).toBe(40000);               // plan price is 49900
  expect(await subscriptionStatus(subscriptionId)).toBe('active');
});
it('payment with amountMinor 0, negative, or fractional -> 400 VALIDATION', ...);
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/http/dashboards.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** each route as a `handle(...)` wrapper that calls the service. `/api/school/enrollment` passes the query values through to `enrollmentSummary`, so the service decides, and it never strips values for a branch admin.
- [ ] **Step 4: Run** `pnpm vitest run tests/http`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(api): platform, school enrollment, and teacher progress endpoints"`

---

### Task 8: `/school` and `/teacher` pages

**Files:**
- Create: `src/app/school/{page.tsx,loaders.ts}`, `src/app/school/_components/{EnrollmentCards,EnrollmentTable,StudentsTable,AddStudentForm,BranchCodes,RemoveButton}.tsx`, `src/app/teacher/{page.tsx,loaders.ts}`, `src/app/teacher/_components/{SectionSelector,ProgressGrid,UsageTable}.tsx`
- Test: `tests/pages/school.test.tsx`, `tests/pages/teacher.test.tsx`

**Interfaces:**
- Consumes: `requirePageActor`, the analytics and enrollment services, the Task 2 UI components, `/api/school/*` routes
- Produces:
  - `loadSchoolDashboard(actor, q: { branchId?: string; grade?: string; status?: string }): Promise<{ summary; students; branches; totals: { pending; active; lapsed; removed }; canFilterBranch: boolean }>`
    - `canFilterBranch` is true only for `school_admin`.
    - For a `branch_admin`, a `q.branchId` that is not their branch throws `FORBIDDEN`.
    - `grade` is parsed to an integer 5–12, and `status` is parsed against `StudentStatus`. Anything else throws `VALIDATION`.
  - `loadTeacherDashboard(actor, q: { sectionId?: string; subjectId?: string }): Promise<{ assignments; selected: { sectionId; subjectId } | null; progress: Awaited<ReturnType<typeof sectionProgress>> | null; usage }>`: the default selection is the first assignment, and `selected` is null when the teacher has no assignments. A selection that is not one of the teacher's assignments throws `FORBIDDEN`.
  - **Pages:**
    - `/school` is guarded with `['school_admin', 'branch_admin']`. It shows:
      - enrollment cards (totals by status) and a branch × grade table
      - a students table with filters (branch select only if `canFilterBranch`), a Remove action in a confirm dialog (`window.confirm`) that calls `POST /api/school/students/:id/remove`, and columns name, username, grade/section, status badge, plan, period end
      - an Add-student form (branch select for school_admin, grade, optional section, student and parent fields) that calls `POST /api/school/students` and shows the returned `inviteUrl` with a Copy button (`navigator.clipboard`)
      - branch signup codes with Rotate and Enable/Disable buttons calling `POST /api/school/branches/:id/code`
      - a link to `/school/content`
    - `/teacher` is guarded with `['teacher']`. It shows a section × subject selector (GET params), a progress grid (students × chapters, cells use `pct`, weak chapter headers highlighted with the `warn` tone), a usage table, and a link to `/teacher/materials`.

- [ ] **Step 1: Write the failing tests.**

```ts
// school.test.tsx
it('loader scopes by role and totals match the seed (Task 3 counts)', async () => {
  const sa = await loadSchoolDashboard(w.a.schoolAdmin, {});
  expect(sa.totals).toEqual({ pending: 2, active: 5, lapsed: 1, removed: 1 }); expect(sa.canFilterBranch).toBe(true);
  const ba = await loadSchoolDashboard(w.a.branchAdmin, {});
  expect(ba.canFilterBranch).toBe(false); expect(ba.students.every(s => s.branchId === w.a.branchId)).toBe(true);
});
it('branch_admin forcing another branch through the query string is FORBIDDEN (Review Focus 4)', async () =>
  await expect(loadSchoolDashboard(w.a.branchAdmin, { branchId: w.aBranch2Id })).rejects.toMatchObject({ code: 'FORBIDDEN' }));
it('bad grade/status params -> VALIDATION', ...);
it('school_admin status filter returns only that status', ...);
it('empty school: loader returns empty collections and the components render empty states (Review Focus 1)', async () => {
  const d = await loadSchoolDashboard(empty.admin, {});
  expect(d.totals).toEqual({ pending: 0, active: 0, lapsed: 0, removed: 0 });
  const html = renderToStaticMarkup(<><EnrollmentTable rows={d.summary} /><StudentsTable rows={d.students} canRemove /><BranchCodes branches={d.branches} /></>);
  expect(html).toContain('No students yet'); expect(html).toContain('No branches yet');
});
it('StudentsTable shows status badge, plan and period end; Remove only when canRemove', ...);
it('AddStudentForm result view shows the invite link', ...);       // render the presentational InviteResult({url})
// teacher.test.tsx
it('loader defaults to first assignment; unassigned selection FORBIDDEN', ...);
it('teacher with no assignments gets selected null; page renders "No classes assigned yet" (Review Focus 1)', ...);
it('ProgressGrid highlights weak headers and renders pct / "—"', () => {
  const html = renderToStaticMarkup(<ProgressGrid data={fixture} />);
  expect(html).toContain('73%'); expect(html).toContain('—'); expect(html).toMatch(/data-weak="true"/);
});
it('ProgressGrid with no students renders the empty state', ...);
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/pages/school.test.tsx tests/pages/teacher.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Loaders: they only compose service calls (`enrollmentSummary`, `listStudents`, `listBranches`, `studentUsage`, `sectionProgress`, `listTeacherAssignments`) and pass filters through unchanged. Scope enforcement stays in the services.
  - Pages: `await requirePageActor([...])`, `await loadX(actor, searchParams)`, render components.
  - Client components (`RemoveButton`, `AddStudentForm`, `BranchCodes` actions) use `fetch` and then `router.refresh()`.
  - Show `error.message` from the API error body, never a raw error.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(web): school and teacher dashboards"`

---

### Task 9: `/platform` pages

**Files:**
- Create: `src/app/platform/{page.tsx,loaders.ts}`, `src/app/platform/{payments,schools,plans,flags,costs,routing}/page.tsx`, `src/app/platform/flags/[messageId]/page.tsx`, `src/app/platform/_components/{RecordPaymentForm,CreateSchoolForm,CreateBranchForm,CreatePlanForm,ReviewButton,DaysToggle,PlatformNav,ConversationView}.tsx`
- Test: `tests/pages/platform.test.tsx`

**Interfaces:**
- Consumes: `requirePageActor(['platform'])`, `platformOverview`, `listPendingSubscriptions`, `listSchools`, `listActivePlans`, `listFlagged`, `getFlaggedConversation`, `costSummary`, `routingStats`, `formatMoney`, `toMinor`
- Produces:
  - Loaders in `loaders.ts`, each taking `(actor, q)`: `loadOverview`, `loadPayments`, `loadSchools`, `loadPlans`, `loadFlags(actor, { status })`, `loadFlagged(actor, messageId)`, `loadCosts(actor, { days })`, `loadRouting(actor, { days })`.
    - `days` is parsed from the query string: missing means 7; anything other than `7 | 30` throws `VALIDATION`.
    - `status` is parsed the same way.
  - `paymentFormDefaults(row: PendingRow): { amount: string; currency: string; paidAt: string }`: `amount` is the plan price in major units (`"499.00"`), and `paidAt` is today's UTC date.
  - `buildPaymentBody(form: { subscriptionId: string; amount: string; currency: string; reference: string; paidAt: string }): { subscriptionId; amountMinor: number; currency; externalRef?: string; paidAt: string }`: it uses `toMinor`, so the typed amount wins over the plan price.
  - **Pages:**
    - `/platform` (overview): three stat cards for pending payments, open flags, and 30-day cost, plus nav links.
    - `/platform/payments`: the pending and lapsed table, with an inline `RecordPaymentForm` per row (amount prefilled, reference, paid-at date) posting to `/api/platform/payments`.
    - `/platform/schools`: a list with branches and codes, a create-school form, and a create-branch form.
    - `/platform/plans`: a list and a create form (price entered in major units).
    - `/platform/flags`: open and reviewed tabs (`?status=`). Each row links to `/platform/flags/[messageId]`. That page shows `ConversationView` with the flagged message highlighted and a Mark reviewed button.
    - `/platform/costs` and `/platform/routing`: a 7/30 `DaysToggle` (`?days=`), cost tables, and routing stat cards (advanced share as a percentage).

- [ ] **Step 1: Write the failing tests.**

```ts
it('paymentFormDefaults prefills the plan price in major units', () =>
  expect(paymentFormDefaults(row({ priceMinor: 49900, currency: 'INR' }))).toMatchObject({ amount: '499.00', currency: 'INR' }));
it('buildPaymentBody lets the typed amount override the plan price exactly (Review Focus 3)', () => {
  expect(buildPaymentBody({ ...form, amount: '400' }).amountMinor).toBe(40000);
  expect(buildPaymentBody({ ...form, amount: '499.90' }).amountMinor).toBe(49990);
  expect(() => buildPaymentBody({ ...form, amount: '4.999' })).toThrow(expect.objectContaining({ code: 'VALIDATION' }));
});
it('loaders: platform ok; non-platform FORBIDDEN; days=14 and status=bogus VALIDATION', ...);
it('loadCosts/loadRouting default to 7 days and pass 30 through', ...);
it('fresh platform with nothing in it renders every page component with its empty state (Review Focus 1)', () => {
  const html = renderToStaticMarkup(<>
    <PaymentsTable rows={[]} /><SchoolsList schools={[]} /><PlansList plans={[]} /><FlagsTable rows={[]} />
    <CostTables data={{ bySchool: [], bySkill: [] }} /><RoutingCards stats={zeroStats} /></>);
  expect(html).toContain('No pending payments'); expect(html).toContain('No schools yet'); expect(html).toContain('No flagged conversations');
  expect(html).not.toContain('NaN');
});
it('RoutingCards shows advancedShare as a percentage and all seven stats', ...);
it('ConversationView highlights only the flagged message and shows roles', ...);
it('SchoolsList shows branches with signup codes and "No branches yet" for a school without them', ...);
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/pages/platform.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** Each page: `requirePageActor(['platform'])`, then the loader, then render. Put the table components (`PaymentsTable`, `SchoolsList`, `PlansList`, `FlagsTable`, `CostTables`, `RoutingCards`) in `_components/`. The client forms build their request body with `buildPaymentBody` and so on. After a successful mutation, call `router.refresh()`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(web): platform dashboards for payments, schools, plans, flags, cost, and routing"`

---

### Task 10: Isolation suite extension

**Files:**
- Create: `tests/isolation/analytics.test.ts`
- Test: `tests/isolation/analytics.test.ts`

**Interfaces:**
- Consumes: `seedAnalyticsWorld` (School A and School B both have students, messages, usage, and a flagged message), every public analytics function
- Produces: no new code. If a test fails it is a real leak; fix it in the owning analytics function before continuing.

- [ ] **Step 1: Write the isolation tests.** Act as School A's actors, target School B ids.

```ts
it('enrollmentSummary: school_admin A with schoolId B is FORBIDDEN; with no filter returns only A branches', ...);
it('studentUsage and sectionProgress: A teacher/school_admin/branch_admin with a B sectionId are FORBIDDEN', ...);
it('studentUsage without filters never returns a B student id', ...);
it('listBranches(a.schoolAdmin) never includes B branches or codes', ...);
it.each(['schoolAdmin','branchAdmin','teacher','student'])('A %s is FORBIDDEN on every platform function with B ids', async k => {
  for (const call of platformCalls(w.a[k], w.b.flaggedMessageId))                // costSummary, routingStats, listFlagged, getFlaggedConversation, markReviewed, listSchools, platformOverview
    await expect(call()).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await bFlagReviewedAt()).toBeNull();                                   // B's flag still open
});
it('raw tenant read: withTenant(A) over messages, usage_daily, conversations returns only A rows', async () => {
  for (const t of [messages, usageDaily, conversations])
    expect((await withTenant(w.a.schoolId, tx => tx.select().from(t))).every(r => r.schoolId === w.a.schoolId)).toBe(true);
});
```

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && pnpm vitest run tests/isolation`. Expected: PASS (an earlier task has a defect if not).
- [ ] **Step 3: Run the whole suite** with `pnpm vitest run && pnpm tsc --noEmit`. Expected: PASS.
- [ ] **Step 4: Commit:** `git commit -m "test: extend isolation suite to analytics and platform views"`

---

### Task 11: Playwright e2e flows

**Files:**
- Create: `e2e/helpers/seed.ts`, `e2e/dashboards.spec.ts`
- Test: `e2e/dashboards.spec.ts`

**Interfaces:**
- Consumes: the dashboards from Tasks 8 and 9, `/learn` (sub-project 3), the `/login` page, and the `/api/auth/login` route
- Produces: `seedDashboardWorld(): Promise<{ platform: Creds; schoolAdmin: Creds; pendingStudent: Creds; removableStudent: Creds; school; branch }>` using `resetDb` and module functions (`createSchool`, `createBranch`, `createStaffUser`, `signupWithCode`, and so on). Creds are `{ username, password }`. Seeded users log in with `SEED_PASSWORD`; the helper gives the removable student a username and password via `SEED_PASSWORD` too. Tests use a 390×844 mobile viewport.

- [ ] **Step 1: Write the failing e2e tests.**

```ts
test.use({ viewport: { width: 390, height: 844 } });
test('platform admin records a payment and the student reaches /learn', async ({ page, browser }) => {
  await login(page, world.platform); await expect(page).toHaveURL('/platform');
  await page.goto('/platform/payments');
  const row = page.getByRole('row', { name: new RegExp(world.pendingStudent.username) });
  await expect(row.getByLabel('Amount')).toHaveValue('499.00');                  // prefilled from plan price
  await row.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(world.pendingStudent.username)).toHaveCount(0);   // leaves the pending queue
  const student = await (await browser.newContext()).newPage();
  await login(student, world.pendingStudent); await expect(student).toHaveURL(/\/learn/);
});
test('school admin manually adds a student and sees the invite link', async ({ page }) => {
  await login(page, world.schoolAdmin); await expect(page).toHaveURL('/school');
  await page.getByLabel('Student name').fill('Kabir'); /* grade, parent name, parent phone */
  await page.getByRole('button', { name: 'Add student' }).click();
  await expect(page.getByText(/\/invite\/[\w-]+/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
});
test('school admin removes a student and that login is then rejected', async ({ page, request }) => {
  await login(page, world.schoolAdmin);
  page.once('dialog', d => d.accept());
  await page.getByRole('row', { name: new RegExp(world.removableStudent.username) }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText(world.removableStudent.username)).toHaveCount(0);   // removed rows hidden in default view, or badge "removed"
  expect((await request.post('/api/auth/login', { data: world.removableStudent })).status()).toBe(403);
});
test('root and guards route by role', async ({ page }) => {
  await login(page, world.schoolAdmin); await page.goto('/'); await expect(page).toHaveURL('/school');
  await page.goto('/platform'); await expect(page).toHaveURL('/school');
  await page.context().clearCookies(); await page.goto('/teacher'); await expect(page).toHaveURL(/\/login/);
});
```

  - In the removal test, confirm the "default students view hides removed" behaviour against `listStudents`. If removed rows are shown by default, assert the `removed` badge instead; this is decided by Task 8's students table.

- [ ] **Step 2: Run** `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH && docker compose up -d && pnpm playwright test e2e/dashboards.spec.ts`. Expected: FAIL until the seed helper and any missing labels are in place (tests are written against the Task 8 and 9 UI labels: `Amount`, `Record payment`, `Student name`, `Add student`, `Copy`, `Remove`).
- [ ] **Step 3: Implement** `e2e/helpers/seed.ts`. Adjust only UI labels (`aria-label` and button text) in the Task 8 and 9 components to match the tests; do not weaken assertions.
- [ ] **Step 4: Run** `pnpm playwright test && pnpm vitest run && pnpm tsc --noEmit`. Expected: all PASS.
- [ ] **Step 5: Commit:** `git commit -m "test(e2e): payment activation, manual add, removal, and role routing flows"`
