import { chaptersFor, getChapter, PATTERNS, SUBJECT_KEYS, type Band, type ChapterRef, type SubjectKey } from './curriculum';

export type Citation = { chunkId: string; itemTitle: string; chapterTitle: string; pageStart: number; pageEnd: number };
export type ArtifactType = 'practice_test' | 'mock_exam' | 'study_notes' | 'last_night_notes';

export type StoredQuestion = {
  id: string;
  type: 'mcq' | 'short';
  prompt: string;
  options?: string[];
  marks: number;
  chapterId: string;
  citations: Citation[];
  correctIndex?: number;
  modelAnswer?: string;
  keywords?: string[];
  need?: number;
};
export type StoredNote = { heading: string; bodyMarkdown: string; chapterId: string; citations: Citation[] };
export type StoredArtifact = {
  id: string;
  studentId: string;
  type: ArtifactType;
  subjectId: string;
  chapterIds: string[];
  chapterTitles: Record<string, string>;
  params: { questionCount?: number; patternKey?: string };
  createdAt: string;
  /** Until this time the artifact reads as `generating`. */
  readyAt: string;
  title: string;
  durationMinutes?: number;
  sections?: { key: string; title: string; questions: StoredQuestion[] }[];
  questions?: StoredQuestion[];
  notes?: StoredNote[];
};

export type QResult = { score: number; maxScore: number; feedback?: string; correct?: boolean; needsReview?: true };
export type Results = Record<string, QResult>;
export type ByChapter = Record<string, { scored: number; max: number }>;

export type StoredAttempt = {
  id: string;
  artifactId: string;
  studentId: string;
  startedAt: string;
  deadline: string | null;
  submittedAt: string | null;
  /** When grading finishes; until then the attempt reads as `grading`. */
  gradedAt: string | null;
  answers: Record<string, number | string>;
  results?: Results;
  score?: number;
  maxScore?: number;
  byChapter?: ByChapter;
};

export const shortName = (title: string) => title.split(':')[0]!;

export function citationFor(ch: ChapterRef, offset = 0): Citation {
  const p = ch.pageStart + offset * 4;
  return { chunkId: `chunk-${ch.id}-${p}`, itemTitle: ch.book, chapterTitle: ch.def.title, pageStart: p, pageEnd: p + 1 };
}

const list = (a: string[]) => a.join(", ");

type Pooled<T> = { ch: ChapterRef; q: T; offset: number };

/** Round-robin over the chosen chapters first, then the remaining chapters of the subject as filler. */
function pool(chosen: ChapterRef[], all: ChapterRef[], pick: (c: ChapterRef) => Pooled<unknown>['q'][]): Pooled<any>[] {
  const order = [...chosen, ...all.filter((c) => !chosen.some((x) => x.id === c.id))];
  const out: Pooled<any>[] = [];
  for (let round = 0; ; round++) {
    let any = false;
    for (const ch of order) {
      const qs = pick(ch);
      if (qs[round]) {
        out.push({ ch, q: qs[round], offset: round });
        any = true;
      }
    }
    if (!any) break;
  }
  return out;
}

export type BuildInput = {
  id: string;
  studentId: string;
  band: Band;
  type: ArtifactType;
  subjectId: string;
  chapterIds: string[];
  questionCount?: number;
  patternKey?: string;
  createdAt: string;
  readyAt: string;
};

export function buildArtifact(i: BuildInput): StoredArtifact {
  const subject = i.subjectId as SubjectKey;
  const all = chaptersFor(i.band, subject);
  const chosen = i.chapterIds.map((id) => getChapter(id)).filter((c): c is ChapterRef => !!c);
  const names = list(chosen.map((c) => shortName(c.def.title)));
  const base = { id: i.id, studentId: i.studentId, type: i.type, subjectId: i.subjectId, chapterIds: chosen.map((c) => c.id), createdAt: i.createdAt, readyAt: i.readyAt };
  let n = 0;
  const mcqOf = (p: Pooled<[string, [string, string, string, string], number]>): StoredQuestion => ({
    id: `${i.id}-q${++n}`, type: 'mcq', prompt: p.q[0], options: [...p.q[1]], marks: 1, chapterId: p.ch.id,
    citations: [citationFor(p.ch, p.offset)], correctIndex: p.q[2],
  });
  const shortOf = (p: Pooled<[string, string, string[], number]>): StoredQuestion => ({
    id: `${i.id}-q${++n}`, type: 'short', prompt: p.q[0], marks: 2, chapterId: p.ch.id,
    citations: [citationFor(p.ch, 2)], modelAnswer: p.q[1], keywords: p.q[2], need: p.q[3],
  });
  const mcqs = pool(chosen, all, (c) => c.def.mcq);
  const shorts = pool(chosen, all, (c) => [c.def.short]);
  const titles = (extra: ChapterRef[]) => Object.fromEntries([...chosen, ...extra].map((c) => [c.id, c.def.title]));

  if (i.type === 'practice_test') {
    const total = Math.min(i.questionCount ?? 10, mcqs.length + shorts.length);
    const shortTarget = total >= 5 ? Math.max(1, Math.round(total * 0.2)) : 0;
    const mcqN = Math.min(mcqs.length, total - shortTarget);
    const shortN = Math.min(shorts.length, total - mcqN);
    const qs = [...mcqs.slice(0, mcqN).map(mcqOf), ...shorts.slice(0, shortN).map(shortOf)];
    const used = new Set(qs.map((q) => q.chapterId));
    return {
      ...base, params: { questionCount: qs.length }, title: `Practice test: ${names} (${qs.length} questions)`, questions: qs,
      chapterTitles: titles(all.filter((c) => used.has(c.id) && !chosen.includes(c))),
    };
  }
  if (i.type === 'mock_exam') {
    const pat = PATTERNS.find((p) => p.key === i.patternKey) ?? PATTERNS[1]!;
    const a = mcqs.slice(0, pat.mcq).map(mcqOf);
    const b = shorts.slice(0, pat.short).map(shortOf);
    const used = new Set([...a, ...b].map((q) => q.chapterId));
    return {
      ...base, params: { patternKey: pat.key }, title: `Mock exam: ${pat.name.split(' · ')[0]} on ${names}`, durationMinutes: pat.durationMinutes,
      sections: [
        { key: 'A', title: 'Section A: Multiple choice (1 mark each)', questions: a },
        { key: 'B', title: 'Section B: Short answers (2 marks each)', questions: b },
      ],
      chapterTitles: titles(all.filter((c) => used.has(c.id) && !chosen.includes(c))),
    };
  }
  if (i.type === 'study_notes') {
    const notes = chosen.flatMap((c): StoredNote[] => [
      { heading: `${c.def.title}: the big picture`, bodyMarkdown: c.def.sum, chapterId: c.id, citations: [citationFor(c, 0)] },
      { heading: `${shortName(c.def.title)}: key ideas`, bodyMarkdown: c.def.pts.map((p) => `- ${p}`).join('\n'), chapterId: c.id, citations: [citationFor(c, 1)] },
      { heading: `${shortName(c.def.title)}: check yourself`, bodyMarkdown: `**${c.def.short[0]}**\n\nThink it through, then compare with this answer: ${c.def.short[1]}`, chapterId: c.id, citations: [citationFor(c, 2)] },
    ]);
    return { ...base, params: {}, title: `Notes: ${names}`, notes, chapterTitles: titles([]) };
  }
  const notes = chosen.map((c): StoredNote => ({
    heading: c.def.title,
    bodyMarkdown: `${c.def.pts.map((p) => `- ${p}`).join('\n')}\n\n**Quick check:** ${c.def.short[0]} ${c.def.short[1]}`,
    chapterId: c.id,
    citations: [citationFor(c, 0)],
  }));
  return { ...base, params: {}, title: `Last-night notes: ${names}`, notes, chapterTitles: titles([]) };
}

