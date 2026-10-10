/**
 * Platform admin CLI. Usage: pnpm admin <command> [flags]
 *
 *   create-platform-admin --username <u> --password <p> --name <n>
 *   create-school         --name <n> --board <b>
 *   create-branch         --school <schoolId> --name <n>
 *   create-plan           --name <n> --interval monthly|annual --price-minor <int> [--currency INR]
 *   create-staff          --school <schoolId> [--branch <branchId>] --role school_admin|branch_admin|teacher
 *                         --username <u> --password <p> --name <n>
 *   create-section        --branch <branchId> --grade <5-12> --name <n>
 *   create-subject        --school <schoolId> --name <n>
 *   assign-teacher        --teacher <teacher username> --section <sectionId> --subject <subjectId>
 *   list-school           --school <schoolId>   (branches, sections, subjects and teachers, with ids)
 *   reset-password        --username <student username> [--password <p>] [--as <platform admin username>]
 *                         (admin-initiated student password reset; revokes the student's sessions)
 *   pending
 *   record-payment        --subscription <id> --amount-minor <int> [--currency INR] [--ref <r>] [--paid-at <ISO>]
 *                         --as <platform admin username>   (required)
 *
 * Every command accepts --as <username> (a platform admin); without it a synthetic platform actor is used.
 * Passwords: --password is visible in shell history, `ps`, and pnpm's own "$ tsx ..." command echo;
 * prefer setting ADMIN_PASSWORD in the environment instead (used when --password is omitted), e.g.
 * `ADMIN_PASSWORD=... pnpm admin create-platform-admin --username ops_admin --name Ops`.
 * This script itself never prints passwords.
 * Loads .env (dev DB). Prints one JSON line on success; exit 1 on DomainError, 2 on usage errors.
 */
