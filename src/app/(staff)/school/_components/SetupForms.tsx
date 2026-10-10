'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Field } from '@/app/ui/components';
import type { BranchListing } from '@/modules/analytics';
import type { SetupProps } from './SetupSection';

const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];

/** One JSON POST form: shows the server's error message, or `done` after success, and refreshes the page data. */
function SetupForm({
  title, url, build, done, submitLabel, children,
}: {
  title: string;
  url: string;
  build: (fd: FormData) => unknown;
  done: string;
  submitLabel: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError(null);
    setOk(false);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(build(new FormData(form))),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not save');
        return;
      }
      form.reset();
      setOk(true);
      router.refresh();
    } catch {
      setError('Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={title}>
      <h3>{title}</h3>
      {children}
      <button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
      {ok ? <p role="status">{done}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const branchOptions = (branches: BranchListing[]) =>
  branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>);

export function AddSectionForm({ branches }: { branches: BranchListing[] }) {
  return (
    <SetupForm
      title="Add a section" url="/api/school/sections" submitLabel="Add section" done="Section added."
      build={(fd) => ({ branchId: str(fd, 'branchId'), grade: Number(str(fd, 'grade')), name: str(fd, 'name') })}
    >
      {branches.length > 1 ? (
        <Field label="Branch"><select name="branchId">{branchOptions(branches)}</select></Field>
      ) : (
        <input type="hidden" name="branchId" value={branches[0]?.branchId ?? ''} />
      )}
      <Field label="Grade">
        <select name="grade" defaultValue="8">{GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</select>
      </Field>
      <Field label="Section name"><input name="name" required maxLength={50} placeholder="8-A" /></Field>
    </SetupForm>
  );
}

export function AddSubjectForm() {
  return (
    <SetupForm
      title="Add a subject" url="/api/school/subjects" submitLabel="Add subject" done="Subject added."
      build={(fd) => ({ name: str(fd, 'name') })}
    >
      <Field label="Subject name"><input name="name" required maxLength={100} /></Field>
    </SetupForm>
  );
}

export function AddTeacherForm({ branches }: { branches: BranchListing[] }) {
  return (
    <SetupForm
      title="Create a teacher account" url="/api/school/teachers" submitLabel="Create teacher"
      done="Teacher account created. Share the username and the password you set with them."
      build={(fd) => ({
        branchId: str(fd, 'branchId'), name: str(fd, 'teacherName'), username: str(fd, 'username'),
        password: String(fd.get('password') ?? ''),
      })}
    >
      {branches.length > 1 ? (
        <Field label="Teacher branch"><select name="branchId">{branchOptions(branches)}</select></Field>
      ) : (
        <input type="hidden" name="branchId" value={branches[0]?.branchId ?? ''} />
      )}
      <Field label="Teacher name"><input name="teacherName" required maxLength={200} /></Field>
      <Field label="Teacher username"><input name="username" required maxLength={64} autoComplete="off" /></Field>
      <Field label="Teacher password">
        <input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
      </Field>
    </SetupForm>
  );
}

export function AssignTeacherForm({ branches, subjects, teachers }: Pick<SetupProps, 'branches' | 'subjects' | 'teachers'>) {
  const [teacherId, setTeacherId] = useState(teachers[0]?.userId ?? '');
  if (teachers.length === 0 || subjects.length === 0) {
    return (
      <div>
        <h3>Assign a teacher</h3>
        <p>{teachers.length === 0 ? 'Create a teacher account first.' : 'Add a subject first.'}</p>
      </div>
    );
  }
  // The service only accepts sections of the teacher's own branch, so only offer those.
  const branchId = teachers.find((t) => t.userId === teacherId)?.branchId;
  const sections = branches.find((b) => b.branchId === branchId)?.sections ?? [];
  return (
    <SetupForm
      title="Assign a teacher" url="/api/school/assignments" submitLabel="Assign" done="Teacher assigned."
      build={(fd) => ({ teacherId: str(fd, 'teacherId'), sectionId: str(fd, 'sectionId'), subjectId: str(fd, 'subjectId') })}
    >
      <Field label="Teacher">
        <select name="teacherId" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          {teachers.map((t) => (
            <option key={t.userId} value={t.userId}>{t.name} ({t.username}, {t.branchName})</option>
          ))}
        </select>
      </Field>
      <Field label="Section">
        <select name="sectionId" required>
          {sections.length === 0 ? <option value="">No sections in this branch</option> : null}
          {sections.map((s) => <option key={s.id} value={s.id}>{s.grade} {s.name}</option>)}
        </select>
      </Field>
      <Field label="Subject">
        <select name="subjectId">{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      </Field>
    </SetupForm>
  );
}
