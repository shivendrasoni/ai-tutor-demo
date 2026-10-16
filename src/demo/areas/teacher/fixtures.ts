/** Hand-written teacher/content fixtures, keyed by the ids in `core/seed-core.ts`. */

export type IngestStatus = 'queued' | 'processing' | 'ready' | 'failed';
/** Same shape as the real `ContentItemRow`, with dates stored as ISO strings. */
export type StoredItem = {
  id: string; schoolId: string; scope: 'school' | 'branch' | 'section'; kind: 'book' | 'material';
  grade: number; subjectId: string; subjectName: string; branchId: string | null; sectionId: string | null;
  title: string; status: IngestStatus; ingestError: string | null; pageCount: number | null;
  ocrPages: number; ocrSkippedPages: number; sizeBytes: number; uploadedBy: string;
  createdAt: string; updatedAt: string; excludedBranchIds: string[];
};

export type Assignment = { teacherId: string; sectionId: string; subjectId: string };
export type Chapter = { id: string; title: string; difficulty: number };
export type ChapterScore = { ratio: number; attempts: number };
export type UsageEntry = { m7: number; m30: number; hoursAgo: number };

export type TeacherSlice = {
  assignments: Assignment[];
  /** Chapters per grade and subject, keyed `${grade}:${subjectId}`. */
  chapters: Record<string, Chapter[]>;
  /** studentId -> chapterId -> score. Missing entry means not attempted. */
  progress: Record<string, Record<string, ChapterScore>>;
  usage: Record<string, UsageEntry>;
  content: StoredItem[];
};

const SCHOOL = 'sch-greenfield';

export const assignments: Assignment[] = [
  { teacherId: 'u-priya', sectionId: 's-n7', subjectId: 'sub-math' },
  { teacherId: 'u-priya', sectionId: 's-n9', subjectId: 'sub-math' },
  { teacherId: 'u-priya', sectionId: 's-n9', subjectId: 'sub-sci' },
  { teacherId: 'u-priya', sectionId: 's-n11', subjectId: 'sub-math' },
  { teacherId: 'u-vikram', sectionId: 's-s8', subjectId: 'sub-sci' },
  { teacherId: 'u-vikram', sectionId: 's-s10', subjectId: 'sub-sci' },
  { teacherId: 'u-vikram', sectionId: 's-s12', subjectId: 'sub-math' },
  { teacherId: 'u-sana', sectionId: 's-s5', subjectId: 'sub-eng' },
  { teacherId: 'u-sana', sectionId: 's-s5', subjectId: 'sub-math' },
  { teacherId: 'u-sana', sectionId: 's-s8', subjectId: 'sub-eng' },
  { teacherId: 'u-sana', sectionId: 's-s10', subjectId: 'sub-soc' },
];

// difficulty: how much harder than average the chapter is (subtracted from a student's base mastery).
const ch = (grade: number, subj: string, titles: [string, number][]): [string, Chapter[]] => [
  `${grade}:sub-${subj}`,
  titles.map(([title, difficulty], i) => ({ id: `ch-${grade}-${subj}-${i + 1}`, title, difficulty })),
];

