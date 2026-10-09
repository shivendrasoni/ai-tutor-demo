# AI Tutor for Schools — System Architecture Design

- **Date:** 2026-10-10
- **Status:** Draft for review
- **Scope:** Platform-wide architecture, module boundaries, core data model, tenancy isolation, key flows. Each module gets its own detailed sub-spec (see §10).

## 1. Purpose and success criteria

An AI tutor sold to schools (B2B2C) for students in classes 5–12. Each school's textbooks are uploaded as PDFs; students chat with an agentic tutor grounded in those books and use AI study tools. Schools get a minimal dashboard.

**v1 goal:** a pilot with 1–3 schools within ~2–3 months. Optimize for tutor quality and speed of delivery over breadth.

**Pilot success means:**
- Students at pilot schools use the tutor regularly, and its answers cite the correct book, chapter, and page.
- The Socratic skill guides students to answers instead of handing them over.
- No cross-school data leakage, verified by automated tests.
- Cost per student is measured from day one.

## 2. Decisions (agreed during brainstorming)

| Topic | Decision |
|---|---|
| Hierarchy | Platform → School → Branch → Section (grade 5–12 + name, e.g. "8-A") |
| Who pays | Parents, per student, monthly or annual plans |
| Enrollment | Parent self-signup with a **branch code**; school "manual add" sends the same invite |
| Pilot payments | Manual payment links; platform admin records payment → student activates. Full payment data model built now |
| Content ownership | Per school; branches can add books or hide (swap) school books; teachers upload materials for their sections |
| Roles | platform admin, school admin, branch admin, teacher, student. Parents are not users in v1 |
| Teacher v1 | View student progress; upload materials. (No assigning work, no AI behavior controls) |
| Student login | Username + password, set by the parent at signup |
| Grounding | Book-first with chapter/page citations; may explain beyond the books but flags out-of-syllabus content |
| Platform | Mobile-first responsive web app (PWA) |
| Language | English only |
| Stack | TypeScript end to end: Next.js, Node API routes, Postgres + pgvector |
| LLM layer | **Provider-neutral.** Mastra agent framework on the Vercel AI SDK provider abstraction; model chosen per skill |
| Embeddings | OpenAI `text-embedding-3-small` behind an `Embedder` interface |
| Pilot study tools | Practice tests, study notes, last-night notes, mock exams. **Flashcards deferred** |
| Fast decisions | TypeSafe **Jev** behind a `Decider` interface for retrieval scoping, model routing, intent/skill routing, and syllabus/safety flags. Jev complements vector retrieval; it does not replace it |

## 3. Architecture overview

Modular monolith: one Next.js app (UI + API routes), one ingestion worker, one Postgres database, object storage for original files.

```
┌──────────────────────── Next.js app (mobile-first PWA) ───────────────────────┐
│  /student   chat, study tools        /teacher  progress, upload materials       │
│  /school    admin dashboard          /platform schools, payments, content, QA   │
└───────────────────────────────┬────────────────────────────────────────────────┘
                                │ API routes (TS)
┌───────────────────────────────▼────────────────────────────────────────────────┐
│  ① tenancy   ② enrollment   ③ content   ④ tutor   ⑤ studytools   ⑥ analytics   │
└───────────────┬───────────────────────────────────────┬────────────────────────┘
                │                                       │ jobs (Postgres-backed queue)
        ┌───────▼────────┐                     ┌────────▼─────────┐
        │ Postgres        │◄────────────────────│ Ingestion worker │
        │ + pgvector      │                     └──────────────────┘
        │ + RLS by school │          Object storage (S3/R2): original PDFs
        └─────────────────┘
```

### 3.1 Modules

Each module owns its tables and exposes a typed service interface. Other modules call the interface, never the tables.

