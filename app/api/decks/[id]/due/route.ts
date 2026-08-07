import { NextResponse } from "next/server";
import { getDeck, dueCardsInDeck, newIntroducedToday } from "@/lib/db";

// GET /api/decks/[id]/due — per-deck session queue: due cards (by due asc) +
// new cards (by ordinal) up to the remaining daily cap.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deck = getDeck(id);
  if (!deck) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = Date.now();
  const introduced = newIntroducedToday(id, now);
  const cards = dueCardsInDeck(id, now, Math.max(0, deck.daily_new_limit - introduced));
  return NextResponse.json({ cards, dailyCap: deck.daily_new_limit, newIntroducedToday: introduced });
}