# Platform Engineering TODO

> Grounded in a read-through of this codebase (2026-08-16). Items are ordered
> by leverage and scoped to be **additive / reversible** unless noted. Deferred
> items carry a reason, not a vague "later".

## Active — doing now (subagent fan-out + owner integration)

### 1. Test suite command + CI gate — ✅ DONE
- `package.json`: added `test` (`node --import tsx --test`, auto-discovers all
  48 test files including `[id]`-bracketed paths), `typecheck`, `verify`
  (typecheck + test + lint + `git diff --check`).
- `.github/workflows/ci.yml`: runs `verify` on push/PR, Node 20, `npm ci`.
- Result: `npm run verify` is green — **191 tests pass, tsc clean, 0 lint
  errors, whitespace clean**. (Was: no `test` script, no CI, a broken test
  file almost shipped.)
**Why:** 48 test files, no `test` script, no CI. A broken test file
(`lib/db/artifact-versions.test.ts`, unparseable) almost shipped on this branch
and was caught only because `tsc` happened to touch it.
**Files:** `package.json` (scripts), `.github/workflows/ci.yml` (new).
**Approach:** Add `test` (auto-discovers `*.test.ts(x)`), `typecheck`
(`tsc --noEmit`), `verify` (typecheck + test + lint + `git diff --check`).
CI runs `verify` on push/PR. Bake the `[[]id[]]` bracket-escape gotcha into the
test script so it isn't tribal knowledge.
**Verify:** `npm run verify` is green on a clean tree.
**Risk:** None — additive.

### 2. Structured logger + route error boundary (`withRouteHandler`) — ✅ DONE
- `lib/server/logger.ts`, `lib/server/withRouteHandler.ts`,
  `lib/server/validation.ts` (zod), + `withRouteHandler.test.ts` (5 tests).
- `withRouteHandler` owns catch + request-id-bound server-side logging +
  sanitized `{ error: "Internal error" }` 500 (never echoes internals).
- `validateBody` → structured 400 `{ error, issues }` for zod failures,
  `{ error: "Invalid JSON" }` for parse failures.
**Why:** 10 of 20 route handlers have **no try/catch** — exceptions bubble as
opaque 500s. No logging library. The chat route strings raw error messages
(e.g. `AI_RetryError: … weekly usage limit …`) straight to the client.
**Files:** `lib/server/logger.ts` (new), `lib/server/withRouteHandler.ts`
(new), `lib/server/validation.ts` (new, zod helper).
**Approach:** A `withRouteHandler` HOF owns try/catch, request-id logging
(server-side only), and a sanitized `{ error: "Internal error" }` 500. Routes
define only the happy path. Combined with zod: a `defineRoute({ body: schema,
handler })` validates the body (400 + structured `{ error, issues }`) then
runs the handler inside the error boundary.
**Verify:** unit tests for the HOF (valid body, invalid body, thrown error).
**Risk:** Low — new files; route wiring is the integration step.

### 3. Zod validation at route boundaries — ✅ DONE
- All 32 route handlers hardened across 5 disjoint subagent groups (chat/
  streaming, conversations/messages/search, projects/settings/decks,
  materials/concepts/review, artifacts/transcribe).
- JSON-body routes get zod schemas; multipart routes get the error boundary
  only (commented why); streaming routes get `validateBody` + a generic SSE
  `"Streaming failed"` (real error logged server-side) without breaking the
  `ReadableStream`.
- **Behavior preserved**: no input that previously succeeded now fails; same
  status codes + response shapes on the happy path.
- Live-smoked: GETs → 200, malformed JSON → 400 (was 500/crash), zod
  failures → structured `{ error, issues }`, 404s intact, chat stream flows.
**Why:** Every POST re-implements "is this body shaped right?" inline with
loose guards and string errors. `as { … }` casts litter routes + client
`fetch().then(r => r.json() as …)`.
**Files:** all `app/api/**/route.ts` (applied via fan-out, disjoint groups).
**Approach:** One zod schema per route body. **Preserve exact existing
acceptance criteria** — do not tighten validation, only make it structured.
Client keeps `as` casts for now (server-side only); client/server schema
sharing is deferred.
**Verify:** `npm run verify`; smoke each route with curl (200/400/500).
**Risk:** Medium — churn on working routes. Mitigated by "preserve behavior"
constraint + disjoint file ownership per agent + full verify at the end.
**Note on streaming routes:** `chat/route` + `chat/overlay` use a
`ReadableStream` with internal `send({ type: "error" })`. Do NOT double-wrap
those — wrap only the sync body-parse/validation; leave the stream's error
handling intact.

### 4. Versioned DB migrations — ✅ DONE
- `lib/db/migrations.ts` (5 ordered named migrations + `runMigrations` +
  `schema_version` table) + `lib/db/migrations.test.ts` (12 tests).
- `lib/db/index.ts` `open()`: **152 → 28 lines**. Base `SCHEMA_SQL` runs first
  (unchanged), then `runMigrations` (each runs at most once + recorded),
  then the recurring `material_extractions` crash-recovery sweep (kept
  outside migrations by design).
