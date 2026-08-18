import { NextResponse } from "next/server";
import { getConceptDetail } from "@/lib/db";
import { withRouteHandler } from "@/lib/server/withRouteHandler";

// GET /api/concepts/[id] — one concept + provenance + neighbors, for the /graph
// detail panel. 404 when the concept id doesn't exist. No request body to
// validate; withRouteHandler provides the error boundary and awaits [id].
export const GET = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  const detail = getConceptDetail(id);
  if (!detail) return NextResponse.json({ error: "Concept not found" }, { status: 404 });
  return NextResponse.json(detail);
});