| Module | Responsibility | Key interface |
|---|---|---|
| ① tenancy | Schools, branches, sections, users, memberships, roles, branch codes | `resolveActor(session) → {userId, schoolId, roles, branchId?, sectionIds?}` |
| ② enrollment | Signup-with-code, manual add/invite, plans, subscriptions, payments, activation, lapse | `recordPayment(...)`, `studentStatus(studentId)` |
| ③ content | Content items, scoping, exclusions, ingestion orchestration, chunk retrieval | `visibleContent(student)`, `searchChunks(student, query, filters)` |
| ④ tutor | Skills registry, conversations, agent execution, guardrails, token budgets | `runTurn(student, conversationId, message) → stream` |
| ⑤ studytools | Generating artifacts via skills, attempts, scoring, grading | `generate(student, tool, params)`, `submitAttempt(...)` |
| ⑥ analytics | Usage and progress rollups for teacher, school, and platform views | `enrollmentSummary(school, branch?)`, `sectionProgress(section, subject)` |

### 3.2 Provider-neutral LLM layer

- **Agent framework:** Mastra, which runs on Vercel AI SDK providers (OpenAI, Anthropic, Google, and any OpenAI-compatible endpoint). Every skill names its model as config (`provider/model`).
- **What we avoid, to keep providers swappable:** provider-native PDF reading and provider-native citations. Text extraction, page tracking, and citations are ours.
- **Provider-specific options** (e.g. reasoning effort) may appear in a skill's optional `provider_options`. The system must work without them.
- **Seams (interfaces):**
  - `Embedder`: `embed(texts) → vectors`, with model id and dimension
  - `OcrExtractor`: `extract(pageImage) → text`. The first implementation uses a vision-capable model through the AI SDK.
  - `ModelRegistry`: resolves a skill's model string to an AI SDK model
  - `Decider`: fast typed judgments, used wherever code must branch on a judgment about text:
    - `choice(state, options) → {choice, probabilities, confidence}`
    - `score(state, levels) → {score, probabilities, confidence}`
    - `yesNo(state, statement) → p`

    The first implementation is TypeSafe Jev (`POST /v1/systemone`; questions are batched into one call and evaluated in parallel). Because only a Python SDK is documented, we write a small typed HTTP client. The fallback implementation is an LLM structured-output call through the AI SDK. If Jev errors or times out (500 ms budget), the system falls back to it or to the default behavior listed for each decision in §6.3.

### 3.3 Decision layer: what Jev does and does not do

- **Does:** turn a student message into labels the code can act on, and route on them: subject and chapter, difficulty, intent, off-syllabus, needs review. Every answer comes with a confidence, and each consumer defines high, medium, and low behavior (§6.3).
- **Does not:** find passages or produce citations. Vector search over chunks still does that, because the tutor must quote and cite actual pages. Jev narrows *where* vector search looks.
- **Cost logic:** query embedding and pgvector search are already cheap. The expensive step is answer generation. The main savings lever is model routing (a cheap model for easy turns), not replacing retrieval.

## 4. Data model

All tenant-owned tables carry `school_id`. Types are indicative; the sub-specs finalize columns.

### 4.1 Tenancy and people
```
schools              id, name, board, status
branches             id, school_id, name, signup_code (unique, rotatable, can be disabled)
sections             id, school_id, branch_id, grade (5–12), name
users                id, username (unique, platform-wide), password_hash, name,
                     email?, phone?, is_platform_admin
memberships          id, user_id, school_id, branch_id?, role
                     role ∈ school_admin | branch_admin | teacher | student
                     school_admin: branch_id null (all branches); others: branch_id set
subjects             id, school_id, name
teacher_assignments  teacher_id, section_id, subject_id
student_profiles     user_id, school_id, branch_id, grade, section_id?,
                     parent_name, parent_phone, parent_email?,
                     status ∈ pending_payment | active | lapsed | removed
```

### 4.2 Content
```
content_items        id, school_id, grade, subject_id, kind ∈ book | material,
                     scope ∈ school | branch | section, branch_id?, section_id?,
                     title, file_key, uploaded_by,
                     ingest_status ∈ queued | processing | ready | failed, ingest_error?
content_exclusions   school_id, branch_id, content_item_id
chunks               id, school_id, content_item_id, chapter, page_start, page_end,
                     text, embedding vector, embedding_model, embedding_dim
```

