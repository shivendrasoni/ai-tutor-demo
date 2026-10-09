# Tenancy, Identity & Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build sub-project 1 of the AI tutor platform. It covers:
- multi-tenant schools, branches, and sections
- username/password identity and roles
- Postgres RLS isolation, with a cross-school isolation test suite
- signup with a branch code
- school manual-add invites
- manual payment recording, activation, and lapse
- student removal

**Architecture:** A greenfield Next.js (App Router) app in TypeScript.
- **Modules** live under `src/modules/{tenancy,enrollment}`. Each module exposes plain async service functions that take an `Actor`.
- **Isolation:** every tenant table carries `school_id` and is protected by RLS. The policy keys on the transaction-local setting `app.school_id`, which `withTenant()` sets.
- **Platform and system work** (signup code lookup, login, payments) uses a separate `app_admin` DB role with `BYPASSRLS`, through `withPlatform()`.
- **HTTP:** thin Next.js route handlers wrap the services. There are four minimal pages: join, invite, login, status.
- **Admin UI:** platform-admin operations are a CLI for now. Admin dashboards come in sub-project 5.

**Tech Stack:**
- Node 22, pnpm
- Next.js 15 (App Router), React 19, TypeScript (strict)
- Postgres 16 (`pgvector/pgvector:pg16` image), Drizzle ORM + drizzle-kit, `pg`
- zod, `@node-rs/argon2`
- Vitest, Playwright, tsx

**Spec:** `docs/superpowers/specs/2026-10-10-ai-tutor-architecture-design.md`. This plan implements §4.1, §4.3, §5, §6.1, and §8 (isolation suite), plus the tenancy and enrollment rows of §3.1.

## Global Constraints

- **Hierarchy:** Platform → School → Branch → Section. Grade is an integer **5–12** inclusive.
- **Roles:** `school_admin | branch_admin | teacher | student`.
  - `school_admin` memberships have `branch_id = null`. All other roles have `branch_id` set.
  - Platform admin is the `users.is_platform_admin` flag, not a membership.
  - In v1 a non-platform user belongs to exactly one school.
- **Student profile status:** `pending_payment | active | lapsed | removed`.
- **Subscription status:** `pending | active | lapsed | cancelled`.
- **Plan interval:** `monthly | annual`. Payment method: `manual_link | gateway`.
- **Money:** stored as integer minor units (`price_minor`, `amount_minor`) plus an ISO `currency` (default `INR`).
- **Usernames:** unique platform-wide; normalized by trim + lowercase; must match `^[a-z0-9_.]{4,32}$`.
- **Passwords:** 8–128 characters, hashed with argon2id.
- **Isolation:**
  - Every table with `school_id` has RLS enabled **and forced**.
  - The policy is `school_id = nullif(current_setting('app.school_id', true), '')::uuid`, so an unset context returns zero rows.
  - `schools` uses `id` in place of `school_id`.
- **Global tables** (no RLS): `users`, `sessions`, `plans`.
- **Removed students** cannot log in. Their sessions are revoked on removal and their data is kept.
- **Pending or lapsed students** can log in but see only the status screen.
- All timestamps are `timestamptz` in UTC.
- Parents are not users. Their contact details live on `student_profiles`.

## Review Focus

1. **Username case and whitespace:** `" Riya.S "` signs up as `riya.s`, and login with `RIYA.S` works. Pinned in Task 4.
2. **Rotated or disabled branch code:** the old code is rejected after rotation (`INVALID_CODE`), and a disabled code is rejected with `CODE_DISABLED`, never a 500. Pinned in Task 5.
3. **Same username submitted twice concurrently:** one request succeeds and the other gets `USERNAME_TAKEN` with suggestions, not a 500 from the unique constraint. Pinned in Task 5.
4. **Month-end and renewal periods:**
   - Jan 31 + monthly = Feb 28 (or Feb 29 in a leap year).
   - A second payment while active extends from the current period end.
   - A payment after lapse starts from the payment date.
   - Pinned in Tasks 5 and 7.
5. **Removed student with a live session:** the next request with the old cookie resolves to no actor (401), and recording a payment for them fails with `STUDENT_REMOVED`. Pinned in Tasks 8 and 10.

---

## File Structure

```
docker-compose.yml                 Postgres 16 + pgvector; runs docker/init.sql
docker/init.sql                    roles app_user, app_admin; databases tutor, tutor_test
.env.example / .env.test           DATABASE_URL_OWNER, DATABASE_URL_APP, DATABASE_URL_ADMIN, APP_URL
drizzle.config.ts
vitest.config.ts                   fileParallelism: false; globalSetup migrates tutor_test
playwright.config.ts
src/db/schema/tenancy.ts           schools, branches, sections, subjects, users, memberships, teacher_assignments
src/db/schema/auth.ts              sessions, invites
src/db/schema/enrollment.ts        student_profiles, plans, subscriptions, payments
src/db/schema/index.ts
src/db/migrations/                 drizzle-generated + custom RLS migration
src/db/client.ts                   pools, withTenant, withPlatform, closeDb
src/lib/errors.ts                  DomainError + codes
src/lib/http.ts                    route handler wrapper, cookie/actor helpers
src/modules/tenancy/actor.ts       Actor type, resolveActor
src/modules/tenancy/authz.ts       runAs, requirePlatform, canManageSchool, canManageBranch
src/modules/tenancy/codes.ts       generateBranchCode
src/modules/tenancy/service.ts     schools/branches/sections/subjects/staff/teacher assignment
src/modules/tenancy/auth/passwords.ts
src/modules/tenancy/auth/usernames.ts
src/modules/tenancy/auth/sessions.ts
src/modules/tenancy/auth/login.ts
src/modules/tenancy/index.ts       public exports
src/modules/enrollment/periods.ts  addInterval
src/modules/enrollment/plans.ts
src/modules/enrollment/signup.ts   signupWithCode, checkUsername
src/modules/enrollment/invites.ts  manualAddStudent, getInvite, completeInvite
src/modules/enrollment/payments.ts recordPayment, listPendingSubscriptions
src/modules/enrollment/lapse.ts    lapseExpired
src/modules/enrollment/students.ts listStudents, removeStudent, studentStatus
src/modules/enrollment/index.ts
src/app/api/**/route.ts            HTTP endpoints (Task 10)
src/app/(public)/{join,invite/[token],login,status}/page.tsx   (Task 11)
scripts/admin.ts                   platform CLI (Task 9)
scripts/lapse.ts                   daily lapse job (Task 9)
tests/helpers/db.ts                resetDb, seedTwoSchools
tests/**                           unit + integration tests; tests/isolation/*.test.ts; e2e/*.spec.ts
```

