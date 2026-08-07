# SP3 — SRS on Decks (design)

> Sub-project 3 of the knowledge-graph + mastery-tracking feature. Builds on
> SP1 (concept extraction + graph storage) and SP2 (graph visualization), both
> merged to `main`. SP3 adds spaced-repetition scheduling to the existing
> flashcard decks. Next: SP4 (mastery model + chat inference + mastery-aware
> retrieval).

## Goal

Turn the existing flashcard decks from a passive flip-through into a real
**spaced-repetition** study system: each card carries FSRS-5 scheduling state,
a review queue surfaces due cards across one deck or all decks, and grading a
card (Again / Hard / Good / Easy) updates its schedule. Two review surfaces —
per-deck study and a global cross-deck queue — share one scheduling engine and
one grading endpoint.

## What exists today (the surface SP3 builds on)

- `decks` (`id, title, conversation_id, created_at`) and `cards`
  (`id, deck_id, front, back, ordinal, created_at`) — both in `lib/db/schema.ts`.
  Decks are **global** (no `project_id`); cards are LLM-authored in chat via the
  `` ```flashcard `` fence and saved through `POST /api/decks`.
- `lib/db/decks.ts`: `listDecks`, `listDecksWithCounts`, `getDeck`, `getCards`,
  `createDeck`, `renameDeck`, `deleteDeck`. **No scheduling state whatsoever** —
  no due/ease/interval/stability/difficulty/review-history columns or helpers.
- `/decks/[id]` is a pure flip-through page (`<FlashcardDeck reviewMode>`): flip
  front↔back, prev/next, shuffle. No grading, no persistence; reload resets to
  card 0. `/decks` is a browse/rename/delete list with card counts.
- Routes: `GET/POST /api/decks`, `GET/PATCH/DELETE /api/decks/[id]`. No
  `/api/review` or study endpoint exists.

## Locked decisions

- **Algorithm:** FSRS-5 (state machine `New/Learning/Review/Relearning`;
  per-card `stability` + `difficulty`; retrievability-based interval at
  desired retention `0.9`), using the **published FSRS-5 default 19-parameter
  `w` vector**. Exact formulas and the 19 constants are pinned in the
  implementation plan; correctness is locked by a golden-vector test
  (Testing). **No per-user parameter optimization in SP3** — the optimizer is a
  later enhancement that needs accumulated review history to be useful.
- **Review surface: both.** Per-deck study (`/decks/[id]`) and a global
  cross-deck queue (`/review`), sharing the scheduling engine, the grading
  endpoint, and the session component.
- **Grading scale:** 4-button FSRS standard — Again (1) / Hard (2) / Good (3) /
  Easy (4). "Again" lapses a Review card into Relearning.
- **New-card policy:** Anki-style **daily cap per deck**, default 20, configurable
  via a new `decks.daily_new_limit` column. Due reviews come first, then new
  cards up to `daily_new_limit − newIntroducedToday`. "New introduced today" is
  derived from `review_log` (distinct cards reviewed today whose pre-grade state
  was `New`) — no extra counter table.
- **`/decks/[id]` becomes a deck overview** (due/new/total counts, last-reviewed,
  "Start review" button) with a "Browse all" tab that reuses the existing
  `<FlashcardDeck reviewMode>` flip-through (no grades recorded).
- **Lazy scheduling rows:** a card with no `card_scheduling` row is `New`. The
  row is created on first review; existing pre-SP3 cards need no migration.
- **Monochrome encoding only** (Graph Paper Lab tokens — no new colors/fonts):
  grade buttons distinguished by token + weight, not hue (e.g. Again → `rule`
  accent; Hard/Good/Easy → `ink`/`ink-2`/`ink`). Accent tokens used sparingly.

## Architecture

A pure FSRS-5 module (math only, no DB) under two review surfaces that share one
grading endpoint and one session component. Per-card state lives in a new 1:1
table; every grade is appended to a review log (source of truth for "new seen
today," stats, SP4 mastery, and future optimization). All schema changes are
additive (`CREATE TABLE IF NOT EXISTS` + the existing `PRAGMA table_info` →
`ALTER TABLE` migration pattern in `lib/db/index.ts`).

### Data flow

1. **Per-deck study.** `/decks/[id]` overview loads `GET /api/decks/[id]` →
   deck, cards (for Browse-all), counts. "Start review" → `GET
   /api/decks/[id]/due` → session queue → `<StudySession>`. Each grade →
   `POST /api/review/grade { cardId, grade }` → server `repeat()` → upsert
   `card_scheduling` + append `review_log` → `{ state, nextDue, reps, lapses }`.
   Client advances, or re-queues "Again" (see Session requeue). Queue empty →
   end-of-session summary → back to overview (re-fetch counts).
2. **Cross-deck.** `/review` loads `GET /api/review/due` → per-deck breakdown +
   flat queue with deck badges. "Start review" → same `<StudySession>`, same
   `POST /api/review/grade`.

### Session requeue rule

When a card is graded "Again", it is re-appended to the **tail of the in-memory
session queue** (max **one** extra re-show per card per session, to avoid
loops) for immediate practice. The **persisted** `due` is always the
FSRS-computed value. The session feels like Anki (lapsed cards reappear); the
DB reflects real FSRS scheduling.

### Components / files

- `lib/fsrs/algorithm.ts` (new, pure) — `Rating`, `CardState`, `SchedCard`,
  `DEFAULT_W` (19), `DESIRED_RETENTION = 0.9`, `repeat(card | null, grade,
  now): { card: SchedCard, log }`. No DB, no React; deterministic and pure.
- `lib/db/schema.ts` (modified, additive) — `card_scheduling` + `review_log`
  tables (below); `CardScheduling`, `ReviewLog`, `CardState`, `Rating` types;
  `decks.daily_new_limit INTEGER NOT NULL DEFAULT 20` via the ALTER migration.
- `lib/db/reviews.ts` (new, re-exported from the `lib/db` barrel) —
  `getCardScheduling(cardId)`, `upsertCardScheduling(row)`,
  `appendReviewLog(entry)`, `dueCardsInDeck(deckId, now, cap)`,
  `dueCardsAllDecks(now)`, `deckDueCounts(deckId, now)`,
  `allDeckDueCounts(now)`, `newIntroducedToday(deckId, now)`.
- `lib/db/decks.ts` (modified) — `listDecksWithCounts` and the `getDeck`/
  cards response carry due + new counts (one extra LEFT JOIN onto
  `card_scheduling`).
- `app/api/decks/[id]/due/route.ts` (new) — `GET`: per-deck session queue.
- `app/api/review/due/route.ts` (new) — `GET`: cross-deck queue + per-deck
  counts.
- `app/api/review/grade/route.ts` (new) — `POST { cardId, grade }` → FSRS
  `repeat` → upsert + log → `{ state, nextDue, reps, lapses }`.
- `app/api/decks/route.ts` + `app/api/decks/[id]/route.ts` (modified) —
  responses include due/new counts (no new route for badges/overview).
- `app/decks/[id]/page.tsx` (rewritten) — overview + "Start review" + "Browse
  all" tab (`<FlashcardDeck reviewMode>` unchanged).
- `app/review/page.tsx` (new) — global queue page.
- `components/study/StudySession.tsx` (new, shared) — props
  `{ queue: CardDue[]; deckLabel?: string; onComplete }`. Flip card, 4 grade
  buttons, progress `n / total`, end-of-session summary.

### Schema (additive)

```sql
CREATE TABLE IF NOT EXISTS card_scheduling (
  card_id     TEXT PRIMARY KEY,
  due         INTEGER NOT NULL,            -- ms timestamp, next due
  stability   REAL    NOT NULL DEFAULT 0,
  difficulty  REAL    NOT NULL DEFAULT 0,
  reps        INTEGER NOT NULL DEFAULT 0,
  lapses      INTEGER NOT NULL DEFAULT 0,
  state       INTEGER NOT NULL DEFAULT 0,  -- 0 New · 1 Learning · 2 Review · 3 Relearning
  last_review INTEGER,                     -- ms, nullable = never reviewed
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_card_sched_due ON card_scheduling(due);

CREATE TABLE IF NOT EXISTS review_log (
  id          TEXT PRIMARY KEY,
  card_id     TEXT NOT NULL,
  deck_id     TEXT NOT NULL,               -- denormalized for cross-deck queries
  grade       INTEGER NOT NULL,            -- 1 Again · 2 Hard · 3 Good · 4 Easy
  state       INTEGER NOT NULL,            -- card state BEFORE this review
  stability   REAL    NOT NULL,            -- … BEFORE
  difficulty  REAL    NOT NULL,            -- … BEFORE
  reviewed_at INTEGER NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_review_log_card ON review_log(card_id);
CREATE INDEX IF NOT EXISTS idx_review_log_deck_time ON review_log(deck_id, reviewed_at);
```

`decks` gains `daily_new_limit INTEGER NOT NULL DEFAULT 20` via the existing
`ALTER TABLE` migration. No existing table or column is removed or renamed.

### Queue selection semantics

- **Due cards** = cards with a `card_scheduling` row where `due <= now` and
  `state ∈ {Learning, Review, Relearning}`, ordered by `due` asc.
- **New cards** = cards with no `card_scheduling` row, ordered by `ordinal`,
  capped at `daily_new_limit − newIntroducedToday` (per deck, in both surfaces).
- **Per-deck queue** = due ∪ (capped new) for that deck; due first.
- **Cross-deck queue** = due ∪ (capped new) across all decks, ordered by `due`
  asc then `ordinal`; each deck's new cards capped by its own `daily_new_limit`.

### Endpoint shapes

`CardDue = { id, front, back, deckId, deckTitle, state, due }`.

- `GET /api/decks/[id]/due` → `{ cards: CardDue[], dailyCap, newIntroducedToday }`.
- `GET /api/review/due` → `{ cards: CardDue[], decks: [{ deckId, title, due, new }] }`.
- `POST /api/review/grade` → req `{ cardId, grade }`, res
  `{ state, nextDue, reps, lapses }`.
- `GET /api/decks` and `GET /api/decks/[id]` extended with per-deck
  `{ due, new, dailyCap, newIntroducedToday, lastReviewed }` (overview/badges).

### Route handling

Per `AGENTS.md`, read the route-handler + dynamic-routes guides under
`node_modules/next/dist/docs/` before writing the new routes; mirror
`app/api/decks/[id]/route.ts` (`{ params }: { params: Promise<{ id: string }> }`,
`NextResponse.json`).

## Error handling

- **Empty queue** (nothing due, no new under cap) → Graph Paper empty state:
  *"nothing due — come back later"*, not a blank canvas.
- **Grade POST failure** → stay on the current card, show a small `text-rule`
  error line, allow retry; do not advance or lose the grade. The scheduling row
  is written only on a successful response.
- **FSRS numeric safety** — `repeat()` clamps `stability ≥ 0.1`, `difficulty`
  to `[1, 10]`, guards against `NaN`/`Infinity`; `due` is always a finite
  integer ms timestamp. A unit test asserts no non-finite values across a long
  random-grade sequence.
- **Deck with no cards** → overview empty state; "Start review" disabled.
- **Never-reviewed pre-SP3 card** → treated as `New` (no row); first review
  creates the row. No data migration.
- **Concurrent double-grade of one card** — single-user local app; last write
  wins. Acceptable (same call SP1/SP2 made).

## Visual encoding (monochrome, Graph Paper tokens)

Tokens: `--paper/-2/-3`, `--ink/-2/-3`, `--rule`, `--feynman`, `--line`,
`--grid`. `rounded-[3px]`, `.mono`, `tracking-wide tabular-nums`. No new colors
or fonts.

- **Grade buttons:** four equal-width buttons under the flipped card. Again →
  `border-rule text-rule` (the red accent, used sparingly for the "negative"
  action); Hard → `border-ink-3 text-ink-3`; Good → `border-ink text-ink`;
  Easy → `border-ink-2 text-ink-2`. All `rounded-[3px] border bg-paper mono`.
- **Overview/queue counts:** `mono text-[11px]` chips; due count in `text-ink`,
  new count in `text-ink-3`, with a `h-1.5 w-1.5 rounded-full bg-rule` dot when
  anything is due (mirrors the `/projects` header chip convention).
- **Cross-deck card badge:** small `mono text-[10px] text-ink-3` deck title
  above the card front.
- **Progress + summary:** `mono tabular-nums text-[12px] text-ink-3` (`n /
  total`); end summary lists reviewed + again-count in `text-ink` / `text-rule`.

## Testing / verification

One scoped deviation from the SP1/SP2 smoke-only bar, because FSRS is pure math
where a golden-vector test pays for itself:

- Add `tsx` as a devDependency; one golden-vector test using Node's built-in
  `node:test` + `assert` (no vitest/jest). Run via `npm run test:fsrs`
  (`tsx --test lib/fsrs/**/*.test.ts`).
- **Golden vector:** a fixed grade sequence applied to a fresh card; assert
  `{ state, stability, difficulty, interval }` at each step matches values
  computed from the pinned constants, where `interval = due − now` (ms). Also assert no `NaN`/`Infinity` across a
  1000-step random-grade sequence. This locks the algorithm + constants.
- **Bar otherwise unchanged:** `npx tsc --noEmit && npm run lint && npm run
  build` clean (pre-existing `<img>` + `lib/db` warnings expected).
- **Manual smoke:** build a deck; run a per-deck session; run the cross-deck
  queue; verify a lapsed ("Again") Review card requeues and re-shows; verify the
  daily cap holds across two sessions in the same day; verify a never-reviewed
  existing deck starts all cards as `New`; dark mode readable, no new colors.

## Dependencies

- `tsx` (devDependency) — for running the FSRS golden-vector test. No runtime
  dependency added; FSRS is self-contained math (no `ts-fsrs` import — the
  algorithm is implemented in-repo so the constants and formulas are pinned and
  testable).

## Out of scope (SP3)

- Per-user FSRS parameter optimization (later enhancement; needs history).
- Burying / suspending cards; custom learning steps; canned crammers.
- Card creation or editing outside the existing chat → `/api/decks` flow.
- Linking cards to concepts (SP4) — `review_log` is the bridge SP4 will use.
- Mastery coloring / mastery-aware retrieval (SP4).

## Notes for SP4

- `review_log` (per-card grade history) is the foundation SP4's mastery model
  will read; SP4 keys mastery off `concepts.id`, so a card↔concept link is an
  SP4 concern (decks are not tied to concepts today).
- The `lib/fsrs/algorithm.ts` pure module + golden test make a future
  `w`-parameter optimizer a drop-in: fit `w` from `review_log`, persist a
  per-user `w` vector, pass it into `repeat` instead of `DEFAULT_W`.
- The shared `<StudySession>` + `POST /api/review/grade` are the seam SP4 mastery
  coloring overlays (grade buttons stay; card fill gains a mastery token).