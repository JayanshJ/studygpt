# SP2 — Concept Graph Visualization (design)

> Sub-project 2 of the knowledge-graph + mastery-tracking feature. Builds on
> SP1 (concept extraction + graph storage), which produces `GET /api/concepts`.
> SP1's plan: `~/.claude/plans/jolly-hopping-badger.md`.

## Goal

A `/graph` page that turns the SP1 concept graph into something you can actually
see and explore: a **hybrid cluster-overview + drill-down** using topic
communities, so a real project (Maths: 404 concepts / 436 edges) never becomes
an unreadable hairball. Click a community to expand it, click a concept to see
its description, provenance (which material/chunk it came from), and neighbors.

**Out of scope (later sub-projects):** mastery coloring (SP4), editing the
graph, server-side clustering, saving/persisting layouts, SRS (SP3).

## Locked decisions

- **Exploration model:** hybrid — overview of topic communities, drill into one
  community to see its concepts, click a concept for a detail panel.
- **Clusters = topic communities**, detected by deterministic label propagation
  on the concept graph (communities can span materials). NOT one-per-material.
- **Cluster naming:** heuristic — each community is named after its 2
  highest-degree concepts' labels joined with " · " (e.g. "Eigenvalue ·
  Eigenvector"). No LLM calls, deterministic, always grounded in real concepts.
- **Where communities are computed:** **client-side on page load** (Option A).
  Deterministic label propagation over the `/api/concepts` data. SP2 stays
  additive — no schema change, no change to the extraction pipeline, no
  re-extraction required to see clusters. SP4 may promote to server-side if
  mastery needs DB-keyed cluster identities.
- **Layout:** force-directed via `d3-force` (position computation) + `@xyflow/react`
  (rendering). Direction shown by arrowheads, not a strict hierarchy.
- **Encoding is monochrome** (Graph Paper Lab tokens only — no multi-hue
  palette exists and none may be added): node **size** by degree, node **fill**
  by source-count, edges by **line style + opacity**, accent tokens used
  sparingly for selection/state. See Visual Encoding.
- **Provenance:** fetched on demand from a new `GET /api/concepts/[id]` detail
  endpoint (keeps the list payload small); shown in the detail panel.

## Architecture

A single client page `/graph` plus one new detail endpoint. No schema or
extraction-pipeline changes.

### Data flow

1. Page mounts → `GET /api/projects` for the project picker (if no
   `?projectId=`); `GET /api/concepts?projectId=<id>` for the graph data
   (`concepts`, `edges`, `materials`).
2. `lib/graph/clusters.ts` runs **deterministic label propagation** over
   `concepts` + `edges`, assigning each concept a `clusterId` and producing a
   cluster summary list (`{ id, name, conceptCount, conceptIds, memberDegree }`).
   Heuristic name = top-2 highest-degree member labels joined " · ".
3. Overview render: one node per cluster; inter-cluster edges = concept edges
   whose endpoints are in different clusters, aggregated (count → edge width).
4. `lib/graph/layout.ts` computes force-directed positions (`d3-force`) for
   whichever level is active (overview clusters, or one expanded cluster's
   concepts).
5. Click a cluster → switch active view to that cluster's concept subgraph
   (re-run layout on the subgraph). Back → overview.
6. Click a concept → `GET /api/concepts/[id]` → detail panel (right) shows
   description, sourceCount, cluster name, provenance list, neighbor list.
   Hovering a node dims non-neighbors and shows edge relation labels.

### Components / files (new)

- `app/graph/page.tsx` — client page: project picker, fetches `/api/concepts`,
  owns `view` state (`overview` | `{ clusterId }`), `selectedConceptId`,
  `searchQuery`; renders `<ConceptGraph>` + `<DetailPanel>` + controls. Graph
  Paper tokens, two-column layout mirroring `/projects`
  (`md:grid-cols-[1fr_300px]` or panel-on-right).
- `lib/graph/clusters.ts` — `detectCommunities(concepts, edges): Cluster[]`:
  deterministic label propagation (synchronous, fixed iteration count, seeded
  by sorted concept ids so output is stable for unchanged input). Exports
  `Cluster` type (`{ id, name, conceptCount, conceptIds, memberIds }`) and
  `clusterName(members, degreeByConcept)` helper.
- `lib/graph/layout.ts` — `layoutNodes(nodes, edges): Map<id, {x,y}>` via
  `d3-force` (forceManyBody, forceLink, forceCollide sized by node radius,
  forceCenter). **Cluster membership is the thing that must be stable across
  loads** (it is — `clusters.ts` is deterministic); **exact pixel positions need
  not be**, so d3-force's RNG jitter is acceptable. Run a fixed number of ticks
  so a given view settles consistently within a session.
- `components/graph/ConceptGraph.tsx` — `<ReactFlow>` wrapper: builds nodes/edges
  from the active view + layout positions, applies the visual encoding, handles
  selection + hover (dim non-neighbors), calls `onSelectConcept`. Memoized.
- `components/graph/DetailPanel.tsx` — fetches `/api/concepts/[id]` on
  `conceptId` change; renders label, cluster name, description, sourceCount,
  provenance list (material title + chunk ordinal + snippet), neighbor list
  (label + relation + confidence + direction; click → `onSelectConcept`).
- `app/api/concepts/[id]/route.ts` — `GET`: 404 if concept missing; returns
  `{ concept, sources, neighbors }` (see endpoint shape).
- `lib/db/concepts.ts` — add `getConceptDetail(id)`: one query for the concept
  row + sources JOINed to `materials` (title) + neighbor edges both directions
  JOINed to `concepts` (label). Returns the shape the route serializes.

