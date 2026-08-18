import { NextResponse } from "next/server";
import { z } from "zod";
import { createConversation, listConversations } from "@/lib/db";
import { getModelConfig } from "@/lib/llm/provider";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";
import { validateBody } from "@/lib/server/validation";

// GET /api/conversations — list all, newest first.
export const GET = withRouteHandlerNoParams(async () =>
  NextResponse.json(listConversations()),
);

// POST /api/conversations — create a new conversation.
// Body: { title?, mode?, projectId? }  (model defaults to the live settings model).
// projectId is nullable: the client sends `{ projectId: activeProjectId }` where
// activeProjectId may be null (standalone). `.nullable().optional()` accepts
// string | null | undefined — matching the original `typeof === "string" ? : null`
// guard so a standalone conversation still creates (was rejecting null → 400 →
// the client pushed the error body into the conversation list → bad keys).
const CreateConversationBody = z.object({
  title: z.string().optional(),
  mode: z.enum(["chat", "feynman"]).optional(),
  projectId: z.string().nullable().optional(),
});

export const POST = withRouteHandlerNoParams(async ({ request }) => {
  const parsed = await validateBody(request, CreateConversationBody);
  if (!parsed.ok) return parsed.response;
  const { title, mode, projectId } = parsed.value;
  const cfg = getModelConfig();
  const conv = createConversation({
    title: title || "New conversation",
    mode: mode === "feynman" ? "feynman" : "chat",
    model: cfg.model,
    projectId: typeof projectId === "string" ? projectId : null,
  });
  return NextResponse.json(conv, { status: 201 });
});