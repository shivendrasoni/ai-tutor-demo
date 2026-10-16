import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoutes, dispatch, registerRoutes } from '../../core/router';
import { getSlice, initStore, setPersona } from '../../core/store';
import { coreSeed, CORE_KEY, type CoreSeed } from '../../core/seed-core';
import { routes, seed } from './index';
import { loadSchoolDashboard, loadSchoolSetup, type SchoolSlice } from './queries';

const u = (p: string) => new URL(p, 'http://localhost');
const post = (path: string, body?: unknown) => dispatch('POST', u(path), { body: JSON.stringify(body ?? {}) });
const core = () => getSlice<CoreSeed>(CORE_KEY);
const school = () => getSlice<SchoolSlice>('school');
const actor = (id: string) => core().users.find((x) => x.id === id)!;

beforeEach(() => {
  initStore({ [CORE_KEY]: coreSeed, school: seed });
  clearRoutes();
  registerRoutes(routes);
  setPersona('school_admin');
});

const newStudent = { branchId: 'b-north', grade: 7, sectionId: 's-n7', studentName: 'Test Kid', parentName: 'Pa Rent', parentPhone: '+91 98765 43210' };

describe('school handlers', () => {
  it('adds a student, then lists, summarises and removes them live', async () => {
    const before = loadSchoolDashboard(core(), school(), actor('u-anita'), {}).totals;
    const res = await post('/api/school/students', newStudent);
    expect(res.status).toBe(201);
    expect((await res.json()).inviteUrl).toMatch(/\/invite\/\w{32}$/);
    const d = loadSchoolDashboard(core(), school(), actor('u-anita'), { branchId: 'b-north', grade: '7' });
    const row = d.students.find((s) => s.name === 'Test Kid')!;
    expect(row).toMatchObject({ username: null, status: 'pending_payment', sectionName: '7-A' });
    expect(loadSchoolDashboard(core(), school(), actor('u-anita'), {}).totals.pending).toBe(before.pending + 1);
    // invite re-issue works for a signed-up-less pending student
    expect((await post(`/api/school/students/${row.userId}/invite`)).status).toBe(201);
    expect((await post(`/api/school/students/${row.userId}/remove`)).status).toBe(200);
    expect(actor(row.userId).status).toBe('removed');
  });

  it('validates the new student', async () => {
    const bad = await post('/api/school/students', { ...newStudent, parentPhone: 'abc' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe('VALIDATION');
    const mismatch = await post('/api/school/students', { ...newStudent, grade: 8 });
    expect(mismatch.status).toBe(400);
    expect((await post('/api/school/students', { ...newStudent, branchId: 'nope' })).status).toBe(404);
  });

  it('resets passwords with the real error codes', async () => {
    expect((await post('/api/school/students/u-diya/password', { password: 'short' })).status).toBe(400);
    expect((await post('/api/school/students/u-diya/password', { password: 'long-enough-pw' })).status).toBe(200);
    expect(school().passwordResets['u-diya']).toBeTruthy();
    const unsigned = await post('/api/school/students/u-kabir/invite');
    expect(unsigned.status).toBe(400); // kabir has a username, so no invite
  });

  it('rotates and disables branch codes', async () => {
    const r = await (await post('/api/school/branches/b-north/code', { action: 'rotate' })).json();
    expect(r.signupCode).not.toBe('GRN-NORTH');
    await post('/api/school/branches/b-north/code', { action: 'disable' });
    expect(loadSchoolSetup(core(), school(), actor('u-anita')).branches.find((b) => b.branchId === 'b-north')).toMatchObject({ signupCode: r.signupCode, signupCodeEnabled: false });
  });

  it('creates sections, subjects, teachers and assignments', async () => {
    expect((await post('/api/school/sections', { branchId: 'b-north', grade: 7, name: '7-A' })).status).toBe(400);
    expect((await post('/api/school/sections', { branchId: 'b-north', grade: 6, name: '6-A' })).status).toBe(201);
    expect((await post('/api/school/subjects', { name: 'Art' })).status).toBe(201);
    expect((await post('/api/school/subjects', { name: 'art' })).status).toBe(400);
    const taken = await post('/api/school/teachers', { branchId: 'b-north', username: 'priya.r', password: 'password123', name: 'X' });
    expect(taken.status).toBe(409);
    const body = await taken.json();
    expect(body.error.code).toBe('USERNAME_TAKEN');
    expect(body.error.details.suggestions).toHaveLength(3);
    const ok = await (await post('/api/school/teachers', { branchId: 'b-north', username: 'new.teacher', password: 'password123', name: 'New T' })).json();
    expect(ok.username).toBe('new.teacher');
    const sec = core().sections.find((s) => s.name === '6-A')!;
    const sub = core().subjects.find((s) => s.name === 'Art')!;
    expect((await post('/api/school/assignments', { teacherId: ok.userId, sectionId: sec.id, subjectId: sub.id })).status).toBe(201);
    expect(school().assignments).toHaveLength(1);
    // cross-branch section is rejected
    expect((await post('/api/school/assignments', { teacherId: ok.userId, sectionId: 's-s5', subjectId: sub.id })).status).toBe(400);
  });

  it('restricts a branch admin to their branch', async () => {
    setPersona('branch_admin');
    const a = actor('u-rohan');
    const d = loadSchoolDashboard(core(), school(), a, {});
    expect(d.canFilterBranch).toBe(false);
    expect(d.branches.map((b) => b.branchId)).toEqual(['b-north']);
    expect(d.students.every((s) => s.branchId === 'b-north')).toBe(true);
    expect(() => loadSchoolDashboard(core(), school(), a, { branchId: 'b-south' })).toThrow();
    expect(loadSchoolSetup(core(), school(), a).canManageSubjects).toBe(false);
    expect((await post('/api/school/subjects', { name: 'Art' })).status).toBe(403);
    expect((await post('/api/school/students', { ...newStudent, branchId: 'b-south', sectionId: undefined })).status).toBe(404);
    expect((await post('/api/school/students/u-advik/remove')).status).toBe(404);
    expect((await dispatch('GET', u('/api/school/enrollment'))).status).toBe(200);
  });

  it('rejects non-admin personas and bad filters', async () => {
    setPersona('teacher');
    expect((await post('/api/school/subjects', { name: 'Art' })).status).toBe(403);
    setPersona('school_admin');
    expect(() => loadSchoolDashboard(core(), school(), actor('u-anita'), { grade: '99' })).toThrow(/Grade/);
    expect(() => loadSchoolDashboard(core(), school(), actor('u-anita'), { status: 'x' })).toThrow(/status/);
  });
});
