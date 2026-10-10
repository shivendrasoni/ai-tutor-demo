'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../_lib/api';
import { PasswordField, UsernameField } from '../../_lib/fields';
import PlanPicker, { SUCCESS_COPY, type PlanOption } from '../../_lib/PlanPicker';
import { submitError } from '../../_lib/submit-error';
import { inviteLoadState, INVITE_UNAVAILABLE, type InviteInfo, type InviteLoadState } from './state';
import styles from '../../public.module.css';

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

  if (load === null) return <p className={styles.sub}>Loading…</p>;
  if (load.kind === 'invalid') {
    return (
      <>
        <h1 className={styles.title}>{INVITE_UNAVAILABLE.title}</h1>
        <p className={styles.notice}>{INVITE_UNAVAILABLE.copy}</p>
      </>
    );
  }
  if (load.kind === 'error') {
    return (
      <>
        <h1 className={styles.title}>Set up your account</h1>
        <p role="alert" className={styles.error}>{load.message}</p>
        <button type="button" className={styles.button} onClick={() => setAttempt((n) => n + 1)}>Try again</button>
      </>
    );
  }
  if (done) {
    return (
      <>
        <h1 className={styles.title}>You're all set</h1>
        <p role="status" className={styles.success}>{SUCCESS_COPY}</p>
        <Link href="/login" className={styles.link}>Go to log in</Link>
      </>
    );
  }

  const { invite } = load;
  return (
    <>
      <h1 className={styles.title}>{`Set up ${invite.studentName}'s account at ${invite.schoolName}`}</h1>
      <p className={styles.sub}>{`${invite.branchName} · Grade ${invite.grade}`}</p>
      <form className={styles.form} onSubmit={submit}>
        {error ? <p role="alert" className={styles.error}>{error}</p> : null}
        <PlanPicker plans={plans} value={planId} onChange={setPlanId} />
        <UsernameField value={username} onChange={setUsername} suggestions={suggestions} onSuggestions={setSuggestions} />
        <PasswordField value={password} onChange={setPassword} />
        <button type="submit" className={styles.button} disabled={busy || planId === ''}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
    </>
  );
}
