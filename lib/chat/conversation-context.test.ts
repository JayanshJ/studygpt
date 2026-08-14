import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationContext } from "./conversation-context";

test("indexes document, Mermaid, and HTML artifacts from assistant messages", () => {
  const context = buildConversationContext([
    { id: "doc", role: "assistant", kind: "document", content: "# Revision notes" },
    { id: "diagram", role: "assistant", kind: "chat", content: "```mermaid\nerDiagram\n```" },
    { id: "visual", role: "assistant", kind: "chat", content: "```artifact\n<html></html>\n```" },
    { id: "deck", role: "assistant", kind: "chat", content: "```flashcard\nQ: What is a key?\nA: An identifier.\n```" },
    { id: "question", role: "user", kind: "chat", content: "Make a diagram" },
  ]);

  assert.deepEqual(context.artifacts.map((item) => [item.kind, item.messageId, item.label]), [
    ["document", "doc", "Revision notes"],
    ["diagram", "diagram", "Diagram"],
    ["visualization", "visual", "Visualization"],
    ["flashcards", "deck", "Flashcards"],
  ]);
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
