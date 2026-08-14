"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Layers, Play, Pencil, RotateCw, Trash2 } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { StudySession } from "@/components/study/StudySession";
import { Skeleton } from "@/components/ui/Skeleton";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/Dialog";
import { motion } from "motion/react";
import { useMotion, fadeUp } from "@/lib/motion";
import type { Card as CardType, Deck } from "@/lib/db/schema";
import type { CardDue } from "@/lib/db/reviews";

type DeckWithCount = Deck & { card_count: number };

// Per-deck due counts from /api/review/due (same shape the old /review page
// used). Merged into the deck list rows to surface a "due" badge; the cards
// array is the cross-deck queue launched by "Review all due".
type DeckCount = { deckId: string; title: string; due: number; new: number };

export default function DecksPage() {
  const [decks, setDecks] = useState<DeckWithCount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cards, setCards] = useState<CardType[]>([]);
  const [loading, setLoading] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Cross-deck review (the folded-in /review surface). `dueCounts` drive the
  // per-deck "due" badges; `allDueQueue` is the cross-deck session launched by
  // the "Review all due" button.
  const [dueCounts, setDueCounts] = useState<DeckCount[] | null>(null);
  const [allDueQueue, setAllDueQueue] = useState<CardDue[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const m = useMotion();

  const loadDecks = useCallback(async () => {
    const res = await fetch("/api/decks");
    if (res.ok) setDecks(await res.json());
  }, []);

  const loadDue = useCallback(async () => {
    const res = await fetch("/api/review/due");
    if (!res.ok) return;
    const d: { cards: CardDue[]; decks: DeckCount[] } = await res.json();
    setDueCounts(d.decks ?? []);
    setAllDueQueue(d.cards ?? []);
  }, []);

  const loadCards = useCallback(async (id: string) => {
    const res = await fetch(`/api/decks/${id}`);
    if (res.ok) {
      const d: { deck: Deck; cards: CardType[] } = await res.json();
      setCards(d.cards);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDecks().finally(() => setLoading(false));
    void loadDue();
  }, [loadDecks, loadDue]);

  // Select the first deck once decks load (if none selected); fall back if the
  // selected deck was deleted.
  useEffect(() => {
    if (!selectedId && decks.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(decks[0].id);
    }
    if (selectedId && !decks.some((d) => d.id === selectedId)) {
      setSelectedId(decks[0]?.id ?? null);
      setCards([]);
    }
  }, [decks, selectedId]);

  // Load cards when the selection changes.
  useEffect(() => {
    if (!selectedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCards([]);
      return;
    }
    loadCards(selectedId);
  }, [selectedId, loadCards]);

  async function renameDeck(id: string) {
    const title = renameValue.trim();
    if (!title) {
      setRenamingId(null);
      return;
    }
    await fetch(`/api/decks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setRenamingId(null);
    await loadDecks();
  }

  async function deleteDeck(id: string) {
    await fetch(`/api/decks/${id}`, { method: "DELETE" });
    setConfirmDeleteId(null);
    if (selectedId === id) {
      setSelectedId(null);
      setCards([]);
    }
    await loadDecks();
  }

  const selected = decks.find((d) => d.id === selectedId) ?? null;
  const deckToDelete = decks.find((d) => d.id === confirmDeleteId) ?? null;
  const dueMap = useMemo(
    () => new Map((dueCounts ?? []).map((d) => [d.deckId, d])),
    [dueCounts],
  );
  const totalDue = (dueCounts ?? []).reduce((a, d) => a + d.due + d.new, 0);

  return (
    <div className="graph-paper h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-6 tab:px-6 tab:py-10">
        <motion.div {...m} variants={fadeUp} className="mb-5 flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
          <Layers size={16} className="text-rule" />
          Decks
        </motion.div>

        <motion.h1 {...m} variants={fadeUp} className="mb-6 font-serif text-[1.6rem] leading-tight text-ink">
          Flashcard decks
        </motion.h1>

        {totalDue > 0 && (
          <motion.div {...m} variants={fadeUp} className="mb-5 flex flex-wrap items-center gap-3">
            <Button variant="primary" size="sm" onClick={() => setReviewing(true)}>
              <RotateCw size={14} />
              Review all due ({totalDue})
            </Button>
            <span className="mono text-[11px] text-content-faint">across all decks</span>
          </motion.div>
        )}

        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          {/* Left column: deck list */}
          <Card className="p-4">
            <ul className="flex flex-col gap-1">
              {loading && decks.length === 0 && (
                <div className="flex flex-col gap-1">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-2">
                      <Skeleton className="h-3.5 flex-1" />
                      <Skeleton className="h-3 w-8" />
                    </div>
                  ))}
                </div>
              )}
              {!loading && decks.length === 0 && (
                <li className="mono px-1 py-3 text-[11px] text-content-faint">
                  no decks yet — ask for flashcards in chat and click “save to my decks”
                </li>
              )}
              {decks.map((d) => {
                const active = d.id === selectedId;
                const renaming = d.id === renamingId;
                const dueFor = dueMap.get(d.id);
                const dueN = dueFor ? dueFor.due + dueFor.new : 0;
                return (
                  <li key={d.id} className="group">
                    {renaming ? (
                      <Input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => renameDeck(d.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameDeck(d.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="text-[12px]"
                      />
                    ) : (
                      <div
                        className={`flex items-center gap-1.5 rounded-control px-2.5 py-2 transition-colors ${
                          active ? "bg-surface-2" : "hover:bg-surface-2/60"
                        }`}
                      >
                        <button
                          onClick={() => setSelectedId(d.id)}
                          className="flex-1 truncate text-left text-[13px] text-ink"
                        >
                          {d.title}
                        </button>
                        <span className="mono text-[10px] tabular-nums text-content-faint">
                          {d.card_count}
                        </span>
                        {dueN > 0 && (
                          <span className="mono text-[10px] tabular-nums text-rule">
                            {dueN} due
                          </span>
                        )}
                        <Link
                          href={`/decks/${d.id}`}
                          aria-label="Review deck"
                          className="text-content-faint opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                        >
                          <Play size={13} />
                        </Link>
                        <IconButton
                          label="Rename deck"
                          size="sm"
                          className="opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
                          onClick={() => {
                            setRenamingId(d.id);
                            setRenameValue(d.title);
                          }}
                        >
                          <Pencil size={12} />
                        </IconButton>
                        <IconButton
                          label="Delete deck"
                          size="sm"
                          className="opacity-0 text-content-faint transition-opacity hover:text-rule group-hover:opacity-100"
                          onClick={() => setConfirmDeleteId(d.id)}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Right column: card preview for the selected deck */}
          <Card className="p-4">
            {reviewing && allDueQueue.length > 0 ? (
              <div>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 className="text-[18px] text-ink">Review all due</h2>
                  <Button variant="ghost" size="sm" onClick={() => setReviewing(false)}>
                    back to decks
                  </Button>
                </div>
                <StudySession
                  queue={allDueQueue}
                  onComplete={() => {
                    setReviewing(false);
                    void loadDue();
                  }}
                />
              </div>
            ) : !selected ? (
              <p className="mono py-10 text-center text-[12px] text-content-faint">
                select a deck to preview its cards
              </p>
            ) : (
              <>
                <div className="mb-4 flex items-baseline justify-between gap-3">
                  <h2 className="truncate text-[18px] text-ink">{selected.title}</h2>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="mono text-[11px] tracking-wide text-content-faint">
                      {cards.length} card{cards.length === 1 ? "" : "s"}
                    </span>
                    <Button asChild variant="primary" size="sm">
                      <Link href={`/decks/${selected.id}`}>review</Link>
                    </Button>
                  </div>
                </div>

                <ul className="flex flex-col gap-2">
                  {cards.length === 0 && (
                    <li className="mono py-6 text-center text-[11px] text-content-faint">
                      no cards
                    </li>
                  )}
                  {cards.map((c, i) => (
                    <li
                      key={c.id}
                      className="rounded-card border border-border bg-surface-2 px-3 py-2.5 shadow-sm"
                    >
                      <div className="mono mb-1 text-[10px] tracking-wide text-content-faint">
                        {i + 1} · Q
                      </div>
                      <Markdown content={c.front} className="prose-chat text-[14px] leading-relaxed text-ink" />
                      <div className="mono mt-2 mb-1 text-[10px] tracking-wide text-content-faint">
                        A
                      </div>
                      <Markdown content={c.back} className="prose-chat text-[14px] leading-relaxed text-content-muted" />
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Card>
        </div>
      </div>

      {/* Delete confirmation */}
      <Dialog open={!!deckToDelete} onOpenChange={(o) => !o && setConfirmDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{deckToDelete?.title}”?</DialogTitle>
            <DialogDescription>
              This permanently removes the deck and all {deckToDelete?.card_count ?? 0} cards. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost" size="sm">cancel</Button>
            </DialogClose>
            <Button variant="danger" size="sm" onClick={() => deckToDelete && deleteDeck(deckToDelete.id)}>
              <Trash2 size={14} />
              delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