---

### Task 1: Project scaffold and database connectivity

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `docker-compose.yml`, `docker/init.sql`, `.env.example`, `.env.test`, `vitest.config.ts`, `tests/setup/global.ts`, `src/db/client.ts`, `.gitignore`
- Test: `tests/db/connect.test.ts`

**Interfaces:**
- Produces:
  - `src/db/client.ts`:
    - `type Db = NodePgDatabase<typeof schema>`
    - `type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]`
    - `withTenant<T>(schoolId: string, fn: (tx: Tx) => Promise<T>): Promise<T>`
    - `withPlatform<T>(fn: (tx: Tx) => Promise<T>): Promise<T>`
    - `closeDb(): Promise<void>`
  - `appDb` uses `DATABASE_URL_APP` (role `app_user`). `adminDb` uses `DATABASE_URL_ADMIN` (role `app_admin`, BYPASSRLS).
  - The schema import is an empty `src/db/schema/index.ts` until Task 2.

- [ ] **Step 1: Scaffold.** Use `pnpm create next-app` (TS, App Router, `src/`, no Tailwind requirement), then add `drizzle-orm pg zod @node-rs/argon2` and the dev deps `drizzle-kit vitest tsx @types/pg @playwright/test dotenv`.
- [ ] **Step 2: Set up Docker and roles.**
  - `docker-compose.yml`: service `db`, image `pgvector/pgvector:pg16`, port 5432, mounting `docker/init.sql` into `/docker-entrypoint-initdb.d/`.
  - `init.sql` creates:
    - databases `tutor` and `tutor_test`
    - role `app_user LOGIN PASSWORD 'app_user'` (no BYPASSRLS)
    - role `app_admin LOGIN PASSWORD 'app_admin' BYPASSRLS`
  - The owner is `postgres`.
- [ ] **Step 3: Write the failing test** in `tests/db/connect.test.ts`:

```ts
it('withTenant sets app.school_id transaction-locally', async () => {
  const id = '00000000-0000-0000-0000-000000000001';
  const inside = await withTenant(id, tx => tx.execute(sql`select current_setting('app.school_id', true) as v`));
  expect(inside.rows[0].v).toBe(id);
  await withTenant(id, async () => null);
  const after = await withPlatform(tx => tx.execute(sql`select current_setting('app.school_id', true) as v`));
  expect([null, '']).toContain(after.rows[0].v);
});
it('withPlatform connects as app_admin', async () => {
  const r = await withPlatform(tx => tx.execute(sql`select current_user as u`));
  expect(r.rows[0].u).toBe('app_admin');
});
```

- [ ] **Step 4: Run it** with `docker compose up -d && pnpm vitest run tests/db/connect.test.ts`. Expected: FAIL, because `src/db/client.ts` has no exports.
- [ ] **Step 5: Implement `src/db/client.ts`.**
  - `withTenant` opens an `appDb.transaction` and first runs `select set_config('app.school_id', $1, true)`.
  - `withPlatform` opens an `adminDb.transaction`.
  - `vitest.config.ts`: `fileParallelism: false`; loads `.env.test`, which points at `tutor_test`; `globalSetup: tests/setup/global.ts`. The global setup runs migrations, a no-op until Task 2, and calls `closeDb` on teardown.
- [ ] **Step 6: Run the test.** Expected: PASS.
- [ ] **Step 7: Commit:** `git commit -m "chore: scaffold Next.js app with Postgres roles and tenant transaction helpers"`

---

### Task 2: Schema, migrations, and RLS

**Files:**
- Create: `src/db/schema/{tenancy,auth,enrollment,index}.ts`, `drizzle.config.ts`, `src/db/migrations/*` (generated), `src/db/migrations/XXXX_rls.sql` (custom), `src/modules/tenancy/actor.ts` (types only), `tests/helpers/db.ts`
- Test: `tests/db/rls.test.ts`

**Interfaces:**
- Produces: these tables (all ids `uuid default gen_random_uuid()`, all `created_at timestamptz default now()`):

