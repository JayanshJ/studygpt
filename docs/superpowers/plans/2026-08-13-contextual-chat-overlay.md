# Contextual Chat Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rich, temporary mini-chat that opens from selected assistant text without adding messages, sources, tokens, or other state to the main conversation.

**Architecture:** Move shared model/retrieval/streaming work into a server-only answer engine that cannot perform database writes. Keep persistence in `POST /api/chat`; add `POST /api/chat/overlay` as a zero-write adapter that authoritatively reloads the conversation through the selected assistant message. On the client, keep overlay state outside the main `messages` array and compose an Ask selection controller, overlay component, and ephemeral SSE hook around the existing Markdown renderer.

**Tech Stack:** Next.js 16.3 App Router route handlers, React 19, TypeScript, AI SDK 7, SQLite/better-sqlite3, Tailwind CSS 4, Radix Dialog, Node built-in test runner with `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-13-contextual-chat-overlay-design.md`

## Global Constraints

- Use `app/api/chat` only as the persistent adapter; `app/api/chat/overlay` makes zero database writes.
- The shared answer engine is server-only and must not import message/source/token/title mutation helpers.
- Overlay context ends at the selected assistant message, always retains the source answer and source user turn, and is bounded deterministically.
- Overlay state must not live in the main `messages` array.
- Preserve current normal chat behavior: send, edit, regenerate, documents, retrieval, notation/vision, web tools, dynamic statuses, sources, and cancellation.
- Overlay rich rendering is supported, but persistent actions (flashcard save/link and document/PDF export) are disabled.
- Use the existing Node test runner; do not add a frontend test framework unless a test cannot be expressed as a pure unit/integration test.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `lib/chat/sse.ts` | shared stream event union, encoding, and resilient client SSE parser |
| `lib/chat/sse.test.ts` | parser fragmentation, terminal and abort behavior |
| `lib/chat/overlay-context.ts` | normalize selection, construct bounded authoritative overlay context |
| `lib/chat/overlay-context.test.ts` | source slicing and context-budget tests |
| `lib/chat/answer-engine.ts` | server-only answer pipeline with typed events and no persistence imports |
| `lib/chat/answer-engine.test.ts` | engine isolation and event-order tests |
| `lib/chat/use-ephemeral-chat.test.ts` | temporary state, retry, and no-persistence tests |
| `lib/chat/overlay-lifecycle.test.ts` | main-chat mutation closure rules |
| `app/api/chat/route.ts` | persistent chat adapter after engine extraction |
| `app/api/chat/overlay/route.ts` | validated, zero-write overlay adapter |
| `lib/db/index.ts` | authoritative conversation-prefix lookup with deterministic order |
| `components/chat/SelectionAskController.tsx` | valid assistant selection capture and Ask anchor positioning |
| `components/chat/selection.ts` | pure selection validation/positioning utilities |
| `components/chat/selection.test.ts` | selection exclusion and viewport-placement tests |
| `components/chat/ChatOverlay.tsx` | desktop modeless overlay and mobile bottom sheet |
| `components/chat/OverlayMessage.tsx` | ephemeral wrapper for existing rich message rendering |
| `lib/chat/use-ephemeral-chat.ts` | temporary turns, SSE lifecycle, retry/abort/run IDs |
| `components/ChatMessage.tsx` | selectable answer markers and `ephemeral` rendering support |
| `components/FlashcardDeck.tsx` | disable persistence controls in ephemeral rendering |
| `components/Markdown.tsx` | thread ephemeral rendering context to embedded renderers |
| `app/(app)/page.tsx` | overlay snapshot ownership and main-chat mutation coordination |

## Task 1: Define a shared SSE contract and robust parser

**Files:**
- Create: `lib/chat/sse.ts`
- Create: `lib/chat/sse.test.ts`
- Modify: `app/(app)/page.tsx`

**Interfaces:**
- Produces `ChatStreamEvent`, `encodeSseEvent(event)`, and `consumeSse(response, handlers, signal)`.
- `consumeSse` accepts a fetch `Response`, invokes typed handlers, and resolves only after a `done` event.

- [ ] **Step 1: Write the failing parser tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { consumeSse } from "./sse";

