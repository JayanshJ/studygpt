# Learning Path & Coverage Map for the Concept Graph

**Date:** 2026-08-11
**Status:** Approved (design)
**Scope:** `/graph` page — turn the concept graph from a passive visualization into an active learning-path / coverage map.

## Problem

The concept graph reflects mastery (node colors, cluster mastery bars) but is passive: there is no loop from *what you see on the graph* → *a study decision* → *the graph changing*. It is "just a graph." The user asked for the graph to be **useful**, and chose the **learning-path / coverage-map** job: *where am I in the subject, what's unlocked, what should I learn next.*

## Direction (decided in brainstorming)

- **Primary job:** learning path / coverage map (not study-cockpit, not comprehension/explanation).
- **Path shape:** per-concept **status + frontier** over the `prerequisite_of` DAG. Not a cluster-level path, not a flattened linear list — the prereq edges form a DAG, so "path" is really *status + what's unlocked*.
- **Unlock rule:** **strict, transitive** — every transitive `prerequisite_of` ancestor must be `strong` (mastered) for a concept to unlock.
- **Build approach:** living-graph overlay on the existing `/graph` (status on nodes, emphasized backbone edges), a "Next up" frontier panel, and a coverage header — one cohesive screen, no new route.

## Ingredients already present

- Per-concept mastery **band**: `"strong" | "learning" | "slipping" | "untested" | "unknown"` (`lib/mastery/model.ts`), already returned per concept by `GET /api/concepts`.
- Relation vocabulary purpose-built for ordering (`lib/concepts/schema.ts`):
  - `prerequisite_of` — source is needed to understand target (**the DAG / path backbone**).
  - `part_of` — source is a component/aspect of target (containment).
  - `generalizes` — source is the broader/general case of target (abstraction).
  - `example_of`, `contrasts_with`, `applies_to` — peer/cross-links.
- `HIERARCHICAL = { prerequisite_of, part_of, generalizes }` (`lib/graph/relations.ts`) — already the layout backbone.
- `GET /api/concepts` already returns per-concept `band` + `mastery`, and edges with `relation`. **Everything needed is already on the client.**

## Section 1 — Status model

Every concept gets one **status**, derived from its band + the `prerequisite_of` DAG. Pure function, client-side, no React/DB.

```
status(concept C):
  if C.band == "strong"                   → MASTERED
  if C.band in {"learning","slipping"}     → IN_PROGRESS   // active study overrides "ready"
  // else band is "untested" or "unknown":
  if all transitive prerequisite_of ancestors of C are MASTERED → READY
  else                                    → LOCKED
```

