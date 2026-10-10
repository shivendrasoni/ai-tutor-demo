import { Field } from '@/app/ui/components';
import type { BranchListing } from '@/modules/analytics';
import { STUDENT_STATUSES } from '../loaders';

export default function StudentFilters({
  branches, canFilterBranch, values,
}: {
  branches: BranchListing[];
  canFilterBranch: boolean;
  values: { branchId?: string; grade?: string; status?: string };
}) {
  return (
    <form method="get" action="/school">
      {canFilterBranch ? (
        <Field label="Branch">
          <select name="branchId" defaultValue={values.branchId ?? ''}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
          </select>
        </Field>
      ) : null}
      <Field label="Grade">
        <select name="grade" defaultValue={values.grade ?? ''}>
          <option value="">All grades</option>
          {[5, 6, 7, 8, 9, 10, 11, 12].map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select name="status" defaultValue={values.status ?? ''}>
          <option value="">All statuses</option>
          {STUDENT_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </Field>
      <button type="submit">Filter</button>
    </form>
  );
}
