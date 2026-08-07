# TODO — 5 fixes

Tracking the five reported issues. Detailed design: `.claude/plans/jolly-hopping-badger.md`.

## Linchpin: stream protocol migration (unblocks 2, 3, 4)
- [x] `app/api/chat/route.ts`: replace `result.toTextStreamResponse()` with a custom SSE `ReadableStream` iterating `result.fullStream`; emit `data:` JSON events: `{type:"text",delta}`, `{type:"reasoning",delta}`, `{type:"status",phase}`, `{type:"error",message}`, `{type:"done"}`. Map parts: `start-step`→status thinking, `reasoning-start`→thinking, `reasoning-delta`→reasoning, `text-delta`→text, `tool-call`→status searching (query), `tool-result`→thinking, `error`→error. Emit leading `reading-materials` / `drafting-document` status before the loop when applicable. `onFinish` (persistence) unchanged. (Note: AI SDK 7 delta parts expose `.text`, not `.textDelta`; tool-call `.input` is typed `{}` so `.query` is cast.)
- [x] `app/page.tsx` `runChat`: replace byte-decode loop with SSE parser (split on `\n`, parse `data: ` lines, dispatch text/reasoning/status/error/done). Add `reasoning?` + `status?` to the in-memory message type. Optimistic bubble starts with `status:"thinking"`. Stop-with-partial + sources-after-stream unchanged. Status cleared in `finally` so the line vanishes on completion.
- [x] `components/ChatMessage.tsx`: status line above bubble while streaming (`thinking…`, `reading your materials…`, `drafting document…`, `searching the web…`, `writing…`); collapsible `<details>` "thinking" panel rendering `m.reasoning` via `<Markdown>`. New optional props `status?`, `reasoning?`, `allMaterials?`.

## 1. Voice typing (`components/ChatInput.tsx`)
- [x] Permission pre-check via `navigator.permissions.query({name:"microphone"})`; if `denied`, show `gateMsg` and bail (no flicker).
- [x] `try/catch` around `rec.start()`.
- [x] `onerror`: map `not-allowed`/`service-not-allowed` → "Microphone blocked…", `no-speech` → "Didn't catch that…", `audio-capture` → "No microphone found."; set `errorRef`; `setListening(false)`.
- [x] `onend`: guarded single re-arm (`manualStopRef` + `retriedRef`) to survive `continuous=true` auto-stops; no infinite loop.
- [x] Clear refs at each new start; user click-stop sets `manualStopRef` before `stop()`.

## 2. Web search (Tavily)
- [x] `lib/tools/web-search.ts` (new): `makeWebSearchTool(apiKey)` → AI SDK `tool` with `z.object({query})` inputSchema; POST `https://api.tavily.com/search` (`api_key`, `query`, `max_results:5`, `include_answer:true`); return `{answer, results:[{title,url,content}]}`. Empty key → return `null`.
- [x] `lib/llm/provider.ts`: expose `tavilyApiKey` (`getAllSettings()` + `TAVILY_API_KEY` env fallback).
- [x] `app/api/settings/route.ts` + `app/settings/page.tsx`: `tavilyApiKey` field (show/hide, "Optional — enables web search").
- [x] `app/api/chat/route.ts`: when body `web:true` and key present, `tools:{web_search}`, `stopWhen: stepCountIs(5)`, `toolChoice:"auto"`. Else omit tools.
- [x] `components/ChatInput.tsx` + `app/page.tsx`: `web` toggle button (default on) + pass `web` in send payload (send/regenerate/edit).

## 3. Think more (auto reasoning + show thinking)
- [x] `app/api/chat/route.ts`: `isComplexTurn(userText, document)` — document OR `/flashcard|quiz|test me|deck|cheat sheet|draft|outline|summarize/i` OR length>400.
- [x] `providerOptions: { ollama: { reasoningEffort: complex ? "high" : "medium" } }` (best-effort).
- [x] `maxOutputTokens`: complex → 8192, default 4096.
- [x] Reasoning surfaced via the stream migration's thinking panel (no extra work if reasoning parts arrive).

## 4. Live status — delivered by the stream migration + ChatMessage status line above.

## 5. Materials/RAG awareness
- [x] `app/api/chat/route.ts` retrieval block: clean query (strip `>` quotes/markdown, collapse ws, truncate ~600 chars) before `embedText`.
- [x] Drop chunks with `cosine < 0.22`.
- [x] Material-level routing: per-material max score → pick top 4 materials (or all if fewer); only their chunks eligible.
- [x] Within selected materials: top chunks (no fixed cap), neighbor expansion (ordinal±1), dedup by first-80 chars, until ~6000-char budget.
- [x] Context block: `<context>` tags, inventory of all project materials (title + chunk count), excerpt `<excerpt material="Title">` tags, instruction to say when info isn't in materials / use web_search.
- [x] `components/SourcesPanel.tsx`: show ALL project materials, mark which were used (by materialId). Thread `allMaterials` from `app/page.tsx` (already has project materials) → `ChatMessage` → `SourcesPanel`.
- [x] Explicit material references: detect when a turn names a material by full title or "<word> <number>" (fuzzy word match survives mangling like "un-bungblatt"→`uebungsblatt`; qualifier word disambiguates `6._Uebungsblatt` vs `Kapitel_6`, and rejects count phrases like "make 10 flashcards"). Force-include referenced materials' chunks in document order, bypassing the 0.22 cosine floor, prioritized first in the budget; a bare follow-up ("again") reuses the prior turn's reference. Context block notes which materials the user named and tells the model to focus on them. Fixes "flashcards from Übungsblatt 6" only surfacing 1/7/9.

## Verify
- [x] `npx tsc --noEmit && npm run lint && npm run build` — clean (only pre-existing `<img>` warnings).
- [ ] Manual: voice prompt+feedback; web search status+citations; thinking panel on complex turns; status phases on every send; SourcesPanel lists all materials with >10; unrelated question → "not in materials" instead of hallucination.