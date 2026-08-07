# Multimodal Chat Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four capabilities to StudyGPT chat — (1) paste/attach images with a vision-model hard gate, (2) voice typing, (3) attach files to a message (inline-extract their text into the prompt, with an optional "add to project" RAG action), and (4) switch the per-conversation model from the chat header.

**Architecture:** Attachments (images as base64 data URLs; text files as extracted text) are carried on each user message as a JSON `attachments` column on `messages`. The chat route unfolds attachments into AI SDK multi-part content (image parts + a text part with inlined file text) at send time, and persists them for reload. A shared `isVisionModel(model)` heuristic gates image input client-side (hard gate: image paste/picking is disabled unless the active conversation's model matches vision keywords, with an explanatory tooltip). Voice typing uses the browser Web Speech API, purely client-side. The model switcher lists models from `/v1/models` and PATCHes `conversation.model`; switching reactively re-evaluates the vision gate.

**Tech Stack:** Next.js 16.3 app router (route handlers with `params: Promise<{id}>` awaited), React 19.2, Tailwind v4 (`@theme inline` CSS-var tokens), better-sqlite3 (additive `ALTER TABLE` migration), AI SDK 7 (`streamText` with array-of-parts message content), `unpdf` (reused `extractPdf` for PDF text), Web Speech API (`SpeechRecognition`/`webkitSpeechRecognition`).

## Global Constraints

- **Graph Paper Lab tokens only.** Use `--paper / --paper-2 / --paper-3 / --ink / --ink-2 / --ink-3 / --rule / --feynman / --line / --grid`. 3px corners (2px chrome). Newsreader serif body + JetBrains Mono `.mono`. No new colors or fonts. Match the existing ChatInput/ChatMessage/header styling exactly.
- **Additive schema.** `CREATE TABLE IF NOT EXISTS` already in place; new columns via guarded `ALTER TABLE … ADD COLUMN` (check `PRAGMA table_info` before adding), exactly like the existing `conversations.project_id` migration in `lib/db/index.ts`. Never destructive.
- **Next 16 conventions.** Route handlers use `params: Promise<{id}>` and `await params`. Verify against `node_modules/next/dist/docs/` if a handler signature is unclear.
- **Read AGENTS.md.** This Next.js has breaking changes vs training data — consult `node_modules/next/dist/docs/` for the relevant API before writing route/UI code.
- **One commit per task.** Each task ends green: `npx tsc --noEmit`, `npm run lint`, `npm run build` (only the pre-existing `lib/db` dynamic-fs-access warning is acceptable).
- **Vision gate is a hard gate** (user decision): when `!isVisionModel(conversation.model)`, image paste and image picking are **disabled** (not warned-and-allowed), with a tooltip explaining why. Text-file attachment is never gated.
- **Files in chat = "both"** (user decision): a text-like file is inline-extracted into the message prompt **and** offered an "add to project" action (uploads the original file to `/api/materials` as a project material for RAG). The "add to project" action appears only on pending (pre-send) file chips and only when the conversation has a `project_id`.
- **YAGNI / DRY.** Reuse `extractPdf` from `lib/ingest`, the existing `/api/materials` multipart route for add-to-project, and existing Graph Paper Lab components. No new deps.
- **Local single-user MVP.** Large base64 image data URLs in the JSON chat body and in the `attachments` column are acceptable. (Same posture as the SSRF limitation already documented in `lib/ingest/index.ts`.)

---

## File Structure

- `lib/db/schema.ts` — add `Attachment` type; extend `Message` with `attachments: Attachment[] | null`.
- `lib/db/index.ts` — guarded `ALTER TABLE messages ADD COLUMN attachments TEXT`; `listMessages` parses the JSON column; `addMessage` gains an optional `attachments` param; new `updateConversationModel(id, model)`.
- `lib/llm/vision.ts` — **new.** `isVisionModel(model): boolean` heuristic, isomorphic (shared by client gate + `/api/models`).
- `app/api/models/route.ts` — **new.** `GET` lists available model ids + vision flags from `/v1/models`.
- `app/api/conversations/[id]/route.ts` — `PATCH` accepts `model`; `GET` unchanged (already returns `listMessages` which now parses attachments).
- `app/api/extract/route.ts` — **new.** `POST` multipart → `{ name, text, charCount }` for a single text-like file (reuses `extractPdf`).
- `app/api/chat/route.ts` — accept per-message `attachments`; build AI SDK multi-part content; persist `attachments` on the user message.
- `components/ChatInput.tsx` — image paste (Ctrl+V), image + file picker, pending attachment chips/thumbnails, vision gate, mic button, "add to project" on file chips; `onSend(text, attachments)` signature; new `model` + `projectId` props.
- `components/ChatMessage.tsx` — render persisted attachments (image thumbnails + file chips) under user messages.
- `app/page.tsx` — wire `onSend(text, attachments)`, pass `model` + `projectId` to `ChatInput`, include `attachments` in the chat request body and on the optimistic user message; replace the static model badge with a `<select>` model switcher.
- `lib/types/web-speech.d.ts` — **new** minimal ambient declarations for `SpeechRecognition` (avoids `any`).

---

### Task 1: Foundations — attachments column, model-switch DB+API, vision helper

**Files:**
- Modify: `lib/db/schema.ts`
- Modify: `lib/db/index.ts`
- Create: `lib/llm/vision.ts`
- Create: `app/api/models/route.ts`
- Modify: `app/api/conversations/[id]/route.ts`

**Interfaces:**
- Produces: `Attachment` type and `Message.attachments` (consumed by Tasks 3, 4, 5, 6); `addMessage(convId, role, content, id?, attachments?)`; `updateConversationModel(id, model)`; `isVisionModel(model)`; `GET /api/models → { models: { id: string; vision: boolean }[] }`; `PATCH /api/conversations/[id]` accepts `body.model`.
- Consumes: `getModelConfig()` / `getProvider()` from `lib/llm/provider`; `extractPdf` is NOT needed here.

- [ ] **Step 1: Add the `Attachment` type and extend `Message`** in `lib/db/schema.ts`

Append after the `SourceEntry` interface:

```ts
// A single attachment on a user message. Stored as JSON in messages.attachments.
// Images are kept as data URLs (sent to the model as image parts); text files
// have their extracted text inlined into the prompt at send time.
export type Attachment =
  | { type: "image"; name: string; mime: string; dataUrl: string }
  | { type: "file"; name: string; text: string; charCount: number };
```

Change the `Message` interface to add the column:

```ts
export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments: Attachment[] | null;
  created_at: number;
}
```

- [ ] **Step 2: Additive migration + parse-on-read + `updateConversationModel`** in `lib/db/index.ts`

Inside `open()`, after the existing `conversations.project_id` migration block, add a parallel guarded migration for `messages.attachments`:

```ts
  // Additive migration: add messages.attachments if missing (existing DBs).
  // Stores a JSON array of Attachment (image data URLs / inlined file text).
  const msgCols = db.prepare("PRAGMA table_info(messages)").all() as { name: string }[];
  if (!msgCols.some((c) => c.name === "attachments")) {
    db.exec("ALTER TABLE messages ADD COLUMN attachments TEXT");
  }
```

Update `listMessages` to parse the JSON column into `Attachment[] | null`:

```ts
export function listMessages(conversationId: string): Message[] {
  const rows = db
    .prepare(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
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
```

Extend `addMessage` with an optional `attachments` param (serialized to JSON):

```ts
export function addMessage(
  conversationId: string,
  role: Message["role"],
  content: string,
  id?: string,
  attachments?: Message["attachments"],
): Message {
  const row: Message = {
    id: id ?? crypto.randomUUID(),
    conversation_id: conversationId,
    role,
    content,
    attachments: attachments ?? null,
    created_at: Date.now(),
  };
  db.prepare(
    "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, attachments, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(row.id, row.conversation_id, row.role, row.content, JSON.stringify(row.attachments), row.created_at);
  return row;
}
```

Add `updateConversationModel` next to `updateConversationMode`:

```ts
export function updateConversationModel(id: string, model: string): void {
  db.prepare("UPDATE conversations SET model = ? WHERE id = ?").run(model, id);
}
```

- [ ] **Step 3: Create `lib/llm/vision.ts`** — the vision heuristic shared by the client gate and `/api/models`:

```ts
// Heuristic: does this model id name a vision/multimodal model?
// Ollama ids carry a tag (e.g. `llama3.2-vision:11b`); configured models may be
// untagged (e.g. `gemma3`). We match on substrings/keywords that the common
// Ollama vision model families contain. This is a heuristic, not a capability
// probe — it is the basis of the hard gate that disables image input when the
// active model is not vision-capable.
const VISION_KEYWORDS =
  /(vision|llava|moondream|minicpm-v|gemma3|qwen.*vl|qwen2-vl|qwen2\.5-vl|pixtral|internvl|phi-3-vision|phi-3\.5-vision|llama3\.2-vision|-vl\b|\bvl\b)/i;

export function isVisionModel(model: string | undefined | null): boolean {
  if (!model) return false;
  return VISION_KEYWORDS.test(model);
}
```

- [ ] **Step 4: Create `app/api/models/route.ts`** — list available models + vision flags:

```ts
import { NextResponse } from "next/server";
import { getModelConfig } from "@/lib/llm/provider";
import { isVisionModel } from "@/lib/llm/vision";

// GET /api/models — lists models available on the configured backend, each
// tagged with whether the vision heuristic considers it vision-capable. Used
// by the header model switcher. Non-fatal: returns an empty list (200) if the
// backend is unreachable, so the switcher degrades to the current model only.
export async function GET() {
  const cfg = getModelConfig();
  try {
    const res = await fetch(`${cfg.baseURL}/models`, {
      signal: AbortSignal.timeout(3000),
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
    });
    if (!res.ok) return NextResponse.json({ models: [] });
    const data = (await res.json()) as { data?: { id: string }[] };
    const models = (data.data ?? []).map((m) => ({
      id: m.id,
      vision: isVisionModel(m.id),
    }));
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [] });
  }
}
```

- [ ] **Step 5: Extend `PATCH /api/conversations/[id]` to accept `model`**

In `app/api/conversations/[id]/route.ts`, add the import and a `model` branch in `PATCH`:

```ts
import {
  deleteConversation,
  getConversation,
  getMessageSources,
  listMessages,
  updateConversationMode,
  updateConversationModel,
  updateConversationTitle,
} from "@/lib/db";
import type { ConversationMode } from "@/lib/db/schema";
```

In `PATCH`, add (after the `title` branch):

```ts
  if (typeof body.model === "string" && body.model.trim()) {
    updateConversationModel(id, body.model.trim());
  }
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean (only the pre-existing `lib/db` dynamic-fs warning). `npm run build` should list `/api/models` among the registered routes.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.ts lib/db/index.ts lib/llm/vision.ts app/api/models/route.ts app/api/conversations/\[id\]/route.ts
git commit -m "feat: attachments column, model-switch API, vision helper"
```

---

### Task 2: POST /api/extract — text extraction for chat file attachments

**Files:**
- Create: `app/api/extract/route.ts`

**Interfaces:**
- Consumes: `extractPdf` from `lib/ingest`.
- Produces: `POST /api/extract` (multipart `file`) → `200 { name, text, charCount }` for text-like files; `400` for unsupported types / missing file / too-large.

- [ ] **Step 1: Create `app/api/extract/route.ts`**

```ts
import { NextResponse } from "next/server";
import { extractPdf } from "@/lib/ingest";

// Text-like extensions we will inline into a chat message. Anything else is
// rejected so the picker/server stay in sync (the client picker uses the same
// list). PDFs go through unpdf; the rest are read as UTF-8.
const TEXT_EXT = [
  "pdf", "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml",
  "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "rb", "go", "rs", "java",
  "kt", "c", "cc", "cpp", "h", "hpp", "cs", "php", "swift", "sh", "bash",
  "sql", "html", "htm", "css", "scss", "toml", "ini", "env", "log", "xml",
];
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB cap on uploaded chat attachments

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

// POST /api/extract — multipart { file }. Extracts text from a single text-like
// file so the client can inline it into the next chat message. PDFs use the
// same unpdf path as materials ingestion; everything else is decoded as UTF-8.
export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024}MB)` }, { status: 400 });
  }
  const ext = extOf(file.name);
  if (!TEXT_EXT.includes(ext)) {
    return NextResponse.json(
      { error: `Unsupported file type: .${ext || "?"}` },
      { status: 400 },
    );
  }

  try {
    let text: string;
    if (ext === "pdf") {
      const bytes = new Uint8Array(await file.arrayBuffer());
      text = (await extractPdf(bytes)).text ?? "";
    } else {
      text = await file.text();
    }
    return NextResponse.json({ name: file.name, text, charCount: text.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Extraction failed" },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean; `/api/extract` listed in build output.

- [ ] **Step 3: Commit**

```bash
git add app/api/extract/route.ts
git commit -m "feat: POST /api/extract for chat file attachments"
```

---

### Task 3: Multimodal chat route — unfold attachments into AI SDK parts + persist

**Files:**
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `Attachment` type (Task 1); the request body's per-message `attachments?: Attachment[]`.
- Produces: a chat route that (a) sends image parts + inlined file text to the model and (b) stores `attachments` on the persisted user message.

- [ ] **Step 1: Extend the request body type and import `Attachment`**

At the top of `app/api/chat/route.ts`:

```ts
import type { SourceEntry, Attachment } from "@/lib/db";
```

Change the `messages` item type in `ChatBody`:

```ts
interface ChatBody {
  conversationId?: string;
  messages?: { role: ChatRole; content: string; attachments?: Attachment[] }[];
  action?: Action;
  userMessageId?: string;
  assistantMessageId?: string;
  replaceAssistantId?: string;
  editMessageId?: string;
  editContent?: string;
}
```

- [ ] **Step 2: Add a helper to build AI SDK message content from attachments**

Near the top of the file (after the types), add:

```ts
// Unfold a message's attachments into AI SDK message content. With no
// attachments, content stays a plain string (unchanged behavior). With
// attachments, content becomes an array of parts: one text part carrying the
// typed text plus inlined file-text blocks, followed by one image part per
// image attachment. File text is inlined (not a separate part type) so any
// model can read it; images become image parts the provider maps to image_url.
function toModelContent(content: string, attachments?: Attachment[]) {
  if (!attachments || attachments.length === 0) return content;
  const files = attachments.filter((a): a is Extract<Attachment, { type: "file" }> => a.type === "file");
  const images = attachments.filter((a): a is Extract<Attachment, { type: "image" }> => a.type === "image");
  const fileBlock = files
    .map((f) => `\n\n[Attached file: ${f.name}]\n${f.text}`)
    .join("");
  const parts: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
    { type: "text", text: (content || "") + fileBlock },
    ...images.map((a) => ({ type: "image" as const, image: a.dataUrl })),
  ];
  return parts;
}
```

- [ ] **Step 3: Persist attachments on the persisted user message and build model content**

In the `action === "send"` branch, pass the last user message's attachments into `addMessage`:

```ts
    if (action === "send") {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        addMessage(conversationId, "user", lastUser.content, userMessageId, lastUser.attachments);
        if (conv.title === "New conversation") {
          updateConversationTitle(
            conversationId,
            lastUser.content.slice(0, 50).trim() || "New conversation",
          );
        }
      }
    } else if (action === "regenerate") {
```

- [ ] **Step 4: Use `toModelContent` when calling `streamText`**

Replace the `messages:` mapping in the `streamText` call:

```ts
    const result = streamText({
      model,
      system: systemPromptFor(conv.mode) + contextBlock,
      messages: messages.map((m) => ({
        role: m.role,
        content: toModelContent(m.content, m.attachments),
      })),
      abortSignal: req.signal,
      onFinish: ({ text }) => {
```

Note: retrieval still embeds `lastUser.content` (the typed text only) — this is intentional; the file text is context, not the query. Leave the retrieval block unchanged.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean.

Smoke (optional, with `npm run dev` + a vision model pulled): POST `/api/chat` with a user message carrying `attachments: [{ type: "image", name: "x.png", mime: "image/png", dataUrl: "data:image/png;base64,..." }]` and confirm the streamed reply references the image.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat: chat route unfolds attachments into AI SDK parts"
```

---

### Task 4: ChatInput — image paste/picker, vision gate, file attachments + page wiring

**Files:**
- Modify: `components/ChatInput.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `isVisionModel` (Task 1); `POST /api/extract` (Task 2); `Attachment` type (Task 1).
- Produces: `ChatInput` props `{ onSend, onStop, streaming, disabled, placeholder, model, projectId }` with `onSend(text: string, attachments: Attachment[])`; pending-attachment chips/thumbnails; a paperclip picker; Ctrl+V image paste; vision hard gate; "add to project" on file chips. `app/page.tsx` threads `attachments` through `sendMessage` → `runChat` (request body + optimistic user message).

> **Scope note:** This task deliberately excludes the voice mic button (Task 5) and persisted-attachment rendering (Task 6). The mic button is added in Task 5 in the same control row.

- [ ] **Step 1: Update `ChatInput` props and signature**

In `components/ChatInput.tsx`, change the props interface and `onSend`:

```ts
import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent, type ClipboardEvent } from "react";
import type { Attachment } from "@/lib/db/schema";
import { isVisionModel } from "@/lib/llm/vision";

interface Props {
  onSend: (text: string, attachments: Attachment[]) => void;
  disabled?: boolean;
  placeholder?: string;
  streaming?: boolean;
  onStop?: () => void;
  model?: string;
  projectId?: string | null;
}
```

- [ ] **Step 2: Add pending-attachment state and helpers**

Inside the component:

```ts
  const [value, setValue] = useState("");
  const [pending, setPending] = useState<Array<{ id: string; attachment: Attachment; file?: File }>>([]);
  const [extracting, setExtracting] = useState(false);
  const [addedToProject, setAddedToProject] = useState<Set<string>>(new Set());
  const [addingToProject, setAddingToProject] = useState<string | null>(null);
  const [gateMsg, setGateMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const visionEnabled = isVisionModel(model);
```

Add a single shared TEXT_EXT string for the picker `accept` (mirror the server list):

```ts
  const TEXT_ACCEPT =
    ".pdf,.txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.js,.mjs,.cjs,.ts,.tsx,.jsx,.py,.rb,.go,.rs,.java,.kt,.c,.cc,.cpp,.h,.hpp,.cs,.php,.swift,.sh,.bash,.sql,.html,.htm,.css,.scss,.toml,.ini,.env,.log,.xml";
```

- [ ] **Step 3: Add an image as a pending attachment (data URL via FileReader)**

```ts
  function addImageFile(file: File) {
    if (!visionEnabled) {
      setGateMsg(`"${model}" doesn't support images — switch to a vision model to attach one.`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;
      setPending((prev) => [
        ...prev,
        { id: crypto.randomUUID(), attachment: { type: "image", name: file.name, mime: file.type, dataUrl } },
      ]);
    };
    reader.readAsDataURL(file);
  }
```

- [ ] **Step 4: Add a text file as a pending attachment (extract via `/api/extract`)**

```ts
  async function addTextFile(file: File) {
    setExtracting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setGateMsg(err.error || "Could not read that file.");
        return;
      }
      const data = (await res.json()) as { name: string; text: string; charCount: number };
      setPending((prev) => [
        ...prev,
        { id: crypto.randomUUID(), attachment: { type: "file", name: data.name, text: data.text, charCount: data.charCount }, file },
      ]);
    } finally {
      setExtracting(false);
    }
  }
