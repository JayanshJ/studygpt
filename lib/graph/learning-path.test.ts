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