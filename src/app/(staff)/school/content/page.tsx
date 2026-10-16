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

export default function SchoolContentPage() {
  const { user, core } = useCurrentUser();
  const teacher = useSlice<TeacherSlice>('teacher');
  const isSchoolAdmin = user?.role === 'school_admin';
  const isBranchAdmin = user?.role === 'branch_admin';
  const items = useMemo(
    () => (user && (isSchoolAdmin || isBranchAdmin) ? (visibleContent(core, teacher, user) as unknown as ContentItemRow[]) : []),
    [core, teacher, user, isSchoolAdmin, isBranchAdmin],
  );
  const targets = useMemo(
    () => (user && (isSchoolAdmin || isBranchAdmin) ? uploadTargets(core, teacher, user) : null),
    [core, teacher, user, isSchoolAdmin, isBranchAdmin],
  );
  if (!user || !targets) return <NotAllowed />;
  // Branch admins (who are not school admins) can hide school-wide items for their own branch.
  const toggleBranchId = isSchoolAdmin ? null : user.branchId;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeading title="Content" lead="Upload books and materials for your students." />
      <Card>
        <UploadForm targets={targets} mode={isSchoolAdmin ? 'school_admin' : 'branch_admin'} />
      </Card>
      <h2 className="text-lg font-semibold">Uploaded content</h2>
      <ContentList initialItems={items} toggleBranchId={toggleBranchId} />
    </div>
  );
}
