'use client';
import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

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
      <Button type="button" variant="outline" size="sm" onClick={remove} disabled={busy}
        className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
        <Trash2 className="size-4" />Remove
      </Button>
      {error ? <span role="alert" className="text-sm text-destructive"> {error}</span> : null}
    </>
  );
}
