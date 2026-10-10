'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postJson } from './api';

export default function ReviewButton({ messageId, reviewedAt }: { messageId: string; reviewedAt: Date | null }) {
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
  if (reviewedAt) return <p role="status">Reviewed on {reviewedAt.toISOString().slice(0, 10)}</p>;
  if (done) return <p role="status">Marked as reviewed</p>;
  return (
    <>
      <button type="button" disabled={busy} onClick={click}>Mark reviewed</button>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
