/**
 * Seeds a complete demo school into the dev database: staff, sections, students in every status, ingested
 * books and materials, and learning history (chats, graded practice tests, notes, flagged messages).
 * Additive and idempotent: it only creates "Greenfield Public School" and does nothing if that school exists.
 * Usage: pnpm seed:demo
 * Books are embedded with whatever EMBEDDER the app is configured with, so tutor search works in the running app.
 */
import './env';
import { eq, sql } from 'drizzle-orm';
import { closeDb, withPlatform } from '@/db/client';
import {
  artifacts, attempts, chunks, contentChapters, contentItems, conversations, messages, schools, skills,
  usageDaily, users,
} from '@/db/schema';
import {
  InMemoryQueue, getDeps, runIngest, setDepsForTest, uploadContent, type ContentScope,
} from '@/modules/content';
import { listActivePlans, createPlan, lapseExpired, recordPayment, signupWithCode } from '@/modules/enrollment';
import {
  assignTeacher, createBranch, createSchool, createSection, createStaffUser, createSubject, hashPassword,
  type Actor,
} from '@/modules/tenancy';
import { seedSkills } from '@/modules/tutor/skills';
import { buildPdf } from '../tests/helpers/pdfs';
import { DEMO_BOOKS, pageTexts } from './demo/curriculum';
import { QUESTIONS, type DemoQuestion } from './demo/questions';

const SCHOOL_NAME = 'Greenfield Public School';
const PASSWORD = 'demo-pass-123';
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number, hour = 16) => new Date(NOW.getTime() - days * DAY - (NOW.getUTCHours() - hour) * 3_600_000);

const SYNTHETIC: Actor = { userId: '00000000-0000-0000-0000-000000000000', isPlatformAdmin: true, schoolId: null, branchId: null, roles: [] };

type Creds = { role: string; name: string; username: string };
const creds: Creds[] = [];

// ---------------------------------------------------------------------------------------------------------------

async function existingSchool(): Promise<string | null> {
  const [row] = await withPlatform((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.name, SCHOOL_NAME)));
  return row?.id ?? null;
}

async function ensurePlatformAdmin(): Promise<Actor> {
  const username = 'demo_platform';
  let [u] = await withPlatform((tx) => tx.select({ id: users.id }).from(users).where(eq(users.username, username)));
  if (!u) {
    const passwordHash = await hashPassword(PASSWORD);
    [u] = await withPlatform((tx) =>
      tx.insert(users).values({ username, passwordHash, name: 'Demo Platform Admin', isPlatformAdmin: true }).returning({ id: users.id }),
    );
  }
  creds.push({ role: 'platform admin', name: 'Demo Platform Admin', username });
  return { ...SYNTHETIC, userId: u.id };
}

async function ensurePlanId(platform: Actor): Promise<string> {
  const plan = (await listActivePlans()).find((p) => p.interval === 'monthly' && p.priceMinor === 49900);
  return plan?.id ?? (await createPlan(platform, { name: 'Monthly', interval: 'monthly', priceMinor: 49900 })).id;
}

// ---------------------------------------------------------------------------------------------------------------

type World = {
  schoolId: string;
  platform: Actor;
  planId: string;
  branches: Record<'Main Campus' | 'North Campus', { id: string; code: string }>;
  sections: Record<string, string>; // "Main Campus:8-A" -> id
  subjects: Record<string, string>;
  admin: Actor;
  teachers: Record<'math' | 'sci', Actor>;
};

