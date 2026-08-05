# Chat UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stop/regenerate/edit/copy/retry/auto-resize/model-badge to the chat, plus a responsive collapsible sidebar and conversation search — without changing the Graph Paper Lab design system or adding a test framework.

**Architecture:** Make message IDs pass-through (client provides IDs, server persists under them) so client and DB agree; extend `POST /api/chat` with an `action` field for send/regenerate/edit; add a tiny `PATCH /api/messages` route to persist a partial reply on stop. Client holds an `AbortController` per request. Persistence uses `INSERT OR IGNORE` (idempotent; full text wins) for user turns and stop-persist, and `ON CONFLICT DO UPDATE content` for `onFinish` so a completing full reply always overwrites an earlier partial.

**Tech Stack:** Next.js 16.3 (app router, route handlers), React 19, better-sqlite3, AI SDK 7 (`streamText`), react-markdown 10, Tailwind 4.

## Global Constraints

- **No new test framework** (per spec). Verification per task = `npx tsc --noEmit` + `npm run lint` + a manual smoke step. Task 1 also runs an inline `node -e` check against an in-memory DB.
- **Design system tokens are fixed** — reuse only: `--paper/-2/-3`, `--ink/-2/-3`, `--rule`, `--feynman`, `--line`, `--grid`; `.mono` for chrome; 3px corners (2px on tight chrome). No new colors/fonts.
- **Next 16 is not the Next you know.** Before touching a route handler, skim `node_modules/next/dist/docs/01-app/` for the convention. (Existing routes already establish the working pattern — follow it.) The new route here is flat (no dynamic `[id]`), so no async-params concern.
- **Commit frequently** — one commit per task.
- `created_at` is milliseconds (`Date.now()`); `deleteMessagesAfter` orders by it. Same-millisecond collisions are accepted (single-user local app).

---

## File Structure

- `lib/db/index.ts` — modify `addMessage`; add `updateMessageContent`, `deleteMessage`, `deleteMessagesAfter`, `upsertMessage`. (Schema unchanged.)
- `app/api/chat/route.ts` — extend body with `action` + IDs + edit fields; pass `abortSignal`; branch persistence by action.
- `app/api/messages/route.ts` — **new**, flat `PATCH` for stop-persist of a partial assistant reply.
- `components/ChatInput.tsx` — auto-resize textarea; `stop` button while streaming; new `streaming`/`onStop` props.
- `components/CodeBlock.tsx` — **new**, `pre` override rendering a copy button over code.
- `components/ChatMessage.tsx` — hover controls (copy/regenerate) + inline edit mode; new optional `onCopy`/`onRegenerate`/`onEdit`/`canRegenerate` props; use `CodeBlock`.
- `components/Sidebar.tsx` — search input + title filter; new `query`/`onQueryChange` props.
- `app/page.tsx` — `runChat` core (AbortController, action threading, stop-persist), `sendMessage`/`stop`/`retry`/`regenerate`/`editMessage`, model badge, responsive sidebar overlay + hamburger, `query` state.

---

## Task 1: Data-layer helpers

**Files:**
- Modify: `lib/db/index.ts`

**Interfaces:**
- Produces (used by Tasks 2, 3):
  - `addMessage(conversationId: string, role: Message["role"], content: string, id?: string): Message` — `INSERT OR IGNORE`, mints id if absent.
  - `upsertMessage(conversationId: string, role: Message["role"], content: string, id: string): Message` — insert or `ON CONFLICT(id) DO UPDATE SET content = excluded.content`.
  - `updateMessageContent(id: string, content: string): void`
  - `deleteMessage(id: string): void`
  - `deleteMessagesAfter(conversationId: string, messageId: string): void`

- [ ] **Step 1: Modify `addMessage` for optional ID + idempotent insert**

In `lib/db/index.ts`, replace the existing `addMessage` with:

```ts
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
```

- [ ] **Step 2: Add `upsertMessage`, `updateMessageContent`, `deleteMessage`, `deleteMessagesAfter`**

Append after `addMessage` in `lib/db/index.ts`:

