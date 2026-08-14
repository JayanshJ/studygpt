# Conversation Context Rail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive, collapsible conversation context rail that indexes the active chat's generated artifacts and cited course materials.

**Architecture:** Keep the database and existing message APIs unchanged. A pure client-safe aggregation module derives artifact and source entries from the already loaded messages. A dedicated panel renders those entries on desktop as a fixed right rail and on smaller screens in the existing sheet/dialog primitive. The chat page owns visibility and scroll-to-message behavior.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Motion, Lucide React, Node test runner with `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-14-conversation-context-rail-design.md`

## Global Constraints

- Preserve the active conversation as the primary surface; context is optional and starts collapsed.
- Use loaded message data and existing source rows; add no database tables, migrations, or fetching endpoints.
- Preserve the shared centered transcript/composer axis and avoid layout animation while streaming.
- Use `18rem` only at `tab` and larger; use the existing dialog/sheet behavior below `tab`.
- Respect `prefers-reduced-motion` through `useMotion` / `useLayoutMotion` helpers.
- Do not commit, stage, or alter unrelated working-tree changes.

---

### Task 1: Create the conversation-context data model

**Files:**
- Create: `lib/chat/conversation-context.ts`
- Test: `lib/chat/conversation-context.test.ts`

**Interfaces:**
- Consumes: message-shaped values with `id`, `role`, `content`, `kind`, and optional `sources`.
- Produces: `buildConversationContext(messages): ConversationContext`.
- Produces: `ConversationArtifact` with `id`, `messageId`, `kind`, `label` and optional `documentId`.
- Produces: `ConversationSource` with `materialId`, `title`, `citationCount`, and `messageId`.

- [ ] **Step 1: Write the failing artifact aggregation tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationContext } from "./conversation-context";

test("indexes document, Mermaid, and HTML artifacts from assistant messages", () => {
  const context = buildConversationContext([
    { id: "doc", role: "assistant", kind: "document", content: "# Revision notes" },
    { id: "diagram", role: "assistant", kind: "chat", content: "```mermaid\\nerDiagram\\n```" },
    { id: "visual", role: "assistant", kind: "chat", content: "```artifact\\n<html></html>\\n```" },
  ]);

  assert.deepEqual(context.artifacts.map((item) => [item.kind, item.messageId]), [
    ["document", "doc"],
    ["diagram", "diagram"],
    ["visualization", "visual"],
  ]);
});
```

- [ ] **Step 2: Add the failing source aggregation test**

```ts
test("deduplicates sources while retaining their first citing message", () => {
  const context = buildConversationContext([
    {
      id: "answer-one",
      role: "assistant",
      kind: "chat",
      content: "First answer",
      sources: [
        { materialId: "slides", title: "Lecture slides", ordinal: 2, snippet: "A" },
        { materialId: "slides", title: "Lecture slides", ordinal: 4, snippet: "B" },
      ],
    },
    {
      id: "answer-two",
      role: "assistant",
      kind: "chat",
      content: "Second answer",
      sources: [{ materialId: "book", title: "Course book", ordinal: 8, snippet: "C" }],
    },
  ]);

  assert.deepEqual(context.sources, [
    { materialId: "slides", title: "Lecture slides", citationCount: 2, messageId: "answer-one" },
    { materialId: "book", title: "Course book", citationCount: 1, messageId: "answer-two" },
  ]);
});
```

- [ ] **Step 3: Run the new tests to verify failure**

Run: `node --import tsx --test lib/chat/conversation-context.test.ts`

Expected: FAIL because `conversation-context.ts` does not yet exist.

- [ ] **Step 4: Implement the pure aggregation module**

```ts
export type ContextMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  kind?: "chat" | "document";
  sources?: SourceEntry[];
};

export function buildConversationContext(messages: ContextMessage[]): ConversationContext {
  // Ignore non-assistant messages. Create at most one item per supported
  // artifact kind per message, and aggregate sources in appearance order.
}
```

Use fence detection that accepts an opening fence at a line boundary and does
not require a closing fence, so a streaming response can be indexed once its
first fence is emitted. Derive document labels from the first Markdown heading,
falling back to `Document`; diagram labels from `Diagram`; and HTML labels from
`Visualization`. Do not parse or render model-authored HTML in this module.

- [ ] **Step 5: Run the aggregation tests**

Run: `node --import tsx --test lib/chat/conversation-context.test.ts`

Expected: PASS.

### Task 2: Build the reusable context panel

**Files:**
- Create: `components/chat/ConversationContextPanel.tsx`
- Create: `components/chat/ConversationContextPanel.test.tsx`
- Modify: `components/ChatMessage.tsx`

**Interfaces:**
- Consumes: `ConversationContext` from `lib/chat/conversation-context.ts`.
- Consumes callbacks `onSelectArtifact(artifact)` and `onSelectSource(source)`.
- Produces: `ConversationContextPanel` with `variant: "rail" | "sheet"`.
- Produces: artifact interaction that scrolls to the answer; document item can invoke `onDownloadDocument(messageId, label)`.

- [ ] **Step 1: Write the failing panel rendering test**

```tsx
import assert from "node:assert/strict";
import test from "node:test";
import { render, screen } from "@testing-library/react";
import { ConversationContextPanel } from "./ConversationContextPanel";

