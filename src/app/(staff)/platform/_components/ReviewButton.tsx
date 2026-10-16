'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { postJson } from './api';

export default function ReviewButton({ messageId, reviewedAt }: { messageId: string; reviewedAt: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function click() {
    setBusy(true);
    setError(null);
    const msg = await postJson(`/api/platform/flags/${encodeURIComponent(messageId)}/review`);
    setBusy(false);
    if (msg) setError(msg);
    else {
      setDone(true);
      router.refresh();
    }
  }
  if (reviewedAt) return <p role="status" className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden="true" />Reviewed on {reviewedAt.slice(0, 10)}</p>;
  if (done) return <p role="status" className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden="true" />Marked as reviewed</p>;
  return (
    <>
      <Button type="button" disabled={busy} onClick={click}>Mark reviewed</Button>
      {error ? <Alert variant="destructive" className="mt-3"><AlertCircle /><AlertDescription>{error}</AlertDescription></Alert> : null}
    </>
  );
}
