'use client';
import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { InviteResult } from './AddStudentForm';

/** Issues a fresh invite link for a student who has not signed up yet (the old link stops working). */
export default function NewInviteButton({ studentId, name }: { studentId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/school/students/${studentId}/invite`, { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? 'Could not create a new invite link');
        return;
      }
      setUrl(body.inviteUrl);
    } catch {
      setError('Could not create a new invite link');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={issue} disabled={busy}>
        <Link2 className="size-4" />New invite link
      </Button>
      {error ? <span role="alert" className="text-sm text-destructive"> {error}</span> : null}
      {url ? <InviteResult url={url} message={`New invite link for ${name} (the previous link no longer works):`} /> : null}
    </>
  );
}
