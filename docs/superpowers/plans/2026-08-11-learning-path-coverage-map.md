# Learning Path & Coverage Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/graph` from a passive visualization into an active learning-path / coverage map: per-concept status (locked / ready / in-progress / mastered) over the `prerequisite_of` DAG, a "Next up" frontier panel, and a coverage header — all client-side, no backend changes.

**Architecture:** A new pure module `lib/graph/learning-path.ts` computes status, coverage, and frontier from data `/api/concepts` already returns (per-concept `band` + edges with `relation`). `GraphPage` calls it over the fetched `data` and feeds results to three surfaces: a coverage header, path-mode rendering in `ClusterOverview`, and a status overlay + "Next up" panel in the cluster drill-down. A "learning path" mode toggle (default on) switches path-mode styling on/off. Cytoscape node/edge status is applied in-place via class toggles (no relayout).

**Tech Stack:** Next.js (custom, per `AGENTS.md`), React, Cytoscape.js + fcose, `node --import tsx --test` (node:test + node:assert) for pure-module tests, ESLint, `tsc --noEmit`. Design tokens from `lib/graph/graph-tokens.ts` (`--rule` = accent/red, `--feynman` = strong/blue, `--ink3` = faint).

**Spec:** `docs/superpowers/specs/2026-08-11-learning-path-coverage-map-design.md`

## Global Constraints

