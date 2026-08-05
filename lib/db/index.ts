import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SCHEMA_SQL, type Conversation, type Message, type ConversationMode } from "./schema";

// Keep one connection across hot-reloads in dev so we don't lock the file.
const globalForDb = globalThis as unknown as { __studygptDb?: Database.Database };

function open(): Database.Database {
  const configured = process.env.DATABASE_URL || "./data/studygpt.db";
  const inMemory = configured === ":memory:";
  // ":memory:" must be passed verbatim — resolve(":memory:") yields an
  // absolute path ending in ":memory:", which better-sqlite3 would then
  // create as a literal file on disk.
  const dbPath = inMemory ? ":memory:" : resolve(configured);
  if (!inMemory) mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  if (!inMemory) db.pragma("journal_mode = WAL"); // WAL requires a file-backed db
  db.pragma("foreign_keys = ON");
  for (const stmt of SCHEMA_SQL) db.exec(stmt);
  // Additive migration: add conversations.project_id if missing (existing DBs).
  const cols = db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "project_id")) {
    db.exec("ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL");
  }
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
  init: Pick<Conversation, "title" | "mode" | "model"> & { projectId?: string | null },
): Conversation {
  const row: Conversation = {
    id: crypto.randomUUID(),
    title: init.title,
    mode: init.mode,
    model: init.model,
    project_id: init.projectId ?? null,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT INTO conversations (id, title, mode, model, project_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.title, row.mode, row.model, row.project_id, row.created_at);
  return row;
}

export function updateConversationMode(id: string, mode: ConversationMode): void {
  db.prepare("UPDATE conversations SET mode = ? WHERE id = ?").run(mode, id);
}

export function updateConversationTitle(id: string, title: string): void {
  db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);
}

export function deleteConversation(id: string): void {
  // message_sources has no FK to messages by design (setMessageSources runs
  // before the assistant messages row exists), so conversation delete does
  // NOT cascade to it. Sweep manually BEFORE the conversation DELETE so the
  // messages rows still exist to select from (messages→conversations is
  // ON DELETE CASCADE, so the conversation DELETE would remove them after).
  db.prepare("DELETE FROM message_sources WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)").run(id);
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
  id?: string,
): Message {
  const row: Message = {
    id: id ?? crypto.randomUUID(),
    conversation_id: conversationId,
    role,
    content,
    created_at: Date.now(),
  };
  // INSERT OR IGNORE: a retry/regenerate passing the same ID is a no-op,
  // so we never duplicate a user turn. (For the assistant reply, onFinish
  // uses upsertMessage instead so a completing full reply overwrites a
  // partial — see upsertMessage.)
  db.prepare(
    "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(row.id, row.conversation_id, row.role, row.content, row.created_at);
  return row;
}

// Insert or overwrite content by id. Used by onFinish for the assistant
// reply: if a stop-persist already wrote a partial, the completing full
// reply overwrites it. Leaves created_at untouched on conflict.
export function upsertMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  id: string,
): Message {
  const row: Message = {
    id,
    conversation_id: conversationId,
    role,
    content,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content = excluded.content`,
  ).run(row.id, row.conversation_id, row.role, row.content, row.created_at);
  return row;
}

export function updateMessageContent(id: string, content: string): void {
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, id);
}

export function deleteMessage(id: string): void {
  db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  // message_sources has no FK to messages by design (setMessageSources runs
  // before the assistant messages row exists), so manual cleanup is required.
  db.prepare("DELETE FROM message_sources WHERE message_id = ?").run(id);
}

// Delete every message in the conversation strictly after `messageId`
// (by created_at). Used by edit-and-resend to drop the stale tail.
export function deleteMessagesAfter(conversationId: string, messageId: string): void {
  const anchor = db.prepare("SELECT created_at FROM messages WHERE id = ?").get(messageId) as
    | { created_at: number }
    | undefined;
  if (!anchor) return;
  // message_sources has no FK to messages by design → manual cleanup of the
  // same tail rows we're about to delete from messages.
  db.prepare(
    "DELETE FROM message_sources WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ? AND created_at > ?)",
  ).run(conversationId, anchor.created_at);
  db.prepare(
    "DELETE FROM messages WHERE conversation_id = ? AND created_at > ?",
  ).run(conversationId, anchor.created_at);
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

export * from "./projects";
export * from "./materials";
export * from "./sources";
export type { Project, Material, Chunk, SourceEntry, MaterialStatus, MaterialSourceType } from "./schema";