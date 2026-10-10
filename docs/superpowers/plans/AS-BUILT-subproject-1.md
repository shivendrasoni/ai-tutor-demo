# As-built: sub-project 1 (tenancy, identity, enrollment)

This is merged on `main` with 182 tests passing. Later plans must use these **real** names. They take precedence over plan 1's text wherever the two differ.

## Public module APIs
- `src/modules/tenancy/index.ts`:
  - types `Actor { userId; isPlatformAdmin; schoolId: string|null; branchId: string|null; roles: Role[] }`, `Role`, `StudentStatus`
  - `loadActor(tx, userId)`, `resolveActor(token)`
  - `assert`, `canManageBranch(actor, schoolId, branchId)`, `canManageSchool(actor, schoolId)`, `requirePlatform`, `runAs(actor, fn)`
  - `login`
  - `hashPassword`, `verifyPassword`, `assertPasswordStrength`
  - `normalizeUsername`, `assertValidUsername`, `suggestUsernames`
  - `createSession`, `revokeSession`, `revokeUserSessions`, `purgeExpiredSessions(cutoff)`, `SESSION_TTL_MS`
  - `assertUsernameFree`, `isUsernameTaken`, `validateCredentials`, `withUsernameTakenHandling`
  - `BRANCH_CODE_ALPHABET`, `generateBranchCode`, `normalizeBranchCode`
  - `assertGrade`, `assignTeacher`, `createBranch`, `createSchool`, `createSection`, `createStaffUser`, `createSubject`, `findBranchByCode`, `listSectionsForBranch`, `rotateBranchCode`, `setBranchCodeEnabled`
  - types `BranchByCode`, `StaffRole`
- `src/modules/enrollment/index.ts`:
  - `addInterval`, `PlanInterval`
  - `createPlan`, `listActivePlans`, `Plan`
  - `checkUsername`, `signupWithCode`, `validateCredentials`, `SignupInput`
  - `completeInvite`, `getInvite`, `INVITE_TTL_MS`, `manualAddStudent`
  - `listPendingSubscriptions`, `recordPayment`, `PendingRow`
  - `lapseExpired`
  - `listStudents`, `removeStudent`, `studentStatus(actor, now?)` (delegates the read-time lapse to `effectiveStudentStatus`), `StudentRow`
  - `effectiveStudentStatus(studentUserId, now?)`: stored status except an `active` student whose period ended is `lapsed` (read-time lapse, see below)
  - `reissueInvite(actor, studentUserId) -> { inviteUrl }`, `resetStudentPassword(actor, studentUserId, newPassword)`
  - `recordPayment(actor, input, now = new Date())`, `lapseExpired(now, onlyStudentId?)`

## Rate limiting (`src/lib/rate-limit.ts`)
- Postgres fixed-window counters in the **global** table `rate_limits(key, window_start, count, pk(key, window_start))` (no `school_id`, so not a tenant table and not in `tenantTables`; written through `withPlatform`; migration `0012`).
- API: `hit(key, limit, windowMs, now?) -> { allowed, retryAfterMs }` (atomic upsert), `peek(key, limit, windowMs, now?)` (read-only: allowed while count < limit), `refund(key, windowMs, now?)`, `enforce(key, limit, windowMs, now?)` (throws `RATE_LIMITED`), `purgeRateLimits(cutoff)`, `clientIp(req)` (the Nth `x-forwarded-for` entry from the right, N = `TRUSTED_PROXY_HOPS`, else `'unknown'`), `limits.*` (env-aware).
- Applied: `POST /api/auth/login` throttles 10 failed attempts per normalized username and **100 failed attempts per client IP** per 15 min. The IP key is checked with `peek` before verifying, incremented only when the credentials are invalid, and never refunded, so successful logins neither consume nor reset it (a school behind one NAT is not locked out by normal use). The username key is hit up front and refunded once the password check is passed. A blocked request never runs argon2. `GET /api/join/username` and `GET /api/join/code/[code]` share 60 per IP per 15 min. `POST /api/join` and `POST /api/invite/[token]` share 20 per IP per hour.
- Defaults are overridable by env: `RATE_LIMIT_LOGIN_USER`, `RATE_LIMIT_LOGIN_IP`, `RATE_LIMIT_JOIN_LOOKUP`, `RATE_LIMIT_JOIN_SUBMIT`. `playwright.config.ts` sets them to 10000 in the dev-server env because the e2e specs sign in and join many times from one IP.
- `TRUSTED_PROXY_HOPS` (default `1`) is the number of trusted reverse proxies in front of the app. Each appends the address it saw to `x-forwarded-for`, so the client IP is the Nth entry from the right; left-hand entries are client-controlled and ignored. `0` ignores the header entirely (every request keys as `'unknown'`, use only when the app is directly exposed and you accept one shared bucket). A header with fewer entries than N yields its left-most entry; invalid values fall back to 1. Set it to the real proxy depth in production (e.g. `2` for CDN + load balancer).
- New `ErrorCode` `RATE_LIMITED` -> HTTP 429. `handle()` adds a `retry-after` header (seconds) from `details.retryAfterMs`.

