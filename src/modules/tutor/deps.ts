import { listVisibleChapters, listVisibleSubjects, searchChunks } from '@/modules/content';
import type { Decider } from './decider/types';
import { ModelRegistry } from './models/registry';
import type { AgentRunner } from './runner/types';

export type TutorDeps = {
  registry: ModelRegistry;
  decider: Decider;
  runner: AgentRunner;
  content: { search: typeof searchChunks; subjects: typeof listVisibleSubjects; chapters: typeof listVisibleChapters };
  now: () => Date;
};

type Factories = { [K in keyof TutorDeps]: () => TutorDeps[K] };

const factories: Factories = {
  registry: () => new ModelRegistry(),
  // Tasks 3 and 7 replace these with selectDecider() and new MastraRunner().
  decider: () => {
    throw new Error('not configured');
  },
  runner: () => {
    throw new Error('not configured');
  },
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

export function configureTutor(p: Partial<TutorDeps>): void {
  override = { ...override, ...p };
}

export function resetTutorConfig(): void {
  override = {};
  cached = {};
}
