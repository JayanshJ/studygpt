// Pure dagre hierarchical layout for the cluster drill-down view. No React,
// no DB. The single source of truth for concept-node dimensions and for the
// dagre → @xyflow coordinate conversion.
//
// Hierarchical relations (`prerequisite_of`, `part_of`, `generalizes`) are the
// only edges passed to dagre for ranking — peer relations are rendered as
// secondary edges by the component and ignored here.

import { graphlib, layout } from "@dagrejs/dagre";
import type { GraphConcept, GraphEdge } from "@/lib/graph/clusters";

// The subset of relations that define the ranking backbone of the hierarchy.
// Peer relations (example_of, contrasts_with, applies_to,
// semantically_similar_to) are NOT members — they are rendered as faded
// secondary edges and must not influence vertical placement.
export const HIERARCHICAL = new Set(["prerequisite_of", "part_of", "generalizes"]);

// --- Node measurement -------------------------------------------------------

// Typography constants for the rendered concept node. These MUST match the
// CSS applied to the rendered div (mono 12px via `.mono`, letter-spacing
// ~0.01em). Tailwind preflight sets `box-sizing: border-box`, so a declared
// width INCLUDES padding + border — the measurement below accounts for that.
const CHAR_ADVANCE = 7.4; // px per mono char at 12px (incl. letter-spacing)
const LINE_HEIGHT = 16; // px per wrapped line
const MAX_WIDTH = 220; // px cap (~27 mono chars); matches the overview card min width
const PAD_X = 8; // px-2 each side
const PAD_Y = 4; // py-1 each side
const BORDER = 2; // border-2 each side

// Horizontal overhead added on top of the raw text width: padding both sides
// + border both sides. Because of border-box, this is the only horizontal
// addition — declared width = textWidth + H_OVERHEAD.
const H_OVERHEAD = PAD_X * 2 + BORDER * 2; // 20
// Vertical overhead on top of the wrapped line block: padding + border, both
// sides. Declared height = lines * LINE_HEIGHT + V_OVERHEAD.
const V_OVERHEAD = PAD_Y * 2 + BORDER * 2; // 12

// Greedy word-wrap on spaces. A single token longer than the cap is broken at
// the cap (the rendered div also uses `break-all` as a CSS fallback; the
// measurer must agree so edges attach to the actual box).
function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let cur = "";
  const pushToken = (token: string) => {
    // A token longer than the cap is broken into cap-sized chunks; the first
    // chunk shares a line with `cur` if there's room, later chunks start
    // their own lines.
    let rest = token;
    while (rest.length > maxChars) {
      if (cur.length === 0) {
        lines.push(rest.slice(0, maxChars));
        rest = rest.slice(maxChars);
      } else if (cur.length + 1 >= maxChars) {
        lines.push(cur);
        cur = "";
      } else {
        const room = maxChars - cur.length - 1; // -1 for the joining space
        lines.push(cur + " " + rest.slice(0, room));
        cur = "";
        rest = rest.slice(room);
      }
    }
    if (rest.length === 0) return;
    if (cur.length === 0) {
      cur = rest;
    } else if (cur.length + 1 + rest.length <= maxChars) {
      cur = cur + " " + rest;
    } else {
      lines.push(cur);
      cur = rest;
    }
  };
  for (const word of words) pushToken(word);
  if (cur.length > 0) lines.push(cur);
  return lines.length > 0 ? lines : [""];
}

// Single source of truth for concept-node dimensions. Used by both dagre
// `setNode` (here) and the rendered div (later, in ConceptGraph) so the box
// dagre lays out is exactly the box the user sees — edges attach correctly.
export function measureConceptNode(label: string): { width: number; height: number } {
  const maxChars = Math.floor((MAX_WIDTH - H_OVERHEAD) / CHAR_ADVANCE);
  const lines = wrapLabel(label, Math.max(1, maxChars));
  let textWidth = 0;
  for (const line of lines) {
    const w = line.length * CHAR_ADVANCE;
    if (w > textWidth) textWidth = w;
  }
  const width = Math.min(MAX_WIDTH, Math.ceil(textWidth + H_OVERHEAD));
  const height = lines.length * LINE_HEIGHT + V_OVERHEAD;
  return { width, height };
}

// --- Layout -----------------------------------------------------------------

export interface LayoutRect {
  x: number; // @xyflow top-left x
  y: number; // @xyflow top-left y
  width: number;
  height: number;
}

// Lay out a single cluster's concepts as a top→bottom hierarchy. Returns a
// Map of concept id → top-left rect (what @xyflow expects). dagre returns node
// CENTER coords; this function converts so callers never see raw dagre output.
export function layoutCluster(
  concepts: GraphConcept[],
  edges: GraphEdge[],
): Map<string, LayoutRect> {
  const out = new Map<string, LayoutRect>();
  if (concepts.length === 0) return out;

  const idSet = new Set(concepts.map((c) => c.id));

  // `acyclicer: "greedy"` is MANDATORY: LLM prerequisite graphs contain cycles
  // (e.g. mutually-prerequisite concepts) and dagre's ranker requires a DAG.
  // Greedy acyclizer reverses a minimal set of edges internally so ranking
  // terminates; the @xyflow edges we render keep their original source/target,
  // so arrowheads still point the intended way — only dagre's internal
  // ranking is affected. If a cluster hierarchy ever looks inverted, the v1.1
  // fix is to drop cycle edges from the dagre graph and render them as
  // peer-style secondary edges.
  const g = new graphlib.Graph();
  g.setGraph({
    rankdir: "TB",
    ranksep: 80,
    nodesep: 24,
    marginx: 16,
    marginy: 16,
    acyclicer: "greedy",
    ranker: "network-simplex",
  });

  for (const c of concepts) {
    const { width, height } = measureConceptNode(c.label);
    g.setNode(c.id, { width, height });
  }

  for (const e of edges) {
    if (e.source === e.target) continue; // skip self-loops
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue; // intra-cluster only
    if (!HIERARCHICAL.has(e.relation)) continue; // hierarchical only
    g.setEdge(e.source, e.target, { weight: 1, minlen: 1 });
  }

  layout(g);

  for (const c of concepts) {
    const n = g.node(c.id);
    if (!n) continue;
    // dagre gives CENTER coords; @xyflow wants TOP-LEFT.
    out.set(c.id, {
      x: n.x - n.width / 2,
      y: n.y - n.height / 2,
      width: n.width,
      height: n.height,
    });
  }

  return out;
}