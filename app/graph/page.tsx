"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Project } from "@/lib/db/schema";
import {
  detectCommunities,
  conceptClusterMap,
  type GraphData,
  type Cluster,
  type GraphConcept,
  type GraphEdge,
} from "@/lib/graph/clusters";
import {
  masteryByCluster,
  externalLinkCountByCluster,
} from "@/lib/graph/cluster-stats";
import { ConceptGraph } from "@/components/graph/ConceptGraph";
import { ClusterOverview } from "@/components/graph/ClusterOverview";
import { DetailPanel } from "@/components/graph/DetailPanel";

type View = { kind: "overview" } | { kind: "cluster"; clusterId: string };

export default function GraphPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "overview" });
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Load project list once.
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : []))
      .then((ps: Project[]) => setProjects(Array.isArray(ps) ? ps : []))
      .catch(() => setProjects([]));
  }, []);

  // Pick projectId from ?projectId= on first load.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("projectId");
    // Syncing a URL param into state on mount is a legitimate one-shot read of an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) setProjectId(q);
  }, []);

  const loadData = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError(null);
    setView({ kind: "overview" });
    setSelectedConceptId(null);
    try {
      const res = await fetch(`/api/concepts?projectId=${encodeURIComponent(id)}`);
      if (res.ok) setData(await res.json());
      else setLoadError("Could not load concept graph");
    } catch {
      setLoadError("Could not load concept graph");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-mount / on-projectId-change is the legitimate data-loading pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (projectId) void loadData(projectId);
    else setData(null);
  }, [projectId, loadData]);

  const clusters: Cluster[] = useMemo(
    () => (data ? detectCommunities(data.concepts, data.edges) : []),
    [data],
  );
  const c2cluster = useMemo(() => conceptClusterMap(clusters), [clusters]);
  const clusterById = useMemo(() => new Map(clusters.map((c) => [c.id, c])), [clusters]);

  // Active-view concept + edge sets. Only the cluster drill-down branch
  // produces data; the overview renders ClusterOverview directly from the
  // dedicated memos below, so `active` is unused when view.kind === "overview".
  const active = useMemo(() => {
    if (!data || view.kind !== "cluster") {
      return { kind: "overview" as const, concepts: [] as GraphConcept[], edges: [] as GraphEdge[] };
    }
    const cl = clusterById.get(view.clusterId);
    const memberSet = new Set(cl?.conceptIds ?? []);
    const concepts = data.concepts.filter((c) => memberSet.has(c.id));
    const edges = data.edges.filter((e) => memberSet.has(e.source) && memberSet.has(e.target));
    return { kind: "concept" as const, concepts, edges };
  }, [data, view, clusterById]);

  // Per-cluster stats feeding ClusterOverview. Computed once per data change
  // (independent of the current view) so switching to the overview is instant.
  const masteryByClusterMap = useMemo(
    () => (data ? masteryByCluster(clusters, data.concepts, c2cluster) : new Map()),
    [data, clusters, c2cluster],
  );
  const externalLinksMap = useMemo(
    () => (data ? externalLinkCountByCluster(clusters, data.edges, c2cluster) : new Map()),
    [data, clusters, c2cluster],
  );
  // Undirected degree per concept. clusters.ts keeps `degreeMap` internal, so
  // recompute it here (the protected clusters.ts module is left untouched).
  const degreeMapById = useMemo(() => {
    if (!data) return new Map<string, number>();
    const deg = new Map<string, number>();
    for (const c of data.concepts) deg.set(c.id, 0);
    for (const e of data.edges) {
      if (e.source === e.target) continue;
      if (!deg.has(e.source) || !deg.has(e.target)) continue;
      deg.set(e.source, deg.get(e.source)! + 1);
      deg.set(e.target, deg.get(e.target)! + 1);
    }
    return deg;
  }, [data]);
  const labelById = useMemo(
    () => (data ? new Map(data.concepts.map((c) => [c.id, c.label])) : new Map()),
    [data],
  );

  const selectedClusterName = useMemo(() => {
    if (view.kind !== "cluster") return null;
    return clusterById.get(view.clusterId)?.name ?? null;
  }, [view, clusterById]);

  function handleNodeClick(id: string) {
    setSelectedConceptId(id);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    const q = search.trim().toLowerCase();
    if (!q) return;
    const match = data.concepts.find((c) => c.label.toLowerCase().includes(q));
    if (!match) return;
    const cid = c2cluster.get(match.id);
    if (cid) setView({ kind: "cluster", clusterId: cid });
    setSelectedConceptId(match.id);
  }

  const hasGraph = !!data && data.concepts.length > 0;

  return (
    <div className="graph-paper min-h-screen">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink">
            ← Back to chat
          </Link>
          <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-feynman" />
            Concept graph
          </span>
        </div>

        <h1 className="mb-6 text-[1.6rem] leading-tight text-ink">Concept graph</h1>

        {/* Controls: project picker + view switch + search */}
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-line pb-4">
          <select
            value={projectId ?? ""}
            onChange={(e) => setProjectId(e.target.value || null)}
            className="mono rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none focus:border-ink/40"
          >
            <option value="">choose a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {view.kind === "cluster" && (
            <button
              onClick={() => {
                setView({ kind: "overview" });
                setSelectedConceptId(null);
              }}
              className="mono rounded-[3px] border border-line bg-paper px-3 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40"
            >
              ← overview
            </button>
          )}

          <form onSubmit={handleSearch} className="flex gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="find a concept…"
              className="mono rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] text-ink outline-none placeholder:text-ink-3 focus:border-ink/40"
            />
            <button
              type="submit"
              className="mono rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40"
            >
              find
            </button>
          </form>

          {data && hasGraph && (
            <span className="mono text-[11px] text-ink-3">
              {data.concepts.length} concepts · {data.edges.length} edges · {clusters.length} clusters
            </span>
          )}
        </div>

        {/* Body: graph + detail panel */}
        {!projectId ? (
          <p className="mono py-10 text-center text-[12px] text-ink-3">choose a project to view its concept graph</p>
        ) : loading ? (
          <p className="mono py-10 text-center text-[12px] text-ink-3">loading graph…</p>
        ) : loadError ? (
          <p className="mono py-10 text-center text-[12px] text-rule">{loadError}</p>
        ) : !hasGraph ? (
          <div className="mono py-10 text-center text-[12px] text-ink-3">
            no concept graph yet —{" "}
            <Link href="/projects" className="text-ink-2 underline">
              build one on /projects
            </Link>
          </div>
        ) : view.kind === "overview" ? (
          <div className="grid gap-6 md:grid-cols-[1fr_300px]">
            <ClusterOverview
              clusters={clusters}
              masteryByCluster={masteryByClusterMap}
              externalLinksByCluster={externalLinksMap}
              degreeMap={degreeMapById}
              labelById={labelById}
              onSelectCluster={(id) => {
                setView({ kind: "cluster", clusterId: id });
                setSelectedConceptId(null);
              }}
            />
            <DetailPanel
              conceptId={selectedConceptId}
              clusterName={selectedClusterName}
              onSelectConcept={setSelectedConceptId}
            />
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1fr_300px]">
            <ConceptGraph
              concepts={active.concepts}
              edges={active.edges}
              selectedId={selectedConceptId}
              onNodeClick={handleNodeClick}
              showSemSim={false}
              showAmbiguous={false}
            />
            <DetailPanel
              conceptId={selectedConceptId}
              clusterName={selectedClusterName}
              onSelectConcept={setSelectedConceptId}
            />
          </div>
        )}
      </div>
    </div>
  );
}