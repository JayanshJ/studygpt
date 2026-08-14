# Study Intelligence Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable intelligence and navigation features to the study chat while preserving a focused chat-first experience.

**Architecture:** Extend the existing SSE answer pipeline with trusted activity and grounding metadata, persist narrowly scoped SQLite records, and layer lightweight client UI on the current message, context rail, and dialog components. Each feature remains independently useful and deployable.

**Tech Stack:** Next.js App Router, React 19, TypeScript, SQLite/better-sqlite3, AI SDK streaming, Tailwind, Framer Motion, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-14-study-intelligence-workbench-design.md`

## Global Constraints

- Preserve chat-first, responsive UI and progressive disclosure.
- Never persist or display model chain-of-thought.
- Persist only trusted server status labels and explicit user memory.
- Use additive SQLite migrations compatible with existing installations.
- Do not duplicate artifact rendering logic.
- Verify every task with targeted tests, TypeScript, `git diff --check`, and production build before completion.

---

### Task 1: Durable study activity and grounding

**Files:**
- Modify: `lib/chat/sse.ts`, `lib/chat/answer-engine.ts`, `app/api/chat/route.ts`, `lib/db/schema.ts`, `lib/db/index.ts`, `lib/db/messages.ts`, `app/(app)/page.tsx`, `components/ChatMessage.tsx`
- Create: `lib/db/message-insights.ts`, `components/chat/AnswerInsights.tsx`
- Test: `lib/db/message-insights.test.ts`, `components/chat/AnswerInsights.test.tsx`

- [ ] Write failing persistence and rendering tests for ordered activity and grounding metadata.
- [ ] Add additive SQLite storage and typed query helpers.
- [ ] Emit and persist sanitized activity/grounding events; load them with conversations.
- [ ] Render a collapsed response insight panel, then verify focused tests.

### Task 2: Conversation search and artifact focus

**Files:**
- Modify: `lib/db/conversations.ts`, `app/(app)/page.tsx`, `components/chat/ConversationContextPanel.tsx`
- Create: `app/api/search/route.ts`, `components/chat/ConversationSearch.tsx`, `components/chat/ArtifactFocusDialog.tsx`
- Test: `lib/db/conversations.test.ts`, `components/chat/ConversationSearch.test.tsx`, `components/chat/ArtifactFocusDialog.test.tsx`

- [ ] Write failing tests for scoped text search and focus-dialog selection.
- [ ] Add safe ranked SQLite search and route validation.
- [ ] Add a keyboard-accessible search dialog that navigates and scrolls to results.
- [ ] Add artifact focus actions using existing markdown/artifact renderers and verify tests.

### Task 3: Interrupted response persistence and retry

**Files:**
- Modify: `lib/db/schema.ts`, `lib/db/index.ts`, `lib/db/messages.ts`, `app/api/chat/route.ts`, `app/(app)/page.tsx`, `components/ChatMessage.tsx`
- Test: `lib/db/messages.test.ts`, `app/api/chat/route.test.ts`

- [ ] Write failing tests for message delivery states and partial-output persistence.
- [ ] Add `delivery_state` migration and message helper support.
- [ ] Debounce partial persistence during streaming and mark failures as interrupted.
- [ ] Surface an accessible retry action that regenerates from the original prompt; verify tests.

### Task 4: Editable project memory

**Files:**
- Modify: `lib/db/schema.ts`, `lib/db/index.ts`, `lib/chat/answer-engine.ts`, project settings UI
- Create: `lib/db/project-memory.ts`, `app/api/projects/[id]/memory/route.ts`, `components/projects/ProjectMemory.tsx`
- Test: `lib/db/project-memory.test.ts`, `app/api/projects/[id]/memory/route.test.ts`, `components/projects/ProjectMemory.test.tsx`

- [ ] Write failing tests for scoped, active-only project memory and API validation.
- [ ] Add additive storage, bounded prompt retrieval, and CRUD route.
- [ ] Add an editable project memory panel with activate, remove, and add interactions.
- [ ] Verify only active explicit entries influence answer prompts.

### Task 5: Integrated quality gate

**Files:**
- Modify: affected tests and user-facing copy only as required by preceding tasks.

- [ ] Run all feature-level Node tests.
- [ ] Run `npx tsc --noEmit` and record pre-existing lint issues separately.
- [ ] Run `git diff --check` and `npm run build`.
- [ ] Check desktop and narrow responsive behavior for every newly added dialog or panel.
