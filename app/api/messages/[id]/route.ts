import { NextResponse } from "next/server";
import { getMessageSources, getMessage, getConversation } from "@/lib/db";
import { withRouteHandler } from "@/lib/server/withRouteHandler";

// GET /api/messages/[id] — the message's content + kind + sources (+ the
// conversation title). The chat's Sources panel consumes `sources`; the
// /print/[id] page consumes `content` + `kind` to render the document. Sources
// are keyed by message id, so no conversation lookup is needed for them.
export const GET = withRouteHandler<{ id: string }>(async ({ params }) => {
  const { id } = params;
  const msg = getMessage(id);
  if (!msg) return new Response("Not found", { status: 404 });
  const conv = getConversation(msg.conversation_id);
  return NextResponse.json({
    content: msg.content,
    kind: msg.kind,
    conversationTitle: conv?.title ?? null,
    sources: getMessageSources(id),
  });
});