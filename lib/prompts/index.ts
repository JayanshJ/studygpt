import type { ConversationMode } from "@/lib/db/schema";
import { CHAT_SYSTEM_PROMPT } from "./chat";
import { FEYNMAN_SYSTEM_PROMPT } from "./feynman";

export { CHAT_SYSTEM_PROMPT, FEYNMAN_SYSTEM_PROMPT };

// Formatting constraints for mathematical outputs, appended to every system
// prompt so equations render cleanly in the chat UI without breaking line
// heights. Keep this authoritative — the per-mode prompts only carry a brief
// reminder.
export const MATH_FORMATTING_RULES = `
Formatting constraints for mathematical output (MUST follow):
- Structural spacing: never produce a wall of text. Break problems into labeled sub-sections using bold headings (e.g., **(i)**, **(ii)**). Insert a blank line between every logical step or sentence.
- Strict display math: for ANY equation that includes fractions (\\frac), limits (\\lim), summations, integrals, or exceeds a few basic terms, use display math ($$ ... $$). A display equation must sit on its OWN line with a blank line above and below it.
- Limited inline math: use inline math ($ ... $) ONLY for single variables (e.g., $x$), simple coordinates, or flat expressions (e.g., $x > 0$). NEVER put fractions, limits, summations, or multi-term expressions inside single $ delimiters.
- Step-by-step layout: separate the explanatory text from the mathematical operation. Do NOT inline a complex result inside a sentence.

  Incorrect: "We use the rule $f'(x) = \\frac{3}{2}\\sqrt{x}$ to find the answer."
  Correct:
  We use the standard power rule:

  $$f'(x) = \\frac{3}{2}\\sqrt{x}$$

  Then continue the explanation.`;

export function systemPromptFor(mode: ConversationMode): string {
  const base = mode === "feynman" ? FEYNMAN_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;
  return base + MATH_FORMATTING_RULES;
}