```

- [ ] **Step 5: Handle picker selection and Ctrl+V paste**

```ts
  function onPickChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) {
      for (const f of Array.from(files)) {
        if (f.type.startsWith("image/")) addImageFile(f);
        else addTextFile(f);
      }
    }
    e.target.value = "";
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    let blockedImage = false;
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) {
          if (visionEnabled) {
            e.preventDefault();
            addImageFile(f);
          } else {
            blockedImage = true;
          }
        }
      }
    }
    if (blockedImage) setGateMsg(`"${model}" doesn't support images — paste disabled.`);
  }
```

- [ ] **Step 6: "Add to project" on a pending file chip**

```ts
  async function addToProject(id: string) {
    const item = pending.find((p) => p.id === id);
    if (!item || item.attachment.type !== "file" || !item.file || !projectId) return;
    setAddingToProject(id);
    try {
      const form = new FormData();
      form.append("projectId", projectId);
      form.append("file", item.file);
      const res = await fetch("/api/materials", { method: "POST", body: form });
      if (res.ok) {
        setAddedToProject((prev) => new Set(prev).add(id));
      } else {
        const err = await res.text();
        setGateMsg(err || "Add to project failed.");
      }
    } finally {
      setAddingToProject(null);
    }
  }
```

- [ ] **Step 7: Wire `submit` to send attachments and clear pending**

```ts
  function submit() {
    const text = value.trim();
    if (!text || disabled || streaming) return;
    onSend(text, pending.map((p) => p.attachment));
    setValue("");
    setPending([]);
    setAddedToProject(new Set());
    setGateMsg(null);
  }
