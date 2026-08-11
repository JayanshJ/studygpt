"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { MessageSquare, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw } from "lucide-react";
import { ConversationListPane } from "@/components/shell/ConversationListPane";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { ModeToggle } from "@/components/ModeToggle";
import { IconButton } from "@/components/ui/IconButton";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/Dialog";
import { useMotion, fadeUp } from "@/lib/motion";
import type {
  Attachment,
  Conversation,
  ConversationMode,
  Material,
  Message,
  Project,
  SourceEntry,
} from "@/lib/db/schema";

type MessageWithSources = Message & {
  sources?: SourceEntry[];
  // Transient (in-memory only): not persisted to the DB. `upsertMessage`/
  // DB only stores `content`. Surfaced live while streaming and dropped on
  // reload.
  reasoning?: string;
  status?: string;
};

type ChatAction = "send" | "regenerate" | "edit";

// Starter prompts for the empty states. The welcome hero and a brand-new
// conversation both surface these as one-click chips; the in-conversation
// set is mode-aware so Feynman mode offers "teach me" prompts instead.
const CHAT_SUGGESTIONS = [
  "Explain the derivative",
  "What are eigenvalues?",
  "Derive the quadratic formula",
  "Compare mitosis vs meiosis",
];
const FEYNMAN_SUGGESTIONS = [
  "Teach me logarithms",
  "Explain photosynthesis back to me",
  "How do transformers work?",
  "What is recursion?",
];

// Reflect the active conversation in the URL as `?c=<id>` so a hard reload
// restores it. Uses replaceState (not the Next router) to avoid re-renders /
// navigation churn — the param is purely a persistence marker, not a route.
function syncUrl(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("c", id);
  else url.searchParams.delete("c");
  window.history.replaceState(null, "", url);
}

