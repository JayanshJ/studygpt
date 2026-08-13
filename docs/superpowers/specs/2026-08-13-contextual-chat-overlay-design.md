# Contextual Chat Overlay Design

**Date:** 2026-08-13  
**Status:** approved for implementation  
**Scope:** temporary, contextual mini-chat opened from selected text in an assistant response.

## Goal

Let a learner select part of an assistant answer and ask a follow-up without adding another turn to the main transcript or losing sight of the original answer. The mini-chat must have the same answer quality and project capabilities as normal chat: context, retrieval, course notation memory, vision, web tools, dynamic status updates, and rich Markdown rendering.

The feature is general infrastructure. It must work for every project and conversation type, not only diagrams, ERMs, or material-backed study questions.

## Product Decisions

- Selection works only in completed assistant answer content. User messages, reasoning, status lines, sources, toolbars, form controls, flashcard controls, and sandboxed artifact iframes are excluded.
- A non-empty valid selection shows a single **Ask** button near the selection.
- **Ask** opens a modeless floating popover on desktop. The same UI uses a bottom sheet on narrow/mobile viewports.
- The overlay supports a multi-turn temporary conversation. Its state is browser-memory only and is discarded when closed.
- Main-chat context is frozen at the selected assistant response. Later main-chat messages never enter the overlay's context.
- One overlay may be active at a time. Opening a normal-chat generation or changing main-chat context closes and aborts it.
- The main transcript, conversation search, token totals, message sources, and database remain unchanged by overlay use.

## User Interaction

### Selection and entry point

`SelectionAskController` is mounted around the main message list. It observes selection changes from pointer and keyboard selection, then validates that the complete range belongs to one marked assistant-answer content region.

A valid selection is normalized for storage (trim outer whitespace and collapse no internal whitespace), capped at 4,000 characters, and stored together with:

- `conversationId`
- `sourceMessageId`
- the original selected text
- the selected range's client rectangle
- a monotonic selection identifier

The Ask button is a small fixed-position control above the range, flipped below it when there is not enough room. It is clamped to the visual viewport. Clicking it saves the selection snapshot and opens the overlay. The native selection may collapse when the user clicks; the overlay therefore displays the source as a quoted, collapsible passage rather than trying to mutate React-owned answer DOM to retain a highlight.

Selections are ignored when they are empty, cross message boundaries, occur during a streaming assistant response, originate from a `data-selection-excluded` subtree, or exceed the cap. A selection that includes only a non-breaking space or punctuation still remains valid; the minimum semantic-selection policy is non-empty trimmed text.

### Overlay layout

On desktop, `ChatOverlay` is a fixed, modeless, labelled dialog anchored to the saved selection rectangle. It has no backdrop, so the original answer stays visible and scrollable. It contains:

1. A header with “Ask about this”, the close button, and a compact quoted source passage.
2. A scrollable temporary message list.
3. The same status/reasoning presentation as a normal assistant answer.
4. A focused follow-up composer with send, stop, retry, and keyboard submit behavior.

It is at most 480px wide and 70dvh tall. It follows the source range on scroll/resize. If the range leaves the viewport, it docks to the nearest viewport edge while preserving the overlay's size and message state.

On mobile, the component uses the existing Radix dialog primitives as a bottom sheet: real dialog semantics, focus trap, safe-area padding, and a `100dvh` max-height. Desktop does not use Radix Dialog because its standard overlay/backdrop would make the contextual popover modal.

`Escape` and the close button abort an active overlay request, discard the temporary thread, and restore focus to the Ask button or selected answer region. Clicking outside does not close a non-empty overlay. The overlay uses an `aria-live="polite"` status area for streaming progress.

### Rendering and controls

Overlay assistant answers reuse `Markdown`, `MermaidDiagram`, `Artifact`, code blocks, math, and `SourcesPanel`. This guarantees visual parity with the main chat. The rendering context receives an explicit `ephemeral` flag:

- source display is supported from streamed source data;
- flashcard content may render but its save-to-deck/link actions are disabled;
- document export actions are not offered for temporary answers;
- artifacts retain the existing sandbox behavior and never become selectable entry points for a nested overlay.

The answer renderer marks only the completed response body with `data-selectable-answer`; it marks controls, citations, reasoning, status, and interactive embedded content with `data-selection-excluded`.

## Context Construction

The browser never sends a mutable copy of the full main transcript. `POST /api/chat/overlay` accepts:

```ts
type OverlayRequest = {
  conversationId: string;
  sourceMessageId: string;
  selectedText: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  web?: boolean;
};
```

The route validates that `sourceMessageId` is an assistant message belonging to `conversationId`, loads that conversation's messages in deterministic order, and slices through that exact source message. It uses a deterministic ordering tie-breaker (`created_at`, then database row identity) so a same-millisecond insert cannot cut context at the wrong message.

The engine receives a bounded context package:

1. The source assistant answer in full.
2. The user turn that directly prompted the source answer, including retained applicable attachments.
3. Earlier main-chat turns, newest first, until the configured input budget is reached.
4. The selected passage as explicit untrusted focus data.
5. Temporary overlay turns, with the latest user question always retained.

The selected passage is serialized as a dedicated user-context section, never interpolated into a system instruction. The overlay system prompt tells the model to answer the current overlay question in relation to that passage and answer, not to continue or alter the main conversation.

The retrieval query combines the latest overlay user question with the selected passage. This makes short questions such as “why?” or “what does this mean?” material-aware. The route preserves the conversation's project, model, mode, web toggle, masteries, and notation/vision behavior.

