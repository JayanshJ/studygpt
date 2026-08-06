import type { ConversationMode } from "@/lib/db/schema";
import { CHAT_SYSTEM_PROMPT } from "./chat";
import { FEYNMAN_SYSTEM_PROMPT } from "./feynman";
import { DOCUMENT_SYSTEM_PROMPT } from "./document";

export { CHAT_SYSTEM_PROMPT, FEYNMAN_SYSTEM_PROMPT, DOCUMENT_SYSTEM_PROMPT };

// Formatting constraints for mathematical outputs, appended to every system
// prompt so equations render cleanly in the chat UI without breaking line
// heights. Keep this authoritative — the per-mode prompts only carry a brief
// reminder.
export const MATH_FORMATTING_RULES = `
Formatting constraints for mathematical output (MUST follow):
- Delimiters: ALWAYS use $...$ for inline math and $$...$$ for display math. NEVER use \\(...\\) or \\[...\\] delimiters — they do NOT render in this interface and will appear as raw text. Every math expression must be wrapped in $ or $$.
- Structural spacing: never produce a wall of text. Break problems into labeled sub-sections using bold headings (e.g., **(i)**, **(ii)**). Insert a blank line between every logical step or sentence.
- Strict display math: for ANY equation that includes fractions (\\frac), limits (\\lim), summations, integrals, or exceeds a few basic terms, use display math ($$ ... $$). A display equation must sit on its OWN line with a blank line above and below it.
- Limited inline math: use inline math ($ ... $) ONLY for single variables (e.g., $x$), simple coordinates, or flat expressions (e.g., $x > 0$). NEVER put fractions, limits, summations, or multi-term expressions inside single $ delimiters.
- Step-by-step layout: separate the explanatory text from the mathematical operation. Do NOT inline a complex result inside a sentence.

  Incorrect: "We use the rule $f'(x) = \\frac{3}{2}\\sqrt{x}$ to find the answer."
  Correct:
  We use the standard power rule:

  $$f'(x) = \\frac{3}{2}\\sqrt{x}$$

  Then continue the explanation.`;

// When the user asks to visualize / render / draw / plot / diagram / build
// something visual or interactive, the model emits a single ```artifact fenced
// block containing a complete, self-contained HTML document; the chat renders
// it inline in a sandboxed iframe (see components/Artifact.tsx). Appended to
// every mode's prompt so the capability is available everywhere.
export const ARTIFACT_RULES = `
Inline visualization artifacts:
- When the user asks you to visualize, render, draw, plot, diagram, animate, or build something visual or interactive, emit a SINGLE fenced code block with the language \`artifact\` containing a COMPLETE, self-contained HTML document that renders it in a browser.
- The artifact renders in a sandboxed iframe. Use inline <style> and <script>. You MAY load libraries from a CDN with <script src="https://..."> (e.g. Chart.js, Plotly, D3, Mermaid, KaTeX, Three.js). It cannot access the parent page, so be fully self-contained: inline your data as JS.
- Make it work standalone: full HTML structure, sensible responsive width, a reasonable height, and your data inline. For charts use Chart.js or Plotly; for diagrams use Mermaid or D3 or hand-drawn SVG; for math use KaTeX from CDN.
- Emit an \`artifact\` block ONLY when the user explicitly wants a visual/interactive output. For ordinary code answers, use normal fenced code blocks with the real language. You may add a short prose explanation before the artifact, but the artifact block itself must contain ONLY the HTML.`;

export function systemPromptFor(mode: ConversationMode): string {
  const base = mode === "feynman" ? FEYNMAN_SYSTEM_PROMPT : CHAT_SYSTEM_PROMPT;
  return base + MATH_FORMATTING_RULES + ARTIFACT_RULES;
}

// System prompt for a one-shot document turn (the "Document" send action).
// Mirrors systemPromptFor(): document base + the shared math rules + artifact
// rules. The retrieval contextBlock is appended by the chat route, just as it
// is for the chat/feynman modes — so a document in a project conversation
// stays grounded in the project's reference materials.
export function documentSystemPrompt(): string {
  return DOCUMENT_SYSTEM_PROMPT + MATH_FORMATTING_RULES + ARTIFACT_RULES;
}