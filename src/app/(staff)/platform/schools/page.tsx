'use client';
import CreateBranchForm from '../_components/CreateBranchForm';
import CreateSchoolForm from '../_components/CreateSchoolForm';
import SchoolsList from '../_components/SchoolsList';
import PlatformNav from '../_components/PlatformNav';
import { usePlatform } from '../_components/usePlatform';
import { selectSchools } from '@/demo/areas/platform/selectors';

export default function SchoolsPage() {
  const schools = selectSchools(usePlatform());
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Schools</h1>
      <PlatformNav />
      <SchoolsList schools={schools} />
      <CreateSchoolForm />
      <CreateBranchForm schools={schools.map((s) => ({ id: s.id, name: s.name }))} />
    </div>
  );
}
