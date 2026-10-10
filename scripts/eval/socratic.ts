/** Checks that the Socratic skill withholds the final answer. Usage: pnpm eval:socratic --set evals/socratic.jsonl (needs real providers). */
import '../env';
import { generateText, Output, type LanguageModel } from 'ai';
import { z } from 'zod';
import type { Actor } from '@/modules/tenancy/actor';
import { isEntry, loadActors, parseJsonl, renderReport, requireEnv, setArg, writeReport } from './lib';

export const socraticCaseSchema = z.object({ problem: z.string().min(1), studentUsername: z.string().min(1) });
export type SocraticCase = z.infer<typeof socraticCaseSchema>;

const verdictSchema = z.object({
  finalAnswerWithheld: z.boolean(),
  askedGuidingQuestion: z.boolean(),
  reason: z.string(),
});
export type Verdict = z.infer<typeof verdictSchema>;
export type Judge = (problem: string, reply: string) => Promise<Verdict>;

/** An LLM judge (generateText + Output.object) over `model`. */
export function makeJudge(model: LanguageModel): Judge {
  return async (problem, reply) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema: verdictSchema }),
      temperature: 0,
      system:
        'You grade a tutor reply to a student. The tutor must guide the student with hints and questions and must NOT hand over the final answer. ' +
        'finalAnswerWithheld is true only if the reply never states the final answer or full solution. ' +
        'askedGuidingQuestion is true if the reply asks the student a guiding question or gives a next-step hint to try. reason is one short sentence.',
      prompt: `Student problem:\n${problem}\n\nTutor reply:\n${reply}`,
    });
    return output;
  };
}

export type SocraticEvalDeps = {
  actors: Record<string, Actor>;
  ask: (actor: Actor, problem: string) => Promise<string>;
  judge: Judge;
};

export async function runSocraticEval(cases: SocraticCase[], deps: SocraticEvalDeps) {
  const rows = [];
  for (const c of cases) {
    const actor = deps.actors[c.studentUsername];
    if (!actor) throw new Error(`no actor for student "${c.studentUsername}"`);
    const reply = await deps.ask(actor, c.problem);
    rows.push({ ...c, reply, verdict: await deps.judge(c.problem, reply) });
  }
  const withheld = rows.filter((r) => r.verdict.finalAnswerWithheld).length;
  const guiding = rows.filter((r) => r.verdict.askedGuidingQuestion).length;
  const rate = (x: number) => (rows.length ? x / rows.length : 0);
  return { n: rows.length, withheld, withheldRate: rate(withheld), guidingRate: rate(guiding), rows };
}

async function main() {
  requireEnv('eval:socratic', ['DATABASE_URL_APP', 'DATABASE_URL_OWNER', 'LLM_STANDARD_MODEL', 'EVAL_JUDGE_MODEL']);
  const { readFile } = await import('node:fs/promises');
  const { closeDb } = await import('@/db/client');
  const { createConversation, runTurn, ModelRegistry } = await import('@/modules/tutor');
  try {
    const cases = parseJsonl(await readFile(setArg('socratic'), 'utf8'), socraticCaseSchema);
    const actors = await loadActors(cases.map((c) => c.studentUsername));
    const judgeModel = new ModelRegistry().resolve(process.env.EVAL_JUDGE_MODEL!);
    const r = await runSocraticEval(cases, {
      actors,
      judge: makeJudge(judgeModel),
      ask: async (actor, problem) => {
        const { id } = await createConversation(actor, { skillKey: 'socratic' });
        let text = '';
        for await (const e of runTurn(actor, id, problem)) {
          if (e.type === 'delta') text += e.data.text;
          if (e.type === 'error') throw new Error(`${e.data.code}: ${e.data.message}`);
        }
        return text;
      },
    });
    const md = renderReport(
      'socratic',
      [
        { title: 'Summary', rows: [{ cases: r.n, withheld: r.withheld, withheldRate: r.withheldRate, guidingRate: r.guidingRate }] },
        {
          title: 'Cases',
          rows: r.rows.map((x) => ({
            problem: x.problem,
            withheld: x.verdict.finalAnswerWithheld ? 'yes' : 'no',
            guiding: x.verdict.askedGuidingQuestion ? 'yes' : 'no',
            reason: x.verdict.reason,
          })),
        },
      ],
      new Date(),
    );
    console.log(`Report: ${await writeReport('socratic', md)}`);
  } finally {
    await closeDb();
  }
}

if (isEntry(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (e) => {
      console.error(`Error: ${(e as Error)?.message ?? String(e)}`);
      process.exit(1);
    },
  );
}
