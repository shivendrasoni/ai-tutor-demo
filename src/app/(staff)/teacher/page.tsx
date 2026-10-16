'use client';

import { Suspense, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import NotAllowed from '../_components/NotAllowed';
import PageHeading from '../_components/PageHeading';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/app/ui/components';
import { useSlice } from '@/demo/core/store';
import { useCurrentUser } from '@/demo/core/useCurrentUser';
import { sectionProgress, studentUsage, teacherAssignments } from '@/demo/areas/teacher/logic';
import type { TeacherSlice } from '@/demo/areas/teacher/fixtures';
import ProgressGrid from './_components/ProgressGrid';
import SectionSelector from './_components/SectionSelector';
import UsageTable from './_components/UsageTable';

function Dashboard() {
  const sp = useSearchParams();
  const { user, core } = useCurrentUser();
  const teacher = useSlice<TeacherSlice>('teacher');
  const sectionId = sp.get('sectionId') || undefined;
  const subjectId = sp.get('subjectId') || undefined;

  const assignments = useMemo(() => (user ? teacherAssignments(core, teacher, user.id) : []), [core, teacher, user]);

  if ((sectionId === undefined) !== (subjectId === undefined)) {
    return (
      <div className="space-y-4">
        <PageHeading title="Teacher" />
        <EmptyState>Choose both a section and a subject</EmptyState>
        <Link href="/teacher" className={buttonVariants({ variant: 'outline' })}>Back to your classes</Link>
      </div>
    );
  }
  let selected: { sectionId: string; subjectId: string } | null = null;
  if (sectionId !== undefined && subjectId !== undefined) {
    if (!assignments.some((a) => a.sectionId === sectionId && a.subjectId === subjectId)) return <NotAllowed />;
    selected = { sectionId, subjectId };
  } else if (assignments.length > 0) {
    selected = { sectionId: assignments[0]!.sectionId, subjectId: assignments[0]!.subjectId };
  }
  const progress = selected ? sectionProgress(core, teacher, selected.sectionId, selected.subjectId) : null;
  const usage = selected ? studentUsage(core, teacher, selected.sectionId) : [];

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
      <SectionSelector assignments={assignments} selected={selected} />
      {progress ? <ProgressGrid data={progress} /> : null}
      {selected ? <UsageTable rows={usage} /> : null}
    </div>
  );
}

export default function TeacherPage() {
  return (
    <Suspense fallback={null}>
      <Dashboard />
    </Suspense>
  );
}
