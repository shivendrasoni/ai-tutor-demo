import ContentList from '../../_components/ContentList';
import NotAllowed from '../../_components/NotAllowed';
import UploadForm from '../../_components/UploadForm';
import styles from '../../staff.module.css';
import { requireStaffPageActor } from '../../_lib/actor';
import { listContent, listUploadTargets } from '@/modules/content';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Materials · AI Tutor for Schools' };

export default async function TeacherMaterialsPage() {
  const actor = await requireStaffPageActor();
  if (!actor.roles.includes('teacher')) return <NotAllowed />;

  const [items, targets] = await Promise.all([listContent(actor, {}), listUploadTargets(actor)]);

  return (
    <>
      <h1 className={styles.title}>Materials</h1>
      <p className={styles.lead}>Share PDF materials with the sections you teach.</p>
      <UploadForm targets={targets} mode="teacher" />
      <h2 className={styles.heading}>Your materials</h2>
      <ContentList initialItems={items} toggleBranchId={null} />
    </>
  );
}
