# As-built: sub-project 5 (dashboards and analytics)

Later plans must use these real names. They take precedence over plan 5's text wherever the two differ.

## Public exports of `src/modules/analytics/index.ts`
- Windows: `windowStart(now, days)`, `windowStartDate`. `days` is 7 or 30: the last N UTC calendar days including today, starting at UTC midnight.
- Enrollment: `enrollmentSummary`, `listBranches`; types `EnrollmentRow`, `BranchListing`.
- Usage: `studentUsage(actor, { sectionId?, subjectId?, now? })`; type `StudentUsageRow`. Counts the student's own messages (7d, 30d, last active). A teacher-only actor passing a section and subject needs a `teacher_assignments` row for that exact pair, otherwise `FORBIDDEN`. Admins are not limited by assignments.
- Progress: `sectionProgress`, `listTeacherAssignments`; types `SectionProgress`, `TeacherAssignment`. A chapter is weak when `scored / max < 0.5` with at least one graded attempt; no graded attempt means `ratio: null`, never weak.
- Platform-only (`requirePlatform` first, `FORBIDDEN` for everyone else): `costSummary`, `routingStats`, `listFlagged`, `getFlaggedConversation`, `markReviewed`, `listSchools`, `platformOverview`; types `CostSummary`, `RoutingStats`, `FlaggedRow`, `SchoolListing`.
- `getFlaggedConversation` returns `{ messages, flaggedMessageId, reviewedAt, reviewedBy }` (`reviewedAt`/`reviewedBy` are null until reviewed). `markReviewed` is idempotent and keeps the first `reviewed_at` / `reviewed_by`.

## Pages by role (`src/app/(staff)/**`, `src/app/(student)/**`)
- `/` redirects through `homeFor`. `/login` when there is no actor.
- Platform admin: `/platform` (overview), `/platform/payments`, `/platform/schools`, `/platform/plans`, `/platform/flags`, `/platform/flags/:messageId` (shows "Reviewed on <date>" and no button once reviewed), `/platform/costs`, `/platform/routing`, plus `/school/content` (linked as "Content" in the platform nav).
- School admin and branch admin: `/school`, `/school/content`.
- Teacher: `/teacher`, `/teacher/materials`.
- Student: `/learn/**` (sub-projects 3 and 4); non-active students go to `/status`.
- The staff layout renders a shared header (Home link from `homeFor`, plus School and Teacher links for a user holding both an admin and a teacher role, and a Log out button that POSTs `/api/auth/logout` then goes to `/login`). It renders nothing extra when there is no session; each page still guards itself. The student nav also has Log out.

## Guard and routing
- `homeFor(actor, studentStatus?)` in `src/lib/home.ts`. `requirePageActor(roles, opts?)` in `src/lib/guard.ts` redirects no actor to `/login` and a wrong-role actor to their home. `checkPageAccess` is the pure decision.
- `staffLinks(actor)` in `src/app/(staff)/_lib/links.ts` builds the header links.

## New API routes and envelopes (all need an authenticated actor; errors use the standard `{ error: { code, message } }` envelope)
- `GET /api/platform/costs?days=7|30` -> `CostSummary`. `GET /api/platform/routing?days=7|30` -> `RoutingStats`. Invalid `days` is 400 `VALIDATION`.
- `GET /api/platform/flags?status=open|reviewed` -> `{ flags: [{ ...FlaggedRow, createdAt: ISO }] }`.
- `POST /api/platform/flags/:messageId/review` -> 204; unknown or unflagged id is 404.
- `GET /api/platform/pending` -> `{ pending: [...] }`.
- `GET|POST /api/platform/plans` -> `{ plans }` / 201 plan. `GET|POST /api/platform/schools` -> `{ schools }` / 201 school. `POST /api/platform/schools/:id/branches` -> 201 branch.
- `POST /api/platform/payments` -> `{ periodStart, periodEnd }` (ISO). The typed amount is stored as given. A `paidAt` whose UTC date is later than today is 400 `VALIDATION` (the payment form rejects it first, with no request).
- `GET /api/school/enrollment?schoolId=&branchId=` -> `{ summary }`. A `branch_admin` passing another branch or school gets 403, never a widened scope.
- `GET /api/school/students?schoolId=&branchId=&grade=&status=` -> `{ students }`. `POST /api/school/students` -> 201 `{ inviteUrl }`. `POST /api/school/students/:id/remove` -> `{ ok: true }`.
- `POST /api/school/branches/:id/code` body `{ action: 'rotate' | 'enable' | 'disable' }` -> `{ signupCode }` or `{}`.
- `GET /api/teacher/progress?sectionId=&subjectId=` -> `{ progress }`. `GET /api/teacher/usage?sectionId=&subjectId=` -> `{ usage }`. Both require both ids; an unassigned section or subject is 403.

## UI helpers
- `src/app/ui/components.tsx`: `DataTable` takes an optional `rowKey(row)` (index fallback); header and cells are keyed by column index. The payments table uses `subscriptionId`.
- `src/app/ui/LogoutButton.tsx` is shared by the staff header and student nav.
- Money: amounts are integer minor units plus an ISO currency; the form shows major units and parses at most 2 decimals (`"499.90"` is 49990).

## Known gaps
- Staff, section, subject, and teacher-assignment management is CLI/DB-only. There is no UI for it.
- The first platform admin is created with `pnpm admin create-platform-admin`.
- The future-`paidAt` rule lives in the route and the form, not in `recordPayment` (existing service tests use fixed future dates).
