import type { SourceEntry } from "@/lib/db/schema";

export type ContextArtifactKind = "document" | "diagram" | "visualization" | "flashcards";

export type ContextMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  kind?: "chat" | "document";
  sources?: SourceEntry[];
};

export type ConversationArtifact = {
  id: string;
  messageId: string;
  kind: ContextArtifactKind;
  label: string;
};

export type ConversationSource = {
  materialId: string;
  title: string;
  citationCount: number;
  messageId: string;
};

export type ConversationContext = {
  artifacts: ConversationArtifact[];
  sources: ConversationSource[];
};

const MERMAID_FENCE = /^```mermaid\b/m;
const ARTIFACT_FENCE = /^```artifact\b/m;
const FLASHCARD_FENCE = /^```flashcard\b/m;
const HEADING = /^#{1,6}\s+(.+?)\s*#*\s*$/m;

function documentLabel(content: string): string {
  return content.match(HEADING)?.[1]?.trim() || "Document";
}

function artifactForMessage(message: ContextMessage): ConversationArtifact[] {
  if (message.role !== "assistant") return [];

  const artifacts: ConversationArtifact[] = [];
  if (message.kind === "document") {
    artifacts.push({
      id: `${message.id}:document`,
      messageId: message.id,
      kind: "document",
      label: documentLabel(message.content),
    });
  }
  if (MERMAID_FENCE.test(message.content)) {
    artifacts.push({
      id: `${message.id}:diagram`,
      messageId: message.id,
      kind: "diagram",
      label: "Diagram",
    });
  }
  if (ARTIFACT_FENCE.test(message.content)) {
    artifacts.push({
      id: `${message.id}:visualization`,
      messageId: message.id,
      kind: "visualization",
      label: "Visualization",
    });
  }
  if (FLASHCARD_FENCE.test(message.content)) {
    artifacts.push({
      id: `${message.id}:flashcards`,
      messageId: message.id,
      kind: "flashcards",
      label: "Flashcards",
    });
  }
  return artifacts;
}

export function buildConversationContext(messages: ContextMessage[]): ConversationContext {
  const artifacts: ConversationArtifact[] = [];
  const sources = new Map<string, ConversationSource>();

  for (const message of messages) {
    artifacts.push(...artifactForMessage(message));
    if (message.role !== "assistant") continue;

    for (const source of message.sources ?? []) {
      const existing = sources.get(source.materialId);
      if (existing) {
        existing.citationCount += 1;
      } else {
        sources.set(source.materialId, {
          materialId: source.materialId,
          title: source.title,
          citationCount: 1,
          messageId: message.id,
        });
      }
    }
  }

  return { artifacts, sources: [...sources.values()] };
}
