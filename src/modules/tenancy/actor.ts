export type Role = 'school_admin' | 'branch_admin' | 'teacher' | 'student';
export type StudentStatus = 'pending_payment' | 'active' | 'lapsed' | 'removed';
export type Actor = {
  userId: string;
  isPlatformAdmin: boolean;
  schoolId: string | null;
  branchId: string | null;
  roles: Role[];
};
