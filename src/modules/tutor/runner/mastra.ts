import type { ModelMessage } from 'ai';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import type { AgentRunner, RunEvent, RunInput } from './types';

/** The only file that imports @mastra/core. Mastra 1.75 drives ai@7 (spec v4) models directly. */
export class MastraRunner implements AgentRunner {
  async *run(input: RunInput): AsyncGenerator<RunEvent> {
    const tools = Object.fromEntries(
      input.tools.map((t) => [
        t.name,
        createTool({
          id: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          execute: async (args) => t.execute(args),
        }),
      ]),
    );
    // Mastra's `model` type lags the spec-v4 model object; it accepts it at runtime.
    const agent = new Agent({
      id: 'tutor',
      name: 'tutor',
      instructions: input.instructions,
      model: input.model as never,
      tools,
      // Drop Mastra's default StreamErrorRetryProcessor (2 retries, 3s delay): runTurn owns the single retry.
      errorProcessorDefaults: false,
    });
    const messages: ModelMessage[] = [
      ...input.history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: input.userText },
    ];
    const out = await agent.stream(messages,
      {
        maxSteps: input.maxSteps,
        abortSignal: input.signal,
        providerOptions: input.providerOptions as never,
        // Mastra defaults to 2 retries; runTurn owns the single retry, so a failure costs at most 2 provider calls per turn.
        modelSettings: { maxRetries: 0 },
      },
    );
    for await (const chunk of out.fullStream) {
      if (chunk.type === 'text-delta') yield { type: 'delta', text: chunk.payload.text };
      else if (chunk.type === 'error') throw toError(chunk.payload.error);
    }
    if (input.signal?.aborted) return;
    const usage = await out.usage; // summed across steps
    yield { type: 'finish', usage: { tokensIn: usage.inputTokens ?? 0, tokensOut: usage.outputTokens ?? 0 } };
  }
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
}