```
schools(id, name text, board text, status text default 'active')
branches(id, school_id fk, name, signup_code text unique, signup_code_enabled bool default true)
sections(id, school_id, branch_id fk, grade int check 5..12, name; unique(branch_id, grade, name))
subjects(id, school_id, name; unique(school_id, name))
users(id, username text unique null, password_hash text null, name, email null, phone null,
      is_platform_admin bool default false)                       -- no RLS
memberships(id, user_id fk, school_id, branch_id null, role text check in 4 roles;
      unique(user_id, school_id))
teacher_assignments(school_id, teacher_id fk users, section_id fk, subject_id fk; pk(teacher_id, section_id, subject_id))
student_profiles(user_id pk fk, school_id, branch_id fk, grade int check 5..12, section_id null fk,
      parent_name, parent_phone, parent_email null, status text check in 4 statuses default 'pending_payment')
plans(id, name, interval text check monthly|annual, price_minor int, currency text default 'INR', active bool default true)  -- no RLS
subscriptions(id, school_id, student_id fk unique, plan_id fk, status text check in 4 default 'pending',
      current_period_start null, current_period_end null)
payments(id, school_id, subscription_id fk, amount_minor int, currency, method text check manual_link|gateway,
      external_ref null, paid_at timestamptz, recorded_by fk users)
sessions(id, user_id fk, token_hash text unique, expires_at)        -- no RLS
invites(id, school_id, student_user_id fk, token_hash text unique, expires_at, used_at null)
```

  - `src/db/schema/index.ts` also exports `tenantTables`: the array of the 9 RLS tables listed in Step 2.
  - `src/modules/tenancy/actor.ts` (types only; Task 4 adds `resolveActor`):
    - `type Role = 'school_admin' | 'branch_admin' | 'teacher' | 'student'`
    - `type StudentStatus = 'pending_payment' | 'active' | 'lapsed' | 'removed'`
    - `type Actor = { userId: string; isPlatformAdmin: boolean; schoolId: string | null; branchId: string | null; roles: Role[] }`
  - `tests/helpers/db.ts`:
    - `resetDb(): Promise<void>` truncates all tables, as owner, with `restart identity cascade`.
    - `appDbRaw(q: SQL)` runs one statement on the app pool with no tenant setup.
    - `currentCode(branchId): Promise<string>` reads a branch's current signup code via `withPlatform`.
    - `seedTwoSchools(): Promise<Seed>`, inserting rows directly via `withPlatform`. Seeded users have a null `password_hash`; tests that log in create their own users.
    - `Seed = { platform: Actor; planId: string; a: SchoolSeed; b: SchoolSeed }`
    - `SchoolSeed = { schoolId, branchId, code, sectionId (grade 8, "8-A"), subjectId, teacherId, studentId, subscriptionId: string; schoolAdmin, branchAdmin, teacher, student: Actor }`
    - The plan is monthly, named `Monthly`, `price_minor` 49900. The student is `pending_payment` with a `pending` subscription.

- [ ] **Step 1: Write the schema files** exactly as above. Then run `pnpm drizzle-kit generate` followed by `pnpm drizzle-kit generate --custom --name rls`.
- [ ] **Step 2: Write the RLS migration.** For each of `branches, sections, subjects, memberships, teacher_assignments, student_profiles, subscriptions, payments, invites`:

```sql
alter table X enable row level security; alter table X force row level security;
create policy tenant_isolation on X using (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  with check (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
```

  - Apply the same to `schools`, keyed on `id`.
  - Grants:
    - `grant select, insert, update, delete on all tables in schema public to app_user, app_admin`
    - plus the sequence grants
    - `revoke update, delete on plans from app_user` (plans are platform-managed)
- [ ] **Step 3: Write the failing tests** in `tests/db/rls.test.ts`, using `seedTwoSchools`:

```ts
it('tenant context sees only its own school rows', async () => {
  const rows = await withTenant(seed.a.schoolId, tx => tx.select().from(studentProfiles));
  expect(rows.map(r => r.schoolId)).toEqual([seed.a.schoolId]);
});
it('no tenant context fails closed', async () => {
  const r = await appDbRaw(sql`select count(*)::int as n from student_profiles`); // app_user, no set_config
  expect(r.rows[0].n).toBe(0);
});
it('cannot insert a row for another school', async () => {
  await expect(withTenant(seed.a.schoolId, tx =>
    tx.insert(subjects).values({ schoolId: seed.b.schoolId, name: 'X' }))).rejects.toThrow(/row-level security/);
});
it('platform sees all schools', async () => {
  const rows = await withPlatform(tx => tx.select().from(schools));
  expect(rows).toHaveLength(2);
});
```

  `appDbRaw` is a test helper in `tests/helpers/db.ts` that runs one statement on the app pool with no transaction setup.
- [ ] **Step 4: Run** `pnpm vitest run tests/db/rls.test.ts`. Expected: FAIL until the migrations are applied by global setup. Update `tests/setup/global.ts` to run `migrate()` as owner against `tutor_test`.
- [ ] **Step 5: Re-run.** Expected: PASS (4 tests).
- [ ] **Step 6: Commit:** `git commit -m "feat(db): tenancy and enrollment schema with forced RLS policies"`

---

### Task 3: Errors and authorization helpers

**Files:**
- Create: `src/lib/errors.ts`, `src/modules/tenancy/authz.ts`
- Test: `tests/tenancy/authz.test.ts`

**Interfaces:**
- Produces:
  - `src/lib/errors.ts`:
    - `class DomainError extends Error { code: ErrorCode; details?: Record<string, unknown> }`
    - `ErrorCode` is one of: `'INVALID_CODE' | 'CODE_DISABLED' | 'USERNAME_TAKEN' | 'INVALID_USERNAME' | 'WEAK_PASSWORD' | 'INVALID_CREDENTIALS' | 'ACCOUNT_REMOVED' | 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'INVITE_INVALID' | 'STUDENT_REMOVED'`
  - `authz.ts`:
    - `runAs<T>(actor: Actor, fn: (tx: Tx) => Promise<T>): Promise<T>`: platform admin uses `withPlatform`. Otherwise it uses `withTenant(actor.schoolId)`, or throws `FORBIDDEN` if `schoolId` is null.
    - `requirePlatform(actor): void`
    - `canManageSchool(actor, schoolId): boolean`: true for a platform admin, or a `school_admin` whose `schoolId` matches.
    - `canManageBranch(actor, schoolId, branchId): boolean`: true if `canManageSchool`, or the actor is a `branch_admin` of that branch.
    - `assert(cond: boolean): asserts cond`, which throws `FORBIDDEN`.

