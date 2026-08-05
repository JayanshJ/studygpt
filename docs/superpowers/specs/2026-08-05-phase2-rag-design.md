# Phase 2 — RAG / Materials (Claude-Projects-style) — Design

**Date:** 2026-08-05
**Status:** Approved
**Target:** StudyGPT v1 (chat + Feynman mode, polish + dark mode merged). Adds a Project entity that holds materials; conversations optionally belong to a project and auto-ground in its materials.

## Goal

Let a user bring in **PDFs and web pages**, group them into named **Projects**, and have every chat inside a project auto-ground its answers in the project's materials — with a Sources panel showing where each answer came from. Standalone chats (no project) keep working exactly as today.

This is the Claude-Projects model: a Project = a named bucket of materials; conversations live inside a project and inherit that context. Per the user's brainstormed roadmap, this is **Phase 2** (the v1 README + schema already name "Phase 2 = materials/chunks"); Phase 3 (knowledge graph) remains separate.

## Clarified scope (from brainstorming)

- **Sources supported:** PDF upload + Web URL fetch. (Pasted text, .txt, .md explicitly out of scope this phase.)
- **Attachment model:** Claude-Projects-style — a Project holds materials; conversations optionally belong to a project and inherit its materials.
- **Membership:** Projects are **optional**. Standalone chats still work; existing conversations stay project-less (no project). New chat defaults to standalone unless a project is selected. Least disruptive.
- **Project contents:** materials only this phase. **No** project-level custom instructions (deferred).
- **Retrieval:** auto-retrieve on every turn in a project chat; show a **Sources panel** beneath the answer (material title + quoted snippet, no inline `[1][2]` marks in the prose) — "whatever Claude does."
- **Vector store:** JS cosine over BLOB embeddings (no native deps). sqlite-vec / ANN is a documented upgrade path, not used now.

## Non-goals

- Background/async ingestion jobs — ingestion is synchronous in the request for MVP (a paper takes a few seconds locally).
- Project-level custom instructions (deferred — materials only this phase).
- Pasted-text / .txt / .md sources (out of scope this phase).
- Re-embedding on material edit, cross-project search, ANN index (sqlite-vec) — documented upgrade paths only.
- Phase 3 knowledge graph (separate spec).

## Architecture

A **Project** is a named container of materials. A conversation *optionally* belongs to a project; when it does, every turn auto-grounds in that project's materials and the answer carries a Sources panel. Standalone chats are unchanged.

### Data model (all `CREATE TABLE IF NOT EXISTS`; additive — only a nullable column touches existing tables)

| table | columns | notes |
|---|---|---|
| `projects` | `id TEXT PK, name TEXT, created_at INTEGER` | new |
| `materials` | `id TEXT PK, project_id TEXT FK→projects ON DELETE CASCADE, title TEXT, source_type TEXT ('pdf'\|'url'), source_ref TEXT (url for url; filename for pdf), text TEXT (full extracted), char_count INTEGER, status TEXT ('processing'\|'ready'\|'error'), error TEXT NULL, created_at INTEGER` | new |
| `chunks` | `id TEXT PK, material_id TEXT FK→materials ON DELETE CASCADE, ordinal INTEGER, text TEXT, embedding BLOB (Float32Array), created_at INTEGER` | new; index on `material_id` |
| `conversations` | adds `project_id TEXT NULL FK→projects ON DELETE SET NULL` | existing chats stay `NULL` (standalone) |
| `message_sources` | `message_id TEXT PK, sources TEXT (JSON), created_at INTEGER` | new; one row per grounded assistant message |

- Deleting a project **cascades** to its materials + chunks; its conversations survive but become standalone (un-grounded) — you never lose chats.
- `chunks.embedding` is a `Float32Array` serialized to a `Buffer` (`Buffer.from(float32array.buffer)`); decoded by `new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length/4)`.

### Embedding model

- New `embeddingModel` setting (default `nomic-embed-text`), separate from the chat model.
- `Provider` interface gains optional `embeddingModel(config): TextEmbeddingModel` and optional `validateEmbedding(config): Promise<void>`.
- Ollama provider implements `embeddingModel` via `client.textEmbeddingModel(model)` from `@ai-sdk/openai-compatible` (already a dependency). `validateEmbedding` reuses the existing `/v1/models` check; on missing model it throws a clean message: `Pull it with \`ollama pull nomic-embed-text\``.
- `getModelConfig()` returns `embeddingModel` (settings value, else `OLLAMA_EMBEDDING_MODEL` env var, else `nomic-embed-text`).

### Retrieval flow (inside `POST /api/chat`)

Runs only when `conversation.project_id` is set **and** the project has ≥1 `ready` material, and runs **before** `streamText`:

1. Take the latest user message as the query; embed it with the embedding model.
2. Load all `chunks` for the project's `ready` materials (chunk id, text, embedding BLOB, material_id, material.title) into memory once.
3. Cosine-similarity query vs. every chunk; take **top-k (k=6)** with a **per-material cap of 3** so one paper cannot dominate.
4. Build a context block appended to the system prompt: the base chat/Feynman prompt (`systemPromptFor(conv.mode)`) + a "Excerpts from project materials — cite by title:" header + the k snippets, each prefixed with `[<material title>]`.
5. Persist the used sources (array of `{materialId, title, snippet, ordinal}`) as JSON in a **separate `message_sources` row keyed by `assistantMessageId`**, written **before** `streamText` (synchronously, right after retrieval). This is decoupled from message-content persistence so the existing stop/regenerate content semantics (INSERT OR IGNORE stop-persist vs. upsert onFinish) are untouched — sources survive a mid-stream stop because they were written before streaming started.
6. The client renders a Sources panel under that assistant message. **Transport:** the conversation GET joins/returns `sources` for each assistant message (so reload shows it); after a live stream the client does one targeted `GET /api/messages/[id]` to fetch sources for the just-finished assistant message and renders the panel immediately (the row already exists, written before streaming).

