# StudyGPT

A local study companion for **concept-heavy learning** (math, physics, CS theory). A ChatGPT-style streaming chat that runs fully on your machine via [Ollama](https://ollama.com) — no API key, no per-token cost. v1 is the MVP: streaming chat + conversation history + a per-conversation **Feynman mode** (you explain concepts back; the AI critiques the gaps).

## Prerequisites

1. Install Ollama and start it: `ollama serve`
2. Pull a model: `ollama pull qwen2.5` (or `llama3.2`, `mistral`, …)

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000, create a conversation, and ask something like
"Explain why the derivative is the slope." Toggle **Feynman** to learn by
explaining back.

## Configuration

Defaults live in `.env.local`:

```
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_MODEL=qwen2.5
DATABASE_URL=./data/studygpt.db
```

The **Settings** page (the ⚙ in the sidebar) changes the model and base URL at
runtime — no restart needed. New conversations pick up the saved model.

## Swapping to Claude or GPT later (the key design decision)

Everything talks to a `Provider` interface in `lib/llm/provider.ts`. v1 ships
only `ollamaProvider`. To use a frontier model when Ollama's reasoning isn't
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
    conversations/          # CRUD + per-conversation get/patch/delete
    settings/route.ts      # live config
lib/
  db/                      # better-sqlite3 schema + queries
  llm/                     # swappable provider layer
  prompts/                 # chat + Feynman system prompts
components/                # Sidebar, ChatMessage (markdown+KaTeX), ChatInput, ModeToggle
```

## Roadmap (out of scope for v1)

- **Phase 2:** study from your own materials — upload PDFs/notes, embed with Ollama, retrieve relevant chunks with citations.
- **Phase 3:** concept/knowledge graph — auto-extract concepts + relationships from conversations and materials, visualize with reactflow, track mastery.