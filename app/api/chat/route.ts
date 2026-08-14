import {
  addMessage,
  deleteMessage,
  deleteMessagesAfter,
  getConversation,
  getMessage,
  listMessages,
  setMessageInsights,
  setMessageSources,
  setMessageTokens,
  updateConversationTitle,
  updateMessageAttachments,
  updateMessageContent,
  upsertMessage,
} from "@/lib/db";
import type { Attachment } from "@/lib/db/schema";
import { streamAnswer } from "@/lib/chat/answer-engine";
import { createAnswerInsightCollector } from "@/lib/chat/answer-insights";
import { encodeSseEvent } from "@/lib/chat/sse";
import { estimateTokens, userTurnText } from "@/lib/tokens";

type ChatRole = "user" | "assistant" | "system";
type Action = "send" | "regenerate" | "edit";

interface ChatBody {
  conversationId?: string;
  messages?: { role: ChatRole; content: string; attachments?: Attachment[] }[];
  action?: Action;
  userMessageId?: string;
  assistantMessageId?: string;
  replaceAssistantId?: string;
  editMessageId?: string;
  editContent?: string;
  editAttachments?: Attachment[] | null;
  document?: boolean;
  web?: boolean;
}

// Persistent chat adapter. It validates and applies normal transcript changes,
// reloads canonical history, then delegates all read-only answer generation to
// `streamAnswer`. The overlay route uses the same engine without these writes.
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
    editAttachments,
    document,
    web,
  } = body;
  if (!conversationId || !Array.isArray(messages)) {
    return new Response("Missing conversationId or messages", { status: 400 });
  }

  const conversation = getConversation(conversationId);
  if (!conversation) return new Response("Conversation not found", { status: 404 });

  if (action === "send") {
    const lastUser = [...messages].reverse().find((message) => message.role === "user");
    if (!lastUser) return new Response("Missing user message", { status: 400 });
    addMessage(
      conversationId,
      "user",
      lastUser.content,
      userMessageId,
      lastUser.attachments,
      estimateTokens(userTurnText(lastUser.content, lastUser.attachments)),
    );
    if (conversation.title === "New conversation") {
      updateConversationTitle(conversationId, lastUser.content.slice(0, 50).trim() || "New conversation");
    }
  } else if (action === "regenerate" && replaceAssistantId) {
    const existing = getMessage(replaceAssistantId);
    if (!existing || existing.conversation_id !== conversationId || existing.role !== "assistant") {
      return new Response("Message not found", { status: 404 });
    }
    deleteMessage(replaceAssistantId);
  } else if (action === "edit") {
    if (!editMessageId || editContent === undefined) return new Response("Missing edited message", { status: 400 });
    const existing = getMessage(editMessageId);
    if (!existing || existing.conversation_id !== conversationId || existing.role !== "user") {
      return new Response("Message not found", { status: 404 });
    }
    updateMessageContent(editMessageId, editContent);
    if (editAttachments !== undefined) updateMessageAttachments(editMessageId, editAttachments);
    setMessageTokens(editMessageId, estimateTokens(userTurnText(editContent, editAttachments ?? existing.attachments)));
    deleteMessagesAfter(conversationId, editMessageId);
  }

  const canonicalMessages = listMessages(conversationId);
  const streamBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Parameters<typeof encodeSseEvent>[0]) => controller.enqueue(encodeSseEvent(event));
      const insights = createAnswerInsightCollector();
      let partialText = "";
      try {
        const completion = await streamAnswer(
          { conversation, messages: canonicalMessages, document, web, abortSignal: req.signal },
          (event) => {
            if (event.type === "status") {
              const activity = insights.recordStatus(event.phase, event.label);
              if (event.phase === "searching") insights.markWebUsed();
              if (event.phase === "notation-ready" || event.phase === "recalling-notation") insights.markNotationUsed();
              if (activity) send({ type: "activity", activity });
            }
            if (event.type === "sources") {
              insights.recordSources(event.sources);
              if (assistantMessageId) setMessageSources(assistantMessageId, event.sources);
            }
            if (event.type === "text") partialText += event.delta;
            send(event);
          },
        );
        if (assistantMessageId) {
          const tokens = completion.outputTokens && completion.outputTokens > 0
            ? completion.outputTokens
            : estimateTokens(completion.text);
          upsertMessage(conversationId, "assistant", completion.text, assistantMessageId, tokens, document ? "document" : undefined, "complete");
          const grounding = { ...insights.grounding(), model: conversation.model || null };
          setMessageInsights(assistantMessageId, insights.activities(), grounding);
          send({ type: "grounding", grounding });
        }
        send({ type: "done" });
      } catch (error) {
        if (assistantMessageId && partialText.trim()) {
          upsertMessage(
            conversationId,
            "assistant",
            partialText,
            assistantMessageId,
            estimateTokens(partialText),
            document ? "document" : undefined,
            "interrupted",
          );
        }
        send({ type: "error", message: error instanceof Error ? error.message : "Streaming failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(streamBody, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
