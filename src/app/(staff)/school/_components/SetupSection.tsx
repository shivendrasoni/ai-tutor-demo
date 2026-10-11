import { Card } from '@/app/ui/components';
import type { BranchListing } from '@/modules/analytics';
import { AddSectionForm, AddSubjectForm, AddTeacherForm, AssignTeacherForm } from './SetupForms';

export type SetupProps = {
  branches: BranchListing[];
  subjects: { id: string; name: string }[];
  teachers: { userId: string; name: string; username: string | null; branchId: string; branchName: string }[];
  canManageSubjects: boolean;
};

/** Minimal school setup: sections, subjects (school_admin only), teacher accounts, teacher assignments. */
export default function SetupSection({ branches, subjects, teachers, canManageSubjects }: SetupProps) {
  if (branches.length === 0) {
    return <Card title="Setup"><p className="text-sm text-muted-foreground">Create a branch before setting up sections and teachers.</p></Card>;
  }
  return (
    <Card title="Setup">
      <div className="grid gap-4 lg:grid-cols-2">
      <AddSectionForm branches={branches} />
      {canManageSubjects ? <AddSubjectForm /> : null}
      <AddTeacherForm branches={branches} />
      <AssignTeacherForm branches={branches} subjects={subjects} teachers={teachers} />
      </div>
    </Card>
  );
}
