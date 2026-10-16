import { ApiError, type Routes } from '../../core/router';
import { getPersona, getSlice, mutateSlice } from '../../core/store';
import { personaById } from '../../core/personas';
import { CORE_KEY, type CoreSeed, type CoreUser } from '../../core/seed-core';
import {
  emptySchoolSlice, enrollmentSummaryFor, listStudentsFor, STUDENT_STATUSES, SchoolError,
  type SchoolSlice,
} from './queries';

/** Seed slice for the school area (stored under key 'school'). */
export const seed: SchoolSlice = emptySchoolSlice();

const core = () => getSlice<CoreSeed>(CORE_KEY);
const school = () => getSlice<SchoolSlice>('school');

function actor(): CoreUser {
  const p = personaById(getPersona());
  const u = core().users.find((x) => x.id === p.userId);
  if (!u || (u.role !== 'school_admin' && u.role !== 'branch_admin')) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
  return u;
}
const isSchoolAdmin = (u: CoreUser) => u.role === 'school_admin';
/** A branch the actor may manage; anything else is NOT_FOUND like the real services (no existence leak). */
function manageableBranch(a: CoreUser, branchId: unknown) {
  const b = core().branches.find((x) => x.id === branchId);
  if (!b || (!isSchoolAdmin(a) && a.branchId !== b.id)) throw new ApiError(404, 'NOT_FOUND', 'Branch not found');
  return b;
}
function studentIn(a: CoreUser, id: string) {
  const s = core().users.find((u) => u.id === id && u.role === 'student');
  if (!s || (!isSchoolAdmin(a) && s.branchId !== a.branchId)) throw new ApiError(404, 'NOT_FOUND', 'Student not found');
  return s;
}
const err = (e: unknown): never => {
  if (e instanceof SchoolError) throw new ApiError(e.code === 'FORBIDDEN' ? 403 : e.code === 'NOT_FOUND' ? 404 : 400, e.code, e.message);
  throw e;
};
const validation = (msg: string): never => {
  throw new ApiError(400, 'VALIDATION', msg);
};
const rand = (n: number, alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789') =>
  Array.from({ length: n }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
const uid = (p: string) => `${p}-${rand(8)}`;
const inviteUrl = (token: string) => `${typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin}/invite/${token}`;
const text = (v: unknown, what: string, max: number) => {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s || s.length > max) validation(`${what} must be 1-${max} characters`);
  return s;
};
const validGrade = (g: unknown): number => {
  if (typeof g !== 'number' || !Number.isInteger(g) || g < 5 || g > 12) validation('Grade must be a whole number from 5 to 12');
  return g as number;
};

/** The real API returns username suggestions in `error.details`, which `ApiError` cannot carry. */
function usernameTaken(base: string): Response {
  const taken = new Set(core().users.map((u) => u.username));
  const stem = base.slice(0, 29);
  const suggestions: string[] = [];
  for (let i = 1; i < 1000 && suggestions.length < 3; i++) if (!taken.has(`${stem}${i}`)) suggestions.push(`${stem}${i}`);
  return new Response(
    JSON.stringify({ error: { code: 'USERNAME_TAKEN', message: 'That username is already taken', details: { suggestions } } }),
    { status: 409, headers: { 'content-type': 'application/json' } },
  );
}

const PHONE_RE = /^[+\d][\d\s()-]{5,30}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const routes: Routes = {
  'GET /api/school/students': ({ query }) => {
    const a = actor();
    try {
      const g = query.get('grade');
      if (g !== null && !/^\d{1,3}$/.test(g)) validation('grade must be a whole number');
      const st = query.get('status');
      if (st && !(STUDENT_STATUSES as string[]).includes(st)) validation('Unknown status');
      return {
        students: listStudentsFor(core(), school(), a, {
          branchId: query.get('branchId') || undefined, grade: g ? Number(g) : undefined, status: (st as never) || undefined,
        }),
      };
    } catch (e) {
      return err(e);
    }
  },

  'POST /api/school/students': ({ body }) => {
    const a = actor();
    const branch = manageableBranch(a, body?.branchId);
    const grade = validGrade(body?.grade);
    const studentName = text(body?.studentName, 'Student name', 200);
    const parentName = text(body?.parentName, 'Parent name', 200);
    const parentPhone = typeof body?.parentPhone === 'string' ? body.parentPhone.trim() : '';
    if (!PHONE_RE.test(parentPhone)) validation('Enter a valid parent phone number');
    const parentEmail = typeof body?.parentEmail === 'string' && body.parentEmail.trim() ? body.parentEmail.trim() : undefined;
    if (parentEmail && !EMAIL_RE.test(parentEmail)) validation('Enter a valid parent email');
    let sectionId: string | undefined;
    if (body?.sectionId) {
      const sec = core().sections.find((s) => s.id === body.sectionId);
      if (!sec || sec.branchId !== branch.id || sec.grade !== grade) validation('Section does not belong to this branch and grade');
      sectionId = sec!.id;
    }
    const id = uid('u');
    const token = rand(32);
    mutateSlice<CoreSeed>(CORE_KEY, (c) => {
      c.users.push({ id, name: studentName, username: '', role: 'student', branchId: branch.id, grade, sectionId, status: 'pending_payment' });
    });
    mutateSlice<SchoolSlice>('school', (s) => {
      s.parents[id] = { name: parentName, phone: parentPhone, email: parentEmail };
      s.invites[id] = token;
    });
    return new Response(JSON.stringify({ inviteUrl: inviteUrl(token) }), { status: 201, headers: { 'content-type': 'application/json' } });
  },

  'POST /api/school/students/:id/remove': ({ params }) => {
    const s = studentIn(actor(), params.id!);
    if (s.status !== 'removed') {
      mutateSlice<CoreSeed>(CORE_KEY, (c) => {
        c.users.find((u) => u.id === s.id)!.status = 'removed';
      });
      mutateSlice<SchoolSlice>('school', (sl) => {
        delete sl.invites[s.id];
      });
    }
    return { ok: true };
  },

  'POST /api/school/students/:id/password': ({ params, body }) => {
    const s = studentIn(actor(), params.id!);
    const pw = typeof body?.password === 'string' ? body.password : '';
    if (pw.length < 8) throw new ApiError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters');
    if (s.status === 'removed') throw new ApiError(400, 'STUDENT_REMOVED', 'This student has been removed');
    if (!s.username) throw new ApiError(400, 'VALIDATION', 'This student has not signed up yet; send them an invite link instead');
    mutateSlice<SchoolSlice>('school', (sl) => {
      sl.passwordResets[s.id] = { at: new Date().toISOString() };
    });
    return { ok: true };
  },

  'POST /api/school/students/:id/invite': ({ params }) => {
    const s = studentIn(actor(), params.id!);
    if (s.status !== 'pending_payment' || s.username) {
      throw new ApiError(400, 'VALIDATION', 'An invite can only be issued to a pending student who has not signed up');
    }
    const token = rand(32);
    mutateSlice<SchoolSlice>('school', (sl) => {
      sl.invites[s.id] = token;
    });
    return new Response(JSON.stringify({ inviteUrl: inviteUrl(token) }), { status: 201, headers: { 'content-type': 'application/json' } });
  },

  'POST /api/school/branches/:id/code': ({ params, body }) => {
    const a = actor();
    const b = manageableBranch(a, params.id);
    const action = body?.action;
    if (action !== 'rotate' && action !== 'enable' && action !== 'disable') validation('Invalid action');
    if (action === 'rotate') {
      const prefix = b.code.includes('-') ? b.code.split('-')[0] : 'GRN';
      const code = `${prefix}-${rand(6, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789')}`;
      mutateSlice<CoreSeed>(CORE_KEY, (c) => {
        c.branches.find((x) => x.id === b.id)!.code = code;
      });
      return { signupCode: code };
    }
    mutateSlice<SchoolSlice>('school', (sl) => {
      sl.codeDisabled = sl.codeDisabled.filter((x) => x !== b.id);
      if (action === 'disable') sl.codeDisabled.push(b.id);
    });
    return {};
  },

  'POST /api/school/sections': ({ body }) => {
    const a = actor();
    const b = manageableBranch(a, body?.branchId);
    const grade = validGrade(body?.grade);
    const name = text(body?.name, 'Name', 50);
    if (core().sections.some((s) => s.branchId === b.id && s.grade === grade && s.name.toLowerCase() === name.toLowerCase())) {
      validation('A section with this grade and name already exists in the branch');
    }
    const id = uid('s');
    mutateSlice<CoreSeed>(CORE_KEY, (c) => {
      c.sections.push({ id, branchId: b.id, grade, name });
    });
    return new Response(JSON.stringify({ id }), { status: 201, headers: { 'content-type': 'application/json' } });
  },

  'POST /api/school/subjects': ({ body }) => {
    const a = actor();
    if (!isSchoolAdmin(a)) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
    const name = text(body?.name, 'Name', 100);
    if (core().subjects.some((s) => s.name.toLowerCase() === name.toLowerCase())) validation('A subject with this name already exists');
    const id = uid('sub');
    mutateSlice<CoreSeed>(CORE_KEY, (c) => {
      c.subjects.push({ id, name });
    });
    return new Response(JSON.stringify({ id }), { status: 201, headers: { 'content-type': 'application/json' } });
  },

  'POST /api/school/teachers': ({ body }) => {
    const a = actor();
    const b = manageableBranch(a, body?.branchId);
    const username = String(body?.username ?? '').trim().toLowerCase();
    const password = typeof body?.password === 'string' ? body.password : '';
    const name = text(body?.name, 'Name', 200);
    if (!/^[a-z0-9_.]{4,32}$/.test(username)) {
      throw new ApiError(400, 'INVALID_USERNAME', 'Username must be 4-32 characters: lowercase letters, digits, "_" or "."');
    }
    if (password.length < 8) throw new ApiError(400, 'WEAK_PASSWORD', 'Password must be at least 8 characters');
    if (core().users.some((u) => u.username === username)) return usernameTaken(username);
    const id = uid('u');
    mutateSlice<CoreSeed>(CORE_KEY, (c) => {
      c.users.push({ id, name, username, role: 'teacher', branchId: b.id });
    });
    return new Response(JSON.stringify({ userId: id, username }), { status: 201, headers: { 'content-type': 'application/json' } });
  },

  'POST /api/school/assignments': ({ body }) => {
    const a = actor();
    const t = core().users.find((u) => u.id === body?.teacherId && u.role === 'teacher');
    if (!t || (!isSchoolAdmin(a) && t.branchId !== a.branchId)) throw new ApiError(404, 'NOT_FOUND', 'Teacher not found');
    const sec = core().sections.find((s) => s.id === body?.sectionId);
    if (!sec || (!isSchoolAdmin(a) && sec.branchId !== a.branchId)) throw new ApiError(404, 'NOT_FOUND', 'Section not found');
    if (!core().subjects.some((s) => s.id === body?.subjectId)) throw new ApiError(404, 'NOT_FOUND', 'Subject not found');
    if (sec.branchId !== t.branchId) validation('Teacher and section must be in the same branch');
    mutateSlice<SchoolSlice>('school', (sl) => {
      if (!sl.assignments.some((x) => x.teacherId === t.id && x.sectionId === sec.id && x.subjectId === body.subjectId)) {
        sl.assignments.push({ teacherId: t.id, sectionId: sec.id, subjectId: body.subjectId });
      }
    });
    return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { 'content-type': 'application/json' } });
  },

  'GET /api/school/enrollment': ({ query }) => {
    const a = actor();
    let summary = enrollmentSummaryFor(core(), a);
    const branchId = query.get('branchId');
    if (branchId) {
      if (!isSchoolAdmin(a) && branchId !== a.branchId) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
      if (!core().branches.some((b) => b.id === branchId)) throw new ApiError(403, 'FORBIDDEN', 'Forbidden');
      summary = summary.filter((r) => r.branchId === branchId);
    }
    return { summary };
  },
};
