import { branches, sections, subjects } from './tenancy';
import { memberships, teacherAssignments } from './auth';
import { chunks, contentChapters, contentExclusions, contentItems } from './content';
import { conversations, messages, usageDaily } from './tutor';
import { invites, payments, studentProfiles, subscriptions } from './enrollment';

export * from './tenancy';
export * from './auth';
export * from './enrollment';
export * from './content';
export * from './tutor';

/** The 16 RLS-protected tables keyed by a school_id column (schools itself is keyed on id). */
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
  contentItems,
  contentExclusions,
  contentChapters,
  chunks,
  conversations,
  messages,
  usageDaily,
];
