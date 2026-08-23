import { NextResponse } from "next/server";
import { createProject, listProjects, listMaterials } from "@/lib/db";
import { z, validateBody } from "@/lib/server/validation";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

// POST /api/projects — create a new project. Body: { name, studyEnabled? }.
// `name` is required (missing/blank → 400). `studyEnabled` defaults to false
// (general-first): a project is a generic container of materials + memory +
// conversations; the study capability (concept graph, mastery, flashcards,
// notation) is opt-in.
const createProjectBodySchema = z.object({
  name: z.string().trim().min(1),
  studyEnabled: z.boolean().optional(),
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

// POST /api/projects — create a new project. Body: { name, studyEnabled? }
export const POST = withRouteHandlerNoParams(async ({ request }) => {
  const parsed = await validateBody(request, createProjectBodySchema);
  if (!parsed.ok) return parsed.response;
  const { name, studyEnabled } = parsed.value;
  return NextResponse.json(createProject(name, studyEnabled ?? false), { status: 201 });
});