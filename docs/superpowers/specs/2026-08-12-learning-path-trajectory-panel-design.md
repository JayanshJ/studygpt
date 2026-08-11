# Learning-path Trajectory Panel + "Ask in chat" Handoff

**Date:** 2026-08-12
**Status:** Approved (design)
**Scope:** `/graph` page — add a right-column **learning-path trajectory** panel: a linear "first do this, then that" list of the concepts you still need to learn, colored by status, with a per-row action that jumps into the project's chat with a prefilled study prompt.

## Problem

The learning-path overlay shipped in the prior feature (status rings on nodes, emphasized `prerequisite_of` backbone edges, per-cluster "Next up" frontier) is useful but has two weaknesses the user hit in practice:

1. **"We have to find where to start."** The graph scatters "start here" entrypoints across cluster cards and a per-cluster Next-up panel. There is no single, scannable, linear answer to "what do I do first, then next?"
2. **"The arrows are sometimes confusing."** A `prerequisite_of` DAG read as edges is hard to follow as a sequence. The user wants a clean linear trajectory, not a graph.

The user also wants each step to **jump into the project's chat** to ask about that concept, scoped to the project so the chat explains from the project's own materials.

## Direction (decided in brainstorming)

- **Trajectory content:** only the **remaining (not-mastered) concepts**, in a single global **topological** learning order. Done concepts collapse to a `✓ N done` header. (User choice: "only remaining concepts.")
- **Colors:** done = green (collapsed header), in progress = yellow, not done (ready + locked) = red. A **"you are here" marker** on the actionable focus (first `in_progress`, else first `ready`) answers "where to start." Position in the linear list carries the order; color carries status.
- **Right-column layout:** the trajectory **replaces the per-cluster NextUpPanel** (same job, but global + linear + with the chat handoff). Right column = scrollable trajectory on top, `DetailPanel` below, persistent across overview and drill-down. (User choice: "Trajectory + DetailPanel.")
- **Ask in chat:** each row has an ask button → opens the project's chat with the composer **prefilled** (review + Enter) with a richer study prompt that names the step and asks the chat to explain from the materials then quiz. Project-scoped so RAG uses that project's materials. (User choice: "Prefill richer study prompt.")

No backend changes. Everything is client-side, reusing the already-shipped `computeStatuses` + `/api/concepts` data. The chat handoff reuses the chat page's existing project-scoped conversation + composer-prefill mechanisms.

## Ingredients already present

- `computeStatuses` / `computeCoverage` / `computeClusterStatuses` + types in `lib/graph/learning-path.ts` (prior feature). Per-concept `ConceptStatus = locked | ready | in_progress | mastered`, derived from band + the `prerequisite_of` DAG with strict transitive gating.
- `HIERARCHICAL`, `filterEdges`, edge/`relation` vocabulary in `lib/graph/relations.ts`.
- `GET /api/concepts` returns per-concept `band` + `mastery` and edges with `relation`.
- The chat page `app/(app)/page.tsx` already:
  - Creates project-scoped conversations: `POST /api/conversations { projectId }` → a `Conversation` with `project_id`.
  - Loads a conversation's project materials into `activeProjectMaterials` (used for RAG / SourcesPanel) via the effect keyed on `conversation.project_id`.
  - Prefills the composer via the `pendingPrompt` / `ChatInput.initialText` mechanism (see `welcomeChip`).
  - Restores the active conversation from `?c=<id>` on mount (ref-guarded).
- The graph page already has `projectId`, `data`, `clusters`, `c2cluster`, `clusterById`, `labelById`, `statuses`, and a `loadData` reset pattern.

## Section 1 — Trajectory content & ordering

A new **pure** function in `lib/graph/learning-path.ts` (no React/DB/DOM):

```ts
export interface TrajectoryItem {
  conceptId: string;
  label: string;
  status: ConceptStatus;
  step: number;        // 1-based overall position (done + remaining) — used in the chat prompt
  clusterName: string | null;
  isYouAreHere: boolean;
}

export interface Trajectory {
  doneCount: number;     // mastered concepts (collapsed into the "✓ N done" header)
  items: TrajectoryItem[]; // remaining concepts, in learning order
}

export function computeTrajectory(
  concepts: { id: string }[],
  edges: { source: string; target: string; relation: string }[],
  statuses: Map<string, ConceptStatus>,
  labelById: Map<string, string>,
  clusterNameById: Map<string, string>, // conceptId -> cluster name (page builds from c2cluster + clusterById)
): Trajectory;
```

