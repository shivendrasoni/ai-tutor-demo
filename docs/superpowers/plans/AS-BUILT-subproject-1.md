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
  - `createSession`, `revokeSession`, `revokeUserSessions`, `SESSION_TTL_MS`
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
  - `listStudents`, `removeStudent`, `studentStatus`, `StudentRow`

## DB
- `src/db/client.ts`: `Db`, `Tx`, `appDb`, `adminDb`, `withTenant(schoolId, fn)`, `withPlatform(fn)`, `closeDb()`
- `src/db/schema/index.ts` re-exports `./tenancy`, `./auth`, and `./enrollment`, and exports `tenantTables`. **New schema files must be re-exported here**, and every new table with a `school_id` must be added to `tenantTables`.
- Migrations live in `src/db/migrations/` (`0000`–`0003`; `0001_rls.sql` holds the policy pattern). Run them with `pnpm db:migrate`, which is `tsx src/db/migrate.ts`. Default privileges for `app_user` and `app_admin` are set in `0003_default_privileges.sql`, so new tables get grants automatically.
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
