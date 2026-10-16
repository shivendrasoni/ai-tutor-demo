# Plan: UI-only demo
1. Foundation (sequential, me): spec, `src/demo/core/*`, registry stubs, root layout/DemoShell, `/` + `/login` persona entry, guard test.
2. Parallel (disjoint file sets, one agent each): student area; teacher area; school+branch admin area; platform admin + public pages (status/join/invite/login).
3. Integrate: typecheck, vitest, next build, Playwright persona smoke; fix; commit.