- **Bands:** `Band = "strong" | "learning" | "slipping" | "untested" | "unknown"` (`lib/mastery/model.ts`). Treat `undefined` band as `"unknown"`.
- **Gating:** strict + transitive over `prerequisite_of` only. `part_of` / `generalizes` do NOT gate. Edge `source → target` means *source is needed for target* (C's prerequisites = sources of edges into C).
- **Statuses:** `"locked" | "ready" | "in_progress" | "mastered"`.
- **Mode toggle:** default **ON**; reset on project switch (in `loadData`).
- **No backend changes:** no new API routes, no DB/schema edits, no new fetches.
- **Pure module has no React/DB/DOM imports** (importable by a test).
- **Tests** use `node:test` + `node:assert/strict`, run via `node --import tsx --test <file>` (see existing `lib/mastery/model.test.ts`). UI tasks have no component-test infra in this repo — verify with `tsc --noEmit` + `eslint` + manual.
- **Studio Notebook tokens only** (no ad-hoc colors): `bg-accent`, `bg-border`, `text-content-faint`, `text-ink`, `text-content-muted`, `border-border`, `bg-surface`, `bg-surface-2`, `text-rule`, `text-feynman`. Mono labels use `className="mono ..."`.
- Commit only when the task's deliverable is green. End commit messages with `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

## File Structure

**New files:**
- `lib/graph/learning-path.ts` — pure: `ConceptStatus`, `computeStatuses`, `Coverage`, `computeCoverage`, `ClusterStatus`, `FrontierItem`, `computeClusterStatuses`. No React/DB/DOM.
- `lib/graph/learning-path.test.ts` — node:test unit tests for the above.
- `components/graph/NextUpPanel.tsx` — the per-cluster frontier list, stacked above `DetailPanel` in the drill-down right column (path mode only).

**Modified files:**
- `package.json` — add `test:learning-path` script.
- `lib/graph/graph-tokens.ts` — add Cytoscape stylesheet selectors for `node.status-ready`, `node.status-locked`, `node.status-mastered`, `edge.path-backbone`, `edge.path-faded`.
- `components/graph/ConceptGraph.tsx` — new props `statuses`, `pathMode`; new effect applying status/path classes in-place.
- `components/graph/ClusterOverview.tsx` — path-mode rendering (status bar, coverage %, start-here, complete/blocked badges).
- `app/(app)/graph/page.tsx` — mode toggle state, compute statuses/cluster-statuses, coverage header, pass props down, reset in `loadData`.

---

## Task 1: Status computation (pure module, TDD)

**Files:**
- Create: `lib/graph/learning-path.ts`
- Create: `lib/graph/learning-path.test.ts`
- Modify: `package.json` (add test script)

**Interfaces:**
- Produces:
  ```ts
  export type ConceptStatus = "locked" | "ready" | "in_progress" | "mastered";
  export function computeStatuses(
    concepts: { id: string; band?: Band }[],
    edges: { source: string; target: string; relation: string }[],
  ): Map<string, ConceptStatus>;
  ```

- [ ] **Step 1: Add the test script to package.json**

In `package.json`, add to `"scripts"` (after `"test:retrieval"`):
```json
"test:learning-path": "node --import tsx --test lib/graph/learning-path.test.ts"
```

- [ ] **Step 2: Write the failing tests**

Create `lib/graph/learning-path.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatuses } from "./learning-path";

// Helper: build concepts with bands and prerequisite_of edges concisely.
// prereqs: entries of "P->C" mean P is a prerequisite_of C (P needed for C).
function fixture(opts: {
  bands: Record<string, "strong" | "learning" | "slipping" | "untested" | "unknown">;
  prereqs?: string[]; // "P->C"
  edges?: { source: string; target: string; relation: string }[];
}) {
  const concepts = Object.entries(opts.bands).map(([id, band]) => ({ id, band }));
  const edges = [
    ...(opts.prereqs ?? []).map((e) => {
      const [source, target] = e.split("->");
      return { source, target, relation: "prerequisite_of" };
    }),
    ...(opts.edges ?? []),
  ];
  return { concepts, edges };
}

test("mastered: band strong", () => {
  const { concepts, edges } = fixture({ bands: { a: "strong" } });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("a"), "mastered");
});

test("in_progress overrides ready: learning band with mastered prereq", () => {
  const { concepts, edges } = fixture({ bands: { p: "strong", c: "learning" }, prereqs: ["p->c"] });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("c"), "in_progress");
});

test("in_progress overrides ready: slipping band", () => {
  const { concepts, edges } = fixture({ bands: { c: "slipping" } });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("c"), "in_progress");
});

test("ready: no prereqs and untested", () => {
  const { concepts, edges } = fixture({ bands: { a: "untested" } });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("a"), "ready");
});

test("ready: no prereqs and unknown band", () => {
  const { concepts, edges } = fixture({ bands: { a: "unknown" } });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("a"), "ready");
});

test("ready: all direct prereqs mastered", () => {
  const { concepts, edges } = fixture({ bands: { p: "strong", q: "strong", c: "untested" }, prereqs: ["p->c", "q->c"] });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("c"), "ready");
});

test("locked: a direct prereq is not mastered", () => {
  const { concepts, edges } = fixture({ bands: { p: "learning", c: "untested" }, prereqs: ["p->c"] });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("c"), "locked");
});

test("gating is transitive: chain p->q->c, p mastered, q not", () => {
  const { concepts, edges } = fixture({ bands: { p: "strong", q: "untested", c: "untested" }, prereqs: ["p->q", "q->c"] });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("q"), "ready");
  assert.equal(s.get("c"), "locked");
});

test("transitive chain fully mastered unlocks the end", () => {
  const { concepts, edges } = fixture({ bands: { p: "strong", q: "strong", c: "untested" }, prereqs: ["p->q", "q->c"] });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("c"), "ready");
});

test("diamond: c depends on p and q, both needed", () => {
  const { concepts, edges } = fixture({ bands: { p: "strong", q: "untested", c: "untested" }, prereqs: ["p->c", "q->c"] });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("c"), "locked");
});

test("part_of does NOT gate", () => {
  const { concepts, edges } = fixture({
    bands: { p: "learning", c: "untested" },
    edges: [{ source: "p", target: "c", relation: "part_of" }],
  });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("c"), "ready");
});

test("generalizes does NOT gate", () => {
  const { concepts, edges } = fixture({
    bands: { p: "learning", c: "untested" },
    edges: [{ source: "p", target: "c", relation: "generalizes" }],
  });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("c"), "ready");
});

test("undefined band treated as unknown -> ready when no prereqs", () => {
  const concepts = [{ id: "a" }]; // no band
  const s = computeStatuses(concepts, []);
  assert.equal(s.get("a"), "ready");
});

test("cycle: unmastered cycle members stay locked", () => {
  const { concepts, edges } = fixture({ bands: { a: "untested", b: "untested" }, prereqs: ["a->b", "b->a"] });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("a"), "locked");
  assert.equal(s.get("b"), "locked");
});

test("cycle: unlocks together when all mastered", () => {
  const { concepts, edges } = fixture({ bands: { a: "strong", b: "strong" }, prereqs: ["a->b", "b->a"] });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("a"), "mastered");
  assert.equal(s.get("b"), "mastered");
});

test("isolated concept (no edges) is ready unless mastered", () => {
  const { concepts, edges } = fixture({ bands: { a: "untested", b: "strong" } });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("a"), "ready");
  assert.equal(s.get("b"), "mastered");
});

test("no prerequisite_of edges at all: every unmastered concept ready", () => {
  const { concepts, edges } = fixture({
    bands: { a: "untested", b: "learning", c: "strong" },
    edges: [{ source: "a", target: "b", relation: "contrasts_with" }],
  });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("a"), "ready");
  assert.equal(s.get("b"), "in_progress");
  assert.equal(s.get("c"), "mastered");
});

test("self-loop prereq ignored (not a real dependency)", () => {
  const { concepts, edges } = fixture({ bands: { a: "untested" }, prereqs: ["a->a"] });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("a"), "ready");
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm run test:learning-path`
Expected: FAIL — module `./learning-path` has no exported `computeStatuses` (import resolves to nothing / `undefined is not a function`).

- [ ] **Step 4: Implement `computeStatuses`**

Create `lib/graph/learning-path.ts`:
```ts
// Pure learning-path computation for the concept graph: per-concept status over
// the prerequisite_of DAG, coverage metrics, and the per-cluster frontier.
// No React, no DB, no DOM — importable by a throwaway test. All inputs are
// already returned by GET /api/concepts (per-concept band + edges with relation).

import type { Band } from "@/lib/mastery/model";

export type ConceptStatus = "locked" | "ready" | "in_progress" | "mastered";

// A concept's status:
//   mastered    — band "strong"
//   in_progress — band "learning" or "slipping" (active study overrides "ready")
//   ready       — not mastered/in-progress AND every transitive prerequisite_of
//                 ancestor is mastered (strict, transitive gating)
//   locked      — otherwise (some ancestor isn't mastered)
// prerequisite_of direction: edge source->target means source is needed for
// target, so C's prerequisites are the sources of prerequisite_of edges into
// C. part_of / generalizes do NOT gate (containment/abstraction, not needed-
// before). Self-loops are ignored. Cycles: an unmastered cycle's members stay
// locked (each member's ancestor set includes the cycle), unlocking together.
export function computeStatuses(
  concepts: { id: string; band?: Band }[],
  edges: { source: string; target: string; relation: string }[],
): Map<string, ConceptStatus> {
  // Prereq adjacency: for each concept C, the set of direct prerequisites
  // (sources of prerequisite_of edges into C). Self-loops skipped.
  const prereqs = new Map<string, Set<string>>();
  for (const c of concepts) prereqs.set(c.id, new Set());
  for (const e of edges) {
    if (e.relation !== "prerequisite_of") continue;
    if (e.source === e.target) continue;
    if (!prereqs.has(e.target) || !prereqs.has(e.source)) continue;
    prereqs.get(e.target)!.add(e.source);
  }

  // Mastered set (band strong). Used as the gating gate.
  const mastered = new Set<string>();
  for (const c of concepts) {
    if (c.band === "strong") mastered.add(c.id);
  }

  const status = new Map<string, ConceptStatus>();
  const memo = new Map<string, ConceptStatus>();

  // Are all transitive prereq ancestors of C mastered? visited guards cycles.
  function ancestorsMastered(id: string, visited: Set<string>): boolean {
    if (memo.has(id)) return memo.get(id) === "ready";
    if (visited.has(id)) {
      // Cycle: treat the revisit as "not yet known mastered" — only ready if
      // the node itself is mastered (handled by caller). Conservative: false.
      return false;
    }
    visited.add(id);
    for (const p of prereqs.get(id) ?? []) {
      if (!mastered.has(p)) {
        // p not mastered — but p might still be "ready"? No: ready requires
        // mastered ancestors, and p isn't mastered, so p is not a satisfied
        // prerequisite. Strict gating: not satisfied.
        visited.delete(id);
        memo.set(id, "locked");
        return false;
      }
      // p is mastered; its own ancestors must also be mastered (transitive).
      if (!ancestorsMastered(p, visited)) {
        visited.delete(id);
        memo.set(id, "locked");
        return false;
      }
    }
    visited.delete(id);
    memo.set(id, "ready");
    return true;
  }

  for (const c of concepts) {
    if (c.band === "strong") {
      status.set(c.id, "mastered");
      continue;
    }
    if (c.band === "learning" || c.band === "slipping") {
      status.set(c.id, "in_progress");
      continue;
    }
    // untested / unknown / undefined → check prereqs (strict, transitive).
    const ok = ancestorsMastered(c.id, new Set());
    status.set(c.id, ok ? "ready" : "locked");
  }
  return status;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:learning-path`
Expected: PASS (all 18 tests).

- [ ] **Step 6: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint lib/graph/learning-path.ts lib/graph/learning-path.test.ts`
Expected: no output (clean).

- [ ] **Step 7: Commit**

```bash
git add lib/graph/learning-path.ts lib/graph/learning-path.test.ts package.json
git commit -m "$(cat <<'EOF'
feat(graph): per-concept status over prerequisite_of DAG

Pure computeStatuses: mastered/in_progress/ready/locked with strict
transitive gating over prerequisite_of edges. part_of/generalizes do
not gate. Cycle-safe. No React/DB/DOM.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Coverage, cluster statuses, and frontier (pure module, TDD)

**Files:**
- Modify: `lib/graph/learning-path.ts` (add functions)
- Modify: `lib/graph/learning-path.test.ts` (add tests)

**Interfaces:**
- Consumes: `computeStatuses` from Task 1; `Cluster` from `@/lib/graph/clusters`.
- Produces:
  ```ts
  export interface Coverage {
    total: number; mastered: number; ready: number; inProgress: number; locked: number;
    percent: number; // 0..100, 0 when total === 0
  }
  export function computeCoverage(statuses: Map<string, ConceptStatus>): Coverage;

  export interface FrontierItem { conceptId: string; label: string; dependents: number; }
  export interface ClusterStatus {
    clusterId: string;
    coverage: Coverage;
    complete: boolean;   // 0 ready/locked/inProgress
    blocked: boolean;    // locked > 0 AND ready === 0
    startHere: string | null;       // top frontier concept id, or null
    startHereLabel: string | null;
    frontier: FrontierItem[];        // ready concepts, ranked
  }
  export function computeClusterStatuses(
    clusters: Cluster[],
    statuses: Map<string, ConceptStatus>,
    edges: { source: string; target: string; relation: string }[],
    labelById: Map<string, string>,
  ): ClusterStatus[];
  ```

- [ ] **Step 1: Write the failing tests**

Append to `lib/graph/learning-path.test.ts`:
```ts
import { computeCoverage, computeClusterStatuses } from "./learning-path";
import type { Cluster } from "./clusters";

function statusesMap(entries: Record<string, import("./learning-path").ConceptStatus>) {
  return new Map(Object.entries(entries));
}

test("computeCoverage: counts and percent", () => {
  const s = statusesMap({ a: "mastered", b: "ready", c: "locked", d: "in_progress", e: "mastered" });
  const cov = computeCoverage(s);
  assert.equal(cov.total, 5);
  assert.equal(cov.mastered, 2);
  assert.equal(cov.ready, 1);
  assert.equal(cov.locked, 1);
  assert.equal(cov.inProgress, 1);
  assert.equal(cov.percent, 40);
});

test("computeCoverage: empty -> 0 percent, no NaN", () => {
  const cov = computeCoverage(new Map());
  assert.equal(cov.total, 0);
  assert.equal(cov.percent, 0);
});

const CLUSTERS: Cluster[] = [
  { id: "c1", name: "Cluster 1", conceptCount: 4, conceptIds: ["a", "b", "c", "d"] },
  { id: "c2", name: "Cluster 2", conceptCount: 2, conceptIds: ["e", "f"] },
];
const LABELS = new Map([["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"], ["e", "E"], ["f", "F"]]);

test("cluster complete: all mastered", () => {
  const s = statusesMap({ a: "mastered", b: "mastered", c: "mastered", d: "mastered", e: "ready", f: "locked" });
  const cs = computeClusterStatuses(CLUSTERS, s, [], LABELS);
  const c1 = cs.find((x) => x.clusterId === "c1")!;
  assert.equal(c1.complete, true);
  assert.equal(c1.blocked, false);
  assert.equal(c1.startHere, null);
  assert.deepEqual(c1.frontier, []);
});

test("cluster blocked: locked>0 and ready===0", () => {
  const s = statusesMap({ a: "mastered", b: "mastered", c: "locked", d: "locked", e: "ready", f: "locked" });
  const cs = computeClusterStatuses(CLUSTERS, s, [], LABELS);
  const c2 = cs.find((x) => x.clusterId === "c2")!;
  assert.equal(c2.blocked, false); // e is ready, so not blocked
  const c1 = cs.find((x) => x.clusterId === "c1")!;
  assert.equal(c1.blocked, true);
});

test("frontier ranked by prerequisite_of out-degree desc, then label asc", () => {
  // a is prereq of 2, b is prereq of 1, d is prereq of 0. a,b,d ready.
  const edges = [
    { source: "a", target: "x", relation: "prerequisite_of" },
    { source: "a", target: "y", relation: "prerequisite_of" },
    { source: "b", target: "z", relation: "prerequisite_of" },
    { source: "a", target: "x", relation: "contrasts_with" }, // peer, not counted
  ];
  const s = statusesMap({ a: "ready", b: "ready", c: "locked", d: "ready" });
  const cs = computeClusterStatuses(CLUSTERS, s, edges, LABELS);
  const c1 = cs.find((x) => x.clusterId === "c1")!;
  assert.deepEqual(c1.frontier.map((f) => f.conceptId), ["a", "b", "d"]);
  assert.equal(c1.frontier[0].dependents, 2);
  assert.equal(c1.frontier[1].dependents, 1);
  assert.equal(c1.frontier[2].dependents, 0);
  assert.equal(c1.startHere, "a");
  assert.equal(c1.startHereLabel, "A");
});

test("frontier excludes non-ready concepts", () => {
  const s = statusesMap({ a: "mastered", b: "in_progress", c: "locked", d: "ready" });
  const cs = computeClusterStatuses(CLUSTERS, s, [], LABELS);
  const c1 = cs.find((x) => x.clusterId === "c1")!;
  assert.deepEqual(c1.frontier.map((f) => f.conceptId), ["d"]);
});

test("frontier tie on dependents breaks by total degree then label asc", () => {
  // b and d both have 0 prerequisite_of out-degree. b has a peer edge (degree 1), d degree 0.
  const edges = [{ source: "b", target: "a", relation: "contrasts_with" }];
  const s = statusesMap({ a: "mastered", b: "ready", c: "locked", d: "ready" });
  const cs = computeClusterStatuses(CLUSTERS, s, edges, LABELS);
  const c1 = cs.find((x) => x.clusterId === "c1")!;
  // b (degree 1) before d (degree 0)
  assert.deepEqual(c1.frontier.map((f) => f.conceptId), ["b", "d"]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:learning-path`
Expected: FAIL — `computeCoverage` / `computeClusterStatuses` not exported.

- [ ] **Step 3: Implement coverage + cluster statuses**

Append to `lib/graph/learning-path.ts`:
```ts
import type { Cluster } from "@/lib/graph/clusters";

export interface Coverage {
  total: number;
  mastered: number;
  ready: number;
  inProgress: number;
  locked: number;
  percent: number; // 0..100; 0 when total === 0
}

export function computeCoverage(statuses: Map<string, ConceptStatus>): Coverage {
  let mastered = 0, ready = 0, inProgress = 0, locked = 0;
  for (const st of statuses.values()) {
    if (st === "mastered") mastered++;
    else if (st === "ready") ready++;
    else if (st === "in_progress") inProgress++;
    else locked++;
  }
  const total = mastered + ready + inProgress + locked;
  return {
    total, mastered, ready, inProgress, locked,
    percent: total === 0 ? 0 : Math.round((mastered / total) * 100),
  };
}

export interface FrontierItem {
  conceptId: string;
  label: string;
  dependents: number; // out-degree in prerequisite_of
}

export interface ClusterStatus {
  clusterId: string;
  coverage: Coverage;
  complete: boolean; // 0 ready/locked/inProgress
  blocked: boolean;  // locked > 0 AND ready === 0
  startHere: string | null;
  startHereLabel: string | null;
  frontier: FrontierItem[]; // ready concepts, ranked
}

// Per-cluster coverage, flags, and ranked frontier. Ranking within a cluster:
// prerequisite_of out-degree desc (most-foundational first), tiebreak by total
// degree desc, then label asc. The top ready concept is the cluster's "start
// here" entrypoint.
export function computeClusterStatuses(
  clusters: Cluster[],
  statuses: Map<string, ConceptStatus>,
  edges: { source: string; target: string; relation: string }[],
  labelById: Map<string, string>,
): ClusterStatus[] {
  // prerequisite_of out-degree and total degree per concept.
  const prereqOut = new Map<string, number>();
  const totalDeg = new Map<string, number>();
  for (const e of edges) {
    if (e.source === e.target) continue;
    totalDeg.set(e.source, (totalDeg.get(e.source) ?? 0) + 1);
    totalDeg.set(e.target, (totalDeg.get(e.target) ?? 0) + 1);
    if (e.relation === "prerequisite_of") {
      prereqOut.set(e.source, (prereqOut.get(e.source) ?? 0) + 1);
    }
  }

  return clusters.map((cl) => {
    const clusterStatuses = cl.conceptIds.map((id) => statuses.get(id)).filter(Boolean) as ConceptStatus[];
    const coverage = computeCoverage(new Map(cl.conceptIds.map((id, i) => [id, clusterStatuses[i]])));

    const readyIds = cl.conceptIds.filter((id) => statuses.get(id) === "ready");
    const frontier: FrontierItem[] = readyIds
      .map((id) => ({
        conceptId: id,
        label: labelById.get(id) ?? id,
        dependents: prereqOut.get(id) ?? 0,
      }))
      .sort((a, b) => {
        if (b.dependents !== a.dependents) return b.dependents - a.dependents;
        const da = totalDeg.get(a.conceptId) ?? 0;
        const db = totalDeg.get(b.conceptId) ?? 0;
        if (db !== da) return db - da;
        return a.label.localeCompare(b.label);
      });

    return {
      clusterId: cl.id,
      coverage,
      complete: coverage.ready === 0 && coverage.locked === 0 && coverage.inProgress === 0,
      blocked: coverage.locked > 0 && coverage.ready === 0,
      startHere: frontier[0]?.conceptId ?? null,
      startHereLabel: frontier[0]?.label ?? null,
      frontier,
    };
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:learning-path`
Expected: PASS (all tests, including Task 1's).

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint lib/graph/learning-path.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/graph/learning-path.ts lib/graph/learning-path.test.ts
git commit -m "$(cat <<'EOF'
feat(graph): coverage metrics + per-cluster frontier

computeCoverage (counts + percent) and computeClusterStatuses
(complete/blocked flags, ranked ready frontier by prerequisite_of
out-degree, start-here entrypoint). Pure.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Cytoscape status + path stylesheet selectors

**Files:**
- Modify: `lib/graph/graph-tokens.ts` (add stylesheet blocks)

**Interfaces:**
- Produces: stylesheet selectors `node.status-ready`, `node.status-locked`, `node.status-mastered`, `edge.path-backbone`, `edge.path-faded` (applied by Task 4 via class toggles). No new JS exports.

- [ ] **Step 1: Add status node selectors**

In `lib/graph/graph-tokens.ts`, inside `buildCytoscapeStyle`'s `blocks` array, insert these blocks immediately **after** the `node.band-unknown` block (line 93) and **before** the `node:selected, node.hovered` block:

```ts
    // --- Learning-path status (applied in-place via class toggles) ----------
    // Path mode only. Status overrides band border. Order: after band, before
    // selected/hovered so selection still wins; dimmed (hover) is later still.
    // ready: accent rule border, thicker, raised — the "this is next" signal.
    { selector: "node.status-ready", style: { "border-color": t.rule, "border-width": 3, "z-index": 50 } },
    // locked: dashed faint border, muted — prereqs not met.
    { selector: "node.status-locked", style: { "border-color": t.ink3, "border-style": "dashed", opacity: 0.4 } },
    // mastered: strong feynman border, thicker — "done".
    { selector: "node.status-mastered", style: { "border-color": t.feynman, "border-width": 3 } },
    // (in_progress has no status class — the existing learning/slipping band
    //  border already signals "active".)
```

- [ ] **Step 2: Add path edge selectors**

In the same `blocks` array, insert these immediately **after** the `edge.hierarchical` block (line ~126) and **before** the `edge.sem-sim` block:

```ts
    // --- Learning-path edge emphasis (path mode only) ----------------------
    // Backbone: prerequisite_of edges read through (strong, opaque). Applied
    // to hierarchical edges in path mode via a `path-backbone` class.
    { selector: "edge.path-backbone", style: { width: 2.2, "line-color": t.ink, "line-opacity": 1, "target-arrow-color": t.ink } },
    // Peer edges fade further in path mode so the DAG reads through.
    { selector: "edge.path-faded", style: { "line-opacity": 0.12 } },
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint lib/graph/graph-tokens.ts`
Expected: clean (the cast `blocks as unknown as StylesheetJson` still holds).

- [ ] **Step 4: Commit**

```bash
git add lib/graph/graph-tokens.ts
git commit -m "$(cat <<'EOF'
feat(graph): cytoscape status + path-mode edge selectors

node.status-ready/locked/mastered borders and edge.path-backbone/
path-faded for the learning-path overlay. Applied in-place via class
toggles in the next commit.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: ConceptGraph in-place status + path class application

**Files:**
- Modify: `components/graph/ConceptGraph.tsx`

**Interfaces:**
- Consumes: `ConceptStatus` from `@/lib/graph/learning-path`.
- Produces: `ConceptGraph` accepts new optional props `statuses?: Map<string, ConceptStatus> | null` and `pathMode?: boolean` and applies them in-place (no relayout).

- [ ] **Step 1: Add imports + props**

In `components/graph/ConceptGraph.tsx`:

Add to the existing `@/lib/graph/...` import group (near line 21-23):
```ts
import type { ConceptStatus } from "@/lib/graph/learning-path";
```

Extend `ConceptGraphProps` (add after `showAmbiguous: boolean;`):
```ts
  // Learning-path overlay (path mode): per-concept status applied to nodes
  // in-place, prerequisite_of edges emphasized, peer edges faded. Null/off
  // clears the classes. Applied via a dedicated effect (not the elements
  // useMemo) so a status flip after a review doesn't trigger a relayout.
  statuses?: Map<string, ConceptStatus> | null;
  pathMode?: boolean;
```

Destructure them (add to the existing destructure, after `showAmbiguous`):
```ts
  statuses = null,
  pathMode = false,
```

- [ ] **Step 2: Add the in-place class application effect**

Insert a new `useEffect` immediately **after** the selection-reflect effect (the one keyed on `[selectedId]`, ending around line 250) and **before** the Esc-fullscreen effect:

```ts
  // Apply learning-path status to nodes + path-mode edge emphasis in place.
  // Kept out of the elements useMemo so a status flip (e.g. after a review
  // changes mastery) updates classes without rebuilding elements / relaying
  // out. Nodes get status-<status>; in_progress has no class (band already
  // signals it). In path mode, prerequisite_of (hierarchical) edges get
  // path-backbone and peer edges get path-faded; both cleared when path mode
  // is off.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((n) => {
      n.removeClass("status-ready status-locked status-mastered");
      if (!pathMode || !statuses) return;
      const st = statuses.get(n.id());
      if (st === "ready") n.addClass("status-ready");
      else if (st === "locked") n.addClass("status-locked");
      else if (st === "mastered") n.addClass("status-mastered");
      // in_progress: no class (band border shows).
    });
    cy.edges().forEach((e) => {
      e.removeClass("path-backbone path-faded");
      if (!pathMode) return;
      // The `hierarchical` class was assigned at element-build time for
      // prerequisite_of/part_of/generalizes. Only prerequisite_of is the
      // backbone; fade everything else (peer edges) in path mode.
      if (e.data("relation") === "prerequisite_of") e.addClass("path-backbone");
      else e.addClass("path-faded");
    });
  }, [statuses, pathMode]);
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/graph/ConceptGraph.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/graph/ConceptGraph.tsx
git commit -m "$(cat <<'EOF'
feat(graph): apply learning-path status + path edge classes in place

