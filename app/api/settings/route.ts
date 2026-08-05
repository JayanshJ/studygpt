import { NextResponse } from "next/server";
import { getAllSettings, setSetting } from "@/lib/db";
import { getModelConfig } from "@/lib/llm/provider";

// GET /api/settings — live model/provider config (merged with .env defaults).
export async function GET() {
  return NextResponse.json({ ...getModelConfig(), raw: getAllSettings() });
}

// PATCH /api/settings — persist provider / model / baseUrl / apiKey / theme.
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (typeof body.provider === "string") setSetting("provider", body.provider);
  if (typeof body.model === "string") setSetting("model", body.model);
  if (typeof body.baseUrl === "string") setSetting("baseUrl", body.baseUrl);
  if (typeof body.apiKey === "string") setSetting("apiKey", body.apiKey);
  if (typeof body.theme === "string") setSetting("theme", body.theme);
  return NextResponse.json({ ...getModelConfig(), raw: getAllSettings() });
}