```ts
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
}

// Delete every message in the conversation strictly after `messageId`
// (by created_at). Used by edit-and-resend to drop the stale tail.
export function deleteMessagesAfter(conversationId: string, messageId: string): void {
  const anchor = db.prepare("SELECT created_at FROM messages WHERE id = ?").get(messageId) as
    | { created_at: number }
    | undefined;
  if (!anchor) return;
  db.prepare(
    "DELETE FROM messages WHERE conversation_id = ? AND created_at > ?",
  ).run(conversationId, anchor.created_at);
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Verify behavior against an in-memory DB**

Run:

```bash
DATABASE_URL=":memory:" node -e "
const m = require('./lib/db');
const c = m.createConversation({title:'t',mode:'chat',model:'m'});
m.addMessage(c.id,'user','hello','u1');
m.addMessage(c.id,'assistant','hi','a1');
m.addMessage(c.id,'assistant','hi','a1');            // dup id -> ignored
m.updateMessageContent('u1','hello world');
m.deleteMessagesAfter(c.id,'u1');                    // removes a1
m.addMessage(c.id,'assistant','partial','a2');       // stop-persist (ignore)
m.upsertMessage(c.id,'assistant','FULL','a2');       // onFinish overwrites partial
console.log(JSON.stringify(m.listMessages(c.id).map(x=>x.id+':'+x.content)));
"
```

Expected: `["u1:hello world","a2:FULL"]` — no duplicate `a1`, `a1` dropped by `deleteMessagesAfter`, `a2` overwritten from `partial` to `FULL` by upsert.

- [ ] **Step 5: Commit**

```bash
git add lib/db/index.ts
git commit -m "feat(db): add message id pass-through, upsert, edit/delete helpers"
```

---

## Task 2: Extend `POST /api/chat` with action + ID pass-through + abort

**Files:**
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes (from Task 1): `addMessage`, `upsertMessage`, `updateMessageContent`, `deleteMessage`, `deleteMessagesAfter`.
- Produces: `POST /api/chat` accepting `{ conversationId, messages, action?, userMessageId?, assistantMessageId?, replaceAssistantId?, editMessageId?, editContent? }`. Persists user under `userMessageId` (send), replaces per regenerate/edit, and persists the assistant reply via `upsertMessage(assistantMessageId)` in `onFinish`. Honors `req.signal` as `abortSignal`.

- [ ] **Step 1: Replace the route body**

Replace the entire contents of `app/api/chat/route.ts` with:

```ts
import { streamText } from "ai";
import { getProvider, getModelConfig } from "@/lib/llm/provider";
import { systemPromptFor } from "@/lib/prompts";
import {
  getConversation,
  addMessage,
  upsertMessage,
  updateMessageContent,
  deleteMessage,
  deleteMessagesAfter,
  updateConversationTitle,
} from "@/lib/db";

type ChatRole = "user" | "assistant" | "system";
type Action = "send" | "regenerate" | "edit";

interface ChatBody {
  conversationId?: string;
  messages?: { role: ChatRole; content: string }[];
  action?: Action;
  userMessageId?: string;
  assistantMessageId?: string;
  replaceAssistantId?: string;
  editMessageId?: string;
  editContent?: string;
}

