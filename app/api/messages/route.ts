import { addMessage } from "@/lib/db";
import { estimateTokens } from "@/lib/tokens";

interface Body {
  conversationId?: string;
  messageId?: string;
  role?: "user" | "assistant" | "system";
  content?: string;
}

// PATCH { conversationId, messageId, role, content }
// Stop-persist: writes a partial assistant reply under messageId. Uses
// addMessage (INSERT OR IGNORE) so if onFinish already wrote the full
// reply, this is a no-op — the full reply wins.
export async function PATCH(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const { conversationId, messageId, role, content } = body;
  const validRoles = ["user", "assistant", "system"];
  if (
    !conversationId ||
    !messageId ||
    !role ||
    !validRoles.includes(role as string) ||
    content === undefined
  ) {
    return new Response("Missing or invalid conversationId, messageId, role, or content", { status: 400 });
  }
  // Store a token estimate so even a stopped partial counts toward the
  // global token total. If onFinish later writes the full reply, its INSERT
  // OR IGNORE is a no-op and the full reply's tokens win via upsertMessage.
  addMessage(conversationId, role, content, messageId, undefined, estimateTokens(content));
  return new Response("OK", { status: 200 });
}