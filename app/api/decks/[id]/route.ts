import { NextResponse } from "next/server";
import { deleteDeck, getDeck, getDeckWithCards, renameDeck } from "@/lib/db";
import { z } from "@/lib/server/validation";
import { withRouteHandler } from "@/lib/server/withRouteHandler";

// PATCH /api/decks/[id] — rename a deck. Body: { title }. The prior inline guard
// only renamed when `title` was a non-blank string and otherwise no-op'd silently
// (never a 400). The preprocess maps every non-(non-blank-string) value —
// missing, empty, whitespace-only, wrong type — to `undefined` so the schema
// accepts them and the handler treats them as a no-op, preserving the exact
// acceptance criteria.
const renameDeckBodySchema = z.object({
  title: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined),
    z.string().min(1).optional(),
  ),
});

// GET /api/decks/[id] — deck + its cards (in order) with due/new/overview counts.
export const GET = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  const payload = getDeckWithCards(id);
  if (!payload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(payload);
});

// PATCH /api/decks/[id] — rename a deck. Body: { title }. The prior handler did
// `await req.json().catch(() => ({}))`: a missing or malformed body was treated
// as `{}` and the request still succeeded (no rename). We mirror that by
// falling back to `{}` on a parse failure before running the permissive schema,
// so the acceptance criteria are unchanged.
export const PATCH = withRouteHandler<{ id: string }>(async ({ request, params }) => {
  const { id } = params;
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    json = {};
  }
  const result = renameDeckBodySchema.safeParse(json);
  if (!result.success) return NextResponse.json({ error: "Invalid request", issues: result.error.issues }, { status: 400 });
  const { title } = result.data;
  if (title) renameDeck(id, title);
  return NextResponse.json(getDeck(id));
});

// DELETE /api/decks/[id] — cascades to cards.
export const DELETE = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  deleteDeck(id);
  return NextResponse.json({ ok: true });
});