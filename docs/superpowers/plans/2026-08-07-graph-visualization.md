# SP2 — Concept Graph Visualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/graph` page that visualizes the SP1 concept graph as a hybrid cluster-overview + drill-down, using client-side topic communities, monochrome Graph Paper encoding, and an on-demand detail endpoint for provenance.

**Architecture:** A single client page (`/graph`) fetches `GET /api/concepts`, runs deterministic label propagation client-side to form topic communities, renders an overview of community clusters with `@xyflow/react` (positions from `d3-force`), and drills into a cluster's concepts on click. A new `GET /api/concepts/[id]` endpoint serves provenance + neighbors to a detail panel. No schema or extraction-pipeline changes.

**Tech Stack:** Next.js 16.3 (app router), React 19.2, `@xyflow/react` (v12, React 19-compatible), `d3-force` (+ `@types/d3-force`), Tailwind v4 Graph Paper tokens, better-sqlite3, the existing `lib/db` barrel.

## Global Constraints

- **Additive only** — no schema changes, no changes to `lib/concepts/extract.ts` or the extraction pipeline. New files + one new DB helper + one new column-free query.
- **Graph Paper Lab tokens only** — `--paper/-2/-3`, `--ink/-2/-3`, `--rule` (red accent), `--feynman` (blue accent), `--line`, `--grid`; `rounded-[3px]`/`rounded-[2px]`, `.mono`. **No new colors or fonts.** Encode distinctions with size / fill / line-style / opacity, never multi-hue.
- **Honor `AGENTS.md`** — before writing `app/api/concepts/[id]/route.ts` (Task 3), read the route-handler guide (`node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`) and the dynamic-routes guide (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md`). Mirror `app/api/projects/[id]/route.ts` (`{ params }: { params: Promise<{ id: string }> }`, `NextResponse.json`). Don't remove the `AGENTS.md` block from any diff.
- **`@/` maps to repo root.** Import DB helpers from `@/lib/db`; types from `@/lib/db/schema` or `@/lib/graph/clusters`.
- **No test framework in this repo** — verify per task with `npx tsc --noEmit && npm run lint` (and `npm run build` where a task adds a route/page). The pre-existing `lib/db` dynamic-fs build warning and the pre-existing `<img>` lint warnings are expected and not failures.
- **Commit only when the user asks** (standing rule). The per-task "Commit" steps below define *clean staging boundaries* — implement the code and run the verify step, but hold the actual `git commit` until the user authorizes it. (Same posture as SP1.)
- **One commit per task** when commits are authorized; stage only the files a task touches.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/graph/clusters.ts` (new) | Shared graph types (`GraphConcept`, `GraphEdge`, `GraphData`, `Cluster`) + `detectCommunities` (deterministic label propagation) + `clusterName` helper. Pure, no React, no DB. |
| `lib/graph/layout.ts` (new) | `layoutNodes(nodes, links, width, height)` → `Map<id,{x,y}>` via `d3-force`. Pure, synchronous (fixed ticks). |
| `lib/db/concepts.ts` (modify) | Add `getConceptDetail(id)` + `ConceptDetail` type. One query for the concept, one for sources (JOIN materials), two for neighbor edges (out + in). |
| `app/api/concepts/[id]/route.ts` (new) | `GET` → `getConceptDetail` → JSON, 404 if missing. Dynamic route. |
| `components/graph/ConceptGraph.tsx` (new) | `<ReactFlow>` wrapper: builds styled nodes/edges from active-view data + layout positions, applies the monochrome encoding, handles hover-dim + click. Custom cluster + concept node components. |
| `components/graph/DetailPanel.tsx` (new) | Right-side panel: fetches `/api/concepts/[id]` on selection, renders description, cluster name, provenance, neighbors. |
| `app/graph/page.tsx` (new) | Client page: project picker, fetch `/api/concepts`, own view/search/selection state, compute active view (overview or one cluster), render `<ConceptGraph>` + `<DetailPanel>` + controls. Empty/loading/error states. |

---

## Task 1: Dependencies + community detection

**Files:**
- Create: `lib/graph/clusters.ts`
- Modify: `package.json`, `package-lock.json` (via npm)

**Interfaces:**
- Produces (exported from `lib/graph/clusters.ts`):
  - `GraphConcept { id: string; label: string; slug: string; description: string | null; sourceCount: number }`
  - `GraphEdge { source: string; target: string; relation: string; confidence: string; score: number | null }`
  - `GraphData { concepts: GraphConcept[]; edges: GraphEdge[]; materials: { materialId: string; title: string; status: string; conceptCount: number; error: string | null }[] }`
  - `Cluster { id: string; name: string; conceptCount: number; conceptIds: string[] }`
  - `detectCommunities(concepts: GraphConcept[], edges: GraphEdge[]): Cluster[]`
  - `conceptClusterMap(clusters: Cluster[]): Map<string, string>` (conceptId → clusterId)

- [ ] **Step 1: Install dependencies**

```bash
npm install @xyflow/react d3-force && npm install -D @types/d3-force
```
Expected: packages added to `package.json` dependencies / devDependencies. If npm reports a peer-dep conflict with React 19, retry with `--legacy-peer-deps` and note it in the task report.

- [ ] **Step 2: Create `lib/graph/clusters.ts`**

```ts
// Client-side topic-community detection for the concept graph (SP2).
// Deterministic label propagation: same input always yields the same cluster
// assignment, so the overview is stable across reloads as long as the graph
// data is unchanged. Pure, no React, no DB.

export interface GraphConcept {
  id: string;
  label: string;
  slug: string;
  description: string | null;
  sourceCount: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: string;
  confidence: string;
  score: number | null;
}

export interface GraphData {
  concepts: GraphConcept[];
  edges: GraphEdge[];
  materials: { materialId: string; title: string; status: string; conceptCount: number; error: string | null }[];
}

export interface Cluster {
  id: string;
  name: string;
  conceptCount: number;
  conceptIds: string[];
}

// Undirected degree (number of incident edges) for each concept. Used both for
// label-propagation tie-breaking and for sizing nodes / naming clusters.
function degreeMap(concepts: GraphConcept[], edges: GraphEdge[]): Map<string, number> {
  const deg = new Map<string, number>();
  for (const c of concepts) deg.set(c.id, 0);
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!deg.has(e.source) || !deg.has(e.target)) continue;
    deg.set(e.source, deg.get(e.source)! + 1);
    deg.set(e.target, deg.get(e.target)! + 1);
  }
  return deg;
}

// Heuristic cluster name: the 2 highest-degree member labels joined with " · ".
// Ties in degree broken by ascending label for determinism.
function clusterName(memberIds: string[], labelById: Map<string, string>, deg: Map<string, number>): string {
  const sorted = [...memberIds].sort((a, b) => {
    const da = deg.get(a) ?? 0;
    const db = deg.get(b) ?? 0;
    if (db !== da) return db - da;
    return (labelById.get(a) ?? a).localeCompare(labelById.get(b) ?? b);
  });
  const top = sorted.slice(0, 2).map((id) => labelById.get(id) ?? id);
  return top.join(" · ");
}

const ITERATIONS = 12;

// Detect topic communities via label propagation. Concepts with no edges
// (degree 0) are merged into a single "isolated" cluster so the overview stays
// tidy (they aren't a topic community). Deterministic: concepts are processed
// in sorted-id order each iteration, and ties resolve to the lexicographically
// smallest label.
export function detectCommunities(concepts: GraphConcept[], edges: GraphEdge[]): Cluster[] {
  if (concepts.length === 0) return [];

  const ids = concepts.map((c) => c.id).sort();
  const labelById = new Map(concepts.map((c) => [c.id, c.label]));
  const deg = degreeMap(concepts, edges);

  // Undirected adjacency (skip self-loops + unknown endpoints).
  const adj = new Map<string, Set<string>>();
  for (const id of ids) adj.set(id, new Set());
  for (const e of edges) {
    if (e.source === e.target) continue;
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source)!.add(e.target);
    adj.get(e.target)!.add(e.source);
  }

  // Initialize each node's label to its own id (deterministic seed).
  const label = new Map<string, string>();
  for (const id of ids) label.set(id, id);

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const id of ids) {
      const neighbors = adj.get(id)!;
      if (neighbors.size === 0) continue; // isolated: keep own label
      const counts = new Map<string, number>();
      for (const n of neighbors) {
        const nl = label.get(n)!;
        counts.set(nl, (counts.get(nl) ?? 0) + 1);
      }
      // Pick the most frequent neighbor label; tie → lexicographically smallest.
      let best = "";
      let bestCount = -1;
      for (const [l, count] of counts) {
        if (count > bestCount || (count === bestCount && l < best)) {
          best = l;
          bestCount = count;
        }
      }
      if (best) label.set(id, best);
    }
  }

  // Group by final label.
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const l = label.get(id)!;
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l)!.push(id);
  }

  const clusters: Cluster[] = [];
  const isolated: string[] = [];
  for (const [l, members] of groups) {
    const memberDeg = members.map((m) => deg.get(m) ?? 0);
    const isConnected = memberDeg.some((d) => d > 0);
    if (!isConnected) {
      isolated.push(...members);
      continue;
    }
    clusters.push({
      id: l,
      name: clusterName(members, labelById, deg),
      conceptCount: members.length,
      conceptIds: members,
    });
  }
  if (isolated.length > 0) {
    clusters.push({
      id: "isolated",
      name: "Isolated concepts",
      conceptCount: isolated.length,
      conceptIds: isolated,
    });
  }

  // Stable order: by conceptCount desc, then by name asc.
  clusters.sort((a, b) => b.conceptCount - a.conceptCount || a.name.localeCompare(b.name));
  return clusters;
}

// conceptId → clusterId lookup, built once per render in the page.
export function conceptClusterMap(clusters: Cluster[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const cl of clusters) for (const id of cl.conceptIds) m.set(id, cl.id);
  return m;
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npm run lint
```
Expected: clean (0 errors; pre-existing `<img>` warnings only).

- [ ] **Step 4: Commit (hold until authorized)**

```bash
git add lib/graph/clusters.ts package.json package-lock.json
git commit -m "feat(graph): client-side topic community detection (SP2)"
```

---

## Task 2: Force-directed layout helper

**Files:**
- Create: `lib/graph/layout.ts`

**Interfaces:**
- Produces (exported from `lib/graph/layout.ts`):
  - `LayoutNode { id: string; radius: number }`
  - `LayoutLink { source: string; target: string }`
  - `layoutNodes(nodes: LayoutNode[], links: LayoutLink[], width: number, height: number): Map<string, { x: number; y: number }>`

- [ ] **Step 1: Create `lib/graph/layout.ts`**

```ts
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceCenter,
  type SimulationNodeDatum,
} from "d3-force";

export interface LayoutNode {
  id: string;
  radius: number;
}

export interface LayoutLink {
  source: string;
  target: string;
}

// Deterministic-ish initial position: spread nodes on a circle around the
// center, angle derived from a stable string hash of the id. Same data → same
// start → similar settled layout across runs (d3-force's internal jitter is
// acceptable; cluster membership — the thing that must be stable — is fixed by
// clusters.ts, not here).
function hashAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (((h % 1000) + 1000) % 1000) / 1000; // 0..1
}

// Synchronously compute node positions via d3-force. Runs a fixed number of
// ticks then stops, returning a Map of id → {x,y}. Caller maps these onto
// @xyflow/react Node positions.
export function layoutNodes(
  nodes: LayoutNode[],
  links: LayoutLink[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;
  if (nodes.length === 1) {
    out.set(nodes[0].id, { x: width / 2, y: height / 2 });
    return out;
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 3;

  type SimNode = SimulationNodeDatum & { id: string; r: number };
  const simNodes: SimNode[] = nodes.map((n, i) => {
    const a = (hashAngle(n.id) + i / nodes.length) * Math.PI * 2;
    return { id: n.id, r: n.radius, x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  });
  const idIndex = new Map(simNodes.map((n, i) => [n.id, i]));

  // Resolve links to node indices (d3-force replaces source/target with node
  // refs when given an id accessor; we pass objects with id fields + the accessor).
  const simLinks = links
    .filter((l) => idIndex.has(l.source) && idIndex.has(l.target) && l.source !== l.target)
    .map((l) => ({ source: l.source, target: l.target }));

  const simulation = forceSimulation<SimNode>(simNodes)
    .force("charge", forceManyBody().strength(-240))
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((d) => d.id)
        .distance(90),
    )
    .force("collide", forceCollide<SimNode>().radius((d) => d.r + 8))
    .force("center", forceCenter(cx, cy));

  // Synchronous settle: run fixed ticks, then stop so it doesn't keep animating.
  for (let i = 0; i < 300; i++) simulation.tick();
  simulation.stop();

  for (const n of simNodes) out.set(n.id, { x: n.x ?? cx, y: n.y ?? cy });
  return out;
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npm run lint
```
Expected: clean. If `d3-force` types complain about the `forceLink` generic or `forceCollide` radius accessor, adjust the generic parameters (the codebase allows `// eslint-disable-next-line @typescript-eslint/no-explicit-any` — see `lib/db/materials.ts` — but prefer correct generics first).

- [ ] **Step 3: Commit (hold until authorized)**

```bash
git add lib/graph/layout.ts
git commit -m "feat(graph): d3-force synchronous layout helper (SP2)"
```

---

## Task 3: Concept detail endpoint (provenance + neighbors)

**Files:**
- Modify: `lib/db/concepts.ts` (add `getConceptDetail` + `ConceptDetail` type)
- Create: `app/api/concepts/[id]/route.ts`

**Interfaces:**
- Consumes: existing `db` from `./index`; existing `concepts` / `concept_sources` / `concept_edges` / `materials` tables (SP1).
- Produces:
  - `ConceptDetail` (exported type from `lib/db/concepts.ts`):
    `{ concept: { id; label; slug; description; sourceCount }, sources: { materialId; title; ordinal; snippet }[], neighbors: { id; label; relation; confidence; score; direction: "out" | "in" }[] }`
  - `getConceptDetail(id: string): ConceptDetail | undefined`
  - HTTP `GET /api/concepts/[id]` → 200 `ConceptDetail` | 404 `{ error: "Concept not found" }`

- [ ] **Step 1: Read the Next route-handler + dynamic-routes guides (per AGENTS.md)**

```bash
sed -n '1,60p' node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md
```
Confirm: dynamic segment `[id]` is consumed via `{ params }: { params: Promise<{ id: string }> }` (async params — same as `app/api/projects/[id]/route.ts`).

- [ ] **Step 2: Add `getConceptDetail` + `ConceptDetail` to `lib/db/concepts.ts`**

Append at the end of `lib/db/concepts.ts` (after `setEdgeCountsForProject`):

```ts
export interface ConceptDetail {
  concept: { id: string; label: string; slug: string; description: string | null; sourceCount: number };
  sources: { materialId: string; title: string; ordinal: number; snippet: string | null }[];
  neighbors: {
    id: string;
    label: string;
    relation: string;
    confidence: string;
    score: number | null;
    direction: "out" | "in";
  }[];
}

// One concept + its provenance (which material/chunk it came from) + its
// neighbors (edges both directions, with the other concept's label). Serves the
// /graph detail panel. Returns undefined when the concept id doesn't exist.
export function getConceptDetail(id: string): ConceptDetail | undefined {
  const concept = db
    .prepare("SELECT id, label, slug, description, source_count FROM concepts WHERE id = ?")
    .get(id) as
    | { id: string; label: string; slug: string; description: string | null; source_count: number }
    | undefined;
  if (!concept) return undefined;

  const sources = db
    .prepare(
      `SELECT cs.material_id AS materialId, m.title, cs.ordinal, cs.snippet
       FROM concept_sources cs
       JOIN materials m ON m.id = cs.material_id
       WHERE cs.concept_id = ?
       ORDER BY m.title ASC, cs.ordinal ASC`,
    )
    .all(id) as { materialId: string; title: string; ordinal: number; snippet: string | null }[];

  const outEdges = db
    .prepare(
      `SELECT e.target_concept AS id, c.label, e.relation, e.confidence, e.confidence_score AS score, 'out' AS direction
       FROM concept_edges e JOIN concepts c ON c.id = e.target_concept
       WHERE e.source_concept = ?`,
    )
    .all(id) as { id: string; label: string; relation: string; confidence: string; score: number | null; direction: "out" }[];
  const inEdges = db
    .prepare(
      `SELECT e.source_concept AS id, c.label, e.relation, e.confidence, e.confidence_score AS score, 'in' AS direction
       FROM concept_edges e JOIN concepts c ON c.id = e.source_concept
       WHERE e.target_concept = ?`,
    )
    .all(id) as { id: string; label: string; relation: string; confidence: string; score: number | null; direction: "in" }[];

  return {
    concept: {
      id: concept.id,
      label: concept.label,
      slug: concept.slug,
      description: concept.description,
      sourceCount: concept.source_count,
    },
    sources,
    neighbors: [...outEdges, ...inEdges],
  };
}
```

- [ ] **Step 3: Create `app/api/concepts/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getConceptDetail } from "@/lib/db";

// GET /api/concepts/[id] — one concept + provenance + neighbors, for the /graph
// detail panel. 404 when the concept id doesn't exist.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const detail = getConceptDetail(id);
  if (!detail) return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  return NextResponse.json(detail);
}
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: clean; build lists `ƒ /api/concepts/[id]` as a dynamic route (alongside the existing `/api/concepts` and `/api/concepts/extract`).

- [ ] **Step 5: Smoke the endpoint**

With the dev server running (`npm run dev`) and a project that has a built graph (e.g. Maths `52807842-4f4d-4bd7-ab72-91d757f93d15`), grab a real concept id from `GET /api/concepts?projectId=…` and hit the detail endpoint:

```bash
CID=$(curl -s "http://localhost:3000/api/concepts?projectId=52807842-4f4d-4bd7-ab72-91d757f93d15" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log(j.concepts[0].id)})')
curl -s "http://localhost:3000/api/concepts/$CID" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);console.log("concept:",j.concept.label,"| sources:",j.sources.length,"| neighbors:",j.neighbors.length)})'
```
Expected: prints a concept label, a source count > 0, and a neighbor count. A bogus id → 404 `{"error":"Concept not found"}`.

- [ ] **Step 6: Commit (hold until authorized)**

```bash
git add lib/db/concepts.ts app/api/concepts/[id]/route.ts
git commit -m "feat(api): GET /api/concepts/[id] detail with provenance + neighbors (SP2)"
```

---

## Task 4: ConceptGraph component (ReactFlow + encoding + hover)

**Files:**
- Create: `components/graph/ConceptGraph.tsx`

**Interfaces:**
- Consumes: `@xyflow/react` (v12), `lib/graph/clusters.ts` types (`GraphConcept`, `GraphEdge`, `Cluster`), `lib/graph/layout.ts` (`layoutNodes`, `LayoutNode`, `LayoutLink`).
- Produces: default export `<ConceptGraph>` with props:
  - `kind: "overview" | "concept"`
  - `clusters: Cluster[]` (used when `kind === "overview"`)
  - `concepts: GraphConcept[]` (used when `kind === "concept"` — the active cluster's concepts)
  - `edges: GraphEdge[]` (active-view edges: inter-cluster when overview, within-cluster when concept)
  - `activeClusterId?: string` (the expanded cluster id, for the back-button context — not strictly needed by the canvas)
  - `selectedId: string | null`
  - `onNodeClick: (id: string) => void`

- [ ] **Step 1: Create `components/graph/ConceptGraph.tsx`**

```tsx
"use client";

