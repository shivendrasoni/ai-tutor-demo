'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postJson } from './api';

export default function ReviewButton({ messageId }: { messageId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function click() {
    setBusy(true);
    setError(null);
    const msg = await postJson(`/api/platform/flags/${encodeURIComponent(messageId)}/review`);
    setBusy(false);
    if (msg) setError(msg);
    else router.refresh();
  }
  return (
    <>
      <button type="button" disabled={busy} onClick={click}>Mark reviewed</button>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
