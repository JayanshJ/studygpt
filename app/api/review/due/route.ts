import { NextResponse } from "next/server";
import { dueCardsAllDecks, allDeckDueCounts } from "@/lib/db";

// GET /api/review/due — cross-deck queue + per-deck counts for the /review page.
export async function GET() {
  const now = Date.now();
  return NextResponse.json({ cards: dueCardsAllDecks(now), decks: allDeckDueCounts(now) });
}