'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { buildPaymentBody, paymentFormDefaults } from '../payment';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { postJson } from './api';

type Row = { subscriptionId: string; priceMinor: number; currency: string };

export default function RecordPaymentForm({ row }: { row: Row }) {
  const router = useRouter();
  const d = paymentFormDefaults(row);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const str = (k: string) => String(fd.get(k) ?? '');
    let body;
    try {
      body = buildPaymentBody({
        subscriptionId: row.subscriptionId, amount: str('amount'), currency: row.currency, reference: str('reference'), paidAt: str('paidAt'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid input');
      return;
    }
    setBusy(true);
    setError(null);
    const msg = await postJson('/api/platform/payments', body);
    setBusy(false);
    if (msg) setError(msg);
    else router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex min-w-56 flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1 text-xs font-medium">Amount ({d.currency}) <Input name="amount" defaultValue={d.amount} inputMode="decimal" required className="h-8 w-28" /></label>
      <label className="flex flex-col gap-1 text-xs font-medium">Reference <Input name="reference" className="h-8 w-32" /></label>
      <label className="flex flex-col gap-1 text-xs font-medium">Paid at <Input name="paidAt" type="date" defaultValue={d.paidAt} required className="h-8 w-36" /></label>
      <Button type="submit" size="sm" disabled={busy}>Record payment</Button>
      {error ? <Alert variant="destructive" className="basis-full py-2"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
    </form>
  );
}