test("consumeSse joins fragmented event lines and requires done", async () => {
  const events: string[] = [];
  const response = new Response(streamFrom(["data: {\\\"type\\\":\\\"text\\\",", "\\\"delta\\\":\\\"hi\\\"}\\n\\n", "data: {\\\"type\\\":\\\"done\\\"}\\n\\n"]));
  await consumeSse(response, { onEvent: (event) => events.push(event.type) });
  assert.deepEqual(events, ["text", "done"]);
});

test("consumeSse rejects a terminal error and EOF without done", async () => {
  await assert.rejects(() => consumeSse(new Response(streamFrom(["data: {\\\"type\\\":\\\"error\\\",\\\"message\\\":\\\"nope\\\"}\\n\\n"])), {}), /nope/);
  await assert.rejects(() => consumeSse(new Response(streamFrom(["data: {\\\"type\\\":\\\"text\\\",\\\"delta\\\":\\\"partial\\\"}\\n\\n"])), {}), /ended before done/);
});
```

- [ ] **Step 2: Run the parser tests to verify failure**

Run: `node --import tsx --test lib/chat/sse.test.ts`  
Expected: FAIL because `./sse` does not exist.

- [ ] **Step 3: Implement the typed protocol and parser**

```ts
export type ChatStreamEvent =
  | { type: "status"; phase: string; label?: string }
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "sources"; sources: SourceEntry[] }
  | { type: "error"; message: string }
  | { type: "done" };

export async function consumeSse(response: Response, handlers: { onEvent?: (event: ChatStreamEvent) => void }, signal?: AbortSignal): Promise<void> {
  // Read TextDecoder chunks, split on complete lines, parse only `data: ` JSON.
  // Throw on `error`; throw if EOF occurs before `done`; stop on abort.
}
```

Implement `encodeSseEvent` as `data: ${JSON.stringify(event)}\n\n` so both route adapters write exactly one format.

- [ ] **Step 4: Replace the duplicated parser in normal chat**

In `app/(app)/page.tsx`, replace the hand-rolled response reader with `consumeSse`. Preserve existing optimistic main-message updates, but route `sources` through the parser for future parity. Track the active run with a monotonically increasing `mainRunIdRef`; ignore events from an obsolete run.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
node --import tsx --test lib/chat/sse.test.ts
npx tsc --noEmit
```

Expected: parser tests PASS; TypeScript reports no errors.

- [ ] **Step 6: Commit the shared stream contract**

```bash
git add lib/chat/sse.ts lib/chat/sse.test.ts 'app/(app)/page.tsx'
git commit -m "refactor: share chat SSE protocol"
```

## Task 2: Add authoritative overlay context lookup and bounded context construction

**Files:**
- Modify: `lib/db/index.ts`
- Create: `lib/chat/overlay-context.ts`
- Create: `lib/chat/overlay-context.test.ts`

**Interfaces:**
- Produces `listConversationMessagesThrough(conversationId, sourceMessageId): Message[] | null`.
- Produces `normalizeSelectedText(text): string | null` and `buildOverlayHistory(prefix, overlayTurns, budget): ModelMessage[]`.

- [ ] **Step 1: Write failing context tests**

```ts
test("buildOverlayHistory retains source user turn, source answer, and newest context within budget", () => {
  const history = buildOverlayHistory(prefixWithOlderTurns, [{ role: "user", content: "Why?" }], 1200);
  assert.equal(history.some((turn) => turn.content === sourceUser.content), true);
  assert.equal(history.some((turn) => turn.content === sourceAnswer.content), true);
  assert.equal(history.at(-1)?.content, "Why?");
  assert.equal(history.some((turn) => turn.content === oldestDiscardableTurn.content), false);
});

test("normalizeSelectedText rejects blank and truncates safely", () => {
  assert.equal(normalizeSelectedText("  "), null);
  assert.equal(normalizeSelectedText(" a "), "a");
  assert.equal(normalizeSelectedText("x".repeat(5000))?.length, 4000);
});
```

- [ ] **Step 2: Run the context tests to verify failure**

Run: `node --import tsx --test lib/chat/overlay-context.test.ts`  
Expected: FAIL because the context module does not exist.

- [ ] **Step 3: Add deterministic database lookup**

Add a read-only helper in `lib/db/index.ts` that verifies the source row belongs to the requested conversation and has `role = 'assistant'`, then returns messages through the exact source row. Use deterministic query order:

```sql
ORDER BY created_at ASC, rowid ASC
```

Return `null` when the conversation/source relationship is invalid. Do not add any write behavior.

