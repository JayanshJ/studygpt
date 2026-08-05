import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SCHEMA_SQL, type Conversation, type Message, type ConversationMode } from "./schema";

// Keep one connection across hot-reloads in dev so we don't lock the file.
const globalForDb = globalThis as unknown as { __studygptDb?: Database.Database };

function open(): Database.Database {
  const dbPath = resolve(process.env.DATABASE_URL || "./data/studygpt.db");
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  for (const stmt of SCHEMA_SQL) db.exec(stmt);
  return db;
}

export const db: Database.Database = globalForDb.__studygptDb ?? open();
if (process.env.NODE_ENV !== "production") globalForDb.__studygptDb = db;

// --- Conversations ---

export function listConversations(): Conversation[] {
  return db
    .prepare("SELECT * FROM conversations ORDER BY created_at DESC")
    .all() as Conversation[];
}

export function getConversation(id: string): Conversation | undefined {
  return db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(id) as Conversation | undefined;
}

export function createConversation(
  init: Pick<Conversation, "title" | "mode" | "model">,
): Conversation {
  const row: Conversation = {
    id: crypto.randomUUID(),
    title: init.title,
    mode: init.mode,
    model: init.model,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO conversations (id, title, mode, model, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(row.id, row.title, row.mode, row.model, row.created_at);
  return row;
}

export function updateConversationMode(id: string, mode: ConversationMode): void {
  db.prepare("UPDATE conversations SET mode = ? WHERE id = ?").run(mode, id);
}

export function updateConversationTitle(id: string, title: string): void {
  db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);
}

export function deleteConversation(id: string): void {
  db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
}

// --- Messages ---

export function listMessages(conversationId: string): Message[] {
  return db
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
    )
    .all(conversationId) as Message[];
}

export function addMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
): Message {
  const row: Message = {
    id: crypto.randomUUID(),
    conversation_id: conversationId,
    role,
    content,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(row.id, row.conversation_id, row.role, row.content, row.created_at);
  return row;
}

// --- Settings (key-value) ---

export function getSetting(key: string, fallback = ""): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}