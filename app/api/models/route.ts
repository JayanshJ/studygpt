import { NextResponse } from "next/server";
import { getModelConfig } from "@/lib/llm/provider";
import { isVisionModel } from "@/lib/llm/vision";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

// GET /api/models — lists models available on the configured backend, each
// tagged with whether the vision heuristic considers it vision-capable. Used
// by the header model switcher. Non-fatal: returns an empty list (200) if the
// backend is unreachable, so the switcher degrades to the current model only.
// The handler keeps its own try/catch (an unreachable backend is an expected
// degraded state, not a 500) — `withRouteHandlerNoParams` is the error boundary
// only for unexpected throws.
export const GET = withRouteHandlerNoParams(async () => {
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
});