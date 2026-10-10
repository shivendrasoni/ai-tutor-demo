import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { RunEvent, RunInput, TutorTool } from '../../src/modules/tutor/runner/types';
import { MastraRunner } from '../../src/modules/tutor/runner/mastra';
import { scriptedModel } from '../helpers/tutor';

async function collect(it: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

const searchTool = (): TutorTool & { execute: ReturnType<typeof vi.fn> } => ({
  name: 'search_curriculum',
  description: 'd',
  inputSchema: z.object({ query: z.string() }),
  execute: vi.fn(async () => '[1] Bio · Ch3 · p. 12–13\ntext'),
});

const base = (over: Partial<RunInput>): RunInput => ({
  instructions: 'I',
  model: scriptedModel([{ text: 'hi' }]),
  history: [],
  userText: 'q',
  tools: [],
  maxSteps: 5,
  ...over,
});

describe('MastraRunner', () => {
  it('streams deltas then finish with summed usage across tool step and answer step', async () => {
    const model = scriptedModel([
      { toolCall: { name: 'search_curriculum', input: { query: 'photosynthesis' } }, usage: { in: 100, out: 10 } },
      { text: 'Plants make food [1].', usage: { in: 120, out: 30 } },
    ]);
    const tool = searchTool();
    const events = await collect(
      new MastraRunner().run(base({ model, userText: 'What is photosynthesis?', tools: [tool] })),
    );
    expect(tool.execute).toHaveBeenCalledWith({ query: 'photosynthesis' });
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.map((e) => (e as { text: string }).text).join('')).toBe('Plants make food [1].');
    expect(events.at(-1)).toEqual({ type: 'finish', usage: { tokensIn: 220, tokensOut: 40 } });
  });

  it('passes history in order before the user text and the instructions as system', async () => {
    const model = scriptedModel([{ text: 'ok' }]);
    await collect(
      new MastraRunner().run(
        base({
          model,
          instructions: 'SYS PROMPT',
          history: [
            { role: 'user', content: 'h1' },
            { role: 'assistant', content: 'h2' },
          ],
          userText: 'now',
        }),
      ),
    );
    const prompt = model.doStreamCalls[0]!.prompt;
    expect(prompt[0]).toMatchObject({ role: 'system', content: 'SYS PROMPT' });
    const text = (m: (typeof prompt)[number]) =>
      typeof m.content === 'string' ? m.content : (m.content as { text?: string }[]).map((p) => p.text).join('');
    expect(prompt.slice(1).map((m) => [m.role, text(m)])).toEqual([
      ['user', 'h1'],
      ['assistant', 'h2'],
      ['user', 'now'],
    ]);
  });

  it('respects maxSteps (a model that always calls the tool stops at maxSteps)', async () => {
    const model = scriptedModel([{ toolCall: { name: 'search_curriculum', input: { query: 'x' } } }]);
    await collect(new MastraRunner().run(base({ model, tools: [searchTool()], maxSteps: 3 })));
    expect(model.calls).toBeGreaterThan(0);
    expect(model.calls).toBeLessThanOrEqual(3);
  });

  it('provider error rejects', async () => {
    const model = scriptedModel([{ error: new Error('boom') }]);
    await expect(collect(new MastraRunner().run(base({ model })))).rejects.toThrow(/boom/);
  });

  it('an aborted signal ends the iteration without throwing', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(collect(new MastraRunner().run(base({ signal: ac.signal })))).resolves.toBeDefined();
  });
});