- [ ] **Step 4: Implement bounded overlay history**

Use a fixed character budget derived from the active model's context policy. Keep, in this order of priority:

1. source user turn and its retained attachments;
2. source assistant answer in full;
3. latest overlay user turn;
4. earlier overlay turns newest-first;
5. earlier main-history pairs newest-first.

When a lower-priority turn cannot fit, omit that complete turn rather than slicing its text. Build selected focus data as a separate user-context message:

```ts
const focusMessage = {
  role: "user" as const,
  content: `Selected passage from the answer being discussed:\n<selected_text>\n${selectedText}\n</selected_text>`,
};
```

The system prompt must never contain raw `selectedText`.

- [ ] **Step 5: Run focused tests**

Run: `node --import tsx --test lib/chat/overlay-context.test.ts`  
Expected: PASS.

- [ ] **Step 6: Commit authoritative overlay context**

```bash
git add lib/db/index.ts lib/chat/overlay-context.ts lib/chat/overlay-context.test.ts
git commit -m "feat: add bounded overlay context"
```

## Task 3: Extract the server-only shared answer engine

**Files:**
- Create: `lib/chat/answer-engine.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `lib/chat/notation.ts` only if callback types need to use the shared event emitter

**Interfaces:**
- Produces `streamAnswer(input, emit): Promise<AnswerCompletion>`.
- `AnswerInput` contains validated conversation config, authoritative messages, optional document/web flags, and `onSources` behavior but contains no persistence callbacks.
- Produces `AnswerCompletion` containing final text and token usage for the persistent adapter only.

- [ ] **Step 1: Add a failing isolation test**

```ts
test("answer engine does not import persistence writers", async () => {
  const source = await readFile(new URL("./answer-engine.ts", import.meta.url), "utf8");
  assert.equal(/\b(addMessage|upsertMessage|setMessageSources|updateConversationTitle|deleteMessage)\b/.test(source), false);
});
```

Add a focused behavior test using a fake `LanguageModel`/stream factory to assert `sources` emit before text and `done` emits after the model stream.

- [ ] **Step 2: Run the engine test to verify failure**

Run: `node --import tsx --test lib/chat/answer-engine.test.ts`  
Expected: FAIL because the engine does not exist.

- [ ] **Step 3: Move generation-only work into `streamAnswer`**

Move from `app/api/chat/route.ts` into the engine:

- model/provider validation and image capability selection;
- mastery prompt, base prompt, web note and tool setup;
- retrieval and `SourceEntry[]` production;
- diagram classification, notation-cache/vision resolution and statuses;
- system-message assembly;
- `streamText` options, reasoning/text/tool statuses, cancellation, and final token calculation.

Use:

```ts
type AnswerEmitter = (event: Exclude<ChatStreamEvent, { type: "done" }>) => void;

export async function streamAnswer(input: AnswerInput, emit: AnswerEmitter): Promise<AnswerCompletion> {
  // emits status -> sources -> reasoning/text/error; throws on fatal failure
  // returns trimmed final text and output token count; never writes to SQLite
}
```

The engine should receive a `modelFactory` dependency only in tests. Production callers use the existing provider setup internally.

- [ ] **Step 4: Reduce `/api/chat` to a persistence adapter**

Keep action validation, ownership checks, normal send/edit/regenerate persistence, and normal `on completion` writes in the route. After mutations, reload canonical DB messages rather than using client-provided `messages` as model history. Feed canonical messages to `streamAnswer`; write returned sources and completion only in the adapter.

- [ ] **Step 5: Run normal-chat regression tests**

Run:

```bash
node --import tsx --test lib/chat/answer-engine.test.ts
node --import tsx --test lib/retrieval/index.test.ts
npx tsc --noEmit
```

Expected: all PASS. Manually send, edit, regenerate, and stop one normal reply in the browser; sources still appear after completion.

- [ ] **Step 6: Commit the engine extraction**

```bash
git add lib/chat/answer-engine.ts lib/chat/answer-engine.test.ts lib/chat/notation.ts app/api/chat/route.ts
git commit -m "refactor: extract shared answer engine"
```

## Task 4: Add the zero-write overlay route

**Files:**
- Create: `app/api/chat/overlay/route.ts`
- Create: `app/api/chat/overlay/route.test.ts`
- Modify: `lib/chat/answer-engine.ts` only for an adapter-neutral retrieval-query input

**Interfaces:**
- Accepts `OverlayRequest` from the spec.
- Emits only `ChatStreamEvent` instances encoded by `encodeSseEvent`.
- Does not import or invoke any database write helper.

- [ ] **Step 1: Write failing route tests with fakes**

```ts
test("overlay rejects a source message from another conversation", async () => {
  const response = await postOverlay({ conversationId: "a", sourceMessageId: "assistant-in-b", selectedText: "term", messages: [] });
  assert.equal(response.status, 404);
});

