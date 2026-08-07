# SP4 — Mastery model + mastery-aware chat (design)

> Sub-project 4 (the integration layer) of the knowledge-graph +
> mastery-tracking feature. Builds on SP1 (concept extraction + graph
> storage), SP2 (graph visualization), and SP3 (FSRS-5 SRS on decks) — all
> present on branch `sp3-srs`, which this branch (`sp4-mastery`) is cut from.
> SP4 is the finale: it reads SP1's concepts + SP3's `review_log` to model what
> the user knows and what's slipping, surfaces that in chat (mastery-aware
> retrieval + a mastery summary in the prompt), and overlays mastery coloring on
> the graph, the study card, the sources panel, and a dedicated mastery page.

## Goal

Give StudyGPT a per-concept **mastery** signal derived from the user's FSRS
review history, and use it three ways: (1) **mastery-aware retrieval** — when the
user asks a question, mildly prefer grounding material about concepts they're
slipping on, and tag each cited excerpt with the concepts it covers + the
learner's mastery; (2) **mastery-aware chat inference** — inject a concise
mastery summary into the system prompt so the tutor tailors explanations toward
slipping/untested concepts and builds on strong ones; (3) **mastery coloring**
across four surfaces — the concept graph, the study card, the sources panel, and
a new `/mastery` overview page — so the user can *see* what they know.

Mastery is **not** a new hand-rolled scorecard. It is the user's FSRS
**retrievability** (the same forgetting curve SP3's algorithm already computes)
aggregated per concept across the cards that test that concept. This reuses
SP3's locked math, decays naturally with time, and makes "slipping" fall out
for free.

## What exists today (the surface SP4 builds on)

- **Concepts (SP1):** `concepts(id, project_id, label, slug, description,
  embedding, source_count, …)`, `concept_edges`, `concept_sources(concept_id,
  material_id, ordinal, …)`. `concept_sources` keys rows by
  `${materialId}:${ordinal}` — **the same key the chat retriever uses for
  chunks** — so a chunk's concepts are already derivable without new schema.
  `lib/db/concepts.ts` exports `listConceptEmbeddingsForProject`,
  `getConceptDetail`, etc. `GET /api/concepts?projectId=` returns
  `{concepts:[{id,label,slug,description,sourceCount}], edges, materials}` —
  its own comment notes "No mastery fields (those arrive in SP4)."
- **Graph (SP2):** `components/graph/ConceptGraph.tsx` — `ConceptNode` colors by
  `sourceCount >= 2` (`bg-ink text-paper` if filled, else `bg-paper text-ink-3`),
  border `border-rule` (selected/hovered) / `border-ink` (filled) /
  `border-ink-3`. `app/graph/page.tsx` consumes `GET /api/concepts`, runs
  `detectCommunities`, feeds `ConceptGraph` + `DetailPanel`.
- **SRS (SP3):** `card_scheduling(card_id, due, stability, difficulty, reps,
  lapses, state, last_review, …)` and `review_log(id, card_id, deck_id, grade,
  state, stability, difficulty, reviewed_at)`. `lib/fsrs/algorithm.ts` is a
  pure FSRS-5 module exporting `repeat`, `Rating`, `CardState`, `SchedCard`,
  `DEFAULT_W`, etc. — but **not** retrievability as a standalone helper. The
  shared `components/study/StudySession.tsx` flips a card and grades it via
  `POST /api/review/grade`; the due endpoints `GET /api/decks/[id]/due` and
  `GET /api/review/due` return `CardDue[] = {id,front,back,deckId,deckTitle,state,due}`.
- **Chat + RAG:** `app/api/chat/route.ts` is a single `POST` using `streamText`.
  Retrieval is a ~280-line inline block (lines 220–497): embed the query, cosine
  over `listChunkEmbeddingsForProject` (floor 0.22), top-4 materials, greedy
  excerpts with neighbor expansion (~6000-char budget). Output is a
  `contextBlock` string appended to the system prompt + `sources: SourceEntry[]`
  persisted via `setMessageSources`. The system prompt is a single concat at
  line 527: `today + basePrompt + webNote + contextBlock`. `CHAT_SYSTEM_PROMPT`
  (`lib/prompts/chat.ts`) is fully user-agnostic. `SourceEntry =
  {materialId, title, snippet, ordinal}`. Decks are global; a card's project is
  reached via `card → deck.conversation_id → conversation.project_id`.

## Locked decisions

- **Mastery = FSRS retrievability aggregated per concept.** Each linked card's
  retrievability `R = (1 + (19/81)·elapsed/stability)^(−0.5)` (the FSRS-5
  forgetting curve, same constants as `lib/fsrs/algorithm.ts`), clamped to
  `[0,1]`. Concept mastery = **mean R over the concept's reviewed linked cards**
  (0..1, decays with elapsed time). Never-reviewed linked cards make the band
  `untested`; no linked cards → `unknown`. Reuses SP3's math via one new
  additive export `retrievability(stability, elapsedDays)` on `algorithm.ts`.
- **Card↔concept link = embedding auto-link, at grade time.** Embed the card
  front, cosine-match to the project's concept embeddings (card → deck →
  conversation → project), upsert the top-≤3 concepts with score ≥ 0.55 into a
  new `card_concepts` table. Triggered from `POST /api/review/grade` after the
  scheduling upsert (idempotent). No change to card creation. Cards whose deck
  has no conversation/project stay unlinked (contribute to no concept).
