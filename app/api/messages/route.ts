import { z } from "zod";
import { addMessage } from "@/lib/db";
import { estimateTokens } from "@/lib/tokens";
import { withRouteHandlerNoParams } from "@/lib/server/withRouteHandler";
import { validateBody } from "@/lib/server/validation";

// PATCH { conversationId, messageId, role, content, kind?, deliveryState? }
// Stop-persist: writes a partial assistant reply under messageId. Uses
// addMessage (INSERT OR IGNORE) so if onFinish already wrote the full
// reply, this is a no-op — the full reply wins.
const PatchMessageBody = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  // Preserve the document tag when stop-persisting a partial document stream,
  // so a stopped document still renders as a document card on reload. If
  // omitted, addMessage defaults to 'chat'.
  kind: z.enum(["chat", "document"]).optional(),
  deliveryState: z.enum(["complete", "interrupted"]).optional(),
});

export const PATCH = withRouteHandlerNoParams(async ({ request }) => {
  const parsed = await validateBody(request, PatchMessageBody);
  if (!parsed.ok) return parsed.response;
  const { conversationId, messageId, role, content, kind, deliveryState } =
    parsed.value;
  // Store a token estimate so even a stopped partial counts toward the
  // global token total. If onFinish later writes the full reply, its INSERT
  // OR IGNORE is a no-op and the full reply's tokens win via upsertMessage.
  addMessage(
    conversationId,
    role,
    content,
    messageId,
    undefined,
    estimateTokens(content),
    kind,
    deliveryState === "interrupted" ? "interrupted" : "complete",
  );
  return new Response("OK", { status: 200 });
});