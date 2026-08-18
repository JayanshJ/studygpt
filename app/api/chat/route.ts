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
import { streamAnswer } from "@/lib/chat/answer-engine";
import { createAnswerInsightCollector } from "@/lib/chat/answer-insights";
import { encodeSseEvent } from "@/lib/chat/sse";
import { estimateTokens, userTurnText } from "@/lib/tokens";
import { z, validateBody } from "@/lib/server/validation";
import { generateRequestId, logger, withRequestId } from "@/lib/server/logger";

// Body for a chat turn. Historically parsed with `req.json()` (untyped `any`)
// and gated with ad-hoc truthiness/`Array.isArray` checks, so the schema only
// enforces the top-level field TYPES the handler reads directly — never the
// nested element shape, which the route consumed opaquely. `messages` is
// `z.array(z.any())` (the route only checked `Array.isArray`), `editContent`
// is `z.any()` (only `=== undefined` is tested), and `editAttachments` is
// `z.any()` (passed straight through to the DB). Tightening any of these would
// reject inputs the route historically accepted.
const ChatBody = z.object({
  conversationId: z.string().optional(),
  messages: z.array(z.any()).optional(),
  action: z.enum(["send", "regenerate", "edit"]).optional(),
  userMessageId: z.string().optional(),
  assistantMessageId: z.string().optional(),
  replaceAssistantId: z.string().optional(),
  editMessageId: z.string().optional(),
  editContent: z.any().optional(),
  editAttachments: z.any().nullable().optional(),
  document: z.boolean().optional(),
  web: z.boolean().optional(),
});

// NOTE: this handler returns a ReadableStream (SSE) with its own internal
// `send({ type: "error" })` error boundary. The stream is the response — it
// cannot be returned from inside `withRouteHandler`'s try/catch without the
// wrapper trying to double-handle errors. So we validate the body with zod
// (structured 400) but do NOT wrap the whole handler in withRouteHandler. We
// still bind a requestId via withRequestId so server-side logging of stream
// failures carries the same id; the client only sees a generic
// "Streaming failed" message (the real error is logged server-side).
export async function POST(req: Request) {
  const bodyResult = await validateBody(req, ChatBody);
  if (!bodyResult.ok) return bodyResult.response;
  const body = bodyResult.value;

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
  const requestId = generateRequestId();
  const streamBody = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Parameters<typeof encodeSseEvent>[0]) => controller.enqueue(encodeSseEvent(event));
      const insights = createAnswerInsightCollector();
      let partialText = "";
      await withRequestId(requestId, async () => {
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
          // Log the real error server-side (bound to requestId); send a generic
          // message to the client so internals (e.g. usage-limit text) never leak.
          logger.error("chat stream failed", {
            requestId,
            error: error instanceof Error ? error.message : String(error),
          });
          send({ type: "error", message: "Streaming failed" });
        } finally {
          controller.close();
        }
      });
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