// POST { conversationId, messages, action, ...ids }
// Streams the assistant reply as plain text. Persists per `action` before
// streaming and the assistant reply (upsert under assistantMessageId) in
// onFinish. Honors req.signal so a client stop cancels generation.
export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const {
    conversationId,
    messages,
    action = "send",
    userMessageId,
    assistantMessageId,
    replaceAssistantId,
    editMessageId,
    editContent,
  } = body;
  if (!conversationId || !Array.isArray(messages)) {
    return new Response("Missing conversationId or messages", { status: 400 });
  }

  const conv = getConversation(conversationId);
  if (!conv) return new Response("Conversation not found", { status: 404 });

  const cfg = getModelConfig();
  try {
    const provider = getProvider(cfg.provider);
    const modelId = conv.model || cfg.model;

    if (provider.validate) {
      await provider.validate({ model: modelId, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
    }
    const model = provider.languageModel({
      model: modelId,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
    });

    if (action === "send") {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (lastUser) {
        addMessage(conversationId, "user", lastUser.content, userMessageId);
        if (conv.title === "New conversation") {
          updateConversationTitle(
            conversationId,
            lastUser.content.slice(0, 50).trim() || "New conversation",
          );
        }
      }
    } else if (action === "regenerate") {
      if (replaceAssistantId) deleteMessage(replaceAssistantId);
    } else if (action === "edit") {
      if (editMessageId && editContent !== undefined) {
        updateMessageContent(editMessageId, editContent);
        deleteMessagesAfter(conversationId, editMessageId);
      }
    }

    const result = streamText({
      model,
      system: systemPromptFor(conv.mode),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      abortSignal: req.signal,
      onFinish: ({ text }) => {
        if (assistantMessageId) upsertMessage(conversationId, "assistant", text, assistantMessageId);
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Streaming failed";
    return new Response(msg, { status: 502 });
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Smoke (with Ollama running)**

Start dev (`npm run dev`), create a conversation in the UI, send a message — confirm a normal reply still streams. Then, holding the existing UI (Task 7 wires the new actions), this route is exercised end-to-end in Task 9. For now just confirm `curl` rejects bad input:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d '{}'
```

Expected: `400`.

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(api/chat): action + id pass-through + abort signal"
```

---

## Task 3: `PATCH /api/messages` (stop-persist)

**Files:**
- Create: `app/api/messages/route.ts`

**Interfaces:**
- Consumes (from Task 1): `addMessage` (idempotent `INSERT OR IGNORE`).
- Produces: `PATCH /api/messages` body `{ conversationId, messageId, role, content }` → persists a partial assistant reply under `messageId` only if no row exists yet (so a completed full reply always wins).

- [ ] **Step 1: Create the route**

Create `app/api/messages/route.ts`:

```ts
import { addMessage } from "@/lib/db";

interface Body {
  conversationId?: string;
  messageId?: string;
  role?: "user" | "assistant" | "system";
  content?: string;
}

// PATCH { conversationId, messageId, role, content }
// Stop-persist: writes a partial assistant reply under messageId. Uses
// addMessage (INSERT OR IGNORE) so if onFinish already wrote the full
// reply, this is a no-op — the full reply wins.
export async function PATCH(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const { conversationId, messageId, role, content } = body;
  if (!conversationId || !messageId || !role || content === undefined) {
    return new Response("Missing conversationId, messageId, role, or content", { status: 400 });
  }
  addMessage(conversationId, role, content, messageId);
  return new Response("OK", { status: 200 });
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/messages/route.ts
git commit -m "feat(api/messages): stop-persist partial reply route"
```

---

## Task 4: Auto-resize input + stop button

**Files:**
- Modify: `components/ChatInput.tsx`

**Interfaces:**
- Produces: `ChatInput({ onSend, disabled?, placeholder?, streaming?, onStop? })`. Auto-grows the textarea to content (cap 192px), shows a `stop` button (rule-colored) instead of `send` while `streaming`.

- [ ] **Step 1: Replace the component**

Replace the entire contents of `components/ChatInput.tsx` with:

```tsx
"use client";

import { useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
  streaming?: boolean;
  onStop?: () => void;
}

export function ChatInput({ onSend, disabled, placeholder, streaming, onStop }: Props) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  // Grow to fit content, capped at ~6 lines, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || disabled || streaming) return;
    onSend(text);
    setValue("");
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form onSubmit={onSubmit} className="px-4 pb-5 pt-2">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-[3px] border border-line bg-paper-2 px-3 py-2 transition-colors focus-within:border-ink/40">
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
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
            disabled={disabled || !value.trim()}
            aria-label="Send"
            className="mono shrink-0 rounded-[3px] bg-ink px-3 py-1.5 text-[12px] tracking-wide text-paper-2 transition-opacity hover:opacity-90 disabled:opacity-30"
          >
            send ↵
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ChatInput.tsx
git commit -m "feat(ChatInput): auto-resize + stop button"
```

---

## Task 5: `CodeBlock` (copy on code)

**Files:**
- Create: `components/CodeBlock.tsx`

**Interfaces:**
- Produces: `CodeBlock({ children })` — a `react-markdown` `pre` component override that renders the original `<pre>` with an absolutely-positioned mono `copy` button (revealed via the nearest `group` hover, which is the assistant message container).

- [ ] **Step 1: Create the component**

Create `components/CodeBlock.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";

interface PreProps {
  children?: ReactNode;
}

// Recursively flatten a react-markdown <pre><code>...</code></pre> tree to
// its raw text so we can copy it.
function extractText(node: ReactNode): string {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in node) {
    return extractText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

export function CodeBlock({ children }: PreProps) {
  const [copied, setCopied] = useState(false);
  const text = extractText(children);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
  }

  return (
    <div className="relative">
      <button
        onClick={copy}
        aria-label="Copy code"
        className="mono absolute right-2 top-2 z-10 rounded-[2px] border border-line bg-paper-2 px-1.5 py-0.5 text-[10px] tracking-wide text-ink-3 opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
      >
        {copied ? "copied" : "copy"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/CodeBlock.tsx
git commit -m "feat(CodeBlock): copy button over code blocks"
```

---

## Task 6: ChatMessage controls (copy / regenerate / edit)

**Files:**
- Modify: `components/ChatMessage.tsx`

**Interfaces:**
- Consumes (from Task 5): `CodeBlock`.
- Produces: `ChatMessage({ role, content, streaming?, onCopy?, onRegenerate?, onEdit?, canRegenerate? })`. Assistant bubbles show hover `copy` (always) and `regen` (only when `canRegenerate && !streaming && onRegenerate`). User bubbles show an `edit` affordance when `onEdit` is passed; editing is an inline textarea (`Enter` commit, `Shift+Enter` newline, `Esc` cancel).

- [ ] **Step 1: Replace the component**

Replace the entire contents of `components/ChatMessage.tsx` with:

```tsx
"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { CodeBlock } from "./CodeBlock";

interface Props {
  role: "user" | "assistant" | "system";
  content: string;
  streaming?: boolean;
  onCopy?: () => void;
  onRegenerate?: () => void;
  onEdit?: (newContent: string) => void;
  canRegenerate?: boolean;
}

export function ChatMessage({
  role,
  content,
  streaming,
  onCopy,
  onRegenerate,
  onEdit,
  canRegenerate,
}: Props) {
  const isUser = role === "user";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // clipboard unavailable — silent
    }
    onCopy?.();
  }

  function commitEdit() {
    const t = draft.trim();
    if (!t) return;
    setEditing(false);
    if (t !== content) onEdit?.(t);
  }

  function cancelEdit() {
    setDraft(content);
    setEditing(false);
  }

  if (isUser && editing) {
    return (
      <div className="flex justify-end">
        <div className="w-[80%] max-w-[80%] rounded-r-[3px] rounded-l-[2px] border-l-2 border-rule bg-paper-3 px-4 py-2.5">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEdit();
              }
            }}
            rows={Math.min(8, Math.max(1, draft.split("\n").length))}
            className="mono w-full resize-none rounded-[2px] border border-line bg-paper-2 px-2 py-1 text-[13px] leading-6 text-ink outline-none focus:border-ink"
          />
          <div className="mono mt-1 flex justify-end gap-3 text-[10px] tracking-wide text-ink-3">
            <button onClick={cancelEdit} className="hover:text-ink">
              cancel
            </button>
            <button onClick={commitEdit} className="text-rule hover:opacity-80">
              save ↵
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="max-w-[80%] rounded-r-[3px] rounded-l-[2px] border-l-2 border-rule bg-paper-3 px-4 py-2.5">
          <div className="mono mb-1 flex items-center justify-end gap-2 text-[10px] tracking-wide text-rule">
            <span>you</span>
            {onEdit && (
              <button
                onClick={() => {
                  setDraft(content);
                  setEditing(true);
                }}
                aria-label="Edit and resend"
                className="opacity-0 transition-opacity hover:text-ink group-hover:opacity-100"
              >
                edit
              </button>
            )}
          </div>
          <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex justify-start">
      <div className="max-w-[85%] rounded-[3px] border border-line bg-paper-2 px-4 py-3 shadow-[0_1px_2px_rgba(31,32,32,0.04)]">
        <div className="mono mb-1.5 flex items-center gap-1.5 text-[10px] tracking-wide text-ink-3">
          <span className="h-1 w-1 rounded-full bg-rule" />
          studygpt
          <div className="ml-auto flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
            <button onClick={copy} aria-label="Copy message" className="hover:text-ink">
              {copied ? "copied" : "copy"}
            </button>
            {canRegenerate && onRegenerate && !streaming && (
              <button onClick={onRegenerate} aria-label="Regenerate" className="hover:text-ink">
                regen
              </button>
            )}
          </div>
        </div>
        <div className="prose-chat text-ink">
          <ReactMarkdown
            remarkPlugins={[remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{ pre: CodeBlock }}
          >
            {content || ""}
          </ReactMarkdown>
          {streaming && (
            <span className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[2px] animate-pulse bg-rule" />
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/ChatMessage.tsx
git commit -m "feat(ChatMessage): copy/regenerate controls + inline edit"
```

---

## Task 7: Page wiring — runChat, stop, retry, regenerate, edit, model badge

**Files:**
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes (from Tasks 4, 6): `ChatInput` (`streaming`, `onStop`), `ChatMessage` (`onCopy`, `onRegenerate`, `onEdit`, `canRegenerate`).
- Produces: the chat page with a unified `runChat` (AbortController, action threading, stop-persist), plus `sendMessage`, `stop`, `retry`, `regenerate`, `editMessage`, and a model badge in the header. (Sidebar changes come in Task 8; this task keeps the existing `<Sidebar>` call and adds the new query/sidebar props as no-ops only if needed — actually Sidebar gets its new props in Task 8, so this task passes the current prop set and Task 8 extends both sides.)

> **Note:** Task 8 changes `Sidebar`'s props (adds `query`/`onQueryChange`) and the page layout (responsive overlay + hamburger + `query` state). To keep each task independently compilable, **this task** does not touch `Sidebar`'s call site beyond what exists today; **Task 8** adds the new state and props together. Do not add `query`/`sidebarOpen` here.

- [ ] **Step 1: Replace `app/page.tsx`**

Replace the entire contents of `app/page.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { ModeToggle } from "@/components/ModeToggle";
import type { Conversation, ConversationMode, Message } from "@/lib/db/schema";

type ChatAction = "send" | "regenerate" | "edit";

export default function Page() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantStreamId, setAssistantStreamId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, assistantStreamId]);

  async function selectConversation(id: string) {
    setActiveId(id);
    setError(null);
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    setConversation(data.conversation);
    setMessages(data.messages ?? []);
  }

  async function newConversation() {
    setError(null);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const conv: Conversation = await res.json();
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    setConversation(conv);
    setMessages([]);
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setConversation(null);
      setMessages([]);
    }
  }

  async function changeMode(mode: ConversationMode) {
    if (!conversation) return;
    const res = await fetch(`/api/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const updated: Conversation = await res.json();
    setConversation(updated);
    setConversations((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  }

  // Core streaming runner. `baseDisplay` is the message list to show *before*
  // the new assistant bubble (already includes any new/edited user message).
  // runChat appends the (empty) assistant bubble, streams into it, and
  // persists per `action`.
  async function runChat(args: {
    action: ChatAction;
    history: Message[];
    assistantId: string;
    baseDisplay: Message[];
    userMessageId?: string;
    replaceAssistantId?: string;
    editMessageId?: string;
    editContent?: string;
  }) {
    const conv = conversation;
    if (!conv) return;
    setError(null);
    const assistantMsg: Message = {
      id: args.assistantId,
      conversation_id: conv.id,
      role: "assistant",
      content: "",
      created_at: Date.now(),
    };
    setMessages([...args.baseDisplay, assistantMsg]);
    setAssistantStreamId(args.assistantId);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conv.id,
          messages: args.history.map((m) => ({ role: m.role, content: m.content })),
          action: args.action,
          userMessageId: args.userMessageId,
          assistantMessageId: args.assistantId,
          replaceAssistantId: args.replaceAssistantId,
          editMessageId: args.editMessageId,
          editContent: args.editContent,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === args.assistantId ? { ...m, content: acc } : m)),
        );
      }
    } catch (err) {
      if (controller.signal.aborted) {
        // Stopped — keep the partial in the bubble and persist it (idempotent:
        // if onFinish already wrote the full reply, this is a no-op).
        if (acc) {
          fetch("/api/messages", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: conv.id,
              messageId: args.assistantId,
              role: "assistant",
              content: acc,
            }),
          }).catch(() => {});
        }
      } else {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== args.assistantId));
      }
    } finally {
      setStreaming(false);
      setAssistantStreamId(null);
      abortRef.current = null;
    }
  }

  async function sendMessage(text: string) {
    if (!conversation || streaming) return;
    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversation.id,
      role: "user",
      content: text,
      created_at: Date.now(),
    };
    const outgoing = [...messages, userMsg];
    setMessages(outgoing);

    // Optimistically title the conversation on the first turn (server does too).
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

  function stop() {
    abortRef.current?.abort();
  }

  async function retry() {
    if (!conversation || streaming) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    // Re-send the same user turn; user message is already persisted (idempotent).
    await runChat({
      action: "send",
      history: messages,
      baseDisplay: messages,
      assistantId: crypto.randomUUID(),
      userMessageId: lastUser.id,
    });
  }

  async function regenerate() {
    if (!conversation || streaming) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const history = messages.filter((m) => m.id !== lastAssistant.id);
    const baseDisplay = history; // drop old assistant, new one appended by runChat
    await runChat({
      action: "regenerate",
      history,
      baseDisplay,
      assistantId: crypto.randomUUID(),
      replaceAssistantId: lastAssistant.id,
    });
  }

  async function editMessage(messageId: string, newContent: string) {
    if (!conversation || streaming) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const edited: Message = { ...messages[idx], content: newContent };
    const history = [...messages.slice(0, idx), edited]; // drop everything after
    await runChat({
      action: "edit",
      history,
      baseDisplay: history,
      assistantId: crypto.randomUUID(),
      editMessageId: messageId,
      editContent: newContent,
    });
  }

  // Index of the last assistant message — for the regenerate affordance.
  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return messages[i].id;
    }
    return null;
  })();

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={newConversation}
        onDelete={deleteConversation}
      />

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5">
          <span className="truncate pr-3 text-[15px] italic text-ink-2">
            {conversation?.title ?? "Select or start a conversation"}
          </span>
          {conversation && (
            <div className="flex shrink-0 items-center gap-3">
              <span className="mono hidden rounded-[2px] border border-line bg-paper-2 px-2 py-0.5 text-[10px] tracking-wide text-ink-3 sm:inline">
                {conversation.model}
              </span>
              <ModeToggle mode={conversation.mode} onChange={changeMode} />
            </div>
          )}
        </header>

        <div ref={scrollRef} className="graph-paper flex-1 overflow-y-auto px-4 py-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {!conversation && (
              <div className="mx-auto mt-24 max-w-md text-center">
                <p className="mono mb-3 text-[11px] tracking-[0.2em] text-rule">NOTEBOOK</p>
                <h1 className="text-[1.6rem] leading-tight text-ink">
                  Start a conversation to study a concept.
                </h1>
                <p className="mt-3 text-[15px] text-ink-2">
                  Ask about the derivative, eigenvalues, or entropy — then flip on{" "}
                  <span className="text-feynman">Feynman</span> to learn by explaining it
                  back.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                role={m.role}
                content={m.content}
                streaming={streaming && m.id === assistantStreamId}
                canRegenerate={m.id === lastAssistantId}
                onRegenerate={regenerate}
                onEdit={(content) => editMessage(m.id, content)}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="mx-auto w-full max-w-3xl px-4">
            <div className="mono flex items-center gap-3 rounded-[3px] border border-rule/40 bg-rule/5 px-3 py-2 text-[12px] text-rule">
              <span className="flex-1">{error}</span>
              <button onClick={retry} className="underline hover:opacity-80">
                retry
              </button>
            </div>
          </div>
        )}

        <ChatInput
          onSend={sendMessage}
          onStop={stop}
          streaming={streaming}
          disabled={streaming || !conversation}
          placeholder={
            conversation
              ? conversation.mode === "feynman"
                ? "Tell the tutor what concept you want to learn…"
                : "Ask about a concept… (Enter to send)"
              : "Start a conversation first"
          }
        />
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (If lint flags `lastAssistantId` IIFE, it's fine — it's a plain const derived per render. If eslint complains about the inline arrow `(content) => editMessage(m.id, content)` creating a new function per render, suppress with a `// eslint-disable-next-line react/no-unstable-nash` only if that rule is enabled; otherwise leave it.)

