'use client';
import { useRouter } from 'next/navigation';
import type { FormEvent } from 'react';
import { Filter } from 'lucide-react';
import { Field } from '@/app/ui/components';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import type { BranchListing } from '@/modules/analytics';
import { STUDENT_STATUSES } from '../loaders';

export default function StudentFilters({
  branches, canFilterBranch, values,
}: {
  branches: BranchListing[];
  canFilterBranch: boolean;
  values: { branchId?: string; grade?: string; status?: string };
}) {
  const router = useRouter();
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const p = new URLSearchParams();
    for (const [k, v] of new FormData(e.currentTarget)) if (typeof v === 'string' && v) p.set(k, v);
    const qs = p.toString();
    router.push(qs ? `/school?${qs}` : '/school');
  }
  return (
    <form method="get" action="/school" onSubmit={onSubmit} className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-0">
      {canFilterBranch ? (
        <Field label="Branch">
          <NativeSelect name="branchId" key={values.branchId ?? ''} defaultValue={values.branchId ?? ''}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
          </NativeSelect>
        </Field>
      ) : null}
      <Field label="Grade">
        <NativeSelect name="grade" key={values.grade ?? ''} defaultValue={values.grade ?? ''}>
          <option value="">All grades</option>
          {[5, 6, 7, 8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>{g}</option>)}
        </NativeSelect>
      </Field>
      <Field label="Status">
        <NativeSelect name="status" key={values.status ?? ''} defaultValue={values.status ?? ''}>
          <option value="">All statuses</option>
          {STUDENT_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </NativeSelect>
      </Field>
      <Button type="submit" variant="secondary" className="mb-4"><Filter className="size-4" />Filter</Button>
    </form>
  );
}