Standalone chats (no `project_id`) skip all of this — byte-for-byte identical to today's chat route.

## Ingestion pipeline

`POST /api/materials` (multipart for PDF, JSON for URL):

1. Insert a `materials` row with `status: 'processing'` (server UUID).
2. Extract text:
   - **PDF** → `unpdf` (`extractPdf(buffer)`, pure-JS, no native deps).
   - **URL** → `fetch()` the page, convert HTML→text with `html-to-text` (lightweight, no native deps).
3. Chunk the text: paragraph-based (split on blank lines), greedily merge into ≤~800-char chunks, split oversized paragraphs at sentence boundaries, carry ~100 chars of overlap into the next chunk. (~40 lines.)
4. Embed chunks in batches of 64 via `embedMany(embeddingModel, chunks)`; store each as a `Float32Array` BLOB in `chunks` (server UUIDs, ordinal from 0).
5. Set `status: 'ready'` + `char_count`, or `status: 'error'` with `error` message.

Ingestion runs **synchronously in the request** for MVP. The materials UI shows `processing` / `ready` / `error` and refreshes on return. Background jobs are a non-goal.

## UI

- **`/projects` page** (new): list / create / rename / delete projects; per-project **materials manager** — upload a PDF or paste a URL, list materials with title + status + char count, delete a material. The main new surface.
- **Sidebar**: a compact **project switcher** at the top (current selection: "Standalone" or a project name; dropdown to change; a "Manage projects…" link to `/projects`). The conversations list filters to the current selection; "+ new conversation" creates the chat inside the current selection. **Standalone is the default**, preserving today's flow.
- **Chat header**: when in a project, show the project name + a materials-count chip; clickable → `/projects`.
- **Sources panel** in `ChatMessage`: under any assistant message that has `sources`, a collapsible "Sources" list — each entry shows the material title and a short quoted snippet. Reuses Graph Paper Lab tokens; no new colors/fonts. No inline marks in the prose (matches Claude).

## File structure (new/changed)

```
app/
  projects/page.tsx              # new — project + materials manager
  api/
    projects/route.ts            # new — list / create
    projects/[id]/route.ts       # new — PATCH (rename) / DELETE
    materials/route.ts           # new — POST (upload pdf / add url)
    materials/[id]/route.ts      # new — DELETE
    chat/route.ts                 # change — retrieval + sources
    conversations/route.ts        # change — accept projectId on create
    conversations/[id]/route.ts   # change — GET returns conversation.project_id + per-message sources
    messages/[id]/route.ts        # new — GET (sources fetch after stream)
lib/
  db/schema.ts                    # add tables + conversations.project_id
  db/projects.ts                  # new — project queries
  db/materials.ts                 # new — material + chunk queries, BLOB encode/decode
  db/sources.ts                  # new — message_sources get/set (by message id)
  embed/index.ts                 # new — embedText/embedMany via provider, cosine
  ingest/index.ts                # new — extract (pdf/url), chunk, embed+store
  llm/provider.ts                # change — embeddingModel + validateEmbedding
  llm/ollama.ts                   # change — embeddingModel impl
components/
  ProjectsView.tsx               # new — /projects page shell
  MaterialsManager.tsx           # new — per-project materials list + add/delete
  ProjectSwitcher.tsx             # new — sidebar project selector
  SourcesPanel.tsx                # new — collapsible sources under assistant msg
  ChatMessage.tsx                 # change — render SourcesPanel
  Sidebar.tsx                     # change — project switcher
```

## Dependencies added (both pure-JS, no native build)

- `unpdf` — PDF text extraction.
- `html-to-text` — HTML→text for URL ingestion.
- The AI SDK embedding utilities (`embed`, `embedMany`, `TextEmbeddingModel`) come from the already-installed `ai` + `@ai-sdk/openai-compatible`.

No new test framework.

## Global constraints

- **Graph Paper Lab tokens only** — Sources panel, project switcher, materials manager all reuse `--paper / --paper-2 / --paper-3 / --ink / --ink-2 / --ink-3 / --rule / --feynman / --line / --grid`; 3px corners (2px on tight chrome); Newsreader (serif body) + JetBrains Mono (chrome via `.mono`). No new colors, no new fonts. The red notebook rule + graph-paper grid + dark-mode palette-block all continue to apply.
- **Additive schema** — `CREATE TABLE IF NOT EXISTS` for new tables; `conversations` only gains a nullable `project_id`. No destructive migration, no data backfill.
- **Verify per task** with `npx tsc --noEmit`, `npm run lint`, `npm run build`. No unit tests. The pre-existing `lib/db` dynamic-fs-access build warning stays expected and ignored.
- **ID pass-through + idempotent inserts** continue (materials/chunks use server UUIDs; sources live in a separate `message_sources` row written **before** streaming, decoupled from the content INSERT OR IGNORE / upsert logic so stop/regenerate semantics stay consistent).
- **One commit per task.**