"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FlashcardDeck } from "@/components/FlashcardDeck";
import { Skeleton } from "@/components/Skeleton";
import type { Card, Deck } from "@/lib/db/schema";

// /decks/[id] — focused review page for a saved deck. Reuses the inline
// FlashcardDeck in reviewMode (no "save" button) so the flip/prev/next/shuffle
// UX is identical to in-chat. `cards` come pre-parsed from the API.
export default function DeckReviewPage() {
  const params = useParams<{ id: string }>();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/decks/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { deck: Deck; cards: Card[] }) => {
        setDeck(d.deck);
        setCards(d.cards);
      })
      .catch(() => setErr("Deck not found."))
      .finally(() => setLoading(false));
  }, [params.id]);

  return (
    <div className="graph-paper min-h-screen">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/decks"
            className="mono text-[12px] tracking-wide text-ink-3 transition-colors hover:text-ink"
          >
            ← Back to decks
          </Link>
          <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
            <span className="h-1.5 w-1.5 rounded-full bg-rule" />
            Review
          </span>
        </div>

        {loading ? (
          <>
            <Skeleton className="h-8 w-2/3" />
            <div className="mt-6 rounded-[3px] border border-line bg-paper-2 p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-4 h-4 w-full" />
              <Skeleton className="mt-2 h-4 w-5/6" />
              <Skeleton className="mt-2 h-4 w-3/4" />
            </div>
          </>
        ) : err || !deck ? (
          <p className="mono text-[13px] text-rule">{err ?? "Deck not found."}</p>
        ) : (
          <>
            <h1 className="mb-2 text-[1.6rem] leading-tight text-ink">{deck.title}</h1>
            <p className="mono mb-6 text-[11px] tracking-wide text-ink-3">
              {cards.length} card{cards.length === 1 ? "" : "s"} · click the card to flip
            </p>
            <FlashcardDeck
              cards={cards.map((c) => ({ front: c.front, back: c.back }))}
              reviewMode
            />
          </>
        )}
      </div>
    </div>
  );
}