- [ ] **Step 1: Write the failing tests.** Make them table-driven over actors (platform, school_admin A, branch_admin A1, teacher A1, student A1, school_admin B) × checks `canManageSchool(A)`, `canManageBranch(A, A1)`, `canManageBranch(A, A2)`. Expected matrix:
  - platform: all true
  - school_admin A: all true
  - branch_admin A1: only `canManageBranch(A, A1)`
  - teacher, student, school_admin B: all false
  - Also: `runAs` with a non-platform actor whose `schoolId` is null rejects with `FORBIDDEN`.
- [ ] **Step 2: Run** `pnpm vitest run tests/tenancy/authz.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `errors.ts` and `authz.ts`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(tenancy): actor model and authorization helpers"`

---

### Task 4: Identity (passwords, usernames, sessions, login, resolveActor)

**Files:**
- Create: `src/modules/tenancy/auth/{passwords,usernames,sessions,login}.ts`; modify `src/modules/tenancy/actor.ts`
- Test: `tests/tenancy/auth.test.ts`

**Interfaces:**
- Consumes: `withPlatform`, `DomainError`, `Actor`
- Produces:
  - `hashPassword(pw: string): Promise<string>`, `verifyPassword(hash: string, pw: string): Promise<boolean>`, `assertPasswordStrength(pw: string): void` (throws `WEAK_PASSWORD`)
  - `normalizeUsername(raw: string): string`, `assertValidUsername(u: string): void` (throws `INVALID_USERNAME`)
  - `suggestUsernames(tx: Tx, base: string, count = 3): Promise<string[]>`: returns the first `count` free names from `base1`, `base2`, and so on, after truncating `base` to 29 characters.
  - `createSession(userId: string): Promise<string>`: the token is 32 random bytes in base64url; the DB stores its SHA-256; TTL is 30 days.
  - `revokeUserSessions(tx: Tx, userId: string): Promise<void>`
  - `login(username: string, password: string): Promise<{ token: string; actor: Actor }>`. It throws `INVALID_CREDENTIALS` for an unknown user, a wrong password, or a user with a null `password_hash`. It throws `ACCOUNT_REMOVED` when the student profile status is `removed`.
  - `resolveActor(token: string | undefined): Promise<Actor | null>`. It returns null for a missing, unknown, or expired session, and for a removed student.

- [ ] **Step 1: Write the failing tests.** Seed a user via `withPlatform` with a school_admin membership, a student with `status='removed'`, and a student `riya.s`.

```ts
it('normalizes and validates usernames', () => {
  expect(normalizeUsername('  Riya.S ')).toBe('riya.s');
  expect(() => assertValidUsername('ab')).toThrow(expect.objectContaining({ code: 'INVALID_USERNAME' }));
  expect(() => assertValidUsername('has space')).toThrow(expect.objectContaining({ code: 'INVALID_USERNAME' }));
});
it('rejects weak passwords', () => expect(() => assertPasswordStrength('short')).toThrow(expect.objectContaining({ code: 'WEAK_PASSWORD' })));
it('suggests free usernames', async () => {
  // riya.s and riya.s1 exist
  expect(await withPlatform(tx => suggestUsernames(tx, 'riya.s'))).toEqual(['riya.s2', 'riya.s3', 'riya.s4']);
});
it('logs in case-insensitively and resolves actor', async () => {
  const { token, actor } = await login('RIYA.S', 'correct-horse');
  expect(actor).toMatchObject({ roles: ['student'], schoolId: seed.a.schoolId, branchId: seed.a.branchId });
  expect(await resolveActor(token)).toEqual(actor);
});
it('rejects wrong password and removed students', async () => {
  await expect(login('riya.s', 'nope-nope')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
  await expect(login('removed.kid', 'correct-horse')).rejects.toMatchObject({ code: 'ACCOUNT_REMOVED' });
});
it('expired or revoked sessions resolve to null', async () => {
  const { token, actor } = await login('riya.s', 'correct-horse');
  await withPlatform(tx => revokeUserSessions(tx, actor.userId));
  expect(await resolveActor(token)).toBeNull();
  expect(await resolveActor(undefined)).toBeNull();
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/tenancy/auth.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `resolveActor` and `login` read `users`, `sessions`, `memberships`, and `student_profiles` through `withPlatform`, because there is no tenant context yet at that point.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(tenancy): username/password identity, sessions, actor resolution"`

---

### Task 5: Tenancy service, branch codes, plans, periods, and signup with a code

**Files:**
- Create: `src/modules/tenancy/{codes,service,index}.ts`, `src/modules/enrollment/{periods,plans,signup}.ts`
- Test: `tests/tenancy/service.test.ts`, `tests/enrollment/periods.test.ts`, `tests/enrollment/signup.test.ts`

