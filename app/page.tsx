"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { ModeToggle } from "@/components/ModeToggle";
import type { Conversation, ConversationMode, Message } from "@/lib/db/schema";

export default function Page() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistantStreamId, setAssistantStreamId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadConversations = useCallback(async () => {
    const res = await fetch("/api/conversations");
    if (res.ok) setConversations(await res.json());
  }, []);

  useEffect(() => {
    // Initial fetch of conversation list on mount.
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
    setConversations((prev) =>
      prev.map((c) => (c.id === updated.id ? updated : c)),
    );
  }

  async function sendMessage(text: string) {
    setError(null);
    if (!conversation) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      conversation_id: conversation.id,
      role: "user",
      content: text,
      created_at: Date.now(),
    };
    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      conversation_id: conversation.id,
      role: "assistant",
      content: "",
      created_at: Date.now(),
    };

    // Optimistic: show the user message + an empty assistant bubble immediately.
    const outgoing = [...messages, userMsg];
    setMessages([...outgoing, assistantMsg]);
    setAssistantStreamId(assistantId);
    setStreaming(true);

    // Optimistically title the conversation on the first turn (server does too).
    if (conversation.title === "New conversation") {
      const newTitle = text.slice(0, 50).trim() || "New conversation";
      const titled = { ...conversation, title: newTitle };
      setConversation(titled);
      setConversations((prev) =>
        prev.map((c) => (c.id === titled.id ? titled : c)),
      );
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          messages: outgoing.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error("No response stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      // Drop the empty assistant bubble if nothing was streamed.
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setStreaming(false);
      setAssistantStreamId(null);
    }
  }

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
        <header className="flex items-center justify-between border-b border-line px-5 py-2.5">
          <span className="truncate pr-3 text-[15px] italic text-ink-2">
            {conversation?.title ?? "Select or start a conversation"}
          </span>
          {conversation && (
            <ModeToggle mode={conversation.mode} onChange={changeMode} />
          )}
        </header>

        <div ref={scrollRef} className="graph-paper flex-1 overflow-y-auto px-4 py-8">
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {!conversation && (
              <div className="mx-auto mt-24 max-w-md text-center">
                <p className="mono mb-3 text-[11px] tracking-[0.2em] text-rule">
                  NOTEBOOK
                </p>
                <h1 className="text-[1.6rem] leading-tight text-ink">
                  Start a conversation to study a concept.
                </h1>
                <p className="mt-3 text-[15px] text-ink-2">
                  Ask about the derivative, eigenvalues, or entropy — then flip on{" "}
                  <span className="text-feynman">Feynman</span> to learn by
                  explaining it back.
                </p>
              </div>
            )}
            {messages.map((m) => (
              <ChatMessage
                key={m.id}
                role={m.role}
                content={m.content}
                streaming={streaming && m.id === assistantStreamId}
              />
            ))}
          </div>
        </div>

        {error && (
          <div className="mx-auto w-full max-w-3xl px-4">
            <p className="mono rounded-[3px] border border-rule/40 bg-rule/5 px-3 py-2 text-[12px] text-rule">
              {error}
            </p>
          </div>
        )}

        <ChatInput
          onSend={sendMessage}
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