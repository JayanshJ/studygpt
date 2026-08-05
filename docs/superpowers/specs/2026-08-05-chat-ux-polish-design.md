# Chat UX Polish — Design

**Date:** 2026-08-05
**Status:** Approved (scope: essentials + responsive + search)
**Target:** v1 StudyGPT chat surface. No new subsystem; sharpens the existing core loop and makes the layout work on mobile.

## Goal

Make the existing chat feel finished: give the user control over a turn mid- and post-stream, stop runaway generations, fix mistakes by editing a prompt, recover from errors without retyping, and use the app on a phone. All within the current **Graph Paper Lab** design system — no new colors, fonts, or visual language.

## Non-goals

- Phase 2 RAG (materials/embeddings) and Phase 3 (knowledge graph) — separate specs.
- A test framework. Verification is build + lint + manual smoke.
- Theme switching, message pinning/starring, message-content search, multi-conversation branching.

## Design system constraints (must respect)

Palette: `--paper / --paper-2 / --paper-3 / --ink / --ink-2 / --ink-3 / --rule / --feynman / --line / --grid`. Type: Newsreader (serif body) + JetBrains Mono (chrome via `.mono`). Corners: 3px (2px on tight chrome). Signature: red notebook margin rule on the sidebar edge, graph-paper grid surface. New controls reuse these tokens — no new ones.

## Background: the ID mismatch (the root issue this fixes)

Today `app/page.tsx` generates client UUIDs for each message it renders, while `POST /api/chat` persists messages with **server-generated** UUIDs (`addMessage` mints its own `crypto.randomUUID()`). The two never reconcile — invisible now because nothing references a message by ID after creation, but it breaks edit/regenerate/stop, which must point at a specific persisted message.

**Fix:** make IDs pass-through. The client provides `userMessageId` / `assistantMessageId`; the server persists under those IDs. After a send, the client bubble's ID == the DB row's ID. On reload the client fetches DB rows (same IDs), so the two always agree. `addMessage` becomes idempotent by ID (primary key) so retries don't duplicate.

## Interaction design

### Stop generation
- While streaming, the input's send button becomes a `stop` button.
- Client holds an `AbortController` per in-flight request; `stop` calls `controller.abort()`.
- The chat route passes `abortSignal: req.signal` to `streamText` so the server stops generating on disconnect (saves local compute).
- The partial assistant text already accumulated in the bubble is **kept and persisted** (see Stop-persist), so a stopped reply survives reload rather than vanishing.

### Regenerate
- A hover control on the **last** assistant message only (not on history). Disabled while streaming.
- Client removes the old assistant bubble and creates a fresh one (new `assistantMessageId`), then `POST /api/chat` with `action: "regenerate"` and `replaceAssistantId` (the old assistant ID). Server deletes the old assistant row and streams a new reply under the new ID.

### Edit & resend
- A hover control on any user message. Click turns the bubble into an inline editable textarea seeded with the message content; `Esc` cancels, `Enter` commits, `Shift+Enter` inserts a newline (mirrors the main input).
- On commit: the client updates that message's content in-place, truncates everything after it from the display, creates a fresh assistant bubble, and calls `POST /api/chat` with `action: "edit"`, `editMessageId` (the user message ID), `editContent` (new text), `assistantMessageId` (new). Server: `updateMessageContent(editMessageId, editContent)`, `deleteMessagesAfter(conversationId, editMessageId)`, then streams the reply under `assistantMessageId`.

### Copy
- Hover `copy` on assistant bubbles (`navigator.clipboard.writeText(content)`); a brief `copied` state.
- Per code-block `copy` via a `react-markdown` `pre` component override that wraps the `<pre>` with a small mono copy button top-right.

### Retry on error
- The existing error bar gains a `retry` button. It re-sends the last user turn with the **same IDs** — `addMessage` is idempotent by ID, so re-persist is a no-op; no duplication.

### Auto-resize input
- `ChatInput`'s textarea grows with content up to `max-h-48` (192px), then scrolls. Reset to one row after send.

### Active-model badge
- Header shows the active conversation's `model` as a small mono chip beside the `ModeToggle`. Hidden when no conversation is selected. (The conversation row already carries `model`; no new data.)

### Responsive sidebar
- Breakpoint `md` (768px).
- **Desktop (≥md):** static sidebar, always visible — current behavior, unchanged.
- **Mobile (<md):** sidebar hidden by default. A hamburger button in the header toggles an overlay: the sidebar slides in over the chat (`fixed`, `z` above content) with a clickable backdrop behind it. Selecting a conversation closes the overlay. State is local to `Page`.

### Conversation search
- A mono input pinned to the top of the sidebar nav; filters `conversations` by case-insensitive title substring, client-side. Empty filter = show all. (Message-content search is out of scope.)

## Data layer changes (`lib/db/index.ts`, `lib/db/schema.ts`)

Schema is unchanged (no new tables/columns — IDs are already `TEXT PRIMARY KEY`). New/changed helpers:

