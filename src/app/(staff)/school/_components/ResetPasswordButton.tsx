'use client';
import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
      <Button type="button" variant="outline" size="sm" onClick={() => { setOpen((o) => !o); setDone(false); }} aria-expanded={open}>
        <KeyRound className="size-4" />Reset password
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-2 flex min-w-64 flex-col gap-2 rounded-lg border bg-muted/40 p-3">
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            <span>New password for {name}</span>
            <Input name="password" type="password" required minLength={8} maxLength={128} autoComplete="new-password" />
          </label>
          <Button type="submit" size="sm" disabled={busy}>{busy ? 'Saving…' : 'Set password'}</Button>
        </form>
      ) : null}
      {done ? <span role="status" className="text-sm text-success"> Password updated. Share it with the student; they are signed out everywhere.</span> : null}
      {error ? <span role="alert" className="text-sm text-destructive"> {error}</span> : null}
    </>
  );
}
