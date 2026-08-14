"use client";

import type { CSSProperties, ReactNode } from "react";
import { MarkdownHooks as ReactMarkdown } from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import rehypePrettyCode from "rehype-pretty-code";
import { CodeBlock } from "./CodeBlock";
import { codeHighlightOptions } from "@/lib/markdown/highlight";
import { Artifact } from "./Artifact";
import { InvalidArtifact, NativeArtifact } from "./artifacts/NativeArtifact";
import { FlashcardDeck } from "./FlashcardDeck";
import { MermaidDiagram } from "./MermaidDiagram";
import { classifyArtifact } from "@/lib/artifacts/schema";
import { extractText } from "@/lib/markdown/extract-text";
import { normalizeMathDelimiters } from "@/lib/markdown/normalize-math";

// Route a fenced code block by its language: an ```artifact fence renders a
// live sandboxed HTML visualization; a ```flashcard fence renders an
// interactive flip deck. Any other fence renders the normal CodeBlock. While
// streaming, an artifact/flashcard fence shows a placeholder — mounting the
// widget on a half-streamed block would reload/re-parse it on every chunk.
// `children` is the inner <code> element react-markdown places inside <pre>;
// its className carries the language as `language-<lang>`.
export function PreBlock({
  children,
  "data-language": dataLanguage,
  className,
  style,
  streaming,
  conversationTitle,
  conversationId,
  ephemeral,
}: {
  children?: ReactNode;
  // rehype-pretty-code (shiki 4) replaces the legacy `language-xxx` class on
  // <code> with a `data-language` attribute on <pre>/<code>. Read it to route
  // artifact/flashcard fences and to label the code block. (The pre's class is
  // forwarded onto CodeBlock's <pre> for any future chrome; shiki emits token
  // colors as --shiki-light/--shiki-dark vars on the spans, themed in CSS.)
  "data-language"?: string;
  className?: string;
  style?: CSSProperties;
  streaming?: boolean;
  conversationTitle?: string;
  conversationId?: string;
  ephemeral?: boolean;
}) {
  const codeEl = (Array.isArray(children) ? children[0] : children) as
    | { props?: { className?: string } }
    | undefined;
  // Fall back to the legacy `language-` class only if a path bypassed the
  // highlighter (defensive — rehype-pretty-code runs on every fence).
  const legacyClassName = codeEl?.props?.className ?? "";
  const lang = dataLanguage ?? /language-([\w-]+)/.exec(legacyClassName)?.[1];
  if (lang === "artifact" || lang === "artifact-html") {
    if (streaming) {
      return (
        <div className="mono my-3 flex items-center gap-1.5 rounded-card border border-border bg-surface-2 px-4 py-3 text-[12px] text-content-faint shadow-sm">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-rule" />
          building visualization…
        </div>
      );
    }
    if (lang === "artifact-html") {
      return (
        <div data-selection-excluded>
          <Artifact html={extractText(children)} />
        </div>
      );
    }
    const classification = classifyArtifact(extractText(children));
    if (classification.type === "native") {
      return (
        <div data-selection-excluded>
          <NativeArtifact artifact={classification.artifact} />
        </div>
      );
    }
    if (classification.type === "legacy-html") {
      return (
        <div data-selection-excluded>
          <Artifact html={classification.html} />
        </div>
      );
    }
    return (
      <InvalidArtifact source={classification.source} reason={classification.reason} />
    );
  }
  if (lang === "mermaid") {
    if (streaming) {
      return (
        <div className="mono my-3 flex items-center gap-1.5 rounded-card border border-border bg-surface-2 px-4 py-3 text-[12px] text-content-faint shadow-sm">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-rule" />
          building diagram…
        </div>
      );
    }
    return <MermaidDiagram code={extractText(children)} />;
  }
  if (lang === "flashcard") {
    if (streaming) {
      return (
        <div className="mono my-3 flex items-center gap-1.5 rounded-card border border-border bg-surface-2 px-4 py-3 text-[12px] text-content-faint shadow-sm">
          <span className="inline-block h-1 w-1 animate-pulse rounded-full bg-rule" />
          building flashcards…
        </div>
      );
    }
    return (
      <div data-selection-excluded>
        <FlashcardDeck
          source={extractText(children)}
          conversationTitle={conversationTitle}
          conversationId={conversationId}
          reviewMode={ephemeral}
        />
      </div>
    );
  }
  return (
    <CodeBlock className={className} style={style} lang={lang}>
      {children}
    </CodeBlock>
  );
}

// The single markdown-rendering config for the app: remark-math + remark-gfm
// (tables/strikethrough/autolinks/task-lists) + rehype-pretty-code (Shiki
// syntax highlighting — async, so we render via MarkdownHooks, the
// async-capable react-markdown entry) + rehype-katex, with LaTeX delimiters
// normalized before parse so \(...\)/\[...\] also render. `pre` is routed via
// PreBlock (artifact/flashcard vs. CodeBlock). Shared by ChatMessage and the
// /print page so a document renders identically in the chat card and the PDF.
// `conversationTitle`/`conversationId` thread through so an inline flashcard
// deck can title + link the deck it saves to the originating chat.
export function Markdown({
  content,
  className,
  streaming,
  conversationTitle,
  conversationId,
  ephemeral,
}: {
  content: string;
  className?: string;
  streaming?: boolean;
  conversationTitle?: string;
  conversationId?: string;
  ephemeral?: boolean;
}) {
  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypePrettyCode, codeHighlightOptions], rehypeKatex]}
        components={{
          pre: (props) => (
            <PreBlock
              {...props}
              streaming={streaming}
              conversationTitle={conversationTitle}
              conversationId={conversationId}
              ephemeral={ephemeral}
            />
          ),
        }}
      >
        {normalizeMathDelimiters(content || "")}
      </ReactMarkdown>
    </div>
  );
}
