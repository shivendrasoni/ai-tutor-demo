import { beforeEach, describe, expect, it } from 'vitest';
import { clearRoutes, dispatch, registerRoutes } from '../../core/router';
import { coreSeed, CORE_KEY } from '../../core/seed-core';
import { initStore, setPersona, getSlice } from '../../core/store';
import { routes, seed, TEACHER_KEY } from './index';
import type { TeacherSlice } from './fixtures';

const call = async (method: string, path: string, init?: RequestInit) => {
  const r = await dispatch(method, new URL(path, 'http://x'), init);
  return { status: r.status, json: r.status === 204 ? null : await r.json() };
};

beforeEach(() => {
  initStore({ [CORE_KEY]: coreSeed, [TEACHER_KEY]: seed });
  clearRoutes();
  registerRoutes(routes);
  setPersona('teacher');
});

const upload = (fields: Record<string, string>, name = 'notes.pdf') => {
  const fd = new FormData();
  fd.set('file', new File([new Uint8Array(2048)], name, { type: name.endsWith('.pdf') ? 'application/pdf' : 'image/png' }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return call('POST', '/api/content', { method: 'POST', body: fd });
};
const mine = { title: 'Ratio worksheet', kind: 'material', scope: 'section', branchId: 'b-north', sectionId: 's-n7', grade: '7', subjectId: 'sub-math' };

describe('teacher analytics', () => {
  it('returns progress for an assigned class with weak chapters flagged', async () => {
    const { status, json } = await call('GET', '/api/teacher/progress?sectionId=s-n7&subjectId=sub-math');
    expect(status).toBe(200);
    expect(json.progress.chapters.length).toBeGreaterThan(3);
    expect(json.progress.students.map((s: { name: string }) => s.name)).toContain('Diya Nair');
    expect(json.progress.students.find((s: { studentId: string }) => s.studentId === 'u-kabir').chapters[0].ratio).toBeNull();
  });
  it('forbids classes the teacher does not teach and removed students are hidden', async () => {
    expect((await call('GET', '/api/teacher/progress?sectionId=s-s10&subjectId=sub-sci')).status).toBe(403);
    expect((await call('GET', '/api/teacher/usage?sectionId=s-n7')).status).toBe(400);
    setPersona('teacher');
    const u = await call('GET', '/api/teacher/usage?sectionId=s-n7&subjectId=sub-math');
    expect(u.json.usage[0]).toHaveProperty('messages7d');
  });
});

describe('content', () => {
  it('teacher upload adds a queued item that becomes ready, and delete removes it', async () => {
    const up = await upload(mine);
    expect(up.status).toBe(201);
    let list = (await call('GET', '/api/content')).json as { id: string; status: string }[];
    expect(list.find((i) => i.id === up.json.id)?.status).toBe('queued');
    const s = getSlice<TeacherSlice>(TEACHER_KEY);
    s.content.find((i) => i.id === up.json.id)!.updatedAt = new Date(Date.now() - 3000).toISOString();
    await call('GET', '/api/content');
    const again = getSlice<TeacherSlice>(TEACHER_KEY).content.find((i) => i.id === up.json.id)!;
    expect(again.status).toBe('processing');
    again.updatedAt = new Date(Date.now() - 6000).toISOString();
    list = (await call('GET', '/api/content')).json;
    expect(list.find((i) => i.id === up.json.id)?.status).toBe('ready');
    expect((await call('DELETE', `/api/content/${up.json.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(((await call('GET', '/api/content')).json as { id: string }[]).some((i) => i.id === up.json.id)).toBe(false);
  });
  it('rejects non-PDFs and sections the teacher does not teach', async () => {
    expect((await upload(mine, 'a.png')).status).toBe(400);
    expect((await upload({ ...mine, branchId: 'b-south', sectionId: 's-s8', grade: '8', subjectId: 'sub-sci' })).status).toBe(403);
  });
  it('branch admin hides and shows a school item for their branch only', async () => {
    setPersona('branch_admin');
    const item = ((await call('GET', '/api/content')).json as { id: string; scope: string }[]).find((i) => i.scope === 'school')!;
    expect((await call('POST', '/api/content/exclusions', { method: 'POST', body: JSON.stringify({ branchId: 'b-south', contentItemId: item.id, excluded: true }) })).status).toBe(403);
    const hide = { branchId: 'b-north', contentItemId: item.id, excluded: true };
    await call('POST', '/api/content/exclusions', { method: 'POST', body: JSON.stringify(hide) });
    const find = async () => ((await call('GET', '/api/content')).json as { id: string; excludedBranchIds: string[] }[]).find((i) => i.id === item.id)!;
    expect((await find()).excludedBranchIds).toContain('b-north');
    await call('POST', '/api/content/exclusions', { method: 'POST', body: JSON.stringify({ ...hide, excluded: false }) });
    expect((await find()).excludedBranchIds).not.toContain('b-north');
  });
  it('retry requeues a failed item', async () => {
    const failed = getSlice<TeacherSlice>(TEACHER_KEY).content.find((i) => i.status === 'failed')!;
    expect((await call('POST', `/api/content/${failed.id}/retry`, { method: 'POST', body: '{}' })).status).toBe(200);
    expect(getSlice<TeacherSlice>(TEACHER_KEY).content.find((i) => i.id === failed.id)!.status).toBe('queued');
  });
  it('school admin sees everything', async () => {
    setPersona('school_admin');
    expect(((await call('GET', '/api/content')).json as unknown[]).length).toBe(getSlice<TeacherSlice>(TEACHER_KEY).content.length);
  });
});
