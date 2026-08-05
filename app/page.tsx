"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { ModeToggle } from "@/components/ModeToggle";
import type {
  Conversation,
  ConversationMode,
  Material,
  Message,
  Project,
  SourceEntry,
} from "@/lib/db/schema";

type MessageWithSources = Message & { sources?: SourceEntry[] };

type ChatAction = "send" | "regenerate" | "edit";

export default function Page() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<MessageWithSources[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantStreamId, setAssistantStreamId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeProjectMaterialCount, setActiveProjectMaterialCount] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastRunRef = useRef<Parameters<typeof runChat>[0] | null>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }, []);

  const loadProjects = useCallback(async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProjects();
  }, [loadProjects]);

  // When a project conversation is active, fetch its material count for the
  // header chip. Reset to null for standalone conversations.
  useEffect(() => {
    const pid = conversation?.project_id ?? null;
    if (!pid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveProjectMaterialCount(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/projects/${pid}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { project: Project; materials: Material[] } | null) => {
        if (!cancelled && d) setActiveProjectMaterialCount(d.materials.length);
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
    setError(null);
    setSidebarOpen(false);
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
    history: MessageWithSources[];
    assistantId: string;
    baseDisplay: MessageWithSources[];
    userMessageId?: string;
    replaceAssistantId?: string;
    editMessageId?: string;
    editContent?: string;
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

      // Fetch sources written by the server before streaming (RAG).
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
    } catch (err) {
      if (controller.signal.aborted) {
        if (acc) {
          // Stopped mid-stream — keep the partial and persist it (idempotent:
          // if onFinish already wrote the full reply, this is a no-op).
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
      setStreaming(false);
      setAssistantStreamId(null);
      abortRef.current = null;
    }
  }

  async function sendMessage(text: string) {
    if (!conversation || streaming) return;
    const userMsg: MessageWithSources = {
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
    });
  }

  async function editMessage(messageId: string, newContent: string) {
    if (!conversation || streaming) return;
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const edited: MessageWithSources = { ...messages[idx], content: newContent };
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
          projects={projects}
          activeProjectId={activeProjectId}
          onProjectChange={setActiveProjectId}
        />
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 z-30 bg-black/40 md:hidden"
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
              projects={projects}
              activeProjectId={activeProjectId}
              onProjectChange={setActiveProjectId}
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
          {conversation && (
            <div className="flex shrink-0 items-center gap-3">
              {conversation.project_id && (() => {
                const p = projects.find((x) => x.id === conversation.project_id);
                if (!p) return null;
                return (
                  <a
                    href="/projects"
                    className="mono hidden items-center gap-1 rounded-[2px] border border-line bg-paper-2 px-2 py-0.5 text-[10px] tracking-wide text-feynman transition-colors hover:text-ink sm:inline-flex"
                  >
                    {p.name}
                    {activeProjectMaterialCount !== null && (
                      <span className="text-ink-3">
                        · {activeProjectMaterialCount} material{activeProjectMaterialCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </a>
                );
              })()}
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
                sources={m.sources}
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