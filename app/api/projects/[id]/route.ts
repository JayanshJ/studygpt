import { NextResponse } from "next/server";
import { deleteProject, getProject, listMaterials, renameProject } from "@/lib/db";
import { z } from "@/lib/server/validation";
import { withRouteHandler } from "@/lib/server/withRouteHandler";

// PATCH /api/projects/[id] — rename a project. Body: { name }. The prior inline
// guard only renamed when `name` was a non-blank string and otherwise no-op'd
// silently (never a 400). The preprocess maps every non-(non-blank-string)
// value — missing, empty, whitespace-only, wrong type — to `undefined` so the
// schema accepts them and the handler treats them as a no-op, preserving the
// exact acceptance criteria.
const renameProjectBodySchema = z.object({
  name: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().min(1).optional(),
  ),
});

// GET /api/projects/[id] — project + its materials.
export const GET = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  const project = getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ project, materials: listMaterials(id) });
});

// PATCH /api/projects/[id] — rename a project. Body: { name }. The prior handler
// did `await req.json().catch(() => ({}))`: a missing or malformed body was
// treated as `{}` and the request still succeeded (no rename). We mirror that
// by falling back to `{}` on a parse failure before running the permissive
// schema, so the acceptance criteria are unchanged.
export const PATCH = withRouteHandler<{ id: string }>(async ({ request, params }) => {
  const { id } = params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const result = renameProjectBodySchema.safeParse(json);
  if (!result.success) return NextResponse.json({ error: "Invalid request", issues: result.error.issues }, { status: 400 });
  const { name } = result.data;
  if (name) renameProject(id, name);
  return NextResponse.json(getProject(id));
});

// DELETE /api/projects/[id] — cascades to materials+chunks; nulls conversations.
export const DELETE = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  deleteProject(id);
  return NextResponse.json({ ok: true });
});