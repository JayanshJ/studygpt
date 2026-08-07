import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceCenter,
  type SimulationNodeDatum,
} from "d3-force";

export interface LayoutNode {
  id: string;
  radius: number;
}

export interface LayoutLink {
  source: string;
  target: string;
}

// Deterministic-ish initial position: spread nodes on a circle around the
// center, angle derived from a stable string hash of the id. Same data → same
// start → similar settled layout across runs (d3-force's internal jitter is
// acceptable; cluster membership — the thing that must be stable — is fixed by
// clusters.ts, not here).
function hashAngle(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return (((h % 1000) + 1000) % 1000) / 1000; // 0..1
}

// Synchronously compute node positions via d3-force. Runs a fixed number of
// ticks then stops, returning a Map of id → {x,y}. Caller maps these onto
// @xyflow/react Node positions.
export function layoutNodes(
  nodes: LayoutNode[],
  links: LayoutLink[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return out;
  if (nodes.length === 1) {
    out.set(nodes[0].id, { x: width / 2, y: height / 2 });
    return out;
  }

  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) / 3;

  type SimNode = SimulationNodeDatum & { id: string; r: number };
  const simNodes: SimNode[] = nodes.map((n, i) => {
    const a = (hashAngle(n.id) + i / nodes.length) * Math.PI * 2;
    return { id: n.id, r: n.radius, x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
  });
  const idIndex = new Map(simNodes.map((n, i) => [n.id, i]));

  // Resolve links to node indices (d3-force replaces source/target with node
  // refs when given an id accessor; we pass objects with id fields + the accessor).
  const simLinks = links
    .filter((l) => idIndex.has(l.source) && idIndex.has(l.target) && l.source !== l.target)
    .map((l) => ({ source: l.source, target: l.target }));

  const simulation = forceSimulation<SimNode>(simNodes)
    .force("charge", forceManyBody().strength(-240))
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(simLinks)
        .id((d) => d.id)
        .distance(90),
    )
    .force("collide", forceCollide<SimNode>().radius((d) => d.r + 8))
    .force("center", forceCenter(cx, cy));

  // Synchronous settle: run fixed ticks, then stop so it doesn't keep animating.
  for (let i = 0; i < 300; i++) simulation.tick();
  simulation.stop();

  for (const n of simNodes) out.set(n.id, { x: n.x ?? cx, y: n.y ?? cy });
  return out;
}