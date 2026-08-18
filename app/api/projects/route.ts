import { NextResponse } from "next/server";
import { createProject, listProjects, listMaterials } from "@/lib/db";
import { z, validateBody } from "@/lib/server/validation";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

// POST /api/projects — create a new project. Body: { name }. `name` is
// required; a missing/blank body yields a 400, matching the prior inline guard.
const createProjectBodySchema = z.object({
  name: z.string().trim().min(1),
});

// GET /api/projects — list all projects with their material counts.
export const GET = withRouteHandlerNoParams(async () => {
  const projects = listProjects();
  const withCounts = projects.map((p) => ({
    ...p,
    materialCount: listMaterials(p.id).length,
  }));
  return NextResponse.json(withCounts);
});

// POST /api/projects — create a new project. Body: { name }
export const POST = withRouteHandlerNoParams(async ({ request }) => {
  const parsed = await validateBody(request, createProjectBodySchema);
  if (!parsed.ok) return parsed.response;
  const { name } = parsed.value;
  return NextResponse.json(createProject(name), { status: 201 });
});