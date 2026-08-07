import { db } from "./index";
import type { Deck, Card } from "./schema";

export function listDecks(): Deck[] {
  return db
    .prepare("SELECT * FROM decks ORDER BY created_at DESC")
    .all() as Deck[];
}

// All decks with their card counts in one query (LEFT JOIN + COUNT), so the
// /decks list page doesn't fan out a getCards call per deck. The count column
// is adjoined onto the Deck row shape as `card_count`.
export function listDecksWithCounts(): (Deck & { card_count: number })[] {
  return db
    .prepare(
      `SELECT d.*, COUNT(c.id) AS card_count
       FROM decks d
       LEFT JOIN cards c ON c.deck_id = d.id
       GROUP BY d.id
       ORDER BY d.created_at DESC`,
    )
    .all() as (Deck & { card_count: number })[];
}

export function getDeck(id: string): Deck | null {
  return (db.prepare("SELECT * FROM decks WHERE id = ?").get(id) as Deck | undefined) ?? null;
}

export function getCards(deckId: string): Card[] {
  return db
    .prepare("SELECT * FROM cards WHERE deck_id = ? ORDER BY ordinal ASC")
    .all(deckId) as Card[];
}

// Insert a deck and all its cards in a single transaction so a mid-loop failure
// leaves no orphan cards. `cards` carry front/back markdown; ordinal is taken
// from array position. Returns the new deck row.
export function createDeck(
  title: string,
  cards: { front: string; back: string }[],
  conversationId?: string | null,
): Deck {
  const deck: Deck = {
    id: crypto.randomUUID(),
    title,
    conversation_id: typeof conversationId === "string" ? conversationId : null,
    created_at: Date.now(),
  };
  const insertDeck = db.prepare(
    "INSERT INTO decks (id, title, conversation_id, created_at) VALUES (?, ?, ?, ?)",
  );
  const insertCard = db.prepare(
    "INSERT INTO cards (id, deck_id, front, back, ordinal, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const run = db.transaction((rows: { front: string; back: string; ordinal: number }[]) => {
    const now = deck.created_at;
    insertDeck.run(deck.id, deck.title, deck.conversation_id, now);
    rows.forEach((r, i) => {
      insertCard.run(crypto.randomUUID(), deck.id, r.front, r.back, i, now + i);
    });
  });
  run(cards.map((c, i) => ({ front: c.front, back: c.back, ordinal: i })));
  return deck;
}

export function renameDeck(id: string, title: string): void {
  db.prepare("UPDATE decks SET title = ? WHERE id = ?").run(title, id);
}

// ON DELETE CASCADE drops the deck's cards.
export function deleteDeck(id: string): void {
  db.prepare("DELETE FROM decks WHERE id = ?").run(id);
}