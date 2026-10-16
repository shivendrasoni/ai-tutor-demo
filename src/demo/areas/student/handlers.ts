import { ApiError, type Routes } from '../../core/router';
import { chunkWords, sseResponse } from '../../core/sse';
import { getPersona, getSlice, mutateSlice } from '../../core/store';
import { isStudent, personaById } from '../../core/personas';
import { CORE_KEY, coreSeed, type CoreSeed } from '../../core/seed-core';
import { bandFor } from '@/lib/student-band';
import { chaptersFor, getChapter, PATTERNS, SUBJECT_KEYS, type Band, type SubjectKey } from './curriculum';
import {
  buildArtifact, gradeAnswers, hasSubjective, questionsOf, reviewQuestion, viewArtifact,
  type ArtifactType, type StoredArtifact, type StoredAttempt,
} from './engine';
import type { Conv, Msg, StudentSlice } from './fixtures';
import { scriptedReply } from './replies';

export const SLICE_KEY = 'student';
const GRACE_MS = 2 * 60_000;
const GENERATE_MS = 3500;
const DAILY_LIMIT = 10;
const TYPES: ArtifactType[] = ['practice_test', 'mock_exam', 'study_notes', 'last_night_notes'];

const SKILLS = [
  { id: 'skill-socratic', key: 'socratic', name: 'Socratic tutor', kind: 'chat', tools: [] as string[], enabled: true },
  { id: 'skill-explain', key: 'explain', name: 'Explain it to me', kind: 'chat', tools: [] as string[], enabled: true },
];

const slice = () => getSlice<StudentSlice>(SLICE_KEY);
const uid = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const nowMs = () => Date.now();
const bad = (m: string) => new ApiError(400, 'VALIDATION', m);
const notFound = () => new ApiError(404, 'NOT_FOUND');

type Me = { id: string; grade: number; band: Band };

/** The active student. Non-student personas (and students awaiting activation) get 403, which the UI turns into a redirect to /status. */
function me(): Me {
  const p = personaById(getPersona());
  if (!isStudent(p.id) || !p.userId) throw new ApiError(403, 'FORBIDDEN');
  const core = getSlice<CoreSeed>(CORE_KEY) ?? coreSeed;
  const u = core.users.find((x) => x.id === p.userId);
  if (!u || (u.status && u.status !== 'active') || p.id === 'student_pending') throw new ApiError(403, 'FORBIDDEN');
  return { id: u.id, grade: u.grade ?? 7, band: bandFor(u.grade) };
}

function ownConv(m: Me, id: string): Conv {
  const c = slice().conversations.find((x) => x.id === id && x.studentId === m.id);
  if (!c) throw notFound();
  return c;
}
function ownArtifact(m: Me, id: string): StoredArtifact {
  const a = slice().artifacts.find((x) => x.id === id && x.studentId === m.id);
  if (!a) throw notFound();
  return a;
}
function ownAttempt(m: Me, id: string): { at: StoredAttempt; art: StoredArtifact } {
  const at = slice().attempts.find((x) => x.id === id && x.studentId === m.id);
  const art = at && slice().artifacts.find((x) => x.id === at.artifactId);
  if (!at || !art) throw notFound();
  return { at, art };
}

const isExpired = (at: StoredAttempt, t: number) => at.submittedAt === null && at.deadline !== null && t > Date.parse(at.deadline) + GRACE_MS;

/** Attempts left open past deadline + grace are closed at their deadline and scored, as the real service does lazily. */
function closeExpired(m: Me) {
  const t = nowMs();
  if (!slice().attempts.some((a) => a.studentId === m.id && isExpired(a, t))) return;
  mutateSlice<StudentSlice>(SLICE_KEY, (d) => {
    for (const at of d.attempts) {
      if (at.studentId !== m.id || !isExpired(at, t)) continue;
      const art = d.artifacts.find((a) => a.id === at.artifactId)!;
      Object.assign(at, { submittedAt: at.deadline, gradedAt: at.deadline, ...gradeAnswers(art, at.answers) });
    }
  });
}

const attemptStatus = (at: StoredAttempt, t: number) => (at.submittedAt === null ? 'in_progress' : t < Date.parse(at.gradedAt ?? at.submittedAt) ? 'grading' : 'graded');
const iso = (n: number) => new Date(n).toISOString();

