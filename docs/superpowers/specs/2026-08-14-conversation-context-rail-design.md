# Conversation Context Rail

## Goal

Make the useful outputs of a StudyGPT conversation easy to revisit without
forcing the learner to scroll through the transcript. The conversation remains
the primary surface; the new right rail is a quiet, optional index of the
conversation's artifacts and course sources.

This adapts the useful part of OpenWorker's right rail: session-scoped,
collapsible deliverables that open from a durable side panel. It intentionally
does not copy its desktop agent, filesystem workspace, task progress, or
approval workflow, because those do not serve a study chat.

## User Experience

### Desktop

- A compact `Context` button in the chat header opens or closes a right rail.
- The rail starts collapsed, preserving the current focused chat layout.
- When open, it has two independently collapsible sections:
  - **Artifacts**: generated study documents/PDFs, Mermaid diagrams, HTML
    visualizations, and flashcard decks from the active conversation.
  - **Sources**: deduplicated course materials used by the active
    conversation, with number of cited excerpts and their originating answer.
- Selecting an artifact scrolls the transcript to the originating response and
  briefly highlights it. A document additionally exposes its existing direct
  PDF download action from the rail.
- Selecting a source scrolls to the first response that cited it. The rail does
  not duplicate full snippets that are already available in the message source
  panel; it functions as an index.
- The rail is fixed-width, has its own unobtrusive scroll area, and does not
  distort the centered main transcript. It can collapse instantly via its
  header control.

### Mobile

- The persistent desktop rail is not rendered.
- The same `Context` button opens a bottom/right sheet with the identical
  artifact and source sections. Closing the sheet returns to the chat exactly
  where the learner was reading.

## Architecture

### Derived data, not a second database

The rail is rebuilt in memory from the loaded conversation state:

- Assistant messages with `kind: "document"` produce a document/PDF item.
- Assistant messages containing `mermaid` fences produce a diagram item.
- Assistant messages containing `artifact` fences produce a visualization
  item.
- Assistant messages containing `flashcard` fences produce a flashcard-deck
  item.
- Each assistant message's existing `sources` list feeds a deduplicated source
  index keyed by material id. The index retains source message ids so clicks can
  return to the relevant answer.

This avoids a migration, avoids stale artifact records, and lets regenerated or
deleted replies naturally disappear from the rail.

### Boundaries

- `lib/chat/conversation-context.ts`: pure parsing and aggregation with no
  React dependency. It exports typed artifact and source entries.
- `components/chat/ConversationContextPanel.tsx`: desktop rail and sheet body.
- `components/chat/ConversationContextToggle.tsx` if the compact header
  control needs separation; otherwise the toggle remains in the chat page.
- `app/(app)/page.tsx`: owns open state, passes messages to the aggregator,
  renders the rail beside the main chat column, and performs transcript scroll
  + highlight actions.

The new panel does not own message fetching, PDF generation, Markdown
rendering, or source retrieval. Existing components remain their single source
of truth for those behaviors.

## Layout and Responsiveness

- The page main area becomes a horizontal flex container only beneath the
  existing header.
- The chat column retains `min-w-0`, its centered `chat-content` max width, and
  its current composer alignment.
- The rail is a sibling with a fixed desktop width of `18rem`, a subtle
  left divider, and `overflow-y-auto`.
- Opening it reduces only the available chat-column width; the transcript and
  composer continue to share the same centered max-width axis.
- At below the existing `tab` breakpoint, the rail switches to the app's dialog
  / sheet primitive so the transcript never becomes cramped.
- The panel uses no per-token layout animation. Its open/close animation is
  transform/opacity only, respecting reduced-motion preferences.

## Accessibility

- The toggle uses `aria-expanded` and describes the context panel.
- Artifact and source rows are buttons with explicit labels.
- Sheet focus handling uses the existing Dialog primitive.
- Scroll-to-result moves focus only when triggered from keyboard; pointer
  selection preserves reading focus.

## Error Handling

- Empty conversations display a low-emphasis empty state per section.
- Malformed or unfinished fences are ignored until the response is complete.
- A source whose message is no longer loaded is omitted safely.
- The existing PDF route remains the download implementation and receives the
  same error state if a download fails.

## Test Strategy

- Unit-test the pure aggregator for document, Mermaid, HTML artifact, mixed,
  and deduplicated-source conversations.
- Component-test that panel sections render counts, call their actions, and
  hide empty entries appropriately.
- Manually verify desktop collapse, mobile sheet, transcript/composer centering,
  keyboard controls, and no FPS regression while responses stream.
