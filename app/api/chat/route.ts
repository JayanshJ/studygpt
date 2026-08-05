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
  listChunkEmbeddingsForProject,
  setMessageSources,
} from "@/lib/db";
import { embedText, decodeEmbedding, cosine } from "@/lib/embed";
import type { SourceEntry } from "@/lib/db";

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

    // --- Retrieval (only for project conversations with ready materials) ---
    // Embed the latest user message, score project chunks by cosine similarity,
    // pick top-6 (max 3 per material), and append the excerpts to the system
    // prompt. Sources are persisted before streaming so they survive a mid-stream
    // stop. Retrieval failure is non-fatal: fall back to an ungrounded answer.
    let contextBlock = "";
    let sources: SourceEntry[] = [];
    if (conv.project_id) {
      const chunks = listChunkEmbeddingsForProject(conv.project_id);
      if (chunks.length > 0) {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (lastUser) {
          try {
            const qVec = await embedText(lastUser.content);
            const q = Float32Array.from(qVec);
            const scored = chunks.map((c) => ({
              c,
              sim: cosine(q, decodeEmbedding(c.embedding)),
            }));
            scored.sort((a, b) => b.sim - a.sim);
            // top-k with a per-material cap of 3
            const k = 6;
            const perMaterial = 3;
            const picked: typeof scored = [];
            const counts: Record<string, number> = {};
            for (const s of scored) {
              if (picked.length >= k) break;
              const cnt = counts[s.c.materialId] ?? 0;
              if (cnt >= perMaterial) continue;
              picked.push(s);
              counts[s.c.materialId] = cnt + 1;
            }
            sources = picked.map((s) => ({
              materialId: s.c.materialId,
              title: s.c.materialTitle,
              snippet: s.c.text.slice(0, 240),
              ordinal: s.c.ordinal,
            }));
            const excerpts = picked
              .map((s) => `[${s.c.materialTitle}]\n${s.c.text}`)
              .join("\n\n---\n\n");
            contextBlock =
              `\n\nThe following are excerpts from the project's reference materials. ` +
              `Use them to ground your answer, and prefer them over your own knowledge when they conflict. ` +
              `Cite a source by its title in square brackets when you rely on it.\n\n${excerpts}`;
            if (assistantMessageId) setMessageSources(assistantMessageId, sources);
          } catch {
            // Retrieval failure is non-fatal — fall back to an ungrounded answer.
          }
        }
      }
    }

    const result = streamText({
      model,
      system: systemPromptFor(conv.mode) + contextBlock,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      abortSignal: req.signal,
      onFinish: ({ text }) => {
        if (assistantMessageId) {
          // Trim trailing whitespace so a model-emitted trailing newline
          // doesn't render as a blank line on reload.
          upsertMessage(conversationId, "assistant", text.replace(/\s+$/, ""), assistantMessageId);
        }
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Streaming failed";
    return new Response(msg, { status: 502 });
  }
}