import { NextResponse } from "next/server";
import { getModelConfig } from "@/lib/llm/provider";
import { isVisionModel } from "@/lib/llm/vision";

// GET /api/models — lists models available on the configured backend, each
// tagged with whether the vision heuristic considers it vision-capable. Used
// by the header model switcher. Non-fatal: returns an empty list (200) if the
// backend is unreachable, so the switcher degrades to the current model only.
export async function GET() {
  const cfg = getModelConfig();
  try {
    const res = await fetch(`${cfg.baseURL}/models`, {
      signal: AbortSignal.timeout(3000),
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    if (!res.ok) return NextResponse.json({ models: [] });
    const data = (await res.json()) as { data?: { id: string }[] };
    const models = (data.data ?? []).map((m) => ({
      id: m.id,
      vision: isVisionModel(m.id),
    }));
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}