ConceptGraph accepts statuses + pathMode and toggles status-*/path-
backbone/path-faded classes on existing elements (no relayout) so a
mastery flip after review updates the overlay without rebuilding.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: NextUpPanel component (per-cluster frontier)

**Files:**
- Create: `components/graph/NextUpPanel.tsx`

**Interfaces:**
- Consumes: `FrontierItem`, `ClusterStatus` from `@/lib/graph/learning-path`.
- Produces: `NextUpPanel({ clusterStatus, onSelect })` — renders the cluster's frontier list or an empty state.

- [ ] **Step 1: Create the component**

Create `components/graph/NextUpPanel.tsx`:
```tsx
"use client";

// The "Next up" frontier panel for the cluster drill-down (learning-path mode
// only). Lists the cluster's READY concepts ranked by prerequisite_of
// out-degree (most-foundational first), each clickable to select + center the
// concept. Stacked above DetailPanel in the right column. Empty states cover
// "cluster complete" and "blocked (prerequisites in another cluster)".

import { Check, Lock } from "lucide-react";
import type { ClusterStatus } from "@/lib/graph/learning-path";
import { Card } from "@/components/ui/Card";

interface NextUpPanelProps {
  clusterStatus: ClusterStatus | null;
  onSelect: (conceptId: string) => void;
}

export function NextUpPanel({ clusterStatus, onSelect }: NextUpPanelProps) {
  if (!clusterStatus) return null;

  const title = (
    <div className="mono mb-2 text-[10px] tracking-wide text-content-faint">NEXT UP</div>
  );

  if (clusterStatus.complete) {
    return (
      <Card className="p-4">
        {title}
        <div className="mono flex items-center gap-1.5 text-[12px] text-content-muted">
          <Check size={12} className="text-feynman" />
          cluster complete
        </div>
      </Card>
    );
  }

  if (clusterStatus.frontier.length === 0) {
    // Has unmastered concepts but none ready → blocked (prereqs live elsewhere).
    return (
      <Card className="p-4">
        {title}
        <div className="mono flex items-center gap-1.5 text-[12px] text-content-muted">
          <Lock size={12} className="text-content-faint" />
          blocked — prerequisites in another cluster
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      {title}
      <ul className="flex flex-col gap-1">
        {clusterStatus.frontier.map((f) => (
          <li key={f.conceptId}>
            <button
              onClick={() => onSelect(f.conceptId)}
              className="mono flex w-full items-center gap-2 truncate text-left text-[11px] text-content-muted hover:text-ink"
              title={`${f.label} · ${f.dependents} depend on this`}
            >
              <span className="truncate text-ink">{f.label}</span>
              <span className="shrink-0 text-content-faint">· {f.dependents} depend</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/graph/NextUpPanel.tsx`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add components/graph/NextUpPanel.tsx
