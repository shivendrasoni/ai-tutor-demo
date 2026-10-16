'use client';
import { useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Card, Field } from '@/app/ui/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RoutingConfig } from '@/demo/areas/platform/types';

/** Demo: editable routing configuration, saved through PUT /api/platform/routing/config. */
export default function RoutingConfigForm({ config }: { config: RoutingConfig }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch('/api/platform/routing/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          basicModel: String(fd.get('basicModel') ?? ''),
          advancedModel: String(fd.get('advancedModel') ?? ''),
          deciderModel: String(fd.get('deciderModel') ?? ''),
          advancedMinGrade: Number(fd.get('advancedMinGrade')),
          advancedShareCapPct: Number(fd.get('advancedShareCapPct')),
          offTopicFilter: fd.get('offTopicFilter') === 'on',
        }),
      });
      if (res.ok) setSaved(true);
      else setError((await res.json().catch(() => null))?.error?.message ?? 'Request failed');
    } catch {
      setError('Request failed');
    }
    setBusy(false);
  }
  return (
    <Card title="Model routing configuration">
      <form onSubmit={submit} key={JSON.stringify(config)} className="grid gap-x-4 sm:grid-cols-2">
        <Field label="Basic tier model"><Input name="basicModel" defaultValue={config.basicModel} required /></Field>
        <Field label="Advanced tier model"><Input name="advancedModel" defaultValue={config.advancedModel} required /></Field>
        <Field label="Decider model"><Input name="deciderModel" defaultValue={config.deciderModel} required /></Field>
        <Field label="Advanced tier from grade"><Input name="advancedMinGrade" type="number" defaultValue={config.advancedMinGrade} required /></Field>
        <Field label="Advanced share cap (%)"><Input name="advancedShareCapPct" type="number" defaultValue={config.advancedShareCapPct} required /></Field>
        <label className="flex items-center gap-2 self-center text-sm"><input type="checkbox" name="offTopicFilter" defaultChecked={config.offTopicFilter} className="size-4 accent-primary" />Block off-topic requests</label>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Save routing</Button></div>
        <div className="sm:col-span-2">
          {error ? <Alert variant="destructive" className="mt-4"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
          {saved ? <p role="status" className="mt-4 flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden="true" />Routing saved</p> : null}
        </div>
      </form>
    </Card>
  );
}
