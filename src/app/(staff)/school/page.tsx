import Link from 'next/link';
import NotAllowed from '../_components/NotAllowed';
import styles from '../staff.module.css';
import { Card, EmptyState } from '@/app/ui/components';
import { requirePageActor } from '@/lib/guard';
import { DomainError } from '@/lib/errors';
import AddStudentForm from './_components/AddStudentForm';
import BranchCodes from './_components/BranchCodes';
import EnrollmentCards from './_components/EnrollmentCards';
import EnrollmentTable from './_components/EnrollmentTable';
import SetupSection from './_components/SetupSection';
import StudentFilters from './_components/StudentFilters';
import StudentsTable from './_components/StudentsTable';
import { loadSchoolDashboard, loadSchoolSetup } from './loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'School · AI Tutor for Schools' };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SchoolPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requirePageActor(['school_admin', 'branch_admin']);
  const sp = await searchParams;
  const q = { branchId: one(sp.branchId), grade: one(sp.grade), status: one(sp.status) };
  // schoolId is never a page parameter: a forced school scope is rejected, not ignored.
  if (sp.schoolId !== undefined) return <NotAllowed />;

  let data: Awaited<ReturnType<typeof loadSchoolDashboard>>;
  let setup: Awaited<ReturnType<typeof loadSchoolSetup>>;
  try {
    [data, setup] = await Promise.all([loadSchoolDashboard(actor, q), loadSchoolSetup(actor)]);
  } catch (e) {
    if (e instanceof DomainError && e.code === 'FORBIDDEN') return <NotAllowed />;
    if (e instanceof DomainError && e.code === 'VALIDATION') {
      return (
        <>
          <h1 className={styles.title}>School</h1>
          <EmptyState>{e.message}</EmptyState>
          <Link href="/school">Clear filters</Link>
        </>
      );
    }
    throw e;
  }

  return (
    <>
      <h1 className={styles.title}>School</h1>
      <nav><Link href="/school/content">Content</Link></nav>
      <EnrollmentCards totals={data.totals} />
      <EnrollmentTable rows={data.summary} />
      <Card title="Students">
        <StudentFilters branches={data.branches} canFilterBranch={data.canFilterBranch} values={q} />
        <StudentsTable rows={data.students} canRemove />
      </Card>
      <AddStudentForm branches={data.branches} />
      <BranchCodes branches={data.branches} />
      <SetupSection {...setup} />
    </>
  );
}