git commit -m "$(cat <<'EOF'
feat(graph): NextUpPanel — per-cluster ready frontier

Renders the cluster's READY concepts ranked by prerequisite_of
out-degree, with complete/blocked empty states. Stacked above
DetailPanel in the drill-down right column (path mode).

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ClusterOverview path-mode rendering

**Files:**
- Modify: `components/graph/ClusterOverview.tsx`

**Interfaces:**
- Consumes: `ClusterStatus` from `@/lib/graph/learning-path`.
- Produces: `ClusterOverview` accepts optional `clusterStatuses?: Map<string, ClusterStatus> | null` and `pathMode?: boolean`; in path mode renders a status bar, coverage %, start-here entrypoint, and complete/blocked badges. Normal mode unchanged.

- [ ] **Step 1: Add imports + props**

In `components/graph/ClusterOverview.tsx`:

The existing import is `import { ArrowRight } from "lucide-react";` (line 7). Replace it with:
```ts
import { ArrowRight, Check, Lock } from "lucide-react";
import type { ClusterStatus } from "@/lib/graph/learning-path";
```

Extend `ClusterOverviewProps` (add after `onSelectCluster: (clusterId: string) => void;`):
```ts
  // Learning-path mode: when on, cards render a status bar + coverage % +
  // start-here entrypoint + complete/blocked badges instead of the mastery
  // band bar. clusterStatuses keyed by cluster id.
  clusterStatuses?: Map<string, ClusterStatus> | null;
  pathMode?: boolean;
  // Drill into a cluster and select its start-here concept (top ready concept).
  onSelectStartHere?: (clusterId: string, conceptId: string) => void;
```