**Interfaces:**
- Consumes: `runAs`, the authz helpers, `hashPassword`, the username helpers, `withPlatform`, `withTenant`
- Produces (tenancy):
  - `generateBranchCode(): string`: 8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, generated with `crypto.randomInt`.
  - `createSchool(actor, { name, board }): Promise<{ id: string }>`: platform only.
  - `createBranch(actor, { schoolId, name }): Promise<{ id: string; signupCode: string }>`: requires `canManageSchool`.
  - `rotateBranchCode(actor, branchId): Promise<string>`: requires `canManageBranch`.
  - `setBranchCodeEnabled(actor, branchId, enabled: boolean): Promise<void>`: requires `canManageBranch`.
  - `createSection(actor, { branchId, grade, name }): Promise<{ id: string }>`: requires `canManageBranch`. Throws `VALIDATION` if grade is outside 5–12.
  - `createSubject(actor, { schoolId, name }): Promise<{ id: string }>`: requires `canManageSchool`.
  - `createStaffUser(actor, { schoolId, branchId: string | null, role: Exclude<Role,'student'>, username, password, name, email? }): Promise<{ userId: string }>`:
    - `school_admin` requires `branchId` null; the other roles require it set.
    - Authorization: platform admin, or a `school_admin` of the school; a `branch_admin` may create a `teacher` in their own branch only.
  - `assignTeacher(actor, { teacherId, sectionId, subjectId }): Promise<void>`: requires `canManageBranch` of the section's branch.
  - `findBranchByCode(code: string): Promise<{ schoolId; branchId; schoolName; branchName; enabled: boolean } | null>`: a system function on `withPlatform`. The code is upper-cased and trimmed.
- Produces (enrollment):
  - `addInterval(start: Date, interval: 'monthly' | 'annual'): Date`: UTC calendar months (1 or 12), clamped to the last day of the target month.
  - `createPlan(actor, { name, interval, priceMinor, currency? }): Promise<{ id: string }>`: platform only.
  - `listActivePlans(): Promise<Plan[]>`
  - `checkUsername(raw: string): Promise<{ username: string; available: boolean; suggestions: string[] }>`
  - `signupWithCode(input: SignupInput): Promise<{ studentUserId: string; subscriptionId: string }>`, where `SignupInput = { code, grade, sectionId?, studentName, parentName, parentPhone, parentEmail?, planId, username, password }`. It is validated with zod (errors become `VALIDATION`). In one transaction under `withTenant(schoolId)` it inserts:
    - a user
    - a student membership
    - `student_profiles` (`pending_payment`)
    - `subscriptions` (`pending`)
  - `signupWithCode` errors:
    - `INVALID_CODE` for an unknown code
    - `CODE_DISABLED` for a disabled code
    - `VALIDATION` for a bad grade, a section not in that branch and grade, or an inactive or unknown plan
    - `USERNAME_TAKEN` with `details.suggestions` (catch Postgres `23505` on `users_username_unique` too, to cover races)

- [ ] **Step 1: Write the failing tests.**

```ts
// periods
expect(addInterval(new Date('2027-01-31T00:00:00Z'), 'monthly').toISOString()).toBe('2027-02-28T00:00:00.000Z');
expect(addInterval(new Date('2028-01-31T00:00:00Z'), 'monthly').toISOString()).toBe('2028-02-29T00:00:00.000Z');
expect(addInterval(new Date('2027-03-15T10:00:00Z'), 'annual').toISOString()).toBe('2028-03-15T10:00:00.000Z');

// tenancy service
it('branch code is 8 chars from the unambiguous alphabet', () =>
  expect(generateBranchCode()).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/));
it('branch_admin cannot create a branch; school_admin can', ...);         // FORBIDDEN vs ok
it('createSection rejects grade 4 and 13 with VALIDATION', ...);
it('branch_admin can create teacher in own branch, not branch_admin', ...);

// signup
it('signs up a pending student with a normalized username', async () => {
  const r = await signupWithCode({ ...valid, code: seed.a.code.toLowerCase(), username: ' Riya.S ' });
  const p = await withTenant(seed.a.schoolId, tx => tx.select().from(studentProfiles).where(eq(studentProfiles.userId, r.studentUserId)));
  expect(p[0]).toMatchObject({ status: 'pending_payment', grade: 8 });
  expect((await login('riya.s', valid.password)).actor.roles).toEqual(['student']);
});
it('rejects rotated and disabled codes', async () => {
  const old = seed.a.code;
  await rotateBranchCode(seed.a.schoolAdmin, seed.a.branchId);
  await expect(signupWithCode({ ...valid, code: old })).rejects.toMatchObject({ code: 'INVALID_CODE' });
  await setBranchCodeEnabled(seed.a.schoolAdmin, seed.a.branchId, false);
  const cur = await currentCode(seed.a.branchId);
  await expect(signupWithCode({ ...valid, code: cur })).rejects.toMatchObject({ code: 'CODE_DISABLED' });
});
it('rejects a section from another grade or branch', ...);                // VALIDATION
it('concurrent duplicate usernames: one wins, other USERNAME_TAKEN with suggestions', async () => {
  const results = await Promise.allSettled([signupWithCode(valid), signupWithCode({ ...valid, studentName: 'Twin' })]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const rej = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
  expect(rej.reason).toMatchObject({ code: 'USERNAME_TAKEN' });
  expect(rej.reason.details.suggestions).toHaveLength(3);
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/tenancy tests/enrollment`. Expected: FAIL.
- [ ] **Step 3: Implement** the functions above. On a `23505` collision in `branches.signup_code`, `createBranch` and `rotateBranchCode` retry code generation up to 5 times.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat: tenancy service, branch codes, plans, and signup with code"`

---

### Task 6: School manual add and parent invites

**Files:**
- Create: `src/modules/enrollment/invites.ts`
- Test: `tests/enrollment/invites.test.ts`