test("overlay streams source snapshots and does not perform writes", async () => {
  const response = await postOverlay(validOverlayRequest);
  const events = await collectEvents(response);
  assert.equal(events.some((event) => event.type === "sources"), true);
  assert.deepEqual(writeSpy.calls, []);
});
```

- [ ] **Step 2: Run route tests to verify failure**

Run: `node --import tsx --test app/api/chat/overlay/route.test.ts`  
Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement request validation and canonical context loading**

Validate JSON shape, require non-empty normalized selection, reject invalid turn roles, and limit temporary overlay turns to a bounded count and character size. Use `listConversationMessagesThrough`. Resolve current conversation/model configuration from the database. Build overlay history with `buildOverlayHistory` and query retrieval with `${latestOverlayQuestion}\n${selectedText}`.

- [ ] **Step 4: Stream engine events without writes**

Wrap `streamAnswer` in a `ReadableStream`, mapping all typed events through `encodeSseEvent` and explicitly emitting `{ type: "done" }` only after successful completion. Pass `req.signal` into the engine. Do not call `addMessage`, `upsertMessage`, `setMessageSources`, token setters, title setters, or any mutation helper.

- [ ] **Step 5: Run focused route tests and source scan**

Run:

```bash
node --import tsx --test app/api/chat/overlay/route.test.ts
rg -n "addMessage|upsertMessage|setMessageSources|setMessageTokens|updateConversationTitle|deleteMessage" app/api/chat/overlay/route.ts lib/chat/answer-engine.ts
```

Expected: route tests PASS; second command returns no matches in the two files.

- [ ] **Step 6: Commit the ephemeral route**

```bash
git add app/api/chat/overlay/route.ts app/api/chat/overlay/route.test.ts lib/chat/answer-engine.ts
git commit -m "feat: add ephemeral chat overlay route"
```

## Task 5: Build pure selection utilities and the Ask controller

**Files:**
- Create: `components/chat/selection.ts`
- Create: `components/chat/selection.test.ts`
- Create: `components/chat/SelectionAskController.tsx`
- Modify: `components/ChatMessage.tsx`

**Interfaces:**
- Produces `getValidAssistantSelection(selection): SelectionSnapshot | null`.
- Produces `placeSelectionAction(rect, viewport): { left: number; top: number; placement: "above" | "below" }`.
- `SelectionAskController` accepts `onAsk(snapshot)` and a scroll-container ref.

- [ ] **Step 1: Write failing selection utility tests**

```ts
test("accepts a range wholly inside one selectable assistant answer", () => {
  assert.equal(isSelectionAllowed(rangeInside("data-selectable-answer")), true);
});

test("rejects controls, reasoning, sources and cross-message ranges", () => {
  assert.equal(isSelectionAllowed(rangeInside("data-selection-excluded")), false);
  assert.equal(isSelectionAllowed(rangeAcrossTwoAssistantMessages()), false);
});

test("flips below and clamps action position near viewport edges", () => {
  assert.deepEqual(placeSelectionAction({ left: 2, top: 1, width: 50, height: 16 }, { width: 320, height: 200 }), { left: 8, top: 25, placement: "below" });
});
```

- [ ] **Step 2: Run selection tests to verify failure**

Run: `node --import tsx --test components/chat/selection.test.ts`  
Expected: FAIL because selection utilities do not exist.

- [ ] **Step 3: Implement selection eligibility and anchoring**

Use `Range.commonAncestorContainer` and `Element.closest` to require one `data-selectable-answer` owner and reject `data-selection-excluded`. Reject selections while the source message is streaming. Use `range.getBoundingClientRect()`, `window.visualViewport`, an 8px edge margin, and a 6px gap. Update positions on the main scroll element, window resize, and `visualViewport.resize/scroll`.

- [ ] **Step 4: Mark assistant content precisely**

In `components/ChatMessage.tsx`, wrap only non-streaming assistant `Markdown` content in `data-selectable-answer={id}`. Wrap status/reasoning, toolbar, SourcesPanel, document controls, and attachment controls in `data-selection-excluded`. Add an optional `ephemeral?: boolean` prop for the next task, but do not alter normal behavior.

- [ ] **Step 5: Implement the floating Ask controller**

Render a fixed `Button` through a portal with `aria-label="Ask about selected text"`. Do not clear selection before snapshot creation. On Ask, call `onAsk(snapshot)`, hide the button, and preserve the snapshot's source message ID/text/rect. Hide on pointer down outside, selection collapse, conversation change, or Escape.

- [ ] **Step 6: Run focused tests and typecheck**

Run:

```bash
node --import tsx --test components/chat/selection.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: Commit selection entry point**