Destructure them in the function signature:
```ts
export function ClusterOverview({
  clusters,
  masteryByCluster,
  externalLinksByCluster,
  degreeMap,
  labelById,
  onSelectCluster,
  clusterStatuses = null,
  pathMode = false,
  onSelectStartHere,
}: ClusterOverviewProps) {
```

- [ ] **Step 2: Render path-mode card content**

In the `clusters.map((cluster) => { ... })` body, compute the path-mode data and branch the bar/footer. Replace the existing mastery-bar block (the `SEGMENTS`-driven `{segments.map(...)}` bar + the `{cm.strong}S ...` caption) with a conditional that renders the **status bar** when `pathMode && clusterStatus`, else the existing mastery bar.

At the top of the `clusters.map` callback, add (after the existing `const cm = ...` / `const reps = ...` / `const external = ...` lines):
```ts
        const cs = pathMode ? clusterStatuses?.get(cluster.id) ?? null : null;
        const statusSegs: Array<{ className: string; pct: number }> = [];
        if (cs) {
          const total = cs.coverage.total;
          if (total > 0) {
            const push = (count: number, cls: string) => {
              if (count > 0) statusSegs.push({ className: cls, pct: (count / total) * 100 });
            };
            push(cs.coverage.mastered, "bg-feynman");
            push(cs.coverage.inProgress, "bg-band-learning");
            push(cs.coverage.ready, "bg-rule");
            push(cs.coverage.locked, "bg-content-faint/40");
          }
        }
```

