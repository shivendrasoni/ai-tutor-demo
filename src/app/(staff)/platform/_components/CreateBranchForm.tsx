'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Card, Field } from '@/app/ui/components';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { postJson } from './api';

export default function CreateBranchForm({ schools }: { schools: { id: string; name: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (schools.length === 0) return <Card title="Create a branch"><p className="text-sm text-muted-foreground">Create a school before adding branches.</p></Card>;
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
      <form onSubmit={submit} className="grid gap-x-4 sm:grid-cols-2">
        <Field label="School">
          <select name="schoolId" defaultValue={schools[0].id} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30">
            {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Branch name"><Input name="name" required maxLength={200} /></Field>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Create branch</Button></div>
        <div className="sm:col-span-2">{error ? <Alert variant="destructive" className="mt-4"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}</div>
      </form>
    </Card>
  );
}
