# Study Intelligence Workbench Design

## Goal

Make every conversation easier to navigate, inspect, recover, and personalize without turning the focused chat screen into a general-purpose workspace.

## Product Principles

- Every capability must reduce friction or improve the tutor's understanding of the learner and course.
- Preserve the current chat-first interface; advanced controls stay progressive and collapsible.
- Show only truthful system information. “Grounding” describes sources and tools used, not guessed token usage.
- Persist user-visible state that is useful after reload, including completed activity, artifacts, partial answers, and explicit project memory.
- Keep streaming smooth: token rendering remains the highest-priority UI work.

## Scope

### 1. Study activity and grounding

Each completed assistant response records a compact, human-readable sequence of trusted server-side steps such as finding course material, using cached notation, or drafting an answer. The response exposes this in a collapsed “How this answer was prepared” view. A grounding summary identifies material sources, web use, diagram notation, and the selected model when known.

### 2. Conversation search

A command-style search finds matching conversation titles and message text. Selecting a result opens that conversation and scrolls directly to the matching message.

### 3. Artifact focus

Artifacts remain inline but can open in a focused dialog for uninterrupted reading, rendering, or PDF download. The dialog uses the existing renderer rather than duplicating artifact formats.

### 4. Interrupted response recovery

Assistant output is periodically persisted while streaming. If a generation ends unexpectedly, the partial response is labelled as interrupted and offers a safe retry from the originating user prompt.

### 5. Explicit project memory

Projects gain a small editable memory list for course conventions and learner preferences. Only active, explicit entries are injected into answer context; notation caching remains separate and automatic.

## Architecture

The server remains the source of truth. `streamAnswer` emits semantic events; the chat route stores a sanitized summary and response metadata after persistence. The client receives the same events live and renders progressive UI without retaining model chain-of-thought.

SQLite gets narrowly scoped tables/columns with additive migrations. API routes follow the existing App Router route-handler pattern. New UI is composed from small client components and existing dialog, markdown, message, and artifact renderers.

## Data Model

- `message_activities`: ordered trusted steps per assistant message: `phase`, `label`, `ordinal`, timestamps.
- `message_metadata`: one JSON payload per assistant message containing source IDs/counts, web/notation flags, model identifier, and whether document rendering was requested.
- `messages.delivery_state`: `complete` or `interrupted`; partial content is stored under the existing message ID.
- `project_memory`: active user-editable entries with `project_id`, `kind`, `content`, provenance, and timestamps.

## UX Boundaries

- No exposed chain-of-thought, token counter, artificial progress, or inaccurate context percentage.
- Search opens on explicit user action and never indexes API keys or attachment bytes.
- Focus mode does not replace inline artifacts.
- A retry never silently sends a new prompt; it visibly regenerates from the original user message.
- Memory is editable and removable by the user, project-scoped, and capped before prompt insertion.

## Verification

Each delivery includes focused node tests, TypeScript validation, `git diff --check`, and a production build. Responsive behavior is checked at desktop and narrow widths for search, focus dialogs, and any added panels.
