import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatuses, computeCoverage, computeClusterStatuses } from "./learning-path";
import type { Cluster } from "./clusters";

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

test("external dependent on a mastered cycle -> ready", () => {
  // a and b form a mastered prerequisite_of cycle (a->b, b->a, both strong);
  // c is an external dependent whose prereq is the cycle member a. All of c's
  // transitive ancestors are mastered → c should be ready (not locked).
  const { concepts, edges } = fixture({
    bands: { a: "strong", b: "strong", c: "untested" },
    prereqs: ["a->b", "b->a", "a->c"],
  });
  const s = computeStatuses(concepts, edges);
  assert.equal(s.get("a"), "mastered");
  assert.equal(s.get("b"), "mastered");
  assert.equal(s.get("c"), "ready");
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

test("frontier tie on dependents AND degree breaks by label asc", () => {
  // d and e both have 0 prerequisite_of out-degree and 0 total degree; "d" < "e".
  const single: Cluster[] = [{ id: "c1", name: "C1", conceptCount: 2, conceptIds: ["e", "d"] }];
  const labels = new Map([["d", "D"], ["e", "E"]]);
  const s = statusesMap({ d: "ready", e: "ready" });
  const cs = computeClusterStatuses(single, s, [], labels);
  assert.deepEqual(cs[0].frontier.map((f) => f.conceptId), ["d", "e"]);
});
