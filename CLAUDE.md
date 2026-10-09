# AI Tutor for Schools

Multi-tenant AI tutor for school students (classes 5–12). The specs live in `docs/superpowers/specs/` and the implementation plans in `docs/superpowers/plans/`. The architecture spec `2026-10-10-ai-tutor-architecture-design.md` is the source of truth for cross-cutting decisions.

## Environment (this machine)
- The tools are not on the default PATH. Start every shell command with:
  `export PATH=/opt/homebrew/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH`
- Node 22, pnpm, and the Docker daemon (Docker Desktop) are available. Postgres runs only via `docker compose up -d` (image `pgvector/pgvector:pg16`).
- No LLM, embedding, or TypeSafe API keys are configured. Every test must use the fakes (`FakeEmbedder`, `FakeDecider`, AI SDK mock language models). Code paths that call real providers are enabled only when their env vars are set, and they are never required by `pnpm test`.

## Conventions
- TypeScript strict. Modules live in `src/modules/<name>`, and other modules import only from `src/modules/<name>/index.ts`.
- Every tenant table has `school_id` with forced RLS. School-scoped DB work goes through `withTenant` or `runAs`; platform and system work goes through `withPlatform`.
- Service functions take an `Actor` first and throw `DomainError` with a code from `src/lib/errors.ts`.
- Work is test-first (Vitest; Playwright for e2e). Make small commits.
