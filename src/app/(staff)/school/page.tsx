'use client';
import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import NotAllowed from '../_components/NotAllowed';
import PageHeading from '../_components/PageHeading';
import { buttonVariants } from '@/components/ui/button';
import { Card, EmptyState } from '@/app/ui/components';
import { useCurrentUser } from '@/demo/core/useCurrentUser';
import { useSlice } from '@/demo/core/store';
import { emptySchoolSlice, type SchoolSlice } from '@/demo/areas/school/queries';
import AddStudentForm from './_components/AddStudentForm';
import BranchCodes from './_components/BranchCodes';
import EnrollmentCards from './_components/EnrollmentCards';
import EnrollmentTable from './_components/EnrollmentTable';
import SetupSection from './_components/SetupSection';
import StudentFilters from './_components/StudentFilters';
import StudentsTable from './_components/StudentsTable';
import { loadSchoolDashboard, loadSchoolSetup, SchoolError } from './loaders';

export default function SchoolPage() {
  return (
    <Suspense fallback={null}>
      <SchoolDashboard />
    </Suspense>
  );
}

function SchoolDashboard() {
  const { user, core } = useCurrentUser();
  const school = useSlice<SchoolSlice>('school') ?? emptySchoolSlice();
  const sp = useSearchParams();
  const q = { branchId: sp.get('branchId') ?? undefined, grade: sp.get('grade') ?? undefined, status: sp.get('status') ?? undefined };
  const schoolIdGiven = sp.get('schoolId') !== null;

  const result = useMemo(() => {
    if (schoolIdGiven) return { kind: 'forbidden' as const };
    try {
      return { kind: 'ok' as const, data: loadSchoolDashboard(core, school, user, q), setup: loadSchoolSetup(core, school, user) };
    } catch (e) {
      if (e instanceof SchoolError && e.code === 'FORBIDDEN') return { kind: 'forbidden' as const };
      if (e instanceof SchoolError && e.code === 'VALIDATION') return { kind: 'invalid' as const, message: e.message };
      throw e;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, school, user, q.branchId, q.grade, q.status, schoolIdGiven]);

  if (result.kind === 'forbidden') return <NotAllowed />;
  if (result.kind === 'invalid') {
    return (
      <div className="space-y-4">
        <PageHeading title="School" />
        <EmptyState>{result.message}</EmptyState>
        <Link href="/school" className={buttonVariants({ variant: 'outline' })}>Clear filters</Link>
      </div>
    );
  }
  const { data, setup } = result;

  return (
    <div className="space-y-6">
      <PageHeading
        title="School"
        actions={
          <nav>
            <Link href="/school/content" className={buttonVariants({ variant: 'outline' })}>
              Content <ArrowRight className="size-4" />
            </Link>
          </nav>
        }
      />
      <EnrollmentCards totals={data.totals} />
      <EnrollmentTable rows={data.summary} />
      <Card title="Students">
        <StudentFilters branches={data.branches} canFilterBranch={data.canFilterBranch} values={q} />
        <StudentsTable rows={data.students} canRemove />
      </Card>
      <AddStudentForm branches={data.branches} />
      <BranchCodes branches={data.branches} />
      <SetupSection {...setup} />
    </div>
  );
}
