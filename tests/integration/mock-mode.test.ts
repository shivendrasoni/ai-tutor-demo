import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withPlatform } from '@/db/client';
import { artifacts } from '@/db/schema';
import { ModelRegistry } from '@/modules/tutor/models/registry';
import { createConversation, runTurn, seedSkills, resetTutorConfig, type TurnEvent } from '@/modules/tutor';
import { getDeps } from '@/modules/tutor/deps';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import { handleGenerateJob, handleGradeJob, requestArtifact, startAttempt, saveAnswers, submitAttempt, getAttempt } from '@/modules/studytools';
import { resetDb, seedTwoSchools, type Seed } from '../helpers/db';
import { activateStudent, seedStudyContent, useRecordingQueue } from '../helpers/study';

/*
 * Production wiring with no keys: getDeps() / selectDecider / the real ModelRegistry / MastraRunner, AI_MOCK=1 and
 * no configureTutor overrides. Only the study queue is recorded (pg-boss is not needed here).
 */
let seed: Seed;
let ids: { subjectId: string; chapterIds: string[]; chunkIds: string[] };
const rec = useRecordingQueue();

beforeAll(async () => {
  await resetDb();
  seed = await seedTwoSchools();
  await activateStudent(seed.a.student);
  await seedSkills(STUDY_SKILLS);
  ids = await seedStudyContent(seed.a);
});
beforeEach(() => {
  resetTutorConfig();
  vi.stubEnv('AI_MOCK', '1');
  for (const k of ['DECIDER', 'LLM_STANDARD_MODEL', 'LLM_ADVANCED_MODEL', 'OPENAI_API_KEY', 'TYPESAFE_API_KEY', 'MODEL_PRICES']) vi.stubEnv(k, '');
  vi.stubEnv('EMBEDDER', 'fake');
});
afterEach(() => {
  resetTutorConfig();
  vi.unstubAllEnvs();
});

describe('keyless mock mode through the production wiring', () => {
  it('selects the mock decider and resolves the mock models from the real registry', () => {
    const deps = getDeps();
    expect(deps.deciderProvider).toBe('mock');
    expect(deps.registry).toBeInstanceOf(ModelRegistry);
    expect(deps.registry.resolve('mock/standard').provider).toBe('mock');
  });

  it('a tutor turn searches the real content and replies with a [1] citation', async () => {
    const student = seed.a.student;
    const conv = await createConversation(student, { skillKey: 'explain' });
    const events: TurnEvent[] = [];
    for await (const e of runTurn(student, conv.id, 'Tell me about topic 1 in Chapter 1')) events.push(e);
    const text = events.flatMap((e) => (e.type === 'delta' ? [e.data.text] : [])).join('');
    expect(text).toContain('[1]');
    expect(text).toMatch(/Chapter 1 passage/);
    const cites = events.find((e) => e.type === 'citations');
    expect(cites?.type === 'citations' && cites.data.citations.length).toBeGreaterThan(0);
    expect(events.at(-1)!.type).toBe('done');
  });

  it('generates a practice test and grades a short answer with the mock model', async () => {
    const student = seed.a.student;
    const { id } = await requestArtifact(student, { type: 'practice_test', subjectId: ids.subjectId, chapterIds: ids.chapterIds.slice(0, 2), questionCount: 5 });
    await handleGenerateJob({ data: rec.current.generate[0]! });
    const [row] = await withPlatform((tx) => tx.select().from(artifacts).where(eq(artifacts.id, id)));
    expect(row!.status).toBe('ready');
    const questions = (row!.content as { questions: { id: string; type: string; marks: number }[] }).questions;
    expect(questions).toHaveLength(5);

    const { attemptId } = await startAttempt(student, row!.id);
    const answers = Object.fromEntries(questions.map((q) => [q.id, q.type === 'mcq' ? 0 : 'my answer']));
    await saveAnswers(student, attemptId, answers);
    await submitAttempt(student, attemptId);
    for (const j of rec.current.grade) await handleGradeJob({ data: j });
    const v = await getAttempt(student, attemptId);
    expect(v.status).toBe('graded');
    const short = questions.filter((q) => q.type === 'short');
    expect(short.length).toBe(2);
    for (const q of short) {
      expect(v.results![q.id]).toMatchObject({ score: q.marks / 2 });
      expect(v.results![q.id]!.needsReview).toBeFalsy();
    }
  });
});
