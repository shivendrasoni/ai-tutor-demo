import ContentList from '../../_components/ContentList';
import NotAllowed from '../../_components/NotAllowed';
import UploadForm from '../../_components/UploadForm';
import styles from '../../staff.module.css';
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
    <>
      <h1 className={styles.title}>Content</h1>
      <p className={styles.lead}>Upload books and materials for your students.</p>
      {actor.isPlatformAdmin ? (
        <p className={styles.hint}>Uploads are made by school staff. You can review and manage content here.</p>
      ) : (
        <UploadForm
          targets={targets}
          mode={isSchoolAdmin ? 'school_admin' : 'branch_admin'}
        />
      )}
      <h2 className={styles.heading}>Uploaded content</h2>
      <ContentList initialItems={items} toggleBranchId={toggleBranchId} />
    </>
  );
}
