import ContentList from '../../_components/ContentList';
import NotAllowed from '../../_components/NotAllowed';
import PageHeading from '../../_components/PageHeading';
import { Card } from '@/app/ui/components';
import UploadForm from '../../_components/UploadForm';
import { requireStaffPageActor } from '../../_lib/actor';
import { listContent, listUploadTargets } from '@/modules/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Content · AI Tutor for Schools' };

export default async function SchoolContentPage() {
  const actor = await requireStaffPageActor();
  const isSchoolAdmin = actor.roles.includes('school_admin');
  const isBranchAdmin = actor.roles.includes('branch_admin');
  if (!actor.isPlatformAdmin && !isSchoolAdmin && !isBranchAdmin) return <NotAllowed />;

  const [items, targets] = await Promise.all([listContent(actor, {}), listUploadTargets(actor)]);
  // Branch admins (who are not school admins) can hide school-wide items for their own branch.
  const toggleBranchId = !actor.isPlatformAdmin && !isSchoolAdmin ? actor.branchId : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeading title="Content" lead="Upload books and materials for your students." />
      {actor.isPlatformAdmin ? (
        <p className="text-sm text-muted-foreground">
          Uploads are made by school staff. You can review and manage content here.
        </p>
      ) : (
        <Card>
          <UploadForm
            targets={targets}
            mode={isSchoolAdmin ? 'school_admin' : 'branch_admin'}
          />
        </Card>
      )}
      <h2 className="text-lg font-semibold">Uploaded content</h2>
      <ContentList initialItems={items} toggleBranchId={toggleBranchId} />
    </div>
  );
}
