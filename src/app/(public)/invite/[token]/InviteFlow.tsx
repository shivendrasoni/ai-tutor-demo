'use client';

import { useEffect, useState, type FormEvent } from 'react';
import styles from '../../public.module.css';
import { apiFetch, credentialError, GENERIC_ERROR, NETWORK_ERROR, SIGNUP_SUCCESS, suggestionsOf } from '../../_lib/api';
import { ErrorRegion, PasswordField, PlanPicker, UsernameField, usePlans } from '../../_lib/fields';

type Invite = { studentName: string; schoolName: string; branchName: string; grade: number };
type Load = { kind: 'loading' } | { kind: 'invalid' } | { kind: 'error'; message: string } | { kind: 'ready'; invite: Invite };

const EXPIRED = 'This invite link has expired or was already used. Ask your school for a new one.';
const isInvalid = (status: number) => status === 404 || status === 410;

export default function InviteFlow({ token }: { token: string }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [done, setDone] = useState(false);

  useEffect(() => {
    let live = true;
    void apiFetch<Invite>(`/api/invite/${encodeURIComponent(token)}`).then((r) => {
      if (!live) return;
      if (r.ok) setLoad({ kind: 'ready', invite: r.data });
      else if (isInvalid(r.error.status)) setLoad({ kind: 'invalid' });
      else setLoad({ kind: 'error', message: r.error.code === 'NETWORK' ? NETWORK_ERROR : GENERIC_ERROR });
    });
    return () => {
      live = false;
    };
  }, [token]);

  if (done) {
    return (
      <>
        <h1 className={styles.title}>You&apos;re all set</h1>
        <p className={styles.success} role="status">{SIGNUP_SUCCESS}</p>
      </>
    );
  }
  if (load.kind === 'loading') return <p className={styles.hint} role="status">Loading your invite…</p>;
  if (load.kind === 'invalid') {
    return (
      <>
        <h1 className={styles.title}>Invite unavailable</h1>
        <p className={styles.error} role="alert">{EXPIRED}</p>
      </>
    );
  }
  if (load.kind === 'error') return <p className={styles.error} role="alert">{load.message}</p>;
  return <InviteForm token={token} invite={load.invite} onInvalid={() => setLoad({ kind: 'invalid' })} onDone={() => setDone(true)} />;
}

function InviteForm({
  token, invite, onInvalid, onDone,
}: { token: string; invite: Invite; onInvalid: () => void; onDone: () => void }) {
  const { plans, error: plansError } = usePlans();
  const [planId, setPlanId] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const r = await apiFetch(`/api/invite/${encodeURIComponent(token)}`, {
      method: 'POST',
      body: { planId, username: username.trim(), password },
    });
    setBusy(false);
    if (r.ok) {
      setPassword('');
      onDone();
      return;
    }
    if (r.error.code === 'INVITE_INVALID' || r.error.status === 404) {
      onInvalid();
      return;
    }
    setError(credentialError(r.error));
    if (r.error.code === 'USERNAME_TAKEN') setSuggestions(suggestionsOf(r.error));
  }

  return (
    <>
      <h1 className={styles.title}>
        Set up {invite.studentName}&apos;s account at {invite.schoolName}
      </h1>
      <p className={styles.lead}>
        {invite.branchName} · Grade {invite.grade}
      </p>
      <form className={styles.form} onSubmit={submit}>
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