export const chapters: Record<string, Chapter[]> = Object.fromEntries([
  ch(5, 'math', [['Shapes and Angles', 0], ['How Many Squares?', 0.05], ['Parts and Wholes', 0.12], ['Does it Look the Same?', 0.04], ['Be My Multiple, I’ll be Your Factor', 0.14]]),
  ch(5, 'eng', [['Ice-cream Man', 0], ['Wonderful Waste!', 0.03], ['Teamwork', 0.08], ['Flying Together', 0.05], ['My Shadow', 0.1]]),
  ch(7, 'math', [['Integers', 0], ['Fractions and Decimals', 0.1], ['Data Handling', 0.04], ['Simple Equations', 0.16], ['Lines and Angles', 0.08], ['The Triangle and its Properties', 0.14]]),
  ch(8, 'sci', [['Crop Production and Management', 0], ['Microorganisms: Friend and Foe', 0.06], ['Combustion and Flame', 0.12], ['Force and Pressure', 0.15], ['Light', 0.1]]),
  ch(8, 'eng', [['The Best Christmas Present in the World', 0], ['The Tsunami', 0.04], ['Glimpses of the Past', 0.12], ['Bepin Choudhury’s Lapse of Memory', 0.09]]),
  ch(9, 'math', [['Number Systems', 0], ['Polynomials', 0.14], ['Coordinate Geometry', 0.05], ['Linear Equations in Two Variables', 0.1], ['Lines and Angles', 0.06], ['Triangles', 0.18]]),
  ch(9, 'sci', [['Matter in Our Surroundings', 0], ['Is Matter Around Us Pure?', 0.12], ['Atoms and Molecules', 0.17], ['The Fundamental Unit of Life', 0.08], ['Motion', 0.2]]),
  ch(10, 'sci', [['Chemical Reactions and Equations', 0], ['Acids, Bases and Salts', 0.1], ['Metals and Non-metals', 0.08], ['Life Processes', 0.14], ['Light: Reflection and Refraction', 0.2]]),
  ch(10, 'soc', [['The Rise of Nationalism in Europe', 0], ['Nationalism in India', 0.06], ['Resources and Development', 0.04], ['Power Sharing', 0.1]]),
  ch(11, 'math', [['Sets', 0], ['Relations and Functions', 0.12], ['Trigonometric Functions', 0.2], ['Complex Numbers', 0.16], ['Permutations and Combinations', 0.22]]),
  ch(12, 'math', [['Relations and Functions', 0], ['Inverse Trigonometric Functions', 0.14], ['Matrices', 0.06], ['Determinants', 0.12], ['Continuity and Differentiability', 0.22]]),
]);

/** Base mastery (0-1), and how many chapters (from the start) the student has attempted. */
export const studentProfile: Record<string, { base: number; reach: number }> = {
  'u-diya': { base: 0.88, reach: 6 }, 'u-arjun': { base: 0.64, reach: 5 }, 'u-sara': { base: 0.47, reach: 4 }, 'u-kabir': { base: 0, reach: 0 },
  'u-vihaan': { base: 0.9, reach: 6 }, 'u-myra': { base: 0.72, reach: 5 }, 'u-reyansh': { base: 0.42, reach: 2 },
  'u-meera': { base: 0.93, reach: 5 }, 'u-neil': { base: 0.66, reach: 4 }, 'u-tara': { base: 0.55, reach: 3 },
  'u-advik': { base: 0.7, reach: 5 }, 'u-zoya': { base: 0.85, reach: 5 }, 'u-rudra': { base: 0, reach: 0 },
  'u-kiara': { base: 0.82, reach: 5 }, 'u-aditya': { base: 0.58, reach: 4 }, 'u-navya': { base: 0.74, reach: 5 },
  'u-samar': { base: 0.68, reach: 4 }, 'u-riya': { base: 0.91, reach: 4 },
  'u-ananya': { base: 0.95, reach: 5 }, 'u-dev': { base: 0.61, reach: 3 },
  'u-aarav': { base: 0.8, reach: 5 }, 'u-ishaan': { base: 0.52, reach: 3 }, 'u-anaya': { base: 0.76, reach: 4 },
};

const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
};

export function buildProgress(): TeacherSlice['progress'] {
  const out: TeacherSlice['progress'] = {};
  for (const [sid, p] of Object.entries(studentProfile)) {
    const row: Record<string, ChapterScore> = {};
    for (const list of Object.values(chapters)) {
      list.forEach((c, i) => {
        // The same student is attempting at most one grade's chapters; unrelated grades simply never match a roster.
        if (i >= p.reach) return;
        const jitter = (hash(sid + c.id) - 0.5) * 0.2;
        const ratio = Math.max(0.05, Math.min(1, p.base - c.difficulty + jitter));
        row[c.id] = { ratio: Math.round(ratio * 100) / 100, attempts: 1 + Math.floor(hash(c.id + sid) * 4) };
      });
    }
    out[sid] = row;
  }
  return out;
}