```

Attach `onPaste={onPaste}` to the textarea.

- [ ] **Step 8: Render the paperclip, pending chips/thumbnails, and gate note**

Insert a hidden file input, a paperclip button before the textarea, a pending-attachments row above the textarea, and a gate note. The control row becomes:

```tsx
  return (
    <form onSubmit={onSubmit} className="px-4 pb-5 pt-2">
      {gateMsg && (
        <div className="mx-auto mb-1 max-w-3xl text-[11px] text-rule">{gateMsg}</div>
      )}
      <div className="mx-auto max-w-3xl rounded-[3px] border border-line bg-paper-2 px-3 py-2 transition-colors focus-within:border-ink/40">
        {pending.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pending.map((p) => (
              <div
                key={p.id}
                className="mono flex items-center gap-1.5 rounded-[2px] border border-line bg-paper px-2 py-1 text-[11px] text-ink-2"
              >
                {p.attachment.type === "image" ? (
                  <img src={p.attachment.dataUrl} alt={p.attachment.name} className="h-7 w-7 rounded-[2px] object-cover" />
                ) : (
                  <span className="truncate max-w-[160px]">📎 {p.attachment.name} ({p.attachment.charCount.toLocaleString()}c)</span>
                )}
                {p.attachment.type === "file" && projectId && (
                  addedToProject.has(p.id) ? (
                    <span className="text-feynman">added ✓</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToProject(p.id)}
                      disabled={addingToProject === p.id}
                      className="text-feynman hover:underline disabled:opacity-50"
                    >
                      {addingToProject === p.id ? "…" : "＋ to project"}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => setPending((prev) => prev.filter((x) => x.id !== p.id))}
                  aria-label="Remove attachment"
                  className="text-ink-3 hover:text-rule"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={visionEnabled ? `${TEXT_ACCEPT},image/*` : TEXT_ACCEPT}
            multiple
            className="hidden"
            onChange={onPickChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || extracting}
            title={visionEnabled ? "Attach files or images" : "Attach files (this model can't take images)"}
            aria-label="Attach files"
            className="mono shrink-0 rounded-[3px] border border-line bg-paper px-2 py-1.5 text-[12px] tracking-wide text-ink-2 transition-colors hover:border-ink/40 disabled:opacity-40"
          >
            +
          </button>
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            rows={1}
            disabled={disabled}
            placeholder={placeholder || "Ask about a concept…"}
            className="mono max-h-48 flex-1 resize-none bg-transparent py-1 text-[13px] leading-6 text-ink outline-none placeholder:text-ink-3 disabled:opacity-50"
          />
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="mono shrink-0 rounded-[3px] border border-rule px-3 py-1.5 text-[12px] tracking-wide text-rule transition-colors hover:bg-rule/10"
            >
              stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={disabled || (!value.trim() && pending.length === 0)}
              aria-label="Send"
              className="mono shrink-0 rounded-[3px] bg-ink px-3 py-1.5 text-[12px] tracking-wide text-paper-2 transition-opacity hover:opacity-90 disabled:opacity-30"
            >
              send ↵
            </button>
          )}
        </div>
      </div>
    </form>
  );
```

Note the send button is enabled when there are pending attachments even with empty text (so an image-only message is sendable). Keep the existing `useEffect` that grows the textarea.

- [ ] **Step 9: Wire `app/page.tsx` to thread attachments**

In `app/page.tsx`:

```ts
import type { Attachment } from "@/lib/db/schema";
```

Change `sendMessage`:

```ts
  async function sendMessage(text: string, attachments: Attachment[]) {
    if (!conversation || streaming) return;
    const userMsg: MessageWithSources = {
      id: crypto.randomUUID(),
      conversation_id: conversation.id,
      role: "user",
      content: text,
      attachments: attachments.length ? attachments : null,
      created_at: Date.now(),
    };
    const outgoing = [...messages, userMsg];
    setMessages(outgoing);

    if (conversation.title === "New conversation") {
      const newTitle = text.slice(0, 50).trim() || "New conversation";
      const titled = { ...conversation, title: newTitle };
      setConversation(titled);
      setConversations((prev) => prev.map((c) => (c.id === titled.id ? titled : c)));
    }

    await runChat({
      action: "send",
      history: outgoing,
      baseDisplay: outgoing,
      assistantId: crypto.randomUUID(),
      userMessageId: userMsg.id,
    });
  }
```

In `runChat`, include attachments in the request body's messages mapping:

```ts
        body: JSON.stringify({
          conversationId: conv.id,
          messages: args.history.map((m) => ({ role: m.role, content: m.content, attachments: m.attachments ?? undefined })),
          action: args.action,
          userMessageId: args.userMessageId,
          assistantMessageId: args.assistantId,
          replaceAssistantId: args.replaceAssistantId,
          editMessageId: args.editMessageId,
          editContent: args.editContent,
        }),
```

Update the `<ChatInput>` usage to pass `model` and `projectId`:

```tsx
        <ChatInput
          onSend={sendMessage}
          onStop={stop}
          streaming={streaming}
          disabled={streaming || !conversation}
          model={conversation?.model}
          projectId={conversation?.project_id ?? null}
          placeholder={…unchanged…}
        />
```

- [ ] **Step 10: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 11: Commit**

```bash
git add components/ChatInput.tsx app/page.tsx
git commit -m "feat: ChatInput image paste/picker, vision gate, file attachments"
```

---

### Task 5: Voice typing (Web Speech API mic button)

**Files:**
- Create: `lib/types/web-speech.d.ts`
- Modify: `components/ChatInput.tsx`

**Interfaces:**
- Produces: a mic button in the ChatInput control row that toggles speech recognition and appends the transcript into the textarea; hidden/disabled with a tooltip on unsupported browsers. Pure client-side, no backend.

- [ ] **Step 1: Create `lib/types/web-speech.d.ts`** — minimal ambient declarations (avoid `any`):

```ts
// Minimal ambient types for the Web Speech API (SpeechRecognition). The full
// lib.dom.d.ts in older TS did not ship these; declaring only the surface we
// use keeps the rest of the code typed.
interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}
interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}
```

- [ ] **Step 2: Add mic state + ref in `ChatInput`**

```ts
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const baseRef = useRef("");
  const speechSupported =
    typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);
