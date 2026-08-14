import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationContext } from "./conversation-context";
import { documentSystemPrompt, systemPromptFor } from "@/lib/prompts";

test("indexes document, Mermaid, native, and legacy artifacts from assistant messages", () => {
  const context = buildConversationContext([
    { id: "doc", role: "assistant", kind: "document", content: "# Revision notes" },
    { id: "diagram", role: "assistant", kind: "chat", content: "```mermaid\nerDiagram\n```" },
    { id: "visual", role: "assistant", kind: "chat", content: "```artifact\n<html></html>\n```" },
    { id: "deck", role: "assistant", kind: "chat", content: "```flashcard\nQ: What is a key?\nA: An identifier.\n```" },
    { id: "custom", role: "assistant", kind: "chat", content: "```artifact-html\n<div>Interactive</div>\n```" },
    { id: "malformed", role: "assistant", kind: "chat", content: "```artifact\n{invalid\n```" },
    {
      id: "native-message",
      role: "assistant",
      kind: "chat",
      content: `\`\`\`artifact
{
  "schema": "studygpt.artifact",
  "version": 1,
  "kind": "comparison",
  "title": "Read/write conflicts",
  "data": {
    "items": [{ "label": "Read", "value": "Shared" }]
  }
}
\`\`\``,
    },
    { id: "question", role: "user", kind: "chat", content: "Make a diagram" },
  ]);

  assert.deepEqual(context.artifacts.map((item) => [item.kind, item.messageId, item.label]), [
    ["document", "doc", "Revision notes"],
    ["diagram", "diagram", "Diagram"],
    ["visualization", "visual", "Visualization"],
    ["flashcards", "deck", "Flashcards"],
    ["visualization", "custom", "Visualization"],
    ["visualization", "native-message", "Read/write conflicts"],
  ]);
  assert.deepEqual(context.artifacts.at(-1), {
    id: "native-message:visualization",
    messageId: "native-message",
    kind: "visualization",
    label: "Read/write conflicts",
  });
});

test("keeps native artifact instructions out of document prompts", () => {
  const chatPrompt = systemPromptFor("chat");
  const documentPrompt = documentSystemPrompt();

  assert.match(chatPrompt, /studygpt\.artifact/);
  assert.match(chatPrompt, /artifact-html/);
  assert.doesNotMatch(documentPrompt, /studygpt\.artifact/);
  assert.doesNotMatch(documentPrompt, /artifact-html/);
});

test("deduplicates sources while retaining their first citing message", () => {
  const context = buildConversationContext([
    {
      id: "answer-one",
      role: "assistant",
      kind: "chat",
      content: "First answer",
      sources: [
        { materialId: "slides", title: "Lecture slides", ordinal: 2, snippet: "A" },
        { materialId: "slides", title: "Lecture slides", ordinal: 4, snippet: "B" },
      ],
    },
    {
      id: "answer-two",
      role: "assistant",
      kind: "chat",
      content: "Second answer",
      sources: [{ materialId: "book", title: "Course book", ordinal: 8, snippet: "C" }],
    },
  ]);

  assert.deepEqual(context.sources, [
    { materialId: "slides", title: "Lecture slides", citationCount: 2, messageId: "answer-one" },
    { materialId: "book", title: "Course book", citationCount: 1, messageId: "answer-two" },
  ]);
});

test("indexes an artifact as soon as its opening fence streams", () => {
  const context = buildConversationContext([
    { id: "streaming", role: "assistant", kind: "chat", content: "Here is the model:\n```mermaid" },
  ]);

  assert.equal(context.artifacts[0]?.kind, "diagram");
});
