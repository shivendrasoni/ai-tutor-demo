import { branches, sections, subjects } from './tenancy';
import { memberships, teacherAssignments } from './auth';
import { invites, payments, studentProfiles, subscriptions } from './enrollment';

export * from './tenancy';
export * from './auth';
export * from './enrollment';

/** The 9 RLS-protected tables keyed by a school_id column (schools itself is keyed on id). */
export const tenantTables = [
  branches,
  sections,
  subjects,
  memberships,
  teacherAssignments,
  studentProfiles,
  subscriptions,
  payments,
  invites,
];