async function seedStructure(platform: Actor, planId: string): Promise<World> {
  const { id: schoolId } = await createSchool(platform, { name: SCHOOL_NAME, board: 'CBSE' });
  const mk = (id: string, branchId: string | null, role: Actor['roles'][number]): Actor => ({
    userId: id, isPlatformAdmin: false, schoolId, branchId, roles: [role],
  });
  const staff = async (role: 'school_admin' | 'branch_admin' | 'teacher', username: string, name: string, branchId: string | null) => {
    const { userId } = await createStaffUser(platform, { schoolId, branchId, role, username, password: PASSWORD, name });
    creds.push({ role: role.replace('_', ' '), name, username });
    return mk(userId, branchId, role);
  };

  const admin = await staff('school_admin', 'demo_admin', 'Sunita Rao (School Admin)', null);
  const main = await createBranch(admin, { schoolId, name: 'Main Campus' });
  const north = await createBranch(admin, { schoolId, name: 'North Campus' });
  const branches = { 'Main Campus': { id: main.id, code: main.signupCode }, 'North Campus': { id: north.id, code: north.signupCode } };

  await staff('branch_admin', 'demo_branch_admin', 'Vikram Desai (Main Campus Admin)', main.id);
  const math = await staff('teacher', 'demo_teacher_math', 'Priya Nair (Maths Teacher)', main.id);
  const sci = await staff('teacher', 'demo_teacher_science', 'Arjun Mehta (Science Teacher)', main.id);

  const subjects: Record<string, string> = {};
  for (const name of ['Mathematics', 'Science']) subjects[name] = (await createSubject(admin, { schoolId, name })).id;

  const sections: Record<string, string> = {};
  const addSection = async (branch: keyof typeof branches, grade: number, name: string) => {
    sections[`${branch}:${name}`] = (await createSection(admin, { branchId: branches[branch].id, grade, name })).id;
  };
  await addSection('Main Campus', 8, '8-A');
  await addSection('Main Campus', 8, '8-B');
  await addSection('Main Campus', 9, '9-A');
  await addSection('North Campus', 8, '8-A');

  for (const sec of ['8-A', '8-B']) {
    await assignTeacher(admin, { teacherId: math.userId, sectionId: sections[`Main Campus:${sec}`], subjectId: subjects.Mathematics });
    await assignTeacher(admin, { teacherId: sci.userId, sectionId: sections[`Main Campus:${sec}`], subjectId: subjects.Science });
  }
  await assignTeacher(admin, { teacherId: math.userId, sectionId: sections['Main Campus:9-A'], subjectId: subjects.Mathematics });

  return { schoolId, platform, planId, branches, sections, subjects, admin, teachers: { math, sci } };
}

// ---------------------------------------------------------------------------------------------------------------