**Visibility rule.** `visibleContent(student)` returns the `ready` content items where:
- `school_id = student.school_id` **and** `grade = student.grade`, **and** one of these holds:
  - `scope = school` and the item is not in `content_exclusions` for the student's branch
  - `scope = branch` and `branch_id = student.branch_id`
  - `scope = section` and `section_id = student.section_id`

A branch "swap" is an exclusion of the school item plus a branch-scoped replacement. Teacher materials are `kind = material, scope = section`, and a teacher may upload only to sections they are assigned to.

### 4.3 Payments
```
plans           id, name, interval ∈ monthly | annual, price, currency, active
subscriptions   id, school_id, student_id, plan_id,
                status ∈ pending | active | lapsed | cancelled,
                current_period_start, current_period_end
payments        id, school_id, subscription_id, amount, currency,
                method ∈ manual_link | gateway, external_ref?, paid_at, recorded_by
```
- Recording a payment activates the subscription, extends its period, and sets the student profile to `active`.
- A daily job marks subscriptions past `current_period_end` as `lapsed` and their students as `lapsed`.
- Plans are platform-wide in v1.

### 4.4 Tutor and study tools
```
skills          id, key, name, kind ∈ chat | generator | grader, instructions,
                models jsonb {standard, advanced},
                tools[], output_schema?, provider_options?, enabled
conversations   id, school_id, student_id, skill_id, subject_id?, created_at
messages        id, school_id, conversation_id, role, content, citations jsonb,
                tokens_in, tokens_out, cost, model, latency_ms, flagged,
                decisions jsonb   (every Decider answer for this turn: question, choice/score/p,
                                   confidence, provider, latency_ms)
artifacts       id, school_id, student_id, skill_id,
                type ∈ practice_test | mock_exam | study_notes | last_night_notes,
                params jsonb, content jsonb, source_chunk_ids[]
attempts        id, school_id, artifact_id, student_id, answers jsonb,
                score, max_score, by_chapter jsonb, graded_at
usage_daily     school_id, student_id, date, tokens, cost      (budget enforcement + analytics)
```
Skills are platform-wide in v1. Per-school overrides are out of scope.

## 5. Tenancy isolation

- **Postgres row-level security** applies to every table with `school_id`. Each request runs in a transaction that sets `app.school_id` from the resolved actor, and policies filter on it.
- Platform-admin operations use a separate database role that bypasses RLS. They are only reachable from `/platform` routes.
- RLS covers vector search, since `chunks` is RLS-protected.
- **Within a school**, branch, section, and teacher scoping is enforced in module services:
  - A branch admin sees only their branch.
  - A teacher sees only students in their assigned sections.
  - A student sees only `visibleContent`.

## 6. Key flows

### 6.1 Signup and activation
1. The parent opens `/join`, enters the branch code, and picks the grade (and section if known).
2. The parent enters their own contact details and the student's name, picks a plan (monthly or annual), then sets the student's username and password.
3. A student profile (`pending_payment`) and a pending subscription for the chosen plan are created.
4. The platform admin sends a payment link manually and records the payment, which activates the student.
5. **School manual add:** the admin enters the student and parent details. This creates a pending profile and an invite link for the parent to set credentials and choose a plan. From there the flow continues as above.
6. A `pending_payment` or `lapsed` student who logs in sees an activation-status screen, not the tutor.
7. A school or branch admin can **remove** a student (`status = removed`), which blocks login. Historical data is kept.

### 6.2 Ingestion
1. Upload goes to object storage, then a `content_item` is created (`queued`) and a job is enqueued.
2. The worker extracts text per page. A page with low text density goes through `OcrExtractor`.
3. Chapters are detected from the PDF outline, then from heading heuristics, then from page-range fallback.
4. Text is chunked into ~500–800 tokens with page ranges preserved, embedded, and stored. The item is marked `ready`.
- Steps are idempotent and retried with backoff.
- On failure the item is marked `failed` with the error, and the uploader can retry.
- An item becomes visible only when `ready`; partial ingests are never visible.

