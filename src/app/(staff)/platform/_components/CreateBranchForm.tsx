'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Card, Field } from '@/app/ui/components';
import { postJson } from './api';

export default function CreateBranchForm({ schools }: { schools: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (schools.length === 0) return <Card title="Create a branch"><p>Create a school before adding branches.</p></Card>;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setBusy(true);
    setError(null);
    const msg = await postJson(`/api/platform/schools/${encodeURIComponent(String(fd.get('schoolId')))}/branches`, { name: String(fd.get('name') ?? '').trim() });
    setBusy(false);
    if (msg) setError(msg);
    else { form.reset(); router.refresh(); }
  }
  return (
    <Card title="Create a branch">
      <form onSubmit={submit}>
        <Field label="School">
          <select name="schoolId" defaultValue={schools[0].id}>
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Branch name"><input name="name" required maxLength={200} /></Field>
        <button type="submit" disabled={busy}>Create branch</button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </Card>
  );
}
