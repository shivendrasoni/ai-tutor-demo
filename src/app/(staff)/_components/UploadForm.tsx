'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { UploadTargets } from '@/modules/content';
import { AlertCircle, CheckCircle2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

export type UploadMode = 'school_admin' | 'branch_admin' | 'teacher';

type Props = { targets: UploadTargets; mode: UploadMode };

const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];
const MAX_BYTES = 100 * 1024 * 1024;

function errorText(status: number, code: string, details: Record<string, unknown> | undefined, message?: string): string {
  if (details?.reason === 'not_pdf') return 'Only PDF files are accepted.';
  if (details?.reason === 'too_large') return 'That file is too large (max 100 MB).';
  if (status === 403) return 'You are not allowed to upload here.';
  if (code === 'VALIDATION' && message) return message;
  return 'Something went wrong. Please try again.';
}

export default function UploadForm({ targets, mode }: Props) {
  const router = useRouter();
  const uid = useId();
  const isTeacher = mode === 'teacher';
  const scopes = mode === 'school_admin' ? ['school', 'branch', 'section'] : ['branch', 'section'];

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState(isTeacher ? 'material' : 'book');
  const [scope, setScope] = useState(isTeacher ? 'section' : scopes[0]);
  const [branchId, setBranchId] = useState(targets.branches.length === 1 ? targets.branches[0].id : '');
  const [sectionId, setSectionId] = useState('');
  const [grade, setGrade] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);

  const needsBranch = scope !== 'school';
  const needsSection = scope === 'section';

  const sectionOptions = useMemo(
    () =>
      targets.sections.filter(
        (s) => (!branchId || s.branchId === branchId) && (!grade || String(s.grade) === grade),
      ),
    [targets.sections, branchId, grade],
  );
  const subjectOptions = useMemo(() => {
    if (!isTeacher || !sectionId) return targets.subjects;
    const allowed = new Set(targets.assignments.filter((a) => a.sectionId === sectionId).map((a) => a.subjectId));
    return targets.subjects.filter((s) => allowed.has(s.id));
  }, [isTeacher, sectionId, targets.assignments, targets.subjects]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setDone('');
    if (!file) {
      setError('Choose a PDF file.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That file is too large (max 100 MB).');
      return;
    }
    const fd = new FormData();
    fd.set('file', file);
    fd.set('title', title.trim());
    fd.set('kind', kind);
    fd.set('scope', scope);
    fd.set('grade', grade);
    fd.set('subjectId', subjectId);
    if (needsBranch) fd.set('branchId', branchId);
    if (needsSection) fd.set('sectionId', sectionId);

    setBusy(true);
    try {
      const res = await fetch('/api/content', { method: 'POST', body: fd, credentials: 'same-origin' });
      if (res.ok) {
        setDone('Uploaded. Processing will start shortly.');
        setTitle('');
        setFile(null);
        setFileKey((k) => k + 1);
        router.refresh();
        return;
      }
      let err: { code?: string; message?: string; details?: Record<string, unknown> } = {};
      try {
        err = ((await res.json()) as { error?: typeof err }).error ?? {};
      } catch {
        // Non-JSON error body: fall back to the status alone.
      }
      setError(errorText(res.status, err.code ?? 'INTERNAL', err.details, err.message));
    } catch {
      setError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const f = (name: string) => `${uid}-${name}`;

  return (
    <form className="flex flex-col gap-4" onSubmit={submit} aria-label="Upload content">
      <div className="flex flex-col gap-2">
        <Label htmlFor={f('title')}>Title</Label>
        <Input id={f('title')} type="text" maxLength={200} required value={title}
          onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={f('kind')}>Kind</Label>
        <NativeSelect id={f('kind')} value={kind} disabled={isTeacher}
          onChange={(e) => setKind(e.target.value)}>
          <option value="book">Book</option>
          <option value="material">Material</option>
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={f('scope')}>Scope</Label>
        <NativeSelect id={f('scope')} value={scope} disabled={isTeacher}
          onChange={(e) => setScope(e.target.value)}>
          {scopes.map((s) => (
            <option key={s} value={s}>
              {s === 'school' ? 'Whole school' : s === 'branch' ? 'One branch' : 'One section'}
            </option>
          ))}
        </NativeSelect>
      </div>
      {needsBranch && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={f('branch')}>Branch</Label>
          <NativeSelect id={f('branch')} required value={branchId}
            onChange={(e) => { setBranchId(e.target.value); setSectionId(''); }}>
            <option value="" disabled>Select a branch</option>
            {targets.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </NativeSelect>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor={f('grade')}>Grade</Label>
        <NativeSelect id={f('grade')} required value={grade}
          onChange={(e) => { setGrade(e.target.value); setSectionId(''); }}>
          <option value="" disabled>Select a grade</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </NativeSelect>
      </div>
      {needsSection && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={f('section')}>Section</Label>
          <NativeSelect id={f('section')} required value={sectionId}
            onChange={(e) => { setSectionId(e.target.value); setSubjectId(''); }}>
            <option value="" disabled>Select a section</option>
            {sectionOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
          <p className="text-sm text-muted-foreground">Sections are filtered by the branch and grade above.</p>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor={f('subject')}>Subject</Label>
        <NativeSelect id={f('subject')} required value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}>
          <option value="" disabled>Select a subject</option>
          {subjectOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={f('file')}>PDF file</Label>
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-input bg-muted/30 p-6 text-center transition-colors focus-within:border-ring hover:bg-muted/50">
          <UploadCloud className="size-8 text-muted-foreground" aria-hidden="true" />
          <Input key={fileKey} id={f('file')} className="max-w-sm cursor-pointer bg-background" type="file" required
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <p className="text-sm text-muted-foreground">PDF only, up to 100 MB.</p>
        </div>
      </div>
      <div role="alert">
        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{error}
          </p>
        )}
      </div>
      <div role="status">
        {done && (
          <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{done}
          </p>
        )}
      </div>
      <Button type="submit" disabled={busy} className="self-start">
        {busy ? 'Uploading…' : 'Upload'}
      </Button>
    </form>
  );
}