```

- [ ] **Step 3: Toggle recognition**

```ts
  function toggleVoice() {
    if (!speechSupported) return;
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    baseRef.current = value;
    rec.onresult = (e: SpeechRecognitionEvent) => {
      let final = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      setValue(baseRef.current + final + interim);
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    setListening(true);
    rec.start();
  }
```

- [ ] **Step 4: Render the mic button** in the control row, between the paperclip (`+`) and the textarea:

```tsx
          {speechSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              disabled={disabled}
              title={listening ? "Stop voice typing" : "Voice type"}
              aria-label={listening ? "Stop voice typing" : "Voice type"}
              className={`mono shrink-0 rounded-[3px] border px-2 py-1.5 text-[12px] tracking-wide transition-colors disabled:opacity-40 ${
                listening
                  ? "border-rule text-rule hover:bg-rule/10"
                  : "border-line bg-paper text-ink-2 hover:border-ink/40"
              }`}
            >
              {listening ? "●" : "🎙"}
            </button>
          )}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean. Confirm the mic button appears only in Chrome/Edge ( Firefox hides it). Confirm `speechSupported` does not crash server render (guarded by `typeof window`).

- [ ] **Step 6: Commit**

```bash
git add lib/types/web-speech.d.ts components/ChatInput.tsx
git commit -m "feat: voice typing via Web Speech API"
```

