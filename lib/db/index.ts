import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SCHEMA_SQL, type Conversation, type Message, type ConversationMode, type MessageKind, type MessageDeliveryState, type Attachment } from "./schema";
import { runMigrations } from "./migrations";
import { prefixThroughAssistantMessage } from "@/lib/chat/message-prefix";
import { rankConversationSearch, type ConversationSearchResult } from "@/lib/chat/conversation-search";
import { rankGlobalSearch, type GlobalSearchResult } from "@/lib/chat/global-search";

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
  // Base tables — idempotent CREATE TABLE IF NOT EXISTS (lib/db/schema.ts).
  for (const stmt of SCHEMA_SQL) db.exec(stmt);
  // Versioned additive migrations + back-fills. Each runs at most once per DB
  // and is recorded in schema_version; on a fresh DB this reproduces the same
  // final schema + back-fills the old boot block produced, and on an existing
  // DB every migration is a guarded no-op that only bumps the recorded version.
  // See lib/db/migrations.ts for the behavior contract.
  runMigrations(db);
  // Crash recovery (recurring — NOT a migration): a build that died
  // mid-extraction leaves its materials in status='extracting'. At startup no
  // build is running, so any 'extracting' row is stale — reset it to 'pending'
  // so the chip doesn't show a phantom "extracting…" forever. The next build
  // re-extracts (only status='ready' is skipped) and overwrites it. This must
  // run every boot (not once), so it stays here, outside runMigrations.
  db.prepare("UPDATE material_extractions SET status='pending' WHERE status='extracting'").run();
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

export function searchConversationHistory(query: string): ConversationSearchResult[] {
  const term = query.trim();
  if (!term) return [];
  const conversations = db.prepare("SELECT id, title FROM conversations ORDER BY created_at DESC").all() as {
    id: string;
    title: string;
  }[];
  const messages = db.prepare(
    "SELECT id, conversation_id, role, content FROM messages WHERE role IN ('user', 'assistant') ORDER BY created_at DESC, rowid DESC",
  ).all() as { id: string; conversation_id: string; role: "user" | "assistant"; content: string }[];
  return rankConversationSearch(
    conversations,
    messages.map((message) => ({
      id: message.id,
      conversationId: message.conversation_id,
      role: message.role,
      content: message.content,
    })),
    term,
  ).slice(0, 20);
}

export function searchGlobalHistory(query: string, activeProjectId: string | null): GlobalSearchResult[] {
  const term = query.trim();
  if (!term) return [];
  const conversations = db.prepare("SELECT id, title, project_id FROM conversations ORDER BY created_at DESC").all() as {
    id: string;
    title: string;
    project_id: string | null;
  }[];
  const messages = db.prepare(
    "SELECT id, conversation_id, role, content, kind FROM messages WHERE role IN ('user', 'assistant') ORDER BY created_at DESC, rowid DESC",
  ).all() as { id: string; conversation_id: string; role: "user" | "assistant"; content: string; kind: MessageKind }[];
  const materials = db.prepare("SELECT id, project_id, title, text FROM materials ORDER BY created_at DESC").all() as {
    id: string;
    project_id: string;
    title: string;
    text: string;
  }[];
  const concepts = db.prepare("SELECT id, project_id, label, description FROM concepts ORDER BY label ASC").all() as {
    id: string;
    project_id: string;
    label: string;
    description: string | null;
  }[];
  const overlays = db.prepare("SELECT id, conversation_id, selected_text FROM overlay_threads ORDER BY updated_at DESC, rowid DESC").all() as {
    id: string;
    conversation_id: string;
    selected_text: string;
  }[];

  return rankGlobalSearch({
    query: term,
    activeProjectId,
    conversations: conversations.map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      projectId: conversation.project_id,
    })),
    messages: messages.map((message) => ({
      id: message.id,
      conversationId: message.conversation_id,
      role: message.role,
      content: message.content,
      kind: message.kind,
    })),
    materials: materials.map((material) => ({
      id: material.id,
      projectId: material.project_id,
      title: material.title,
      text: material.text,
    })),
    concepts: concepts.map((concept) => ({
      id: concept.id,
      projectId: concept.project_id,
      label: concept.label,
      description: concept.description,
    })),
    overlays: overlays.map((overlay) => ({
      id: overlay.id,
      conversationId: overlay.conversation_id,
      selectedText: overlay.selected_text,
    })),
  });
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

export function updateConversationModel(id: string, model: string): void {
  db.prepare("UPDATE conversations SET model = ? WHERE id = ?").run(model, id);
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
  const rows = db
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(conversationId) as (Omit<Message, "attachments"> & { attachments: string | null })[];
  return rows.map((r) => {
    let attachments: Message["attachments"] = null;
    if (r.attachments) {
      try {
        const parsed = JSON.parse(r.attachments);
        if (Array.isArray(parsed)) attachments = parsed as Message["attachments"];
      } catch {
        attachments = null;
      }
    }
    return { ...r, attachments };
  });
}

