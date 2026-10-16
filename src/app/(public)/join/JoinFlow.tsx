'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch, genericMessage } from '../_lib/api';
import { PasswordField, TextField, UsernameField } from '../_lib/fields';
import PlanPicker, { SUCCESS_COPY, type PlanOption } from '../_lib/PlanPicker';
import { codeCopy, submitError } from '../_lib/submit-error';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

const SELECT_CLASS =
  'border-input bg-transparent focus-visible:border-ring focus-visible:ring-ring/50 h-10 w-full rounded-md border px-3 text-base shadow-xs outline-none transition-[color,box-shadow] focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 md:text-sm';

type Section = { id: string; grade: number; name: string };
type Branch = { schoolName: string; branchName: string; sections: Section[] };

const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];

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
      setError(codeCopy(b.error.code) ?? genericMessage(b.error));
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
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-tight">Join your school</h1>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p role="status" className="rounded-lg border border-success/30 bg-success/15 px-4 py-3 text-sm text-success">{SUCCESS_COPY}</p>
          <Button asChild size="lg" className="w-full">
            <Link href="/status">View my account status</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link href="/login">Go to log in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (step === 'code' || !branch) {
    return (
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-tight">Join your school</h1>
          <CardDescription>Enter the signup code your school gave you.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <form className="grid gap-5" onSubmit={lookup}>
            {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <TextField label="Signup code" value={code} onChange={setCode} autoComplete="off" required maxLength={64} />
            <Button type="submit" size="lg" className="w-full" disabled={busy}>{busy ? 'Checking…' : 'Continue'}</Button>
          </form>
          <p className="text-center"><Link href="/login" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Already have an account? Log in</Link></p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold leading-tight">Join your school</h1>
        <CardDescription>{`Joining ${branch.schoolName} — ${branch.branchName}`}</CardDescription>
      </CardHeader>
      <CardContent>
      <form className="grid gap-5" onSubmit={submit}>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="join-grade">Grade</Label>
          <select
            id="join-grade"
            className={SELECT_CLASS}
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
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="join-section">Section (optional)</Label>
          <select id="join-section" className={SELECT_CLASS} value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={gradeSections.length === 0}>
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
        <Button type="submit" size="lg" className="w-full" disabled={busy || planId === ''}>{busy ? 'Creating…' : 'Create account'}</Button>
      </form>
      </CardContent>
    </Card>
  );
}