**Interfaces:**
- Consumes: `runAs`, `canManageBranch`, the signup validation helpers from `signup.ts` (export `validateCredentials(username, password)` and `assertSectionInBranch(tx, sectionId, branchId, grade)` from there)
- Produces:
  - `manualAddStudent(actor, { branchId, grade, sectionId?, studentName, parentName, parentPhone, parentEmail? }): Promise<{ studentUserId: string; inviteToken: string; inviteUrl: string }>`. Requires `canManageBranch`. It creates a user with null username and password, a student membership, a `pending_payment` profile, and an invite valid for 14 days. `inviteUrl = ${APP_URL}/invite/${token}`.
  - `getInvite(token): Promise<{ studentName; schoolName; branchName; grade } | null>`. Returns null if the invite is unknown, expired, or used.
  - `completeInvite({ token, planId, username, password }): Promise<{ studentUserId: string; subscriptionId: string }>`. It sets the credentials, creates a `pending` subscription, and marks the invite used, all in one transaction. It throws `INVITE_INVALID` if the invite is unknown, expired, or used, and `USERNAME_TAKEN` the same way as signup.

- [ ] **Step 1: Write the failing tests:**
  - A school_admin of A can add to branch A1, and the result appears as `pending_payment`.
  - A teacher gets `FORBIDDEN`.
  - `getInvite` returns the student and school names.
  - `completeInvite` then lets the student log in with a pending subscription.
  - A second `completeInvite` with the same token gets `INVITE_INVALID`.
  - An invite whose `expires_at` is set in the past gets `INVITE_INVALID`, and `getInvite` returns null for it.
- [ ] **Step 2: Run** `pnpm vitest run tests/enrollment/invites.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Tokens follow the same pattern as sessions: 32 random bytes, with the SHA-256 stored.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(enrollment): school manual add with parent invite links"`

---

### Task 7: Manual payments, activation, and the lapse job

**Files:**
- Create: `src/modules/enrollment/{payments,lapse}.ts`
- Test: `tests/enrollment/payments.test.ts`

**Interfaces:**
- Consumes: `requirePlatform`, `withPlatform`, `addInterval`
- Produces:
  - `recordPayment(actor, { subscriptionId, amountMinor, currency, externalRef?, paidAt: Date }): Promise<{ periodStart: Date; periodEnd: Date }>`. Platform only. In one transaction it inserts a payment (`method: 'manual_link'`, `recorded_by: actor.userId`) and computes the new period:
    - **pending or lapsed:** start = `paidAt`, end = `addInterval(paidAt)`
    - **active:** start unchanged, end = `addInterval(current_period_end)`

    It then sets the subscription to `active` and the profile to `active`. It throws `STUDENT_REMOVED` if the profile is `removed` and `NOT_FOUND` for an unknown subscription.
  - `listPendingSubscriptions(actor): Promise<PendingRow[]>`. Platform only. Returns subscriptions in `pending` or `lapsed` whose profile is not `removed`, ordered by `created_at`.
    - `PendingRow` fields: `{ subscriptionId, status, studentName, username, schoolName, branchName, grade, parentName, parentPhone, planName, priceMinor, currency, createdAt }`
  - `lapseExpired(now: Date): Promise<number>`. Sets `lapsed` on every `active` subscription with `current_period_end < now`, and on its `active` profile. Returns the number of subscriptions lapsed.

- [ ] **Step 1: Write the failing tests** (monthly plan):

```ts
it('first payment activates from paidAt', async () => {
  const r = await recordPayment(platform, { subscriptionId: s, amountMinor: 49900, currency: 'INR', paidAt: new Date('2027-01-31T00:00:00Z') });
  expect(r.periodEnd.toISOString()).toBe('2027-02-28T00:00:00.000Z');
  expect(await profileStatus(student)).toBe('active');
});
it('payment while active extends from current end', async () => { /* second payment paidAt 2027-02-10 → end 2027-03-28 */ });
it('lapse then pay restarts from paidAt', async () => {
  expect(await lapseExpired(new Date('2027-03-01T00:00:00Z'))).toBe(1);
  expect(await profileStatus(student)).toBe('lapsed');
  const r = await recordPayment(platform, { ..., paidAt: new Date('2027-04-10T00:00:00Z') });
  expect(r.periodStart.toISOString()).toBe('2027-04-10T00:00:00.000Z');
});
it('rejects non-platform actors and removed students', async () => {
  await expect(recordPayment(seed.a.schoolAdmin, {...})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  // mark profile removed → STUDENT_REMOVED
});
it('pending list excludes removed and active', ...);
```

- [ ] **Step 2: Run** `pnpm vitest run tests/enrollment/payments.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Lock the subscription row with `select … for update` inside `recordPayment`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(enrollment): manual payment recording, activation, and lapse job"`

---

### Task 8: Student listing, removal, and status

**Files:**
- Create: `src/modules/enrollment/{students,index}.ts`
- Test: `tests/enrollment/students.test.ts`

**Interfaces:**
- Consumes: `runAs`, `canManageSchool`, `canManageBranch`, `revokeUserSessions`
- Produces:
  - `listStudents(actor, { branchId?, grade?, status? }): Promise<StudentRow[]>`.
    - A `school_admin` (or platform admin, given a `schoolId` filter) sees all branches.
    - A `branch_admin` sees only their branch; passing another `branchId` throws `FORBIDDEN`.
    - Anyone else gets `FORBIDDEN`.
    - `StudentRow` fields: `{ userId, name, username: string | null, branchId, branchName, grade, sectionName: string | null, status, planName: string | null, periodEnd: Date | null }`
  - `removeStudent(actor, studentUserId): Promise<void>`. Requires `canManageBranch` of the student's branch. Sets the profile to `removed`, sets the subscription to `cancelled`, and revokes sessions. It is idempotent.
  - `studentStatus(actor): Promise<{ status: StudentStatus; planName: string | null; periodEnd: Date | null }>`. For the acting student only; throws `FORBIDDEN` for non-students.

