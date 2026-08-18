import { NextResponse } from "next/server";
import { z } from "zod";
import {
  deleteConversation,
  getConversation,
  getMessageInsights,
  getMessageSources,
  listMessages,
  updateConversationMode,
  updateConversationModel,
  updateConversationTitle,
} from "@/lib/db";
import type { ConversationMode } from "@/lib/db/schema";
import { withRouteHandler } from "@/lib/server/withRouteHandler";
import { validateBody } from "@/lib/server/validation";

// GET /api/conversations/[id] — conversation + its messages.
export const GET = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Attach `sources` to assistant messages that have any, so the UI can cite
  // which material chunks backed each answer (empty arrays omitted).
  const messages = listMessages(id).map((message) => {
    if (message.role !== "assistant") return message;
    const sources = getMessageSources(message.id);
    const insights = getMessageInsights(message.id);
    return {
      ...message,
      ...(sources.length ? { sources } : {}),
      ...(insights.activities.length ? { activities: insights.activities } : {}),
      ...(insights.grounding ? { grounding: insights.grounding } : {}),
    };
  });
  return NextResponse.json({ conversation: conv, messages });
});

// PATCH /api/conversations/[id] — update mode, title, and/or model.
const UpdateConversationBody = z.object({
  mode: z.enum(["chat", "feynman"]).optional(),
  title: z.string().optional(),
  model: z.string().optional(),
});

export const PATCH = withRouteHandler<{ id: string }>(async ({ request, params }) => {
  const { id } = params;
  const parsed = await validateBody(request, UpdateConversationBody);
  if (!parsed.ok) return parsed.response;
  const { mode, title, model } = parsed.value;
  if (mode === "chat" || mode === "feynman") {
    updateConversationMode(id, mode as ConversationMode);
  }
  if (typeof title === "string") {
    updateConversationTitle(id, title);
  }
  if (typeof model === "string" && model.trim()) {
    updateConversationModel(id, model.trim());
  }
  return NextResponse.json(getConversation(id));
});

// DELETE /api/conversations/[id]
export const DELETE = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  deleteConversation(id);
  return NextResponse.json({ ok: true });
});