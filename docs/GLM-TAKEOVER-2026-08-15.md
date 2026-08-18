# StudyGPT GLM Takeover

**Prepared:** 2026-08-15
**Repository:** `/Users/jayansh/Developer/Personal/chat`
**Branch:** `feat/minimal-orange-redesign`
**Last pushed commit:** `07b26fe feat: add native chat artifact renderers`
**GitHub:** `https://github.com/JayanshJ/chat/tree/feat/minimal-orange-redesign`

This is the authoritative handoff for continuing the session with GLM. It records the product intent, completed systems, current uncommitted work, validation evidence, and exact resume order.

## Product North Star

Every change must make StudyGPT easier to use and more intelligently aware of the learner. Reuse conversation, selected text, project materials, notation memory, mastery, and user intent. Avoid hidden modes, repeated setup, and complexity that does not improve ease or intelligence. Read `AGENTS.md` first.

## User preferences established

- No visible Document mode. Detect PDF/document intent automatically.
- PDF requests must return a real downloadable PDF in chat, not a separate HTML download page.
- PDFs must be standalone authored explainers, not chat transcripts.
- Quality matters more than speed; long generation is acceptable.
- Artifacts and diagrams should render inline and blend with StudyGPT.
- Course diagrams must follow notation found in uploaded materials.
- Ask only for large decisions; infer routine implementation details.
- UI should be responsive, smooth, dynamic, and moderately rounded.
- Preserve useful memory such as notation and overlay discussions.
- Large work should use implementation subagents plus independent review.

## Runtime and architecture

- Next.js 16.3 App Router, React 19, TypeScript.
- AI SDK `ai@7` and `@ai-sdk/openai-compatible`.
- SQLite via `better-sqlite3`.
- Text backend: Ollama-compatible, usually `glm-5.2:cloud` at `http://localhost:11434/v1`.
- Vision backend: OpenRouter, default `google/gemini-2.5-flash`.
- PDF extraction: `unpdf`; PDF page rendering: `mupdf`.
- PDF export: Puppeteer/headless Chromium.
- Mermaid v11 for compatible diagram types.
- Read relevant local Next.js docs under `node_modules/next/dist/docs/` before framework changes.

## Completed work

### Direct PDFs and automatic documents

- `app/api/messages/[id]/pdf/route.ts` returns a real PDF generated from `/print/[id]`.
- `ChatMessage` has a direct download-PDF action.
- Print pages wait for Mermaid/visual rendering.
- `lib/chat/pdf-intent.ts` detects PDF, cheat-sheet, study-guide, A4, page-count, and printable-document requests.
- The visible document-mode toggle was removed.
- Document turns drop chat history and author standalone material.
- Document prompts forbid HTML artifact/flashcard fences.
- Document output budget is 32,768 tokens with high reasoning.

### Inline diagrams and course notation

- `MermaidDiagram.tsx` renders Mermaid inline with strict security and platform colors.
- Mermaid syntax-error SVGs are detected before display.
- Uploaded PDFs are persisted and pages render to JPEG through `lib/ingest/pdf-pages.ts`.
- `chunks.page` maps retrieval chunks to one-indexed PDF pages.
- PDF extraction preserves page boundaries using `mergePages: false` joined with form feeds.
- `diagram-intent.ts` classifies ER, flowchart, sequence, class, state, and generic diagrams.
- `notation.ts` sends relevant page images to the OpenRouter vision model.
- `db/notation.ts` caches notation by project and diagram type.
- Existing PDFs can be healed on re-upload without rebuilding chunks or the concept graph.
- Mermaid is used when faithful; legacy custom SVG remains available for notation Mermaid cannot express.

### Regeneration and dynamic activity

- User prompts have edit and regenerate controls.
- Regeneration from a prompt truncates trailing messages and preserves document kind.
- The answer engine emits material-search, found-source, notation, thinking, web-search, and writing activities.

### Persistent contextual overlays

