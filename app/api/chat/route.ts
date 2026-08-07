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
  listChunkEmbeddingsForProject,
  setMessageSources,
  setMessageTokens,
} from "@/lib/db";
import { embedText, decodeEmbedding, cosine } from "@/lib/embed";
import { isVisionModel } from "@/lib/llm/vision";
import { estimateTokens, userTurnText } from "@/lib/tokens";
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

    // --- Retrieval (two-stage RAG, only for project conversations) ---
    // Stage 1: material routing — embed the (cleaned) query, score every
    // chunk by cosine similarity, drop chunks below the floor, then rank
    // materials by their best chunk score and select the top 4.
    // Stage 2: excerpt selection — within the selected materials, greedily
    // take the top-scoring chunks with neighbor (ordinal ±1) expansion, dedup
    // by leading text, and accumulate up to a ~6000-char budget. The context
    // block lists ALL project materials (so the model is aware of everything)
    // followed by the selected excerpts. Sources are persisted before
    // streaming so they survive a mid-stream stop. Retrieval failure is
    // non-fatal: fall back to an ungrounded answer.
    let contextBlock = "";
    let sources: SourceEntry[] = [];
    if (conv.project_id) {
      const chunks = listChunkEmbeddingsForProject(conv.project_id);
      if (chunks.length > 0 && lastUser) {
        try {
          // Clean the query: strip leading `>` quote lines and markdown fences,
          // collapse whitespace, truncate to ~600 chars.
          const strippedFences = lastUserContent.replace(/```[\s\S]*?```/g, " ");
          const withoutQuotes = strippedFences
            .split("\n")
            .filter((ln) => !/^\s*>/.test(ln))
            .join("\n");
          const cleaned = withoutQuotes.replace(/\s+/g, " ").trim().slice(0, 600);
          const cleanQuery = cleaned || lastUserContent.slice(0, 600);

          // --- Explicit material reference detection ----------------------
          // A request like "make flashcards from Übungsblatt 6" is a *meta*
          // request: it names a material but isn't semantically similar to that
          // material's content. Pure cosine retrieval scores those chunks low,
          // drops them under the 0.22 floor, and selects whichever materials
          // have incidental similarity (e.g. sheets 1/7/9) instead. Detect when
          // the user names a material — by full title, or by "<word> <number>"
          // (e.g. "übungsblatt 6", "kapitel 6") — and force that material's
          // chunks in regardless of cosine. The word match is fuzzy so a mangled
          // spoken/typed word ("un-bungblatt") still matches "uebungsblatt".
          const normRef = (s: string) =>
            s
              .toLowerCase()
              .normalize("NFKD")
              .replace(/[̀-ͯ]/g, "")
              .replace(/\.(pdf|txt|md|markdown|csv|tsv|json|docx?)$/i, "")
              .replace(/[^a-z0-9]+/g, " ")
              .trim();
          const refTokens = (s: string) => {
            const t = normRef(s);
            return t ? t.split(" ").filter(Boolean) : [];
          };
          const isAlphaTok = (t: string) => /[a-z]/.test(t) && t.length >= 4;
          // Fuzzy word match tolerant of transcription/typo mangling, e.g.
          // "bungblatt" matches "uebungsblatt": contiguous substring either way,
          // OR subsequence (only for ≥5 chars so short words don't over-match).
          const fuzzyWord = (a: string, b: string) => {
            if (!a || !b) return false;
            if (a.includes(b) || b.includes(a)) return true;
            if (a.length < 5 || b.length < 5) return false;
            const [hay, needle] = a.length >= b.length ? [a, b] : [b, a];
            let i = 0;
            for (const ch of hay) {
              if (ch === needle[i]) {
                i++;
                if (i === needle.length) return true;
              }
            }
            return false;
          };

          const materialTitles = new Map<string, string>();
          for (const c of chunks) {
            if (!materialTitles.has(c.materialId)) materialTitles.set(c.materialId, c.materialTitle);
          }

          const detectRefs = (text: string): Set<string> => {
            const ids = new Set<string>();
            const qToks = refTokens(text);
            const qNorm = normRef(text);
            for (const [mid, title] of materialTitles) {
              const tToks = refTokens(title);
              const tNums = tToks.filter((t) => /^\d+$/.test(t));
              const tAlpha = tToks.filter(isAlphaTok);
              const tNorm = normRef(title);
              // (1) full normalized title appears in the query (clean mention)
              if (tNorm && tNorm.length >= 3 && qNorm.includes(tNorm)) {
                ids.add(mid);
                continue;
              }
              // (2) "<word> <number>": a query number matches a title number,
              // with an alpha qualifier right before it fuzzy-matching the
              // title's alpha token. Disambiguates "übungsblatt 6" →
              // 6._Uebungsblatt vs Kapitel_6, and ignores count words like
              // "make 10 flashcards" (no title word before the number).
              for (let qi = 0; qi < qToks.length; qi++) {
                if (!/^\d+$/.test(qToks[qi])) continue;
                if (!tNums.includes(qToks[qi])) continue;
                let qualifier = "";
                for (let j = qi - 1; j >= Math.max(0, qi - 3); j--) {
                  if (isAlphaTok(qToks[j])) {
                    qualifier = qToks[j];
                    break;
                  }
                }
                if (!qualifier) continue; // bare number → too ambiguous (could be a count)
                if (tAlpha.some((a) => fuzzyWord(a, qualifier))) {
                  ids.add(mid);
                  break;
                }
              }
            }
            return ids;
          };

          let explicitIds = detectRefs(lastUserContent);
          // A bare follow-up like "again" / "make them again" carries no
          // material name; pull the reference from the prior user turn so the
          // redo keeps the same material instead of falling back to semantic.
          if (explicitIds.size === 0 && lastUserContent.trim().split(/\s+/).length <= 10) {
            const prevUser = [...messages]
              .reverse()
              .filter((m) => m.role === "user")
              .slice(1, 3)
              .map((m) => m.content)
              .join(" ");
            if (prevUser) explicitIds = detectRefs(prevUser);
          }

          // --- Semantic scoring (for non-explicit selection) ------------
          const qVec = await embedText(cleanQuery);
          const q = Float32Array.from(qVec);
          const scored = chunks.map((c) => ({
            c,
            sim: cosine(q, decodeEmbedding(c.embedding)),
          }));
          // Drop chunks below the similarity floor.
          const eligible = scored.filter((s) => s.sim >= 0.22);

          // Material routing: per-material max chunk score → rank → top 4
          // (or all if fewer). Only chunks from selected materials are eligible
          // for excerpt selection, but the inventory below lists every material.
          const perMaterial = new Map<string, { title: string; max: number }>();
          for (const s of eligible) {
            const cur = perMaterial.get(s.c.materialId);
            if (!cur || s.sim > cur.max) {
              perMaterial.set(s.c.materialId, { title: s.c.materialTitle, max: s.sim });
            }
          }
          const rankedMaterials = [...perMaterial.entries()]
            .sort((a, b) => b[1].max - a[1].max)
            .slice(0, 4)
            .map(([id]) => id);
          // Selected = top-4 semantic ∪ explicitly referenced materials.
          const selectedMatSet = new Set(rankedMaterials);
          for (const id of explicitIds) selectedMatSet.add(id);

          // Index every chunk in selected materials by `${materialId}:${ordinal}`
          // so neighbor expansion can look up ordinal ±1 regardless of score.
          const chunkIndex = new Map<string, (typeof chunks)[number]>();
          for (const c of chunks) {
            if (selectedMatSet.has(c.materialId)) {
              chunkIndex.set(`${c.materialId}:${c.ordinal}`, c);
            }
          }

          const eligibleSelected = eligible
            .filter((s) => selectedMatSet.has(s.c.materialId))
            .sort((a, b) => b.sim - a.sim);

          // Inventory of ALL project materials (title + chunk count).
          const inventoryMap = new Map<string, { title: string; count: number }>();
          for (const c of chunks) {
            const cur = inventoryMap.get(c.materialId);
            if (cur) cur.count += 1;
            else inventoryMap.set(c.materialId, { title: c.materialTitle, count: 1 });
          }
          const inventory = [...inventoryMap.values()];

          // Greedily take top chunks with neighbor expansion (ordinal ±1),
          // dedup by first-80 chars, accumulate until ~6000-char budget.
          const BUDGET = 6000;
          const seenText = new Set<string>();
          const pickedOrdinals = new Set<string>();
          const picked: Array<{ c: (typeof chunks)[number]; sim: number }> = [];
          let totalChars = 0;

          const tryAdd = (chunk: (typeof chunks)[number]): boolean => {
            const textKey = chunk.text.slice(0, 80);
            const ordKey = `${chunk.materialId}:${chunk.ordinal}`;
            if (seenText.has(textKey) || pickedOrdinals.has(ordKey)) return false;
            if (totalChars + chunk.text.length > BUDGET && picked.length > 0) return false;
            seenText.add(textKey);
            pickedOrdinals.add(ordKey);
            picked.push({ c: chunk, sim: 0 });
            totalChars += chunk.text.length;
            return true;
          };

          // (A) Explicitly referenced materials FIRST: take their chunks in
          // natural document order (ordinal) up to a per-material slice of the
          // budget, bypassing the cosine floor — the user asked for THIS
          // material, so its content is relevant by reference, not similarity.
          if (explicitIds.size > 0) {
            const explicitSlice = Math.max(2500, Math.floor(BUDGET / explicitIds.size));
            for (const mid of explicitIds) {
              const ordered = chunks
                .filter((c) => c.materialId === mid)
                .sort((a, b) => a.ordinal - b.ordinal);
              let used = 0;
              for (const c of ordered) {
                if (used >= explicitSlice) break;
                if (tryAdd(c)) used += c.text.length;
              }
            }
          }

          // (B) Fill the remaining budget with the top semantic chunks from
          // the other selected materials, with neighbor expansion.
          for (const s of eligibleSelected) {
            if (totalChars >= BUDGET) break;
            if (explicitIds.has(s.c.materialId)) continue; // already seeded above
            tryAdd(s.c);
            for (const d of [-1, 1]) {
              const neighbor = chunkIndex.get(`${s.c.materialId}:${s.c.ordinal + d}`);
              if (neighbor) tryAdd(neighbor);
            }
          }

          sources = picked.map((s) => ({
            materialId: s.c.materialId,
            title: s.c.materialTitle,
            snippet: s.c.text.slice(0, 240),
            ordinal: s.c.ordinal,
          }));

          const inventoryLines = inventory
            .map((m, i) => `${i + 1}. ${m.title} (${m.count} chunk${m.count === 1 ? "" : "s"})`)
            .join("\n");

          // Group selected excerpts by material for the context block.
          const byMaterial = new Map<string, { title: string; texts: string[] }>();
          for (const s of picked) {
            let g = byMaterial.get(s.c.materialId);
            if (!g) {
              g = { title: s.c.materialTitle, texts: [] };
              byMaterial.set(s.c.materialId, g);
            }
            g.texts.push(s.c.text);
          }

          const excerpts = [...byMaterial.values()]
            .map((g) => `<excerpt material="${g.title}">\n${g.texts.join("\n\n")}\n</excerpt>`)
            .join("\n---\n");

          const explicitNote =
            explicitIds.size > 0
              ? `The user explicitly referenced: ${[...explicitIds]
                  .map((id) => materialTitles.get(id) ?? "")
                  .filter(Boolean)
                  .join(", ")}. Focus on those materials' excerpts and cite them by title. `
              : "";

          contextBlock =
            `\n\n<context>\n` +
            `You are working within a study project with the following reference materials:\n` +
            `${inventoryLines}\n` +
            `${explicitNote}` +
            `The excerpts below are the most relevant passages retrieved for this question. ` +
            `Use them to ground your answer and cite a source by its title in square brackets when you rely on it. ` +
            `If the user names a specific material, focus your answer on that material. ` +
            `If the answer is not in the excerpts, say so, then either answer from general knowledge and say so, ` +
            `or use the web_search tool if web search is enabled.\n\n` +
            `${excerpts}\n</context>`;

          if (assistantMessageId) setMessageSources(assistantMessageId, sources);
        } catch {
          // Retrieval failure is non-fatal — fall back to an ungrounded answer.
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