// Returns a conversation's canonical history ending at one specific assistant
// message. The query is scoped to `conversationId` first, so a globally-known
// message ID from another conversation cannot be used as an overlay source.
export function listConversationMessagesThrough(
  conversationId: string,
  sourceMessageId: string,
): Message[] | null {
  return prefixThroughAssistantMessage(listMessages(conversationId), sourceMessageId);
}

export function addMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  id?: string,
  attachments?: Message["attachments"],
  tokens?: number,
  kind?: MessageKind,
  deliveryState: MessageDeliveryState = "complete",
): Message {
  const row: Message = {
    id: id ?? crypto.randomUUID(),
    conversation_id: conversationId,
    role,
    content,
    kind: kind ?? "chat",
    delivery_state: deliveryState,
    attachments: attachments ?? null,
    tokens: tokens ?? null,
    created_at: Date.now(),
  };
  // INSERT OR IGNORE: a retry/regenerate passing the same ID is a no-op,
  // so we never duplicate a user turn. (For the assistant reply, onFinish
  // uses upsertMessage instead so a completing full reply overwrites a
  // partial — see upsertMessage.)
  db.prepare(
    "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, kind, delivery_state, attachments, tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.conversation_id, row.role, row.content, row.kind, row.delivery_state, JSON.stringify(row.attachments), row.tokens, row.created_at);
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
  tokens?: number,
  kind?: MessageKind,
  deliveryState: MessageDeliveryState = "complete",
): Message {
  const row: Message = {
    id,
    conversation_id: conversationId,
    role,
    content,
    kind: kind ?? "chat",
    delivery_state: deliveryState,
    attachments: null,
    tokens: tokens ?? null,
    created_at: Date.now(),
  };
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, kind, delivery_state, attachments, tokens, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET content = excluded.content, tokens = excluded.tokens, kind = excluded.kind, delivery_state = excluded.delivery_state`,
  ).run(row.id, row.conversation_id, row.role, row.content, row.kind, row.delivery_state, JSON.stringify(row.attachments), row.tokens, row.created_at);
  return row;
}

// Fetch a single message by id (used by the print page's content fetch).
// Returns null if the id doesn't exist. attachments is JSON-parsed like
// listMessages.
export function getMessage(id: string): Message | null {
  const r = db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(id) as (Omit<Message, "attachments"> & { attachments: string | null }) | undefined;
  if (!r) return null;
  let attachments: Message["attachments"] = null;
  if (r.attachments) {
    try {
      const parsed = JSON.parse(r.attachments);
      if (Array.isArray(parsed)) attachments = parsed as Message["attachments"];
    } catch {
      attachments = null;
    }
  }
  return { ...r, attachments };
}

// Recompute + store a message's token estimate (e.g. after an edit changes
// its content or attachments). Caller supplies the estimate since it has the
// full content+attachments context the model saw.
export function setMessageTokens(id: string, tokens: number): void {
  db.prepare("UPDATE messages SET tokens = ? WHERE id = ?").run(tokens, id);
}

// Total estimated tokens across ALL messages — for the Settings page's
// global token count. Rows without a token estimate are counted as 0.
export function getTotalTokens(): number {
  const row = db.prepare("SELECT COALESCE(SUM(tokens), 0) AS total FROM messages").get() as { total: number | null };
  return row.total ?? 0;
}

export function updateMessageContent(id: string, content: string): void {
  db.prepare("UPDATE messages SET content = ? WHERE id = ?").run(content, id);
}

// Replace a user message's attachments during edit-and-resend. An empty array
// or null clears them (the user removed all attachments in the edit UI).
// Serializes consistently with addMessage: null when none, JSON otherwise.
export function updateMessageAttachments(
  id: string,
  attachments: Attachment[] | null,
): void {
  const serialized = attachments && attachments.length > 0 ? JSON.stringify(attachments) : null;
  db.prepare("UPDATE messages SET attachments = ? WHERE id = ?").run(serialized, id);
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
export * from "./decks";
export * from "./reviews";
export * from "./concepts";
export * from "./mastery";
export * from "./notation";
export * from "./overlays";
export * from "./insights";
export * from "./project-memory";
export * from "./artifact-versions";
export type { Project, ProjectMemoryEntry, Material, Chunk, SourceEntry, MaterialStatus, MaterialSourceType, Attachment, Message, MessageKind, MessageDeliveryState, MessageActivity, MessageGrounding, Deck, Card, CardScheduling, ReviewLog, Concept, ConceptEdge, ConceptSource, CardConcept, MaterialExtraction, MaterialExtractionStatus, EdgeConfidence, ConceptRelation, OverlayThread, OverlayMessage, ArtifactVersion, CreateArtifactVersionInput } from "./schema";
