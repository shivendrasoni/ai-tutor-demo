import styles from '../../staff.module.css';
import { requirePageActor } from '@/lib/guard';
import CreateBranchForm from '../_components/CreateBranchForm';
import CreateSchoolForm from '../_components/CreateSchoolForm';
import SchoolsList from '../_components/SchoolsList';
import PlatformNav from '../_components/PlatformNav';
import { pageError } from '../_components/PageError';
import { loadSchools } from '../loaders';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Schools · AI Tutor for Schools' };

export default async function SchoolsPage() {
  const actor = await requirePageActor(['platform']);
  let schools: Awaited<ReturnType<typeof loadSchools>>;
  try {
    schools = await loadSchools(actor);
  } catch (e) {
    return pageError('Schools', e);
  }
  return (
    <>
      <h1 className={styles.title}>Schools</h1>
      <PlatformNav />
      <SchoolsList schools={schools} />
      <CreateSchoolForm />
      <CreateBranchForm schools={schools.map((s) => ({ id: s.id, name: s.name }))} />
    </>
  );
}
