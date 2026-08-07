import { streamText, stepCountIs } from "ai";
import { getProvider, getModelConfig } from "@/lib/llm/provider";
import { systemPromptFor, documentSystemPrompt } from "@/lib/prompts";
import { makeWebSearchTool } from "@/lib/tools/web-search";
import {
  getConversation,
  addMessage,
  upsertMessage,
  updateMessageContent,
  updateMessageAttachments,
  deleteMessage,
  deleteMessagesAfter,
  updateConversationTitle,
  setMessageSources,
  setMessageTokens,
} from "@/lib/db";
import { isVisionModel } from "@/lib/llm/vision";
import { estimateTokens, userTurnText } from "@/lib/tokens";
import type { SourceEntry, Attachment } from "@/lib/db";
import { retrieve } from "@/lib/retrieval";

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
  // When true, this turn produces a one-shot authored document instead of a
  // conversational reply: the system prompt becomes the document-authoring
  // prompt and the persisted assistant message is tagged kind='document'.
  document?: boolean;
  // When true and a Tavily key is configured, a web_search tool is exposed to
  // the model so it can pull in fresh external sources for this turn.
  web?: boolean;
}

// Decide whether this turn warrants deeper reasoning. Authoring a document
// always does; otherwise trigger on explicit study-aid keywords or a long
// user message. Drives reasoningEffort + maxOutputTokens below.
function isComplexTurn(userText: string, document?: boolean): boolean {
  return (
    document ||
    /flashcard|quiz|test me|deck|cheat sheet|draft|outline|summarize/i.test(userText) ||
    userText.length > 400
  );
}

// Unfold a message's attachments into AI SDK message content, choosing how
// each image is delivered based on whether the active chat model can see
// images natively:
// - vision-capable model → images become `image` parts (the provider maps them
// to image_url); file text is inlined into the leading text part.
// - text-only model → each image's OCR'd text is inlined as a text block
// instead of an image part, so a model with no vision can still "see" the
// image's contents. (OCR happens at attach time in the client; the parsed
// text travels on the attachment.)
//
// With no attachments, content stays a plain string (unchanged behavior). With
// attachments under a vision model, content becomes an array of parts. Under a
// non-vision model everything collapses to a plain string (no image parts).
function imageTextBlock(a: Extract<Attachment, { type: "image" }>): string {
  const t = a.text && a.text.length > 0 ? a.text : "(no text detected)";
  return `\n\n[Image: ${a.name}]\n${t}`;
}

function toModelContent(
  content: string,
  attachments: Attachment[] | undefined,
  vision: boolean,
): string | Array<{ type: "text"; text: string } | { type: "image"; image: string }> {
  if (!attachments || attachments.length === 0) return content;
  const files = attachments.filter((a): a is Extract<Attachment, { type: "file" }> => a.type === "file");
  const images = attachments.filter((a): a is Extract<Attachment, { type: "image" }> => a.type === "image");
  const fileBlock = files
    .map((f) => `\n\n[Attached file: ${f.name}]\n${f.text}`)
    .join("");

  if (!vision) {
    const imageBlock = images.map(imageTextBlock).join("");
    return (content || "") + fileBlock + imageBlock;
  }

  const parts: Array<{ type: "text"; text: string } | { type: "image"; image: string }> = [
    { type: "text", text: (content || "") + fileBlock },
    ...images.map((a) => ({ type: "image" as const, image: a.dataUrl })),
  ];
  return parts;
}

// How many of the most recent user turns keep their IMAGE attachments in
// context. Older turns than this drop images too. Bounding this stops a long
// conversation from re-sending every past image (and its base64 data URL) on
// every turn — the main source of context + request-body bloat.
const RECENT_IMAGE_TURNS = 3;

