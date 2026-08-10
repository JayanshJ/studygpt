"use client";

// Concept-graph drill-down rendered with Cytoscape.js + the cluster-aware
// fcose layout. Replaces the prior @xyflow + dagre renderer.
//
// Cytoscape draws to a <canvas>, so the Graph Paper tokens are resolved from
// the live <html> computed style (graph-tokens.ts) and the stylesheet is
// rebuilt when the theme flips (MutationObserver on html[data-theme]) —
// colors update without re-laying-out. The default edge filter
// (lib/graph/relations.filterEdges) hides semantically_similar_to + AMBIGUOUS
// edges, which are the main thing crisscrossing the graph; the two toggles
// (passed from the page) reveal them.

import { useEffect, useMemo, useRef } from "react";
import cytoscape from "cytoscape";
import fcose from "cytoscape-fcose";
import { measureConceptNode, NODE_BORDER } from "@/lib/graph/node-size";
import { HIERARCHICAL, edgeOpacity, filterEdges } from "@/lib/graph/relations";
import { readGraphTokens, buildCytoscapeStyle } from "@/lib/graph/graph-tokens";
import type { GraphConcept, GraphEdge } from "@/lib/graph/clusters";

// Register the fcose layout extension once at module load.
cytoscape.use(fcose);

// fcose is an extension-supplied layout not in cytoscape's built-in
// LayoutOptions union, so the options object is narrowed via one cast.
function runLayout(cy: cytoscape.Core, randomize: boolean): void {
  cy.layout({
    name: "fcose",
    quality: "default",
    animate: false,
    randomize,
    nodeRepulsion: 8000,
    idealEdgeLength: 100,
    nodeSeparation: 60,
    packComponents: true,
    nodeDimensionsIncludeLabels: true,
    padding: 40,
  } as unknown as cytoscape.LayoutOptions).run();
  cy.fit(undefined, 40);
}

interface ConceptGraphProps {
  concepts: GraphConcept[];
  edges: GraphEdge[];
  selectedId: string | null;
  onNodeClick: (id: string) => void;
  showSemSim: boolean;
  showAmbiguous: boolean;
}

