'use client';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Field } from '@/app/ui/components';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { BranchListing } from '@/modules/analytics';
import type { SetupProps } from './SetupSection';

const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];

export type SetupError = { message: string; suggestions: string[] };

/** Reads the API error envelope: the message plus any username suggestions (USERNAME_TAKEN details). */
export function parseSetupError(body: unknown): SetupError {
  const e = (body as { error?: { message?: unknown; details?: { suggestions?: unknown } } } | null)?.error;
  const s = e?.details?.suggestions;
  return {
    message: typeof e?.message === 'string' && e.message ? e.message : 'Could not save',
    suggestions: Array.isArray(s) ? s.filter((x): x is string => typeof x === 'string') : [],
  };
}

export function SetupFormError({ error, onPick }: { error: SetupError; onPick: (suggestion: string) => void }) {
  return (
    <div role="alert" className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      <p>{error.message}</p>
      {error.suggestions.length > 0 ? (
        <>
          <p>Try one of these:</p>
          <p className="flex flex-wrap gap-2">
            {error.suggestions.map((s) => (
              <Button key={s} type="button" variant="outline" size="sm" onClick={() => onPick(s)}>{s}</Button>
            ))}
          </p>
        </>
      ) : null}
    </div>
  );
}

/** One JSON POST form: shows the server's error message, or `done` after success, and refreshes the page data. */
function SetupForm({
  title, url, build, done, submitLabel, suggestionField, children,
}: {
  title: string;
  url: string;
  build: (fd: FormData) => unknown;
  done: string;
  submitLabel: string;
  /** Name of the input that username suggestions fill. */
  suggestionField?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SetupError | null>(null);
  const [ok, setOk] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

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
        setError(parseSetupError(body));
        return;
      }
      form.reset();
      setOk(true);
      router.refresh();
    } catch {
      setError({ message: 'Could not save', suggestions: [] });
    } finally {
      setBusy(false);
    }
  }

  function pick(suggestion: string) {
    const input = suggestionField ? formRef.current?.elements.namedItem(suggestionField) : null;
    if (input instanceof HTMLInputElement) input.value = suggestion;
    setError(null);
  }

  return (
    <form ref={formRef} onSubmit={submit} aria-label={title} onChange={() => setOk(false)}
      className="rounded-xl border bg-muted/20 p-4">
      <h3 className="mb-3 font-semibold">{title}</h3>
      {children}
      <Button type="submit" disabled={busy}>{busy ? 'Saving…' : submitLabel}</Button>
      {ok ? <p role="status" className="mt-3 text-sm text-success">{done}</p> : null}
      {error ? <div className="mt-3"><SetupFormError error={error} onPick={pick} /></div> : null}
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
        <Field label="Branch"><NativeSelect name="branchId">{branchOptions(branches)}</NativeSelect></Field>
      ) : (
        <input type="hidden" name="branchId" value={branches[0]?.branchId ?? ''} />
      )}
      <Field label="Grade">
        <NativeSelect name="grade" defaultValue="8">{GRADES.map((g) => <option key={g} value={g}>{g}</option>)}</NativeSelect>
      </Field>
      <Field label="Section name"><Input name="name" required maxLength={50} placeholder="8-A" /></Field>
    </SetupForm>
  );
}

export function AddSubjectForm() {
  return (
    <SetupForm
      title="Add a subject" url="/api/school/subjects" submitLabel="Add subject" done="Subject added."
      build={(fd) => ({ name: str(fd, 'name') })}
    >
      <Field label="Subject name"><Input name="name" required maxLength={100} /></Field>
    </SetupForm>
  );
}

export function AddTeacherForm({ branches }: { branches: BranchListing[] }) {
  return (
    <SetupForm
      title="Create a teacher account" url="/api/school/teachers" submitLabel="Create teacher" suggestionField="username"
      done="Teacher account created. Share the username and the password you set with them."
      build={(fd) => ({
        branchId: str(fd, 'branchId'), name: str(fd, 'teacherName'), username: str(fd, 'username'),
        password: String(fd.get('password') ?? ''),
      })}
    >
      {branches.length > 1 ? (
        <Field label="Teacher branch"><NativeSelect name="branchId">{branchOptions(branches)}</NativeSelect></Field>
      ) : (
        <input type="hidden" name="branchId" value={branches[0]?.branchId ?? ''} />
      )}
      <Field label="Teacher name"><Input name="teacherName" required maxLength={200} /></Field>
      <Field label="Teacher username"><Input name="username" required maxLength={64} autoComplete="off" /></Field>
      <Field label="Teacher password">
        <Input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
      </Field>
    </SetupForm>
  );
}

export function AssignTeacherForm({ branches, subjects, teachers }: Pick<SetupProps, 'branches' | 'subjects' | 'teachers'>) {
  const [teacherId, setTeacherId] = useState(teachers[0]?.userId ?? '');
  if (teachers.length === 0 || subjects.length === 0) {
    return (
      <div className="rounded-xl border bg-muted/20 p-4">
        <h3 className="mb-3 font-semibold">Assign a teacher</h3>
        <p className="text-sm text-muted-foreground">{teachers.length === 0 ? 'Create a teacher account first.' : 'Add a subject first.'}</p>
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
        <NativeSelect name="teacherId" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          {teachers.map((t) => (
            <option key={t.userId} value={t.userId}>{t.name} ({t.username}, {t.branchName})</option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="Section">
        <NativeSelect name="sectionId" required>
          {sections.length === 0 ? <option value="">No sections in this branch</option> : null}
          {sections.map((s) => <option key={s.id} value={s.id}>{s.grade} {s.name}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Subject">
        <NativeSelect name="subjectId">{subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</NativeSelect>
      </Field>
    </SetupForm>
  );
}
