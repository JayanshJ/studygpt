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