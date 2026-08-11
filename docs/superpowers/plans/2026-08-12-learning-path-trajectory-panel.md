# Learning-path Trajectory Panel + "Ask in chat" Handoff — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-column linear learning-path trajectory to `/graph` (remaining concepts in topological order, colored green/yellow/red with a "you are here" marker) and a per-row "ask in chat" action that opens the project's chat with a prefilled study prompt scoped to that project's materials.

**Architecture:** A new pure `computeTrajectory` in `lib/graph/learning-path.ts` (Kahn's best-first topological sort over the not-done `prerequisite_of` subgraph, foundational-first tiebreak) feeds a new presentational `LearningPathTrajectory` component wired into the graph page's right column (replacing the per-cluster `NextUpPanel`). The "ask" action is a Next `<Link>` to `/?projectId=<pid>&q=<prompt>`; the chat page reads those params on mount, creates a project-scoped conversation, and prefills the composer. No backend changes.

**Tech Stack:** Next.js 16.3 (custom — heed AGENTS.md; read `node_modules/next/dist/docs/` if a Next API is uncertain), React 19, Cytoscape (graph, unchanged), node:test + tsx (tests), Studio Notebook design tokens.

## Global Constraints

- **No backend changes.** Everything client-side from existing `GET /api/concepts` data + existing `POST /api/conversations`. No new endpoints, no DB/schema migration.
- **Reuse the shipped pure module.** `computeTrajectory` consumes the existing `computeStatuses` output + `ConceptStatus`; do not recompute statuses.
- **Studio Notebook tokens only** in new UI — `bg-band-learning`, `bg-rule`, `text-rule`, `text-band-learning`, `text-content-faint`, `text-content-muted`, `text-ink`, `bg-surface`, `bg-surface-2`, `border-border`, `border-border-strong`, `mono`. No hardcoded colors.
- **`prerequisite_of` only gates/orders.** `part_of` / `generalizes` do not affect trajectory ordering (same rule as the prior feature). Self-loops ignored.
- **Single-file staging per task.** Stage only the files each task touches explicitly; never `git add -A`/`.`/`package.json` (the working tree carries unrelated uncommitted UI-refactor work that must not be swept into these commits).
- **`package.json` is NOT touched** by any task here (the `test:learning-path` script already exists from the prior feature).

## File Structure

- **Modify** `lib/graph/learning-path.ts` — add `TrajectoryItem`, `Trajectory`, `computeTrajectory` (pure).
- **Modify** `lib/graph/learning-path.test.ts` — add `computeTrajectory` tests (TDD).
- **Create** `components/graph/LearningPathTrajectory.tsx` — presentational right-column panel.
- **Modify** `app/(app)/graph/page.tsx` — trajectory memo, replace `NextUpPanel` with `LearningPathTrajectory` in both branches, ask link, remove dead `NextUpPanel`/`activeClusterStatus` wiring.
- **Modify** `app/(app)/page.tsx` — read `?projectId`/`?q` on mount → create project-scoped conversation + prefill composer (the chat handoff).

---

## Task 1: `computeTrajectory` pure module (TDD)

**Files:**
- Modify: `lib/graph/learning-path.ts` (append to the existing module — it already imports `Band` and `Cluster`; this task adds `TrajectoryItem`/`Trajectory`/`computeTrajectory`).
- Test: `lib/graph/learning-path.test.ts` (append; reuse the existing `fixture` helper).

**Interfaces:**
- Consumes: `ConceptStatus` (from this module), the `prerequisite_of` relation, `labelById`, `clusterNameById`.
- Produces: `TrajectoryItem`, `Trajectory`, `computeTrajectory` — used by Task 3 (graph page memo) and exercised by Task 1's tests.

- [ ] **Step 1: Write the failing tests**

Append to `lib/graph/learning-path.test.ts`. First update the import (line 3) to include `computeTrajectory`:
```ts
import { computeStatuses, computeCoverage, computeClusterStatuses, computeTrajectory } from "./learning-path";
```

Then append this helper + tests (after the existing tests):
```ts
// Trajectory helper: like `fixture`, but also runs computeStatuses and builds
// labelById (label = id uppercased) + an empty clusterNameById for convenience.
function trajFixture(opts: {
  bands: Record<string, "strong" | "learning" | "slipping" | "untested" | "unknown">;
  prereqs?: string[];
  edges?: { source: string; target: string; relation: string }[];
  labelById?: Map<string, string>;
  clusterNameById?: Map<string, string>;
}) {
  const { concepts, edges } = fixture(opts);
  const statuses = computeStatuses(concepts, edges);
  const ids = Object.keys(opts.bands);
  const labelById = opts.labelById ?? new Map(ids.map((id) => [id, id.toUpperCase()]));
  const clusterNameById = opts.clusterNameById ?? new Map<string, string>();
  return { concepts, edges, statuses, labelById, clusterNameById };
}

test("trajectory: linear chain a->b->c, all untested", () => {
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "untested", b: "untested", c: "untested" }, prereqs: ["a->b", "b->c"] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.deepEqual(t.items.map((i) => i.conceptId), ["a", "b", "c"]);
  assert.deepEqual(t.items.map((i) => i.step), [1, 2, 3]);
  assert.equal(t.doneCount, 0);
  assert.equal(t.items[0].isYouAreHere, true);
});

test("trajectory: diamond a->{b,c}->d orders a first, d last", () => {
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "untested", b: "untested", c: "untested", d: "untested" }, prereqs: ["a->b", "a->c", "b->d", "c->d"] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.equal(t.items[0].conceptId, "a");
  assert.equal(t.items[3].conceptId, "d");
  // b and c tie on out-degree(1) + total-degree(2) → label asc (B<C)
  assert.deepEqual(t.items.map((i) => i.conceptId), ["a", "b", "c", "d"]);
});

test("trajectory: foundational-first — higher prerequisite_of out-degree emits first", () => {
  // a is prereq of x and y (out-degree 2); b is prereq of z (out-degree 1).
  // a and b both available → a emits first.
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "untested", b: "untested", x: "untested", y: "untested", z: "untested" }, prereqs: ["a->x", "a->y", "b->z"] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.equal(t.items[0].conceptId, "a");
  assert.equal(t.items[1].conceptId, "b");
});

test("trajectory: tie on out-degree breaks by total degree desc", () => {
  // a and p both available, both out-degree 0; a has a part_of edge (total degree 1), b has none (0).
  // part_of does not order, so all three are available; sort by total degree desc then label asc.
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "untested", b: "untested", p: "untested" }, edges: [{ source: "a", target: "p", relation: "part_of" }] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.deepEqual(t.items.map((i) => i.conceptId), ["a", "p", "b"]); // a(1),p(1) by label, then b(0)
});

test("trajectory: full tie (no edges) breaks by label asc", () => {
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { c: "untested", a: "untested", b: "untested" } });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.deepEqual(t.items.map((i) => i.conceptId), ["a", "b", "c"]);
});

test("trajectory: in_progress concept is isYouAreHere; step numbers after done", () => {
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "strong", b: "learning", c: "untested" }, prereqs: ["a->b", "b->c"] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.equal(t.doneCount, 1);
  assert.deepEqual(t.items.map((i) => i.conceptId), ["b", "c"]);
  assert.equal(t.items[0].status, "in_progress");
  assert.equal(t.items[0].isYouAreHere, true);
  assert.equal(t.items[0].step, 2); // doneCount(1) + 0 + 1
  assert.equal(t.items[1].status, "locked");
  assert.equal(t.items[1].step, 3);
});

test("trajectory: first ready is isYouAreHere when no in_progress", () => {
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "untested", b: "untested" }, prereqs: ["a->b"] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.deepEqual(t.items.map((i) => i.conceptId), ["a", "b"]);
  assert.equal(t.items[0].status, "ready");
  assert.equal(t.items[0].isYouAreHere, true);
  assert.equal(t.items[1].status, "locked");
  assert.equal(t.items[1].isYouAreHere, false);
});

test("trajectory: exactly one isYouAreHere (the first in_progress wins over a later ready)", () => {
  // a in_progress (no prereqs), b ready (no prereqs) — both available; a is isYouAreHere.
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "learning", b: "untested" } });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  const here = t.items.filter((i) => i.isYouAreHere);
  assert.equal(here.length, 1);
  assert.equal(here[0].conceptId, "a");
});

test("trajectory: all mastered → empty items, doneCount N, no isYouAreHere", () => {
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "strong", b: "strong" }, prereqs: ["a->b"] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.equal(t.doneCount, 2);
  assert.deepEqual(t.items, []);
});

test("trajectory: no prerequisite_of edges → all available, ordered by tiebreak", () => {
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { x: "untested", y: "untested", z: "untested" } });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.deepEqual(t.items.map((i) => i.conceptId), ["x", "y", "z"]);
  assert.equal(t.items.every((i) => i.status === "ready"), true);
});

test("trajectory: prerequisite_of cycle among not-done appended at end by label (no hang)", () => {
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "untested", b: "untested", c: "untested" }, prereqs: ["a->b", "b->a"] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  // c available (no prereq) emits first; a,b cycle members appended by label asc.
  assert.deepEqual(t.items.map((i) => i.conceptId), ["c", "a", "b"]);
  assert.equal(t.items[0].isYouAreHere, true);
  assert.equal(t.items[1].status, "locked");
  assert.equal(t.items[2].status, "locked");
});

test("trajectory: part_of / generalizes do not affect ordering", () => {
  // generalizes b->a does NOT make b precede a; both available → label asc (A<B).
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "untested", b: "untested" }, edges: [{ source: "b", target: "a", relation: "generalizes" }] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.deepEqual(t.items.map((i) => i.conceptId), ["a", "b"]);
});

test("trajectory: self-loop prereq ignored", () => {
  const { concepts, edges, statuses, labelById, clusterNameById } = trajFixture({ bands: { a: "untested" }, prereqs: ["a->a"] });
  const t = computeTrajectory(concepts, edges, statuses, labelById, clusterNameById);
  assert.deepEqual(t.items.map((i) => i.conceptId), ["a"]);
  assert.equal(t.items[0].status, "ready");
});

test("trajectory: clusterName + doneCount + step numbering with mixed mastered/remaining", () => {
  const f = fixture({ bands: { a: "strong", b: "strong", c: "untested", d: "untested" }, prereqs: ["c->d"] });
  const statuses = computeStatuses(f.concepts, f.edges);
  const labelById = new Map([["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"]]);
  const clusterNameById = new Map([["c", "Databases"], ["d", "Databases"]]);
  const t = computeTrajectory(f.concepts, f.edges, statuses, labelById, clusterNameById);
  assert.equal(t.doneCount, 2);
  assert.deepEqual(t.items.map((i) => i.conceptId), ["c", "d"]);
  assert.deepEqual(t.items.map((i) => i.step), [3, 4]);
  assert.equal(t.items[0].clusterName, "Databases");
  assert.equal(t.items[0].isYouAreHere, true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:learning-path`
Expected: FAIL — `computeTrajectory` is not exported (the new tests throw/import-error).

- [ ] **Step 3: Write the implementation**

Append to `lib/graph/learning-path.ts` (after `computeClusterStatuses`):
```ts
export interface TrajectoryItem {
  conceptId: string;
  label: string;
  status: ConceptStatus;
  step: number; // 1-based overall position (done + remaining) — used in the chat prompt
  clusterName: string | null;
  isYouAreHere: boolean;
}

export interface Trajectory {
  doneCount: number; // mastered concepts (collapsed into the "✓ N done" header)
  items: TrajectoryItem[]; // remaining concepts, in learning order
}

// A linear learning order of the remaining (not-mastered) concepts: a best-first
// topological sort over the prerequisite_of subgraph restricted to not-done
// concepts. At each step the most foundational available concept emits first
// (prerequisite_of out-degree desc, then total degree desc, then label asc).
// Mastered concepts collapse into doneCount. part_of/generalizes do not order
// (only prerequisite_of). Self-loops ignored. Cycles among not-done concepts
// never become available; they are appended at the end by label asc so the
// trajectory stays complete (no infinite loop). isYouAreHere = the first
// in_progress item if any, else the first ready item.
export function computeTrajectory(
  concepts: { id: string }[],
  edges: { source: string; target: string; relation: string }[],
  statuses: Map<string, ConceptStatus>,
  labelById: Map<string, string>,
  clusterNameById: Map<string, string>,
): Trajectory {
  let doneCount = 0;
  const notDone: string[] = [];
  const statusOf = new Map<string, ConceptStatus>();
  for (const c of concepts) {
    const st = statuses.get(c.id);
    if (st == null) continue;
    if (st === "mastered") doneCount++;
    else {
      notDone.push(c.id);
      statusOf.set(c.id, st);
    }
  }
  if (notDone.length === 0) return { doneCount, items: [] };

  const notDoneSet = new Set(notDone);

  // Graph-wide prerequisite_of out-degree + total degree (tiebreak inputs).
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

  // Not-done prerequisite adjacency (Kahn over the not-done subgraph).
  const prereqs = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();
  const inDeg = new Map<string, number>();
  for (const id of notDone) {
    prereqs.set(id, new Set());
    dependents.set(id, new Set());
    inDeg.set(id, 0);
  }
  for (const e of edges) {
    if (e.relation !== "prerequisite_of" || e.source === e.target) continue;
    if (notDoneSet.has(e.target) && notDoneSet.has(e.source)) {
      prereqs.get(e.target)!.add(e.source);
      dependents.get(e.source)!.add(e.target);
    }
  }
  for (const id of notDone) inDeg.set(id, prereqs.get(id)!.size);

  const labelOf = (id: string) => labelById.get(id) ?? id;
  // Best-first: most foundational (prereq out-degree desc, total degree desc, label asc).
  const better = (a: string, b: string): number => {
    const oa = prereqOut.get(a) ?? 0, ob = prereqOut.get(b) ?? 0;
    if (ob !== oa) return ob - oa;
    const da = totalDeg.get(a) ?? 0, db = totalDeg.get(b) ?? 0;
    if (db !== da) return db - da;
    return labelOf(a).localeCompare(labelOf(b));
  };

  let avail = notDone.filter((id) => inDeg.get(id) === 0).sort(better);
  const emitted: string[] = [];
  const emittedSet = new Set<string>();
  while (avail.length > 0) {
    const id = avail.shift()!;
    emitted.push(id);
    emittedSet.add(id);
    const newlyAvail: string[] = [];
    for (const dep of dependents.get(id)!) {
      const d = (inDeg.get(dep) ?? 0) - 1;
      inDeg.set(dep, d);
      if (d === 0) newlyAvail.push(dep);
    }
    if (newlyAvail.length > 0) avail = [...avail, ...newlyAvail].sort(better);
  }

  // Cycle fallback: append unemitted not-done concepts by label asc.
  if (emittedSet.size < notDone.length) {
    const rest = notDone.filter((id) => !emittedSet.has(id)).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
    emitted.push(...rest);
  }

  let youAreHereIdx = -1;
  for (let i = 0; i < emitted.length; i++) {
    if (statusOf.get(emitted[i]) === "in_progress") { youAreHereIdx = i; break; }
  }
  if (youAreHereIdx === -1) {
    for (let i = 0; i < emitted.length; i++) {
      if (statusOf.get(emitted[i]) === "ready") { youAreHereIdx = i; break; }
    }
  }

  const items: TrajectoryItem[] = emitted.map((id, i) => ({
    conceptId: id,
    label: labelOf(id),
    status: statusOf.get(id)!,
    step: doneCount + i + 1,
    clusterName: clusterNameById.get(id) ?? null,
    isYouAreHere: i === youAreHereIdx,
  }));

  return { doneCount, items };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:learning-path`
Expected: PASS — all prior tests + the new trajectory tests (the count rises from 27 to 27 + 15 = 42 total).

- [ ] **Step 5: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint lib/graph/learning-path.ts lib/graph/learning-path.test.ts`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/graph/learning-path.ts lib/graph/learning-path.test.ts
git commit -m "$(cat <<'EOF'
feat(graph): computeTrajectory — linear learning order of remaining concepts

Best-first topological sort over the not-done prerequisite_of subgraph
(foundational-first: prereq out-degree desc, total degree desc, label asc).
Mastered concepts collapse into doneCount; isYouAreHere marks the first
in_progress else first ready. Cycle-safe (cycle members appended by label).
Pure module, no React/DB. 15 new tests.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `LearningPathTrajectory` component

**Files:**
- Create: `components/graph/LearningPathTrajectory.tsx`

**Interfaces:**
- Consumes: `Trajectory` from `@/lib/graph/learning-path`; `Card` from `@/components/ui/Card`; `cn` from `@/lib/cn`; `Link` from `next/link`; `Lock`, `ArrowUpRight` from lucide-react.
- Produces: `LearningPathTrajectory` presentational component — used by Task 3 (graph page right column, both branches).

- [ ] **Step 1: Create the component**

`components/graph/LearningPathTrajectory.tsx`:
```tsx
"use client";

// The learning-path trajectory panel for /graph — a linear "first do this,
// then that" list of the remaining (not-mastered) concepts in topological
// learning order, colored by status (green done [collapsed into the header] /
// yellow in progress / red not done), with a "you are here" marker on the
// actionable focus. Each row has an "ask in chat" link that hands off to the
// project's chat with a prefilled study prompt. Presentational — only an
// auto-scroll ref for the "you are here" row. Studio Notebook tokens only.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowUpRight, Lock } from "lucide-react";
import type { Trajectory } from "@/lib/graph/learning-path";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

interface LearningPathTrajectoryProps {
  trajectory: Trajectory | null;
  projectId: string | null;
  selectedId: string | null;
  onSelect: (conceptId: string) => void;
  buildAskPrompt: (label: string, step: number) => string;
}

export function LearningPathTrajectory({
  trajectory,
  projectId,
  selectedId,
  onSelect,
  buildAskPrompt,
}: LearningPathTrajectoryProps) {
  const hereRef = useRef<HTMLLIElement | null>(null);

  // Auto-scroll the "you are here" row into view on load / data change.
  useEffect(() => {
    hereRef.current?.scrollIntoView({ block: "nearest" });
  }, [trajectory]);

  if (!trajectory) return null;

  if (trajectory.items.length === 0) {
    return (
      <Card className="p-4">
        <div className="mono mb-2 text-[10px] tracking-wide text-content-faint">LEARNING PATH</div>
        <div className="mono flex items-center gap-1.5 text-[12px] text-content-faint">
          ✓ path complete · {trajectory.doneCount} done
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex max-h-[70vh] flex-col overflow-hidden p-0">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="mono text-[10px] tracking-wide text-content-faint">LEARNING PATH</span>
        <span className="mono text-[10px] text-content-faint">✓ {trajectory.doneCount} done</span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <ul>
          {trajectory.items.map((it) => {
            const inProgress = it.status === "in_progress";
            const askHref = projectId
              ? `/?projectId=${encodeURIComponent(projectId)}&q=${encodeURIComponent(buildAskPrompt(it.label, it.step))}`
              : null;
            return (
              <li
                key={it.conceptId}
                ref={it.isYouAreHere ? hereRef : undefined}
                className={cn(
                  "relative flex items-center gap-2 border-b border-border/60 px-3 py-2 transition-colors",
                  it.isYouAreHere ? "bg-surface-2" : it.conceptId === selectedId ? "bg-surface-2/60" : "hover:bg-surface-2/40",
                )}
              >
                {it.isYouAreHere && (
                  <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-rule" />
                )}
                <button
                  onClick={() => onSelect(it.conceptId)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      inProgress ? "bg-band-learning" : "bg-rule",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "mono block truncate text-[12px] leading-tight",
                        inProgress ? "text-band-learning" : "text-rule",
                      )}
                    >
                      {it.isYouAreHere && <span className="mr-0.5">▸</span>}
                      {it.label}
                    </span>
                    <span className="mono block truncate text-[10px] leading-tight text-content-faint">
                      {it.isYouAreHere
                        ? it.status === "in_progress"
                          ? "you are here"
                          : "start here"
                        : it.clusterName ?? ""}
                    </span>
                  </span>
                </button>
                {it.status === "locked" && (
                  <Lock size={11} className="shrink-0 text-content-faint" />
                )}
                {askHref && (
                  <Link
                    href={askHref}
                    aria-label={`Ask in chat about ${it.label}`}
                    className="mono shrink-0 rounded-[3px] border border-border bg-surface px-1.5 py-0.5 text-[10px] text-content-muted transition-colors hover:border-border-strong hover:text-ink"
                  >
                    ask
                    <ArrowUpRight size={10} className="-ml-0.5 inline align-baseline" />
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint components/graph/LearningPathTrajectory.tsx`
Expected: clean. (If `cn` is not at `@/lib/cn` or `Card` is not a named export from `@/components/ui/Card`, stop and report — the prior feature's NextUpPanel confirmed `Card` is a named export and `lib/cn.ts` exists, so this should resolve.)

- [ ] **Step 3: Commit**

```bash
git add components/graph/LearningPathTrajectory.tsx
git commit -m "$(cat <<'EOF'
feat(graph): LearningPathTrajectory panel — linear path + ask in chat

Presentational right-column panel: scrollable list of remaining concepts
in topological order, colored green/yellow/red with a "you are here"
marker (auto-scrolled into view) and a per-row "ask in chat" link to the
project's chat with a prefilled study prompt. Done concepts collapse to
a header. Studio Notebook tokens only.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Graph page wiring (trajectory memo, replace NextUpPanel, ask link)

**Files:**
- Modify: `app/(app)/graph/page.tsx`

**Interfaces:**
- Consumes: `computeTrajectory`, `Trajectory` from Task 1; `LearningPathTrajectory` from Task 2. `ConceptGraph` already centers on `selectedId` (no change needed).
- Produces: the wired `/graph` page — trajectory in the right column (both branches), NextUpPanel removed, ask link built from the trajectory items.

- [ ] **Step 1: Update imports**

In `app/(app)/graph/page.tsx`:

a) The existing learning-path import block (around line 22-29) currently is:
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
Replace it with:
```ts
import {
  computeStatuses,
  computeCoverage,
  computeClusterStatuses,
  computeTrajectory,
  type ConceptStatus,
  type ClusterStatus,
  type Trajectory,
} from "@/lib/graph/learning-path";
import { LearningPathTrajectory } from "@/components/graph/LearningPathTrajectory";
```

(`ClusterStatus` is still used by `clusterStatusById`/`ClusterOverview` — keep it. `Link` is already imported on line 4.)

- [ ] **Step 2: Add the `buildAskPrompt` helper**

Near the top of the file, after the `const NONE = "__none__";` line (around line 39), add:
```ts
// Build the chat prompt handed off from a trajectory row's "ask" link. The
// chat is project-scoped, so RAG explains from that project's materials.
function buildAskPrompt(label: string, step: number) {
  return `I'm working through my study path and I'm on "${label}" (step ${step}). Explain it from my materials, then quiz me to check my understanding.`;
}
```

- [ ] **Step 3: Add `clusterNameById` + `trajectory` memos; remove `activeClusterStatus`**

Locate the memo block that currently defines `activeClusterStatus` (the Task 7 block, around lines 175-192):
```ts
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
Replace it with:
```ts
  const clusterStatusById = useMemo(
    () => new Map(clusterStatuses.map((c) => [c.clusterId, c])),
    [clusterStatuses],
  );
  // conceptId -> cluster name (for the trajectory's per-row cluster tag).
  const clusterNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data?.concepts ?? []) {
      const cid = c2cluster.get(c.id);
      const name = cid ? clusterById.get(cid)?.name ?? null : null;
      if (name) m.set(c.id, name);
    }
    return m;
  }, [data, c2cluster, clusterById]);
  // The linear learning path: remaining concepts in topological order, with
  // the "you are here" marker. Client-side; reflows when data/statuses change.
  const trajectory: Trajectory | null = useMemo(
    () => (data ? computeTrajectory(data.concepts, data.edges, statuses, labelById, clusterNameById) : null),
    [data, statuses, labelById, clusterNameById],
  );
```

(`activeClusterStatus` is removed — only NextUpPanel used it, and NextUpPanel is being replaced.)

- [ ] **Step 4: Replace the overview branch's right column**

The overview branch (around lines 287-305) currently ends with:
```tsx
            <DetailPanel
              conceptId={selectedConceptId}
              clusterName={selectedClusterName}
              onSelectConcept={setSelectedConceptId}
            />
```
Replace that `<DetailPanel ... />` with a stacked trajectory + DetailPanel:
```tsx
            <div className="flex flex-col gap-3">
              <LearningPathTrajectory
                trajectory={trajectory}
                projectId={projectId}
                selectedId={selectedConceptId}
                onSelect={setSelectedConceptId}
                buildAskPrompt={buildAskPrompt}
              />
              <DetailPanel
                conceptId={selectedConceptId}
                clusterName={selectedClusterName}
                onSelectConcept={setSelectedConceptId}
              />
            </div>
```

- [ ] **Step 5: Replace the drill-down branch's right column**

The drill-down branch (around lines 307-323) currently has:
```tsx
            <div className="flex flex-col gap-3">
              {pathMode && <NextUpPanel clusterStatus={activeClusterStatus} onSelect={setSelectedConceptId} />}
              <DetailPanel
                conceptId={selectedConceptId}
                clusterName={selectedClusterName}
                onSelectConcept={setSelectedConceptId}
              />
            </div>
```
Replace the `{pathMode && <NextUpPanel ... />}` line with the trajectory (always shown — it's the primary path surface, not gated on `pathMode`):
```tsx
            <div className="flex flex-col gap-3">
              <LearningPathTrajectory
                trajectory={trajectory}
                projectId={projectId}
                selectedId={selectedConceptId}
                onSelect={setSelectedConceptId}
                buildAskPrompt={buildAskPrompt}
              />
              <DetailPanel
                conceptId={selectedConceptId}
                clusterName={selectedClusterName}
                onSelectConcept={setSelectedConceptId}
              />
            </div>
```

- [ ] **Step 6: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/graph/page.tsx" components/graph/LearningPathTrajectory.tsx`
Expected: clean. (`NextUpPanel` import removed, `activeClusterStatus` removed, `ClusterStatus` still used by `clusterStatusById`.)

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/graph/page.tsx"
git commit -m "$(cat <<'EOF'
feat(graph): wire learning-path trajectory into /graph right column

Add trajectory + clusterNameById memos; replace the per-cluster NextUpPanel
with the global LearningPathTrajectory panel in both overview and drill-down
right columns (stacked above DetailPanel). Row select reuses setSelectedConceptId
(ConceptGraph already centers on selectedId). Ask link builds the project-scoped
chat URL from each item's label + step.

Also bundles the pre-existing uncommitted work already in this file (the
prior feature's wiring) — that work is the base this wiring was built on
and cannot be cleanly split from it non-interactively.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Chat page "ask in chat" handoff (`?projectId` + `?q`)

**Files:**
- Modify: `app/(app)/page.tsx`

**Interfaces:**
- Consumes: existing `POST /api/conversations { projectId }`, `setActiveProjectId`, `setPendingPrompt` (composer prefill via `ChatInput.initialText` — already a one-time seed), `syncUrl` pattern.
- Produces: the chat page reads `?projectId`/`?q` on mount → creates a project-scoped conversation + prefills the composer; strips the params from the URL so a reload doesn't re-create the conversation.

- [ ] **Step 1: Add the handoff effect**

In `app/(app)/page.tsx`, locate the existing `?c` restore effect (the `restoredRef` block, around lines 149-165). Immediately **after** that effect, add a new ref + effect:
```ts
  // Handoff from /graph "ask in chat": ?projectId=<pid>&q=<prompt>. Create a
  // project-scoped conversation and prefill the composer so the user reviews +
  // sends. Runs once on mount; the graph link never also sets ?c, so it does
  // not conflict with the ?c restore. Strips q/projectId from the URL after so
  // a reload doesn't re-create the conversation. (ChatInput seeds initialText
  // exactly once via its seededRef, so clearing pendingPrompt later is a no-op
  // — the textarea keeps the prompt.)
  const handoffRef = useRef(false);
  useEffect(() => {
    if (handoffRef.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (!q) return; // no handoff → let the ?c restore path handle mount
    handoffRef.current = true;
    const pid = params.get("projectId");
    if (pid) setActiveProjectId(pid);
    setPendingPrompt(q);
    void (async () => {
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: pid ?? null }),
        });
        if (!res.ok) return;
        const conv: Conversation = await res.json();
        setConversations((prev) => [conv, ...prev]);
        setActiveId(conv.id);
        setConversation(conv);
        setMessages([]);
        const url = new URL(window.location.href);
        url.searchParams.set("c", conv.id);
        url.searchParams.delete("q");
        url.searchParams.delete("projectId");
        window.history.replaceState(null, "", url);
      } catch {
        /* ignore — user can start a conversation manually */
      } finally {
        setPendingPrompt(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

Notes for the implementer:
- `Conversation`, `useRef`, `useEffect`, `setActiveProjectId`, `setPendingPrompt`, `setConversations`, `setActiveId`, `setConversation`, `setMessages` are all already in scope (existing imports/state). `Conversation` is imported from `@/lib/db/schema` (line ~21).
- Do NOT call `syncUrl` here — the inline `replaceState` both sets `?c` and strips `q`/`projectId` in one write.
- The `eslint-disable-next-line react-hooks/exhaustive-deps` matches the style of the adjacent `?c` restore effect (intentional mount-only effect).

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/page.tsx"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/page.tsx"
git commit -m "$(cat <<'EOF'
feat(chat): accept ?projectId + ?q handoff from /graph "ask in chat"

On mount, if ?q is present, create a project-scoped conversation (POST
/api/conversations { projectId }), set it active, prefill the composer via
pendingPrompt, and strip q/projectId from the URL so a reload doesn't
re-create it. The conversation's project_id loads that project's materials
(existing behavior) so RAG explains from them.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run:
```bash
npm run test:learning-path
npx tsc --noEmit
npx eslint lib/graph/learning-path.ts lib/graph/learning-path.test.ts components/graph/LearningPathTrajectory.tsx "app/(app)/graph/page.tsx" "app/(app)/page.tsx"
```
Expected: all tests pass (42 in learning-path: 27 prior + 15 new), tsc exit 0, eslint exit 0.

- [ ] **Step 2: Manual browser pass (human)**

`next dev` → open `/graph` on the 87-concept project:
- Right column shows the trajectory: `✓ N done` header + remaining concepts in order, yellow for in progress, red for ready/locked, `▸` + accent bar on the "you are here" row, auto-scrolled into view.
- Clicking a row selects the concept (DetailPanel updates; in a drill-down cluster, the canvas centers on it).
- A row's `ask` link navigates to `/?projectId=<pid>&q=<prompt>` → the project's chat opens with the composer prefilled with the study prompt and the project's materials loaded (SourcesPanel shows them). Review + Enter sends.
- Switching projects resets/re-scrolls the trajectory.
- Toggling the learning-path mode still toggles the graph overlay; the trajectory stays visible in both modes.
- No console errors (no nested-button hydration — the trajectory rows use `<button>` inside `<li>`, not nested buttons).

- [ ] **Step 3: Record results**

Append the verification outcome (test counts, tsc/eslint exits, manual pass/fail notes) to `.superpowers/sdd/progress.md`.

---

## Self-Review (run after writing, before execution)

1. **Spec coverage:** Section 1 (ordering) → Task 1; Section 2 (component) → Task 2; Section 3 (layout) → Task 3; Section 4 (chat handoff) → Task 4; Section 5 (data flow) → Task 3 memos; Section 6 (tests) → Task 1 + Task 5. All covered.
2. **Placeholder scan:** no TBD/TODO; every code step has complete code.
3. **Type consistency:** `TrajectoryItem`/`Trajectory` defined in Task 1, consumed in Task 2 (props `trajectory: Trajectory | null`) and Task 3 (`const trajectory: Trajectory | null`). `buildAskPrompt(label, step)` signature matches between Task 2 (`Props.buildAskPrompt`) and Task 3 (`buildAskPrompt` module function) and the Task 1 `step` field (number). `computeTrajectory`'s param order (`concepts, edges, statuses, labelById, clusterNameById`) matches the Task 3 call site and the Task 1 tests.
4. **Devs from spec noted:** the spec's "centers the node in drill-down" needs no new code — `ConceptGraph` already centers on `selectedId` (lines 253-258), so `onSelect={setSelectedConceptId}` suffices.
5. **Git hygiene:** each task stages only its own files; Task 3's commit message honestly bundles the pre-existing uncommitted work in `app/(app)/graph/page.tsx` (same pattern as the prior feature's Tasks 4/6/7).