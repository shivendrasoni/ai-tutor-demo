import './env';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { asc, eq } from 'drizzle-orm';
import { closeDb, withPlatform } from '@/db/client';
import { branches, schools, sections, users } from '@/db/schema';
import { DomainError } from '@/lib/errors';
import { isUuid } from '@/lib/uuid';
import {
  assertUsernameFree,
  assignTeacher,
  createBranch,
  createSchool,
  createSection,
  createStaffUser,
  createSubject,
  hashPassword,
  listSubjects,
  listTeachers,
  normalizeUsername,
  validateCredentials,
  withUsernameTakenHandling,
  type Actor,
  type StaffRole,
} from '@/modules/tenancy';
import {
  createPlan,
  listPendingSubscriptions,
  recordPayment,
  resetStudentPassword,
  type PlanInterval,
} from '@/modules/enrollment';

export type Io = { out: (line: string) => void; err: (line: string) => void };

class UsageError extends Error {}

type OptSpec = { type: 'string' };
type Command = {
  options: string[];
  required: string[];
  run: (v: Record<string, string | undefined>, actor: Actor, as: string | undefined) => Promise<unknown>;
};

const SYNTHETIC_ACTOR: Actor = {
  userId: '00000000-0000-0000-0000-000000000000',
  isPlatformAdmin: true,
  schoolId: null,
  branchId: null,
  roles: [],
};

function int(raw: string | undefined, what: string): number {
  if (raw === undefined || !/^-?\d+$/.test(raw.trim())) throw new DomainError('VALIDATION', `${what} must be a whole number`);
  return Number(raw.trim());
}

function password(v: Record<string, string | undefined>): string {
  const p = v.password ?? process.env.ADMIN_PASSWORD;
  if (!p) throw new UsageError('A password is required: pass --password or set ADMIN_PASSWORD');
  return p;
}

async function findUserByUsername(raw: string) {
  const username = normalizeUsername(raw);
  const [u] = await withPlatform((tx) =>
    tx.select({ id: users.id, username: users.username, isPlatformAdmin: users.isPlatformAdmin }).from(users).where(eq(users.username, username)).limit(1),
  );
  return u ?? null;
}

const commands: Record<string, Command> = {
  'create-school': {
    options: ['name', 'board'],
    required: ['name', 'board'],
    run: async (v, actor) => ({ schoolId: (await createSchool(actor, { name: v.name!, board: v.board! })).id }),
  },
  'create-branch': {
    options: ['school', 'name'],
    required: ['school', 'name'],
    run: async (v, actor) => {
      const r = await createBranch(actor, { schoolId: v.school!, name: v.name! });
      return { branchId: r.id, signupCode: r.signupCode };
    },
  },
  'create-plan': {
    options: ['name', 'interval', 'price-minor', 'currency'],
    required: ['name', 'interval', 'price-minor'],
    run: async (v, actor) => {
      const r = await createPlan(actor, {
        name: v.name!,
        interval: v.interval as PlanInterval,
        priceMinor: int(v['price-minor'], '--price-minor'),
        currency: v.currency,
      });
      return { planId: r.id };
    },
  },
  'create-staff': {
    options: ['school', 'branch', 'role', 'username', 'password', 'name'],
    required: ['school', 'role', 'username', 'name'],
    run: async (v, actor) => {
      const r = await createStaffUser(actor, {
        schoolId: v.school!,
        branchId: v.branch ?? null,
        role: v.role as StaffRole,
        username: v.username!,
        password: password(v),
        name: v.name!,
      });
      return { userId: r.userId };
    },
  },
  'create-platform-admin': {
    options: ['username', 'password', 'name'],
    required: ['username', 'name'],
    run: async (v) => {
      const pw = password(v);
      const username = validateCredentials(v.username!, pw);
      const name = v.name!.trim();
      if (name === '') throw new DomainError('VALIDATION', 'Name is required');
      const passwordHash = await hashPassword(pw);
      const userId = await withUsernameTakenHandling(username, () =>
        withPlatform(async (tx) => {
          await assertUsernameFree(tx, username);
          const [u] = await tx.insert(users).values({ username, passwordHash, name, isPlatformAdmin: true }).returning({ id: users.id });
          return u.id;
        }),
      );
      return { userId };
    },
  },
  pending: {
    options: [],
    required: [],
    run: (_v, actor) => listPendingSubscriptions(actor),
  },
  'record-payment': {
    options: ['subscription', 'amount-minor', 'currency', 'ref', 'paid-at'],
    required: ['subscription', 'amount-minor'],
    run: async (v, actor, as) => {
      if (!as) throw new UsageError('record-payment requires --as <platform admin username> so the payment has a real recorder');
      let paidAt = new Date();
      if (v['paid-at'] !== undefined) {
        paidAt = new Date(v['paid-at']);
        if (Number.isNaN(paidAt.getTime())) throw new DomainError('VALIDATION', '--paid-at must be an ISO date');
      }
      const r = await recordPayment(actor, {
        subscriptionId: v.subscription!,
        amountMinor: int(v['amount-minor'], '--amount-minor'),
        currency: (v.currency ?? 'INR').trim().toUpperCase(),
        externalRef: v.ref,
        paidAt,
      });
      return { periodStart: r.periodStart.toISOString(), periodEnd: r.periodEnd.toISOString() };
    },
  },
  'reset-password': {
    options: ['username', 'password'],
    required: ['username'],
    run: async (v, actor) => {
      const pw = password(v);
      const u = await findUserByUsername(v.username!);
      if (!u) throw new DomainError('NOT_FOUND', 'Student not found');
      await resetStudentPassword(actor, u.id, pw);
      return { userId: u.id, username: u.username };
    },
  },
  'create-section': {
    options: ['branch', 'grade', 'name'],
    required: ['branch', 'grade', 'name'],
    run: async (v, actor) => {
      const r = await createSection(actor, { branchId: v.branch!, grade: int(v.grade, '--grade'), name: v.name! });
      return { sectionId: r.id };
    },
  },
  'create-subject': {
    options: ['school', 'name'],
    required: ['school', 'name'],
    run: async (v, actor) => ({ subjectId: (await createSubject(actor, { schoolId: v.school!, name: v.name! })).id }),
  },
  'assign-teacher': {
    options: ['teacher', 'section', 'subject'],
    required: ['teacher', 'section', 'subject'],
    run: async (v, actor) => {
      const t = await findUserByUsername(v.teacher!);
      if (!t) throw new DomainError('NOT_FOUND', 'Teacher not found');
      await assignTeacher(actor, { teacherId: t.id, sectionId: v.section!, subjectId: v.subject! });
      return { teacher: t.username, sectionId: v.section, subjectId: v.subject };
    },
  },
  'list-school': {
    options: ['school'],
    required: ['school'],
    run: async (v, actor) => {
      const schoolId = v.school!;
      if (!isUuid(schoolId)) throw new DomainError('NOT_FOUND', 'School not found');
      const { school, bs, ss } = await withPlatform(async (tx) => {
        const [school] = await tx
          .select({ id: schools.id, name: schools.name, board: schools.board, status: schools.status })
          .from(schools)
          .where(eq(schools.id, schoolId));
        const bs = await tx
          .select({ id: branches.id, name: branches.name, signupCode: branches.signupCode, signupCodeEnabled: branches.signupCodeEnabled })
          .from(branches)
          .where(eq(branches.schoolId, schoolId))
          .orderBy(asc(branches.name), asc(branches.id));
        const ss = await tx
          .select({ id: sections.id, branchId: sections.branchId, grade: sections.grade, name: sections.name })
          .from(sections)
          .where(eq(sections.schoolId, schoolId))
          .orderBy(asc(sections.grade), asc(sections.name), asc(sections.id));
        return { school, bs, ss };
      });
      if (!school) throw new DomainError('NOT_FOUND', 'School not found');
      return {
        school,
        branches: bs.map((b) => ({
          ...b,
          sections: ss.filter((s) => s.branchId === b.id).map(({ id, grade, name }) => ({ id, grade, name })),
        })),
        subjects: await listSubjects(actor, schoolId),
        teachers: await listTeachers(actor, schoolId),
      };
    },
  },
};

