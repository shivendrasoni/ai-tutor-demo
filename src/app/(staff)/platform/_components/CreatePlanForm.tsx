'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Card, Field } from '@/app/ui/components';
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
      <form onSubmit={submit}>
        <Field label="Name"><input name="name" required maxLength={100} /></Field>
        <Field label="Interval">
          <select name="interval" defaultValue="monthly"><option value="monthly">Monthly</option><option value="annual">Annual</option></select>
        </Field>
        <Field label="Price (major units)"><input name="price" inputMode="decimal" required placeholder="499.00" /></Field>
        <Field label="Currency"><input name="currency" defaultValue="INR" maxLength={3} minLength={3} required /></Field>
        <button type="submit" disabled={busy}>Create plan</button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </Card>
  );
}
