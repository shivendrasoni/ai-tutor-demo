'use client';

import { useId, useMemo, useState, type FormEvent } from 'react';
import styles from '../public.module.css';
import {
  apiFetch, credentialError, GENERIC_ERROR, NETWORK_ERROR, SIGNUP_SUCCESS, suggestionsOf, type ApiError,
} from '../_lib/api';
import { ErrorRegion, PasswordField, PlanPicker, TextField, UsernameField, usePlans } from '../_lib/fields';

type Section = { id: string; grade: number; name: string };
type Branch = { code: string; schoolName: string; branchName: string; sections: Section[] };

const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];
const INVALID_CODE = "That code wasn't recognised. Check it and try again.";
const CODE_DISABLED = 'Signups for this branch are currently closed. Please contact your school.';

function codeError(e: ApiError): string {
  if (e.code === 'INVALID_CODE') return INVALID_CODE;
  if (e.code === 'CODE_DISABLED') return CODE_DISABLED;
  if (e.code === 'NETWORK') return NETWORK_ERROR;
  return GENERIC_ERROR;
}

export default function JoinFlow() {
  const [branch, setBranch] = useState<Branch | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <>
        <h1 className={styles.title}>You&apos;re all set</h1>
        <p className={styles.success} role="status">{SIGNUP_SUCCESS}</p>
      </>
    );
  }
  if (!branch) return <CodeStep onFound={setBranch} />;
  return <DetailsStep branch={branch} onBack={() => setBranch(null)} onDone={() => setDone(true)} />;
}

function CodeStep({ onFound }: { onFound: (b: Branch) => void }) {
  const id = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const c = code.trim();
    if (!c) {
      setError(INVALID_CODE);
      return;
    }
    setBusy(true);
    setError('');
    const r = await apiFetch<Omit<Branch, 'code'>>(`/api/join/code/${encodeURIComponent(c)}`);
    setBusy(false);
    if (r.ok) onFound({ code: c, ...r.data });
    else setError(codeError(r.error));
  }

  return (
    <>
      <h1 className={styles.title}>Join your school</h1>
      <p className={styles.lead}>Enter the signup code your school gave you.</p>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={id}>Signup code</label>
          <input
            id={id}
            className={styles.input}
            name="code"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={32}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <ErrorRegion message={error} />
        <button className={styles.button} type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>
    </>
  );
}

function DetailsStep({ branch, onBack, onDone }: { branch: Branch; onBack: () => void; onDone: () => void }) {
  const gradeId = useId();
  const sectionId = useId();
  const { plans, error: plansError } = usePlans();

  const [grade, setGrade] = useState('');
  const [section, setSection] = useState('');
  const [studentName, setStudentName] = useState('');
  const [parentName, setParentName] = useState('');
  const [parentPhone, setParentPhone] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [planId, setPlanId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const gradeSections = useMemo(
    () => branch.sections.filter((s) => String(s.grade) === grade),
    [branch.sections, grade],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await apiFetch('/api/join', {
      method: 'POST',
      body: {
        code: branch.code,
        grade: Number(grade),
        ...(section ? { sectionId: section } : {}),
        studentName: studentName.trim(),
        parentName: parentName.trim(),
        parentPhone: parentPhone.trim(),
        ...(parentEmail.trim() ? { parentEmail: parentEmail.trim() } : {}),
        planId,
        username: username.trim(),
        password,
      },
    });
    setBusy(false);
    if (r.ok) {
      setPassword('');
      onDone();
      return;
    }
    if (r.error.code === 'INVALID_CODE' || r.error.code === 'CODE_DISABLED') setError(codeError(r.error));
    else setError(credentialError(r.error));
    if (r.error.code === 'USERNAME_TAKEN') setSuggestions(suggestionsOf(r.error));
  }

  return (
    <>
      <h1 className={styles.title}>Create your account</h1>
      <p className={styles.lead}>
        Joining {branch.schoolName} — {branch.branchName}
      </p>
      <button type="button" className={styles.linkButton} onClick={onBack}>Use a different code</button>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={gradeId}>Grade</label>
          <select
            id={gradeId}
            className={styles.select}
            name="grade"
            required
            value={grade}
            onChange={(e) => {
              setGrade(e.target.value);
              setSection('');
            }}
          >
            <option value="" disabled>Select a grade</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>Grade {g}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={sectionId}>Section (optional)</label>
          <select
            id={sectionId}
            className={styles.select}
            name="section"
            value={section}
            disabled={!grade || gradeSections.length === 0}
            onChange={(e) => setSection(e.target.value)}
          >
            <option value="">{grade && gradeSections.length === 0 ? 'No sections for this grade' : 'Not sure / skip'}</option>
            {gradeSections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <TextField label="Student name" value={studentName} onChange={setStudentName} name="studentName" autoComplete="off" maxLength={200} />
        <TextField label="Parent name" value={parentName} onChange={setParentName} name="parentName" autoComplete="name" maxLength={200} />
        <TextField
          label="Parent phone" value={parentPhone} onChange={setParentPhone} name="parentPhone"
          type="tel" inputMode="tel" autoComplete="tel" maxLength={32}
        />
        <TextField
          label="Parent email (optional)" value={parentEmail} onChange={setParentEmail} name="parentEmail" required={false}
          type="email" inputMode="email" autoComplete="email" maxLength={254}
        />

        <PlanPicker plans={plans} error={plansError} value={planId} onChange={setPlanId} />

        <UsernameField value={username} onChange={setUsername} suggestions={suggestions} onSuggestions={setSuggestions} />
        <PasswordField value={password} onChange={setPassword} autoComplete="new-password" />

        <ErrorRegion message={error} />
        <button className={styles.button} type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </>
  );
}