async function seedContent(w: World): Promise<Record<string, string>> {
  setDepsForTest({ queue: new InMemoryQueue() }); // ingest inline below; blobs/embedder/ocr stay env-driven
  const { blobs, embedder, ocr } = getDeps();
  const ids: Record<string, string> = {};
  for (const book of DEMO_BOOKS) {
    const pages = pageTexts(book);
    for (const p of pages) if (p.length < 200) throw new Error(`demo page too short for ${book.key}`);
    const bytes = await buildPdf({ pages });
    const branch = book.branch ? w.branches[book.branch] : undefined;
    const actor = book.key === 'worksheet8a' ? w.teachers.math : w.admin;
    const { id } = await uploadContent(actor, {
      scope: book.scope as ContentScope,
      schoolId: w.schoolId,
      branchId: branch?.id,
      sectionId: book.section && book.branch ? w.sections[`${book.branch}:${book.section}`] : undefined,
      grade: book.grade,
      subjectId: w.subjects[book.subject],
      kind: book.kind,
      title: book.title,
      file: { bytes, filename: `${book.key}.pdf` },
    });
    await runIngest({ contentItemId: id, schoolId: w.schoolId }, { blobs, embedder, ocr }, { finalAttempt: true });
    const [row] = await withPlatform((tx) =>
      tx.select({ s: contentItems.ingestStatus, e: contentItems.ingestError }).from(contentItems).where(eq(contentItems.id, id)),
    );
    if (row.s !== 'ready') throw new Error(`ingest of "${book.title}" ended ${row.s}: ${row.e}`);
    ids[book.key] = id;
    console.log(`  ingested ${book.title} (${book.chapters.length} chapter${book.chapters.length > 1 ? 's' : ''})`);
  }
  setDepsForTest(null);
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------

type Student = {
  key: string; username: string; name: string; grade: number; branch: 'Main Campus' | 'North Campus'; section: string;
  state: 'active' | 'lapsed' | 'pending'; paidDaysAgo?: number;
};
const STUDENTS: Student[] = [
  { key: 'aarav', username: 'demo_aarav', name: 'Aarav Sharma', grade: 8, branch: 'Main Campus', section: '8-A', state: 'active', paidDaysAgo: 9 },
  { key: 'meera', username: 'demo_meera', name: 'Meera Iyer', grade: 8, branch: 'Main Campus', section: '8-A', state: 'active', paidDaysAgo: 12 },
  { key: 'rohan', username: 'demo_rohan', name: 'Rohan Gupta', grade: 8, branch: 'Main Campus', section: '8-B', state: 'active', paidDaysAgo: 5 },
  { key: 'ananya', username: 'demo_ananya', name: 'Ananya Singh', grade: 9, branch: 'Main Campus', section: '9-A', state: 'active', paidDaysAgo: 3 },
  { key: 'kabir', username: 'demo_kabir', name: 'Kabir Khan', grade: 8, branch: 'North Campus', section: '8-A', state: 'active', paidDaysAgo: 7 },
  { key: 'dev', username: 'demo_dev', name: 'Dev Malhotra (lapsed)', grade: 8, branch: 'Main Campus', section: '8-A', state: 'lapsed', paidDaysAgo: 45 },
  { key: 'isha', username: 'demo_isha', name: 'Isha Patel (awaiting payment)', grade: 8, branch: 'Main Campus', section: '8-B', state: 'pending' },
];

async function seedStudents(w: World): Promise<Record<string, Actor>> {
  const out: Record<string, Actor> = {};
  for (const s of STUDENTS) {
    const { studentUserId, subscriptionId } = await signupWithCode({
      code: w.branches[s.branch].code,
      grade: s.grade,
      sectionId: w.sections[`${s.branch}:${s.section}`],
      studentName: s.name,
      parentName: `Parent of ${s.name.split(' ')[0]}`,
      parentPhone: '9876543210',
      planId: w.planId,
      username: s.username,
      password: PASSWORD,
    });
    if (s.state !== 'pending') {
      await recordPayment(w.platform, {
        subscriptionId, amountMinor: 49900, currency: 'INR', externalRef: `DEMO-UPI-${s.key.toUpperCase()}`, paidAt: ago(s.paidDaysAgo!),
      });
    }
    creds.push({ role: `student (${s.state})`, name: `${s.name}, class ${s.grade} ${s.section}, ${s.branch}`, username: s.username });
    out[s.key] = { userId: studentUserId, isPlatformAdmin: false, schoolId: w.schoolId, branchId: w.branches[s.branch].id, roles: ['student'] };
  }
  await lapseExpired(NOW); // Dev's 45-day-old payment ran out 15 days ago
  return out;
}

// ---------------------------------------------------------------------------------------------------------------

type ChapterInfo = {
  chapterId: string; itemTitle: string; chapterTitle: string; pageStart: number; pageEnd: number;
  firstChunkId: string; chunkIds: string[];
};

async function loadChapters(w: World, itemIds: Record<string, string>): Promise<Record<string, ChapterInfo>> {
  const out: Record<string, ChapterInfo> = {};
  for (const book of DEMO_BOOKS) {
    const rows = await withPlatform((tx) =>
      tx.select().from(contentChapters).where(eq(contentChapters.contentItemId, itemIds[book.key])).orderBy(contentChapters.ordinal),
    );
    for (const [i, ch] of rows.entries()) {
      const cs = await withPlatform((tx) =>
        tx.select({ id: chunks.id }).from(chunks).where(eq(chunks.chapterId, ch.id)).orderBy(chunks.ordinal),
      );
      out[`${book.key}:${i}`] = {
        chapterId: ch.id, itemTitle: book.title, chapterTitle: ch.title, pageStart: ch.pageStart, pageEnd: ch.pageEnd,
        firstChunkId: cs[0].id, chunkIds: cs.map((c) => c.id),
      };
    }
  }
  return out;
}

async function skillIds(): Promise<Record<string, string>> {
  const rows = await withPlatform((tx) => tx.select({ id: skills.id, key: skills.key }).from(skills));
  return Object.fromEntries(rows.map((r) => [r.key, r.id]));
}

/** One practice test for `student` on chapter `ref`, with one graded attempt per entry in `attemptsSpec`. */
async function seedPractice(
  w: World, sk: Record<string, string>, chapters: Record<string, ChapterInfo>, student: Actor,
  ref: string, attemptsSpec: { daysAgo: number; wrong: number[]; shortScore: number }[], createdDaysAgo: number,
): Promise<void> {
  const book = DEMO_BOOKS.find((b) => b.key === ref.split(':')[0])!;
  const ch = chapters[ref];
  const bank: DemoQuestion[] = QUESTIONS[ref];
  const sources = Object.fromEntries(
    ch.chunkIds.map((id) => [id, { itemTitle: ch.itemTitle, chapterTitle: ch.chapterTitle, pageStart: ch.pageStart, pageEnd: ch.pageEnd }]),
  );
  const stored = bank.map((q, i) => ({
    id: `q${i + 1}`, type: q.type, prompt: q.prompt, marks: q.marks, chapterId: ch.chapterId, passageRefs: [], chunkIds: [ch.firstChunkId],
    ...(q.type === 'mcq' ? { options: q.options, correctIndex: q.correct } : { modelAnswer: q.modelAnswer, rubric: q.rubric }),
  }));
  const subjectId = w.subjects[book.subject];
  const [art] = await withPlatform((tx) =>
    tx.insert(artifacts).values({
      schoolId: w.schoolId, studentId: student.userId, skillId: sk.practice_test_generator, type: 'practice_test', subjectId,
      chapterIds: [ch.chapterId], params: { questionCount: bank.length, chapterTitles: { [ch.chapterId]: ch.chapterTitle } },
      status: 'ready', content: { title: `Practice test: ${ch.chapterTitle}`, questions: stored, sources },
      sourceChunkIds: [ch.firstChunkId], createdAt: ago(createdDaysAgo),
    }).returning({ id: artifacts.id }),
  );
  for (const a of attemptsSpec) {
    const results: Record<string, { score: number; maxScore: number; feedback?: string; correct?: boolean }> = {};
    const answers: Record<string, number | string> = {};
    let scored = 0;
    let max = 0;
    bank.forEach((q, i) => {
      const id = `q${i + 1}`;
      max += q.marks;
      if (q.type === 'mcq') {
        const wrong = a.wrong.includes(i);
        const pick = wrong ? (q.correct + 1) % 4 : q.correct;
        answers[id] = pick;
        results[id] = { score: wrong ? 0 : 1, maxScore: 1, correct: !wrong };
        if (!wrong) scored += 1;
      } else {
        answers[id] = q.modelAnswer.split('. ')[0] + '.';
        results[id] = {
          score: a.shortScore, maxScore: 2,
          feedback: a.shortScore >= 2 ? 'Complete and clearly explained. Well done.' : a.shortScore >= 1 ? 'Good start, but a key step is missing. Compare with the textbook page cited.' : 'This does not answer the question yet. Re-read the cited passage and try again.',
        };
        scored += a.shortScore;
      }
    });
    const at = ago(a.daysAgo);
    await withPlatform((tx) =>
      tx.insert(attempts).values({
        schoolId: w.schoolId, artifactId: art.id, studentId: student.userId, status: 'graded',
        startedAt: new Date(at.getTime() - 12 * 60_000), submittedAt: at, gradedAt: at, answers, results,
        score: String(scored), maxScore: String(max), byChapter: { [ch.chapterId]: { scored, max } },
      }),
    );
  }
}

async function seedNotes(w: World, sk: Record<string, string>, chapters: Record<string, ChapterInfo>, student: Actor) {
  const ch = chapters['science8:1'];
  const sources = Object.fromEntries(
    ch.chunkIds.map((id) => [id, { itemTitle: ch.itemTitle, chapterTitle: ch.chapterTitle, pageStart: ch.pageStart, pageEnd: ch.pageEnd }]),
  );
  const section = (heading: string, bodyMarkdown: string) => ({ heading, bodyMarkdown, chapterId: ch.chapterId, passageRefs: [], chunkIds: [ch.firstChunkId] });
  await withPlatform((tx) =>
    tx.insert(artifacts).values({
      schoolId: w.schoolId, studentId: student.userId, skillId: sk.study_notes_generator, type: 'study_notes', subjectId: w.subjects.Science,
      chapterIds: [ch.chapterId], params: { chapterTitles: { [ch.chapterId]: ch.chapterTitle } }, status: 'ready',
      content: {
        title: 'Study notes: Microorganisms, Friend and Foe',
        sections: [
          section('What are microorganisms?', 'Living things too small to see without a microscope: **bacteria, fungi, protozoa**, some algae, and viruses (which only multiply inside a host cell).\n\n- Found in air, water, soil and inside plants and animals.'),
          section('Useful microorganisms', '- **Yeast** makes bread rise (it releases carbon dioxide) and is used in fermentation.\n- **Lactobacillus** turns milk into curd.\n- Bacteria in the **root nodules of pulses** fix nitrogen.\n- Decomposers turn dead matter into manure.'),
          section('Harmful microorganisms', '- Pathogens cause **cholera, typhoid, TB** (bacteria), **malaria** (protozoan, spread by female *Anopheles*) and **dengue** (virus, spread by *Aedes*).\n- Food is preserved with **salt, sugar, vinegar, heating/cooling** and sealed packaging.\n- **Vaccines** train the body to make antibodies; **antibiotics** kill bacteria and need a doctor\'s advice.'),
        ],
        sources,
      },
      sourceChunkIds: [ch.firstChunkId], createdAt: ago(2),
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------

type Exchange = { q: string; a: string };
type Convo = {
  student: string; skill: 'socratic' | 'explain'; subject: 'Mathematics' | 'Science'; ref: string; daysAgo: number; title: string;
  exchanges: Exchange[]; flag?: { reason: string; onExchange: number };
};

const CONVOS: Convo[] = [
  {
    student: 'aarav', skill: 'socratic', subject: 'Mathematics', ref: 'maths8:0', daysAgo: 6, title: 'Rational numbers between two numbers',
    exchanges: [
      { q: 'How do I find a rational number between 1/4 and 1/2?', a: 'Good question. Before I show you a method: if you had two numbers like 4 and 6, how would you find one that sits exactly between them? Think about it and tell me what you did. [1]' },
      { q: 'I would add them and divide by 2, so 5', a: 'Exactly. The same idea works for fractions: the mean of two rational numbers lies between them. Can you try it with 1/4 and 1/2? Start by writing both with the same denominator. [1]' },
      { q: '1/4 + 2/4 = 3/4, then divide by 2 so 3/8', a: 'Yes, 3/8 lies between 1/4 and 1/2 (that is 2/8 and 4/8). Nice work. How many more rational numbers do you think there are between those two? [1]' },
    ],
  },
  {
    student: 'aarav', skill: 'explain', subject: 'Science', ref: 'science8:1', daysAgo: 3, title: 'Why does curd form?',
    exchanges: [
      { q: 'Explain how milk turns into curd', a: 'Milk turns into curd because of **Lactobacillus** bacteria. A small spoonful of curd added to warm milk contains these bacteria; they multiply overnight and turn the milk sugar into lactic acid, which makes the milk thicken and taste sour. [1]' },
      { q: 'Is it the same bacteria that cause disease?', a: 'No. Most microorganisms are harmless or useful. Disease-causing ones are called **pathogens**, for example the bacteria behind cholera and typhoid. Lactobacillus is a friendly bacterium, and it is the same kind that lives in our gut. [1]' },
    ],
  },
  {
    student: 'aarav', skill: 'socratic', subject: 'Mathematics', ref: 'maths8:1', daysAgo: 1, title: 'Solving equations with x on both sides',
    exchanges: [
      { q: 'how to solve 5x - 3 = 2x + 9', a: 'Let us do it together. We want all the x terms on one side. What could you do to both sides of the equation to remove the 2x on the right? [1]' },
      { q: 'subtract 2x from both sides?', a: 'Yes. What does the equation look like after that? [1]' },
      { q: '3x - 3 = 9 so 3x = 12 and x = 4', a: 'Correct, x = 4. A good habit is to check: put x = 4 into both sides. What do you get on the left and on the right? [1]' },
    ],
  },
  {
    student: 'aarav', skill: 'explain', subject: 'Science', ref: 'science8:3', daysAgo: 0, title: 'Why is AMBULANCE written backwards?',
    exchanges: [
      { q: 'why is ambulance written reversed on the vehicle', a: 'A plane mirror produces **lateral inversion**: the left of the object appears on the right in the image. So the word AMBULANCE is painted reversed on the front, and a driver looking in the rear-view mirror sees it the right way round and can make way. [1]' },
    ],
  },
  {
    student: 'meera', skill: 'explain', subject: 'Mathematics', ref: 'maths8:3', daysAgo: 8, title: 'Square roots by prime factorisation',
    exchanges: [
      { q: 'How can I find the square root of 144 without a calculator?', a: 'Use prime factorisation. 144 = 2 x 2 x 2 x 2 x 3 x 3. Group the factors in pairs and take one from each pair: 2 x 2 x 3 = 12, so the square root of 144 is 12. [1]' },
      { q: 'and what about 2? it is not a perfect square', a: 'Right: 2 is not a perfect square, so its square root is not a rational number. We estimate it. 1.41 is a good approximation, since 1.41 x 1.41 is about 1.99. [1]' },
    ],
  },
  {
    student: 'meera', skill: 'socratic', subject: 'Science', ref: 'science8:0', daysAgo: 4, title: 'Kharif and Rabi crops',
    exchanges: [
      { q: 'what is the difference between kharif and rabi', a: 'Think about the seasons first. Which crops do you think need the monsoon rains to grow, and which ones grow in the cooler, drier winter months? Give me one example of each if you can. [1]' },
      { q: 'rice in monsoon and wheat in winter', a: 'Well done. Rice (paddy) is a **Kharif** crop, sown with the monsoon in June or July. Wheat is a **Rabi** crop, sown in October or November. Can you name one more of each? [1]' },
    ],
  },
  {
    student: 'rohan', skill: 'socratic', subject: 'Science', ref: 'science8:2', daysAgo: 5, title: 'Pressure and area',
    exchanges: [
      { q: 'why does a knife cut when sharp', a: 'Let us think about pressure = force / area. If you press with the same force, what happens to the pressure when the area gets smaller? Try to answer in your own words. [1]' },
      { q: 'it gets bigger?', a: 'Yes, you are right. The edge of a sharp knife has a tiny area, so the same push gives a very large pressure. Now, why do camels have wide feet? [1]' },
    ],
  },
  {
    student: 'rohan', skill: 'explain', subject: 'Mathematics', ref: 'maths8:2', daysAgo: 2, title: 'Types of quadrilaterals',
    exchanges: [
      { q: 'what is the difference between rhombus and square', a: 'A **rhombus** has four equal sides, and its diagonals cross at right angles. A **square** is a rhombus that also has four right angles (and equal diagonals), so every square is a rhombus but not every rhombus is a square. [1]' },
      { q: 'tell me the answer to my homework on the quiz question 4 directly', a: 'I will not give a homework answer directly, but I am happy to work through a similar question with you. Which property of the question can you already tell me? [1]' },
    ],
    flag: { reason: 'homework_answer_request', onExchange: 1 },
  },
  {
    student: 'ananya', skill: 'explain', subject: 'Mathematics', ref: 'maths9:1', daysAgo: 4, title: 'Factor theorem',
    exchanges: [
      { q: 'explain the factor theorem with an example', a: 'The **Factor Theorem** says x - a is a factor of p(x) exactly when p(a) = 0. Example: for p(x) = x^3 - 6x^2 + 11x - 6, p(1) = 1 - 6 + 11 - 6 = 0, so x - 1 is a factor. Dividing out gives (x - 1)(x - 2)(x - 3). [1]' },
    ],
  },
  {
    student: 'ananya', skill: 'socratic', subject: 'Mathematics', ref: 'maths9:0', daysAgo: 1, title: 'Irrational numbers',
    exchanges: [
      { q: 'is pi rational', a: 'What would it mean for pi to be rational? Recall the definition: a rational number can be written as p/q with q not zero. Do you remember what its decimal expansion would look like if it were rational? [1]' },
      { q: 'it would end or repeat', a: 'Exactly. The decimal expansion of pi neither ends nor repeats, so pi is irrational. Can you name another irrational number from this chapter? [1]' },
    ],
  },
  {
    student: 'kabir', skill: 'explain', subject: 'Science', ref: 'science8:1', daysAgo: 3, title: 'Vaccines',
    exchanges: [
      { q: 'how do vaccines work', a: 'A vaccine introduces a harmless form of a pathogen so your body learns to make **antibodies** against it. If the real pathogen arrives later, your body responds fast and you do not fall seriously ill. Edward Jenner developed the first vaccine, against smallpox. [1]' },
      { q: 'can i take antibiotics for a cold', a: 'Antibiotics kill bacteria, and a cold is caused by a virus, so they will not help. Antibiotics should be taken only on a doctor\'s advice. [1]' },
    ],
  },
  {
    student: 'kabir', skill: 'socratic', subject: 'Science', ref: 'science8:3', daysAgo: 0, title: 'Dispersion of light',
    exchanges: [
      { q: 'what is a rainbow', a: 'A great question. When you see white light pass through a glass prism, what do you notice comes out of the other side? Think about how that could happen in the sky with raindrops. [1]' },
    ],
  },
];

async function seedConversations(w: World, sk: Record<string, string>, chapters: Record<string, ChapterInfo>, students: Record<string, Actor>) {
  const perDay = new Map<string, { schoolId: string; studentId: string; date: string; tokens: number; cost: number }>();
  for (const c of CONVOS) {
    const student = students[c.student];
    const ch = chapters[c.ref];
    const start = ago(c.daysAgo, 15);
    await withPlatform(async (tx) => {
      const [conv] = await tx.insert(conversations).values({
        schoolId: w.schoolId, studentId: student.userId, skillId: sk[c.skill], subjectId: w.subjects[c.subject], title: c.title,
        createdAt: start, updatedAt: new Date(start.getTime() + c.exchanges.length * 3 * 60_000),
      }).returning({ id: conversations.id });
      for (const [i, ex] of c.exchanges.entries()) {
        const t = new Date(start.getTime() + i * 3 * 60_000);
        const flagged = c.flag?.onExchange === i;
        const tokensIn = 350 + ex.q.length * 3;
        const tokensOut = 120 + ex.a.length / 2;
        await tx.insert(messages).values({
          schoolId: w.schoolId, conversationId: conv.id, role: 'user', content: ex.q, createdAt: t,
        });
        await tx.insert(messages).values({
          schoolId: w.schoolId, conversationId: conv.id, role: 'assistant', content: ex.a, createdAt: new Date(t.getTime() + 20_000),
          flagged, flagReason: flagged ? c.flag!.reason : null,
          citations: [{ n: 1, chunkId: ch.firstChunkId, itemTitle: ch.itemTitle, chapterTitle: ch.chapterTitle, pageStart: ch.pageStart, pageEnd: ch.pageEnd }],
          retrievedChunkIds: [ch.firstChunkId],
          decisions: { tier: i === 2 ? 'advanced' : 'standard' },
          model: 'demo/standard', modelTier: i === 2 ? 'advanced' : 'standard', tokensIn, tokensOut: Math.round(tokensOut),
          cost: String((tokensIn * 0.1 + tokensOut * 0.5) / 1_000_000), latencyMs: 900 + i * 350,
        });
        const date = t.toISOString().slice(0, 10);
        const key = `${student.userId}:${date}`;
        const row = perDay.get(key) ?? { schoolId: w.schoolId, studentId: student.userId, date, tokens: 0, cost: 0 };
        row.tokens += tokensIn + Math.round(tokensOut);
        row.cost += (tokensIn * 0.1 + tokensOut * 0.5) / 1_000_000;
        perDay.set(key, row);
      }
    });
  }
  for (const r of perDay.values()) {
    await withPlatform((tx) =>
      tx.insert(usageDaily).values({ schoolId: r.schoolId, studentId: r.studentId, date: r.date, tokens: r.tokens, cost: String(r.cost) })
        .onConflictDoUpdate({ target: [usageDaily.studentId, usageDaily.date], set: { tokens: sql`${usageDaily.tokens} + ${r.tokens}` } }),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------

async function main() {
  if (await existingSchool()) {
    console.log(`"${SCHOOL_NAME}" already exists, nothing to do. To re-seed, delete that school's data or use a fresh database.`);
    return;
  }
  console.log('Seeding demo data...');
  await seedSkills();
  const platform = await ensurePlatformAdmin();
  const planId = await ensurePlanId(platform);
  const w = await seedStructure(platform, planId);
  console.log('  school, branches, sections, staff');
  const itemIds = await seedContent(w);
  const students = await seedStudents(w);
  console.log('  students');
  const chapters = await loadChapters(w, itemIds);
  const sk = await skillIds();

  const A = students;
  // Aarav (the main demo student): a mix of strong and weak chapters, one retaken test showing improvement.
  await seedPractice(w, sk, chapters, A.aarav, 'maths8:0', [{ daysAgo: 7, wrong: [1, 3], shortScore: 1 }, { daysAgo: 5, wrong: [3], shortScore: 2 }], 8);
  await seedPractice(w, sk, chapters, A.aarav, 'maths8:1', [{ daysAgo: 1, wrong: [0, 1, 2], shortScore: 0 }], 2);
  await seedPractice(w, sk, chapters, A.aarav, 'science8:0', [{ daysAgo: 4, wrong: [], shortScore: 2 }], 5);
  await seedPractice(w, sk, chapters, A.aarav, 'science8:2', [{ daysAgo: 2, wrong: [2], shortScore: 1 }], 3);
  await seedNotes(w, sk, chapters, A.aarav);
  // The rest of the class.
  await seedPractice(w, sk, chapters, A.meera, 'maths8:3', [{ daysAgo: 8, wrong: [], shortScore: 2 }], 9);
  await seedPractice(w, sk, chapters, A.meera, 'maths8:1', [{ daysAgo: 6, wrong: [3], shortScore: 2 }], 7);
  await seedPractice(w, sk, chapters, A.meera, 'science8:0', [{ daysAgo: 4, wrong: [1], shortScore: 2 }], 5);
  await seedPractice(w, sk, chapters, A.rohan, 'science8:2', [{ daysAgo: 5, wrong: [0, 1], shortScore: 0 }, { daysAgo: 3, wrong: [1], shortScore: 1 }], 6);
  await seedPractice(w, sk, chapters, A.rohan, 'maths8:0', [{ daysAgo: 2, wrong: [0, 2, 3], shortScore: 0 }], 3);
  await seedPractice(w, sk, chapters, A.ananya, 'maths9:0', [{ daysAgo: 4, wrong: [], shortScore: 2 }], 5);
  await seedPractice(w, sk, chapters, A.kabir, 'science8:1', [{ daysAgo: 3, wrong: [2], shortScore: 1 }], 4);
  await seedConversations(w, sk, chapters, students);
  console.log('  practice tests, notes, conversations');

  console.log(`\nDemo ready. Every account uses the password: ${PASSWORD}\n`);
  for (const c of creds) console.log(`  ${c.role.padEnd(22)} ${c.username.padEnd(22)} ${c.name}`);
  console.log('\nStart the app with: pnpm dev   (and pnpm worker:dev for study-tool generation)');
}

try {
  await main();
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await closeDb();
}