/** Tutor messages: last 7 days, last 30 days, hours since the last message. */
export const usage: Record<string, UsageEntry> = {
  'u-diya': { m7: 34, m30: 118, hoursAgo: 3 }, 'u-arjun': { m7: 12, m30: 61, hoursAgo: 20 }, 'u-sara': { m7: 3, m30: 27, hoursAgo: 96 },
  'u-kabir': { m7: 0, m30: 0, hoursAgo: -1 },
  'u-vihaan': { m7: 41, m30: 152, hoursAgo: 1 }, 'u-myra': { m7: 19, m30: 83, hoursAgo: 8 }, 'u-reyansh': { m7: 0, m30: 9, hoursAgo: 410 },
  'u-meera': { m7: 52, m30: 187, hoursAgo: 2 }, 'u-neil': { m7: 15, m30: 70, hoursAgo: 27 }, 'u-tara': { m7: 6, m30: 38, hoursAgo: 52 },
  'u-advik': { m7: 22, m30: 90, hoursAgo: 6 }, 'u-zoya': { m7: 29, m30: 104, hoursAgo: 4 }, 'u-rudra': { m7: 0, m30: 0, hoursAgo: -1 },
  'u-kiara': { m7: 25, m30: 99, hoursAgo: 5 }, 'u-aditya': { m7: 8, m30: 44, hoursAgo: 31 }, 'u-navya': { m7: 17, m30: 72, hoursAgo: 12 },
  'u-samar': { m7: 14, m30: 66, hoursAgo: 18 }, 'u-riya': { m7: 38, m30: 131, hoursAgo: 2 },
  'u-ananya': { m7: 47, m30: 169, hoursAgo: 1 }, 'u-dev': { m7: 5, m30: 31, hoursAgo: 70 },
  'u-aarav': { m7: 21, m30: 85, hoursAgo: 7 }, 'u-ishaan': { m7: 9, m30: 40, hoursAgo: 44 }, 'u-anaya': { m7: 16, m30: 68, hoursAgo: 15 },
};

const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

type Seed = {
  title: string; grade: number; subject: string; scope: 'school' | 'branch' | 'section'; kind: 'book' | 'material';
  by: string; days: number; branch?: string; section?: string; pages?: number; mb?: number;
  status?: StoredItem['status']; error?: string; ocrSkipped?: number; excluded?: string[];
};
const SUBJ: Record<string, string> = { math: 'Mathematics', sci: 'Science', eng: 'English', soc: 'Social Studies' };