- **Statuses:** `LOCKED | READY | IN_PROGRESS | MASTERED`.
- **prerequisite_of direction:** edge `source → target` means *source is needed for target*. C's prerequisites = sources of `prerequisite_of` edges pointing into C. Ancestors = transitive closure following edges backwards from C.
- **Gating is transitive & strict:** the entire ancestor chain must be `strong`/`mastered` for C to be `READY`.
- **Entry points:** a concept with no incoming `prerequisite_of` edges and no mastery is `READY`.
- **`IN_PROGRESS` overrides `READY`:** a `learning`/`slipping` concept is in-progress even if its prereqs are mastered (it's actively being studied).
- **Cycles:** if the LLM emitted a circular `prerequisite_of` chain (shouldn't, but cheap to survive), cycle members' ancestor sets include themselves → they can only be `READY` once all are `mastered`, so an unmastered cycle stays `LOCKED` and unlocks together. Closure uses a visited set — no infinite loop.
- **`part_of` / `generalizes` do NOT gate** for v1 — containment/abstraction, not "needed-before." They remain layout/visual hierarchy only. Revisit if it turns out `part_of` should gate.

## Section 2 — Coverage metrics & frontier

Also pure, in the same module.

**Coverage (global + per-cluster):**
- `coverage = mastered / total`.
- Counts per scope: `ready`, `in_progress`, `locked`, `mastered`.
- **Cluster flags:**
  - **complete** — 0 `ready`/`locked`/`in_progress` (all mastered).
  - **blocked** — has `locked` concepts and 0 `ready` (entry points not unlocked).

**Frontier (the "Next up" list):**
- = all `READY` concepts, **grouped by cluster**.
- **Ranking within a cluster:** out-degree in `prerequisite_of` descending (concepts that are the prerequisite of the most others = most foundational → learn first), tiebreak by total degree, then label.
- **Top ready concept per cluster** = that cluster's "start here" entrypoint on the overview.
- Rationale: out-degree is a cheap, good proxy for "learn this first." A true "unlocks-the-most" simulation is a possible later enhancement, not v1.

**Selection semantics:** clicking a frontier item selects the concept (existing DetailPanel) and, on the overview, drills into that concept's cluster so you land on it in the canvas.

## Section 3 — Overview as the coverage map

A **learning-path mode toggle** in the existing controls row, **default ON** ("useful by default"). Normal mode (toggle off) = exactly today's overview.

**Coverage header** (full width, above the controls):
`47% mastered · 12 ready · 8 in progress · 23 locked` + a slim coverage bar. The "where am I in the subject" answer at a glance.

**ClusterOverview cards in path mode:**
- Stacked bar switches from mastery-band to a **status bar** (mastered / in-progress / ready / locked segments). Normal mode keeps the mastery-band bar.
- Footer: `NN% · M ready`.
- **"start here: <top ready concept>"** entrypoint — clickable → drills into that cluster AND selects that concept.
- **complete** cluster → checkmark badge. **blocked** cluster → muted "locked" tag.

**Right column:** unchanged DetailPanel (shows on selection; empty-state prompt otherwise). There is **no single global frontier list** anywhere — the overview surfaces per-cluster "start here" entrypoints (above), and the drill-down (Section 4) shows the frontier for the open cluster. This avoids duplicating one list in two places.

## Section 4 — Drill-down canvas overlay + "Next up" panel

Same mode toggle keeps overview + drill-down in sync.

**Canvas — status on nodes** (new Cytoscape classes layered on existing band styling):
- `locked`: muted (lower opacity) + thin dashed ring.
- `ready`: accent glow ring (`--accent` / `--rule` token) — the eye-grabbing "this is next."
- `in_progress`: keeps existing slipping/learning band color.
- `mastered`: solid fill + small check glyph.
- `prerequisite_of` edges: stronger stroke in path mode (the backbone). Peer edges fade further so the DAG reads through.

**"Next up" panel** — **stacked** above the DetailPanel in the right column (decision: stack, not tabs — you want "what's next" *and* the selected concept's detail together). Shows the frontier for *this cluster*: ready concepts ranked per Section 2, each row = label + "· N depend on this", clickable (selects concept + centers it in canvas). Empty states: "cluster complete ✓" / "blocked — prerequisites in another cluster".

Normal mode (toggle off) = today's drill-down (no status classes, no Next-up panel, standard edge styling).

## Section 5 — Data flow: where it lives

**No backend changes.** `/api/concepts` already returns per-concept `band` + `mastery` and edges with `relation`. Status, coverage, and frontier are computed **client-side** in `lib/graph/learning-path.ts` (pure), invoked from `GraphPage` over the already-fetched `data`.

- The mode toggle is local UI state (like `showSemSim`), reset on project switch in `loadData`.
- No new endpoints, no DB/schema migration, no extra fetches or polling.
- The path/coverage reflows on the next `/api/concepts` fetch (which already happens on project load) — so after reviewing, status updates on next graph load. No stale-gating bug: gating is recomputed from fresh `band` each load.

## Section 6 — Edge cases & testing

**Edge cases (handled, documented):**
- **No `prerequisite_of` edges** (material with only peer relations) → every unmastered concept is `READY`; frontier = everything not mastered. Useful degenerate case, not a crash.
- **Cycles** → unmastered cycle members stay `LOCKED`, unlock together (visited set, no infinite loop).
- **Isolated concepts** (no edges, isolated cluster) → `READY` unless mastered; frontier includes them.
- **Cross-cluster prereqs** (C in cluster A needs P in cluster B) → C is `LOCKED` until P mastered; C's cluster shows "blocked"; drill-down empty-state says "blocked — prerequisites in another cluster". Tracing *which* cluster is a possible later enhancement, not v1.
- **Mastery flips on review** → status recomputed on next `/api/concepts` fetch. No stale gating.
- **`unknown` vs `untested`** → both treated as "not yet assessed" → subject to prereq gating (READY/LOCKED), same path.

**Testing (TDD on the pure module):**
- `lib/graph/learning-path.test.ts`: status across DAG shapes (chain, diamond, no-prereq entry points, cycle, isolated), coverage % + counts (global + per-cluster), frontier grouping + ranking (out-degree tiebreaks), `complete`/`blocked` cluster flags.
- UI: `tsc --noEmit` + `eslint`, then manual verify on the real 87-concept project (status colors, frontier correctness, mode-toggle sync, project-switch reset).

## Out of scope (v1)

- True "unlocks-the-most" frontier simulation (v1 uses out-degree proxy).
- Cross-cluster dependency tracing (v1 surfaces "blocked — elsewhere").
- Gating on `part_of` / `generalizes` (v1: `prerequisite_of` only).
- A separate `/path` route (v1: overlay on `/graph`).
- Study-cockpit actions (drill/review-this-cluster) and comprehension/explanation (AI edge explanations, cluster summaries) — different jobs, deliberately not chosen.