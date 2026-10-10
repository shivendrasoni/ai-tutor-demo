# As-built: sub-project 3 (tutor agent)

Later plans must use these real names. They take precedence over plan 3's text wherever the two differ.

## Public exports of `src/modules/tutor/index.ts`
- Conversations: `createConversation`, `listChatSubjects`, `getMessages`, `listConversations`, `submitFeedback`; type `MessageRow`
- Turn: `runTurn(actor, conversationId, text, { signal? })` is an async generator of `TurnEvent` (`meta`, `delta`, `citations`, `done`, `error`). Pre-stream failures (`FORBIDDEN`, `NOT_FOUND`, `VALIDATION`) throw on the first `next()`.
- Skills: `listSkills`, `seedSkills`, `SEED_SKILLS`; types `SkillRow`, `SkillKind`, `SeedSkill`
- Structured generation: `runSkillStructured`; type `StructuredUsage`
- Wiring and seams: `configureTutor`, `resetTutorConfig`, `ModelRegistry`, `FakeDecider`; types `TutorDeps`, `TutorModel`, `ModelTier`, `Decider`, `DeciderAnswer`, `DeciderQuestion`, `DeciderRun`, `AgentRunner`, `RunEvent`, `RunInput`, `Citation`
- Other modules import only from the index.

