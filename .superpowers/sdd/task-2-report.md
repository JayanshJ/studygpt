# Task 2 Report: card_concepts schema + mastery DB helpers (SP4)

## What I implemented

All 8 steps from the brief, verbatim (no adaptations needed):

1. **`lib/db/schema.ts`** — Appended `card_concepts` DDL + 2 indexes (`idx_card_concepts_card`, `idx_card_concepts_concept`) to `SCHEMA_SQL` with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`. Added `import type { Band } from "@/lib/mastery/model"` at the top. Added the `CardConcept` interface after `ConceptSource`. Added optional `concepts?: { label: string; band: Band }[]` to `SourceEntry` (additive — existing fields untouched).
2. **`lib/db/reviews.ts`** — Added `import type { Band } from "@/lib/mastery/model"` and optional `mastery?: number | null` / `band?: Band` to `CardDue`. SQL queries untouched.
3. **`lib/db/index.ts`** — Added `export * from "./mastery";` after `export * from "./concepts";` and inserted `CardConcept,` into the `export type { ... } from "./schema";` line.
4. **`lib/db/mastery.ts`** — Created with the brief's code verbatim: `ConceptMastery` interface, `upsertCardConcept`, `linkedConceptsForCard`, `conceptMasteryForProject` (single SQL pass joining `card_concepts` → `concepts` → `card_scheduling`, then JS aggregation — no N+1), `conceptMastery`, `cardMastery` (returns `{ mastery: null, band: "untested" }` for new cards, never `"unknown"`), `chunksToConcepts` (keyed by `${materialId}:${ordinal}`).

The circular-barrel pattern (`import { db } from "@/lib/db/index"` while `index.ts` re-exports `./mastery`) is the same as `reviews.ts`/`concepts.ts`; `db` is only accessed inside function bodies, so no TDZ/runtime cycle. `Band` is imported type-only from `@/lib/mastery/model`, which itself only imports from `@/lib/fsrs/algorithm` — no runtime cycle into `lib/db`.

## Verification

- `npx tsc --noEmit` → clean (no output).
- `npm run lint` → 0 errors, 3 warnings (all pre-existing `<img>` warnings in `components/ChatInput.tsx` / `components/ChatMessage.tsx`; no `lib/db` warnings).
- Step 7 table-creation check:
  ```
  $ node --import tsx -e "import { db } from '@/lib/db/index'; console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='card_concepts'\").get());"
  { name: 'card_concepts' }
  ```

## Files changed

- `lib/db/schema.ts` (modified)
- `lib/db/reviews.ts` (modified)
- `lib/db/index.ts` (modified)
- `lib/db/mastery.ts` (created)

## Self-review findings

- Additive-only: confirmed. No existing field removed/renamed; `SourceEntry` and `CardDue` only gained optional fields. The `card_concepts` DDL uses `IF NOT EXISTS` and runs idempotently on next `db` open via `SCHEMA_SQL` — no `ALTER TABLE`.
- No N+1 in `conceptMasteryForProject`: single SQL query, JS aggregation over the returned rows.
- `cardMastery` never returns `"unknown"`: returns `{ mastery: null, band: "untested" }` when no scheduling row, otherwise a numeric `mastery` with `masteryBand(mastery, 1, 1)` (linked=1, reviewed=1 → falls through to the strong/learning/slipping branches).
- `chunksToConcepts` key format: `${r.materialId}:${r.ordinal}` — matches the chat retriever's chunk key.
- The `cardMastery` return type includes `| null` per the brief's signature, but the body never returns `null` (it always returns an object). This is the brief's exact code, kept verbatim; the `| null` is a dead branch in the union but harmless.
- `conceptMasteryForProject` notes in its comment that concepts with no `card_concepts` rows are absent (caller treats absent as `unknown` band) — consistent with `masteryBand`'s `linked === 0 → unknown` rule.
- AGENTS.md block left intact (it lives in CLAUDE.md/AGENTS.md, not in any source file I touched).

## Concerns

None. Implementation matches the brief exactly; all checks green.

## Commit hash
9dda5d0 — feat(db): card_concepts bridge + mastery DB helpers (SP4)
## Fix: cardMastery never-unknown

Spec invariant: `cardMastery` must NEVER return `band: "unknown"` (that band is
reserved for concept-level "no linked cards"). The original code set
`mastery = null` when `cardRetrievability` returned a non-finite R, which made
`masteryBand(null, 1, 1)` return `"unknown"` (reviewed>0, mastery==null).

One-line change in `lib/db/mastery.ts` (`cardMastery`):

```diff
-  const mastery = Number.isFinite(R) ? Math.min(1, Math.max(0, R)) : null;
+  const mastery = Number.isFinite(R) ? Math.min(1, Math.max(0, R)) : 0;
```

With `mastery = 0`, `masteryBand(0, 1, 1)` → `0 < 0.5` → `"slipping"` (the
FSRS-honest band for uncomputable retrievability; never `"unknown"`). Only this
single line was modified — no other functions, types, or files touched.

### Verification

- `npx tsc --noEmit`: clean (no errors).
- `npm run lint`: 0 errors, 3 pre-existing `<img>` warnings (allowed). No
  `lib/db` warnings introduced.

For valid graded cards R is always finite (stability ≥ 0.01, last_review set),
so this only affects corrupt/defensive paths; the fix makes the defensive path
correct.