const seeds: Seed[] = [
  ...([5, 6, 7, 8, 9, 10, 11, 12] as const).flatMap((g): Seed[] => [
    { title: `Mathematics Textbook, Class ${g}`, grade: g, subject: 'math', scope: 'school', kind: 'book', by: 'u-anita', days: 60, pages: 180 + g * 14, mb: 12 + g },
    { title: `Science Textbook, Class ${g}`, grade: g, subject: 'sci', scope: 'school', kind: 'book', by: 'u-anita', days: 60, pages: 210 + g * 12, mb: 16 + g, ocrSkipped: g === 9 ? 3 : 0 },
  ]),
  { title: 'English Reader, Class 5: Marigold', grade: 5, subject: 'eng', scope: 'school', kind: 'book', by: 'u-anita', days: 58, pages: 164, mb: 14 },
  { title: 'English Reader, Class 8: Honeydew', grade: 8, subject: 'eng', scope: 'school', kind: 'book', by: 'u-anita', days: 58, pages: 152, mb: 13 },
  { title: 'Social Studies, Class 10: Contemporary India II', grade: 10, subject: 'soc', scope: 'school', kind: 'book', by: 'u-anita', days: 57, pages: 128, mb: 11, excluded: ['b-south'] },
  { title: 'Class 9 Science: Chapter 8, Motion (extended notes)', grade: 9, subject: 'sci', scope: 'branch', kind: 'book', by: 'u-rohan', days: 21, branch: 'b-north', pages: 22, mb: 2 },
  { title: 'Class 7 Mathematics: Integers Practice Set', grade: 7, subject: 'math', scope: 'branch', kind: 'material', by: 'u-rohan', days: 14, branch: 'b-north', pages: 12, mb: 1 },
  { title: 'Class 10 Science: Board Revision Pack', grade: 10, subject: 'sci', scope: 'branch', kind: 'book', by: 'u-sana', days: 12, branch: 'b-south', pages: 64, mb: 5 },
  { title: 'Fractions and Decimals Worksheets (7-A)', grade: 7, subject: 'math', scope: 'section', kind: 'material', by: 'u-priya', days: 9, branch: 'b-north', section: 's-n7', pages: 8, mb: 1 },
  { title: 'Algebra Revision Notes (9-A)', grade: 9, subject: 'math', scope: 'section', kind: 'material', by: 'u-priya', days: 6, branch: 'b-north', section: 's-n9', pages: 14, mb: 1 },
  { title: 'Trigonometry Formula Sheet (11-A)', grade: 11, subject: 'math', scope: 'section', kind: 'material', by: 'u-priya', days: 4, branch: 'b-north', section: 's-n11', pages: 4, mb: 1, status: 'processing' },
  { title: 'Handwritten Chemistry Notes (9-A)', grade: 9, subject: 'sci', scope: 'section', kind: 'material', by: 'u-priya', days: 3, branch: 'b-north', section: 's-n9', pages: 18, mb: 38, status: 'failed', error: 'Could not extract text: the scan is too low quality to read. Upload a clearer copy and retry.' },
  { title: 'Reading Comprehension Pack (5-B)', grade: 5, subject: 'eng', scope: 'section', kind: 'material', by: 'u-sana', days: 8, branch: 'b-south', section: 's-s5', pages: 10, mb: 1 },
  { title: 'Light: Ray Diagram Practice (8-B)', grade: 8, subject: 'sci', scope: 'section', kind: 'material', by: 'u-vikram', days: 5, branch: 'b-south', section: 's-s8', pages: 6, mb: 1 },
  { title: 'Matrices Problem Set (12-B)', grade: 12, subject: 'math', scope: 'section', kind: 'material', by: 'u-vikram', days: 2, branch: 'b-south', section: 's-s12', pages: 16, mb: 2 },
];

export function buildContent(): StoredItem[] {
  return seeds.map((s, i): StoredItem => {
    const status = s.status ?? 'ready';
    return {
      id: `ci-${String(i + 1).padStart(3, '0')}`,
      schoolId: SCHOOL,
      scope: s.scope,
      kind: s.kind,
      grade: s.grade,
      subjectId: `sub-${s.subject}`,
      subjectName: SUBJ[s.subject]!,
      branchId: s.branch ?? null,
      sectionId: s.section ?? null,
      title: s.title,
      status,
      ingestError: s.error ?? null,
      pageCount: status === 'ready' ? s.pages ?? null : null,
      ocrPages: 0,
      ocrSkippedPages: s.ocrSkipped ?? 0,
      sizeBytes: Math.round((s.mb ?? 1) * 1024 * 1024),
      uploadedBy: s.by,
      createdAt: iso(s.days),
      updatedAt: status === 'processing' ? new Date(Date.now() - 60_000).toISOString() : iso(s.days),
      excludedBranchIds: s.excluded ?? [],
    };
  });
}

export const buildSeed = (): TeacherSlice => ({
  assignments, chapters, progress: buildProgress(), usage, content: buildContent(),
});
