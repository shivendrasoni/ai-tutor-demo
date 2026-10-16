import { chapterId, getChapter, type Band, type SubjectKey } from './curriculum';
import { buildArtifact, citationFor, gradeAnswers, questionsOf, type ArtifactType, type Citation, type StoredArtifact, type StoredAttempt } from './engine';
import type { ConvState } from './replies';

export type NumberedCitation = Citation & { n: number };
export type Conv = { id: string; studentId: string; title: string | null; skillKey: string; subjectId: string | null; updatedAt: string; state: ConvState };
export type Msg = { id: string; role: 'user' | 'assistant'; content: string; citations: NumberedCitation[]; feedback: string | null };
export type StudentSlice = {
  conversations: Conv[];
  messages: Record<string, Msg[]>;
  artifacts: StoredArtifact[];
  attempts: StoredAttempt[];
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

type Turn = [role: 'u' | 'a', text: string, cites?: [SubjectKey, number, number?][]];
type ConvSpec = { key: string; title: string; skill: 'socratic' | 'explain'; subject: SubjectKey; ago: number; turns: Turn[]; band: Band; thumbsDown?: number };

const CONVS: Record<string, ConvSpec[]> = {
  'u-aarav': [
    {
      key: 'fractions', title: 'What is a fraction?', skill: 'socratic', subject: 'sub-math', ago: 2 * HOUR, band: 'junior',
      turns: [
        ['u', "What is a fraction? My teacher wrote 3/4 on the board but I don't get it"],
        ['a', "Great question! 🍕 Let's think about a pizza together. If we cut it into **4 equal slices** and you eat **3 slices**, what do you think we should call the part you ate? Take a guess, there is no wrong answer!", [['sub-math', 0]]],
        ['u', 'is it 3 slices out of 4 slices?'],
        ['a', "Yes, exactly! 🎉 You said it perfectly: **3 slices out of 4 equal slices** is the fraction **3/4**. The bottom number (4) is how many equal slices the pizza has, and the top number (3) is how many you ate.\n\nNow a little challenge: if your friend eats the last slice, what fraction of the pizza did your friend eat?", [['sub-math', 0, 1]]],
        ['u', '1/4!!'],
        ['a', "Brilliant! 🌟 **1/4** is right. And look: 3/4 + 1/4 = 4/4, which is the **whole pizza**. Do you want to try adding some more fractions, or make your own pizza puzzle for me?"],
      ],
    },
    {
      key: 'plants', title: 'Why do plants need sunlight?', skill: 'explain', subject: 'sub-sci', ago: DAY + 3 * HOUR, band: 'junior',
      turns: [
        ['u', 'why do plants need sunlight'],
        ['a', 'Plants are like tiny kitchens! 🌱 Their green leaves catch **sunlight**, drink **water** from the roots and take in **air**, and mix them to make food. This is called **photosynthesis**, and the plant gives out oxygen for us to breathe.', [['sub-sci', 0]]],
        ['u', 'what happens if we keep a plant in a cupboard'],
        ['a', "Good thinking! Without light the plant cannot make food, so its leaves slowly turn **yellow and pale** and it becomes weak. That's why we keep plants near a window. ☀️ You can try it: keep one small plant in the dark and one in the sun for a week and compare them!", [['sub-sci', 0, 1]]],
      ],
    },
    {
      key: 'nouns', title: 'Help with my nouns homework', skill: 'socratic', subject: 'sub-eng', ago: 2 * DAY + 5 * HOUR, band: 'junior',
      turns: [
        ['u', 'help me with my homework. it says underline the proper nouns'],
        ['a', "I'm happy to help with homework! 📚 We will work it out together. What is the sentence? Type it here."],
        ['u', 'Riya went to Jaipur with her cousin on Sunday'],
        ['a', 'Let\'s be word detectives! ✏️ A **proper noun** is the special name of one person, place or day, and it starts with a **capital letter**. Look at your sentence again: which words start with a capital letter? Tell me what you find.', [['sub-eng', 0]]],
        ['u', 'Riya Jaipur Sunday'],
        ['a', "Excellent! **Riya** (a person), **Jaipur** (a place) and **Sunday** (a day) are all proper nouns. 🎉 And what about \"cousin\"? Is it a special name, or a general word for anyone who is a cousin?"],
      ],
    },
  ],
  'u-diya': [
    {
      key: 'equations', title: 'Solving 2x − 3 = 9', skill: 'socratic', subject: 'sub-math', ago: 3 * HOUR, band: 'middle',
      turns: [
        ['u', 'how do i solve 2x - 3 = 9? i keep getting a wrong answer'],
        ['a', "Let's treat the equation like a balance. Look at your equation and ask: what is being done to x, in what order? What would undo the last operation, and what must you do to the other side to keep it balanced? Try the first step and tell me what you get.", [['sub-math', 1]]],
        ['u', 'x is multiplied by 2 and then 3 is subtracted. so i add 3 to both sides? that gives 2x = 12'],
        ['a', 'Good first step! You undid the subtraction by adding 3 to **both** sides, so the balance is kept. Now you have **2x = 12**. What is the next operation you need to undo, and what does the equation look like after you do it?', [['sub-math', 1, 1]]],
        ['u', 'divide by 2, so x = 6'],
        ['a', "That's it! 🎯 The final habit of a good mathematician: substitute it back into the original equation. What is 2(6) − 3, and does it equal 9?"],
        ['u', '12 - 3 = 9 yes!!'],
        ['a', 'It checks out, so **x = 6** is correct. You found it yourself by undoing the operations in reverse order. Want to try one with brackets, like 3(x + 2) = 18?'],
      ],
    },
    {
      key: 'mughal', title: 'Why did Panipat matter?', skill: 'explain', subject: 'sub-soc', ago: DAY + 2 * HOUR, band: 'middle',
      turns: [
        ['u', 'why was the battle of panipat 1526 important for the mughals'],
        ['a', "The First Battle of Panipat (1526) is where **Babur** defeated **Ibrahim Lodi**, the last Sultan of Delhi. It mattered for three reasons:\n\n- It ended the **Delhi Sultanate**.\n- It gave Babur control of Delhi and Agra, the heart of north India.\n- Babur's cannons and well-trained cavalry showed a new way of fighting in India.\n\nIt marked the **beginning of Mughal rule**, which Akbar later strengthened.", [['sub-soc', 0], ['sub-soc', 0, 2]]],
        ['u', 'and what did akbar do to make it strong'],
        ['a', "Akbar built a strong administration. He organised the **mansabdari system** (ranks for officers), made a fair land-revenue system with help from **Todar Mal**, and followed a policy of tolerance towards different religions, which won the support of many local rulers.", [['sub-soc', 0, 1]]],
      ],
    },
    {
      key: 'photo', title: 'Photosynthesis word equation', skill: 'explain', subject: 'sub-sci', ago: 2 * DAY + 6 * HOUR, band: 'middle', thumbsDown: 1,
      turns: [
        ['u', 'what is the word equation for photosynthesis'],
        ['a', 'Photosynthesis is how green plants make food. **Chlorophyll** in the leaves traps sunlight, and the plant combines **carbon dioxide + water** to make **glucose + oxygen**.\n\n> Carbon dioxide + Water → (sunlight, chlorophyll) → Glucose + Oxygen\n\nStomata on the leaf let the gases move in and out.', [['sub-sci', 0]]],
        ['u', 'where does the plant get the carbon dioxide from'],
        ['a', 'From the **air**. Carbon dioxide enters through tiny pores called **stomata** on the underside of the leaf, while the roots take in water from the soil. The glucose that is made is used for energy or stored as **starch**.', [['sub-sci', 0, 1]]],
      ],
    },
  ],
  'u-meera': [
    {
      key: 'disc', title: 'Discriminant and nature of roots', skill: 'socratic', subject: 'sub-math', ago: 4 * HOUR, band: 'senior',
      turns: [
        ['u', 'can you help me understand how the discriminant tells us about the roots of a quadratic'],
        ['a', "Let's try to factorise x² − 5x + 6 = 0 before using any formula. Which two numbers multiply to give +6 and add to give −5? Once you have them, what must x be for each bracket to become zero? Tell me where you get stuck.", [['sub-math', 0]]],
        ['u', '-2 and -3, so (x-2)(x-3) and x = 2 or 3'],
        ['a', 'Good, the roots are 2 and 3. Now compute **b² − 4ac** for the same equation, with a = 1, b = −5, c = 6. What value do you get, and how does it relate to the fact that we found two different real roots?', [['sub-math', 0, 1]]],
        ['u', '25 - 24 = 1. positive so two real roots?'],
        ['a', 'Exactly. **D > 0** means two distinct real roots, **D = 0** means equal roots and **D < 0** means no real roots. Notice also that √D = 1 is a perfect square, which is why the roots came out rational.\n\nIf I change c from 6 to 9, what does the discriminant become, and what do you predict about the roots?', [['sub-math', 0, 2]]],
        ['u', '25 - 36 = -11 so no real roots'],
        ['a', 'Spot on. You could also see it graphically: the parabola y = x² − 5x + 9 stays above the x-axis and never crosses it. Try finding the range of k for which x² + kx + 9 = 0 has real roots.'],
      ],
    },
    {
      key: 'newton', title: "Newton's second law numerical", skill: 'explain', subject: 'sub-sci', ago: DAY + 5 * HOUR, band: 'senior',
      turns: [
        ['u', 'a 5 kg block is pushed with 20 N and friction is 5 N. find acceleration'],
        ['a', 'Use **F_net = ma**.\n\n1. Net force along the motion = applied force − friction = 20 − 5 = **15 N**.\n2. Acceleration a = F_net / m = 15 / 5 = **3 m/s²**.\n\nA common mistake is to use the 20 N directly; the block only accelerates under the **net** force.', [['sub-sci', 0], ['sub-sci', 0, 1]]],
        ['u', 'and how far does it go in 4 s starting from rest'],
        ['a', 'Using s = ut + ½at² with u = 0, a = 3 m/s² and t = 4 s: s = ½ × 3 × 16 = **24 m**. Its speed at that moment is v = at = 12 m/s.', [['sub-sci', 1]]],
      ],
    },
    {
      key: 'essay', title: 'Writing a strong thesis statement', skill: 'socratic', subject: 'sub-eng', ago: 2 * DAY + 8 * HOUR, band: 'senior', thumbsDown: 3,
      turns: [
        ['u', 'i have to write an argumentative essay on whether homework should be banned. how do i start'],
        ['a', "Good question. Before we dive in, what is your own position, and what is your single strongest reason for it? Write one sentence for each and I will help you shape them into a thesis.", [['sub-eng', 1]]],
        ['u', 'i think homework should be reduced not banned. because too much of it leaves no time to sleep or rest'],
        ['a', 'That is already close to a thesis. A strong thesis states your **claim** and your **main reason** in one sentence, and it can be argued against. Try: "Schools should reduce homework, because excessive assignments cut into the sleep and rest that students need to learn well."\n\nWhat counter-argument might a teacher raise, and how would you answer it?', [['sub-eng', 1, 1]]],
      ],
    },
  ],
};

function buildConversations(userId: string, now: number): { convs: Conv[]; messages: Record<string, Msg[]> } {
  const convs: Conv[] = [];
  const messages: Record<string, Msg[]> = {};
  for (const spec of CONVS[userId] ?? []) {
    const id = `conv-${userId}-${spec.key}`;
    const updatedAt = new Date(now - spec.ago).toISOString();
    convs.push({ id, studentId: userId, title: spec.title, skillKey: spec.skill, subjectId: spec.subject, updatedAt, state: {} });
    let asst = 0;
    messages[id] = spec.turns.map(([role, text, cites], i): Msg => {
      const isA = role === 'a';
      const citations = (cites ?? []).flatMap(([subj, idx, off], k) => {
        const ch = getChapter(chapterId(spec.band, subj, idx));
        return ch ? [{ n: k + 1, ...citationFor(ch, off ?? 0) }] : [];
      });
      if (isA) asst++;
      return { id: `${id}-m${i + 1}`, role: isA ? 'assistant' : 'user', content: text, citations, feedback: isA && spec.thumbsDown === asst ? 'down' : null };
    });
  }
  return { convs, messages };
}

type ArtSpec = { type: ArtifactType; subject: SubjectKey; chapters: number[]; ago: number; count?: number; pattern?: string; attempt?: { ago: number; style: 'strong' | 'mixed' | 'weak' } };
const ARTS: Record<string, ArtSpec[]> = {
  'u-aarav': [
    { type: 'practice_test', subject: 'sub-math', chapters: [0, 2], ago: DAY, count: 8, attempt: { ago: DAY - 10 * MIN, style: 'mixed' } },
    { type: 'mock_exam', subject: 'sub-sci', chapters: [0, 1, 3], ago: 2 * DAY, pattern: 'unit_test_30' },
    { type: 'study_notes', subject: 'sub-sci', chapters: [0, 1], ago: 3 * DAY },
    { type: 'last_night_notes', subject: 'sub-eng', chapters: [0, 1], ago: 4 * DAY },
  ],
  'u-diya': [
    { type: 'practice_test', subject: 'sub-sci', chapters: [0, 2], ago: 2 * DAY, count: 8, attempt: { ago: 2 * DAY - 15 * MIN, style: 'strong' } },
    { type: 'practice_test', subject: 'sub-math', chapters: [1], ago: DAY, count: 6, attempt: { ago: DAY - 12 * MIN, style: 'weak' } },
    { type: 'mock_exam', subject: 'sub-math', chapters: [0, 1, 2], ago: 3 * DAY, pattern: 'half_yearly_45' },
    { type: 'study_notes', subject: 'sub-soc', chapters: [0, 1], ago: 4 * DAY },
    { type: 'last_night_notes', subject: 'sub-eng', chapters: [1, 2], ago: 5 * DAY },
  ],
  'u-meera': [
    { type: 'practice_test', subject: 'sub-math', chapters: [0, 3], ago: DAY, count: 10, attempt: { ago: DAY - 20 * MIN, style: 'strong' } },
    { type: 'practice_test', subject: 'sub-sci', chapters: [0, 1], ago: 3 * DAY, count: 8, attempt: { ago: 3 * DAY - 14 * MIN, style: 'mixed' } },
    { type: 'mock_exam', subject: 'sub-sci', chapters: [0, 1, 2], ago: 2 * DAY, pattern: 'board_style_60' },
    { type: 'study_notes', subject: 'sub-sci', chapters: [0, 1], ago: 4 * DAY },
    { type: 'last_night_notes', subject: 'sub-soc', chapters: [0, 1, 2], ago: 5 * DAY },
  ],
};
const BAND_OF: Record<string, Band> = { 'u-aarav': 'junior', 'u-diya': 'middle', 'u-meera': 'senior' };

function buildStudy(userId: string, now: number): { artifacts: StoredArtifact[]; attempts: StoredAttempt[] } {
  const band = BAND_OF[userId]!;
  const artifacts: StoredArtifact[] = [];
  const attempts: StoredAttempt[] = [];
  (ARTS[userId] ?? []).forEach((s, i) => {
    const created = new Date(now - s.ago).toISOString();
    const art = buildArtifact({
      id: `art-${userId}-${i + 1}`, studentId: userId, band, type: s.type, subjectId: s.subject,
      chapterIds: s.chapters.map((c) => chapterId(band, s.subject, c)), questionCount: s.count, patternKey: s.pattern, createdAt: created, readyAt: created,
    });
    artifacts.push(art);
    if (!s.attempt) return;
    const answers: Record<string, number | string> = {};
    questionsOf(art).forEach((q, k) => {
      const wrongEvery = s.attempt!.style === 'strong' ? 7 : s.attempt!.style === 'mixed' ? 3 : 2;
      const right = (k + 1) % wrongEvery !== 0;
      if (q.type === 'mcq') answers[q.id] = right ? q.correctIndex! : (q.correctIndex! + 1) % 4;
      else answers[q.id] = right ? q.modelAnswer! : s.attempt!.style === 'weak' ? 'I am not sure about this one.' : 'It helps with the topic in the chapter.';
    });
    const g = gradeAnswers(art, answers);
    const startedAt = now - s.attempt.ago;
    attempts.push({
      id: `att-${userId}-${i + 1}`, artifactId: art.id, studentId: userId, startedAt: new Date(startedAt).toISOString(), deadline: null,
      submittedAt: new Date(startedAt + 11 * MIN).toISOString(), gradedAt: new Date(startedAt + 11 * MIN).toISOString(), answers, ...g,
    });
  });
  return { artifacts, attempts };
}

export function buildSeed(now = Date.now()): StudentSlice {
  const slice: StudentSlice = { conversations: [], messages: {}, artifacts: [], attempts: [] };
  for (const userId of Object.keys(CONVS)) {
    const c = buildConversations(userId, now);
    slice.conversations.push(...c.convs);
    Object.assign(slice.messages, c.messages);
    const s = buildStudy(userId, now);
    slice.artifacts.push(...s.artifacts);
    slice.attempts.push(...s.attempts);
  }
  return slice;
}
