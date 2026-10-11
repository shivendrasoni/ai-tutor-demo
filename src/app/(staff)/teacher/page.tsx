import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import NotAllowed from '../_components/NotAllowed';
import PageHeading from '../_components/PageHeading';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/app/ui/components';
import { DomainError } from '@/lib/errors';
import { requirePageActor } from '@/lib/guard';
import ProgressGrid from './_components/ProgressGrid';
import SectionSelector from './_components/SectionSelector';
import UsageTable from './_components/UsageTable';
import { loadTeacherDashboard } from './loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Teacher · AI Tutor for Schools' };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TeacherPage({ searchParams }: { searchParams: Promise<Params> }) {
  const actor = await requirePageActor(['teacher']);
  const sp = await searchParams;

  let data: Awaited<ReturnType<typeof loadTeacherDashboard>>;
  try {
    data = await loadTeacherDashboard(actor, { sectionId: one(sp.sectionId), subjectId: one(sp.subjectId) });
  } catch (e) {
    if (e instanceof DomainError && e.code === 'FORBIDDEN') return <NotAllowed />;
    if (e instanceof DomainError && e.code === 'VALIDATION') {
      return (
        <div className="space-y-4">
          <PageHeading title="Teacher" />
          <EmptyState>{e.message}</EmptyState>
          <Link href="/teacher" className={buttonVariants({ variant: 'outline' })}>Back to your classes</Link>
        </div>
      );
    }
    throw e;
  }

  return (
    <div className="space-y-6">
      <PageHeading
        title="Teacher"
        actions={
          <nav>
            <Link href="/teacher/materials" className={buttonVariants({ variant: 'outline' })}>
              Materials <ArrowRight className="size-4" />
            </Link>
          </nav>
        }
      />
      <SectionSelector assignments={data.assignments} selected={data.selected} />
      {data.progress ? <ProgressGrid data={data.progress} /> : null}
      {data.selected ? <UsageTable rows={data.usage} /> : null}
    </div>
  );
}