- [ ] **Step 3: Smoke (with Ollama running)**

`npm run dev`. Send a message → reply streams. Click `stop` mid-stream → generation stops, partial stays in the bubble. Reload → partial persists. Click `regen` on the last assistant reply → new reply streams; reload → only the new reply is present. Edit a user message → tail drops, fresh reply streams; reload → consistent. Stop Ollama, send → error bar with `retry`; restart Ollama, click `retry` → reply recovers.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(page): stop/retry/regenerate/edit + model badge + id pass-through"
```

---

## Task 8: Responsive sidebar overlay + conversation search

**Files:**
- Modify: `components/Sidebar.tsx`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces: `Sidebar({ conversations, activeId, onSelect, onNew, onDelete, query, onQueryChange })` — adds a `search` input that filters conversations by title (case-insensitive substring). Page adds `query`/`setQuery` state, a `sidebarOpen` state, a hamburger button (visible `<md`), and renders the sidebar as a fixed overlay on mobile (`<md`) and static on desktop (`≥md`). Selecting a conversation closes the mobile overlay.

- [ ] **Step 1: Replace `components/Sidebar.tsx`**

Replace the entire contents of `components/Sidebar.tsx` with:

```tsx
"use client";

import Link from "next/link";
import type { Conversation } from "@/lib/db/schema";

