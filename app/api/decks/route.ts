import { NextResponse } from "next/server";
import { createDeck, listDecksWithCounts } from "@/lib/db";
import { z, validateBody } from "@/lib/server/validation";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";

// POST /api/decks — save a deck. Body: { title, cards: [{front, back}], conversationId? }.
// `title` is required + trimmed (400 if blank). `cards` is required, non-empty,
// and every card must have string `front`+`back`; extra card keys are allowed
// (the prior inline guard only checked front/back, and `createDeck` ignores the
// rest), so the card schema uses `.passthrough()` to mirror that. A missing or
// malformed body yielded a 400 ("title required") before; `validateBody`
// returns a 400 with a structured error instead — same status, error path only.
const cardSchema = z
  .object({ front: z.string(), back: z.string() })
  .passthrough();

const createDeckBodySchema = z.object({
  title: z.string().trim().min(1),
  cards: z.array(cardSchema).min(1),
  // conversationId is nullable: FlashcardDeck sends `conversationId: conversationId ?? null`
  // for a deck saved outside any conversation. `.nullable().optional()` accepts
  // string | null | undefined — matching the original behavior.
  conversationId: z.string().nullable().optional(),
});

// GET /api/decks — list all saved decks with card counts (newest first).
export const GET = withRouteHandlerNoParams(async () => {
  return NextResponse.json(listDecksWithCounts());
});

// POST /api/decks — save a deck. Body: { title, cards: [{front, back}], conversationId? }
export const POST = withRouteHandlerNoParams(async ({ request }) => {
  const parsed = await validateBody(request, createDeckBodySchema);
  if (!parsed.ok) return parsed.response;
  const { title, cards, conversationId } = parsed.value;
  const deck = createDeck(
    title,
    cards.map((c) => ({ front: c.front.trim(), back: c.back.trim() })),
    conversationId ?? null,
  );
  return NextResponse.json(deck, { status: 201 });
});