## Environment variables
- `LLM_STANDARD_MODEL`, `LLM_ADVANCED_MODEL`: `provider/model` (provider is `openai | anthropic | google | compat | mock`). They are the fallback when a skill has no `models` entry for the tier. In mock mode an unset value defaults to `mock/standard` / `mock/advanced` (`llmModel`); otherwise a missing value makes the turn end with `TUTOR_BUSY` (and a model-not-configured log line). `mock/*` always resolves in `ModelRegistry` (no key needed), even outside mock mode.
- `OPENAI_COMPAT_BASE_URL` (and optional `OPENAI_COMPAT_API_KEY`): for `compat/...` models.
- Provider API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`.
- `AI_MOCK=1|0` (`aiMockMode()` in `src/lib/ai-mode.ts`): `1` forces mock providers on, `0` forces them off. Unset or empty: on only when `NODE_ENV === 'development'` (set by `next dev`; unset NODE_ENV, as in a tsx worker, never enables it, so use `pnpm worker:dev` or `AI_MOCK=1` for the worker), `VITEST` is unset, and none of `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_COMPAT_BASE_URL`, `TYPESAFE_API_KEY`, `LLM_STANDARD_MODEL`, `LLM_ADVANCED_MODEL` is set. Production therefore needs an explicit `AI_MOCK=1`. It logs one `console.warn` ("AI mock mode: ...") per process on first use. Playwright's server and global-setup worker set `AI_MOCK=1`.
- `DECIDER=jev|llm|mock|none`: default is `jev` if `TYPESAFE_API_KEY` is set, else `llm` if `LLM_STANDARD_MODEL` is set, else `mock` in mock mode, else `none`. `selectDecider` order: `jev` (with key), `llm` (only over a non-`mock/*` spec; an `LlmDecider` is never built over a mock model), `MockDecider` (`DECIDER=mock`, mock mode, or a `mock/*` `LLM_STANDARD_MODEL`), then none. `DECIDER=none` always wins. Note `LLM_STANDARD_MODEL=mock/standard` selects `MockDecider` (provider `mock`) even without full mock mode.
- `TYPESAFE_API_KEY`: Jev decider (`jev-latest`, 500 ms timeout, falls back to `llm`, then to no decision).
- `STUDENT_DAILY_TOKEN_LIMIT`: tokens (in + out) per student per UTC day, default 200000. Checked only before a turn; usage equal to the limit counts as exhausted.
- `MODEL_PRICES`: JSON `{ "<provider/model>": { "inPerM": n, "outPerM": n } }` in USD. A model without a price has `cost = null`, except `mock/*` models, which cost 0 (their tokens still count toward the daily budget).
- `EVAL_JUDGE_MODEL`: judge model for the eval scripts.

## Mock language model (`src/modules/tutor/models/mock.ts`)
`createMockModel(id)` is a deterministic spec-v4 model (provider `mock`) used through the real `MastraRunner` and `runSkillStructured`. It reads the call options: with `search_curriculum` offered and no tool result yet it calls the tool with the student's message; with a tool result it replies from the first passage, citing `[1]` (the `socratic` system prompt gets a guiding question instead; no results gives the "beyond your textbook" line). With a JSON `responseFormat` it generates schema-valid output from the prompt: explicit generators keyed on the schema shape (practice test, mock exam following the requested sections, study/last-night notes, grader with score = half marks) and a generic JSON-schema filler as fallback. Usage is fixed (tool call 20/5, text 30/15, JSON 40/30 tokens in/out). Keyless integration test: `tests/integration/mock-mode.test.ts`; e2e: `e2e/tutor-mock-chat.spec.ts` (the Playwright server also sets `DECIDER=mock`).

## Scripts
- `pnpm seed:skills`: upserts `SEED_SKILLS` (`socratic`, `explain`) by key.
- `pnpm eval:tutor`, `pnpm eval:socratic`, `pnpm eval:routing`: eval harnesses (they call real models; not part of `vitest`).

## `messages.decisions` keys
`answers`, `tier`, `fixedReply`, `filterFallback`, `deciderProvider`, `deciderError`, `deciderFellBack`, `latencyMs`, `aborted`.
- `deciderProvider` is the configured provider (`jev | llm | mock | none`), not the one that answered. `mock` is the deterministic keyword `MockDecider` (`decider/mock.ts`; pure, no I/O, sanitized output); analytics `routingStats` does not group by provider, so `mock` turns count like any other and no DB constraint exists on the value. Use `deciderFellBack` to detect that the chain fell back; `deciderError` means every decider failed and defaults applied.
- `tier` is `null` for fixed replies (no model ran); `messages.model` and `messages.model_tier` are also null for them. Otherwise it is `standard | advanced`.
- `fixedReply` is `'off_topic' | 'unsafe' | null`. `filterFallback` is true when the filtered search found nothing and was retried unfiltered. `aborted` is true when the client left mid-stream (the partial text is kept).
- `flag_reason` is `'decider_review' | 'unsafe' | 'student_feedback'`.

## Usage metering rules
- Whenever the provider was invoked, the turn records usage in `usage_daily` (atomic upsert), using the reported usage or an estimate (`ceil(chars / 4)`). This holds on abort and on failure before the first delta.
- No empty assistant row is ever stored. A provider failure or an empty finished stream stores nothing and ends with `error TUTOR_BUSY`; the user message is kept.
- A failure while saving the assistant message is logged (redacted) and yields `error TUTOR_BUSY` instead of `done`; it never throws out of the generator.
- Retries: the runner disables Mastra's own retries (`modelSettings.maxRetries = 0`, `errorProcessorDefaults: false`); `runTurn` retries once, only if nothing was streamed.
- A pre-meta `TUTOR_BUSY` (model not configured) maps to HTTP 503 after the user message is stored; the web client therefore restores the draft only for network failures and 4xx (`shouldRestoreDraft` in `src/lib/sse-client.ts`).

## Adding skills from another sub-project
`seedSkills(extra?: readonly SeedSkill[])` upserts `SEED_SKILLS` plus `extra` by key. Sub-project 4 passes its generator and grader skills:

```ts
import { seedSkills, type SeedSkill } from '@/modules/tutor';
await seedSkills([quizGenerator, quizGrader]);
```

On conflict it updates `name`, `kind`, `instructions`, `tools`, `outputSchema`, `providerOptions`. It never touches `models` or `enabled` (operator-owned).

## HTTP
`GET /api/tutor/subjects` returns the student's visible chat subjects `[{ id, name }]` (for the subject picker; `FORBIDDEN` unless an active student). The other routes: `GET /api/tutor/skills`, `GET|POST /api/tutor/conversations`, `GET|POST /api/tutor/conversations/[id]/messages` (POST streams SSE), `POST /api/tutor/messages/[id]/feedback`.

## Test seams (`tests/helpers/tutor.ts`)
- `useTutorFakes({ model, decider, hits, runner, subjects, chapters })` wires the deps to fakes and stubs the LLM env; call `resetTutorFakes()` in `afterEach`.
- `scriptedModel(steps)` is a `MockLanguageModelV4` with one scripted step per `doStream` (`text`, `toolCall`, or `error`) and a `calls` counter.
- `activate(actor)` sets the student profile to `active`; `seedTutorSkills()` seeds `socratic` and `explain`.
- `fakeContent` is the content-seam fake (`search` is a spy).
