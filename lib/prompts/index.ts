import type { ConversationMode } from "@/lib/db/schema";
import { CHAT_SYSTEM_PROMPT } from "./chat";
import { FEYNMAN_SYSTEM_PROMPT } from "./feynman";

export { CHAT_SYSTEM_PROMPT, FEYNMAN_SYSTEM_PROMPT };

export function systemPromptFor(mode: ConversationMode): string {
  return mode === "feynman" ? FEYNMAN_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;
}