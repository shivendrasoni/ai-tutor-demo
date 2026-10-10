import { beforeAll, describe, expect, it } from 'vitest';
import { listSkills, seedSkills } from '@/modules/tutor';
import { STUDY_SKILLS } from '@/modules/tutor/skills-study';
import { resetDb } from '../helpers/db';

beforeAll(resetDb);

describe('study skills', () => {
  it('seedSkills adds the five study skills, idempotently', async () => {
    await seedSkills();
    await seedSkills();
    const rows = await listSkills();
    for (const k of ['practice_test_generator', 'mock_exam_generator', 'study_notes_generator', 'last_night_notes_generator'])
      expect(rows.find((r) => r.key === k)).toMatchObject({ kind: 'generator', tools: [] });
    expect(rows.find((r) => r.key === 'answer_grader')).toMatchObject({ kind: 'grader', tools: [] });
    expect(rows.filter((r) => r.key === 'answer_grader')).toHaveLength(1);
    expect((await listSkills('chat')).map((r) => r.key).sort()).toEqual(['explain', 'socratic']);
  });
  it('instructions say: only the passages, match the grade, cite P<n>', () => {
    expect(STUDY_SKILLS).toHaveLength(5);
    for (const s of STUDY_SKILLS.filter((x) => x.kind === 'generator')) {
      expect(s.instructions).toMatch(/only (the|from the) passages/i);
      expect(s.instructions).toMatch(/grade/i);
      expect(s.instructions).toMatch(/P<n>/);
    }
  });
});
