import { NextResponse } from "next/server";
import { getProject, listConceptsForProject, conceptMasteryForProject } from "@/lib/db";
import type { Band } from "@/lib/mastery/model";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

const BAND_RANK: Record<Band, number> = {
  slipping: 0,
  untested: 1,
  learning: 2,
  strong: 3,
  unknown: 4,
};

// GET /api/mastery?projectId= — per-concept mastery rows for a project.
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

  const rows = listConceptsForProject(projectId).map((c) => {
    const m = masteryMap.get(c.id);
    const band: Band = m?.band ?? "unknown";
    return {
      id: c.id,
      label: c.label,
      mastery: m?.mastery ?? null,
      band,
      reviewedCards: m?.reviewedCards ?? 0,
      totalCards: m?.totalCards ?? 0,
      lastReviewed: m?.lastReviewed ?? null,
    };
  });

  rows.sort((a, b) => {
    const r = BAND_RANK[a.band] - BAND_RANK[b.band];
    if (r !== 0) return r;
    // within a band, slipping/learning by mastery asc; others by label
    if (a.mastery != null && b.mastery != null) return a.mastery - b.mastery;
    return a.label.localeCompare(b.label);
  });

  return NextResponse.json({ rows });
});