- Selecting assistant text shows Ask/Explain.
- `ChatOverlay.tsx` opens a large blurred-background overlay with full conversation/material context.
- Enter sends; Shift+Enter creates a newline.
- Voice typing is shared with the main composer.
- Overlay threads/messages persist in SQLite.
- Clicking a highlighted passage reopens its saved overlay.
- Repeated equal text is disambiguated with `text_offset`.
- Main files: `SelectionAskController.tsx`, `ChatOverlay.tsx`, `OverlaySourceMarkers.tsx`, `overlay-context.ts`, `use-overlay-chat.ts`, `db/overlays.ts`, and overlay API routes.

### UI and context architecture

- Conversation content and composer share one centered max-width axis.
- The right-side dark strip/scrollbar imbalance was fixed and user-confirmed.
- Radius was reduced globally after feedback.
- Motion honors reduced-motion and was tuned after FPS concerns.
- A collapsible right context rail indexes conversation artifacts and sources.
- Artifacts open in a focused dialog.
- Search, sidebar, sheets, model controls, and chat remain responsive.
- Project memory, answer grounding/activity, mastery, concept graph, and learning paths are integrated.

### Native artifact engine

Commit `07b26fe` added StudyGPT-owned artifacts instead of model-authored mini web pages.

Canonical envelope:

    {
      "schema": "studygpt.artifact",
      "version": 1,
      "kind": "diagram|table|comparison|steps|callout|chart",
      "title": "optional",
      "summary": "optional",
      "data": {}
    }

Native renderers exist for tables, comparisons, steps, callouts, charts, and Mermaid diagrams. `lib/artifacts/schema.ts` validates and normalizes model output. Legacy HTML stays sandboxed. Invalid payloads show a compact fallback. Chart aliases such as `series.name` and `xAxis.values` are normalized. Chart labels/grid sizing and Mermaid dark-theme readability were fixed.

Validation at that milestone: 32 focused tests passed, TypeScript passed, and `git diff --check` passed.

## Provider status

Settings currently support Ollama chat configuration, Tavily web search, an OpenAI key for voice transcription, and OpenRouter vision configuration.

The user asked for OpenAI as a full chat provider. It is not implemented. Intended behavior: provider selector, OpenAI base URL `https://api.openai.com/v1`, separate per-provider model/key persistence, and validation before streaming. A default of `gpt-4.1-mini` was proposed.

## Current uncommitted workflow upgrade

Approved spec: `docs/superpowers/specs/2026-08-15-study-workflow-upgrades-design.md`

Plan: `docs/superpowers/plans/2026-08-15-study-workflow-upgrades.md`

Ledger: `.superpowers/sdd/2026-08-15-study-workflow-upgrades/progress.md`

The four selected upgrades are source evidence, global command palette, proactive study actions, and editable/versioned artifacts.

### Task 1: source evidence — complete and review-clean

Uncommitted files include:

- `lib/chat/evidence.ts`
- `lib/chat/evidence-route.ts`
- `lib/chat/evidence-preview.ts`
- `app/api/materials/[id]/evidence/route.ts`
- `components/chat/SourceCitationStrip.tsx`
- `components/chat/EvidenceDialog.tsx`
- integrations/tests in `ChatMessage` and the main chat page.

Behavior: source chips deduplicate by material/chunk/page; PDF citations open the exact rendered page; URL/no-page sources show the stored passage; failures use generic 404s; URL materials never invoke PDF rendering; object URLs are revoked safely after cancellation.

Evidence: 9 focused tests passed, TypeScript passed, diff check passed, and the independent re-review approved both original findings.

### Task 2: global command palette — implemented, review pending

Uncommitted implementation:

- `lib/chat/global-search.ts` and tests.
- expanded `lib/db/index.ts`.
- expanded `app/api/search/route.ts`.
- `components/chat/CommandPalette.tsx` and tests.
- integration in `app/(app)/page.tsx`.

Reported behavior: search conversations, messages, materials, concepts, overlays, and artifacts; active-project ranking; maximum 8 results per kind and 30 total; keyboard navigation; `Cmd/Ctrl+K`; exact result destinations; artifacts derived through `buildConversationContext`.

