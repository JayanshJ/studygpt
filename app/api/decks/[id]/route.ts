import { NextResponse } from "next/server";
import { deleteDeck, getDeck, getCards, renameDeck } from "@/lib/db";

// GET /api/decks/[id] — deck + its cards (in order).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ deck, cards: getCards(id) });
}

// PATCH /api/decks/[id] — rename a deck. Body: { title }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { title } = await req.json().catch(() => ({}));
  if (typeof title === "string" && title.trim()) renameDeck(id, title.trim());
  return NextResponse.json(getDeck(id));
}

// DELETE /api/decks/[id] — cascades to cards.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deleteDeck(id);
  return NextResponse.json({ ok: true });
}