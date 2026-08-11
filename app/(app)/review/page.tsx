"use client";

import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { StudySession } from "@/components/study/StudySession";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card } from "@/components/ui/Card";
import { motion } from "motion/react";
import { useMotion, fadeUp } from "@/lib/motion";
import type { CardDue } from "@/lib/db/reviews";

type DeckCount = { deckId: string; title: string; due: number; new: number };

export default function ReviewPage() {
  const [decks, setDecks] = useState<DeckCount[] | null>(null);
  const [queue, setQueue] = useState<CardDue[] | null>(null);
  const [loading, setLoading] = useState(true);
  const m = useMotion();

  useEffect(() => {
    fetch("/api/review/due")
      .then((r) => r.json())
      .then((d: { cards: CardDue[]; decks: DeckCount[] }) => {
        setDecks(d.decks);
        setQueue(d.cards);
      })
      .catch(() => setDecks([]))
      .finally(() => setLoading(false));
  }, []);

  const totalDue = decks?.reduce((a, d) => a + d.due + d.new, 0) ?? 0;
  const reload = () => {
    setQueue(null);
    fetch("/api/review/due")
      .then((r) => r.json())
      .then((d: { cards: CardDue[]; decks: DeckCount[] }) => {
        setDecks(d.decks);
        setQueue(d.cards);
      })
      .finally(() => setLoading(false));
  };

  return (
    <div className="graph-paper h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 tab:px-6 tab:py-10">
        <motion.div {...m} variants={fadeUp} className="mb-5 flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
          <RotateCw size={16} className="text-rule" />
          Review
        </motion.div>

        {loading ? (
          <Skeleton className="h-8 w-1/2" />
        ) : (
          <>
            <motion.h1 {...m} variants={fadeUp} className="mb-2 font-serif text-[1.6rem] leading-tight text-ink">
              Review queue
            </motion.h1>
            <p className="mono mb-6 text-[11px] tracking-wide text-content-faint">
              {totalDue} card{totalDue === 1 ? "" : "s"} due across all decks
            </p>

            {decks && decks.length > 0 && (
              <ul className="mb-6 space-y-1">
                {decks.map((d) => (
                  <motion.li key={d.deckId} {...m} variants={fadeUp}>
                    <Card className="mono flex items-center justify-between p-3 text-[12px]">
                      <a href={`/decks/${d.deckId}`} className="text-ink hover:underline">{d.title}</a>
                      <span className="tabular-nums text-content-faint">
                        {d.due} due · {d.new} new
                      </span>
                    </Card>
                  </motion.li>
                ))}
              </ul>
            )}

            {queue && queue.length > 0 ? (
              <StudySession queue={queue} onComplete={reload} />
            ) : (
              <Card className="p-6 text-center">
                <p className="mono text-[12px] text-content-faint">nothing due — come back later</p>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}