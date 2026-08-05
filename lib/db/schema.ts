// SQLite schema for the StudyGPT v1 MVP.
// Two tables only — conversations and messages. Phases 2 (materials/chunks)
// and 3 (concepts/concept_edges) add their own tables later.
//
// Run via migrate() in index.ts on first connect; uses CREATE TABLE IF NOT EXISTS
// so it's idempotent and safe to extend.

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'chat',
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation
     ON messages(conversation_id, created_at)`,
  // Key-value store for runtime settings (provider, model, baseUrl).
  // Lets the Settings page change config live without touching .env.
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
] as const;

export type ConversationMode = "chat" | "feynman";

export interface Conversation {
  id: string;
  title: string;
  mode: ConversationMode;
  model: string;
  created_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: number;
}