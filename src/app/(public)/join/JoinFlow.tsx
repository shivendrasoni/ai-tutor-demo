'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch, genericMessage } from '../_lib/api';
import { PasswordField, TextField, UsernameField } from '../_lib/fields';
import PlanPicker, { SUCCESS_COPY, type PlanOption } from '../_lib/PlanPicker';
import { submitError } from '../_lib/submit-error';
import styles from '../public.module.css';

type Section = { id: string; grade: number; name: string };
type Branch = { schoolName: string; branchName: string; sections: Section[] };

const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];

function codeError(code: string, fallback: string): string {
  if (code === 'INVALID_CODE') return "That signup code isn't valid. Check it and try again.";
  if (code === 'CODE_DISABLED') return 'Signups with this code are turned off. Ask your school.';
  return fallback;
}

export default function JoinFlow() {
  const [step, setStep] = useState<'code' | 'form' | 'done'>('code');
  const [code, setCode] = useState('');
  const [branch, setBranch] = useState<Branch | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [grade, setGrade] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [studentName, setStudentName] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [planId, setPlanId] = useState('');
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [password, setPassword] = useState('');

  const gradeSections = useMemo(
    () => (branch && grade ? branch.sections.filter((s) => s.grade === Number(grade)) : []),
    [branch, grade],
  );

  async function lookup(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const trimmed = code.trim();
    const [b, p] = await Promise.all([
      apiFetch<Branch>(`/api/join/code/${encodeURIComponent(trimmed)}`),
      apiFetch<{ plans: PlanOption[] }>('/api/plans'),
    ]);
    setBusy(false);
    if (!b.ok) {
      setError(codeError(b.error.code, genericMessage(b.error)));
      return;
    }
    if (!p.ok) {
      setError(genericMessage(p.error));
      return;
    }
    setBranch(b.data);
    setPlans(p.data.plans);
    setStep('form');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await apiFetch('/api/join', {
      method: 'POST',
      body: {
        code: code.trim(),
        grade: Number(grade),
        ...(sectionId ? { sectionId } : {}),
        studentName,
        parentName,
        parentPhone,
        ...(parentEmail.trim() ? { parentEmail: parentEmail.trim() } : {}),
        planId,
        username,
        password,
      },
    });
    setBusy(false);
    if (r.ok) {
      setStep('done');
      return;
    }
    const f = submitError(r.error);
    setError(f.message);
    if (f.suggestions.length > 0) setSuggestions(f.suggestions);
  }

  if (step === 'done') {
    return (
      <>
        <h1 className={styles.title}>Join your school</h1>
        <p role="status" className={styles.success}>{SUCCESS_COPY}</p>
        <Link href="/login" className={styles.link}>Go to log in</Link>
      </>
    );
  }

  if (step === 'code' || !branch) {
    return (
      <>
        <h1 className={styles.title}>Join your school</h1>
        <p className={styles.sub}>Enter the signup code your school gave you.</p>
        <form className={styles.form} onSubmit={lookup}>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          <TextField label="Signup code" value={code} onChange={setCode} autoComplete="off" required maxLength={64} />
          <button type="submit" className={styles.button} disabled={busy}>{busy ? 'Checking…' : 'Continue'}</button>
        </form>
        <p><Link href="/login" className={styles.link}>Already have an account? Log in</Link></p>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.title}>Join your school</h1>
      <p className={styles.sub}>{`Joining ${branch.schoolName} — ${branch.branchName}`}</p>
      <form className={styles.form} onSubmit={submit}>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <div className={styles.field}>
          <label htmlFor="join-grade" className={styles.label}>Grade</label>
          <select
            id="join-grade"
            value={grade}
            required
            onChange={(e) => {
              setGrade(e.target.value);
              setSectionId('');
            }}
          >
            <option value="">Select grade</option>
            {GRADES.map((g) => <option key={g} value={String(g)}>{g}</option>)}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor="join-section" className={styles.label}>Section (optional)</label>
          <select id="join-section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={gradeSections.length === 0}>
            <option value="">Not sure / none</option>
            {gradeSections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <TextField label="Student name" value={studentName} onChange={setStudentName} autoComplete="off" required maxLength={200} />
        <TextField label="Parent name" value={parentName} onChange={setParentName} autoComplete="off" required maxLength={200} />
        <TextField label="Parent phone" type="tel" value={parentPhone} onChange={setParentPhone} autoComplete="tel" required maxLength={32} />
        <TextField label="Parent email (optional)" type="email" value={parentEmail} onChange={setParentEmail} autoComplete="email" maxLength={254} />
        <PlanPicker plans={plans} value={planId} onChange={setPlanId} />
        <UsernameField value={username} onChange={setUsername} suggestions={suggestions} onSuggestions={setSuggestions} />
        <PasswordField value={password} onChange={setPassword} />
        <button type="submit" className={styles.button} disabled={busy || planId === ''}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
    </>
  );
}