```bash
git add components/chat/selection.ts components/chat/selection.test.ts components/chat/SelectionAskController.tsx components/ChatMessage.tsx
git commit -m "feat: add ask action for assistant selections"
```

## Task 6: Implement in-memory overlay streaming and rich overlay UI

**Files:**
- Create: `lib/chat/use-ephemeral-chat.ts`
- Create: `components/chat/OverlayMessage.tsx`
- Create: `components/chat/ChatOverlay.tsx`
- Modify: `components/Markdown.tsx`
- Modify: `components/FlashcardDeck.tsx`
- Modify: `components/ChatMessage.tsx`

**Interfaces:**
- `useEphemeralChat(snapshot)` returns `{ turns, send, retry, stop, status, error, streaming, sources, close }`.
- `ChatOverlay` accepts a `SelectionSnapshot`, `conversationId`, `web`, `onClose`, and the main scroll ref.

- [ ] **Step 1: Write failing ephemeral state tests**

```ts
test("overlay keeps temporary turns and sources only in local state", async () => {
  const chat = createEphemeralChat(fakeFetch);
  await chat.send("Explain this");
  assert.equal(chat.state.turns.length, 2);
  assert.equal(chat.state.sources.length, 1);
  assert.equal(persistentMessageSpy.calls.length, 0);
});

test("retry replaces only the failed temporary assistant turn", async () => {
  const chat = createEphemeralChat(fakeFetchThatFailsOnce);
  await chat.send("Why?");
  await chat.retry();
  assert.equal(chat.state.turns.filter((turn) => turn.role === "assistant").length, 1);
});
```

- [ ] **Step 2: Run the state tests to verify failure**

Run: `node --import tsx --test lib/chat/use-ephemeral-chat.test.ts`  
Expected: FAIL because the hook/state factory does not exist.

- [ ] **Step 3: Implement a testable ephemeral state factory and React hook**

Keep `createEphemeralChat(fetchImpl)` framework-free for tests, then adapt it in `useEphemeralChat`. On send, append a local user turn and empty assistant turn, post `OverlayRequest`, consume typed SSE events, store `sources` from the event, and update only local state. Use an overlay-only `AbortController` and run ID. Close/stop aborts and clears local state; retry removes the failed temporary assistant turn and resends its paired user turn.

- [ ] **Step 4: Implement rich ephemeral message rendering**

`OverlayMessage` reuses `Markdown` and `SourcesPanel`. Thread `ephemeral` through `Markdown` into code/artifact/flashcard child renderers. In `FlashcardDeck`, conditionally hide/disable all save/link controls with an explanatory tooltip. In `ChatMessage`, suppress document/PDF actions when `ephemeral` is true.

- [ ] **Step 5: Implement `ChatOverlay`**

Desktop behavior:

- fixed `role="dialog"`, `aria-labelledby`, no backdrop, max width 480px and max height `70dvh`;
- quoted source passage, closable details element, scrollable temporary turns, `Textarea` composer;
- anchor to `placeSelectionAction`/selection rect; dock to viewport edge when source leaves view;
- source/status live region, stop/retry controls, focus composer on open, restore focus to Ask button on close.

Mobile behavior:

- detect `matchMedia("(max-width: 639px)")`;
- use `Dialog`, `DialogContent side="bottom"`, `DialogTitle`, and safe-area / `100dvh` styling;
- close through the same abort-and-clear callback.

- [ ] **Step 6: Run focused tests and browser smoke check**

Run:

```bash
node --import tsx --test lib/chat/use-ephemeral-chat.test.ts
npx tsc --noEmit
npm run dev
```

