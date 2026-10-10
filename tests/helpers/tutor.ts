import { eq } from 'drizzle-orm';
import { MockLanguageModelV4 } from 'ai/test';

type StreamPart = Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P> ? P : never;
import { withPlatform } from '@/db/client';
import { studentProfiles } from '@/db/schema';
import { seedSkills } from '@/modules/tutor/skills';
import type { Actor } from '@/modules/tenancy/actor';

/** Sets the student's profile to `active` (platform context), so the student may chat. */
export async function activate(actor: Actor): Promise<void> {
  await withPlatform((tx) =>
    tx.update(studentProfiles).set({ status: 'active' }).where(eq(studentProfiles.userId, actor.userId)),
  );
}

/** Seeds the global tutor skills (`socratic`, `explain`). */
export async function seedTutorSkills(): Promise<void> {
  await seedSkills();
}

export type ScriptStep =
  | { toolCall: { name: string; input: unknown }; usage?: { in: number; out: number } }
  | { text: string; usage?: { in: number; out: number } }
  | { error: Error };

const usageOf = (u: { in: number; out: number } = { in: 10, out: 5 }) => ({
  inputTokens: { total: u.in, noCache: u.in, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: u.out, text: u.out, reasoning: undefined },
});

/**
 * A scripted ai@7 (spec v4) model: one step per `doStream` call. Text is split into several deltas.
 * When the script is exhausted the last step repeats (so a "always calls the tool" model can run until a step limit).
 */
export function scriptedModel(steps: ScriptStep[]): MockLanguageModelV4 & { readonly calls: number } {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const step = steps[Math.min(calls, steps.length - 1)]!;
      const n = calls++;
      if ('error' in step) throw step.error;
      const parts: StreamPart[] = [{ type: 'stream-start', warnings: [] }];
      if ('toolCall' in step) {
        parts.push({
          type: 'tool-call',
          toolCallId: `call-${n}`,
          toolName: step.toolCall.name,
          input: JSON.stringify(step.toolCall.input),
        });
        parts.push({
          type: 'finish',
          usage: usageOf(step.usage),
          finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
        });
      } else {
        const id = `t-${n}`;
        parts.push({ type: 'text-start', id });
        for (let i = 0; i < step.text.length; i += 4) {
          parts.push({ type: 'text-delta', id, delta: step.text.slice(i, i + 4) });
        }
        parts.push({ type: 'text-end', id });
        parts.push({ type: 'finish', usage: usageOf(step.usage), finishReason: { unified: 'stop', raw: 'stop' } });
      }
      return {
        stream: new ReadableStream({
          start(c) {
            for (const p of parts) c.enqueue(p);
            c.close();
          },
        }),
      };
    },
  });
  Object.defineProperty(model, 'calls', { get: () => calls });
  return model as MockLanguageModelV4 & { readonly calls: number };
}
