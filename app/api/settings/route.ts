import { NextResponse } from "next/server";
import { getAllSettings, setSetting, getTotalTokens } from "@/lib/db";
import { getModelConfig } from "@/lib/llm/provider";
import { z } from "@/lib/server/validation";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

// PATCH /api/settings — persist provider / model / baseUrl / apiKey / theme /
// embeddingModel + vision-pipeline keys. Each field is an optional string; the
// prior inline guard set a field only when it was `typeof === "string"` and
// ignored everything else (including wrong types, never a 400). This permissive
// schema mirrors that: any unknown key is stripped and any non-string value for
// a known key becomes `undefined`, so the handler's `if (typeof x === "string")`
// guards still drive what actually gets persisted.
const patchSettingsBodySchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  tavilyApiKey: z.string().optional(),
  openaiApiKey: z.string().optional(),
  theme: z.string().optional(),
  embeddingModel: z.string().optional(),
  visionModel: z.string().optional(),
  visionBaseUrl: z.string().optional(),
  visionApiKey: z.string().optional(),
});

// GET /api/settings — live model/provider config (merged with .env defaults),
// plus the global token count (sum of every message's estimate).
export const GET = withRouteHandlerNoParams(async () => {
  return NextResponse.json({ ...getModelConfig(), totalTokens: getTotalTokens(), raw: getAllSettings() });
});

// PATCH /api/settings — persist provider / model / baseUrl / apiKey / theme.
// The prior handler did `await req.json().catch(() => ({}))`: a missing or
// malformed body was treated as `{}` and the request still succeeded (no-op).
// `validateBody` would turn that into a 400, tightening the acceptance
// criteria — so we mirror the original by falling back to `{}` on a parse
// failure and running the permissive schema against that.
export const PATCH = withRouteHandlerNoParams(async ({ request }) => {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const result = patchSettingsBodySchema.safeParse(json);
  if (!result.success) return NextResponse.json({ error: "Invalid request", issues: result.error.issues }, { status: 400 });
  const body = result.data;
  if (typeof body.provider === "string") setSetting("provider", body.provider);
  if (typeof body.model === "string") setSetting("model", body.model);
  if (typeof body.baseUrl === "string") setSetting("baseUrl", body.baseUrl);
  if (typeof body.apiKey === "string") setSetting("apiKey", body.apiKey);
  if (typeof body.tavilyApiKey === "string") setSetting("tavilyApiKey", body.tavilyApiKey);
  if (typeof body.openaiApiKey === "string") setSetting("openaiApiKey", body.openaiApiKey);
  if (typeof body.theme === "string") setSetting("theme", body.theme);
  if (typeof body.embeddingModel === "string") setSetting("embeddingModel", body.embeddingModel);
  // Vision pipeline (diagram notation): a separate OpenAI-compatible backend
  // (OpenRouter by default) + its own model + base URL + API key. Empty
  // visionModel/visionApiKey disables the vision path; diagram turns then fall
  // back to the text-only Mermaid path.
  if (typeof body.visionModel === "string") setSetting("visionModel", body.visionModel);
  if (typeof body.visionBaseUrl === "string") setSetting("visionBaseUrl", body.visionBaseUrl);
  if (typeof body.visionApiKey === "string") setSetting("visionApiKey", body.visionApiKey);
  return NextResponse.json({ ...getModelConfig(), totalTokens: getTotalTokens(), raw: getAllSettings() });
});