import { listVisibleChapters, listVisibleSubjects, searchChunks } from '@/modules/content';
import { selectDecider } from './decider/select';
import type { Decider } from './decider/types';
import { ModelRegistry } from './models/registry';
import { MastraRunner } from './runner/mastra';
import type { AgentRunner } from './runner/types';

export type TutorDeps = {
  registry: ModelRegistry;
  decider: Decider | null;
  deciderProvider: 'jev' | 'llm' | 'mock' | 'none';
  runner: AgentRunner;
  content: { search: typeof searchChunks; subjects: typeof listVisibleSubjects; chapters: typeof listVisibleChapters };
  now: () => Date;
};

type Factories = { [K in keyof TutorDeps]: () => TutorDeps[K] };

let selected: ReturnType<typeof selectDecider> | undefined;
/** One selection shared by `decider` and `deciderProvider` so they always agree. */
function selection() {
  return (selected ??= selectDecider({ registry: resolve('registry') }));
}

const factories: Factories = {
  registry: () => new ModelRegistry(),
  decider: () => selection().decider,
  deciderProvider: () => selection().provider,
  runner: () => new MastraRunner(),
  content: () => ({ search: searchChunks, subjects: listVisibleSubjects, chapters: listVisibleChapters }),
  now: () => () => new Date(),
};

let cached: Partial<TutorDeps> = {};
let override: Partial<TutorDeps> = {};

function resolve<K extends keyof TutorDeps>(key: K): TutorDeps[K] {
  if (key in override) return override[key] as TutorDeps[K];
  if (!(key in cached)) cached[key] = factories[key]();
  return cached[key] as TutorDeps[K];
}

/** Lazy per-member production wiring (a member that is not configured only fails when used). Do not spread. */
export function getDeps(): TutorDeps {
  return {
    get registry() {
      return resolve('registry');
    },
    get decider() {
      return resolve('decider');
    },
    get deciderProvider() {
      return resolve('deciderProvider');
    },
    get runner() {
      return resolve('runner');
    },
    get content() {
      return resolve('content');
    },
    get now() {
      return resolve('now');
    },
  };
}

/** Tests may also pass `deciderProvider` alongside `decider` (otherwise it still comes from env selection). */
export function configureTutor(p: Partial<TutorDeps>): void {
  override = { ...override, ...p };
}

export function resetTutorConfig(): void {
  override = {};
  cached = {};
  selected = undefined;
}
