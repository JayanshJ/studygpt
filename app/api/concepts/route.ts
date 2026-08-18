import { NextResponse } from "next/server";
import {
  getProject,
  listMaterials,
  listConceptsForProject,
  listEdgesForProject,
  listExtractionsForProject,
  getBuildProgress,
} from "@/lib/db";
import { conceptMasteryForProject } from "@/lib/db/mastery";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

// GET /api/concepts?projectId= — the concept graph read shape consumed by the
// (SP2) graph page and the /projects status chips. Returns concepts, edges,
// and per-material extraction status. Mastery fields (mastery, band) arrive
// in SP4.
//
// projectId is a query param (not a JSON body), so validateBody does not
// apply; the existing query-param guard below is kept as-is. withRouteHandler
// adds the error boundary.
export const GET = withRouteHandlerNoParams(async ({ request: req }) => {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  if (typeof projectId !== "string" || !projectId.trim()) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  if (!getProject(projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const now = Date.now();
  const masteryMap = conceptMasteryForProject(projectId, now);
  const concepts = listConceptsForProject(projectId).map((c) => {
    const m = masteryMap.get(c.id);
    return {
      id: c.id,
      label: c.label,
      slug: c.slug,
      description: c.description,
      sourceCount: c.source_count,
      mastery: m?.mastery ?? null,
      band: m?.band ?? "unknown",
    };
  });
  const edges = listEdgesForProject(projectId).map((e) => ({
    source: e.source_concept,
    target: e.target_concept,
    relation: e.relation,
    confidence: e.confidence,
    score: e.confidence_score,
  }));
  // Hoist the extractions lookup into a Map once (avoids a per-material DB hit).
  const extById = new Map(listExtractionsForProject(projectId).map((x) => [x.material_id, x]));
  const materials = listMaterials(projectId).map((m) => {
    const ext = extById.get(m.id);
    return {
      materialId: m.id,
      title: m.title,
      status: ext?.status ?? "pending",
      conceptCount: ext?.concept_count ?? 0,
      error: ext?.error ?? null,
    };
  });

  // Live build progress (chunk-level) if an extraction is in flight, else null.
  const progress = getBuildProgress(projectId) ?? null;
  return NextResponse.json({ concepts, edges, materials, progress });
});