interface Props {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
}

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  query,
  onQueryChange,
}: Props) {
  const q = query.trim().toLowerCase();
  const filtered = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;

  return (
    <aside className="margin-rule flex h-full w-64 shrink-0 flex-col bg-paper-3">
      <header className="flex items-center justify-between px-4 py-3.5">
        <span className="mono flex items-center gap-2 text-[13px] font-medium tracking-wide text-ink">
          <span className="h-1.5 w-1.5 rounded-full bg-rule" />
          StudyGPT
        </span>
        <Link
          href="/settings"
          aria-label="Settings"
          className="mono text-ink-3 transition-colors hover:text-ink"
        >
          ⚙
        </Link>
      </header>

      <div className="px-3 pb-2">
        <button
          onClick={onNew}
          className="mono w-full rounded-[3px] border border-line bg-paper-2 px-3 py-2 text-[12px] tracking-wide text-ink transition-colors hover:border-ink/40"
        >
          + new conversation
        </button>
      </div>

      <div className="px-3 pb-1">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="search"
          className="mono w-full rounded-[3px] border border-line bg-paper-2 px-2.5 py-1.5 text-[12px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink/40"
        />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3 pt-1">
        {filtered.length === 0 && (
          <p className="mono px-2 py-4 text-[11px] text-ink-3">
            {conversations.length === 0 ? "no conversations yet" : "no matches"}
          </p>
        )}
        {filtered.map((c) => {
          const active = c.id === activeId;
          return (
            <div
              key={c.id}
              onClick={() => onSelect(c.id)}
              className={`group relative cursor-pointer rounded-[3px] px-3 py-2 text-[14px] transition-colors ${
                active ? "bg-paper-2" : "hover:bg-paper-2/60"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-rule" />
              )}
              <div className="flex items-center gap-1.5">
                <span className="flex-1 truncate leading-snug text-ink">{c.title}</span>
                {c.mode === "feynman" && (
                  <span className="mono rounded-[2px] bg-feynman/10 px-1 py-px text-[9px] font-medium text-feynman">
                    F
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  aria-label="Delete conversation"
                  className="mono opacity-0 transition-opacity group-hover:opacity-100 hover:text-rule"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Add state + responsive layout to `app/page.tsx`**

In `app/page.tsx`, add two state hooks near the other `useState` calls (after `const [assistantStreamId, ...]`):

```tsx
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
```

Wrap `selectConversation` so it also closes the mobile sidebar. Replace the existing `selectConversation` with:

```tsx
  async function selectConversation(id: string) {
    setActiveId(id);
    setError(null);
    setSidebarOpen(false);
    const res = await fetch(`/api/conversations/${id}`);
    const data = await res.json();
    setConversation(data.conversation);
    setMessages(data.messages ?? []);
  }
```

Replace the layout block — the outer `<div>` and `<Sidebar>` and the header opening — so the sidebar is static on desktop and an overlay on mobile, and the header gets a hamburger. Replace from `<div className="flex h-screen w-screen overflow-hidden">` through the `<header ...>` opening tag with:

```tsx
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden md:flex">
        <Sidebar
          conversations={conversations}
          activeId={activeId}
          onSelect={selectConversation}
          onNew={newConversation}
          onDelete={deleteConversation}
          query={query}
          onQueryChange={setQuery}
        />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-ink/20 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className="fixed left-0 top-0 z-40 h-full md:hidden">
            <Sidebar
              conversations={conversations}
              activeId={activeId}
              onSelect={selectConversation}
              onNew={newConversation}
              onDelete={deleteConversation}
              query={query}
              onQueryChange={setQuery}
            />
          </div>
        </>
      )}

      <main className="flex flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
              className="mono text-ink-3 transition-colors hover:text-ink md:hidden"
            >
              ☰
            </button>
            <span className="truncate text-[15px] italic text-ink-2">
              {conversation?.title ?? "Select or start a conversation"}
            </span>
          </div>
```

(Leave the rest of the header — the `conversation && (...)` block with the model badge and `ModeToggle` — unchanged from Task 7.)

- [ ] **Step 3: Remove the now-duplicated old `<Sidebar>` call**

After Step 2, ensure there is exactly **one** `<Sidebar>` inside the desktop wrapper and one inside the mobile overlay — the bare `<Sidebar>` that Task 7 placed directly under the outer `<div>` must be gone. If Step 2's replacement left the old call in place, delete it.

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. `Sidebar` is now always rendered with `query`/`onQueryChange`, so no missing-prop errors.

- [ ] **Step 5: Smoke (desktop + ~390px mobile viewport)**

Desktop: sidebar static, search filters the list as you type. Mobile (DevTools toggle device toolbar, ~390px): sidebar hidden; hamburger opens the overlay; backdrop click closes it; selecting a conversation closes it; search still works inside the overlay.

- [ ] **Step 6: Commit**

```bash
git add components/Sidebar.tsx app/page.tsx
git commit -m "feat(sidebar): responsive overlay + conversation search"
```

---

## Task 9: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds (catches anything `tsc`/lint missed, e.g. server/client boundary issues).

- [ ] **Step 3: Manual smoke checklist (Ollama running, `npm run dev`)**

Desktop + a ~390px mobile viewport, in each:

1. New conversation → send → reply streams. **Stop** mid-stream → stops; reload → partial persists.
2. **Regenerate** last assistant reply → new reply; reload → old gone, new present.
3. **Edit** a user message mid-thread → tail dropped, fresh reply streams; reload → consistent (edited content, no orphaned tail).
4. **Copy** an assistant message; **copy** a code block.
5. Stop Ollama → send → error bar with **retry**; restart Ollama → **retry** recovers; DB has no duplicate user rows.
6. **Search** filters by title; mobile hamburger opens/closes the sidebar; selecting closes it.
7. Spot-check `data/studygpt.db` after edits/regenerates: no duplicate IDs, no orphaned assistant rows beyond the latest.

For DB spot-check:

```bash
sqlite3 data/studygpt.db "SELECT conversation_id, role, substr(content,1,30) FROM messages ORDER BY created_at;"
```

- [ ] **Step 4: Commit verification note (optional)**

If any fixups were needed during smoke, commit them. Otherwise no commit.

---

## Self-Review (run after writing; results recorded here)

- **Spec coverage:** stop (T4/T7), copy (T5/T6), regenerate (T2/T6/T7), edit (T2/T6/T7), retry (T7), auto-resize (T4), model badge (T7), responsive sidebar (T8), search (T8), id pass-through (T1/T2/T3), stop-persist (T3/T7). All spec sections covered.
- **Placeholder scan:** none — every code step has full code.
- **Type consistency:** `addMessage`/`upsertMessage`/`updateMessageContent`/`deleteMessage`/`deleteMessagesAfter` (T1) match usage in T2/T3. `ChatInput` props `streaming`/`onStop` (T4) match T7. `ChatMessage` props `onCopy`/`onRegenerate`/`onEdit`/`canRegenerate` (T6) match T7. `Sidebar` props `query`/`onQueryChange` (T8) match T7→T8. `runChat` arg names (`action`/`history`/`assistantId`/`baseDisplay`/`userMessageId`/`replaceAssistantId`/`editMessageId`/`editContent`) consistent across T7.