### 6.3 Tutor turn
1. The student sends a message in a conversation bound to a skill (default: Socratic) and an optional subject.
2. The tutor checks the student's status and daily token budget (a configurable platform-wide limit; the default value is set in sub-spec 3).
3. **Route (one batched `Decider` call, recent turns + message as state).** The questions and how each answer is used:

   | Question | Primitive | Options / levels | Used for |
   |---|---|---|---|
   | `intent` | choice | `learn_concept`, `solve_problem`, `wants_final_answer`, `exam_prep`, `off_topic`, `unsafe` | Skill and guardrail routing |
   | `subject` | choice | The student's visible subjects, plus `other` | Retrieval scope |
   | `difficulty` | score | `recall`, `apply`, `multi_step` | Model tier |
   | `out_of_syllabus` | yesNo | "The question goes beyond a class-*N* syllabus" | Syllabus flag |
   | `needs_review` | yesNo | "The message suggests distress, harm, or inappropriate content" | Flag queue (an extra safety layer, not the only one) |

   **Chapter.** When `subject` is confident, a second call does `chapter` choice over that subject's visible chapters, plus `none`.

   **Actions by confidence.** Thresholds are initial values, tuned by the routing eval (§8):

   | Decision | Answer and confidence | Action |
   |---|---|---|
   | Subject or chapter | Confidence ≥ 0.7 | Pass as a filter to `search_curriculum` |
   | Subject or chapter | 0.4–0.7 | Filter to the top-2 options |
   | Subject or chapter | < 0.4 | No filter |
   | Difficulty | `multi_step` with p ≥ 0.5 | Use the skill's `advanced` model |
   | Difficulty | Otherwise | Use the `standard` model |
   | Intent | `off_topic` with confidence ≥ 0.8 | Reply with a fixed redirect and make no LLM call |
   | Intent | `unsafe` with p ≥ 0.5 | Send a fixed safe-response template, flag the message, make no LLM call |
   | Intent | `wants_final_answer` | If the conversation's skill is general chat, run the turn in Socratic mode and tell the student so. A student-selected skill is otherwise never overridden. |
   | `out_of_syllabus` | p ≥ 0.6 | Instruct the agent to add the out-of-syllabus flag |
   | `needs_review` | p ≥ 0.5 | Set `messages.flagged` and send to the review queue |

   **Decider failure or timeout:** no filters, `standard` model, no intent override, and the guardrail preamble still applies. This is the same behavior as having no Decider.
4. A Mastra agent is built from the skill config and the chosen model tier. The **shared guardrail preamble** is prepended to every skill:
   - age-appropriate content
   - academic focus
   - refusal of harmful requests
   - cite sources and flag out-of-syllabus content
5. Tool `search_curriculum(query, subject?, chapter?)` calls `content.searchChunks`. That runs pgvector similarity within `visibleContent(student)`, narrowed by the routed filters. It returns chunks labelled with book, chapter, and pages. If a filtered search returns no chunk above the similarity floor, the search is retried without filters.
6. The response streams to the client. Citations are taken from the chunks the tool returned, never from model-invented references.
7. Tokens, cost, latency, model, retrieved chunk ids, and all Decider answers are logged on the message.
- **Failure handling:** a provider error or timeout gets one retry. If that also fails, the student sees "tutor is busy" and their message is kept.

### 6.4 Study artifacts
1. The student picks a tool (practice test, mock exam, study notes, last-night notes) plus subject and chapters.
2. The generator skill runs with `search_curriculum` (scoped to the chosen chapters, so no routing call is needed) and its `output_schema`. The output is validated; on failure there is one repair attempt, then an error.
3. The artifact is saved with `source_chunk_ids`. Every question or note section must reference at least one source chunk.
4. **Mock exams** follow a board exam pattern template (sections, marks, question types, duration) attached to the skill params. They are timed in the UI.
5. **Scoring:** objective questions are auto-scored. Subjective answers are graded by a `grader` skill against a rubric generated alongside the question, and the result is shown as feedback.
6. Each attempt stores `by_chapter` scores, which feed the progress views.

### 6.5 Dashboards (minimal)
- **School/branch admin:**
  - enrolled students by branch and grade, with status counts
  - each student's plan and status
  - remove student, manual add (invite), rotate branch code
