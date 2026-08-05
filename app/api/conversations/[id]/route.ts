import { NextResponse } from "next/server";
import {
  deleteConversation,
  getConversation,
  listMessages,
  updateConversationMode,
  updateConversationTitle,
} from "@/lib/db";
import type { ConversationMode } from "@/lib/db/schema";

// GET /api/conversations/[id] — conversation + its messages.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conv = getConversation(id);
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ conversation: conv, messages: listMessages(id) });
}

// PATCH /api/conversations/[id] — update mode and/or title.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body.mode === "chat" || body.mode === "feynman") {
    updateConversationMode(id, body.mode as ConversationMode);
  }
  if (typeof body.title === "string") {
    updateConversationTitle(id, body.title);
  }
  return NextResponse.json(getConversation(id));
}

// DELETE /api/conversations/[id]
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  deleteConversation(id);
  return NextResponse.json({ ok: true });
}