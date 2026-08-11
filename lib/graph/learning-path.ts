// Pure learning-path computation for the concept graph: per-concept status over
// the prerequisite_of DAG, coverage metrics, and the per-cluster frontier.
// No React, no DB, no DOM — importable by a throwaway test. All inputs are
// already returned by GET /api/concepts (per-concept band + edges with relation).

import type { Band } from "@/lib/mastery/model";
import type { Cluster } from "@/lib/graph/clusters";

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