Replace the mastery bar block:
```tsx
            {/* Mastery stacked bar. Empty track rendered when total === 0. */}
            <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-2">
              {segments.map((seg, i) => (
                <div
                  key={i}
                  className={seg.className}
                  style={{ width: `${seg.pct}%` }}
                />
              ))}
            </div>
            <div className="mono mt-1.5 text-[10px] text-content-faint">
              {cm.strong}S {cm.learning}L {cm.slipping} slip {un} un
            </div>
```
with:
```tsx
            {/* Path mode: status bar (mastered/in-progress/ready/locked) +
                coverage % + start-here + flags. Normal mode: mastery band bar. */}
            {pathMode && cs ? (
              <>
                <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-2">
                  {statusSegs.map((seg, i) => (
                    <div key={i} className={seg.className} style={{ width: `${seg.pct}%` }} />
                  ))}
                </div>
                <div className="mono mt-1.5 flex items-center gap-2 text-[10px] text-content-faint">
                  <span>{cs.coverage.percent}% · {cs.coverage.ready} ready</span>
                  {cs.complete && <span className="text-feynman">✓ complete</span>}
                  {cs.blocked && <span className="text-content-faint">· locked</span>}
                </div>
                {cs.startHere && cs.startHereLabel && onSelectStartHere ? (
                  <button
                    onClick={() => onSelectStartHere(cluster.id, cs.startHere!)}
                    className="mono mt-2 flex w-full items-center gap-1 truncate rounded-[3px] border border-border bg-surface px-2 py-1 text-left text-[11px] text-content-muted transition-colors hover:border-border-strong hover:text-ink"
                  >
                    <span className="shrink-0 text-rule">start here:</span>
                    <span className="truncate text-ink">{cs.startHereLabel}</span>
                  </button>
                ) : null}
              </>
            ) : (
              <>
                <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-[2px] bg-surface-2">
                  {segments.map((seg, i) => (
                    <div key={i} className={seg.className} style={{ width: `${seg.pct}%` }} />
                  ))}
                </div>
                <div className="mono mt-1.5 text-[10px] text-content-faint">
                  {cm.strong}S {cm.learning}L {cm.slipping} slip {un} un
                </div>
              </>
            )}
```