function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? `${t.slice(0, 45).trimEnd()}…` : t;
}

export const routes: Routes = {
  // ---- tutor chat ----
  'GET /api/tutor/subjects': () => {
    me();
    const core = getSlice<CoreSeed>(CORE_KEY) ?? coreSeed;
    return core.subjects.map((s) => ({ id: s.id, name: s.name }));
  },
  'GET /api/tutor/skills': ({ query }) => {
    me();
    const kind = query.get('kind');
    return SKILLS.filter((s) => !kind || s.kind === kind);
  },
  'GET /api/tutor/conversations': () => {
    const m = me();
    return slice().conversations
      .filter((c) => c.studentId === m.id)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .map((c) => ({ id: c.id, title: c.title, skillKey: c.skillKey, subjectId: c.subjectId, updatedAt: c.updatedAt }));
  },
  'POST /api/tutor/conversations': ({ body }) => {
    const m = me();
    const skillKey = String(body?.skillKey ?? '');
    if (!SKILLS.some((s) => s.key === skillKey)) throw bad('Unknown skill');
    const subjectId: string | null = body?.subjectId ?? null;
    if (subjectId && !SUBJECT_KEYS.includes(subjectId as SubjectKey)) throw bad('Subject is not available');
    const id = uid('conv');
    mutateSlice<StudentSlice>(SLICE_KEY, (d) => {
      d.conversations.push({ id, studentId: m.id, title: null, skillKey, subjectId, updatedAt: iso(nowMs()), state: {} });
      d.messages[id] = [];
    });
    return { id };
  },
  'GET /api/tutor/conversations/:id/messages': ({ params }) => {
    const m = me();
    ownConv(m, params.id!);
    return slice().messages[params.id!] ?? [];
  },
  'POST /api/tutor/conversations/:id/messages': ({ params, body, signal }) => {
    const m = me();
    const conv = ownConv(m, params.id!);
    const text = String(body?.text ?? '').trim();
    if (!text) throw bad('Write a message first');
    if (text.length > 4000) throw bad('That message is too long');
    const history = slice().messages[conv.id] ?? [];
    const reply = scriptedReply({
      text, band: m.band, skillKey: conv.skillKey, subjectId: conv.subjectId, prev: conv.state ?? {},
      userTurns: history.filter((x) => x.role === 'user').length,
    });
    const messageId = uid('msg');
    const citations = reply.citations.map((c, i) => ({ n: i + 1, ...c }));
    mutateSlice<StudentSlice>(SLICE_KEY, (d) => {
      const list = (d.messages[conv.id] ??= []);
      list.push({ id: uid('msg'), role: 'user', content: text, citations: [], feedback: null });
      list.push({ id: messageId, role: 'assistant', content: reply.text, citations, feedback: null });
      const c = d.conversations.find((x) => x.id === conv.id)!;
      c.title ??= titleFrom(text);
      c.updatedAt = iso(nowMs());
      c.state = reply.state;
    });
    const words = chunkWords(reply.text);
    return sseResponse(
      [
        { event: 'meta', data: { messageId, skill: conv.skillKey, modelTier: 'standard' } },
        ...words.map((w) => ({ event: 'delta', data: { text: w } })),
        ...(citations.length ? [{ event: 'citations', data: { citations } }] : []),
        { event: 'done', data: { tokensIn: Math.ceil(text.length / 4) + 420, tokensOut: Math.ceil(reply.text.length / 4) } },
      ],
      28,
      signal,
    );
  },
  'POST /api/tutor/messages/:id/feedback': ({ params }) => {
    const m = me();
    const owned = Object.entries(slice().messages).some(([cid, ms]) => ms.some((x) => x.id === params.id) && slice().conversations.some((c) => c.id === cid && c.studentId === m.id));
    if (!owned) throw notFound();
    mutateSlice<StudentSlice>(SLICE_KEY, (d) => {
      for (const ms of Object.values(d.messages)) for (const x of ms as Msg[]) if (x.id === params.id) x.feedback = 'down';
    });
    return null;
  },

  // ---- study ----
  'GET /api/study/patterns': () => {
    const m = me();
    return PATTERNS.filter((p) => m.grade >= p.gradeMin && m.grade <= p.gradeMax).map((p) => ({ key: p.key, name: p.name, durationMinutes: p.durationMinutes }));
  },
  'GET /api/study/chapters': ({ query }) => {
    const m = me();
    const subject = query.get('subjectId') as SubjectKey | null;
    if (!subject || !SUBJECT_KEYS.includes(subject)) throw bad('subjectId is required');
    return chaptersFor(m.band, subject).map((c) => ({ id: c.id, title: c.def.title, itemTitle: c.book, ordinal: c.idx + 1 }));
  },
  'GET /api/study/artifacts': ({ query }) => {
    const m = me();
    const type = query.get('type');
    const t = nowMs();
    return slice().artifacts
      .filter((a) => a.studentId === m.id && (!type || a.type === type))
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .map((a) => {
        const done = slice().attempts.filter((x) => x.artifactId === a.id && x.submittedAt && attemptStatus(x, t) === 'graded' && x.maxScore);
        const best = done.length ? Math.max(...done.map((x) => ((x.score ?? 0) / x.maxScore!) * 100)) : null;
        return {
          id: a.id, type: a.type, status: t < Date.parse(a.readyAt) ? 'generating' : 'ready', subjectId: a.subjectId, chapterIds: a.chapterIds,
          title: a.title, createdAt: a.createdAt, attemptCount: slice().attempts.filter((x) => x.artifactId === a.id).length, bestScorePct: best,
        };
      });
  },
  'POST /api/study/artifacts': ({ body }) => {
    const m = me();
    const type = body?.type as ArtifactType;
    if (!TYPES.includes(type)) throw bad('Unknown artifact type');
    const subject = body?.subjectId as SubjectKey;
    if (!SUBJECT_KEYS.includes(subject)) throw bad('Subject is not available');
    const ids: string[] = [...new Set<string>(Array.isArray(body?.chapterIds) ? body.chapterIds : [])];
    if (ids.length < 1 || ids.length > 6) throw bad('Choose 1 to 6 chapters');
    for (const id of ids) {
      const ch = getChapter(id);
      if (!ch || ch.band !== m.band || ch.subject !== subject) throw bad('A chapter is not available for this subject');
    }
    let questionCount: number | undefined;
    if (body?.questionCount !== undefined) {
      if (type !== 'practice_test') throw bad('questionCount is only for practice tests');
      questionCount = Number(body.questionCount);
      if (!Number.isInteger(questionCount) || questionCount < 5 || questionCount > 30) throw bad('questionCount must be a whole number from 5 to 30');
    }
    let patternKey: string | undefined;
    if (type === 'mock_exam') {
      const fallback = PATTERNS.find((p) => m.grade >= p.gradeMin && m.grade <= p.gradeMax)!.key;
      patternKey = body?.patternKey ?? fallback;
      const p = PATTERNS.find((x) => x.key === patternKey);
      if (!p || m.grade < p.gradeMin || m.grade > p.gradeMax) throw bad('That exam pattern is not available for your grade');
    } else if (body?.patternKey !== undefined) throw bad('patternKey is only for mock exams');

    const t = nowMs();
    const dayStart = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());
    if (slice().artifacts.filter((a) => a.studentId === m.id && Date.parse(a.createdAt) >= dayStart).length >= DAILY_LIMIT) {
      throw new ApiError(429, 'GENERATION_LIMIT', 'Daily limit reached');
    }
    const id = uid('art');
    const art = buildArtifact({
      id, studentId: m.id, band: m.band, type, subjectId: subject, chapterIds: ids, questionCount: questionCount ?? (type === 'practice_test' ? 10 : undefined),
      patternKey, createdAt: iso(t), readyAt: iso(t + GENERATE_MS),
    });
    mutateSlice<StudentSlice>(SLICE_KEY, (d) => void d.artifacts.push(art));
    return { id };
  },
  'GET /api/study/artifacts/:id': ({ params }) => {
    const m = me();
    closeExpired(m);
    const a = ownArtifact(m, params.id!);
    const t = nowMs();
    const attempts = slice().attempts
      .filter((x) => x.artifactId === a.id)
      .sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt))
      .map((x) => {
        const status = attemptStatus(x, t);
        return { id: x.id, status, startedAt: x.startedAt, submittedAt: x.submittedAt, score: status === 'graded' ? (x.score ?? null) : null, maxScore: status === 'graded' ? (x.maxScore ?? null) : null };
      });
    return { ...viewArtifact(a, t), attempts };
  },
  'POST /api/study/artifacts/:id/attempts': ({ params }) => {
    const m = me();
    closeExpired(m);
    const a = ownArtifact(m, params.id!);
    if (a.type !== 'practice_test' && a.type !== 'mock_exam') throw bad('Only tests can be attempted');
    if (nowMs() < Date.parse(a.readyAt)) throw bad('This test is not ready yet');
    const open = slice().attempts.filter((x) => x.artifactId === a.id && x.submittedAt === null).sort((x, y) => Date.parse(y.startedAt) - Date.parse(x.startedAt))[0];
    if (open) return { attemptId: open.id, startedAt: open.startedAt, deadline: open.deadline, answers: { ...open.answers } };
    const t = nowMs();
    const deadline = a.durationMinutes ? iso(t + a.durationMinutes * 60_000) : null;
    const id = uid('att');
    mutateSlice<StudentSlice>(SLICE_KEY, (d) => {
      d.attempts.push({ id, artifactId: a.id, studentId: m.id, startedAt: iso(t), deadline, submittedAt: null, gradedAt: null, answers: {} });
    });
    return { attemptId: id, startedAt: iso(t), deadline, answers: {} };
  },
  'PUT /api/study/attempts/:id/answers': ({ params, body }) => {
    const m = me();
    const { at, art } = ownAttempt(m, params.id!);
    if (at.submittedAt) throw bad('This attempt is already submitted');
    if (isExpired(at, nowMs())) throw new ApiError(409, 'ATTEMPT_EXPIRED', 'The time for this attempt is over');
    const raw = body?.answers;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('answers must be an object');
    const byId = new Map(questionsOf(art).map((q) => [q.id, q]));
    const clean: Record<string, number | string> = {};
    for (const [qid, v] of Object.entries(raw as Record<string, unknown>)) {
      const q = byId.get(qid);
      if (!q) throw bad('Unknown question');
      if (q.type === 'mcq') {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 3) throw bad('Invalid answer');
      } else if (typeof v !== 'string' || v.length > 10_000) throw bad('Invalid answer');
      clean[qid] = v as number | string;
    }
    mutateSlice<StudentSlice>(SLICE_KEY, (d) => {
      d.attempts.find((x) => x.id === at.id)!.answers = clean;
    });
    return null;
  },
  'POST /api/study/attempts/:id/submit': ({ params }) => {
    const m = me();
    closeExpired(m);
    const { at, art } = ownAttempt(m, params.id!);
    if (at.submittedAt) return { status: attemptStatus(at, nowMs()) };
    const t = nowMs();
    const slow = hasSubjective(art, at.answers);
    mutateSlice<StudentSlice>(SLICE_KEY, (d) => {
      const x = d.attempts.find((y) => y.id === at.id)!;
      Object.assign(x, { submittedAt: iso(t), gradedAt: iso(t + (slow ? 1500 : 0)), ...gradeAnswers(art, x.answers) });
    });
    return { status: slow ? 'grading' : 'graded' };
  },
  'GET /api/study/attempts/:id': ({ params }) => {
    const m = me();
    closeExpired(m);
    const { at, art } = ownAttempt(m, params.id!);
    const t = nowMs();
    const status = attemptStatus(at, t);
    const view: Record<string, unknown> = {
      id: at.id, artifactId: at.artifactId, status, startedAt: at.startedAt, deadline: at.deadline, submittedAt: at.submittedAt,
      answers: { ...at.answers }, artifact: viewArtifact(art, t),
    };
    if (at.submittedAt) {
      view.questions = questionsOf(art).map(reviewQuestion);
      if (status === 'graded') Object.assign(view, { results: at.results, score: at.score, maxScore: at.maxScore, byChapter: at.byChapter });
    }
    return view;
  },
};