### Endpoint shapes

`GET /api/concepts/[id]` → 200:
```jsonc
{
  "concept": { "id": "...", "label": "...", "slug": "...", "description": "...",
               "sourceCount": 4, "clusterId": "..." /* client-assigned, NOT here */ },
  "sources": [ { "materialId": "...", "title": "Kapitel_8", "ordinal": 12, "snippet": "..." } ],
  "neighbors": [ { "id": "...", "label": "Eigenvector", "relation": "prerequisite_of",
                   "confidence": "EXTRACTED", "score": 1.0, "direction": "out" } ]
}
```
(`clusterId` is client-side only; the endpoint returns `concept` without it.)
404 `{ error: "Concept not found" }` when the id is absent.

`GET /api/concepts?projectId=` is unchanged from SP1.

### Route handling

Per `AGENTS.md`, read the route-handler + dynamic-routes guides under
`node_modules/next/dist/docs/` before writing `app/api/concepts/[id]/route.ts`;
mirror `app/api/projects/[id]/route.ts` (`{ params }: { params: Promise<{ id:
string }> }`, `NextResponse.json`). The `[id]` segment is dynamic → the route is
server-rendered on demand (no caching config needed).

## Visual encoding (monochrome, Graph Paper tokens)

Tokens: `--paper/-2/-3`, `--ink/-2/-3`, `--rule` (red accent), `--feynman`
(blue accent), `--line`, `--grid`. `rounded-[3px]`/`rounded-[2px]`, `.mono`. No
new colors or fonts.

- **Cluster node (overview):** rounded rect, `.mono` label (heuristic name),
  size by `conceptCount` (min/max radius clamped). Fill `bg-paper`, border
  `border-line`, label `text-ink`. Selected cluster → `border-rule`.
- **Concept node (expanded):** circle/rounded rect. **Radius scales with
  degree** (number of incident edges) — hubs are visibly larger. **Fill:**
  filled `bg-ink` with a `text-paper` label when `sourceCount >= 2`
  (well-grounded across materials); hollow (`bg-paper`, `border-ink-3`, `text-ink-3`
  label) when single-source. Selected/hovered → `border-rule`. Dimmed
  (non-neighbor of hovered) → reduced opacity.
- **Edges:** solid for the 6 LLM relations, **dashed** for
  `semantically_similar_to`. Stroke `border-line`/`ink-2`-ish; **opacity scales
  with `confidence_score`** (AMBIGUOUS faint, EXTRACTED strong). Arrowhead shows
  direction (source→target). Relation label (`prerequisite_of`, …) shown on
  hover as a small `.mono` tag near the edge midpoint.
- **Inter-cluster edges (overview):** stroke width scales with the count of
  concept edges crossing that cluster pair; neutral `ink-3`.
- **Controls:** search input + (optional) relation-type checkboxes to
  show/hide edge types; "back to overview" button; project picker. All
  `rounded-[3px] border border-line bg-paper`, `.mono text-[12px]`.

## Error handling

- No project / empty graph → friendly empty state in the Graph Paper style
  ("no concept graph yet — build one on /projects"), not a blank canvas.
- `GET /api/concepts/[id]` failure → detail panel shows a small `text-rule`
  error line, keeps last good state dimmed.
- Missing/invalid `projectId` query → project picker (no crash).
- Large graph: layout + community detection are synchronous but bounded
  (~400 nodes < 100ms); if a future project is huge, cap rendered nodes via the
  search/filter controls rather than rendering thousands.

## Testing / verification

No unit-test framework is set up in this repo (SP1 verified via `tsc`/`lint`/
`build` + manual smoke). SP2 follows the same bar:

- `npx tsc --noEmit && npm run lint && npm run build` clean (the pre-existing
  `lib/db` dynamic-fs warning and `<img>` lint warnings are expected).
- Manual smoke (dev server, a project with a built graph — Maths or test):
  1. `/graph` → project picker if no id; with `?projectId=` → overview renders
     one node per community with heuristic names + inter-cluster edges.
  2. Click a cluster → expands to its concept nodes (force layout); Back works.
  3. Click a concept → detail panel shows description + provenance (material
     titles + chunk ordinals) + neighbors; clicking a neighbor pivots.
  4. Search a known concept → its cluster auto-expands and the node centers.
  5. Hover a node → non-neighbors dim, edge relation labels appear.
  6. Dark mode: nodes/edges/panel readable; no new colors introduced.
  7. Empty project (BigData, unbuilt) → empty-state message, no crash.

## Dependencies

- `@xyflow/react` (rendering, pan/zoom, node/edge components)
- `d3-force` + `@types/d3-force` (position computation)

Both are additive (no existing dep replaced). Match whatever version range the
AI SDK / React 19.2 / Next 16.3 versions in `package.json` permit; pin at
install time and record exact versions in the plan.

## Notes for later sub-projects

- SP4 (mastery) will recolor concept nodes by mastery state using the existing
  accent tokens (`--feynman` known / `--ink-3` learning / `--rule` due). The
  SP2 size/fill encoding must coexist with that — plan SP4 to overlay mastery
  as the fill and keep degree as size.
- If SP4 needs stable DB-keyed cluster ids, promote community detection to
  server-side at extraction time (Option B) then; the client `lib/graph/clusters.ts`
  interface should be written so it can be swapped for a server-provided
  `clusterId` without rewriting the page.
- `concept_sources` provenance surfaced in the detail panel is the foundation
  for SP2/SP4 "jump to source" (open the material at that chunk).