- **Teacher:** for assigned sections and subjects, usage per student and attempt scores by chapter (weak chapters highlighted). Material upload with ingest status.
- **Platform admin:**
  - schools, branches, and content items
  - the pending-payment queue and record-payment action
  - plans
  - flagged conversations
  - cost per school

## 7. Error handling principles
- User-facing failures show an actionable state ("tutor is busy", "awaiting activation", "ingest failed — retry") and never a raw error.
- Background jobs are idempotent with bounded retries. Terminal failures are visible to the user who started the job.
- An LLM output that fails schema validation gets one repair attempt, then a clean failure. Invalid artifacts are never saved.

## 8. Testing strategy
- **Isolation suite (CI, mandatory):** acting as School A, attempt to read School B's students, content, chunks (including via vector search), conversations, artifacts, and payments through every module. All attempts must return nothing.
- **Visibility resolver:** table-driven tests over school, branch, exclusion, and section scopes and grade boundaries.
- **Ingestion:** fixture PDFs (text-based, scanned, equation-heavy), asserting chapter detection, page ranges, and OCR fallback.
- **Tutor evals (on demand + before any model or prompt change):**
  - ~30 golden questions per pilot book, each with its expected chapter and page. Measures retrieval hit rate and citation accuracy.
  - A Socratic rubric scored by an LLM judge: the final answer is not stated until the student has made at least one attempt at it, and guiding questions are asked.
  - These evals are the gate for swapping providers or models.
- **Routing eval (before trusting Jev, and before any threshold change):**
  - ~200 real or realistic student messages labelled with subject, chapter, intent, difficulty, and out-of-syllabus.
  - For each decision, measure accuracy at each confidence band, and choose thresholds where the high band is ≥ 95% accurate.
  - Also measure end-to-end citation accuracy with routing on vs off. Routing must not reduce it.
  - Run the same eval against the LLM fallback `Decider`, so the fallback's quality is known.
- **Study tools:** schema validation, a source-chunk reference check, and scoring correctness on fixture answers.

## 9. Observability
- Per model call: skill, model, tokens, cost, latency, retrieved chunk ids. These roll up to cost per student, per school, and per skill.
- Per Decider call: answers, confidences, latency, provider, fallback used. Dashboards show:
  - the share of turns routed to the `advanced` model
  - off-topic blocks
  - filter fallbacks (filtered search returned nothing)
  - Decider error rate
- Error tracking (e.g. Sentry); ingestion job dashboard.
- **Flagged conversations queue:** guardrail triggers plus student thumbs-down, reviewed in `/platform`.

## 10. Decomposition and build order

Each item gets its own spec → plan → implementation cycle:

1. **Tenancy, identity & enrollment:** modules ①②, RLS foundation, isolation test suite, signup/activation, manual payments, plans
2. **Content & ingestion:** module ③, the worker, `Embedder`/`OcrExtractor`, visibility resolver, upload UIs
3. **Tutor agent & skills:** module ④, Mastra integration, skills registry, guardrails, Socratic + general chat skills, citations, budgets, `Decider` (Jev client + LLM fallback) and turn routing, eval harness including the routing eval
4. **Study tools:** module ⑤, practice tests, mock exams (exam pattern templates), study notes, last-night notes, grading
5. **Dashboards & analytics:** module ⑥, school/branch/teacher/platform views, flagged queue, cost reporting

## 11. Out of scope for v1
- Payment gateway integration (data model ready; `method = gateway` reserved)
- Flashcards
- Parent accounts and parent dashboard
- Teachers assigning work or controlling AI behavior
- Per-school skill or plan customization
- Languages other than English
- Native mobile apps; offline mode

## 12. Pilot prerequisites (non-code)
- **TypeSafe vendor review:** student messages from minors are sent to TypeSafe. Before the pilot, get written answers on data retention, training use, data residency, pricing, latency, and rate limits, and sign a DPA. Do the same for the LLM and embedding providers in use. If TypeSafe can't meet these terms, ship with the LLM fallback `Decider`.
