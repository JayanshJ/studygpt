import { streamText } from "ai";
import { getProvider, getModelConfig } from "@/lib/llm/provider";
import { systemPromptFor } from "@/lib/prompts";
import {
  getConversation,
  addMessage,
  updateConversationTitle,
} from "@/lib/db";

type ChatRole = "user" | "assistant" | "system";

// POST { conversationId, messages: {role, content}[] }
// Streams the assistant reply as plain text. Persists the latest user
// message synchronously and the assistant reply in onFinish.
export async function POST(req: Request) {
  let body: { conversationId?: string; messages?: { role: ChatRole; content: string }[] };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const { conversationId, messages } = body;
  if (!conversationId || !Array.isArray(messages)) {
    return new Response("Missing conversationId or messages", { status: 400 });
  }

  const conv = getConversation(conversationId);
  if (!conv) return new Response("Conversation not found", { status: 404 });

  const cfg = getModelConfig();
  try {
    const provider = getProvider(cfg.provider);
    const modelId = conv.model || cfg.model;

    // Preflight: fail fast with a clean message if Ollama is down or the
    // model isn't pulled — before we start streaming (which would otherwise
    // surface as an empty bubble with no error).
    if (provider.validate) {
      await provider.validate({ model: modelId, baseURL: cfg.baseURL, apiKey: cfg.apiKey });
    }

    const model = provider.languageModel({
      model: modelId,
      baseURL: cfg.baseURL,
      apiKey: cfg.apiKey,
    });

    // Persist the newest user turn (the trailing user message in the array).
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
      addMessage(conversationId, "user", lastUser.content);
      if (conv.title === "New conversation") {
        updateConversationTitle(
          conversationId,
          lastUser.content.slice(0, 50).trim() || "New conversation",
        );
      }
    }

    const result = streamText({
      model,
      system: systemPromptFor(conv.mode),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      onFinish: ({ text }) => {
        addMessage(conversationId, "assistant", text);
      },
    });

    return result.toTextStreamResponse();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Streaming failed";
    return new Response(msg, { status: 502 });
  }
}