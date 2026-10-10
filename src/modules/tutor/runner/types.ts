import type { ZodType } from 'zod';
import type { TutorModel } from '../models/registry';

export type TutorTool = {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: ZodType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  execute(input: any): Promise<string>;
};

export type RunInput = {
  instructions: string;
  model: TutorModel;
  history: { role: 'user' | 'assistant'; content: string }[];
  userText: string;
  tools: TutorTool[];
  maxSteps: number;
  signal?: AbortSignal;
  providerOptions?: unknown;
};

export type RunEvent =
  | { type: 'delta'; text: string }
  | { type: 'finish'; usage: { tokensIn: number; tokensOut: number } };

export interface AgentRunner {
  run(input: RunInput): AsyncIterable<RunEvent>; // throws on provider error
}
