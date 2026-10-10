'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { UploadTargets } from '@/modules/content';
import styles from '../staff.module.css';

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
    <form className={styles.form} onSubmit={submit} aria-label="Upload content">
      <div className={styles.field}>
        <label className={styles.label} htmlFor={f('title')}>Title</label>
        <input id={f('title')} className={styles.input} type="text" maxLength={200} required value={title}
          onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={f('kind')}>Kind</label>
        <select id={f('kind')} className={styles.input} value={kind} disabled={isTeacher}
          onChange={(e) => setKind(e.target.value)}>
          <option value="book">Book</option>
          <option value="material">Material</option>
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={f('scope')}>Scope</label>
        <select id={f('scope')} className={styles.input} value={scope} disabled={isTeacher}
          onChange={(e) => setScope(e.target.value)}>
          {scopes.map((s) => (
            <option key={s} value={s}>
              {s === 'school' ? 'Whole school' : s === 'branch' ? 'One branch' : 'One section'}
            </option>
          ))}
        </select>
      </div>
      {needsBranch && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={f('branch')}>Branch</label>
          <select id={f('branch')} className={styles.input} required value={branchId}
            onChange={(e) => { setBranchId(e.target.value); setSectionId(''); }}>
            <option value="" disabled>Select a branch</option>
            {targets.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
      )}
      <div className={styles.field}>
        <label className={styles.label} htmlFor={f('grade')}>Grade</label>
        <select id={f('grade')} className={styles.input} required value={grade}
          onChange={(e) => { setGrade(e.target.value); setSectionId(''); }}>
          <option value="" disabled>Select a grade</option>
          {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      {needsSection && (
        <div className={styles.field}>
          <label className={styles.label} htmlFor={f('section')}>Section</label>
          <select id={f('section')} className={styles.input} required value={sectionId}
            onChange={(e) => { setSectionId(e.target.value); setSubjectId(''); }}>
            <option value="" disabled>Select a section</option>
            {sectionOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <p className={styles.hint}>Sections are filtered by the branch and grade above.</p>
        </div>
      )}
      <div className={styles.field}>
        <label className={styles.label} htmlFor={f('subject')}>Subject</label>
        <select id={f('subject')} className={styles.input} required value={subjectId}
          onChange={(e) => setSubjectId(e.target.value)}>
          <option value="" disabled>Select a subject</option>
          {subjectOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={f('file')}>PDF file</label>
        <input key={fileKey} id={f('file')} className={styles.input} type="file" required
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <p className={styles.hint}>PDF only, up to 100 MB.</p>
      </div>
      <div role="alert">{error && <p className={styles.error}>{error}</p>}</div>
      <div role="status">{done && <p className={styles.success}>{done}</p>}</div>
      <button className={styles.button} type="submit" disabled={busy}>
        {busy ? 'Uploading…' : 'Upload'}
      </button>
    </form>
  );
}
