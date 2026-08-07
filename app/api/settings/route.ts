import { NextResponse } from "next/server";
import { getAllSettings, setSetting, getTotalTokens } from "@/lib/db";
import { getModelConfig } from "@/lib/llm/provider";

// GET /api/settings — live model/provider config (merged with .env defaults),
// plus the global token count (sum of every message's estimate).
export async function GET() {
  return NextResponse.json({ ...getModelConfig(), totalTokens: getTotalTokens(), raw: getAllSettings() });
}

// PATCH /api/settings — persist provider / model / baseUrl / apiKey / theme.
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.provider === "string") setSetting("provider", body.provider);
  if (typeof body.model === "string") setSetting("model", body.model);
  if (typeof body.baseUrl === "string") setSetting("baseUrl", body.baseUrl);
  if (typeof body.apiKey === "string") setSetting("apiKey", body.apiKey);
  if (typeof body.tavilyApiKey === "string") setSetting("tavilyApiKey", body.tavilyApiKey);
  if (typeof body.openaiApiKey === "string") setSetting("openaiApiKey", body.openaiApiKey);
  if (typeof body.theme === "string") setSetting("theme", body.theme);
  if (typeof body.embeddingModel === "string") setSetting("embeddingModel", body.embeddingModel);
  return NextResponse.json({ ...getModelConfig(), totalTokens: getTotalTokens(), raw: getAllSettings() });
}