---

### Task 6: ChatMessage — render persisted attachments

**Files:**
- Modify: `components/ChatMessage.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `Attachment` type (Task 1); `Message.attachments` now present on loaded messages.
- Produces: image thumbnails and "📎 name (Nc)" chips rendered under user message content; `ChatMessage` gains an `attachments?: Attachment[] | null` prop; `app/page.tsx` passes `attachments={m.attachments}`.

- [ ] **Step 1: Add the prop to `ChatMessage`**

```ts
import type { SourceEntry, Attachment } from "@/lib/db/schema";

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  sources?: SourceEntry[];
  attachments?: Attachment[] | null;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onEdit?: (newContent: string) => void;
  canRegenerate?: boolean;
}

export function ChatMessage({
  role, content, streaming, sources, attachments, onCopy, onRegenerate, onEdit, canRegenerate,
}: Props) {
```

- [ ] **Step 2: Render attachments in the user (non-editing) branch**

After the `<div className="whitespace-pre-wrap …">{content}</div>` block in the user branch, add:

```tsx
          {attachments && attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {attachments.map((a, i) =>
                a.type === "image" ? (
                  <img
                    key={i}
                    src={a.dataUrl}
                    alt={a.name}
                    className="max-h-32 rounded-[2px] border border-line object-contain"
                  />
                ) : (
                  <span
                    key={i}
                    className="mono rounded-[2px] border border-line bg-paper-2 px-2 py-0.5 text-[11px] text-ink-2"
                  >
                    📎 {a.name} ({a.charCount.toLocaleString()}c)
                  </span>
                ),
              )}
            </div>
          )}
