import { NextResponse } from "next/server";
import { getProject } from "@/lib/db";
import { getModelConfig, getProvider } from "@/lib/llm/provider";
import { extractConceptsForProject } from "@/lib/concepts/extract";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";
import { z, validateBody } from "@/lib/server/validation";

// POST /api/concepts/extract — build (or refresh) the concept graph for a
// project. Preflights the chat model so a down backend returns a clean 502
// BEFORE any extraction runs (no partial DB state). Extraction is idempotent:
// materials whose text is unchanged since last extraction are skipped. Pass
// `force: true` to wipe the existing graph + extraction records and re-extract
// every ready material from scratch (use after changing the prompt/granularity).
//
// Preserves the existing acceptance criteria: `projectId` must be a
// non-empty (after trim) string; `force` is optional and only true is treated
// as a forced re-extract. The original code coerced a missing body to `{}` and
// read `force === true`; this schema mirrors that (force optional, boolean)
// without tightening anything.
const extractBodySchema = z.object({
  projectId: z.string().trim().min(1),
  force: z.boolean().optional(),
});

export const POST = withRouteHandlerNoParams(async ({ request: req }) => {
  const parsed = await validateBody(req, extractBodySchema);
  if (!parsed.ok) return parsed.response;
  const { projectId, force } = parsed.value;

  if (!getProject(projectId)) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  try {
    const cfg = getModelConfig();
    const provider = getProvider(cfg.provider);
    if (provider.validate) {
      await provider.validate({ model: cfg.model, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Chat model unavailable" },
      { status: 502 },
    );
  }
  return NextResponse.json(await extractConceptsForProject(projectId, { force: force === true }));
});