## Server Architecture

Extract the non-persistent answer pipeline from `app/api/chat/route.ts` into a server-only shared module, tentatively `lib/chat/answer-engine.ts`.

The engine owns:

- provider/model setup and validation;
- prompt assembly and token/reasoning budget selection;
- attachment conversion and bounded history preparation;
- materials retrieval and source snapshots;
- diagram notation cache resolution and vision use;
- optional web-tool setup;
- `streamText` lifecycle and normalized typed stream events;
- cancellation propagation to retrieval, notation extraction, tools, and model streaming.

The engine must not import database mutation helpers such as `addMessage`, `upsertMessage`, `deleteMessage`, `setMessageSources`, token setters, or conversation-title writers. It returns events and a final completion result only. This structural boundary makes persistence leakage impossible by design rather than dependent on an `if (ephemeral)` condition.

Two adapters use the engine:

| Adapter | Input authority | Database writes | Sources |
| --- | --- | --- | --- |
| `POST /api/chat` | validates mutations, reloads authoritative DB history | normal user/reply/title/token/source writes | persisted, then normal fetch path |
| `POST /api/chat/overlay` | reloads conversation prefix through validated source message | none | emitted directly in SSE |

The persistent route retains send/edit/regenerate semantics, but validates message ownership before mutation and reloads authoritative history after the mutation. It must not continue to trust client-provided history or globally-scoped message IDs.

## Stream Contract

Both adapters expose one typed SSE protocol:

```ts
type ChatStreamEvent =
  | { type: "status"; phase: string; label?: string }
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "sources"; sources: SourceEntry[] }
  | { type: "error"; message: string }
  | { type: "done" };
```

The engine sends a source snapshot immediately after retrieval, before model text starts. Existing granular status labels remain data-driven and work for both surfaces: searching materials, found passages, recalling notation, studying slides, searching the web, thinking, and writing.

Create a shared client SSE parser and use it in both `runChat` and `useEphemeralChat`. The parser treats `error` as terminal, requires `done` for a successful completion, reports truncated/no-`done` streams as an error, and safely handles fragmented SSE lines.

Main and overlay streams use separate `AbortController`s and monotonic run IDs. Every event is ignored if its run ID is no longer current. Closing, retrying, changing conversation, sending/editing/regenerating a main message, changing mode/model, deleting/newing/switching a conversation, or unmounting the chat page aborts the overlay and clears its state.

## Client State and Components

New focused pieces:

| Unit | Responsibility |
| --- | --- |
| `components/chat/SelectionAskController.tsx` | capture/validate selection, position Ask, retain selection snapshot |
| `components/chat/ChatOverlay.tsx` | desktop popover/mobile sheet, temporary thread, focus/close behavior |
| `components/chat/OverlayMessage.tsx` | thin ephemeral wrapper around existing rich answer rendering |
| `lib/chat/use-ephemeral-chat.ts` | overlay SSE lifecycle, retries, aborts, run IDs, in-memory sources |
| `lib/chat/sse.ts` | shared event types and robust SSE parsing |
| `lib/chat/answer-engine.ts` | server-only generation pipeline with no persistence imports |
| `app/api/chat/overlay/route.ts` | authoritative context adapter with zero writes |

`app/(app)/page.tsx` owns only the overlay open/close snapshot and coordinates closing on main-chat mutations. The overlay's turns stay separate from `messages`, so main-chat auto-scroll, optimistic persistence, and transcript rendering cannot observe them.

## Failure Handling

- Missing/deleted/edited source message: return a clear error that the original answer is no longer available; keep no stale overlay thread.
- Model/network failure: preserve question and completed temporary turns; show Retry.
- Explicit close: abort and discard immediately; do not persist partial content.
- Retrieval/vision/tool failure: preserve the regular text-only fallback behavior and report only actionable model errors.
- Excessive context: deterministic trimming keeps selected answer, source prompt, latest overlay question, then newest remaining history until budget. Do not silently drop the selected text.
- Artifact isolation: retain the artifact iframe sandbox and use an explicit content-security policy/allowlist review during implementation before permitting networked artifact content.

## Test Plan

### Unit

- selection validation, range-to-viewport positioning, flipping/clamping, and excluded subtrees;
- context slicing and deterministic ordering;
- context-budget trimming, including retained source answer and latest overlay question;
- overlay prompt construction and selected-text escaping/normalization;
- SSE fragmentation, terminal error, missing `done`, abort, and late-event handling.

### Route and engine integration

- overlay uses project retrieval, notation memory/vision fallback, web tool configuration, and source SSE snapshots;
- overlay makes zero message, source, token, title, or conversation writes;
- cross-conversation source IDs and non-assistant source IDs are rejected;
- normal send/edit/regenerate/document flows preserve persistence behavior after shared-engine extraction;
- cancel reaches the active generation and returns no late UI events.

### Component/browser

- selecting prose, table cells, code, and math opens Ask;
- status/reasoning/sources/controls/artifact iframe do not open Ask;
- desktop anchor, scroll docking, mobile sheet, focus restoration, Escape, and one-overlay enforcement;
- original main-chat scroll and messages remain unchanged after overlay close;
- rich Markdown/Mermaid/artifact rendering works in the overlay and persistent actions are disabled.

## Out of Scope

- selecting inside artifact iframes;
- storing, sharing, or deep-linking temporary overlay threads;
- multiple simultaneous overlays;
- merging overlay turns into the main transcript;
- document/PDF generation from an overlay answer in the first release;
- a separate overlay model configuration.