```

- [ ] **Step 3: Pass `attachments` from `app/page.tsx`**

In the `messages.map` JSX:

```tsx
              <ChatMessage
                key={m.id}
                role={m.role}
                content={m.content}
                attachments={m.attachments}
                streaming={streaming && m.id === assistantStreamId}
                sources={m.sources}
                canRegenerate={m.id === lastAssistantId}
                onRegenerate={regenerate}
                onEdit={(content) => editMessage(m.id, content)}
              />
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean. Reload a conversation whose user messages had attachments and confirm thumbnails/chips render.

- [ ] **Step 5: Commit**

```bash
git add components/ChatMessage.tsx app/page.tsx
git commit -m "feat: render persisted attachments in ChatMessage"
```

---

### Task 7: Model switcher dropdown in the chat header

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: `GET /api/models` (Task 1); `PATCH /api/conversations/[id]` with `{ model }` (Task 1).
- Produces: a `<select>` replacing the static model badge; on change it PATCHes the conversation, updates `conversation` + `conversations` state, which reactively re-evaluates the ChatInput vision gate.

- [ ] **Step 1: Add models state + loader in `app/page.tsx`**

```ts
  const [models, setModels] = useState<Array<{ id: string; vision: boolean }>>([]);

  const loadModels = useCallback(async () => {
    const res = await fetch("/api/models");
    if (res.ok) setModels((await res.json()).models ?? []);
  }, []);
```