export function ConceptGraph({
  concepts,
  edges,
  selectedId,
  onNodeClick,
  showSemSim,
  showAmbiguous,
}: ConceptGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);
  const prevNodeSigRef = useRef<string>("");
  // Keep the latest onNodeClick in a ref so the (once-bound) tap handler never
  // goes stale without re-binding the Cytoscape event. Updated in an effect,
  // never during render.
  const onNodeClickRef = useRef(onNodeClick);
  useEffect(() => {
    onNodeClickRef.current = onNodeClick;
  }, [onNodeClick]);

  // Build Cytoscape elements (nodes sized to labels + filtered edges) and a
  // node-set signature to detect "new cluster" vs "filter toggle only".
  const { elements, nodeSig } = useMemo(() => {
    const ids = concepts.map((c) => c.id);
    const idSet = new Set(ids);
    const filtered = filterEdges(edges, { showSemSim, showAmbiguous });

    const nodes: cytoscape.ElementDefinition[] = concepts.map((c) => {
      const { width, height } = measureConceptNode(c.label);
      // Inner text width (inside the border) — kept >= the measurer's text
      // area so Cytoscape never wraps to MORE lines than the measured box
      // height (overflow-safe; extra whitespace is fine, clipping is not).
      const textMax = Math.max(8, width - NODE_BORDER * 2);
      const filled = c.sourceCount >= 2;
      const band = c.band ?? "unknown";
      return {
        group: "nodes",
        data: {
          id: c.id,
          label: c.label,
          width,
          height,
          textMax,
          sourceCount: c.sourceCount,
          band,
        },
        classes: [filled ? "filled" : "", `band-${band}`].join(" ").trim(),
      };
    });

    const cyEdges: cytoscape.ElementDefinition[] = filtered
      .filter((e) => e.source !== e.target && idSet.has(e.source) && idSet.has(e.target))
      .map((e) => {
        const hierarchical = HIERARCHICAL.has(e.relation);
        const op = edgeOpacity(e.score) * (hierarchical ? 1 : 0.6);
        const classes = [
          hierarchical ? "hierarchical" : "peer",
          e.relation === "semantically_similar_to" ? "sem-sim" : "",
        ].filter(Boolean).join(" ");
        return {
          group: "edges",
          data: {
            id: `${e.source}->${e.target}->${e.relation}`,
            source: e.source,
            target: e.target,
            relation: e.relation,
            op,
          },
          classes,
        };
      });

    return {
      elements: [...nodes, ...cyEdges],
      nodeSig: ids.slice().sort().join(","),
    };
  }, [concepts, edges, showSemSim, showAmbiguous]);

  // Create the Cytoscape instance once; bind handlers + a theme observer.
  // Elements are populated by the sync effect below.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const cy = cytoscape({
      container,
      elements: [],
      style: buildCytoscapeStyle(readGraphTokens()),
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: false,
      autounselectify: false,
    } as cytoscape.CytoscapeOptions);
    cyRef.current = cy;

    cy.on("tap", "node", (evt: cytoscape.EventObject) => {
      onNodeClickRef.current(evt.target.id());
    });

    // Hover: emphasize the node + dim everything not in its neighborhood.
    cy.on("mouseover", "node", (evt: cytoscape.EventObject) => {
      const node = evt.target;
      node.addClass("hovered");
      const neighbors = node.neighborhood().nodes();
      cy.nodes().not(node).not(neighbors).addClass("dimmed");
      cy.edges().not(node.connectedEdges()).addClass("dimmed");
    });
    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("hovered dimmed");
    });

    // Edge hover: reveal the relation label.
    cy.on("mouseover", "edge", (evt: cytoscape.EventObject) => evt.target.addClass("hovered"));
    cy.on("mouseout", "edge", (evt: cytoscape.EventObject) => evt.target.removeClass("hovered"));

    // Rebuild the stylesheet when the theme flips — colors update, positions
    // (and the layout) are untouched.
    const observer = new MutationObserver(() => {
      if (!cyRef.current) return;
      cyRef.current.style(buildCytoscapeStyle(readGraphTokens()));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    return () => {
      observer.disconnect();
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Sync elements when the data or filter changes. New cluster (node set
  // changed) → full rebuild + fcose randomize:true + fit. Filter toggle or
  // edge reload on the same cluster → edges-only resync + randomize:false
  // (nodes keep their positions) + fit.
  //
  // The `cy.nodes().length === 0` guard covers the React strict-mode (dev)
  // remount race: mount → cleanup (cy.destroy) → re-mount (fresh empty cy).
  // prevNodeSigRef survives the cleanup, so without the guard the second pass
  // would take the edges-only path against an empty cy and try to add edges
  // whose source nodes don't exist yet.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const nodesChanged = nodeSig !== prevNodeSigRef.current || cy.nodes().length === 0;
    prevNodeSigRef.current = nodeSig;

    if (nodesChanged) {
      cy.elements().remove();
      cy.add(elements);
      runLayout(cy, true);
    } else {
      cy.edges().remove();
      cy.add(elements.filter((e) => e.group === "edges"));
      runLayout(cy, false);
    }
  }, [elements, nodeSig]);

  // Reflect external selection (search / detail panel) into the canvas:
  // unselect everything, then select + center the chosen concept.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.$(":selected").unselect();
    if (!selectedId) return;
    const ele = cy.getElementById(selectedId);
    if (ele.empty()) return;
    ele.select();
    cy.center(ele);
  }, [selectedId]);

  return (
    <div className="relative h-[620px] w-full rounded-[3px] border border-line bg-paper-2">
      <div ref={containerRef} className="h-full w-full" />
      {concepts.length === 0 && (
        <div className="mono pointer-events-none absolute inset-0 flex items-center justify-center text-[12px] text-ink-3">
          nothing to show
        </div>
      )}
    </div>
  );
}