'use client';

import { useMemo } from 'react';
import ContentList from '../../_components/ContentList';
import NotAllowed from '../../_components/NotAllowed';
import PageHeading from '../../_components/PageHeading';
import { Card } from '@/app/ui/components';
import UploadForm from '../../_components/UploadForm';
import { useSlice } from '@/demo/core/store';
import { useCurrentUser } from '@/demo/core/useCurrentUser';
import { uploadTargets, visibleContent } from '@/demo/areas/teacher/logic';
import type { TeacherSlice } from '@/demo/areas/teacher/fixtures';
import type { ContentItemRow } from '@/modules/content';

export default function TeacherMaterialsPage() {
  const { user, core } = useCurrentUser();
  const teacher = useSlice<TeacherSlice>('teacher');
  const items = useMemo(
    () => (user?.role === 'teacher' ? (visibleContent(core, teacher, user) as unknown as ContentItemRow[]) : []),
    [core, teacher, user],
  );
  const targets = useMemo(() => (user?.role === 'teacher' ? uploadTargets(core, teacher, user) : null), [core, teacher, user]);
  if (!user || user.role !== 'teacher' || !targets) return <NotAllowed />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeading title="Materials" lead="Share PDF materials with the sections you teach." />
      <Card>
        <UploadForm targets={targets} mode="teacher" />
      </Card>
      <h2 className="text-lg font-semibold">Your materials</h2>
      <ContentList initialItems={items} toggleBranchId={null} />
    </div>
  );
}