- **Retrieval = re-rank + tag (no filtering).** Chunk score becomes
  `cosine + 0.15·(1 − chunkMaxConceptMastery)` — a mild boost for
  slipping-concept chunks so semantic relevance still dominates. Each excerpt is
  tagged with the concepts it covers + the learner's band. Relevant material is
  never hidden.
- **Chat inference = a mastery block in the system prompt.** No separate model
  call. A concise per-concept mastery summary is injected between `basePrompt`
  and `contextBlock`; `CHAT_SYSTEM_PROMPT` gains one line telling the tutor to
  use it. Gated on the project having concepts + mastery data.
- **Four mastery surfaces, all in scope:** graph node coloring, StudySession
  card coloring, SourcesPanel tags, and a dedicated `/mastery` page.
- **Monochrome encoding only** (Graph Paper tokens). Five mastery bands map to
  existing tokens (table below). No new colors or fonts.
- **On-demand mastery, no cache table.** `conceptMasteryForProject` computes
  per request (cheap, small N); a cache table is YAGNI.

### Mastery bands → tokens

| band | condition | token |
|---|---|---|
| `strong` | reviewed linked cards exist and mean R ≥ 0.8 | `--feynman` |
| `learning` | reviewed linked cards exist and 0.5 ≤ mean R < 0.8 | `--ink` |
| `slipping` | reviewed linked cards exist and mean R < 0.5 | `--rule` |
| `untested` | ≥1 linked card, none reviewed (no `card_scheduling` row) | `--ink-3` |
| `unknown` | no linked cards | `--ink-3` (dim, e.g. `opacity-40`) |

