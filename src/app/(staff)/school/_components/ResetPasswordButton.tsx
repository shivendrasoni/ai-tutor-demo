'use client';
import { useState, type FormEvent } from 'react';

/** Admin-initiated password reset: the admin types a new password and passes it on to the family. */
export default function ResetPasswordButton({ studentId, name }: { studentId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const password = String(new FormData(form).get('password') ?? '');
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/school/students/${studentId}/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not reset the password');
        return;
      }
      form.reset();
      setDone(true);
      setOpen(false);
    } catch {
      setError('Could not reset the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen((o) => !o); setDone(false); }} aria-expanded={open}>Reset password</button>
      {open ? (
        <form onSubmit={submit}>
          <label>
            New password for {name}{' '}
            <input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
          </label>{' '}
          <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
        </form>
      ) : null}
      {done ? <span role="status"> Password updated. Share it with the student; they are signed out everywhere.</span> : null}
      {error ? <span role="alert"> {error}</span> : null}
    </>
  );
}