// Bound the attachments sent for a given user message index within `messages`:
// - the latest user turn → full attachments (file text + images) so the model
// can answer the current question;
// - an older turn → drop file text (one-shot context already consumed on the
// turn it was sent) and keep images only if the turn is among the last
// RECENT_IMAGE_TURNS user turns (multi-turn vision), else drop everything.
function attachmentsForTurn(
  msg: { attachments?: Attachment[] },
  i: number,
  lastUserIdx: number | undefined,
  keepImageIdx: Set<number>,
): Attachment[] | undefined {
  const atts = msg.attachments;
  if (!atts || atts.length === 0) return undefined;
  if (i === lastUserIdx) return atts;
  if (!keepImageIdx.has(i)) return undefined;
  const images = atts.filter((a): a is Extract<Attachment, { type: "image" }> => a.type === "image");
  return images.length ? images : undefined;
}

// POST { conversationId, messages, action, ...ids }
// Streams the assistant reply as an SSE stream of `data: <json>` events with
// the parts: {status, reasoning, text, error, done}. Persists per `action`
// before streaming and the assistant reply (upsert under assistantMessageId)
// in onFinish. Honors req.signal so a client stop cancels generation.
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

  const conv = getConversation(conversationId);
  if (!conv) return new Response("Conversation not found", { status: 404 });

  const cfg = getModelConfig();
  try {
    const provider = getProvider(cfg.provider);
    const modelId = conv.model || cfg.model;
    // Whether THIS conversation's model can see images natively. Drives the
    // parsing layer: vision-capable models get image parts; text-only models
    // get the OCR'd text inlined instead (see toModelContent).
    const visionEnabled = isVisionModel(modelId);

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
        addMessage(
          conversationId,
          "user",
          lastUser.content,
          userMessageId,
          lastUser.attachments,
          estimateTokens(userTurnText(lastUser.content, lastUser.attachments)),
        );
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
        // An edit can drop attachments the user removed in the edit UI. Only
        // touch attachments when the client explicitly sent editAttachments
        // (undefined = legacy callers that don't manage attachments).
        const editedAttachments = editAttachments ?? undefined;
        if (editAttachments !== undefined) {
          updateMessageAttachments(editMessageId, editAttachments);
        }
        // Recompute the edited message's token estimate from its new content +
        // surviving attachments (what the model will see on resend).
        setMessageTokens(
          editMessageId,
          estimateTokens(userTurnText(editContent, editedAttachments ?? null)),
        );
        deleteMessagesAfter(conversationId, editMessageId);
      }
    }

    // The latest user message text — used both for retrieval (cleaned query)
    // and for the complexity heuristic that drives reasoning effort + budget.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const lastUserContent = lastUser?.content ?? "";
    const complex = isComplexTurn(lastUserContent, document);

    // --- Retrieval (two-stage RAG) — extracted to lib/retrieval (SP4) ---
    let contextBlock = "";
    let sources: SourceEntry[] = [];
    const retrieved = await retrieve({
      projectId: conv.project_id ?? "",
      lastUser,
      lastUserContent,
      messages,
    });
    if (retrieved) {
      contextBlock = retrieved.contextBlock;
      sources = retrieved.sources;
      if (assistantMessageId) setMessageSources(assistantMessageId, sources);
    }

    // Precompute which user turns still carry attachments when sent to the
    // model: the latest user turn keeps everything; the last RECENT_IMAGE_TURNS
    // user turns keep their images; everything older is stripped to plain
    // text. See attachmentsForTurn / RECENT_IMAGE_TURNS above.
    const userIdx = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
    const lastUserIdx = userIdx[userIdx.length - 1];
    const keepImageIdx = new Set(userIdx.slice(-RECENT_IMAGE_TURNS));

    // Web search is opt-in per turn and requires a configured Tavily key. When
    // enabled, expose a single web_search tool and let the model call it
    // autonomously (up to 5 steps). Otherwise the model has no tools, matching
    // prior behavior.
    const webSearch = web ? makeWebSearchTool(cfg.tavilyApiKey) : null;
    const useWeb = web === true && webSearch !== null;

    // Build the system prompt: prepend the current date so the model knows its
    // training data may be stale (and leans on web_search for current facts),
    // then the mode/document base, then a per-turn web-search availability
    // note, then the retrieval context block.
    const today = new Date().toISOString().slice(0, 10);
    const basePrompt = document ? documentSystemPrompt() : systemPromptFor(conv.mode);
    // When the user enabled web search this turn but no Tavily key is
    // configured, the tool is unavailable — tell the model to say so rather
    // than silently declining, so the user learns to add a key in Settings.
    const webNote =
      web && !useWeb
        ? "\n\nNote: the user enabled web search for this turn, but no search provider key is configured, so the web_search tool is NOT available. If you cannot answer a current or factual question from your own knowledge, say briefly that web search isn't set up yet and they can add a Tavily API key in Settings to enable it. Do not pretend to search."
        : "";
    const system = `Current date: ${today}.\n` + basePrompt + webNote + contextBlock;

    const result = streamText({
      model,
      // A document turn swaps in the authoring prompt; a normal turn uses the
      // conversation's mode prompt. Retrieval contextBlock is appended either
      // way so project-grounded documents still cite their sources.
      system,
      // Complex turns (document, study-aid keywords, or a long prompt) get a
      // larger output budget and deeper reasoning so a requested multi-page
      // document isn't cut off at the provider's default (small) cap.
      maxOutputTokens: complex ? 8192 : 4096,
      providerOptions: { ollama: { reasoningEffort: complex ? "high" : "medium" } },
      messages: messages.map((m, i) =>
        m.role === "user"
          ? {
              role: "user" as const,
              content: toModelContent(m.content, attachmentsForTurn(m, i, lastUserIdx, keepImageIdx), visionEnabled),
            }
          : { role: m.role, content: m.content },
      ),
      ...(useWeb
        ? {
            tools: { web_search: webSearch },
            stopWhen: stepCountIs(5),
            toolChoice: "auto" as const,
          }
        : {}),
      abortSignal: req.signal,
      onFinish: ({ text, usage }) => {
        if (assistantMessageId) {
          const reply = text.replace(/\s+$/, "");
          // Prefer the provider's real completion token count when it reports
          // one; fall back to our estimate. (Ollama doesn't always populate
          // usage, so the estimate keeps the per-message + global counts honest.)
          const completionTokens = usage?.outputTokens;
          const tokens =
            typeof completionTokens === "number" && completionTokens > 0
              ? completionTokens
              : estimateTokens(reply);
          // Trim trailing whitespace so a model-emitted trailing newline
          // doesn't render as a blank line on reload.
          upsertMessage(conversationId, "assistant", reply, assistantMessageId, tokens, document ? "document" : undefined);
        }
      },
    });

    // SSE stream of `data: <single-line-json>\n\n` events. The wire contract
    // (consumed verbatim by the client parser): status / reasoning / text /
    // error / done. A leading status event is emitted before the loop so the
    // UI shows the right phase immediately (reading materials / drafting a
    // document / thinking).
    const encoder = new TextEncoder();
    const streamBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: unknown) =>
          controller.enqueue(encoder.encode("data: " + JSON.stringify(o) + "\n\n"));
        try {
          if (contextBlock) send({ type: "status", phase: "reading-materials" });
          else if (document) send({ type: "status", phase: "drafting-document" });
          else send({ type: "status", phase: "thinking" });

          for await (const part of result.fullStream) {
            switch (part.type) {
              case "start-step":
                send({ type: "status", phase: "thinking" });
                break;
              case "reasoning-start":
                send({ type: "status", phase: "thinking" });
                break;
              case "reasoning-delta":
                send({ type: "reasoning", delta: part.text });
                break;
              case "text-delta":
                send({ type: "text", delta: part.text });
                break;
              case "tool-call":
                send({
                  type: "status",
                  phase: "searching",
                  query: (part as { input?: { query?: string } }).input?.query,
                });
                break;
              case "tool-result":
                send({ type: "status", phase: "thinking" });
                break;
              case "error":
                send({ type: "error", message: String(part.error) });
                break;
              // finish-step / finish / reasoning-end / source are not surfaced
              // on the wire — the client only tracks the phases above.
              default:
                break;
            }
          }
          send({ type: "done" });
          controller.close();
        } catch (err) {
          send({ type: "error", message: err instanceof Error ? err.message : "Streaming failed" });
          controller.close();
        }
      },
    });

    return new Response(streamBody, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Streaming failed";
    return new Response(msg, { status: 502 });
  }
}