In the local app, select assistant prose, click Ask, send two follow-ups, view sources, stop one response, retry it, press Escape, and confirm no new main-chat message appears after closing.

- [ ] **Step 7: Commit ephemeral UI**

```bash
git add lib/chat/use-ephemeral-chat.ts lib/chat/use-ephemeral-chat.test.ts components/chat/OverlayMessage.tsx components/chat/ChatOverlay.tsx components/Markdown.tsx components/FlashcardDeck.tsx components/ChatMessage.tsx
git commit -m "feat: add temporary contextual chat overlay"
```

## Task 7: Integrate overlay lifecycle with the main chat page

**Files:**
- Modify: `app/(app)/page.tsx`
- Modify: `components/ChatInput.tsx` only if an explicit `onMainSend` lifecycle callback is needed

**Interfaces:**
- Main page owns `overlaySnapshot: SelectionSnapshot | null`.
- Exposes one `closeOverlay()` that aborts and clears the overlay.

- [ ] **Step 1: Add an integration-focused regression test**

Extract a pure `shouldCloseOverlayForMainAction(action)` helper and test:

```ts
test("every main transcript mutation closes the overlay", () => {
  for (const action of ["send", "edit", "regenerate", "new", "switch", "delete", "mode", "model"] as const) {
    assert.equal(shouldCloseOverlayForMainAction(action), true);
  }
});
```

- [ ] **Step 2: Run the lifecycle test to verify failure**

Run: `node --import tsx --test lib/chat/overlay-lifecycle.test.ts`  
Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Mount and coordinate the overlay**

Mount `SelectionAskController` inside the main chat content only when a conversation is loaded. Render `ChatOverlay` outside the scroll container so it stays fixed. Call `closeOverlay()` before normal send, edit, regenerate, conversation select/new/delete, model change, mode change, and component unmount. Do not modify `messages` to represent overlay turns.

- [ ] **Step 4: Preserve main-chat cancellation isolation**

Keep `abortRef` for main chat and the hook's controller for the overlay separate. Confirm the main Stop action stops only main streaming; overlay Stop stops only overlay streaming. When a main mutation occurs, close overlay before changing main state.

- [ ] **Step 5: Run regression tests and manual interaction checklist**

Run:

```bash
node --import tsx --test lib/chat/overlay-lifecycle.test.ts
node --import tsx --test lib/chat/sse.test.ts lib/chat/overlay-context.test.ts lib/chat/answer-engine.test.ts lib/chat/use-ephemeral-chat.test.ts components/chat/selection.test.ts
node --import tsx --test lib/retrieval/index.test.ts
npx tsc --noEmit
```

Manually verify source selection from an older answer, then send a new normal chat message: the overlay closes and the next overlay opened on another answer never sees the later conversation turns beyond its own source cutoff.

- [ ] **Step 6: Commit main-page integration**

```bash
git add 'app/(app)/page.tsx' components/ChatInput.tsx lib/chat/overlay-lifecycle.test.ts
git commit -m "feat: integrate contextual overlay with chat lifecycle"
```

## Task 8: Final security, regression, and release verification

**Files:**
- Modify only files required by defects found in this task.
- Modify: `docs/superpowers/specs/2026-08-13-contextual-chat-overlay-design.md` only if implementation reveals a necessary design correction.

- [ ] **Step 1: Run the complete configured suite**

Run:

```bash
npm run test:fsrs
npm run test:mastery
npm run test:retrieval
npm run test:learning-path
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all commands PASS. If unrelated existing failures occur, record them separately and do not broaden the fix.

- [ ] **Step 2: Verify zero-persistence behavior against a running database**

Before opening an overlay, record counts for the active conversation's `messages`, `message_sources`, and token fields. Open an overlay, send multiple turns, stop/retry, then close. Re-query the same rows. Counts and values must be identical.

- [ ] **Step 3: Verify security and accessibility behavior**

Check that no selection action appears inside `data-selection-excluded` regions or artifact iframes; check Escape, focus restoration, live status text, and mobile bottom-sheet close behavior. Review `components/Artifact.tsx` sandbox/CSP behavior and ensure the overlay does not weaken it.

- [ ] **Step 4: Record verification results**

In the implementation handoff, report each verification command, whether it passed, and any unrelated pre-existing failure without changing unrelated code. No final commit is required unless this task found and fixed a concrete defect; that defect belongs in its own follow-up task with explicit file paths and tests.