export default function Page() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageWithSources[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantStreamId, setAssistantStreamId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [convSheetOpen, setConvSheetOpen] = useState(false);
  // Desktop conversation pane collapse. Persisted to localStorage so a reload
  // honours the user's choice; defaults to expanded (SSR-safe — read in an
  // effect to avoid a hydration mismatch). Mobile uses the slide-in sheet, not
  // this collapse, so it only affects the tab+ pane.
  const [paneCollapsed, setPaneCollapsed] = useState(false);
  const togglePane = useCallback(() => {
    setPaneCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("studygpt.pane.collapsed", next ? "1" : "0");
      } catch {
        /* ignore storage failures (private mode, etc.) */
      }
      return next;
    });
  }, []);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectMaterialCount, setActiveProjectMaterialCount] = useState<number | null>(null);
  // Full material list for the active project — threaded to <ChatMessage> so
  // the SourcesPanel can show ALL of the project's materials (not just the
  // ones cited in this turn) and mark which were used. Cleared on project change.
  const [activeProjectMaterials, setActiveProjectMaterials] = useState<{ id: string; title: string }[]>([]);
  const [models, setModels] = useState<Array<{ id: string; vision: boolean }>>([]);
  // True until the first conversations fetch resolves — drives the sidebar's
  // skeleton rows so the first paint doesn't look like an empty account.
  const [convLoading, setConvLoading] = useState(true);
  // A prompt handed to the composer from the welcome screen's suggestion
  // chips (create-then-prefill). Cleared once the conversation exists.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<Parameters<typeof runChat>[0] | null>(null);
  // Remembers the last user-chosen `web` toggle setting. Regenerate/edit
  // don't go through the composer, so they reuse this value to preserve the
  // turn's web-search preference instead of reverting to the default.
  const lastWebRef = useRef<boolean>(true);
  const m = useMotion();

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      if (res.ok) setConversations(await res.json());
    } finally {
      setConvLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  }, []);

  const loadModels = useCallback(async () => {
    const res = await fetch("/api/models");
    if (res.ok) setModels((await res.json()).models ?? []);
  }, []);

  // Whether voice typing should record+transcribe via the OpenAI Whisper proxy
  // (server-side key) instead of the browser's built-in Web Speech API (which
  // needs Google's service and is often blocked by Arc shields / blockers).
  const [transcriptionAvailable, setTranscriptionAvailable] = useState(false);
  useEffect(() => {
    fetch("/api/transcribe")
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d: { available?: boolean }) => setTranscriptionAvailable(!!d.available))
      .catch(() => setTranscriptionAvailable(false));
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Restore the active conversation from `?c=<id>` after the conversation list
  // loads, so a hard reload lands back in the same chat instead of the empty
  // screen. Runs once (restoredRef) and yields to an already-active selection.
  const restoredRef = useRef(false);
  const initialConvId = useMemo(
    () => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("c")),
    [],
  );
  useEffect(() => {
    if (restoredRef.current || !initialConvId || !conversations.length || activeId) return;
    restoredRef.current = true;
    if (conversations.some((c) => c.id === initialConvId)) {
      void selectConversation(initialConvId);
    } else {
      // Stale id (deleted in another tab) — clean the URL and stay on the
      // empty screen.
      syncUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConvId, conversations, activeId]);

  // Handoff from /graph "ask in chat": ?projectId=<pid>&q=<prompt>. Create a
  // project-scoped conversation and prefill the composer so the user reviews +
  // sends. Runs once on mount; the graph link never also sets ?c, so it does
  // not conflict with the ?c restore. Strips q/projectId from the URL after so
  // a reload doesn't re-create the conversation. (ChatInput seeds initialText
  // exactly once via its seededRef, so clearing pendingPrompt later is a no-op
  // — the textarea keeps the prompt.)
  const handoffRef = useRef(false);
  useEffect(() => {
    if (handoffRef.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (!q) return; // no handoff → let the ?c restore path handle mount
    handoffRef.current = true;
    const pid = params.get("projectId");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pid) setActiveProjectId(pid);
    setPendingPrompt(q);
    void (async () => {
      try {
        const res = await fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId: pid ?? null }),
        });
        if (!res.ok) return;
        const conv: Conversation = await res.json();
        setConversations((prev) => [conv, ...prev]);
        setActiveId(conv.id);
        setConversation(conv);
        setMessages([]);
        const url = new URL(window.location.href);
        url.searchParams.set("c", conv.id);
        url.searchParams.delete("q");
        url.searchParams.delete("projectId");
        window.history.replaceState(null, "", url);
      } catch {
        /* ignore — user can start a conversation manually */
      } finally {
        setPendingPrompt(null);
      }
    })();
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadModels();
  }, [loadModels]);

  // Restore the pane collapse preference on mount (SSR-safe).
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPaneCollapsed(localStorage.getItem("studygpt.pane.collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

  // When a project conversation is active, fetch its material count for the
  // header chip. Reset to null for standalone conversations.
  useEffect(() => {
    const pid = conversation?.project_id ?? null;
    if (!pid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveProjectMaterialCount(null);
      setActiveProjectMaterials([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${pid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { project: Project; materials: Material[] } | null) => {
        if (!cancelled && d) {
          setActiveProjectMaterialCount(d.materials.length);
          setActiveProjectMaterials(d.materials.map((m) => ({ id: m.id, title: m.title })));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation?.project_id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, assistantStreamId]);

  async function selectConversation(id: string) {
    if (streaming) abortRef.current?.abort();
    setActiveId(id);
    syncUrl(id);
    setError(null);
    setConvSheetOpen(false);
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
      body: JSON.stringify({ projectId: activeProjectId }),
    });
    const conv: Conversation = await res.json();
    setConversations((prev) => [conv, ...prev]);
    setActiveId(conv.id);
    syncUrl(conv.id);
    setConversation(conv);
    setMessages([]);
  }

  // A welcome-screen suggestion chip: create a conversation and seed the
  // composer with the prompt so the user lands on a ready-to-send first turn
  // (gentle — they review and press Enter). We hand the prompt to ChatInput
  // via `pendingPrompt`/`initialText`, then clear it once the conversation
  // exists so a later re-render doesn't re-seed.
  async function welcomeChip(text: string) {
    setPendingPrompt(text);
    await newConversation();
    setPendingPrompt(null);
  }

  async function deleteConversation(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setConversation(null);
      setMessages([]);
      syncUrl(null);
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

  // Core streaming runner. `baseDisplay` is the message list to show *before*
  // the new assistant bubble (already includes any new/edited user message).
  // runChat appends the (empty) assistant bubble, streams into it, and
  // persists per `action`.
  async function runChat(args: {
    action: ChatAction;
    history: MessageWithSources[];
    assistantId: string;
    baseDisplay: MessageWithSources[];
    userMessageId?: string;
    replaceAssistantId?: string;
    editMessageId?: string;
    editContent?: string;
    editAttachments?: Attachment[];
    // true for a one-shot document turn → optimistic assistant bubble is
    // tagged kind='document' and the server uses the document-authoring prompt.
    document?: boolean;
    // Web-search toggle from the composer. Regenerate/edit reuse the last
    // user-chosen value via lastWebRef so those turns preserve the setting.
    web?: boolean;
  }) {
    const conv = conversation;
    if (!conv) return;
    lastRunRef.current = args;
    setError(null);
    const assistantMsg: MessageWithSources = {
      id: args.assistantId,
      conversation_id: conv.id,
      role: "assistant",
      content: "",
      kind: args.document ? "document" : "chat",
      attachments: null,
      tokens: null,
      created_at: Date.now(),
      status: "thinking",
    };
    setMessages([...args.baseDisplay, assistantMsg]);
    setAssistantStreamId(args.assistantId);
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";
    // Patch the in-flight assistant message by id, merging the given fields
    // into the matching entry in setMessages. Used by the SSE handlers below.
    const patch = (fields: Partial<Pick<MessageWithSources, "content" | "reasoning" | "status">>) =>
      setMessages((prev) =>
        prev.map((m) => (m.id === args.assistantId ? { ...m, ...fields } : m)),
      );
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conv.id,
          messages: args.history.map((m) => ({ role: m.role, content: m.content, attachments: m.attachments ?? undefined })),
          action: args.action,
          userMessageId: args.userMessageId,
          assistantMessageId: args.assistantId,
          replaceAssistantId: args.replaceAssistantId,
          editMessageId: args.editMessageId,
          editContent: args.editContent,
          editAttachments: args.editAttachments,
          document: args.document,
          web: args.web,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream");

      // SSE stream: each event is a line `data: <single-line-json>\n\n`.
      // Dispatch on evt.type: text/reasoning accumulate, status sets phase,
      // error surfaces, done falls through to finish handling.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reasoningAcc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.startsWith("data: ")) continue;
          type SseEvent =
            | { type: "text"; delta: string }
            | { type: "reasoning"; delta: string }
            | { type: "status"; phase: string; query?: string }
            | { type: "error"; message: string }
            | { type: "done" };
          let evt: SseEvent;
          try { evt = JSON.parse(raw.slice(6)); } catch { continue; }
          if (evt.type === "text") {
            acc += evt.delta;
            patch({ content: acc, status: acc ? "writing" : "thinking" });
          } else if (evt.type === "reasoning") {
            reasoningAcc += evt.delta;
            patch({ reasoning: reasoningAcc });
          } else if (evt.type === "status") {
            patch({ status: evt.phase });
          } else if (evt.type === "error") {
            setError(evt.message);
          }
          // "done" → fall through to finish handling
        }
      }
    } catch (err) {
      if (controller.signal.aborted) {
        if (acc) {
          // Stopped mid-stream — keep the partial and persist it (idempotent:
          // if onFinish already wrote the full reply, this is a no-op). Pass
          // the optimistic bubble's kind so a stopped document stays a document.
          fetch("/api/messages", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              conversationId: conv.id,
              messageId: args.assistantId,
              role: "assistant",
              content: acc,
              kind: args.document ? "document" : "chat",
            }),
          }).catch(() => {});
        } else {
          // Stopped before any token — drop the empty bubble.
          setMessages((prev) => prev.filter((m) => m.id !== args.assistantId));
        }
      } else {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== args.assistantId));
      }
    } finally {
      // Sources fetch lives in `finally` so the Sources panel populates on
      // both normal completion AND a mid-stream abort. The server writes the
      // message_sources row before streaming starts, so it already exists.
      // Fire-and-forget: the .then merge is a no-op if the assistant message
      // was dropped (e.g. stop-before-any-token in the catch branch above).
      fetch(`/api/messages/${args.assistantId}`)
        .then((r) => r.json())
        .then((d: { sources?: SourceEntry[] }) => {
          if (d.sources?.length) {
            setMessages((prev) =>
              prev.map((m) => (m.id === args.assistantId ? { ...m, sources: d.sources } : m)),
            );
          }
        })
        .catch(() => {});
      setStreaming(false);
      setAssistantStreamId(null);
      abortRef.current = null;
      // Clear the transient status/reasoning-in-progress flag now that the
      // turn is finished (or stopped with a partial). The status line above
      // the bubble only shows while a phase is active.
      setMessages((prev) =>
        prev.map((m) => (m.id === args.assistantId ? { ...m, status: undefined } : m)),
      );
    }
  }

  async function sendMessage(text: string, attachments: Attachment[], document = false, web = true) {
    if (!conversation || streaming) return;
    lastWebRef.current = web;
    const userMsg: MessageWithSources = {
      id: crypto.randomUUID(),
      conversation_id: conversation.id,
      role: "user",
      content: text,
      kind: "chat",
      attachments: attachments.length ? attachments : null,
      tokens: null,
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
      document,
      web,
    });
  }

  function stop() {
    abortRef.current?.abort();
  }

  async function retry() {
    if (!conversation || streaming) return;
    const last = lastRunRef.current;
    if (!last) return;
    await runChat(last);
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
      // Regenerating a document stays a document (keeps the document prompt +
      // document card); regenerating a chat reply stays chat.
      document: lastAssistant.kind === "document",
      web: lastWebRef.current,
    });
  }

  async function editMessage(messageId: string, newContent: string, attachments: Attachment[]) {
    if (!conversation || streaming) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const nextAttachments = attachments.length > 0 ? attachments : null;
    const edited: MessageWithSources = { ...messages[idx], content: newContent, attachments: nextAttachments };
    const history = [...messages.slice(0, idx), edited]; // drop everything after
    await runChat({
      action: "edit",
      history,
      baseDisplay: history,
      assistantId: crypto.randomUUID(),
      editMessageId: messageId,
      editContent: newContent,
      editAttachments: attachments,
      web: lastWebRef.current,
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
    <div className="flex h-full min-w-0">
      {/* Desktop conversation pane — collapsible (hidden below `tab`; mobile
          uses the slide-in sheet). Collapsed renders a slim rail with an
          expand button where the pane used to be. */}
      <div className="hidden tab:flex">
        {paneCollapsed ? (
          <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-surface-2 py-3">
            <IconButton label="Show conversations" onClick={togglePane}>
              <PanelLeftOpen size={17} strokeWidth={1.75} />
            </IconButton>
          </div>
        ) : (
          <ConversationListPane
            conversations={conversations}
            activeId={activeId}
            onSelect={selectConversation}
            onNew={newConversation}
            onDelete={deleteConversation}
            query={query}
            onQueryChange={setQuery}
            projects={projects}
            activeProjectId={activeProjectId}
            onProjectChange={setActiveProjectId}
            loading={convLoading}
          />
        )}
      </div>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 tab:px-5">
          <div className="flex min-w-0 items-center gap-3">
            {/* Mobile: conversation list slides in from the left (desktop pane
                is always visible at tab+). */}
            <Dialog open={convSheetOpen} onOpenChange={setConvSheetOpen}>
              <DialogTrigger asChild>
                <IconButton label="Conversations" className="tab:hidden">
                  <MessageSquare size={17} strokeWidth={1.75} />
                </IconButton>
              </DialogTrigger>
              <DialogContent side="left" showClose={false} className="p-0">
                <ConversationListPane
                  conversations={conversations}
                  activeId={activeId}
                  onSelect={selectConversation}
                  onNew={newConversation}
                  onDelete={deleteConversation}
                  query={query}
                  onQueryChange={setQuery}
                  projects={projects}
                  activeProjectId={activeProjectId}
                  onProjectChange={setActiveProjectId}
                  loading={convLoading}
                />
              </DialogContent>
            </Dialog>
            {/* Desktop: collapse the conversation pane (shown only while
                expanded — the collapsed rail carries the expand button). */}
            <IconButton
              label="Hide conversations"
              onClick={togglePane}
              className={paneCollapsed ? "hidden" : "hidden tab:inline-flex"}
            >
              <PanelLeftClose size={17} strokeWidth={1.75} />
            </IconButton>
            <span className="truncate text-[15px] italic text-ink-2">
              {conversation?.title ?? "Select or start a conversation"}
            </span>
          </div>
          {conversation && (
            <div className="flex shrink-0 items-center gap-3">
              {conversation.project_id && (() => {
                const p = projects.find((x) => x.id === conversation.project_id);
                if (!p) return null;
                return (
                  <a
                    href="/projects"
                    className="mono hidden items-center gap-1 rounded-[3px] border border-border bg-surface px-2 py-0.5 text-[10px] tracking-wide text-feynman transition-colors hover:text-content sm:inline-flex"
                  >
                    {p.name}
                    {activeProjectMaterialCount !== null && (
                      <span className="text-content-faint">
                        · {activeProjectMaterialCount} material{activeProjectMaterialCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </a>
                );
              })()}
              <select
                value={conversation.model}
                onChange={(e) => changeModel(e.target.value)}
                aria-label="Model"
                className="mono max-w-[180px] truncate rounded-[3px] border border-border bg-surface px-2 py-0.5 text-[10px] tracking-wide text-content-faint outline-none transition-colors hover:border-border-strong focus:border-border-strong"
              >
                {/* Ensure the current model is always selectable even if the
                    backend list is empty / doesn't include it. */}
                {!models.some((mdl) => mdl.id === conversation.model) && (
                  <option value={conversation.model}>{conversation.model}</option>
                )}
                {models.map((mdl) => (
                  <option key={mdl.id} value={mdl.id}>
                    {mdl.id}
                    {mdl.vision ? "  ◉ vision" : ""}
                  </option>
                ))}
              </select>
              <ModeToggle mode={conversation.mode} onChange={changeMode} />
            </div>
          )}
        </header>

        <div
          ref={scrollRef}
          className="graph-paper flex-1 overflow-y-auto px-4 py-8 pb-[calc(4.5rem+env(safe-area-inset-bottom))] tab:pb-8"
        >
          {!conversation ? (
            <div className="flex min-h-full items-center justify-center">
              <motion.div {...m} variants={fadeUp} className="w-full max-w-[560px]">
                <Card accent className="px-8 py-10 sm:px-10">
                  <p className="eyebrow">Study Notebook</p>
                  <h1 className="hero-title mt-4">
                    Study anything,
                    <br />
                    one concept at a time.
                  </h1>
                  <p className="hero-lede mt-4">
                    Ask about the derivative, eigenvalues, or entropy — then flip on{" "}
                    <span className="text-feynman">Feynman</span> to learn by explaining it
                    back.
                  </p>
                  <div className="mt-7">
                    <Button variant="primary" onClick={() => newConversation()}>
                      <Plus size={15} strokeWidth={2} />
                      start a conversation
                    </Button>
                  </div>
                  <div className="mt-6 flex flex-wrap gap-2">
                    {CHAT_SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => welcomeChip(s)}
                        className="mono rounded-[3px] border border-border bg-surface px-2.5 py-1 text-[12px] text-content-muted transition-[border-color,background-color] duration-fast ease-out hover:border-border-strong hover:bg-surface-2 hover:text-content"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </Card>
              </motion.div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-5">
              {messages.length === 0 && !streaming && (
                <motion.div {...m} variants={fadeUp} className="mx-auto mt-20 w-full max-w-[520px] text-center">
                  <p className="eyebrow">Ask</p>
                  <h2 className="mt-4 text-[1.4rem] leading-tight text-ink">
                    Ask your first question.
                  </h2>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    {(conversation.mode === "feynman" ? FEYNMAN_SUGGESTIONS : CHAT_SUGGESTIONS).map(
                      (s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => sendMessage(s, [])}
                          className="mono rounded-[3px] border border-border bg-surface px-2.5 py-1 text-[12px] text-content-muted transition-[border-color,background-color] duration-fast ease-out hover:border-border-strong hover:bg-surface-2 hover:text-content"
                        >
                          {s}
                        </button>
                      ),
                    )}
                  </div>
                </motion.div>
              )}
              {messages.map((m) => (
                <ChatMessage
                  key={m.id}
                  id={m.id}
                  role={m.role}
                  content={m.content}
                  attachments={m.attachments}
                  kind={m.kind}
                  streaming={streaming && m.id === assistantStreamId}
                  sources={m.sources}
                  status={m.status}
                  reasoning={m.reasoning}
                  allMaterials={activeProjectMaterials}
                  canRegenerate={m.id === lastAssistantId}
                  onRegenerate={regenerate}
                  onEdit={(content, attachments) => editMessage(m.id, content, attachments)}
                  conversationTitle={conversation?.title}
                  conversationId={conversation?.id}
                />
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="mx-auto w-full max-w-3xl px-4">
            <div className="mono flex items-center gap-3 rounded-[3px] border border-rule/40 bg-rule/5 px-3 py-2 text-[12px] text-rule">
              <span className="flex-1">{error}</span>
              <Button variant="ghost" size="sm" onClick={retry} className="text-rule hover:text-rule">
                <RefreshCw size={13} />
                retry
              </Button>
            </div>
          </div>
        )}

        <div className="pb-[calc(0.5rem+env(safe-area-inset-bottom))] tab:pb-0">
          <ChatInput
            onSend={sendMessage}
            onStop={stop}
            streaming={streaming}
            disabled={streaming || !conversation}
            projectId={conversation?.project_id ?? null}
            transcriptionAvailable={transcriptionAvailable}
            initialText={pendingPrompt ?? undefined}
            placeholder={
              conversation
                ? conversation.mode === "feynman"
                  ? "Tell the tutor what concept you want to learn…"
                  : "Ask about a concept… (Enter to send)"
                : "Start a conversation first"
            }
          />
        </div>
      </main>
    </div>
  );
}