export type PersonaId =
  | 'student_junior'
  | 'student_middle'
  | 'student_senior'
  | 'student_pending'
  | 'teacher'
  | 'branch_admin'
  | 'school_admin'
  | 'platform_admin';

export type Persona = {
  id: PersonaId;
  label: string;
  group: 'Student' | 'Staff' | 'Platform';
  /** Display name of the demo user. */
  name: string;
  /** Matches a user in `seed-core`; null for the platform admin. */
  userId: string | null;
  home: string;
  blurb: string;
};

export const PERSONAS: Persona[] = [
  { id: 'student_junior', label: 'Student · Grade 5', group: 'Student', name: 'Aarav Mehta', userId: 'u-aarav', home: '/learn', blurb: 'Playful junior view' },
  { id: 'student_middle', label: 'Student · Grade 7', group: 'Student', name: 'Diya Nair', userId: 'u-diya', home: '/learn', blurb: 'Middle-school view' },
  { id: 'student_senior', label: 'Student · Grade 11', group: 'Student', name: 'Meera Iyer', userId: 'u-meera', home: '/learn', blurb: 'Focused senior view' },
  { id: 'student_pending', label: 'Student · Awaiting payment', group: 'Student', name: 'Kabir Shah', userId: 'u-kabir', home: '/status', blurb: 'Signed up, not yet activated' },
  { id: 'teacher', label: 'Teacher', group: 'Staff', name: 'Ms. Priya Raman', userId: 'u-priya', home: '/teacher', blurb: 'Class progress & materials' },
  { id: 'branch_admin', label: 'Branch admin', group: 'Staff', name: 'Mr. Rohan Das', userId: 'u-rohan', home: '/school', blurb: 'One branch of the school' },
  { id: 'school_admin', label: 'School admin', group: 'Staff', name: 'Dr. Anita Kulkarni', userId: 'u-anita', home: '/school', blurb: 'Whole school' },
  { id: 'platform_admin', label: 'Platform admin', group: 'Platform', name: 'Platform Ops', userId: null, home: '/platform', blurb: 'Schools, plans, costs, flags' },
];

export const DEFAULT_PERSONA: PersonaId = 'student_middle';

export const personaById = (id: PersonaId): Persona => PERSONAS.find((p) => p.id === id) ?? PERSONAS[1]!;

export const isStudent = (id: PersonaId) => id.startsWith('student_');

/** Paths anyone may open. */
const PUBLIC = ['/login', '/join', '/invite'];

/** Personas allowed on a path; null means public. */
export function allowedPersonas(pathname: string): PersonaId[] | null {
  const under = (base: string) => pathname === base || pathname.startsWith(base + '/');
  if (PUBLIC.some(under)) return null;
  if (under('/learn')) return ['student_junior', 'student_middle', 'student_senior'];
  if (under('/status')) return ['student_pending'];
  if (under('/teacher')) return ['teacher'];
  if (under('/school')) return ['branch_admin', 'school_admin'];
  if (under('/platform')) return ['platform_admin'];
  return null;
}
