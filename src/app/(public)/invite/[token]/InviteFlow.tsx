'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../_lib/api';
import { PasswordField, UsernameField } from '../../_lib/fields';
import PlanPicker, { SUCCESS_COPY, type PlanOption } from '../../_lib/PlanPicker';
import { submitError } from '../../_lib/submit-error';
import { inviteLoadState, INVITE_UNAVAILABLE, type InviteInfo, type InviteLoadState } from './state';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';

export default function InviteFlow({ token }: { token: string }) {
  const [load, setLoad] = useState<InviteLoadState | null>(null);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [planId, setPlanId] = useState('');
  const [username, setUsername] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoad(null);
      const [inv, pl] = await Promise.all([
        apiFetch<InviteInfo>(`/api/invite/${encodeURIComponent(token)}`),
        apiFetch<{ plans: PlanOption[] }>('/api/plans'),
      ]);
      if (!live) return;
      if (pl.ok) setPlans(pl.data.plans);
      setLoad(inviteLoadState(inv));
    })();
    return () => {
      live = false;
    };
  }, [token, attempt]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await apiFetch(`/api/invite/${encodeURIComponent(token)}`, { method: 'POST', body: { planId, username, password } });
    setBusy(false);
    if (r.ok) {
      setDone(true);
      return;
    }
    if (r.error.status === 410 || r.error.code === 'INVITE_INVALID') {
      setLoad({ kind: 'invalid' });
      return;
    }
    const f = submitError(r.error);
    setError(f.message);
    if (f.suggestions.length > 0) setSuggestions(f.suggestions);
  }

  if (load === null) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>;
  if (load.kind === 'invalid') {
    return (
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-tight">{INVITE_UNAVAILABLE.title}</h1>
        </CardHeader>
        <CardContent>
          <p className="rounded-lg bg-muted px-4 py-3 text-sm">{INVITE_UNAVAILABLE.copy}</p>
        </CardContent>
      </Card>
    );
  }
  if (load.kind === 'error') {
    return (
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-tight">Set up your account</h1>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Alert variant="destructive"><AlertDescription>{load.message}</AlertDescription></Alert>
          <Button type="button" size="lg" className="w-full" onClick={() => setAttempt((n) => n + 1)}>Try again</Button>
        </CardContent>
      </Card>
    );
  }
  if (done) {
    return (
      <Card>
        <CardHeader>
          <h1 className="text-2xl font-semibold leading-tight">You're all set</h1>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p role="status" className="rounded-lg border border-success/30 bg-success/15 px-4 py-3 text-sm text-success">{SUCCESS_COPY}</p>
          <Button asChild size="lg" className="w-full">
            <Link href="/login">Go to log in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  const { invite } = load;
  return (
    <Card>
      <CardHeader>
        <h1 className="text-2xl font-semibold leading-tight">{`Set up ${invite.studentName}'s account at ${invite.schoolName}`}</h1>
        <CardDescription>{`${invite.branchName} · Grade ${invite.grade}`}</CardDescription>
      </CardHeader>
      <CardContent>
      <form className="grid gap-5" onSubmit={submit}>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        <PlanPicker plans={plans} value={planId} onChange={setPlanId} />
        <UsernameField value={username} onChange={setUsername} suggestions={suggestions} onSuggestions={setSuggestions} />
        <PasswordField value={password} onChange={setPassword} />
        <Button type="submit" size="lg" className="w-full" disabled={busy || planId === ''}>{busy ? 'Creating…' : 'Create account'}</Button>
      </form>
      </CardContent>
    </Card>
  );
}