Add to the existing mount `useEffect` block (or a new one):

```ts
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadModels();
  }, [loadModels]);
```

- [ ] **Step 2: Add a `changeModel` handler**

```ts
  async function changeModel(model: string) {
    if (!conversation) return;
    const res = await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    const updated: Conversation = await res.json();
    setConversation(updated);
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }
```

- [ ] **Step 3: Replace the static model badge with a `<select>`**

Replace the `<span className="mono hidden …">{conversation.model}</span>` block with:

```tsx
              <select
                value={conversation.model}
                onChange={(e) => changeModel(e.target.value)}
                aria-label="Model"
                className="mono max-w-[180px] truncate rounded-[2px] border border-line bg-paper-2 px-2 py-0.5 text-[10px] tracking-wide text-ink-3 outline-none focus:border-ink/40"
              >
                {/* Ensure the current model is always selectable even if the
                    backend list is empty / doesn't include it. */}
                {!models.some((m) => m.id === conversation.model) && (
                  <option value={conversation.model}>{conversation.model}</option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id}
                    {m.vision ? "  ◉ vision" : ""}
                  </option>
                ))}
              </select>
```

(The `ModeToggle` stays as-is.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean.

Smoke: with `npm run dev` + Ollama running, open a conversation, change the model in the header, reload, and confirm the choice persists and the ChatInput vision gate flips when switching between a vision and non-vision model.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git commit -m "feat: model switcher dropdown in chat header"
```

---

### Task 8: Verify — tsc/lint/build + browser smoke checklist

**Files:** none.

- [ ] **Step 1: Full type/lint/build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: clean (only the pre-existing `lib/db` dynamic-fs-access warning).

- [ ] **Step 2: Hand the user a browser smoke checklist**

With `npm run dev`, Ollama running, and `nomic-embed-text` pulled:

1. **Model switcher** — open a conversation; change the model in the header; reload; confirm it persists.
2. **Vision hard gate** — with a non-vision model active (e.g. `glm-5.2:cloud`), paste an image / pick an image: the paperclip picker should omit `image/*` and paste should show the "doesn't support images" note. Switch to a vision model (e.g. `llama3.2-vision`); image paste/pick should now work.
3. **Image message** — paste an image with a vision model and send (with or without text); confirm the model describes the image, and the thumbnail persists after reload.
4. **Voice typing** — in Chrome/Edge, click 🎙, speak, confirm the transcript fills the box; click again to stop. (Firefox should hide the mic button.)
5. **File attach (inline)** — attach a PDF / .txt; confirm a "📎 name (Nc)" chip appears; send; confirm the reply references the file's contents; reload and confirm the chip persists.
6. **Add to project** — in a project conversation, attach a file; click "＋ to project"; confirm it appears on the Projects page as a ready material; confirm RAG retrieval cites it in a follow-up question.

- [ ] **Step 3: Update the SDD progress ledger**

Append a summary to `.superpowers/sdd/progress-multimodal.md` (or the existing phase ledger) noting each task's status, commits, and any recorded Minors — matching the established pattern from Phase 2.

---

## Self-Review

**Spec coverage:** Image paste + vision gate → T1 (helper) + T4 (paste/gate) + T3 (route). Voice typing → T5. Files in chat (inline + add-to-project) → T2 (extract) + T4 (UI + add-to-project) + T3 (route inlines text). Model switch → T1 (API/db) + T7 (UI). All four user features covered.

**Decisions reflected:** Hard vision gate — T1 helper + T4 `visionEnabled` disabling image picker accept and intercepting paste only when enabled; gate note explains why. Files "both" — T4 inlines via `/api/extract` AND offers "＋ to project" reusing `/api/materials`, only on project conversations and pre-send.

**Type consistency:** `Attachment` defined once (T1, schema.ts), threaded through `Message.attachments`, the chat body, `onSend`, `ChatInput` pending state, and `ChatMessage`. `addMessage` 5th param, `updateConversationModel`, `isVisionModel`, `GET /api/models` shape, `PATCH model` all consistent across tasks.

**Placeholders:** None — each step carries the actual code.