import { useMemo, useState, useCallback } from "react";
import ReactFlow, {
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { layoutNodes, type LayoutNode, type LayoutLink } from "@/lib/graph/layout";
import type { GraphConcept, GraphEdge, Cluster } from "@/lib/graph/clusters";

// --- visual encoding constants (monochrome Graph Paper tokens) ---
const CANVAS_W = 900;
const CANVAS_H = 620;

function conceptRadius(degree: number): number {
  return Math.max(16, Math.min(40, 16 + degree * 1.6));
}
function clusterRadius(conceptCount: number): number {
  return Math.max(26, Math.min(70, 26 + conceptCount * 1.4));
}
// confidence_score → stroke opacity (AMBIGUOUS faint, EXTRACTED strong).
function edgeOpacity(score: number | null): number {
  if (score == null) return 0.4;
  return Math.max(0.18, Math.min(0.9, 0.18 + score * 0.72));
}

// --- custom node components ---

type ConceptNodeData = {
  label: string;
  degree: number;
  sourceCount: number;
  selected: boolean;
  dimmed: boolean;
};
type ConceptRFNode = Node<ConceptNodeData, "concept">;

function ConceptNode({ data }: NodeProps<ConceptRFNode>) {
  const filled = data.sourceCount >= 2;
  const base = `flex items-center justify-center rounded-full text-center transition-opacity ${
    data.dimmed ? "opacity-20" : "opacity-100"
  }`;
  const box = filled
    ? "bg-ink text-paper border-2"
    : "bg-paper text-ink-3 border-2";
  const border = data.selected ? "border-rule" : filled ? "border-ink" : "border-ink-3";
  // size via inline style so it scales with degree
  const r = conceptRadius(data.degree);
  return (
    <div className={base} style={{ width: r * 2, height: r * 2 }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div className={`${box} ${border} mono rounded-full px-2 py-1 text-[10px] leading-tight`} style={{ maxWidth: r * 2.4 }}>
        {data.label}
      </div>
    </div>
  );
}

type ClusterNodeData = {
  label: string;
  conceptCount: number;
  selected: boolean;
  dimmed: boolean;
};
type ClusterRFNode = Node<ClusterNodeData, "cluster">;

function ClusterNode({ data }: NodeProps<ClusterRFNode>) {
  const r = clusterRadius(data.conceptCount);
  return (
    <div className={`transition-opacity ${data.dimmed ? "opacity-30" : "opacity-100"}`} style={{ width: r * 2, height: r * 2 }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div
        className={`mono flex h-full w-full flex-col items-center justify-center rounded-[3px] border-2 bg-paper px-2 text-center ${
          data.selected ? "border-rule" : "border-line"
        }`}
      >
        <div className="text-[11px] leading-tight text-ink">{data.label}</div>
        <div className="mt-0.5 text-[9px] text-ink-3">{data.conceptCount} concepts</div>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { concept: ConceptNode, cluster: ClusterNode };

interface ConceptGraphProps {
  kind: "overview" | "concept";
  clusters: Cluster[];
  concepts: GraphConcept[];
  edges: GraphEdge[];
  selectedId: string | null;
  onNodeClick: (id: string) => void;
}

export function ConceptGraph({
  kind,
  clusters,
  concepts,
  edges,
  selectedId,
  onNodeClick,
}: ConceptGraphProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Active node ids + per-node degree (undirected) for the current view.
  const { nodeIds, degreeById, labelById, sourceCountById } = useMemo(() => {
    if (kind === "overview") {
      const ids = clusters.map((c) => c.id);
      const deg = new Map<string, number>();
      const lbl = new Map<string, string>(clusters.map((c) => [c.id, c.name]));
      const sc = new Map<string, number>();
      // inter-cluster edge weight = degree between clusters
      for (const e of edges) {
        // edges here are inter-cluster; count per cluster node
        deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
        deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
      }
      return { nodeIds: ids, degreeById: deg, labelById: lbl, sourceCountById: sc };
    }
    const ids = concepts.map((c) => c.id);
    const deg = new Map<string, number>(ids.map((id) => [id, 0]));
    const lbl = new Map<string, string>(concepts.map((c) => [c.id, c.label]));
    const sc = new Map<string, number>(concepts.map((c) => [c.id, c.sourceCount]));
    for (const e of edges) {
      if (e.source === e.target) continue;
      if (!deg.has(e.source) || !deg.has(e.target)) continue;
      deg.set(e.source, deg.get(e.source)! + 1);
      deg.set(e.target, deg.get(e.target)! + 1);
    }
    return { nodeIds: ids, degreeById: deg, labelById: lbl, sourceCountById: sc };
  }, [kind, clusters, concepts, edges]);

  // Layout positions for the active nodes.
  const positions = useMemo(() => {
    const ln: LayoutNode[] = nodeIds.map((id) => ({
      id,
      radius:
        kind === "overview"
          ? clusterRadius(clusters.find((c) => c.id === id)?.conceptCount ?? 1)
          : conceptRadius(degreeById.get(id) ?? 0),
    }));
    const ll: LayoutLink[] = edges
      .filter((e) => nodeIds.includes(e.source) && nodeIds.includes(e.target) && e.source !== e.target)
      .map((e) => ({ source: e.source, target: e.target }));
    return layoutNodes(ln, ll, CANVAS_W, CANVAS_H);
  }, [nodeIds, edges, kind, clusters, degreeById]);

  // Neighbor set for hover-dim.
  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const id of nodeIds) m.set(id, new Set());
    for (const e of edges) {
      if (e.source === e.target) continue;
      if (!m.has(e.source) || !m.has(e.target)) continue;
      m.get(e.source)!.add(e.target);
      m.get(e.target)!.add(e.source);
    }
    return m;
  }, [nodeIds, edges]);

  const focusId = hoveredId ?? selectedId;
  const focusNeighbors = focusId ? neighbors.get(focusId) ?? null : null;

  // Build @xyflow nodes + edges with encoding + hover-dim applied.
  const { rfNodes, rfEdges } = useMemo(() => {
    const rfNodes: Node[] = nodeIds.map((id) => {
      const pos = positions.get(id) ?? { x: CANVAS_W / 2, y: CANVAS_H / 2 };
      const selected = id === selectedId;
      const dimmed = !!focusId && id !== focusId && !(focusNeighbors?.has(id) ?? false);
      if (kind === "overview") {
        const cl = clusters.find((c) => c.id === id);
        return {
          id,
          type: "cluster",
          position: pos,
          data: { label: cl?.name ?? id, conceptCount: cl?.conceptCount ?? 0, selected, dimmed },
        } satisfies Node<ClusterNodeData, "cluster">;
      }
      return {
        id,
        type: "concept",
        position: pos,
        data: {
          label: labelById.get(id) ?? id,
          degree: degreeById.get(id) ?? 0,
          sourceCount: sourceCountById.get(id) ?? 0,
          selected,
          dimmed,
        },
      } satisfies Node<ConceptNodeData, "concept">;
    });

    const rfEdges: Edge[] = edges
      .filter((e) => nodeIds.includes(e.source) && nodeIds.includes(e.target) && e.source !== e.target)
      .map((e) => {
        const dimmed = !!focusId && e.source !== focusId && e.target !== focusId;
        const dashed = e.relation === "semantically_similar_to";
        const op = edgeOpacity(e.score) * (dimmed ? 0.25 : 1);
        const id = `${e.source}->${e.target}->${e.relation}`;
        const isHoveredEdge = id === hoveredEdgeId;
        return {
          id,
          source: e.source,
          target: e.target,
          style: { stroke: "var(--ink-2)", strokeWidth: 1.5, strokeOpacity: op, strokeDasharray: dashed ? "4 3" : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color: "var(--ink-2)" },
          // Relation label shown only on the hovered edge (spec: small .mono tag
          // near the midpoint on hover). @xyflow renders edge.label as a pill.
          label: isHoveredEdge ? e.relation : undefined,
          labelStyle: { fontFamily: "monospace", fontSize: 10, fill: "var(--ink-2)" },
          labelBgStyle: { fill: "var(--paper)" },
          labelBgPadding: [2, 1] as [number, number],
        };
      });

    return { rfNodes, rfEdges };
  }, [nodeIds, positions, kind, clusters, labelById, degreeById, sourceCountById, edges, selectedId, focusId, focusNeighbors, hoveredEdgeId]);

  const onNodeMouseEnter = useCallback<NodeMouseHandler>((_, node) => setHoveredId(node.id), []);
  const onNodeMouseLeave = useCallback<NodeMouseHandler>(() => setHoveredId(null), []);
  const handleNodeClick = useCallback<NodeMouseHandler>((_, node) => onNodeClick(node.id), [onNodeClick]);

  if (nodeIds.length === 0) {
    return (
      <div className="mono flex h-[620px] items-center justify-center rounded-[3px] border border-line bg-paper-2 text-[12px] text-ink-3">
        nothing to show
      </div>
    );
  }

  return (
    <div className="h-[620px] w-full rounded-[3px] border border-line bg-paper-2">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeMouseEnter={(_, edge) => setHoveredEdgeId(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdgeId(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} color="var(--line)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npm run lint
```
Expected: clean. If `@xyflow/react` v12 types differ (e.g. `NodeProps` generic arity, `NodeMouseHandler` import path), adjust to satisfy tsc — the verify step is the gate. The `satisfies Node<…, "…">` pattern is v12-correct.

- [ ] **Step 3: Commit (hold until authorized)**

```bash
git add components/graph/ConceptGraph.tsx
git commit -m "feat(graph): ReactFlow canvas with monochrome encoding + hover-dim (SP2)"
```

---

## Task 5: DetailPanel component

**Files:**
- Create: `components/graph/DetailPanel.tsx`

**Interfaces:**
- Consumes: `GET /api/concepts/[id]` response shape = `ConceptDetail` (from `lib/db/concepts.ts`, re-exported via `@/lib/db`).
- Produces: default export `<DetailPanel>` with props:
  - `conceptId: string | null`
  - `clusterName: string | null`
  - `onSelectConcept: (id: string) => void`

- [ ] **Step 1: Create `components/graph/DetailPanel.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { ConceptDetail } from "@/lib/db";

interface DetailPanelProps {
  conceptId: string | null;
  clusterName: string | null;
  onSelectConcept: (id: string) => void;
}

export function DetailPanel({ conceptId, clusterName, onSelectConcept }: DetailPanelProps) {
  const [detail, setDetail] = useState<ConceptDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!conceptId) {
      setDetail(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/concepts/${encodeURIComponent(conceptId)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as ConceptDetail) : null))
      .then((d) => {
        if (!alive) return;
        setDetail(d);
        setLoading(false);
        if (!d) setError("Concept not found");
      })
      .catch(() => {
        if (!alive) return;
        setError("Could not load concept");
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [conceptId]);

  if (!conceptId) {
    return (
      <div className="mono rounded-[3px] border border-line bg-paper-2 p-4 text-[12px] text-ink-3">
        select a concept to see its description, provenance, and neighbors.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="mono rounded-[3px] border border-line bg-paper-2 p-4 text-[12px] text-ink-3">
        loading…
      </div>
    );
  }
  if (error || !detail) {
    return (
      <div className="mono rounded-[3px] border border-line bg-paper-2 p-4 text-[12px] text-rule">
        {error ?? "Could not load concept"}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-[3px] border border-line bg-paper-2 p-4">
      <div>
        <div className="text-[15px] text-ink">{detail.concept.label}</div>
        {clusterName && <div className="mono mt-0.5 text-[10px] text-ink-3">{clusterName}</div>}
      </div>
      <div className="mono text-[10px] text-ink-3">
        {detail.concept.sourceCount} source{detail.concept.sourceCount === 1 ? "" : "s"}
      </div>
      {detail.concept.description && (
        <p className="text-[12px] leading-relaxed text-ink-2">{detail.concept.description}</p>
      )}

      <div>
        <div className="mono mb-1 text-[10px] tracking-wide text-ink-3">PROVENANCE</div>
        {detail.sources.length === 0 ? (
          <div className="mono text-[10px] text-ink-3">none</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.sources.map((s, i) => (
              <li key={i} className="mono text-[10px] text-ink-2">
                <span className="text-ink">{s.title}</span>{" "}
                <span className="text-ink-3">· chunk {s.ordinal}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="mono mb-1 text-[10px] tracking-wide text-ink-3">NEIGHBORS</div>
        {detail.neighbors.length === 0 ? (
          <div className="mono text-[10px] text-ink-3">none</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.neighbors.map((n, i) => (
              <li key={i}>
                <button
                  onClick={() => onSelectConcept(n.id)}
                  className="mono w-full truncate text-left text-[10px] text-ink-2 hover:text-ink"
                  title={`${n.relation} · ${n.confidence}`}
                >
                  <span className="text-ink-3">{n.direction === "out" ? "→" : "←"} </span>
                  <span className="text-ink">{n.label}</span>{" "}
                  <span className="text-ink-3">{n.relation}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npm run lint
```
Expected: clean.

- [ ] **Step 3: Commit (hold until authorized)**

```bash
git add components/graph/DetailPanel.tsx
git commit -m "feat(graph): concept detail panel with provenance + neighbors (SP2)"
```

---

## Task 6: /graph page (wiring)

**Files:**
- Create: `app/graph/page.tsx`

**Interfaces:**
- Consumes: `@/lib/graph/clusters` (`detectCommunities`, `conceptClusterMap`, `GraphData`, `Cluster`, `GraphConcept`, `GraphEdge`), `@/lib/graph/layout` (not directly — used inside ConceptGraph), `<ConceptGraph>`, `<DetailPanel>`, `/api/projects` (Project list), `/api/concepts?projectId=` (GraphData), `type Project` from `@/lib/db/schema`.
- Produces: the `/graph` route.

- [ ] **Step 1: Create `app/graph/page.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Project } from "@/lib/db/schema";
import {
  detectCommunities,
  conceptClusterMap,
  type GraphData,
  type Cluster,
  type GraphConcept,
  type GraphEdge,
} from "@/lib/graph/clusters";
import { ConceptGraph } from "@/components/graph/ConceptGraph";
import { DetailPanel } from "@/components/graph/DetailPanel";

type View = { kind: "overview" } | { kind: "cluster"; clusterId: string };

export default function GraphPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "overview" });
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Load project list once.
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((ps: Project[]) => setProjects(ps))
      .catch(() => setProjects([]));
  }, []);

  // Pick projectId from ?projectId= on first load.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("projectId");
    if (q) setProjectId(q);
  }, []);

  const loadData = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError(null);
    setView({ kind: "overview" });
    setSelectedConceptId(null);
    try {
      const res = await fetch(`/api/concepts?projectId=${encodeURIComponent(id)}`);
      if (res.ok) setData(await res.json());
      else setLoadError("Could not load concept graph");
    } catch {
      setLoadError("Could not load concept graph");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (projectId) void loadData(projectId);
    else setData(null);
  }, [projectId, loadData]);

  const clusters: Cluster[] = useMemo(
    () => (data ? detectCommunities(data.concepts, data.edges) : []),
    [data],
  );
  const c2cluster = useMemo(() => conceptClusterMap(clusters), [clusters]);
  const clusterById = useMemo(() => new Map(clusters.map((c) => [c.id, c])), [clusters]);

  // Active-view edges + concept set passed to ConceptGraph.
  const active = useMemo(() => {
    if (!data) return { kind: "overview" as const, clusters: [] as Cluster[], concepts: [] as GraphConcept[], edges: [] as GraphEdge[] };
    if (view.kind === "overview") {
      // Inter-cluster edges: aggregate concept edges whose endpoints map to different clusters.
      const pair = new Map<string, GraphEdge & { weight: number }>();
      for (const e of data.edges) {
        const a = c2cluster.get(e.source);
        const b = c2cluster.get(e.target);
        if (!a || !b || a === b) continue;
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        const prev = pair.get(key);
        if (prev) prev.weight += 1;
        else pair.set(key, { ...e, weight: 1 });
      }
      return { kind: "overview" as const, clusters, concepts: [], edges: [...pair.values()] };
    }
    const cl = clusterById.get(view.clusterId);
    const memberSet = new Set(cl?.conceptIds ?? []);
    const concepts = data.concepts.filter((c) => memberSet.has(c.id));
    const edges = data.edges.filter((e) => memberSet.has(e.source) && memberSet.has(e.target));
    return { kind: "concept" as const, clusters, concepts, edges };
  }, [data, view, clusters, c2cluster, clusterById]);

  const selectedClusterName = useMemo(() => {
    if (view.kind !== "concept") return null;
    return clusterById.get(view.clusterId)?.name ?? null;
  }, [view, clusterById]);

  function handleNodeClick(id: string) {
    if (view.kind === "overview") {
      setView({ kind: "cluster", clusterId: id });
      setSelectedConceptId(null);
    } else {
      setSelectedConceptId(id);
    }
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const q = search.trim().toLowerCase();
    if (!q) return;
    const match = data.concepts.find((c) => c.label.toLowerCase().includes(q));
    if (!match) return;
    const cid = c2cluster.get(match.id);
    if (cid) setView({ kind: "cluster", clusterId: cid });
    setSelectedConceptId(match.id);
  }

  const hasGraph = !!data && data.concepts.length > 0;

  return (
    <div className="graph-paper min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink">
            ← Back to chat
          </Link>
          <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-feynman" />
            Concept graph
          </span>
        </div>

        <h1 className="mb-6 text-[1.6rem] leading-tight text-ink">Concept graph</h1>

        {/* Controls: project picker + view switch + search */}
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-line pb-4">
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="mono rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink/40"
          >
            <option value="">choose a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {view.kind === "cluster" && (
            <button
              onClick={() => {
                setView({ kind: "overview" });
                setSelectedConceptId(null);
              }}
              className="mono rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40"
            >
              ← overview
            </button>
          )}

          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="find a concept…"
              className="mono rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink/40"
            />
            <button
              type="submit"
              className="mono rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40"
            >
              find
            </button>
          </form>

          {data && hasGraph && (
            <span className="mono text-[11px] text-ink-3">
              {data.concepts.length} concepts · {data.edges.length} edges · {clusters.length} clusters
            </span>
          )}
        </div>

        {/* Body: graph + detail panel */}
        {!projectId ? (
          <p className="mono py-10 text-center text-[12px] text-ink-3">choose a project to view its concept graph</p>
        ) : loading ? (
          <p className="mono py-10 text-center text-[12px] text-ink-3">loading graph…</p>
        ) : loadError ? (
          <p className="mono py-10 text-center text-[12px] text-rule">{loadError}</p>
        ) : !hasGraph ? (
          <div className="mono py-10 text-center text-[12px] text-ink-3">
            no concept graph yet —{" "}
            <Link href="/projects" className="text-ink-2 underline">
              build one on /projects
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1fr_300px]">
            <ConceptGraph
              kind={active.kind}
              clusters={active.clusters}
              concepts={active.concepts}
              edges={active.edges}
              selectedId={selectedConceptId}
              onNodeClick={handleNodeClick}
            />
            <DetailPanel
              conceptId={selectedConceptId}
              clusterName={selectedClusterName}
              onSelectConcept={setSelectedConceptId}
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: clean; build lists `○ /graph` (static) or `ƒ /graph` (dynamic — either is fine for a client page).

- [ ] **Step 3: Commit (hold until authorized)**

```bash
git add app/graph/page.tsx
git commit -m "feat(graph): /graph page with overview + drill-down + detail panel (SP2)"
```

---

## Task 7: Final verification + smoke

- [ ] **Step 1: Full verify**

```bash
npx tsc --noEmit && npm run lint && npm run build
```
Expected: clean (only the pre-existing `lib/db` dynamic-fs build warning and `<img>` lint warnings).

- [ ] **Step 2: Confirm AGENTS.md intact**

```bash
git status --short AGENTS.md CLAUDE.md
```
Expected: empty (neither modified).

- [ ] **Step 3: Manual smoke (dev server + a built project)**

With `npm run dev`, Ollama not required for SP2 (no extraction here), and a project that already has a built graph (Maths `52807842-4f4d-4bd7-ab72-91d757f93f15` or `test` `fbf4f511-e8f0-40f2-b52b-227abf774d03`):

1. `/graph` with no `?projectId=` → "choose a project" prompt + project picker.
2. Pick "Maths" (or `?projectId=52807842-…`) → overview renders one node per community with heuristic names ("Eigenvalue · Eigenvector" etc.) + inter-cluster edges; header shows `404 concepts · 436 edges · N clusters`.
3. Click a cluster → expands to its concept nodes (force layout, hubs larger); "← overview" button returns.
4. Click a concept → right panel shows label, cluster name, description, provenance (material titles + chunk ordinals), neighbors. Clicking a neighbor pivots the selection.
5. Search a known concept (e.g. type part of a label) → its cluster auto-expands and the concept is selected.
6. Hover a node → non-neighbors dim; edge arrowheads + dashed `semantically_similar_to` edges visible. Hover an edge → its relation label (`prerequisite_of`, …) appears as a small mono tag at the midpoint.
7. Empty project (BigData, unbuilt) → "no concept graph yet — build one on /projects" with link; no crash.
8. Dark mode: nodes/edges/panel/controls readable; no new colors introduced (only ink/paper/rule/feynman/line).

- [ ] **Step 4: Commit (hold until authorized)** — only if smoke surfaces fixes.

```bash
git add -A
git commit -m "fix(graph): smoke-test adjustments (SP2)"
```

---

## Reused functions / files

- `GET /api/concepts?projectId=` (SP1, unchanged) — the graph data source.
- `lib/db/concepts.ts` (SP1) — extended with `getConceptDetail`; existing helpers untouched.
- `lib/db/index.ts` barrel — `export * from "./concepts"` auto-re-exports `getConceptDetail` + `ConceptDetail`.
- `app/api/projects` + `app/api/projects/[id]` (existing) — project picker data + the route-handler pattern to mirror.
- `app/projects/page.tsx` (SP1) — Graph Paper token + polling patterns referenced for visual consistency.
- `lib/db/schema.ts` types (`Project`) — unchanged.

## Critical files

- `lib/graph/clusters.ts`, `lib/graph/layout.ts`
- `lib/db/concepts.ts` (+ `ConceptDetail`), `app/api/concepts/[id]/route.ts`
- `components/graph/ConceptGraph.tsx`, `components/graph/DetailPanel.tsx`
- `app/graph/page.tsx`

## Notes for later sub-projects

- SP4 (mastery) will recolor concept nodes by mastery state using the existing accent tokens (`--feynman` known / `--ink-3` learning / `--rule` due). The SP2 fill (sourceCount ≥ 2) must yield to mastery fill then; keep degree as size. The `ConceptNodeData` shape is the integration point.
- If SP4 needs DB-keyed stable cluster ids, promote `detectCommunities` to server-side at extraction time; the `Cluster` interface here is written so a server-provided `clusterId` can replace the client label without changing the page.
- The detail panel's provenance list is the foundation for a future "jump to source" (open the material at that chunk) — left as a later enhancement.