**Ordering algorithm** (Kahn's topological sort over the not-done subgraph):
- Restrict to not-mastered concepts (`ready` + `in_progress` + `locked`). Mastered concepts are excluded from the list (counted into `doneCount`).
- Build prerequisite adjacency among not-done concepts: for a not-done concept `C`, its not-done prerequisites = `prerequisite_of` sources that are themselves not-done. (`part_of` / `generalizes` do NOT order the trajectory — same gating/structure rule as the prior feature.) Self-loops ignored.
- `in-degree(C)` = number of not-done prerequisites of `C`. The available set = not-done concepts with `in-degree === 0` (all their prerequisites are mastered, so they're learnable now — these are the `ready`/`in_progress` ones at the front).
- Repeatedly emit the "best" available concept and decrement `in-degree` of its not-done dependents, adding any that reach 0. **"Best" tiebreak (which to learn next when several are available):**
  1. `prerequisite_of` out-degree **desc** (most foundational — most other concepts depend on it → learn first; this is the existing frontier heuristic, computed graph-wide),
  2. total degree **desc**,
  3. label **asc** (`localeCompare`).
- **Cycle fallback:** if a `prerequisite_of` cycle exists among not-done concepts (LLLM error case), its members never reach `in-degree 0`. After Kahn exhausts, append any unemitted not-done concepts sorted by label asc, so the trajectory stays complete (they render as `locked`/red). No infinite loop (Kahn terminates; the remainder is a deterministic append).
- **`step`:** for the remaining item at 0-based index `i`, `step = doneCount + i + 1` — the 1-based overall position in the full path (done + remaining), used in the chat prompt ("step N of my path").
- **`isYouAreHere`:** the first `in_progress` item in the order if any, else the first `ready` item. Exactly one item is marked (or none if the trajectory is empty — everything mastered).

**Properties:**
- A concept always appears after its not-done prereqs → the list is a valid "do this before that."
- The first item is always actionable (`ready` or `in_progress`) — it's where you are / where to start.
- An `in_progress` concept appears at its topological position (near the front, since its prereqs are typically mastered); the `isYouAreHere` marker pinpoints it even if a `ready` concept precedes it by the foundational-first tiebreak.

## Section 2 — Visual design (right-column panel, ~300px)

New component `components/graph/LearningPathTrajectory.tsx` ("use client", presentational, Studio Notebook tokens only).

**Layout (top to bottom):**
1. Header row: `LEARNING PATH` + `✓ doneCount done` (the collapsed done count) + coverage %.
2. Scrollable list of `items` (independent scroll; `max-height` constrained; auto-scrolls the `isYouAreHere` item into view on mount/data change).

**Each row:**
- A status dot/chip + the concept label + a tiny cluster tag (`mono`, `text-content-faint`).
- A small **"ask" icon button** (icon: `MessageSquare` / `ArrowUpRight` from lucide-react) — always visible on the `isYouAreHere` row, and on hover for other rows (to keep the 300px column uncluttered).
- Colors:
  - `in_progress` → yellow (`bg-band-learning` / `text-band-learning` token family) + `▸ you are here` marker (or `▸ start here` when the marked item is `ready`).
  - `ready` / `locked` → red (`text-rule` family); `locked` rows render slightly muted with a tiny `Lock` glyph, but stay red (not a separate color — position + marker carry the "where to start" signal).
- Clicking the row body selects the concept (→ `DetailPanel` updates; in drill-down, centers it in the canvas). Clicking the ask button does the Section 4 handoff (and `stopPropagation` so it doesn't also select).

The trajectory is the **primary "path" surface**; the graph's status-overlay toggle (prior feature) still exists but the trajectory is always visible.

## Section 3 — Right-column layout

In `app/(app)/graph/page.tsx`, the trajectory **replaces the per-cluster `NextUpPanel`** (remove it; the trajectory subsumes its purpose). The right column becomes, in **both** the overview and drill-down branches:

```
<div className="flex flex-col gap-3">          // right column
  <LearningPathTrajectory ... />                // top: scrollable, persistent
  <DetailPanel ... />                           // bottom: selected concept
</div>
```

- **Persistent across overview ↔ drill-down:** the trajectory is a global view, so it stays mounted/visible when you drill into a cluster (the canvas changes, the trajectory doesn't). The `activeClusterStatus`-driven NextUpPanel wiring is removed.
- Selecting a trajectory row calls the existing `setSelectedConceptId` (DetailPanel updates) and, when in a cluster view whose cluster contains the concept, centers the node.

## Section 4 — "Ask in chat" handoff

**Prompt template** (constructed on the graph page, which has the item's `label` + `step`):
```
I'm working through my study path and I'm on "<label>" (step <N>).
Explain it from my materials, then quiz me to check my understanding.
```

**URL contract:** the ask button is a Next `<Link>` (or `router.push`) to
```
/?projectId=<pid>&q=<encodeURIComponent(prompt)>
```

**Chat page changes** (`app/(app)/page.tsx`) — a new ref-guarded mount effect reads URL params:
- `?projectId=<pid>` → `setActiveProjectId(pid)` (so the conversation list pane shows the right project context).
- `?q=<prompt>` → create a **project-scoped conversation** (`POST /api/conversations { projectId: pid ?? null }`), set it active (`setActiveId`/`setConversation`/`syncUrl`/empty `messages`), and `setPendingPrompt(prompt)` so `ChatInput` prefills the composer (existing mechanism). The user reviews the prompt and presses Enter (gentle; matches `welcomeChip`).
- **Precedence:** if `q` is present, perform the handoff and **skip** the existing `?c=` restore (ref-guarded so it runs once; `q`-handoff and `?c`-restore are mutually exclusive in practice).
- The created conversation's `project_id` triggers the existing project-materials effect → `activeProjectMaterials` loads → RAG explains from the project's materials. **No backend changes.**

## Section 5 — Data flow & reactivity

- All client-side. The graph page adds a `trajectory` memo: `computeTrajectory(data.concepts, data.edges, statuses, labelById, clusterNameById)` where `clusterNameById` is built from `c2cluster` + `clusterById` (conceptId → cluster name). Recomputed when `data`/`statuses`/`clusters` change → after a review, the next `/api/concepts` fetch reflows the trajectory (no stale-gating).
- The trajectory (and the `isYouAreHere` auto-scroll) resets/re-scrolls on project switch via the existing `loadData` reset pattern.
- No new endpoints, no DB/schema migration, no extra fetches.
- The chat page reads `?projectId` / `?q` only on mount (ref-guarded); navigating `/graph → /?projectId=&q=` is a route change → fresh mount → the effect fires.

## Section 6 — Edge cases & testing

**Pure module (`lib/graph/learning-path.test.ts`, TDD):**
- Linear chain `a→b→c`: order `a, b, c`; `step` = doneCount + index + 1.
- Diamond `a→{b,c}→d`: `a` first, then `b`/`c` by tiebreak, then `d`.
- Foundational-first tiebreak: two available concepts, the one with higher `prerequisite_of` out-degree emits first; equal out-degree → total degree; equal → label asc.
- `in_progress` concept gets `isYouAreHere` when present; otherwise the first `ready` gets it; exactly one (or zero).
- All-mastered → `items: []`, `doneCount = N`, no `isYouAreHere`.
- No `prerequisite_of` edges → every not-done concept available, ordered by tiebreak.
- `prerequisite_of` cycle among not-done → cycle members appended at the end by label asc (no infinite loop, list complete).
- `part_of` / `generalizes` do not affect ordering.
- Self-loop ignored.

**UI:** `tsc --noEmit` + `eslint`, then manual browser pass on the real project (87 concepts): trajectory order/colors, "you are here" marker + auto-scroll, row→select + center in drill-down, ask button → lands in the project's chat with the prefilled prompt + project materials loaded, project-switch resets/re-scrolls.

## Out of scope (v1)

- Auto-sending the chat question (v1 prefills for review + Enter).
- Reordering the trajectory by drag, or pinning custom "next" choices.
- A "mark as done" action from the trajectory (mastery still flows from review, as today).
- Distinguishing `ready` vs `locked` by color (both red in v1; position + marker carry the signal).
- Per-cluster mini-trajectories (v1 is one global list).
- Prior feature's deferred minors (mastered check-glyph; blocked-cluster double-indicator) — still deferred.