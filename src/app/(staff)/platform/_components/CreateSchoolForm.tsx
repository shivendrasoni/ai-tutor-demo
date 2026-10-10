'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Card, Field } from '@/app/ui/components';
import { postJson } from './api';

export default function CreateSchoolForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setError(null);
    const msg = await postJson('/api/platform/schools', { name: String(fd.get('name') ?? '').trim(), board: String(fd.get('board') ?? '').trim() });
    setBusy(false);
    if (msg) setError(msg);
    else { form.reset(); router.refresh(); }
  }
  return (
    <Card title="Create a school">
      <form onSubmit={submit}>
        <Field label="Name"><input name="name" required maxLength={200} /></Field>
        <Field label="Board"><input name="board" required maxLength={50} placeholder="CBSE" /></Field>
        <button type="submit" disabled={busy}>Create school</button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </Card>
  );
}