test("shows artifact and source counts and forwards selection", () => {
  const selected: string[] = [];
  render(
    <ConversationContextPanel
      variant="rail"
      context={{
        artifacts: [{ id: "diagram", kind: "diagram", label: "Diagram", messageId: "m1" }],
        sources: [{ materialId: "slides", title: "Lecture slides", citationCount: 2, messageId: "m1" }],
      }}
      onSelectArtifact={(artifact) => selected.push(artifact.id)}
      onSelectSource={(source) => selected.push(source.materialId)}
    />,
  );
  assert.ok(screen.getByRole("button", { name: /diagram/i }));
  assert.ok(screen.getByRole("button", { name: /lecture slides/i }));
});
```

If Testing Library is not configured for this repository, keep the UI test as a
small DOM-free test of exported `panelSectionState` instead and retain the
manual checks in Task 5. Do not add a test framework solely for this feature.

- [ ] **Step 2: Run the panel test to verify failure**

Run: `node --import tsx --test components/chat/ConversationContextPanel.test.tsx`

Expected: FAIL because the component does not yet exist.

- [ ] **Step 3: Implement the panel**

```tsx
export function ConversationContextPanel({
  context,
  variant,
  onSelectArtifact,
  onSelectSource,
  onDownloadDocument,
}: Props) {
  // Independent Artifacts and Sources disclosure state.
  // Empty sections render muted, informative copy rather than disappearing.
}
```

Use `FileText`, `GitBranch`, `PanelTop`, `BookOpen`, `ChevronRight`, and
`Download` icons from `lucide-react`. Keep the row visual treatment neutral:
small icon, truncating title, then a soft metadata line (`PDF document`,
`Mermaid diagram`, `2 citations`). Keep details in the transcript rather than
putting source snippets in the rail.

For artifact rows:
- Call `onSelectArtifact` for every row.
- Add a nested non-propagating download button only when `kind === "document"`.

For source rows:
- Call `onSelectSource`.
- Include the exact citation count in the accessible name.

Use `AnimatePresence` only for section disclosure, with existing reduced-motion
helpers. Do not use `layout` props on a panel that can update during streaming.

- [ ] **Step 4: Add a message scroll target**

Add `id={id ? \`message-${id}\` : undefined}` to the outermost durable
container of `ChatMessage`. Do not change message content, overlay source
markers, source panels, or existing action buttons.

- [ ] **Step 5: Run focused panel and existing chat tests**

Run: `node --import tsx --test lib/chat/conversation-context.test.ts components/chat/ConversationContextPanel.test.tsx components/chat/ChatOverlay.test.ts components/chat/OverlaySourceMarkers.test.ts`

Expected: PASS. If a referenced overlay test file does not exist in the current
working tree, omit only that missing test path and record why in the task report.

### Task 3: Integrate the rail into the chat page

**Files:**
- Modify: `app/(app)/page.tsx`
- Test: `components/chat/chat-layout.test.ts` (create if absent)

**Interfaces:**
- Consumes: `buildConversationContext(messages)` and `ConversationContextPanel`.
- Produces: a desktop rail controlled by the chat-header `Context` toggle.
- Produces: mobile sheet using existing `Dialog` and `DialogContent` components.

- [ ] **Step 1: Write a failing layout contract test**

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("chat page uses a sibling context rail and retains centered chat content", () => {
  const page = readFileSync("app/(app)/page.tsx", "utf8");
  assert.match(page, /ConversationContextPanel/);
  assert.match(page, /buildConversationContext\(messages\)/);
  assert.match(page, /chat-content/);
});
```

- [ ] **Step 2: Run the layout contract test to verify failure**

Run: `node --import tsx --test components/chat/chat-layout.test.ts`

Expected: FAIL because the page does not yet import the context panel.

- [ ] **Step 3: Add state and header controls**

Add `contextOpen` state persisted under `studygpt.context-rail.open` in
`localStorage`, defaulting to `false` during SSR. Add a compact `Context`
header control at `tab` and larger with an icon, visible count badge when
artifacts/sources exist, `aria-expanded`, and `aria-controls="conversation-context-rail"`.

On smaller screens, render a matching icon button that opens the existing
`Dialog` / `DialogContent` sheet. Avoid duplicating the panel body: the same
`ConversationContextPanel` must render in both paths.

- [ ] **Step 4: Change only the post-header main layout**

Wrap the transcript/composer portion in a `flex min-h-0 min-w-0 flex-1`
container. Keep the current chat area as the first flex child:

```tsx
<section className="flex min-h-0 min-w-0 flex-1 flex-col">
  {/* current scroll region, errors, and composer */}
</section>
{contextOpen && (
  <aside id="conversation-context-rail" className="hidden w-72 shrink-0 border-l border-border/60 bg-paper/70 tab:block">
    <ConversationContextPanel variant="rail" ... />
  </aside>
)}
```

Do not move the existing header. Keep `chat-scroll` inside the chat section,
and do not add horizontal padding to the rail's parent. This preserves the
centered `chat-content` and composer relationship already fixed in the chat.

- [ ] **Step 5: Add selection and download actions**

Implement `scrollToMessage(messageId)` with:

```ts
document.getElementById(`message-${messageId}`)?.scrollIntoView({
  behavior: reducedMotion ? "auto" : "smooth",
  block: "center",
});
```

Track a short-lived highlighted message id (about 1.2 seconds) and add a
non-layout-affecting ring/background class to that mapped message wrapper.
Use a `prefers-reduced-motion` safe path.

Implement `downloadDocument(messageId, label)` by reusing the existing
`/api/messages/${messageId}/pdf` fetch-to-blob download behavior from
`ChatMessage`. Extract a small shared client helper only if duplicating the
existing function would otherwise create divergent filename/error behavior.

- [ ] **Step 6: Run page-level focused tests**

Run: `node --import tsx --test lib/chat/conversation-context.test.ts components/chat/chat-layout.test.ts components/shell/navigation-motion.test.ts components/ModeToggle.test.ts`

Expected: PASS.

### Task 4: Make the rail visually quiet and responsive

**Files:**
- Modify: `app/globals.css` only if Tailwind utilities cannot express scrollbar, focus, or sheet rules cleanly.
- Modify: `components/chat/ConversationContextPanel.tsx`
- Modify: `app/(app)/page.tsx`

**Interfaces:**
- Consumes: desktop rail wrapper from Task 3.
- Produces: no added visual weight to the centered transcript and composer.

- [ ] **Step 1: Add the desktop rail’s visual containment**

Give the rail body `min-h-0 flex-1 overflow-y-auto` with `scrollbar-gutter:
stable` through an existing global utility or a targeted class. Use a muted
left divider (`border-border/60`) and no right border. Use the same surface,
type scale, compact radii, and shadow vocabulary already in the chat shell.

- [ ] **Step 2: Add resilient responsive behavior**

At `tab` and above, the rail remains `w-72 shrink-0`. Below `tab`, hide the
rail and expose only the dialog sheet. Ensure source/artifact rows wrap or
truncate without horizontal overflow. Do not use viewport-specific offsets.

- [ ] **Step 3: Preserve performance**

Ensure no rail component uses `layout` animation. Memoize the derived
`ConversationContext` in the page with `useMemo(() => buildConversationContext(messages), [messages])`.
The static rail can re-render while a token streams, but it must not create new
iframes, issue fetches, or trigger measurements.

- [ ] **Step 4: Run typecheck and style safety check**

Run: `npx tsc --noEmit && git diff --check`

Expected: both commands succeed without errors.

### Task 5: Verify end-to-end behavior

**Files:**
- Verify: `app/(app)/page.tsx`
- Verify: `components/chat/ConversationContextPanel.tsx`
- Verify: `lib/chat/conversation-context.ts`

- [ ] **Step 1: Run complete relevant tests**

Run:

```bash
node --import tsx --test \
  lib/chat/conversation-context.test.ts \
  components/chat/chat-layout.test.ts \
  components/shell/navigation-motion.test.ts \
  components/ModeToggle.test.ts \
  lib/chat/overlay-threads.test.ts \
  lib/chat/use-overlay-chat.test.ts
```

Expected: PASS. Omit only paths that do not exist in the working tree.

- [ ] **Step 2: Build the application**

Run: `npm run build`

Expected: successful production build. Preserve the known unrelated dynamic
filesystem tracing warning in `lib/db/index.ts`; do not modify it for this
feature.

- [ ] **Step 3: Perform the manual interaction check**

With a conversation containing at least one document/PDF, Mermaid diagram,
HTML visualization, and cited material:

1. Verify the Context toggle starts closed and opens the desktop rail.
2. Verify the artifacts and sources counts match the conversation.
3. Verify clicking an artifact or source centers and highlights its source
   message without changing the composer width or axis.
4. Verify document download creates a real PDF through the existing route.
5. Verify collapse returns the original chat width without transcript shift.
6. Verify the mobile viewport uses a sheet and does not leave a narrow third
   column.
7. Stream a long response and confirm the transcript remains smooth; no
   full-transcript layout animation is introduced.

## Plan Self-Review

- **Spec coverage:** Tasks 1–2 implement derived artifacts and deduplicated
  sources; Task 3 implements desktop/mobile integration, scroll actions, and
  PDF reuse; Task 4 covers responsive behavior, motion, and scrollbar details;
  Task 5 verifies every success criterion.
- **Placeholder scan:** No deferred implementation markers or unspecified
  interfaces remain.
- **Type consistency:** `ConversationContext`, `ConversationArtifact`,
  `ConversationSource`, and `buildConversationContext` originate in Task 1 and
  are used under the same names in Tasks 2–5.
