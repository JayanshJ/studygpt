"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Compass, List, Maximize2, Search, Share2 } from "lucide-react";
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
import { LearningPathTrajectory } from "@/components/graph/LearningPathTrajectory";
import { MasteryList, type Row } from "@/components/graph/MasteryList";
import {
  computeStatuses,
  computeCoverage,
  computeClusterStatuses,
  computeTrajectory,
  type ConceptStatus,
  type Trajectory,
} from "@/lib/graph/learning-path";
import { filterEdges } from "@/lib/graph/relations";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Switch } from "@/components/ui/Switch";
import { Badge } from "@/components/ui/Badge";
import { motion } from "motion/react";
import { useMotion, fadeUp } from "@/lib/motion";

type View = { kind: "overview" } | { kind: "cluster"; clusterId: string };

const NONE = "__none__";

// Build the chat prompt handed off from a trajectory row's "ask" link. The
// chat is project-scoped, so RAG explains from that project's materials.
function buildAskPrompt(label: string, step: number) {
  return `I'm working through my study path and I'm on "${label}" (step ${step}). Explain it from my materials, then quiz me to check my understanding.`;
}

export default function GraphPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ kind: "overview" });
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Edge-filter toggles for the drill-down (off by default → hide the noisy
  // inferred-similarity + AMBIGUOUS edges). Reset when switching projects.
  const [showSemSim, setShowSemSim] = useState(false);
  const [showAmbiguous, setShowAmbiguous] = useState(false);
  // Learning-path mode (default on — the graph should be useful by default).
  // Reset on project switch so a stale overlay doesn't survive a reload.
  const [pathMode, setPathMode] = useState(true);
  // Fullscreen overlay for the cluster-view graph (CSS-overlay, not the browser
  // Fullscreen API — no permission prompt and works inside arbitrary layout).
  // Reset when switching projects so a stale overlay doesn't survive a reload.
  const [fullscreen, setFullscreen] = useState(false);
  // List/graph view toggle. When on, the overview body is replaced by the
  // per-concept mastery list (the old /mastery page, folded in here). Default
  // from ?view=list (set by the /mastery redirect). Persists across project
  // switches — only the rows re-fetch.
  const [listMode, setListMode] = useState(false);
  const [masteryRows, setMasteryRows] = useState<Row[] | null>(null);
  const [masteryLoading, setMasteryLoading] = useState(false);
  const [masteryError, setMasteryError] = useState<string | null>(null);
  const m = useMotion();

  // Load project list once.
  useEffect(() => {
    fetch("/api/projects")
      .then((r) => (r.ok ? r.json() : []))
      .then((ps: Project[]) => setProjects(Array.isArray(ps) ? ps : []))
      .catch(() => setProjects([]));
  }, []);

  // Pick projectId from ?projectId= and view from ?view=list on first load.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("projectId");
    const v = params.get("view");
    // Syncing URL params into state on mount is a legitimate one-shot read of an external system.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) setProjectId(q);
    if (v === "list") setListMode(true);
  }, []);

  const loadData = useCallback(async (id: string) => {
    setLoading(true);
    setLoadError(null);
    setView({ kind: "overview" });
    setSelectedConceptId(null);
    setShowSemSim(false);
    setShowAmbiguous(false);
    setFullscreen(false);
    setPathMode(true);
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

  // Lazy mastery fetch: only when listMode is on (keeps graph mode free of an
  // extra request). Re-runs on project change while listMode stays on — the
  // toggle persists across project switches, only the rows re-fetch.
  const loadMastery = useCallback(async (id: string) => {
    setMasteryLoading(true);
    setMasteryError(null);
    try {
      const res = await fetch(`/api/mastery?projectId=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error("mastery failed");
      const d: { rows: Row[] } = await res.json();
      setMasteryRows(d.rows);
    } catch {
      setMasteryError("Could not load mastery");
    } finally {
      setMasteryLoading(false);
    }
  }, []);

  useEffect(() => {
    // Fetch-on-toggle / on-projectId-change is the legitimate data-loading pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (listMode && projectId) void loadMastery(projectId);
  }, [listMode, projectId, loadMastery]);

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

  // Edges visible in the current drill-down after the filter (for the
  // "showing N of M edges" caption). Only meaningful in the cluster view.
  const visibleEdgeCount = useMemo(
    () => (active.kind === "concept" ? filterEdges(active.edges, { showSemSim, showAmbiguous }).length : 0),
    [active, showSemSim, showAmbiguous],
  );

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

  // Learning-path: status per concept (strict transitive prerequisite_of
  // gating), global coverage, and per-cluster status/frontier. All client-side
  // from data /api/concepts already returns. Recomputed when data or clusters
  // change — so after a review, the next graph load reflects new mastery.
  const statuses = useMemo(
    () => (data ? computeStatuses(data.concepts, data.edges) : new Map<string, ConceptStatus>()),
    [data],
  );
  const coverage = useMemo(() => computeCoverage(statuses), [statuses]);
  const clusterStatuses = useMemo(
    () => (data ? computeClusterStatuses(clusters, statuses, data.edges, labelById) : []),
    [clusters, statuses, data, labelById],
  );
  const clusterStatusById = useMemo(
    () => new Map(clusterStatuses.map((c) => [c.clusterId, c])),
    [clusterStatuses],
  );
  // conceptId -> cluster name (for the trajectory's per-row cluster tag).
  const clusterNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of data?.concepts ?? []) {
      const cid = c2cluster.get(c.id);
      const name = cid ? clusterById.get(cid)?.name ?? null : null;
      if (name) m.set(c.id, name);
    }
    return m;
  }, [data, c2cluster, clusterById]);
  // The linear learning path: remaining concepts in topological order, with
  // the "you are here" marker. Client-side; reflows when data/statuses change.
  const trajectory: Trajectory | null = useMemo(
    () => (data ? computeTrajectory(data.concepts, data.edges, statuses, labelById, clusterNameById) : null),
    [data, statuses, labelById, clusterNameById],
  );

  const selectedClusterName = useMemo(() => {
    if (view.kind !== "cluster") return null;
    return clusterById.get(view.clusterId)?.name ?? null;
  }, [view, clusterById]);

  function handleNodeClick(id: string) {
    setSelectedConceptId(id);
  }

  // Drill into a cluster and immediately select its top ready concept
  // (the cluster's "start here" entrypoint from the overview card).
  function handleSelectStartHere(clusterId: string, conceptId: string) {
    setView({ kind: "cluster", clusterId });
    setSelectedConceptId(conceptId);
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
  const title = listMode ? "Mastery" : "Concept graph";

  return (
    <div className="graph-paper h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 py-6 tab:px-6 tab:py-10">
        <motion.div {...m} variants={fadeUp} className="mb-5 flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
          <Share2 size={16} className="text-feynman" />
          {title}
        </motion.div>

        <motion.h1 {...m} variants={fadeUp} className="mb-6 font-serif text-[1.6rem] leading-tight text-ink">
          {title}
        </motion.h1>

        {hasGraph && pathMode && !listMode && (
          <motion.div {...m} variants={fadeUp} className="mb-4 flex flex-wrap items-center gap-3 rounded-[4px] border border-border bg-surface px-4 py-3">
            <div className="flex items-baseline gap-2">
              <span className="font-serif text-[1.4rem] leading-none text-ink">{coverage.percent}%</span>
              <span className="mono text-[11px] text-content-faint">mastered</span>
            </div>
            <div className="mono flex items-center gap-3 text-[11px] text-content-muted">
              <span><span className="text-rule">{coverage.ready}</span> ready</span>
              <span>{coverage.inProgress} in progress</span>
              <span className="text-content-faint">{coverage.locked} locked</span>
            </div>
            {/* Slim coverage bar */}
            <div className="ml-auto flex h-1.5 w-40 overflow-hidden rounded-[2px] bg-surface-2">
              <div className="bg-feynman" style={{ width: `${coverage.percent}%` }} />
            </div>
          </motion.div>
        )}

        {/* Controls: project picker + view switch + search */}
        <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-border pb-4">
          <Select
            value={projectId ?? NONE}
            onValueChange={(v) => setProjectId(v === NONE ? null : v)}
          >
            <SelectTrigger aria-label="Project" className="w-[200px]">
              <SelectValue placeholder="choose a project…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>choose a project…</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* List/graph view toggle (the folded-in mastery list). Shown only
              when the graph exists; graph-only controls below are hidden while
              listMode is on so the list view stays uncluttered. */}
          {hasGraph && (
            <label className="mono flex cursor-pointer items-center gap-1.5 text-[12px] text-content-muted">
              <Switch checked={listMode} onCheckedChange={setListMode} />
              <List size={12} />
              list
            </label>
          )}

          {view.kind === "cluster" && !listMode && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setView({ kind: "overview" });
                setSelectedConceptId(null);
              }}
            >
              <ChevronLeft size={14} />
              overview
            </Button>
          )}

          {!listMode && (
            <form onSubmit={handleSearch} className="flex gap-2">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="find a concept…"
                className="w-[180px]"
              />
              <Button type="submit" variant="secondary" size="sm">
                <Search size={14} />
                find
              </Button>
            </form>
          )}

          {hasGraph && !listMode && (
            <label className="mono flex cursor-pointer items-center gap-1.5 text-[12px] text-content-muted">
              <Switch checked={pathMode} onCheckedChange={setPathMode} />
              <Compass size={12} />
              learning path
            </label>
          )}

          {data && hasGraph && !listMode && (
            <Badge tone="neutral" className="ml-auto">
              {data.concepts.length} concepts · {data.edges.length} edges · {clusters.length} clusters
            </Badge>
          )}

          {view.kind === "cluster" && !listMode && (
            <div className="flex w-full items-center gap-4 pt-1">
              <label className="mono flex cursor-pointer items-center gap-1.5 text-[12px] text-content-muted">
                <Switch checked={showSemSim} onCheckedChange={setShowSemSim} />
                show similar
              </label>
              <label className="mono flex cursor-pointer items-center gap-1.5 text-[12px] text-content-muted">
                <Switch checked={showAmbiguous} onCheckedChange={setShowAmbiguous} />
                show ambiguous
              </label>
              <span className="mono text-[11px] text-content-faint">
                showing {visibleEdgeCount} of {active.kind === "concept" ? active.edges.length : 0} edges
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setFullscreen(true)}
                aria-label="Fullscreen graph"
                className="ml-auto"
              >
                <Maximize2 size={14} />
                fullscreen
              </Button>
            </div>
          )}
        </div>

        {/* Body: graph + detail panel */}
        {!projectId ? (
          <p className="mono py-10 text-center text-[12px] text-content-faint">choose a project to view its concept graph</p>
        ) : loading ? (
          <p className="mono py-10 text-center text-[12px] text-content-faint">loading graph…</p>
        ) : loadError ? (
          <p className="mono py-10 text-center text-[12px] text-danger">{loadError}</p>
        ) : !hasGraph ? (
          <div className="mono py-10 text-center text-[12px] text-content-faint">
            no concept graph yet —{" "}
            <Link href="/projects" className="text-content-muted underline">
              build one on /projects
            </Link>
          </div>
        ) : listMode ? (
          <MasteryList rows={masteryRows} loading={masteryLoading} loadError={masteryError} />
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
              clusterStatuses={clusterStatusById}
              pathMode={pathMode}
              onSelectStartHere={handleSelectStartHere}
            />
            <div className="flex flex-col gap-3">
              <LearningPathTrajectory
                trajectory={trajectory}
                projectId={projectId}
                selectedId={selectedConceptId}
                onSelect={setSelectedConceptId}
                buildAskPrompt={buildAskPrompt}
              />
              <DetailPanel
                conceptId={selectedConceptId}
                clusterName={selectedClusterName}
                onSelectConcept={setSelectedConceptId}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[1fr_300px]">
            <ConceptGraph
              concepts={active.concepts}
              edges={active.edges}
              selectedId={selectedConceptId}
              onNodeClick={handleNodeClick}
              showSemSim={showSemSim}
              showAmbiguous={showAmbiguous}
              fullscreen={fullscreen}
              onExitFullscreen={() => setFullscreen(false)}
              statuses={pathMode ? statuses : null}
              pathMode={pathMode}
            />
            <div className="flex flex-col gap-3">
              <LearningPathTrajectory
                trajectory={trajectory}
                projectId={projectId}
                selectedId={selectedConceptId}
                onSelect={setSelectedConceptId}
                buildAskPrompt={buildAskPrompt}
              />
              <DetailPanel
                conceptId={selectedConceptId}
                clusterName={selectedClusterName}
                onSelectConcept={setSelectedConceptId}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}