- [ ] **Step 1: Write the failing tests:**
  - school_admin A lists 1 student, and filtering by `status: 'active'` returns 0.
  - branch_admin A1 passing B's branchId gets `FORBIDDEN`.
  - A teacher gets `FORBIDDEN`.
  - After `removeStudent`, the student's earlier token gives `resolveActor(token) === null`, `login` throws `ACCOUNT_REMOVED`, and the student row still exists with `status: 'removed'`.
  - `studentStatus` for a pending student returns `{ status: 'pending_payment', planName: 'Monthly', periodEnd: null }`.
- [ ] **Step 2: Run** `pnpm vitest run tests/enrollment/students.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** `index.ts` re-exports the public enrollment API.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(enrollment): list, remove, and status for students"`

---

### Task 9: Cross-school isolation suite, platform CLI, and lapse script

**Files:**
- Create: `tests/isolation/services.test.ts`, `scripts/admin.ts`, `scripts/lapse.ts`, `.github/workflows/ci.yml`; modify `package.json` scripts (`admin`, `job:lapse`, `test`, `test:isolation`)
- Test: `tests/isolation/services.test.ts`

**Interfaces:**
- Consumes: every public function from `src/modules/tenancy/index.ts` and `src/modules/enrollment/index.ts`; `seedTwoSchools`
- Produces:
  - CLI `pnpm admin <command>` with these commands:
    - `create-school --name --board`
    - `create-branch --school --name`
    - `create-plan --name --interval --price-minor [--currency]`
    - `create-staff --school [--branch] --role --username --password --name`
    - `create-platform-admin --username --password --name`
    - `pending`
    - `record-payment --subscription --amount-minor [--currency] [--ref] [--paid-at]`

    It runs as a synthetic platform actor (`{ userId: <platform admin id from --as username>, isPlatformAdmin: true, ... }`); `--as` is required for `record-payment` so that `recorded_by` is a real user. `create-platform-admin` writes directly through `withPlatform`, as a bootstrap.
  - `pnpm job:lapse` calls `lapseExpired(new Date())` and prints the count. It is meant for a daily cron.

- [ ] **Step 1: Write the isolation tests.** Each case acts as School A's actors and targets School B ids. Each must reject with `FORBIDDEN` or `NOT_FOUND`, or return no B data:
  - `listStudents(a.schoolAdmin, { branchId: b.branchId })`: `FORBIDDEN`, or an empty result if RLS hides it. Assert that no row has B's schoolId either way.
  - `removeStudent(a.schoolAdmin, b.studentId)`: rejects, and B's student is still `pending_payment` (checked via `withPlatform`).
  - `rotateBranchCode` and `setBranchCodeEnabled` with `(a.schoolAdmin, b.branchId)`: reject, and B's code is unchanged.
  - `createSection(a.branchAdmin, { branchId: b.branchId, ... })`: rejects.
  - `createStaffUser(a.schoolAdmin, { schoolId: b.schoolId, ... })`: rejects.
  - `assignTeacher(a.schoolAdmin, { teacherId: a.teacherId, sectionId: b.sectionId, subjectId: a.subjectId })`: rejects.
  - `manualAddStudent(a.schoolAdmin, { branchId: b.branchId, ... })`: rejects, and B's student count is unchanged.
  - `recordPayment` and `listPendingSubscriptions` as a school admin: `FORBIDDEN`.
  - `studentStatus(a.student)`: returns only A data.
  - Raw: `withTenant(a.schoolId, tx => tx.select().from(T))` for every RLS table `T` returns only rows with `schoolId === a.schoolId`. Loop over the table list exported from `src/db/schema/index.ts` as `tenantTables`.
- [ ] **Step 2: Run** `pnpm vitest run tests/isolation`. Expected: PASS if Tasks 2–8 are correct. Any failure is a real leak; fix it in the owning module before continuing.
- [ ] **Step 3: Implement** `scripts/admin.ts` (with `node:util` `parseArgs`) and `scripts/lapse.ts`. Add `"test:isolation": "vitest run tests/isolation"`. Add `.github/workflows/ci.yml`: on push and PR, start a `pgvector/pgvector:pg16` service, run `docker/init.sql` with `psql`, then run `pnpm install`, `pnpm vitest run` (which includes the isolation suite), and `pnpm tsc --noEmit`.
- [ ] **Step 4: Smoke test the CLI** against the dev DB:
  - `pnpm admin create-platform-admin --username ops --password 'change-me-now' --name Ops`
  - then `pnpm admin create-school --name "Demo School" --board CBSE --as ops`

  Expected: a printed id.
- [ ] **Step 5: Commit:** `git commit -m "test: cross-school isolation suite; feat: platform CLI and lapse job"`

---

### Task 10: HTTP API (route handlers)

**Files:**
- Create: `src/lib/http.ts` and these routes:
  - `src/app/api/auth/{login,logout}/route.ts`
  - `src/app/api/join/route.ts`, `src/app/api/join/code/[code]/route.ts`, `src/app/api/join/username/route.ts`
  - `src/app/api/invite/[token]/route.ts`
  - `src/app/api/plans/route.ts`
  - `src/app/api/me/status/route.ts`
  - `src/app/api/school/students/route.ts`, `src/app/api/school/students/[id]/remove/route.ts`
  - `src/app/api/school/branches/[id]/code/route.ts`
  - `src/app/api/platform/{pending,payments}/route.ts`