- `addMessage(conversationId, role, content, id?)` — uses the provided ID when given, else mints one. Insert is `INSERT OR IGNORE`-equivalent (idempotent by PK) so retries/regenerates with the same ID don't duplicate.
- `updateMessageContent(id, content)` — `UPDATE messages SET content = ? WHERE id = ?`.
- `deleteMessage(id)` — single-row delete.
- `deleteMessagesAfter(conversationId, messageId)` — deletes messages strictly after `messageId` by `created_at` (resolves the anchor's `created_at`, then deletes rows in that conversation with a greater `created_at`). Used by edit-and-resend to drop the stale tail.
- `upsertMessage(conversationId, role, content, id)` — `INSERT ... ON CONFLICT(id) DO UPDATE SET content = excluded.content`. Used by stop-persist when the assistant row may or may not exist yet.

## API changes

### `POST /api/chat` (extended body)

```
{
  conversationId: string,
  messages: { role, content }[],   // history sent to the model (no placeholder assistant)
  action?: "send" | "regenerate" | "edit",   // default "send"
  userMessageId?: string,           // send: persist the new user turn under this ID
  assistantMessageId?: string,      // send/regenerate/edit: persist the reply under this ID
  replaceAssistantId?: string,      // regenerate: the old assistant row to delete first
  editMessageId?: string,           // edit: the user message to replace
  editContent?: string              // edit: new content for that user message
}
```

Behavior by `action`:

- **send** — persist user turn under `userMessageId` (idempotent). Stream; persist reply under `assistantMessageId` in `onFinish`. Title-on-first-turn logic unchanged.
- **regenerate** — `deleteMessage(replaceAssistantId)`; no user persistence. Stream; persist reply under `assistantMessageId`.
- **edit** — `updateMessageContent(editMessageId, editContent)`; `deleteMessagesAfter(conversationId, editMessageId)`; no new user row. Stream; persist reply under `assistantMessageId`.

`streamText` gets `abortSignal: req.signal`. Preflight `validate` (Ollama reachability) stays as-is.

### `PATCH /api/messages` (new, tiny)

Body `{ conversationId, messageId, role, content }` → `upsertMessage`. Called by the client on **stop** to persist the partial assistant text. Idempotent: if `onFinish` already ran (generation completed just as the user clicked stop), the upsert overwrites the same row with the same/partial content — no duplicate, because ID matches.

No other routes change shape. Existing `GET/POST/DELETE /api/conversations`, `GET/PATCH /api/conversations/[id]`, `GET/PATCH /api/settings` are untouched.

## Client changes (`app/page.tsx`, components)

- `Page`: hold an `AbortController` ref; thread `userMessageId`/`assistantMessageId`/`action` through `sendMessage`; add `regenerate`, `editMessage`, `stop`, `retry`; manage `sidebarOpen` state + a `query` filter string passed to `Sidebar`.
- `ChatInput`: auto-resize textarea; `stop` button state while `streaming`; surface `onStop`.
- `ChatMessage`: optional hover controls (`onCopy`, `onRegenerate`, `onEdit`); edit-mode internal state.
- New `CodeBlock` component (or inline `pre` override) for copy-on-code-blocks.
- `Sidebar`: hamburger toggle (mobile), search input, title-filter.
- Header: model badge chip.

## Error handling

- Provider/network errors keep surfacing via the existing 502 path and the error bar; `retry` re-sends.
- Edit/regenerate against a missing conversation or message → 404/400 as today; client surfaces the message and aborts the optimistic change.
- Stop-persist failure is non-fatal: the partial text stays in the UI for the session even if the upsert fails; the next reload simply won't have it.

## Testing & verification

- `npm run lint` and `tsc --noEmit` clean.
- Manual smoke, desktop + a ~390px-wide viewport:
  1. Send a message; stop mid-stream; reload → partial reply persists.
  2. Regenerate the last reply; reload → new reply persists, old gone.
  3. Edit a user message mid-thread; confirm the tail is dropped and a fresh reply streams; reload → consistent.
  4. Copy an assistant message and a code block.
  5. Force an error (stop Ollama); retry → reply recovers, no duplicate user rows.
  6. Toggle sidebar open/closed on mobile; search filters the list.
- Spot-check the DB after each to confirm no duplicate/orphaned rows (the ID-pass-through invariant).

## Risks

- **onFinish on abort:** the AI SDK may or may not call `onFinish` when the client disconnects. The stop-persist upsert makes this irrelevant — the client always writes the partial it has, idempotently. If `onFinish` does fire it writes the same row; either way the ID matches.
- **deleteMessagesAfter ordering:** uses `created_at`, which is milliseconds. Two messages in the same ms would mis-order. Acceptable for a local single-user app; if it bites, switch to a monotonic sequence column later (out of scope here).
- **Edit truncation is destructive:** once committed, the dropped tail is gone from the DB too. This matches standard chat UX (ChatGPT, Claude) and is the expected behavior, not a bug.