export const questionsOf = (a: StoredArtifact): StoredQuestion[] => a.questions ?? a.sections?.flatMap((s) => s.questions) ?? [];

export const viewQuestion = (q: StoredQuestion) => ({
  id: q.id, type: q.type, prompt: q.prompt, ...(q.options ? { options: q.options } : {}), marks: q.marks, chapterId: q.chapterId, citations: q.citations,
});
export const reviewQuestion = (q: StoredQuestion) => ({
  ...viewQuestion(q),
  ...(typeof q.correctIndex === 'number' ? { correctIndex: q.correctIndex } : {}),
  ...(q.modelAnswer ? { modelAnswer: q.modelAnswer } : {}),
});

export function viewArtifact(a: StoredArtifact, nowMs: number) {
  const generating = nowMs < Date.parse(a.readyAt);
  return {
    id: a.id, type: a.type, status: generating ? 'generating' : 'ready', error: null, subjectId: a.subjectId, chapterIds: a.chapterIds,
    chapterTitles: a.chapterTitles, params: a.params, createdAt: a.createdAt, title: a.title,
    ...(generating ? {} : {
      ...(a.durationMinutes ? { durationMinutes: a.durationMinutes } : {}),
      ...(a.sections ? { sections: a.sections.map((s) => ({ key: s.key, title: s.title, questions: s.questions.map(viewQuestion) })) } : {}),
      ...(a.questions ? { questions: a.questions.map(viewQuestion) } : {}),
      ...(a.notes ? { notes: a.notes } : {}),
    }),
  };
}

export function gradeAnswers(a: StoredArtifact, answers: Record<string, number | string>): { results: Results; score: number; maxScore: number; byChapter: ByChapter } {
  const results: Results = {};
  const byChapter: ByChapter = {};
  let score = 0;
  let maxScore = 0;
  for (const q of questionsOf(a)) {
    const ans = answers[q.id];
    let r: QResult;
    if (q.type === 'mcq') {
      const ok = ans === q.correctIndex;
      r = { score: ok ? q.marks : 0, maxScore: q.marks, correct: ok };
    } else if (typeof ans !== 'string' || ans.trim() === '') {
      r = { score: 0, maxScore: q.marks, feedback: 'No answer was written for this question.' };
    } else {
      const text = ans.toLowerCase();
      const kws = q.keywords ?? [];
      const need = q.need ?? 0;
      const hit = kws.filter((k) => text.includes(k.toLowerCase())).length;
      const frac = kws.length === 0 || need === 0 ? (ans.trim().length >= 15 ? 1 : 0.5) : Math.min(1, hit / need);
      const s = frac >= 1 ? q.marks : frac > 0 ? q.marks / 2 : 0;
      const feedback = frac >= 1 ? 'Great answer! You covered the key points.'
        : frac > 0 ? `Partly right. A complete answer would be: ${q.modelAnswer}`
        : `Not quite yet. A good answer would be: ${q.modelAnswer}`;
      r = { score: s, maxScore: q.marks, feedback };
    }
    results[q.id] = r;
    score += r.score;
    maxScore += r.maxScore;
    const b = (byChapter[q.chapterId] ??= { scored: 0, max: 0 });
    b.scored += r.score;
    b.max += r.maxScore;
  }
  return { results, score, maxScore, byChapter };
}

export const hasSubjective = (a: StoredArtifact, answers: Record<string, number | string>) =>
  questionsOf(a).some((q) => q.type === 'short' && typeof answers[q.id] === 'string' && String(answers[q.id]).trim() !== '');

export { SUBJECT_KEYS };
