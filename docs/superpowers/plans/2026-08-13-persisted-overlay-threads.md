# Persisted Contextual Overlay Threads Implementation Plan

**Goal:** Make contextual overlay chats durable, visibly anchored to the selected answer passage, voice-capable, and slightly less rounded across the application.

**Architecture:** A saved overlay is a thread keyed by the conversation, source assistant message, and normalized selected text. Overlay turns live in their own table, while the existing answer engine still receives the canonical conversation prefix plus the saved overlay history. The browser resolves a thread before opening the overlay, streams replies through the existing SSE contract, and reloads saved anchors for each conversation.

**Tech Stack:** Next.js App Router route handlers, SQLite via `better-sqlite3`, React 19, Motion, browser Web Speech / MediaRecorder, existing `/api/transcribe` service.

## Constraints

- Keep normal chat messages and their persistence unchanged.
- Reuse both existing voice paths: browser live recognition and server-side transcription.
- Keep overlay answers material-aware through the existing `streamAnswer` engine.
- Additive SQLite migrations must keep existing local databases working.
- Reduced-motion users retain the existing static behavior.

## Tasks

### 1. Persist overlay threads and turns
- Add `overlay_threads` and `overlay_messages` schema entries with cascade cleanup from conversations/messages.
- Add `lib/db/overlays.ts` for resolving a selection to a thread, reading markers/turns, and writing completed turns.
- Add pure helpers for grouping markers by source message and test them with `node:test`.

### 2. Add resolve and streaming APIs
- Add `POST /api/chat/overlays` to validate a selection and return the existing-or-created thread plus saved turns.
- Update `POST /api/chat/overlay` to accept `overlayId` and a new question, rebuild context from persisted turns, and persist the user/assistant turns around the shared SSE answer engine.
- Preserve streamed source entries with assistant turns so reopened overlays render citations.

### 3. Reuse voice typing in the overlay composer
- Extract normal composer voice behavior into `useVoiceTyping(value, setValue, transcriptionAvailable)`.
- Replace `ChatInput`’s internal recording/recognition state with the hook.
- Add the same mic button, recording state, server-transcribing state, and error copy to `ChatOverlay`.

### 4. Render saved discussion anchors
- Resolve a saved thread before showing `ChatOverlay`.
- Fetch marker summaries when a conversation is loaded and pass them to assistant messages.
- Highlight selected text using the browser CSS Custom Highlight API, with a visible “discussion” chip fallback/action for reopening each saved thread.

### 5. Tune the radius scale
- Reduce control/card/panel token values by roughly 10–15%.
- Update overlay panel geometry to become wider on desktop while preserving a comfortable mobile bottom sheet.

### 6. Verify
- Run focused helper/API static tests, TypeScript, and `next build`.
- Confirm migration safety and no remaining ephemeral-only route behavior.
