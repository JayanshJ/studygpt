# Loom

A calm, local AI assistant that's especially good for studying. A ChatGPT-style
streaming chat that runs fully on your machine via [Ollama](https://ollama.com)
— no API key, no per-token cost. Use it for writing, code, analysis, or
open-ended thinking; turn on a project's study tools to learn from your own
materials (concept graph, mastery tracking, flashcards, explain-it-back
Feynman mode).

## Product North Star

Loom should always become easier to use and more intelligently aware of the
user's situation. New work should remove friction, make the interface clearer,
and use available context—conversation, selected text, project materials, study
state, and intent—to help without making people repeat themselves. Avoid
complexity that does not improve either usability or useful intelligence.

## Prerequisites

1. Install Ollama and start it: `ollama serve`
2. Pull a model: `ollama pull qwen2.5` (or `llama3.2`, `mistral`, …)

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, create a conversation, and ask anything. For
studying, create a **Study project** on the Projects page, add your materials
(PDFs/URLs), and build a concept graph — or just toggle **Feynman** mode in a
conversation to learn by explaining back.

## Configuration

Defaults live in `.env.local`:

```
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5
DATABASE_URL=./data/studygpt.db
```

The **Settings** page (the ⚙ in the sidebar) changes the model and base URL at
runtime — no restart needed. New conversations pick up the saved model. The
Settings page also configures optional keys for web search (Tavily), voice
typing (OpenAI Whisper), and diagram notation (a vision model).

## Swapping to Claude or GPT later (the key design decision)

Everything talks to a `Provider` interface in `lib/llm/provider.ts`. Today only
`ollamaProvider` is wired. To use a frontier model when Ollama's reasoning isn't
sharp enough:

1. Add a provider impl (e.g. `lib/llm/anthropic.ts`) using `@ai-sdk/anthropic`.
2. Register it in `PROVIDERS` in `lib/llm/provider.ts`.
3. Pick it in Settings.

No UI, data model, or route changes.

## Project layout

```
app/
  page.tsx                 # chat view (streaming, client state)
  settings/page.tsx        # model + endpoint config
  api/
    chat/route.ts          # streaming endpoint -> provider
    conversations/         # CRUD + per-conversation get/patch/delete
    projects/              # project CRUD + study capability toggle
    settings/route.ts      # live config
lib/
  db/                      # better-sqlite3 schema + queries + migrations
  llm/                     # swappable provider layer
  prompts/                 # chat, feynman, document, study-persona prompts
  chat/                    # answer engine, RAG, notation, study actions
components/                # Sidebar, ChatMessage (markdown+KaTeX), ChatInput, ModeToggle
```

## Study loop

A Study project (study capability enabled) closes a learning loop that a plain
chat doesn't:

- **Materials** — upload PDFs or add URLs; chunked + embedded for retrieval with
  citations.
- **Concept graph** — auto-extract concepts + relationships from your materials,
  visualized with Cytoscape, with prerequisite-gated learning paths and coverage.
- **Mastery** — per-concept mastery bands derived from your flashcard review
  history, fed back into the tutor's system prompt so it focuses on what you're
  slipping on.
- **Flashcards** — inline flashcard decks in chat with FSRS spaced review.
- **Feynman mode** — explain a concept back; the AI critiques the gaps.

A general project (study off) is just a container of materials + memory +
conversations with the general assistant persona — useful for coding, writing,
and research without the study surfaces.