Reported evidence: 12 focused tests passed, TypeScript passed, diff check passed.

Reviewer agent `01a00321-0669-7840-ad5a-60a0407a4ef4` was still running or had not returned when the user requested this handoff. Check it or independently review Task 2 before marking the ledger complete.

### Tasks 3–6: not started

- Task 3: deterministic, dismissible proactive study actions that open contextual overlays.
- Task 4: stable native artifact ids as `messageId:artifact:ordinal`.
- Task 5: SQLite artifact-version persistence and validated transform routes.
- Task 6: artifact edit/version/restore UI and end-to-end integration.

## Exact git state at handoff

Tracked modifications:

- `app/(app)/page.tsx`
- `app/api/search/route.ts`
- `components/ChatMessage.tsx`
- `lib/db/index.ts`

Untracked files include Task 1 evidence files/tests, Task 2 palette/search files/tests, and the 2026-08-15 workflow spec/plan.

Do not reset, clean, checkout, or overwrite the working tree. These changes belong to the active implementation.

## Validation commands

    node --import tsx --test \
      lib/chat/evidence.test.ts \
      lib/chat/evidence-preview.test.ts \
      'app/api/materials/[[]id[]]/evidence/route.test.ts' \
      components/chat/SourceCitationStrip.test.ts \
      components/ChatMessage.evidence.test.ts \
      'app/(app)/page.evidence.test.ts' \
      lib/chat/conversation-search.test.ts \
      lib/chat/global-search.test.ts \
      components/chat/CommandPalette.test.tsx
    npx tsc --noEmit
    git diff --check

The `[id]` route path must be escaped as `[[]id[]]` for Node test discovery.

Known unrelated broader failures: `npm run build` previously hit the existing Google Newsreader/Turbopack font path and a DB dynamic-filesystem trace warning. Lint has unrelated pre-existing errors. Do not fix these during focused feature work unless the new diff is proven causal.

`mupdf` is ESM with top-level await. The evidence route uses an injected handler boundary so tests can execute route behavior without importing `mupdf` through CJS.

## Data safety

- SQLite and uploaded material data live under gitignored `data/`.
- Do not rebuild the concept graph just to create page images.
- Do not delete stored PDFs/page images.
- Old PDFs without retained page boundaries cannot be perfectly reconstructed from extracted text; use stored-PDF healing/fallback sampling.
- Notation cache should only reference material ids that still exist.

## Resume order for GLM

1. Read `AGENTS.md` and this file.
2. Read the 2026-08-15 workflow spec, plan, ledger, Task 1 report, and Task 2 report.
3. Inspect `git status --short` and preserve all current changes.
4. Obtain or recreate the Task 2 review verdict; fix blocking findings and update the ledger.
5. Continue Tasks 3–6 sequentially with fresh implementer and reviewer agents.
6. Run the full focused suite, TypeScript, and diff check.
7. Browser-smoke-test citations, command palette, proactive overlays, artifact transform/version restore, and refresh persistence.
8. Do not commit or push unless the user explicitly asks.

## Files to read first

1. `AGENTS.md`
2. `docs/GLM-TAKEOVER-2026-08-15.md`
3. `docs/superpowers/specs/2026-08-15-study-workflow-upgrades-design.md`
4. `docs/superpowers/plans/2026-08-15-study-workflow-upgrades.md`
5. `.superpowers/sdd/2026-08-15-study-workflow-upgrades/progress.md`
6. Task 1 and Task 2 reports in that SDD directory.
7. `lib/chat/answer-engine.ts`
8. `lib/artifacts/schema.ts`
9. `app/(app)/page.tsx`

## Final state

The platform now has direct PDFs, inline diagrams, course-notation vision/cache, persistent contextual overlays, centered responsive UI, context rail, project intelligence, and native artifacts. The current working tree adds review-clean source evidence and an implemented but not-yet-reviewed global command palette. Proactive study actions and artifact editing/versioning remain pending.
