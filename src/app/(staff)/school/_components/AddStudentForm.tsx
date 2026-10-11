'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Check, Copy, UserPlus } from 'lucide-react';
import { Card, Field } from '@/app/ui/components';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { BranchListing } from '@/modules/analytics';

export function InviteResult({ url, message = 'Student added. Share this invite link with the parent:' }: { url: string; message?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div role="status" className="mt-4 space-y-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm">
      <p>{message}</p>
      <div className="flex flex-wrap gap-2">
        <Input readOnly value={url} aria-label="Invite link" className="min-w-0 flex-1 bg-background" />
        <Button type="button" variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export default function AddStudentForm({ branches }: { branches: BranchListing[] }) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(branches[0]?.branchId ?? '');
  const [grade, setGrade] = useState(8);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  if (branches.length === 0) return <Card title="Add a student"><p className="text-sm text-muted-foreground">Create a branch before adding students.</p></Card>;
  const sections = branches.find((b) => b.branchId === branchId)?.sections.filter((s) => s.grade === grade) ?? [];

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const str = (k: string) => String(fd.get(k) ?? '').trim();
    setBusy(true);
    setError(null);
    setInviteUrl(null);
    try {
      const res = await fetch('/api/school/students', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          branchId,
          grade,
          sectionId: str('sectionId') || undefined,
          studentName: str('studentName'),
          parentName: str('parentName'),
          parentPhone: str('parentPhone'),
          parentEmail: str('parentEmail') || undefined,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error?.message ?? 'Could not add the student');
        return;
      }
      setInviteUrl(body.inviteUrl);
      form.reset();
      router.refresh();
    } catch {
      setError('Could not add the student');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Add a student">
      <form onSubmit={submit} className="grid gap-x-4 sm:grid-cols-2">
        {branches.length > 1 ? (
          <Field label="Branch">
            <NativeSelect value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
            </NativeSelect>
          </Field>
        ) : null}
        <Field label="Grade">
          <NativeSelect value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
            {[5, 6, 7, 8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>{g}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Section (optional)">
          <NativeSelect name="sectionId" defaultValue="">
            <option value="">No section</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Student name"><Input name="studentName" required maxLength={200} /></Field>
        <Field label="Parent name"><Input name="parentName" required maxLength={200} /></Field>
        <Field label="Parent phone"><Input name="parentPhone" required maxLength={32} inputMode="tel" /></Field>
        <Field label="Parent email (optional)"><Input name="parentEmail" type="email" maxLength={254} /></Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={busy}><UserPlus className="size-4" />{busy ? 'Adding…' : 'Add student'}</Button>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
      </form>
      {inviteUrl ? <InviteResult url={inviteUrl} /> : null}
    </Card>
  );
}
