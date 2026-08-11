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