'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Card, Field } from '@/app/ui/components';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
      <form onSubmit={submit} className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Name"><Input name="name" required maxLength={200} /></Field>
        <Field label="Board"><Input name="board" required maxLength={50} placeholder="CBSE" /></Field>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Create school</Button></div>
        <div className="sm:col-span-2">{error ? <Alert variant="destructive" className="mt-4"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}</div>
      </form>
    </Card>
  );
}
