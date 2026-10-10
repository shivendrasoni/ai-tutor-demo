'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { buildPaymentBody, paymentFormDefaults } from '../payment';
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
    <form onSubmit={submit}>
      <label>Amount ({d.currency}) <input name="amount" defaultValue={d.amount} inputMode="decimal" required /></label>{' '}
      <label>Reference <input name="reference" /></label>{' '}
      <label>Paid at <input name="paidAt" type="date" defaultValue={d.paidAt} required /></label>{' '}
      <button type="submit" disabled={busy}>Record payment</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
