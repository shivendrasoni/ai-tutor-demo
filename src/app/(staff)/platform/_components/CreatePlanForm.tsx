'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Card, Field } from '@/app/ui/components';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { toMinor } from '@/app/ui/format';
import { postJson } from './api';

export default function CreatePlanForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    let priceMinor: number;
    try {
      priceMinor = toMinor(String(fd.get('price') ?? ''));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid price');
      return;
    }
    setBusy(true);
    setError(null);
    const msg = await postJson('/api/platform/plans', {
      name: String(fd.get('name') ?? '').trim(),
      interval: String(fd.get('interval')),
      priceMinor,
      currency: String(fd.get('currency') ?? 'INR').trim().toUpperCase(),
    });
    setBusy(false);
    if (msg) setError(msg);
    else { form.reset(); router.refresh(); }
  }
  return (
    <Card title="Create a plan">
      <form onSubmit={submit} className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Name"><Input name="name" required maxLength={100} /></Field>
        <Field label="Interval">
          <select name="interval" defaultValue="monthly" className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"><option value="monthly">Monthly</option><option value="annual">Annual</option></select>
        </Field>
        <Field label="Price (major units)"><Input name="price" inputMode="decimal" required placeholder="499.00" /></Field>
        <Field label="Currency"><Input name="currency" defaultValue="INR" maxLength={3} minLength={3} required /></Field>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Create plan</Button></div>
        <div className="sm:col-span-2">{error ? <Alert variant="destructive" className="mt-4"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}</div>
      </form>
    </Card>
  );
}
