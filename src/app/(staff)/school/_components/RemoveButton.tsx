'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function RemoveButton({ studentId, name }: { studentId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Remove ${name}? They will lose access immediately.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/school/students/${studentId}/remove`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not remove the student');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not remove the student');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={remove} disabled={busy}>Remove</button>
      {error ? <span role="alert"> {error}</span> : null}
    </>
  );
}
