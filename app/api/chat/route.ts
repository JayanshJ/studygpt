import { streamText } from "ai";
import { getProvider, getModelConfig } from "@/lib/llm/provider";
import { systemPromptFor } from "@/lib/prompts";
import {
  getConversation,
  addMessage,
  upsertMessage,
  updateMessageContent,
  updateMessageAttachments,
  deleteMessage,
  deleteMessagesAfter,
  updateConversationTitle,
  listChunkEmbeddingsForProject,
  setMessageSources,
} from "@/lib/db";
import { embedText, decodeEmbedding, cosine } from "@/lib/embed";
import type { SourceEntry, Attachment } from "@/lib/db";

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
}

// Unfold a message's attachments into AI SDK message content. With no
// attachments, content stays a plain string (unchanged behavior). With
// attachments, content becomes an array of parts: one text part carrying the
// typed text plus inlined file-text blocks, followed by one image part per
// image attachment. File text is inlined (not a separate part type) so any
// model can read it; images become image parts the provider maps to image_url.
function toModelContent(content: string, attachments?: Attachment[]) {
  if (!attachments || attachments.length === 0) return content;
  const files = attachments.filter((a): a is Extract<Attachment, { type: "file" }> => a.type === "file");
  const images = attachments.filter((a): a is Extract<Attachment, { type: "image" }> => a.type === "image");
  const fileBlock = files
    .map((f) => `\n\n[Attached file: ${f.name}]\n${f.text}`)
    .join("");
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
//   can answer the current question;
// - an older turn → drop file text (one-shot context already consumed on the
//   turn it was sent) and keep images only if the turn is among the last
//   RECENT_IMAGE_TURNS user turns (multi-turn vision), else drop everything.
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
    editAttachments,
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
        addMessage(conversationId, "user", lastUser.content, userMessageId, lastUser.attachments);
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
        if (editAttachments !== undefined) {
          updateMessageAttachments(editMessageId, editAttachments);
        }
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

    // Precompute which user turns still carry attachments when sent to the
    // model: the latest user turn keeps everything; the last RECENT_IMAGE_TURNS
    // user turns keep their images; everything older is stripped to plain
    // text. See attachmentsForTurn / RECENT_IMAGE_TURNS above.
    const userIdx = messages.map((m, i) => (m.role === "user" ? i : -1)).filter((i) => i >= 0);
    const lastUserIdx = userIdx[userIdx.length - 1];
    const keepImageIdx = new Set(userIdx.slice(-RECENT_IMAGE_TURNS));

    const result = streamText({
      model,
      system: systemPromptFor(conv.mode) + contextBlock,
      messages: messages.map((m, i) =>
        m.role === "user"
          ? {
              role: "user" as const,
              content: toModelContent(m.content, attachmentsForTurn(m, i, lastUserIdx, keepImageIdx)),
            }
          : { role: m.role, content: m.content },
      ),
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