/** Shared people and ids so every area of the demo tells one consistent story. Areas extend this, never redefine it. */
export type StudentStatus = 'pending_payment' | 'active' | 'lapsed' | 'removed';

export type CoreUser = {
  id: string;
  name: string;
  username: string;
  role: 'school_admin' | 'branch_admin' | 'teacher' | 'student';
  branchId: string | null;
  grade?: number;
  sectionId?: string;
  status?: StudentStatus;
};

export type CoreSeed = {
  school: { id: string; name: string };
  branches: { id: string; name: string; code: string }[];
  sections: { id: string; branchId: string; grade: number; name: string }[];
  subjects: { id: string; name: string }[];
  users: CoreUser[];
};

const branches = [
  { id: 'b-north', name: 'North Campus', code: 'GRN-NORTH' },
  { id: 'b-south', name: 'South Campus', code: 'GRN-SOUTH' },
];

const sections = [
  { id: 's-n5', branchId: 'b-north', grade: 5, name: '5-A' },
  { id: 's-n7', branchId: 'b-north', grade: 7, name: '7-A' },
  { id: 's-n9', branchId: 'b-north', grade: 9, name: '9-A' },
  { id: 's-n11', branchId: 'b-north', grade: 11, name: '11-A' },
  { id: 's-s5', branchId: 'b-south', grade: 5, name: '5-B' },
  { id: 's-s8', branchId: 'b-south', grade: 8, name: '8-B' },
  { id: 's-s10', branchId: 'b-south', grade: 10, name: '10-B' },
  { id: 's-s12', branchId: 'b-south', grade: 12, name: '12-B' },
];

const subjects = [
  { id: 'sub-math', name: 'Mathematics' },
  { id: 'sub-sci', name: 'Science' },
  { id: 'sub-eng', name: 'English' },
  { id: 'sub-soc', name: 'Social Studies' },
];

const staff: CoreUser[] = [
  { id: 'u-anita', name: 'Dr. Anita Kulkarni', username: 'anita.k', role: 'school_admin', branchId: null },
  { id: 'u-rohan', name: 'Mr. Rohan Das', username: 'rohan.d', role: 'branch_admin', branchId: 'b-north' },
  { id: 'u-priya', name: 'Ms. Priya Raman', username: 'priya.r', role: 'teacher', branchId: 'b-north' },
  { id: 'u-vikram', name: 'Mr. Vikram Joshi', username: 'vikram.j', role: 'teacher', branchId: 'b-south' },
  { id: 'u-sana', name: 'Ms. Sana Qureshi', username: 'sana.q', role: 'teacher', branchId: 'b-south' },
];

type S = [id: string, name: string, sectionId: string, status?: StudentStatus];
const students: S[] = [
  ['u-aarav', 'Aarav Mehta', 's-n5'], ['u-ishaan', 'Ishaan Verma', 's-n5'], ['u-anaya', 'Anaya Gupta', 's-n5'],
  ['u-diya', 'Diya Nair', 's-n7'], ['u-arjun', 'Arjun Reddy', 's-n7'], ['u-sara', 'Sara Khan', 's-n7'],
  ['u-kabir', 'Kabir Shah', 's-n7', 'pending_payment'],
  ['u-vihaan', 'Vihaan Rao', 's-n9'], ['u-myra', 'Myra Singh', 's-n9'], ['u-reyansh', 'Reyansh Pillai', 's-n9', 'lapsed'],
  ['u-meera', 'Meera Iyer', 's-n11'], ['u-neil', 'Neil Fernandes', 's-n11'], ['u-tara', 'Tara Bose', 's-n11'],
  ['u-advik', 'Advik Malhotra', 's-s5'], ['u-zoya', 'Zoya Ahmed', 's-s5'], ['u-rudra', 'Rudra Patil', 's-s5', 'pending_payment'],
  ['u-kiara', 'Kiara Menon', 's-s8'], ['u-aditya', 'Aditya Joshi', 's-s8'], ['u-navya', 'Navya Desai', 's-s8'],
  ['u-samar', 'Samar Chopra', 's-s10'], ['u-riya', 'Riya Kapoor', 's-s10'], ['u-yash', 'Yash Bhatt', 's-s10', 'removed'],
  ['u-ananya', 'Ananya Das', 's-s12'], ['u-dev', 'Dev Sharma', 's-s12'],
];

const users: CoreUser[] = [
  ...staff,
  ...students.map(([id, name, sectionId, status]): CoreUser => {
    const sec = sections.find((s) => s.id === sectionId)!;
    return {
      id, name, sectionId, branchId: sec.branchId, grade: sec.grade, role: 'student',
      username: name.toLowerCase().replace(/[^a-z]+/g, '.'), status: status ?? 'active',
    };
  }),
];

export const coreSeed: CoreSeed = {
  school: { id: 'sch-greenfield', name: 'Greenfield International School' },
  branches, sections, subjects, users,
};

export const CORE_KEY = 'core';