import './env';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { asc, eq } from 'drizzle-orm';
import { closeDb, withPlatform } from '@/db/client';
import { branches, schools, sections, users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { redactError } from '@/lib/redact';
import { isUuid } from '@/lib/uuid';
import { createPlan, listPendingSubscriptions, recordPayment, resetStudentPassword } from '@/modules/enrollment';
import {
  assignTeacher, createBranch, createSchool, createSection, createStaffUser, createSubject, hashPassword, listSubjects, listTeachers,
  loadActor, normalizeUsername, requirePlatform,
  validateCredentials, withUsernameTakenHandling, type Actor, type StaffRole,
} from '@/modules/tenancy';
import { assertUsernameFree } from '@/modules/tenancy/auth/credentials';

export type Io = { out: (line: string) => void; err: (line: string) => void };
const defaultIo: Io = { out: (s) => console.log(s), err: (s) => console.error(s) };

class UsageError extends Error {}

const SYNTHETIC_PLATFORM: Actor = {
  userId: '00000000-0000-0000-0000-000000000000',
  isPlatformAdmin: true,
  schoolId: null,
  branchId: null,
  roles: [],
};

type Flags = Record<string, string | undefined>;
type Command = { flags: string[]; run: (f: Flags, actor: () => Promise<Actor>, io: Io) => Promise<unknown> };

function req(f: Flags, name: string): string {
  const v = f[name];
  if (v === undefined || v === '') throw new UsageError(`--${name} is required`);
  return v;
}

function password(f: Flags): string {
  const v = f.password ?? process.env.ADMIN_PASSWORD;
  if (!v) throw new UsageError('--password (or ADMIN_PASSWORD env var) is required');
  return v;
}

function int(f: Flags, name: string): number {
  const raw = req(f, name);
  if (!/^-?\d+$/.test(raw)) throw new DomainError('VALIDATION', `--${name} must be an integer`);
  return Number(raw);
}

/** Looks up a platform admin by username and builds its Actor. */
async function actorFor(username: string): Promise<Actor> {
  const actor = await withPlatform(async (tx) => {
    const [u] = await tx
      .select({ id: users.id, isPlatformAdmin: users.isPlatformAdmin })
      .from(users)
      .where(eq(users.username, normalizeUsername(username)))
      .limit(1);
    return u?.isPlatformAdmin ? loadActor(tx, u.id) : null;
  });
  if (!actor?.isPlatformAdmin) throw new DomainError('FORBIDDEN', `--as ${username} is not a platform admin`);
  return actor;
}

const commands: Record<string, Command> = {
  'create-platform-admin': {
    flags: ['username', 'password', 'name'],
    run: async (f) => {
      const name = req(f, 'name').trim();
      const pw = password(f);
      const username = validateCredentials(req(f, 'username'), pw);
      if (!name) throw new UsageError('--name is required');
      const passwordHash = await hashPassword(pw);
      // Bootstrap: written directly with the platform connection.
      return withUsernameTakenHandling(username, () =>
        withPlatform(async (tx) => {
          await assertUsernameFree(tx, username);
          const [u] = await tx
            .insert(users)
            .values({ username, passwordHash, name, isPlatformAdmin: true })
            .returning({ id: users.id });
          return { userId: u.id, username };
        }),
      );
    },
  },
  'create-school': {
    flags: ['name', 'board'],
    run: async (f, actor) => {
      const input = { name: req(f, 'name'), board: req(f, 'board') };
      const { id } = await createSchool(await actor(), input);
      return { schoolId: id };
    },
  },
  'create-branch': {
    flags: ['school', 'name'],
    run: async (f, actor) => {
      const input = { schoolId: req(f, 'school'), name: req(f, 'name') };
      const { id, signupCode } = await createBranch(await actor(), input);
      return { branchId: id, signupCode };
    },
  },
  'create-plan': {
    flags: ['name', 'interval', 'price-minor', 'currency'],
    run: async (f, actor) => {
      const input = {
        name: req(f, 'name'),
        interval: req(f, 'interval') as 'monthly' | 'annual',
        priceMinor: int(f, 'price-minor'),
        currency: f.currency,
      };
      const { id } = await createPlan(await actor(), input);
      return { planId: id };
    },
  },
  'create-staff': {
    flags: ['school', 'branch', 'role', 'username', 'password', 'name'],
    run: async (f, actor) => {
      const input = {
        schoolId: req(f, 'school'),
        branchId: f.branch ?? null,
        role: req(f, 'role') as StaffRole,
        username: req(f, 'username'),
        password: password(f),
        name: req(f, 'name'),
      };
      return createStaffUser(await actor(), input);
    },
  },
  'create-section': {
    flags: ['branch', 'grade', 'name'],
    run: async (f, actor) => {
      const input = { branchId: req(f, 'branch'), grade: int(f, 'grade'), name: req(f, 'name') };
      const { id } = await createSection(await actor(), input);
      return { sectionId: id };
    },
  },
  'create-subject': {
    flags: ['school', 'name'],
    run: async (f, actor) => {
      const input = { schoolId: req(f, 'school'), name: req(f, 'name') };
      const { id } = await createSubject(await actor(), input);
      return { subjectId: id };
    },
  },
  'assign-teacher': {
    flags: ['teacher', 'section', 'subject'],
    run: async (f, actor) => {
      const username = normalizeUsername(req(f, 'teacher'));
      const input = { sectionId: req(f, 'section'), subjectId: req(f, 'subject') };
      const a = await actor();
      const [t] = await withPlatform((tx) => tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1));
      if (!t) throw new DomainError('NOT_FOUND', 'Teacher not found');
      await assignTeacher(a, { teacherId: t.id, ...input });
      return { teacher: username, ...input };
    },
  },
  'list-school': {
    flags: ['school'],
    run: async (f, actor) => {
      const schoolId = req(f, 'school');
      const a = await actor();
      requirePlatform(a);
      if (!isUuid(schoolId)) throw new DomainError('NOT_FOUND', 'School not found');
      const [school, branchRows, sectionRows] = await withPlatform(async (tx) => {
        const [s] = await tx.select({ id: schools.id, name: schools.name, board: schools.board }).from(schools).where(eq(schools.id, schoolId));
        if (!s) throw new DomainError('NOT_FOUND', 'School not found');
        return [
          s,
          await tx.select({ id: branches.id, name: branches.name }).from(branches).where(eq(branches.schoolId, schoolId)).orderBy(asc(branches.name), asc(branches.id)),
          await tx.select({ id: sections.id, branchId: sections.branchId, grade: sections.grade, name: sections.name })
            .from(sections).where(eq(sections.schoolId, schoolId)).orderBy(asc(sections.grade), asc(sections.name)),
        ] as const;
      });
      const [subjectRows, teachers] = await Promise.all([listSubjects(a, schoolId), listTeachers(a, schoolId)]);
      return {
        school,
        branches: branchRows.map((b) => ({
          ...b,
          sections: sectionRows.filter((s) => s.branchId === b.id).map(({ id, grade, name }) => ({ id, grade, name })),
        })),
        subjects: subjectRows,
        teachers,
      };
    },
  },
  'reset-password': {
    flags: ['username', 'password'],
    run: async (f, actor) => {
      const username = normalizeUsername(req(f, 'username'));
      const pw = password(f);
      const [u] = await withPlatform((tx) => tx.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1));
      if (!u) throw new DomainError('NOT_FOUND', 'Student not found');
      await resetStudentPassword(await actor(), u.id, pw);
      return { userId: u.id, username };
    },
  },
  pending: {
    flags: [],
    run: async (_f, actor) => listPendingSubscriptions(await actor()),
  },
  'record-payment': {
    flags: ['subscription', 'amount-minor', 'currency', 'ref', 'paid-at'],
    run: async (f, actor) => {
      if (!f.as) throw new UsageError('--as <platform admin username> is required for record-payment');
      const paidAt = f['paid-at'] ? new Date(f['paid-at']) : new Date();
      if (Number.isNaN(paidAt.getTime())) throw new DomainError('VALIDATION', '--paid-at must be an ISO date');
      const input = {
        subscriptionId: req(f, 'subscription'),
        amountMinor: int(f, 'amount-minor'),
        currency: (f.currency ?? 'INR').toUpperCase(),
        externalRef: f.ref,
        paidAt,
      };
      return recordPayment(await actor(), input);
    },
  },
};