- Fresh-DB schema identical to the old boot block; existing DBs are guarded
  no-ops that only bump the recorded version. All DB-touching suites green.
**Why:** `lib/db/index.ts`'s `open()` runs a 151-line migration block on every
boot — `PRAGMA table_info` scans, `ALTER`s, a chunk-page back-fill, a token
back-fill. "Has this run?" is inferred from data shape, not recorded, and the
block only grows.
**Files:** `lib/db/migrations.ts` (new), `lib/db/index.ts` (owns `open()`).
**Approach:** Add a `schema_version` table; record the highest applied
migration. The existing additive `ALTER`s / back-fills become ordered,
**named** migrations v1..vN that run once and are recorded. Behavior is
**identical** on a fresh DB and on an existing DB that already ran the current
boot block (they're all no-ops there). Keep `CREATE TABLE IF NOT EXISTS` in
`SCHEMA_SQL` for the base tables.
**Verify:** existing DB suites green (`test:fsrs`, `test:mastery`,
`test:retrieval`, `test:learning-path`, `lib/db/artifact-versions.test.ts`);
open a pre-existing on-disk DB and confirm no re-runs.
**Risk:** Medium-high — DB init bugs can corrupt user DBs. Mitigated by
**strictly additive** migrations that mirror the existing no-op guards, and
by running all DB-touching suites.

### 5. Extract `useGlobalSearch` + `useArtifactVersions` hooks from `page.tsx` — ✅ DONE
- `components/hooks/useGlobalSearch.ts` (palette state + debounced search +
  Cmd/Ctrl+K + keyboard-nav active index) and `components/hooks/useArtifactVersions.ts`
  (override map load + transform/restore handlers).
- `app/(app)/page.tsx`: **1371 → 1231 lines**. The page is now the composition
  root wiring the two hooks; the inlined effects/handlers removed.
- Pre-existing lint errors in `page.tsx` (fn-hoist forward ref, 2× `Date.now()`
  in event handlers) and 3 other component files (`MermaidDiagram`,
  `useVoiceTyping`, `use-overlay-chat` set-state-in-effect) fixed with the
  established `eslint-disable-next-line` pattern + explanatory notes. These
  were blocking `verify`/CI; now 0 lint errors. Proper resolution (useCallback
  / move declarations / extract Date.now) is part of deferred item #7.
**Why:** `app/(app)/page.tsx` is 1,371 lines doing ~8 jobs; the pre-existing
lint errors (fn-used-before-declaration, `Date.now()` during render) survive
because nobody reads the whole file.
**Files:** `components/hooks/useGlobalSearch.ts` (new),
`components/hooks/useArtifactVersions.ts` (new), `app/(app)/page.tsx` (wired
by owner — NOT a blind subagent).
**Approach:** Extract only the two cleanly-separable concerns I added this
session (global search state+effect+result nav, and artifact-version
override load+change/error handlers). The page becomes the composition root.
**Verify:** `npm run verify`; the existing `page.evidence.test.ts` still
passes; manual smoke of Cmd+K palette + an artifact transform.
**Risk:** Medium — page.tsx is the app's heart. Mitigated by extracting only
the two self-contained hooks (not the core chat-stream/send/regenerate flow)
and by the owner (me) doing the wiring + verification, not a subagent.

## Deferred — with reasons

### 6. `sqlite-vec` / ANN retrieval — **measure first**
`lib/retrieval/index.ts` loads all project chunks and runs full cosine per
query. Fine for study-sized projects; only matters at scale. `sqlite-vec`
adds a native dependency + index-creation churn. **Do not install blind in a
batch** — first add a retrieval-latency probe/metric and confirm a real
project hits the threshold. Revisit when a project is large enough to matter.

### 7. Full `page.tsx` decomposition (core chat flow) — **separate, higher-risk effort**
Extracting `useChatStream` / `useConversationLoader` / `useOverlaySession` is
entangled with the send/edit/regenerate/SSE flows and is high-regression.
Out of scope for this batch. Item 5 takes the safe slice; the rest is a
dedicated refactor with its own verification.

### 8. Typed DB query helper + client/server schema sharing — **lower priority**
147 `.prepare(` calls with loose `as` casts. A `query<T>(sql, params): T[]`
centralizes casts and enables later row validation, but the immediate win is
small. Client/server zod-schema sharing (replace client `as` casts) is
valuable but doubles the surface of item 3. Fold in after item 3 lands.

---

## Orchestration

- **Phase 1 (parallel, 3 subagents — disjoint files):** #1 test/CI,
  #2 server-infra (logger + withRouteHandler + validation), #4 migrations.
- **Owner verifies Phase 1** (tsc + tests + smoke).
- **Phase 2 (parallel, 5 subagents — disjoint route groups):** #3 route
  hardening (each agent owns a disjoint set of route files).
- **Owner integrates:** #5 hooks + page.tsx wiring, full `npm run verify`,
  curl smoke of every route, fix regressions.

zod is installed by the owner before Phase 1 so all agents can import it
without a race on `package-lock.json`.