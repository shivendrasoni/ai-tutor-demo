'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Ban, CheckCircle2, RefreshCw } from 'lucide-react';
import { Badge, Card, DataTable } from '@/app/ui/components';
import { Button } from '@/components/ui/button';
import type { BranchListing } from '@/modules/analytics';

export default function BranchCodes({ branches }: { branches: BranchListing[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: 'rotate' | 'enable' | 'disable') {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/school/branches/${id}/code`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Could not update the signup code');
        return;
      }
      router.refresh();
    } catch {
      setError('Could not update the signup code');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card title="Branch signup codes">
      <DataTable
        rows={branches}
        empty="No branches yet"
        columns={[
          { header: 'Branch', cell: (b) => b.name },
          { header: 'Code', cell: (b) => <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{b.signupCode}</code> },
          { header: 'Status', cell: (b) => <Badge tone={b.signupCodeEnabled ? 'ok' : 'muted'}>{b.signupCodeEnabled ? 'enabled' : 'disabled'}</Badge> },
          {
            header: 'Actions',
            cell: (b) => (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" disabled={busyId === b.branchId} onClick={() => act(b.branchId, 'rotate')}>
                  <RefreshCw className="size-4" />Rotate
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={busyId === b.branchId} onClick={() => act(b.branchId, b.signupCodeEnabled ? 'disable' : 'enable')}>
                  {b.signupCodeEnabled ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}
                  {b.signupCodeEnabled ? 'Disable' : 'Enable'}
                </Button>
              </div>
            ),
          },
        ]}
      />
      {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
    </Card>
  );
}