function usage(): string {
  return `Usage: pnpm admin <command> [flags]\nCommands: ${Object.keys(commands).join(', ')}\nSee scripts/admin.ts for flags.`;
}

/** Runs one CLI command. Returns the process exit code (0 ok, 1 DomainError/failure, 2 usage). */
export async function run(argv: string[], io: Io = defaultIo): Promise<number> {
  const [name, ...rest] = argv;
  const cmd = name ? commands[name] : undefined;
  try {
    if (!cmd) throw new UsageError(name ? `Unknown command: ${name}` : 'No command given');
    let values: Flags;
    try {
      const options = Object.fromEntries(
        [...cmd.flags, 'as'].map((k) => [k, { type: 'string' as const }]),
      );
      ({ values } = parseArgs({ args: rest, options, strict: true, allowPositionals: false }) as { values: Flags });
    } catch (e) {
      throw new UsageError((e as Error).message);
    }
    const actor = () => (values.as ? actorFor(values.as) : Promise.resolve(SYNTHETIC_PLATFORM));
    const result = await cmd.run(values, actor, io);
    io.out(JSON.stringify(result));
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(`Error: ${e.message}\n${usage()}`);
      return 2;
    }
    if (e instanceof DomainError) {
      io.err(`Error [${e.code}]: ${e.message}${e.details ? ` ${JSON.stringify(e.details)}` : ''}`);
      return 1;
    }
    // Unexpected errors: print a redacted summary only (Drizzle "Failed query" messages embed bound params).
    const r = redactError(e);
    const cause = r.cause as { code?: string; message?: string } | undefined;
    io.err(`Error: ${r.name}: ${r.message ?? ''}${cause ? ` (${[cause.code, cause.message].filter(Boolean).join(': ')})` : ''}`);
    return 1;
  }
}

function isMain(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) {
  const code = await run(process.argv.slice(2));
  await closeDb();
  process.exit(code);
}
