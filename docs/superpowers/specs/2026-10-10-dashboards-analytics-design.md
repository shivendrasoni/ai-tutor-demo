# Sub-spec 5: Dashboards & Analytics

- **Date:** 2026-10-10
- **Parent spec:** `2026-10-10-ai-tutor-architecture-design.md`. This spec covers §6.5, module ⑥, and §9 (observability views).
- **Depends on:** sub-projects 1–4. It reuses `listStudents`, `removeStudent`, `manualAddStudent`, the branch code functions, `listPendingSubscriptions`, `recordPayment`, `createPlan`, `createSchool`, `createBranch`, `listContent` (via the existing pages), and `chapterProgress`. It also reads `messages`, `usage_daily`, and `subscriptions`.

## 1. Goal
Give each role a minimal web dashboard, replacing the CLI as the main way to administer the platform:
- **School and branch admins:** enrollment and student management.
- **Teachers:** student progress.
- **Platform admin:** payments, schools, plans, flagged conversations, cost, and routing health.

## 2. Decisions
| Topic | Decision |
|---|---|
| Rendering | Next.js server components that call module services directly with the actor resolved from the `sid` cookie. Mutations go through the existing API routes, or new ones listed below |
| Guarding | `src/lib/guard.ts`: `requirePageActor(roles: Array<Role | 'platform'>)` redirects to `/login` when there is no actor, and to the role's home page when the role doesn't match |
| Home routing | After login, users go to the home page for their role: platform → `/platform`; school_admin or branch_admin → `/school`; teacher → `/teacher`; an active student → `/learn`; any other student → `/status`. `/` redirects the same way |
| Queries | Plain SQL aggregations in `src/modules/analytics`, with no materialised views (pilot scale). Every query is scoped by `runAs` |
| Time windows | Usage windows are the last 7 and the last 30 UTC days, including today |
| Weak chapter | Score ratio `scored / max` below **0.5**, with at least 1 graded attempt |
| Styling | One shared minimal CSS module set (`src/app/ui/`) with table, card, badge, and form styles. Mobile-first; tables scroll horizontally inside their card |

## 3. Service interface (`src/modules/analytics/index.ts`)
```ts
enrollmentSummary(actor, { schoolId? }) → Promise<{ branchId; branchName; grade; pending: number; active: number; lapsed: number; removed: number }[]>
  // school_admin: all branches; branch_admin: own; platform: requires schoolId
studentUsage(actor, { sectionId?; subjectId? }) → Promise<{ studentId; name; sectionName; messages7d; messages30d; lastActiveAt: Date | null }[]>
  // teacher: students in assigned sections; admins: their scope
sectionProgress(actor, { sectionId; subjectId }) → Promise<{ students: { studentId; name; chapters: { chapterId; ratio: number | null; attempts: number }[] }[];
                                                         chapters: { chapterId; title; avgRatio: number | null; weak: boolean }[] }>
  // teacher must be assigned to section+subject, or canManageBranch; built on chapterProgress
costSummary(actor, { days: 7 | 30 }) → Promise<{ bySchool: { schoolId; name; cost: number; tokens: number; students: number }[];
                                                 bySkill: { skillKey; cost: number; tokens: number; turns: number }[] }>   // platform only
routingStats(actor, { days: 7 | 30 }) → Promise<{ turns: number; advancedShare: number; offTopicBlocks: number;
                                                  unsafeBlocks: number; filterFallbacks: number; deciderErrors: number; deciderFallbacks: number }>  // platform only
listFlagged(actor, { status: 'open' | 'reviewed' }) → Promise<{ messageId; conversationId; schoolName; studentName; reason; excerpt; createdAt }[]>  // platform only
getFlaggedConversation(actor, messageId) → Promise<{ messages: MessageRow[]; flaggedMessageId }>  // platform only
markReviewed(actor, messageId) → Promise<void>   // platform only; sets reviewed_at, reviewed_by
listSchools(actor) → Promise<{ id; name; board; branches: { id; name; signupCode; signupCodeEnabled }[] }[]>  // platform only
```

The routing stats are derived from `messages.decisions` on assistant messages. These keys are written by the tutor (sub-project 3). If anything is missing, sub-project 5 adds the writes:
- `decisions.tier`
- `decisions.fixedReply` (`'off_topic' | 'unsafe'`)
- `decisions.filterFallback` (boolean)
- `decisions.deciderError` (boolean)
- `decisions.deciderProvider` (`'jev' | 'llm' | 'none'`)

`deciderFallbacks` counts turns where `deciderProvider = 'llm'` while `DECIDER = 'jev'` was configured, which is recorded as `decisions.deciderFellBack = true`.

## 4. Pages
**`/school`** (school_admin, branch_admin):
- **Enrollment cards:** totals by status. A table by branch × grade.
- **Students table:**
  - filters for branch (school_admin only), grade, and status
  - columns: name, username, grade/section, status badge, plan, period end
  - a "Remove" action with a confirm dialog
- **"Add student" form** (manual add): shows the resulting invite link with a copy button.
- **Branch signup codes:** each branch's code, with rotate and enable/disable actions.
- **Links** to `/school/content` (from sub-project 2).

**`/teacher`:**
- A selector for the assigned section × subject.
- A progress grid: students × chapters, cells showing the ratio as a percentage, and weak chapter headers highlighted.
- A usage table.
- A link to `/teacher/materials`.

**`/platform`:**
- **Overview:** pending payments count, open flags count, 30-day cost.
- **`/platform/payments`:** the pending and lapsed list, with a record-payment form per row (amount prefilled from the plan price, plus reference and paid-at date).
- **`/platform/schools`:** list, create school, create branch.
- **`/platform/plans`:** list and create.
- **`/platform/flags`:** open and reviewed tabs. Each row opens the conversation view, which has a "Mark reviewed" action.
- **`/platform/costs`:** cost by school and by skill, with a 7/30-day toggle.
- **`/platform/routing`:** routing stats, with a 7/30-day toggle.

**New API routes:**
- `GET /api/platform/schools`, `POST /api/platform/schools`, `POST /api/platform/schools/:id/branches`
- `GET /api/platform/plans`, `POST /api/platform/plans`
- `GET /api/platform/flags?status=`, `POST /api/platform/flags/:messageId/review`
- `GET /api/platform/costs?days=`, `GET /api/platform/routing?days=`
- `GET /api/school/enrollment`
- `GET /api/teacher/progress?sectionId&subjectId`, `GET /api/teacher/usage?sectionId&subjectId`

## 5. Testing
- **Analytics services**, with seeded data (students across statuses, messages with decisions, `usage_daily`, graded attempts):
  - exact counts for `enrollmentSummary`, by role
  - `studentUsage` windows (a message 8 days old counts in 30d but not 7d)
  - `sectionProgress` weak flag at 0.49 vs 0.5
  - `costSummary` sums
  - every `routingStats` field
  - `listFlagged` open/reviewed and `markReviewed`
- **Authorization:**
  - a teacher can't see unassigned sections
  - a branch admin can't see other branches
  - non-platform users get `FORBIDDEN` on every platform function
  - cross-school isolation is added to `tests/isolation`
- **Guard and home routing:** unit tests for `homeFor(actor, studentStatus)` and `requirePageActor`.
- **E2E (Playwright, mobile viewport):**
  - A platform admin logs in, records a payment for a pending student, and the student can then reach `/learn`.
  - A school admin manually adds a student and sees the invite link.
  - A school admin removes a student, and that student's login is then rejected.

## 6. Out of scope
Charts beyond tables and cards, CSV export, email notifications, parent dashboard.
