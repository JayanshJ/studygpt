import { NextResponse } from "next/server";
import { getCard, getCardScheduling, upsertCardScheduling, appendReviewLog } from "@/lib/db";
import { repeat, Rating, CardState, type SchedCard } from "@/lib/fsrs/algorithm";
import { linkCardToConcepts } from "@/lib/mastery/link";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";
import { z, validateBody } from "@/lib/server/validation";

// POST /api/review/grade — grade a card, update its FSRS schedule, append a
// review_log row. Body: { cardId, grade }. Deck-agnostic (used by both the
// per-deck session and the cross-deck queue).
//
// Preserves the existing acceptance criteria exactly: `cardId` must be a
// non-empty string and `grade` an integer in [1,4]. The original code rejected
// a body whose `grade` was non-integer or out of range; this schema mirrors
// that (and still rejects a missing/non-string cardId) without tightening it.
const gradeBodySchema = z.object({
  cardId: z.string().min(1),
  grade: z.number().int().min(1).max(4),
});

export const POST = withRouteHandlerNoParams(async ({ request: req }) => {
  const parsed = await validateBody(req, gradeBodySchema);
  if (!parsed.ok) return parsed.response;
  const { cardId, grade } = parsed.value;

  const card = getCard(cardId);
  if (!card) return NextResponse.json({ error: "Card not found" }, { status: 404 });

  const existing = getCardScheduling(cardId);
  const prev: SchedCard | null = existing
    ? {
        due: existing.due,
        stability: existing.stability,
        difficulty: existing.difficulty,
        reps: existing.reps,
        lapses: existing.lapses,
        state: existing.state as CardState,
        last_review: existing.last_review,
      }
    : null;

  const now = Date.now();
  const { card: next, log } = repeat(prev, grade as Rating, now);

  upsertCardScheduling(cardId, next);
  appendReviewLog({
    cardId,
    deckId: card.deck_id,
    grade: grade as Rating,
    state: log.state,
    stability: log.stability,
    difficulty: log.difficulty,
    reviewedAt: now,
  });
  // SP4: best-effort card ↔ concept auto-link. Fire-and-forget so grading
  // stays snappy; failures are swallowed inside linkCardToConcepts.
  void linkCardToConcepts(cardId).catch(() => {});
  return NextResponse.json({ state: next.state, nextDue: next.due, reps: next.reps, lapses: next.lapses });
});