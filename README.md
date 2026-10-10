# AI Tutor for Schools

Multi-tenant AI tutor for school students (classes 5-12). Specs live in `docs/superpowers/specs/`, plans in `docs/superpowers/plans/`.

## Running locally without API keys

The app runs end to end with deterministic mock AI providers, so you need no OpenAI, Anthropic or TypeSafe keys.

```sh
docker compose up -d        # Postgres (pgvector)
pnpm db:migrate
pnpm dev                    # web app; `next dev` sets NODE_ENV=development, which turns mock mode on
pnpm worker:dev             # ingestion + study-tools worker with NODE_ENV=development (mock mode on)
```

Outside `NODE_ENV=development` (for example plain `pnpm worker`, which runs under tsx with no `NODE_ENV`) mock mode stays off, so a production deploy without keys never serves fake answers. Force it explicitly with `AI_MOCK=1` (for example `AI_MOCK=1 pnpm worker`); `AI_MOCK=0` forces it off.

What the mocks do:

- Chat: `mock/standard` and `mock/advanced` call `search_curriculum` with your message, then answer from the first passage and cite `[1]`. The Socratic skill replies with a guiding question.
- Study tools: practice tests, mock exams (exact pattern), study notes, last-night notes and answer grading are generated from the retrieved passages (grading gives half marks).
- Routing decider: a keyword heuristic stands in for Jev. OCR returns a placeholder for pages without a text layer. Embeddings use the fake embedder unless `EMBEDDER` says otherwise.
- Mock models cost 0, but their tokens count toward the daily token budget.

**Warning:** `AI_MOCK=1`, `LLM_STANDARD_MODEL`/`LLM_ADVANCED_MODEL` set to `mock/...`, and `DECIDER=mock` are explicit mock opt-ins that apply even in production. Never set them on a real deployment.

A console line ("AI mock mode: ...") is logged once per process when mock mode is used.

### Switching to real providers

Mock mode switches itself off in `development` as soon as any real-provider setting is present, or when `AI_MOCK=0`:

| Variable | Effect |
| --- | --- |
| `OPENAI_API_KEY` (also `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_COMPAT_BASE_URL`) | Credentials for the chat provider |
| `LLM_STANDARD_MODEL`, `LLM_ADVANCED_MODEL` | Real chat and study-tool models, as `provider/model` (e.g. `openai/gpt-4o-mini`) |
| `TYPESAFE_API_KEY` | Jev routing decider (otherwise the LLM decider, then the mock decider) |
| `OCR_MODEL` | Real OCR for pages without a text layer |
| `EMBEDDER` | Real embeddings instead of the fake embedder |

See `.env.example` and `docs/superpowers/plans/AS-BUILT-subproject-3.md` for the full list.

## Tests

`pnpm vitest run` (unit and integration, needs the Docker Postgres), `pnpm e2e` (Playwright), `pnpm tsc --noEmit`. No test needs real keys.
