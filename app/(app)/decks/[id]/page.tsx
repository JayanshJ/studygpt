"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { RotateCw, Layers } from "lucide-react";
import { FlashcardDeck } from "@/components/FlashcardDeck";
import { StudySession } from "@/components/study/StudySession";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { motion } from "motion/react";
import { useMotion, fadeUp } from "@/lib/motion";
import type { Card as CardType, Deck } from "@/lib/db/schema";
import type { CardDue } from "@/lib/db/reviews";

type Overview = {
  deck: Deck;
  cards: CardType[];
  due: number;
  new: number;
  dailyCap: number;
  newIntroducedToday: number;
  lastReviewed: number | null;
};

export default function DeckOverviewPage() {
  const params = useParams<{ id: string }>();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tab, setTab] = useState<"review" | "browse">("review");
  const [queue, setQueue] = useState<CardDue[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const m = useMotion();

  useEffect(() => {
    if (!params.id) return;
    fetch(`/api/decks/${params.id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((o: Overview) => setOverview(o))
      .catch(() => setErr("Deck not found."))
      .finally(() => setLoading(false));
  }, [params.id]);

  const startReview = () => {
    setErr(null);
    fetch(`/api/decks/${params.id}/due`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: { cards: CardDue[] }) => setQueue(d.cards))
      .catch(() => setErr("Could not load review queue."));
  };

  const reloadOverview = () => {
    setQueue(null);
    fetch(`/api/decks/${params.id}`)
      .then((r) => r.json())
      .then((o: Overview) => setOverview(o))
      .catch(() => {});
  };

  return (
    <div className="graph-paper h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 tab:px-6 tab:py-10">
        <motion.div {...m} variants={fadeUp} className="mb-5 flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
          <Layers size={16} className="text-rule" />
          Deck
        </motion.div>

        {loading ? (
          <Skeleton className="h-8 w-2/3" />
        ) : err || !overview ? (
          <p className="mono text-[13px] text-danger">{err ?? "Deck not found."}</p>
        ) : (
          <>
            <motion.h1 {...m} variants={fadeUp} className="mb-2 font-serif text-[1.6rem] leading-tight text-ink">
              {overview.deck.title}
            </motion.h1>
            <p className="mono mb-6 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tracking-wide text-content-faint">
              <span className={overview.due > 0 ? "text-ink" : ""}>{overview.due} due</span>
              <span>{overview.new} new</span>
              <span>{overview.cards.length} total</span>
              {overview.lastReviewed && <span>last reviewed {new Date(overview.lastReviewed).toLocaleDateString()}</span>}
            </p>

            <Tabs value={tab} onValueChange={(v) => setTab(v as "review" | "browse")} className="mb-6">
              <TabsList>
                <TabsTrigger value="review">Review</TabsTrigger>
                <TabsTrigger value="browse">Browse all</TabsTrigger>
              </TabsList>

              <TabsContent value="review" className="mt-6">
                {queue ? (
                  queue.length === 0 ? (
                    <Card className="p-6 text-center">
                      <p className="mono text-[12px] text-content-faint">nothing due — come back later</p>
                    </Card>
                  ) : (
                    <StudySession queue={queue} deckLabel={overview.deck.title} onComplete={reloadOverview} />
                  )
                ) : (
                  <Button
                    variant="secondary"
                    onClick={startReview}
                    disabled={overview.cards.length === 0}
                  >
                    <RotateCw size={14} />
                    {overview.due + Math.min(overview.new, Math.max(0, overview.dailyCap - overview.newIntroducedToday)) > 0 ? "Start review" : "nothing due"}
                  </Button>
                )}
              </TabsContent>

              <TabsContent value="browse" className="mt-6">
                <FlashcardDeck
                  cards={overview.cards.map((c) => ({ front: c.front, back: c.back }))}
                  reviewMode
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}