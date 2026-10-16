# UI-only interactive demo (branch `demo/ui-only-prototype`)

## Goal
A clickable, stateful prototype of the whole product with no DB, auth, worker, or LLM. The UI is the existing UI. A persona toggle switches between Student (grades 5-7, 8-12, pending payment), Teacher, Branch admin, School admin, and Platform admin. Actions work (chat, quizzes, adding/removing students, recording payments) against an in-browser store.

## Decisions (confirmed with the user)
- Fake in-browser backend: fixtures seed a client store persisted in `localStorage`; "Reset demo" restores the seed.
- Same Next app. Because the branch is demo-only, existing routes are converted in place (no `/demo` prefix): server pages that called DB loaders become client pages reading the store; hrefs and `fetch('/api/*')` calls in child components stay unchanged.

## Architecture (`src/demo/`)
- `core/store.ts`: typed store (`useDemoStore`, `getState`, `mutate`), persistence, reset, `persona` state.
- `core/fetch.ts`: `installDemoFetch()` patches `window.fetch`; requests to `/api/*` go to a handler registry (`method + path pattern -> handler`), with small latency. Unknown routes return a clear 404 JSON.
- `core/sse.ts`: helper to produce a streamed `Response` of SSE frames (used for tutor chat).
- `core/personas.ts`: persona definitions, home route per persona.
- `core/DemoShell.tsx`: root provider (installs fetch, hydrates store, floating persona switcher + reset), client route guard (wrong persona -> persona home).
- `areas/{student,teacher,school,platform}/`: each owns `fixtures.ts` (seed slice), `handlers.ts` (API mirror), and the page conversions for its routes.
- `registry.ts`: composes seeds and handlers from the four areas.
- Shared people/ids live in `core/seed-core.ts` (school, branches, sections, teachers, students, subjects) so every area is consistent.

## Constraints
- Demo code never imports `src/modules/*`, `src/db`, `next/headers`, or `pg`. A Vitest test enforces this.
- Chat uses a scripted Socratic reply streamed token by token. No LLM.
- Tests: Vitest for store/handlers/import-boundary; Playwright smoke across all personas.

## Out of scope
Real auth, real uploads/ingestion (upload adds a fake item), real payments.