- Test: `tests/http/routes.test.ts` (imports the handlers and calls them with `new Request(...)`)

**Interfaces:**
- Consumes: the public module APIs, `resolveActor`, `login`
- Produces:
  - `handle(fn: (req: Request, ctx) => Promise<Response>)` maps `DomainError` codes to HTTP statuses:
    - `VALIDATION`, `INVALID_USERNAME`, `WEAK_PASSWORD` → 400
    - `INVALID_CREDENTIALS` → 401
    - `FORBIDDEN`, `ACCOUNT_REMOVED` → 403
    - `INVALID_CODE`, `NOT_FOUND` → 404
    - `USERNAME_TAKEN`, `STUDENT_REMOVED` → 409
    - `CODE_DISABLED`, `INVITE_INVALID` → 410

    Each error body is `{ error: { code, message, details? } }`. Unknown errors become a 500 with `{ error: { code: 'INTERNAL' } }`, and the error is logged.
  - `requireActor(req): Promise<Actor>`: reads the `sid` cookie and throws 401 if there is no actor.
  - The session cookie is `sid`, `httpOnly`, `sameSite: 'lax'`, `secure` in production, `path: '/'`, `maxAge` 30 days.
  - Endpoints:
    - `POST /api/auth/login {username,password}` → `{ roles }` plus the cookie
    - `POST /api/auth/logout`
    - `GET /api/join/code/:code` → `{ schoolName, branchName, sections: {id, grade, name}[] }`
    - `GET /api/join/username?u=` → `checkUsername`
    - `POST /api/join` → 201
    - `GET` and `POST /api/invite/:token`
    - `GET /api/plans`
    - `GET /api/me/status`
    - `GET /api/school/students?branchId&grade&status`
    - `POST /api/school/students` → 201 `{ inviteUrl }`
    - `POST /api/school/students/:id/remove`
    - `POST /api/school/branches/:id/code { action: 'rotate'|'enable'|'disable' }` → `{ signupCode? }`
    - `GET /api/platform/pending`
    - `POST /api/platform/payments`

- [ ] **Step 1: Write the failing tests:**
  - `POST /api/join` with a disabled code → 410 and `error.code === 'CODE_DISABLED'`.
  - A duplicate username → 409 with `details.suggestions`.
  - Login sets an `httponly` `sid` cookie.
  - `GET /api/me/status` with that cookie → `{ status: 'pending_payment' }`.
  - After `removeStudent`, the same cookie on `GET /api/me/status` → 401.
  - `GET /api/platform/pending` as a school admin → 403.
  - Garbage JSON → 400 `VALIDATION`.
- [ ] **Step 2: Run** `pnpm vitest run tests/http`. Expected: FAIL.
- [ ] **Step 3: Implement** `http.ts` and the handlers. Parse each body with a zod schema per endpoint.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(api): auth, join, invite, school, and platform endpoints"`

---

### Task 11: Public pages and end-to-end flow

**Files:**
- Create:
  - `src/app/(public)/join/page.tsx`
  - `src/app/(public)/invite/[token]/page.tsx`
  - `src/app/(public)/login/page.tsx`
  - `src/app/(public)/status/page.tsx`
  - `src/app/page.tsx` (redirects to `/login`)
  - `playwright.config.ts`
  - `e2e/signup-activate.spec.ts`
- Test: `e2e/signup-activate.spec.ts`

**Interfaces:**
- Consumes: the Task 10 endpoints, and `recordPayment` via `pnpm admin record-payment` (or a direct import in the e2e setup)
- Produces: mobile-first client components (single column, max-width 480px), using plain CSS modules.
  - **`/join` is two steps:**
    1. Code entry; shows "Joining {schoolName} — {branchName}".
    2. Form with grade (5–12), optional section filtered by grade, student name, parent name, phone, optional email, plan radio from `/api/plans`, username (availability checked on blur, with clickable suggestions), and password.

    Success screen copy: "Account created. You'll be able to log in once your payment is confirmed."
  - **`/invite/[token]`:** shows "Set up {studentName}'s account at {schoolName}", then plan, username, and password. An invalid invite shows "This invite link has expired or was already used. Ask your school for a new one."
  - **`/login`:** on success, redirects to `/status`.
  - **`/status`:** copy is exact.
    - pending: "Your account is waiting for activation. Once your payment is confirmed you'll be able to start learning."
    - lapsed: "Your plan has expired. Please contact us to renew."
    - active: "Your account is active." (sub-project 3 replaces this with the tutor)
    - staff: "Signed in as {name}."

- [ ] **Step 1: Write the failing e2e test** in `e2e/signup-activate.spec.ts`, with a mobile viewport of 390×844:
  1. Seed a school, branch, and plan in `beforeAll`.
  2. Go to `/join` and enter the code. Expect the school name to be visible.
  3. Fill the form with username `E2E.Kid` and submit. Expect "Account created".
  4. Log in as `e2e.kid`. Expect the pending copy.
  5. Record a payment via the module function. Reload and expect "Your account is active."
- [ ] **Step 2: Run** `pnpm playwright test`. Expected: FAIL (the pages don't exist yet).
- [ ] **Step 3: Implement the pages.**
- [ ] **Step 4: Run** `pnpm playwright test && pnpm vitest run`. Expected: all PASS.
- [ ] **Step 5: Commit:** `git commit -m "feat(web): join, invite, login, and status pages with e2e signup-to-activation test"`
