"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FolderKanban, Plus, Pencil, Trash2, FileUp, Link as LinkIcon, Workflow, Loader2 } from "lucide-react";
import type { Material, Project, ProjectMemoryEntry } from "@/lib/db/schema";
import { ProjectMemory } from "@/components/projects/ProjectMemory";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Badge } from "@/components/ui/Badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/Dialog";
import { motion } from "motion/react";
import { useMotion, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

// Concept-graph read shape from GET /api/concepts (SP1). SP2's graph page and
// SP4's mastery layer will extend this; SP1 only carries concepts, edges, and
// per-material extraction status.
type ConceptReport = {
  concepts: { id: string; label: string; slug: string; description: string | null; sourceCount: number }[];
  edges: { source: string; target: string; relation: string; confidence: string; score: number | null }[];
  materials: {
    materialId: string;
    title: string;
    status: "pending" | "extracting" | "ready" | "error";
    conceptCount: number;
    error: string | null;
  }[];
  progress: { processed: number; total: number } | null;
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [memoryEntries, setMemoryEntries] = useState<ProjectMemoryEntry[]>([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [conceptsReport, setConceptsReport] = useState<ConceptReport | null>(null);
  const [building, setBuilding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const m = useMotion();

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  }, []);

  const loadMaterials = useCallback(async (id: string) => {
    const res = await fetch(`/api/projects/${id}`);
    if (res.ok) {
      const d: { project: Project; materials: Material[] } = await res.json();
      setMaterials(d.materials);
    }
  }, []);

  const loadConcepts = useCallback(async (id: string) => {
    const res = await fetch(`/api/concepts?projectId=${encodeURIComponent(id)}`);
    if (res.ok) setConceptsReport(await res.json());
  }, []);
  const loadMemory = useCallback(async (id: string) => {
    const res = await fetch(`/api/projects/${id}/memory`);
    if (res.ok) setMemoryEntries((await res.json() as { entries: ProjectMemoryEntry[] }).entries);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects();
  }, [loadProjects]);

  // Select first project once projects load (if none selected).
  useEffect(() => {
    if (!selectedId && projects.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(projects[0].id);
    }
    if (selectedId && !projects.some((p) => p.id === selectedId)) {
      // Selected project got deleted — fall back to first or none.
      setSelectedId(projects[0]?.id ?? null);
      setMaterials([]);
      setMemoryEntries([]);
    }
  }, [projects, selectedId]);

  // Load materials when selection changes.
  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMaterials([]);
      setConceptsReport(null);
      return;
    }
    loadMaterials(selectedId);
    loadConcepts(selectedId);
    loadMemory(selectedId);
  }, [selectedId, loadMaterials, loadConcepts, loadMemory]);

  async function addMemory(content: string) { if (!selectedId) return; await fetch(`/api/projects/${selectedId}/memory`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) }); await loadMemory(selectedId); }
  async function toggleMemory(entry: ProjectMemoryEntry, active: boolean) { if (!selectedId) return; await fetch(`/api/projects/${selectedId}/memory`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: entry.id, active }) }); await loadMemory(selectedId); }
  async function removeMemory(entry: ProjectMemoryEntry) { if (!selectedId) return; await fetch(`/api/projects/${selectedId}/memory?entryId=${encodeURIComponent(entry.id)}`, { method: "DELETE" }); await loadMemory(selectedId); }

  // Poll while any material is still processing.
  useEffect(() => {
    const anyProcessing = materials.some((m) => m.status === "processing");
    if (!selectedId || !anyProcessing) return;
    const t = setInterval(() => {
      loadMaterials(selectedId);
    }, 1000);
    return () => clearInterval(t);
  }, [selectedId, materials, loadMaterials]);

  // Poll while the build is in flight. The POST to /api/concepts/extract runs
  // server-side and may take a while; this refreshes the per-material chips AND
  // the chunk-level progress bar (report.progress) while it runs. `building`
  // covers the whole POST; anyExtracting also covers a build started in another
  // tab that left a material in "extracting".
  useEffect(() => {
    const anyExtracting = (conceptsReport?.materials ?? []).some((m) => m.status === "extracting");
    if (!selectedId || (!building && !anyExtracting)) return;
    const t = setInterval(() => {
      loadConcepts(selectedId);
    }, 1000);
    return () => clearInterval(t);
  }, [selectedId, building, conceptsReport, loadConcepts]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const p: Project = await res.json();
      setNewProjectName("");
      await loadProjects();
      setSelectedId(p.id);
    }
  }

  async function renameProject(id: string) {
    const name = renameValue.trim();
    if (!name) {
      setRenamingId(null);
      return;
    }
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRenamingId(null);
    await loadProjects();
  }

  async function deleteProject(id: string) {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    setConfirmDeleteId(null);
    if (selectedId === id) {
      setSelectedId(null);
      setMaterials([]);
    }
    await loadProjects();
  }

  // Upload a single PDF. `title` (may be "") overrides the shared addTitle
  // field — used so multi-file uploads name each material after its filename
  // instead of stamping the same title on every file. Returns null on success
  // or an error message on failure (caller aggregates per-file results).
  async function addPdf(file: File, title: string): Promise<string | null> {
    if (!selectedId) return null;
    const form = new FormData();
    form.append("projectId", selectedId);
    form.append("file", file);
    const t = title.trim();
    if (t) form.append("title", t);
    const res = await fetch("/api/materials", { method: "POST", body: form });
    if (res.ok) return null;
    const err = await res.text();
    return err || "PDF upload failed";
  }

  // Upload one or more PDFs sequentially. Sequential (not parallel) so we
  // don't fan out concurrent embedding batches onto Ollama mid-ingest, and so
  // each material appears in the list as soon as it's ready. Progress is shown
  // per file; per-file failures are aggregated into a single status message.
  async function addPdfs(files: FileList | File[]) {
    if (!selectedId) return;
    const list = Array.from(files);
    if (list.length === 0) return;
    const errors: string[] = [];
    for (let i = 0; i < list.length; i++) {
      // A single-file upload honors the shared title field; a multi-file
      // upload leaves each to fall back to its filename (cleaner than naming
      // them all the same).
      const title = list.length === 1 ? addTitle : "";
      setStatusMsg(`Uploading PDF ${i + 1}/${list.length}…`);
      const err = await addPdf(list[i], title);
      if (err) errors.push(`${list[i].name}: ${err}`);
      await loadMaterials(selectedId);
    }
    setStatusMsg(null);
    setAddTitle("");
    if (errors.length) {
      setStatusMsg(
        errors.length === list.length
          ? `All ${list.length} uploads failed — ${errors[0]}`
          : `${list.length - errors.length}/${list.length} uploaded; ${errors.length} failed`,
      );
    }
  }

  async function submitUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !addUrl.trim()) return;
    setStatusMsg("Adding URL…");
    const res = await fetch("/api/materials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: selectedId,
        url: addUrl.trim(),
        title: addTitle.trim() || undefined,
      }),
    });
    setStatusMsg(null);
    if (res.ok) {
      setAddUrl("");
      setAddTitle("");
      await loadMaterials(selectedId);
    } else {
      const err = await res.text();
      setStatusMsg(err || "URL add failed");
    }
  }

  async function deleteMaterial(id: string) {
    await fetch(`/api/materials/${id}`, { method: "DELETE" });
    if (selectedId) await loadMaterials(selectedId);
  }

  // Build (or refresh) the concept graph for the selected project. The POST
  // preflights the chat model and runs extraction server-side; it resolves
  // only once every ready material is processed, so we surface the summary
  // (processed / concepts / edges / skipped / chunk errors) in the status line.
  //
  // When a graph already exists, send `force: true` so the server wipes the old
  // graph and re-extracts every material from scratch — pressing "build" again
  // is a rebuild (e.g. to apply a coarser extraction prompt), not a no-op that
  // skips unchanged materials.
  async function buildGraph() {
    if (!selectedId) return;
    const rebuild = conceptCount > 0 || edgeCount > 0;
    setBuilding(true);
    setStatusMsg(rebuild ? "Rebuilding concept graph…" : "Building concept graph…");
    // Refresh once up front so the poll effect can observe the per-material
    // "extracting" state the server sets while the POST runs.
    void loadConcepts(selectedId);
    try {
      const res = await fetch("/api/concepts/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedId, force: rebuild }),
      });
      if (res.ok) {
        const r: { processed: number; concepts: number; edges: number; skipped: number; errors: string[] } =
          await res.json();
        const parts = [
          `processed ${r.processed}`,
          `${r.concepts} concepts`,
          `${r.edges} edges`,
        ];
        if (r.skipped) parts.push(`skipped ${r.skipped}`);
        if (r.errors.length) parts.push(`${r.errors.length} chunk error(s)`);
        setStatusMsg(parts.join(" · "));
      } else {
        const err = await res.text();
        setStatusMsg(err || "Build failed");
      }
    } finally {
      setBuilding(false);
      if (selectedId) await loadConcepts(selectedId);
    }
  }

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  // Concept-graph derived state for the selected project. extById is hoisted
  // once per render so each material row can look up its extraction status
  // without a per-row DB hit or a map rebuild.
  const readyMaterialCount = materials.filter((m) => m.status === "ready").length;
  const conceptCount = conceptsReport?.concepts.length ?? 0;
  const edgeCount = conceptsReport?.edges.length ?? 0;
  const progress = conceptsReport?.progress ?? null;
  const extById = new Map((conceptsReport?.materials ?? []).map((r) => [r.materialId, r]));
  const renderConceptChip = (materialId: string) => {
    const ext = extById.get(materialId);
    if (!ext || ext.status === "pending") return null;
    if (ext.status === "extracting")
      return <span className="mono flex items-center gap-1 text-[10px] text-amber"><Loader2 size={10} className="animate-spin" />extracting…</span>;
    if (ext.status === "error")
      return (
        <span className="mono max-w-[140px] truncate text-[10px] text-danger" title={ext.error ?? ""}>
          extraction failed
        </span>
      );
    return (
      <span className="mono text-[10px] text-content-muted">
        {ext.conceptCount} concept{ext.conceptCount === 1 ? "" : "s"}
      </span>
    );
  };

  const projectToDelete = projects.find((p) => p.id === confirmDeleteId) ?? null;

  return (
    <div className="graph-paper h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 tab:px-6 tab:py-10">
        <motion.div {...m} variants={fadeUp} className="mb-5 flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
          <FolderKanban size={16} className="text-rule" />
          Projects
        </motion.div>

        <motion.h1 {...m} variants={fadeUp} className="mb-6 font-serif text-[1.6rem] leading-tight text-ink">
          Projects &amp; materials
        </motion.h1>

        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          {/* Left column: project list */}
          <Card className="p-4">
            <form onSubmit={createProject} className="mb-3 flex gap-2">
              <Input
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                placeholder="new project name"
                className="text-[12px]"
              />
              <Button type="submit" variant="secondary" size="sm" className="shrink-0" aria-label="Create project">
                <Plus size={15} />
              </Button>
            </form>

            <ul className="flex flex-col gap-1">
              {projects.length === 0 && (
                <li className="mono px-1 py-3 text-[11px] text-content-faint">
                  no projects yet
                </li>
              )}
              {projects.map((p) => {
                const active = p.id === selectedId;
                const renaming = p.id === renamingId;
                return (
                  <li key={p.id} className="group">
                    {renaming ? (
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => renameProject(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameProject(p.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="text-[12px]"
                      />
                    ) : (
                      <div
                        className={`flex items-center gap-1.5 rounded-control px-2.5 py-2 transition-colors ${
                          active ? "bg-surface-2" : "hover:bg-surface-2/60"
                        }`}
                      >
                        <button
                          onClick={() => setSelectedId(p.id)}
                          className="flex-1 truncate text-left text-[13px] text-ink"
                        >
                          {p.name}
                        </button>
                        <IconButton
                          label="Rename project"
                          size="sm"
                          className="opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                          onClick={() => {
                            setRenamingId(p.id);
                            setRenameValue(p.name);
                          }}
                        >
                          <Pencil size={12} />
                        </IconButton>
                        <IconButton
                          label="Delete project"
                          size="sm"
                          className="opacity-0 text-content-faint transition-opacity hover:text-rule group-hover:opacity-100"
                          onClick={() => setConfirmDeleteId(p.id)}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Right column: materials manager */}
          <Card className="p-4">
            {!selected ? (
              <p className="mono py-10 text-center text-[12px] text-content-faint">
                select a project to manage its materials
              </p>
            ) : (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 className="truncate text-[18px] text-ink">{selected.name}</h2>
                  <span className="mono shrink-0 text-[11px] tracking-wide text-content-faint">
                    {materials.length} material{materials.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ProjectMemory entries={memoryEntries} onAdd={addMemory} onToggle={toggleMemory} onDelete={removeMemory} />

                {/* Build concept graph (SP1). Disabled while building or when
                    no material is ready to extract from. The chip shows the
                    current concept/edge totals once a graph exists. */}
                <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-border pb-4">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={buildGraph}
                    disabled={building || readyMaterialCount === 0}
                  >
                    <Workflow size={14} />
                    {building ? "building…" : conceptCount > 0 || edgeCount > 0 ? "rebuild concept graph" : "build concept graph"}
                  </Button>
                  {(conceptCount > 0 || edgeCount > 0) && (
                    <Badge tone="neutral">{conceptCount} concepts · {edgeCount} edges</Badge>
                  )}
                </div>

                {/* Chunk-level progress bar while a build is in flight. The
                    extract POST writes report.progress to the DB as chunks
                    complete; this poll-refreshed bar reads it. */}
                {building && progress && progress.total > 0 && (
                  <div className="mb-5 border-b border-border pb-4">
                    <div className="mb-1.5 flex items-center justify-between">
                      <span className="mono text-[11px] text-content-faint">
                        extracting concepts · {progress.processed}/{progress.total}
                      </span>
                      <span className="mono text-[11px] text-content-faint">
                        {Math.round((progress.processed / progress.total) * 100)}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                        style={{ width: `${Math.min(100, (progress.processed / progress.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Add material */}
                <div className="mb-5 flex flex-col gap-2 border-b border-border pb-4">
                  <label className="mono text-[11px] tracking-wide text-content-faint">
                    title (optional)
                  </label>
                  <Input
                    value={addTitle}
                    onChange={(e) => setAddTitle(e.target.value)}
                    placeholder="material title"
                    className="text-[12px]"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <FileUp size={14} />
                      upload PDFs
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="application/pdf"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const files = e.target.files;
                        if (files && files.length > 0) addPdfs(files);
                        e.target.value = "";
                      }}
                    />
                    <form onSubmit={submitUrl} className="flex flex-1 gap-2">
                      <Input
                        value={addUrl}
                        onChange={(e) => setAddUrl(e.target.value)}
                        placeholder="https://example.com/article"
                        className="text-[12px]"
                      />
                      <Button type="submit" variant="secondary" size="sm" className="shrink-0">
                        <LinkIcon size={14} />
                        add URL
                      </Button>
                    </form>
                  </div>
                  {statusMsg && (
                    <p className="mono text-[11px] text-content-faint">{statusMsg}</p>
                  )}
                </div>

                {/* Materials list */}
                <ul className="flex flex-col gap-2">
                  {materials.length === 0 && (
                    <li className="mono py-6 text-center text-[11px] text-content-faint">
                      no materials yet
                    </li>
                  )}
                  {materials.map((mat) => (
                    <li
                      key={mat.id}
                      className="group flex items-center gap-3 rounded-card border border-border bg-surface-2 px-3 py-2.5 shadow-sm"
                    >
                      <Badge tone="neutral" className="uppercase">{mat.source_type}</Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] text-ink">
                          {mat.title}
                        </div>
                        <div className="mono truncate text-[10px] text-content-faint">
                          {mat.source_ref}
                        </div>
                      </div>
                      <span
                        className={cn(
                          "mono text-[10px] tracking-wide",
                          mat.status === "ready"
                            ? "text-content-muted"
                            : mat.status === "processing"
                              ? "text-amber"
                              : "text-danger",
                        )}
                      >
                        {mat.status}
                      </span>
                      <span className="mono hidden text-[10px] text-content-faint sm:inline">
                        {mat.char_count.toLocaleString()} chars
                      </span>
                      {renderConceptChip(mat.id)}
                      {mat.status === "error" && mat.error && (
                        <span
                          className="mono max-w-[180px] truncate text-[10px] text-danger"
                          title={mat.error}
                        >
                          {mat.error}
                        </span>
                      )}
                      <IconButton
                        label="Delete material"
                        size="sm"
                        className="opacity-0 text-content-faint transition-opacity hover:text-rule group-hover:opacity-100"
                        onClick={() => deleteMaterial(mat.id)}
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* Delete project confirmation */}
      <Dialog open={!!projectToDelete} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{projectToDelete?.name}”?</DialogTitle>
            <DialogDescription>
              This permanently removes the project, its materials, and its concept graph. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">cancel</Button>
            </DialogClose>
            <Button variant="danger" size="sm" onClick={() => projectToDelete && deleteProject(projectToDelete.id)}>
              <Trash2 size={14} />
              delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
