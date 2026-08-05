import { addMessage } from "@/lib/db";

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
  if (!conversationId || !messageId || !role || content === undefined) {
    return new Response("Missing conversationId, messageId, role, or content", { status: 400 });
  }
  addMessage(conversationId, role, content, messageId);
  return new Response("OK", { status: 200 });
}