Add a small lock badge to the representative-concepts block when blocked (optional scannability). After the `{reps.map(...)}` block, add:
```tsx
            {pathMode && cs?.blocked && (
              <div className="mono mt-1 flex items-center gap-1 text-[10px] text-content-faint">
                <Lock size={10} /> prerequisites needed
              </div>
            )}
```

- [ ] **Step 3: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/graph/ClusterOverview.tsx`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add components/graph/ClusterOverview.tsx
git commit -m "$(cat <<'EOF'
feat(graph): ClusterOverview path-mode — status bar + start here

In learning-path mode, cluster cards show a mastered/in-progress/
ready/locked status bar, coverage %, a 'start here' entrypoint (top
ready concept), and complete/locked badges. Normal mode unchanged.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: GraphPage wiring (toggle, compute, header, pass-down, reset)

**Files:**
- Modify: `app/(app)/graph/page.tsx`

**Interfaces:**
- Consumes: `computeStatuses`, `computeCoverage`, `computeClusterStatuses` from `@/lib/graph/learning-path`; `NextUpPanel` from Task 5; `ConceptStatus` type.
- Produces: the wired `/graph` page — mode toggle (default on), coverage header, status overlay on the canvas, Next-up panel above DetailPanel, reset on project switch.

- [ ] **Step 1: Add imports**

In `app/(app)/graph/page.tsx`, add to the imports near the other `@/lib/graph/...` and component imports:
```ts
import {
  computeStatuses,
  computeCoverage,
  computeClusterStatuses,
  type ConceptStatus,
  type ClusterStatus,
} from "@/lib/graph/learning-path";
import { NextUpPanel } from "@/components/graph/NextUpPanel";
```
Add a `Compass` icon to the existing `lucide-react` import (for the mode toggle label): change the line `import { ChevronLeft, Maximize2, Search, Share2 } from "lucide-react";` to `import { ChevronLeft, Compass, Maximize2, Search, Share2 } from "lucide-react";`.

- [ ] **Step 2: Add mode state + reset**

In the state block (near `const [showAmbiguous, setShowAmbiguous] = useState(false);`), add:
```ts
  // Learning-path mode (default on — the graph should be useful by default).
  // Reset on project switch so a stale overlay doesn't survive a reload.
  const [pathMode, setPathMode] = useState(true);
```
In `loadData` (the `useCallback`), add to the reset block alongside the other `set*` resets:
```ts
    setPathMode(true);
```

- [ ] **Step 3: Compute statuses + coverage + cluster statuses**

After the `clusters`/`c2cluster`/`clusterById` memos and after `labelById` (around line 152), add:
```ts
  // Learning-path: status per concept (strict transitive prerequisite_of
  // gating), global coverage, and per-cluster status/frontier. All client-side
  // from data /api/concepts already returns. Recomputed when data or clusters
  // change — so after a review, the next graph load reflects new mastery.
  const statuses = useMemo(
    () => (data ? computeStatuses(data.concepts, data.edges) : new Map<string, ConceptStatus>()),
    [data],
  );
  const coverage = useMemo(() => computeCoverage(statuses), [statuses]);
  const clusterStatuses = useMemo(
    () => (data ? computeClusterStatuses(clusters, statuses, data.edges, labelById) : []),
    [clusters, statuses, data, labelById],
  );
  const clusterStatusById = useMemo(
    () => new Map(clusterStatuses.map((c) => [c.clusterId, c])),
    [clusterStatuses],
  );
  // The open cluster's status (for the drill-down Next-up panel).
  const activeClusterStatus: ClusterStatus | null = useMemo(
    () => (view.kind === "cluster" ? clusterStatusById.get(view.clusterId) ?? null : null),
    [view, clusterStatusById],
  );
```

- [ ] **Step 4: Add a start-here handler**

Near `handleNodeClick` / `handleSearch`, add:
```ts
  // Drill into a cluster and immediately select its top ready concept
  // (the cluster's "start here" entrypoint from the overview card).
  function handleSelectStartHere(clusterId: string, conceptId: string) {
    setView({ kind: "cluster", clusterId });
    setSelectedConceptId(conceptId);
  }
