'use client';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Card, Field } from '@/app/ui/components';
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
    <div role="status">
      <p>{message}</p>
      <input readOnly value={url} aria-label="Invite link" size={48} />{' '}
      <button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
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

  if (branches.length === 0) return <Card title="Add a student"><p>Create a branch before adding students.</p></Card>;
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
      <form onSubmit={submit}>
        {branches.length > 1 ? (
          <Field label="Branch">
            <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
            </select>
          </Field>
        ) : null}
        <Field label="Grade">
          <select value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
            {[5, 6, 7, 8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </Field>
        <Field label="Section (optional)">
          <select name="sectionId" defaultValue="">
            <option value="">No section</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Student name"><input name="studentName" required maxLength={200} /></Field>
        <Field label="Parent name"><input name="parentName" required maxLength={200} /></Field>
        <Field label="Parent phone"><input name="parentPhone" required maxLength={32} inputMode="tel" /></Field>
        <Field label="Parent email (optional)"><input name="parentEmail" type="email" maxLength={254} /></Field>
        <button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add student'}</button>
        {error ? <p role="alert">{error}</p> : null}
      </form>
      {inviteUrl ? <InviteResult url={inviteUrl} /> : null}
    </Card>
  );
}
