"use client";

import { useMemo, useState, useCallback } from "react";
import {
  ReactFlow,
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
import { measureConceptNode, layoutCluster, HIERARCHICAL } from "@/lib/graph/dagre-layout";
import type { GraphConcept, GraphEdge } from "@/lib/graph/clusters";
import type { Band } from "@/lib/mastery/model";

// --- visual encoding constants (monochrome Graph Paper tokens) ---
const CANVAS_W = 900;
const CANVAS_H = 620;

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
  band: Band;
  selected: boolean;
  hovered: boolean;
  dimmed: boolean;
};
type ConceptRFNode = Node<ConceptNodeData, "concept">;

function bandBorder(band: Band): string {
  switch (band) {
    case "slipping": return "border-rule";
    case "strong": return "border-feynman";
    case "learning": return "border-ink";
    default: return "border-ink-3"; // untested + unknown
  }
}

function ConceptNode({ data }: NodeProps<ConceptRFNode>) {
  const filled = data.sourceCount >= 2;
  // Single source of truth for the box dims (also set on the @xyflow Node so
  // edge endpoints attach without waiting for a DOM measure). MUST match the
  // CSS: mono 12px, px-2 py-1, border-2 (border-box) — see measureConceptNode.
  const { width, height } = measureConceptNode(data.label);
  const base = `flex items-center justify-center transition-opacity ${
    data.dimmed ? "opacity-20" : "opacity-100"
  }`;
  const box = filled
    ? "bg-ink text-paper border-2"
    : "bg-paper text-ink-3 border-2";
  const bandBorderClass = bandBorder(data.band);
  const border = (data.selected || data.hovered)
    ? "border-rule border-[3px]"
    : bandBorderClass;
  const dim = data.band === "unknown" ? "opacity-40" : "";
  return (
    <div className={base} style={{ width, height }}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <div
        className={`${box} ${border} ${dim} mono px-2 py-1 text-[12px] leading-tight break-all`}
        style={{ width, height }}
      >
        {data.label}
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { concept: ConceptNode };

interface ConceptGraphProps {
  concepts: GraphConcept[];
  edges: GraphEdge[];
  selectedId: string | null;
  onNodeClick: (id: string) => void;
}

export function ConceptGraph({
  concepts,
  edges,
  selectedId,
  onNodeClick,
}: ConceptGraphProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);

  // Active node ids + per-node degree (undirected) for the current cluster.
  const { nodeIds, degreeById, labelById, sourceCountById, bandById } = useMemo(() => {
    const ids = concepts.map((c) => c.id);
    const deg = new Map<string, number>(ids.map((id) => [id, 0]));
    const lbl = new Map<string, string>(concepts.map((c) => [c.id, c.label]));
    const sc = new Map<string, number>(concepts.map((c) => [c.id, c.sourceCount]));
    const band = new Map<string, Band>(concepts.map((c) => [c.id, c.band ?? "unknown"]));
    for (const e of edges) {
      if (e.source === e.target) continue;
      if (!deg.has(e.source) || !deg.has(e.target)) continue;
      deg.set(e.source, deg.get(e.source)! + 1);
      deg.set(e.target, deg.get(e.target)! + 1);
    }
    return { nodeIds: ids, degreeById: deg, labelById: lbl, sourceCountById: sc, bandById: band };
  }, [concepts, edges]);

  // dagre hierarchical layout (top→bottom). layoutCluster returns @xyflow
  // top-left coords already; fall back to canvas center for any concept missing
  // from the map (defensive — should not happen).
  const positions = useMemo(() => layoutCluster(concepts, edges), [concepts, edges]);

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
      const hovered = id === hoveredId;
      const dimmed = !!focusId && id !== focusId && !(focusNeighbors?.has(id) ?? false);
      const label = labelById.get(id) ?? id;
      const { width, height } = measureConceptNode(label);
      return {
        id,
        type: "concept",
        position: pos,
        width,
        height,
        data: {
          label,
          degree: degreeById.get(id) ?? 0,
          sourceCount: sourceCountById.get(id) ?? 0,
          band: bandById.get(id) ?? "unknown",
          selected,
          hovered,
          dimmed,
        },
      } satisfies Node<ConceptNodeData, "concept">;
    });

    // Concept drill-down: hierarchical edges are the ranking backbone
    // (straight, solid, full opacity); peer edges are secondary (bezier,
    // faded; semantically_similar_to dashed). Arrowheads retained on both
    // for direction.
    const rfEdges: Edge[] = edges
      .filter((e) => nodeIds.includes(e.source) && nodeIds.includes(e.target) && e.source !== e.target)
      .map((e) => {
        const dimmed = !!focusId && e.source !== focusId && e.target !== focusId;
        const id = `${e.source}->${e.target}->${e.relation}`;
        const isHoveredEdge = id === hoveredEdgeId;
        const hierarchical = HIERARCHICAL.has(e.relation);
        const op = edgeOpacity(e.score) * (hierarchical ? 1 : 0.6) * (dimmed ? 0.25 : 1);
        const dashed = e.relation === "semantically_similar_to";
        return {
          id,
          source: e.source,
          target: e.target,
          type: hierarchical ? "straight" : "default",
          style: {
            stroke: hierarchical ? "var(--ink-2)" : "var(--ink-3)",
            strokeWidth: hierarchical ? 1.5 : 1.2,
            strokeOpacity: op,
            strokeDasharray: dashed ? "4 3" : undefined,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: hierarchical ? "var(--ink-2)" : "var(--ink-3)" },
          // Relation label shown only on the hovered edge (spec: small .mono tag
          // near the midpoint on hover). @xyflow renders edge.label as a pill.
          label: isHoveredEdge ? e.relation : undefined,
          labelStyle: { fontFamily: "monospace", fontSize: 10, fill: "var(--ink-2)" },
          labelBgStyle: { fill: "var(--paper)" },
          labelBgPadding: [2, 1] as [number, number],
        };
      });

    return { rfNodes, rfEdges };
  }, [nodeIds, positions, labelById, degreeById, sourceCountById, bandById, edges, selectedId, focusId, focusNeighbors, hoveredId, hoveredEdgeId]);

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