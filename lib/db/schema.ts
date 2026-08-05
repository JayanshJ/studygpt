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
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    title TEXT NOT NULL,
    source_type TEXT NOT NULL,      -- 'pdf' | 'url'
    source_ref TEXT NOT NULL,       -- url, or pdf filename
    text TEXT NOT NULL DEFAULT '',
    char_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'processing', -- 'processing' | 'ready' | 'error'
    error TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    text TEXT NOT NULL,
    embedding BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS message_sources (
    message_id TEXT PRIMARY KEY,
    sources TEXT NOT NULL,          -- JSON array
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chunks_material ON chunks(material_id)`,
] as const;

export type ConversationMode = "chat" | "feynman";

export interface Conversation {
  id: string;
  title: string;
  mode: ConversationMode;
  model: string;
  project_id: string | null;
  created_at: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments: Attachment[] | null;
  created_at: number;
}

export type MaterialStatus = "processing" | "ready" | "error";
export type MaterialSourceType = "pdf" | "url";

export interface Project {
  id: string;
  name: string;
  created_at: number;
}

export interface Material {
  id: string;
  project_id: string;
  title: string;
  source_type: MaterialSourceType;
  source_ref: string;
  text: string;
  char_count: number;
  status: MaterialStatus;
  error: string | null;
  created_at: number;
}

export interface Chunk {
  id: string;
  material_id: string;
  ordinal: number;
  text: string;
  embedding: Buffer; // Float32Array serialized
  created_at: number;
}

export interface SourceEntry {
  materialId: string;
  title: string;
  snippet: string;
  ordinal: number;
}

// A single attachment on a user message. Stored as JSON in messages.attachments.
// Images are kept as data URLs and, for the parsing layer, carry their OCR'd
// text so any model — even one without native vision — can ingest the image:
// vision-capable models get the image part directly; text-only models get the
// `text` inlined instead. Text files have their extracted text inlined too.
export type Attachment =
  | { type: "image"; name: string; mime: string; dataUrl: string; text?: string; charCount?: number }
  | { type: "file"; name: string; text: string; charCount: number };