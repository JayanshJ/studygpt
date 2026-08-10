// Graph Paper Lab token resolution + Cytoscape stylesheet builder.
//
// Cytoscape renders to a <canvas>, so its style objects need CONCRETE color
// strings — CSS `var(--ink-2)` does not resolve on a canvas the way it did on
// @xyflow's DOM nodes. `readGraphTokens()` resolves the Graph Paper tokens
// (and the mono font stack) from the live computed style on <html>, so the
// CSS in globals.css stays the single source of truth. The component rebuilds
// the stylesheet via `buildCytoscapeStyle(tokens)` whenever the theme flips
// (MutationObserver on html[data-theme]) — colors update without re-laying-out.
//
// `buildCytoscapeStyle` is a pure function of the resolved tokens. String
// mappers (`data(width)`, `data(op)`, …) are used for data-driven values; the
// whole array is cast to Cytoscape's stylesheet type once at the return, since
// some numeric-only style fields (opacity) accept a string mapper at runtime
// but not in the strict type.

import type { StylesheetJson } from "cytoscape";

export interface GraphTokens {
  paper: string; // unfilled node background
  paper2: string; // canvas / filled-node label background
  ink: string; // filled node background, learning band border
  ink2: string; // secondary text, hierarchical edges
  ink3: string; // faint captions, peer edges, untested/unknown border
  rule: string; // red notebook rule, slipping band, selection
  feynman: string; // chalk blue, strong band
  line: string; // hairlines
  mono: string; // resolved mono font stack for canvas text
}

function readVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Resolve the Graph Paper tokens from the live <html> computed style. Called
// on mount and whenever html[data-theme] changes.
export function readGraphTokens(): GraphTokens {
  return {
    paper: readVar("--paper", "#f2f0e7"),
    paper2: readVar("--paper-2", "#fbfaf3"),
    ink: readVar("--ink", "#1f2020"),
    ink2: readVar("--ink-2", "#565850"),
    ink3: readVar("--ink-3", "#6f7166"),
    rule: readVar("--rule", "#c8443a"),
    feynman: readVar("--feynman", "#2e5c8a"),
    line: readVar("--line", "#d7d5c8"),
    mono: readVar("--font-mono", "ui-monospace, monospace"),
  };
}

// A stylesheet block with a loose style shape (string mappers are values here,
// narrowed to Cytoscape's strict type once at the build return). `data(...)` /
// `mapData(...)` string mappers are fully supported by Cytoscape at runtime.
type StyleBlock = { selector: string; style: Record<string, string | number> };

// Build the monochrome, band-aware Cytoscape stylesheet from resolved tokens.
// Encodes mastery band borders (strong=feynman, learning=ink, slipping=rule,
// untested/unknown=ink-3), filled-vs-unfilled nodes (sourceCount>=2), the
// hierarchical-vs-peer edge split, dashed sem-sim edges, and hover/selection
// emphasis. Per-element `classes` set at build time drive the selectors here.
export function buildCytoscapeStyle(t: GraphTokens): StylesheetJson {
  const blocks: StyleBlock[] = [
    // --- Nodes: base ------------------------------------------------------
    {
      selector: "node",
      style: {
        shape: "round-rectangle",
        width: "data(width)",
        height: "data(height)",
        "background-color": t.paper, // default (unfilled)
        "border-width": 2,
        "border-color": t.ink3, // default; overridden per band
        label: "data(label)",
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "text-max-width": "data(textMax)",
        color: t.ink3, // default label color (unfilled)
        "font-family": t.mono,
        "font-size": 12,
        "font-weight": "normal",
      },
    },
    // Filled node (>=2 sources): ink background, paper label.
    { selector: "node.filled", style: { "background-color": t.ink, color: t.paper2 } },
    // Mastery band borders.
    { selector: "node.band-strong", style: { "border-color": t.feynman } },
    { selector: "node.band-learning", style: { "border-color": t.ink } },
    { selector: "node.band-slipping", style: { "border-color": t.rule } },
    { selector: "node.band-untested", style: { "border-color": t.ink3 } },
    { selector: "node.band-unknown", style: { "border-color": t.ink3, opacity: 0.45 } },
    // Selection + hover emphasis (rule border, thicker).
    {
      selector: "node:selected, node.hovered",
      style: { "border-color": t.rule, "border-width": 3, "z-index": 99 },
    },
    // Hover-dim: non-neighbors fade.
    { selector: "node.dimmed", style: { opacity: 0.2 } },

    // --- Edges: base ------------------------------------------------------
    {
      selector: "edge",
      style: {
        "curve-style": "bezier",
        "line-color": t.ink3,
        width: 1.2,
        "line-opacity": "data(op)",
        "target-arrow-color": t.ink3,
        "target-arrow-shape": "none",
        "arrow-scale": 1,
        "loop-direction": "-90deg",
      },
    },
    // Hierarchical edges: straight, ink-2, arrowed, full opacity weight.
    {
      selector: "edge.hierarchical",
      style: {
        "curve-style": "straight",
        "line-color": t.ink2,
        width: 1.5,
        "target-arrow-shape": "triangle",
        "target-arrow-color": t.ink2,
      },
    },
    // semantically_similar_to: dashed.
    { selector: "edge.sem-sim", style: { "line-style": "dashed" } },
    // Edge hover: reveal the relation label in a small mono tag.
    {
      selector: "edge.hovered",
      style: {
        label: "data(relation)",
        "font-size": 10,
        color: t.ink2,
        "text-background-color": t.paper2,
        "text-background-padding": "2px",
        "text-background-opacity": 1,
        width: 2,
        "line-color": t.ink2,
      },
    },
    { selector: "edge.dimmed", style: { "line-opacity": 0.08 } },

    // --- Core: canvas background -----------------------------------------
    { selector: "core", style: { "active-bg-color": t.ink3, "active-bg-opacity": 0.15 } },
  ];
  return blocks as unknown as StylesheetJson;
}