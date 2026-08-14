import { NextResponse } from "next/server";
import {
  getConversation,
  listConversationMessagesThrough,
  listOverlayMessages,
  listOverlayThreads,
  resolveOverlayThread,
} from "@/lib/db";
import { normalizeSelectedText } from "@/lib/chat/overlay-context";

type ResolveBody = {
  conversationId?: string;
  sourceMessageId?: string;
  selectedText?: string;
  textOffset?: number;
};

export async function GET(req: Request) {
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
  if (!getConversation(conversationId)) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  return NextResponse.json({ threads: listOverlayThreads(conversationId) });
}

// Resolve an existing discussion when the exact selected passage was opened
// before, or create its durable thread on first use. Source validation ensures
// a selection cannot point at a user message or another conversation.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as ResolveBody;
  const selectedText = typeof body.selectedText === "string" ? normalizeSelectedText(body.selectedText) : null;
  const textOffset = typeof body.textOffset === "number" && Number.isSafeInteger(body.textOffset) && body.textOffset >= 0
    ? body.textOffset
    : null;
  if (!body.conversationId || !body.sourceMessageId || !selectedText || textOffset === null) {
    return NextResponse.json({ error: "Missing overlay context" }, { status: 400 });
  }
  if (!getConversation(body.conversationId)) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }
  if (!listConversationMessagesThrough(body.conversationId, body.sourceMessageId)) {
    return NextResponse.json({ error: "Original answer is no longer available" }, { status: 404 });
  }

  const { thread } = resolveOverlayThread(body.conversationId, body.sourceMessageId, selectedText, textOffset);
  return NextResponse.json({ thread, messages: listOverlayMessages(thread.id) });
}
