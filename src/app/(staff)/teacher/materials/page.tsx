import ContentList from '../../_components/ContentList';
import NotAllowed from '../../_components/NotAllowed';
import PageHeading from '../../_components/PageHeading';
import { Card } from '@/app/ui/components';
import UploadForm from '../../_components/UploadForm';
import { requireStaffPageActor } from '../../_lib/actor';
import { listContent, listUploadTargets } from '@/modules/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Materials · AI Tutor for Schools' };

export default async function TeacherMaterialsPage() {
  const actor = await requireStaffPageActor();
  if (!actor.roles.includes('teacher')) return <NotAllowed />;

  const [items, targets] = await Promise.all([listContent(actor, {}), listUploadTargets(actor)]);

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
