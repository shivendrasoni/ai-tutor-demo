// Placeholder types (Task 2); Task 3 fills in behavior (fake, jev, llm, fallback, select) without renaming.
export type DeciderQuestion =
  | { type: 'choice'; instructions: string; options: Record<string, string> }
  | { type: 'score'; instructions: string; levels: string[] }
  | { type: 'yesno'; statement: string };

export type DeciderAnswer =
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: 'score'; score: number; probabilities: Record<string, number>; confidence: number }
  | { type: 'yesno'; p: number };

export interface Decider {
  decide(state: string, questions: Record<string, DeciderQuestion>): Promise<Record<string, DeciderAnswer>>;
}