(`R` uses the card's `stability` + `elapsed = max(0, floor(now/DAY) − floor(last_review/DAY))` from `card_scheduling`.)

## Architecture

A pure mastery module (math only) under four display surfaces + two chat seams
(retrieval + prompt). Per-concept mastery is derived on demand from
`card_concepts` (the new card↔concept bridge) joined to `card_scheduling`
(SP3). Chunk→concept is derived from the existing `concept_sources` (no new
schema). All schema changes are additive (one new table + one new pure export +
type/response extensions; no existing table/column touched).

### Data flow

1. **Grade rolls up to mastery.** User grades a card → `POST /api/review/grade`
   → FSRS `repeat` → upsert `card_scheduling` + append `review_log` (unchanged,
   SP3) → **new:** `linkCardToConcepts(cardId)` (embed front → match project
   concepts → upsert `card_concepts`). From then on the card's retrievability
   feeds every concept it links to.
2. **Mastery-aware chat.** User asks a question → `retrieve(projectId, query,
   {now})` (new `lib/retrieval`, extracted from the inline block) → cosine
   ranking re-weighted by concept mastery → excerpts tagged with concepts+band →
   `contextBlock` + a `masteryBlock` injected into the system prompt →
   `streamText`. `sources` carry `concepts` for the SourcesPanel.
3. **Mastery coloring.** `GET /api/concepts` (extended) computes per-concept
   mastery → graph page colors nodes; `/mastery` page lists concepts by mastery;
   due endpoints compute per-card R → StudySession tints the card; SourcesPanel
   renders per-excerpt concept+band chips.

### Components / files

- `lib/fsrs/algorithm.ts` (modified, additive) — export
  `retrievability(stability, elapsedDays): number` (the forgetting curve already
  computed internally; surfaced as a pure helper). No behavior change to
  `repeat`.
- `lib/mastery/model.ts` (new, pure) — `retrievability` re-exported/used;
  `cardRetrievability(sched, now)`, `aggregateMastery(rs: number[]): number`,
  `masteryBand(mastery: number|null, reviewed: number, linked: number): Band`,
  `Band = "strong"|"learning"|"slipping"|"untested"|"unknown"`. No DB, no React.
- `lib/mastery/link.ts` (new) — `linkCardToConcepts(cardId)` (project resolution
  via deck→conversation→project; embed front; cosine vs
  `listConceptEmbeddingsForProject`; upsert top-≤3 ≥0.55 into `card_concepts`).
  `ensureCardLinked` not needed (grade-time only).
- `lib/db/mastery.ts` (new, re-exported from the `lib/db` barrel) —
  `conceptMasteryForProject(projectId, now): Map<conceptId, {mastery:number|null, band:Band, reviewedCards:number, totalCards:number}>`,
  `conceptMastery(conceptId, now)` (single),
  `cardMastery(cardId, now): {mastery, band} | null` (the card's own R/band,
  for StudySession), `chunksToConcepts(materialId, ordinals): Map<chunkKey,
  {conceptId,label}[]>` (via `concept_sources`), `linkedConceptsForCard(cardId)`.
- `lib/db/schema.ts` (modified, additive) — `card_concepts` table +
  `CardConcept` type; `CardDue` gains optional `mastery?: number|null`,
  `band?: Band`; `SourceEntry` gains optional `concepts?: {label:string,
  band:Band}[]`.
- `lib/db/index.ts` (modified) — `export * from "./mastery"`; add `CardConcept`
  to the type re-export; the `card_concepts` DDL is in `SCHEMA_SQL`
  (`CREATE TABLE IF NOT EXISTS`).
- `lib/retrieval/index.ts` (new) — `retrieve(projectId, query, opts): {
  contextBlock, sources }`, extracted verbatim from the chat route's inline
  block, then extended with mastery re-rank + excerpt tagging. No HTTP/persistence.
- `app/api/chat/route.ts` (modified) — replace the inline retrieval block with a
  call to `retrieve(...)`; insert `masteryBlock` into the system-prompt concat.
- `lib/prompts/chat.ts` (modified) — one line instructing the tutor to use the
  mastery summary when present.
- `app/api/concepts/route.ts` (modified) — `concepts[]` carries
  `{mastery, band}` (via `conceptMasteryForProject`).
- `app/api/decks/[id]/due/route.ts` + `app/api/review/due/route.ts` (modified) —
  `CardDue` carries `{mastery, band}` (via `cardMastery`).
- `components/graph/ConceptGraph.tsx` + `app/graph/page.tsx` (modified) —
  `ConceptNodeData` gains `band`; node border reflects mastery band; page passes
  it through.
- `components/study/StudySession.tsx` (modified) — flip-card border tints by
  `current.band` (the SP3 seam: "card fill gains a mastery token").
- `components/SourcesPanel.tsx` (modified) — per-excerpt concept+band chips from
  `SourceEntry.concepts`.
- `app/mastery/page.tsx` (new) — `/mastery` overview with project switcher
  (mirrors `/graph`), concepts sorted slipping-first, band chips, linked-card
  counts, last-reviewed.
- `components/Sidebar.tsx` (modified) — new `/mastery` icon link.
- `lib/mastery/model.test.ts` (new) — pure unit test (node:test + tsx):
  `retrievability` vs the ts-fsrs oracle (dev-only) + band thresholds +
  aggregation on a fixed card set.

### Schema (additive)

```sql
CREATE TABLE IF NOT EXISTS card_concepts (
  card_id     TEXT NOT NULL,
  concept_id  TEXT NOT NULL,
  score       REAL NOT NULL,            -- cosine sim of card front to concept embedding
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (concept_id) REFERENCES concepts(id) ON DELETE CASCADE,
  UNIQUE(card_id, concept_id)
);
CREATE INDEX IF NOT EXISTS idx_card_concepts_card ON card_concepts(card_id);
CREATE INDEX IF NOT EXISTS idx_card_concepts_concept ON card_concepts(concept_id);
```

No existing table or column is removed or renamed. `CardDue`/`SourceEntry` are
derived/JSON types (no schema change). `GET /api/concepts` response is widened
additively. `algorithm.ts` gains one export.

### Mastery-aware retrieval detail

- **Extraction first.** Pull the inline block into `lib/retrieval/index.ts` as a
  behavior-preserving refactor (no mastery) — so any regression is isolated.
- **Re-rank.** For each eligible chunk, resolve its concepts via
  `chunksToConcepts(materialId, [ordinal])` (a batched lookup over
  `concept_sources`). `chunkMastery = max numeric mastery among the chunk's
  concepts that have reviewed linked cards` — concepts in the `untested` or
  `unknown` bands (no numeric mastery) are **neutral** and contribute no boost,
  and a chunk that maps to no reviewed concept gets no boost at all (this
  matters: most chunks map to no concept, so boosting them would neutralize the
  re-rank). Final score = `cosine + 0.15 * (1 − chunkMastery)` when a reviewed
  concept applies, else `cosine`. The 0.15 weight keeps semantic relevance
  dominant; a slipping-concept chunk (mastery 0) gets a +0.15 bump, a strong one
  (mastery 0.9) gets +0.015.
- **Tag.** Each `<excerpt>` block in `contextBlock` is prefixed with
  `[covers: <label> (<band>), …]` (only when the chunk has concepts). The
  corresponding `SourceEntry.concepts` is populated for SourcesPanel.
- **No filtering.** The cosine floor (0.22) and material-routing are unchanged;
  mastery only re-orders within the eligible set and annotates.

### System-prompt mastery block

Inserted at the concat (`route.ts:527`) between `basePrompt` and `contextBlock`,
only when `conv.project_id` is set and `conceptMasteryForProject` returns ≥1
non-`unknown` concept:

```
Learner mastery — strong: <labels>; learning: <labels>; slipping: <labels>;
untested: <labels>. Focus explanations on slipping and untested concepts;
connect new material to strong ones; don't re-explain what's strong.
```

Bands omitted when empty. Each band lists up to 6 labels (slipping by lowest
mastery first, strong by highest first; `+N more` if exceeded) so the block
stays bounded. `CHAT_SYSTEM_PROMPT` gains: "When a Learner mastery summary is
provided, tailor depth and emphasis to it." No extra model call.

### Visual encoding (monochrome)

- **Graph nodes:** border = mastery band (`slipping`→`border-rule`,
  `strong`→`border-feynman`, `learning`→`border-ink`, `untested`/`unknown`→
  `border-ink-3`); fill stays `sourceCount`-based; selected/hovered overrides to
  a thicker `border-rule` (so selection is still distinguishable from
  slipping). `unknown` nodes render dim (`opacity-40`).
- **Study card:** flip-card border tints by `current.band`
  (`slipping`→`border-rule`, `strong`→`border-feynman`, `learning`→`border-ink`,
  `untested`/`unknown`→`border-line`); hover keeps `border-ink-3`. A small
  `mono text-[10px]` band label appears in the card header.
- **SourcesPanel:** per excerpt, `mono text-[10px]` chips: `<label> <band>`,
  band in its token color. Hidden when an excerpt has no concepts.
- **`/mastery` page:** a table/list of concepts sorted slipping-first then
  untested, each row: label, band chip, `reviewed/total` cards, last-reviewed
  date. Header chip `N slipping · M learning · K strong` (mono, tabular-nums).
  Reuses the `/graph` project-switcher pattern + Graph Paper page chrome.

## Error handling

- **No project / no concepts / never-graded cards** → mastery block omitted,
  retrieval behaves exactly as today (no re-rank, no tags), coloring = `unknown`
  band. The extraction refactor must preserve today's behavior verbatim when
  mastery is absent — this is the regression guard.
- **Card with no resolvable project** (deck has no `conversation_id`, or
  conversation has no `project_id`) → `linkCardToConcepts` is a no-op; the card
  stays unlinked and contributes to no concept. No error.
- **Embedding/link failure** (Ollama down during a grade) → `linkCardToConcepts`
  catches and skips; the grade itself still succeeds (linking is best-effort,
  retried on the next grade). Mastery for that card falls back to `untested`.
- **Mastery computation NaN safety** — `retrievability` clamps to `[0,1]`;
  `aggregateMastery` ignores non-finite R; a concept whose reviewed cards all
  yield non-finite R → `unknown`. The unit test asserts no non-finite mastery.
- **`/mastery` with no project selected / no concepts** → Graph Paper empty
  state: "no concepts yet — build a concept graph first", not a blank canvas.

## Testing / verification

- **Pure mastery unit test** (`lib/mastery/model.test.ts`, node:test + tsx):
  (1) `retrievability` matches ts-fsrs's forgetting curve (dev-only oracle) over
  a grid of `{stability, elapsed}`; (2) band thresholds on a fixed card set
  (e.g. a card with stability 3, last_reviewed today → `strong`; same card
  reviewed 30 days ago → `slipping`); (3) `aggregateMastery` mean + the
  `untested`/`unknown` rules; (4) no NaN/Infinity across a random card set.
  Run via a `test:mastery` script (mirror of `test:fsrs`).
- **Retrieval re-rank** — a focused synthetic test (a project with two
  materials mapped to a slipping vs a strong concept) asserting the
  slipping-concept chunk ranks higher at equal cosine. Otherwise covered by smoke.
- **Bar otherwise unchanged:** `npx tsc --noEmit && npm run lint && npm run
  build` clean (pre-existing `<img>` + `lib/db` warnings expected); `test:fsrs`
  still 3/3 (the new `retrievability` export doesn't change `repeat`).
- **Manual smoke:** grade a card whose front matches a concept → graph node for
  that concept colors by band; `/mastery` lists it; ask a question about a
  slipping concept → the cited excerpt is tagged `slipping` and the system
  prompt carries the mastery block (verify via a logged prompt or behavior);
  SourcesPanel shows concept+band chips; StudySession card border tints by
  band; a project with no concepts → chat behaves exactly as before (no block,
  no tags, no re-rank).

## Dependencies

- None new. Reuses `lib/embed` (`embedText`, `decodeEmbedding`, `cosine`),
  `lib/fsrs/algorithm` (new `retrievability` export), `lib/db/concepts`
  (`listConceptEmbeddingsForProject`), `lib/db` (`getCard`, `getDeck`,
  conversation/project helpers), `lib/db/decks` + `lib/db/reviews` (SP3),
  `lib/llm/provider` (only if a future inference pass is added — not in SP4).
  `ts-fsrs` stays dev-only (mastery unit test only).

## Out of scope (SP4)

- Per-user FSRS `w`-parameter optimization (still deferred; needs more history).
- Manual card↔concept tagging UI (auto-link only).
- A separate LLM "pedagogy inference" pass (the prompt block covers it).
- A persisted mastery cache table (on-demand only).
- Conversation-driven mastery signals (e.g. inferring mastery from chat itself,
  not reviews) — a later enhancement.
- Editing/re-linking cards to concepts by hand; auto-link is immutable per grade.
- Mastery-based study-session ordering (cards already surface by FSRS due).

## Notes for after SP4

- SP4 completes the 4-part feature. The natural next enhancements are: the
  deferred `w`-optimizer (drop-in via `lib/fsrs/algorithm.ts` + `review_log`),
  conversation-driven mastery signals, and mastery-trend history (snapshot
  mastery over time for a progress chart).
- The pure `lib/mastery/model.ts` + unit test make the band thresholds and
  aggregation tunable without touching anything else.
- The `lib/retrieval` extraction is a cleanup win independent of mastery — it
  makes the chat route's RAG testable and replaceable.