```

- [ ] **Step 5: Render the coverage header**

Immediately **after** the `<motion.h1>` block and **before** the controls `<div className="mb-5 flex flex-wrap ...">`, insert:
```tsx
        {hasGraph && pathMode && (
          <motion.div {...m} variants={fadeUp} className="mb-4 flex flex-wrap items-center gap-3 rounded-[4px] border border-border bg-surface px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-[1.4rem] leading-none text-ink">{coverage.percent}%</span>
              <span className="mono text-[11px] text-content-faint">mastered</span>
            </div>
            <div className="mono flex items-center gap-3 text-[11px] text-content-muted">
              <span><span className="text-rule">{coverage.ready}</span> ready</span>
              <span>{coverage.inProgress} in progress</span>
              <span className="text-content-faint">{coverage.locked} locked</span>
            </div>
            {/* Slim coverage bar */}
            <div className="ml-auto flex h-1.5 w-40 overflow-hidden rounded-[2px] bg-surface-2">
              <div className="bg-feynman" style={{ width: `${coverage.percent}%` }} />
            </div>
          </motion.div>
        )}
```

- [ ] **Step 6: Add the mode toggle to the controls**

In the controls `<div>` (the one containing the project picker), add a toggle after the search `<form>` and before the `{data && hasGraph && (...)}` Badge. Add:
```tsx
          {hasGraph && (
            <label className="mono flex cursor-pointer items-center gap-1.5 text-[12px] text-content-muted">
              <Switch checked={pathMode} onCheckedChange={setPathMode} />
              <Compass size={12} />
              learning path
            </label>
          )}
```

- [ ] **Step 7: Pass props to ClusterOverview (overview branch)**

In the `view.kind === "overview" ? (...)` branch, update `<ClusterOverview .../>` to pass the new props:
```tsx
            <ClusterOverview
              clusters={clusters}
              masteryByCluster={masteryByClusterMap}
              externalLinksByCluster={externalLinksMap}
              degreeMap={degreeMapById}
              labelById={labelById}
              onSelectCluster={(id) => {
                setView({ kind: "cluster", clusterId: id });
                setSelectedConceptId(null);
              }}
              clusterStatuses={clusterStatusById}
              pathMode={pathMode}
              onSelectStartHere={handleSelectStartHere}
            />
```

- [ ] **Step 8: Pass props to ConceptGraph + add NextUpPanel (drill-down branch)**

In the cluster drill-down branch (the `else` after the overview), update the right column to stack `NextUpPanel` above `DetailPanel` and pass the overlay props to `ConceptGraph`:
```tsx
          <div className="grid gap-6 md:grid-cols-[1fr_300px]">
            <ConceptGraph
              concepts={active.concepts}
              edges={active.edges}
              selectedId={selectedConceptId}
              onNodeClick={handleNodeClick}
              showSemSim={showSemSim}
              showAmbiguous={showAmbiguous}
              fullscreen={fullscreen}
              onExitFullscreen={() => setFullscreen(false)}
              statuses={pathMode ? statuses : null}
              pathMode={pathMode}
            />
            <div className="flex flex-col gap-3">
              {pathMode && <NextUpPanel clusterStatus={activeClusterStatus} onSelect={setSelectedConceptId} />}
              <DetailPanel
                conceptId={selectedConceptId}
                clusterName={selectedClusterName}
                onSelectConcept={setSelectedConceptId}
              />
            </div>
          </div>
```

- [ ] **Step 9: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/graph/page.tsx" components/graph/NextUpPanel.tsx components/graph/ClusterOverview.tsx components/graph/ConceptGraph.tsx`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add "app/(app)/graph/page.tsx"
git commit -m "$(cat <<'EOF'
feat(graph): wire learning-path mode into /graph

Mode toggle (default on, reset on project switch), coverage header,
status overlay on the canvas, per-cluster Next-up panel stacked above
DetailPanel, and start-here entrypoints on overview cards. All client-
side from existing /api/concepts data.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full pure-module suite**

Run: `npm run test:learning-path`
Expected: all tests PASS.

- [ ] **Step 2: Type-check + lint the whole repo touch set**

Run: `npx tsc --noEmit && npx eslint lib/graph/learning-path.ts lib/graph/learning-path.test.ts lib/graph/graph-tokens.ts components/graph/ConceptGraph.tsx components/graph/ClusterOverview.tsx components/graph/NextUpPanel.tsx "app/(app)/graph/page.tsx"`
Expected: clean.

- [ ] **Step 3: Manual verification on a real project**

Start the dev server (`npm run dev`) and on the 87-concept project verify:
- Coverage header shows `% mastered · N ready · N in progress · N locked` and the slim bar.
- Toggling "learning path" off returns the page to the prior overview + drill-down (mastery band bars, no status colors, no Next-up panel).
- Overview cards (path mode) show the status bar, `NN% · M ready`, and a "start here:" entrypoint; complete clusters show `✓ complete`, blocked ones show `locked`.
- Clicking a "start here" entrypoint drills into the cluster with that concept selected + centered.
- Drill-down canvas: ready nodes have the red rule ring, locked nodes are dashed/muted, mastered nodes have the feynman border, prerequisite_of edges are the emphasized backbone, peer edges faded.
- "Next up" panel lists the cluster's ready concepts ranked by dependents; clicking one selects + centers it; DetailPanel shows below.
- A blocked cluster's drill-down shows "blocked — prerequisites in another cluster".
- Switching projects resets path mode to on and clears the selection/overlay.

- [ ] **Step 4: (No commit — verification only. If anything fails, fix in the relevant task and re-verify.)**

---

## Notes / implementation decisions (spec refinements)

- **Glyphs → borders:** the spec mentioned a "check glyph" for mastered nodes. Cytoscape renders to canvas and doesn't easily composite SVG glyphs; implemented as a thicker feynman border instead (same visual intent: "done"). Locked uses a dashed faint border + muted opacity; ready uses the accent rule border (the existing "next/selection" color).
- **Status applied in-place, not via element rebuild:** a status flip (after review) updates node/edge classes in a dedicated effect keyed on `[statuses, pathMode]` — no element rebuild, no fcose relayout flash. (Building status into the elements useMemo would have hit the edges-only resync path and silently skipped node class updates.)
- **No global frontier list:** per the spec, the overview surfaces per-cluster "start here" entrypoints and the drill-down shows the open cluster's frontier. There is no single global "Next up" list, to avoid duplicating one list in two places.