/** Never echoes SQL text, parameters or hashes: only the leading error label and a Postgres code if present. */
function redact(err: unknown): string {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const code = typeof e?.code === 'string' ? e.code : typeof e?.cause?.code === 'string' ? e.cause.code : undefined;
  const label = err instanceof Error ? err.message.split('\n')[0].split(':')[0].trim().slice(0, 80) : 'unknown error';
  return `Unexpected error: ${label}${code ? ` (code ${code})` : ''}`;
}

/** Runs one CLI invocation. Exit codes: 0 ok, 1 domain/unexpected error, 2 usage error. */
export async function run(argv: string[], io: Io): Promise<number> {
  const [name, ...rest] = argv;
  const cmd = name ? commands[name] : undefined;
  if (!cmd) {
    io.err(`Unknown or missing command. Commands: ${Object.keys(commands).join(', ')}`);
    return 2;
  }
  try {
    const options: Record<string, OptSpec> = { as: { type: 'string' } };
    for (const o of cmd.options) options[o] = { type: 'string' };
    let values: Record<string, string | undefined>;
    try {
      values = parseArgs({ args: rest, options, strict: true, allowPositionals: false }).values as Record<string, string | undefined>;
    } catch (e) {
      throw new UsageError(e instanceof Error ? e.message : 'Invalid arguments');
    }
    const missing = cmd.required.filter((r) => values[r] === undefined);
    if (missing.length > 0) throw new UsageError(`Missing required option(s): ${missing.map((m) => `--${m}`).join(', ')}`);

    let actor = SYNTHETIC_ACTOR;
    if (values.as !== undefined) {
      const u = await findUserByUsername(values.as);
      if (!u || !u.isPlatformAdmin) throw new DomainError('FORBIDDEN', '--as must name an existing platform admin');
      actor = { ...SYNTHETIC_ACTOR, userId: u.id };
    }
    const result = await cmd.run(values, actor, values.as);
    io.out(JSON.stringify(result));
    return 0;
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(err.message);
      return 2;
    }
    if (err instanceof DomainError) {
      io.err(`${err.code}: ${err.message}${err.details ? ` ${JSON.stringify(err.details)}` : ''}`);
      return 1;
    }
    io.err(redact(err));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await run(process.argv.slice(2), { out: (s) => console.log(s), err: (s) => console.error(s) });
  await closeDb();
  process.exitCode = code;
}
