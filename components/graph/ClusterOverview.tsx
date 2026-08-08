// Presentational cluster-card grid for the /graph overview (Task 3 of the
// Topic Map redesign). Receives precomputed per-cluster stats from the page
// (Task 4 wires it in) and renders a scannable CSS grid of cards. No hooks,
// no state — a plain component. Graph Paper tokens only.

import type { Cluster } from "@/lib/graph/clusters";
import type { ClusterMastery } from "@/lib/graph/cluster-stats";
import { representativeConcepts } from "@/lib/graph/cluster-stats";

interface ClusterOverviewProps {
  clusters: Cluster[];
  masteryByCluster: Map<string, ClusterMastery>;
  externalLinksByCluster: Map<string, number>;
  degreeMap: Map<string, number>;
  labelById: Map<string, string>;
  onSelectCluster: (clusterId: string) => void;
}

// Mastery band segments, rendered in this fixed order so every bar reads the
// same way left→right. Untested + unknown are bucketed into one `ink-3` segment
// (their counts summed) — matches the band-border mapping for untested/unknown.
const SEGMENTS: Array<{
  key: "strong" | "learning" | "slipping" | "un";
  className: string;
}> = [
  { key: "strong", className: "bg-feynman" },
  { key: "learning", className: "bg-ink" },
  { key: "slipping", className: "bg-rule" },
  { key: "un", className: "bg-ink-3" },
];

export function ClusterOverview({
  clusters,
  masteryByCluster,
  externalLinksByCluster,
  degreeMap,
  labelById,
  onSelectCluster,
}: ClusterOverviewProps) {
  if (clusters.length === 0) {
    return <div className="mono text-[12px] text-ink-3">no clusters</div>;
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {clusters.map((cluster) => {
        const m = masteryByCluster.get(cluster.id) ?? {
          strong: 0,
          learning: 0,
          slipping: 0,
          untested: 0,
          unknown: 0,
        };
        const un = m.untested + m.unknown;
        const total = m.strong + m.learning + m.slipping + un;
        const segments: Array<{ className: string; pct: number }> = [];
        if (total > 0) {
          for (const seg of SEGMENTS) {
            const count = seg.key === "un" ? un : m[seg.key];
            if (count > 0) segments.push({ className: seg.className, pct: (count / total) * 100 });
          }
        }
        const reps = representativeConcepts(cluster, degreeMap, labelById, 3);
        const external = externalLinksByCluster.get(cluster.id) ?? 0;

        return (
          <button
            key={cluster.id}
            type="button"
            onClick={() => onSelectCluster(cluster.id)}
            className="group text-left rounded-[3px] border border-line bg-paper-2 p-4 transition-colors hover:border-ink/40 focus:outline-none focus:border-ink/40"
          >
            <div className="mono line-clamp-2 text-[13px] leading-tight text-ink">
              {cluster.name}
            </div>
            <div className="mono mt-1 text-[10px] text-ink-3">
              {cluster.conceptCount} concepts
            </div>

            {/* Mastery stacked bar. Empty track rendered when total === 0. */}
            <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-[2px] bg-paper-3">
              {segments.map((seg, i) => (
                <div
                  key={i}
                  className={seg.className}
                  style={{ width: `${seg.pct}%` }}
                />
              ))}
            </div>
            <div className="mono mt-1.5 text-[10px] text-ink-3">
              {m.strong}S {m.learning}L {m.slipping} slip {un} un
            </div>

            {/* Representative concept labels. */}
            <div className="mt-3">
              {reps.map((label) => (
                <div key={label} className="mono mt-0.5 truncate text-[11px] text-ink-2">
                  · {label}
                </div>
              ))}
            </div>

            <div className="mono mt-3 text-[10px] text-ink-3">
              → {external} external links
            </div>

            {/* Isolated cluster drill-down is a flat row (no intra-cluster
                edges); head that off for large isolated buckets. */}
            {cluster.id === "isolated" && cluster.conceptCount > 40 && (
              <div className="mono mt-1 text-[10px] text-ink-3">
                no internal links — flat drill-down
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}