## DB
- `src/db/client.ts`: `Db`, `Tx`, `appDb`, `adminDb`, `withTenant(schoolId, fn)`, `withPlatform(fn)`, `closeDb()`
- `src/db/schema/index.ts` re-exports `./tenancy`, `./auth`, and `./enrollment`, and exports `tenantTables`. **New schema files must be re-exported here**, and every new table with a `school_id` must be added to `tenantTables`.
- Migrations live in `src/db/migrations/` (`0000`–`0003`; `0001_rls.sql` holds the policy pattern). Run them with `pnpm db:migrate`, which is `tsx src/db/migrate.ts`. Default privileges for `app_user` and `app_admin` are set in `0003_default_privileges.sql`, so new tables get grants automatically. Sub-project 1's fix wave added `0012` (rate_limits) and `0013` (payments unique index).
- **Gate:** `tests/db/rls-catalog.test.ts` fails CI if any public table with a `school_id` column lacks enabled and forced RLS with a policy, or is missing from `tenantTables`.

## Errors and HTTP
- `src/lib/errors.ts`: `ErrorCode` union and `DomainError(code, message?, details?)`. **A new code must also be added** to the `STATUS: Record<ErrorCode, number>` map in `src/lib/http.ts`; the type requires it.
- `src/lib/http.ts`:
  - `SESSION_COOKIE = 'sid'`, `HttpError(status, code, message?)`, `json()`
  - `handle(fn)`, `readJson(req, zodSchema)` (100 KB body cap: `MAX_BODY_BYTES`)
  - `parseWith(schema, value)`, `readCookie`, `sessionToken(req)`, `requireActor(req)`
  - `sessionCookie(token)`, `clearSessionCookie()`, `redactError`
  - Multipart uploads need their own size handling. `readJson`'s 100 KB cap applies to JSON only.

## App and tests
- Pages live under `src/app/(public)/{join,invite,login,status}`, with `_lib/`, `layout.tsx`, and `public.module.css`. API routes are under `src/app/api/{auth,invite,join,me,plans,platform,school}`.
- `tests/helpers/db.ts`:
  - `resetDb()` truncates every public table
  - `appDbRaw(sql)`, `currentCode(branchId)`
  - `SEED_PASSWORD = 'correct-horse'` (seeded users **do** have this password)
  - `seedTwoSchools(): Seed`, with `Seed = { platform: Actor; planId; a: SchoolSeed; b: SchoolSeed }`
  - `SchoolSeed = { schoolId, branchId, code, sectionId, subjectId, teacherId, studentId, subscriptionId, schoolAdmin, branchAdmin, teacher, student: Actor }`
- Test directories: `tests/{db,enrollment,helpers,http,isolation,scripts,setup,tenancy}`. The isolation suite is `tests/isolation/services.test.ts`.
- Scripts: `pnpm test`, `typecheck`, `db:generate`, `db:migrate`, `test:isolation`, `admin`, `job:lapse`, `e2e`.

## Payments, effective status, invites and password reset
- **Payment idempotency:** partial unique index `payments_subscription_external_ref_unique` on `payments(subscription_id, external_ref) where external_ref is not null`. A repeated reference is `VALIDATION` with message "This payment reference was already recorded" and `details.reason = 'duplicate_payment'`. Payments without a reference never collide.
- **paidAt bounds** are enforced in `recordPayment` (so the CLI cannot bypass them): not later than `now + 5 min`, not earlier than `now - 1 year`, else `VALIDATION`. `now` is injectable (third parameter).
- **Read-time lapse:** `studentStatus` (login home, `/api/me/status`, page guard) and content `studentScope` (gates tutor and study) go through the same rule: an `active` student whose subscription `current_period_end < now` is `lapsed`, and the subscription and profile rows are flipped via `lapseExpired(now, studentId)` in that call. The daily `job:lapse` is now only a backstop.
- **`reissueInvite(actor, studentUserId)`:** `canManageBranch`; only `pending_payment` students without a username/password; expires the old unused invites and creates a new 14-day one. `POST /api/school/students/[id]/invite` returns `{ inviteUrl }` (201). `/school` students table shows "New invite link" for such students.
- **`resetStudentPassword(actor, studentUserId, newPassword)`:** admin-initiated reset (`canManageBranch`; platform admin any student); `assertPasswordStrength`; revokes the student's sessions; refuses removed students (`STUDENT_REMOVED`) and students who have not signed up (`VALIDATION`). `POST /api/school/students/[id]/password` with `{ password }` returns `{ ok: true }`. `/school` students table shows "Reset password".
- **New routes:** `POST /api/school/students/[id]/invite`, `POST /api/school/students/[id]/password`.
- **CLI:** `pnpm admin reset-password --username <student> [--password <p> | ADMIN_PASSWORD env] [--as <platform admin>]`.
- **Memberships:** a non-platform user belongs to one school (not enforced by the schema); `loadActor` picks the oldest membership by `(created_at, id)` if there are several.
- **Housekeeping:** `pnpm job:lapse` (`runLapse(now)` in `scripts/lapse.ts`) also deletes rate-limit windows older than 1 day and sessions that expired more than 7 days ago, and prints `{ lapsed, purgedRateLimits, purgedSessions }`.
